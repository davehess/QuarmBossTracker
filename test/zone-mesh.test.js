// test/zone-mesh.test.js — the packed wall mesh behind the 3D replay (web/lib/zoneMesh.ts) and the route
// that serves it.
//
// The risk this pins is an AXIS one: a mirrored or swapped mesh still draws a plausible zone, and raiders
// would then stand on the wrong side of every wall. So the axis tests run the REAL chain on a synthetic room:
// V2 file -> parseEqemuMap -> sliceZoneMap (what the 2D board draws) and -> packMesh -> unpackMesh ->
// positionsToThree (what the 3D view draws), and require the two to agree about which side of a wall a raider
// is on. The raider is placed the way the replay places one: raid_roster (loc_x, loc_y) through serverXY.
//
// The cap tests use a corpus LARGER than the cap and check WHICH triangles survive, and that the same corpus
// uncapped keeps them all, so a cap that was never applied cannot pass.
//
// Run: npx vitest run test/zone-mesh.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseEqemuMap, sliceZoneMap } from '../web/lib/zoneMap/slice.ts';
import {
  packMesh, unpackMesh, positionsToThree, serverToThree, heightHue,
  HEADER_BYTES, BYTES_PER_TRI, DEFAULT_TRI_CAP, MIN_TRI_AREA, MESH_MAGIC,
} from '../web/lib/zoneMesh.ts';
import { serverXY, toScreen } from '../web/lib/spectator.ts';
import { stripJs, ROOT } from './_source-slice.js';

// ---- synthetic mesh (same V2 layout the slice test builds) -------------------------------------

function mesh() {
  const verts = [];
  const idx = [];
  const tri = (a, b, c) => {
    for (const p of [a, b, c]) { idx.push(verts.length / 3); verts.push(...p); }
  };
  // Floors in this format wind clockwise seen from above (normal.z negative); a floor is dropped either way.
  const floor = (x0, y0, x1, y1, z) => {
    tri([x0, y0, z], [x0, y1, z], [x1, y1, z]);
    tri([x0, y0, z], [x1, y1, z], [x1, y0, z]);
  };
  const wall = (x0, y0, x1, y1, z0, z1) => {
    tri([x0, y0, z0], [x1, y1, z0], [x0, y0, z1]);
    tri([x1, y1, z0], [x1, y1, z1], [x0, y0, z1]);
  };
  return { verts, idx, tri, floor, wall };
}

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

// A 200 x 200 room, deliberately NOT symmetric about the origin so a flipped axis cannot hide: the walls
// are at server x = 0 and 200, y = 0 and 200. Walls are 20 tall and, being 200 long, well over every threshold.
function room() {
  const m = mesh();
  m.floor(0, 0, 200, 200, 0);
  m.wall(0, 0, 200, 0, 0, 20);        // y = 0
  m.wall(0, 200, 200, 200, 0, 20);    // y = 200 (the "north" wall in the server frame)
  m.wall(0, 0, 0, 200, 0, 20);        // x = 0
  m.wall(200, 0, 200, 200, 0, 20);    // x = 200
  return m;
}

// ---- the packed format ---------------------------------------------------------------------

