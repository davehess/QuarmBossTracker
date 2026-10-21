// test/buff-groups-web.test.js — /buffs grouped by raid group (?v=b group cards, ?v=c buff lines).
//
// The guild lead, 2026-10-04: "we should be grouping people for buffs on /buffs — treat that like the
// buff queue as well". A GROUP buff lands on the CASTER'S OWN group in this era, so the call-out that
// helps is "3 of 4 in G3 are short on Haste — the enchanter IN G3 can cast it", never "an enchanter
// somewhere in the raid". The rules (web/lib/buffGroups.ts) and the categorizer (web/lib/buffs.ts) run
// for real; characters below are invented fixtures.
//
// Run: npx vitest run test/buff-groups-web.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  GROUP_SPELLS, LINE_ORDER, LINE_LABELS, CALLOUT_MIN, MAX_RAID_GROUP, UNPLACED_LABEL,
  normalizeGroup, canonClass, freshestByName, splitRaids, buildBuffGroups, missingLinesFor,
  calloutLines, buildLineView, casterGroups, noCasterText,
} from '../web/lib/buffGroups.ts';
import { categorizeBuff, analyzeHpSlots, classToRole } from '../web/lib/buffs.ts';

// ── fixtures ─────────────────────────────────────────────────────────────────
// A raider, built the way the page builds one: categorize the buff NAMES, then read the HP slots.
const AEGO = 'Blessing of Aegolism';          // fills HP A + B
const KHURA = "Khura's Focusing";             // HP C
const VOG = 'Visions of Grandeur';            // haste
const ATK = 'Call of the Predator';           // attack
const RES = 'Circle of Seasons';              // resists
const KEI = "Koadic's Endless Intellect";     // mana regen
const DS = 'Legacy of Thorn';                 // damage shield
const HP = [AEGO, KHURA];
const FULL = {
  tank: [...HP, VOG, ATK, RES, DS],
  melee: [...HP, VOG, ATK, RES],
  caster: [...HP, KEI, RES],
};

function raider(name, cls, group, buffs, over = {}) {
  const byCategory = {};
  for (const b of buffs) { const c = categorizeBuff(b); if (c) (byCategory[c] ||= []).push(b); }
  return {
    name, className: cls, role: classToRole(cls), group,
    byCategory, hpSlots: analyzeHpSlots(buffs), ...over,
  };
}
const without = (list, ...drop) => list.filter(b => !drop.includes(b));
const card = (sections, g) => sections[0].groups.find(c => c.group === g);
const line = (c, key) => c.lines.find(l => l.key === key);

// Group 3 has an enchanter; group 5 has two melee short on haste and NO enchanter (one sits in group 2).
const raid = () => [
  raider('Brackwyn', 'Warrior', 3, without(FULL.tank, VOG)),
  raider('Rethlan', 'Monk', 3, without(FULL.melee, VOG)),
  raider('Nyssara', 'Rogue', 3, without(FULL.melee, VOG)),
  raider('Zarrin', 'Berserker', 3, FULL.melee),                       // has haste
  raider('Corvale', 'Enchanter', 3, FULL.caster),
  raider('Tamsk', 'Warrior', 5, without(FULL.tank, VOG)),
  raider('Velka', 'Monk', 5, without(FULL.melee, VOG)),
  raider('Aldenmar', 'Cleric', 2, [...HP, KEI, RES]),
  raider('Ilsa', 'Enchanter', 2, FULL.caster),
  raider('Orrin', 'Monk', null, without(FULL.melee, VOG)),            // ungrouped
  raider('Pell', 'Enchanter', null, FULL.caster),                     // ungrouped enchanter
];

