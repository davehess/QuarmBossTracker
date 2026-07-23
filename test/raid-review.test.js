// test/raid-review.test.js — #80 Raid Night Review pure helpers.
//
// Real-imports the web lib (web/lib/raidReview.ts). The death dedup is a port of
// utils/parseDeaths.js (#134); we re-assert the load-bearing cases here so the
// review page's death count can't silently drift from the parse page. Also
// covers the slow-spell match + multi-observer collapse and the Eastern-day →
// UTC window math the single-night queries depend on.

import { describe, it, expect } from 'vitest';
import {
  dedupEncounterDeaths,
  DEATH_DEDUP_MS,
  isSlowSpell,
  dedupeSlows,
  zonedDayRangeUtc,
  isValidDateKey,
} from '../web/lib/raidReview.ts';

describe('dedupEncounterDeaths — matches the #134 parse-page logic', () => {
  it('collapses three parsers each seeing the same six deaths once → each ×1', () => {
    const names = ['Kebarer', 'Gabekn', 'Gibobab', 'Melting', 'Gonobtik', 'Vebober'];
    const contrib = (skewSec) => names.map((n, i) => ({
      name: n,
      ts: new Date(Date.parse('2026-07-22T01:00:00Z') + i * 5000 + skewSec * 1000).toISOString(),
    }));
    const out = dedupEncounterDeaths([contrib(0), contrib(1), contrib(2)]);
    expect(out).toHaveLength(6);
    for (const r of out) expect(r.count).toBe(1);
    expect(out.map(r => r.name)).toEqual(names);
  });

  it('drops a name any SINGLE contributor reported dying 2+ times (phantom NPC namesake)', () => {
    const c1 = [
      { name: 'Syphon', ts: '2026-07-22T01:00:00Z' },
      { name: 'Syphon', ts: '2026-07-22T01:03:00Z' },
      { name: 'Realtank', ts: '2026-07-22T01:02:00Z' },
    ];
    const c2 = [{ name: 'Realtank', ts: '2026-07-22T01:02:01Z' }];
    const out = dedupEncounterDeaths([c1, c2]);
    expect(out.map(r => r.name)).toEqual(['Realtank']);
    expect(out[0].count).toBe(1);
  });

  it('two DIFFERENT contributors reporting a death minutes apart → ×2', () => {
    const c1 = [{ name: 'Tanky', ts: '2026-07-22T01:00:00Z' }];
    const c2 = [{ name: 'Tanky', ts: '2026-07-22T01:05:00Z' }];
    const out = dedupEncounterDeaths([c1, c2]);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(2);
  });

  it('collapses sightings within the dedup window to ×1', () => {
    const c1 = [{ name: 'Tanky', ts: '2026-07-22T01:00:00Z' }];
    const c2 = [{ name: 'Tanky', ts: new Date(Date.parse('2026-07-22T01:00:00Z') + DEATH_DEDUP_MS - 1).toISOString() }];
    const out = dedupEncounterDeaths([c1, c2]);
    expect(out[0].count).toBe(1);
  });

  it('carries class through and ORs the riposte flag; tolerates malformed input', () => {
    const c1 = [{ name: 'Knightly', ts: '2026-07-22T01:00:00Z', class: 'Paladin', riposteDeath: false }];
    const c2 = [{ name: 'Knightly', ts: '2026-07-22T01:00:01Z', class: 'Paladin', riposteDeath: true }];
    const out = dedupEncounterDeaths([c1, c2]);
    expect(out[0].class).toBe('Paladin');
    expect(out[0].riposteDeath).toBe(true);
    expect(dedupEncounterDeaths(null)).toEqual([]);
    expect(dedupEncounterDeaths([[], [{ name: '' }], [null]])).toEqual([]);
  });
});

describe('isSlowSpell', () => {
  it('matches known slows case- and backtick-insensitively', () => {
    expect(isSlowSpell('Turgur\'s Insects')).toBe(true);
    expect(isSlowSpell('turgur`s insects')).toBe(true);   // EQ logs backtick possessives
    expect(isSlowSpell('Cripple')).toBe(true);
    expect(isSlowSpell('Rage of Ssraeshza')).toBe(true);
  });
  it('rejects non-slows and junk', () => {
    expect(isSlowSpell('Aegolism')).toBe(false);
    expect(isSlowSpell('')).toBe(false);
    expect(isSlowSpell(null)).toBe(false);
  });
});

describe('dedupeSlows', () => {
  it('keeps only slow spells, collapses multi-observer landings, sorts by time', () => {
    const t0 = '2026-07-22T02:00:00Z';
    const t0b = new Date(Date.parse(t0) + 2000).toISOString();   // same land, another observer
    const t1 = '2026-07-22T02:10:00Z';
    const rows = [
      { target: 'a sand giant', spell_name: 'Turgur\'s Insects', cast_at: t1, observer: 'Bob' },
      { target: 'a sand giant', spell_name: 'Turgur\'s Insects', cast_at: t0, observer: 'Ann' },
      { target: 'a sand giant', spell_name: 'Turgur\'s Insects', cast_at: t0b, observer: 'Cid' },
      { target: 'a sand giant', spell_name: 'Aegolism', cast_at: t0, observer: 'Ann' }, // not a slow → dropped
    ];
    const out = dedupeSlows(rows);
    expect(out.map(r => r.spell)).toEqual(['Turgur\'s Insects', 'Turgur\'s Insects']);
    expect(out[0].at).toBe(t0);   // earliest kept
    expect(out[1].at).toBe(t1);   // the later re-slow survives
  });
  it('tolerates empty / malformed', () => {
    expect(dedupeSlows(null)).toEqual([]);
    expect(dedupeSlows([null, { target: '', spell_name: 'Cripple', cast_at: 'x' }])).toEqual([]);
  });
});

