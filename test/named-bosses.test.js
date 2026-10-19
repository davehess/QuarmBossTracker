// test/named-bosses.test.js — the curated PoP raid-boss list that fills in eqemu_npc_types.raid_target.
//
// The guild lead, 2026-10-18 (raid night): "The named bosses in Halls of Honor can be listed, same with the other
// major named bosses in the zones". The catalog has raid_target = false for Advocent Joran (211084), Freegan Haun
// (211085), Halgoz Rellinic (211086) and nearly every other PoP boss, and the weekly mirror sync overwrites the
// table, so the bot ORs data/named-bosses.json into every raid_target it serves (utils/namedBosses.js).
//
// Runs the real module, the real _buildMobInfo (sliced out of index.js, the way mobinfo-procs.test.js does) and
// the real zone-spawns build against a fake database.
//
// Mutation-checked (2026-10-19): `namedBosses.raidTarget(r)` back to `!!r.raid_target` in _buildMobInfo turns the
// mob-info tests red; the same in utils/zoneSpawns.js turns the zone-spawns test red; deleting Joran from the
// JSON turns the list tests red.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, BOT_INDEX } from './_source-slice.js';
import { makeCapFake } from './_cap_fake_supabase.js';

const nodeRequire = createRequire(BOT_INDEX);
const nb = nodeRequire('./utils/namedBosses');
const zs = nodeRequire('./utils/zoneSpawns');
const list = nodeRequire('./data/named-bosses.json');

describe('the curated list', () => {
  it('names the three Halls of Honor trial 3 bosses, Rydda`Dar and the Temple of Marr four', () => {
    const names = (z) => list.zones[z].bosses.map(b => b.name).sort();
    expect(names('hohonora')).toEqual(['Advocent Joran', 'Freegan Haun', 'Halgoz Rellinic', 'Rydda`Dar']);
    expect(names('hohonorb')).toEqual(['Edium, Guardian of Marr', 'Halon of Marr', 'Lord Mithaniel Marr', 'Ralthazor, Champion of Marr']);
  });

  it('every boss sits in the zone its id belongs to, and no id repeats', () => {
    const seen = new Set();
    for (const [short, z] of Object.entries(list.zones)) {
      for (const b of z.bosses) {
        expect(Math.floor(b.id / 1000), `${short} / ${b.name}`).toBe(z.zoneId);
        expect(seen.has(b.id), `${b.id} listed twice`).toBe(false);
        seen.add(b.id);
      }
    }
  });
});

describe('isNamedBoss / raidTarget', () => {
  it('Joran, Haun and Rellinic are raid targets although the catalog says false', () => {
    for (const [id, name] of [[211084, 'Advocent_Joran'], [211085, 'Freegan_Haun'], [211086, 'Halgoz_Rellinic']]) {
      expect(nb.raidTarget({ id, name, raid_target: false }), name).toBe(true);
    }
  });
  it('a trash mob in the same zone stays false', () => {
    expect(nb.raidTarget({ id: 211002, name: 'Hero_Shrine_Guardian', raid_target: false })).toBe(false);
    expect(nb.raidTarget({ id: 211105, name: 'Granmuck_Reiga', raid_target: false })).toBe(false);   // a trial 2 villager attacker
  });
  it('the catalog flag still wins on its own', () => {
    expect(nb.raidTarget({ id: 1234, name: 'a_thing', raid_target: true })).toBe(true);
    expect(nb.raidTarget({ id: 1234, name: 'a_thing', raid_target: false })).toBe(false);
    expect(nb.raidTarget(null)).toBe(false);
  });
  it('a second body of a listed name in the same zone matches, the same name in another zone does not', () => {
    expect(nb.isNamedBoss({ id: 214313, name: 'Tallon_Zek' })).toBe(true);        // listed id is 214026
    expect(nb.isNamedBoss({ id: 212026, name: 'Rizlona' })).toBe(true);           // listed id is the #Rizlona dragon
    expect(nb.isNamedBoss({ id: 99042, name: 'Advocent_Joran' })).toBe(false);    // not Halls of Honor
  });
  it('spellings with a # prefix, underscores or a quote all read as one name', () => {
    expect(nb.isNamedBoss({ id: 208999, name: '#Aerin\'Dar' })).toBe(true);
    expect(nb.isNamedBoss({ id: 221999, name: 'Terris Thule' })).toBe(true);
  });
});