// ── group numbers ────────────────────────────────────────────────────────────
describe('which group number counts', () => {
  it('1 through 12 are groups; null, 0, negatives, fractions and 13+ are ungrouped', () => {
    for (let g = 1; g <= MAX_RAID_GROUP; g++) expect(normalizeGroup(g)).toBe(g);
    for (const bad of [null, undefined, 0, -1, 13, 99, 2.5, NaN]) expect(normalizeGroup(bad)).toBe(null);
  });
  it('a raid_roster group of 0 or 13 lands the member in the ungrouped card, last', () => {
    const s = buildBuffGroups([
      raider('Aldenmar', 'Cleric', 0, FULL.caster),
      raider('Brackwyn', 'Warrior', 13, FULL.tank),
      raider('Corvale', 'Enchanter', 1, FULL.caster),
    ]);
    expect(s[0].groups.map(c => c.group)).toEqual([1, null]);
    expect(card(s, null).members.map(m => m.name).sort()).toEqual(['Aldenmar', 'Brackwyn']);
  });
});

// ── freshest roster row ──────────────────────────────────────────────────────
describe('the freshest roster row wins', () => {
  const rows = [
    { name: 'Aldenmar', group_num: 7, captured_at: '2026-10-04T19:40:00Z' },
    { name: 'aldenmar', group_num: 3, captured_at: '2026-10-04T20:00:30Z' },   // freshest, other case
    { name: 'Aldenmar', group_num: 5, captured_at: '2026-10-04T19:58:00Z' },
    { name: 'Aldenmar', group_num: 9, captured_at: null },                      // no timestamp loses
  ];
  it('picks the newest captured_at whatever order the query returned', () => {
    expect(freshestByName(rows).get('aldenmar').group_num).toBe(3);
    expect(freshestByName([...rows].reverse()).get('aldenmar').group_num).toBe(3);
  });
  it('keys are lower-cased, and a name with one row keeps it', () => {
    const m = freshestByName([...rows, { name: 'Brackwyn', group_num: 1, captured_at: '2026-10-04T20:00:00Z' }]);
    expect([...m.keys()].sort()).toEqual(['aldenmar', 'brackwyn']);
  });
});

// ── "missing" is the grid's rule ─────────────────────────────────────────────
describe('missing follows the role-expected rule', () => {
  it('a cleric is not missing haste or attack; a monk is', () => {
    const cleric = raider('Aldenmar', 'Cleric', 1, [...HP, KEI, RES]);
    const monk = raider('Rethlan', 'Monk', 1, [...HP, RES]);
    expect(missingLinesFor(cleric)).toEqual([]);
    expect(missingLinesFor(monk)).toEqual(['haste', 'attack']);
  });
  it('only a tank is missing a damage shield; every role is missing empty HP slots', () => {
    expect(missingLinesFor(raider('Brackwyn', 'Warrior', 1, without(FULL.tank, DS)))).toEqual(['ds']);
    expect(missingLinesFor(raider('Corvale', 'Enchanter', 1, [KEI, RES]))).toEqual(['hp:A', 'hp:B', 'hp:C']);
    expect(missingLinesFor(raider('Nyssara', 'Rogue', 1, without(FULL.melee, DS)))).toEqual([]);
  });
  it('Aegolism fills HP A and B, so only slot C reads short', () => {
    expect(missingLinesFor(raider('Zarrin', 'Wizard', 1, [AEGO, KEI, RES]))).toEqual(['hp:C']);
  });
  it('a raider not running the agent is unknown, never missing', () => {
    const m = raider('Tamsk', 'Warrior', 1, [], { noAgent: true });
    expect(missingLinesFor(m)).toEqual([]);
    const c = buildBuffGroups([m])[0].groups[0];
    expect(c.unknown).toBe(1);
    expect(c.lines).toEqual([]);
    expect(c.members[0].noAgent).toBe(true);
  });
  it('Run Speed is expected by no role, so it is never a gap', () => {
    for (const cls of ['Warrior', 'Monk', 'Cleric', 'Enchanter', 'Bard', 'Unknown']) {
      expect(missingLinesFor(raider('X', cls, 1, []))).not.toContain('runSpeed');
    }
  });
});

