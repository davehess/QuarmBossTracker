// GET /api/spectator/mesh?zone=<short_name>[&floors=1|only] — a zone's wall triangles for the 3D replay.
//
//   -> application/octet-stream, the packed format described in web/lib/zoneMesh.ts (server frame, Int16).
//      Headers: X-Mesh-Triangles (sent), X-Mesh-Raw (in the source file).
//
// Source: the EQEmu collision mesh (EQEmu/maps, GPLv2-or-later), the same file the wall lines are sliced
// from. Plain geometry only: no textures, no client art. Near-horizontal triangles are dropped unless
// `floors=1` (walls and floors together), tiny ones always, and the rest is capped by area so a big zone
// stays near 2 MB. `floors=only` is the 3D view's second request: just the near-horizontal triangles, under
// their own smaller cap, drawn under the walls so a hole in the terrain fills in. Two requests rather than
// one mixed list because the walls keep their whole budget and the Floors toggle can hide the layer.
// Size: nothing here compresses the body; Vercel's CDN compresses by Content-Type and octet-stream is not on
// its list as far as we know (unverified), so treat the raw size as what goes over the wire.
//
// Members-only, the same gate as /api/spectator/map and /positions: a signed-in session, 401 otherwise. Nothing
// is read from or written to the database; the zone name is validated (lowercase letters, digits, underscore)
// before it can reach the upstream URL, so there is no path to anything but base/<zone>.map.
//
// Cost: a cold zone is one download (kept by Next for a day) plus a parse and a pack, well under the Hobby
// function limit; the packed answer is also held in this process for a few zones, so a repeat skips the work.
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { fetchEqemuMesh } from '@/lib/zoneMap/load';
import { isZoneShort } from '@/lib/zoneMap/source';
import { packMesh, type PackStats } from '@/lib/zoneMesh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const DAY = { 'Cache-Control': 'private, max-age=86400' };
const fail = (error: string, status: number, headers?: Record<string, string>) =>
  NextResponse.json({ error }, { status, headers });

const MEMO_MAX = 8;   // walls + floors for four zones (a split screen shows two at once)
const MEMO_TTL_MS = 6 * 60 * 60 * 1000;
const memo = new Map<string, { at: number; buf: ArrayBuffer; stats: PackStats }>();

export async function GET(req: Request) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail('sign in first', 401);

  const q = new URL(req.url).searchParams;
  const zone = q.get('zone');
  if (!isZoneShort(zone)) return fail('bad zone', 400);
  const fl = q.get('floors');
  const floors = fl === '1';
  const floorsOnly = fl === 'only';
  const key = `${zone}|${floorsOnly ? 'only' : floors ? 1 : 0}`;

  let hit = memo.get(key);
  if (hit && Date.now() - hit.at > MEMO_TTL_MS) { memo.delete(key); hit = undefined; }
  if (!hit) {
    let mesh;
    try {
      mesh = await fetchEqemuMesh(zone);
    } catch (e) {
      console.error(`[spectator-mesh] ${zone}: ${e instanceof Error ? e.message : e}`);
      return fail('map source unreachable', 502, { 'Cache-Control': 'private, max-age=60' });
    }
    if (!mesh) return fail('no mesh for this zone', 404, DAY);
    const packed = packMesh(mesh.V, mesh.I, { floors, floorsOnly });
    hit = { at: Date.now(), buf: packed.buf, stats: packed.stats };
    if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string);
    memo.set(key, hit);
  }

  return new NextResponse(hit.buf, {
    headers: {
      ...DAY,
      'Content-Type': 'application/octet-stream',
      'X-Mesh-Triangles': String(hit.stats.packed),
      'X-Mesh-Raw': String(hit.stats.raw),
    },
  });
}
