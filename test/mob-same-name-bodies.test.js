// test/mob-same-name-bodies.test.js — FB-80: one name, two catalog bodies, two LEVELS.
//
// A member, Mimic 2.9.0, 2026-10-14: in the Plane of Tactics Target Info "can't discern between 'a war boar'
// (lvl 55, only spawn in the tunnel behind the pit) and 'a war boar' (lvl 63, spawns in the pit)". It could not:
// the catalog holds both (eqemu_npc_types 214304 and 214048), the row-picker serves the highest level, so the
// tunnel boar showed the pit boar's level, HP and damage.
//
// What the client can see (Zeal named_pipe.cpp, 1.4.8): the target's LEVEL, and its position within 250 units.
// The bot lists the level bands (`level_bodies`) and serves any body by id; the agent picks the band from the
// level, then a /consider, then where the mob stands, and shows both bands when it still cannot tell.
//
// Fixture rows are the catalog's own (game data, queried 2026-10-22).
//
// Run: npx vitest run test/mob-same-name-bodies.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, BOT_INDEX, AGENT_INDEX, ROOT } from './_source-slice.js';

const nodeRequire = createRequire(import.meta.url);
const ms = nodeRequire('../utils/mobSpecials.js');

// "a War Boar", both bodies. 214304 is the tunnel one (level 55), 214048 the pit one (level 63).
const TUNNEL = { id: 214304, name: 'a_War_Boar', level: 55, maxlevel: 0, hp: 14300, class: 9, race: 321, gender: 2, mindmg: 67, maxdmg: 329, special_abilities: '', npcspecialattks: '' };
const PIT    = { id: 214048, name: 'a_War_Boar', level: 63, maxlevel: 0, hp: 29100, class: 9, race: 319, gender: 2, mindmg: 135, maxdmg: 583, special_abilities: '', npcspecialattks: '' };

describe('levelBodies', () => {
  it('lists one band per distinct level, highest first (the default pick leads)', () => {
    const picked = ms.pickAndMergeMobRows([TUNNEL, PIT], { zoneId: 214 });
    expect(picked.row.id).toBe(214048);   // the old, still-default answer
    expect(ms.levelBodies(picked.candidates)).toEqual([
      { id: 214048, level: 63, maxlevel: null, hp: 29100 },
      { id: 214304, level: 55, maxlevel: null, hp: 14300 },
    ]);
  });
  it('is empty for one body, so a single-row name answers byte-for-byte as before', () => {
    expect(ms.levelBodies([PIT])).toEqual([]);
    expect(ms.levelBodies([])).toEqual([]);
    expect(ms.levelBodies(undefined)).toEqual([]);
  });
  it('leaves a same-level pair to class_variants', () => {
    const a = { id: 76004, level: 49, hp: 10120 }, b = { id: 76005, level: 49, hp: 10120 };
    expect(ms.levelBodies([a, b])).toEqual([]);
  });
  it('two rows of one level collapse to one band, and a third level still makes a pair', () => {
    const out = ms.levelBodies([{ id: 1, level: 63, hp: 5 }, { id: 2, level: 63, hp: 4 }, { id: 3, level: 55, hp: 3 }]);
    expect(out.map(b => b.id)).toEqual([1, 3]);
  });
  it('keeps a level range as the band', () => {
    const out = ms.levelBodies([{ id: 1, level: 60, maxlevel: 63, hp: 5 }, { id: 2, level: 55, maxlevel: 0, hp: 3 }]);
    expect(out[0]).toEqual({ id: 1, level: 60, maxlevel: 63, hp: 5 });
  });
  it('is capped', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, level: 40 + i, hp: 1 }));
    expect(ms.levelBodies(rows)).toHaveLength(8);
  });
});

