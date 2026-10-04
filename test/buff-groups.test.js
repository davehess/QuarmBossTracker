// test/buff-groups.test.js — buffs grouped by raid group (the guild lead, 2026-10-04: "we should be
// grouping people for buffs on https://wolfpack.quest/buffs — treat that like the buff queue as well").
//
// Four layers, all behaviour (a comment cannot satisfy a function call):
//   1. utils/buffGroups.js buildBuffGroups — grouping, ordering, caster rules (pure).
//   2. utils/raidBuffs.js missingLines — the per-raider gap rule, role filter included.
//   3. the keyword fixes — each new buff name lands in the category / HP slot it was added for,
//      and every GROUP_SPELLS entry categorizes into its own line.
//   4. the REAL _handleAgentRaidBuffQueue sliced out of index.js and run on fake tables: `groups`
//      only in raid mode, built from every scoped raider before the 40-row cap, raid-scoped when
//      two raids run at once.
//
// Fixture names are invented (Aldenmar, Brackwyn, Corvale ...); none is a member.
//
// Run: npx vitest run test/buff-groups.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, BOT_INDEX } from './_source-slice.js';

const require = createRequire(import.meta.url);
const rb = require('../utils/raidBuffs.js');
const bg = require('../utils/buffGroups.js');
const rangeUtil = require('../utils/range.js');
const raidGroupsUtil = require('../utils/raidGroups.js');

const member = (name, cls, group, missing = [], extra = {}) =>
  ({ name, class: cls, group, level: 65, missing, inferred: false, noSignal: false, ...extra });
const byGroup = (groups, g) => groups.find((x) => x.group === g);

// ── 1. buildBuffGroups ──────────────────────────────────────────────────────
describe('buildBuffGroups — grouping and order', () => {
  it('sorts by group number and puts the ungrouped bucket last', () => {
    const groups = bg.buildBuffGroups([
      member('Aldenmar', 'Cleric', 3),
      member('Brackwyn', 'Warrior', null),
      member('Corvale', 'Enchanter', 1),
      member('Rethlan', 'Rogue', 12),
    ]);
    expect(groups.map((g) => g.group)).toEqual([1, 3, 12, null]);
  });

  it('reads null, 0, negative, fractional and >12 as ungrouped (Zeal ungrouped value is unverified)', () => {
    const groups = bg.buildBuffGroups([
      member('Aldenmar', 'Cleric', 2),
      member('Brackwyn', 'Warrior', 0),
      member('Corvale', 'Enchanter', -1),
      member('Rethlan', 'Rogue', 13),
      member('Nyssara', 'Wizard', null),
      member('Zarrin', 'Monk', '1.5'),
      member('Tamsk', 'Bard', '7'),   // numeric string from the ingest path still counts
    ]);
    expect(groups.map((g) => g.group)).toEqual([2, 7, null]);
    expect(byGroup(groups, null).members.map((m) => m.name))
      .toEqual(['Brackwyn', 'Corvale', 'Nyssara', 'Rethlan', 'Zarrin']);
  });

  it('lists members by name inside a group and carries the queue-style labels', () => {
    const [g] = bg.buildBuffGroups([
      member('Rethlan', 'Rogue', 3, ['haste', 'hp:B']),
      member('Brackwyn', 'Warrior', 3, ['manaRegen', 'ds'], { inferred: true }),
    ]);
    expect(g.members).toEqual([
      { name: 'Brackwyn', class: 'Warrior', missing: ['Mana Regen', 'Dmg Shield'], inferred: true },
      { name: 'Rethlan', class: 'Rogue', missing: ['HP B', 'Haste'], inferred: false },
    ]);
  });

  it('returns [] for no members', () => {
    expect(bg.buildBuffGroups([])).toEqual([]);
    expect(bg.buildBuffGroups(undefined)).toEqual([]);
  });
});

