// Zone wall mesh for the 3D replay: the EQEmu collision mesh cut down to a small packed triangle list.
// The pure parts, with no React, no three.js and no Node modules, so the mesh route (pack), the 3D view
// (unpack, transform) and the tests share one copy of the rules that are easy to get backwards.
//
// Source: https://github.com/EQEmu/maps (base/<zone>.map), GPLv2-or-later; what this produces is DERIVED from
// those meshes and carries the same licence (see web/lib/zoneMap/slice.ts). Plain walls only: no textures and
// no client art (DECISIONS-2026-09-21 §220, 3D-A).
//
// FRAME (read before plotting a raider on this)
//   The packed triangles are in the SERVER frame, untouched: the vertices of the .map file are the same axes
//   as eqemu_spawn2 x/y and as the slice in zoneMap/slice.ts (whose segments are raw V x,y). A decoded replay
//   raider (lib/raidReplay.ts, via serverXY in lib/spectator.ts) is in that frame too, so a raider and a wall
//   triangle need no conversion between them. Only the DRAWING needs one: the 2D board shows the picture
//   north-up as screen = (-x, -y) with y growing down (toScreen), i.e. right = -x and up = +y. A three.js
//   scene is right-handed, y up; looking straight down the -y axis with camera up = -z puts world +x on the
//   right and world -z up the screen. So
//        three = (X, Y, Z) = (-x, z, -y)
//   makes the top-down 3D view the same picture as the 2D board (X = screen x, Z = screen y). That is a
//   reflection (the 2D picture is the mirror image of the server axes seen from above), so the triangles' winding
//   flips: draw them double-sided.
//
// WIRE FORMAT (little endian, which is every host this runs on)
//   0   u32  magic 'WPM1'
//   4   u32  triangle count
//   8   u32  flags (bit 0: floors included, bit 1: ONLY floors; the walls come from the walls-only request)
//   12  f32  centre x, y, z   (server frame; the middle of the packed bounding box)
//   24  f32  scale x, y, z    (units per integer step)
//   36  i16  9 per triangle: x0 y0 z0 x1 y1 z1 x2 y2 z2, each as round((v - centre) / scale)
// 18 bytes a triangle; DEFAULT_TRI_CAP triangles is ~1.8 MB before the host compresses it.

export const MESH_MAGIC = 0x314d5057;   // 'W' 'P' 'M' '1' read as a little-endian u32
export const HEADER_BYTES = 36;
export const BYTES_PER_TRI = 18;
export const DEFAULT_TRI_CAP = 100_000;
// The floors request (floorsOnly) is a second, smaller layer drawn under the walls, so it has its own cap and
// the walls keep their full budget: a toggle that hides it leaves the walls exactly as they were.
export const DEFAULT_FLOOR_CAP = 60_000;

// A triangle whose normal is within this of horizontal (|nz| at or above it) is floor or ceiling; below it,
// a wall or a slope too steep to walk. ~45 degrees. The 2D slicer is stricter (0.30, true walls only) because
// it draws one line per wall; a solid view wants the steep ground too or terrain zones read as holes.
export const STEEP_NZ = 0.7;
// A sliver smaller than this (square units) is noise at any zoom the view allows.
export const MIN_TRI_AREA = 4;

export type PackOptions = { floors?: boolean; floorsOnly?: boolean; cap?: number };
export type PackStats = { raw: number; kept: number; packed: number; bytes: number; floors: boolean; floorsOnly: boolean };
export type PackedMesh = { buf: ArrayBuffer; stats: PackStats };
export type UnpackedMesh = {
  tris: number;
  pos: Float32Array;   // 9 numbers a triangle, SERVER frame
  floors: boolean;
  floorsOnly: boolean;
  min: [number, number, number];
  max: [number, number, number];
};

/** Server frame -> three.js world. See the header: top-down it is the 2D board's picture. */
export function serverToThree(x: number, y: number, z: number): [number, number, number] {
  return [-x, z, -y];
}

/** A whole position array (3 per vertex, server frame) -> a new one in the three.js frame. */
export function positionsToThree(pos: Float32Array): Float32Array {
  const out = new Float32Array(pos.length);
  for (let i = 0; i + 2 < pos.length; i += 3) {
    out[i] = -pos[i];
    out[i + 1] = pos[i + 2];
    out[i + 2] = -pos[i + 1];
  }
  return out;
}

/**
 * The parsed collision mesh (V: x,y,z floats; I: three indices a triangle, as zoneMap/slice.ts parseEqemuMap
 * returns them) -> the packed wire buffer. Drops degenerate triangles, slivers and (unless `floors`) anything
 * near-horizontal, then keeps the `cap` LARGEST by area, in their original order.
 */
