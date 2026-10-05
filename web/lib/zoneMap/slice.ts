// Flat top-down wall lines for a zone, sliced from an EQEmu server collision mesh.
//
// Source: https://github.com/EQEmu/maps (base/<zone_short>.map), GPLv2-or-later,
// "Copyright (C) 2004-2009 EQEmulator.NET, AX-Classic, and ProjectEQ". What this file
// produces is DERIVED from those meshes, so it carries the same licence; the route and the
// cache table both label it that way.
//
// This is a port of the Python reference slicer the method was tuned with. The thresholds
// below are the ones that worked on the real meshes (Vex Thal, Plane of Innovation, a
// terrain zone) — change one only with a side-by-side render, not by taste.
//
// COORDINATE FRAME — read before plotting a raider on this:
//   Segments stay in the SERVER frame: the same axes as eqemu_spawn2 x/y. The Zeal pipe and
//   raid_roster report (loc_x, loc_y) = server (y, x), i.e. the two are swapped. Verified
//   2026-10-04 against live Plane of Innovation positions: with the swap 15 of 19 raiders
//   stand on a floor of the sliced map, without it 0 do. The map stays in the server frame
//   and the CONSUMER swaps, so the one swap lives in one place.
//
// WHAT IS DRAWN
//   Walls only: a wall triangle (|normal.z| < 0.30, at least 5 units tall) contributes its
//   longest xy edge, and collinear pieces are merged into one line. Open mesh edges are
//   deliberately NOT drawn — they trace unwelded terrain-tile seams, not coastlines.
//   Floors are used only to find FLOOR BANDS (the stacked storeys of a zone), so a multi-level
//   zone can be shown one level at a time: each wall gets the band its foot stands on.

import zlib from 'node:zlib';

// ---- tunables (see the header: these are measured, not guessed) ----
const WALL_NZ = 0.30;        // |normal.z| below this = wall
const FLOOR_NZ = -0.70;      // normal.z below this = walkable floor (this mesh's winding points floors DOWN)
const MIN_WALL_H = 5.0;      // wall triangle z-extent: drops curbs and sliver noise
const MIN_SEG = 3.0;         // a per-triangle xy edge shorter than this is ignored
const THETA_BIN = (2.0 * Math.PI) / 180;  // collinear merge: angle bucket (2 degrees)
const OFFSET_BIN = 3.0;      // collinear merge: perpendicular offset bucket (units)
const GAP = 4.0;             // merge collinear pieces separated by <= GAP
const FINAL_MIN = 6.0;       // drop merged segments shorter than this
const Z_BIN = 4.0;           // floor z histogram bin
const BAND_MIN_FRAC = 0.05;  // a band needs >= this fraction of the biggest floor area
const BAND_MERGE = 20.0;     // peaks closer than this (z units) are one band

// A V2 map is: u32 0x02000000, u32 compressed size, u32 uncompressed size, then a zlib block.
// The inflated block starts with 40 bytes of header (9 x u32 counts + a float); the first two
// counts are the vertex count and the INDEX count (three per triangle). float3 vertices and
// u32 indices follow; the models/placeables after them are not needed for walls.
const MAGIC_V2 = 0x02000000;
const INNER_HEADER = 40;
// Real zone meshes inflate to a few MB; this only stops a hostile or corrupt size field.
const MAX_INFLATED = 128 * 1024 * 1024;

export type Seg = [x1: number, y1: number, x2: number, y2: number, band: number];
export type Bounds = { minX: number; maxX: number; minY: number; maxY: number };
export type ZoneSlice = { bands: number[]; segs: Seg[]; bounds: Bounds };

export function parseEqemuMap(buf: Buffer): { V: Float32Array; I: Uint32Array } {
  if (buf.length < 12 || buf.readUInt32LE(0) !== MAGIC_V2) throw new Error('not a V2 EQEmu map');
  const compressed = buf.readUInt32LE(4);
  if (12 + compressed > buf.length) throw new Error('truncated EQEmu map');
  const inner = zlib.inflateSync(buf.subarray(12, 12 + compressed), { maxOutputLength: MAX_INFLATED });
  if (inner.length < INNER_HEADER) throw new Error('truncated EQEmu map header');
  const vc = inner.readUInt32LE(0);
  const ic = inner.readUInt32LE(4);
  const vEnd = INNER_HEADER + 12 * vc;
  if (ic % 3 !== 0 || vEnd + 4 * ic > inner.length) throw new Error('truncated EQEmu map body');
  // Copy into fresh buffers: a typed-array view needs a 4-byte-aligned offset, which a Buffer
  // sliced out of the pool does not promise. (Both x86 and ARM hosts are little-endian.)
  const V = new Float32Array(inner.buffer.slice(inner.byteOffset + INNER_HEADER, inner.byteOffset + vEnd));
  const I = new Uint32Array(inner.buffer.slice(inner.byteOffset + vEnd, inner.byteOffset + vEnd + 4 * ic));
  for (let k = 0; k < I.length; k++) {
    if (I[k] >= vc) throw new Error('EQEmu map index out of range');
  }
  return { V, I };
}

