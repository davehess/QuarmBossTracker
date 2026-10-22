// Route planner: the maths behind the Draw tool (?v=draw on /raid/plan/routes). No DOM here, so the root vitest suite
// real-imports this; the engine only collects clicks and pointer samples and hands them over.
//
// Two ways to lay a leg's path in one go (the guild lead, 2026-10-22: "add in draw with pins or let us redraw a path or
// segment entirely"):
//   * POINTS: click bend points in order from the leg's start pin to its end pin (a draft, with undo and cancel);
//   * PEN: drag along the corridor. The stroke is thinned and simplified with the same Douglas-Peucker pass "Use this route"
//     runs (follow.ts bakeRecorded -> navroute.ts bakeBends), and REPLACES the bends it covers: the whole leg when the stroke
//     runs pin to pin (or lies off the leg), only the stretch between where it starts and where it ends when it starts and
//     ends on the leg.
// Bends are what a plan keeps (Line.pts, the server frame); the pins are never bends.
import { bakeRecorded } from './follow';
import { polyLen, r1 } from './plan';

export type XY = [number, number];

/** The most bends a drawn leg ends up with (the same cap "Use this route" bakes to). */
export const MAX_DRAW_BENDS = 40;
/** Bends closer than this to the one before are the same point (a double click, a stroke's rounding). */
const SAME = 0.5;

const d2 = (p: readonly number[], q: readonly number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** Drop every sample closer than `gap` to the last kept one; the last sample is always kept. A stroke of pointer events is dense; this is the cheap first cut. */
export function thinStroke(raw: readonly XY[], gap: number): XY[] {
  const out: XY[] = [];
  for (const p of raw) if (!out.length || d2(out[out.length - 1], p) >= gap) out.push([p[0], p[1]]);
  const last = raw[raw.length - 1];
  if (last && out.length && (out[out.length - 1][0] !== last[0] || out[out.length - 1][1] !== last[1])) out.push([last[0], last[1]]);
  return out;
}

/** Collapse consecutive points that sit on one another. */
function dedupe(pts: readonly XY[]): XY[] {
  const out: XY[] = [];
  for (const p of pts) if (!out.length || d2(out[out.length - 1], p) >= SAME) out.push([p[0], p[1]]);
  return out;
}

/**
 * The corners of a path that matter, no more than `max` of them, ends excluded (they are the pins or the joints and the caller
 * keeps them). It is bakeRecorded: the simplifier behind "Use this route" and "Use recorded routes".
 */
export function simplifyPath(path: readonly XY[], max = MAX_DRAW_BENDS): XY[] {
  if (path.length <= 2 || max <= 0) return [];
  return bakeRecorded(path, max).map(p => [p[0], p[1]] as XY);
}

/** Where along a polyline a point lands: the arc length to its nearest spot, how far off the line it is, and that spot. */
export function project(poly: readonly XY[], p: readonly number[]): { pos: number; d: number; at: XY } {
  let best = { pos: 0, d: Infinity, at: [poly[0][0], poly[0][1]] as XY }, acc = 0;
  for (let i = 0; i + 1 < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[i + 1], dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy, sl = Math.sqrt(l2);
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / l2)) : 0;
    const at: XY = [x1 + t * dx, y1 + t * dy], dd = d2(p, at);
    if (dd < best.d) best = { pos: acc + t * sl, d: dd, at };
    acc += sl;
  }
  return best;
}

/** The arc length of every vertex of a polyline (0 for the first). */
export function vertexPositions(poly: readonly XY[]): number[] {
  const out = [0];
  for (let i = 1; i < poly.length; i++) out.push(out[i - 1] + d2(poly[i - 1], poly[i]));
  return out;
}

export type PenOpts = {
  /** How near the leg a stroke's two ends must be for it to redraw a stretch of the leg (world units; about 14 screen pixels). */
  hitR: number;
  /** A stroke shorter than this is a click, not a drawing. */
  minLen?: number;
  max?: number;
};
export type PenResult =
  | { ok: true; bends: XY[]; scope: 'whole' | 'segment'; replaced: number }
  | { ok: false; reason: 'short' | 'same-spot' };

const rnd = (p: readonly number[]): XY => [r1(p[0]), r1(p[1])];

/**
 * A finished pen stroke applied to a leg. `a` and `b` are the leg's pins, `bends` its bends now, `stroke` the pointer samples
 * (world units, in the order drawn, either direction).
 *
 *  - Both ends of the stroke on the leg (within hitR of its line, a pin counting as on it): REDRAW THE STRETCH. The bends
 *    between where the stroke starts and where it ends are replaced by the simplified stroke; the bends outside stay. An end
 *    within hitR of a pin snaps to that pin; any other end joins the old line where it left it (that joint is a bend).
 *    A stroke drawn against the leg's direction is turned round.
 *  - Otherwise: REDRAW THE LEG. The stroke's ends snap to the two pins (whichever way round is nearer) and every old bend goes.
 */
