// The traps layer of GET /api/agent/zone-spawns (utils/trapSpawns.js; the guild lead, 2026-10-23: "maps should show
// traps as well"). Runs the SHIPPED module against the cap fake.
//
// The Plane of Earth fixture is the server's own script text (SecretsOTheP/quests poeartha/encounters/Traps.lua,
// trimmed to the table) and the catalog's own NPC names, so the mapping under test is what the server does, not what a
// guide says. Mutation-checked: dropping the `bodytype` gate turns the mantrap test red; reading the ladder's ids in
// the wrong order turns the "which is the named" test red.
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { BOT_INDEX } from './_source-slice.js';
import { makeCapFake } from './_cap_fake_supabase.js';

const nodeRequire = createRequire(BOT_INDEX);
const ts = nodeRequire('./utils/trapSpawns');
const zs = nodeRequire('./utils/zoneSpawns');

// poeartha/encounters/Traps.lua, the table only (comments are the server's).
const POEARTH_LUA = `
local TRAP_SPAWNS = {
	[218341] = { 218348, 218351, 218006 }, -- TrapMan1, A Needlescale Hatchling, A Prismatic Basilisk, A_Needlescale_Basilisk
	[218403] = { 218344, 218386, 218001 }, -- TrapMan6, A Glass Formation, A Shimmering Gem Sentry, A_Majestic_Gemwalker
	[218404] = { 218346, 218385, 218034 }, -- TrapMan7, A Gemmed Rock Man, A Perfect Rock Formation, A_Gemmed_Protector
	[218410] = { 218417, 218417, 218417 }, -- TrapMan13, A Decaying Spelunker
};

local counters = {};
function TrapCombat(e) end
`;
const VEXTHAL_LUA = `
local TYPES = {
	[158467] = {		-- weak shade warriors
		158008, -- #Qua_Centien_Xakra
		158122, -- #Zov_Centien_Xakra
		158088, -- #Zun_Centien_Xakra
	},
	[158468] = { 158032, 158116 },
};
local SPAWN_CHANCE = { [158467] = { 90, 10 } };
`;
const GRIEG_LUA = `
local FAKE_SENDING = 163002;
local TYPES = {
	[163062] = {	 -- A_Dark_Visage
		163390, -- A_Creeping_Visage
	},
};
local SPAWN_CHANCE = { [163062] = { 100 } };
local EMOTE_TRAP_TYPES = { [163383] = 1, [163125] = 1 };
`;

describe('parseTrapTable', () => {
  it('reads the Plane of Earth ladder: the trap, the named, the placeholder, in that order', () => {
    const t = ts.parseTrapTable(POEARTH_LUA);
    expect(t.name).toBe('TRAP_SPAWNS');
    expect([...t.entries.keys()]).toEqual([218341, 218403, 218404, 218410]);
    expect(t.entries.get(218341)).toEqual([218348, 218351, 218006]);
  });

  it('does not read ids out of the comments', () => {
    const t = ts.parseTrapTable('local TYPES = {\n  [1] = { 2 }, -- 99999, 88888\n}');
    expect(t.entries.get(1)).toEqual([2]);
  });

  it('reads a TYPES table and ignores the odds table beside it', () => {
    const t = ts.parseTrapTable(VEXTHAL_LUA);
    expect(t.name).toBe('TYPES');
    expect(t.entries.get(158467)).toEqual([158008, 158122, 158088]);
    expect(t.entries.size).toBe(2);
  });

  it('skips the Griegs End emote-only traps (a flag, not a list) and a flat id list', () => {
    expect([...ts.parseTrapTable(GRIEG_LUA).entries.keys()]).toEqual([163062]);
    expect(ts.parseTrapTable('local TYPES = { 216255, 216252, 216250 };\nfunction MobSpawn(e) end')).toBeNull();
    expect(ts.parseTrapTable('function event_say(e) end')).toBeNull();
    expect(ts.parseTrapTable(null)).toBeNull();
  });
});

