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
const memberLockout = require('./memberLockout');
const { clientIp } = require('./clientIp');
const { createIpLimiter } = require('./ipLimiter');

const LINK_CODE_TTL_SECONDS = 10 * 60;     // 10 minutes from /start
const POLL_INTERVAL_SECONDS = 2;
const VERIFICATION_URL_DEFAULT = 'https://wolfpack.quest/auth/mimic-link';

// In-process session cache to avoid hitting Supabase on every upload. Mimic
// installs send the session token as a header on every agent request which the
// agent forwards to the bot on every call — cache for 5 minutes per token.
// Both caches are BOUNDED (unauthenticated-flood hardening, the guild lead, 2026-10-17): the positive cache holds only
// tokens the store vouched for, the not-found/revoked answers live in a separate small cache with a short TTL, so a
// stream of random tokens can neither grow memory without limit nor evict a real member's session.
const _sessionCache = new Map();   // token → { resolvedAt, value }   (positive only; FIFO-capped)
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000;
const SESSION_CACHE_MAX = 10_000;
const _sessionMissCache = new Map();   // token → resolvedAt            (not found / revoked; FIFO-capped)
const SESSION_MISS_TTL_MS = 60 * 1000;
const SESSION_MISS_MAX = 2_000;
const SESSION_RETRY_MS = 15 * 1000;   // how soon a failed member read is tried again

// A real token is exactly this (see _generateSessionToken). Anything else is rejected before ANY lookup or cache write.
const SESSION_TOKEN_RE = /^wpms_[0-9a-f]{64}$/;