export function applyPen(a: readonly number[], b: readonly number[], bends: readonly XY[], stroke: readonly XY[], opts: PenOpts): PenResult {
  const max = opts.max ?? MAX_DRAW_BENDS, minLen = opts.minLen ?? 20;
  if (stroke.length < 2 || polyLen(stroke) < minLen) return { ok: false, reason: 'short' };
  const A: XY = [a[0], a[1]], B: XY = [b[0], b[1]];
  const poly: XY[] = [A, ...bends, B], cum = vertexPositions(poly), total = cum[cum.length - 1];
  const first = project(poly, stroke[0]), lastS = project(poly, stroke[stroke.length - 1]);

  if (first.d > opts.hitR || lastS.d > opts.hitR) {
    const flip = d2(stroke[0], A) + d2(stroke[stroke.length - 1], B) > d2(stroke[0], B) + d2(stroke[stroke.length - 1], A);
    const s = flip ? [...stroke].reverse() : stroke;
    const out = simplifyPath([A, ...s.slice(1, -1), B], max).map(rnd);
    return { ok: true, bends: dedupe(out), scope: 'whole', replaced: bends.length };
  }

  // the stretch: from where the stroke starts along the leg to where it ends
  let s = stroke, p0 = first, p1 = lastS;
  if (p0.pos > p1.pos) { s = [...stroke].reverse(); p0 = lastS; p1 = first; }
  if (p1.pos - p0.pos < Math.max(opts.hitR, 1)) return { ok: false, reason: 'same-spot' };
  const atA = p0.pos <= opts.hitR, atB = total - p1.pos <= opts.hitR;
  const startPt: XY = atA ? A : p0.at, endPt: XY = atB ? B : p1.at;
  const inner = bends.map((p, i) => ({ p, pos: cum[i + 1] }));
  const before = inner.filter(q => q.pos < p0.pos).map(q => q.p);
  const after = inner.filter(q => q.pos > p1.pos).map(q => q.p);
  const joints = (atA ? 0 : 1) + (atB ? 0 : 1);
  const budget = Math.max(2, max - before.length - after.length - joints);
  const mid = simplifyPath([startPt, ...s.slice(1, -1), endPt], budget);
  const out = dedupe([...before, ...(atA ? [] : [startPt]), ...mid, ...(atB ? [] : [endPt]), ...after].map(rnd));
  return { ok: true, bends: out, scope: atA && atB ? 'whole' : 'segment', replaced: inner.length - before.length - after.length };
}

// ── points: "draw with pins" ─────────────────────────────────────────────────

/** The bends clicked so far for the leg being drawn; nothing in the plan changes until the draft is finished. */
export type PointsDraft = { pts: XY[] };
export const newDraft = (): PointsDraft => ({ pts: [] });

/** Add a click. A click on the last point (a double click's second half) is dropped; the draft stops growing at `max`. */
export function draftAdd(d: PointsDraft, p: readonly number[], max = MAX_DRAW_BENDS): PointsDraft {
  const last = d.pts[d.pts.length - 1];
  if (d.pts.length >= max || (last && d2(last, p) < SAME)) return d;
  return { pts: [...d.pts, rnd(p)] };
}

/** Backspace: take the last point back. */
export const draftUndo = (d: PointsDraft): PointsDraft => (d.pts.length ? { pts: d.pts.slice(0, -1) } : d);

/** The line the draft makes, pin to pin; `cursor` adds the rubber-band segment to where the pointer is. */
export function draftLine(a: readonly number[], b: readonly number[], d: PointsDraft, cursor?: readonly number[] | null): XY[] {
  const end = cursor ?? b;
  return [[a[0], a[1]], ...d.pts, [end[0], end[1]]];
}

/** Finishing: the bends the leg gets (the draft itself), or null while the draft has no point (a finish with nothing drawn changes nothing). */
export const draftFinish = (d: PointsDraft): XY[] | null => (d.pts.length ? d.pts.map(rnd) : null);

/** How a finished draw changes a leg's line: the bends are replaced, a walk-route snap (`follow`) is let go, a teleporter (`via`) is kept. */
export function drawnLine<T extends { pts: XY[]; follow?: number }>(ln: T, bends: readonly XY[]): T {
  ln.pts = bends.map(p => [p[0], p[1]] as XY);
  ln.follow = undefined;
  return ln;
}