describe('isTrapHelper', () => {
  const helper = (name, extra = {}) => ({ id: 1, name, bodytype: 67, ...extra });
  it('takes a trap-named helper', () => {
    for (const n of ['TrapMan3', 'an_inactive_trap', 'AirTrapSpawner', 'Fungi_Trap', 'TRAP_PH', '#TrapMan']) {
      expect(ts.isTrapHelper(helper(n), null), n).toBe(true);
    }
  });
  it('takes a helper the zone script lists, whatever it is called', () => {
    const table = { entries: new Map([[158467, [1]]]) };
    expect(ts.isTrapHelper(helper('_', { id: 158467 }), table)).toBe(true);
    expect(ts.isTrapHelper(helper('_', { id: 158468 }), table)).toBe(false);
  });
  it('leaves out a fightable mantrap, a hunter and a quest NPC, whatever their names say', () => {
    expect(ts.isTrapHelper({ id: 2, name: 'Erollisi_man-trap', bodytype: 25 }, null)).toBe(false);   // body type is the first gate
    expect(ts.isTrapHelper(helper('Trapamyamu'), null)).toBe(false);
    expect(ts.isTrapHelper(helper('Trap_control'), null)).toBe(false);
    expect(ts.isTrapHelper(helper('a_trapper'), null)).toBe(false);
    expect(ts.isTrapHelper(helper('Plain_Emote'), null)).toBe(false);
  });
});

describe('trapRowWords / tableRow (zone/trap.h effect values)', () => {
  const names = { spell: new Map([[2902, 'Shissar Broodling Poison']]), npc: new Map([[123015, 'a_Chetari_Deathshaper']]) };
  const row = (o) => ({ id: 1, x: 10, y: 20, z: 30, chance: 100, maxzdiff: 20, radius: 50, effect: 0, effectvalue: 0, effectvalue2: 0,
    message: '', level: 60, respawn_time: 600, undetectable: 0, ...o });

  it('a spell trap names its spell', () => {
    const r = ts.tableRow(row({ effect: 0, effectvalue: 2902 }), names);
    expect(r.fx).toBe('spell');
    expect(r.title).toBe('Trap: Shissar Broodling Poison');
    expect(r.text).toMatch(/Casts Shissar Broodling Poison on whoever sets it off\./);
    expect(r.text).toMatch(/every time within 50 \(±20 high\)/);
    expect(r.text).toMatch(/Level 60\. Re-arms after 10 min\./);
  });
  it('a spell id the catalog does not know still says something', () => {
    expect(ts.tableRow(row({ effectvalue: 77777 }), names).title).toBe('Trap: spell 77777');
  });
  it('spell 0 is flavour text only', () => {
    const r = ts.tableRow(row({ effectvalue: 0, message: 'a trap being to glow' }), names);
    expect(r.text).toMatch(/Only prints its message/);
    expect(r.text).toMatch(/“a trap being to glow”/);
  });
  it('alarm, spawn and damage', () => {
    expect(ts.tableRow(row({ effect: 1, effectvalue2: 300 }), names).text).toMatch(/pulls mobs within 300/);
    const sp = ts.tableRow(row({ effect: 2, effectvalue: 123015, effectvalue2: 1 }), names);
    expect(sp.fx).toBe('spawn');
    expect(sp.title).toBe('Spawn trap: a Chetari Deathshaper');
    expect(ts.tableRow(row({ effect: 3, effectvalue: 123015, effectvalue2: 3 }), names).text).toMatch(/Spawns 3 × a Chetari Deathshaper/);
    expect(ts.tableRow(row({ effect: 4, effectvalue: 75, effectvalue2: 300 }), names).text).toMatch(/Hits for 75–300/);
  });
  it('says how often it sets off, and flags an undetectable one', () => {
    const r = ts.tableRow(row({ chance: 25, undetectable: 1 }), names);
    expect(r.text).toMatch(/25% of the time/);
    expect(r.text).toMatch(/Undetectable: Sense Traps will not find it\./);
    expect(r.hid).toBe(true);
    expect(ts.tableRow(row({ undetectable: 0 }), names).hid).toBe(false);
  });
  it('keeps the position and the radius the Map draws with', () => {
    const r = ts.tableRow(row({ x: -604, y: -505, z: -237, radius: 40, maxzdiff: 15 }), names);
    expect([r.x, r.y, r.z, r.r, r.mz]).toEqual([-604, -505, -237, 40, 15]);
  });
});

