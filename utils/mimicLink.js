// utils/mimicLink.js — Discord device-code login flow for Mimic.
//
// Three public entry points (HTTP handlers below) plus a session resolver:
//
//   POST /api/mimic-link/start    — create a fresh user_code + device_code,
//                                   return both. No auth (anyone can ask).
//   POST /api/mimic-link/poll     — Mimic polls every 2s with its device_code;
//                                   returns pending/expired/linked. On linked,
//                                   the link code is deleted + a session_token
//                                   minted in mimic_sessions.
//   POST /api/mimic-link/revoke   — sign out: marks the session revoked.
//
//   _resolveMimicSession(req)     — header → { user_id, discord_id, role_names,
//                                   is_officer, signed_in_as } or null.
//
// We deliberately keep this lean: NO Express, NO refresh-token rotation, NO
// JWT. The session_token is an opaque bearer that we resolve via a single
// SELECT joined to wolfpack_members. v2 can layer rotation + scopes on top.

const crypto = require('crypto');
const supabase = require('./supabase');

const LINK_CODE_TTL_SECONDS = 10 * 60;     // 10 minutes from /start
const POLL_INTERVAL_SECONDS = 2;
const VERIFICATION_URL_DEFAULT = 'https://wolfpack.quest/auth/mimic-link';

// In-process session cache to avoid hitting Supabase on every upload. Mimic
// installs send the session token as a header on every agent request which the
// agent forwards to the bot on every call — cache for 5 minutes per token.
const _sessionCache = new Map();   // token → { resolvedAt, value }
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000;

// User-facing code is 6 chars from an unambiguous alphabet (no 0/O/1/I/L). The
// space is ~2.18B values; combined with the 10-min TTL and rate-limiting that's
// already plenty for a private guild tool. The DEVICE code is the real secret
// (32 random bytes hex'd → 64 chars) and is what protects the poll endpoint.
function _generateUserCode() {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';   // 31 chars, no 0/O/1/I/L
  let out = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
function _generateDeviceCode()   { return crypto.randomBytes(32).toString('hex'); }
function _generateSessionToken() { return 'wpms_' + crypto.randomBytes(32).toString('hex'); }

function _verificationUrl() {
  return process.env.MIMIC_LINK_VERIFICATION_URL || VERIFICATION_URL_DEFAULT;
}

async function _readJsonBody(req, maxBytes = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let aborted = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBytes) { aborted = true; req.destroy(); resolve(null); }
    });
    req.on('end',   () => { if (aborted) return; try { resolve(body ? JSON.parse(body) : {}); } catch { resolve(null); } });
    req.on('error', reject);
  });
}

// POST /api/mimic-link/start — initiate the dance.
async function handleStart(req, res) {
  const payload = await _readJsonBody(req).catch(() => null);
  if (payload === null) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'invalid json' })); }
  if (!supabase.isEnabled()) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'service unavailable' })); }

  // We may collide on a user_code in theory (1 in 2B). Retry once; the second
  // collision is implausible enough to surface as a 500 the user can retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    const userCode    = _generateUserCode();
    const deviceCode  = _generateDeviceCode();
    const expiresAt   = new Date(Date.now() + LINK_CODE_TTL_SECONDS * 1000).toISOString();
    const inserted = await supabase.insert('mimic_link_codes', [{
      user_code:     userCode,
      device_code:   deviceCode,
      expires_at:    expiresAt,
      agent_version: payload?.agent_version ? String(payload.agent_version).slice(0, 32) : null,
    }]).catch(() => null);
    if (Array.isArray(inserted) && inserted[0]) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        user_code:         userCode,
        device_code:       deviceCode,
        verification_url:  _verificationUrl(),
        verification_url_complete: `${_verificationUrl()}?code=${encodeURIComponent(userCode)}`,
        expires_in:        LINK_CODE_TTL_SECONDS,
        poll_interval:     POLL_INTERVAL_SECONDS,
      }));
    }
  }
  res.writeHead(500, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ error: 'could not allocate link code, please retry' }));
}

