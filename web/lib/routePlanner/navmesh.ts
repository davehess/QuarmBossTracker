// Route planner: the walkable map (the server's own navmesh), as bytes. Pure: no zlib, no fetch, no wasm, so the root
// vitest suite real-imports it, the API route (which owns zlib) and the browser loader both use it.
//
// SOURCE. Quarm's navmeshes are the files the server's pathfinder loads (EQMacEmu/Maps, repo root, `<zone>.nav`). Layout:
//   9 bytes "EQNAVMESH", u32 version (2), u32 size of the zlib stream, u32 size once inflated, the zlib stream.
//   Inflated: u32 tile count, 28 bytes of Detour navmesh params, then per tile u32 tileRef, u32 size, a Detour v7 tile.
// Quarm's file differs from EQEmu's for the same zone (Plane of Tactics), so always read Quarm's.
//
// THE SLIM FORM (what the route sends the browser). A tile carries three things Detour can rebuild, which is most of its
// weight: the link table (rebuilt when the tile is added), the BV tree (these meshes have none, asserted below) and the
// detail mesh (only for ground height between polygon corners; route lines do not need it). The slim form drops them and
// the browser regenerates the same "no detail mesh" layout dtCreateNavMeshData itself writes: one fan of (nv - 2)
// triangles per polygon, over the polygon's own vertices. ⚠ Dropping the detail mesh WITHOUT regenerating that fan makes
// Detour read past the tile and crashes the WASM, so the expand step is not optional.
//   slim = u32 tiles, 28 bytes params, then per tile: u32 ref, u32 slim size, u32 maxLinkCount, u32 body size, the body
//   (header + vertices + polygons), then the off-mesh connections (36 bytes each).
// Frame: Detour is (x, y-up, z); the server is (x, y, z-up) = Detour (x, z, y). Nothing is negated.

export type NavParams = { orig: [number, number, number]; tileWidth: number; tileHeight: number; maxTiles: number; maxPolys: number };
export type NavTile = { ref: number; data: Uint8Array };
export type NavMeshData = { params: NavParams; tiles: NavTile[] };

export const NAV_MAGIC = 'EQNAVMESH';
const HEADER = 100;          // sizeof(dtMeshHeader)
const PARAMS_BYTES = 28;
/** Bigger than any Quarm zone's tiles by a wide margin: a corrupt count must not allocate its way to a crash. */
const MAX_TILES = 40000;

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** The part of the file before the zlib stream. Throws when it is not a v2 Quarm navmesh. */
export function readNavHeader(file: Uint8Array): { dataSize: number; bufferSize: number; offset: number } {
  if (file.length < 21) throw new Error('navmesh too short');
  for (let i = 0; i < NAV_MAGIC.length; i++) if (file[i] !== NAV_MAGIC.charCodeAt(i)) throw new Error('not a navmesh');
  const d = dv(file);
  if (d.getUint32(9, true) !== 2) throw new Error('navmesh version ' + d.getUint32(9, true));
  const dataSize = d.getUint32(13, true);
  if (21 + dataSize > file.length) throw new Error('navmesh truncated');
  return { dataSize, bufferSize: d.getUint32(17, true), offset: 21 };
}

/** The inflated payload: the tile count, the params, the tiles. */
export function parseNavInner(inner: Uint8Array): NavMeshData {
  const d = dv(inner);
  if (inner.length < 4 + PARAMS_BYTES) throw new Error('navmesh payload too short');
  const n = d.getUint32(0, true);
  if (n > MAX_TILES) throw new Error('navmesh tile count');
  const params: NavParams = {
    orig: [d.getFloat32(4, true), d.getFloat32(8, true), d.getFloat32(12, true)],
    tileWidth: d.getFloat32(16, true), tileHeight: d.getFloat32(20, true),
    maxTiles: d.getInt32(24, true), maxPolys: d.getInt32(28, true),
  };
  let o = 4 + PARAMS_BYTES;
  const tiles: NavTile[] = [];
  for (let i = 0; i < n; i++) {
    if (o + 8 > inner.length) throw new Error('navmesh tile table truncated');
    const ref = d.getUint32(o, true), size = d.getUint32(o + 4, true);
    o += 8;
    if (size < HEADER || o + size > inner.length) throw new Error('navmesh tile truncated');
    tiles.push({ ref, data: inner.subarray(o, o + size) });
    o += size;
  }
  return { params, tiles };
}

/** The counts a tile's header holds (Detour v7 dtMeshHeader). */
function tileCounts(t: Uint8Array) {
  const d = dv(t);
  return {
    polyCount: d.getInt32(24, true), vertCount: d.getInt32(28, true), maxLinkCount: d.getInt32(32, true),
    detailMeshCount: d.getInt32(36, true), detailVertCount: d.getInt32(40, true), detailTriCount: d.getInt32(44, true),
    bvNodeCount: d.getInt32(48, true), offMeshConCount: d.getInt32(52, true),
  };
}