// ── through the real zone-spawns build ──────────────────────────────────────────────────────────────────────
const npc = (id, name, extra = {}) => ({
  id, name, level: 60, raid_target: false, see_invis: false, see_invis_undead: false, see_hide: false,
  see_improved_hide: false, special_abilities: null, npcspecialattks: null, aggroradius: 0, assistradius: 0, npc_faction_id: 0, bodytype: 21, ...extra,
});
const sp = (id, group, zone, extra = {}) => ({ id, spawngroup_id: group, zone_short: zone, x: id, y: -id, z: 3, respawntime: 600, variance: 0, enabled: true, ...extra });
const se = (group, npc_id) => ({ spawngroup_id: group, npc_id, chance: 100 });

function world() {
  return {
    eqemu_zone: [{ short_name: 'poeartha', long_name: 'Plane of Earth' }, { short_name: 'necropolis', long_name: 'Necropolis' },
      { short_name: 'quiet', long_name: 'Quiet' }],
    eqemu_spawn2: [
      sp(1, 10, 'poeartha'), sp(2, 10, 'poeartha'), sp(3, 11, 'poeartha'), sp(4, 12, 'poeartha'), sp(5, 13, 'poeartha'),
      sp(6, 14, 'poeartha'),                       // an ordinary mob in the same zone
      sp(20, 20, 'necropolis'), sp(21, 21, 'necropolis'), sp(22, 22, 'necropolis'),
      sp(30, 30, 'quiet'),
    ],
    eqemu_spawnentry: [se(10, 218341), se(11, 218403), se(12, 218404), se(13, 218410), se(14, 1001), se(20, 123120), se(21, 94236), se(22, 155335), se(30, 1001)],
    eqemu_npc_types: [
      npc(218341, 'TrapMan1', { bodytype: 67, aggroradius: 50, level: 1 }),
      npc(218403, 'TrapMan6', { bodytype: 67, aggroradius: 50, level: 1 }),
      npc(218404, 'TrapMan7', { bodytype: 67, aggroradius: 50, level: 1 }),
      npc(218410, 'TrapMan13', { bodytype: 67, aggroradius: 50, level: 1 }),
      npc(1001, 'a_stone_golem'),
      npc(218348, 'A_Needlescale_Hatchling'), npc(218351, 'A_Prismatic_Basilisk', { level: 69 }), npc(218006, 'A_Needlescale_Basilisk', { level: 64 }),
      npc(218344, 'A_Glass_Formation'), npc(218386, 'A_Shimmering_Gem_Sentry', { level: 69 }), npc(218001, 'A_Majestic_Gemwalker', { level: 64 }),
      npc(218346, 'A_Gemmed_Rock_Man'), npc(218385, 'A_Perfect_Rock_Formation', { level: 69 }), npc(218034, 'A_Gemmed_Protector', { level: 64 }),
      npc(218417, 'A_Decaying_Spelunker', { level: 64 }),
      npc(123120, 'an_inactive_trap', { bodytype: 66, aggroradius: 0 }),
      npc(94236, 'Erollisi_mantrap', { bodytype: 25 }),              // a plant you fight
      npc(155335, 'Trapamyamu', { bodytype: 67 }),                   // a quest NPC with trap in its name
    ],
    eqemu_quest_scripts: [
      { path: 'poeartha/encounters/Traps.lua', zone_short: 'poeartha', body: POEARTH_LUA },
      { path: 'poeartha/Other.lua', zone_short: 'poeartha', body: 'local TYPES = { [1] = { 2 } }' },
    ],
    eqemu_traps: [
      { id: 19, zone: 'necropolis', x: -604, y: -505, z: -237, chance: 100, maxzdiff: 20, radius: 50, effect: 4, effectvalue: 75, effectvalue2: 300,
        message: '', level: 60, respawn_time: 1200, undetectable: 1 },
      { id: 867, zone: 'ssratemple', x: 488, y: -299, z: 140, chance: 100, maxzdiff: 20, radius: 50, effect: 0, effectvalue: 2902, effectvalue2: 0,
        message: '', level: 60, respawn_time: 600, undetectable: 0 },
    ],
    eqemu_spells: [{ id: 2902, name: 'Shissar Broodling Poison' }],
  };
}

let tables, fake;
beforeEach(() => {
  zs._resetCache();
  tables = world();
  fake = makeCapFake({ tables });
});

const bodyOf = async (zone, f = fake) => {
  const r = await zs.getZoneSpawns(f, zone, []);
  expect(r.status).toBe(200);
  return JSON.parse(r.body);
};

