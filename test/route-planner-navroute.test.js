// test/route-planner-navroute.test.js: "Walk route" on the route planner (web/lib/routePlanner/navroute.ts, navmesh.ts,
// navmeshServer.ts, view3d.ts, and the wiring that keeps it off the page everyone sees). No wasm and no network: the graph
// search runs on a FAKE walk function (a map of rooms), the navmesh bytes on a tile built here, and the route on a fake fetch.
//
// Run: npx vitest run test/route-planner-navroute.test.js

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, it, expect } from 'vitest';
import {
  makeRouter, routeLeg, bendHeights, bakeBends, completeWalk, jumpName, legSig, viaNames, END_GAP,
} from '../web/lib/routePlanner/navroute.ts';
import {
  NAV_MAGIC, readNavHeader, parseNavInner, slimTile, slimNav, expandSlim, toDetour, fromDetour,
} from '../web/lib/routePlanner/navmesh.ts';
import { fetchSlimNav, navmeshUrl, pickEncoding, encodeSlim } from '../web/lib/routePlanner/navmeshServer.ts';
import { buildView3D, floorLevels } from '../web/lib/routePlanner/view3d.ts';
import { keepHeights, legLength, planLegs, pruneLines, sanitize } from '../web/lib/routePlanner/plan.ts';
import { legBarText } from '../web/lib/routePlanner/legFocus.ts';
import { skeletonHtml } from '../web/app/raid/plan/routes/skeleton.ts';
import { emptyPlan } from '../web/lib/routePlanner/types.ts';
import { zoneData } from '../web/lib/routePlanner/zones/index.ts';
import { stripJs } from './_source-slice.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── a fake world: rooms on a line ────────────────────────────────────────────────────────────────
// A room is an x range at every y and z. Two points in one room walk to each other in a straight line (len x factor); two
// points in different rooms do not, which is exactly what a navmesh says about two separate walkable pieces.
const rooms = (...ranges) => (a, b, factor = 1) => {
  const room = p => ranges.findIndex(([lo, hi]) => p[0] >= lo && p[0] <= hi);
  const ra = room(a), rb = room(b);
  if (ra < 0 || ra !== rb) return { ok: false };
  return { ok: true, pts: [a, b], len: Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * factor };
};
const counted = fn => { const w = (a, b) => { w.calls++; return fn(a, b); }; w.calls = 0; return w; };
const tp = (label, from, to, extra = {}) => ({ kind: 'teleport', label, from, to, ...extra });

