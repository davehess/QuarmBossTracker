// Mobs that split on death: utils/splitSpawns.js and the `splits` field it adds to GET /api/agent/zone-spawns (the guild
// lead, 2026-11-01: "some of these mobs split, we should denote it"). Runs the SHIPPED modules against the cap fake.
//
// The Lua fixtures are the server's own death handlers (SecretsOTheP/quests, as mirrored in eqemu_quest_scripts), trimmed
// to the handler, so the syntax under test is what the server writes. Catalog NPC names are the catalog's own.
// Mutation-checked: making `own()` accept any numeric x/y turns the fixed-coordinate test red; dropping the implicit
// "no spawn" alternative from `chain()` turns the "incarnate" min test red.
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { BOT_INDEX } from './_source-slice.js';
import { makeCapFake } from './_cap_fake_supabase.js';

const nodeRequire = createRequire(BOT_INDEX);
const ss = nodeRequire('./utils/splitSpawns');
const zs = nodeRequire('./utils/zoneSpawns');

// poair/A_Phoenix_Breezewing.lua — a loop, 2..4 = three
const BREEZEWING = `
function event_death_complete(e)
	for i = 2, 4 do
		eq.spawn2(215412, 0, 0, e.self:GetX(), e.self:GetY(), e.self:GetZ(), 0); -- A_Phoenix_Gustlet
	end
end
`;
// hohonora/A_Rabid_Wrulon.lua — position kept in locals
const WRULON = `
function event_death_complete(e)
	local x, y, z, h = e.self:GetX(), e.self:GetY(), e.self:GetZ(), e.self:GetHeading();
	eq.spawn2(211080, 0, 0, x, y, z, h); -- A_Rabid_Wrulon_Pup
	eq.spawn2(211080, 0, 0, x, y, z, h); -- A_Rabid_Wrulon_Pup
end
`;
// skyshrine/a_shambling_cube.lua — two ids, one per branch, offsets from the spot
const CUBE = `
function event_death_complete(e)
	if(e.self:GetLevel() < 43) then
		eq.spawn2(114001,0,0,e.self:GetX()+5,e.self:GetY(),e.self:GetZ(),0);
		eq.spawn2(114001,0,0,e.self:GetX()-5,e.self:GetY(),e.self:GetZ(),0);
	else
		eq.spawn2(114000,0,0,e.self:GetX()+5,e.self:GetY(),e.self:GetZ(),0);
		eq.spawn2(114000,0,0,e.self:GetX()-5,e.self:GetY(),e.self:GetZ(),0);
	end
end
`;
// poair/A_Castellan_of_Air.lua — a constant for the id, a 5% roll, then a random-sized loop
const CASTELLAN = `
local INLOKHER_TYPE = 215395; -- Inlokher
local CONTROLLER_TYPE = 215419;
function event_death_complete(e)
	eq.signal(CONTROLLER_TYPE, 1);
	local roll = math.random(100);
	if ( roll < 6 and not eq.get_entity_list():IsMobSpawnedByNpcTypeID(INLOKHER_TYPE) ) then
		eq.spawn2(INLOKHER_TYPE, 0, 0, e.self:GetX(), e.self:GetY(), e.self:GetZ(), 0);
	end
	roll = math.random(1, 4);
	for i = 1, roll do
		eq.spawn2(215413, 0, 0, e.self:GetX(), e.self:GetY(), e.self:GetZ(), 0); -- A_Vengeful_Airspirit
	end
end
`;
// soltemple/an_incarnate.lua — which = 1: one, 2: two, 3: nothing
const INCARNATE = `
function event_death_complete(e)
	local which = math.random(3);
	if (which == 1) then
		eq.spawn2(80005, 0, 0, e.self:GetX(), e.self:GetY(), e.self:GetZ(), e.self:GetHeading());
	elseif (which == 2) then
		eq.spawn2(80005, 0, 0, e.self:GetX(), e.self:GetY(), e.self:GetZ(), e.self:GetHeading());
		eq.spawn2(80005, 0, 0, e.self:GetX(), e.self:GetY(), e.self:GetZ(), e.self:GetHeading());
	end
end
`;
// akanon/Clockwork_MX.lua — two sibling ifs on one roll that cover it: one or two, never none
const CLOCKWORK = `
function event_death_complete(e)
	local rand = math.random(2);
	if(rand == 1) then
		eq.spawn2(55392,0,0,e.self:GetX(),e.self:GetY(),e.self:GetZ(),e.self:GetHeading());
	end
	if(rand == 2) then
		eq.spawn2(55392,0,0,e.self:GetX(),e.self:GetY(),e.self:GetZ(),e.self:GetHeading());
		eq.spawn2(55392,0,0,e.self:GetX()+1,e.self:GetY()+1,e.self:GetZ(),e.self:GetHeading());
	end
end
`;
// solrotower/Xuzl.lua shape — the death brings up named and adds at FIXED places: not a split
const SOLRO = `
function event_death_complete(e)
	eq.spawn2(212410, 0, 0, 1780, -336, 339, 0);
	eq.spawn2(212415, 0, 0, 1837, -1040, 297, 128);
end
`;