// numpy.round and Python's round() are half-to-even; Math.round is half-up. The merge buckets
// sit on exact .5 ties for axis-aligned walls on half-unit coordinates, so matching the
// reference means matching this.
function roundEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  const r = d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1;
  return r === 0 ? 0 : r;   // never -0: it survives into assertions and reads oddly in a debugger
}

// Cluster walkable-floor z (area weighted) into bands; returns the band centre z values, low to high.
function findBands(zc: number[], area: number[]): number[] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const z of zc) {
    if (z < lo) lo = z;
    if (z > hi) hi = z;
  }
  const e0 = Math.floor(lo);
  // At least one bin: a zone whose floors all sit on one integer z has hi == e0, which the
  // reference's arange would turn into a single edge (and then fail on).
  const nb = Math.max(1, Math.ceil((hi + Z_BIN - e0) / Z_BIN) - 1);
  const h = new Array<number>(nb).fill(0);
  for (let k = 0; k < zc.length; k++) {
    let i = Math.min(nb - 1, Math.max(0, Math.floor((zc[k] - e0) / Z_BIN)));
    // Pin the bin against float rounding at an exact edge: [e_i, e_i+1), last bin closed.
    while (i > 0 && zc[k] < e0 + Z_BIN * i) i--;
    while (i < nb - 1 && zc[k] >= e0 + Z_BIN * (i + 1)) i++;
    h[i] += area[k];
  }
  // [1,2,1]/4 smoothing with zero padding.
  const hs = h.map((v, i) => ((i > 0 ? h[i - 1] : 0) + 2 * v + (i < nb - 1 ? h[i + 1] : 0)) / 4);
  const hsMax = Math.max(...hs);
  const cen = (i: number) => e0 + Z_BIN * i + Z_BIN / 2;
  const peaks: number[] = [];
  for (let i = 0; i < nb; i++) {
    if (hs[i] > 0 && hs[i] >= BAND_MIN_FRAC * hsMax
        && (i === 0 || hs[i] >= hs[i - 1])
        && (i === nb - 1 || hs[i] > hs[i + 1])) peaks.push(i);
  }
  // Peaks closer than BAND_MERGE are one band; keep the heavier.
  const merged: number[] = [];
  for (const i of peaks) {
    const last = merged[merged.length - 1];
    if (last !== undefined && cen(i) - cen(last) < BAND_MERGE) {
      if (hs[i] > hs[last]) merged[merged.length - 1] = i;
    } else {
      merged.push(i);
    }
  }
  return merged.map(cen);
}

type Group = { kq: number; oq: number; s: number; e: number; offs: number; ths: number; n: number; zfoot: number };