describe('the graph search', () => {
  const world = rooms([0, 100], [1000, 1100]);
  const pad = tp('Teleporter to the east: it jumps', [50, 0, 0], [1050, 0, 0]);

  it('walks straight when the ends are in one room and nothing is cheaper', () => {
    const r = routeLeg(makeRouter(world, [pad]), { a: [10, 0, 0], b: [90, 0, 0] });
    expect(r.segs).toHaveLength(1);
    expect(r.segs[0].kind).toBe('walk');
    expect(r.walkLen).toBeCloseTo(80);
    expect(r.jumps).toEqual([]);
  });

  it('crosses between rooms by the teleporter, and the jump is not walked length', () => {
    const r = routeLeg(makeRouter(world, [pad]), { a: [10, 0, 0], b: [1090, 0, 0] });
    expect(r.segs.map(s => s.kind)).toEqual(['walk', 'jump', 'walk']);
    expect(r.walkLen).toBeCloseTo(40 + 40);
    expect(viaNames(r)).toEqual(['Teleporter to the east']);
    expect(r.jumps[0]).toMatchObject({ via: 'teleport', from: [50, 0, 0], to: [1050, 0, 0] });
  });

  it('a teleporter goes one way only', () => {
    expect(routeLeg(makeRouter(world, [pad]), { a: [1090, 0, 0], b: [10, 0, 0] })).toBeNull();
  });

  it('takes the teleporter when it is cheaper than walking, and walks when it is not', () => {
    const slow = (a, b) => { const r = rooms([0, 2000])(a, b); return r.ok ? { ...r, len: r.len * 5 } : r; };   // bad ground: 5x the distance
    const links = [tp('Pad', [100, 0, 0], [1900, 0, 0])];
    const near = routeLeg(makeRouter(slow, links), { a: [0, 0, 0], b: [2000, 0, 0] });
    expect(near.jumps).toHaveLength(1);
    expect(near.walkLen).toBeCloseTo(5 * 100 + 5 * 100);
    const far = routeLeg(makeRouter(slow, [tp('Pad', [1500, 800, 0], [100, 800, 0])]), { a: [0, 0, 0], b: [400, 0, 0] });
    expect(far.jumps).toEqual([]);
    expect(far.walkLen).toBeCloseTo(5 * 400);
  });

  it('a flagged door is a way through like a teleporter; a locked door and a zone line are not', () => {
    const flag = { kind: 'flag', label: 'Flagged door: lava runes into the chamber, need all five wing flags', from: [50, 0, 0], to: [1050, 0, 0] };
    const r = routeLeg(makeRouter(world, [flag]), { a: [10, 0, 0], b: [1090, 0, 0] });
    expect(r.jumps[0].via).toBe('flag');
    expect(viaNames(r)).toEqual(['Flagged door lava runes into the chamber']);
    for (const kind of ['locked', 'zoneline']) {
      expect(routeLeg(makeRouter(world, [{ kind, label: 'x', from: [50, 0, 0], to: kind === 'locked' ? [1050, 0, 0] : null }]), { a: [10, 0, 0], b: [1090, 0, 0] })).toBeNull();
    }
  });

  it('a path the mesh only half finds is no path (the loader turns a partial path into ok:false, so the search never uses it)', () => {
    const half = completeWalk([[0, 0, 0], [40, 0, 0]], [100, 0, 0]);      // ended 60 short of where it was asked to go
    expect(half).toEqual({ ok: false });
    const whole = completeWalk([[0, 0, 0], [3, 4, 0], [100, 0, 0]], [100 + END_GAP - 0.5, 0, 0]);
    expect(whole.ok).toBe(true);
    expect(whole.len).toBeCloseTo(5 + Math.hypot(97, 4));
    expect(completeWalk([], [0, 0, 0])).toEqual({ ok: false });
    expect(routeLeg(makeRouter(() => half, []), { a: [0, 0, 0], b: [100, 0, 0] })).toBeNull();
  });

  it('is null when no walk, jump or step joins the ends', () => {
    expect(routeLeg(makeRouter(world, []), { a: [10, 0, 0], b: [1090, 0, 0] })).toBeNull();
    expect(routeLeg(makeRouter(world, [pad]), { a: [10, 0, 0], b: [5000, 0, 0] })).toBeNull();   // off the mesh entirely
  });

  it('a step bridge joins two rooms both ways, is walked length, and is counted', () => {
    const step = { kind: 'step', label: 'gap', from: [100, 0, 0], to: [1000, 0, 6] };
    const there = routeLeg(makeRouter(world, [step]), { a: [90, 0, 0], b: [1010, 0, 0] });
    const back = routeLeg(makeRouter(world, [step]), { a: [1010, 0, 0], b: [90, 0, 0] });
    for (const r of [there, back]) {
      expect(r.steps).toBe(1);
      expect(r.jumps).toEqual([]);
      expect(r.segs).toHaveLength(1);                                  // the walks and the step are one line
      expect(r.walkLen).toBeCloseTo(10 + Math.hypot(900, 6) + Math.hypot(10, 6));   // the walk, the step (3D), the walk
    }
    expect(there.segs[0].pts.some(p => p[0] === 100) && there.segs[0].pts.some(p => p[0] === 1000)).toBe(true);
  });

  it('makes no query for a far teleporter when the walk it already has is shorter than getting there', () => {
    const w = counted(rooms([-100000, 100000]));
    const links = Array.from({ length: 12 }, (_, i) => tp('Far pad ' + i, [5000 + i * 100, 0, 0], [-5000 - i * 100, 0, 0]));
    const router = makeRouter(w, links);
    const r = routeLeg(router, { a: [0, 0, 0], b: [200, 0, 0] });
    expect(r.jumps).toEqual([]);
    expect(w.calls).toBe(1);                                           // the direct walk, and nothing else
  });

  it('remembers a walk: the same leg again costs no queries', () => {
    const w = counted(world);
    const router = makeRouter(w, [pad]);
    routeLeg(router, { a: [10, 0, 0], b: [1090, 0, 0] });
    const n = w.calls;
    expect(n).toBeGreaterThan(1);
    routeLeg(router, { a: [10, 0, 0], b: [1090, 0, 0] });
    expect(w.calls).toBe(n);
    expect(router.queries()).toBe(n);
  });

  it('goes through the bend points in order', () => {
    const r = routeLeg(makeRouter(rooms([0, 1000]), []), { a: [0, 0, 0], b: [900, 0, 0], bends: [[300, 200], [600, -200]] });
    const xs = r.segs[0].pts.map(p => p[0]);
    expect(xs).toEqual([0, 300, 600, 900]);
    expect(r.segs[0].pts.map(p => p[1])).toEqual([0, 200, -200, 0]);
    expect(r.ignoredBends).toBe(false);
    expect(r.walkLen).toBeCloseTo(Math.hypot(300, 200) + Math.hypot(300, 400) + Math.hypot(300, 200));
  });

  it('a bend that cannot be walked to is left out, and the route says so', () => {
    const r = routeLeg(makeRouter(rooms([0, 1000]), []), { a: [0, 0, 0], b: [900, 0, 0], bends: [[5000, 0]] });
    expect(r.ignoredBends).toBe(true);
    expect(r.segs[0].pts.map(p => p[0])).toEqual([0, 900]);
    expect(routeLeg(makeRouter(rooms([0, 100]), []), { a: [0, 0, 0], b: [900, 0, 0], bends: [[50, 0]] })).toBeNull();   // no route even without them
  });

  it('a leg set to go via a teleporter goes through it, even when walking is shorter', () => {
    const w = rooms([-100000, 100000]);
    const jump = { from: [100, 0, 0], to: [-900, 0, 0], label: 'Pad backwards: x' };
    const r = routeLeg(makeRouter(w, [tp(jump.label, jump.from, jump.to)]), { a: [0, 0, 0], b: [200, 0, 0], jump });
    expect(r.segs.map(s => s.kind)).toEqual(['walk', 'jump', 'walk']);
    expect(r.walkLen).toBeCloseTo(100 + 1100);
  });

  it('ends on the pins themselves, not on the nearest part of the mesh', () => {
    const snapped = (a, b) => ({ ok: true, pts: [[a[0] + 3, a[1], a[2]], [b[0] - 3, b[1], b[2]]], len: 10 });
    const r = routeLeg(makeRouter(snapped, []), { a: [0, 0, 0], b: [100, 0, 0] });
    expect(r.segs[0].pts[0]).toEqual([0, 0, 0]);
    expect(r.segs[0].pts[r.segs[0].pts.length - 1]).toEqual([100, 0, 0]);
  });
});

