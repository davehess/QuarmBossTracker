// Floor surfaces from the EQEmu collision mesh, shaded with NO textures: the colours for the 3D replay's floors and
// the parchment-style background of the 2D replay. Pure (no React, no three.js, no DOM), so the 3D view, the 2D
// rasteriser and the tests share one copy of the rules. The input is the unpacked `floors=only` mesh from
// lib/zoneMesh.ts, positions in the SERVER frame. Plain geometry in, colours out: no client art anywhere
// (DECISIONS-2026-09-21 §220, 3D-A).
//
// SHADING (computed once per mesh load, never per frame)
//   colour = heightRamp(t) x slope(up) x light(n)         all in sRGB 0..1, clamped
//   heightRamp  low cool -> high warm: the hue ramp of the 2D board's bandColor (zoneMesh.heightHue), muted.
//               t is the triangle's centroid z over the floors' own z range, 0..1.
//   slope       SLOPE_MIN + (1 - SLOPE_MIN) * up^2, up = |nz| of the unit face normal: flat 1, steeper darker, a
//               wall-like normal bottoms out at SLOPE_MIN.
//   light       a baked directional light from the north-west of the PICTURE (up-left on the north-up 2D board),
//               45 degrees up, plus ambient, divided by what a flat floor gets so flat ground keeps the ramp's own
//               colour and slopes lean lighter (toward the light) or darker (away from it). The 3D floors use an
//               unlit material and show this baked light; it does not move with the camera, like a printed map.
//
// FACING. Floors in this mesh format wind so that the face normal's z is NEGATIVE (the same convention
// zoneMap/slice.ts uses for FLOOR_NZ), and a roof/ceiling has it positive. The opaque floor layer must not
// include roofs (a cave roof would hide the cave from above), so only floor-facing triangles are kept. If a mesh
// had the opposite winding it would have NO floor-facing triangles, and the other facing is used instead rather
// than drawing nothing.
import { heightHue } from './zoneMesh';

export type Rgb = [number, number, number];

export const SLOPE_MIN = 0.55;
export const AMBIENT = 0.45;
// A little below zoneMesh.STEEP_NZ (0.7): the mesh is quantised to 16 bits, which can nudge a 45 degree face
// across the line, and this file must not drop a triangle the mesh route kept.
export const FLOOR_MIN_UP = 0.65;
// Toward the light, server frame. The picture is (-x, -y) with north up, so picture-left is +x and picture-up is
// +y: a north-west light is (+x, +y). Unit length: 0.25 + 0.25 + 0.5.
const LIGHT: Rgb = [0.5, 0.5, Math.SQRT1_2];
const FLAT_LIGHT = AMBIENT + (1 - AMBIENT) * LIGHT[2];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function hslToRgb(hDeg: number, s: number, l: number): Rgb {
  const h = (((hDeg % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    return u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

/** The muted height ramp, t 0 (lowest floor, cool blue) .. 1 (highest, warm orange). */
export function heightRgb(t: number): Rgb {
  return hslToRgb(heightHue(t), 0.34, 0.52);
}

/** 1 on flat ground, SLOPE_MIN on a wall-like face, darker the steeper in between. `nz` is the unit normal's z. */
export function slopeShade(nz: number): number {
  const up = Math.min(1, Math.abs(nz));
  return SLOPE_MIN + (1 - SLOPE_MIN) * up * up;
}

/** The baked directional light on a unit face normal (any facing: it is turned to face up first). Flat = 1. */
export function lightShade(nx: number, ny: number, nz: number): number {
  const s = nz < 0 ? -1 : 1;
  const d = Math.max(0, s * (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]));
  return (AMBIENT + (1 - AMBIENT) * d) / FLAT_LIGHT;
}

/** The 3D floor colour: height ramp x slope x light, sRGB 0..1. */
export function shadeFloor(t: number, nx: number, ny: number, nz: number): Rgb {
  const k = slopeShade(nz) * lightShade(nx, ny, nz);
  const c = heightRgb(t);
  return [clamp01(c[0] * k), clamp01(c[1] * k), clamp01(c[2] * k)];
}

export type FloorShade = {
  n: number;
  tri: Uint32Array;        // the source triangle number of each kept floor (index into the mesh's triangles)
  t: Float32Array;         // 0..1 height of each
  slope: Float32Array;     // slopeShade of each
  light: Float32Array;     // lightShade of each
  flipped: boolean;        // the mesh wound the other way and the other facing was used (see FACING)
  dropped: number;         // triangles not kept: the other facing, or steeper than FLOOR_MIN_UP
  min: [number, number, number];   // bounds of the KEPT triangles, server frame
  max: [number, number, number];
};

/** Which triangles of a floors mesh are floor, and how each is shaded. `pos` is 9 numbers a triangle, server frame. */
export function shadeFloors(pos: Float32Array): FloorShade {
  const nTri = Math.floor(pos.length / 9);
  const nx = new Float32Array(nTri), ny = new Float32Array(nTri), nz = new Float32Array(nTri), cz = new Float32Array(nTri);
  let down = 0, up = 0;
  for (let t = 0; t < nTri; t++) {
    const o = 9 * t;
    const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2];
    const vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
    const ax = uy * vz - uz * vy, ay = uz * vx - ux * vz, az = ux * vy - uy * vx;
    const len = Math.sqrt(ax * ax + ay * ay + az * az);
    if (!(len > 1e-9)) { nz[t] = 0; continue; }   // degenerate: neither facing
    nx[t] = ax / len; ny[t] = ay / len; nz[t] = az / len;
    cz[t] = (pos[o + 2] + pos[o + 5] + pos[o + 8]) / 3;
    if (nz[t] <= -FLOOR_MIN_UP) down++;
    else if (nz[t] >= FLOOR_MIN_UP) up++;
  }
  const flipped = down === 0 && up > 0;
  const keepIf = (z: number) => (flipped ? z >= FLOOR_MIN_UP : z <= -FLOOR_MIN_UP);

  const kept: number[] = [];
  let zLo = Infinity, zHi = -Infinity;
  for (let t = 0; t < nTri; t++) {
    if (!keepIf(nz[t])) continue;
    kept.push(t);
    if (cz[t] < zLo) zLo = cz[t];
    if (cz[t] > zHi) zHi = cz[t];
  }
  const n = kept.length;
  const span = Math.max(1, zHi - zLo);
  const out: FloorShade = {
    n, tri: Uint32Array.from(kept), t: new Float32Array(n), slope: new Float32Array(n), light: new Float32Array(n),
    flipped, dropped: nTri - n, min: [0, 0, 0], max: [0, 0, 0],
  };
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const t = kept[i];
    out.t[i] = (cz[t] - zLo) / span;
    out.slope[i] = slopeShade(nz[t]);
    out.light[i] = lightShade(nx[t], ny[t], nz[t]);
    for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) {
      const c = pos[9 * t + 3 * v + k];
      if (c < lo[k]) lo[k] = c;
      if (c > hi[k]) hi[k] = c;
    }
  }
  if (n) { out.min = [lo[0], lo[1], lo[2]]; out.max = [hi[0], hi[1], hi[2]]; }
  return out;
}

