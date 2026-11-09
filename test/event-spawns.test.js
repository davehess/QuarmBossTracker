// test/event-spawns.test.js: PoP event mobs from the server's quest scripts (2026-11-09).
//
// The event mobs are spawned by scripts (eq.spawn2 / eq.unique_spawn), so they have no eqemu_spawn2 row: no range ring
// on the Map, no spawn-point pinning, and their kills were dropped from the replay timelines (auto_registered fiends).
// utils/eventSpawnParse.js reads the scripts, scripts/gen-event-spawns.js writes data/event-spawns.json (copied to
// web/lib/eventSpawns.json), utils/zoneSpawns.js turns it into points, web/lib/eventNpcIds.ts feeds the timelines.
//
// The parser tests run the shipped module over small fixtures modelled on Coirnav (25 + 3 spots, type constants) and
// Fennin (Y, X order). Mob names are the catalog's own. Run: npx vitest run test/event-spawns.test.js
// Mutation-checked: dropping the Y/X swap in the parser turns "Fennin's table is Y, X" red.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fakeSupabase } from './_fake-supabase-js.js';
import { loadTimelineKills } from '../web/lib/raidTimelineLoad.ts';
import { EVENT_NPC_IDS, eventNpcIdsFor, isEventNpcId } from '../web/lib/eventNpcIds.ts';
import { ROOT, stripJs } from './_source-slice.js';

const nodeRequire = createRequire(import.meta.url);
const { parseScript, stripComments } = nodeRequire('../utils/eventSpawnParse');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'event-spawns.json'), 'utf8'));

// 25 fiend spots + 3 mini spots, as Coirnav.lua has them (a few spots kept; the count is padded to 25 below).
const spots = Array.from({ length: 25 }, (_, i) => `\t{ ${-800 - i},${1000 + i},-501 },`).join('\n');
const COIRNAV = `
local COIRNAV_TYPE = 216048; -- Coirnav_the_Avatar_of_Water
local VAPORFIEND_TYPE = 216257; -- a_triloun_vaporfiend
local ICEFIEND_TYPE = 216260; -- a_hraquis_icefiend
local WATERFIEND_TYPE = 216258; -- a_regrua_waterfiend
local PWELON_TYPE = 216236; -- Pwelon_of_Vapor
local NRINDA_TYPE = 216245; -- Nrinda_of_Ice
local VAMUIL_TYPE = 216247; -- Vamuil_of_Water
local PROJECTION_TYPE = 216266; -- Essence_of_Water
local COIRNAV_SPAWNID = 365647;
-- a comment with { 1,2,3 } in it
local SPAWN_LOCS = {
${spots}
};
local FIENDS={VAPORFIEND_TYPE,ICEFIEND_TYPE,WATERFIEND_TYPE};
local MINIS={PWELON_TYPE,NRINDA_TYPE,VAMUIL_TYPE};
local MINI_LOCS={{-860,1065,-480,64},{-877,1095,-480,64},{-860,1120,-480,64}};
local function SpawnWave(w)
    for _,loc in ipairs(SPAWN_LOCS)do if not SpawnRecord(FIENDS[w],1,loc,70)then return;end end
    if not SpawnRecord(MINIS[w],2,MINI_LOCS[w],0)then return;end
end
local function SpawnRecord(typ,kind,loc,grid)
    local n=eq.spawn2(typ,grid or 0,0,loc[1],loc[2],loc[3],loc[4]or 0);
end
function Death(e)
    ProjectionEligibility.Spawn(PROJECTION_TYPE,0,0,e.self:GetX(),e.self:GetY(),e.self:GetZ(),0,e.killer);
end
`;

const FENNIN = `
local REAVER_TYPE = 217417; -- a_rage_reaver_of_flame
local KIRTRA_TYPE = 217432; -- Chancellor_Kirtra
local FENNIN_TYPE = 217440; -- Fennin_Ro_the_Tyrant_of_Fire
local GUARDIAN_SPAWN_ID = 367088;
local SPAWNS = {	-- these locs are copied from showeq so they are Y, X, Z, 360 degree headings
	[1] = {
		[REAVER_TYPE] = {
			{ -1621,	-588,	-166.625,	329.0625 },
			{ -1321,	-605,	-117.375,	37.26563 },
		},
	},
	[3] = { [KIRTRA_TYPE]  = { { -1152, -1555, -199, 182 } }, },
	[4] = { [FENNIN_TYPE]  = { { -930, -1504, -160, 182 } }, },
};
local function Spawn(data, loc)
    local npc=eq.spawn2(data.typ,0,0,loc[2],loc[1],loc[3],loc[4]*0.7);
end
`;

