// The reads behind a raid session review: one ShareWindow in, one SessionBundle (plus the replay's night) out.
// Server-side, service-role client. The members' page (/raid/session) and the public share page
// (/share/raid/[token]) both call `loadSessionReview`, so what a member sees and what a share shows are the same
// numbers; only the window's source differs (a member's query string, or the share row).
//
// BOUNDED, on purpose. Every table that has a time column is read with `gte(col, from).lt(col, to)` on the
// window: raid_track_minutes.minute_at, encounters.ended_at, looted_items.looted_at, loot_observations.posted_at,
// roll_sets.started_at, roll_set_overrides.started_at, raid_attendance_ticks.scheduled_for and opendkp_raids.ts.
// The tables with none (encounter_players, opendkp_ticks, opendkp_loot_recent, bosses_local) are read only for ids
// that one of those reads returned. test/raid-share.test.js drives this file against a recording client and fails
// if a read comes back without the window on it.
//
// Every read is bounded for the 1,000-row cap (test/db-read-discipline-web.test.js): pages through selectAll on
// a unique order, `in (...)` lists chunked. The bounds are written out on each chain, not applied by a helper, so
// that scan sees the whole chain (`.range` included).
//
// OPENDKP, honestly: opendkp_ticks has no time of its own and opendkp_loot_recent only a raid date, so both are
// reached through opendkp_raids whose `ts` (the day the raid was created) is in the window. A morning session
// that no officer made an OpenDKP raid for has none, and the review says "none in this window" rather than
// guessing from the date.
//
// COST: the attendance is read from the recording's own `who` lists, so a 3.5-hour session reads ~5 MB of
// minute rows once (30 rows a page). The finished bundle is kept in this process for five minutes per window.
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAll } from './selectAll';
import { GUILD_TAG } from './guild';
import { chunk } from './replayBosses';
import { windowIso, type ShareWindow } from './raidShare';
import { loadOptedOut } from './raidShareLookup';
import {
  attendanceFromMinutes, buildKills, buildLoot, buildRolls, buildTicks, windowNight,
  type CapturedTickIn, type DkpLootIn, type DkpTickIn, type EncounterIn, type LootedIn,
  type ObservedIn, type PlayerIn, type SessionBundle,
} from './raidSession';
import type { NightSummary, NightMinute } from './raidReplay';
import type { RollOverride, RollSetRow } from './rolls';

export type SessionReview = { bundle: SessionBundle; night: NightSummary | null };

const MINUTE_PAGE = 30;       // rows of ~25 KB each: ~750 KB a response
// The top-five list is read for this many fights at most (curated bosses first, then the biggest). It was 60, which
// left the later fights of a long night with no parse line at all. A night is one window of under 24 hours and a
// raid night's unclassified fights number in the low hundreds, so 400 covers all of one; the cost is 20 ids a read,
// at most 20 reads, once per window (the bundle is cached below). The full table of any fight loads on demand.
const TOP_FIGHTS = 400;
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: SessionReview }>();

type MinuteRowIn = NightMinute & { data: string };
type RaidIn = { raid_id: number };
type DkpTickRaw = DkpTickIn & { raid_id: number; tick_id: number };

async function readAll(sb: SupabaseClient, win: ShareWindow) {
  const { from: lo, to: hi } = windowIso(win);
  const [minutes, encounters, looted, observed, rollRows, overrides, captured, raids] = await Promise.all([
    selectAll<MinuteRowIn>((from, to) => sb.from('raid_track_minutes')
      .select('minute_at, night_key, zones, raiders, data')
      .eq('guild_id', GUILD_TAG)
      .gte('minute_at', lo).lt('minute_at', hi)
      .order('minute_at')
      .range(from, to), { page: MINUTE_PAGE }),
    selectAll<EncounterIn>((from, to) => sb.from('encounters')
      .select('id, npc_id, started_at, ended_at, duration_sec, total_damage, zone_short, eqemu_npc_types(name)')
      .eq('guild_id', GUILD_TAG)
      .is('classification', null)
      .gte('ended_at', lo).lt('ended_at', hi)
      .order('id')
      .range(from, to)),
    selectAll<LootedIn>((from, to) => sb.from('looted_items')
      .select('looter_character, item_name, zone, looted_at, from_own_pet')
      .eq('guild_id', GUILD_TAG)
      .gte('looted_at', lo).lt('looted_at', hi)
      .order('id')
      .range(from, to)),
    selectAll<ObservedIn>((from, to) => sb.from('loot_observations')
      .select('item_name, winner_character, dkp_amount, posted_at')
      .eq('guild_id', GUILD_TAG)
      .gte('posted_at', lo).lt('posted_at', hi)
      .order('id')
      .range(from, to)),
    selectAll<RollSetRow & { id: string }>((from, to) => sb.from('roll_sets')
      .select('id, roll_from, roll_to, item, qty, zone, rolls, started_at, last_at')
      .eq('guild_id', GUILD_TAG)
      .gte('started_at', lo).lt('started_at', hi)
      .order('started_at').order('id')
      .range(from, to)),
    selectAll<RollOverride & { id: string }>((from, to) => sb.from('roll_set_overrides')
      .select('id, roll_from, roll_to, started_at, hidden, item')
      .eq('guild_id', GUILD_TAG)
      .gte('started_at', lo).lt('started_at', hi)
      .order('id')
      .range(from, to)),
    selectAll<CapturedTickIn & { id: string }>((from, to) => sb.from('raid_attendance_ticks')
      .select('id, description, scheduled_for, names')
      .eq('guild_id', GUILD_TAG)
      .gte('scheduled_for', lo).lt('scheduled_for', hi)
      .order('id')
      .range(from, to)),
    selectAll<RaidIn>((from, to) => sb.from('opendkp_raids')
      .select('raid_id')
      .gte('ts', lo).lt('ts', hi)
      .order('raid_id')
      .range(from, to)),
  ]);
  return { minutes, encounters, looted, observed, rollRows, overrides, captured, raids };
}

