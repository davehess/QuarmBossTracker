// Route planner: "follow recorded paths". Pure maths over the recorded nights (no DOM).
//
// A night is a series of [unix seconds, x, y]: the median position of the raiders placed in the zone, every 3 s.
// For two pins A and B, a night PASSED A then B when its series gets within FOLLOW_R of A and, three or more samples
// later, within FOLLOW_R of B; the cheapest such pair of samples is the passage (the time between them is the leg's
// recorded time). Following a leg means replacing its bends with the distance-resampled average of those passages.
import { r1 } from './plan';
import { bakeBends, type P3 } from './navroute';
import type { Night } from './types';

export const FOLLOW_R = 320;     // how near a night must pass a pin to count
export const MIN_FOLLOW = 120;   // pins closer than this: a recorded path between them would be noise
const RESAMPLE_N = 28;

type Sample = readonly [number, number, number];
type XY = readonly [number, number];
type Pt = { x: number; y: number };

export function resample(poly: readonly XY[], n: number): [number, number][] | null {
  const cum = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
  const tot = cum[cum.length - 1];
  if (tot === 0) return null;
  const out: [number, number][] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const d = tot * k / (n - 1);
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const seg = cum[j + 1] - cum[j] || 1, t = (d - cum[j]) / seg;
    out.push([poly[j][0] + (poly[j + 1][0] - poly[j][0]) * t, poly[j][1] + (poly[j + 1][1] - poly[j][1]) * t]);
  }
  return out;
}

export function passage(series: readonly Sample[], A: Pt, B: Pt, R: number): { i: number; j: number; dA: number; dB: number } | null {
  let bestA = Infinity, bi = -1, best: { i: number; j: number; dA: number; dB: number } | null = null, bestCost = Infinity;
  for (let j = 0; j < series.length; j++) {
    const p = series[j], dA = Math.hypot(p[1] - A.x, p[2] - A.y), dB = Math.hypot(p[1] - B.x, p[2] - B.y);
    if (bi >= 0 && j - bi >= 3 && bestA <= R && dB <= R && bestA + dB < bestCost) { bestCost = bestA + dB; best = { i: bi, j, dA: bestA, dB }; }
    if (dA < bestA) { bestA = dA; bi = j; }
  }
  return best;
}

export type LegStats = {
  nights: number;                         // nights that passed both pins, in that order
  median: number | null;                  // seconds
  best: number | null;                    // seconds
  found: { n: Night; i: number; j: number }[];
};

const middle = (sorted: number[]) => (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);

export function createFollow(nights: readonly Night[]) {
  const cache = new Map<string, LegStats>();

  function legStats(A: Pt, B: Pt): LegStats {
    const key = [A.x, A.y, B.x, B.y].join(',');
    const hit = cache.get(key);
    if (hit) return hit;
    const times: number[] = [], found: LegStats['found'] = [];
    if (Math.hypot(A.x - B.x, A.y - B.y) >= MIN_FOLLOW) {
      for (const n of nights) {
        const ps = passage(n.pts, A, B, FOLLOW_R);
        if (ps) { times.push(n.pts[ps.j][0] - n.pts[ps.i][0]); found.push({ n, i: ps.i, j: ps.j }); }
      }
    }
    times.sort((a, b) => a - b);
    const res: LegStats = { nights: times.length, median: times.length ? middle(times) : null, best: times.length ? times[0] : null, found };
    if (cache.size > REC_CACHE) cache.clear();   // a drag asks about a new pair every move
    cache.set(key, res);
    return res;
  }

  /** The average of the recorded passages between A and B, as bends (the ends are the pins), or null when no night passed both. `n`: samples per passage. */
  function followPath(A: Pt, B: Pt, n = RESAMPLE_N): { pts: [number, number][]; nights: number; median: number | null } | null {
    const st = legStats(A, B);
    if (!st.found.length) return null;
    const polys: [number, number][][] = [];
    for (const { n: night, i, j } of st.found) {
      const r = resample(night.pts.slice(i, j + 1).map(p => [p[1], p[2]] as [number, number]), n);
      if (r) polys.push(r);
    }
    if (!polys.length) return null;
    const avg: [number, number][] = [];
    for (let k = 1; k < n - 1; k++) {
      let sx = 0, sy = 0;
      for (const p of polys) { sx += p[k][0]; sy += p[k][1]; }
      avg.push([r1(sx / polys.length), r1(sy / polys.length)]);
    }
    return { pts: avg, nights: polys.length, median: st.median };
  }

  const recCache = new Map<string, RecordedLeg | null>();

  /**
   * The leg as the nights actually ran it (the "Recorded" route source): the distance-resampled average of every night that
   * passed A then B, ends included, finer than followPath's (a sample about every REC_STEP units, so a corner stays a corner),
   * with its length. Null when no night passed both pins in that order. Kept per pair of ends; a long drag fills the cache with
   * pairs nobody will ask for again, so it is emptied past REC_CACHE.
   */
  function recorded(A: Pt, B: Pt): RecordedLeg | null {
    const key = [A.x, A.y, B.x, B.y].join(',');
    if (recCache.has(key)) return recCache.get(key) ?? null;
    if (recCache.size > REC_CACHE) recCache.clear();
    const n = Math.min(REC_MAX_N, Math.max(RESAMPLE_N, Math.round(Math.hypot(A.x - B.x, A.y - B.y) / REC_STEP)));
    const f = followPath(A, B, n);
    const out = f ? { poly: [[A.x, A.y], ...f.pts, [B.x, B.y]] as [number, number][], nights: f.nights, median: f.median, len: 0 } : null;
    if (out) for (let i = 1; i < out.poly.length; i++) out.len += Math.hypot(out.poly[i][0] - out.poly[i - 1][0], out.poly[i][1] - out.poly[i - 1][1]);
    recCache.set(key, out);
    return out;
  }

  return { legStats, followPath, recorded };
}

export const REC_STEP = 60;       // units between samples of a recorded leg
const REC_MAX_N = 90;
const REC_CACHE = 400;

export type RecordedLeg = { poly: [number, number][]; nights: number; median: number | null; len: number };

/**
 * A recorded leg as the bend points a plan keeps (`Line.pts`): the same simplifier "Use this route" runs on a walk route
 * (navroute.ts bakeBends), so a leg keeps the corners that matter and no more than `max` of them. The ends are the pins and are
 * not bends.
 */
export function bakeRecorded(poly: readonly (readonly [number, number])[], max = 40): [number, number][] {
  const pts = poly.map(p => [p[0], p[1], 0] as P3);
  let walkLen = 0;
  for (let i = 1; i < pts.length; i++) walkLen += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return bakeBends({ segs: [{ kind: 'walk', pts }], walkLen, jumps: [], steps: 0, ignoredBends: false }, max).map(p => [p[0], p[1]] as [number, number]);
}

export type Follow = ReturnType<typeof createFollow>;