const RELATIVE = `
local SPORADIC_TYPE = 215388; -- A_Sporadic_Stormrider
local AVATAR_TYPE = 215391; -- #Avatar_of_Wind
function Spawn(e)
    eq.spawn2(SPORADIC_TYPE, 0, 0, e.self:GetX(), e.self:GetY(), e.self:GetZ(), 0);
    eq.unique_spawn(AVATAR_TYPE, 0, 0, -1591, 484, 15, 192);
end
`;

const parse = (src, script = 'powater/encounters/Test.lua') => parseScript(src, { zone: script.split('/')[0], script });

describe('the parser over a Coirnav-shaped script', () => {
  const r = parse(COIRNAV);

  it('puts every fiend type on all 25 spots and one mini on each of the 3 mini spots', () => {
    const at = (id, role) => r.entries.filter(e => e.npc_id === id && e.role === role);
    for (const id of [216257, 216260, 216258]) expect(at(id, 'spawn_locs')).toHaveLength(25);
    expect(at(216236, 'mini_locs')).toHaveLength(1);
    expect(at(216236, 'mini_locs')[0]).toMatchObject({ x: -860, y: 1065, z: -480, h: 64, kind: 'table' });
    expect(at(216245, 'mini_locs')[0]).toMatchObject({ x: -877, y: 1095 });
    expect(at(216247, 'mini_locs')[0]).toMatchObject({ x: -860, y: 1120 });
  });

  it('pairs a mini with its own spot by index, and does not leak the fiends onto the mini spots', () => {
    const onMini = r.entries.filter(e => e.role === 'mini_locs').map(e => e.npc_id).sort();
    expect(onMini).toEqual([216236, 216245, 216247]);
  });

  it('reads the name hint from the constant\'s comment and does not take a spawn id for a type', () => {
    expect(r.entries.find(e => e.npc_id === 216236).name).toBe('Pwelon of Vapor');
    expect(r.type_ids).not.toContain(365647);
    expect(r.type_ids).toContain(216048);
  });

  it('a spawn that follows the killer is relative: no coordinates, an anchor', () => {
    const rel = r.entries.filter(e => e.kind === 'relative');
    expect(rel).toHaveLength(1);
    expect(rel[0]).toMatchObject({ npc_id: 216266, anchor: 'self' });
    expect(rel[0].x).toBeUndefined();
    expect(rel[0].y).toBeUndefined();
  });

  it('comments are not read: braces and numbers inside one add nothing', () => {
    expect(stripComments('local A = 1 -- { 1,2,3 }\n--[[ { 4,5,6 } ]]\nlocal B = 2')).not.toMatch(/[456]/);
  });
});

describe('the parser over a Fennin-shaped script', () => {
  const r = parse(FENNIN, 'pofire/encounters/Test.lua');

  it('Fennin\'s table is Y, X: the spawn call swaps loc[2] and loc[1], so x is the second number', () => {
    const reaver = r.entries.filter(e => e.npc_id === 217417);
    expect(reaver).toHaveLength(2);
    expect(reaver[0]).toMatchObject({ x: -588, y: -1621, z: -166.625, src_yx: true });
    expect(r.entries.find(e => e.npc_id === 217432)).toMatchObject({ x: -1555, y: -1152 });
    expect(r.entries.find(e => e.npc_id === 217440)).toMatchObject({ x: -1504, y: -930 });
  });

  it('keeps the phase in the role', () => {
    expect(r.entries.find(e => e.npc_id === 217432).role).toBe('spawns[3]');
  });

  it('without the swapping call the same table is read in the order written', () => {
    const plain = parse(FENNIN.replace('loc[2],loc[1]', 'loc[1],loc[2]'), 'pofire/encounters/Test.lua');
    expect(plain.entries.find(e => e.npc_id === 217432)).toMatchObject({ x: -1152, y: -1555 });
  });
});