describe('bend heights and the cache key', () => {
  it('a bend takes the height it would have on the way between its neighbours', () => {
    const hs = bendHeights([0, 0, 0], [300, 0, 300], [[100, 0], [200, 0]]);
    expect(hs.map(p => p[2])).toEqual([100, 200]);
    expect(hs[0].slice(0, 2)).toEqual([100, 0]);
  });

  it('a bend on the end of a teleporter takes that end exactly, and the heights run from it', () => {
    const anchors = [[100, 0, 50], [900, 0, 400]];
    const hs = bendHeights([0, 0, 50], [1000, 0, 400], [[100.5, 0], [900, 0], [950, 0]], anchors);
    expect(hs[0]).toEqual([100, 0, 50]);
    expect(hs[1]).toEqual([900, 0, 400]);
    expect(hs[2][2]).toBeCloseTo(400);
  });

  it('a baked bend keeps its own height over the guess, and a route through baked bends uses them', () => {
    const hs = bendHeights([0, 0, 0], [300, 0, 300], [[100, 0], [200, 0]], [], [[100, 0, 7], [200, 0, 250]]);
    expect(hs.map(p => p[2])).toEqual([7, 250]);
    const seen = [];
    const spy = (a, b) => { seen.push([a, b]); return { ok: true, pts: [a, b], len: 1 }; };
    routeLeg(makeRouter(spy, []), { a: [0, 0, 0], b: [300, 0, 300], bends: [[100, 0], [200, 0]], known: [[100, 0, 7], [200, 0, 250]] });
    expect(seen.some(([, b]) => b[0] === 100 && b[2] === 7)).toBe(true);
    expect(seen.some(([, b]) => b[0] === 200 && b[2] === 250)).toBe(true);
  });

  it('the key changes with the pins, the bends and the teleporter, and not with anything else', () => {
    const base = { a: [0, 0, 0], b: [10, 0, 0], bends: [[5, 5]] };
    expect(legSig(base)).toBe(legSig({ ...base, bends: [[5, 5]] }));
    expect(legSig(base)).not.toBe(legSig({ ...base, bends: [[5, 6]] }));
    expect(legSig(base)).not.toBe(legSig({ ...base, b: [10, 0, 1] }));
    expect(legSig(base)).not.toBe(legSig({ ...base, jump: { from: [1, 1, 1], to: [2, 2, 2], label: 'x' } }));
  });

  it('names a jump by what comes before the colon', () => {
    expect(jumpName("Jiva's cauldron: teleports back to the teleporter hall")).toBe("Jiva's cauldron");
    expect(jumpName("Teleporter to Xuzl's wing")).toBe("Teleporter to Xuzl's wing");
    expect(jumpName('Flagged door: lava runes into the chamber, need all five wing flags')).toBe('Flagged door lava runes into the chamber');
  });
});