const byId = (r) => Object.fromEntries(r.map(x => [x.id, x]));

describe('parseDeathSplits', () => {
  it('counts a loop of 2..4 as three, spawned at the dead mob\'s own spot', () => {
    expect(ss.parseDeathSplits(BREEZEWING)).toEqual([{ id: 215412, min: 3, max: 3, unique: false }]);
  });

  it('follows x / y / z held in locals bound to GetX / GetY', () => {
    expect(ss.parseDeathSplits(WRULON)).toEqual([{ id: 211080, min: 2, max: 2, unique: false }]);
  });

  it('counts each id on its own, across if / else branches, with offsets from the spot', () => {
    const r = byId(ss.parseDeathSplits(CUBE));
    // one branch or the other ever runs: two of 114001, or two of 114000 (so each id is 0..2)
    expect(r[114001]).toMatchObject({ min: 0, max: 2 });
    expect(r[114000]).toMatchObject({ min: 0, max: 2 });
  });

  it('reads a loop bound from math.random, a constant id, and a chance branch (min 0)', () => {
    const r = byId(ss.parseDeathSplits(CASTELLAN));
    expect(r[215413]).toMatchObject({ min: 1, max: 4 });   // for i = 1, roll with roll = math.random(1, 4)
    expect(r[215395]).toMatchObject({ min: 0, max: 1 });   // INLOKHER_TYPE on a roll under 6
  });

  it('an if-chain that does not cover every roll can spawn nothing (min 0)', () => {
    expect(ss.parseDeathSplits(INCARNATE)).toEqual([{ id: 80005, min: 0, max: 2, unique: false }]);
  });

  it('sibling ifs on one roll that cover it are one chain: one or two, never none', () => {
    expect(ss.parseDeathSplits(CLOCKWORK)).toEqual([{ id: 55392, min: 1, max: 2, unique: false }]);
  });

  it('FIXED coordinates are not a split', () => {
    expect(ss.parseDeathSplits(SOLRO)).toEqual([]);
  });

  it('a spawn from another event, or a comment, or a string, is not a death split', () => {
    const lua = `
      function event_spawn(e) eq.spawn2(1, 0, 0, e.self:GetX(), e.self:GetY(), 0, 0); end
      function event_death_complete(e)
        -- eq.spawn2(2, 0, 0, e.self:GetX(), e.self:GetY(), 0, 0)
        e.self:Say("eq.spawn2(3, 0, 0, e.self:GetX(), e.self:GetY(), 0, 0) end");
      end`;
    expect(ss.parseDeathSplits(lua)).toEqual([]);
  });

  it('a spawn at the KILLER\'s spot, or at the home spot, is not the dead mob\'s own', () => {
    const lua = `function event_death_complete(e)
      eq.spawn2(1, 0, 0, e.other:GetX(), e.other:GetY(), 0, 0);
      eq.spawn2(2, 0, 0, e.self:GetSpawnPointX(), e.self:GetSpawnPointY(), 0, 0);
    end`;
    expect(ss.parseDeathSplits(lua)).toEqual([]);
  });

  it('a count it cannot read is { min: 1, max: null }, never a guess', () => {
    const loopVar = `function event_death_complete(e)
      for i = 1, how_many do eq.spawn2(7, 0, 0, e.self:GetX(), e.self:GetY(), 0, 0); end
    end`;
    const whileLoop = `function event_death_complete(e)
      while keep_going() do eq.spawn2(7, 0, 0, e.self:GetX(), e.self:GetY(), 0, 0); end
    end`;
    expect(ss.parseDeathSplits(loopVar)).toEqual([{ id: 7, min: 1, max: null, unique: false }]);
    expect(ss.parseDeathSplits(whileLoop)).toEqual([{ id: 7, min: 1, max: null, unique: false }]);
  });

  it('marks unique_spawn, and skips an id it cannot name', () => {
    const lua = `function event_death_complete(e)
      eq.unique_spawn(200232, 0, 0, e.self:GetX(), e.self:GetY(), e.self:GetZ(), 0);
      eq.spawn2(which_one, 0, 0, e.self:GetX(), e.self:GetY(), e.self:GetZ(), 0);
    end`;
    expect(ss.parseDeathSplits(lua)).toEqual([{ id: 200232, min: 1, max: 1, unique: true }]);
  });

  it('answers [] for nothing, garbage, and a script with no death handler', () => {
    for (const v of [null, '', 'function (((', 'function event_say(e) end']) expect(ss.parseDeathSplits(v)).toEqual([]);
  });
});

