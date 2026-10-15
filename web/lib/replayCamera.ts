// /spectator/replay, 3D: where the camera stands. The pure parts, with no React and no three.js (vectors are
// [x, y, z] tuples in the THREE frame of lib/zoneMesh.ts serverToThree: X = -x, Y = z, Z = -y), so the 3D view and
// the tests share one copy of the rules.
//
// The old default fitted the whole zone or a box around every raider, from a point that could be well outside the
// walls, looking in (the guild lead, 2026-10-15: "in 3d mode vision should be from inside of the zone's normal area
// not outside the bounds if possible"). The camera now behaves like a third-person game camera:
//   * it orbits the same 80% centre the 2D board frames (lib/replayFraming.ts), a modest height above the raid at
//     about a 40 degree pitch, backing off only as far as it must to keep that 80% on screen;
//   * its position is clamped to the mesh's x/z extent (shrunk by a margin) and to y between the raid's floor and
//     the mesh's highest point;
//   * a segment from the orbit target to the camera is tested against the wall (and floor/ceiling) triangles and,
//     on a hit, the camera is pulled in to just short of it, so it is never on the far side of a wall.
//
// Wall test cost: a uniform grid over the mesh's XZ extent holds, per cell, the triangles whose box touches it.
// A camera segment is a few hundred units, so it visits a handful of cells and a few hundred triangles with an
// exact Moller-Trumbore test, instead of three.js's raycast over all ~100k triangles (milliseconds, every frame).
// Building the grid is one pass over the mesh when it loads.

import { boxOf, keepNearest, FRAME_KEEP, FRAME_TAU_MS } from './replayFraming';
import { serverToThree } from './zoneMesh';

export type V3 = [number, number, number];

export const CAM_PITCH = (40 * Math.PI) / 180;   // off the horizontal
export const CAM_HEIGHT_MIN = 120;               // units above the raid
export const CAM_HEIGHT_MAX = 250;
export const CAM_EYE = 6;                        // the orbit target is this far above the raiders' feet
export const CAM_FIT_PAD = 1.15;                 // room around the 80% box when backing off to fit it
export const CAM_MIN_DIST = 25;                  // the closest a wall may pull the camera to the target
export const CAM_WALL_CLEAR = 8;                 // how far in front of a wall it stops
export const CAM_NEAR_SKIP = 12;                 // ignore anything this close to the target (the raiders' own floor)
export const CAM_SETTLED = 1;                    // units: closer than this to the goal is arrived

/** The 80% of the raid the camera frames, in the SERVER frame. */
export type RaidFocus = { x: number; y: number; z: number; span: number; n: number };

/** Centre (of the box around the nearest `keep` of the raiders), mean height and size of the raid. Null with none. */
export function raidFocus(rs: readonly { x: number; y: number; z: number }[], keep = FRAME_KEEP): RaidFocus | null {
  const kept = keepNearest(rs, keep);
  const b = boxOf(kept);
  if (!b) return null;
  let z = 0;
  for (const r of kept) z += r.z;
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, z: z / kept.length, span: Math.max(b.maxX - b.minX, b.maxY - b.minY), n: kept.length };
}

export type Rig = { target: V3; pos: V3; dist: number };

/**
 * Where the camera wants to be for a focus, before the zone's walls get a say: south of the raid looking north
 * (north is up in the 2D board), CAM_HEIGHT_MIN..MAX above it scaled to the raid's spread, at CAM_PITCH, and
 * backed off along that line only when the default does not fit the raid's size into the view.
 */
export function desiredRig(f: RaidFocus, aspect: number, fovDeg: number): Rig {
  const span = Math.max(f.span, 150);
  const height = Math.min(CAM_HEIGHT_MAX, Math.max(CAM_HEIGHT_MIN, span * 0.45));
  const half = Math.tan((fovDeg * Math.PI) / 360);
  const dFit = (span * CAM_FIT_PAD) / (2 * half * Math.min(1, aspect > 0 ? aspect : 1));
  const dist = Math.max(height / Math.sin(CAM_PITCH), dFit);
  const target = serverToThree(f.x, f.y, f.z + CAM_EYE);
  return { target, dist, pos: [target[0], target[1] + dist * Math.sin(CAM_PITCH), target[2] + dist * Math.cos(CAM_PITCH)] };
}