describe('baking a route into bend points', () => {
  const walk = pts => ({ kind: 'walk', pts });
  const route = segs => ({ segs, walkLen: 0, jumps: [], steps: 0, ignoredBends: false });

  it('a straight walk has no bends', () => {
    expect(bakeBends(route([walk([[0, 0, 0], [50, 0, 0], [100, 0, 0]])]))).toEqual([]);
  });

  it('keeps the corners, drops the points on the way, and leaves the pins out', () => {
    const r = route([walk([[0, 0, 0], [50, 0, 0], [100, 0, 0], [100, 50, 0], [100, 100, 0]])]);
    expect(bakeBends(r)).toEqual([[100, 0, 0]]);
  });

  it('never returns more than the cap, and keeps the shape in order', () => {
    const wave = Array.from({ length: 400 }, (_, i) => [i * 5, Math.sin(i / 7) * 120, 0]);
    const out = bakeBends(route([walk(wave)]), 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.length).toBeGreaterThan(10);
    for (let i = 1; i < out.length; i++) expect(out[i][0]).toBeGreaterThan(out[i - 1][0]);
  });

  it('keeps both ends of every jump, so routing through the bends lands on the same teleporter', () => {
    const wave = Array.from({ length: 200 }, (_, i) => [i * 5, Math.sin(i / 7) * 120, 0]);
    const r = route([walk(wave), { kind: 'jump', from: [1000, 3, 0], to: [-2000, 8, 100], label: 'x', via: 'teleport' }, walk([[-2000, 8, 100], [-1500, 9, 100], [-1000, 8, 100]])]);
    const out = bakeBends(r, 12);
    expect(out.length).toBeLessThanOrEqual(12);
    const i = out.findIndex(p => p[0] === 1000 && p[1] === 3);
    expect(i).toBeGreaterThan(-1);
    expect(out[i + 1]).toEqual([-2000, 8, 100]);
  });

  it('keeps the ends of a jump even where they sit on a straight line of the walk (nothing else would keep them)', () => {
    const r = route([walk([[0, 0, 0], [100, 0, 0], [200, 0, 0]]), { kind: 'jump', from: [200, 0, 0], to: [300, 0, 0], label: 'x', via: 'teleport' }, walk([[300, 0, 0], [400, 0, 0], [500, 0, 0]])]);
    expect(bakeBends(r, 40)).toEqual([[200, 0, 0], [300, 0, 0]]);
  });

  it('each bend comes with the height the route had there', () => {
    const r = route([walk([[0, 0, 0], [100, 0, 10], [100, 100, 55], [200, 100, 60]])]);
    expect(bakeBends(r)).toEqual([[100, 0, 10], [100, 100, 55]]);
  });

  it('rounds to a tenth', () => {
    expect(bakeBends(route([walk([[0, 0, 0], [10.04, 33.33, 0], [50, 0, 0]])]))).toEqual([[10, 33.3, 0]]);
  });
});

describe('the frame', () => {
  it('Detour is the server frame with y and z swapped, nothing negated', () => {
    expect(toDetour([-1, -2915, -766])).toEqual({ x: -1, y: -766, z: -2915 });
    expect(fromDetour({ x: -1, y: -766, z: -2915 })).toEqual([-1, -2915, -766]);
    const p = [123.5, -77.25, 40];
    expect(fromDetour(toDetour(p))).toEqual(p);
  });
});

// ── the navmesh bytes ────────────────────────────────────────────────────────────────────────────

