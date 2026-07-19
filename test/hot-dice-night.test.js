// test/hot-dice-night.test.js — #91 Hot Dice NIGHT award math.
//
// Real-imports the pure bot util (utils/hotDiceNight.js): merge multi-uploader
// roll_sets rows, rank each set's winner, and decide whether one character
// out-rolled everyone on >20% of the night's contested sets (with a ≥5-set
// floor). Determinism matters — the midnight chain upserts by the winner, so a
// re-run must pick the same one.

import { describe, it, expect } from 'vitest';
import { computeHotDiceNight, sessionWinner, mergeRollSetRows } from '../utils/hotDiceNight.js';

const base = Date.parse('2026-07-17T22:00:00.000Z');
// A contested set (≥2 rollers) with a chosen winner and topper value.
function set(offsetMin, from, to, rolls) {
  const startedAt = new Date(base + offsetMin * 60000).toISOString();
  return {
    roll_from: from, roll_to: to, started_at: startedAt, last_at: startedAt,
    rolls: rolls.map((r, i) => ({ name: r.name, value: r.value, at: new Date(base + offsetMin * 60000 + i * 1000).toISOString() })),
  };
}

describe('sessionWinner', () => {
  it('ranks by highest first-roll, ignoring re-rolls', () => {
    const s = {
      rolls: [
        { name: 'Grobnar', value: 40, atMs: base + 1000 },
        { name: 'Shavimo', value: 88, atMs: base + 2000 },
        { name: 'Grobnar', value: 99, atMs: base + 3000, reroll: true },  // re-roll: ignored
      ],
    };
    const w = sessionWinner(s);
    expect(w.winner).toBe('Shavimo');
    expect(w.rollers).toBe(2);
    expect(w.topValue).toBe(88);
  });
});

describe('mergeRollSetRows dedup', () => {
  it('collapses the same set seen by two uploaders', () => {
    const a = set(0, 0, 100, [{ name: 'Grobnar', value: 87 }, { name: 'Shavimo', value: 42 }]);
    const b = { ...a, started_at: new Date(base + 1000).toISOString() };   // other observer, ~same start
    const merged = mergeRollSetRows([a, b]);
    expect(merged).toHaveLength(1);
    expect(sessionWinner(merged[0]).rollers).toBe(2);
  });
});

describe('computeHotDiceNight', () => {
  // 6 contested sets, Uilnayar tops 3 of them (50%).
  const uiWins = (o) => set(o, 0, 100, [{ name: 'Uilnayar', value: 95 }, { name: 'Grobnar', value: 30 }]);
  const grWins = (o) => set(o, 0, 100, [{ name: 'Grobnar', value: 88 }, { name: 'Shavimo', value: 12 }]);
  const shWins = (o) => set(o, 0, 100, [{ name: 'Shavimo', value: 77 }, { name: 'Peopleslayer', value: 5 }]);

  it('awards the dominant roller above the 20% threshold', () => {
    const rows = [uiWins(0), uiWins(20), uiWins(40), grWins(60), shWins(80), grWins(100)];
    const award = computeHotDiceNight(rows);
    expect(award).not.toBeNull();
    expect(award.winner).toBe('Uilnayar');
    expect(award.wins).toBe(3);
    expect(award.contested).toBe(6);
    expect(award.pct).toBeCloseTo(0.5, 5);
  });

  it('returns null below the ≥5 contested floor', () => {
    const rows = [uiWins(0), uiWins(20), uiWins(40), uiWins(60)];  // 4 contested, all Uilnayar
    expect(computeHotDiceNight(rows)).toBeNull();
  });

  it('returns null when nobody exceeds 20% (evenly split)', () => {
    // 5 contested, each won by a distinct player → top share = 1/5 = 20% (not > 20%)
    const rows = [
      set(0, 0, 100, [{ name: 'A', value: 90 }, { name: 'Z', value: 1 }]),
      set(20, 0, 100, [{ name: 'B', value: 90 }, { name: 'Z', value: 1 }]),
      set(40, 0, 100, [{ name: 'C', value: 90 }, { name: 'Z', value: 1 }]),
      set(60, 0, 100, [{ name: 'D', value: 90 }, { name: 'Z', value: 1 }]),
      set(80, 0, 100, [{ name: 'E', value: 90 }, { name: 'Z', value: 1 }]),
    ];
    expect(computeHotDiceNight(rows)).toBeNull();
  });

  it('ignores uncontested (solo) sets when counting the night', () => {
    const solo = (o) => set(o, 0, 100, [{ name: 'Uilnayar', value: 50 }]);  // 1 roller
    const rows = [uiWins(0), uiWins(20), grWins(40), shWins(60), solo(80), solo(100)];
    const award = computeHotDiceNight(rows);
    // 4 contested only → below the floor → null
    expect(award).toBeNull();
  });

  it('is deterministic on ties (idempotent midnight re-run)', () => {
    // 5 contested: Grobnar 2, Uilnayar 2, Shavimo 1 → tie at top; both >20%.
    const rows = [grWins(0), grWins(20), uiWins(40), uiWins(60), shWins(80)];
    const a = computeHotDiceNight(rows);
    const b = computeHotDiceNight(rows);
    expect(a).toEqual(b);
    // tie broken by lowercased name → "Grobnar" < "Uilnayar"
    expect(a.winner).toBe('Grobnar');
    expect(a.wins).toBe(2);
    expect(a.contested).toBe(5);
  });
});
