// test/raid-guide.test.js — #81 Wolf Pack Raid Guide pure kernel.
//
// Real-imports web/lib/raidGuide.ts (the raidReview.ts pattern). Every fixture
// below is REAL production data queried on 2026-08-02, not invented — the whole
// point of these tests is that the rules produce the right answer on the case
// that motivated them. Design + provenance: docs/DESIGN-81-raid-guide.md.

import { describe, it, expect } from 'vitest';
import {
  normalizeNpcName,
  resolveCatalogRow,
  hpCorroboration,
  median,
  bucketEncounters,
  killStats,
  attributeLoot,
  pairwiseOrder,
  precedence,
  staleFacts,
  STALE_REL_DELTA,
} from '../web/lib/raidGuide.ts';

// ── Real catalog rows: the shell vs the live row (§6.1) ──────────────────────
// encounters.npc_id for every Emperor fight is 162065 — the SHELL.
const SHELL = {
  id: 162065, name: '#Emperor_Ssraeshza', level: 66,
  hp: 1000000, ac: 200, mindmg: 7, maxdmg: 134,
  mr: 26, fr: 26, cr: 26, dr: 26, pr: 26,
  class: 1, race: 217, runspeed: 0,
  npc_spells_id: 0, loottable_id: 0, npcspecialattks: null,
};
const LIVE = {
  id: 162491, name: 'Emperor_Ssraeshza_', level: 66,
  hp: 1250000, ac: 700, mindmg: 283, maxdmg: 904,
  mr: 1000, fr: 60, cr: 75, dr: 150, pr: 1000,
  class: 1, race: 217, runspeed: 0,
  npc_spells_id: 227, loottable_id: 12791, npcspecialattks: null,
};

describe('normalizeNpcName', () => {
  it('collapses the eqemu # / _ conventions so siblings compare equal', () => {
    expect(normalizeNpcName('#Emperor_Ssraeshza')).toBe('emperor ssraeshza');
    expect(normalizeNpcName('Emperor_Ssraeshza_')).toBe('emperor ssraeshza');
    expect(normalizeNpcName('#a_glyph_covered_serpent')).toBe('a glyph covered serpent');
    expect(normalizeNpcName(null)).toBe('');
  });
});

describe('resolveCatalogRow — the #171 pick-and-merge', () => {
  it('picks the LIVE row over the shell that encounters.npc_id points at', () => {
    const r = resolveCatalogRow([SHELL, LIVE], 162065);
    expect(r).not.toBeNull();
    expect(r.primaryId).toBe(162491);
    expect(r.usedFallbackRow).toBe(true);
    // The facts a guide page would otherwise render fictionally:
    expect(r.row.hp).toBe(1250000);
    expect(r.row.ac).toBe(700);
    expect(r.row.mindmg).toBe(283);
    expect(r.row.maxdmg).toBe(904);
    expect(r.row.mr).toBe(1000);
    expect(r.row.loottable_id).toBe(12791);
    expect(r.row.npc_spells_id).toBe(227);
  });

  it('is order-independent (shell first or live first, same answer)', () => {
    const a = resolveCatalogRow([SHELL, LIVE], 162065);
    const b = resolveCatalogRow([LIVE, SHELL], 162065);
    expect(b.primaryId).toBe(a.primaryId);
    expect(b.row).toEqual(a.row);
  });

  it('keeps runspeed 0 — a real value, not a missing one (Emperor does not move)', () => {
    const r = resolveCatalogRow([LIVE, { ...SHELL, runspeed: 1.25 }], 162065);
    expect(r.row.runspeed).toBe(0);
  });

  it('fills a gap from the lower-scoring row rather than dropping the field', () => {
    const partial = { ...LIVE, npcspecialattks: null };
    const withFlags = { ...SHELL, npcspecialattks: 'SERU' };
    const r = resolveCatalogRow([partial, withFlags], 162065);
    expect(r.row.npcspecialattks).toBe('SERU');
    expect(r.mergedFrom).toEqual([162491, 162065]);
  });

  it('does not claim a fallback when the keyed row IS the best one', () => {
    const r = resolveCatalogRow([LIVE], 162491);
    expect(r.usedFallbackRow).toBe(false);
    expect(r.mergedFrom).toEqual([162491]);
  });

  it('returns null with nothing to resolve', () => {
    expect(resolveCatalogRow([], 1)).toBeNull();
    expect(resolveCatalogRow(null, 1)).toBeNull();
  });
});

