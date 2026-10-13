// utils/ownTimers.js — a player's OWN buff timers (their pet's, and their own), kept in the database.
//
// WHY IT EXISTS
// The guild lead, 2026-10-13: buff timers on a player's own pet (and self) should pause while they are logged
// out and be "synced to the database so if I logged on from a different machine or if my installation failed I
// would still have those buff timers." The local agent POSTs its current set here and GETs it back on a fresh
// install or a second machine.
//
//   POST /api/agent/own-timers   { character, pet_name|null, last_line_ms|null,
//                                  pet_buffs: [{ name, dur_ticks, dur_formula, landed_at }] }
//   GET  /api/agent/own-timers?character=<Name>
//        -> { ok: true, timers: { character, pet_name, last_line_ms, pet_buffs, saved_at } | null }
//
// STORAGE: one row per character in `bot_kv` (service-role only, no migration), key `own_timers:<name lowercased>`,
// the whole object as the jsonb value. A save replaces the row; there is no history.
// WHO: the caller is the Mimic session's own Discord id, handed in by the route. A character is the caller's when
// it is in its family (utils/characterPrefs.js ownedNames/findOwned), the same rule as POST /character-prefs.
// The route itself (auth, body read) is _handleAgentOwnTimers* in index.js; the rules live here, against an
// injected supabase and cache, so they can be tested without a server.

const characterPrefs = require('./characterPrefs');

const GUILD = require('./supabase').guildId();
const KEY_PREFIX = 'own_timers:';
const MAX_BODY_BYTES = 16 * 1024;
const MAX_BUFFS = 40;
const MAX_STR = 64;
const MAX_TICKS = 100000;
const CHAR_RE = /^[A-Za-z]{2,20}$/;

const NO_ACCOUNT = { status: 403, body: { error: 'no linked account' } };
const NOT_YOURS = { status: 403, body: { error: 'not your character' } };
const UNAVAILABLE = { status: 502, body: { error: 'unavailable' } };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_STR;

const keyFor = (character) => KEY_PREFIX + String(character).toLowerCase();

// One buff entry -> the clean shape, or null when it is not exactly right (the caller drops it silently).
function cleanBuff(b) {
  if (!b || typeof b !== 'object') return null;
  if (!isStr(b.name)) return null;
  if (!isNum(b.dur_ticks) || b.dur_ticks < 0 || b.dur_ticks > MAX_TICKS) return null;
  const formula = b.dur_formula == null ? null : b.dur_formula;
  if (formula !== null && !isNum(formula)) return null;
  if (!isNum(b.landed_at)) return null;
  return { name: b.name, dur_ticks: b.dur_ticks, dur_formula: formula, landed_at: b.landed_at };
}

// The POST body -> { ok, value } or { ok: false, error }. Malformed buff entries are dropped; a malformed
// envelope (character, pet_name, last_line_ms, pet_buffs not an array) is a 400. More than MAX_BUFFS entries keep
// the first MAX_BUFFS.
function parseBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'body must be an object' };
  if (typeof body.character !== 'string' || !CHAR_RE.test(body.character)) return { ok: false, error: 'bad character' };
  const petName = body.pet_name == null ? null : body.pet_name;
  if (petName !== null && (typeof petName !== 'string' || petName.length > MAX_STR)) return { ok: false, error: 'bad pet_name' };
  const lastLine = body.last_line_ms == null ? null : body.last_line_ms;
  if (lastLine !== null && !isNum(lastLine)) return { ok: false, error: 'bad last_line_ms' };
  if (!Array.isArray(body.pet_buffs)) return { ok: false, error: 'pet_buffs must be an array' };
  const pet_buffs = body.pet_buffs.slice(0, MAX_BUFFS).map(cleanBuff).filter(Boolean);
  return { ok: true, character: body.character, value: { pet_name: petName, last_line_ms: lastLine, pet_buffs } };
}

// The caller's stored spelling of `character`, or a { status, body } to send instead.
async function owned(supabase, cache, discordId, character) {
  if (!discordId) return { fail: NO_ACCOUNT };
  const names = await characterPrefs.ownedNames(supabase, cache, discordId);
  if (!names) return { fail: UNAVAILABLE };
  const stored = characterPrefs.findOwned(names, character);
  if (!stored) return { fail: NOT_YOURS };
  return { stored };
}

// POST. Validation first (no database read for a request that cannot be honoured), then ownership, then ONE upsert.
async function saveTimers(supabase, cache, discordId, body) {
  if (!discordId) return NO_ACCOUNT;
  const parsed = parseBody(body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };

  const o = await owned(supabase, cache, discordId, parsed.character);
  if (o.fail) return o.fail;

  const savedAt = new Date().toISOString();
  const value = { character: o.stored, ...parsed.value, saved_at: savedAt };
  const rows = await supabase.upsert('bot_kv',
    [{ guild_id: GUILD, key: keyFor(o.stored), value, updated_at: savedAt }], 'guild_id,key');
  if (!Array.isArray(rows)) return UNAVAILABLE;
  return { status: 200, body: { ok: true, saved_at: savedAt } };
}

// GET. The stored object, or null when this character has never saved.
async function loadTimers(supabase, cache, discordId, character) {
  if (!discordId) return NO_ACCOUNT;
  if (typeof character !== 'string' || !CHAR_RE.test(character)) return { status: 400, body: { error: 'bad character' } };

  const o = await owned(supabase, cache, discordId, character);
  if (o.fail) return o.fail;

  const rows = await supabase.select('bot_kv',
    `guild_id=eq.${encodeURIComponent(GUILD)}&key=eq.${encodeURIComponent(keyFor(o.stored))}&select=value&limit=1`);
  if (!Array.isArray(rows)) return UNAVAILABLE;
  const v = rows[0]?.value;
  return { status: 200, body: { ok: true, timers: v && typeof v === 'object' && !Array.isArray(v) ? v : null } };
}

module.exports = { GUILD, KEY_PREFIX, MAX_BODY_BYTES, keyFor, cleanBuff, parseBody, saveTimers, loadTimers };
