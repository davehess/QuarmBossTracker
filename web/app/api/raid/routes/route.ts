// GET /api/raid/routes: the raid-route explorer's data, for /raid/routes.
//
//   ?zones=1                     -> { zones: [{ zone, name, visits: [{ key, night_key, from, to, minutes, peak, raid }] }] }
//   ?zone=<short>[&nights=a,b]   -> { zone, name, nights: [...], selected, route }   (nights = visit keys; omitted = all)
//
// Members-only, the same gate as /api/spectator/*: a signed-in Supabase session, 401 otherwise. raid_track_minutes is
// service-role only, so the reads use the admin client after that check (web/lib/raidRoutesLoad.ts). Raw frames never
// leave the server: the answer is the averaged route, one simplified path per night (at most 300 points), the stops,
// the per-leg timings and clearing, and the spawn points cleared.
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { isZoneShort } from '@/lib/zoneMap/source';
import { listZones, zoneRoutes } from '@/lib/raidRoutesLoad';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });
const KEY = /^\d{1,9}$/;

export async function GET(req: Request) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail(401, 'unauthorized');

  const q = new URL(req.url).searchParams;
  try {
    if (q.get('zones')) {
      return NextResponse.json({ zones: await listZones() }, { headers: { 'Cache-Control': 'private, max-age=60' } });
    }
    const zone = q.get('zone');
    if (!isZoneShort(zone)) return fail(400, 'bad request');
    const raw = q.get('nights');
    const keys = raw == null ? null : raw.split(',').filter(Boolean);
    if (keys && (keys.length > 60 || !keys.every(k => KEY.test(k)))) return fail(400, 'bad request');
    const answer = await zoneRoutes(zone, keys);
    if (!answer) return fail(404, 'no recorded nights');
    return NextResponse.json(answer, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (e) {
    console.error(`[raid-routes] ${e instanceof Error ? e.message : String(e)}`);
    return fail(500, 'routes unavailable');
  }
}
