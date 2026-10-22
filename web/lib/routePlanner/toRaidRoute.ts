// Route planner -> the in-game map. Pure.
//
// "Send to in-game map" writes the plan in EXACTLY the shape web/app/raid/routes/actions.ts saves for a measured route,
// under the same key (`raid_route:<zone>`), because the bot's GET /api/agent/raid-route serves that key to Mimic's Map
// overlay and the overlay draws what it finds. One shape, two ways to make it. Version 1:
//   { v:1, zone, name, saved_at, nights:[night_key...], keys:[visit key...],
//     points:[[x,y]...]          the route end to end, SERVER frame (not negated), whole units,
//     stops:[{ n, npc_id, name, x, y, at:'spawn'|'raid', median_clock_s }],
//     legs:[{ from, to, median_s, best_s, nights, start_index, end_index }]   indexes into points,
//     clears:[{ x, y, leg, name, nights, of }] }
// What a plan can and cannot say in it:
//   • stops: the route pins in order (n = 1..N). `npc_id` is the pin's npc, 0 for a pin that is not a mob (a note);
//     `at` is 'spawn' for a pin that came from a catalog or script point, 'raid' for one dropped by hand;
//     `median_clock_s` is the recorded time since the first stop, summed from the legs' recorded medians, null from the
//     first leg that no recorded night walked.
//   • legs: one per visible leg. A leg the officers hid is not drawn in game either, so it has no slice of `points`.
//     `median_s`/`best_s`/`nights` come from the recorded nights that passed both pins.
//   • a SPLIT is flattened: the start pin, then each branch's pins in turn (named "Team A: Vallon Zek"), then the regroup
//     pin; every branch's legs are legs like any other. The regroup pin's clock is the start's plus the slowest branch.
//   • keys and clears are empty: a plan is drawn by hand, it did not clear anything.
import { activeSplits, legPoly, planLegs, routePins } from './plan';
import type { Follow } from './follow';
import type { Pin, Plan, ZoneData } from './types';

export type RaidRouteValue = {
  v: 1;
  zone: string;
  name: string;
  saved_at: string;
  nights: string[];
  keys: string[];
  points: [number, number][];
  stops: { n: number; npc_id: number; name: string; x: number; y: number; at: 'spawn' | 'raid'; median_clock_s: number | null }[];
  legs: { from: string; to: string; median_s: number | null; best_s: number | null; nights: number; start_index: number; end_index: number }[];
  clears: { x: number; y: number; leg: number; name: string; nights: number; of: number }[];
};

export type ToRaidRouteOptions = { skipOptional?: boolean; nowIso: string };

const whole = (n: number) => Math.round(n);

/** Null when the plan has no leg to draw (fewer than two route pins, or every leg hidden). */
export function planToRaidRoute(plan: Plan, zone: ZoneData, follow: Follow, opts: ToRaidRouteOptions): RaidRouteValue | null {
  const skip = !!opts.skipOptional;
  const legs = planLegs(plan, skip, zone.links);
  const visible = legs.filter(l => !l.off);
  if (!visible.length) return null;

  const points: [number, number][] = [];
  const legOut: RaidRouteValue['legs'] = visible.map(l => {
    const start = points.length;
    for (const p of legPoly(l)) points.push([whole(p[0]), whole(p[1])]);
    const st = follow.legStats(l.a, l.b);
    return { from: l.a.label, to: l.b.label, median_s: st.median, best_s: st.best, nights: st.nights, start_index: start, end_index: points.length - 1 };
  });

  const medianOf = (a: Pin, b: Pin): number | null => follow.legStats(a, b).median;
  // a branch's clock at each of its pins, and when it reaches the regroup pin (null once a leg of it was never walked)
  const walk = (from: Pin, seq: Pin[], to: Pin, startClock: number | null) => {
    const clocks: (number | null)[] = [];
    let clock = startClock, prev = from;
    for (const p of seq) {
      const m = medianOf(prev, p);
      clock = clock == null || m == null ? null : clock + m;
      clocks.push(clock); prev = p;
    }
    const m = medianOf(prev, to);
    return { clocks, end: clock == null || m == null ? null : clock + m };
  };

  const rp = routePins(plan, skip);
  const splits = activeSplits(plan, skip);
  const order: { pin: Pin; name: string; clock: number | null }[] = [];
  let clock: number | null = 0;
  rp.forEach((p, i) => {
    order.push({ pin: p, name: p.label, clock });
    const next = rp[i + 1];
    if (!next) return;
    const split = splits.get(p.id);
    const ends: (number | null)[] = [];
    if (split) {
      for (const b of split.branches) {
        const seq = b.pins.filter(q => !(skip && q.optional));
        if (!seq.length) continue;
        const w = walk(p, seq, next, clock);
        seq.forEach((q, j) => order.push({ pin: q, name: `${b.label}: ${q.label}`, clock: w.clocks[j] }));
        ends.push(w.end);
      }
    }
    if (ends.length) clock = ends.some(e => e == null) ? null : Math.max(...(ends as number[]));   // the raid regroups when the slowest branch is there
    else { const m = medianOf(p, next); clock = clock == null || m == null ? null : clock + m; }
  });

  const stops: RaidRouteValue['stops'] = order.map((o, i) => ({
    n: i + 1, npc_id: o.pin.npc ?? 0, name: o.name, x: whole(o.pin.x), y: whole(o.pin.y),
    at: o.pin.mob ? 'spawn' : 'raid', median_clock_s: o.clock == null ? null : Math.round(o.clock),
  }));

  return {
    v: 1,
    zone: zone.zone,
    name: zone.name,
    saved_at: opts.nowIso,
    nights: zone.nights.map(n => n.key),
    keys: [],
    points,
    stops,
    legs: legOut,
    clears: [],
  };
}