const HEADER = 100;
/** A Detour v7 tile with one quad, one off-mesh polygon (two vertices), links, a detail mesh and one off-mesh connection. */
function makeTile({ bv = 0 } = {}) {
  const vc = 6, pc = 2, links = 5, dmc = 2, dvc = 3, dtc = 3, omc = 1;
  const size = HEADER + 12 * vc + 32 * pc + 12 * links + 12 * dmc + 12 * dvc + 4 * dtc + 16 * bv + 36 * omc;
  const b = new Uint8Array(size);
  const d = new DataView(b.buffer);
  d.setInt32(0, 0x444e4156, true); d.setInt32(4, 7, true); d.setInt32(8, 3, true); d.setInt32(12, 4, true);
  d.setInt32(24, pc, true); d.setInt32(28, vc, true); d.setInt32(32, links, true);
  d.setInt32(36, dmc, true); d.setInt32(40, dvc, true); d.setInt32(44, dtc, true); d.setInt32(48, bv, true); d.setInt32(52, omc, true);
  let o = HEADER;
  for (let i = 0; i < 12 * vc; i++) b[o + i] = 0xa0;                                   // vertices
  o += 12 * vc;
  b[o + 30] = 4; for (let i = 0; i < 30; i++) b[o + i] = 0xb0;                          // polygon 0: four vertices
  b[o + 32 + 30] = 2; for (let i = 0; i < 30; i++) b[o + 32 + i] = 0xb1;                // polygon 1: the off-mesh one, two
  o += 32 * pc;
  b.fill(0xee, o, o + 12 * links); o += 12 * links;                                     // links: rebuilt on load
  b.fill(0xdd, o, o + 12 * dmc + 12 * dvc + 4 * dtc); o += 12 * dmc + 12 * dvc + 4 * dtc;   // detail: regenerated on load
  b.fill(0xbb, o, o + 16 * bv); o += 16 * bv;
  b.fill(0xcc, o, o + 36 * omc);                                                        // the off-mesh connection
  return b;
}
function makeNavFile(tiles, { version = 2, magic = NAV_MAGIC } = {}) {
  const parts = [];
  const head = new Uint8Array(4 + 28); const hd = new DataView(head.buffer);
  hd.setUint32(0, tiles.length, true);
  [-10, -20, -30].forEach((v, i) => hd.setFloat32(4 + 4 * i, v, true));
  hd.setFloat32(16, 128, true); hd.setFloat32(20, 256, true); hd.setInt32(24, 4096, true); hd.setInt32(28, 1024, true);
  parts.push(head);
  tiles.forEach((t, i) => { const m = new Uint8Array(8); const md = new DataView(m.buffer); md.setUint32(0, 100 + i, true); md.setUint32(4, t.length, true); parts.push(m, t); });
  const inner = Buffer.concat(parts.map(p => Buffer.from(p)));
  const z = zlib.deflateSync(inner);
  const out = Buffer.alloc(21 + z.length);
  out.write(magic, 0, 'latin1'); out.writeUInt32LE(version, 9); out.writeUInt32LE(z.length, 13); out.writeUInt32LE(inner.length, 17);
  z.copy(out, 21);
  return { file: new Uint8Array(out), inner };
}
const inflate = file => { const h = readNavHeader(file); return zlib.inflateSync(file.subarray(h.offset, h.offset + h.dataSize)); };

describe('the navmesh file', () => {
  const { file } = makeNavFile([makeTile(), makeTile()]);
  const mesh = parseNavInner(inflate(file));

  it('reads the header, the params and the tiles', () => {
    expect(mesh.tiles).toHaveLength(2);
    expect(mesh.tiles.map(t => t.ref)).toEqual([100, 101]);
    expect(mesh.params).toMatchObject({ orig: [-10, -20, -30], tileWidth: 128, tileHeight: 256, maxTiles: 4096, maxPolys: 1024 });
    expect(mesh.tiles[0].data).toHaveLength(makeTile().length);
  });

  it('refuses what is not a Quarm navmesh', () => {
    expect(() => readNavHeader(makeNavFile([makeTile()], { magic: 'NOTANAVMESH'.slice(0, 9) }).file)).toThrow(/not a navmesh/);
    expect(() => readNavHeader(makeNavFile([makeTile()], { version: 3 }).file)).toThrow(/version 3/);
    expect(() => readNavHeader(file.subarray(0, 40))).toThrow(/truncated/);
    expect(() => readNavHeader(new Uint8Array(5))).toThrow(/short/);
    const inner = inflate(file);
    expect(() => parseNavInner(inner.subarray(0, inner.length - 50))).toThrow(/truncated/);
  });

  it('the slim tile keeps the vertices, polygons and off-mesh connection, and drops links, detail and the rest', () => {
    const t = mesh.tiles[0].data;
    const s = slimTile(100, t);
    expect(s).toHaveLength(16 + HEADER + 12 * 6 + 32 * 2 + 36);
    expect(s.includes(0xee)).toBe(false);
    expect(s.includes(0xdd)).toBe(false);
    expect(s.includes(0xa0)).toBe(true);
    expect(s.includes(0xb0) && s.includes(0xb1)).toBe(true);
    expect(s[s.length - 1]).toBe(0xcc);
    const d = new DataView(s.buffer, s.byteOffset, s.byteLength);
    expect(d.getUint32(0, true)).toBe(100);
    expect(d.getUint32(4, true)).toBe(s.length - 16);
    expect(d.getUint32(8, true)).toBe(5);                               // maxLinkCount survives: Detour needs room for its links
    expect([36, 40, 44].map(o => d.getInt32(16 + o, true))).toEqual([0, 0, 0]);
  });

  it('a polygon with fewer than two vertices is refused (a one-vertex polygon has no triangle fan to make)', () => {
    const t = makeTile();
    t[HEADER + 12 * 6 + 30] = 1;
    const slim = slimNav({ params: mesh.params, tiles: [{ ref: 1, data: t }] });
    expect(() => expandSlim(slim)).toThrow(/polygon/);
  });

  it('a tile with a BV tree is refused, not mis-sized', () => {
    expect(() => slimTile(1, makeTile({ bv: 2 }))).toThrow(/BV tree/);
  });

  it('a tile shorter than its header says is refused', () => {
    expect(() => slimTile(1, makeTile().subarray(0, 300))).toThrow(/shorter/);
  });

  it('expands to the layout Detour reads with no detail mesh: a triangle fan per polygon, zero links', () => {
    const e = expandSlim(slimNav(mesh));
    expect(e.params).toEqual(mesh.params);
    expect(e.tiles.map(t => t.ref)).toEqual([100, 101]);
    const t = e.tiles[0].data;
    const d = new DataView(t.buffer, t.byteOffset, t.byteLength);
    const vc = 6, pc = 2, links = 5, tris = 2;
    expect(t).toHaveLength(HEADER + 12 * vc + 32 * pc + 12 * links + 12 * pc + 4 * tris + 36);
    expect([36, 40, 44].map(o => d.getInt32(o, true))).toEqual([pc, 0, tris]);
    const links0 = HEADER + 12 * vc + 32 * pc;
    expect(t.subarray(links0, links0 + 12 * links).every(v => v === 0)).toBe(true);
    const dm = links0 + 12 * links;
    expect([d.getUint32(dm, true), d.getUint32(dm + 4, true), t[dm + 8], t[dm + 9]]).toEqual([0, 0, 0, 2]);              // the quad: two triangles from 0
    expect([d.getUint32(dm + 12, true), d.getUint32(dm + 16, true), t[dm + 20], t[dm + 21]]).toEqual([0, 2, 0, 0]);       // the off-mesh polygon: none
    const dt = dm + 12 * pc;
    expect(Array.from(t.subarray(dt, dt + 8))).toEqual([0, 1, 2, 4 | 1, 0, 2, 3, 4 | 16]);
    expect(t[t.length - 1]).toBe(0xcc);                                                    // the off-mesh connection came through
  });

  it('refuses a slim body that does not add up, so a half-sent mesh is a failed load and not a crashed wasm', () => {
    const slim = slimNav(mesh);
    expect(() => expandSlim(slim.subarray(0, slim.length - 7))).toThrow();
    expect(() => expandSlim(slim.subarray(0, 20))).toThrow(/short/);
    const bad = Uint8Array.from(slim);
    new DataView(bad.buffer).setUint32(0, 99999999, true);
    expect(() => expandSlim(bad)).toThrow(/tile count/);
  });
});