describe('keys', () => {
  it('a script named for an id, and for an NPC (case, punctuation and the # kept apart)', () => {
    expect(ss.keyOfPath('potactics/214316.lua')).toBe('id:214316');
    expect(ss.keyOfPath('poair/A_Phoenix_Breezewing.lua')).toBe('name:a_phoenix_breezewing');
    expect(ss.keyOfPath('necropolis/#Garzicor-s_Corpse.lua')).toBe('name:#garzicors_corpse');
    expect(ss.nameKey('#Garzicor`s_Corpse')).toBe('name:#garzicors_corpse');
    expect(ss.keyOfPath('solrotower/Rizlona.lua')).not.toBe(ss.keyOfPath('solrotower/#Rizlona.lua'));
  });
});

// ── build() and the zone-spawns row ──────────────────────────────────────────
const npc = (id, name, extra = {}) => ({
  id, name, level: 50, raid_target: false, see_invis: false, see_invis_undead: false, see_hide: false,
  see_improved_hide: false, special_abilities: null, npcspecialattks: null, aggroradius: 70, assistradius: 0, npc_faction_id: 0, ...extra,
});
const script = (zone, file, body) => ({ path: `${zone}/${file}`, zone_short: zone, npc_name: file.replace(/\.lua$/, ''), is_encounter: false, body });

function world() {
  return {
    eqemu_zone: [{ short_name: 'splitzone', long_name: 'The Split Zone' }],
    eqemu_spawn2: [
      { id: 1, spawngroup_id: 10, zone_short: 'splitzone', x: 10, y: 10, z: 1, respawntime: 600, variance: 0, enabled: true },
      { id: 2, spawngroup_id: 11, zone_short: 'splitzone', x: 20, y: 20, z: 1, respawntime: 600, variance: 0, enabled: true },
      { id: 3, spawngroup_id: 12, zone_short: 'splitzone', x: 30, y: 30, z: 1, respawntime: 600, variance: 0, enabled: true },
    ],
    eqemu_spawnentry: [
      { spawngroup_id: 10, npc_id: 215411, chance: 100 },
      { spawngroup_id: 11, npc_id: 1002, chance: 100 },
      { spawngroup_id: 12, npc_id: 1003, chance: 100 },
    ],
    eqemu_npc_types: [
      npc(215411, 'A_Phoenix_Breezewing'), npc(215412, 'A_Phoenix_Gustlet'),
      npc(1002, 'a_stone_golem'), npc(1003, 'Xuzl'), npc(1004, '#Fixed_Add'),
    ],
    eqemu_quest_scripts: [
      script('splitzone', 'A_Phoenix_Breezewing.lua', BREEZEWING),
      script('splitzone', 'Xuzl.lua', SOLRO),
      script('splitzone', 'a_stone_golem.lua', 'function event_say(e) end'),
      // another zone's script, and an encounter script, must not be read
      script('otherzone', 'a_stone_golem.lua', WRULON.replaceAll('211080', '1004')),
      { ...script('splitzone', 'encounters/Fight.lua', WRULON.replaceAll('211080', '1004')), is_encounter: true },
    ],
  };
}

// The shared fake's ilike turns `*` into `.`, which stops at a newline; a Lua body is many lines and PostgREST's ilike
// is not. So this wrapper applies the `body=ilike.*event_death*` filter itself (on the whole body) and hands the rest of
// the query on, keeping the original query string in `calls` for the assertions below.
function fakeWith(opts) {
  const inner = makeCapFake(opts);
  const select = inner.select;
  inner.select = async (table, qs = '') => {
    const rows = await select(table, String(qs).replace(/&?body=ilike\.[^&]*/, ''));
    if (Array.isArray(rows) && table === 'eqemu_quest_scripts' && /body=ilike\./.test(qs)) {
      const want = decodeURIComponent(/body=ilike\.([^&]*)/.exec(qs)[1]).replace(/\*/g, '').toLowerCase();
      inner.calls[inner.calls.length - 1].qs = qs;
      return rows.filter(r => String(r.body).toLowerCase().includes(want));
    }
    return rows;
  };
  return inner;
}

let tables, fake;
beforeEach(() => {
  zs._resetCache();
  tables = world();
  fake = fakeWith({ tables });
});