// ── Guest sessions (the guild lead, 2026-10-30) ──────────────────────────────────────────────────────────────
// An officer-approved, time-limited link for a raider from another guild: scope 'guest' on mimic_sessions, an
// expires_at, and a synthetic discord_id `guest:<session id>` (every consumer wants a non-null string; it is text in
// each uploaded_by column, and the prefix keeps it from ever reading as a Discord snowflake).
// A guest may call ONLY these routes. requireAgentAuth enforces it, so every handler is covered from one place.
// poll serves a guest no stream at all, only the control plane (see _handleAgentPoll in index.js).
const GUEST_ALLOWED_ROUTES = [
  ['POST', '/api/agent/encounter'],       // the parse upload: the whole point of a guest link
  ['GET',  '/api/agent/poll'],            // the agent's one poll loop; answers the kill switch + version floor, no streams
  ['GET',  '/api/agent/latest-version'],  // update prompts (answered without a session; listed so the allowlist reads whole)
];
function guestRouteAllowed(method, url) {
  const path = String(url || '').split(/[?#]/)[0];
  return GUEST_ALLOWED_ROUTES.some(([m, p]) => m === method && p === path);
}

// ── Hub sessions (the guild lead, 2026-10-31, DECISIONS §499): a Mimic linked to a guild other than this process's ──
// A session whose guild_id is not the process guild (supabase.guildId()) belongs to a guild on Raid Mimic. It resolves
// through hub_players / hub_memberships, never wolfpack_members, and it is a member of ITS guild only. While row-level
// scoping is behind a flag (§496) it may call only the routes below: the same three as a guest, plus the link routes.
// The /api/mimic-link/* routes are answered before requireAgentAuth runs (the device code is their credential), so they
// are listed to keep the allowlist whole, not because this gate sees them. There is no /api/me route on the bot: the
// signed-in reads live on the website, which reads the hub tables itself.
const HUB_ALLOWED_ROUTES = [
  ...GUEST_ALLOWED_ROUTES,
  ['POST', '/api/mimic-link/start'],
  ['POST', '/api/mimic-link/poll'],
  ['POST', '/api/mimic-link/revoke'],
];
function hubRouteAllowed(method, url) {
  const path = String(url || '').split(/[?#]/)[0];
  return HUB_ALLOWED_ROUTES.some(([m, p]) => m === method && p === path);
}
// The registry's slug shape (supabase hub_guilds_slug_shape; web/lib/hubRegistry.ts GUILD_SLUG_RX).
const HUB_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$/;
const HUB_SITE_URL_DEFAULT = 'https://raidmimic.com';
// The site a hosted guild's members finish the link on. Configurable because a guild can get its own address; https only.
function _hubSiteUrl() {
  const env = String(process.env.HUB_SITE_URL || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(env) ? env : HUB_SITE_URL_DEFAULT;
}
// The hub slug a request asked for: null for "none given" and for this process's own guild (Wolf Pack as today),
// undefined for a value that is not a slug (the caller answers 400).
function _cleanHub(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !HUB_SLUG_RE.test(raw)) return undefined;
  return raw === supabase.guildId() ? null : raw;
}

const GUEST_LABEL_MAX = 64;
const GUEST_CACHE_MS  = 60 * 1000;   // a guest identity is trusted from cache for this long, so a Revoke lands within a minute
const _guestRefusedLogged = new Set();   // `${label}|${path}` → logged once per process, so a chatty agent cannot flood the log
function _guestExpired(value, nowMs = Date.now()) {
  return !!(value && value.scope === 'guest' && value.expires_at && Date.parse(value.expires_at) <= nowMs);
}

// Failed-auth throttle, per client IP: a lookup that costs a store read and finds nothing counts. Over the limit an
// IP's further UNKNOWN tokens get a 429 with no read; tokens already known good still pass (a member mid-relink is
// not locked out by an old install on the same IP). index.js re-reads the tuning knob `ip_failauth_per_min`.
const FAILAUTH_PER_MIN_DEFAULT = 60;
let _failAuthPerMin = FAILAUTH_PER_MIN_DEFAULT;
const _failAuth = createIpLimiter({ max: FAILAUTH_PER_MIN_DEFAULT });
function setFailAuthPerMin(n) { _failAuthPerMin = Number.isFinite(Number(n)) ? Number(n) : FAILAUTH_PER_MIN_DEFAULT; }

function _setBounded(map, max, key, val) {
  if (!map.has(key) && map.size >= max) map.delete(map.keys().next().value);   // Map keeps insertion order → FIFO
  map.set(key, val);
}

// Per-IP rate limit on the UNAUTHENTICATED /start — it does a Supabase INSERT
// per call, so an open loop could spam mimic_link_codes (audit: unauthenticated
// write vector). Legit use is a handful of links per person; 10 / 10min / IP is
// generous. In-memory sliding window (single bot replica — see CLAUDE.md).
const START_RATE_WINDOW_MS = 10 * 60 * 1000;
const START_RATE_MAX       = 10;
const _startRate = new Map();   // ip → [tsMs, ...]
function _startRateLimited(req) {
  const ip  = clientIp(req);
  const now = Date.now();
  const arr = (_startRate.get(ip) || []).filter(t => now - t < START_RATE_WINDOW_MS);
  if (arr.length >= START_RATE_MAX) { _startRate.set(ip, arr); return true; }
  arr.push(now);
  _startRate.set(ip, arr);
  // Bound the map so a distributed probe can't grow it unboundedly.
  if (_startRate.size > 5000) {
    for (const [k, v] of _startRate) {
      if (!v.length || now - Math.max(...v) > START_RATE_WINDOW_MS) _startRate.delete(k);
      if (_startRate.size <= 4000) break;
    }
  }
  return false;
}

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

// Wolf Pack (no hub) keeps today's address exactly; a hub guild's link is finished on the hosted site.
function _verificationUrl(hub = null) {
  if (hub) return `${_hubSiteUrl()}/auth/mimic-link`;
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
  // The guild the link is for (§499): none = this process's guild, as always. A value that is not a slug is refused.
  const hub = _cleanHub(payload?.hub);
  if (hub === undefined) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'invalid hub' })); }
  if (_startRateLimited(req)) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
    return res.end(JSON.stringify({ error: 'too many link attempts, wait a minute and retry' }));
  }

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
      // Only a hub link names its guild: a Wolf Pack row is written exactly as before, so it needs no new column.
      ...(hub ? { hub } : {}),
    }]).catch(() => null);
    if (Array.isArray(inserted) && inserted[0]) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        user_code:         userCode,
        device_code:       deviceCode,
        verification_url:  _verificationUrl(hub),
        verification_url_complete: `${_verificationUrl(hub)}?code=${encodeURIComponent(userCode)}`,
        expires_in:        LINK_CODE_TTL_SECONDS,
        poll_interval:     POLL_INTERVAL_SECONDS,
        ...(hub ? { hub } : {}),
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
    // select=* on purpose: the guest columns (guest_label, guest_expires_at) arrive with a migration, and naming a
    // column that does not exist yet would turn every member's poll into "expired" until it is applied.
    `device_code=eq.${encodeURIComponent(deviceCode)}&select=*&limit=1`,
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
  // Linked when a web OAuth confirm stamped authorized_user_id, OR (since
  // 2026-07-31) when a discord-only authorization stamped just the discord id
  // (members Discord blocks from OAuth have no auth.users row to stamp).
  // An officer-approved GUEST link stamps neither id: it is a guest, not a member (authorized_via 'guest').
  const isGuest = row.authorized_via === 'guest';
  if (!row.authorized_at || (!isGuest && !row.authorized_user_id && !row.authorized_discord_id)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'pending' }));
  }

  // A guest link without a usable expiry or label is never turned into a session, and a spent expiry is expired.
  if (isGuest && (!row.guest_label || !row.guest_expires_at || Date.parse(row.guest_expires_at) <= Date.now())) {
    await supabase.del('mimic_link_codes', `device_code=eq.${encodeURIComponent(deviceCode)}`).catch(() => null);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'expired' }));
  }

  // A locked member gets no new session: the code is spent and the device is told it expired.
  if (!isGuest && memberLockout.isLocked(row.authorized_discord_id)) {
    await supabase.del('mimic_link_codes', `device_code=eq.${encodeURIComponent(deviceCode)}`).catch(() => null);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'expired' }));
  }

  // A link made for a hub guild (§499). The web page only stamps the code; THIS is where the guild is enforced, because an
  // officer-assisted stamp or a stolen stamp must not mint a session in a guild the person is not in. A guest approval is
  // Wolf Pack's alone. The session carries the code's guild, and the answer is the hub member's, never wolfpack_members'.
  const hub = _hubGuildOf(row.hub);
  let hubMember = null;
  if (hub) {
    if (isGuest) {
      await supabase.del('mimic_link_codes', `device_code=eq.${encodeURIComponent(deviceCode)}`).catch(() => null);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'expired' }));
    }
    hubMember = await _hubMembership(hub, row.authorized_discord_id);
    if (hubMember === LOOKUP_ERROR) {   // a failed read keeps the code, so the next poll asks again
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'pending' }));
    }
    if (!hubMember) {
      await supabase.del('mimic_link_codes', `device_code=eq.${encodeURIComponent(deviceCode)}`).catch(() => null);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'expired' }));
    }
  }

  // Authorized — mint the session, look up display info, delete the link code.
  const sessionToken = _generateSessionToken();
  // A guest's id is chosen here so the synthetic discord_id (`guest:<id>`) can name the row it belongs to.
  const guestSessionId = isGuest ? crypto.randomUUID() : null;
  const insertSession = await supabase.insert('mimic_sessions', [{
    ...(isGuest ? {
      id:          guestSessionId,
      scope:       'guest',
      expires_at:  row.guest_expires_at,
      guest_label: String(row.guest_label).slice(0, GUEST_LABEL_MAX),
    } : {}),
    session_token: sessionToken,
    user_id:       row.authorized_user_id || null,
    discord_id:    isGuest ? `guest:${guestSessionId}` : row.authorized_discord_id,
    agent_version: row.agent_version || null,
    // Durable audit: the link-code row is deleted right below, so HOW this
    // session came to exist survives only here. 'officer' means an officer
    // attested the identity on /admin/links (the OAuth-blocked path, e.g.
    // Discord's unverified-account wall); absent/'self' is the normal flow.
    linked_via:           row.authorized_via || (row.authorized_user_id ? 'self' : null),
    linked_by_discord_id: row.authorized_by_discord_id || null,
    ...(hub ? { guild_id: hub } : {}),   // a Wolf Pack session leaves the column to its default, as before
  }]).catch(() => null);
  if (!Array.isArray(insertSession) || !insertSession[0]) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'could not create session' }));
  }
  // Best-effort delete; if it fails the row will expire on its own.
  await supabase.del('mimic_link_codes', `device_code=eq.${encodeURIComponent(deviceCode)}`).catch(() => null);

  if (isGuest) {
    // No member row to read: the label the officer typed is the display name, and a guest holds no roles.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status:        'linked',
      session_token: sessionToken,
      user_id:       null,
      discord_id:    `guest:${guestSessionId}`,
      display_name:  String(row.guest_label).slice(0, GUEST_LABEL_MAX),
      is_officer:    false,
      role_names:    [],
      scope:         'guest',
      expires_at:    row.guest_expires_at,
    }));
  }

  if (hub) {
    // The guild's own roster is the source: no Wolf Pack nickname or role names exist for this person here.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status:        'linked',
      session_token: sessionToken,
      user_id:       row.authorized_user_id || null,
      discord_id:    row.authorized_discord_id,
      display_name:  hubMember.display_name || row.authorized_discord_id,
      is_officer:    hubMember.is_officer,
      role_names:    [],
      scope:         'member',
      guild_id:      hub,
      hub_role:      hubMember.role,
    }));
  }

  // Look up display name + roles so Mimic can show "Signed in as <name>" right
  // away without a second round-trip. discord_id fallback for sessions with
  // no web-account link (same as _resolveSessionToken).
  const pollMemberFilter = row.authorized_user_id
    ? `user_id=eq.${encodeURIComponent(row.authorized_user_id)}`
    : `discord_id=eq.${encodeURIComponent(row.authorized_discord_id)}`;
  const memberRows = await supabase.select(
    'wolfpack_members',
    `${pollMemberFilter}&select=nickname,global_name,role_names&limit=1`,
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
  if (!SESSION_TOKEN_RE.test(token)) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'invalid session token' })); }
  if (!supabase.isEnabled()) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'service unavailable' })); }
  await supabase.update(
    'mimic_sessions',
    `session_token=eq.${encodeURIComponent(token)}`,
    { revoked_at: new Date().toISOString() },
  ).catch(() => null);
  invalidateSessionCache(token);
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