describe('the bot: _buildMobInfo and the mob-info endpoint', () => {
  const SRC = readSource(BOT_INDEX);
  const slice = sliceBlock(SRC, 'async function _buildMobInfo(supabase, {', '\n  return mob;\n}');
  const helpers = [
    sliceBlock(SRC, 'function _mobCaseKey(n) {', '\n}'),
    sliceBlock(SRC, 'function _mobRowsForCase(rows, caseKey) {', '\n}'),
  ].join('\n');
  const GENDER = "const _GENDER_NAMES = { 0: 'male', 1: 'female', 2: 'neuter' };";
  const CLASSES = "const _MOB_CLASS_NAMES = { 1:'Warrior', 9:'Rogue', 13:'Magician', 14:'Enchanter' };";
  let bodies;
  beforeEach(() => { bodies = [TUNNEL, PIT]; });
  const sb = () => ({
    select: async (table, q) => {
      if (table === 'eqemu_npc_types') {
        const want = decodeURIComponent(q.slice('or=(name.ilike.'.length, q.indexOf(',name.ilike')));
        return bodies.filter(b => b.name.toLowerCase() === want.toLowerCase());
      }
      return [];
    },
  });
  const build = () => new Function('mobSpecials', 'factionAssist', '_factionRowsFor', 'npcProcs', 'process', 'console', 'namedBosses',
    `${helpers}\n${GENDER}\n${CLASSES}\n${slice}\nreturn _buildMobInfo;`)(
    ms, { getIndex: async () => null, assistFor: () => null }, async () => null,
    nodeRequire('../utils/npcProcs.js'), process, console, nodeRequire('../utils/namedBosses.js'));
  const ask = (extra) => build()(sb(), { name: 'a_War_Boar', norm: 'a_war_boar', caseKey: 'a_War_Boar', reqZoneId: 214, reqGender: null, ...extra });

  it('still answers the highest level, now with both bands listed', async () => {
    const mob = await ask({});
    expect(mob.id).toBe(214048);
    expect(mob.level).toBe(63);
    expect(mob.level_bodies.map(b => [b.id, b.level])).toEqual([[214048, 63], [214304, 55]]);
  });
  it('npcId serves that body whole (its level, HP and damage) and still lists both bands', async () => {
    const mob = await ask({ npcId: 214304 });
    expect([mob.id, mob.level, mob.hp, mob.mindmg, mob.maxdmg]).toEqual([214304, 55, 14300, 67, 329]);
    expect(mob.level_bodies.map(b => b.id)).toEqual([214048, 214304]);
  });
  it('an id that is not one of this name\'s rows is ignored', async () => {
    const mob = await ask({ npcId: 999999 });
    expect(mob.id).toBe(214048);
  });
  it('a name with one body carries no level_bodies key at all', async () => {
    bodies = [PIT];
    const mob = await ask({});
    expect(Object.prototype.hasOwnProperty.call(mob, 'level_bodies')).toBe(false);
  });
  it('the endpoint reads npc_id, keys its cache on it and bumps the zone pack shape', () => {
    const bot = stripJs(SRC);
    expect(bot).toMatch(/const n = parseInt\(sp\.get\('npc_id'\), 10\);/);
    expect(bot).toMatch(/\+ \(reqNpcId != null \? '\|n' \+ reqNpcId : ''\);/);
    expect(bot).toMatch(/_buildMobInfo\(supabase, \{ name, norm, caseKey, reqZoneId, reqGender, npcId: reqNpcId \}\)/);
    expect(bot).toMatch(/const _MOB_PACK_VERSION = 10;/);
  });
});

// ── The agent ───────────────────────────────────────────────────────────────────────────────────
const SRC_A = readSource(AGENT_INDEX);
const NORM = sliceBlock(SRC_A, 'function _mapNormName(n) {', '// Which spawn point did a mob that just died come from?');
const SERVER_XY = sliceBlock(SRC_A, 'function _mapServerXY(loc) {', '\n}');
const RESOLVER = sliceBlock(SRC_A, '// ── Two mobs, one name (FB-80)', '  } catch { return mob; }\n}');

// Spawn points as the Map's zone data lists them (utils/zoneSpawns.js): a name and a level per npc. Positions are the
// real catalog's (server frame): the level 55 boars stand in the tunnel, the level 63 ones walk grid 29 in the pit.
const POINTS = [
  { id: 361153, x: 1226, y: -868, z: -290.6, grid: null, npcs: [{ name: 'a War Boar', level: 55 }] },
  { id: 361189, x: 1226, y: -804, z: -288.7, grid: null, npcs: [{ name: 'a War Boar', level: 55 }] },
  { id: 361360, x: 1123, y: -438, z: -288.7, grid: null, npcs: [{ name: 'a War Boar', level: 55 }] },
  { id: 361166, x: 642, y: -218, z: -285.4, grid: 29, npcs: [{ name: 'A Young War Boar', level: 46 }, { name: 'an Enraged War Boar', level: 62 }, { name: 'a War Boar', level: 63 }] },
  { id: 361167, x: 800, y: -352, z: -285.4, grid: 29, npcs: [{ name: 'a War Boar', level: 63 }] },
  { id: 361212, x: 884, y: 23, z: -285.4, grid: 29, npcs: [{ name: 'a War Boar', level: 63 }] },
];
const GRIDS = { 29: { type: 1, pts: [[642, -218, -285, 0], [800, -352, -285, 0], [884, 23, -285, 0]] } };
const BODIES = [{ id: 214048, level: 63, maxlevel: null, hp: 29100 }, { id: 214304, level: 55, maxlevel: null, hp: 14300 }];
const MOB63 = { id: 214048, name: 'a War Boar', level: 63, hp: 29100, mindmg: 135, maxdmg: 583, level_bodies: BODIES };
const MOB55 = { id: 214304, name: 'a War Boar', level: 55, hp: 14300, mindmg: 67, maxdmg: 329, level_bodies: BODIES };

