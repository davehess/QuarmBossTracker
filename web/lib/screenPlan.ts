// The raid-night plan as /screen uses it (the guild lead picked option C, 2026-10-14): the plan drawn under
// the live map when the raid stands in a zone the plan covers, and a "who still lacks which preflag" summary
// for the Overview.
//
// Client-safe and pure on purpose. The plan itself (lib/raidPlan.ts) is long prose the browser has no use for,
// so the SERVER page builds these small shapes from it and hands them down; this file only holds the shapes and
// the two lookups, with type-only imports so pulling it into the map's bundle pulls nothing else in.
//
// Frame: the overlay's x, y are the plan's own, the SERVER frame (the spawn table's), the same frame as the
// walls and as a raider's x, y after serverXY. So the map draws them through toScreen() like those, and never
// through serverXY's column swap (that converts raid_roster's loc columns, which these are not).
import type { MapMarker, Pt, Preflag, RoutePt } from '@/lib/raidPlan';

export type PlanOverlay = {
  zone: string;          // zone short name, as the map's zone ids
  markers: MapMarker[];
  route: RoutePt[];
  altRoutes?: RoutePt[][];
  patrol?: Pt[];
};

/** The drawable part of each plan section: no prose, just where things are. */
export function planOverlays(
  sections: { zone: string; markers: MapMarker[]; route: RoutePt[]; altRoutes?: RoutePt[][]; patrol?: Pt[] }[],
): PlanOverlay[] {
  return sections.map(s => ({ zone: s.zone, markers: s.markers, route: s.route, altRoutes: s.altRoutes, patrol: s.patrol }));
}

/** The overlay for the zone on screen, or null (no plan given, no zone, or the plan does not cover it). */
export function overlayForZone(plan: PlanOverlay[] | undefined, zone: string | null): PlanOverlay | null {
  if (!plan || !zone) return null;
  return plan.find(p => p.zone === zone) ?? null;
}

export type PreflagLine = { key: string; short: string; label: string; missing: string[] };
export type PreflagSummary = { note: string; total: number; lines: PreflagLine[] };

/**
 * Per preflag, who of `raiders` does not hold it. `held` is keyed by lower-case name (loadHeld in
 * lib/raidPreflags.ts); a raider with no entry holds nothing.
 */
export function preflagSummary(
  raiders: { name: string }[],
  held: Map<string, Set<string>>,
  preflags: Pick<Preflag, 'key' | 'short' | 'label'>[],
  note: string,
): PreflagSummary {
  return {
    note,
    total: raiders.length,
    lines: preflags.map(p => ({
      key: p.key,
      short: p.short,
      label: p.label,
      missing: raiders.filter(r => !held.get(r.name.toLowerCase())?.has(p.key)).map(r => r.name),
    })),
  };
}