// Who a Discord id is in a hub guild: { player_id, display_name, role, is_officer } for an active member of an
// unsuspended guild, null for anyone else (never joined, left, account deleted, guild suspended or unknown), or
// LOOKUP_ERROR when a read failed (the store is down is not "not a member"). Both the poll (before a session is minted)
// and the session resolver (every refresh) ask this, so a link cannot outlive the membership it was made on.
// The role is the guild's own call: owner and officer are the guild's officers, and only on that guild.
async function _hubMembership(guildId, discordId) {
  if (!guildId || !discordId) return null;
  const guild = await supabase.select(
    'hub_guilds',
    `guild_id=eq.${encodeURIComponent(guildId)}&select=guild_id,suspended_at&limit=1`,
  ).catch(() => null);
  if (!Array.isArray(guild)) return LOOKUP_ERROR;
  if (!guild[0] || guild[0].suspended_at) return null;
  const players = await supabase.select(
    'hub_players',
    `discord_id=eq.${encodeURIComponent(String(discordId))}&select=player_id,display_name,deleted_at&limit=1`,
  ).catch(() => null);
  if (!Array.isArray(players)) return LOOKUP_ERROR;
  const player = players[0];
  if (!player || player.deleted_at) return null;
  const members = await supabase.select(
    'hub_memberships',
    `guild_id=eq.${encodeURIComponent(guildId)}&player_id=eq.${encodeURIComponent(player.player_id)}&left_at=is.null&select=role&limit=1`,
  ).catch(() => null);
  if (!Array.isArray(members)) return LOOKUP_ERROR;
  if (!members[0]) return null;
  const role = String(members[0].role || 'member');
  return { player_id: player.player_id, display_name: player.display_name || null, role, is_officer: role === 'owner' || role === 'officer' };
}
// The guild a session row belongs to when it is not this process's own; null for Wolf Pack and for a row that predates
// the guild_id column.
function _hubGuildOf(guildId) {
  return guildId && guildId !== supabase.guildId() ? String(guildId) : null;
}

