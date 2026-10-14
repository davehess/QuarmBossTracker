// The EQEmu wall layer for one zone, for the raid-night maps. Server-only.
//
// Read order: the zone_map_lines row /spectator already caches (only bands, segs, bounds: the Brewall column is
// never selected here and no Brewall file is ever fetched), then a live fetch of the EQEmu mesh.
//
// A fetched layer is NOT written back to zone_map_lines. That table holds one row per zone and
// /api/spectator/map treats any row as settled, Brewall column included; a row written here without a Brewall
// layer would make the spectator map show none for that zone for good. So a miss is held in this process
// instead (six hours), and a zone the spectator map has loaded once is read from the table from then on.
import { supabaseAdmin } from '@/lib/supabase';
import { fetchEqemuLayer } from '@/lib/zoneMap/load';
import { isZoneShort } from '@/lib/zoneMap/source';
import type { Bounds, Seg } from '@/lib/zoneMap/slice';

export type Walls = { segs: Seg[]; bounds: Bounds };

const MEMO_TTL_MS = 6 * 60 * 60 * 1000;
const FAIL_TTL_MS = 60 * 1000;
const memo = new Map<string, { at: number; walls: Walls | null; ok: boolean }>();

export async function loadWalls(zone: string): Promise<Walls | null> {
  if (!isZoneShort(zone)) return null;
  const now = Date.now();
  const held = memo.get(zone);
  if (held && now - held.at < (held.ok ? MEMO_TTL_MS : FAIL_TTL_MS)) return held.walls;

  let walls: Walls | null = null;
  let ok = true;
  try {
    const hit = await supabaseAdmin().from('zone_map_lines').select('segs, bounds').eq('zone_short', zone).maybeSingle();
    if (hit.error) console.error(`[pop-raid] wall cache read failed for ${zone}: ${hit.error.message}`);
    const row = hit.data as { segs: Seg[] | null; bounds: Bounds | null } | null;
    if (row?.segs && row.bounds) {
      walls = { segs: row.segs, bounds: row.bounds };
    } else {
      const layer = await fetchEqemuLayer(zone);
      walls = layer ? { segs: layer.segs, bounds: layer.bounds } : null;
    }
  } catch (e) {
    console.error(`[pop-raid] walls for ${zone} unavailable: ${e instanceof Error ? e.message : String(e)}`);
    ok = false;
  }
  memo.set(zone, { at: now, walls, ok });
  return walls;
}
