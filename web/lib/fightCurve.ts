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
  /** Every attributed name with its full cum array — NO top-N fold. The
   *  class-grouped view (Hitya's 2026-08-16 parse review) needs the long tail
   *  per-name so a class's total is right and its drill-down has every member;
   *  the folded `bands` can't provide either. */
  series: Band[];
};

/** One class's stacked band plus its members, for the class-level view and its
 *  per-character drill-down. `klass` is a display label — real class, 'Pets'
 *  is impossible here (pets fold under owners upstream), unknowns arrive as
 *  whatever fallback the caller put in classOf (the page passes null → we
 *  label 'Unknown'). */
export type ClassGroup = {
  klass: string;
  total: number;
  cum: number[];
  members: Band[];            // largest first
  isOther?: boolean;          // the folded "N other classes" group
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
    return { buckets: [], bands: [], totalDamage: 0, mt: [], everyone: [], series: [] };
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

  const series: Band[] = everyone.map(e => ({
    name: e.name,
    total: e.total,
    cum: cumOf(dmgByName.get(e.name) || new Array(nB).fill(0)),
  }));

  return { buckets, bands, totalDamage, mt: mainTankLane(tookByBucket, buckets, stepSec), everyone, series };
}

/**
 * Group the unfolded per-name series by class for the class-level stacked view
 * (Hitya 2026-08-16: right-edge "class + %" labels, drill into a class for the
 * same per character). Largest class first; beyond `topN` classes the rest fold
 * into one "N other classes" group that stays drillable — same palette
 * discipline as the character fold (7 hues + one muted overflow, never an 8th).
 */
export function groupSeriesByClass(
  series: Band[],
  classOf: Record<string, string | null>,
  topN = TOP_N,
): ClassGroup[] {
  const byClass = new Map<string, Band[]>();
  for (const b of series) {
    const k = classOf[b.name] || 'Unknown';
    const arr = byClass.get(k);
    if (arr) arr.push(b); else byClass.set(k, [b]);
  }
  const nB = series[0]?.cum.length ?? 0;
  const sumCum = (members: Band[]): number[] => {
    const out = new Array(nB).fill(0);
    for (const m of members) for (let i = 0; i < nB; i++) out[i] += m.cum[i] || 0;
    return out;
  };
  const groups: ClassGroup[] = [...byClass.entries()].map(([klass, members]) => ({
    klass,
    total: members.reduce((a, m) => a + m.total, 0),
    cum: sumCum(members),
    members: [...members].sort((a, b) => b.total - a.total),
  })).sort((a, b) => b.total - a.total);
  if (groups.length <= topN + 1) return groups;   // +1: folding ONE class saves nothing
  const kept = groups.slice(0, topN);
  const rest = groups.slice(topN);
  const restMembers = rest.flatMap(g => g.members).sort((a, b) => b.total - a.total);
  kept.push({
    klass: `${rest.length} other classes`,
    total: rest.reduce((a, g) => a + g.total, 0),
    cum: sumCum(restMembers),
    members: restMembers,
    isOther: true,
  });
  return kept;
}

/**
 * MT lane: whoever's damage-taken rises fastest in a bucket is who the boss is
 * hitting. Run-length-encoded so a stable tank is one segment, not 200 ticks.
 *
 * Buckets where nobody took damage produce NO segment rather than extending the
 * previous tank — the boss being off everyone (mez, gate, a pause, RUNNING) is
 * real information and inventing continuity across it would hide a mechanic.
 *
 * ONE exception, measured 2026-08-16 (encounter 4d0d6dd2, the restless
 * burrower): the snapshot cadence is 3.5–6.4s against 5s buckets, so a single
 * empty bucket inside a stable tanking stretch is usually aliasing, not the
 * boss leaving — that fight had six scattered 1-bucket holes mid-fight and
 * one REAL 110s tail gap (the mob ran at ~5% while the raid kept hitting it).
 * A gap of exactly `bridgeBuckets` empty buckets with the SAME tank on both
 * sides is bridged (took just doesn't grow there); anything longer, or a gap
 * across a tank change, stays a hole.
 */
export function mainTankLane(
  tookByBucket: Map<string, number>[],
  buckets: number[],
  stepSec: number,
  bridgeBuckets = 1,
): MTSegment[] {
  const out: MTSegment[] = [];
  let cur: MTSegment | null = null;
  let gapSince: number | null = null;   // toSec of `cur` when the gap began

  for (let i = 0; i < tookByBucket.length; i++) {
    let best: string | null = null;
    let bestVal = 0;
    for (const [name, v] of tookByBucket[i]) {
      if (v > bestVal) { bestVal = v; best = name; }
    }
    const t = buckets[i];
    if (!best) {
      if (cur && gapSince === null) gapSince = cur.toSec;
      // Past the bridgeable width the hole is real — drop the segment.
      if (cur && gapSince !== null && t + stepSec - gapSince > bridgeBuckets * stepSec) {
        cur = null;
        gapSince = null;
      }
      continue;
    }
    if (cur && cur.name === best && (cur.toSec === t || gapSince !== null)) {
      cur.toSec = t + stepSec;
      cur.took += bestVal;
    } else {
      cur = { fromSec: t, toSec: t + stepSec, name: best, took: bestVal };
      out.push(cur);
    }
    gapSince = null;
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
