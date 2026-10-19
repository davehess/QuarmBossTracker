// utils/setupShare.js — "Get a code" for a whole Mimic setup (the guild lead, 2026-10-19, DECISIONS §383: share-setup = A,
// "file + share code"; the options were written in §91). Mimic builds the bundle (apps/mimic/portableSetup.js); this holds
// it for 24 hours under a six-character code so a second install can fetch it.
//
//   POST   /api/agent/setup-share          body { setup: <mimic-setup bundle> }
//          201 { ok, code, expires_at, ttl_hours: 24, bytes, summary }
//          400 bad JSON / not a setup / refused (a path, a sign-in or a webhook in it) · 413 over 512 KB
//          429 over 10 codes an hour (Retry-After) · 503 store down, retry
//   GET    /api/agent/setup-share/<CODE>   200 { ok, code, expires_at, setup }
//          400 not shaped like a code · 404 no such code OR expired (the same answer, on purpose)
//          429 over 60 fetches an hour, or 15 wrong codes an hour (Retry-After) · 503 store down, retry
//   DELETE /api/agent/setup-share/<CODE>   the member who made it, any time: 200 { ok }  ·  404 not found or not yours
//
// Auth is the Mimic session bearer (requireAgentAuth) on all three: members only. The local edition has no session, so it
// has no codes — files only.
//
// A code is REUSABLE for its 24 hours (a household of three installs reads one code three times) and is not consumed by a
// read. Revoking is the creator's DELETE. Nothing survives the 24 hours: reads refuse an expired row and delete it, and
// every create sweeps the expired rows (at most once an hour).
//
// STORAGE: bot_kv, one row per code — key `setup_share:<CODE>`, value { owner, created_at, expires_at, bytes, setup }.
// No migration: bot_kv is the durable key-value table for state that must survive a Railway deploy. The owner's Discord id
// stays in the row for the creator's DELETE and is NEVER echoed in a response. The row is never read by anything else.
//
// The code alphabet leaves out 0 O 1 I L, so a code read aloud or from a screenshot is unambiguous. 31^6 is ~887 million, and
// a guess costs a request: wrong codes are throttled per member (15 an hour) as well as per address (requireAgentAuth).
//
// createSetupShare() takes its collaborators so the routes are testable without a database; index.js wires the real ones.
'use strict';

const crypto = require('crypto');
const { createIpLimiter } = require('./ipLimiter');
const portableSetup = require('./portableSetup');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 6;
const TTL_MS = 24 * 60 * 60 * 1000;
const KEY_PREFIX = 'setup_share:';
const MAX_BODY_BYTES = portableSetup.MAX_BYTES + 64 * 1024;   // the bundle's own cap is checked after it is rebuilt
const CREATES_PER_HOUR = 10;
const FETCHES_PER_HOUR = 60;
const MISSES_PER_HOUR = 15;
const INSERT_TRIES = 6;
const SWEEP_EVERY_MS = 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const CODE_RE = new RegExp(`^[${ALPHABET}]{${CODE_LEN}}$`);

/** What a person typed → the code it means, or null. Case, spaces and dashes are ignored ("abc-def" is "ABCDEF"). */
function normalizeCode(s) {
  const c = String(s == null ? '' : s).toUpperCase().replace(/[\s-]+/g, '');
  return CODE_RE.test(c) ? c : null;
}

/** A fresh code. crypto.randomInt is unbiased (no modulo skew). */
function newCode(randomInt = crypto.randomInt) {
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

function _json(res, status, obj, headers) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, headers || {}));
  return res.end(JSON.stringify(obj));
}

async function _readBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) return { tooBig: true };
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return (body && typeof body === 'object' && !Array.isArray(body)) ? { body } : { bad: true };
  } catch { return { bad: true }; }
}