// ── the cards ────────────────────────────────────────────────────────────────
describe('group cards', () => {
  const s = buildBuffGroups(raid());
  it('one section when one raid runs, groups ascending, ungrouped last', () => {
    expect(s).toHaveLength(1);
    expect(s[0].label).toBe(null);
    expect(s[0].groups.map(c => c.group)).toEqual([2, 3, 5, null]);
    expect(s[0].size).toBe(11);
  });
  it('each member carries class and the lines they are missing; worst first', () => {
    const g3 = card(s, 3);
    expect(g3.members.map(m => m.name)).toEqual(['Brackwyn', 'Nyssara', 'Rethlan', 'Corvale', 'Zarrin']);
    const brack = g3.members.find(m => m.name === 'Brackwyn');
    expect(brack.className).toBe('Warrior');
    expect(brack.missing).toEqual(['haste']);
    expect(g3.members.find(m => m.name === 'Zarrin').missing).toEqual([]);
  });
  it('a line shows the count of members missing it out of those who want it', () => {
    const haste = line(card(s, 3), 'haste');
    expect(haste.missing).toEqual(['Brackwyn', 'Nyssara', 'Rethlan']);
    expect(haste.expected).toBe(4);          // the three melee/tank + Zarrin; the enchanter does not want haste
    expect(haste.label).toBe('Haste');
  });
  it('call-outs only for lines where 2+ members of that group are missing', () => {
    expect(CALLOUT_MIN).toBe(2);
    expect(calloutLines(card(s, 3)).map(l => l.key)).toEqual(['haste']);
    // group 5: Tamsk and Velka are both short on haste → call-out; group 2 has nobody short → none
    expect(calloutLines(card(s, 5)).map(l => l.key)).toEqual(['haste']);
    expect(calloutLines(card(s, 2))).toEqual([]);
  });
  it('one member short on a line is a chip, not a call-out', () => {
    const one = buildBuffGroups([
      raider('Brackwyn', 'Warrior', 4, without(FULL.tank, VOG)),
      raider('Rethlan', 'Monk', 4, FULL.melee),
      raider('Corvale', 'Enchanter', 4, FULL.caster),
    ]);
    const g = card(one, 4);
    expect(line(g, 'haste').missing).toEqual(['Brackwyn']);
    expect(calloutLines(g)).toEqual([]);
  });
  it('lines are sorted by most missing, then by line order', () => {
    const g = card(buildBuffGroups([
      raider('Brackwyn', 'Warrior', 1, [AEGO, KHURA, RES]),               // haste, attack, ds
      raider('Rethlan', 'Monk', 1, [AEGO, KHURA, RES]),                   // haste, attack
      raider('Nyssara', 'Rogue', 1, [AEGO, KHURA, RES, VOG]),             // attack
      raider('Zarrin', 'Berserker', 1, [AEGO, KHURA, RES, VOG, ATK]),
    ]), 1);
    expect(g.lines.map(l => [l.key, l.missing.length])).toEqual([['attack', 3], ['haste', 2], ['ds', 1]]);
  });
  it('a group nobody is short in has no lines', () => {
    expect(card(s, 2).lines).toEqual([]);
  });
});

