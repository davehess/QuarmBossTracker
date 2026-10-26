// The reads behind a raid session review: one ShareWindow in, one SessionBundle (plus the replay's night) out.
// Server-side, service-role client. The members' page (/raid/session) and the public share page
// (/share/raid/[token]) both call `loadSessionReview`, so what a member sees and what a share shows are the same
// numbers; only the window's source differs (a member's query string, or the share row).
//
// BOUNDED, on purpose. Every table that has a time column is read with `gte(col, from).lt(col, to)` on the
// window: raid_track_minutes.minute_at, encounters.ended_at, looted_items.looted_at, loot_observations.posted_at,
// roll_sets.started_at, roll_set_overrides.started_at, raid_attendance_ticks.scheduled_for, opendkp_raids.ts and
// opendkp_auctions.end_at (the bid winners, lib/raidSessionBids.ts).
// The tables with none (encounter_players, opendkp_ticks, opendkp_loot_recent, opendkp_auction_bids, bosses_local)
// are read only for ids that one of those reads returned. test/raid-share.test.js drives this file against a recording client and fails
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
import { anonSalt, loadAnon } from './raidShareLookup';
import { loadBidders } from './raidSessionBids';
import {
  LISTED_MARKS, anonSig, attendanceFromMinutes, buildKills, buildLoot, buildRolls, buildTicks, nameKey, npcZoneId, windowNight,
  type AnonMap, type CapturedTickIn, type DkpLootIn, type DkpTickIn, type EncounterIn, type LootedIn,
  type ObservedIn, type PlayerIn, type SessionBundle,
} from './raidSession';
import { buildGroups, groupOfFight, inGroupAt, narrowRows, type GroupIndex, type RaidGroup } from './sessionGroups';
import { detectRaidChange, whoSeries, type RaidChange } from './raidSplit';
import { rosterCuts } from './liveRaidWindow';
import type { NightSummary, NightMinute } from './raidReplay';
import type { RollOverride, RollSetRow } from './rolls';

// `change` is a time and two counts, never a name (raidSplit.ts); only the members' page uses it.
// `breaks` (only with opts.breaks, which the members' page asks for) is the instants at which the roster turns over, found again inside each
// side of `change`: times only, never a name (liveRaidWindow.ts rosterCuts).
//
// `groups` (only with opts.groups or opts.group, the members' page) is the raids the recording holds inside the window
// (lib/sessionGroups.ts); `group` is the one this review is narrowed to, when `opts.group` named one that exists. A
// narrowed review has its attendance, replay minutes, fights and loot cut to that raid. The window's ticks, rolls and bids
// stay whole: they are not attributed to a raid anywhere upstream.
export type SessionReview = {
  bundle: SessionBundle; night: NightSummary | null; change: RaidChange | null; breaks?: number[];
  groups?: RaidGroup[]; group?: string | null;
  /** Server-side only (who was in each raid minute by minute): the page uses it to scope the deaths; it is never sent to the browser. */
  groupIndex?: GroupIndex;
};
export type ReviewOpts = { breaks?: boolean; groups?: boolean; group?: string | null; groupWin?: ShareWindow | null };

const MINUTE_PAGE = 30;       // rows of ~25 KB each: ~750 KB a response
// The top-five list is read for this many fights at most (curated bosses first, then the biggest). It was 60, which
// left the later fights of a long night with no parse line at all. A night is one window of under 24 hours and a
// raid night's unclassified fights number in the low hundreds, so 400 covers all of one; the cost is 20 ids a read,
// at most 20 reads, once per window (the bundle is cached below). The full table of any fight loads on demand.
const TOP_FIGHTS = 400;
const CACHE_MS = 5 * 60_000;
// Kept with the labels it was built with (`sig`): a bundle is reused only while the opt-outs and the winners are
// what they were, so an opt-out leaves a cached review within the minute loadOptedOut is held, not in five.
const cache = new Map<string, { at: number; sig: string; value: SessionReview }>();

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
      .select('id, npc_id, started_at, ended_at, duration_sec, total_damage, zone_short, classification, is_wipe, eqemu_npc_types(name)')
      .eq('guild_id', GUILD_TAG)
      .or(LISTED_MARKS)   // ours, wipes and another guild's: the last two are listed with a tag, never counted as kills
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

// The raids of a window, kept five minutes per window so the replay route (15 minutes of rows a request) does not
// read the whole window again for each slice. Filled by the review load and by loadGroupIndex.
const groupCache = new Map<string, { at: number; sig: string; index: GroupIndex }>();
const groupKey = (win: ShareWindow) => `${GUILD_TAG}|${win.fromMs}|${win.toMs}`;
function rememberGroups(win: ShareWindow, sig: string, index: GroupIndex) {
  if (groupCache.size >= 20) groupCache.delete(groupCache.keys().next().value as string);
  groupCache.set(groupKey(win), { at: Date.now(), sig, index });
}

/**
 * The raids in a window (lib/sessionGroups.ts), for the routes that serve a narrowed slice. Cached per window; a miss
 * reads the window's minute rows once (the same ~5 MB the review reads).
 */
