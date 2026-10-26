// The pure parts of the /pop/raid maps: where the picture is framed, how Brewall's lines become one small SVG path,
// which route is drawn, and how markers are lettered. No React, no Supabase, so the page, the SVG and the tests share
// one copy of the rules.
//
// FRAME. Everything here is the SERVER frame (the spawn table's x, y; Brewall's file coordinates already negated back
// into it by lib/zoneMap/brewall.ts). The picture is north-up, so a point is drawn at toScreen(x, y) = (-x, -y). One
// conversion for the art, the markers, the route and the patrol is what keeps them lined up.
import { toScreen } from './spectator';
import type { Bounds } from './zoneMap/slice';
import type { BrewallLine } from './zoneMap/brewall';
import type { MapMarker, Pt, RoutePt } from './raidPlan';

export type Frame = { vx: number; vy: number; vw: number; vh: number };

// A plan that covers less than this share of the zone's drawn extent is zoomed to the plan (the Lair's arena sits in
// one end of a 4,000-unit zone); anything bigger shows the whole zone, so a big zone is never cropped.
const ZOOM_BELOW = 0.3;
const MIN_SPAN = 100;
const MIN_ZOOM_SPAN = 400;

type Box = { x0: number; y0: number; x1: number; y1: number };

function boxOf(pts: { sx: number; sy: number }[]): Box | null {
  if (!pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.sx < x0) x0 = p.sx;
    if (p.sx > x1) x1 = p.sx;
    if (p.sy < y0) y0 = p.sy;
    if (p.sy > y1) y1 = p.sy;
  }
  return { x0, y0, x1, y1 };
}

const spanOf = (b: Box) => Math.max(b.x1 - b.x0, b.y1 - b.y0);

/** The viewBox for one zone: the plan's points, widened to the zone's drawn extent unless the plan is a small corner of it. */
export function planFrame(pts: Pt[], bounds: Bounds | null): Frame {
  const plan = boxOf(pts.map(p => toScreen(p.x, p.y)));
  const zone: Box | null = bounds ? { x0: -bounds.maxX, y0: -bounds.maxY, x1: -bounds.minX, y1: -bounds.minY } : null;
  let box: Box;
  let zoomed = false;
  if (plan && zone) {
    zoomed = spanOf(plan) < ZOOM_BELOW * spanOf(zone);
    box = zoomed ? plan : { x0: Math.min(plan.x0, zone.x0), y0: Math.min(plan.y0, zone.y0), x1: Math.max(plan.x1, zone.x1), y1: Math.max(plan.y1, zone.y1) };
  } else {
    box = plan ?? zone ?? { x0: -500, y0: -500, x1: 500, y1: 500 };
  }
  const span = Math.max(spanOf(box), zoomed ? MIN_ZOOM_SPAN : MIN_SPAN);
  const pad = span * (zoomed ? 0.14 : 0.06);
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const w = Math.max(box.x1 - box.x0, zoomed ? MIN_ZOOM_SPAN : 0) + pad * 2;
  const h = Math.max(box.y1 - box.y0, zoomed ? MIN_ZOOM_SPAN : 0) + pad * 2;
  return { vx: cx - w / 2, vy: cy - h / 2, vw: w, vh: h };
}

/**
 * Brewall's lines as one SVG path in screen coordinates. Lines are in whole server units. A line is kept when it
 * touches the frame (grown by 40%, so a wall running off the edge is whole to the edge); none is dropped for being
 * short or for lying on another floor. Segments that continue the previous one (the art is drawn as runs) share one
 * subpath, and the drawing is relative after the first point, which is what keeps a 7,000-line zone small. An exact
 * repeat of a segment, in either direction, is drawn once.
 */