// ── casters come from the same group, and only that group ────────────────────
describe('casters', () => {
  const s = buildBuffGroups(raid());
  it('names the enchanter in the SAME group, with the best spell for the line', () => {
    const haste = line(card(s, 3), 'haste');
    expect(haste.casters).toEqual([{ name: 'Corvale', cls: 'Enchanter', spell: "Vallon's Quickening" }]);
  });
  it('an enchanter in another group does not count: group 5 has none', () => {
    const haste = line(card(s, 5), 'haste');
    expect(haste.casters).toEqual([]);
    expect(haste.casterClasses).toEqual(['Enchanter']);
    expect(noCasterText(haste.casterClasses)).toBe('no enchanter in this group — single-target, or move someone');
  });
  it('an ungrouped enchanter covers nobody, and an ungrouped card has no call-outs', () => {
    const ung = card(s, null);
    expect(line(ung, 'haste').casters).toEqual([]);
    expect(calloutLines(ung)).toEqual([]);
  });
  it('class aliases still resolve (ENC / enchanter)', () => {
    expect(canonClass('ENC')).toBe('enchanter');
    expect(canonClass(' Enchanter ')).toBe('enchanter');
    const g = card(buildBuffGroups([
      raider('Brackwyn', 'Warrior', 6, without(FULL.tank, VOG)),
      raider('Rethlan', 'Monk', 6, without(FULL.melee, VOG)),
      raider('Corvale', 'ENC', 6, FULL.caster),
    ]), 6);
    expect(line(g, 'haste').casters.map(c => c.name)).toEqual(['Corvale']);
  });
  it('a line two classes can cast lists both in the no-caster note', () => {
    expect(noCasterText(['Shaman', 'Paladin'])).toBe('no shaman or paladin in this group — single-target, or move someone');
    expect(noCasterText(['Druid', 'Shaman', 'Ranger'])).toBe('no druid, shaman or ranger in this group — single-target, or move someone');
  });
  it('casters fold by class and spell for the sentence', () => {
    expect(casterGroups([
      { name: 'Corvale', cls: 'Enchanter', spell: "Vallon's Quickening" },
      { name: 'Ilsa', cls: 'Enchanter', spell: "Vallon's Quickening" },
      { name: 'Nyssara', cls: 'Druid', spell: 'Flight of Eagles' },
    ])).toEqual([
      { names: ['Corvale', 'Ilsa'], cls: 'Enchanter', spell: "Vallon's Quickening" },
      { names: ['Nyssara'], cls: 'Druid', spell: 'Flight of Eagles' },
    ]);
  });
  it('the Khura line is castable by a shaman OR a paladin (Brell) in the group', () => {
    const g = card(buildBuffGroups([
      raider('Aldenmar', 'Paladin', 8, [AEGO, VOG, ATK, RES, DS]),         // no HP C of his own
      raider('Brackwyn', 'Warrior', 8, [AEGO, VOG, ATK, RES, DS]),
      raider('Rethlan', 'Shaman', 8, [AEGO, KEI, RES]),
    ]), 8);
    const c = line(g, 'hp:C');
    expect(c.missing).toEqual(['Aldenmar', 'Brackwyn', 'Rethlan']);
    expect(c.casters.map(x => [x.name, x.spell])).toEqual([
      ['Aldenmar', "Brell's Mountainous Barrier"], ['Rethlan', 'Focus of the Seventh'],
    ]);
  });
  it('names the best group spell the caster\'s level allows (unknown level = the best)', () => {
    const at = (lvl) => line(card(buildBuffGroups([
      raider('Corvale', 'Enchanter', 3, [AEGO, KEI], { level: lvl }),
      raider('Brackwyn', 'Warrior', 3, [AEGO, ATK, RES, DS]),
      raider('Rethlan', 'Monk', 3, [AEGO, ATK, RES, DS]),
    ]), 3), 'haste').casters.map(x => x.spell);
    expect(at(65)).toEqual(["Vallon's Quickening"]);
    expect(at(62)).toEqual(['Speed of the Brood']);
    expect(at(null)).toEqual(["Vallon's Quickening"]);
    expect(at(55)).toEqual([]);   // too low for any group haste: not named as a caster
  });
});

