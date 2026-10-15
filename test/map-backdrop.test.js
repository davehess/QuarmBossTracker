// test/map-backdrop.test.js — the floor shading behind the 3D replay's opaque floors and the 2D parchment
// background (web/lib/zoneFloor.ts), the background choice and the cache keys (web/lib/mapBackdrop.ts).
//
// What is pinned: a flat floor is the ramp's own colour and a slope is darker (steeper, darker; a wall-like
// normal bottoms out); the ramp runs cool at the low end to warm at the high end; a roof is NOT a floor; the
// picture is mirrored (x positive lands on the LEFT of the raster); a higher storey paints over a lower one in any
// input order; and a raster painted in many small slices equals one painted in a single call.
// The rasteriser tests use corpora bigger than their limits (300 triangles against 128 per clock check) so a
// limit that was never applied cannot pass.
//
// Run: npx vitest run test/map-backdrop.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  SLOPE_MIN, slopeShade, lightShade, heightRgb, shadeFloor, shadeFloors, floorVertexColors,
  parchmentFloor, planRaster, fillTriangle, FloorRaster,
} from '../web/lib/zoneFloor.ts';
import { parseBg, bgSearch, rasterBucket, RASTER_BUCKETS, parchmentKey, lruSet, DEFAULT_BG } from '../web/lib/mapBackdrop.ts';
import { stripJs, ROOT } from './_source-slice.js';

const sum = c => c[0] + c[1] + c[2];

// A floor triangle as the mesh winds them (normal.z negative), at height z, over [x0,x1] x [y0,y1].
function floorQuad(x0, y0, x1, y1, z) {
  return [x0, y0, z, x0, y1, z, x1, y1, z, x0, y0, z, x1, y1, z, x1, y0, z];
}
// The same quad wound the other way: a roof (normal.z positive).
function roofQuad(x0, y0, x1, y1, z) {
  return [x0, y0, z, x1, y1, z, x0, y1, z, x0, y0, z, x1, y0, z, x1, y1, z];
}
const f32 = (...parts) => Float32Array.from(parts.flat());