describe('buildBuffGroups — lines', () => {
  it('lists only gaps somebody has, most-missing first, ties in GROUP_SPELLS order', () => {
    const [g] = bg.buildBuffGroups([
      member('Aldenmar', 'Warrior', 3, ['attack', 'haste', 'ds']),
      member('Brackwyn', 'Rogue', 3, ['haste', 'attack']),
      member('Corvale', 'Monk', 3, ['haste']),
      member('Rethlan', 'Wizard', 3, ['manaRegen']),
    ]);
    expect(g.lines.map((l) => [l.key, l.missing.length])).toEqual([
      ['haste', 3],      // most missing
      ['attack', 2],
      ['manaRegen', 1],  // tie with ds at 1 → GROUP_SPELLS order puts manaRegen first
      ['ds', 1],
    ]);
    expect(g.lines[0]).toMatchObject({ key: 'haste', label: 'Haste', missing: ['Aldenmar', 'Brackwyn', 'Corvale'] });
  });

  it('has no lines when nobody is missing anything', () => {
    const [g] = bg.buildBuffGroups([member('Aldenmar', 'Cleric', 1), member('Brackwyn', 'Warrior', 1)]);
    expect(g.lines).toEqual([]);
  });

  it('labels an HP slot line like the queue does', () => {
    const [g] = bg.buildBuffGroups([member('Aldenmar', 'Warrior', 1, ['hp:C'])]);
    expect(g.lines[0]).toMatchObject({ key: 'hp:C', label: 'HP C' });
  });

  it('carries the classes that CAN cast each line, with or without a caster in the group', () => {
    const [g] = bg.buildBuffGroups([
      member('Corvale', 'Enchanter', 3),
      member('Aldenmar', 'Warrior', 3, ['haste', 'ds', 'hp:C']),
    ]);
    const line = (k) => g.lines.find((l) => l.key === k);
    expect(line('haste').classes).toEqual(['enchanter']);      // has a caster (Corvale)
    expect(line('haste').casters).toHaveLength(1);
    expect(line('ds').classes).toEqual(['druid', 'magician']); // no caster, classes still named
    expect(line('ds').casters).toEqual([]);
    expect(line('hp:C').classes).toEqual(['shaman', 'paladin']);
  });

  it('classes is exactly the lowercase classes of GROUP_SPELLS for that key, in order, unique', () => {
    for (const key of rb.GROUP_LINE_KEYS) {
      const expected = [...new Set(rb.GROUP_SPELLS[key].map((e) => e.cls))];
      expect(bg.classesFor(key)).toEqual(expected);
      for (const c of expected) expect(c).toBe(c.toLowerCase());
    }
  });
});

describe('groupOf — the requester\'s own group', () => {
  const groups = bg.buildBuffGroups([
    member('Aldenmar', 'Cleric', 3),
    member('Brackwyn', 'Warrior', 1),
    member('Corvale', 'Enchanter', null),
  ]);
  it('finds the group a named raider is in, ignoring case', () => {
    expect(bg.groupOf(groups, 'Aldenmar')).toBe(3);
    expect(bg.groupOf(groups, ' brackwyn ')).toBe(1);
  });
  it('is null for an ungrouped raider, an unlisted name, a blank name or no groups', () => {
    expect(bg.groupOf(groups, 'Corvale')).toBeNull();
    expect(bg.groupOf(groups, 'Rethlan')).toBeNull();
    expect(bg.groupOf(groups, '')).toBeNull();
    expect(bg.groupOf(undefined, 'Aldenmar')).toBeNull();
  });
});

