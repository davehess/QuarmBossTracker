// Route planner: planned against what one recorded night actually did. Pure.
//
// The night comes from the SAME place /raid/routes reads (GET /api/raid/routes?zone=<z>&nights=<visit key>, lib/raidRoutes.ts):
// for one night its route is that night's named kills in the order they died (`stops`, with the spawn point or the raid
// centre they happened at) and the walk between them (`legs`, leg i ends at stop i; leg 0 starts at first engage).
//
// MATCHING a kill to a pin: by npc id first, then (for kills still without a pin) by name (a pin is "Tallon Zek (south wing)",
// the kill is "Tallon Zek"), and when several pins fit, the one NEAREST to where the kill happened, each pin used once, kills
// taken in the order they died. A pin with no kill whose spot the night's path came within FOLLOW_R of is "passed", not "never visited".
// Only boss / named / scripted pins that carry an npc can be "visited"; the zone-in and the Projections to hail cannot.
import { FOLLOW_R } from './follow';
import { allPins, dist, legLength, planLegs, polyLen, type Leg } from './plan';
import type { Pin, Plan, ZoneLink } from './types';

export type ActualStop = { n: number; npc_id: number; name: string; x: number | null; y: number | null; at: 'spawn' | 'raid' | null; medianClockS: number | null };
export type ActualLeg = { from: string; to: string; medianS: number | null; pts: [number, number][] };
export type Actual = {
  label: string;
  stops: ActualStop[];             // kill order
  legs: ActualLeg[];               // legs[i] ends at stops[i]
  path: [number, number][];        // the night's centre path, first engage to last stop
};

const norm = (s: string) => s.replace(/\([^)]*\)/g, ' ').replace(/^#/, '').replace(/_/g, ' ').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();

const isKillPin = (p: Pin) => p.npc !== undefined && (p.kind === 'boss' || p.kind === 'named' || p.kind === 'scripted');

/** pin id -> the number the plan shows for it: 1..N on the main route, A1.. / B1.. in a branch. */
export function pinNumbers(plan: Plan): Map<string, string> {
  const out = new Map<string, string>();
  plan.pins.forEach((p, i) => out.set(p.id, String(i + 1)));
  for (const s of plan.splits) s.branches.forEach((b, bi) => b.pins.forEach((p, i) => out.set(p.id, String.fromCharCode(65 + bi) + (i + 1))));
  return out;
}

/**
 * kill index (into actual.stops) -> pin, one pin per kill. Two passes: every kill takes a pin of its own npc id first, and only
 * the kills still without one try by name, so "Tallon Zek" (home) cannot take the "Tallon Zek (event)" pin ahead of the event kill.
 */
export function matchKills(plan: Plan, stops: readonly ActualStop[]): Map<number, Pin> {
  const left = allPins(plan).filter(isKillPin);
  const out = new Map<number, Pin>();
  const take = (i: number, s: ActualStop, cand: Pin[]) => {
    if (!cand.length) return;
    let best = cand[0];
    if (s.x != null && s.y != null && cand.length > 1) {
      let bd = Infinity;
      for (const p of cand) { const d = dist(p, { x: s.x, y: s.y }); if (d < bd) { bd = d; best = p; } }
    }
    out.set(i, best);
    left.splice(left.indexOf(best), 1);
  };
  stops.forEach((s, i) => take(i, s, left.filter(p => p.npc === s.npc_id)));
  stops.forEach((s, i) => { if (!out.has(i)) take(i, s, left.filter(p => norm(p.label) === norm(s.name))); });
  return out;
}

/** Distance from a point to a polyline (to its one point when it has one, Infinity with none). */
function distToPath(p: { x: number; y: number }, path: readonly (readonly [number, number])[]): number {
  let best = Infinity;
  for (let i = 0; i < path.length; i++) {
    const [ax, ay] = path[i], [bx, by] = path[Math.min(i + 1, path.length - 1)];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy)));
  }
  return best;
}

