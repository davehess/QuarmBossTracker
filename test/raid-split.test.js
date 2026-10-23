// test/raid-split.test.js — "Start a new raid here" on the raid session review (?v=split; web/lib/raidSplit.ts).
//
//   1. CUT      a cut is snapped to the nearest minute and held one minute inside the window; the two halves are
//               [from, cut) and [cut, to) and together are exactly the window.
//   2. DETECTOR on a synthetic per-minute roster series: two raids back to back are cut on the hand-over; one raid
//               (steady, churning, thinning out at the end, a late group arriving) is never cut.
//   3. SERIES   minute rows -> who lists: bad rows skipped, a pet counts as its owner, names are keys not output.
//   4. SOURCE   the page only passes `split` for ?v=split, the board reports the playhead only when asked, the share
//               page never receives the suggestion.
//
// Names below are invented tokens (a roster is only identities here). Run: npx vitest run test/raid-split.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { MINUTE_MS } from '../web/lib/raidReplay.ts';
import {
  detectRaidChange, snapCut, splitWindows, whoSeries, MIN_SIDE_MINUTES, MIN_REGULARS,
} from '../web/lib/raidSplit.ts';

const read = (...p) => stripJs(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));

const T0 = Date.parse('2026-10-22T23:02:00Z');
const win = { fromMs: T0, toMs: T0 + 90 * MINUTE_MS };

describe('snapCut', () => {
  it('rounds to the nearest minute', () => {
    expect(snapCut(T0 + 10 * MINUTE_MS + 29_000, win)).toBe(T0 + 10 * MINUTE_MS);
    expect(snapCut(T0 + 10 * MINUTE_MS + 31_000, win)).toBe(T0 + 11 * MINUTE_MS);
  });
  it('keeps one minute on each side', () => {
    expect(snapCut(T0 - 5 * MINUTE_MS, win)).toBe(T0 + MINUTE_MS);
    expect(snapCut(T0, win)).toBe(T0 + MINUTE_MS);
    expect(snapCut(win.toMs, win)).toBe(win.toMs - MINUTE_MS);
    expect(snapCut(win.toMs + 9 * MINUTE_MS, win)).toBe(win.toMs - MINUTE_MS);
  });
  it('has no cut in a window under two minutes, or for a non-number', () => {
    expect(snapCut(T0, { fromMs: T0, toMs: T0 + MINUTE_MS })).toBeNull();
    expect(snapCut(T0 + MINUTE_MS, { fromMs: T0, toMs: T0 + 2 * MINUTE_MS })).toBe(T0 + MINUTE_MS);
    expect(snapCut(NaN, win)).toBeNull();
  });
});

describe('splitWindows', () => {
  it('makes [from, cut) and [cut, to) that together are the window', () => {
    const h = splitWindows(win, T0 + 40 * MINUTE_MS + 20_000);
    expect(h.cutMs).toBe(T0 + 40 * MINUTE_MS);
    expect(h.before).toEqual({ fromMs: T0, toMs: T0 + 40 * MINUTE_MS });
    expect(h.after).toEqual({ fromMs: T0 + 40 * MINUTE_MS, toMs: win.toMs });
    expect(h.before.toMs).toBe(h.after.fromMs);
  });
  it('never makes an empty half', () => {
    for (const ms of [T0, T0 + 1, win.toMs, win.toMs - 1, T0 - 1e9, T0 + 1e9]) {
      const h = splitWindows(win, ms);
      expect(h.before.toMs).toBeGreaterThan(h.before.fromMs);
      expect(h.after.toMs).toBeGreaterThan(h.after.fromMs);
    }
    expect(splitWindows({ fromMs: T0, toMs: T0 + MINUTE_MS }, T0)).toBeNull();
  });
});

// ── The detector ─────────────────────────────────────────────────────────────

/** A deterministic 0..1 from two integers (no Math.random: a test that flakes proves nothing). */
const rnd = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const crew = (tag, n) => Array.from({ length: n }, (_, i) => `${tag}${i}`);
/** One recorded minute per index, each member listed with probability `p` (people blink out of a recording). */
const minutes = (from, count, members, p = 0.9, salt = 1) => Array.from({ length: count }, (_, i) => ({
  t: T0 + (from + i) * MINUTE_MS,
  who: members.filter((m, j) => rnd(from + i + salt * 7919, j + m.length) < p),
}));

