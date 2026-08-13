// test/fight-curve.test.js — the arithmetic behind the fight damage curve.
//
// A wrong chart still renders. Every failure this pins produces a plausible
// picture, which is exactly why it needs tests rather than a look:
//   • pets counted as their own contributor (double-billing the meter);
//   • gaps interpolated instead of zeroed (a lull reads as steady damage);
//   • the MT lane extending across a stretch where nobody was being hit
//     (inventing continuity over a mez/gate — a real mechanic, hidden);
//   • the stack not summing to the fight total, which breaks the ONE-AXIS
//     premise the whole chart rests on (top edge == HP removed).
//
// Run: npx vitest run test/fight-curve.test.js

import { describe, it, expect } from 'vitest';
import { buildFightCurve, mainTankLane, attributedName, observedHpSeries, TOP_N }
  from '../web/lib/fightCurve.ts';

const row = (t, name, dmg, took = 0, pet_owner = null) =>
  ({ t_sec: t, char_name: name, pet_owner, dmg_delta: dmg, took_delta: took });

describe('attribution', () => {
  it('folds a pet under its owner', () => {
    expect(attributedName(row(0, 'a pet', 10, 0, 'Hitya'))).toBe('Hitya');
    expect(attributedName(row(0, 'Hitya', 10))).toBe('Hitya');
  });

  it('sums pet damage into the owner band rather than making a second band', () => {
    const c = buildFightCurve([
      row(0, 'Hitya', 100), row(0, 'a pet', 50, 0, 'Hitya'),
    ], 5);
    expect(c.bands).toHaveLength(1);
    expect(c.bands[0].name).toBe('Hitya');
    expect(c.bands[0].total).toBe(150);
  });

  it('keeps damage TAKEN on the real character — a pet tanking is not the owner tanking', () => {
    const c = buildFightCurve([
      row(0, 'a pet', 0, 900, 'Hitya'), row(0, 'Abrahms', 0, 100),
    ], 5);
    expect(c.mt[0].name).toBe('a pet');
  });
});

describe('bucketing', () => {
  it('places gaps as ZERO, not as interpolation', () => {
    // Damage at t=0 and t=30 with nothing between. The cumulative series must
    // be flat across the gap; a chart that slopes through it is claiming damage
    // that never happened.
    const c = buildFightCurve([row(0, 'A', 100), row(30, 'A', 100)], 5);
    expect(c.buckets).toEqual([0, 5, 10, 15, 20, 25, 30]);
    expect(c.bands[0].cum).toEqual([100, 100, 100, 100, 100, 100, 200]);
  });

  it('is cumulative and monotonic', () => {
    const c = buildFightCurve([row(0, 'A', 10), row(5, 'A', 10), row(10, 'A', 10)], 5);
    expect(c.bands[0].cum).toEqual([10, 20, 30]);
  });

  it('survives an empty fight without throwing', () => {
    const c = buildFightCurve([], 5);
    expect(c).toEqual({ buckets: [], bands: [], totalDamage: 0, mt: [], everyone: [] });
  });
});

describe('the ONE-AXIS premise', () => {
  it('bands sum to the fight total at the last bucket', () => {
    // The top edge of the stack IS the HP-removed curve. If the bands do not
    // sum to totalDamage the two series stop sharing an axis and the chart is
    // silently a dual-axis chart again.
    const rows = [];
    for (let t = 0; t <= 50; t += 5) {
      rows.push(row(t, 'A', 10), row(t, 'B', 6), row(t, 'C', 4));
    }
    const c = buildFightCurve(rows, 5);
    const last = c.bands.reduce((sum, b) => sum + b.cum[b.cum.length - 1], 0);
    expect(last).toBe(c.totalDamage);
    expect(c.totalDamage).toBe(11 * 20);
  });
});