// ── Bounds ──────────────────────────────────────────────────────────────────

export type Bounds3 = { min: V3; max: V3 };

/** A mesh's server-frame min/max -> its three-frame bounds. */
export function boundsFromServer(min: readonly number[], max: readonly number[]): Bounds3 {
  return { min: [-max[0], min[2], -max[1]], max: [-min[0], max[2], -min[1]] };
}

/** `p` inside the bounds shrunk by a margin on x and z, and between `floorY` and the mesh's highest point on y. */
export function clampToBounds(p: V3, b: Bounds3, floorY: number): V3 {
  const mx = (lo: number, hi: number) => Math.min((hi - lo) / 4, Math.max(25, (hi - lo) * 0.03));
  const ax = mx(b.min[0], b.max[0]), az = mx(b.min[2], b.max[2]);
  return [
    Math.min(b.max[0] - ax, Math.max(b.min[0] + ax, p[0])),
    Math.min(b.max[1], Math.max(Math.min(b.max[1], Math.max(b.min[1], floorY)), p[1])),
    Math.min(b.max[2] - az, Math.max(b.min[2] + az, p[2])),
  ];
}

// ── The triangle grid ───────────────────────────────────────────────────────

export type TriGrid = {
  pos: Float32Array;          // 9 numbers a triangle, three frame
  minX: number; minZ: number; cell: number; nx: number; nz: number;
  start: Int32Array;          // per cell: where its triangles begin in `tris` (nx * nz + 1 entries)
  tris: Int32Array;
  seen: Uint32Array;          // per triangle: the last query that tested it, so a triangle in several cells is tested once
  stamp: number;
};

const MAX_CELLS_PER_AXIS = 160;

/** Bins every triangle into the cells its XZ box touches. Null for an empty mesh. */
export function buildTriGrid(pos: Float32Array, cellHint = 96): TriGrid | null {
  const n = Math.floor(pos.length / 9);
  if (!n) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n * 9; i += 3) {
    if (pos[i] < x0) x0 = pos[i];
    if (pos[i] > x1) x1 = pos[i];
    if (pos[i + 2] < z0) z0 = pos[i + 2];
    if (pos[i + 2] > z1) z1 = pos[i + 2];
  }
  const cell = Math.max(cellHint, (x1 - x0) / MAX_CELLS_PER_AXIS, (z1 - z0) / MAX_CELLS_PER_AXIS, 1);
  const nx = Math.max(1, Math.floor((x1 - x0) / cell) + 1);
  const nz = Math.max(1, Math.floor((z1 - z0) / cell) + 1);
  const range = (t: number) => {
    const o = t * 9;
    const lo = Math.min(pos[o], pos[o + 3], pos[o + 6]), hi = Math.max(pos[o], pos[o + 3], pos[o + 6]);
    const zlo = Math.min(pos[o + 2], pos[o + 5], pos[o + 8]), zhi = Math.max(pos[o + 2], pos[o + 5], pos[o + 8]);
    return [
      Math.floor((lo - x0) / cell), Math.min(nx - 1, Math.floor((hi - x0) / cell)),
      Math.floor((zlo - z0) / cell), Math.min(nz - 1, Math.floor((zhi - z0) / cell)),
    ];
  };
  const counts = new Int32Array(nx * nz + 1);
  for (let t = 0; t < n; t++) {
    const [ax, bx, az, bz] = range(t);
    for (let cz = az; cz <= bz; cz++) for (let cx = ax; cx <= bx; cx++) counts[cz * nx + cx + 1]++;
  }
  for (let i = 0; i < nx * nz; i++) counts[i + 1] += counts[i];
  const fill = counts.slice(0, nx * nz);
  const tris = new Int32Array(counts[nx * nz]);
  for (let t = 0; t < n; t++) {
    const [ax, bx, az, bz] = range(t);
    for (let cz = az; cz <= bz; cz++) for (let cx = ax; cx <= bx; cx++) tris[fill[cz * nx + cx]++] = t;
  }
  return { pos, minX: x0, minZ: z0, cell, nx, nz, start: counts, tris, seen: new Uint32Array(n), stamp: 0 };
}

/**
 * The first triangle the segment a-b crosses, as a fraction of the way from a (0) to b (1), or null for a clear
 * segment. Double-sided. Visits only the cells under the segment's XZ box.
 */
