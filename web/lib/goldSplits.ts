// web/lib/goldSplits.ts — the speedrun-style maths over an event's attempts (DECISIONS §555). Pure.
//
// Moment 0 is the start. Segment i (i >= 1) is the time from moment i-1 to moment i. A segment is null when either end
// was not seen in that attempt (shown as a dash). The GOLD of a segment is the best (smallest) time anyone ever ran it;
// the sum of best is the theoretical best run; an attempt's time save is how much quicker it would have been with the
// gold of every segment it ran. Group moments are already sorted by time inside an attempt (eventAttempts.ts), so a
// segment is never negative.

import type { Attempt } from './eventAttempts';

export type AttemptSplits = {
  /** Seconds from the attempt's first moment to each moment (null = not seen). */
  cumulative: (number | null)[];
  /** Segment i (index 0 is always null: the start has no segment). */
  segments: (number | null)[];
  /** Total of the segments when every segment was seen, else null. */
  total: number | null;
  /** total - sum of best, only for an attempt that ran every segment. */
  timeSave: number | null;
};

export type GoldSplits = {
  /** The best time of each segment (null where nobody ran it) and the attempt index that holds it. */
  gold: (number | null)[];
  goldAttempt: (number | null)[];
  /** Sum of the golds, and whether every segment has one. */
  sumOfBest: number;
  complete: boolean;
  attempts: AttemptSplits[];
  /** The fastest full run (index into attempts) and its total, or null when no attempt ran every segment. */
  bestRun: number | null;
};

export function computeSplits(momentCount: number, attempts: Pick<Attempt, 'moments'>[]): GoldSplits {
  const per = attempts.map(a => {
    const cumulative = Array.from({ length: momentCount }, (_, i) => a.moments[i]?.relSec ?? null);
    const segments = cumulative.map((t, i) => {
      if (i === 0) return null;
      const p = cumulative[i - 1];
      return t != null && p != null ? Math.max(0, t - p) : null;
    });
    return { cumulative, segments };
  });
  const gold: (number | null)[] = Array(momentCount).fill(null);
  const goldAttempt: (number | null)[] = Array(momentCount).fill(null);
  for (let i = 1; i < momentCount; i++) {
    per.forEach((p, ai) => {
      const s = p.segments[i];
      if (s != null && (gold[i] == null || s < (gold[i] as number))) { gold[i] = s; goldAttempt[i] = ai; }
    });
  }
  const sumOfBest = gold.reduce<number>((s, g) => s + (g ?? 0), 0);
  const complete = momentCount > 1 && gold.slice(1).every(g => g != null);
  const out: AttemptSplits[] = per.map(p => {
    const full = p.segments.slice(1).every(s => s != null) && momentCount > 1;
    const total = full ? p.segments.slice(1).reduce<number>((s, x) => s + (x as number), 0) : null;
    return { ...p, total, timeSave: total != null && complete ? total - sumOfBest : null };
  });
  let bestRun: number | null = null;
  out.forEach((a, i) => { if (a.total != null && (bestRun == null || a.total < (out[bestRun].total as number))) bestRun = i; });
  return { gold, goldAttempt, sumOfBest, complete, attempts: out, bestRun };
}

/** 83 -> "1:23", 3725 -> "1:02:05", null -> an em dash. */
export function fmtClock(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.round(Math.abs(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
  return sec < 0 ? `-${body}` : body;
}

/**
 * How many moments the table shows. An explicit event shows all of them. The generic default has a slot per named
 * death, most unfilled, so it shows as many as EVERY attempt reached (at least the start and one kill).
 */
export function momentsShown(generic: boolean | undefined, defCount: number, attempts: Pick<Attempt, 'moments'>[]): number {
  if (!generic || attempts.length === 0) return defCount;
  const reach = attempts.map(a => {
    let last = 0;
    a.moments.forEach((m, i) => { if (m) last = i; });
    return last + 1;
  });
  return Math.max(2, Math.min(defCount, ...reach));
}