describe('hpCorroboration — our own parses pick the catalog row', () => {
  const MEDIAN_DAMAGE = 1211014;                 // real: median of Emperor complete kills

  it('agrees with the LIVE row (96.9% of 1.25M)', () => {
    const c = hpCorroboration(MEDIAN_DAMAGE, LIVE.hp);
    expect(c.agrees).toBe(true);
    expect(c.verdict).toBe('agrees');
    expect(Math.round(c.ratio * 1000) / 10).toBeCloseTo(96.9, 1);
  });

  it('flags the SHELL row as understated (121% of 1.0M is impossible)', () => {
    const c = hpCorroboration(MEDIAN_DAMAGE, SHELL.hp);
    expect(c.agrees).toBe(false);
    expect(c.verdict).toBe('over');
  });

  it('is null-safe on missing inputs', () => {
    expect(hpCorroboration(0, 1000)).toBeNull();
    expect(hpCorroboration(1000, 0)).toBeNull();
    expect(hpCorroboration(1000, null)).toBeNull();
  });
});

// ── Real Emperor engagement set (§6.2) ───────────────────────────────────────
// All 21 non-classified encounters on npc_id 162065, as stored.
const enc = (id, startedAt, dur, dmg, dps, players, ended = true) => ({
  id, started_at: startedAt, ended_at: ended ? startedAt : null,
  duration_sec: dur, total_damage: dmg, total_dps: dps,
  classification: null, player_count: players,
});
const EMPEROR = [
  enc('a', '2026-07-31T02:42:22Z', 1070, 1327143, 1242, 50),
  enc('b', '2026-07-23T03:00:53Z',  925, 1061369, 1146, 29),
  enc('c', '2026-07-13T02:52:06Z', 1270, 1008417,  794, 32),
  enc('d', '2026-07-03T02:37:55Z',  728, 1602826, 2606, 40),
  enc('e', '2026-06-25T02:38:53Z',  753, 1278542, 2241, 28),
  enc('f', '2026-06-15T02:18:13Z', 1458, 1246015, 1557, 23),
  enc('g', '2026-06-05T02:40:48Z', 1165, 1192846, 1025, 27),
  enc('h', '2026-05-28T02:34:57Z',    4,    8317, 2752, 21),   // abort
  enc('i', '2026-05-28T02:03:51Z', 1070, 1202161, 1123, 29),
  enc('j', '2026-05-18T02:39:06Z', 1436, 1210654,  842, 23),
  enc('k', '2026-05-18T01:00:00Z',  764,       0,    0,  0),   // timer-only, no parse
  enc('l', '2026-05-08T02:58:33Z',  190,  417394, 2196, 27),   // fragment
  enc('m', '2026-05-08T01:00:00Z',  394,       0,    0,  0),   // timer-only
  enc('n', '2026-04-30T03:08:32Z',  608, 1214484, 2028, 26),
  enc('o', '2026-03-30T01:50:17Z',    7,    2931,  417,  8),   // abort
  enc('p', '2026-03-12T01:35:35Z',   10,   23214, 2323, 23),   // abort
  enc('q', '2026-03-02T02:30:53Z',  454, 1211014, 2664, 33),
  enc('r', '2026-02-20T03:30:04Z', 1153, 1210691, 1049, 33),
  enc('s', '2026-02-12T02:38:15Z',  649, 1224417, 1889, 33),
  enc('t', '2026-01-19T03:46:52Z',   81,  198305, 2446, 31),   // fragment
  enc('u', '2026-01-09T03:22:21Z',   13,   27134, 2087, 21),   // abort
];

describe('bucketEncounters + killStats — the DAMAGE floor, not a duration floor', () => {
  const buckets = bucketEncounters(EMPEROR, LIVE.hp);
  const s = killStats(buckets);

  it('separates 13 complete kills out of 21 engagements', () => {
    expect(s.engagements).toBe(21);
    expect(s.completeKills).toBe(13);
    expect(s.noParse).toBe(2);
    // 2 damage-floor fragments + 4 sub-60s aborts all land in `fragments`
    expect(s.fragments).toBe(6);
  });

  it('rejects the 81s / 198k re-pull fragment that a 60s duration floor admits', () => {
    const ids = buckets.complete.map(e => e.id);
    expect(ids).not.toContain('t');            // 81s, 198,305 dmg
    expect(ids).not.toContain('l');            // 190s, 417,394 dmg
    expect(buckets.fragments.map(e => e.id)).toEqual(expect.arrayContaining(['t', 'l']));
  });

  it('reports the real fight envelope, not the fragment-poisoned one', () => {
    expect(s.medianDurationSec).toBe(1070);     // 17:50
    expect(s.minDurationSec).toBe(454);         // 7:34, not the fictional 81s
    expect(s.maxDurationSec).toBe(1458);        // 24:18
    expect(s.medianDamage).toBe(1211014);
    expect(s.maxDamage).toBe(1602826);
    expect(s.medianPlayers).toBe(29);
  });

  it('never counts an unconfirmed engagement or a classified row', () => {
    const withNoise = [
      ...EMPEROR,
      { ...enc('v', '2026-07-31T05:00:00Z', 900, 1200000, 1300, 30, false) },
      { ...enc('w', '2026-07-31T06:00:00Z', 900, 1200000, 1300, 30), classification: 'foreign' },
      { ...enc('x', '2026-07-31T07:00:00Z', 900, 1200000, 1300, 30), classification: 'wipe' },
    ];
    const b2 = bucketEncounters(withNoise, LIVE.hp);
    expect(b2.complete).toHaveLength(13);
    expect(b2.engaged).toHaveLength(1);
    expect(b2.excluded).toHaveLength(2);
  });

  it('falls back to a median-derived floor when no HP pool resolves', () => {
    const b3 = bucketEncounters(EMPEROR, null);
    expect(b3.floorSource).toBe('median-damage');
    expect(b3.complete.length).toBe(13);        // same answer, different route
  });

  it('handles an empty history without throwing', () => {
    const s0 = killStats(bucketEncounters([], LIVE.hp));
    expect(s0.engagements).toBe(0);
    expect(s0.medianDurationSec).toBeNull();
    expect(s0.medianDamage).toBeNull();
  });
});

