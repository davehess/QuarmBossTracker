// The wall layers for one zone, for the raid-night maps. Server-only.
//
// Brewall's map is the picture (the guild lead, 2026-10-26: "pop/raid needs the brewall maps underneath"); the
// EQEmu wall slice is read too, as the fallback for a zone Brewall has no map for.
//
// Read order: the zone_map_lines row /spectator already caches (segs, bounds and the brewall column), and when
// there is no row, a live fetch of both layers the way /api/spectator/map does it (fetchEqemuLayer + fetchBrewallLayer).
// A row is settled: it is never topped up here, because the spectator route wrote it only after both sources answered.
//
// A fetched layer is NOT written back to zone_map_lines. That table holds one row per zone and
// /api/spectator/map treats any row as settled, Brewall column included; a row written here with a layer missing
// would make the spectator map show none for that zone for good. So a miss is held in this process instead (six
// hours when both sources answered completely, a minute when one failed or the Brewall file names had to be
// guessed), and a zone the spectator map has loaded once is read from the table from then on.
import { supabaseAdmin } from '@/lib/supabase';
import { fetchBrewallLayer, fetchEqemuLayer } from '@/lib/zoneMap/load';
import { isZoneShort } from '@/lib/zoneMap/source';
import type { BrewallLayer } from '@/lib/zoneMap/brewall';
import type { Bounds, Seg } from '@/lib/zoneMap/slice';

/** `segs`/`bounds` are the EQEmu slice (null when the zone has none); `brewall` is the art (null when there is none). */
export type Walls = { segs: Seg[] | null; bounds: Bounds | null; brewall: BrewallLayer | null };

const MEMO_TTL_MS = 6 * 60 * 60 * 1000;
const FAIL_TTL_MS = 60 * 1000;
const memo = new Map<string, { at: number; walls: Walls | null; ok: boolean }>();

const isBrewall = (v: unknown): v is BrewallLayer =>
  !!v && typeof v === 'object' && Array.isArray((v as BrewallLayer).lines) && !!(v as BrewallLayer).bounds;

export async function loadWalls(zone: string): Promise<Walls | null> {
  if (!isZoneShort(zone)) return null;
  const now = Date.now();
  const held = memo.get(zone);
  if (held && now - held.at < (held.ok ? MEMO_TTL_MS : FAIL_TTL_MS)) return held.walls;

  let walls: Walls | null = null;
  let ok = true;
  try {
    const hit = await supabaseAdmin().from('zone_map_lines').select('segs, bounds, brewall').eq('zone_short', zone).maybeSingle();
    if (hit.error) console.error(`[pop-raid] wall cache read failed for ${zone}: ${hit.error.message}`);
    const row = hit.data as { segs: Seg[] | null; bounds: Bounds | null; brewall: unknown } | null;
    if (row) {
      const brewall = isBrewall(row.brewall) && row.brewall.lines.length ? row.brewall : null;
      const segs = row.segs && row.bounds ? row.segs : null;
      walls = segs || brewall ? { segs, bounds: segs ? row.bounds : null, brewall } : null;
    } else {
      const [eq, bw] = await Promise.allSettled([fetchEqemuLayer(zone), fetchBrewallLayer(zone)]);
      if (eq.status === 'rejected') console.error(`[pop-raid] EQEmu layer failed for ${zone}: ${eq.reason}`);
      if (bw.status === 'rejected') console.error(`[pop-raid] Brewall layer failed for ${zone}: ${bw.reason}`);
      const eqemu = eq.status === 'fulfilled' ? eq.value : null;
      const brewall = bw.status === 'fulfilled' && bw.value.layer?.lines.length ? bw.value.layer : null;
      walls = eqemu || brewall ? { segs: eqemu?.segs ?? null, bounds: eqemu?.bounds ?? null, brewall } : null;
      ok = eq.status === 'fulfilled' && bw.status === 'fulfilled' && bw.value.complete;
    }
  } catch (e) {
    console.error(`[pop-raid] walls for ${zone} unavailable: ${e instanceof Error ? e.message : String(e)}`);
    ok = false;
  }
  memo.set(zone, { at: now, walls, ok });
  return walls;
}
