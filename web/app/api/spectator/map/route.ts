// GET /api/spectator/map?zone=<short_name> — the two map layers for the members-only spectator map.
//
//   -> { zone, frame: 'server',
//        eqemu:   { bands, segs, bounds } | null,    wall lines sliced from the EQEmu collision mesh
//        brewall: { lines, labels, bounds } | null,  Brewall's map art (lines + labelled points)
//        sources: { eqemu, brewall }, generated_at }
//
// Both layers use the server frame (the eqemu_spawn2 axes). raid_roster / pipe (loc_x, loc_y) are
// server (y, x), so the page swaps when it plots a raider — see the header of web/lib/zoneMap/slice.ts.
//
// Each layer is fetched from its public source the first time a zone is asked for, then cached in
// zone_map_lines, one row per zone. 404 only when BOTH layers are missing.
//
// The Brewall layer is third-party art with no stated licence. It is served only here, behind the
// Discord-gated sign-in, and the cache table has no policy that lets anyone but this route read it.
//
// Gate: signed-in is the member gate on this site. The sign-in callback signs out anyone who is not
// in the guild or lacks an allowed role, so a live session already means "member"; /api/media and
// /api/search check exactly this and nothing more.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { fetchBrewallLayer, fetchEqemuLayer } from '@/lib/zoneMap/load';
import { isZoneShort, MAP_LICENSE, MAP_SOURCES } from '@/lib/zoneMap/source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A cold zone downloads a ~1.5 MB mesh and slices it next to a few text files; the default 10 s is tight.
export const maxDuration = 30;

const CACHE = { 'Cache-Control': 'private, max-age=3600' };
// A layer we could not reach is retried soon, not held for an hour.
const SHORT = { 'Cache-Control': 'private, max-age=60' };

const fail = (error: string, status: number, headers?: Record<string, string>) =>
  NextResponse.json({ error }, { status, headers });

export async function GET(req: Request) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail('sign in first', 401);

  const zone = new URL(req.url).searchParams.get('zone');
  if (!isZoneShort(zone)) return fail('bad zone', 400);

  const admin = supabaseAdmin();
  const respond = (eqemu: unknown, brewall: unknown, generated_at: string, headers: Record<string, string>) =>
    NextResponse.json({ zone, frame: 'server', eqemu, brewall, sources: MAP_SOURCES, generated_at }, { headers });

  // Cache first: a row only ever exists for a zone that passed the eqemu_zone check below, so a
  // hit needs no second lookup. A failed read (e.g. the table not applied yet) falls through to
  // compute rather than failing the page.
  const hit = await admin.from('zone_map_lines')
    .select('bands, segs, bounds, brewall, generated_at')
    .eq('zone_short', zone)
    .maybeSingle();
  if (hit.error) console.error(`[spectator-map] cache read failed for ${zone}: ${hit.error.message}`);
  if (hit.data) {
    const r = hit.data;
    return respond(r.segs ? { bands: r.bands, segs: r.segs, bounds: r.bounds } : null, r.brewall ?? null, r.generated_at, CACHE);
  }

  const known = await admin.from('eqemu_zone').select('short_name').eq('short_name', zone).limit(1);
  if (known.error) {
    console.error(`[spectator-map] eqemu_zone lookup failed for ${zone}: ${known.error.message}`);
    return fail('zone lookup failed', 502);
  }
  if (!known.data?.length) return fail('unknown zone', 404, CACHE);

  const [eq, bw] = await Promise.allSettled([fetchEqemuLayer(zone), fetchBrewallLayer(zone)]);
  if (eq.status === 'rejected') console.error(`[spectator-map] EQEmu layer failed for ${zone}: ${eq.reason}`);
  if (bw.status === 'rejected') console.error(`[spectator-map] Brewall layer failed for ${zone}: ${bw.reason}`);
  const eqemu = eq.status === 'fulfilled' ? eq.value : null;
  const brewall = bw.status === 'fulfilled' ? bw.value.layer : null;
  // Cache only what is settled: a layer that errored, or a Brewall layer whose file names were
  // guessed, may be missing for now and must be looked for again, not remembered as absent.
  const settled = eq.status === 'fulfilled' && bw.status === 'fulfilled' && bw.value.complete;

  if (!eqemu && !brewall) {
    return settled ? fail('no map for this zone', 404, CACHE) : fail('map source unreachable', 502);
  }

  const generated_at = new Date().toISOString();
  if (settled) {
    // Two requests racing on a cold zone both fetch and both upsert the same row; harmless. A failed
    // write still answers this request, and the next one tries again.
    const saved = await admin.from('zone_map_lines').upsert({
      zone_short: zone,
      source: eqemu ? MAP_SOURCES.eqemu : null,
      license: eqemu ? MAP_LICENSE : null,
      bands: eqemu?.bands ?? null,
      segs: eqemu?.segs ?? null,
      bounds: eqemu?.bounds ?? null,
      seg_count: eqemu ? eqemu.segs.length : null,
      brewall,
      generated_at,
    }, { onConflict: 'zone_short' });
    if (saved.error) console.error(`[spectator-map] cache write failed for ${zone}: ${saved.error.message}`);
  }
  return respond(eqemu, brewall, generated_at, settled ? CACHE : SHORT);
}