describe('median', () => {
  it('averages the middle pair on even counts and skips non-numbers', () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, null, 1, undefined, 2])).toBe(2);
    expect(median([])).toBeNull();
  });
});

// ── Loot attribution (§6.3) ──────────────────────────────────────────────────
describe('attributeLoot — only sole-source items carry a price', () => {
  const drops = [
    { item_id: 26604, item_name: "Koadic's Robe of Heightened Focus" },  // sole
    { item_id: 21809, item_name: 'White Ornate Chain Bridle' },          // sole
    { item_id: 26564, item_name: 'Shield of Mental Fortitude' },         // sole
    { item_id: 7610,  item_name: 'Spell: Blessing of Aegolism' },        // shared
    { item_id: 7710,  item_name: 'Song: Warsong of the Vah Shir' },      // shared
  ];
  const dropperCounts = new Map([
    [26604, 1], [21809, 1], [26564, 1], [7610, 9], [7710, 6],
  ]);
  const awards = [
    { item_name: "Koadic's Robe of Heightened Focus", dkp: 550 },
    { item_name: "Koadic's Robe of Heightened Focus", dkp: 224 },
    { item_name: 'White Ornate Chain Bridle', dkp: 420 },
    { item_name: 'Spell: Blessing of Aegolism', dkp: 17 },   // must NOT price this boss
    { item_name: 'Song: Warsong of the Vah Shir', dkp: 42 },
  ];

  const { sole, shared } = attributeLoot(drops, dropperCounts, awards);

  it('splits sole-source from shared', () => {
    expect(sole.map(r => r.itemId).sort()).toEqual([21809, 26564, 26604]);
    expect(shared.map(r => r.itemId).sort()).toEqual([7610, 7710]);
  });

  it('prices only the sole-source rows, highest average first', () => {
    expect(sole.map(r => r.itemName)).toEqual([
      'White Ornate Chain Bridle',                 // avg 420
      "Koadic's Robe of Heightened Focus",         // avg 387
      'Shield of Mental Fortitude',                // never awarded
    ]);
    expect(sole[0].avgDkp).toBe(420);
    expect(sole[1].awards).toBe(2);
    expect(sole[1].avgDkp).toBe(387);              // (550+224)/2
    expect(sole[1].maxDkp).toBe(550);
  });

  it('never attaches another boss’s DKP to a shared drop', () => {
    for (const r of shared) {
      expect(r.awards).toBe(0);
      expect(r.avgDkp).toBeNull();
      expect(r.maxDkp).toBeNull();
    }
  });

  it('shows an un-awarded sole item with no price rather than hiding it', () => {
    const s = sole.find(r => r.itemId === 26564);
    expect(s.awards).toBe(0);
    expect(s.avgDkp).toBeNull();
  });
});