// Core lookup: token string → identity, or null (unknown/revoked), or
// LOOKUP_ERROR (transient store failure — retryable). Shared by both the
// X-Wolfpack-Mimic-Session resolver (UI flows) and requireAgentAuth (agent
// uploads). Single cache means a session token used by both surfaces only
// hits Supabase once per 5 min.
async function _resolveSessionToken(token, ip) {
  const r = await _lookupSessionToken(token, ip);
  // Member lockout (utils/memberLockout.js): a locked member's token behaves exactly like a revoked one. The check
  // sits OUTSIDE the 5-minute cache on purpose, so an unlock (or a lock) takes effect within one lockout refresh.
  if (r && r !== LOOKUP_ERROR && r !== RATE_LIMITED && memberLockout.isLocked(r.discord_id)) return null;
  return r;
}

// Sentinel: this IP has burned its failed-auth budget and the token is not one we already know — answered with no
// store read. requireAgentAuth turns it into a 429; the UI resolver into null.
const RATE_LIMITED = Symbol('session_lookup_rate_limited');

async function _lookupSessionToken(token, ip) {
  if (!token || !SESSION_TOKEN_RE.test(token)) return null;   // wrong shape: nothing to look up, nothing to cache
  const cached = _sessionCache.get(token);
  if (cached && (Date.now() - cached.resolvedAt) < SESSION_CACHE_TTL_MS) {
    // A guest session dies at its expiry, not at the end of the 5-minute cache window.
    if (!_guestExpired(cached.value)) return cached.value;
    _sessionCache.delete(token);
    _setBounded(_sessionMissCache, SESSION_MISS_MAX, token, Date.now());
    return null;
  }
  const missAt = _sessionMissCache.get(token);
  if (missAt !== undefined) {
    if (Date.now() - missAt < SESSION_MISS_TTL_MS) return null;
    _sessionMissCache.delete(token);
  }
  if (!supabase.isEnabled()) return null;
  // Failed-auth throttle. A token we hold in the positive cache (even past its TTL) is a known member, so it still
  // gets its refresh; only unknown tokens from a spent IP are turned away.
  if (!cached && _failAuth.isOver(ip, _failAuthPerMin)) return RATE_LIMITED;
  // Distinguish a FAILED lookup from an empty result. supabase.select (see
  // utils/supabase.js _request) resolves to `null` on any request failure
  // (5xx / network — it never rejects) and to an array (possibly []) on
  // success. So: null = the store is down (retryable), [] = token genuinely not
  // found. The extra .catch is belt-and-suspenders in case _request ever throws.
  const rows = await supabase.select(
    'mimic_sessions',
    // select=*: scope / expires_at / guest_label arrive with a migration (see handlePoll's note on naming columns).
    `session_token=eq.${encodeURIComponent(token)}&select=*&limit=1`,
  ).catch(() => null);
  if (rows === null) return LOOKUP_ERROR;   // store down — do NOT cache, do NOT 401
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || row.revoked_at || (row.scope === 'guest' && (!row.expires_at || Date.parse(row.expires_at) <= Date.now()))) {
    // Not found / revoked / an expired guest: short-lived, separate, bounded cache, and one strike against this IP.
    _sessionCache.delete(token);
    _setBounded(_sessionMissCache, SESSION_MISS_MAX, token, Date.now());
    _failAuth.hit(ip, _failAuthPerMin);
    return null;
  }
  _sessionMissCache.delete(token);
  if (row.scope === 'guest') {
    // A guest has no wolfpack_members row to read: the officer's label is the name and there are no roles.
    const value = {
      user_id: null, discord_id: row.discord_id, display_name: row.guest_label || 'Guest',
      role_names: [], is_officer: false,
      scope: 'guest', guest_label: row.guest_label || null, expires_at: row.expires_at,
      guild_id: row.guild_id || null,   // the session's guild (utils/guildScoped.js scopes a request to it)
    };
    // Cached for a minute, not five: the officer's Revoke on /admin/links is a web write the bot is not told about.
    _setBounded(_sessionCache, SESSION_CACHE_MAX, token, { resolvedAt: Date.now() - SESSION_CACHE_TTL_MS + GUEST_CACHE_MS, value });
    supabase.update(
      'mimic_sessions',
      `session_token=eq.${encodeURIComponent(token)}`,
      { last_used_at: new Date().toISOString() },
    ).catch(() => null);
    return value;
  }
  // A session linked to a hub guild (§499) resolves through that guild's roster, never wolfpack_members. Leaving the
  // guild, deleting the account or the guild being suspended ends the session like a revoke does (within the 5-minute
  // cache window at most). A read that FAILS keeps the last good identity and tries again in 15 s, the same rule the
  // Wolf Pack member read follows below.
  const hubGuild = _hubGuildOf(row.guild_id);
  if (hubGuild) {
    const m = await _hubMembership(hubGuild, row.discord_id);
    if (m === LOOKUP_ERROR) {
      const value = (cached && cached.value) || {
        user_id: row.user_id || null, discord_id: row.discord_id, display_name: row.discord_id,
        role_names: [], is_officer: false, scope: 'member', guild_id: hubGuild, hub_guild: hubGuild,
      };
      _setBounded(_sessionCache, SESSION_CACHE_MAX, token, { resolvedAt: Date.now() - SESSION_CACHE_TTL_MS + SESSION_RETRY_MS, value });
      return value;
    }
    if (!m) {
      _sessionCache.delete(token);
      _setBounded(_sessionMissCache, SESSION_MISS_MAX, token, Date.now());
      return null;
    }
    const value = {
      user_id: row.user_id || null, discord_id: row.discord_id, display_name: m.display_name || row.discord_id,
      role_names: [], is_officer: m.is_officer,   // the HUB role: it grants nothing on Wolf Pack data (requireAgentAuth's gate)
      scope: 'member', guild_id: hubGuild, hub_guild: hubGuild, hub_role: m.role,
    };
    _setBounded(_sessionCache, SESSION_CACHE_MAX, token, { resolvedAt: Date.now(), value });
    supabase.update(
      'mimic_sessions',
      `session_token=eq.${encodeURIComponent(token)}`,
      { last_used_at: new Date().toISOString() },
    ).catch(() => null);
    return value;
  }
  // Sessions minted for OAuth-blocked members carry no user_id — fall back
  // to the discord_id key (wolfpack_members' PK) so display + roles resolve.
  const memberFilter = row.user_id
    ? `user_id=eq.${encodeURIComponent(row.user_id)}`
    : `discord_id=eq.${encodeURIComponent(row.discord_id)}`;
  const memberRows = await supabase.select(
    'wolfpack_members',
    `${memberFilter}&select=nickname,global_name,role_names&limit=1`,
  ).catch(() => null);
  // The member read FAILED (store timing out), as opposed to finding no row: keep the last good identity and
  // retry in 15 s, rather than caching "no roles" for 5 minutes. Raid night 2026-10-14: one stall cached two
  // officers as non-officers, so the Admin tab vanished and a DKP tick from Mimic came back "officers only".
  if (memberRows === null) {
    const value = (cached && cached.value) || {
      user_id: row.user_id || null, discord_id: row.discord_id, display_name: row.discord_id,
      role_names: [], is_officer: false, guild_id: row.guild_id || null,
    };
    _setBounded(_sessionCache, SESSION_CACHE_MAX, token, { resolvedAt: Date.now() - SESSION_CACHE_TTL_MS + SESSION_RETRY_MS, value });
    return value;
  }
  const member = Array.isArray(memberRows) ? memberRows[0] : null;
  const roleNames = Array.isArray(member?.role_names) ? member.role_names : [];
  const value = {
    user_id:       row.user_id || null,
    discord_id:    row.discord_id,
    display_name:  member?.nickname || member?.global_name || row.discord_id,
    role_names:    roleNames,
    is_officer:    _hasOfficerRole(roleNames),
    guild_id:      row.guild_id || null,
  };
  _setBounded(_sessionCache, SESSION_CACHE_MAX, token, { resolvedAt: Date.now(), value });
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
  const r = await _resolveSessionToken(token, clientIp(req));
  // UI flows expect null-or-identity; a transient lookup blip (or a throttled IP) fails closed to
  // null (unauthenticated), same as before — never leak a truthy sentinel.
  return (r === LOOKUP_ERROR || r === RATE_LIMITED) ? null : r;
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

  // Cheap pre-check: real session tokens are exactly wpms_ + 64 hex (see
  // _generateSessionToken). Anything else — empty, shared-secret, scanner
  // probes — gets rejected without a Supabase round-trip or a cache write.
  if (!bearer || !SESSION_TOKEN_RE.test(bearer)) {
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

  const identity = await _resolveSessionToken(bearer, clientIp(req));
  if (identity === RATE_LIMITED) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
    res.end(JSON.stringify({ error: 'rate_limited', retry_after: 60 }));
    return null;
  }
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

  // Guest scope (2026-10-30): one allowlist, here, so no handler has to remember it. A refused route answers 403
  // without the handler running; the refusal is logged once per guest per route, never warned (it is expected).
  if (identity.scope === 'guest' && !guestRouteAllowed(req.method, req.url)) {
    const path = String(req.url || '').split(/[?#]/)[0];
    const key  = `${identity.guest_label || identity.discord_id}|${path}`;
    if (!_guestRefusedLogged.has(key)) {
      if (_guestRefusedLogged.size >= 500) _guestRefusedLogged.clear();
      _guestRefusedLogged.add(key);
      console.log(`[guest] "${identity.guest_label || 'guest'}" refused ${req.method} ${path} (guest links upload parses only)`);
    }
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'guest_scope' }));
    return null;
  }

  // Hub scope (2026-10-31, §499): a session linked to another guild gets the allowlist above and nothing else, whatever
  // role it holds there. Same one-place rule as the guest gate, logged once per guild and route.
  if (identity.hub_guild && !hubRouteAllowed(req.method, req.url)) {
    const path = String(req.url || '').split(/[?#]/)[0];
    const key  = `hub:${identity.hub_guild}|${path}`;
    if (!_guestRefusedLogged.has(key)) {
      if (_guestRefusedLogged.size >= 500) _guestRefusedLogged.clear();
      _guestRefusedLogged.add(key);
      console.log(`[hub] a "${identity.hub_guild}" session refused ${req.method} ${path} (guild links upload parses only for now)`);
    }
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error:   'hub_scope',
      message: 'This Mimic is linked to another guild. For now that link can upload parses and check for updates; nothing else is served to it yet.',
    }));
    return null;
  }

  return identity;
}