function loadAgent(extra) {
  globalThis.__bodiesTest = extra || {};
  const prefix = `
    const __t = globalThis.__bodiesTest;
    const MOB_INFO_TTL_MS = 6 * 60 * 60 * 1000;
    const _mobInfoByName = __t.cache || new Map();
    const _mobInfoCacheKey = (n, z, id) => String(n).toLowerCase() + '|' + z + (id != null ? '|n' + id : '');
    const fetchMobInfo = (...a) => { (__t.fetches || []).push(a); };
    const conLevelFor = () => __t.con || null;
    const _mapZoneShort = () => 'potactics';
    const _mapEnsureZone = () => (__t.zone === undefined ? { body: { points: ${JSON.stringify(POINTS)}, grids: ${JSON.stringify(GRIDS)} } } : __t.zone);
  `;
  return evalBlock(prefix + NORM + '\n' + SERVER_XY + '\n' + RESOLVER, ['resolveMobBody', '_pickMobBody']);
}
// A Zeal pipe position is the server's x/y swapped.
const pipe = (x, y) => ({ x: y, y: x, z: 0 });

describe('resolveMobBody: the evidence, strongest first', () => {
  let r;
  beforeEach(() => { r = loadAgent().resolveMobBody; });
  const where = (x, y) => ({ name: 'a war boar', loc: { x, y, z: 0 }, place: () => ({ points: POINTS, grids: GRIDS }) });

  it('a single-body mob is left alone (null)', () => {
    expect(r({ id: 1, level: 50 }, { level: 50 })).toBe(null);
    expect(r({ id: 1, level: 50, level_bodies: [{ id: 1, level: 50 }] }, { level: 50 })).toBe(null);
  });
  it('picks by the target\'s level, exactly', () => {
    expect(r(MOB63, { level: 55 })).toMatchObject({ id: 214304, how: 'level' });
    expect(r(MOB63, { level: 63 })).toMatchObject({ id: 214048, how: 'level' });
  });
  it('a level inside a band\'s range counts for that band', () => {
    const m = { id: 1, level_bodies: [{ id: 1, level: 60, maxlevel: 63 }, { id: 2, level: 55, maxlevel: null }] };
    expect(r(m, { level: 62 })).toMatchObject({ id: 1, how: 'level' });
  });
  it('a level that fits no band is ignored, not trusted', () => {
    const out = r(MOB63, { level: 59 });
    expect(out.id).toBe(null);
    expect(out.cands).toHaveLength(2);
  });
  it('the target\'s level outranks where it stands', () => {
    expect(r(MOB63, { level: 63, ...where(1226, -868) })).toMatchObject({ id: 214048, how: 'level' });
  });
  it('without a level, a /consider range picks the band it allows', () => {
    expect(r(MOB63, { con: { min: 63, max: null } })).toMatchObject({ id: 214048, how: 'con' });   // red
    expect(r(MOB63, { con: { min: 1, max: 57 } })).toMatchObject({ id: 214304, how: 'con' });      // green
    expect(r(MOB63, { con: { min: 40, max: 70 } }).id).toBe(null);                                  // fits both: no help
  });
  it('without either, where it stands picks the band whose spawn points it is at', () => {
    expect(r(MOB63, where(1226, -850))).toMatchObject({ id: 214304, how: 'place' });   // the tunnel
    expect(r(MOB63, where(650, -225))).toMatchObject({ id: 214048, how: 'place' });    // the pit
  });
  it('a pit boar walking its route is still the pit one', () => {
    expect(r(MOB63, where(860, -200))).toMatchObject({ id: 214048, how: 'place' });
  });
  it('a walker far from its spawn point but on its route beats a still mob that is nearer in a straight line', () => {
    // A (level 63) spawns at the origin and walks a straight route to x=1000. B (level 55) stands at (900, 300).
    // The mob is at (900, 0): 900 from A's spawn point, 300 from B's, and ON A's route.
    const points = [
      { id: 1, x: 0, y: 0, z: 0, grid: 7, npcs: [{ name: 'a war boar', level: 63 }] },
      { id: 2, x: 900, y: 300, z: 0, grid: null, npcs: [{ name: 'a war boar', level: 55 }] },
    ];
    const grids = { 7: { type: 0, pts: [[0, 0, 0, 0], [1000, 0, 0, 0]] } };
    const ev = { name: 'a war boar', loc: { x: 900, y: 0, z: 0 }, place: () => ({ points, grids }) };
    expect(r(MOB63, ev)).toMatchObject({ id: 214048, how: 'place' });
    expect(r(MOB63, { ...ev, place: () => ({ points, grids: null }) }).id).toBe(214304);   // no route known: the nearer spot
  });
  it('a mob about equally far from both is ambiguous: both bands, no pick', () => {
    const out = r(MOB63, where(1000, -600));
    expect(out.id).toBe(null);
    expect(out.how).toBe(null);
    expect(out.cands.map(b => b.id)).toEqual([214048, 214304]);
  });
  it('no position and no level: ambiguous', () => {
    expect(r(MOB63, {})).toMatchObject({ id: null, how: null });
  });
  it('a body no spawn point can make is never chosen by place, and a lone placed body wins', () => {
    const only63 = [POINTS[3], POINTS[4], POINTS[5]];
    const out = r(MOB63, { name: 'a war boar', loc: { x: 700, y: -300, z: 0 }, place: () => ({ points: only63, grids: GRIDS }) });
    expect(out).toMatchObject({ id: 214048, how: 'place' });
  });
});