export async function loadSessionReview(sb: SupabaseClient, win: ShareWindow): Promise<SessionReview> {
  const key = `${GUILD_TAG}|${win.fromMs}|${win.toMs}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const [r, optedOut] = await Promise.all([readAll(sb, win), loadOptedOut(sb, GUILD_TAG)]);

  // Ids that the windowed reads returned: the opendkp children, the parses and the curated-boss flags.
  const raidIds = r.raids.map(x => x.raid_id);
  const dkpTicks: DkpTickRaw[] = [];
  const dkpLoot: DkpLootIn[] = [];
  for (const ids of chunk(raidIds, 50)) {
    dkpTicks.push(...await selectAll<DkpTickRaw>((from, to) => sb.from('opendkp_ticks')
      .select('tick_id, raid_id, description, attendees')
      .in('raid_id', ids)
      .order('tick_id')
      .range(from, to)));
    dkpLoot.push(...await selectAll<DkpLootIn>((from, to) => sb.from('opendkp_loot_recent')
      .select('raid_id, item_name, character_name, dkp')
      .in('raid_id', ids)
      .order('raid_date').order('character_name').order('item_name').order('auction_id')
      .range(from, to)));
  }

  const npcIds = [...new Set(r.encounters.map(e => e.npc_id).filter((n): n is number => typeof n === 'number'))];
  const bossIds = new Set<number>();
  for (const ids of chunk(npcIds, 100)) {
    const { data, error } = await sb.from('bosses_local')
      .select('npc_id')
      .eq('auto_registered', false)
      .in('npc_id', ids)
      .limit(100);   // a literal, equal to the chunk: one row at most per id asked for
    if (error) throw error;
    for (const b of (data ?? []) as { npc_id: number }[]) bossIds.add(b.npc_id);
  }

  // Parses: the curated bosses first, then the biggest of the rest, capped.
  const fights = [...r.encounters]
    .sort((a, b) => Number(bossIds.has(b.npc_id ?? -1)) - Number(bossIds.has(a.npc_id ?? -1)) || (b.total_damage ?? 0) - (a.total_damage ?? 0))
    .slice(0, TOP_FIGHTS);
  const players: PlayerIn[] = [];
  for (const ids of chunk(fights.map(f => f.id), 20)) {
    players.push(...await selectAll<PlayerIn>((from, to) => sb.from('encounter_players')
      .select('encounter_id, character_name, total_damage, dps')
      .in('encounter_id', ids)
      .order('encounter_id').order('character_name')
      .range(from, to)));
  }

  const bundle: SessionBundle = {
    fromMs: win.fromMs,
    toMs: win.toMs,
    minutesRecorded: r.minutes.length,
    attendance: attendanceFromMinutes(r.minutes, optedOut),
    ticks: buildTicks(r.captured, dkpTicks, optedOut),
    kills: buildKills(r.encounters, players, bossIds, optedOut),
    loot: buildLoot(r.looted, r.observed, dkpLoot, optedOut),
    rolls: buildRolls(r.rollRows, r.overrides, r.looted, optedOut),
  };
  const value: SessionReview = { bundle, night: windowNight(r.minutes, win) };

  if (cache.size >= 20) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), value });
  return value;
}
