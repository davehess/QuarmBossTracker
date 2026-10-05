// test/zone-map-slice.test.js — the spectator map's wall slicer (web/lib/zoneMap/slice.ts) and the
// zone-name guard in front of the GitHub fetch (web/lib/zoneMap/source.ts).
//
// Real-imports both libs and runs them on a tiny V2 mesh built here: a box room (floor + four
// walls) with a second, smaller floor 60 units up that carries one wall of its own, plus the
// pieces the slicer must throw away. Nothing reads a real EQEmu file, so the test stays fast and
// does not depend on a download. (The ported thresholds were also compared against the Python
// reference on real meshes by hand; that comparison is in the PR notes, not here.)

import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { parseEqemuMap, sliceZoneMap } from '../web/lib/zoneMap/slice.ts';
import { eqemuMapUrl, isZoneShort } from '../web/lib/zoneMap/source.ts';

// ---- synthetic mesh -------------------------------------------------------------------------
// Triangles are pushed unshared (three vertices each); the slicer does not weld, so neither need we.

function mesh() {
  const verts = [];
  const idx = [];
  const tri = (a, b, c) => {
    for (const p of [a, b, c]) { idx.push(verts.length / 3); verts.push(...p); }
  };
  // Floors in this format wind clockwise seen from above, so their normal.z is negative.
  const floor = (x0, y0, x1, y1, z) => {
    tri([x0, y0, z], [x0, y1, z], [x1, y1, z]);
    tri([x0, y0, z], [x1, y1, z], [x1, y0, z]);
  };
  // A vertical wall rectangle from (x0,y0) to (x1,y1), z0..z1, as two triangles.
  const wall = (x0, y0, x1, y1, z0, z1) => {
    tri([x0, y0, z0], [x1, y1, z0], [x0, y0, z1]);
    tri([x1, y1, z0], [x1, y1, z1], [x0, y0, z1]);
  };
  return { verts, idx, tri, floor, wall };
}

// V2 file: u32 magic, u32 compressed size, u32 inflated size, zlib block. The block opens with
// 40 header bytes (the first two u32 are vertex count and index count), then vertices, then indices.
function encodeV2({ verts, idx }) {
  const inner = Buffer.alloc(40 + verts.length * 4 + idx.length * 4);
  inner.writeUInt32LE(verts.length / 3, 0);
  inner.writeUInt32LE(idx.length, 4);
  verts.forEach((v, i) => inner.writeFloatLE(v, 40 + i * 4));
  idx.forEach((v, i) => inner.writeUInt32LE(v, 40 + verts.length * 4 + i * 4));
  const z = zlib.deflateSync(inner);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x02000000, 0);
  head.writeUInt32LE(z.length, 4);
  head.writeUInt32LE(inner.length, 8);
  return Buffer.concat([head, z]);
}

function buildRoom() {
  const m = mesh();
  m.floor(0, 0, 200, 200, 0);        // ground floor, 40000 units^2
  m.floor(0, 0, 100, 100, 60);       // upper floor, a quarter of that: well over the 5% band threshold

  // Four room walls, 20 tall. The north wall is built from two adjacent pieces, the east wall from
  // two stacked ones: both must still come out as ONE line (collinear merge, band-agnostic).
  m.wall(0, 0, 200, 0, 0, 20);                    // south
  m.wall(0, 200, 100, 200, 0, 20);                // north, west half
  m.wall(100, 200, 200, 200, 0, 20);              // north, east half
  m.wall(0, 0, 0, 200, 0, 20);                    // west
  m.wall(200, 0, 200, 200, 0, 10);                // east, lower half
  m.wall(200, 0, 200, 200, 10, 20);               // east, upper half

  // One wall standing on the upper floor, away from every room wall's line.
  m.wall(20, 100, 100, 100, 60, 80);

  // Things that must NOT survive:
  m.wall(20, 150, 180, 150, 0, 3);                // a long curb: under 5 units tall
  m.wall(10, 50, 15, 50, 0, 20);                  // 5 long: passes the per-triangle floor, dies at the merged minimum
  // A ramp: tall enough and long enough to be a wall if it were steep, but its normal is 45 degrees
  // up, which is a slope you can walk, not a wall. (Wound so its normal points UP, so it is not a floor either.)
  m.tri([20, 170, 0], [120, 170, 0], [20, 200, 30]);
  // A chain of 2-long pieces: each dies at the per-triangle minimum. Were they kept, they would
  // join into one 60-long line, so this (unlike a lone 2-long piece) fails if that minimum goes.
  for (let x = 30; x < 90; x += 2) m.wall(x, 60, x + 2, 60, 0, 20);
  return m;
}

// Endpoint-order independent view of a segment, for comparing against what we drew by hand.
const norm = ([x1, y1, x2, y2, band]) => {
  const a = [x1, y1], b = [x2, y2];
  const [p, q] = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? [a, b] : [b, a];
  return [...p, ...q, band];
};
const sorted = (segs) => segs.map(norm).sort((s, t) => s[0] - t[0] || s[1] - t[1] || s[2] - t[2] || s[3] - t[3]);

