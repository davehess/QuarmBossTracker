// 2026-10-30, the guild lead: Target Info on Falto, Lord of Thunder read "not in the catalog". Seven PoP bosses (Storms,
// Valor) carry a comma in their catalog name, and an unquoted comma inside or=(…) ends the value: PostgREST refuses the
// whole query ("failed to parse logic tree"). The fake below splits or=(…) the way PostgREST does, so the old query fails.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { readSource, BOT_INDEX, sliceBlock } from './_source-slice.js';

const nodeRequire = createRequire(import.meta.url);
const SRC = readSource(BOT_INDEX);
const slice = sliceBlock(SRC, 'async function _buildMobInfo(supabase, {', '\n  return mob;\n}');
const helpers = [
  sliceBlock(SRC, 'function _mobCaseKey(n) {', '\n}'),
  sliceBlock(SRC, 'function _mobRowsForCase(rows, caseKey) {', '\n}'),
].join('\n');

// PostgREST's or=(a,b): split on commas outside double quotes; a value is `col.ilike.<v>` or `col.ilike."<v>"`; any
// other shape is a parse error, as on the server.
function parseOr(q) {
  const m = /^or=\((.*)\)&/.exec(q);
  if (!m) throw new Error('no or=');
  const body = decodeURIComponent(m[1]), parts = [];
  let cur = '', inQ = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\' && inQ) { cur += body[++i]; continue; }
    if (c === '"') { inQ = !inQ; cur += c; continue; }
    if (c === ',' && !inQ) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts.map(p => {
    const pm = /^name\.ilike\.(?:"(.*)"|([^",.:()]+))$/.exec(p);
    if (!pm) throw new Error('PGRST100 failed to parse logic tree: ' + p);
    return (pm[1] ?? pm[2]).toLowerCase();
  });
}
const body = (id, name) => ({
  id, name, class: 1, level: 70, maxlevel: 70, hp: 305000, mana: 0, ac: 10, mr: 140, fr: 515, cr: 45, pr: 45, dr: 75,
  mindmg: 316, maxdmg: 1137, runspeed: 1.25, npcspecialattks: '', special_abilities: '', raid_target: false,
  bodytype: 1, npc_spells_id: 0, see_invis: true, see_invis_undead: true, see_hide: false, see_improved_hide: false, race: 1, gender: 0,
});
const rows = [body(210470, 'Falto,_Lord_of_Thunder'), body(210459, 'a_blazing_mephit')];
const queries = [];
const sb = {
  select: async (table, q) => {
    if (table !== 'eqemu_npc_types') return [];
    queries.push(q);
    const want = parseOr(q);
    return rows.filter(r => want.includes(r.name.toLowerCase()));
  },
};
const build = new Function('mobSpecials', 'factionAssist', '_factionRowsFor', 'npcProcs', 'namedBosses', 'process', 'console',
  `${helpers}\nconst _GENDER_NAMES = { 0: 'male' };\nconst _MOB_CLASS_NAMES = { 1: 'Warrior' };\n${slice}\nreturn _buildMobInfo;`)(
  nodeRequire('../utils/mobSpecials.js'), { getIndex: async () => null, assistFor: () => null }, async () => null,
  nodeRequire('../utils/npcProcs.js'), { raidTarget: () => false }, process, { log() {}, warn() {} });
const ask = (caseKey) => build(sb, { name: caseKey, norm: caseKey.toLowerCase(), caseKey, reqZoneId: 210, reqGender: null });

describe('Target Info finds a boss with a comma in its name', () => {
  it('Falto, Lord of Thunder comes back from the catalog', async () => {
    const mob = await ask('Falto,_Lord_of_Thunder');
    expect(mob && mob.id).toBe(210470);
  });
  it('a plain name sends exactly the old, unquoted query', async () => {
    queries.length = 0;
    const mob = await ask('a_blazing_mephit');
    expect(mob && mob.id).toBe(210459);
    expect(queries[0]).toMatch(/^or=\(name\.ilike\.a_blazing_mephit,name\.ilike\.%23a_blazing_mephit\)&/);
  });
});