// POST /api/mimic-link/poll — Mimic polls with { device_code }; if the user
// has authorized via the web page we mint a session and return it.
async function handlePoll(req, res) {
  const payload = await _readJsonBody(req).catch(() => null);
  if (!payload || !payload.device_code) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'device_code required' })); }
  if (!supabase.isEnabled()) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'service unavailable' })); }

  const deviceCode = String(payload.device_code);
  const rows = await supabase.select(
    'mimic_link_codes',
    `device_code=eq.${encodeURIComponent(deviceCode)}&select=user_code,expires_at,authorized_at,authorized_user_id,authorized_discord_id,agent_version&limit=1`,
  ).catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    // Already exchanged + deleted, or never existed. Either way, this device
    // can't link again without a new /start.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'expired' }));
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    // Tidy up — single best-effort delete.
    await supabase.del('mimic_link_codes', `device_code=eq.${encodeURIComponent(deviceCode)}`).catch(() => null);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'expired' }));
  }
  if (!row.authorized_at || !row.authorized_user_id) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'pending' }));
  }

  // Authorized — mint the session, look up display info, delete the link code.
  const sessionToken = _generateSessionToken();
  const insertSession = await supabase.insert('mimic_sessions', [{
    session_token: sessionToken,
    user_id:       row.authorized_user_id,
    discord_id:    row.authorized_discord_id,
    agent_version: row.agent_version || null,
  }]).catch(() => null);
  if (!Array.isArray(insertSession) || !insertSession[0]) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'could not create session' }));
  }
  // Best-effort delete; if it fails the row will expire on its own.
  await supabase.del('mimic_link_codes', `device_code=eq.${encodeURIComponent(deviceCode)}`).catch(() => null);

  // Look up display name + roles so Mimic can show "Signed in as <name>" right
  // away without a second round-trip.
  const memberRows = await supabase.select(
    'wolfpack_members',
    `user_id=eq.${encodeURIComponent(row.authorized_user_id)}&select=nickname,global_name,role_names&limit=1`,
  ).catch(() => null);
  const member = Array.isArray(memberRows) ? memberRows[0] : null;
  // Display preference: guild nickname → Discord display name → raw discord_id.
  const displayName = member?.nickname || member?.global_name || row.authorized_discord_id;
  const roleNames   = Array.isArray(member?.role_names) ? member.role_names : [];
  const isOfficer   = _hasOfficerRole(roleNames);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({
    status:        'linked',
    session_token: sessionToken,
    user_id:       row.authorized_user_id,
    discord_id:    row.authorized_discord_id,
    display_name:  displayName,
    is_officer:    isOfficer,
    role_names:    roleNames,
  }));
}

// POST /api/mimic-link/revoke — sign out. Header: X-Wolfpack-Mimic-Session.
async function handleRevoke(req, res) {
  const token = String(req.headers['x-wolfpack-mimic-session'] || '').trim();
  if (!token) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'X-Wolfpack-Mimic-Session header required' })); }
  if (!supabase.isEnabled()) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'service unavailable' })); }
  await supabase.update(
    'mimic_sessions',
    `session_token=eq.${encodeURIComponent(token)}`,
    { revoked_at: new Date().toISOString() },
  ).catch(() => null);
  _sessionCache.delete(token);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ ok: true }));
}

// Resolve a session token (from any agent endpoint) to its identity. Returns
// null when there's no header, the token is unknown, or it's revoked — the
// caller decides what to do with that (v1: nothing, log-only).
function _hasOfficerRole(roleNames) {
  const allow = (process.env.OFFICER_ROLE_NAMES || 'Officer,Pack Leader')
    .split(',').map(s => s.trim()).filter(Boolean);
  const set = new Set(allow);
  return Array.isArray(roleNames) && roleNames.some(n => set.has(n));
}