function createSetupShare({ supabase, requireAuth, now = Date.now, randomInt = crypto.randomInt } = {}) {
  const createLimit = createIpLimiter({ max: CREATES_PER_HOUR, windowMs: HOUR, now, cleanupMs: 0 });
  const fetchLimit = createIpLimiter({ max: FETCHES_PER_HOUR, windowMs: HOUR, now, cleanupMs: 0 });
  const missLimit = createIpLimiter({ max: MISSES_PER_HOUR, windowMs: HOUR, now, cleanupMs: 0 });
  let lastSweep = 0;

  const kvKey = (code) => KEY_PREFIX + code;
  const _enc = encodeURIComponent;
  const limited = (res, hit) => _json(res, 429, { error: 'rate_limited', retry_after: hit.retryAfterSec }, { 'Retry-After': String(hit.retryAfterSec) });

  // Expired rows go. Fire-and-forget from a create, and at most once an hour: nothing waits on it, and a failure is the next
  // sweep's problem (reads refuse an expired row whether or not it has been swept).
  function sweep() {
    if (now() - lastSweep < SWEEP_EVERY_MS) return;
    lastSweep = now();
    const cutoff = encodeURIComponent(new Date(now()).toISOString());
    Promise.resolve(supabase.del('bot_kv',
      `guild_id=eq.${_enc(supabase.guildId())}&key=like.${encodeURIComponent(KEY_PREFIX)}*&value->>expires_at=lt.${cutoff}`)).catch(() => null);
  }

  async function _readRow(code) {
    return supabase.select('bot_kv', `guild_id=eq.${_enc(supabase.guildId())}&key=eq.${_enc(kvKey(code))}&select=value&limit=1`);
  }
  const _drop = (code) => Promise.resolve(supabase.del('bot_kv', `guild_id=eq.${_enc(supabase.guildId())}&key=eq.${_enc(kvKey(code))}`)).catch(() => null);
  const _expired = (v) => !v || typeof v.expires_at !== 'string' || !(Date.parse(v.expires_at) > now());

  async function create(req, res, identity) {
    const owner = identity.discord_id ? String(identity.discord_id) : '';
    if (!owner) return _json(res, 403, { error: 'no Discord identity on this session' });

    const read = await _readBody(req, MAX_BODY_BYTES);
    if (read.tooBig) return _json(res, 413, { error: 'too_large', max_bytes: portableSetup.MAX_BYTES });
    if (read.bad) return _json(res, 400, { error: 'invalid JSON' });
    const checked = portableSetup.validate(read.body.setup);
    if (!checked.ok) return _json(res, 400, { error: 'not_shareable', message: checked.error });

    // Counted only once the body is a real setup, so a client that sends rubbish cannot spend a member's hour.
    const hit = createLimit.hit(owner);
    if (hit.limited) return limited(res, hit);

    const created = new Date(now());
    const value = {
      owner,
      created_at: created.toISOString(),
      expires_at: new Date(created.getTime() + TTL_MS).toISOString(),
      bytes: checked.bytes,
      setup: checked.setup,
    };
    for (let i = 0; i < INSERT_TRIES; i++) {
      const code = newCode(randomInt);
      // ignore-duplicates: a code that already exists is not overwritten, it comes back as an empty answer and we draw again.
      const saved = await supabase.insertIgnoreDuplicates('bot_kv',
        [{ guild_id: supabase.guildId(), key: kvKey(code), value }], { representation: true });
      if (saved === null || saved === undefined) return _json(res, 503, { error: 'store_unavailable' }, { 'Retry-After': '30' });
      if (Array.isArray(saved) && saved.length) {
        sweep();
        return _json(res, 201, { ok: true, code, expires_at: value.expires_at, ttl_hours: TTL_MS / HOUR, bytes: value.bytes, summary: checked.summary });
      }
      // Taken. It may be a LAPSED code nobody swept yet: clear it if so (the next draw is a fresh code either way).
      const rows = await _readRow(code);
      if (Array.isArray(rows) && rows[0] && _expired(rows[0].value)) await _drop(code);
    }
    return _json(res, 503, { error: 'no_free_code' }, { 'Retry-After': '30' });
  }

  async function fetchOne(req, res, identity, codeIn) {
    const code = normalizeCode(codeIn);
    if (!code) return _json(res, 400, { error: 'bad_code', message: 'A code is six letters and numbers.' });
    const who = String(identity.discord_id || '');
    const hit = fetchLimit.hit(who);
    if (hit.limited) return limited(res, hit);
    if (missLimit.isOver(who, MISSES_PER_HOUR)) return limited(res, missLimit.hit(who));

    const rows = await _readRow(code);
    if (!Array.isArray(rows)) return _json(res, 503, { error: 'store_unavailable' }, { 'Retry-After': '30' });   // not "no such code"
    const row = rows[0] && rows[0].value;
    if (!row || _expired(row)) {
      if (row) await _drop(code);                 // expiry is enforced here, not only by the sweep
      missLimit.hit(who);                         // the 15th wrong code in an hour is the last one answered
      return _json(res, 404, { error: 'not_found', message: 'That code is not valid, or it has expired.' });
    }
    return _json(res, 200, { ok: true, code, expires_at: row.expires_at, setup: row.setup });
  }

  async function revoke(req, res, identity, codeIn) {
    const code = normalizeCode(codeIn);
    if (!code) return _json(res, 400, { error: 'bad_code' });
    const rows = await _readRow(code);
    if (!Array.isArray(rows)) return _json(res, 503, { error: 'store_unavailable' }, { 'Retry-After': '30' });
    const row = rows[0] && rows[0].value;
    if (!row || String(row.owner) !== String(identity.discord_id)) return _json(res, 404, { error: 'not_found' });
    await _drop(code);
    return _json(res, 200, { ok: true });
  }

  // true when the request was ours (and has been answered), false to let routing continue.
  async function handle(req, res) {
    const path = String(req.url || '').split(/[?#]/)[0];
    const m = /^\/api\/agent\/setup-share(?:\/([^/]+))?\/?$/.exec(path);
    if (!m) return false;
    const code = m[1] || null;
    const method = req.method;
    const allowed = code ? ['GET', 'DELETE'] : ['POST'];
    if (!allowed.includes(method)) { _json(res, 405, { error: 'method not allowed' }, { Allow: allowed.join(', ') }); return true; }
    const identity = await requireAuth(req, res);
    if (!identity) return true;      // requireAuth already answered 401/429/503
    if (!code) await create(req, res, identity);
    else if (method === 'GET') await fetchOne(req, res, identity, code);
    else await revoke(req, res, identity, code);
    return true;
  }

  return { handle, sweep };
}

module.exports = { createSetupShare, newCode, normalizeCode, ALPHABET, CODE_LEN, TTL_MS, KEY_PREFIX,
  CREATES_PER_HOUR, FETCHES_PER_HOUR, MISSES_PER_HOUR };