describe('floor shading primitives', () => {
  it('slope: flat is 1, steeper is darker, a wall-like normal bottoms out at the minimum', () => {
    expect(slopeShade(1)).toBe(1);
    expect(slopeShade(-1)).toBe(1);   // facing does not matter
    const s45 = slopeShade(Math.SQRT1_2);
    expect(s45).toBeLessThan(1);
    expect(s45).toBeGreaterThan(SLOPE_MIN);
    expect(slopeShade(0)).toBeCloseTo(SLOPE_MIN, 6);
    expect(slopeShade(0.9)).toBeGreaterThan(slopeShade(0.8));
    expect(slopeShade(0.8)).toBeGreaterThan(slopeShade(0.7));
  });

  it('light: flat is 1 either way up, toward the north-west light is brighter, away is darker', () => {
    expect(lightShade(0, 0, 1)).toBeCloseTo(1, 6);
    expect(lightShade(0, 0, -1)).toBeCloseTo(1, 6);
    const s = Math.SQRT1_2;
    const toward = lightShade(0.5, 0.5, s), away = lightShade(-0.5, -0.5, s);
    expect(toward).toBeGreaterThan(1.1);
    expect(away).toBeLessThan(0.7);
    // The picture's left is +x and its top is +y, so a slope facing +x +y faces the light. Facing -x alone is darker than +x alone.
    expect(lightShade(Math.SQRT1_2, 0, Math.SQRT1_2)).toBeGreaterThan(lightShade(-Math.SQRT1_2, 0, Math.SQRT1_2));
  });

  it('ramp: the low end is cool, the high end is warm', () => {
    const lo = heightRgb(0), hi = heightRgb(1);
    expect(lo[2]).toBeGreaterThan(lo[0]);   // blue over red
    expect(hi[0]).toBeGreaterThan(hi[2]);   // red over blue
    expect(heightRgb(-5)).toEqual(lo);      // clamped
    expect(heightRgb(5)).toEqual(hi);
  });

  it('combined: flat keeps the ramp colour, a 45 degree slope facing away is darker, a wall-like normal darker still', () => {
    const flat = shadeFloor(0.5, 0, 0, 1);
    expect(flat).toEqual(heightRgb(0.5).map(v => Math.min(1, v)));
    const away = shadeFloor(0.5, -0.5, -0.5, Math.SQRT1_2);
    const wall = shadeFloor(0.5, -1, 0, 0);
    expect(sum(away)).toBeLessThan(sum(flat));
    expect(sum(wall)).toBeLessThan(sum(flat));
    // A 45 degree slope facing the light is lit more than one facing away, same height.
    expect(sum(shadeFloor(0.5, 0.5, 0.5, Math.SQRT1_2))).toBeGreaterThan(sum(away));
    for (const c of [flat, away, wall]) for (const v of c) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
});

describe('shadeFloors', () => {
  it('keeps floors, drops roofs, and puts the lowest floor at t 0 and the highest at t 1', () => {
    const pos = f32(floorQuad(0, 0, 10, 10, 0), floorQuad(20, 0, 30, 10, 100), roofQuad(0, 0, 10, 10, 300));
    const out = shadeFloors(pos);
    expect(out.n).toBe(4);                 // two quads = four floor triangles
    expect(out.dropped).toBe(2);           // the roof's two
    expect(out.flipped).toBe(false);
    expect([...out.tri]).toEqual([0, 1, 2, 3]);
    expect(Math.min(...out.t)).toBe(0);
    expect(Math.max(...out.t)).toBe(1);
    expect([...out.t]).toEqual([0, 0, 1, 1]);
    expect(out.min).toEqual([0, 0, 0]);
    expect(out.max).toEqual([30, 10, 100]);
  });

  it('shades a flat floor 1 and a 45 degree slope darker', () => {
    // A slope rising to +x at 45 degrees, wound like a floor.
    const slope = [0, 0, 0, 0, 10, 0, 10, 10, 10];
    const out = shadeFloors(f32(floorQuad(0, 0, 10, 10, 5).slice(0, 9), slope));
    expect(out.n).toBe(2);
    expect(out.slope[0]).toBe(1);
    expect(out.light[0]).toBeCloseTo(1, 5);
    expect(out.slope[1]).toBeLessThan(out.slope[0]);
    expect(out.slope[1]).toBeCloseTo(slopeShade(Math.SQRT1_2), 3);
  });

  it('drops a wall-like triangle and a degenerate one', () => {
    const wall = [0, 0, 0, 0, 10, 0, 0, 10, 10];   // normal along x
    const line = [0, 0, 0, 1, 1, 1, 2, 2, 2];
    expect(shadeFloors(f32(wall, line)).n).toBe(0);
  });

  it('a mesh wound the other way is not drawn empty: its facing is used instead', () => {
    const out = shadeFloors(f32(roofQuad(0, 0, 10, 10, 0), roofQuad(20, 0, 30, 10, 50)));
    expect(out.flipped).toBe(true);
    expect(out.n).toBe(4);
    expect(out.light[0]).toBeCloseTo(1, 5);
  });

  it('vertex colours: nine per triangle, one colour on all three corners, low and high differ', () => {
    const out = shadeFloors(f32(floorQuad(0, 0, 10, 10, 0), floorQuad(20, 0, 30, 10, 100)));
    const col = floorVertexColors(out);
    expect(col.length).toBe(out.n * 9);
    for (let i = 0; i < out.n; i++) {
      expect([...col.slice(9 * i + 3, 9 * i + 6)]).toEqual([...col.slice(9 * i, 9 * i + 3)]);
      expect([...col.slice(9 * i + 6, 9 * i + 9)]).toEqual([...col.slice(9 * i, 9 * i + 3)]);
    }
    expect(col[2]).toBeGreaterThan(col[0]);                       // lowest: cool
    expect(col[9 * 2]).toBeGreaterThan(col[9 * 2 + 2]);           // highest: warm
  });
});

describe('parchment raster', () => {
  const at = (r, px, py) => { const i = (py * r.plan.w + px) * 4; return [...r.rgba.slice(i, i + 4)]; };
  const run = r => { while (!r.step(Infinity)) { /* one call finishes it */ } return r; };

  it('plans a raster whose longer side is the bucket, with margin', () => {
    const p = planRaster(-1000, 1000, -500, 500, 1024);
    expect(Math.max(p.w, p.h)).toBeLessThanOrEqual(1024 + 2);
    expect(Math.max(p.w, p.h)).toBeGreaterThan(1000);
    expect(p.w).toBeGreaterThan(p.h);
  });

  it('mirrors like the board: a floor at positive x lands on the left of the raster, positive y at the top', () => {
    const pos = f32(floorQuad(100, 0, 200, 100, 0), floorQuad(-200, 0, -100, 100, 0), floorQuad(0, 200, 100, 300, 0));
    const shade = shadeFloors(pos);
    const plan = planRaster(-200, 200, 0, 300, 400);
    const r = run(new FloorRaster(shade, pos, plan));
    const px = x => Math.round((-x - plan.u0) * plan.k), py = y => Math.round((-y - plan.v0) * plan.k);
    expect(at(r, px(150), py(50))[3]).toBeGreaterThan(0);      // x +150: painted
    expect(at(r, px(-150), py(50))[3]).toBeGreaterThan(0);
    expect(px(150)).toBeLessThan(px(-150));                     // and the positive one is further left
    expect(py(250)).toBeLessThan(py(50));                       // y +250 is nearer the top than y +50
    expect(at(r, px(0), py(50))[3]).toBe(0);                    // the gap between the two strips is clear
  });

  it('a higher storey is painted over a lower one, whatever order the mesh lists them in', () => {
    const low = floorQuad(0, 0, 100, 100, 0), high = floorQuad(0, 0, 100, 100, 200);
    const pos = (a, b) => f32(a, b);
    const plan = planRaster(0, 100, 0, 100, 128);
    const mid = Math.round(plan.w / 2);
    const px = (p, o) => { const s = shadeFloors(p); return at(run(new FloorRaster(s, p, plan)), mid, Math.round(plan.h / 2)); };
    const a = px(pos(low, high)), b = px(pos(high, low));
    expect(a).toEqual(b);
    const lo = parchmentFloor(0, 1), hi = parchmentFloor(1, 1);
    // The top storey is 60% of the result, so it is closer to the high colour than the low one on the channel that differs most.
    const ch = [0, 1, 2].reduce((m, i) => (Math.abs(hi[i] - lo[i]) > Math.abs(hi[m] - lo[m]) ? i : m), 0);
    expect(Math.abs(a[ch] - hi[ch])).toBeLessThan(Math.abs(a[ch] - lo[ch]));
  });

  it('a triangle smaller than a pixel still marks one, so a small floor is not a hole', () => {
    const rgba = new Uint8ClampedArray(8 * 8 * 4);
    const n = fillTriangle(rgba, 8, 8, 3.1, 3.1, 3.4, 3.1, 3.2, 3.4, 10, 20, 30);
    expect(n).toBe(1);
    expect([...rgba.slice((3 * 8 + 3) * 4, (3 * 8 + 3) * 4 + 4)].slice(0, 3)).toEqual([10, 20, 30]);
  });

  it('a long diagonal sliver paints only the pixels it covers', () => {
    const rgba = new Uint8ClampedArray(200 * 200 * 4);
    const n = fillTriangle(rgba, 200, 200, 0, 0, 199, 199, 199, 195, 1, 2, 3);
    expect(n).toBeGreaterThan(100);
    expect(n).toBeLessThan(2000);   // not the 40,000 pixels of its bounding box
  });

  it('painting in many small slices equals painting in one call, and takes more than one slice', () => {
    const quads = [];
    for (let i = 0; i < 150; i++) quads.push(floorQuad(i * 12, 0, i * 12 + 10, 10, (i * 7) % 90));
    const pos = f32(...quads);                    // 300 triangles: more than the 128 between clock checks
    const shade = shadeFloors(pos);
    const plan = planRaster(0, 1800, 0, 10, 512);
    const whole = run(new FloorRaster(shade, pos, plan));
    const sliced = new FloorRaster(shade, pos, plan);
    let calls = 0;
    while (!sliced.step(0, () => 1)) calls++;     // the deadline is always already past
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(sliced.done).toBe(true);
    expect(sliced.progress).toBe(1);
    expect(Buffer.from(sliced.rgba).equals(Buffer.from(whole.rgba))).toBe(true);
    expect(whole.rgba.some(v => v > 0)).toBe(true);
  });
});

describe('background choice and cache keys', () => {
  it('parses ?bg=, defaulting to parchment and ignoring anything else', () => {
    expect(DEFAULT_BG).toBe('parchment');
    expect(parseBg('')).toBe('parchment');
    expect(parseBg('?bg=none')).toBe('none');
    expect(parseBg('?x=1&bg=lines')).toBe('lines');
    expect(parseBg('?bg=parchment')).toBe('parchment');
    expect(parseBg('?bg=painted')).toBe('parchment');
    expect(parseBg('?bg=')).toBe('parchment');
  });

  it('writes ?bg= only off the default and keeps unrelated params', () => {
    expect(bgSearch('parchment', '')).toBe('');
    expect(bgSearch('lines', '')).toBe('?bg=lines');
    expect(bgSearch('none', '?follow=Aldenmar&split=off')).toBe('?follow=Aldenmar&split=off&bg=none');
    expect(bgSearch('parchment', '?bg=none&follow=Aldenmar')).toBe('?follow=Aldenmar');
    expect(parseBg(bgSearch('none', '?hl=a,b'))).toBe('none');
  });

  it('buckets by pane size with headroom, tops out at the largest, ignores tiny panes', () => {
    expect(RASTER_BUCKETS).toEqual([768, 1024, 1536, 2048]);
    expect(rasterBucket(390, 420)).toBe(768);        // a phone
    expect(rasterBucket(600, 400)).toBe(768);        // 600 * 1.25 = 750
    expect(rasterBucket(620, 400)).toBe(1024);       // just over
    expect(rasterBucket(1100, 600)).toBe(1536);
    expect(rasterBucket(1400, 700)).toBe(2048);
    expect(rasterBucket(5000, 5000)).toBe(2048);
    expect(rasterBucket(0, 0)).toBe(768);
  });

  it('keys by zone and bucket: a resize inside a bucket is the same key, across one is not', () => {
    expect(parchmentKey('ssratemple', rasterBucket(900, 500))).toBe(parchmentKey('ssratemple', rasterBucket(950, 520)));
    expect(parchmentKey('ssratemple', rasterBucket(900, 500))).not.toBe(parchmentKey('ssratemple', rasterBucket(1300, 600)));
    expect(parchmentKey('ssratemple', 1024)).not.toBe(parchmentKey('vexthal', 1024));
  });

  it('the cache keeps the newest N and reports what it dropped (a touch makes an entry newest)', () => {
    const m = new Map();
    expect(lruSet(m, 'a', 1, 3)).toEqual([]);
    lruSet(m, 'b', 2, 3);
    lruSet(m, 'c', 3, 3);
    lruSet(m, 'a', 1, 3);                                   // touch a: b is now oldest
    expect(lruSet(m, 'd', 4, 3)).toEqual(['b']);
    expect([...m.keys()]).toEqual(['c', 'a', 'd']);
    expect(lruSet(m, 'e', 5, 1)).toEqual(['c', 'a', 'd']);  // shrinking evicts several
    expect([...m.keys()]).toEqual(['e']);
  });
});

describe('wiring (comments stripped)', () => {
  const read = p => stripJs(fs.readFileSync(path.join(ROOT, p), 'utf8'));
  it('the 3D floors are an opaque unlit mesh from the baked colours, and the dots skip the depth test', () => {
    const src = read('web/app/spectator/replay/Replay3D.tsx');
    expect(src).toMatch(/floorVertexColors\(fs\)/);
    expect(src).toMatch(/new MeshBasicMaterial\(\{ vertexColors: true, side: DoubleSide \}\)/);
    expect(src).not.toMatch(/opacity: floor/);
    expect((src.match(/depthTest: false/g) || []).length).toBe(4);
  });
  it('the replay board draws the paper and floor wash only for parchment, and no lines for none', () => {
    const src = read('web/app/spectator/replay/ReplayBoard.tsx');
    expect(src).toMatch(/const ink = o\.bg === 'parchment'/);
    expect(src).toMatch(/entry\?\.status === 'ready' && o\.bg !== 'none'/);
    expect(src).toMatch(/bg: bgRef\.current/);
  });
});