describe('build', () => {
  it('maps a script to its NPC, naming what it breaks into', async () => {
    const m = await ss.build(fake, 'splitzone');
    expect([...m.keys()]).toEqual(['name:a_phoenix_breezewing']);
    expect(m.get('name:a_phoenix_breezewing')).toEqual({ into: [{ name: 'A Phoenix Gustlet', min: 3, max: 3 }] });
  });

  it('splitsFor finds an NPC row by its name, and by its id when the script is named for the id', async () => {
    tables.eqemu_quest_scripts.push(script('splitzone', '1002.lua', WRULON.replaceAll('211080', '215412')));
    const m = await ss.build(fake, 'splitzone');
    expect(ss.splitsFor(m, { id: 215411, name: 'A_Phoenix_Breezewing' }).into[0].name).toBe('A Phoenix Gustlet');
    expect(ss.splitsFor(m, { id: 1002, name: 'a_stone_golem' }).into[0]).toMatchObject({ min: 2, max: 2 });
    expect(ss.splitsFor(m, { id: 1003, name: 'Xuzl' })).toBeNull();   // a fixed-coordinate spawn
    expect(ss.splitsFor(new Map(), { id: 1, name: 'x' })).toBeNull();
  });

  it('a failed read answers an empty map and does not throw', async () => {
    const down = fakeWith({ tables, missing: ['eqemu_quest_scripts'] });
    const m = await ss.build(down, 'splitzone');
    expect(m.size).toBe(0);
    const boom = { select: async () => { throw new Error('db down'); } };
    expect((await ss.build(boom, 'splitzone')).size).toBe(0);
  });

  it('asks for only this zone\'s death scripts, and only the columns it needs', async () => {
    await ss.build(fake, 'splitzone');
    const q = fake.calls.find(c => c.table === 'eqemu_quest_scripts');
    expect(decodeURIComponent(q.qs)).toMatch(/zone_short=eq\.splitzone/);
    expect(decodeURIComponent(q.qs)).toMatch(/body=ilike\.\*event_death\*/);
    expect(decodeURIComponent(q.qs)).toMatch(/select=path,body(&|$)/);
  });

  it('an override (Vallon Zek at 50% HP) is merged in for its zone only', async () => {
    tables.eqemu_npc_types.push(npc(214317, 'Vallon_Zek'), npc(214318, 'Vallon_Zek'), npc(214319, 'Vallon_Zek'));
    const m = await ss.build(fake, 'potactics');
    const e = m.get('id:214316');
    expect(e.at).toBe('50% HP');
    expect(e.into[0]).toEqual({ name: 'Vallon Zek', min: 1, max: 1 });
    expect((await ss.build(fake, 'splitzone')).has('id:214316')).toBe(false);
  });
});

describe('the zone-spawns point row', () => {
  const get = async () => JSON.parse((await zs.getZoneSpawns(fake, 'splitzone', [])).body);

  it('a splitter carries `splits` and a `splits` badge; every other row keeps its shape', async () => {
    const b = await get();
    const rows = Object.fromEntries(b.points.flatMap(p => p.npcs).map(n => [n.name, n]));
    expect(rows['A Phoenix Breezewing'].splits).toEqual({ into: [{ name: 'A Phoenix Gustlet', min: 3, max: 3 }] });
    expect(rows['A Phoenix Breezewing'].badges).toContain('splits');
    for (const n of ['a stone golem', 'Xuzl']) {
      expect(rows[n].splits).toBeUndefined();
      expect(rows[n].badges).not.toContain('splits');
      expect(Object.keys(rows[n])).toEqual(['name', 'level', 'chance', 'named', 'raid_target', 'badges', 'aggro', 'fac', 'assist', 'pf']);
    }
  });

  it('a placeholder that brings up its named on death (unique_spawn) carries `splits` but not the badge', async () => {
    tables.eqemu_quest_scripts.push(script('splitzone', 'a_stone_golem.lua',
      'function event_death_complete(e)\n  eq.unique_spawn(1004, 0, 0, e.self:GetX(), e.self:GetY(), e.self:GetZ(), 0);\nend'));
    tables.eqemu_quest_scripts = tables.eqemu_quest_scripts.filter(s => !(s.path === 'splitzone/a_stone_golem.lua' && /event_say/.test(s.body)));
    const b = await get();
    const golem = b.points.flatMap(p => p.npcs).find(n => n.name === 'a stone golem');
    expect(golem.splits.into[0]).toMatchObject({ name: 'Fixed Add', unique: true });
    expect(golem.badges).not.toContain('splits');
  });

  // FB-114: a Planes of Power zone (eqemu_zone.expansion 4) says so, and Mimic's Map gives its kills slow mode's 18 hours.
  it('a Planes of Power zone carries slow_zone; any other zone does not', async () => {
    expect((await get()).slow_zone).toBeUndefined();
    zs._resetCache();
    tables.eqemu_zone[0].expansion = 4;
    expect((await get()).slow_zone).toBe(true);
  });

  it('a failed script read still answers the zone, with no marks', async () => {
    fake = fakeWith({ tables, missing: ['eqemu_quest_scripts'] });
    const r = await zs.getZoneSpawns(fake, 'splitzone', []);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).points.flatMap(p => p.npcs).some(n => n.splits)).toBe(false);
  });
});
