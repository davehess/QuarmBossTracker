// Route planner: the browser's half of "Walk route". Client-only, and lazy on purpose: nothing here is imported until the
// toggle is turned on, so the page everyone sees never downloads the navigation library (about 260 KB gzipped, the wasm
// inlined in it) or a navmesh.
//
// loadNavRouter(zone) fetches the zone's slim navmesh from /api/raid/navmesh, expands it (navmesh.ts), builds a Detour
// navmesh in the WASM and hands back the router (navroute.ts) whose walk function is a Detour query. It is kept per zone for
// the life of the page, so a second look is free.
//
// Facts established before this was written (a prototype over the real Quarm files):
//   • Detour (x, y-up, z) is the server's (x, z, y); no sign flips (verified on every tower pin).
//   • NavMeshQuery needs maxNodes 65535: the default 2048 silently returns PARTIAL paths, and computePath reports success on
//     a partial path, so an end more than 2 units from where it was asked to go is a failure here.
//   • The snap box is x/z 12, y 40. EQEmu's usual 100-200 on y snaps a point to the wrong storey in a tower. A pin that is a
//     little off the mesh gets one wider look sideways (30), never upwards.
//   • A query takes 1 to 3 ms; a leg that needs several teleports takes about 0.5 s the first time and a few tens of ms after.
import { expandSlim, fromDetour, toDetour, type P3 } from './navmesh';
import { completeWalk, makeRouter, type Router, type WalkFn } from './navroute';
import type { ZoneData } from './types';

const TIGHT = { x: 12, y: 40, z: 12 };
const LOOSE = { x: 30, y: 40, z: 30 };

const loads = new Map<string, Promise<Router>>();

/** The zone's router. Rejects with a sentence for the page ("no walkable map for this zone", "could not load ..."). */
export function loadNavRouter(zone: Pick<ZoneData, 'zone' | 'links'>): Promise<Router> {
  let p = loads.get(zone.zone);
  if (!p) {
    p = build(zone);
    loads.set(zone.zone, p);
    p.catch(() => loads.delete(zone.zone));   // a failure is not kept: turning the toggle off and on tries again
  }
  return p;
}

async function build(zone: Pick<ZoneData, 'zone' | 'links'>): Promise<Router> {
  const [res, recast] = await Promise.all([
    fetch(`/api/raid/navmesh?zone=${encodeURIComponent(zone.zone)}`).catch(() => null),
    import('@recast-navigation/core'),
  ]);
  if (!res) throw new Error('The walkable map could not be loaded (no connection).');
  if (res.status === 404) throw new Error('There is no walkable map for this zone.');
  if (!res.ok) throw new Error(`The walkable map could not be loaded (${res.status}).`);
  let mesh;
  try {
    mesh = expandSlim(new Uint8Array(await res.arrayBuffer()));
  } catch {
    throw new Error('The walkable map could not be read.');
  }
  await recast.init();
  const { NavMesh, NavMeshQuery, NavMeshParams, UnsignedCharArray } = recast;
  const nm = new NavMesh();
  const [ox, oy, oz] = mesh.params.orig;
  if (!nm.initTiled(NavMeshParams.create({ orig: { x: ox, y: oy, z: oz }, tileWidth: mesh.params.tileWidth, tileHeight: mesh.params.tileHeight, maxTiles: mesh.params.maxTiles, maxPolys: mesh.params.maxPolys }))) {
    throw new Error('The walkable map could not be built.');
  }
  let added = 0;
  for (const t of mesh.tiles) {
    const arr = new UnsignedCharArray();
    arr.copy(t.data);
    if (nm.addTile(arr, 0, t.ref).tileRef) added++;
  }
  if (!added) throw new Error('The walkable map could not be built.');
  const q = new NavMeshQuery(nm, { maxNodes: 65535 });

  const snap = (p: P3) => {
    for (const he of [TIGHT, LOOSE]) {
      const r = q.findNearestPoly(toDetour(p), { halfExtents: he });
      if (r.success && r.nearestRef) return r.nearestPoint;
    }
    return null;
  };
  const walk: WalkFn = (a, b) => {
    const sa = snap(a), sb = snap(b);
    if (!sa || !sb) return { ok: false };
    const r = q.computePath(sa, sb, { halfExtents: LOOSE, maxPathPolys: 2048, maxStraightPathPoints: 2048 });
    if (!r.success || !r.path.length) return { ok: false };
    return completeWalk(r.path.map(fromDetour), fromDetour(sb));   // a partial path is a failure
  };
  return makeRouter(walk, zone.links);
}