describe('literal and relative spawn calls', () => {
  const r = parse(RELATIVE, 'poair/encounters/Test.lua');
  it('a literal unique_spawn is a fixed point', () => {
    expect(r.entries.find(e => e.npc_id === 215391)).toMatchObject({ kind: 'fixed', x: -1591, y: 484, z: 15, h: 192 });
  });
  it('GetX() in the call makes it relative, never a point', () => {
    const e = r.entries.find(x => x.npc_id === 215388);
    expect(e.kind).toBe('relative');
    expect('x' in e).toBe(false);
  });
});

describe('the committed data/event-spawns.json', () => {
  const placed = (zone) => (DATA.zones[zone] || []).filter(e => e.kind !== 'relative');
  const spotsOf = (zone) => new Set(placed(zone).map(e => `${e.x}|${e.y}|${e.z}`));

  it('powater has the 25 fiend spots and the three minis (28+ spots)', () => {
    expect(spotsOf('powater').size).toBeGreaterThanOrEqual(28);
    for (const id of [216236, 216245, 216247]) expect(placed('powater').some(e => e.npc_id === id)).toBe(true);
  });
  it('pofire has points and every other event zone is present', () => {
    expect(spotsOf('pofire').size).toBeGreaterThan(30);
    for (const z of ['poair', 'poeartha', 'poearthb']) expect(DATA.zones[z]).toBeDefined();
  });
  it('every npc id is an integer, every placed entry has numeric x, y, z, no relative entry has any', () => {
    for (const [zone, list] of Object.entries(DATA.zones)) {
      for (const e of list) {
        expect(Number.isInteger(e.npc_id)).toBe(true);
        if (e.kind === 'relative') { expect(e.x).toBeUndefined(); expect(e.y).toBeUndefined(); }
        else for (const k of ['x', 'y', 'z']) expect(typeof e[k]).toBe('number');
      }
      for (const id of DATA.npc_ids[zone]) expect(Number.isInteger(id)).toBe(true);
      for (const e of list) expect(DATA.npc_ids[zone]).toContain(e.npc_id);
    }
    expect(DATA.quests_sha).toMatch(/^[0-9a-f]{40}$/);
  });
  it('the web copy is byte-identical (the web imports nothing from outside web/)', () => {
    expect(fs.readFileSync(path.join(ROOT, 'web', 'lib', 'eventSpawns.json'), 'utf8'))
      .toBe(fs.readFileSync(path.join(ROOT, 'data', 'event-spawns.json'), 'utf8'));
  });
});

describe('the replay timelines keep a scripted-event kill', () => {
  const FIEND = 216258, TRASH_MOB = 216999, CURATED = 159000;
  const T = (min) => new Date(Date.UTC(2026, 10, 9, 12, min, 0)).toISOString();
  const enc = (npc, min, i) => ({ id: `e${i}`, guild_id: 'g', npc_id: npc, ended_at: T(min), classification: null, is_wipe: false, zone_short: null, eqemu_npc_types: { name: `Mob_${npc}` } });
  const world = () => fakeSupabase({ tables: {
    encounters: [enc(FIEND, 10, 1), enc(TRASH_MOB, 20, 2), enc(CURATED, 30, 3)],
    bosses_local: [{ npc_id: FIEND, auto_registered: true }, { npc_id: CURATED, auto_registered: false }],
  } });

  it('an auto-registered event fiend is included; an uncurated, non-event mob is still excluded', async () => {
    expect(isEventNpcId(FIEND)).toBe(true);
    expect(isEventNpcId(TRASH_MOB)).toBe(false);
    const kills = await loadTimelineKills(world(), T(0), T(120), 'g');
    expect(kills.map(k => k.npc_id)).toEqual([FIEND, CURATED]);
  });

  it('the helper reads the committed list: per zone and overall', () => {
    expect(eventNpcIdsFor('powater').has(216258)).toBe(true);
    expect(eventNpcIdsFor('nowhere').size).toBe(0);
    expect(EVENT_NPC_IDS.size).toBeGreaterThan(100);
  });

  it('all three loaders ask the same helper', () => {
    for (const f of ['web/lib/raidTimelineLoad.ts', 'web/lib/replayBossesLoad.ts', 'web/app/api/spectator/replay/bosses/route.ts']) {
      const code = stripJs(fs.readFileSync(path.join(ROOT, f), 'utf8'));
      expect(code).toMatch(/curated\.has\(r\.npc_id\) \|\| isEventNpcId\(r\.npc_id\)/);
      expect(code).toMatch(/from '(\.|@\/lib)\/eventNpcIds'/);
    }
  });
});