// ── two raids at once ────────────────────────────────────────────────────────
describe('two raids both have a group 1', () => {
  const NOW = Date.parse('2026-10-04T01:00:00Z');
  const at = (secAgo) => new Date(NOW - secAgo * 1000).toISOString();
  const upload = (uploader, leader, others) => [
    { name: leader, rank: 'Raid Leader', uploaded_by_discord_id: uploader, captured_at: at(20) },
    ...others.map((n) => ({ name: n, rank: null, uploaded_by_discord_id: uploader, captured_at: at(20) })),
  ];
  const ROSTER = [
    ...upload('u1', 'Aldenmar', ['Brackwyn', 'Corvale', 'Rethlan']),
    ...upload('u2', 'Zarrin', ['Nyssara', 'Tamsk', 'Velka', 'Ilsa']),
  ];
  const split = splitRaids(ROSTER, NOW);
  const mine = (name, cls, group, buffs) => {
    const uploader = ROSTER.find(r => r.name === name).uploaded_by_discord_id;
    return raider(name, cls, group, buffs, { raidKey: split.keyFor(name, uploader) });
  };

  it('labels each raid by its leader, biggest first', () => {
    expect(split.multi).toBe(true);
    expect(split.raids.map(r => r.label)).toEqual(['Raid 1 — Zarrin (5)', 'Raid 2 — Aldenmar (4)']);
  });
  it('keeps the two group 1s apart, each with only its own members', () => {
    const s = buildBuffGroups([
      mine('Aldenmar', 'Warrior', 1, without(FULL.tank, VOG)),
      mine('Brackwyn', 'Monk', 1, without(FULL.melee, VOG)),
      mine('Corvale', 'Enchanter', 1, FULL.caster),
      mine('Rethlan', 'Cleric', 2, FULL.caster),
      mine('Zarrin', 'Warrior', 1, FULL.tank),
      mine('Nyssara', 'Monk', 1, without(FULL.melee, VOG)),
      mine('Tamsk', 'Rogue', 1, without(FULL.melee, VOG)),
      mine('Velka', 'Shaman', 2, FULL.caster),
      mine('Ilsa', 'Druid', 2, FULL.caster),
    ], split.raids);
    expect(s.map(x => x.label)).toEqual(['Raid 1 — Zarrin (5)', 'Raid 2 — Aldenmar (4)']);
    const [r1, r2] = s;
    expect(card([r1], 1).members.map(m => m.name).sort()).toEqual(['Nyssara', 'Tamsk', 'Zarrin']);
    expect(card([r2], 1).members.map(m => m.name).sort()).toEqual(['Aldenmar', 'Brackwyn', 'Corvale']);
    // raid 2's group-1 enchanter can cast for raid 2's group 1, and raid 1's group 1 has none
    expect(line(card([r2], 1), 'haste').casters.map(c => c.name)).toEqual(['Corvale']);
    expect(line(card([r1], 1), 'haste').casters).toEqual([]);
  });
  it('a member no live raid claims goes in a trailing section, not into somebody\'s raid', () => {
    const lost = raider('Orrin', 'Monk', 1, without(FULL.melee, VOG), { raidKey: split.keyFor('Orrin', 'nobody') });
    const s = buildBuffGroups([mine('Aldenmar', 'Warrior', 1, FULL.tank), lost], split.raids);
    expect(s.map(x => x.label)).toEqual(['Raid 2 — Aldenmar (4)', UNPLACED_LABEL]);
    expect(s[1].groups[0].members.map(m => m.name)).toEqual(['Orrin']);
  });
  it('one raid → no raid labels at all', () => {
    const one = splitRaids(upload('u1', 'Aldenmar', ['Brackwyn']), NOW);
    expect(one.multi).toBe(false);
    expect(one.raids).toEqual([]);
    expect(one.keyFor('Brackwyn', 'u1')).toBe(null);
  });
  it('an empty raid → no sections', () => {
    expect(buildBuffGroups([], split.raids)).toEqual([]);
    expect(buildBuffGroups([])).toEqual([]);
  });
});

