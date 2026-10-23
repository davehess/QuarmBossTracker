// "Start a new raid here": cutting one reviewed window into two, and guessing where it should be cut.
// Pure (no React, no Supabase, no node), so the session page, the loader and the tests share one copy.
//
// A SPLIT IS NOT A RECORD. Two raids that ran back to back with no quiet gap are one recorded session
// (SESSION_GAP_MS in raidReplay.ts), but a review is just a window [from, to). Cutting it at a minute gives two
// windows, [from, cut) and [cut, to), and each one is an ordinary window: the session page opens it, and the
// officer's Share… makes a link for exactly it. Nothing is written when a split is made.
//
// THE SUGGESTION (detectRaidChange) uses only what the loader already reads for the attendance: the `who` list of
// each recorded minute. It answers one question, "is the roster after some minute mostly different people from the
// roster before it?", and it is deliberately blunt:
//   * A "regular" of a stretch is someone listed in at least half of that stretch's minutes. One minute of a
//     character passing through is not a roster.
//   * For a candidate cut, look at the regulars of the stretch before it (A) and of the stretch after it (B). Count
//     how many are regulars of both. If that count is under half of A AND under half of B, the two stretches are
//     different groups of people. (Both, not either: a raid that thins out at the end leaves a small B that is wholly
//     inside A, which is one raid ending, not a second one starting. B must also not be mostly A.)
//   * Each side needs MIN_SIDE_MINUTES recorded minutes and MIN_REGULARS regulars, so a handful of stragglers or a
//     ten-minute tail never reads as a raid.
//   * The best candidate (least overlap) names who is A-only and who is B-only; the cut is then placed where the
//     fewest A-only minutes fall after it and B-only minutes before it, so it lands on the hand-over itself rather
//     than somewhere in the plateau of cuts that all score the same. Among equal cuts the later one wins, which puts
//     the cut on B's first minute rather than in the quiet minutes before it.
// It cannot see a change of raid where the same people carry on (the same roster doing a second raid, say). Zones
// are not used: they change inside one raid all night. The output is a time and two counts, never a name.
import { MINUTE_MS } from './raidReplay';
import { nameKey } from './raidSession';

/** A window of time, [fromMs, toMs). Structurally the same as raidShare's ShareWindow, which is not client-safe. */
export type Win = { readonly fromMs: number; readonly toMs: number };

// ── The cut ──────────────────────────────────────────────────────────────────

/**
 * `ms` rounded to the nearest minute and held at least one minute inside the window, so both halves are non-empty
 * and minute-aligned (the recording is one row per minute). Null when the window is under two minutes.
 */
