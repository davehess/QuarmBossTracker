// /pop sidebar previews (the guild lead, 2026-10-21: "Need a sidebar for the pop flags page, the essences of power
// should be minimized and under the elementals section.").
//
// Two genuinely different sidebars, each its own preview on beta, picked by ?v= (CLAUDE.md: UI on an existing page
// ships as options on b.wolfpack.quest, and no ?v= is the page exactly as production has it):
//   ?v=b  a NAVIGATION sidebar on the left: the view buttons and a jump link to every tier and plane, each plane
//         with its "N in" count.
//   ?v=c  a YOUR-PROGRESS sidebar on the right: your characters' next flag step, what to raid next, and the
//         essences queue in one glance.
// In both, the Essences of Power card moves into the Elemental tier (Tier Four) and starts folded.
//
// This file is the pure part (test/pop-sidebar.test.js runs it for real): which variant a URL names, where the
// essences card goes, the sidebar's lists. It reads nothing and renders nothing: the components are in
// web/app/pop/ (Tailwind only scans app/ and components/, so no class names live here), and the page hands in
// what it has already loaded, so a preview costs no new query.

import type { PopNode } from './popFlags';
import { TIER_COLORS, TIER_LABELS } from './popFlags';
import { nextCard, nextSteps } from './popNextSteps';
import type { NextUp } from './essencesQueue';

export type SideVariant = 'b' | 'c';

/** The `?v=` switch: 'b' or 'c' show a sidebar; anything else (absent, 'a', a repeated param) shows none, so
 *  the page without it stays exactly what production has. */
export function sideVariant(raw: unknown): SideVariant | null {
  return raw === 'b' || raw === 'c' ? raw : null;
}

/** The elemental tier: Earth, Air, Water and Fire, where the four essences drop. */
export const ELEMENTAL_TIER = 4;

/** Where the Essences of Power card goes.
 *  top       the full card above everything: the page as production has it (no variant)
 *  tier      folded, at the foot of the Elemental tier (a variant, on the chart that has tier sections)
 *  top-fold  folded, in the old place (a variant, on a view with no tier sections: Matrix, My Characters, one zone) */
export type EssencePlace = 'top' | 'tier' | 'top-fold';
export function essencesPlace(side: SideVariant | null, chartBody: boolean): EssencePlace {
  if (!side) return 'top';
  return chartBody ? 'tier' : 'top-fold';
}

export const tierAnchor = (tier: number) => `tier-${tier}`;
export const zoneAnchor = (key: string) => `zone-${key}`;
export const ESSENCES_ANCHOR = 'essences';

// ── Variant B: the jump list ────────────────────────────────────────────────────────────────────────────────────
export type NavZone = { key: string; id: string; short: string; name: string; elig: number };
export type NavGroup = { tier: number; id: string; name: string; sub: string; color: string; zones: NavZone[] };

/** One group per tier that has a plane, planes in the chart's column order. Sub-zones (the lower Crypt, the Temple
 *  of Marr, Ragrax) ride inside their parent's card on the chart, so they are not listed on their own. */
export function navGroups(zones: PopNode[], elig: ReadonlyMap<string, number>): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const tier of Object.keys(TIER_LABELS).map(Number).sort((a, b) => a - b)) {
    const inTier = zones.filter(z => !z.subZoneOf && z.tier === tier).sort((a, b) => a.col - b.col);
    if (inTier.length === 0) continue;
    groups.push({
      tier, id: tierAnchor(tier), name: TIER_LABELS[tier].name, sub: TIER_LABELS[tier].sub, color: TIER_COLORS[tier],
      zones: inTier.map(z => ({ key: z.key, id: zoneAnchor(z.key), short: z.short, name: z.name, elig: elig.get(z.key) ?? 0 })),
    });
  }
  return groups;
}

// ── The essences, condensed ─────────────────────────────────────────────────────────────────────────────────────
export const ESSENCE_ICON: Record<NextUp['key'], string> = { fire: '🔥', wind: '💨', water: '💧', earth: '🪨' };

export type DropGroup = { icons: string; who: string | null };
/** Who gets the next drop, one entry per person with their essences together ("🔥💨 Aldenmar"), and the essences
 *  nobody is in line for together as who: null ("bid it"). First essence first, in the card's own order. */
export function dropGroups(next: NextUp[]): DropGroup[] {
  const by = new Map<string, DropGroup>();
  for (const n of next) {
    const k = n.bid || !n.name ? '\u0000bid' : n.name.toLowerCase();
    const g = by.get(k) ?? { icons: '', who: n.bid || !n.name ? null : n.name };
    g.icons += ESSENCE_ICON[n.key];
    by.set(k, g);
  }
  return [...by.values()];
}

// ── Variant C: your progress ────────────────────────────────────────────────────────────────────────────────────
export type MineRow = { name: string; cls: string | null; main: boolean; flags: Iterable<string> };
export type MineProgress = {
  name: string; cls: string | null; main: boolean;
  /** The one step to do next (must-haves first, then the guide's order). null: nothing open to do right now. */
  next: { line: string; title: string; zone: string | null } | null;
  /** Other lines with a step open to do. */
  more: number;
  /** What the lines with nothing open wait on, first one named (a gate flag), when `next` is null. */
  waitingOn: string | null;
  finished: boolean;
};

/** Each character's next step, from the flags the page already holds for them (Mimic, /who, loot and the owner's
 *  ticks, merged on the page). Steps with no flag of their own (a hail, a talk) only show as done once a later flag
 *  proves them, which is how the checklist itself reads evidence; the full checklist is one link away. */
export function mineProgress(rows: MineRow[], max = 6): { shown: MineProgress[]; hidden: number } {
  const all = rows.map((r): MineProgress => {
    const card = nextCard(nextSteps({ done: [], flags: [...r.flags] }), 1);
    const top = card.top[0];
    return {
      name: r.name, cls: r.cls, main: r.main,
      next: top ? { line: top.label, title: top.step.title, zone: top.step.zone } : null,
      more: card.more,
      waitingOn: !top ? card.blocked[0]?.blockedOn[0]?.label ?? null : null,
      finished: card.finished === card.lines,
    };
  });
  return { shown: all.slice(0, max), hidden: Math.max(0, all.length - max) };
}

/** ?demo=1 sample characters for the progress sidebar: invented names, none is anybody. */
export function demoMine(): MineRow[] {
  return [
    { name: 'Aldenmar', cls: 'Cleric', main: true, flags: ['trial_justice', 'grummus_dead', 'behemoth_dead', 'hedge_event', 'aerindar_dead', 'askr_quest', 'carprin_cycle'] },
    { name: 'Brackwyn', cls: 'Enchanter', main: false, flags: ['trial_justice', 'grummus_dead', 'behemoth_dead', 'hedge_event'] },
    { name: 'Corvale', cls: 'Wizard', main: false, flags: [] },
  ];
}

/** One row of "what to raid next", cut down from the page's planner. */
export type RaidNextRow = { key: string; icon: string; label: string; zoneShort: string; zoneHref: string; gains: number; unlocks: number };
