// test/raid-heatmap.test.js — the pure helpers behind the raid-attendance
// heatmaps on /me and /raidhistory (Hitya, 2026-09-03).
//
// Real imports, real calls: a comment cannot satisfy a function. The traps
// each block pins were found against live rows the same day:
//   · a night is an EASTERN day, and two raids can share one (25 of 389 do);
//   · a raider on two characters is one raider, and "Hitya" and "hitya" are
//     the same tick attendee;
//   · the colour scale is Hitya's, not a gradient from zero: red UNTIL half,
//     orange AT three-quarters, green FROM full;
//   · the grid's last column must stop at today, or the renderer draws
//     nights that have not happened.
//
// Run: npx vitest run test/raid-heatmap.test.js

import { describe, it, expect } from 'vitest';
import {
  addDays, weekdayOf, buildWeeks, gridStart, monthLabels, nightLabel,
  buildNights, nightNames, fillColor, attendedAlpha, pct,
  FILL_RED, FILL_ORANGE, FILL_GREEN, ATTENDED, DEFAULT_FULL_RAID,
} from '../web/lib/raidHeatmap.ts';

describe('calendar arithmetic', () => {
  it('adds days without a DST seam moving the date', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');    // spring-forward Sunday
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');   // fall-back Sunday
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('knows Thursday from Sunday', () => {
    expect(weekdayOf('2026-09-03')).toBe(4);   // Thu
    expect(weekdayOf('2026-08-30')).toBe(0);   // Sun
  });

  it('nightLabel leads with the weekday — the weekday IS the raid', () => {
    expect(nightLabel('2026-08-27')).toBe('Thu, Aug 27, 2026');
  });
});

describe('buildWeeks — the grid', () => {
  const weeks = buildWeeks('2026-09-03', 3);   // a Thursday

  it('makes N columns of seven, Sunday first', () => {
    expect(weeks).toHaveLength(3);
    for (const col of weeks) expect(col).toHaveLength(7);
    expect(weeks[0][0]).toBe('2026-08-16');
    expect(gridStart(weeks)).toBe('2026-08-16');
    expect(weeks[2][0]).toBe('2026-08-30');
  });

  it('blanks the days after the end key instead of drawing the future', () => {
    expect(weeks[2][4]).toBe('2026-09-03');
    expect(weeks[2][5]).toBe('');
    expect(weeks[2][6]).toBe('');
    // Earlier columns are whole.
    expect(weeks[1].every(Boolean)).toBe(true);
  });

  it('never returns fewer than one column', () => {
    expect(buildWeeks('2026-09-03', 0)).toHaveLength(1);
  });
});

describe('monthLabels', () => {
  it('labels the column where a month begins', () => {
    // Sundays: Jul 26, Aug 2, 9, 16, 23, 30.
    expect(monthLabels(buildWeeks('2026-09-03', 6))).toEqual([null, 'Aug', null, null, null, null]);
  });

  it('labels the first column only when the second does not start a new month', () => {
    // Sundays: Aug 16, 23, 30 — one month, so the first column carries it.
    expect(monthLabels(buildWeeks('2026-09-03', 3))).toEqual(['Aug', null, null]);
  });
});

describe('buildNights — raids + ticks → Eastern nights', () => {
  const raids = [
    { raid_id: 2, ts: '2026-07-22T12:00:00Z', name: '7-23-26 Seru + Misc' },
    { raid_id: 1, ts: '2026-07-22T12:00:00Z', name: '7-22-26 SSRA' },
    { raid_id: 3, ts: '2026-08-28T03:00:00Z', name: 'late one' },   // 11pm ET on the 27th
  ];
  const ticks = [
    { raid_id: 1, tick_id: 10, attendees: ['Hitya', 'Canopy'] },
    { raid_id: 1, tick_id: 11, attendees: ['hitya', 'Dant'] },
    { raid_id: 2, tick_id: 20, attendees: ['Uilnayar'] },
    { raid_id: 3, tick_id: 30, attendees: ['Hitya'] },
    { raid_id: 99, tick_id: 90, attendees: ['Nobody'] },          // raid outside the window
  ];
  const nights = buildNights(raids, ticks);

  it('folds two raids on one date into one night, in raid order', () => {
    const n = nights.get('2026-07-22');
    expect(n).toBeTruthy();
    expect(n.raids.map(r => r.raid_id)).toEqual([1, 2]);
    expect(nightNames(n)).toEqual(['7-22-26 SSRA', '7-23-26 Seru + Misc']);
  });

  it('counts a raider once across ticks, raids and letter-case', () => {
    expect(nights.get('2026-07-22').attendees).toEqual(['canopy', 'dant', 'hitya', 'uilnayar']);
    expect(nights.get('2026-07-22').tickIds).toEqual([10, 11, 20]);
  });

  it('buckets by the EASTERN day, not UTC', () => {
    expect(nights.has('2026-08-27')).toBe(true);
    expect(nights.has('2026-08-28')).toBe(false);
  });

  it('ignores ticks whose raid is not in the window', () => {
    expect([...nights.values()].some(n => n.tickIds.includes(90))).toBe(false);
  });

  it('keeps tick ids when the caller sends no attendee arrays (the /me path)', () => {
    const n = buildNights(raids, [{ raid_id: 1, tick_id: 10 }, { raid_id: 1, tick_id: 11 }]).get('2026-07-22');
    expect(n.tickIds).toEqual([10, 11]);
    expect(n.attendees).toEqual([]);
  });

  it('nightNames drops blanks and repeats', () => {
    expect(nightNames({ date: 'x', tickIds: [], attendees: [], raids: [
      { raid_id: 1, ts: '', name: ' VT ' }, { raid_id: 2, ts: '', name: null }, { raid_id: 3, ts: '', name: 'VT' },
    ] })).toEqual(['VT']);
  });
});

describe("fillColor — Hitya's scale", () => {
  it('is red up to half, green from full', () => {
    expect(fillColor(0)).toBe(FILL_RED);
    expect(fillColor(0.5)).toBe(FILL_RED);
    expect(fillColor(0.3)).toBe(FILL_RED);
    expect(fillColor(1)).toBe(FILL_GREEN);
    expect(fillColor(1.2)).toBe(FILL_GREEN);
    expect(fillColor(Number.NaN)).toBe(FILL_RED);
  });

  it('is orange exactly midway, and a blend on either side', () => {
    expect(fillColor(0.75)).toBe(FILL_ORANGE);
    // Hand-computed midpoints of the two legs: (248,81,73)→(255,166,87) and
    // (255,166,87)→(86,211,100), each at t = 0.5, rounded half-up.
    expect(fillColor(0.625)).toBe('#fc7c50');
    expect(fillColor(0.875)).toBe('#abbd5e');
  });

  it('uses the platform palette, not a new one', () => {
    expect(FILL_RED).toBe('#f85149');
    expect(FILL_ORANGE).toBe('#ffa657');
    expect(FILL_GREEN).toBe('#56d364');
    expect(ATTENDED).toBe('#d29922');
    expect(DEFAULT_FULL_RAID).toBe(60);
  });
});

describe('attendedAlpha — brighter the more of the night', () => {
  it('full night is full strength; one tick still visibly gold', () => {
    expect(attendedAlpha(4, 4)).toBe(1);
    expect(attendedAlpha(1, 4)).toBe(0.51);
    expect(attendedAlpha(2, 4)).toBeGreaterThan(attendedAlpha(1, 4));
  });
  it('nothing attended, or nothing held, is zero — never NaN', () => {
    expect(attendedAlpha(0, 4)).toBe(0);
    expect(attendedAlpha(2, 0)).toBe(0);
  });
});

describe('pct', () => {
  it('rounds and survives an empty denominator', () => {
    expect(pct(41, 52)).toBe(79);
    expect(pct(0, 0)).toBe(0);
  });
});