// Invalidate a session token from the in-process cache. Called when /token
// revokes a session so the next upload sees the revocation without waiting
// for the 5-min TTL.
function invalidateSessionCache(token) {
  if (token) { _sessionCache.delete(token); _sessionMissCache.delete(token); }
}

// A guest session's expiry just changed (utils/guestLinks.js extend). The caches are keyed by token, and a guest
// identity is trusted from cache with its OLD expires_at, so drop it by token when the caller has it and, in case it
// does not, by the synthetic discord_id every guest identity carries. The miss cache is token-keyed only, which is why
// a caller reviving a lapsed key must pass the token.
function forgetGuestSession(sessionId, token) {
  invalidateSessionCache(token);
  const did = `guest:${sessionId}`;
  for (const [t, c] of _sessionCache) if (c.value && c.value.discord_id === did) _sessionCache.delete(t);
}

// Mint a new mimic_session for a Discord user — bypasses the OAuth device
// flow. Used by /token in Discord so users (especially standalone-agent
// users without Mimic) can get a per-user token without a web round-trip.
// userId (the wolfpack.quest auth.users link) is OPTIONAL since 2026-07-31:
// a member whose Discord account can't complete OAuth (phone/email
// verification wall) never gets one, and every session consumer keys on
// discord_id anyway — user_id is only the web-account join.
// Returns { sessionToken, sessionId } or null on failure.
async function mintSessionForUser({ userId, discordId, agentVersion = null, machineLabel = null }) {
  if (!supabase.isEnabled() || !discordId) return null;
  if (memberLockout.isLocked(discordId)) return null;
  const sessionToken = _generateSessionToken();
  const inserted = await supabase.insert('mimic_sessions', [{
    session_token: sessionToken,
    user_id:       userId || null,
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
  if (row.session_token) invalidateSessionCache(row.session_token);
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
  forgetGuestSession,   // utils/guestLinks.js: an extended guest's new expiry applies at once
  mintSessionForUser,
  revokeSessionForUser,
  listSessionsForUser,
  guestRouteAllowed, GUEST_ALLOWED_ROUTES, GUEST_LABEL_MAX,   // the guest-link allowlist (test/guest-link.test.js)
  hubRouteAllowed, HUB_ALLOWED_ROUTES,   // the hub-session allowlist (test/mimic-link-hub.test.js)
  setFailAuthPerMin,   // index.js feeds the `ip_failauth_per_min` tuning knob in here
  // Exposed for test/bot-auth-flood.test.js — the bounded caches and the failed-auth throttle.
  _sessionCache, _sessionMissCache, _failAuth,
  // Exposed for the characterization test suite (test/rate-limit.test.js) — the
  // per-IP sliding-window limiter on the unauthenticated /start endpoint.
  _startRateLimited,
};