describe('_pickMobBody: what Target Info shows', () => {
  const st = (o) => ({ target_name: 'a war boar', target_level: null, target_loc: null, ...o });
  it('a mob with one body comes back as the very same object', () => {
    const { _pickMobBody: pick } = loadAgent();
    const mob = { id: 1, level: 50 };
    expect(pick(mob, st({ target_level: 50 }), 'Aldenmar', 214, 1000)).toBe(mob);
  });
  it('the primary body\'s level resolves in place', () => {
    const { _pickMobBody: pick } = loadAgent();
    const out = pick(MOB63, st({ target_level: 63 }), 'Aldenmar', 214, 1000);
    expect(out).toMatchObject({ id: 214048, level: 63, body_pick: { how: 'level' } });
  });
  it('the other body asks the bot for its row, and until it arrives shows only the level and HP its band told us', () => {
    const fetches = [];
    const { _pickMobBody: pick } = loadAgent({ fetches });
    const out = pick(MOB63, st({ target_level: 55 }), 'Aldenmar', 214, 1000);
    expect(fetches).toEqual([['a war boar', 'Aldenmar', 214, 214304]]);
    expect([out.level, out.hp, out.mindmg, out.maxdmg]).toEqual([55, 14300, null, null]);   // never the 63's 29,100 HP
    expect(out.body_pick.cands.map(c => c.level)).toEqual([55]);
  });
  it('undecided between both: both bands, every number that differs blanked', () => {
    const { _pickMobBody: pick } = loadAgent();
    const out = pick(MOB63, st({}), 'Aldenmar', 214, 1000);
    expect(out.body_pick.how).toBe(null);
    expect(out.body_pick.cands.map(c => c.level)).toEqual([63, 55]);
    expect([out.level, out.hp, out.mindmg, out.maxdmg]).toEqual([null, null, null, null]);
  });
  it('once that row is held, it IS the mob shown', () => {
    const cache = new Map([['a war boar|214|n214304', { at: 1000, mob: { ...MOB55, level_bodies: undefined } }]]);
    const fetches = [];
    const { _pickMobBody: pick } = loadAgent({ cache, fetches });
    const out = pick(MOB63, st({ target_level: 55 }), 'Aldenmar', 214, 2000);
    expect(fetches).toEqual([]);
    expect(out).toMatchObject({ id: 214304, level: 55, hp: 14300, mindmg: 67, body_pick: { how: 'level' } });
    expect(out.level_bodies).toEqual(BODIES);
  });
  it('a row past its TTL is asked for again', () => {
    const cache = new Map([['a war boar|214|n214304', { at: 0, mob: MOB55 }]]);
    const fetches = [];
    const { _pickMobBody: pick } = loadAgent({ cache, fetches });
    pick(MOB63, st({ target_level: 55 }), 'Aldenmar', 214, 7 * 60 * 60 * 1000);
    expect(fetches).toHaveLength(1);
  });
  it('place picks the tunnel boar from the server-frame position of a Zeal pipe loc', () => {
    const fetches = [];
    const { _pickMobBody: pick } = loadAgent({ fetches });
    pick(MOB63, st({ target_loc: pipe(1226, -850) }), 'Aldenmar', 214, 1000);
    expect(fetches[0][3]).toBe(214304);
  });
  it('an unplaced, unleveled target stays ambiguous and asks for nothing', () => {
    const fetches = [];
    const { _pickMobBody: pick } = loadAgent({ fetches, zone: null });
    const out = pick(MOB63, st({ target_loc: pipe(1000, -600) }), 'Aldenmar', 214, 1000);
    expect(fetches).toEqual([]);
    expect(out.body_pick.how).toBe(null);
  });
});