/** One tile in slim form: [meta 16 bytes][body][off-mesh connections]. */
export function slimTile(ref: number, t: Uint8Array): Uint8Array {
  const c = tileCounts(t);
  if (c.bvNodeCount !== 0) throw new Error('navmesh tile has a BV tree; the slim form assumes none');
  if (c.polyCount < 0 || c.vertCount < 0 || c.maxLinkCount < 0 || c.offMeshConCount < 0) throw new Error('navmesh tile counts');
  const polysEnd = HEADER + 12 * c.vertCount + 32 * c.polyCount;
  const linksEnd = polysEnd + 12 * c.maxLinkCount;
  const detailEnd = linksEnd + 12 * c.detailMeshCount + 12 * c.detailVertCount + 4 * c.detailTriCount;
  const offBytes = 36 * c.offMeshConCount;
  if (detailEnd + offBytes > t.length) throw new Error('navmesh tile shorter than its header says');
  const out = new Uint8Array(16 + polysEnd + offBytes);
  const o = dv(out);
  o.setUint32(0, ref, true); o.setUint32(4, polysEnd + offBytes, true); o.setUint32(8, c.maxLinkCount, true); o.setUint32(12, polysEnd, true);
  out.set(t.subarray(0, polysEnd), 16);
  out.set(t.subarray(detailEnd, detailEnd + offBytes), 16 + polysEnd);
  // the stored header still counts the parts that are gone; the expand step rewrites those three, so zero them here too
  o.setInt32(16 + 36, 0, true); o.setInt32(16 + 40, 0, true); o.setInt32(16 + 44, 0, true);
  return out;
}

/** The whole mesh in slim form (uncompressed; the route compresses it for the wire). */
export function slimNav(m: NavMeshData): Uint8Array {
  const tiles = m.tiles.map(t => slimTile(t.ref, t.data));
  const total = 4 + PARAMS_BYTES + tiles.reduce((s, t) => s + t.length, 0);
  const out = new Uint8Array(total);
  const d = dv(out);
  d.setUint32(0, m.tiles.length, true);
  m.params.orig.forEach((v, i) => d.setFloat32(4 + 4 * i, v, true));
  d.setFloat32(16, m.params.tileWidth, true); d.setFloat32(20, m.params.tileHeight, true);
  d.setInt32(24, m.params.maxTiles, true); d.setInt32(28, m.params.maxPolys, true);
  let o = 4 + PARAMS_BYTES;
  for (const t of tiles) { out.set(t, o); o += t.length; }
  return out;
}

/**
 * The browser's half: a slim mesh back into full-size tiles Detour accepts (zero links, no detail verts, the triangle fan
 * per polygon). Throws on anything that does not add up, so a half-sent body is a failed load and never a crashed WASM.
 */
export function expandSlim(raw: Uint8Array): NavMeshData {
  if (raw.length < 4 + PARAMS_BYTES) throw new Error('slim navmesh too short');
  const d = dv(raw);
  const n = d.getUint32(0, true);
  if (n > MAX_TILES) throw new Error('slim navmesh tile count');
  const params: NavParams = {
    orig: [d.getFloat32(4, true), d.getFloat32(8, true), d.getFloat32(12, true)],
    tileWidth: d.getFloat32(16, true), tileHeight: d.getFloat32(20, true),
    maxTiles: d.getInt32(24, true), maxPolys: d.getInt32(28, true),
  };
  let o = 4 + PARAMS_BYTES;
  const tiles: NavTile[] = [];
  for (let i = 0; i < n; i++) {
    if (o + 16 > raw.length) throw new Error('slim navmesh truncated');
    const ref = d.getUint32(o, true), len = d.getUint32(o + 4, true), maxLink = d.getUint32(o + 8, true), bodyLen = d.getUint32(o + 12, true);
    o += 16;
    if (bodyLen < HEADER || bodyLen > len || o + len > raw.length) throw new Error('slim navmesh tile sizes');
    const body = raw.subarray(o, o + bodyLen), off = raw.subarray(o + bodyLen, o + len);
    o += len;
    const b = dv(body);
    const vc = b.getInt32(28, true), pc = b.getInt32(24, true), pOff = HEADER + 12 * vc;
    if (vc < 0 || pc < 0 || pOff + 32 * pc !== bodyLen) throw new Error('slim navmesh tile body');
    const nvs = new Uint8Array(pc);
    let tris = 0;
    for (let k = 0; k < pc; k++) { const nv = body[pOff + 32 * k + 30]; if (nv < 2) throw new Error('slim navmesh polygon'); nvs[k] = nv; tris += nv - 2; }
    const dmOff = bodyLen + 12 * maxLink, dtOff = dmOff + 12 * pc, omOff = dtOff + 4 * tris;
    const full = new Uint8Array(omOff + off.length);
    full.set(body, 0); full.set(off, omOff);
    const f = dv(full);
    f.setInt32(36, pc, true); f.setInt32(40, 0, true); f.setInt32(44, tris, true);
    let tb = 0;
    for (let k = 0; k < pc; k++) {
      const nv = nvs[k], m = dmOff + 12 * k;
      f.setUint32(m, 0, true); f.setUint32(m + 4, tb, true); full[m + 8] = 0; full[m + 9] = nv - 2;
      for (let j = 2; j < nv; j++) {
        const t = dtOff + 4 * (tb + j - 2);
        full[t] = 0; full[t + 1] = j - 1; full[t + 2] = j;
        let fl = 4;                       // the middle edge is internal to the fan, the outer two are the polygon's own
        if (j === 2) fl |= 1;
        if (j === nv - 1) fl |= 16;
        full[t + 3] = fl;
      }
      tb += nv - 2;
    }
    tiles.push({ ref, data: full });
  }
  return { params, tiles };
}

// ── frames ───────────────────────────────────────────────────────────────────

export type P3 = [number, number, number];
/** Server (x, y, z-up) to Detour (x, y-up, z). */
export const toDetour = (p: readonly [number, number, number]) => ({ x: p[0], y: p[2], z: p[1] });
/** Detour back to the server frame. */
export const fromDetour = (p: { x: number; y: number; z: number }): P3 => [p.x, p.z, p.y];
