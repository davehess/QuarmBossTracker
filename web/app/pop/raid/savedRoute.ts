// The route an officer saved for a zone, for the raid-night maps. Server-only, one read per zone per five minutes.
//
// `bot_kv` row `raid_route:<zone>` is written by the website's Raid routes page (an average of the recorded nights,
// web/app/raid/routes/actions.ts) or by the route planner's "Send to in-game map". The bot serves the same row to
// Mimic's Map (utils/raidRoute.js). This is the page's own server read: no client polling, and "none saved" is held
// as well, so a page view costs no query inside the window.
import { supabaseAdmin } from '@/lib/supabase';
import { GUILD_TAG } from '@/lib/guild';
import { isZoneShort } from '@/lib/zoneMap/source';
import { slimSavedRoute, type SavedRoute } from '@/lib/popRaidMap';

const TTL_MS = 5 * 60 * 1000;
const FAIL_TTL_MS = 30 * 1000;
const memo = new Map<string, { at: number; route: SavedRoute | null; ok: boolean }>();

export async function loadSavedRoute(zone: string): Promise<SavedRoute | null> {
  if (!isZoneShort(zone)) return null;
  const now = Date.now();
  const held = memo.get(zone);
  if (held && now - held.at < (held.ok ? TTL_MS : FAIL_TTL_MS)) return held.route;
  let route: SavedRoute | null = null;
  let ok = true;
  try {
    const { data, error } = await supabaseAdmin().from('bot_kv').select('value')
      .eq('guild_id', GUILD_TAG).eq('key', `raid_route:${zone}`).maybeSingle();
    if (error) throw new Error(error.message);
    route = slimSavedRoute((data as { value: unknown } | null)?.value);
  } catch (e) {
    console.error(`[pop-raid] saved route for ${zone} unavailable: ${e instanceof Error ? e.message : String(e)}`);
    ok = false;
  }
  memo.set(zone, { at: now, route, ok });
  return route;
}
