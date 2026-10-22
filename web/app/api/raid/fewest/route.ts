// GET /api/raid/fewest?zone=<short>&npc=<id,id,...>: our smallest past kills of each boss, for the route planner.
//
//   -> { zone, bosses: [{ npc_id, boss, total_kills, kills: [{ encounter_id, killed_at, players, characters,
//        fought_players, unmatched, classes, night_type, source }] }] }      (fewest players first, at most 5 a boss)
//
// Members-only, the same gate as /api/raid/routes: a signed-in Supabase session, 401 otherwise. The reads use the admin
// client after that check (raid_track_minutes is service-role only). Counts and a class mix only: no character or
// member name is in the answer. The maths and the reads are in web/lib/fewestKills.ts.
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isZoneShort } from '@/lib/zoneMap/source';
import { fewestKills, MAX_NPCS, type FewestBoss } from '@/lib/fewestKills';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });
const ID = /^\d{1,9}$/;

// A cache in this process: the same planner view is opened by several raiders at once. Never the record.
const TTL = 5 * 60 * 1000;
const MAX_CACHE = 40;
const held = new Map<string, { at: number; p: Promise<FewestBoss[]> }>();

export async function GET(req: Request) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail(401, 'unauthorized');

  const q = new URL(req.url).searchParams;
  const zone = q.get('zone');
  const raw = q.get('npc');
  if (!isZoneShort(zone) || !raw) return fail(400, 'bad request');
  const parts = raw.split(',').filter(Boolean);
  if (!parts.length || parts.length > MAX_NPCS || !parts.every(p => ID.test(p))) return fail(400, 'bad request');
  const npcIds = [...new Set(parts.map(Number))].sort((a, b) => a - b);

  try {
    const key = `${zone}:${npcIds.join(',')}`;
    const now = Date.now();
    let hit = held.get(key);
    if (!hit || now - hit.at > TTL) {
      const p = fewestKills(supabaseAdmin(), { zone, npcIds });
      hit = { at: now, p };
      held.set(key, hit);
      p.catch(() => { if (held.get(key)?.p === p) held.delete(key); });   // a failure is not remembered
      if (held.size > MAX_CACHE) for (const k of held.keys()) { held.delete(k); if (held.size <= MAX_CACHE) break; }
    }
    return NextResponse.json({ zone, bosses: await hit.p }, { headers: { 'Cache-Control': 'private, max-age=300' } });
  } catch (e) {
    console.error(`[raid-fewest] ${e instanceof Error ? e.message : String(e)}`);
    return fail(500, 'kills unavailable');
  }
}
