// Route planner: the "Recorded" route source. Pure (no DOM, no three.js), so the root vitest suite real-imports it.
//
// The planner's legs come three ways, as a VIEW over the plan (the plan keeps its own straight or bent line):
//   Straight   the line the officers drew
//   Walk       along the server's own walkable map (navroute.ts)
//   Recorded   along where the raid actually went: the distance-resampled average of every recorded night that passed the
//              leg's two pins in that order (follow.ts)
// In Recorded a leg no night covers falls back to Walk when the walkable map is there, and to Straight when it is not;
// the leg's card says which. Recorded wins over Walk whenever both exist: it is where we really ran.
import type { Follow } from './follow';
import { bakeRecorded } from './follow';
import type { Leg } from './plan';
import type { Plan } from './types';

export type LegSource = 'recorded' | 'walked' | 'straight';

/** Which of the three a leg is drawn along, given the answers on it (`rec` / `walk` as the engine annotated them). */
export function legSource(lg: Pick<Leg, 'rec' | 'walk'>): LegSource {
  if (lg.rec && lg.rec.state === 'ok') return 'recorded';
  if (lg.walk && lg.walk.state === 'ok') return 'walked';
  return 'straight';
}

/** What a leg's card says about its route source in Recorded mode: "recorded: 3 nights" / "no recorded night: walked" / "straight". */
export function recText(lg: Pick<Leg, 'rec' | 'walk'>): string {
  const s = legSource(lg);
  if (s === 'recorded') { const n = (lg.rec as { nights: number }).nights; return `recorded: ${n} night${n === 1 ? '' : 's'}`; }
  if (s === 'walked') return 'no recorded night: walked';
  if (lg.walk && lg.walk.state === 'pending') return 'no recorded night: finding the walking route…';
  return 'straight';
}

/**
 * Set `rec` on every leg: the recorded route when a night ran it, else none. A leg through a teleport is left to the walk
 * route (a night's samples jump at a teleport, and an average of them would draw straight through the jump), and so is one
 * whose pins are too close for a recorded path to be more than noise (follow.ts MIN_FOLLOW).
 */
export function annotateRecorded(legs: readonly Leg[], follow: Pick<Follow, 'recorded'>): void {
  for (const lg of legs) {
    const r = lg.jump ? null : follow.recorded(lg.a, lg.b);
    lg.rec = r ? { state: 'ok', len: r.len, nights: r.nights } : { state: 'none' };
  }
}

/** The recorded polylines (pin to pin) by leg key, for the legs that have one: what the 3D view draws. */
export function recordedPolys(legs: readonly Leg[], follow: Pick<Follow, 'recorded'>): Map<string, [number, number][]> {
  const out = new Map<string, [number, number][]>();
  for (const lg of legs) {
    if (!lg.rec || lg.rec.state !== 'ok') continue;
    const r = follow.recorded(lg.a, lg.b);
    if (r) out.set(lg.k, r.poly);
  }
  return out;
}

/**
 * "Use recorded routes": bake the recorded average of the given legs into their bend points in the plan (`Line.pts`), no more
 * than `max` bends each, and mark them as following the nights they average. The pins, a hidden leg's hidden state, a leg's
 * teleport and its optional flag stay as they are. A leg no night covers is left alone. Returns how many legs it baked.
 */
export function useRecordedRoutes(plan: Plan, legs: readonly Leg[], follow: Pick<Follow, 'recorded'>, max = 40): { baked: number; skipped: number } {
  let baked = 0, skipped = 0;
  for (const lg of legs) {
    const r = lg.jump ? null : follow.recorded(lg.a, lg.b);
    if (!r) { skipped++; continue; }
    let ln = plan.lines.find(x => x.k === lg.k);
    if (!ln) { ln = { k: lg.k, pts: [], off: false }; plan.lines.push(ln); }
    ln.pts = bakeRecorded(r.poly, max);
    ln.follow = r.nights;
    delete ln.h;
    baked++;
  }
  return { baked, skipped };
}