describe('buildBuffGroups — casters', () => {
  it('names only members of the SAME group, never a caster in another group', () => {
    const groups = bg.buildBuffGroups([
      member('Corvale', 'Enchanter', 1),                      // can cast haste, but in G1
      member('Aldenmar', 'Warrior', 3, ['haste']),
      member('Brackwyn', 'Rogue', 3, ['haste']),
      member('Rethlan', 'Cleric', 3),
    ]);
    expect(byGroup(groups, 3).lines[0].casters).toEqual([]);   // no enchanter IN G3
    expect(byGroup(groups, 1).lines).toEqual([]);              // and G1 has nothing missing
  });

  it('lists the group\'s own caster with the spell to name', () => {
    const [g] = bg.buildBuffGroups([
      member('Corvale', 'Enchanter', 3),
      member('Aldenmar', 'Warrior', 3, ['haste']),
    ]);
    expect(g.lines[0].casters).toEqual([{ name: 'Corvale', class: 'Enchanter', spell: "Vallon's Quickening" }]);
  });

  it('a caster may itself be missing the line, and several casters are listed by name', () => {
    const [g] = bg.buildBuffGroups([
      member('Rethlan', 'Enchanter', 2, ['manaRegen']),
      member('Corvale', 'Enchanter', 2),
      member('Brackwyn', 'Wizard', 2, ['manaRegen']),
    ]);
    const line = g.lines.find((l) => l.key === 'manaRegen');
    expect(line.missing).toEqual(['Brackwyn', 'Rethlan']);
    expect(line.casters.map((c) => c.name)).toEqual(['Corvale', 'Rethlan']);
  });

  it('uses the best spell the caster\'s level allows (a 60 enchanter cannot cast the level-65 spell)', () => {
    const casterFor = (level) => bg.buildBuffGroups([
      member('Corvale', 'Enchanter', 3, [], { level }),
      member('Aldenmar', 'Warrior', 3, ['haste']),
    ])[0].lines[0].casters;
    expect(casterFor(65)[0].spell).toBe("Vallon's Quickening");
    expect(casterFor(60)[0].spell).toBe('Speed of the Brood');
    expect(casterFor(null)[0].spell).toBe("Vallon's Quickening");   // level unknown → best
    expect(casterFor(40)).toEqual([]);                              // below every haste spell
  });

  it('matches class abbreviations and a full name with a space', () => {
    expect(bg.canonClass('ENC')).toBe('enchanter');
    expect(bg.canonClass('Shadow Knight')).toBe('shadow knight');
    const [g] = bg.buildBuffGroups([
      member('Corvale', 'ENC', 3),
      member('Aldenmar', 'Shadow Knight', 3, ['haste']),
    ]);
    expect(g.lines[0].casters.map((c) => c.name)).toEqual(['Corvale']);
  });

  it('never names a caster in the ungrouped bucket (a group buff there lands on nobody else)', () => {
    const [g] = bg.buildBuffGroups([
      member('Corvale', 'Enchanter', null),
      member('Aldenmar', 'Warrior', null, ['haste']),
    ]);
    expect(g.group).toBeNull();
    expect(g.lines[0]).toMatchObject({ key: 'haste', missing: ['Aldenmar'], casters: [] });
  });

  it('a class with no group spell for the line is not a caster', () => {
    const [g] = bg.buildBuffGroups([
      member('Corvale', 'Cleric', 3),      // clerics have no haste
      member('Aldenmar', 'Warrior', 3, ['haste']),
    ]);
    expect(g.lines[0].casters).toEqual([]);
  });
});

describe('buildBuffGroups — raiders with no buff signal', () => {
  it('lists them flagged, counts them toward no line, and still lets them cast', () => {
    const [g] = bg.buildBuffGroups([
      member('Corvale', 'Enchanter', 3, [], { noSignal: true }),
      member('Aldenmar', 'Warrior', 3, ['haste']),
      member('Brackwyn', 'Rogue', 3, ['haste'], { noSignal: true }),   // stray keys on a no-signal row are ignored
    ]);
    expect(g.members.find((m) => m.name === 'Corvale')).toMatchObject({ missing: [], no_signal: true });
    expect(g.members.find((m) => m.name === 'Brackwyn')).toMatchObject({ missing: [], no_signal: true });
    expect(g.members.find((m) => m.name === 'Aldenmar').no_signal).toBeUndefined();
    expect(g.lines).toHaveLength(1);
    expect(g.lines[0].missing).toEqual(['Aldenmar']);
    expect(g.lines[0].casters.map((c) => c.name)).toEqual(['Corvale']);
  });
});

