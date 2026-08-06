// Clock-offset correction at ingest (R1).
//
// The bug, from the 2026-08-06 raid: Fargan's install reads ~63s behind, so his
// copy of a SHARED death landed 63s later than everyone else's. Death dedup
// collapses sightings within 30s, 63 > 30, so his copy escaped as a phantom
// second death and the parse card overcounted.
//
// The last describe() is the one that matters — it drives the real
// dedupParseDeaths over a real multi-observer fight and asserts the overcount
// is gone. The unit tests above it exist to say WHY when that one breaks.
//
// Run: npx vitest run test/clock-offset-ingest.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const clock = require('../utils/clockOffset.js');
const { dedupParseDeaths } = require('../utils/parseDeaths.js');

const NOW = Date.parse('2026-08-06T21:15:00.000Z');
const iso = ms => new Date(ms).toISOString();

// Fargan's real row, 2026-08-06.
const FARGAN = {
  offset_ms: 63541, samples: 364, spread_ms: 10333,
  last_sample_at: iso(NOW - 60_000),
};

describe('trustedOffsetMs gates', () => {
  it('accepts the row this was built for', () => {
    expect(clock.trustedOffsetMs(FARGAN, NOW)).toBe(63541);
  });

  it('accepts a 10.3s spread — the fleet median is 7.2s, so a tight gate would reject the broken machine', () => {
    // Guards the calibration decision, not just the comparison: 15 of 28
    // installs measured above 5s spread. A 5s gate reads as "conservative" and
    // would have made this whole change a no-op for its own motivating case.
    expect(clock.trustedOffsetMs({ ...FARGAN, spread_ms: 10_333 }, NOW)).toBe(63541);
    expect(clock.trustedOffsetMs({ ...FARGAN, spread_ms: 30_000 }, NOW)).toBe(63541);
    expect(clock.trustedOffsetMs({ ...FARGAN, spread_ms: 30_001 }, NOW)).toBe(0);
  });

  it('ignores an offset too small to have broken anything', () => {
    // Dedup already absorbs anything under 30s; correcting a 4.9s clock is
    // risk without benefit.
    expect(clock.trustedOffsetMs({ ...FARGAN, offset_ms: 4_999 }, NOW)).toBe(0);
    expect(clock.trustedOffsetMs({ ...FARGAN, offset_ms: 5_000 }, NOW)).toBe(5_000);
    expect(clock.trustedOffsetMs({ ...FARGAN, offset_ms: -5_000 }, NOW)).toBe(-5_000);  // signed both ways
  });

  it('ignores an under-sampled row', () => {
    expect(clock.trustedOffsetMs({ ...FARGAN, samples: 9 }, NOW)).toBe(0);
    expect(clock.trustedOffsetMs({ ...FARGAN, samples: 10 }, NOW)).toBe(63541);
  });

  it('ignores a stale row — a clock we have not heard from is not a claim', () => {
    const old = { ...FARGAN, last_sample_at: iso(NOW - 6 * 3600_000 - 1) };
    expect(clock.trustedOffsetMs(old, NOW)).toBe(0);
    expect(clock.trustedOffsetMs({ ...FARGAN, last_sample_at: iso(NOW - 6 * 3600_000 + 1) }, NOW)).toBe(63541);
  });

  it('yields 0 for anything malformed rather than guessing', () => {
    for (const bad of [null, undefined, 42, 'nope', {},
                       { ...FARGAN, offset_ms: 'x' },
                       { ...FARGAN, samples: null },
                       { ...FARGAN, spread_ms: undefined },
                       { ...FARGAN, last_sample_at: 'not a date' }]) {
      expect(clock.trustedOffsetMs(bad, NOW)).toBe(0);
    }
  });
});

