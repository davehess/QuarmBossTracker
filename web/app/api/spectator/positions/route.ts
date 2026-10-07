// GET /api/spectator/positions: where the raid is standing right now, for /spectator.
//
// Members-only, the same gate as /api/search: a signed-in Supabase session, 401 otherwise. Nothing here is
// stored or logged; it reads what raid_roster already holds (Zeal's raid pipe, uploaded every ~3 s) and
// hands back only the raiders whose position is under POSITION_FRESH_S old. The uploader's Discord id is
// used to place a raider in a zone and is never returned.
//
// Zone: raid_roster has none, so it comes from character_live_state (Mimic raiders) and, for everyone else,
// from the raiders around them (resolveZoneIds in lib/spectator.ts). Axis swap and the freshest-per-name
// rule live there too, with their tests.
//
// Every read is bounded for the 1,000-row cap and test/db-read-discipline-web.test.js: the positions RPC
// returns one row per raider (a raid is at most 72 and two can run at once; it stops at 300), and
// character_live_state (over 1,000 rows) is read only for those names with an explicit range.
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { GUILD_TAG } from '@/lib/guild';
import {
  buildPositions, POSITION_FRESH_S, ZONE_LIVE_MS, type RosterPosRow,
} from '@/lib/spectator';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });

export async function GET() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail(401, 'unauthorized');

  try {
    const admin = supabaseAdmin();
    const now = Date.now();

    // One row per raider, freshest first, from SQL (migration 20261005003000): raid_roster holds one row
    // per uploader × raider, ~1,100 inside 30 s on a full night, so a raw read would cut raiders off.
    const { data: rosterRows, error: rosterErr } = await admin
      .rpc('spectator_positions', { p_guild_id: GUILD_TAG, p_fresh_s: POSITION_FRESH_S })
      .range(0, 299);
    if (rosterErr) return fail(502, 'positions unavailable');
    const rows = (rosterRows ?? []) as RosterPosRow[];
    if (!rows.length) return NextResponse.json(buildPositions([], new Map(), new Map(), now), { headers: NO_STORE });

    const names = [...new Set(rows.map(r => r.name).filter((n): n is string => !!n))];
    const { data: liveRows, error: liveErr } = await admin.from('character_live_state')
      .select('character, zone_id, zone_name')
      .eq('guild_id', GUILD_TAG)
      .in('character', names)
      .gte('updated_at', new Date(now - ZONE_LIVE_MS).toISOString())
      .range(0, 199);
    if (liveErr) return fail(502, 'positions unavailable');

    const liveZoneByName = new Map<string, number>();
    for (const l of (liveRows ?? []) as { character: string | null; zone_id: number | null }[]) {
      if (l.character && l.zone_id != null && l.zone_id > 0) liveZoneByName.set(l.character.trim().toLowerCase(), l.zone_id);
    }

    const zoneIds = [...new Set(liveZoneByName.values())];
    const zoneById = new Map<number, { short: string; long: string | null }>();
    if (zoneIds.length) {
      const { data: zones, error: zoneErr } = await admin.from('eqemu_zone')
        .select('zone_id, short_name, long_name')
        .in('zone_id', zoneIds)
        .limit(100);
      if (zoneErr) return fail(502, 'positions unavailable');
      for (const z of (zones ?? []) as { zone_id: number | null; short_name: string | null; long_name: string | null }[]) {
        if (z.zone_id != null && z.short_name) zoneById.set(z.zone_id, { short: z.short_name, long: z.long_name });
      }
    }

    return NextResponse.json(buildPositions(rows, liveZoneByName, zoneById, now), { headers: NO_STORE });
  } catch {
    return fail(500, 'positions unavailable');
  }
}
