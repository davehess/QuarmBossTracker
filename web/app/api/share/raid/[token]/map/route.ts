// GET /api/share/raid/<token>/map?zone=<short_name>: a zone's wall lines for the public replay.
//
// The EQEmu layer ONLY (GPLv2-or-later, wall lines sliced from the collision mesh). The Brewall layer is third-party
// art with no stated licence that the members' route serves "only behind the Discord-gated sign-in"
// (web/app/api/spectator/map/route.ts), so this route never reads it: the cache read selects bands/segs/bounds and
// nothing else, and `brewall` is always null. A zone with no cached row is fetched from the public EQEmu maps and
// answered without being written back (the members' route owns the cache).
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchEqemuLayer } from '@/lib/zoneMap/load';
import { isZoneShort, MAP_SOURCES } from '@/lib/zoneMap/source';
import { resolveShare } from '@/lib/raidShareLookup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const HOUR = { 'Cache-Control': 'private, max-age=3600', 'X-Robots-Tag': 'noindex, nofollow' };
const fail = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: { 'Cache-Control': status === 404 ? 'private, max-age=60' : 'no-store', 'X-Robots-Tag': 'noindex' } });

export async function GET(req: Request, { params }: { params: { token: string } }) {
  try {
    const sb = supabaseAdmin();
    if (!(await resolveShare(sb, params.token))) return fail('not found', 404);
    const zone = new URL(req.url).searchParams.get('zone');
    if (!isZoneShort(zone)) return fail('bad zone', 400);

    const respond = (eqemu: unknown, generated_at: string) => NextResponse.json({
      zone, frame: 'server', eqemu, brewall: null, sources: { eqemu: MAP_SOURCES.eqemu, brewall: '' }, generated_at,
    }, { headers: HOUR });

    const hit = await sb.from('zone_map_lines').select('bands, segs, bounds, generated_at').eq('zone_short', zone).maybeSingle();
    if (hit.data?.segs) return respond({ bands: hit.data.bands, segs: hit.data.segs, bounds: hit.data.bounds }, hit.data.generated_at);

    const eqemu = await fetchEqemuLayer(zone).catch(() => null);
    return eqemu ? respond(eqemu, new Date().toISOString()) : fail('no map for this zone', 404);
  } catch {
    return fail('map unavailable', 500);
  }
}