// Sentinel: the auth-store lookup itself FAILED (Supabase 5xx/network blip),
// which is NOT the same as "token not found". Callers must treat this as
// RETRYABLE (503), never as an invalid token (401) — a 4xx makes the agent's
// durable queue drop the payload as permanent, so a transient blip would become
// fleet-wide data loss (audit P0 #1). Never cached, so the next request retries.
const LOOKUP_ERROR = Symbol('session_lookup_error');

// Core lookup: token string → identity, or null (unknown/revoked), or
// LOOKUP_ERROR (transient store failure — retryable). Shared by both the
// X-Wolfpack-Mimic-Session resolver (UI flows) and requireAgentAuth (agent
// uploads). Single cache means a session token used by both surfaces only
// hits Supabase once per 5 min.
async function _resolveSessionToken(token) {
  if (!token) return null;
  const cached = _sessionCache.get(token);
  if (cached && (Date.now() - cached.resolvedAt) < SESSION_CACHE_TTL_MS) return cached.value;
  if (!supabase.isEnabled()) return null;
  // Distinguish a FAILED lookup from an empty result. supabase.select (see
  // utils/supabase.js _request) resolves to `null` on any request failure
  // (5xx / network — it never rejects) and to an array (possibly []) on
  // success. So: null = the store is down (retryable), [] = token genuinely not
  // found. The extra .catch is belt-and-suspenders in case _request ever throws.
  const rows = await supabase.select(
    'mimic_sessions',
    `session_token=eq.${encodeURIComponent(token)}&select=user_id,discord_id,revoked_at&limit=1`,
  ).catch(() => null);
  if (rows === null) return LOOKUP_ERROR;   // store down — do NOT cache, do NOT 401
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || row.revoked_at) {
    _sessionCache.set(token, { resolvedAt: Date.now(), value: null });
    return null;
  }
  const memberRows = await supabase.select(
    'wolfpack_members',
    `user_id=eq.${encodeURIComponent(row.user_id)}&select=nickname,global_name,role_names&limit=1`,
  ).catch(() => null);
  const member = Array.isArray(memberRows) ? memberRows[0] : null;
  const roleNames = Array.isArray(member?.role_names) ? member.role_names : [];
  const value = {
    user_id:       row.user_id,
    discord_id:    row.discord_id,
    display_name:  member?.nickname || member?.global_name || row.discord_id,
    role_names:    roleNames,
    is_officer:    _hasOfficerRole(roleNames),
  };
  _sessionCache.set(token, { resolvedAt: Date.now(), value });
  // Best-effort bump last_used_at so we can show "this install last seen X ago".
  supabase.update(
    'mimic_sessions',
    `session_token=eq.${encodeURIComponent(token)}`,
    { last_used_at: new Date().toISOString() },
  ).catch(() => null);
  return value;
}

async function resolveMimicSession(req) {
  const token = String(req.headers?.['x-wolfpack-mimic-session'] || '').trim();
  const r = await _resolveSessionToken(token);
  // UI flows expect null-or-identity; a transient lookup blip fails closed to
  // null (unauthenticated), same as before — never leak the truthy sentinel.
  return r === LOOKUP_ERROR ? null : r;
}