describe('pack / unpack', () => {
  it('writes the header and 18 bytes a triangle, and reads back within one quantisation step', () => {
    const m = room();
    const { V, I } = parseEqemuMap(encodeV2(m));
    const { buf, stats } = packMesh(V, I, { floors: true });
    expect(stats.packed).toBe(10);      // 2 floor + 8 wall triangles
    expect(buf.byteLength).toBe(HEADER_BYTES + BYTES_PER_TRI * 10);
    expect(new DataView(buf).getUint32(0, true)).toBe(MESH_MAGIC);
    const u = unpackMesh(buf);
    expect(u.tris).toBe(10);
    expect(u.floors).toBe(true);
    // The span is 200 x 200 x 20, so a step is span / 65534 (~0.003): every wall corner comes back within it.
    const corners = new Set();
    for (let i = 0; i < u.pos.length; i += 3) corners.add(`${Math.round(u.pos[i])},${Math.round(u.pos[i + 1])},${Math.round(u.pos[i + 2])}`);
    for (const c of ['0,0,0', '200,0,0', '0,200,0', '200,200,0', '0,0,20', '200,200,20']) expect(corners.has(c)).toBe(true);
    for (let i = 0; i < u.pos.length; i += 3) {
      expect(Math.abs(u.pos[i] - Math.round(u.pos[i]))).toBeLessThan(0.01);
      expect(Math.abs(u.pos[i + 1] - Math.round(u.pos[i + 1]))).toBeLessThan(0.01);
    }
  });

  it('keeps a big zone to a fraction of a unit: a 40,000-unit span still quantises under half a unit', () => {
    const m = mesh();
    m.wall(-20000, -20000, 20000, -20000, -500, 900);
    m.wall(20000, 20000, -20000, 20000, -500, 900);
    const { V, I } = parseEqemuMap(encodeV2(m));
    const u = unpackMesh(packMesh(V, I).buf);
    expect(u.tris).toBe(4);
    for (let i = 0; i < u.pos.length; i++) {
      const k = i % 3;
      const nearest = k === 2 ? [-500, 900] : [-20000, 20000];
      expect(Math.min(...nearest.map(n => Math.abs(u.pos[i] - n)))).toBeLessThan(0.5);
    }
  });

  it('drops floors unless asked, and always drops slivers and non-finite triangles', () => {
    const m = room();
    m.wall(0, 0, 1, 0, 0, 1);                          // area 0.5: a sliver
    m.tri([NaN, 0, 0], [50, 0, 0], [0, 0, 50]);        // not a place
    m.tri([5, 5, 0], [5, 5, 0], [5, 5, 0]);            // degenerate
    const { V, I } = parseEqemuMap(encodeV2(m));
    expect(packMesh(V, I).stats.packed).toBe(8);
    expect(packMesh(V, I, { floors: true }).stats.packed).toBe(10);
    expect(MIN_TRI_AREA).toBeGreaterThan(0.5);
  });

  it('floorsOnly is the opposite filter: the near-horizontal triangles and nothing else, flagged as such', () => {
    const m = room();
    m.floor(300, 300, 400, 400, 5);                    // a second floor, 2 more triangles
    const { V, I } = parseEqemuMap(encodeV2(m));
    const walls = packMesh(V, I);
    const only = packMesh(V, I, { floorsOnly: true });
    expect(only.stats.packed).toBe(4);                 // the floors, not the 8 wall triangles
    expect(walls.stats.packed).toBe(8);
    const u = unpackMesh(only.buf);
    expect(u.floorsOnly).toBe(true);
    expect(u.floors).toBe(true);
    expect(unpackMesh(walls.buf).floorsOnly).toBe(false);
    // Every triangle that came back lies flat: its three z values are equal.
    for (let t = 0; t < u.tris; t++) {
      const z = [2, 5, 8].map(k => u.pos[9 * t + k]);
      expect(Math.abs(z[0] - z[1]) + Math.abs(z[1] - z[2])).toBeLessThan(0.01);
    }
  });

  it('floorsOnly has its own, smaller cap, and the walls request is untouched by it', () => {
    const m = mesh();
    for (let i = 0; i < 30; i++) m.floor(i * 100, 0, i * 100 + 10 + i, 10 + i, 0);   // 60 floor triangles, growing
    m.wall(0, 0, 50, 0, 0, 20);
    const { V, I } = parseEqemuMap(encodeV2(m));
    expect(packMesh(V, I, { floorsOnly: true, cap: 10 }).stats.packed).toBe(10);
    expect(packMesh(V, I, { floorsOnly: true }).stats.packed).toBe(60);
    expect(packMesh(V, I).stats.packed).toBe(2);       // walls only, whatever the floors did
  });

  it('an empty mesh is a valid zero-triangle buffer', () => {
    const u = unpackMesh(packMesh(new Float32Array(0), new Uint32Array(0)).buf);
    expect(u.tris).toBe(0);
    expect(u.pos.length).toBe(0);
  });

  it('refuses a buffer that is not one of ours', () => {
    expect(() => unpackMesh(new ArrayBuffer(8))).toThrow();
    const bad = new ArrayBuffer(HEADER_BYTES);
    expect(() => unpackMesh(bad)).toThrow(/not a zone mesh/);
    const ok = packMesh(...(() => { const { V, I } = parseEqemuMap(encodeV2(room())); return [V, I]; })()).buf;
    expect(() => unpackMesh(ok.slice(0, ok.byteLength - 2))).toThrow(/length/);
  });
});