// ── 2. missingLines ─────────────────────────────────────────────────────────
describe('missingLines — the per-raider gap rule', () => {
  const FILLED = ['Hand of Virtue', "Khura's Focusing", 'Circle of Seasons'];   // HP A+B, C, resists

  it('respects the role-expected filter: a cleric is not missing haste, attack or DS', () => {
    const naked = rb.missingLines([], 'priest');
    expect(naked).toEqual(['hp:A', 'hp:B', 'hp:C', 'manaRegen', 'resists']);
    for (const k of ['haste', 'attack', 'ds']) expect(naked).not.toContain(k);
  });

  it('expects haste/attack of a melee, plus DS of a tank', () => {
    expect(rb.missingLines(FILLED, 'melee')).toEqual(['haste', 'attack']);
    expect(rb.missingLines(FILLED, 'tank')).toEqual(['haste', 'attack', 'ds']);
    expect(rb.missingLines(FILLED, 'caster')).toEqual(['manaRegen']);
    expect(rb.missingLines(FILLED, 'bard')).toEqual(['haste']);
    expect(rb.missingLines(FILLED, 'other')).toEqual([]);
  });

  it('the catch-all role expects resists; a role outside ROLE_TARGETS expects nothing beyond the HP slots', () => {
    expect(rb.missingLines([], 'other')).toEqual(['hp:A', 'hp:B', 'hp:C', 'resists']);
    expect(rb.missingLines([], 'nonsense')).toEqual(['hp:A', 'hp:B', 'hp:C']);
  });

  it('credits a buff in its own line and clears the gap', () => {
    expect(rb.missingLines([...FILLED, "Vallon's Quickening", 'Spirit of the Predator'], 'melee')).toEqual([]);
    expect(rb.missingLines([...FILLED, 'Maelstrom of Ro'], 'tank')).toEqual(['haste', 'attack']);
  });

  it('credits secondary categories: Bih`Li carries attack, POTG carries mana regen', () => {
    expect(rb.missingLines([...FILLED, 'Spirit of Bih`Li'], 'melee')).toEqual(['haste']);
    expect(rb.missingLines([...FILLED, 'Protection of the Glades'], 'caster')).toEqual([]);
  });

  it('reads HP slots: Aegolism-family fills A+B, a group Mark fills B, Focus of the Seventh fills C', () => {
    const R = 'Circle of Seasons';   // keep the resists gap out of the way
    expect(rb.missingLines([R, 'Blessing of Aegolism'], 'other')).toEqual(['hp:C']);
    expect(rb.missingLines([R, 'Kazad`s Mark'], 'other')).toEqual(['hp:A', 'hp:C']);
    expect(rb.missingLines([R, 'Focus of the Seventh'], 'other')).toEqual(['hp:A', 'hp:B']);
  });

  it('no role ever reports runSpeed (the queue never expects it, so neither does the group view)', () => {
    for (const role of Object.keys(rb.ROLE_TARGETS)) expect(rb.missingLines([], role)).not.toContain('runSpeed');
  });

  it('ignores blank names and tolerates no list', () => {
    expect(rb.missingLines([null, '', undefined], 'other')).toEqual(['hp:A', 'hp:B', 'hp:C', 'resists']);
    expect(rb.missingLines(undefined, 'other')).toEqual(['hp:A', 'hp:B', 'hp:C', 'resists']);
  });

  it('buffCategoriesPresent folds secondary credits in exactly as the queue loop used to', () => {
    expect(rb.buffCategoriesPresent(['Spirit of Bih`Li', 'Protection of the Glades', 'Haste']))
      .toEqual({
        runSpeed: ['Spirit of Bih`Li'],
        attack: ['Spirit of Bih`Li'],
        hp: ['Protection of the Glades'],
        manaRegen: ['Protection of the Glades'],
        haste: ['Haste'],
      });
  });
});

