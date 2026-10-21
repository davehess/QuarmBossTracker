'use server';

// "Make this our route" on /raid/routes (the guild lead, 2026-10-21): save the averaged route of a zone so Mimic can
// draw it later. Officers only. The browser sends only WHICH zone and WHICH nights; the route is recomputed here from
// the same cached answer the page shows, so a saved route is never something the browser made up.
//
// Stored in bot_kv under `raid_route:<zone_short>` (guild_id, key is the primary key). bot_kv is service-role only,
// which is why this is a server action behind isOfficer and not a client write. Value, version 1:
//   { v:1, zone, name, saved_at, nights:[night_key...], keys:[visit key...],
//     points:[[x,y]...]          the averaged route end to end, SERVER frame (not negated),
//     stops:[{ n, npc_id, name, x, y, at:'spawn'|'raid', median_clock_s }],
//     legs:[{ from, to, median_s, best_s, nights, start_index, end_index }]   indexes into points,
//     clears:[{ x, y, leg, name, nights, of }] }
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { GUILD_TAG } from '@/lib/guild';
import { isZoneShort } from '@/lib/zoneMap/source';
import { zoneRoutes } from '@/lib/raidRoutesLoad';

export type SaveRouteResult = { ok: true; saved: number } | { ok: false; error: string };

export async function saveRoute(zone: string, keys: string[]): Promise<SaveRouteResult> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  if (!(await isOfficer(user.id))) return { ok: false, error: 'Officers only.' };
  if (!isZoneShort(zone) || !Array.isArray(keys) || keys.length > 60 || !keys.every(k => typeof k === 'string' && /^\d{1,9}$/.test(k))) {
    return { ok: false, error: 'Bad request.' };
  }
  try {
    const a = await zoneRoutes(zone, keys);
    if (!a) return { ok: false, error: 'No recorded nights for that zone.' };
    const legs = a.route.legs.filter(l => l.pts.length);
    if (!legs.length) return { ok: false, error: 'The chosen nights have no complete leg to average.' };

    const points: [number, number][] = [];
    const legOut = legs.map(l => {
      const start = points.length;
      points.push(...l.pts);
      return { from: l.from, to: l.to, median_s: l.medianS, best_s: l.bestS, nights: l.nights, start_index: start, end_index: points.length - 1 };
    });
    const value = {
      v: 1,
      zone,
      name: a.name,
      saved_at: new Date().toISOString(),
      keys: a.selected,
      nights: a.nights.filter(n => n.included).map(n => n.night_key),
      points,
      stops: a.route.stops.map(s => ({ n: s.n, npc_id: s.npc_id, name: s.name, x: s.x, y: s.y, at: s.at, median_clock_s: s.medianClockS })),
      legs: legOut,
      clears: a.route.clears.map(c => ({ x: c.x, y: c.y, leg: c.leg, name: c.name, nights: c.nights, of: c.of })),
    };
    const { error } = await supabaseAdmin().from('bot_kv')
      .upsert({ guild_id: GUILD_TAG, key: `raid_route:${zone}`, value, updated_at: new Date().toISOString() }, { onConflict: 'guild_id,key' });
    if (error) return { ok: false, error: 'Could not save the route.' };
    return { ok: true, saved: points.length };
  } catch {
    return { ok: false, error: 'Could not save the route.' };
  }
}
