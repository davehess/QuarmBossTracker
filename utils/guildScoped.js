// utils/guildScoped.js — run a request's database calls as ONE guild, under RLS, instead of as the service role.
//
// WHY: docs/DESIGN-raidmimic-hosted.md section 9b and decisions-inbox 490 (2026-10-31): "the bot stops using service_role
// for guild data". The service key bypasses RLS, so isolation between guilds rests on every query remembering its guild
// filter (scripts/guild-scope-audit.js ratchets that down). A guild-scoped token moves the boundary into the database: the
// bot mints a JWT carrying `role: guild_scoped` and a `guild_id` claim, PostgREST runs the request as that role, and the
// policies of supabase/migrations/20261031180000_guild_rls_foundation.sql show it only its own guild's rows. A missed
// filter then returns nothing instead of everything.
//
// THE FOUNDATION, NOT THE MIGRATION OF THE BOT. Three tables carry the policies (encounters, encounter_players,
// contributions) and one handler uses them (POST /api/agent/encounter). Everything else still uses the service key.
//
// OFF BY DEFAULT, FAIL-OPEN. forIdentity() returns null unless GUILD_RLS=1 (env) or `flag_guild_rls` >= 1 (the tuning map,
// live within its 60s cache) says on; the caller then runs today's code path with no scoped object anywhere. With the flag
// on but no usable signing key it logs once and also returns null. A token the database rejects (401) is retried with the
// service key inside utils/supabase.js, so a mis-set key cannot lose a parse.
//
// SIGNING (2026-10-31): the project's legacy HS256 JWT secret was disabled on 2026-10-29, so the bot signs with its OWN
// ES256 (P-256) key. The guild lead generated it, imported it into Supabase as a standby JWT signing key and rotated to it;
// the token header carries that key's `kid` so the gateway picks the right public key.
//
// NEVER SILENT. Flag on while not actually scoped (no/invalid key, or the database rejecting tokens) is the one state that
// looks healthy and is not, so the process keeps a small status (flagOn, keyOk, rejected, last times), writes it to bot_kv
// `guild_rls_status` (throttled to one write per 5 minutes, only on change), serves it on GET /health, and
// /admin/overlays shows officers a red box from it.
//
// Env: SUPABASE_JWT_SIGNING_JWK (a JSON private JWK {kty:'EC', crv:'P-256', kid, d, x, y}; never log it), GUILD_RLS=1,
//      SUPABASE_ANON_KEY (optional: the gateway's apikey header; the service key stands in when it is unset).

'use strict';

const crypto = require('node:crypto');
const supabase = require('./supabase');

const ROLE = 'guild_scoped';
const MAX_TTL_SEC = 300;        // a request is seconds long; five minutes is the ceiling, not the target
const DEFAULT_TTL_SEC = 120;
const STATUS_KEY = 'guild_rls_status';
const STATUS_WRITE_EVERY_MS = 5 * 60 * 1000;

const _b64u = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

const _warned = new Set();
function _warnOnce(msg) {
  if (_warned.has(msg)) return;
  _warned.add(msg);
  console.warn(`[guild-rls] ${msg}`);
}

// Parse + validate a JWK (an object or its JSON text) into { key: KeyObject, kid } or null. Cached by the raw input, so the
// env var is parsed once per value. A bad value warns once and NEVER echoes the value.
const _keyCache = new Map();
function loadKey(raw = process.env.SUPABASE_JWT_SIGNING_JWK) {
  if (!raw) return null;
  const ck = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (_keyCache.has(ck)) return _keyCache.get(ck);
  let out = null;
  try {
    const jwk = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.kid !== 'string' || !jwk.kid.trim() || !jwk.d) {
      _warnOnce('SUPABASE_JWT_SIGNING_JWK is not a P-256 EC private JWK with a kid and d — requests run with the service key, unscoped');
    } else {
      out = { key: crypto.createPrivateKey({ key: jwk, format: 'jwk' }), kid: jwk.kid };
    }
  } catch {
    _warnOnce('SUPABASE_JWT_SIGNING_JWK could not be parsed — requests run with the service key, unscoped');
  }
  _keyCache.set(ck, out);
  return out;
}

