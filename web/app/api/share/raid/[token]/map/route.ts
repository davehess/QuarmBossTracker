// GET /api/share/raid/<token>/map?zone=<short_name>: a zone's wall lines for the public replay.
//
// The EQEmu layer ONLY (GPLv2-or-later, wall lines sliced from the collision mesh). The Brewall layer is third-party
// art with no stated licence that the members' route serves "only behind the Discord-gated sign-in"
// (web/app/api/spectator/map/route.ts), so this route never reads it: the cache read selects bands/segs/bounds and
// nothing else, and `brewall` is always null. A zone with no cached row is fetched from the public EQEmu maps and
// answered without being written back (the members' route owns the cache).
import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchEqemuLayer } from '@/lib/zoneMap/load';
import { isZoneShort, MAP_SOURCES } from '@/lib/zoneMap/source';
import { resolveShare } from '@/lib/raidShareLookup';
import { ceilingApi, guardApi } from '@/lib/shareGuard';
import { SHARE_CACHE_S } from '@/lib/raidShare';

// ABUSE (the guild lead, 2026-10-17): per-IP limit before the lookup, per-share hourly ceiling after it. The cached
// zone row is one zone's wall lines, the same for every share and every visitor, so it is kept by ZONE
// (unstable_cache, 5 minutes) rather than by share, and carries no share tag: it holds nothing a revoke should hide,
// and the lookup (outside the cache) is what refuses a revoked link.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const HOUR = { 'Cache-Control': 'private, max-age=3600', 'X-Robots-Tag': 'noindex, nofollow' };
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
    const zone = new URL(req.url).searchParams.get('zone');
    if (!isZoneShort(zone)) return fail('bad zone', 400);

    const respond = (eqemu: unknown, generated_at: string) => NextResponse.json({
      zone, frame: 'server', eqemu, brewall: null, sources: { eqemu: MAP_SOURCES.eqemu, brewall: '' }, generated_at,
    }, { headers: HOUR });

    const z: string = zone;
    const hit = await unstable_cache(async () => {
      const r = await supabaseAdmin().from('zone_map_lines').select('bands, segs, bounds, generated_at').eq('zone_short', z).maybeSingle();
      if (r.error) throw r.error;   // a throw is never cached
      return r.data;
    }, ['raid-share-map', z], { revalidate: SHARE_CACHE_S })().catch(() => null);   // as before: a failed read falls through to the public maps
    if (hit?.segs) return respond({ bands: hit.bands, segs: hit.segs, bounds: hit.bounds }, hit.generated_at);

    const eqemu = await fetchEqemuLayer(zone).catch(() => null);
    return eqemu ? respond(eqemu, new Date().toISOString()) : fail('no map for this zone', 404);
  } catch {
    return fail('map unavailable', 500);
  }
}
