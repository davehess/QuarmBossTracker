// GET /api/share/raid/<token>/mesh?zone=<short_name>[&floors=1|only]: a zone's wall triangles for the public 3D replay.
//
// The same packed EQEmu collision mesh as /api/spectator/mesh (GPLv2-or-later; plain geometry, no art), behind the
// share token instead of a sign-in. Nothing is read from or written to the database except the token's own row.
// The packing is lib/zoneMesh.ts; the members' route keeps a process memo, this one leans on the browser cache.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchEqemuMesh } from '@/lib/zoneMap/load';
import { isZoneShort } from '@/lib/zoneMap/source';
import { packMesh } from '@/lib/zoneMesh';
import { resolveShare } from '@/lib/raidShareLookup';
import { ceilingApi, guardApi } from '@/lib/shareGuard';

// ABUSE (the guild lead, 2026-10-17): per-IP limit before the lookup, per-share hourly ceiling after it. The mesh
// itself is static per zone (the upstream file is already kept by Next for a day, and nothing here touches the
// database), so it is deliberately NOT wrapped in a cache of its own: a packed mesh is binary and runs to
// megabytes, which the data cache would store as a JSON array of bytes.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const fail = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: { 'Cache-Control': status === 404 ? 'private, max-age=60' : 'no-store', 'X-Robots-Tag': 'noindex' } });

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const limited = guardApi(req);
  if (limited) return limited;
  try {
    const share = await resolveShare(supabaseAdmin(), params.token);
    if (!share) return fail('not found', 404);
    const over = ceilingApi(share.row.id);
    if (over) return over;
    const q = new URL(req.url).searchParams;
    const zone = q.get('zone');
    if (!isZoneShort(zone)) return fail('bad zone', 400);
    const fl = q.get('floors');

    let mesh;
    try { mesh = await fetchEqemuMesh(zone); } catch { return fail('map source unreachable', 502); }
    if (!mesh) return fail('no mesh for this zone', 404);
    const packed = packMesh(mesh.V, mesh.I, { floors: fl === '1', floorsOnly: fl === 'only' });
    return new NextResponse(packed.buf, {
      headers: {
        'Cache-Control': 'private, max-age=3600',
        'X-Robots-Tag': 'noindex, nofollow',
        'Content-Type': 'application/octet-stream',
        'X-Mesh-Triangles': String(packed.stats.packed),
        'X-Mesh-Raw': String(packed.stats.raw),
      },
    });
  } catch {
    return fail('mesh unavailable', 500);
  }
}