describe('Plane of Earth, from the server script', () => {
  it('marks every trap spot and nothing else', async () => {
    const b = await bodyOf('poeartha');
    const spots = b.points.filter(p => p.trap != null).map(p => [p.id, p.trap]);
    expect(spots).toEqual([[1, 218341], [2, 218341], [3, 218403], [4, 218404], [5, 218410]]);
    expect(b.points.find(p => p.id === 6).trap).toBeUndefined();
  });

  it('says which is the named and which is the placeholder, in the script\'s order', async () => {
    const d = (await bodyOf('poeartha')).traps.defs;
    expect(d[218341].title).toBe('Trap spot: A Needlescale Hatchling → A Prismatic Basilisk');
    expect(d[218341].text).toMatch(/spawns A Needlescale Hatchling \(60\)/);
    expect(d[218341].text).toMatch(/the named A Prismatic Basilisk \(69\), or its placeholder A Needlescale Basilisk \(64\)/);
    // The two the eqprogression guide pairs differently: the script rules.
    expect(d[218403].text).toMatch(/named A Shimmering Gem Sentry \(69\), or its placeholder A Majestic Gemwalker/);
    expect(d[218404].text).toMatch(/named A Perfect Rock Formation \(69\), or its placeholder A Gemmed Protector/);
  });

  it('gives each ladder type its own colour slot, stable across zone-ins, and the named\'s initial', async () => {
    const d = (await bodyOf('poeartha')).traps.defs;
    expect([d[218341].grp, d[218403].grp, d[218404].grp]).toEqual([1, 2, 3]);
    expect([d[218341].ch, d[218403].ch, d[218404].ch]).toEqual(['P', 'S', 'P']);
    expect(d[218341].r).toBe(50);
  });

  it('the skeleton trap spawns one thing and says so', async () => {
    const d = (await bodyOf('poeartha')).traps.defs[218410];
    expect(d.grp).toBe(0);
    expect(d.title).toBe('Trap spot: A Decaying Spelunker');
    expect(d.text).toMatch(/does not trigger every time/);
  });

  it('a zone with no trap helpers gets no traps key and no trap on its points', async () => {
    const b = await bodyOf('quiet');
    expect('traps' in b).toBe(false);
    expect(b.points.every(p => p.trap === undefined)).toBe(true);
  });
});

describe('trap-named helpers with no script, and the traps table', () => {
  it('draws a name-only trap helper with its own name, and refuses a fightable mantrap and a quest NPC', async () => {
    const b = await bodyOf('necropolis');
    expect(b.points.filter(p => p.trap != null).map(p => p.id)).toEqual([20]);
    expect(b.traps.defs[123120]).toMatchObject({ k: 'marker', title: 'an inactive trap', grp: 0 });
  });

  it('sends the zone\'s traps-table rows with their words', async () => {
    const t = (await bodyOf('necropolis')).traps.table;
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ id: 19, x: -604, y: -505, z: -237, r: 50, fx: 'damage', hid: true, title: 'Damage trap' });
    expect(t[0].text).toMatch(/Hits for 75–300/);
  });

  it('a zone whose spawns are all ordinary mobs still gets its table rows when the table has them', async () => {
    tables.eqemu_spawn2.push(sp(40, 40, 'ssratemple'));
    tables.eqemu_spawnentry.push(se(40, 1001));
    tables.eqemu_zone.push({ short_name: 'ssratemple', long_name: 'Ssraeshza Temple' });
    const t = (await bodyOf('ssratemple')).traps;
    expect(t.defs).toEqual({});
    expect(t.table[0].title).toBe('Trap: Shissar Broodling Poison');
  });

  it('survives the traps table and the scripts being unreadable: the map still answers, without traps', async () => {
    fake = makeCapFake({ tables, missing: ['eqemu_traps', 'eqemu_quest_scripts', 'eqemu_spells'] });
    const b = await bodyOf('necropolis', fake);
    expect(b.points.length).toBeGreaterThan(0);
    expect(b.traps.table).toEqual([]);
    expect(b.traps.defs[123120]).toBeDefined();   // the name rule needs no script
    const e = await bodyOf('poeartha', fake);
    // Without the script the spots are still there (they are named for traps), just without the named / placeholder words.
    expect(e.points.filter(p => p.trap != null)).toHaveLength(5);
    expect(e.traps.defs[218341]).toMatchObject({ k: 'marker', title: 'TrapMan1' });
  });
});
