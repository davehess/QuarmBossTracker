// Route planner: putting a flat path on the ground. Pure (no three.js, no DOM), so the root vitest suite real-imports it.
//
// A recorded night is [x, y] only: the recorder never kept a height. To draw one in the true-3D view (?v=c) each sample is
// DRAPED onto the zone's floors: a vertical ray at (x, y) meets every floor above or below that point (a tower has eleven), and
// the one to pick is the one the raid was on. That is decided by CONTINUITY, not by a guess at the floor: the path starts at a
// reference height (the pin or kill it starts at), and every next sample takes the hit nearest the height of the one before it.
// So a path stays on its storey at a place where another storey lies right above or below it, and climbs a ramp smoothly (the
// ramp's own hits are only a step apart). A sample with no hit at all (a hole in the mesh) carries the previous height.
//
// `heightsAt(x, y)` is the only thing that knows the mesh; here it is a function, so a test gives it a fake. Plan3D builds the
// real one from the floors it draws (floorHeightsAt over a TriGrid).
import type { TriGrid } from '../replayCamera';

export type XY = readonly [number, number];
export type XYZ = [number, number, number];
/** Every height at which a floor lies under or over (x, y), in the server's frame (z), in any order. */
export type HeightsAt = (x: number, y: number) => number[];

/** Where a segment may be cut into more samples (units) and the longest gap that is still a walk and not a teleport or a hole in the recording. */
export const DRAPE_STEP = 40;
export const DRAPE_MAX_GAP = 400;

/**
 * The heights of the floors under (x, y), server frame, from a triangle grid built over the floors in the three frame
 * (X = -x, Y = z, Z = -y; replayCamera.ts buildTriGrid). A triangle counts when (x, y) is inside its footprint. Heights within
 * half a unit of each other are one floor.
 */
export function floorHeightsAt(g: TriGrid, x: number, y: number): number[] {
  const X = -x, Z = -y;
  const cx = Math.floor((X - g.minX) / g.cell), cz = Math.floor((Z - g.minZ) / g.cell);
  if (cx < 0 || cz < 0 || cx >= g.nx || cz >= g.nz) return [];
  const c = cz * g.nx + cx, p = g.pos, out: number[] = [];
  for (let k = g.start[c]; k < g.start[c + 1]; k++) {
    const o = g.tris[k] * 9;
    const x0 = p[o], y0 = p[o + 1], z0 = p[o + 2], x1 = p[o + 3], y1 = p[o + 4], z1 = p[o + 5], x2 = p[o + 6], y2 = p[o + 7], z2 = p[o + 8];
    const den = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
    if (Math.abs(den) < 1e-9) continue;
    const a = ((z1 - z2) * (X - x2) + (x2 - x1) * (Z - z2)) / den;
    const b = ((z2 - z0) * (X - x2) + (x0 - x2) * (Z - z2)) / den;
    const d = 1 - a - b, e = -1e-4;
    if (a < e || b < e || d < e) continue;
    const h = a * y0 + b * y1 + d * y2;
    if (!out.some(q => Math.abs(q - h) < 0.5)) out.push(h);
  }
  return out;
}

/** The path with samples added so no step is longer than `step`; a gap past `maxGap` is a jump and is left as one. */
export function densify(pts: readonly XY[], step = DRAPE_STEP, maxGap = DRAPE_MAX_GAP): [number, number][] {
  const out: [number, number][] = [];
  pts.forEach((p, i) => {
    if (i > 0) {
      const q = pts[i - 1], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d > step && d <= maxGap) {
        const n = Math.ceil(d / step);
        for (let k = 1; k < n; k++) out.push([q[0] + ((p[0] - q[0]) * k) / n, q[1] + ((p[1] - q[1]) * k) / n]);
      }
    }
    out.push([p[0], p[1]]);
  });
  return out;
}

/** One height per sample: the hit nearest the previous sample's height (the first is judged against `startZ`); no hit carries the previous. */
export function drapeHeights(pts: readonly XY[], heightsAt: HeightsAt, startZ: number): number[] {
  const out: number[] = [];
  let prev = startZ;
  for (const p of pts) {
    const hs = heightsAt(p[0], p[1]);
    if (hs.length) {
      let best = hs[0];
      for (const h of hs) if (Math.abs(h - prev) < Math.abs(best - prev)) best = h;
      prev = best;
    }
    out.push(prev);
  }
  return out;
}

/** The path cut into samples and draped: x, y, z. */
export function drapePath(pts: readonly XY[], heightsAt: HeightsAt, startZ: number, step = DRAPE_STEP): XYZ[] {
  const dense = densify(pts, step);
  const zs = drapeHeights(dense, heightsAt, startZ);
  return dense.map((p, i) => [p[0], p[1], zs[i]] as XYZ);
}

export type Ref = { x: number; y: number; z: number };

/** The z of the reference (a pin, a mob) nearest to (x, y); null when there are none. */
export function nearestZ(x: number, y: number, refs: readonly Ref[]): number | null {
  let best: number | null = null, bd = Infinity;
  for (const r of refs) {
    const d = Math.hypot(r.x - x, r.y - y);
    if (d < bd) { bd = d; best = r.z; }
  }
  return best;
}

/** How far from a pin or mob a floor it stands on still counts as under the raid, with no mesh to say otherwise. */
export const REF_REACH = 350;

/**
 * A stand-in for the floor mesh when there is none (the stacked view, or true 3D before the floors load): the floors under
 * (x, y) are those the pins and mobs within REF_REACH stand on, else the one nearest. Draped by continuity like the real thing,
 * so a path stays on its floor past a pin that stands on another one, instead of stepping to that floor and back.
 */
export function refHeightsAt(refs: readonly Ref[], reach = REF_REACH): HeightsAt {
  return (x, y) => {
    const near: number[] = [];
    let nz: number | null = null, nd = Infinity;
    for (const r of refs) {
      const d = Math.hypot(r.x - x, r.y - y);
      if (d <= reach && !near.includes(r.z)) near.push(r.z);
      if (d < nd) { nd = d; nz = r.z; }
    }
    return near.length ? near : nz === null ? [] : [nz];
  };
}