export function brewallPath(lines: BrewallLine[], frame: Frame): string {
  // The page draws the frame at the width of its column, so the picture can show more than the viewBox on one side:
  // keep what lies a good way past it too, or the walls would end in a straight cut at the edge of the frame.
  const m = Math.max(frame.vw, frame.vh) * 0.4;
  const x0 = frame.vx - m, y0 = frame.vy - m, x1 = frame.vx + frame.vw + m, y1 = frame.vy + frame.vh + m;
  const seen = new Set<string>();
  const out: string[] = [];
  let cx = NaN, cy = NaN;   // where the pen is, screen units; NaN = no open subpath
  for (const l of lines) {
    const ax = -l[0] || 0, ay = -l[1] || 0, bx = -l[3] || 0, by = -l[4] || 0;
    if (ax === bx && ay === by) continue;
    if ((ax < x0 && bx < x0) || (ax > x1 && bx > x1) || (ay < y0 && by < y0) || (ay > y1 && by > y1)) continue;
    const key = ax < bx || (ax === bx && ay < by) ? `${ax},${ay},${bx},${by}` : `${bx},${by},${ax},${ay}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (ax === cx && ay === cy) out.push(`l${bx - ax} ${by - ay}`);
    else out.push(`M${ax} ${ay}l${bx - ax} ${by - ay}`);
    cx = bx;
    cy = by;
  }
  return out.join('');
}

/** A marker's letter: A, B, C ... (the legend under the map says which is which; the map carries no names). */
export const markerLetter = (i: number): string => String.fromCharCode(65 + (i % 26));

/** A marker's glyph: where it is drawn (sx, sy) and where the point truly is (ox, oy), in screen units. */
export type Glyph = { sx: number; sy: number; ox: number; oy: number };

const GLYPH_GAP = 2.3; // centre to centre, in glyph radii: the widest shape (the zone-in diamond) is 1.3 across half-way

/**
 * Where each marker's glyph is drawn. A glyph stays on its point unless another one would sit on it; then the two are
 * pushed apart along the line between them, no further than they need, so two points a boss-width apart (the Disease
 * boss and its pipe) stay two readable letters. The map shows a short leader from a moved glyph back to its point.
 */
export function spreadGlyphs(markers: Pt[], gr: number): Glyph[] {
  const g: Glyph[] = markers.map(m => { const s = toScreen(m.x, m.y); return { sx: s.sx, sy: s.sy, ox: s.sx, oy: s.sy }; });
  const min = gr * GLYPH_GAP;
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let a = 0; a < g.length; a++) {
      for (let b = a + 1; b < g.length; b++) {
        const dx = g[b].sx - g[a].sx, dy = g[b].sy - g[a].sy;
        const d = Math.hypot(dx, dy);
        if (d >= min) continue;
        moved = true;
        // two glyphs on one spot are split sideways, the later one to the right
        const ux = d > 1e-6 ? dx / d : 1, uy = d > 1e-6 ? dy / d : 0;
        const push = (min - d) / 2 + 1e-6;
        g[a].sx -= ux * push; g[a].sy -= uy * push;
        g[b].sx += ux * push; g[b].sy += uy * push;
      }
    }
    if (!moved) break;
  }
  return g;
}

// ── the saved route ────────────────────────────────────────────────────────────────────────────────

export type SavedRoute = {
  /** True when recorded nights were averaged (an officer saved it from /raid/routes); false when it was sent from the route planner. */
  walked: boolean;
  nights: string[];
  savedAt: string | null;
  legs: Pt[][];
  stops: RoutePt[];
};

const MAX_ROUTE_POINTS = 1500;
const MAX_STOPS = 60;
const COORD_LIMIT = 100000;
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const coord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= COORD_LIMIT;
const label = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 64) : '');

/**
 * `bot_kv` `raid_route:<zone>` (web/app/raid/routes/actions.ts, web/lib/routePlanner/toRaidRoute.ts) -> what the map
 * draws, or null when there is nothing to draw. The value is the bot's to read too (utils/raidRoute.js), so it is
 * re-checked the same way: a hand-edited row must not be able to put a script-shaped name or a huge body on the page.
 * Points are thinned evenly per leg to MAX_ROUTE_POINTS; a leg keeps both its ends.
 */
export function slimSavedRoute(value: unknown): SavedRoute | null {
  if (!isObj(value) || !Array.isArray(value.points)) return null;
  const pts: (Pt | null)[] = value.points.map(p => (Array.isArray(p) && coord(p[0]) && coord(p[1]) ? { x: Math.round(p[0]), y: Math.round(p[1]) } : null));
  let ranges: [number, number][] = [];
  if (Array.isArray(value.legs)) {
    for (const l of value.legs) {
      if (isObj(l) && Number.isInteger(l.start_index) && Number.isInteger(l.end_index)) {
        const a = l.start_index as number, b = l.end_index as number;
        if (a >= 0 && b > a && b < pts.length) ranges.push([a, b]);
      }
    }
  }
  if (!ranges.length) ranges = [[0, pts.length - 1]];
  const total = ranges.reduce((s, [a, b]) => s + (b - a + 1), 0);
  const stride = Math.max(1, Math.ceil(total / MAX_ROUTE_POINTS));
  const legs: Pt[][] = [];
  for (const [a, b] of ranges) {
    const leg: Pt[] = [];
    for (let i = a; i <= b; i += stride) { const p = pts[i]; if (p) leg.push(p); }
    const end = pts[b];
    if (stride > 1 && (b - a) % stride !== 0 && end) leg.push(end);
    if (leg.length >= 2) legs.push(leg);
  }
  if (!legs.length) return null;

  const stops: RoutePt[] = [];
  if (Array.isArray(value.stops)) {
    const rows = value.stops
      .filter(isObj)
      .filter(s => coord(s.x) && coord(s.y) && Number.isInteger(s.n) && (s.n as number) >= 1 && (s.n as number) <= 999 && label(s.name))
      .sort((a, b) => (a.n as number) - (b.n as number))
      .slice(0, MAX_STOPS);
    for (const s of rows) stops.push({ x: Math.round(s.x as number), y: Math.round(s.y as number), label: label(s.name) });
  }
  const nights = Array.isArray(value.nights) ? value.nights.filter((n): n is string => typeof n === 'string').map(label).filter(Boolean).slice(0, 60) : [];
  const savedAt = typeof value.saved_at === 'string' && Number.isFinite(Date.parse(value.saved_at)) ? value.saved_at : null;
  return { walked: nights.length > 0, nights, savedAt, legs, stops };
}

/** "10/21/2026" (the recorder's night key) or an ISO date -> "2026-10-21"; null when it is neither. */
export function isoDay(s: string | null | undefined): string | null {
  const t = String(s ?? '').trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(t);
  return iso ? iso[1] : null;
}

export type DrawnRoute = {
  kind: 'walked' | 'saved-plan' | 'planned';
  /** The line under the map: where this route comes from. */
  note: string;
  /** Drawn solid when it was walked (a path), dashed when it is straight legs between stops. */
  legs: Pt[][];
  stops: RoutePt[];
};

/** The route the map draws: the saved one when there is one, else the hand-entered plan route. */
export function chooseRoute(saved: SavedRoute | null, planned: RoutePt[]): DrawnRoute {
  if (saved) {
    const days = saved.nights.map(isoDay).filter((d): d is string => !!d).sort();
    const savedDay = isoDay(saved.savedAt);
    if (saved.walked) {
      const note = days.length === 1
        ? `walked by the raid on ${days[0]}`
        : days.length > 1
          ? `walked by the raid, ${days.length} nights averaged (latest ${days[days.length - 1]})`
          : `walked by the raid${savedDay ? `, saved ${savedDay}` : ''}`;
      return { kind: 'walked', note, legs: saved.legs, stops: saved.stops };
    }
    return {
      kind: 'saved-plan',
      note: `planned in the route planner${savedDay ? `, saved ${savedDay}` : ''} (not yet walked)`,
      legs: saved.legs,
      stops: saved.stops,
    };
  }
  return { kind: 'planned', note: 'planned (not yet walked)', legs: [planned], stops: planned };
}
