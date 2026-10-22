// The raid's PATH on the spectator replay and the shared raid (the guild lead, 2026-10-22: "add the path view for
// spectator and shared raids as well"; picked: the whole night's path, always on, with a Path toggle). The whole night's
// path is drawn faint, the part up to the playhead solid, with numbered kill markers. Pure: no React, no DOM, no network.
//
// DATA: nothing new is asked for. The path is the same centre the route pages draw (lib/raidRoutes.ts centroidSeries:
// the median position of the raiders the recorder placed in the zone, frame by frame), computed here from the frames
// the board already decodes, with the median z kept as well so the 3D view needs no draping. `pathSeries` takes the
// same filters as centroidSeries (placed in the zone, finite, not 0,0, median) and test/replay-path.test.js holds the
// two together. Two differences, both on purpose: the floor is PATH_MIN_RAIDERS (4), not 8, because a replay shows a
// group of any size, and there is no wall box to filter against (the board has no walls in hand in 2D).
//
// FRAME: the SERVER frame, like every position in the replay (lib/raidReplay.ts). The board negates both axes to draw
// north up (toScreen), Replay3D uses serverToThree.
import { median } from './raidRoutes';
import type { ReplayFrame } from './raidReplay';

export const PATH_MIN_RAIDERS = 4;        // a frame with fewer raiders placed in the zone is not "the raid"
export const PATH_BREAK_MS = 60_000;      // two samples further apart than this are not joined
export const PATH_HOP = 200;              // a centre that moved further than this between two samples did not walk it

export type PathPt = { t: number; x: number; y: number; z: number; n: number };

const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

// ── the centre path ───────────────────────────────────────────────────────────

/** Every zone's centre path in a run of frames, one pass. A zone with no frame of `minRaiders` is absent. */
export function pathSeriesByZone(frames: readonly ReplayFrame[], minRaiders = PATH_MIN_RAIDERS): Map<string, PathPt[]> {
  const out = new Map<string, PathPt[]>();
  for (const f of frames) {
    const by = new Map<string, { xs: number[]; ys: number[]; zs: number[] }>();
    for (const r of f.raiders) {
      if (!r.zone || !fin(r.x) || !fin(r.y)) continue;
      if (r.x === 0 && r.y === 0) continue;
      let b = by.get(r.zone);
      if (!b) by.set(r.zone, b = { xs: [], ys: [], zs: [] });
      b.xs.push(r.x); b.ys.push(r.y);
      if (fin(r.z)) b.zs.push(r.z);
    }
    for (const [zone, b] of by) {
      if (b.xs.length < minRaiders) continue;
      const p: PathPt = { t: f.t, x: median(b.xs) as number, y: median(b.ys) as number, z: median(b.zs) ?? 0, n: b.xs.length };
      const a = out.get(zone);
      if (a) a.push(p); else out.set(zone, [p]);
    }
  }
  for (const a of out.values()) a.sort((p, q) => p.t - q.t);
  return out;
}

/** One zone's centre path. With the default floor of 8 it is centroidSeries' x, y, t and n exactly. */
export function pathSeries(frames: readonly ReplayFrame[], zone: string, minRaiders = PATH_MIN_RAIDERS): PathPt[] {
  return pathSeriesByZone(frames, minRaiders).get(zone) ?? [];
}

/**
 * The night's path, accumulated window by window. A window is kept by its index, so a window asked for again (the
 * live tail grows) replaces its old path instead of doubling it, and a window the playhead has left is NOT dropped
 * (the board keeps frames for about an hour around the playhead; the path is one point per frame, a few hundred per
 * window per zone, which is why it can stay for the whole night).
 */
export class PathStore {
  private wins = new Map<number, Map<string, PathPt[]>>();
  private cache = new Map<string, PathPt[]>();
  /** Bumps on every change; the board uses it to know the path grew. */
  version = 0;

  addWindow(w: number, frames: readonly ReplayFrame[]): void {
    this.wins.set(w, pathSeriesByZone(frames));
    this.cache.clear();
    this.version++;
  }
  has(w: number): boolean { return this.wins.has(w); }
  get size(): number { return this.wins.size; }
  clear(): void {
    this.wins.clear();
    this.cache.clear();
    this.version++;
  }
  /** The zone's path in time order. The SAME array until the next change, so a drawing layer can key on it. */
  seriesFor(zone: string): PathPt[] {
    const hit = this.cache.get(zone);
    if (hit) return hit;
    const out: PathPt[] = [];
    for (const k of [...this.wins.keys()].sort((a, b) => a - b)) {
      const s = this.wins.get(k)?.get(zone);
      if (s) for (const p of s) out.push(p);
    }
    this.cache.set(zone, out);
    return out;
  }
}

