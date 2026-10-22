// Route planner: the rules behind the "One leg" mode (?v=leg, ?v=b, ?v=c on /raid/plan/routes). With 26 pins the map is a
// tangle of crossing legs, so the mode draws one leg at a time. No DOM here, so the root vitest suite real-imports this; the
// engine only decides what to draw from what this returns.
import type { Leg } from './plan';
import { legLength } from './plan';

/** A leg index held inside 0..n-1 (0 when there are no legs, or the index is not a number). */
export function clampLeg(i: number, n: number): number {
  if (!(n > 0) || !Number.isFinite(i)) return 0;
  return Math.min(n - 1, Math.max(0, Math.trunc(i)));
}

/** One step back (-1) or on (+1): it stops at the first and last leg rather than wrapping. */
export const stepLeg = (i: number, d: number, n: number): number => clampLeg(i + d, n);

/**
 * The current leg once `pinId` is selected: the leg that starts at the pin. A pin that starts several (a split's start pin)
 * keeps the current leg when it is one of them. The route's last pin starts nothing, so it takes the leg that ends there;
 * a pin on no leg at all (an optional pin skipped from the route) leaves the current leg alone.
 */
export function legIndexForPin(legs: readonly Leg[], pinId: string | null | undefined, current: number): number {
  const cur = clampLeg(current, legs.length);
  if (!pinId || !legs.length) return cur;
  if (legs[cur].a.id === pinId) return cur;
  const starts = legs.findIndex(l => l.a.id === pinId);
  if (starts >= 0) return starts;
  if (legs[cur].b.id === pinId) return cur;
  const ends = legs.findIndex(l => l.b.id === pinId);
  return ends >= 0 ? ends : cur;
}

/** Seconds as m:ss, rounded to the second. */
export function clockText(s: number): string {
  const t = Math.max(0, Math.round(s));
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
}

/** The bar over the map: "Leg 5 of 25: A → B · 812 u · ~1:40". The time is the recorded median and is left out when there is none. */
export function legBarText(leg: Leg, index: number, count: number, timeS: number | null): string {
  const bits = [Math.round(legLength(leg)).toLocaleString('en-US') + ' u'];
  if (timeS != null && Number.isFinite(timeS)) bits.push('~' + clockText(timeS));
  const w = leg.walk;
  if (w && w.state === 'ok') { if (w.via.length) bits.push('via ' + w.via.join(', then ')); }
  else if (w && w.state === 'none') bits.push('no walkable route found');
  else if (w) bits.push('finding the walking route…');
  if (leg.branch) bits.push(leg.branch.branch.label);
  if (leg.off) bits.push('hidden leg');
  return `Leg ${index + 1} of ${count}: ${leg.a.label} → ${leg.b.label} · ${bits.join(' · ')}`;
}