// ── 3. keyword fixes ────────────────────────────────────────────────────────
describe('keyword gaps — each added name lands where it was added for', () => {
  const cases = [
    // [catalog name, category, HP slot or null]
    ["Marzin's Mark", 'hp', 'B'],
    ["Naltron's Mark", 'hp', 'B'],
    ['Kazad`s Mark', 'hp', 'B'],
    ["Kazad's Mark", 'hp', 'B'],
    ['Focus of the Seventh', 'hp', 'C'],
    ["Vallon's Quickening", 'haste', null],
    ['Speed of the Brood', 'haste', null],          // already covered by 'speed of' — guarded here
    ['Spirit of Bih`Li', 'runSpeed', null],
    ['Spirit of Eagle', 'runSpeed', null],
    ['Flight of Eagles', 'runSpeed', null],         // already covered by 'flight of eagle'
    ['Spirit of the Predator', 'attack', null],
    ['Call of the Predator', 'attack', null],       // already present
    ['Spiritual Vigor', 'attack', null],            // ATK +40 / max HP +225
    ['Spiritual Dominion', 'manaRegen', null],      // mana + HP regen, not attack
    ['Boon of the Clear Mind', 'manaRegen', null],
    ['Gift of Pure Thought', 'manaRegen', null],    // already present
    ['Maelstrom of Ro', 'ds', null],
    ['Aegis of Ro', 'ds', null],
  ];
  for (const [name, cat, slot] of cases) {
    it(`${name} → ${cat}${slot ? ' / slot ' + slot : ''}`, () => {
      expect(rb.categorizeBuff(name)).toBe(cat);
      expect(rb.categorizeBuff(name.toLowerCase())).toBe(cat);
      if (slot) {
        const slots = rb.analyzeHpSlots([name]);
        for (const s of rb.HP_SLOTS) expect(Boolean(slots[s])).toBe(s === slot);
      }
    });
  }

  it('Spirit of Bih`Li also credits attack (its second effect)', () => {
    expect(rb.secondaryCategoriesFor('Spirit of Bih`Li')).toContain('attack');
  });

  it('Talisman of the Brute stays uncategorized: it is a stamina buff (SPA 7), not attack', () => {
    expect(rb.categorizeBuff('Talisman of the Brute')).toBeNull();
  });

  it('does not steal an existing name: the older lines categorize as before', () => {
    expect(rb.categorizeBuff('Aegolism')).toBe('hp');
    expect(rb.categorizeBuff('Symbol of Marzin')).toBe('hp');
    expect(rb.categorizeBuff("Khura's Focusing")).toBe('hp');
    expect(rb.categorizeBuff('Spirit of Wolf')).toBe('runSpeed');
    expect(rb.categorizeBuff('Aegis of Bathezid')).toBe('resists');
    expect(rb.categorizeBuff('Circle of Seasons')).toBe('resists');
    expect(rb.categorizeBuff('Legacy of Thorn')).toBe('ds');
  });
});

describe('GROUP_SPELLS — every entry is recognized as the line it is filed under', () => {
  const HP_KEYS = new Set(['hp:A', 'hp:B', 'hp:C']);

  it('has the nine lines the group view uses', () => {
    expect(Object.keys(rb.GROUP_SPELLS)).toEqual(
      ['hp:A', 'hp:B', 'hp:C', 'haste', 'manaRegen', 'runSpeed', 'attack', 'ds', 'resists']);
    expect(rb.GROUP_LINE_KEYS).toEqual(Object.keys(rb.GROUP_SPELLS));
  });

  for (const [key, entries] of Object.entries(rb.GROUP_SPELLS)) {
    for (const e of entries) {
      it(`${key}: ${e.spell} (${e.cls}) is read back as that line`, () => {
        expect(e.cls).toBe(e.cls.toLowerCase());
        expect(Number.isInteger(e.id)).toBe(true);
        if (HP_KEYS.has(key)) {
          expect(rb.analyzeHpSlots([e.spell])[key.slice(3)]).toBeTruthy();
        } else {
          const cats = [rb.categorizeBuff(e.spell), ...rb.secondaryCategoriesFor(e.spell)];
          expect(cats).toContain(key);
        }
        // and the member who just landed it is NOT reported missing that line
        const role = { haste: 'melee', manaRegen: 'caster', attack: 'melee', ds: 'tank', resists: 'other' }[key] || 'other';
        expect(rb.missingLines([e.spell], role)).not.toContain(key);
      });
    }
  }

  it('spell ids are unique', () => {
    const ids = Object.values(rb.GROUP_SPELLS).flat().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lineLabel gives the labels the queue rows use', () => {
    expect(rb.lineLabel('hp:A')).toBe('HP A');
    expect(rb.lineLabel('haste')).toBe('Haste');
    expect(rb.lineLabel('ds')).toBe('Dmg Shield');
    expect(rb.lineLabel('manaRegen')).toBe('Mana Regen');
    expect(rb.lineLabel('runSpeed')).toBe('Run Speed');
    expect(rb.lineLabel('attack')).toBe('Attack');
    expect(rb.lineLabel('resists')).toBe('Resists');
  });
});

// ── 4. the real handler, on fake tables ─────────────────────────────────────
// Slice _handleAgentRaidBuffQueue out of index.js (requiring index.js boots Discord) and run it
// with stubs for everything it reaches outside itself. The `with` scope hands the stubs in by
// name; anything not stubbed falls through to the real globals, and a missing stub shows up as a
// 500 ("internal error") rather than a quiet pass.
const HANDLER_SRC = (() => {
  const src = readSource(BOT_INDEX);
  return sliceBlock(src,
    'async function _handleAgentRaidBuffQueue(req, res) {',
    '// Casting status on a single target, for the queue rows');
})();