// ── the route ────────────────────────────────────────────────────────────────────────────────────

describe('the server half', () => {
  const { file } = makeNavFile([makeTile()]);
  const ok = body => async () => ({ status: 200, ok: true, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) });

  it('reads Quarm\'s file from EQMacEmu/Maps, at the repo root', () => {
    expect(navmeshUrl('solrotower')).toBe('https://raw.githubusercontent.com/EQMacEmu/Maps/master/solrotower.nav');
    expect(() => navmeshUrl('../etc/passwd')).toThrow(/bad zone/);
    expect(() => navmeshUrl('Solrotower')).toThrow(/bad zone/);
  });

  it('turns the file into the slim mesh, and says how big the source was', async () => {
    const got = await fetchSlimNav('potactics', ok(file));
    expect(got.source).toBe(file.length);
    expect(got.slim).toEqual(slimNav(parseNavInner(inflate(file))));
  });

  it('answers null for a zone Quarm has no navmesh for, and throws when it cannot find out', async () => {
    expect(await fetchSlimNav('hateplane', async () => ({ status: 404, ok: false }))).toBeNull();
    await expect(fetchSlimNav('hateplane', async () => ({ status: 503, ok: false }))).rejects.toThrow(/503/);
    await expect(fetchSlimNav('hateplane', ok(new Uint8Array(40)))).rejects.toThrow();
  });

  it('picks the encoding the browser can read, and the bytes decode back to the slim mesh', () => {
    expect(pickEncoding('gzip, deflate, br')).toBe('br');
    expect(pickEncoding('gzip')).toBe('gzip');
    expect(pickEncoding('br;q=0, gzip')).toBe('gzip');
    expect(pickEncoding(null)).toBe('identity');
    const slim = slimNav(parseNavInner(inflate(file)));
    expect(zlib.brotliDecompressSync(encodeSlim(slim, 'br'))).toEqual(Buffer.from(slim));
    expect(zlib.gunzipSync(encodeSlim(slim, 'gzip'))).toEqual(Buffer.from(slim));
    expect(encodeSlim(slim, 'identity')).toBe(slim);
  });

  const route = stripJs(read('web/app/api/raid/navmesh/route.ts'));
  it('the route checks the session before it validates the zone or touches the network', () => {
    const auth = route.indexOf('auth.getUser()');
    expect(auth).toBeGreaterThan(-1);
    expect(route.indexOf("fail('sign in first', 401)")).toBeGreaterThan(auth);
    expect(route.indexOf('isZoneShort(zone)')).toBeGreaterThan(auth);
    expect(route.indexOf('fetchSlimNav(zone)')).toBeGreaterThan(route.indexOf('isZoneShort(zone)'));
  });

  it('is private for a day, keeps a few zones in this process, and reads nothing in the database', () => {
    expect(route).toMatch(/private, max-age=86400/);
    expect(route).toMatch(/MEMO_MAX = 4/);
    expect(route).toMatch(/'Content-Encoding': enc/);
    expect(route).toMatch(/Vary: 'Accept-Encoding'/);
    expect(route).toMatch(/'X-Navmesh-Bytes'/);
    expect(route).not.toMatch(/supabaseAdmin|\.from\(/);
  });
});