export type LegCompare = {
  leg: Leg;
  from: string; to: string;                       // pin numbers
  plannedU: number;
  actualOrder: [number, number] | null;           // kill numbers (1-based) of the two ends, when both were killed
  actualU: number | null;
  actualS: number | null;
  between: number;                                // other kills between the two in the actual night
  status: 'walked' | 'reversed' | 'one end not in the night' | 'not a kill leg';
};

export type Comparison = {
  label: string;
  actualOrder: { n: number; name: string; pin: string | null }[];
  plannedOrder: { pin: string; name: string; killed: number | null; passed: boolean; optional: boolean }[];   // the kill pins, in plan order; passed: not killed, but the raid's path came within FOLLOW_R
  legs: LegCompare[];
  passed: { pin: string; name: string; optional: boolean }[];          // not killed, the night walked past it
  neverVisited: { pin: string; name: string; optional: boolean }[];    // not killed and the path never came near
  notInPlan: { n: number; name: string }[];
};

export function comparePlan(plan: Plan, skipOptional: boolean, actual: Actual, links: readonly ZoneLink[] = []): Comparison {
  const nums = pinNumbers(plan);
  const match = matchKills(plan, actual.stops);
  const killOf = new Map<string, number>();            // pin id -> kill number
  match.forEach((p, i) => killOf.set(p.id, i + 1));
  const idxOf = new Map<string, number>();             // pin id -> index into actual.stops
  match.forEach((p, i) => idxOf.set(p.id, i));

  const legs: LegCompare[] = planLegs(plan, skipOptional, links).map(leg => {
    const row: LegCompare = {
      leg, from: nums.get(leg.a.id) ?? '?', to: nums.get(leg.b.id) ?? '?', plannedU: legLength(leg),
      actualOrder: null, actualU: null, actualS: null, between: 0, status: 'not a kill leg',
    };
    const ka = idxOf.get(leg.a.id), kb = idxOf.get(leg.b.id);
    if (!isKillPin(leg.a) || !isKillPin(leg.b)) {
      // the zone-in and the Projections are not kills: nothing to measure the leg against
      return row;
    }
    if (ka === undefined || kb === undefined) { row.status = 'one end not in the night'; return row; }
    row.actualOrder = [ka + 1, kb + 1];
    if (kb < ka) { row.status = 'reversed'; return row; }
    row.status = 'walked';
    row.between = kb - ka - 1;
    let u = 0, s: number | null = 0;
    for (let k = ka + 1; k <= kb; k++) {
      const l = actual.legs[k];
      if (!l) { u = NaN; s = null; break; }
      u += polyLen(l.pts);
      s = s == null || l.medianS == null ? null : s + l.medianS;
    }
    row.actualU = Number.isFinite(u) ? u : null;
    row.actualS = s;
    return row;
  });

  // A pin the night never killed may still have been walked past (upstairs Rallos never dies: he leaps at 50%): "passed", not "never visited".
  const plannedOrder = allPins(plan).filter(isKillPin).map(p => {
    const killed = killOf.get(p.id) ?? null;
    return { pin: nums.get(p.id) ?? '?', name: p.label, killed, passed: killed === null && distToPath(p, actual.path) <= FOLLOW_R, optional: p.optional };
  });
  return {
    label: actual.label,
    actualOrder: actual.stops.map((s, i) => ({ n: i + 1, name: s.name, pin: match.has(i) ? nums.get((match.get(i) as Pin).id) ?? null : null })),
    plannedOrder,
    legs,
    passed: plannedOrder.filter(p => p.passed).map(p => ({ pin: p.pin, name: p.name, optional: p.optional })),
    neverVisited: plannedOrder.filter(p => p.killed === null && !p.passed).map(p => ({ pin: p.pin, name: p.name, optional: p.optional })),
    notInPlan: actual.stops.flatMap((s, i) => (match.has(i) ? [] : [{ n: i + 1, name: s.name }])),
  };
}