// ── Run order (§6.4) ─────────────────────────────────────────────────────────
describe('pairwiseOrder / precedence — average-slot ordering is wrong', () => {
  // Blood of Ssraeshza's DEATH spawns Emperor 2:00 later (agent
  // BOSS_SPAWN_CHAINS), so Blood must order first. Real shape: 8 shared nights,
  // Blood first on 6. Emperor also appears on 11 nights Blood was not recorded,
  // which is exactly what breaks an average-slot ranking.
  const kills = [];
  const day = (n) => `2026-05-${String(n).padStart(2, '0')}`;
  // 8 FULL-CLEAR nights: serpent + three filler names, then Blood, then Emperor
  // (reversed on 2 of them). Blood therefore sits LATE in the night.
  for (let i = 1; i <= 8; i++) {
    const bloodFirst = i <= 6;
    kills.push({ bossKey: 'serpent', night: day(i), at: `${day(i)}T00:10:00Z` });
    kills.push({ bossKey: 'fill1',   night: day(i), at: `${day(i)}T00:20:00Z` });
    kills.push({ bossKey: 'fill2',   night: day(i), at: `${day(i)}T00:30:00Z` });
    kills.push({ bossKey: 'fill3',   night: day(i), at: `${day(i)}T00:40:00Z` });
    kills.push({ bossKey: 'blood',   night: day(i), at: `${day(i)}T0${bloodFirst ? 1 : 3}:00:00Z` });
    kills.push({ bossKey: 'emperor', night: day(i), at: `${day(i)}T02:00:00Z` });
  }
  // 11 SHORT nights where only Emperor got recorded — a different sample era.
  // This is the average-slot poison: Emperor's mean slot collapses to ~2 while
  // Blood's stays ~5, so an average-slot ranking puts the boss BEFORE the boss
  // whose death spawns him.
  for (let i = 9; i <= 19; i++) {
    kills.push({ bossKey: 'serpent', night: day(i), at: `${day(i)}T00:10:00Z` });
    kills.push({ bossKey: 'emperor', night: day(i), at: `${day(i)}T05:00:00Z` });
  }

  it('precedence reports Blood first on 6 of 8 shared nights (75%)', () => {
    const p = precedence(kills, 'blood', 'emperor');
    expect(p.shared).toBe(8);
    expect(p.aFirst).toBe(6);
    expect(p.bFirst).toBe(2);
    expect(p.rate).toBeCloseTo(0.75, 5);
  });

  it('still orders Blood before Emperor despite Emperor having 19 nights to 8', () => {
    const order = pairwiseOrder(kills, 4).map(r => r.bossKey);
    expect(order[0]).toBe('serpent');
    expect(order.indexOf('blood')).toBeLessThan(order.indexOf('emperor'));
    expect(order[order.length - 1]).toBe('emperor');
  });

  it('naive average kill-slot gets it backwards — the bug this avoids', () => {
    const slots = new Map();
    const byNight = new Map();
    for (const k of kills) {
      const arr = byNight.get(k.night) || [];
      arr.push(k); byNight.set(k.night, arr);
    }
    for (const arr of byNight.values()) {
      arr.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      arr.forEach((k, i) => {
        const s = slots.get(k.bossKey) || { sum: 0, n: 0 };
        s.sum += i + 1; s.n += 1; slots.set(k.bossKey, s);
      });
    }
    const avg = (k) => slots.get(k).sum / slots.get(k).n;
    expect(avg('emperor')).toBeLessThan(avg('blood'));   // impossible, but that's average-slot
  });

  it('ignores pairs below the shared-night threshold', () => {
    const sparse = [
      { bossKey: 'a', night: '2026-05-01', at: '2026-05-01T01:00:00Z' },
      { bossKey: 'b', night: '2026-05-01', at: '2026-05-01T02:00:00Z' },
    ];
    const rows = pairwiseOrder(sparse, 4);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.confidence).toBe(0);
  });

  it('is safe on empty input', () => {
    expect(pairwiseOrder([])).toEqual([]);
    expect(precedence([], 'a', 'b')).toEqual({ aFirst: 0, bFirst: 0, shared: 0, rate: null });
  });
});

// ── Authored-note staleness (§5.3) ───────────────────────────────────────────
describe('staleFacts — flags, never rewrites', () => {
  it('trips when a watched scalar moves past the relative threshold', () => {
    const out = staleFacts(
      { medianDurationSec: 764, completeKills: 8 },
      { medianDurationSec: 1070, completeKills: 9 },
    );
    expect(out.map(o => o.key)).toEqual(['medianDurationSec']);
    expect(out[0].then).toBe(764);
    expect(out[0].now).toBe(1070);
    expect(out[0].delta).toBeGreaterThan(STALE_REL_DELTA);
  });

  it('uses the looser growth threshold for the sample size', () => {
    expect(staleFacts({ completeKills: 8 }, { completeKills: 11 })).toHaveLength(0);  // +37%
    expect(staleFacts({ completeKills: 8 }, { completeKills: 12 })).toHaveLength(1);  // +50%
  });

  it('says nothing when there is no snapshot, and never mutates the note', () => {
    expect(staleFacts(null, { medianDurationSec: 1070 })).toEqual([]);
    expect(staleFacts({ medianDurationSec: 764 }, null)).toEqual([]);
    const written = { medianDurationSec: 764 };
    staleFacts(written, { medianDurationSec: 1070 });
    expect(written).toEqual({ medianDurationSec: 764 });
  });

  it('ignores a zero baseline instead of dividing by it', () => {
    expect(staleFacts({ medianDamage: 0 }, { medianDamage: 1211014 })).toEqual([]);
  });
});