// requireAgentAuth(req, res) — gate for every /api/agent/* endpoint after the
// 2026-06-04 cutover. The agent sends its session token in the standard
// Authorization: Bearer header (one shared secret WOLFPACK_AGENT_TOKEN is no
// longer accepted — see /token in Discord to mint a per-user token via the
// mimic_sessions flow). Returns the identity {user_id, discord_id,
// display_name, role_names, is_officer} on success; sends a 401 and returns
// null on failure so the caller can `if (!identity) return;`.
async function requireAgentAuth(req, res) {
  const auth   = String(req.headers?.['authorization'] || '');
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();

  // Cheap pre-check: real session tokens are prefixed wpms_ (see
  // _generateSessionToken). Anything else — empty, shared-secret, scanner
  // probes — gets rejected without a Supabase round-trip.
  if (!bearer || !bearer.startsWith('wpms_')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'unauthorized',
      hint:  'Per-user session token required. Run /token in Discord to mint one (or sign in via Mimic).',
    }));
    return null;
  }

  if (!supabase.isEnabled()) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'service unavailable' }));
    return null;
  }

  const identity = await _resolveSessionToken(bearer);
  if (identity === LOOKUP_ERROR) {
    // Auth-store blip (Supabase 5xx/network). MUST be retryable: a 401 here
    // would make the agent's durable queue drop the payload as permanent (4xx),
    // turning a transient outage into fleet-wide data loss (audit P0 #1). 503 →
    // the queue backs off and re-sends when the store recovers.
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'auth store temporarily unavailable, retry' }));
    return null;
  }
  if (!identity) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'session token invalid or revoked',
      hint:  'Run /token in Discord to mint a new one.',
    }));
    return null;
  }

  return identity;
}

// Invalidate a session token from the in-process cache. Called when /token
// revokes a session so the next upload sees the revocation without waiting
// for the 5-min TTL.
function invalidateSessionCache(token) {
  if (token) _sessionCache.delete(token);
}

// Mint a new mimic_session for a Discord user — bypasses the OAuth device
// flow. Used by /token in Discord so users (especially standalone-agent
// users without Mimic) can get a per-user token without a web round-trip.
// Returns { sessionToken, sessionId } or null on failure.
async function mintSessionForUser({ userId, discordId, agentVersion = null, machineLabel = null }) {
  if (!supabase.isEnabled() || !userId || !discordId) return null;
  const sessionToken = _generateSessionToken();
  const inserted = await supabase.insert('mimic_sessions', [{
    session_token: sessionToken,
    user_id:       userId,
    discord_id:    discordId,
    agent_version: agentVersion,
    machine_label: machineLabel,
  }]).catch(() => null);
  const row = Array.isArray(inserted) ? inserted[0] : null;
  if (!row) return null;
  return { sessionToken, sessionId: row.id };
}

// Revoke a single session by id, scoped to a discord_id so users can only
// revoke their own. Also clears the in-process cache for the session_token.
async function revokeSessionForUser({ sessionId, discordId }) {
  if (!supabase.isEnabled() || !sessionId || !discordId) return false;
  // Look up the token so we can clear the cache after the update.
  const rows = await supabase.select(
    'mimic_sessions',
    `id=eq.${encodeURIComponent(sessionId)}&discord_id=eq.${encodeURIComponent(discordId)}&select=session_token&limit=1`,
  ).catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return false;
  await supabase.update(
    'mimic_sessions',
    `id=eq.${encodeURIComponent(sessionId)}&discord_id=eq.${encodeURIComponent(discordId)}`,
    { revoked_at: new Date().toISOString() },
  ).catch(() => null);
  if (row.session_token) _sessionCache.delete(row.session_token);
  return true;
}

// List all of a user's active sessions for the /token UI. Returns rows
// sorted by last_used_at desc; revoked sessions excluded.
async function listSessionsForUser(discordId) {
  if (!supabase.isEnabled() || !discordId) return [];
  const rows = await supabase.select(
    'mimic_sessions',
    `discord_id=eq.${encodeURIComponent(discordId)}&revoked_at=is.null&select=id,agent_version,machine_label,created_at,last_used_at&order=last_used_at.desc&limit=20`,
  ).catch(() => null);
  return Array.isArray(rows) ? rows : [];
}

module.exports = {
  handleStart,
  handlePoll,
  handleRevoke,
  resolveMimicSession,
  requireAgentAuth,
  invalidateSessionCache,
  mintSessionForUser,
  revokeSessionForUser,
  listSessionsForUser,
};
