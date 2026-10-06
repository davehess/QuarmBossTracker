// GET /api/screen/feed: the slow-moving facts the raid screen's Loot and Overview modes and its right rail
// show. Members only (signed in), the same gate as /api/spectator/positions.
//
//   -> { at, awards, looted, kills, spawns, partial }
//
//   awards  opendkp_auctions of the last TONIGHT_H hours, with the character name resolved through
//           opendkp_loot_recent. This is the OpenDKP MIRROR, which the bot refreshes every ~30 minutes: a
//           live auction is in the bot's memory only (the site has no route to it), so "open" here means
//           bidding had not closed when the mirror last ran. Mostly an auction shows up already closed.
//   looted  looted_items (what the raiders' agents saw picked up) in the same window, folded by item.
//   kills   curated bosses (bosses_local) killed tonight: ended, not classified out, damage > 0 (the
//           /parses rule, web/lib/bossFilter.ts).
//   spawns  bot_boards timers opening in the next 24 hours (the table /boards mirrors).
//
// Each part is read on its own: one that fails is left empty and `partial` is set, so the page says "some
// of this did not load" instead of showing an empty list as fact. Every read is bounded (limit <= 100) for
// the 1,000-row cap and test/db-read-discipline-web.test.js. The answer is shared for FEED_CACHE_MS, so a
// room of viewers polling costs the database one read of each, not forty.
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { curatedNpcIds } from '@/lib/bossFilter';
import { cleanBossName } from '@/lib/format';
import {
  FEED_CACHE_MS, SCREEN_GUILD, buildAwards, groupLooted, sinceIso,
  type AwardRow, type FeedKill, type FeedSpawn, type LootedRow, type NameRow, type ScreenFeed,
} from '@/lib/raidScreen';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });

type Db = ReturnType<typeof supabaseAdmin>;

let cache: { at: number; body: ScreenFeed } | null = null;

async function loadAwards(db: Db, since: string, nowMs: number) {
  const { data, error } = await db.from('opendkp_auctions')
    .select('auction_id, item_name, winner, bid_amount, end_at')
    .gte('end_at', since)
    .order('end_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as AwardRow[];
  let names: NameRow[] = [];
  if (rows.length) {
    const named = await db.from('opendkp_loot_recent')
      .select('auction_id, character_name')
      .in('auction_id', rows.map(r => r.auction_id))
      .limit(100);
    // The names are a nicety: without them the bidder's login is shown, so a failed read is not a failure.
    if (!named.error) names = (named.data ?? []) as NameRow[];
  }
  return buildAwards(rows, names, nowMs);
}

async function loadLooted(db: Db, since: string) {
  const { data, error } = await db.from('looted_items')
    .select('looter_character, item_name, looted_at')
    .eq('guild_id', SCREEN_GUILD)
    .gte('looted_at', since)
    .order('looted_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return groupLooted((data ?? []) as LootedRow[]);
}

type KillRow = { id: string; ended_at: string | null; duration_sec: number | null; eqemu_npc_types: { name: string | null } | null };

async function loadKills(db: Db, since: string): Promise<FeedKill[]> {
  const curated = await curatedNpcIds(db);
  if (!curated.length) return [];
  const { data, error } = await db.from('encounters')
    .select('id, ended_at, duration_sec, eqemu_npc_types ( name )')
    .in('npc_id', curated)
    .gte('started_at', since)
    .not('ended_at', 'is', null)
    .is('classification', null)
    .gt('total_damage', 0)
    .order('started_at', { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as KillRow[]).map(r => ({
    id: r.id,
    name: cleanBossName(r.eqemu_npc_types?.name),
    at: r.ended_at,
    durationSec: r.duration_sec,
  }));
}

type SpawnRow = { boss_id: string; name: string | null; zone: string | null; next_spawn: string };

async function loadSpawns(db: Db, nowMs: number): Promise<FeedSpawn[]> {
  // From ten minutes ago, so a window that has just opened still shows as "now".
  const { data, error } = await db.from('bot_boards')
    .select('boss_id, name, zone, next_spawn')
    .gte('next_spawn', new Date(nowMs - 10 * 60_000).toISOString())
    .lte('next_spawn', new Date(nowMs + 24 * 3600_000).toISOString())
    .order('next_spawn', { ascending: true })
    .limit(12);
  if (error) throw new Error(error.message);
  return ((data ?? []) as SpawnRow[]).map(r => ({
    id: r.boss_id, name: cleanBossName(r.name), zone: r.zone, at: r.next_spawn,
  }));
}

export async function GET() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail(401, 'unauthorized');

  const nowMs = Date.now();
  if (cache && nowMs - cache.at < FEED_CACHE_MS) return NextResponse.json(cache.body, { headers: NO_STORE });

  try {
    const db = supabaseAdmin();
    const since = sinceIso(nowMs);
    const [awards, looted, kills, spawns] = await Promise.allSettled([
      loadAwards(db, since, nowMs), loadLooted(db, since), loadKills(db, since), loadSpawns(db, nowMs),
    ]);
    const body: ScreenFeed = {
      at: new Date(nowMs).toISOString(),
      awards: awards.status === 'fulfilled' ? awards.value : [],
      looted: looted.status === 'fulfilled' ? looted.value : [],
      kills: kills.status === 'fulfilled' ? kills.value : [],
      spawns: spawns.status === 'fulfilled' ? spawns.value : [],
      partial: [awards, looted, kills, spawns].some(r => r.status === 'rejected'),
    };
    // A feed with a hole in it is not kept: the next poll tries again.
    if (!body.partial) cache = { at: nowMs, body };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch {
    return fail(502, 'feed unavailable');
  }
}