// ---- parse ----------------------------------------------------------------------------------

describe('parseEqemuMap', () => {
  it('reads vertex and index counts back out of a V2 file', () => {
    const m = buildRoom();
    const { V, I } = parseEqemuMap(encodeV2(m));
    expect(V).toBeInstanceOf(Float32Array);
    expect(I).toBeInstanceOf(Uint32Array);
    expect(V.length).toBe(m.verts.length);
    expect(I.length).toBe(m.idx.length);
    expect(Array.from(V.slice(0, 6))).toEqual(m.verts.slice(0, 6));
    expect(Array.from(I.slice(0, 3))).toEqual([0, 1, 2]);
  });

  it('refuses a file that is not V2', () => {
    const bad = encodeV2(buildRoom());
    bad.writeUInt32LE(0x01000000, 0);
    expect(() => parseEqemuMap(bad)).toThrow(/V2/);
  });

  it('refuses a truncated file instead of reading past the end', () => {
    const good = encodeV2(buildRoom());
    expect(() => parseEqemuMap(good.subarray(0, 20))).toThrow();
  });

  it('refuses an index that points past the vertex list', () => {
    const m = buildRoom();
    m.idx[0] = m.verts.length;          // far past the last vertex
    expect(() => parseEqemuMap(encodeV2(m))).toThrow(/index/);
  });
});

// ---- slice ----------------------------------------------------------------------------------

describe('sliceZoneMap', () => {
  const { V, I } = parseEqemuMap(encodeV2(buildRoom()));
  const out = sliceZoneMap(V, I);

  it('finds one band per floor, low to high', () => {
    // Ground floor lands in the first 4-unit bin (centre 2); the upper floor at z=60 closes the last (centre 58).
    expect(out.bands).toEqual([2, 58]);
  });

  it('draws the four room walls and the upper wall, each as one merged line', () => {
    expect(sorted(out.segs)).toEqual(sorted([
      [0, 0, 200, 0, 0],        // south
      [0, 200, 200, 200, 0],    // north: two adjacent pieces merged
      [0, 0, 0, 200, 0],        // west
      [200, 0, 200, 200, 0],    // east: two stacked pieces merged
      [20, 100, 100, 100, 1],   // stands on the upper floor
    ]));
  });

  it('gives each wall the band its foot stands on', () => {
    const byBand = (b) => out.segs.filter(s => s[4] === b).length;
    expect(byBand(0)).toBe(4);
    expect(byBand(1)).toBe(1);
  });

  it('bounds what is drawn, in whole units', () => {
    expect(out.bounds).toEqual({ minX: 0, maxX: 200, minY: 0, maxY: 200 });
    for (const s of out.segs) for (const v of s) expect(Number.isInteger(v)).toBe(true);
  });

  it('drops the curb, the 5-unit piece, the chain of 2-unit pieces and the ramp', () => {
    // Anything at y=150, y=50 or y=60 would be one of the first three throwaways, and a ramp edge
    // would be a diagonal; the room walls and the upper wall (y=100) are the only lines left.
    expect(out.segs.some(([, y1, , y2]) => [150, 50, 60].includes(y1) || [150, 50, 60].includes(y2))).toBe(false);
    expect(out.segs.length).toBe(5);
  });

  it('handles a zone with no walkable floor without failing', () => {
    const m = mesh();
    m.wall(0, 0, 100, 0, 0, 20);
    const r = sliceZoneMap(new Float32Array(m.verts), new Uint32Array(m.idx));
    expect(r.segs).toEqual([[0, 0, 100, 0, 0]]);
    expect(r.bands).toEqual([1]);
  });

  it('handles an empty mesh', () => {
    const r = sliceZoneMap(new Float32Array(0), new Uint32Array(0));
    expect(r).toEqual({ bands: [], segs: [], bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } });
  });
});

// ---- zone name guard ------------------------------------------------------------------------

describe('isZoneShort / eqemuMapUrl', () => {
  it('accepts EQEmu short names', () => {
    for (const z of ['vexthal', 'poinnovation', 'gfaydark', 'qeynos2', 'a_b', 'ab']) {
      expect(isZoneShort(z)).toBe(true);
    }
  });

  it('rejects anything that could change the URL it is dropped into', () => {
    const bad = ['', 'a', 'x'.repeat(33), 'Vexthal', '../etc/passwd', 'a/b', 'a.b', 'a-b', 'a b',
      'vexthal?x=1', 'vexthal#', 'vexthal\n', '%2e%2e', null, undefined, 42, ['vexthal']];
    for (const z of bad) expect(isZoneShort(z)).toBe(false);
  });

  it('builds the raw GitHub URL on the master branch, and refuses to build one from a bad name', () => {
    expect(eqemuMapUrl('vexthal')).toBe('https://raw.githubusercontent.com/EQEmu/maps/master/base/vexthal.map');
    expect(() => eqemuMapUrl('../x')).toThrow();
  });
});
