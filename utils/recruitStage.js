// utils/recruitStage.js — a new member's first sign-in in Mimic stages their characters.
//
// WHY IT EXISTS
// The guild lead (2026-10-24): "[a new member] had to create his account on opendkp before he could log in. we should
// check for the discord role and let them in, then prestage as a new recruit main. but also ask if they want
// to upload their spellbook and inventory now" and "We should be asking what characters the player would like
// to upload (from their logs). If none show up, they can type in their character name to get started. A lot of
// things won't work without logs." The failure that prompted it: a new member's `characters` row existed with
// NULL class, rank, main_name and discord_id, so every ownership check said "not your character", the PoP spell
// view (it joins characters.class) showed nothing, and Mimic's Voice tab refused the name pronunciation. The
// spellbook itself HAD uploaded (it needs no characters row); only the row that makes it theirs was missing.
//
// WHAT IT DOES (POST /api/agent/characters/stage, body { characters: [{ name, is_main }] })
// For each name, on the `characters` row (guild_id, name) and nowhere else:
//   discord_id   the caller's, ONLY where it is NULL. A row owned by another Discord id is never touched and comes
//                back in `conflicts`. A row still unowned but already in OpenDKP (opendkp_id set) is also left alone
//                (reason in_opendkp_unclaimed): it belongs to the existing claim flow, and letting any signed-in
//                member claim a roster main by typing its name would be a way to take someone else's character.
//   rank         coalesce(rank, 'Recruit') for the main, coalesce(rank, 'Non-raid Alt') for the others
//   main_name    coalesce(main_name, <the main's stored name>) — the main points at itself, as the OpenDKP sync
//                writes a family root. If the MAIN conflicts, the alts get no main_name at all: pointing them at
//                someone else's main would put them in that person's family.
//   class        the MAIN only, and only when the member's Discord roles hold exactly one EQ class name:
//                coalesce(class, thatClass). An alt's class cannot be read off a role, so it stays NULL.
//   registered_via_web_at / registered_via_web_by_discord_id   the audit pair, stamped once
// NOTHING is created in OpenDKP here; an officer confirms or registers the recruit there.
//
// Idempotent: saving the same list again changes nothing (every column is filled only while empty).
// The OpenDKP roster sync (utils/openDkpSync.js syncCharacters) only upserts rows OpenDKP lists, and its payload
// has no discord_id column, so it can neither clobber a staged row nor strip its owner; once an officer registers
// the character it overwrites class/rank/main_name with OpenDKP's values, which is what we want.
//
// Pure of Discord and HTTP: the route in index.js reads the body and sends { status, body }. The database is
// injected so test/recruit-stage.test.js drives the real code against a stub.

const { canonClass } = require('./typicalRaid');

const NAME_RX = /^[A-Za-z]{2,24}$/;
const MAX_NAMES = 12;
const MAX_BODY_BYTES = 16 * 1024;

const RANK_MAIN = 'Recruit';
const RANK_ALT = 'Non-raid Alt';

const NO_ACCOUNT = { status: 403, body: { error: 'no linked account' } };
const UNAVAILABLE = { status: 502, body: { error: 'unavailable' } };

// EverQuest names are one capital then lowercase; the log file already spells them that way, but a typed name may not.
function stored(name) { return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase(); }

// Body -> { ok: true, entries: [{ name, is_main }], main } or { ok: false, error }. The first is_main wins; with
// none flagged the first name is the main. A repeated name (any case) counts once. Anything not exactly right is
// refused, not coerced: this is a write that hands out ownership.
function parseBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'json object required' };
  const list = body.characters;
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: 'characters required' };
  if (list.length > MAX_NAMES) return { ok: false, error: 'at most ' + MAX_NAMES + ' characters' };

  const seen = new Set();
  const entries = [];
  let main = null;
  for (const c of list) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return { ok: false, error: 'each character must be an object' };
    const raw = typeof c.name === 'string' ? c.name.trim() : '';
    if (!NAME_RX.test(raw)) return { ok: false, error: 'bad character name' };
    if (c.is_main !== undefined && typeof c.is_main !== 'boolean') return { ok: false, error: 'is_main must be a boolean' };
    const name = stored(raw);
    const lc = name.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);
    entries.push({ name, is_main: false });
    if (c.is_main === true && main === null) main = lc;
  }
  if (main === null) main = entries[0].name.toLowerCase();
  for (const e of entries) e.is_main = e.name.toLowerCase() === main;
  return { ok: true, entries, main: entries.find(e => e.is_main).name };
}