// ES256 JWT: header { alg, kid, typ }, payload { role, guild_id, iat, exp }. Null without a usable key or a guild: the
// caller's cue to stay unscoped. `jwk` is injectable for tests.
function mintToken(guildId, { jwk = process.env.SUPABASE_JWT_SIGNING_JWK, ttlSec = DEFAULT_TTL_SEC, nowMs = Date.now() } = {}) {
  if (!guildId) return null;
  const k = loadKey(jwk);
  if (!k) return null;
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + Math.min(MAX_TTL_SEC, Math.max(1, Math.floor(Number(ttlSec) || DEFAULT_TTL_SEC)));
  const head = _b64u({ alg: 'ES256', kid: k.kid, typ: 'JWT' });
  const body = _b64u({ role: ROLE, guild_id: String(guildId), iat, exp });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: k.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${head}.${body}.${sig}`;
}

// The switch: the env var, or the tuning map's flag_guild_rls (an officer sets it in /admin/overlays, no deploy).
function flagOn(tune) {
  return process.env.GUILD_RLS === '1' || Number(tune && tune.flag_guild_rls) >= 1;
}

function _resetWarned() { _warned.clear(); _keyCache.clear(); }   // test-only

// ── The status: is the flag on while the bot is NOT actually scoped? ─────────────────────────────────────────────────
const _status = { flagOn: false, keyOk: false, lastFlagSeenAt: 0 };
let _lastWritten = { sig: '', at: 0 };

// The shape bot_kv, /health and the website read. No secrets: counts, times and booleans.
function status() {
  const s = supabase.scopedStats();
  const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
  return {
    flag_on: _status.flagOn,
    key_ok: _status.keyOk,
    rejected_count: s.rejected,
    last_rejected_at: iso(s.lastRejectedAt),
    last_ok_at: iso(s.lastOkAt),
    scoped_ok_count: s.ok,
  };
}

// Persist to bot_kv when something changed, at most once per 5 minutes. Fire-and-forget; a failed write costs nothing.
function persistStatus({ nowMs = Date.now(), force = false } = {}) {
  try {
    if (!supabase.isEnabled()) return false;
    const st = status();
    // The ok counter moves on every request; only its being non-zero is news, so it stays out of the change signature.
    const sig = JSON.stringify([st.flag_on, st.key_ok, st.rejected_count, st.last_rejected_at, st.scoped_ok_count > 0]);
    if (!force && (sig === _lastWritten.sig || nowMs - _lastWritten.at < STATUS_WRITE_EVERY_MS)) return false;
    if (!force && !st.flag_on && !_lastWritten.sig) { _lastWritten = { sig, at: nowMs }; return false; }   // never on, nothing to say
    _lastWritten = { sig, at: nowMs };
    Promise.resolve(supabase.upsert('bot_kv',
      [{ guild_id: supabase.guildId(), key: STATUS_KEY, value: st, updated_at: new Date(nowMs).toISOString() }],
      'guild_id,key', { minimal: true })).catch(() => {});
    return true;
  } catch { return false; }
}
function _resetStatus() { _status.flagOn = false; _status.keyOk = false; _lastWritten = { sig: '', at: 0 }; }   // test-only

// A rejection or a scoped success inside utils/supabase.js lands here, so the status moves without a request entering
// forIdentity.
supabase.onScopedEvent(() => persistStatus());

// A handle for one guild: its id and a minted token. Calls run as that guild through run() below (or, inside
// utils/supabase.js, _asGuild), so each call stays written in place. `scoped: false` (no token) is the service-key facade.
function scopedClient(guildId, { jwk, ttlSec, nowMs } = {}) {
  const token = mintToken(guildId, { jwk, ttlSec, nowMs });
  if (!token) {
    _warnOnce('no usable SUPABASE_JWT_SIGNING_JWK (or no guild) — requests run with the service key, unscoped');
    return { guildId, scoped: false, token: null };
  }
  return { guildId: String(guildId), scoped: true, token };
}

// The per-request entry point. The guild comes from the SESSION (mimic_sessions.guild_id, carried on the identity), and
// falls back to the process's own tag only for an identity that predates the column. Returns a scoped client, or null
// meaning "run the unchanged path".
function forIdentity(identity, tune) {
  const on = flagOn(tune);
  _status.flagOn = on;
  if (!on) { persistStatus(); return null; }
  if (!supabase.isEnabled()) return null;
  const guildId = (identity && identity.guild_id) || supabase.guildId();
  const client = scopedClient(guildId);
  _status.keyOk = !!loadKey();
  persistStatus();
  return client.scoped ? client : null;
}

// Run one call of the caller's own (so the guild-scope ratchet still reads the call in place) as the client's guild.
// A null client runs it plainly: this is the identity function when the flag is off.
function run(client, fn) {
  return client && client.scoped ? supabase.runScoped(client.token, fn) : fn();
}

module.exports = { ROLE, MAX_TTL_SEC, STATUS_KEY, mintToken, loadKey, flagOn, scopedClient, forIdentity, run, status, persistStatus, _resetWarned, _resetStatus };
