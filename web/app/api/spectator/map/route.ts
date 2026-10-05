// GET /api/spectator/map?zone=<short_name> — flat wall lines for the members-only spectator map.
//
//   -> { zone, frame: 'server', bands, segs, bounds, source, generated_at }
//
// Wall lines are sliced from the EQEmu server collision mesh (web/lib/zoneMap/slice.ts) the first
// time a zone is asked for, then cached in zone_map_lines so every later request is one row read.
// `frame: 'server'` means the lines use the eqemu_spawn2 axes; raid_roster / pipe (loc_x, loc_y)
// are server (y, x), so the page swaps when it plots a raider — see the header of slice.ts.
//
// Gate: signed-in is the member gate on this site. The sign-in callback signs out anyone who is not
// in the guild or lacks an allowed role, so a live session already means "member"; /api/media and
// /api/search check exactly this and nothing more.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { parseEqemuMap, sliceZoneMap } from '@/lib/zoneMap/slice';
import { eqemuMapUrl, isZoneShort, MAP_LICENSE, MAP_SOURCE_LABEL } from '@/lib/zoneMap/source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A cold zone downloads ~1.5 MB and slices it; the default 10 s is tight for the largest meshes.
export const maxDuration = 30;

const FETCH_TIMEOUT_MS = 8000;
// The biggest Quarm-era mesh is a few MB; anything past this is not a map.
const MAX_MAP_BYTES = 16 * 1024 * 1024;
const CACHE = { 'Cache-Control': 'private, max-age=3600' };

const fail = (error: string, status: number, headers?: Record<string, string>) =>
  NextResponse.json({ error }, { status, headers });

export async function GET(req: Request) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail('sign in first', 401);

  const zone = new URL(req.url).searchParams.get('zone');
  if (!isZoneShort(zone)) return fail('bad zone', 400);

  const admin = supabaseAdmin();
  const body = (m: { bands: unknown; segs: unknown; bounds: unknown; source: string; generated_at: string }) =>
    NextResponse.json({
      zone, frame: 'server', bands: m.bands, segs: m.segs, bounds: m.bounds,
      source: m.source, generated_at: m.generated_at,
    }, { headers: CACHE });

  // Cache first: a row only ever exists for a zone that passed the eqemu_zone check below, so a
  // hit needs no second lookup. A failed read (e.g. the table not applied yet) falls through to
  // compute rather than failing the page.
  const hit = await admin.from('zone_map_lines')
    .select('bands, segs, bounds, source, generated_at')
    .eq('zone_short', zone)
    .maybeSingle();
  if (hit.error) console.error(`[spectator-map] cache read failed for ${zone}: ${hit.error.message}`);
  if (hit.data) return body(hit.data);

  const known = await admin.from('eqemu_zone').select('short_name').eq('short_name', zone).limit(1);
  if (known.error) {
    console.error(`[spectator-map] eqemu_zone lookup failed for ${zone}: ${known.error.message}`);
    return fail('zone lookup failed', 502);
  }
  if (!known.data?.length) return fail('unknown zone', 404, CACHE);

  let raw: Buffer;
  try {
    const res = await fetch(eqemuMapUrl(zone), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store' });
    if (res.status === 404) return fail('no map for this zone', 404, CACHE);
    if (!res.ok) return fail(`map source answered ${res.status}`, 502);
    raw = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.error(`[spectator-map] fetch failed for ${zone}: ${(e as Error).message}`);
    return fail('map source unreachable', 502);
  }
  if (raw.length > MAX_MAP_BYTES) return fail('map too large', 502);

  let sliced;
  try {
    const { V, I } = parseEqemuMap(raw);
    sliced = sliceZoneMap(V, I);
  } catch (e) {
    console.error(`[spectator-map] could not read the ${zone} map: ${(e as Error).message}`);
    return fail('unreadable map', 502);
  }

  const row = {
    zone_short: zone,
    source: MAP_SOURCE_LABEL,
    license: MAP_LICENSE,
    bands: sliced.bands,
    segs: sliced.segs,
    bounds: sliced.bounds,
    seg_count: sliced.segs.length,
    generated_at: new Date().toISOString(),
  };
  // Two requests racing on a cold zone both slice and both upsert the same row; harmless. A failed
  // write still answers this request, and the next one tries again.
  const saved = await admin.from('zone_map_lines').upsert(row, { onConflict: 'zone_short' });
  if (saved.error) console.error(`[spectator-map] cache write failed for ${zone}: ${saved.error.message}`);

  return body(row);
}