// ---- the cap -------------------------------------------------------------------------------

describe('triangle cap', () => {
  // 500 walls, wall i is (10 + i) long and 20 tall, so area grows with i and every one is a distinct size.
  function ladder(n) {
    const m = mesh();
    for (let i = 0; i < n; i++) m.tri([0, i * 3, 0], [10 + i, i * 3, 0], [0, i * 3, 20]);
    return m;
  }
  const spans = (u) => {
    const out = [];
    for (let t = 0; t < u.tris; t++) {
      const xs = [0, 1, 2].map(c => u.pos[9 * t + 3 * c]);
      out.push(Math.round(Math.max(...xs) - Math.min(...xs)));
    }
    return out;
  };

  it('keeps exactly the cap, and they are the largest', () => {
    const { V, I } = parseEqemuMap(encodeV2(ladder(500)));
    const all = packMesh(V, I, { cap: 1e9 });
    expect(all.stats.packed).toBe(500);                      // the corpus really is bigger than the cap
    const capped = packMesh(V, I, { cap: 100 });
    expect(capped.stats.kept).toBe(500);
    expect(capped.stats.packed).toBe(100);
    expect(capped.buf.byteLength).toBe(HEADER_BYTES + BYTES_PER_TRI * 100);
    const s = spans(unpackMesh(capped.buf));
    expect(Math.min(...s)).toBe(10 + 400);                   // wall 400 is the 100th largest
    expect(Math.max(...s)).toBe(10 + 499);
  });

  it('a tie at the cut line does not overshoot the cap', () => {
    const m = mesh();
    for (let i = 0; i < 300; i++) m.tri([0, i * 3, 0], [50, i * 3, 0], [0, i * 3, 20]);   // 300 equal areas
    const { V, I } = parseEqemuMap(encodeV2(m));
    expect(packMesh(V, I, { cap: 1e9 }).stats.packed).toBe(300);
    expect(packMesh(V, I, { cap: 100 }).stats.packed).toBe(100);
  });

  it('the default cap keeps a wire answer under ~2 MB', () => {
    expect(HEADER_BYTES + BYTES_PER_TRI * DEFAULT_TRI_CAP).toBeLessThan(2 * 1024 * 1024);
    const { V, I } = parseEqemuMap(encodeV2(ladder(DEFAULT_TRI_CAP + 50)));
    expect(packMesh(V, I).stats.packed).toBe(DEFAULT_TRI_CAP);
  });
});

// ---- axes ----------------------------------------------------------------------------------

