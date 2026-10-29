// The pure half of the PoP guide's "Getting there" line (see popGettingThere.ts): the shapes the server sends and the
// one rule the beta layout applies to the rows it shows. It imports nothing, because GuideRoute.tsx is a client
// component and must not pull in popTravel.ts (the cited routes, ~90 KB) to place a line.

export type GettingThere = { main: string; alt?: string };

export type GuideGettingThere = {
  /** step key -> its zone (the Plane of Knowledge included: a step there ends a run, and has no line). */
  steps: Record<string, string>;
  /** zone -> its line. */
  lines: Record<string, GettingThere>;
};

/**
 * Which of the rows shown start a new zone, and so carry the line. Steps with no zone are skipped over, so a step
 * that needs no travel does not repeat the line; a Plane of Knowledge step (no line) ends the run before it.
 */
export function startsOfRuns(rows: { key: string }[], gt: GuideGettingThere): Map<string, GettingThere> {
  const out = new Map<string, GettingThere>();
  let prev: string | null = null;
  for (const r of rows) {
    const z = gt.steps[r.key];
    if (!z) continue;
    if (z !== prev) {
      const l = gt.lines[z];
      if (l) out.set(r.key, l);
      prev = z;
    }
  }
  return out;
}