const NOW = () => Date.now();
const ago = (sec) => new Date(NOW() - sec * 1000).toISOString();

async function callHandler({ identity = { discord_id: 'u1' }, query = 'class=Cleric&character=Aldenmar', tables }) {
  const fakeSupabase = {
    isEnabled: () => true,
    select: async (table) => tables[table] || [],
  };
  const modules = {
    './utils/supabase': fakeSupabase,
    './utils/raidBuffs': rb,
    './utils/range': rangeUtil,
    './utils/buffGroups': bg,
  };
  const scope = {
    mimicLink: { requireAgentAuth: async () => identity },
    _raidGroups: raidGroupsUtil,
    _keepRaidSplit: (s) => s,
    _lastRaiderDeath: new Map(),
    _debuffClearMarks: new Map(),
    _spellFxMap: async () => new Map(),
    _CURSE_COUNTERS_FOR: () => 0,
    _CURE_RANK: { curse: 0, blind: 1, poison: 2, disease: 3 },
    _applyCuredCounters: () => {},
    _cureStateFor: () => ({ state: 'none' }),
    _castingOnTarget: () => [],
    _mgbTrainedSet: async () => new Set(),
    _buffDetailFor: () => null,
    require: (p) => { if (!(p in modules)) throw new Error('unstubbed require ' + p); return modules[p]; },
  };
  const proxy = new Proxy(scope, { has: (t, k) => Object.prototype.hasOwnProperty.call(t, k) });
  // eslint-disable-next-line no-new-func
  const handler = new Function('__scope', `with (__scope) { ${HANDLER_SRC}\nreturn _handleAgentRaidBuffQueue; }`)(proxy);
  let status = null, body = null;
  const res = { writeHead: (s) => { status = s; }, end: (b) => { body = b; } };
  await handler({ url: '/api/agent/raid-buff-queue?' + query }, res);
  return { status, out: JSON.parse(body) };
}

// A fresh raid_roster row. rank 'Raid Leader' marks the leader's row (raidGroups.groupRaids reads it).
const rosterRow = (name, cls, group, uploader = 'u1', extra = {}) => ({
  name, class: cls, group_num: group, rank: null, level: 65, hp_pct: 100,
  uploaded_by_discord_id: uploader, captured_at: ago(10), ...extra,
});
const liveRow = (character, buffNames, extra = {}) => ({
  character, buffs: buffNames.map((n) => ({ name: n, ticks: 200 })), buff_count: buffNames.length,
  zone_name: 'testzone', self_hp_pct: 100, loc_x: null, loc_y: null, loc_z: null, updated_at: ago(5), ...extra,
});