export async function loadGroupIndex(sb: SupabaseClient, win: ShareWindow, anon?: AnonMap): Promise<GroupIndex> {
  const a = anon ?? await loadAnon(sb, GUILD_TAG, win);
  const sig = anonSig(a);
  const hit = groupCache.get(groupKey(win));
  if (hit && hit.sig === sig && Date.now() - hit.at < CACHE_MS) return hit.index;
  const { from: lo, to: hi } = windowIso(win);
  const minutes = await selectAll<{ minute_at: string; data: string }>((from, to) => sb.from('raid_track_minutes')
    .select('minute_at, data')
    .eq('guild_id', GUILD_TAG)
    .gte('minute_at', lo).lt('minute_at', hi)
    .order('minute_at')
    .range(from, to), { page: MINUTE_PAGE });
  const index = buildGroups(minutes, a);
  rememberGroups(win, sig, index);
  return index;
}

export async function loadSessionReview(sb: SupabaseClient, win: ShareWindow, opts: ReviewOpts = {}): Promise<SessionReview> {
  const key = `${GUILD_TAG}|${win.fromMs}|${win.toMs}${opts.breaks ? '|b' : ''}${opts.groups || opts.group ? '|g' : ''}${opts.group ? `:${opts.group}` : ''}${opts.groupWin ? `@${opts.groupWin.fromMs}.${opts.groupWin.toMs}` : ''}`;
  const anon = await loadAnon(sb, GUILD_TAG, win);
  const sig = anonSig(anon);
  const hit = cache.get(key);
  if (hit && hit.sig === sig && Date.now() - hit.at < CACHE_MS) return hit.value;

  const [r, bidders] = await Promise.all([readAll(sb, win), loadBidders(sb, GUILD_TAG, win, anonSalt())]);

  // Which raids the window holds, and whether this review is narrowed to one of them.
  // A part of a larger window is cut by the raids found in the LARGER one (opts.groupWin): ids only mean something there.
  const wantGroups = !!(opts.groups || opts.group);
  const index = !wantGroups ? null
    : opts.groupWin ? await loadGroupIndex(sb, opts.groupWin, anon)
    : buildGroups(r.minutes, anon);
  if (index && !opts.groupWin) rememberGroups(win, sig, index);
  const group = index && opts.group && index.members.has(opts.group) ? opts.group : null;
  const inRaid = (name: string | null | undefined, atMs: number | null) =>
    !index || !group || (!!name && (atMs == null ? false : inGroupAt(index, group, nameKey(name), atMs)));
  const minutes = index && group ? narrowRows(r.minutes, index, group) : r.minutes;

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

  // A narrowed review keeps a fight when the raid holds at least half of its damage dealers; a fight with no parse
  // at all cannot be placed, so it is left out of a raid's list (it is still in the whole window's).
  let encounters = r.encounters;
  if (index && group) {
    const namesOf = new Map<string, string[]>();
    for (const p of players) {
      const a = namesOf.get(p.encounter_id);
      if (a) a.push(nameKey(p.character_name)); else namesOf.set(p.encounter_id, [nameKey(p.character_name)]);
    }
    encounters = r.encounters.filter(e => {
      const at = Date.parse(e.ended_at ?? e.started_at);
      return Number.isFinite(at) && groupOfFight(index, at, namesOf.get(e.id) ?? []) === group;
    });
  }

  // Zones for fights whose row has none: the NPC id carries it (eqemu_npc_types.id = zoneid * 1000 + n).
  const zoneNames = new Map<number, string>();
  const zoneIds = [...new Set(encounters.filter(e => !e.zone_short).map(e => npcZoneId(e.npc_id)).filter((z): z is number => z != null))];
  for (const ids of chunk(zoneIds, 100)) {
    const { data, error } = await sb.from('eqemu_zone')
      .select('zone_id, short_name')
      .in('zone_id', ids)
      .limit(100);   // a literal, equal to the chunk: one row per id asked for
    if (error) throw error;
    for (const z of (data ?? []) as { zone_id: number; short_name: string | null }[]) if (z.short_name) zoneNames.set(z.zone_id, z.short_name);
  }

  const bundle: SessionBundle = {
    fromMs: win.fromMs,
    toMs: win.toMs,
    minutesRecorded: minutes.length,
    attendance: attendanceFromMinutes(minutes, anon),
    ticks: buildTicks(r.captured, dkpTicks, anon),
    kills: buildKills(encounters, players, bossIds, anon, zoneNames),
    loot: buildLoot(
      r.looted.filter(l => inRaid(l.looter_character, Date.parse(l.looted_at))),
      r.observed.filter(o => inRaid(o.winner_character, Date.parse(o.posted_at))),
      dkpLoot, anon),
    rolls: buildRolls(r.rollRows, r.overrides, r.looted, anon),
    bidders,
  };
  const who = whoSeries(minutes);
  const value: SessionReview = { bundle, night: windowNight(minutes, win), change: detectRaidChange(who) };
  if (opts.breaks) value.breaks = rosterCuts(who);
  if (index) { value.groups = index.groups; value.group = group; value.groupIndex = index; }

  if (cache.size >= 20) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), sig, value });
  return value;
}