describe('axis consistency with the 2D slice', () => {
  const m = room();
  const file = encodeV2(m);
  const { V, I } = parseEqemuMap(file);
  const slice = sliceZoneMap(V, I);
  const u = unpackMesh(packMesh(V, I).buf);
  const three = positionsToThree(u.pos);

  // A raider as the replay holds them: raid_roster stores (loc_x, loc_y) = server (y, x); serverXY puts
  // them in the server frame. This is the ONE place the swap happens, in both the 2D and the 3D board.
  const raiderAt = (locX, locY, z = 5) => ({ ...serverXY(locX, locY), z });

  it('the sliced segments and the packed wall corners are in the same frame', () => {
    expect(slice.segs.length).toBe(4);
    // Every end of every 2D wall line is a vertex of the packed mesh, to within a unit.
    for (const [x1, y1, x2, y2] of slice.segs) {
      for (const [ex, ey] of [[x1, y1], [x2, y2]]) {
        let near = false;
        for (let i = 0; i < u.pos.length; i += 3) if (Math.hypot(u.pos[i] - ex, u.pos[i + 1] - ey) < 1) near = true;
        expect(near).toBe(true);
      }
    }
  });

  it('a raider inside the room is inside in both pictures, and one outside is outside in both', () => {
    // Inside: roster loc (x = 190, y = 100) is server (x = 100, y = 190): 10 units off the y = 200 wall.
    // Outside: roster loc (x = 210, y = 100) is server (x = 100, y = 210): past it.
    const inside = raiderAt(190, 100);
    const outside = raiderAt(210, 100);
    expect(inside).toMatchObject({ x: 100, y: 190 });

    // 2D: the north wall is the segment at server y = 200; its screen y is toScreen(.., 200).sy.
    const north = slice.segs.find(s => s[1] === 200 && s[3] === 200);
    expect(north).toBeTruthy();
    const wallSy = toScreen(0, 200).sy;
    const side2d = (r) => Math.sign(toScreen(r.x, r.y).sy - wallSy);

    // 3D: the same wall's vertices in the three.js frame sit at Z = -200; a raider's Z is serverToThree's.
    const wallZ = [];
    for (let i = 0; i < u.pos.length; i += 3) if (Math.abs(u.pos[i + 1] - 200) < 0.01) wallZ.push(three[i + 2]);
    expect(wallZ.length).toBeGreaterThan(0);
    for (const z of wallZ) expect(z).toBeCloseTo(-200, 1);
    const side3d = (r) => Math.sign(serverToThree(r.x, r.y, r.z)[2] - wallZ[0]);

    expect(side2d(inside)).toBe(side3d(inside));
    expect(side2d(outside)).toBe(side3d(outside));
    expect(side2d(inside)).not.toBe(side2d(outside));          // the two are on OPPOSITE sides, so the test can fail
  });

  it('the same holds across the x walls, so the swap is not hiding a flip', () => {
    // Roster loc_y = server x. A raider at roster (100, 190) is server x = 190 (inside the x = 200 wall);
    // at roster (100, 210) it is server x = 210 (outside).
    const inside = raiderAt(100, 190);
    const outside = raiderAt(100, 210);
    const wallSx = toScreen(200, 0).sx;
    const wallX = [];
    for (let i = 0; i < u.pos.length; i += 3) if (Math.abs(u.pos[i] - 200) < 0.01) wallX.push(three[i]);
    for (const x of wallX) expect(x).toBeCloseTo(-200, 1);
    for (const r of [inside, outside]) {
      expect(Math.sign(toScreen(r.x, r.y).sx - wallSx)).toBe(Math.sign(serverToThree(r.x, r.y, r.z)[0] - wallX[0]));
    }
    expect(Math.sign(toScreen(inside.x, 0).sx - wallSx)).not.toBe(Math.sign(toScreen(outside.x, 0).sx - wallSx));
  });

  it('top-down, the three.js frame is the 2D board: X = screen x, Z = screen y, Y = height', () => {
    for (const [x, y, z] of [[0, 0, 0], [123, -456, 7], [-2319, 2475, -996], [744, -2620, 2438]]) {
      const [X, Y, Z] = serverToThree(x, y, z);
      const { sx, sy } = toScreen(x, y);
      expect(X + 0).toBe(sx + 0);
      expect(Z + 0).toBe(sy + 0);
      expect(Y).toBe(z);
    }
  });

  it('positionsToThree agrees with serverToThree vertex by vertex', () => {
    for (let i = 0; i < u.pos.length; i += 3) {
      const [X, Y, Z] = serverToThree(u.pos[i], u.pos[i + 1], u.pos[i + 2]);
      expect([three[i], three[i + 1], three[i + 2]]).toEqual([X, Y, Z].map(Math.fround));
    }
  });
});

describe('height tint', () => {
  it('runs from the 2D board\'s cool low hue to its warm high one and clamps', () => {
    expect(heightHue(0)).toBe(215);
    expect(heightHue(1)).toBe(25);
    expect(heightHue(-3)).toBe(215);
    expect(heightHue(9)).toBe(25);
  });
});

// ---- the route -----------------------------------------------------------------------------

describe('GET /api/spectator/mesh', () => {
  const src = stripJs(fs.readFileSync(path.join(ROOT, 'web', 'app', 'api', 'spectator', 'mesh', 'route.ts'), 'utf8'));

  it('checks the session before it validates the zone or touches the network', () => {
    const auth = src.indexOf('auth.getUser()');
    expect(auth).toBeGreaterThan(-1);
    expect(src.indexOf("fail('sign in first', 401)")).toBeGreaterThan(auth);
    expect(src.indexOf('isZoneShort(zone)')).toBeGreaterThan(auth);
    expect(src.indexOf('fetchEqemuMesh(zone)')).toBeGreaterThan(src.indexOf('isZoneShort(zone)'));
  });

  it('is private for a day and reads and writes nothing in the database', () => {
    expect(src).toMatch(/private, max-age=86400/);
    expect(src).not.toMatch(/supabaseAdmin|\.from\(/);
  });
});