// ── ?v=c, the same data by buff line ─────────────────────────────────────────
describe('buff lines', () => {
  const sec = buildBuffGroups(raid())[0];
  const view = buildLineView(sec);
  it('sections run most missing first', () => {
    const totals = view.lines.map(l => l.total);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
    expect(view.lines[0].key).toBe('haste');
    expect(view.lines[0].total).toBe(6);   // Brackwyn, Rethlan, Nyssara (G3), Tamsk, Velka (G5), Orrin (no group)
  });
  it('groups with 2+ missing get a row; the rest are stragglers after them', () => {
    const haste = view.lines.find(l => l.key === 'haste');
    expect(haste.rows.map(r => r.group)).toEqual([3, 5]);
    expect(haste.rows[0].missing).toEqual(['Brackwyn', 'Nyssara', 'Rethlan']);
    expect(haste.rows[0].casters.map(c => c.name)).toEqual(['Corvale']);
    expect(haste.rows[1].casters).toEqual([]);                          // group 5: no caster note
    expect(haste.stragglers).toEqual([{ name: 'Orrin', group: null }]);
  });
  it('a single short member in a group is a straggler tagged with their group', () => {
    const s = buildBuffGroups([
      raider('Brackwyn', 'Warrior', 4, without(FULL.tank, VOG)),
      raider('Rethlan', 'Monk', 7, without(FULL.melee, VOG)),
    ])[0];
    const haste = buildLineView(s).lines.find(l => l.key === 'haste');
    expect(haste.rows).toEqual([]);
    expect(haste.stragglers).toEqual([{ name: 'Brackwyn', group: 4 }, { name: 'Rethlan', group: 7 }]);
  });
  it('lines with nothing missing are "covered"; lines no role expects are untracked, not covered', () => {
    expect(view.covered).toContain('hp:A');
    expect(view.covered).not.toContain('haste');
    expect(view.untracked).toEqual(['runSpeed']);
    expect(view.covered).not.toContain('runSpeed');
  });
  it('labels come from one table', () => {
    expect(LINE_LABELS['hp:B']).toBe('HP B (Symbol)');
    expect(LINE_LABELS.ds).toBe('Dmg Shield');
    expect(Object.keys(LINE_LABELS).sort()).toEqual([...LINE_ORDER].sort());
  });
});

// ── the GROUP_SPELLS table ───────────────────────────────────────────────────
// Ids and names were read back from eqemu_spells (targettype 41 group; Kazad`s Mark is 3) on 2026-10-04.
describe('GROUP_SPELLS', () => {
  const IDS = {
    'hp:A': { cleric: [3479, 2122, 2510] },
    'hp:B': { cleric: [3047, 2893, 1774] },
    'hp:C': { shaman: [3397, 2530], paladin: [2590] },
    haste: { enchanter: [3178, 2895] },
    manaRegen: { enchanter: [2570, 1695, 1694], beastlord: [3460] },
    runSpeed: { druid: [3185, 169], shaman: [2524] },
    attack: { ranger: [3417, 1464], beastlord: [3456] },
    ds: { druid: [1561, 1727], magician: [3486, 1669, 1668] },
    resists: { druid: [2519], enchanter: [72] },
  };
  it('holds exactly the verified spells, best first within each class', () => {
    const got = {};
    for (const [key, list] of Object.entries(GROUP_SPELLS)) {
      got[key] = {};
      for (const s of list) (got[key][s.cls] ||= []).push(s.id);
    }
    expect(got).toEqual(IDS);
  });
  it('is the same table as the bot\'s (utils/raidBuffs.js), entry for entry, so the page and the buff queue name the same caster spells', async () => {
    const { createRequire } = await import('node:module');
    const bot = createRequire(import.meta.url)('../utils/raidBuffs.js').GROUP_SPELLS;
    expect(GROUP_SPELLS).toEqual(bot);
  });
  it('class keys are lower-case, ids are unique across the table', () => {
    const all = Object.values(GROUP_SPELLS).flat();
    for (const s of all) expect(s.cls).toBe(s.cls.toLowerCase());
    expect(new Set(all.map(s => s.id)).size).toBe(all.length);
  });
  it('the page can READ every one: each spell categorizes into the line it is the group version of', () => {
    for (const [key, list] of Object.entries(GROUP_SPELLS)) {
      for (const s of list) {
        if (key.startsWith('hp:')) {
          expect(categorizeBuff(s.spell), s.spell).toBe('hp');
          expect(analyzeHpSlots([s.spell])[key.slice(3)], s.spell).toBe(s.spell);
        } else {
          expect(categorizeBuff(s.spell), s.spell).toBe(key);
        }
      }
    }
  });
});