describe('top-N folding', () => {
  it(`keeps ${TOP_N} bands and folds the rest into one "others"`, () => {
    // A generated 8th hue is never the answer; the palette non-negotiable is
    // that overflow folds.
    const rows = [];
    for (let i = 0; i < TOP_N + 5; i++) rows.push(row(0, `P${i}`, 100 - i));
    const c = buildFightCurve(rows, 5);
    expect(c.bands).toHaveLength(TOP_N + 1);
    const other = c.bands[c.bands.length - 1];
    expect(other.isOther).toBe(true);
    expect(other.name).toBe('5 others');
    expect(c.everyone).toHaveLength(TOP_N + 5);   // the search list keeps everybody
  });

  it('orders bands by total damage, largest first', () => {
    const c = buildFightCurve([row(0, 'small', 1), row(0, 'big', 100), row(0, 'mid', 50)], 5);
    expect(c.bands.map(b => b.name)).toEqual(['big', 'mid', 'small']);
  });

  it('does not create an "others" band when everyone fits', () => {
    const c = buildFightCurve([row(0, 'A', 5), row(0, 'B', 4)], 5);
    expect(c.bands.some(b => b.isOther)).toBe(false);
  });
});

describe('MT lane', () => {
  const lane = (perBucket, step = 5) =>
    mainTankLane(perBucket.map(m => new Map(Object.entries(m))),
                 perBucket.map((_, i) => i * step), step);

  it('run-length-encodes a stable tank into ONE segment', () => {
    const segs = lane([{ Abrahms: 100 }, { Abrahms: 90 }, { Abrahms: 80 }]);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ name: 'Abrahms', fromSec: 0, toSec: 15 });
    expect(segs[0].took).toBe(270);
  });

  it('splits when the boss switches target', () => {
    const segs = lane([{ Abrahms: 100 }, { Abrahms: 100 }, { Syko: 100 }]);
    expect(segs.map(s => s.name)).toEqual(['Abrahms', 'Syko']);
    expect(segs[0].toSec).toBe(10);
    expect(segs[1].fromSec).toBe(10);
  });

  it('leaves a HOLE where nobody took damage instead of extending the tank', () => {
    // The boss being off everyone (mez, gate, a pause) is a mechanic. Bridging
    // it would erase the thing worth seeing.
    const segs = lane([{ Abrahms: 100 }, {}, { Abrahms: 100 }]);
    expect(segs).toHaveLength(2);
    expect(segs[0].toSec).toBe(5);
    expect(segs[1].fromSec).toBe(10);
  });

  it('picks the largest riser, not the first seen', () => {
    expect(lane([{ Alpha: 10, Zeta: 999 }])[0].name).toBe('Zeta');
  });
});

describe('observed HP series', () => {
  const t0 = '2026-08-13T00:00:00Z';

  it('converts timestamps to seconds from fight start and sorts', () => {
    const s = observedHpSeries([
      { at: '2026-08-13T00:00:30Z', hp_pct: 50 },
      { at: '2026-08-13T00:00:10Z', hp_pct: 90 },
    ], t0, 60);
    expect(s).toEqual([{ tSec: 10, pct: 90 }, { tSec: 30, pct: 50 }]);
  });

  it('drops readings outside the fight and impossible percentages', () => {
    const s = observedHpSeries([
      { at: '2026-08-13T00:10:00Z', hp_pct: 50 },   // long after the fight
      { at: '2026-08-12T23:59:00Z', hp_pct: 50 },   // before it started
      { at: '2026-08-13T00:00:10Z', hp_pct: 140 },  // impossible
      { at: '2026-08-13T00:00:20Z', hp_pct: null }, // no reading
      { at: '2026-08-13T00:00:30Z', hp_pct: 25 },   // the only good one
    ], t0, 60);
    expect(s).toEqual([{ tSec: 30, pct: 25 }]);
  });

  it('returns nothing rather than throwing on a bad start time', () => {
    expect(observedHpSeries([{ at: t0, hp_pct: 50 }], 'not-a-date', 60)).toEqual([]);
  });
});
