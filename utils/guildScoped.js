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
// on but no SUPABASE_JWT_SECRET it logs once and also returns null. A token the database rejects (401) is retried with the
// service key inside utils/supabase.js, so a mis-set secret cannot lose a parse.
//
// Env: SUPABASE_JWT_SECRET (Supabase dashboard: Project Settings, API, JWT Secret; never log it), GUILD_RLS=1,
//      SUPABASE_ANON_KEY (optional: the gateway's apikey header; the service key stands in when it is unset).

'use strict';

const crypto = require('node:crypto');
const supabase = require('./supabase');

const ROLE = 'guild_scoped';
const MAX_TTL_SEC = 300;        // a request is seconds long; five minutes is the ceiling, not the target
const DEFAULT_TTL_SEC = 120;

const _b64u = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

// HS256 JWT: { role, guild_id, iat, exp }. Null without a secret or a guild: the caller's cue to stay unscoped.
function mintToken(guildId, { secret = process.env.SUPABASE_JWT_SECRET, ttlSec = DEFAULT_TTL_SEC, nowMs = Date.now() } = {}) {
  if (!secret || !guildId) return null;
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + Math.min(MAX_TTL_SEC, Math.max(1, Math.floor(Number(ttlSec) || DEFAULT_TTL_SEC)));
  const head = _b64u({ alg: 'HS256', typ: 'JWT' });
  const body = _b64u({ role: ROLE, guild_id: String(guildId), iat, exp });
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

// The switch: the env var, or the tuning map's flag_guild_rls (an officer sets it in /admin/overlays, no deploy).
function flagOn(tune) {
  return process.env.GUILD_RLS === '1' || Number(tune && tune.flag_guild_rls) >= 1;
}

const _warned = new Set();
function _warnOnce(msg) {
  if (_warned.has(msg)) return;
  _warned.add(msg);
  console.warn(`[guild-rls] ${msg}`);
}
function _resetWarned() { _warned.clear(); }   // test-only

// A handle for one guild: its id and a minted token. Calls run as that guild through run() below (or, inside
// utils/supabase.js, _asGuild), so each call stays written in place. `scoped: false` (no token) is the service-key facade.
function scopedClient(guildId, { secret, ttlSec, nowMs } = {}) {
  const token = mintToken(guildId, { secret, ttlSec, nowMs });
  if (!token) {
    _warnOnce('no SUPABASE_JWT_SECRET (or no guild) — requests run with the service key, unscoped');
    return { guildId, scoped: false, token: null };
  }
  return { guildId: String(guildId), scoped: true, token };
}

// The per-request entry point. The guild comes from the SESSION (mimic_sessions.guild_id, carried on the identity), and
// falls back to the process's own tag only for an identity that predates the column. Returns a scoped client, or null
// meaning "run the unchanged path".
function forIdentity(identity, tune) {
  if (!flagOn(tune)) return null;
  if (!supabase.isEnabled()) return null;
  const guildId = (identity && identity.guild_id) || supabase.guildId();
  const client = scopedClient(guildId);
  return client.scoped ? client : null;
}

// Run one call of the caller's own (so the guild-scope ratchet still reads the call in place) as the client's guild.
// A null client runs it plainly: this is the identity function when the flag is off.
function run(client, fn) {
  return client && client.scoped ? supabase.runScoped(client.token, fn) : fn();
}

module.exports = { ROLE, MAX_TTL_SEC, mintToken, flagOn, scopedClient, forIdentity, run, _resetWarned };