// ── keyword gaps closed in web/lib/buffs.ts (each verified against eqemu_spells) ─
describe('buff keyword additions', () => {
  const CASES = [
    // [buff name, category, HP slot it fills (if hp)]
    ["Marzin's Mark", 'hp', 'B'], ["Naltron's Mark", 'hp', 'B'], ['Kazad`s Mark', 'hp', 'B'], ["Kazad's Mark", 'hp', 'B'],
    ['Focus of the Seventh', 'hp', 'C'],
    ["Vallon's Quickening", 'haste'], ['Speed of the Brood', 'haste'],
    ['Spirit of Bih`Li', 'runSpeed'], ['Spirit of Eagle', 'runSpeed'], ['Flight of Eagles', 'runSpeed'],
    ['Spirit of the Predator', 'attack'], ['Call of the Predator', 'attack'], ['Spiritual Vigor', 'attack'],
    ['Spiritual Dominion', 'manaRegen'], ['Boon of the Clear Mind', 'manaRegen'], ['Gift of Pure Thought', 'manaRegen'],
    ['Maelstrom of Ro', 'ds'], ['Aegis of Ro', 'ds'],
  ];
  for (const [name, cat, slot] of CASES) {
    it(`${name} → ${cat}${slot ? ' slot ' + slot : ''}`, () => {
      expect(categorizeBuff(name)).toBe(cat);
      if (slot) expect(analyzeHpSlots([name])[slot]).toBe(name);
    });
  }
  it('Talisman of the Brute stays out of attack (it is stamina only, SPA 7)', () => {
    expect(categorizeBuff('Talisman of the Brute')).not.toBe('attack');
  });
  it('the old names still land where they did', () => {
    expect(categorizeBuff('Aegolism')).toBe('hp');
    expect(categorizeBuff('Symbol of Marzin')).toBe('hp');
    expect(analyzeHpSlots(['Symbol of Marzin']).B).toBe('Symbol of Marzin');
    expect(categorizeBuff('Spirit of Wolf')).toBe('runSpeed');
    expect(categorizeBuff('Visions of Grandeur')).toBe('haste');
    expect(categorizeBuff('Clarity')).toBe('manaRegen');
  });
  it('a raider carrying the new group buffs is no longer "missing" those lines', () => {
    const m = raider('Rethlan', 'Monk', 1, [AEGO, 'Focus of the Seventh', "Vallon's Quickening", 'Spirit of the Predator', RES]);
    expect(missingLinesFor(m)).toEqual([]);
    const sym = raider('Zarrin', 'Wizard', 1, ["Marzin's Mark", 'Ancient: Gift of Aegolism', KHURA, KEI, RES]);
    expect(missingLinesFor(sym)).toEqual([]);
  });
});

// ── page wiring (source text, comments stripped) ─────────────────────────────
describe('/buffs page wiring', () => {
  const page = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/buffs/page.tsx'), 'utf8'));
  it('?v=b and ?v=c select the group layouts, anything else is the classic grid', () => {
    expect(page).toMatch(/v === 'b' \|\| v === 'c' \? v : null/);
    expect(page.indexOf('<BuffGroupsView')).toBeGreaterThan(-1);
    expect(page.indexOf('<BuffGroupsView')).toBeLessThan(page.indexOf('<BuffsGrid'));
  });
  it('the classic grid is still rendered with the same props', () => {
    expect(page).toContain('<BuffsGrid rows={rows} categories={categories} spellIds={spellIds} />');
  });
  it('the roster map takes the freshest row, not the last', () => {
    expect(page).toContain('freshestByName(rosterClean)');
    expect(page).not.toMatch(/\.map\(r => \[r\.name\.toLowerCase\(\), r\]\)/);
  });
  it('the roster query now carries what the raid split needs', () => {
    expect(page).toMatch(/select\('name, class, group_num, level, rank, captured_at, uploaded_by_discord_id'\)/);
  });
  it('the default sign-in redirect is unchanged', () => {
    expect(page).toContain("'/auth/signin?next=/buffs'");
  });
});
