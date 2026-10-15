// /spectator/replay: how the camera frames the raid. The pure parts, with no React and no three.js, so the 2D
// board, the 3D view and the tests share one copy of the rules.
//
// The old framing fitted the box around everyone and refitted whenever one of them was about to leave the picture,
// so a single straggler (a corpse run, a scout down a corridor) dragged the view across the zone and back, and
// every refit was a snap (the guild lead, 2026-10-15: "the view will jump a ton when it shouldn't. it needs to keep
// all of the raiders in view, or at least 80% of them"). The rules now:
//   * the TARGET is the tightest box holding the nearest FRAME_KEEP of the raiders to their median, padded;
//   * the view stays where it is until something is clearly wrong (FRAME_RESIZE_RATIO, FRAME_OUTSIDE_MAX), then
//     glides to the target and stops, so it never breathes with every step of the raid;
//   * the glide is exponential in wall-clock time (frame-rate independent), zoom eased in log space;
//   * a scrub, a zone change or a session change snaps, because the old picture is not the one being watched.
// The 3D camera (lib/replayCamera.ts) uses the same subset, the same hysteresis numbers and the same time constant.

import { fitView, median, type View } from './spectator';

export const FRAME_KEEP = 0.8;        // the share of the raiders the picture must hold
export const FRAME_PAD = 0.15;          // spare room around that box, as a share of its size on each side
export const FRAME_MIN_SPAN = 300;      // never zoom tighter than this many units across (fitView's floor)
export const FRAME_RESIZE_RATIO = 1.25; // the target must differ from the view by more than this in size to move it
export const FRAME_OUTSIDE_MAX = 0.2;   // ... or more than this share of the raiders must be outside the picture
export const FRAME_EDGE_PX = 16;        // a raider this close to the pane's edge counts as outside
export const FRAME_TAU_MS = 450;        // how fast the view closes on its target (the time constant)
export const FRAME_SNAP_MS = 60_000;    // a playhead jump this big is a scrub: no glide

export type Pt = { x: number; y: number };
export type Box = { minX: number; maxX: number; minY: number; maxY: number };

/** The `keep` share of the points nearest to their median (at least one). The farthest go first. */
export function keepNearest<T extends Pt>(pts: readonly T[], keep = FRAME_KEEP): T[] {
  const n = pts.length;
  if (n <= 1) return pts.slice();
  const mx = median(pts.map(p => p.x)) as number;
  const my = median(pts.map(p => p.y)) as number;
  const k = Math.max(1, Math.ceil(keep * n - 1e-9));   // 0.8 * 15 is 12.000000000000002 in floating point
  return pts
    .map((p, i) => ({ p, i, d: (p.x - mx) ** 2 + (p.y - my) ** 2 }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, k)
    .map(e => e.p);
}

/** Bounding box of some points. Null with none. */
export function boxOf(pts: readonly Pt[]): Box | null {
  if (!pts.length) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

/** The tightest box holding the nearest `keep` of the points, padded by `pad` of its size on each side. Null with none. */
export function coverageBox(pts: readonly Pt[], keep = FRAME_KEEP, pad = FRAME_PAD): Box | null {
  const b = boxOf(keepNearest(pts, keep));
  if (!b) return null;
  const px = (b.maxX - b.minX) * pad, py = (b.maxY - b.minY) * pad;
  return { minX: b.minX - px, maxX: b.maxX + px, minY: b.minY - py, maxY: b.maxY + py };
}

/** The view that frames those points (screen frame, as lib/spectator.ts raidBox): the coverage box fitted to the pane. */
export function targetView(pts: readonly Pt[], w: number, h: number): View | null {
  const box = coverageBox(pts);
  return box ? fitView(box, w, h, 8, FRAME_MIN_SPAN) : null;
}

/** Share of the points outside the pane (or within FRAME_EDGE_PX of its edge) at this view. */
export function outsideFraction(v: View, pts: readonly Pt[], w: number, h: number, edge = FRAME_EDGE_PX): number {
  if (!pts.length) return 0;
  let out = 0;
  for (const p of pts) {
    const px = (p.x - v.cx) * v.scale + w / 2;
    const py = (p.y - v.cy) * v.scale + h / 2;
    if (px < edge || px > w - edge || py < edge || py > h - edge) out++;
  }
  return out / pts.length;
}

/**
 * Is the picture wrong enough to move? `zoomRatio` is the zoom the target wants over the zoom in force (above 1:
 * the raid has shrunk and could be closer; below 1: it has spread). Small ratios and a few strays are left alone.
 */
export function exceedsHysteresis(zoomRatio: number, outsideFrac: number): boolean {
  return zoomRatio > FRAME_RESIZE_RATIO || zoomRatio < 1 / FRAME_RESIZE_RATIO || outsideFrac > FRAME_OUTSIDE_MAX;
}

const SETTLED_PX = 0.5;       // closer than this (on screen) is arrived
const SETTLED_LOG = 0.005;    // and a zoom within this (in log) is the same zoom

/** One step of the glide from `cur` toward `goal`; `done` (and exactly the goal) once it is within a pixel. */
export function easeView(cur: View, goal: View, dtMs: number, tau = FRAME_TAU_MS): { view: View; done: boolean } {
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tau);
  const scale = cur.scale * Math.pow(goal.scale / cur.scale, k);
  const cx = cur.cx + (goal.cx - cur.cx) * k;
  const cy = cur.cy + (goal.cy - cur.cy) * k;
  const near = Math.hypot(goal.cx - cx, goal.cy - cy) * scale < SETTLED_PX && Math.abs(Math.log(goal.scale / scale)) < SETTLED_LOG;
  return near ? { view: goal, done: true } : { view: { cx, cy, scale }, done: false };
}

/** The same glide for a zoom alone (the follow camera closing in). */
export function easeScale(cur: number, goal: number, dtMs: number, tau = FRAME_TAU_MS): { scale: number; done: boolean } {
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tau);
  const scale = cur * Math.pow(goal / cur, k);
  return Math.abs(Math.log(goal / scale)) < SETTLED_LOG ? { scale: goal, done: true } : { scale, done: false };
}

export type FrameState = { view: View | null; goal: View | null };

/**
 * One frame of auto-framing for a pane `w` x `h`, with the raiders' screen-frame points `pts`.
 *   no view yet, or `snap`: take the target at once;
 *   a glide under way: keep going to the goal it set out for (the goal is not chased, or a moving raid would
 *     keep it gliding forever);
 *   otherwise: leave the view alone unless exceedsHysteresis, then set the target as the goal.
 * `animating` is true while a glide is under way (the caller must draw again).
 */
export function frameStep(s: FrameState, pts: readonly Pt[], w: number, h: number, dtMs: number, snap: boolean): FrameState & { animating: boolean } {
  const target = pts.length && w > 0 && h > 0 ? targetView(pts, w, h) : null;
  if (!target) return { ...s, animating: !!s.goal };
  if (!s.view || snap) return { view: target, goal: null, animating: false };
  let goal = s.goal;
  if (!goal && exceedsHysteresis(target.scale / s.view.scale, outsideFraction(s.view, pts, w, h))) goal = target;
  if (!goal) return { view: s.view, goal: null, animating: false };
  const e = easeView(s.view, goal, dtMs);
  return { view: e.view, goal: e.done ? null : goal, animating: !e.done };
}