describe('mob-info serves it', () => {
  const SRC = readSource(BOT_INDEX);
  const slice = sliceBlock(SRC, 'async function _buildMobInfo(supabase, {', '\n  return mob;\n}');
  const helpers = [
    sliceBlock(SRC, 'function _mobCaseKey(n) {', '\n}'),
    sliceBlock(SRC, 'function _mobRowsForCase(rows, caseKey) {', '\n}'),
  ].join('\n');
  const GENDER = "const _GENDER_NAMES = { 0: 'male', 1: 'female', 2: 'neuter' };";
  const CLASSES = "const _MOB_CLASS_NAMES = { 1:'Warrior', 12:'Wizard' };";
  const body = (id, name, hp) => ({
    id, name, class: 12, level: 70, maxlevel: 70, hp, mana: 0, ac: 10, mr: 0, fr: 0, cr: 0, pr: 0, dr: 0,
    mindmg: 1, maxdmg: 2, runspeed: 1.25, npcspecialattks: '', special_abilities: '', raid_target: false,
    bodytype: 1, npc_spells_id: 0, see_invis: false, see_invis_undead: false, see_hide: false, see_improved_hide: false, race: 1, gender: 0,
  });
  const bodies = [body(211084, 'Advocent_Joran', 115000), body(211002, 'Hero_Shrine_Guardian', 22100)];
  const sb = {
    select: async (table, q) => {
      if (table !== 'eqemu_npc_types') return [];
      const want = decodeURIComponent(q.slice('or=(name.ilike.'.length, q.indexOf(',name.ilike')));
      return bodies.filter(b => b.name.toLowerCase() === want.toLowerCase());
    },
  };
  const build = new Function('mobSpecials', 'factionAssist', '_factionRowsFor', 'npcProcs', 'namedBosses', 'process', 'console',
    `${helpers}\n${GENDER}\n${CLASSES}\n${slice}\nreturn _buildMobInfo;`)(
    nodeRequire('./utils/mobSpecials.js'), { getIndex: async () => null, assistFor: () => null }, async () => null,
    nodeRequire('./utils/npcProcs.js'), nb, process, { log() {}, warn() {} });
  const ask = (name) => build(sb, { name, norm: name.toLowerCase(), caseKey: name, reqZoneId: 211, reqGender: null });

  it('Advocent Joran comes back raid_target true', async () => {
    const mob = await ask('Advocent_Joran');
    expect(mob.id).toBe(211084);
    expect(mob.raid_target).toBe(true);
  });
  it('a trash mob in the same zone comes back false', async () => {
    expect((await ask('Hero_Shrine_Guardian')).raid_target).toBe(false);
  });
  it('the zone-pack shape is bumped so packs built without the list rebuild', () => {
    expect(stripJs(SRC)).toMatch(/const _MOB_PACK_VERSION = 9;/);
  });
});

describe('zone-spawns serves it', () => {
  it('Joran is a raid target and named on the map; the trash beside him is neither', async () => {
    const npc = (id, name) => ({
      id, name, level: 70, raid_target: false, see_invis: false, see_invis_undead: false, see_hide: false,
      see_improved_hide: false, special_abilities: null, npcspecialattks: null, aggroradius: 70, assistradius: 0, npc_faction_id: 0,
    });
    const fake = makeCapFake({ tables: {
      eqemu_zone: [{ short_name: 'hohonora', long_name: 'Halls of Honor' }],
      eqemu_spawn2: [
        { id: 1, spawngroup_id: 10, zone_short: 'hohonora', x: 1, y: 1, z: 1, respawntime: 600, variance: 0, enabled: true, pathgrid: 0 },
        { id: 2, spawngroup_id: 11, zone_short: 'hohonora', x: 2, y: 2, z: 2, respawntime: 600, variance: 0, enabled: true, pathgrid: 0 },
      ],
      eqemu_spawngroup: [],
      eqemu_spawnentry: [{ spawngroup_id: 10, npc_id: 211084, chance: 100 }, { spawngroup_id: 11, npc_id: 211002, chance: 100 }],
      eqemu_npc_types: [npc(211084, 'Advocent_Joran'), npc(211002, 'Hero_Shrine_Guardian')],
    } });
    const inner = fake.select;
    fake.select = async (table, qs = '') => {
      const rows = await inner(table, qs);
      const m = /(?:^|&)select=([^&]+)/.exec(qs);
      if (!Array.isArray(rows) || !m || m[1] === '*') return rows;
      const cols = decodeURIComponent(m[1]).split(',');
      return rows.map(r => Object.fromEntries(cols.filter(c => c in r).map(c => [c, r[c]])));
    };
    zs._resetCache();
    const r = await zs.getZoneSpawns(fake, 'hohonora', []);
    expect(r.status).toBe(200);
    const mobs = JSON.parse(r.body).points.flatMap(p => p.npcs);
    const joran = mobs.find(n => n.name === 'Advocent Joran');
    const guard = mobs.find(n => n.name === 'Hero Shrine Guardian');
    expect(joran.raid_target).toBe(true);
    expect(joran.named).toBe(true);
    expect(guard.raid_target).toBe(false);
    expect(guard.named).toBe(false);
  });
});