export function sliceZoneMap(V: Float32Array, I: Uint32Array): ZoneSlice {
  const nTri = Math.floor(I.length / 3);

  // ---- pass 1: normals -> walkable floors (for bands) and wall triangles ----
  const floorZ: number[] = [];
  const floorArea: number[] = [];
  const wallP0: number[] = [];   // x,y pairs, flattened
  const wallP1: number[] = [];
  const wallFoot: number[] = [];
  for (let t = 0; t < nTri; t++) {
    const ia = I[3 * t] * 3, ib = I[3 * t + 1] * 3, ic = I[3 * t + 2] * 3;
    const ax = V[ia], ay = V[ia + 1], az = V[ia + 2];
    const bx = V[ib], by = V[ib + 1], bz = V[ib + 2];
    const cx = V[ic], cy = V[ic + 1], cz = V[ic + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nzr = ux * vy - uy * vx;
    const nl = Math.sqrt(nx * nx + ny * ny + nzr * nzr);
    if (!(nl > 1e-9)) continue;   // degenerate: no normal, so neither floor nor wall
    const nz = nzr / nl;
    if (nz < FLOOR_NZ) {
      floorZ.push((az + bz + cz) / 3);
      floorArea.push(nl / 2);
    }
    if (Math.abs(nz) >= WALL_NZ) continue;
    const zmin = Math.min(az, bz, cz), zmax = Math.max(az, bz, cz);
    if (zmax - zmin < MIN_WALL_H) continue;
    // The longest xy edge of a wall triangle is the line the wall draws (first wins a tie).
    const l01 = Math.hypot(ax - bx, ay - by);
    const l12 = Math.hypot(bx - cx, by - cy);
    const l20 = Math.hypot(cx - ax, cy - ay);
    let len = l01, x0 = ax, y0 = ay, x1 = bx, y1 = by;
    if (l12 > len) { len = l12; x0 = bx; y0 = by; x1 = cx; y1 = cy; }
    if (l20 > len) { len = l20; x0 = cx; y0 = cy; x1 = ax; y1 = ay; }
    if (len < MIN_SEG) continue;
    wallP0.push(x0, y0);
    wallP1.push(x1, y1);
    wallFoot.push(zmin);
  }

  let bands = floorZ.length ? findBands(floorZ, floorArea) : [];

  // ---- collinear merge (band-agnostic: a tall wall is many stacked triangles, and merging
  // before banding keeps it ONE line) ----
  const n = wallFoot.length;
  const th = new Float64Array(n), off = new Float64Array(n), ta = new Float64Array(n), tb = new Float64Array(n);
  const kq = new Int32Array(n), oq = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const p0x = wallP0[2 * i], p0y = wallP0[2 * i + 1], p1x = wallP1[2 * i], p1y = wallP1[2 * i + 1];
    let a = Math.atan2(p1y - p0y, p1x - p0x) % Math.PI;
    if (a < 0) a += Math.PI;
    th[i] = a;
    const ux = Math.cos(a), uy = Math.sin(a);
    off[i] = -p0x * uy + p0y * ux;
    const t0 = p0x * ux + p0y * uy, t1 = p1x * ux + p1y * uy;
    ta[i] = Math.min(t0, t1);
    tb[i] = Math.max(t0, t1);
    kq[i] = roundEven(a / THETA_BIN);
    oq[i] = roundEven(off[i] / OFFSET_BIN);
  }
  const order = Array.from({ length: n }, (_, i) => i)
    .sort((i, j) => kq[i] - kq[j] || oq[i] - oq[j] || ta[i] - ta[j] || i - j);

  const groups: Group[] = [];
  let cur: Group | null = null;
  for (const i of order) {
    if (cur && cur.kq === kq[i] && cur.oq === oq[i] && ta[i] <= cur.e + GAP) {
      cur.e = Math.max(cur.e, tb[i]);
      cur.offs += off[i]; cur.ths += th[i]; cur.n++;
      cur.zfoot = Math.min(cur.zfoot, wallFoot[i]);
    } else {
      if (cur) groups.push(cur);
      cur = { kq: kq[i], oq: oq[i], s: ta[i], e: tb[i], offs: off[i], ths: th[i], n: 1, zfoot: wallFoot[i] };
    }
  }
  if (cur) groups.push(cur);

  // A zone with no walkable floor at all still needs one band for its walls to belong to.
  if (!bands.length && groups.length) bands = [groups.reduce((m, g) => Math.min(m, g.zfoot), Infinity) + 1];

  const segs: Seg[] = [];
  for (const g of groups) {
    if (g.e - g.s < FINAL_MIN) continue;
    const o = g.offs / g.n, t = g.ths / g.n;
    const ux = Math.cos(t), uy = Math.sin(t);
    // Band = the floor the wall's FOOT stands on (+1 so a wall sitting exactly on a floor reads as on it).
    let band = 0;
    for (let b = 1; b < bands.length; b++) {
      if (Math.abs(g.zfoot + 1 - bands[b]) < Math.abs(g.zfoot + 1 - bands[band])) band = b;
    }
    segs.push([
      roundEven(g.s * ux - o * uy), roundEven(g.s * uy + o * ux),
      roundEven(g.e * ux - o * uy), roundEven(g.e * uy + o * ux),
      band,
    ]);
  }

  // Bounds of what is drawn (segment endpoints), not of the whole mesh: a terrain zone's mesh
  // is far larger than its walls, and the view should fit the lines it has.
  const bounds: Bounds = segs.length
    ? { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    : { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  for (const [x1, y1, x2, y2] of segs) {
    bounds.minX = Math.min(bounds.minX, x1, x2);
    bounds.maxX = Math.max(bounds.maxX, x1, x2);
    bounds.minY = Math.min(bounds.minY, y1, y2);
    bounds.maxY = Math.max(bounds.maxY, y1, y2);
  }
  return { bands: bands.map(roundEven), segs, bounds };
}