// The one EQ class a member's Discord roles name, or null when they name none or several.
function classFromRoles(roleNames) {
  const found = new Set();
  for (const r of Array.isArray(roleNames) ? roleNames : []) {
    const c = canonClass(r);
    if (c) found.add(c);
  }
  return found.size === 1 ? [...found][0] : null;
}

const SELECT_COLS = 'name,discord_id,rank,class,main_name,opendkp_id,registered_via_web_at';

// Resolves to { status, body } for the route to send.
async function stageCharacters(supabase, guildId, discordId, roleNames, body, nowIso) {
  if (!discordId) return NO_ACCOUNT;
  const parsed = parseBody(body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };

  // One read for every name, case-insensitive (names are letters only, so the ilike values need no escaping).
  const orList = '(' + parsed.entries.map(e => 'name.ilike.' + e.name).join(',') + ')';
  const rows = await supabase.select(
    'characters',
    `guild_id=eq.${encodeURIComponent(guildId)}&or=${encodeURIComponent(orList)}&select=${SELECT_COLS}`,
  );
  if (!Array.isArray(rows)) return UNAVAILABLE;
  const have = new Map();
  for (const r of rows) if (r && typeof r.name === 'string') have.set(r.name.toLowerCase(), r);

  const cls = classFromRoles(roleNames);
  const staged = [];
  const conflicts = [];
  // The main first, so the alts know whether it landed.
  const ordered = [...parsed.entries].sort((a, b) => (b.is_main ? 1 : 0) - (a.is_main ? 1 : 0));
  let mainName = null;

  for (const e of ordered) {
    const row = have.get(e.name.toLowerCase()) || null;
    const name = row ? row.name : e.name;

    if (row && row.discord_id && row.discord_id !== discordId) { conflicts.push({ name, reason: 'owned_by_another' }); continue; }
    if (row && !row.discord_id && row.opendkp_id != null) { conflicts.push({ name, reason: 'in_opendkp_unclaimed' }); continue; }

    const rank = e.is_main ? RANK_MAIN : RANK_ALT;
    const familyRoot = e.is_main ? name : mainName;   // an alt is only parented under a main that was actually staged
    let written = false;

    if (!row) {
      const fresh = {
        guild_id: guildId, name, discord_id: discordId, rank, active: true,
        registered_via_web_at: nowIso, registered_via_web_by_discord_id: discordId,
        ...(familyRoot ? { main_name: familyRoot } : {}),
        ...(e.is_main && cls ? { class: cls } : {}),
      };
      const out = await supabase.insert('characters', [fresh]);
      if (!Array.isArray(out) || out.length === 0) { conflicts.push({ name, reason: 'write_failed' }); continue; }
      written = true;
    } else {
      // Fill only what is empty; the discord_id guard in the filter makes the claim atomic against a racing claim.
      const patch = {};
      if (!row.discord_id) patch.discord_id = discordId;
      if (!row.rank) patch.rank = rank;
      if (!row.main_name && familyRoot) patch.main_name = familyRoot;
      if (e.is_main && !row.class && cls) patch.class = cls;
      if (!row.registered_via_web_at) {
        patch.registered_via_web_at = nowIso;
        patch.registered_via_web_by_discord_id = discordId;
      }
      if (Object.keys(patch).length > 0) {
        const claim = row.discord_id ? '' : '&discord_id=is.null';
        const out = await supabase.update(
          'characters',
          `guild_id=eq.${encodeURIComponent(guildId)}&name=eq.${encodeURIComponent(name)}${claim}`,
          patch,
        );
        if (!Array.isArray(out)) { conflicts.push({ name, reason: 'write_failed' }); continue; }
        if (out.length === 0) { conflicts.push({ name, reason: 'owned_by_another' }); continue; }   // lost the race
        written = true;
      }
    }
    if (e.is_main) mainName = name;
    staged.push({ name, is_main: e.is_main, rank: row && row.rank ? row.rank : rank, created: !row, changed: written });
  }

  // Report in the order the caller sent them.
  const order = new Map(parsed.entries.map((e, i) => [e.name.toLowerCase(), i]));
  const byOrder = (a, b) => (order.get(a.name.toLowerCase()) ?? 0) - (order.get(b.name.toLowerCase()) ?? 0);
  staged.sort(byOrder);
  conflicts.sort(byOrder);
  return { status: 200, body: { ok: true, staged, conflicts } };
}

module.exports = { NAME_RX, MAX_NAMES, MAX_BODY_BYTES, RANK_MAIN, RANK_ALT, parseBody, classFromRoles, stageCharacters };
