// utils/characterPrefs.js — Mimic SETS a character's display and collection switches.
//
// WHY IT EXISTS
// The guild lead (2026-10-06): "the complete hide or hide from all but inventory should be with mimic
// during onboarding but the denotation on other side should be carried over." Until now only
// wolfpack.quest/me could write these flags (web/app/me/ExclusionToggles.tsx + its server action). Mimic's
// onboarding now writes them through POST /api/agent/character-prefs, and both sides read the SAME place:
// the three columns on the `characters` row. There is no second copy to drift.
//
//   hidden_from_lists   display only: the character leaves every character list, and shows only in the
//                       account inventory (the "Hide from lists" switch on /me)
//   exclude_from_stats  the character's own agent stops uploading, and /me leaves it out ("Stats: EXCLUDED")
//   exclude_inventory   Mimic stops uploading its inventory and spellbook ("Inventory: EXCLUDED")
//
// MODE: the onboarding shorthand Mimic sends instead of three booleans. Each mode is a fixed set of the
// three, and the same table runs backwards (modeOf) to name what a row currently holds, so the list Mimic
// shows and the choice it writes cannot disagree. A combination none of the three names (the website's
// switches can make one) reads as 'custom'.
//
//   show       nothing is hidden or excluded
//   inventory  hidden from everything but the account inventory; still uploads and still counts in stats
//   hidden     hidden completely: hidden from lists, excluded from stats, inventory excluded
//
// WHO: the caller is the Mimic session's own Discord id, handed in by the route. Nothing in the body names
// a person. A character is the caller's when it is in its FAMILY: the household (wolfpack_members merged
// aliases) -> the characters anchored to any household id -> their whole family by main_name. That is
// computed by owned_character_names() (supabase/migrations/20261007010000_owned_character_names.sql, the
// same rule as the My parses function), read once per person per five minutes.
//
// The route itself (auth, body read, status codes) is _handleAgentCharacterPrefsSet / the mine=1 branch of
// _handleAgentCharacterPrefs in index.js; every rule worth testing lives here, against an injected
// supabase and cache.

const { cleanChar, createCache } = require('./myParses');

// The deployment's guild tag (SUPABASE_GUILD_ID, else 'wolfpack'). Read once at load: the env is set at boot.
const GUILD = require('./supabase').guildId();
const FLAG_COLS = ['hidden_from_lists', 'exclude_from_stats', 'exclude_inventory'];

const MODE_FLAGS = Object.freeze({
  show:      Object.freeze({ hidden_from_lists: false, exclude_from_stats: false, exclude_inventory: false }),
  inventory: Object.freeze({ hidden_from_lists: true,  exclude_from_stats: false, exclude_inventory: false }),
  hidden:    Object.freeze({ hidden_from_lists: true,  exclude_from_stats: true,  exclude_inventory: true }),
});
const MODES = Object.freeze(Object.keys(MODE_FLAGS));

// The names of one person's family change only when a character is claimed or re-anchored, so five minutes
// is long enough to spare the database a function call per click and short enough that a newly claimed
// alt is settable within one cup of coffee.
function createOwnedCache(opts) { return createCache(opts); }

// A row (or any object) -> the three flags as plain booleans. Null and absent read as false, as the website does.
function prefsOf(row) {
  const out = {};
  for (const c of FLAG_COLS) out[c] = !!(row && row[c]);
  return out;
}

// Three flags -> the mode that names them, or 'custom'.
function modeOf(prefs) {
  const p = prefsOf(prefs);
  for (const m of MODES) if (FLAG_COLS.every(c => p[c] === MODE_FLAGS[m][c])) return m;
  return 'custom';
}

// The POST body -> { ok: true, character, patch } or { ok: false, error }. `patch` holds ONLY the columns to
// write: a mode sets all three, an explicit boolean overrides one of them, and a boolean sent alone leaves
// the other two as they are. Anything that is not exactly what it should be is refused, not coerced: this
// is a write, so "yes" or 1 is not a boolean and 'Hidden' is not a mode.
function parseSetBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'json object required' };

  const character = cleanChar(body.character);
  if (!character) return { ok: false, error: 'character required' };

  let patch = {};
  if (body.mode !== undefined) {
    if (typeof body.mode !== 'string' || !Object.prototype.hasOwnProperty.call(MODE_FLAGS, body.mode)) {
      return { ok: false, error: 'mode must be one of: ' + MODES.join(', ') };
    }
    patch = { ...MODE_FLAGS[body.mode] };
  }
  for (const c of FLAG_COLS) {
    if (body[c] === undefined) continue;
    if (typeof body[c] !== 'boolean') return { ok: false, error: c + ' must be a boolean' };
    patch[c] = body[c];
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: 'mode or at least one of ' + FLAG_COLS.join(', ') + ' required' };

  return { ok: true, character, patch };
}