// ── segments and the playhead ─────────────────────────────────────────────────

/** Whether sample i is joined to sample i+1: close enough in time, and not a jump. */
export function linked(series: readonly PathPt[], i: number, breakMs = PATH_BREAK_MS, hop = PATH_HOP): boolean {
  const a = series[i], b = series[i + 1];
  if (!a || !b) return false;
  return b.t - a.t <= breakMs && Math.hypot(b.x - a.x, b.y - a.y) <= hop;
}

/** The joined pairs of a path, oldest first: `from[k]` is the first sample of segment k, `end[k]` the time it ends. */
export type Segments = { from: Int32Array; end: Float64Array; count: number };

export function buildSegments(series: readonly PathPt[], breakMs = PATH_BREAK_MS, hop = PATH_HOP): Segments {
  const from: number[] = [];
  for (let i = 0; i + 1 < series.length; i++) if (linked(series, i, breakMs, hop)) from.push(i);
  return { from: Int32Array.from(from), end: Float64Array.from(from, i => series[i + 1].t), count: from.length };
}

/** First index in sorted `xs` whose value is greater than `v` (so the count of values <= v). */
function upper(xs: ArrayLike<number>, n: number, v: number): number {
  let lo = 0, hi = n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] <= v) lo = m + 1; else hi = m; }
  return lo;
}

/** How many segments are finished by playhead `t`: the SOLID part of the path. The rest is the faint part. */
export function segmentsDone(seg: Segments, t: number): number {
  return upper(seg.end, seg.count, t);
}

function lastAtOrBefore(series: readonly PathPt[], t: number): number {
  let lo = 0, hi = series.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (series[m].t <= t) lo = m + 1; else hi = m; }
  return lo - 1;
}

/**
 * The centre at time `t`, between the two samples around it (the raid's head). Null outside the path, and in a hole
 * longer than `maxGap` unless `t` is within half of it of a sample.
 */
export function headAt(series: readonly PathPt[], t: number, maxGap = PATH_BREAK_MS): PathPt | null {
  const n = series.length;
  if (!n || t < series[0].t - 1000 || t > series[n - 1].t + 1000) return null;
  const k = Math.max(0, lastAtOrBefore(series, t));
  const a = series[k], b = series[Math.min(n - 1, k + 1)];
  if (b.t === a.t) return a;
  if (b.t - a.t > maxGap) return t - a.t <= maxGap / 2 ? a : t >= b.t ? b : null;
  const f = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
  return { t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f, n: a.n };
}

// ── kill markers ──────────────────────────────────────────────────────────────

export type KillIn = { name: string; to: number; zones?: readonly string[] };
export type KillMark = { n: number; name: string; t: number; x: number; y: number; z: number; done: boolean };

/** The night's boss kills in the order they died, numbered from 1. Ties keep the order they came in. */
export function rankKills<T extends { to: number }>(kills: readonly T[]): (T & { n: number })[] {
  return kills.map((k, i) => ({ k, i })).sort((a, b) => a.k.to - b.k.to || a.i - b.i).map((x, i) => ({ ...x.k, n: i + 1 }));
}

/**
 * Where on this zone's path each kill was: the raid centre at the moment the boss died. A kill the path does not
 * cover (another zone, a hole in the recording) has no marker but keeps its number, so the 1..N along the route and
 * in the legend are the same. A boss whose zones are known and do not include `zone` is left out as well.
 */
export function killMarks(kills: readonly KillIn[], series: readonly PathPt[], zone: string, t: number): KillMark[] {
  const out: KillMark[] = [];
  for (const k of rankKills(kills)) {
    if (k.zones && k.zones.length && !k.zones.includes(zone)) continue;
    const p = headAt(series, k.to);
    if (!p) continue;
    out.push({ n: k.n, name: k.name, t: k.to, x: p.x, y: p.y, z: p.z, done: k.to <= t });
  }
  return out;
}

// ── what the board hands the 3D view ──────────────────────────────────────────

export type RouteFeed = {
  series: readonly PathPt[];     // the zone's centre path; the same array until the path changes
  t: number;                     // the playhead
  marks: KillMark[];             // the numbered kills along the path
};