describe('the wiring', () => {
  const agent = stripJs(SRC_A);
  it('buildMobInfo shows the picked body', () => {
    expect(agent).toMatch(/mob:\s+cached && cached\.mob \? _pickMobBody\(cached\.mob, st, selfChar, myZoneId, Date\.now\(\)\) : null,/);
  });
  it('fetchMobInfo asks for a body by id and never answers it from the zone pack', () => {
    expect(agent).toMatch(/if \(npcId != null\) url \+= '&npc_id=' \+ encodeURIComponent\(npcId\);/);
    expect(agent).toMatch(/const packed = npcId != null \? null : _mobPackLookup\(name, zoneId\);/);
  });
  it('Mimic reads the target\'s level off the pipe and nulls it when absent', () => {
    const main = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')));
    expect(main).toMatch(/s\.target_level = \(typeof inner\.target_level === 'number'/);
  });
  it('the overlay prints the candidates while undecided', () => {
    const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'), 'utf8');
    expect(html).toMatch(/mob\.body_pick && !mob\.body_pick\.how/);
    expect(html).toMatch(/bodyCands\.map\(bodyLv\)\.join\(' or '\)/);
  });
});

// fetchMobInfo, run for real (the same slice test/mob-pack-agent.test.js runs): a body asked for by id goes to the bot
// with npc_id and lands under its own key. (That it is never answered from the zone pack, which holds one body per
// name, is the `packed` line asserted under "the wiring".)
describe('fetchMobInfo with an npcId', () => {
  const block = sliceBlock(SRC_A, 'const _mobInfoByName  = new Map();', '\n// ── Spawn map core');
  function load(S) {
    globalThis.__bodiesFetch = S;
    const prefix = `
      const __s = globalThis.__bodiesFetch;
      const fs = __s.fs, path = __s.path, zlib = __s.zlib, https = __s.https, http = __s.https;
      const __dirname = '/nowhere';
      const AGENT_VERSION = '0.0.0';
      const eqServerCaps = () => ({ catalog: true }), eqServerForCharacter = () => 'quarm', _primaryCharacter = () => null;
      let _uploadOpts = { botUrl: 'https://bot.example/api/agent/encounter', token: 't' };
      const _zealState = {};
      const _controlStandDown = () => ({ down: false });
      const console = { log() {}, warn() {} };
    `;
    return evalBlock(prefix + block, ['_mobInfoByName', '_mobInfoCacheKey', 'fetchMobInfo', '_mobPackZoneMobs']);
  }
  it('asks with npc_id, keys the answer on it, and skips the pack', () => {
    const paths = [];
    const https = { request(opts) { paths.push(opts.path); return { on() { return this; }, destroy() {}, end() {} }; } };
    const m = load({ fs, path, zlib: nodeRequire('zlib'), https });
    const idxKey = m._mobInfoCacheKey('a war boar', 214, 214304);
    expect(idxKey).toBe(m._mobInfoCacheKey('a war boar', 214) + '|n214304');
    m.fetchMobInfo('a war boar', 'Aldenmar', 214, 214304);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/\/mob-info\?name=a%20war%20boar&character=Aldenmar&npc_id=214304$/);
    expect(m._mobInfoByName.has(m._mobInfoCacheKey('a war boar', 214))).toBe(false);
  });
  it('without an npcId the request is exactly what it was', () => {
    const paths = [];
    const https = { request(opts) { paths.push(opts.path); return { on() { return this; }, destroy() {}, end() {} }; } };
    const m = load({ fs, path, zlib: nodeRequire('zlib'), https });
    m.fetchMobInfo('a war boar', 'Aldenmar', 214);
    expect(paths[0]).toMatch(/\/mob-info\?name=a%20war%20boar&character=Aldenmar$/);
  });
});