export function packMesh(V: Float32Array, I: Uint32Array, opts: PackOptions = {}): PackedMesh {
  const floorsOnly = !!opts.floorsOnly;
  const floors = !!opts.floors || floorsOnly;
  const cap = Math.max(1, Math.floor(opts.cap ?? (floorsOnly ? DEFAULT_FLOOR_CAP : DEFAULT_TRI_CAP)));
  const nTri = Math.floor(I.length / 3);

  const keep: number[] = [];       // triangle numbers that pass the filters
  const area: number[] = [];       // parallel to keep
  for (let t = 0; t < nTri; t++) {
    const ia = I[3 * t] * 3, ib = I[3 * t + 1] * 3, ic = I[3 * t + 2] * 3;
    const ax = V[ia], ay = V[ia + 1], az = V[ia + 2];
    const bx = V[ib], by = V[ib + 1], bz = V[ib + 2];
    const cx = V[ic], cy = V[ic + 1], cz = V[ic + 2];
    if (!(Number.isFinite(ax + ay + az + bx + by + bz + cx + cy + cz))) continue;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const a = nl / 2;
    if (!(a >= MIN_TRI_AREA)) continue;
    const flat = Math.abs(nz / nl) >= STEEP_NZ;
    if (floorsOnly ? !flat : (!floors && flat)) continue;
    keep.push(t);
    area.push(a);
  }

  // Over the cap: the area of the cap-th largest is the cut line. Everything above it stays, then triangles
  // exactly on it fill the rest, so the count is the cap and not a tie's worth over.
  let chosen = keep;
  if (keep.length > cap) {
    const sorted = Float32Array.from(area).sort();
    const cut = sorted[sorted.length - cap];
    let above = 0;
    for (const a of area) if (Math.fround(a) > cut) above++;
    let ties = cap - above;
    chosen = [];
    for (let k = 0; k < keep.length; k++) {
      const a = Math.fround(area[k]);
      if (a > cut) chosen.push(keep[k]);
      else if (a === cut && ties > 0) { chosen.push(keep[k]); ties--; }
    }
  }

  const n = chosen.length;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const t of chosen) {
    for (let c = 0; c < 3; c++) {
      const o = I[3 * t + c] * 3;
      for (let k = 0; k < 3; k++) {
        const v = V[o + k];
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
      }
    }
  }
  if (!n) { lo.fill(0); hi.fill(0); }
  const centre = lo.map((l, k) => Math.fround((l + hi[k]) / 2));
  const scale = lo.map((l, k) => Math.fround(hi[k] - l > 0 ? (hi[k] - l) / 65534 : 1));

  const buf = new ArrayBuffer(HEADER_BYTES + BYTES_PER_TRI * n);
  const dv = new DataView(buf);
  dv.setUint32(0, MESH_MAGIC, true);
  dv.setUint32(4, n, true);
  dv.setUint32(8, (floors ? 1 : 0) | (floorsOnly ? 2 : 0), true);
  for (let k = 0; k < 3; k++) {
    dv.setFloat32(12 + 4 * k, centre[k], true);
    dv.setFloat32(24 + 4 * k, scale[k], true);
  }
  const q = new Int16Array(buf, HEADER_BYTES, 9 * n);
  let w = 0;
  for (const t of chosen) {
    for (let c = 0; c < 3; c++) {
      const o = I[3 * t + c] * 3;
      for (let k = 0; k < 3; k++) {
        q[w++] = Math.max(-32767, Math.min(32767, Math.round((V[o + k] - centre[k]) / scale[k])));
      }
    }
  }
  return { buf, stats: { raw: nTri, kept: keep.length, packed: n, bytes: buf.byteLength, floors, floorsOnly } };
}

/** The wire buffer -> positions in the SERVER frame. Throws on anything that is not a mesh we wrote. */
export function unpackMesh(buf: ArrayBuffer): UnpackedMesh {
  if (buf.byteLength < HEADER_BYTES) throw new Error('mesh too short');
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MESH_MAGIC) throw new Error('not a zone mesh');
  const tris = dv.getUint32(4, true);
  if (buf.byteLength !== HEADER_BYTES + BYTES_PER_TRI * tris) throw new Error('mesh length does not match its triangle count');
  const flags = dv.getUint32(8, true);
  const floors = (flags & 1) === 1;
  const floorsOnly = (flags & 2) === 2;
  const c = [0, 1, 2].map(k => dv.getFloat32(12 + 4 * k, true));
  const s = [0, 1, 2].map(k => dv.getFloat32(24 + 4 * k, true));
  const q = new Int16Array(buf, HEADER_BYTES, 9 * tris);
  const pos = new Float32Array(9 * tris);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) {
    const k = i % 3;
    const v = q[i] * s[k] + c[k];
    pos[i] = v;
    if (v < min[k]) min[k] = v;
    if (v > max[k]) max[k] = v;
  }
  if (!tris) { min.fill(0); max.fill(0); }
  return { tris, pos, floors, floorsOnly, min, max };
}

/** The same low-cool, high-warm ramp as the 2D board's bandColor (SpectatorBoard.tsx), as a hue in degrees. */
export function heightHue(t: number): number {
  const f = Math.min(1, Math.max(0, t));
  return 215 - f * 190;
}
