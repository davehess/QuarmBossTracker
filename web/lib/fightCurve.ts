// Pure transforms behind the fight damage curve (docs/DESIGN-fight-timeline.md).
//
// The chart's whole honesty rests on one idea: cumulative damage dealt IS boss
// HP removed, so a stack normalised to the fight's total damage shares ONE axis
// with the HP curve — 0-100% of the boss's health bar. No second scale.
//
// Kept separate from the component so the arithmetic is testable without a DOM;
// the correctness traps in the design doc (§"Two correctness traps") are the
// kind that render as a plausible-looking chart when wrong.

export type TimelineRow = {
  t_sec: number;
  char_name: string;
  pet_owner: string | null;
  dmg_delta: number | string;
  took_delta: number | string;
};

export type Band = {
  name: string;
  total: number;
  /** Cumulative damage at each bucket, same length as `buckets`. */
  cum: number[];
  isOther?: boolean;
};

export type MTSegment = { fromSec: number; toSec: number; name: string; took: number };

export type FightCurve = {
  buckets: number[];          // bucket start times, seconds from fight start
  bands: Band[];              // stacked bottom-to-top, largest first, Others last
  totalDamage: number;
  mt: MTSegment[];
  everyone: { name: string; total: number }[];  // all contributors, for the search list
};

/** Top N carry the categorical palette; the rest fold into one muted band.
 *  A generated 8th hue is never the answer — see the palette non-negotiable. */
export const TOP_N = 7;

const num = (v: number | string): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Fold a pet's damage under its owner. `pet_owner` rides every snapshot row, and
 * without this a charmed pet shows up as its own contributor — which is both
 * wrong on the meter and unreadable on a stack.
 */
export function attributedName(row: TimelineRow): string {
  return (row.pet_owner && row.pet_owner.trim()) || row.char_name;
}

export function buildFightCurve(rows: TimelineRow[], stepSec: number): FightCurve {
  if (!rows.length) {
    return { buckets: [], bands: [], totalDamage: 0, mt: [], everyone: [] };
  }

  // Bucket grid. encounter_timeline() already returns per-step deltas, so the
  // only job here is to place them on a dense axis — gaps must render as ZERO,
  // not as a straight line between distant points, or a lull looks like steady
  // damage.
  let maxT = 0;
  for (const r of rows) if (r.t_sec > maxT) maxT = r.t_sec;
  const nB = Math.max(1, Math.floor(maxT / stepSec) + 1);
  const buckets = Array.from({ length: nB }, (_, i) => i * stepSec);
  const idxOf = (t: number) => Math.min(nB - 1, Math.max(0, Math.floor(t / stepSec)));

  // Per-attributed-name deltas, and per-bucket damage-taken for the MT lane.
  const dmgByName = new Map<string, number[]>();
  const tookByBucket: Map<string, number>[] = Array.from({ length: nB }, () => new Map());

  for (const r of rows) {
    const name = attributedName(r);
    const i = idxOf(r.t_sec);
    const d = num(r.dmg_delta);
    if (d > 0) {
      let arr = dmgByName.get(name);
      if (!arr) { arr = new Array(nB).fill(0); dmgByName.set(name, arr); }
      arr[i] += d;
    }
    const took = num(r.took_delta);
    // Damage TAKEN stays on the real character — a pet tanking is not the owner
    // tanking, and the MT lane is about who the boss is actually hitting.
    if (took > 0) {
      const m = tookByBucket[i];
      m.set(r.char_name, (m.get(r.char_name) || 0) + took);
    }
  }

  const everyone = [...dmgByName.entries()]
    .map(([name, arr]) => ({ name, total: arr.reduce((a, b) => a + b, 0) }))
    .filter(e => e.total > 0)
    .sort((a, b) => b.total - a.total);

  const totalDamage = everyone.reduce((a, e) => a + e.total, 0);

  // Top N as their own bands; everything else summed into one.
  const top = everyone.slice(0, TOP_N);
  const rest = everyone.slice(TOP_N);
  const cumOf = (arr: number[]): number[] => {
    const out = new Array(arr.length);
    let run = 0;
    for (let i = 0; i < arr.length; i++) { run += arr[i]; out[i] = run; }
    return out;
  };

  const bands: Band[] = top.map(e => ({
    name: e.name,
    total: e.total,
    cum: cumOf(dmgByName.get(e.name) || new Array(nB).fill(0)),
  }));

  if (rest.length) {
    const merged = new Array(nB).fill(0);
    for (const e of rest) {
      const arr = dmgByName.get(e.name);
      if (arr) for (let i = 0; i < nB; i++) merged[i] += arr[i];
    }
    bands.push({
      name: `${rest.length} others`,
      total: rest.reduce((a, e) => a + e.total, 0),
      cum: cumOf(merged),
      isOther: true,
    });
  }

  return { buckets, bands, totalDamage, mt: mainTankLane(tookByBucket, buckets, stepSec), everyone };
}

/**
 * MT lane: whoever's damage-taken rises fastest in a bucket is who the boss is
 * hitting. Run-length-encoded so a stable tank is one segment, not 200 ticks.
 *
 * Buckets where nobody took damage produce NO segment rather than extending the
 * previous tank — the boss being off everyone (mez, gate, a pause) is real
 * information and inventing continuity across it would hide a mechanic.
 */
export function mainTankLane(
  tookByBucket: Map<string, number>[],
  buckets: number[],
  stepSec: number,
): MTSegment[] {
  const out: MTSegment[] = [];
  let cur: MTSegment | null = null;

  for (let i = 0; i < tookByBucket.length; i++) {
    let best: string | null = null;
    let bestVal = 0;
    for (const [name, v] of tookByBucket[i]) {
      if (v > bestVal) { bestVal = v; best = name; }
    }
    const t = buckets[i];
    if (!best) { cur = null; continue; }
    if (cur && cur.name === best && cur.toSec === t) {
      cur.toSec = t + stepSec;
      cur.took += bestVal;
    } else {
      cur = { fromSec: t, toSec: t + stepSec, name: best, took: bestVal };
      out.push(cur);
    }
  }
  return out;
}

/**
 * Observed boss HP, thinned onto the same axis. Returns % of max HP remaining.
 * Observed beats derived (design doc), but it is sparse and only exists since
 * 2026-08-04 — the caller says which source it drew.
 */
export function observedHpSeries(
  obs: { at: string; hp_pct: number | null }[],
  startedAt: string,
  durationSec: number,
): { tSec: number; pct: number }[] {
  const t0 = new Date(startedAt).getTime();
  if (!Number.isFinite(t0) || durationSec <= 0) return [];
  return obs
    // ⚠ Reject null BEFORE Number(): Number(null) === 0, so a missing reading
    // would sail through Number.isFinite and draw the boss at 0% — dead — in
    // the middle of a fight. Caught by test, not by looking at the chart.
    .filter(o => o.hp_pct !== null && o.hp_pct !== undefined && o.hp_pct !== ('' as unknown))
    .map(o => ({ tSec: (new Date(o.at).getTime() - t0) / 1000, pct: Number(o.hp_pct) }))
    .filter(p => Number.isFinite(p.tSec) && Number.isFinite(p.pct)
                 && p.tSec >= 0 && p.tSec <= durationSec * 1.05
                 && p.pct >= 0 && p.pct <= 100)
    .sort((a, b) => a.tSec - b.tSec);
}