/** The 3D vertex colours: 9 numbers (sRGB 0..1) per kept floor, the same colour on all three corners (flat shading). */
export function floorVertexColors(fs: FloorShade): Float32Array {
  const col = new Float32Array(fs.n * 9);
  for (let i = 0; i < fs.n; i++) {
    const k = fs.slope[i] * fs.light[i];
    const c = heightRgb(fs.t[i]);
    const r = clamp01(c[0] * k), g = clamp01(c[1] * k), b = clamp01(c[2] * k);
    for (let v = 0; v < 3; v++) { col[9 * i + 3 * v] = r; col[9 * i + 3 * v + 1] = g; col[9 * i + 3 * v + 2] = b; }
  }
  return col;
}

// ── the 2D parchment ─────────────────────────────────────────────────────────────────────────────────────────

/** Paper under the floors; the floor wash is a lighter, warmer version of it. 0..255. */
export const PAPER_RGB: Rgb = [205, 189, 150];
export const PAPER_FLOOR_RGB: Rgb = [236, 226, 196];
const HEIGHT_TINT = 0.2;   // how much of the height ramp shows through on the parchment
const HILL_GAIN = 0.9;     // how hard the NW hillshade bites; the 3D view uses the light as it is

/** The parchment colour of one floor triangle, 0..255: light paper, a touch of the height ramp, a soft NW hillshade. */
export function parchmentFloor(t: number, light: number): Rgb {
  const h = heightRgb(t);
  const m = Math.min(1.12, Math.max(0.55, 1 + HILL_GAIN * (light - 1)));
  const f = (base: number, hr: number) => Math.min(255, Math.max(0, Math.round((base * (1 - HEIGHT_TINT) + hr * 255 * HEIGHT_TINT) * m)));
  return [f(PAPER_FLOOR_RGB[0], h[0]), f(PAPER_FLOOR_RGB[1], h[1]), f(PAPER_FLOOR_RGB[2], h[2])];
}

/** Where the raster sits: pixel = ((-x) - u0) * k, ((-y) - v0) * k for a SERVER-frame x, y (the picture is -x, -y). */
export type RasterPlan = { w: number; h: number; k: number; u0: number; v0: number };

/** A plan that fits server-frame bounds into a raster whose longer side is `longSide` pixels, with a pixel of margin. */
export function planRaster(minX: number, maxX: number, minY: number, maxY: number, longSide: number): RasterPlan {
  const spanU = Math.max(maxX - minX, 1), spanV = Math.max(maxY - minY, 1);
  const k = Math.max(2, longSide - 2) / Math.max(spanU, spanV);
  return {
    w: Math.ceil(spanU * k) + 2, h: Math.ceil(spanV * k) + 2, k,
    u0: -maxX - 1 / k, v0: -maxY - 1 / k,
  };
}