// The stored spelling of `character` when it is in `names`, else null. Case-insensitive, because the route
// writes by the STORED name: what the caller typed is only used to find it.
function findOwned(names, character) {
  if (!Array.isArray(names) || typeof character !== 'string') return null;
  const want = character.toLowerCase();
  for (const n of names) if (typeof n === 'string' && n.toLowerCase() === want) return n;
  return null;
}

// Every character in the caller's family, by stored name; null when the read failed (supabase.rpc resolves
// null on any failure, so a failed read is never an empty family). Cached per person; a failure and an
// empty family are both left uncached, so a person who has just linked a character is not told "none" for
// five minutes.
async function ownedNames(supabase, cache, discordId) {
  const hit = cache.get(discordId);
  if (hit) return hit;
  const out = await supabase.rpc('owned_character_names', { p_discord_id: discordId });
  if (!Array.isArray(out)) return null;
  const names = out.filter(n => typeof n === 'string' && n);
  if (names.length) cache.set(discordId, names);
  return names;
}

// PostgREST in.(...) list: every value double-quoted, a backslash or quote inside escaped.
function inList(names) {
  return '(' + names.map(n => '"' + n.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + ')';
}

const SELECT_COLS = 'name,' + FLAG_COLS.join(',');
const NO_ACCOUNT = { status: 403, body: { error: 'no linked account' } };
const UNAVAILABLE = { status: 502, body: { error: 'unavailable' } };

// POST /api/agent/character-prefs. Resolves to { status, body } for the route to send. Validation comes first
// (no database read for a request that cannot be honoured), then ownership, then ONE write to the
// characters row. Nothing else is written: the website's switch writes this row and nothing more.
async function setPrefs(supabase, cache, discordId, body) {
  if (!discordId) return NO_ACCOUNT;

  const parsed = parseSetBody(body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };

  const names = await ownedNames(supabase, cache, discordId);
  if (!names) return UNAVAILABLE;
  const stored = findOwned(names, parsed.character);
  if (!stored) return { status: 403, body: { error: 'not your character' } };

  const rows = await supabase.update(
    'characters',
    `guild_id=eq.${encodeURIComponent(GUILD)}&name=eq.${encodeURIComponent(stored)}&select=${SELECT_COLS}`,
    parsed.patch,
  );
  if (!Array.isArray(rows)) return UNAVAILABLE;                                  // the write failed
  if (rows.length === 0) return { status: 404, body: { error: 'unknown character' } };  // gone since the family read

  const prefs = prefsOf(rows[0]);
  return { status: 200, body: { ok: true, character: stored, prefs, mode: modeOf(prefs) } };
}

// GET /api/agent/character-prefs?mine=1: every character in the caller's family with its three flags and
// the mode they name, sorted by name. Includes the characters the caller has hidden or excluded: the list
// exists so one can be switched back.
async function minePrefs(supabase, cache, discordId) {
  if (!discordId) return NO_ACCOUNT;

  const names = await ownedNames(supabase, cache, discordId);
  if (!names) return UNAVAILABLE;
  if (names.length === 0) return { status: 200, body: { ok: true, characters: [] } };

  const rows = await supabase.select(
    'characters',
    `guild_id=eq.${encodeURIComponent(GUILD)}&name=in.${encodeURIComponent(inList(names))}&select=${SELECT_COLS}`,
  );
  if (!Array.isArray(rows)) return UNAVAILABLE;

  const characters = rows
    .filter(r => r && typeof r.name === 'string')
    .map(r => { const prefs = prefsOf(r); return { name: r.name, ...prefs, mode: modeOf(prefs) }; })
    .sort((a, b) => { const x = a.name.toLowerCase(), y = b.name.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; });
  return { status: 200, body: { ok: true, characters } };
}

module.exports = {
  GUILD, FLAG_COLS, MODE_FLAGS, MODES,
  createOwnedCache, prefsOf, modeOf, parseSetBody, findOwned, ownedNames, inList, setPrefs, minePrefs,
};