export function snapCut(ms: number, win: Win): number | null {
  if (!Number.isFinite(ms)) return null;
  const lo = Math.ceil((win.fromMs + MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
  const hi = Math.floor((win.toMs - MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
  if (hi < lo) return null;
  return Math.min(hi, Math.max(lo, Math.round(ms / MINUTE_MS) * MINUTE_MS));
}

export type SplitHalves = { cutMs: number; before: Win; after: Win };

/** The two windows a cut makes: [from, cut) and [cut, to). The cut is snapped; null when the window cannot hold one. */
export function splitWindows(win: Win, ms: number): SplitHalves | null {
  const cutMs = snapCut(ms, win);
  if (cutMs == null) return null;
  return { cutMs, before: { fromMs: win.fromMs, toMs: cutMs }, after: { fromMs: cutMs, toMs: win.toMs } };
}

// ── The suggestion ───────────────────────────────────────────────────────────

export type WhoMinute = { t: number; who: readonly string[] };
export type RaidChange = { atMs: number; before: number; after: number };   // before/after: how many regulars each side has

export const MIN_SIDE_MINUTES = 20;   // each side of a suggested cut needs this many recorded minutes
export const MIN_REGULARS = 5;        // ... and this many regulars
export const REGULAR_SHARE = 0.5;     // a regular is listed in at least this share of its side's minutes
export const MAX_OVERLAP = 0.5;     // a cut is suggested when the shared regulars are under this share of EACH side

/** Minute rows -> who was listed in each, as opaque keys (lowercase; a pet counts as its owner). Rows that do not parse are skipped. */
export function whoSeries(rows: readonly { minute_at: string; data: string }[]): WhoMinute[] {
  const out: WhoMinute[] = [];
  for (const r of rows) {
    const t = Date.parse(r.minute_at);
    if (!Number.isFinite(t)) continue;
    let d: { v?: unknown; who?: unknown };
    try { d = JSON.parse(r.data); } catch { continue; }
    if (!d || d.v !== 1 || !Array.isArray(d.who)) continue;
    const seen = new Set<string>();
    for (const w of d.who as unknown[]) {
      if (Array.isArray(w) && typeof w[0] === 'string' && w[0].trim()) seen.add(nameKey(w[0]));
    }
    out.push({ t, who: [...seen] });
  }
  return out;
}

type Sides = { a: Set<number>; b: Set<number>; both: number };

/** The regulars of the stretch before row `c` (a) and after it (b), from the running counts. */
function sidesAt(before: ArrayLike<number>, total: ArrayLike<number>, c: number, n: number): Sides {
  const needA = Math.max(1, Math.ceil(REGULAR_SHARE * c));
  const needB = Math.max(1, Math.ceil(REGULAR_SHARE * (n - c)));
  const a = new Set<number>(), b = new Set<number>();
  let both = 0;
  for (let id = 0; id < total.length; id++) {
    const inA = before[id] >= needA;
    const inB = total[id] - before[id] >= needB;
    if (inA) a.add(id);
    if (inB) b.add(id);
    if (inA && inB) both++;
  }
  return { a, b, both };
}

/**
 * Where, if anywhere, the roster of the series turns over (see the header). The series is the minutes that have a
 * `who` list, oldest first; a minute listing nobody carries no information and is ignored.
 */
export function detectRaidChange(series: readonly WhoMinute[]): RaidChange | null {
  const rows = series.filter(m => m.who.length).sort((x, y) => x.t - y.t);
  const n = rows.length;
  if (n < 2 * MIN_SIDE_MINUTES) return null;

  const ids = new Map<string, number>();
  const minutes: number[][] = rows.map(m => [...new Set(m.who)].map(k => {
    let id = ids.get(k);
    if (id === undefined) ids.set(k, id = ids.size);
    return id;
  }));
  const total = new Int32Array(ids.size);
  for (const m of minutes) for (const id of m) total[id]++;

  // Phase 1: the cut whose two sides share the fewest regulars.
  const before = new Int32Array(ids.size);
  for (let i = 0; i < MIN_SIDE_MINUTES; i++) for (const id of minutes[i]) before[id]++;
  let best: { c: number; score: number; sides: Sides } | null = null;
  for (let c = MIN_SIDE_MINUTES; c <= n - MIN_SIDE_MINUTES; c++) {
    const s = sidesAt(before, total, c, n);
    if (s.a.size >= MIN_REGULARS && s.b.size >= MIN_REGULARS) {
      const score = Math.max(s.both / s.a.size, s.both / s.b.size);
      if (score < MAX_OVERLAP && (!best || score < best.score)) best = { c, score, sides: s };
    }
    for (const id of minutes[c]) before[id]++;
  }
  if (!best) return null;

  // Phase 2: place the cut on the hand-over. Label each minute by which side's own people outnumber the other's.
  const { a, b } = best.sides;
  const misA: number[] = [0], misB: number[] = [0];   // prefix counts of "B-looking" and "A-looking" minutes
  for (const m of minutes) {
    let na = 0, nb = 0;
    for (const id of m) { if (a.has(id) && !b.has(id)) na++; else if (b.has(id) && !a.has(id)) nb++; }
    misA.push(misA[misA.length - 1] + (nb > na ? 1 : 0));   // a B-looking minute before the cut is an error
    misB.push(misB[misB.length - 1] + (na > nb ? 1 : 0));   // an A-looking minute after the cut is an error
  }
  let cut = best.c, fewest = Infinity;
  for (let c = MIN_SIDE_MINUTES; c <= n - MIN_SIDE_MINUTES; c++) {
    const errors = misA[c] + (misB[n] - misB[c]);
    if (errors <= fewest) { fewest = errors; cut = c; }   // <=: among equal cuts the later one
  }
  return { atMs: rows[cut].t, before: a.size, after: b.size };
}