describe('detectRaidChange', () => {
  it('cuts two raids that ran back to back, on the hand-over', () => {
    const a = crew('alder', 30), b = crew('birch', 18);
    const series = [...minutes(0, 120, a), ...minutes(120, 75, b)];
    const r = detectRaidChange(series);
    expect(r).not.toBeNull();
    expect(Math.abs(r.atMs - (T0 + 120 * MINUTE_MS))).toBeLessThanOrEqual(2 * MINUTE_MS);
    expect(r.before).toBeGreaterThanOrEqual(MIN_REGULARS);
    expect(r.after).toBeGreaterThanOrEqual(MIN_REGULARS);
  });

  it('cuts on the hand-over even with a few people in both raids and a few quiet minutes between', () => {
    const a = crew('alder', 30), b = [...crew('birch', 16), ...a.slice(0, 3)];
    const series = [...minutes(0, 100, a), ...minutes(100, 4, a.slice(0, 2)), ...minutes(104, 70, b)];
    const r = detectRaidChange(series);
    expect(r).not.toBeNull();
    // the four quiet minutes (100..103) look like neither raid: the cut goes on the second raid's first minute
    expect(r.atMs).toBe(T0 + 104 * MINUTE_MS);
  });

  it('finds nothing in one continuous raid, however much it churns', () => {
    const everyone = crew('alder', 40);
    // 200 minutes; each person is in with probability 0.6, so the lists differ from minute to minute.
    expect(detectRaidChange(minutes(0, 200, everyone, 0.6))).toBeNull();
    // A different slice of the same 40 people in each third: still the same raid's people.
    const thirds = [...minutes(0, 70, everyone.slice(0, 30)), ...minutes(70, 70, everyone.slice(5, 35)), ...minutes(140, 70, everyone.slice(10, 40))];
    expect(detectRaidChange(thirds)).toBeNull();
  });

  it('does not call a raid thinning out at the end a second raid', () => {
    const a = crew('alder', 40);
    expect(detectRaidChange([...minutes(0, 150, a), ...minutes(150, 40, a.slice(0, 8))])).toBeNull();
  });

  it('does not call a late group joining the same raid a second raid', () => {
    const a = crew('alder', 30);
    expect(detectRaidChange([...minutes(0, 120, a), ...minutes(120, 40, [...a, ...crew('birch', 8)])])).toBeNull();
  });

  it('needs enough minutes and enough people on each side', () => {
    const a = crew('alder', 30), b = crew('birch', 18);
    // five minutes of one group is a visit, not a raid; and a series under two sides' worth of minutes has no cut at all
    expect(detectRaidChange([...minutes(0, 5, a), ...minutes(5, 60, b)])).toBeNull();
    expect(detectRaidChange([...minutes(0, MIN_SIDE_MINUTES - 1, a), ...minutes(MIN_SIDE_MINUTES - 1, MIN_SIDE_MINUTES, b)])).toBeNull();
    expect(detectRaidChange([...minutes(0, 60, a), ...minutes(60, 60, crew('birch', MIN_REGULARS - 1))])).toBeNull();
    expect(detectRaidChange([])).toBeNull();
  });

  it('ignores minutes that list nobody and tolerates unsorted input', () => {
    const a = crew('alder', 30), b = crew('birch', 18);
    const series = [...minutes(0, 60, a), { t: T0 + 60 * MINUTE_MS, who: [] }, ...minutes(61, 59, b)].reverse();
    const r = detectRaidChange(series);
    expect(r).not.toBeNull();
    expect(Math.abs(r.atMs - (T0 + 61 * MINUTE_MS))).toBeLessThanOrEqual(2 * MINUTE_MS);
  });

  it('returns a time and two counts, never a name', () => {
    const r = detectRaidChange([...minutes(0, 60, crew('alder', 30)), ...minutes(60, 60, crew('birch', 18))]);
    expect(Object.keys(r).sort()).toEqual(['after', 'atMs', 'before']);
    expect(JSON.stringify(r)).not.toMatch(/alder|birch/);
  });
});

describe('whoSeries', () => {
  const row = (min, data) => ({ minute_at: new Date(T0 + min * MINUTE_MS).toISOString(), data: typeof data === 'string' ? data : JSON.stringify(data) });
  it('reads the who list of each minute as lowercase keys, a pet as its owner, once each', () => {
    const s = whoSeries([row(0, { v: 1, who: [['Zarrin', 'Cleric'], ['zarrin`s pet'], ['Nyssara'], ['', 'x'], 'junk'] })]);
    expect(s).toHaveLength(1);
    expect(s[0].t).toBe(T0);
    expect(s[0].who.slice().sort()).toEqual(['nyssara', 'zarrin']);
  });
  it('skips rows that are not a v1 recording', () => {
    expect(whoSeries([row(0, 'not json'), row(1, { v: 2, who: [['a']] }), row(2, { v: 1 }), { minute_at: 'nope', data: '{"v":1,"who":[["a"]]}' }])).toEqual([]);
  });
});

describe('wiring', () => {
  it('passes `split` to the review only for ?v=split, and the suggestion never reaches the share page', () => {
    const page = read('web', 'app', 'raid', 'session', 'page.tsx');
    expect(page).toMatch(/one\(searchParams\.v\) === 'split'/);
    expect(page).toMatch(/split=\{split \? \{/);
    const share = read('web', 'app', 'share', 'raid', '[token]', 'page.tsx');
    expect(share).not.toMatch(/\.change\b|split=/);
  });
  it('the board reports the playhead only to a caller that asked', () => {
    const board = read('web', 'app', 'spectator', 'replay', 'ReplayBoard.tsx');
    expect(board).toMatch(/onPlayheadRef\.current\?\.\(uiT\)/);
    const review = read('web', 'app', 'raid', 'session', 'SessionReview.tsx');
    expect(review).toMatch(/onPlayhead: splitOn \? onPlayhead : undefined/);
    expect(review).toMatch(/splitAt: splitOn \? splitAt : undefined/);
  });
  it('each half opens as its own session page and keeps ?v=split', () => {
    const panel = read('web', 'app', 'raid', 'session', 'SplitPanel.tsx');
    expect(panel).toMatch(/&v=split/);
    expect(panel).toMatch(/defaultFollow=\{isLive\}/);
  });
});