// ── the planner around it ────────────────────────────────────────────────────────────────────────

const TOWER = zoneData('solrotower');
const pin = (id, x, y, z, extra = {}) => ({ id, label: id, kind: 'note', optional: false, x, y, z, ...extra });

describe('the data', () => {
  it('the Tower carries three step bridges, each a short gap between two heights, and Tactics none', () => {
    const steps = TOWER.links.filter(l => l.kind === 'step');
    expect(steps).toHaveLength(3);
    for (const s of steps) {
      expect(s.to).not.toBeNull();
      expect(Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1])).toBeLessThan(8.1);
      expect(Math.abs(s.to[2] - s.from[2])).toBeLessThanOrEqual(14);
      expect(s.label).toMatch(/not walked in game/);
    }
    expect(zoneData('potactics').links.filter(l => l.kind === 'step')).toHaveLength(0);
  });

  it('a step bridge is not a floor: the 3D levels are the same with and without them', () => {
    const without = { ...TOWER, links: TOWER.links.filter(l => l.kind !== 'step') };
    expect(floorLevels(TOWER)).toEqual(floorLevels(without));
  });
});

describe('a walked leg in the plan', () => {
  const a = pin('a', 0, 0, 0), b = pin('b', 300, 0, 0);
  const plan = { ...emptyPlan(), pins: [a, b] };
  const [leg] = planLegs(plan, false, []);

  it('is as long as it walks, a jump counting nothing; any other state keeps the drawn length', () => {
    expect(legLength(leg)).toBe(300);
    expect(legLength({ ...leg, walk: { state: 'ok', len: 812.4, via: [], steps: 0, ignoredBends: false } })).toBe(812.4);
    expect(legLength({ ...leg, walk: { state: 'none' } })).toBe(300);
    expect(legLength({ ...leg, walk: { state: 'pending' } })).toBe(300);
  });

  it('the One leg bar says where it goes through, or that there is no way', () => {
    const t = w => legBarText({ ...leg, walk: w }, 0, 1, null);
    expect(t(undefined)).toBe('Leg 1 of 1: a → b · 300 u');
    expect(t({ state: 'ok', len: 5792, via: ["Teleporter to Xuzl's wing"], steps: 0, ignoredBends: false })).toBe("Leg 1 of 1: a → b · 5,792 u · via Teleporter to Xuzl's wing");
    expect(t({ state: 'ok', len: 700, via: ['A', 'B'], steps: 0, ignoredBends: false })).toContain('via A, then B');
    expect(t({ state: 'none' })).toContain('no walkable route found');
    expect(t({ state: 'pending' })).toContain('finding the walking route');
  });
});

describe('the heights a baked leg keeps', () => {
  const base = () => ({
    ...emptyPlan(), pins: [pin('a', 0, 0, 0), pin('b', 300, 0, 0)],
    lines: [{ k: 'a>b', pts: [[100, 0], [200, 50]], off: false, h: [[100, 0, 12.34], [200, 50, 40], [999, 9, 9], [1, 2, NaN]] }],
  });

  it('are kept while the bend is where it was, rounded, and the rest is dropped', () => {
    const p = sanitize(base());
    expect(p.lines[0].h).toEqual([[100, 0, 12.3], [200, 50, 40]]);
  });

  it('a bend that was moved loses its height; with no bend left the heights go', () => {
    const l = { k: 'a>b', pts: [[100, 0], [201, 50]], off: false, h: [[100, 0, 1], [200, 50, 2]] };
    keepHeights(l);
    expect(l.h).toEqual([[100, 0, 1]]);
    l.pts = [];
    keepHeights(l);
    expect(l.h).toBeUndefined();
  });

  it('pruning a plan applies the same rule', () => {
    const p = base();
    p.lines[0].pts = [[100, 0]];
    pruneLines(p);
    expect(p.lines[0].h).toEqual([[100, 0, 12.34]]);
  });
});