describe('_handleAgentRaidBuffQueue — the `groups` field', () => {
  beforeEach(() => { globalThis._rbqBundleCache = undefined; });   // the handler memoizes the bundle for 2s

  const BASE = ['Hand of Virtue', "Khura's Focusing", 'Circle of Seasons'];   // HP A+B, HP C, resists

  const raid = () => ({
    raid_roster: [
      rosterRow('Aldenmar', 'Cleric', 1, 'u1', { rank: 'Raid Leader' }),
      rosterRow('Zarrin', 'Monk', 1),
      rosterRow('Tamsk', 'Enchanter', 1, 'u1', { level: 60 }),
      rosterRow('Corvale', 'Enchanter', 3),
      rosterRow('Brackwyn', 'Warrior', 3),
      rosterRow('Rethlan', 'Rogue', 3),
      rosterRow('Nyssara', 'Wizard', 3),
      rosterRow('Velka', 'Paladin', 3),                 // roster row only: no Mimic, no landings
    ],
    character_live_state: [
      liveRow('Aldenmar', [...BASE, 'Boon of the Clear Mind']),
      liveRow('Zarrin', BASE),
      liveRow('Tamsk', BASE),
      liveRow('Corvale', [...BASE, "Koadic's Endless Intellect"]),
      liveRow('Brackwyn', BASE),
      liveRow('Rethlan', [...BASE, "Vallon's Quickening", 'Spirit of the Predator']),
      liveRow('Nyssara', BASE),
    ],
    // characters.class can read "Unknown" while the Zeal roster knows the real class.
    characters: [{ name: 'Tamsk', class: 'Unknown' }],
    buff_casts: [],
  });

  it('is added in raid mode, grouped, with the same labels the queue uses', async () => {
    const { status, out } = await callHandler({ tables: raid() });
    expect(status).toBe(200);
    expect(out.group_mode).toBe(false);
    expect(out.groups.map((g) => g.group)).toEqual([1, 3]);

    const g3 = byGroup(out.groups, 3);
    expect(g3.members.map((m) => [m.name, m.class, m.missing])).toEqual([
      ['Brackwyn', 'Warrior', ['Haste', 'Attack', 'Dmg Shield']],
      ['Corvale', 'Enchanter', []],
      ['Nyssara', 'Wizard', ['Mana Regen']],
      ['Rethlan', 'Rogue', []],
      ['Velka', 'Paladin', []],
    ]);
    expect(g3.members.find((m) => m.name === 'Velka').no_signal).toBe(true);   // unknown, not "fully buffed"
    expect(g3.lines.map((l) => [l.key, l.label, l.missing])).toEqual([
      ['haste', 'Haste', ['Brackwyn']],
      ['manaRegen', 'Mana Regen', ['Nyssara']],
      ['attack', 'Attack', ['Brackwyn']],
      ['ds', 'Dmg Shield', ['Brackwyn']],
    ]);
    // casters are G3's own enchanter, and only for the lines an enchanter can cast
    expect(g3.lines.find((l) => l.key === 'haste').casters)
      .toEqual([{ name: 'Corvale', class: 'Enchanter', spell: "Vallon's Quickening" }]);
    expect(g3.lines.find((l) => l.key === 'manaRegen').casters)
      .toEqual([{ name: 'Corvale', class: 'Enchanter', spell: "Koadic's Endless Intellect" }]);
    expect(g3.lines.find((l) => l.key === 'attack').casters).toEqual([]);
    expect(g3.lines.find((l) => l.key === 'ds').casters).toEqual([]);
  });

  it('names G1\'s caster for G1, reads class from the roster when characters says Unknown, and gates by level', async () => {
    const { out } = await callHandler({ tables: raid() });
    const g1 = byGroup(out.groups, 1);
    expect(g1.members.find((m) => m.name === 'Tamsk')).toMatchObject({ class: 'Enchanter', missing: ['Mana Regen'] });
    const haste = g1.lines.find((l) => l.key === 'haste');
    expect(haste.missing).toEqual(['Zarrin']);
    // Tamsk is level 60 → Speed of the Brood; Corvale (G3, level 65) is not offered to G1
    expect(haste.casters).toEqual([{ name: 'Tamsk', class: 'Enchanter', spell: 'Speed of the Brood' }]);
  });

  it('counts an observed landing (no Mimic) as the raider\'s buffs and flags the member inferred', async () => {
    const t = raid();
    t.raid_roster.push(rosterRow('Zarrinb', 'Warrior', 3));
    t.buff_casts.push(
      ...[...BASE, "Vallon's Quickening", 'Spirit of the Predator', 'Maelstrom of Ro']
        .map((s) => ({ target: 'Zarrinb', spell_name: s, dur_ticks: 300, cast_at: ago(60) })));
    const { out } = await callHandler({ tables: t });
    const m = byGroup(out.groups, 3).members.find((x) => x.name === 'Zarrinb');
    expect(m).toEqual({ name: 'Zarrinb', class: 'Warrior', missing: [], inferred: true });
  });

  it('is built from every scoped raider, before the queue\'s 40-row cap', async () => {
    const t = { raid_roster: [rosterRow('Aldenmar', 'Cleric', 1, 'u1', { rank: 'Raid Leader' })], character_live_state: [liveRow('Aldenmar', BASE)], characters: [], buff_casts: [] };
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < 50; i++) {
      const name = 'Fill' + letters[Math.floor(i / 26)] + letters[i % 26];
      t.raid_roster.push(rosterRow(name, 'Warrior', 2));
      t.character_live_state.push(liveRow(name, ['Spirit of Wolf']));   // missing HP → on a cleric's queue
    }
    const { out } = await callHandler({ tables: t });
    expect(out.buff_queue).toHaveLength(40);                           // the existing cap, untouched
    const g2 = byGroup(out.groups, 2);
    expect(g2.members).toHaveLength(50);                               // the group view sees all of them
    expect(g2.lines.find((l) => l.key === 'hp:A').missing).toHaveLength(50);
  });

  it('says which group the requester is in (self_group), and every line names its casting classes', async () => {
    const { out } = await callHandler({ tables: raid() });                                   // requester Aldenmar, G1
    expect(out.self_group).toBe(1);
    const g3 = byGroup(out.groups, 3);
    expect(g3.lines.find((l) => l.key === 'attack').classes).toEqual(['ranger', 'beastlord']);
    expect(g3.lines.find((l) => l.key === 'haste').classes).toEqual(['enchanter']);

    globalThis._rbqBundleCache = undefined;
    const other = await callHandler({ tables: raid(), query: 'class=Warrior&character=Brackwyn' });
    expect(other.out.self_group).toBe(3);

    globalThis._rbqBundleCache = undefined;
    const stranger = await callHandler({ tables: raid(), query: 'class=Cleric&character=Nobodyhere' });
    expect(stranger.out.self_group).toBeNull();                                              // not on the roster
  });

  it('self_group is null when the requester is ungrouped (a Zeal group of 0 reads as none)', async () => {
    const t = raid();
    t.raid_roster.find((r) => r.name === 'Aldenmar').group_num = 0;
    const { out } = await callHandler({ tables: t });
    expect(out.self_group).toBeNull();
    expect(byGroup(out.groups, null).members.map((m) => m.name)).toEqual(['Aldenmar']);
  });

  it('is absent in group mode (no raid roster, so no group numbers)', async () => {
    const t = { raid_roster: [], character_live_state: [liveRow('Aldenmar', BASE), liveRow('Brackwyn', BASE)], characters: [], buff_casts: [] };
    const { status, out } = await callHandler({ tables: t });
    expect(status).toBe(200);
    expect(out.group_mode).toBe(true);
    expect('groups' in out).toBe(false);
    expect('self_group' in out).toBe(false);
    expect(out.buff_queue).toBeDefined();   // everything else is as it was
  });

  it('keeps two raids\' group 1 apart: each requester sees only their own raid', async () => {
    // Two raids at once, each with a "group 1" — different leaders, different uploaders.
    const t = {
      raid_roster: [
        rosterRow('Aldenmar', 'Cleric', 1, 'u1', { rank: 'Raid Leader' }),
        rosterRow('Brackwyn', 'Warrior', 1, 'u1'),
        rosterRow('Corvale', 'Enchanter', 1, 'u2', { rank: 'Raid Leader' }),
        rosterRow('Rethlan', 'Rogue', 1, 'u2'),
        rosterRow('Nyssara', 'Wizard', 2, 'u2'),
      ],
      character_live_state: ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara'].map((n) => liveRow(n, BASE)),
      characters: [],
      buff_casts: [],
    };
    const mine = await callHandler({ tables: t, identity: { discord_id: 'u1' }, query: 'class=Cleric&character=Aldenmar' });
    expect(mine.out.raids).toHaveLength(2);
    expect(mine.out.groups.map((g) => [g.group, g.members.map((m) => m.name)])).toEqual([[1, ['Aldenmar', 'Brackwyn']]]);

    globalThis._rbqBundleCache = undefined;
    const theirs = await callHandler({ tables: t, identity: { discord_id: 'u2' }, query: 'class=Enchanter&character=Corvale' });
    expect(theirs.out.groups.map((g) => [g.group, g.members.map((m) => m.name)]))
      .toEqual([[1, ['Corvale', 'Rethlan']], [2, ['Nyssara']]]);
  });

  it('keeps the existing queue rows and roster field as they were', async () => {
    const { out } = await callHandler({ tables: raid() });
    // Brackwyn/Zarrin etc. all hold HP+resists, so a cleric's queue has nothing to fix; the roster card still lists everyone.
    expect(out.buff_queue).toEqual([]);
    expect(out.roster.map((r) => r.name).sort()).toEqual(['Aldenmar', 'Brackwyn', 'Corvale', 'Nyssara', 'Rethlan', 'Tamsk', 'Velka', 'Zarrin']);
  });
});