describe('applyClockOffsetToDeaths', () => {
  const deaths = [{ name: 'Syko', ts: '2026-08-06T21:10:00.000Z', class: 'Warrior' }];

  it('ADDS the offset — a clock reading behind produces a later real time', () => {
    // The sign is the whole correctness of this feature. offset_ms is
    // server-minus-client: positive means the install reads EARLY.
    const [d] = clock.applyClockOffsetToDeaths(deaths, 63541);
    expect(d.ts).toBe('2026-08-06T21:11:03.541Z');
    expect(Date.parse(d.ts) - Date.parse(deaths[0].ts)).toBe(63541);
  });

  it('keeps the original as tsRaw and records how it was corrected', () => {
    const [d] = clock.applyClockOffsetToDeaths(deaths, 63541);
    expect(d.tsRaw).toBe('2026-08-06T21:10:00.000Z');
    expect(d.clockOffsetMs).toBe(63541);
    expect(d.clockOffsetMethod).toBe('pulse');
    expect(d.class).toBe('Warrior');           // unrelated fields survive
  });

  it('does not mutate the caller\'s rows', () => {
    const input = [{ name: 'Syko', ts: '2026-08-06T21:10:00.000Z' }];
    clock.applyClockOffsetToDeaths(input, 63541);
    expect(input[0].ts).toBe('2026-08-06T21:10:00.000Z');
    expect(input[0].tsRaw).toBeUndefined();
  });

  it('accepts numeric ts as well as ISO', () => {
    const [d] = clock.applyClockOffsetToDeaths([{ name: 'Syko', ts: NOW }], 63541);
    expect(Date.parse(d.ts)).toBe(NOW + 63541);
    expect(d.tsRaw).toBe(NOW);
  });

  it('passes everything through untouched at offset 0', () => {
    const input = [{ name: 'Syko', ts: '2026-08-06T21:10:00.000Z' }];
    expect(clock.applyClockOffsetToDeaths(input, 0)).toBe(input);   // same reference
    expect(clock.applyClockOffsetToDeaths(input, NaN)).toBe(input);
  });

  it('leaves unparseable or missing stamps alone instead of inventing one', () => {
    const rows = clock.applyClockOffsetToDeaths(
      [{ name: 'A', ts: 'garbage' }, { name: 'B' }, { name: 'C', ts: null }, null], 63541);
    expect(rows[0].ts).toBe('garbage');
    expect(rows[0].tsRaw).toBeUndefined();
    expect(rows[1].ts).toBeUndefined();
    expect(rows[2].ts).toBeNull();
    expect(rows[3]).toBeNull();
  });

  it('survives non-array input', () => {
    expect(clock.applyClockOffsetToDeaths(null, 63541)).toEqual([]);
    expect(clock.applyClockOffsetToDeaths([], 63541)).toEqual([]);
  });
});

describe('the actual bug: a skewed observer no longer doubles a death', () => {
  // One death. Three people saw it. Two clocks are fine, Fargan's reads 63.5s
  // behind, so his copy is stamped 63.5s early.
  const T = Date.parse('2026-08-06T21:10:00.000Z');
  const sighting = (tsMs) => [{ name: 'Syko', ts: iso(tsMs), class: 'Warrior' }];

  const uilnayar = sighting(T);
  const dant     = sighting(T + 1_200);          // normal parser jitter
  const fargan   = sighting(T - 63_541);         // his clock, uncorrected

  it('reproduces the overcount when the skew is left in', () => {
    // If this ever stops failing, the fixture no longer models the bug and the
    // test below proves nothing.
    const rows = dedupParseDeaths([uilnayar, dant, fargan]);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);              // ← the reported symptom
  });

  it('collapses to a single death once Fargan is corrected at ingest', () => {
    const corrected = clock.applyClockOffsetToDeaths(fargan, 63541);
    const rows = dedupParseDeaths([uilnayar, dant, corrected]);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(1);
    expect(rows[0].class).toBe('Warrior');
  });

  it('still separates a genuine rez-and-die-again', () => {
    // The reason widening DEATH_DEDUP_MS to ~63s was never an option: it would
    // swallow this too. Correcting the clock keeps real second deaths visible.
    const rezDeath = sighting(T + 5 * 60_000);
    const rows = dedupParseDeaths([
      uilnayar, dant,
      clock.applyClockOffsetToDeaths(fargan, 63541),
      rezDeath,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);              // two real deaths, not one
  });

  it('a same-fight phantom NPC namesake is still suppressed', () => {
    // Correction must not disturb rule 1 — one contributor reporting a name
    // twice discredits it for the whole fight.
    const namesake = [{ name: 'Syphon', ts: iso(T) }, { name: 'Syphon', ts: iso(T + 90_000) }];
    const rows = dedupParseDeaths([uilnayar, clock.applyClockOffsetToDeaths(namesake, 63541)]);
    expect(rows.map(r => r.name)).toEqual(['Syko']);
  });
});