const FLOOR_ALPHA = 232;   // the wash is nearly opaque where there is floor, clear where there is none
const OVER = 0.6;          // an upper storey painted over a lower one keeps 40% of what was under it

/**
 * Fills one triangle (pixel coordinates) into an RGBA buffer, scanline by scanline, so cost follows the pixels
 * covered and not the bounding box (a long diagonal sliver is cheap). A triangle that covers no pixel centre still
 * marks the pixel under its middle, so a small floor does not become a hole. Returns the pixels written.
 */
export function fillTriangle(
  rgba: Uint8ClampedArray, w: number, h: number,
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, r: number, g: number, b: number,
): number {
  let wrote = 0;
  const put = (px: number, py: number) => {
    const i = (py * w + px) * 4;
    if (rgba[i + 3] === 0) {
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = FLOOR_ALPHA;
    } else {
      rgba[i] = rgba[i] + (r - rgba[i]) * OVER;
      rgba[i + 1] = rgba[i + 1] + (g - rgba[i + 1]) * OVER;
      rgba[i + 2] = rgba[i + 2] + (b - rgba[i + 2]) * OVER;
    }
    wrote++;
  };
  const yMin = Math.max(0, Math.ceil(Math.min(y0, y1, y2) - 0.5));
  const yMax = Math.min(h - 1, Math.floor(Math.max(y0, y1, y2) - 0.5));
  for (let py = yMin; py <= yMax; py++) {
    const yc = py + 0.5;
    let xl = Infinity, xr = -Infinity;
    const edge = (ax: number, ay: number, bx: number, by: number) => {
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
        const x = ax + ((yc - ay) * (bx - ax)) / (by - ay);
        if (x < xl) xl = x;
        if (x > xr) xr = x;
      }
    };
    edge(x0, y0, x1, y1); edge(x1, y1, x2, y2); edge(x2, y2, x0, y0);
    if (xl > xr) continue;
    const a = Math.max(0, Math.ceil(xl - 0.5)), z = Math.min(w - 1, Math.floor(xr - 0.5));
    for (let px = a; px <= z; px++) put(px, py);
  }
  if (!wrote) {
    const cx = Math.floor((x0 + x1 + x2) / 3), cy = Math.floor((y0 + y1 + y2) / 3);
    if (cx >= 0 && cx < w && cy >= 0 && cy < h) put(cx, cy);
  }
  return wrote;
}

/**
 * The parchment floor wash as a resumable job: kept floors painted lowest first (a higher storey lands on top),
 * `step` doing as much as fits before its deadline so the caller can spread the work over idle time. Nothing in
 * here touches the DOM; the result is an RGBA buffer the caller puts on a canvas.
 */
export class FloorRaster {
  readonly rgba: Uint8ClampedArray;
  private readonly order: Uint32Array;
  private next = 0;

  constructor(private readonly fs: FloorShade, private readonly pos: Float32Array, readonly plan: RasterPlan) {
    this.rgba = new Uint8ClampedArray(plan.w * plan.h * 4);
    // Counting sort on height (256 steps): O(n), stable, and no comparator over 60k triangles.
    const q = new Uint8Array(fs.n);
    const count = new Uint32Array(257);
    for (let i = 0; i < fs.n; i++) { q[i] = Math.round(fs.t[i] * 255); count[q[i] + 1]++; }
    for (let i = 0; i < 256; i++) count[i + 1] += count[i];
    this.order = new Uint32Array(fs.n);
    for (let i = 0; i < fs.n; i++) this.order[count[q[i]]++] = i;
  }

  get done(): boolean { return this.next >= this.order.length; }
  get progress(): number { return this.order.length ? this.next / this.order.length : 1; }

  /** Paints until `deadline` (in `now()` units) or the end. Checks the clock every 128 triangles. Returns done. */
  step(deadline: number, now: () => number = () => performance.now()): boolean {
    const { fs, pos, plan, rgba } = this;
    while (this.next < this.order.length) {
      const end = Math.min(this.order.length, this.next + 128);
      for (; this.next < end; this.next++) {
        const i = this.order[this.next];
        const o = 9 * fs.tri[i];
        const c = parchmentFloor(fs.t[i], fs.light[i]);
        fillTriangle(
          rgba, plan.w, plan.h,
          (-pos[o] - plan.u0) * plan.k, (-pos[o + 1] - plan.v0) * plan.k,
          (-pos[o + 3] - plan.u0) * plan.k, (-pos[o + 4] - plan.v0) * plan.k,
          (-pos[o + 6] - plan.u0) * plan.k, (-pos[o + 7] - plan.v0) * plan.k,
          c[0], c[1], c[2]);
      }
      if (now() >= deadline) break;
    }
    return this.done;
  }
}