describe('zonedDayRangeUtc', () => {
  it('spans exactly 24h for a US Eastern (EDT) summer day, starting at 04:00Z', () => {
    const { startIso, endIso } = zonedDayRangeUtc('2026-07-22', 'America/New_York');
    expect(startIso).toBe('2026-07-22T04:00:00.000Z'); // EDT = UTC-4
    expect(endIso).toBe('2026-07-23T04:00:00.000Z');
    expect(new Date(endIso).getTime() - new Date(startIso).getTime()).toBe(24 * 3600 * 1000);
  });
  it('uses the winter (EST, UTC-5) offset for a January day', () => {
    const { startIso } = zonedDayRangeUtc('2026-01-15', 'America/New_York');
    expect(startIso).toBe('2026-01-15T05:00:00.000Z');
  });
});

describe('isValidDateKey', () => {
  it('accepts real YYYY-MM-DD and rejects junk / impossible dates', () => {
    expect(isValidDateKey('2026-07-22')).toBe(true);
    expect(isValidDateKey('2026-13-01')).toBe(false);
    expect(isValidDateKey('2026-02-30')).toBe(false);
    expect(isValidDateKey('not-a-date')).toBe(false);
    expect(isValidDateKey('')).toBe(false);
    expect(isValidDateKey(null)).toBe(false);
  });
});

// ── Field-feedback round (2026-07-23): cross-encounter dedup, pet split, span ─
import {
  dedupNightDeaths,
  NIGHT_DEATH_DEDUP_MS,
  partitionDeaths,
  activitySpan,
  inSpan,
} from '../web/lib/raidReview.ts';

describe('dedupNightDeaths — "can\'t die twice in the same minute" across encounters', () => {
  it('collapses the same death claimed by two overlapping encounters (the Naggato 8:36 case)', () => {
    const rows = [
      { name: 'Naggato', ts: '2026-07-23T00:36:10Z', boss: 'a glyph covered serpent' },
      { name: 'Naggato', ts: '2026-07-23T00:36:12Z', boss: 'Vyzh`dra the Exiled' },
    ];
    const out = dedupNightDeaths(rows);
    expect(out).toHaveLength(1);
    expect(out[0].boss).toBe('a glyph covered serpent');   // earliest row's attribution kept
  });

  it('keeps a genuine rez-and-die >60s apart', () => {
    const rows = [
      { name: 'Syko', ts: '2026-07-23T00:39:00Z', boss: 'a glyph covered serpent' },
      { name: 'Syko', ts: '2026-07-23T00:46:30Z', boss: 'Vyzh`dra the Cursed' },
    ];
    expect(dedupNightDeaths(rows)).toHaveLength(2);
  });

  it('window boundary: exactly NIGHT_DEATH_DEDUP_MS apart collapses, +1ms survives', () => {
    const t0 = Date.parse('2026-07-23T01:00:00Z');
    const at = (ms) => new Date(t0 + ms).toISOString();
    expect(dedupNightDeaths([
      { name: 'A', ts: at(0) }, { name: 'A', ts: at(NIGHT_DEATH_DEDUP_MS) },
    ])).toHaveLength(1);
    expect(dedupNightDeaths([
      { name: 'B', ts: at(0) }, { name: 'B', ts: at(NIGHT_DEATH_DEDUP_MS + 1) },
    ])).toHaveLength(2);
  });

  it('different names in the same minute both survive', () => {
    expect(dedupNightDeaths([
      { name: 'Gonner', ts: '2026-07-23T00:56:00Z' },
      { name: 'Jarer', ts: '2026-07-23T00:56:05Z' },
    ])).toHaveLength(2);
  });
});

describe('partitionDeaths — pets (class-less) off the main timeline', () => {
  it('splits Xasaner-style class-less rows from classed players', () => {
    const { players, pets } = partitionDeaths([
      { name: 'Dongru', class: 'Shadow Knight' },
      { name: 'Xasaner', class: null },
      { name: 'Naggato', class: 'Paladin' },
      { name: 'Jarer', class: null },
      { name: 'Zonekab', class: null },
    ]);
    expect(players.map(p => p.name)).toEqual(['Dongru', 'Naggato']);
    expect(pets.map(p => p.name)).toEqual(['Xasaner', 'Jarer', 'Zonekab']);
  });

  it('empty/null input → empty partitions', () => {
    expect(partitionDeaths(null)).toEqual({ players: [], pets: [] });
  });
});

describe('activitySpan / inSpan — bound day-wide streams to the fight span', () => {
  const enc = (s, e) => ({ startMs: Date.parse(s), endMs: Date.parse(e) });

  it('daytime myconid slows fall outside the padded night span', () => {
    const span = activitySpan([
      enc('2026-07-23T00:30:00Z', '2026-07-23T00:36:00Z'),   // 8:30pm ET fight
      enc('2026-07-23T03:10:00Z', '2026-07-23T03:22:00Z'),   // 11:10pm ET fight
    ]);
    expect(span).not.toBeNull();
    expect(inSpan('2026-07-22T18:40:00Z', span)).toBe(false);   // 2:40pm ET myconid grinding
    expect(inSpan('2026-07-23T00:05:00Z', span)).toBe(true);    // 25min pre-first-kill (within 30m pad)
    expect(inSpan('2026-07-23T03:30:00Z', span)).toBe(true);    // 8min after last kill
    expect(inSpan('2026-07-23T05:00:00Z', span)).toBe(false);   // long after
  });

  it('no encounters → null span, and inSpan(null) is always false', () => {
    expect(activitySpan([])).toBeNull();
    expect(inSpan('2026-07-23T00:00:00Z', null)).toBe(false);
  });
});