describe('the 3D view with walk routes', () => {
  const zone = { ...TOWER };
  const a = pin('a', 0, -2915, -766), b = pin('b', 1835, -716, 327);
  const plan = { ...emptyPlan(), pins: [a, b] };
  const key = 'a>b';
  const routed = {
    segs: [
      { kind: 'walk', pts: [[0, -2915, -766], [100, -2000, -500], [1296, -642, -384]] },
      { kind: 'jump', from: [1296, -642, -384], to: [1932, -2480, 289], label: "Teleporter to Xuzl's wing", via: 'teleport' },
      { kind: 'walk', pts: [[1932, -2480, 289], [1835, -716, 327]] },
    ],
    walkLen: 100, jumps: [], steps: 0, ignoredBends: false,
  };
  it('draws the walked line at the heights it was walked at and an arc for the jump', () => {
    const v = buildView3D({ zone, plan, skipOptional: false, mode: 'mesh', routes: new Map([[key, routed]]) });
    const leg = v.legs[0];
    expect(leg.walks).toHaveLength(2);
    expect(leg.walks[0].map(p => p[2])).toEqual([-766, -500, -384]);
    expect(leg.arcs).toHaveLength(1);
    expect(leg.arc).toBe(leg.arcs[0]);
    expect(leg.arcs[0][0]).toEqual([1296, -642, -384]);
  });

  it('in the stacked view the walked line climbs through the floors\' slabs, and starts and ends on the pins\' slabs', () => {
    const v = buildView3D({ zone, plan, skipOptional: false, mode: 'stack', routes: new Map([[key, routed]]) });
    const hs = v.legs[0].walks[0].map(p => p[2]);
    expect(hs).not.toEqual([-766, -500, -384]);                        // not the real z: the slabs are spaced out
    expect(hs[1]).toBeGreaterThan(hs[0]);
    expect(hs[2]).toBeGreaterThan(hs[1]);
    expect(Math.abs(hs[0] - v.pins.find(p => p.id === 'a').h)).toBeLessThan(v.spacing * 0.1);   // near the pin's slab, not on a different floor's
  });

  it('a leg with no route is drawn as before, and the step bridges are not links in the view', () => {
    const v = buildView3D({ zone, plan, skipOptional: false, mode: 'mesh' });
    expect(v.legs[0].walks).toHaveLength(1);
    expect(v.legs[0].arcs).toEqual([]);
    expect(v.links.some(l => l.kind === 'step')).toBe(false);
    expect(v.links).toHaveLength(TOWER.links.filter(l => l.kind !== 'step').length);
    expect(v.links.map(l => l.i)).toEqual(TOWER.links.map((l, i) => (l.kind === 'step' ? -1 : i)).filter(i => i >= 0));
  });
});

describe('the page everyone sees is unchanged', () => {
  const z = zoneData('solrotower');
  it('the markup has the Walk route toggle only when the host offers the walkable map', () => {
    expect(skeletonHtml(z, false, false)).not.toMatch(/walkOn|walkNote|Walk route/);
    expect(skeletonHtml(z, false, true)).toMatch(/data-src="walk"/);      // Walk route is one of the route sources (Straight · Walk route · Recorded)
    expect(skeletonHtml(z, false, false)).not.toMatch(/data-src=/);
    expect(skeletonHtml(z, true, true)).toMatch(/id="walkNote"/);
  });

  it('the host always offers the walkable map, loaded lazily, with no ?v= gate', () => {
    const host = stripJs(read('web/app/raid/plan/routes/RoutePlanner.tsx'));
    expect(host).toMatch(/navRoute: \{ load:/);
    expect(host).not.toMatch(/props\.variant/);
    expect(stripJs(read('web/app/raid/plan/routes/page.tsx'))).not.toMatch(/searchParams\.v\b|variant/);
    expect(host).toMatch(/import\('@\/lib\/routePlanner\/navLoad'\)/);          // lazy: nothing of it is in the page's own chunk
    const engine = stripJs(read('web/app/raid/plan/routes/engine.ts'));
    expect(engine).toMatch(/const walkOn = \(\) => !!host\.navRoute && \(ui\.src === 'walk' \|\| ui\.src === 'rec'\);/);
    expect(engine).toMatch(/const recOn = \(\) => !!host\.recorded && ui\.src === 'rec';/);
    expect(host).toMatch(/legFocus: true,/);                                         // One leg is always available
    expect(host).toMatch(/recorded: true,/);                                         // so is the Recorded source
    const load = stripJs(read('web/lib/routePlanner/navLoad.ts'));
    expect(load).toMatch(/await import\('@recast-navigation\/core'\)|import\('@recast-navigation\/core'\)/);
    expect(load).not.toMatch(/^import .* from '@recast-navigation/m);          // never a top-level import
  });

  it('the navigation library is pinned exactly', () => {
    const pkg = JSON.parse(read('web/package.json'));
    expect(pkg.dependencies['@recast-navigation/core']).toBe('0.43.1');
    expect(pkg.dependencies['@recast-navigation/wasm']).toBe('0.43.1');
  });
});