export function segmentHit(g: TriGrid, a: V3, b: V3): number | null {
  const lo = (v: number, o: number) => Math.max(0, Math.floor((v - o) / g.cell));
  const cx0 = lo(Math.min(a[0], b[0]), g.minX), cx1 = Math.min(g.nx - 1, Math.floor((Math.max(a[0], b[0]) - g.minX) / g.cell));
  const cz0 = lo(Math.min(a[2], b[2]), g.minZ), cz1 = Math.min(g.nz - 1, Math.floor((Math.max(a[2], b[2]) - g.minZ) / g.cell));
  if (cx1 < cx0 || cz1 < cz0) return null;
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const p = g.pos;
  g.stamp = (g.stamp + 1) >>> 0;
  if (g.stamp === 0) { g.seen.fill(0); g.stamp = 1; }
  let best = Infinity;
  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = cz * g.nx + cx;
      for (let k = g.start[c]; k < g.start[c + 1]; k++) {
        const t = g.tris[k];
        if (g.seen[t] === g.stamp) continue;
        g.seen[t] = g.stamp;
        const o = t * 9;
        const e1x = p[o + 3] - p[o], e1y = p[o + 4] - p[o + 1], e1z = p[o + 5] - p[o + 2];
        const e2x = p[o + 6] - p[o], e2y = p[o + 7] - p[o + 1], e2z = p[o + 8] - p[o + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-9) continue;
        const inv = 1 / det;
        const sx = a[0] - p[o], sy = a[1] - p[o + 1], sz = a[2] - p[o + 2];
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const s = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (s >= 0 && s <= 1 && s < best) best = s;
      }
    }
  }
  return best === Infinity ? null : best;
}

// ── Keeping the camera inside ───────────────────────────────────────────────

export type Constraint = { bounds: Bounds3 | null; grids: readonly (TriGrid | null)[]; floorY?: number };

/**
 * `pos` made legal: clamped into the zone's extent, then pulled in along the line to `target` to just short of the
 * first wall, floor or ceiling triangle between them (never closer than CAM_MIN_DIST). `pulled` says a wall did it.
 */
export function constrainCamera(target: V3, pos: V3, c: Constraint): { pos: V3; pulled: boolean } {
  const p = c.bounds ? clampToBounds(pos, c.bounds, c.floorY ?? target[1]) : pos;
  const dx = p[0] - target[0], dy = p[1] - target[1], dz = p[2] - target[2];
  const len = Math.hypot(dx, dy, dz);
  if (len <= CAM_NEAR_SKIP + 1e-6) return { pos: p, pulled: false };
  const a: V3 = [target[0] + (dx / len) * CAM_NEAR_SKIP, target[1] + (dy / len) * CAM_NEAR_SKIP, target[2] + (dz / len) * CAM_NEAR_SKIP];
  let hit = Infinity;
  for (const g of c.grids) {
    if (!g) continue;
    const s = segmentHit(g, a, p);
    if (s != null) hit = Math.min(hit, CAM_NEAR_SKIP + s * (len - CAM_NEAR_SKIP));
  }
  if (hit === Infinity) return { pos: p, pulled: false };
  const d = Math.min(len, Math.max(CAM_MIN_DIST, hit - CAM_WALL_CLEAR));
  const k = d / len;
  return { pos: [target[0] + dx * k, target[1] + dy * k, target[2] + dz * k], pulled: d < len };
}

// ── Easing ──────────────────────────────────────────────────────────────────

/** One step of the glide of the orbit target and the camera toward their goals; the same time constant as the 2D view. */
export function easeRig(
  cur: { target: V3; pos: V3 }, goal: { target: V3; pos: V3 }, dtMs: number, tau = FRAME_TAU_MS,
): { target: V3; pos: V3; done: boolean } {
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tau);
  const mix = (a: V3, b: V3): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const target = mix(cur.target, goal.target);
  const pos = mix(cur.pos, goal.pos);
  const far = Math.max(Math.hypot(goal.target[0] - target[0], goal.target[1] - target[1], goal.target[2] - target[2]),
    Math.hypot(goal.pos[0] - pos[0], goal.pos[1] - pos[1], goal.pos[2] - pos[2]));
  return far < CAM_SETTLED ? { target: goal.target, pos: goal.pos, done: true } : { target, pos, done: false };
}
