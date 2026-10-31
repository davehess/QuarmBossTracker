// The reads behind the /me?v=b hub. Each block on the page calls the one it needs, so a slow read holds only its own
// block (the guild lead, 2026-10-31: "it needs to load immediately then fill in"). Everything here is a read the classic
// /me already makes, with the same helper or the same columns: the roster read is the shared per-request one, levels
// are the me_levels RPC, the parse numbers are me_char_stats, live state and the upload heartbeat are the classic
// page's own selects. The functions that more than one block calls are wrapped in React's cache(), so a request reads
// each once.

import { cache } from 'react';
import { supabaseAdmin } from '@/lib/supabase';
import { ownedCharacters } from '@/lib/ownedCharacters';
import { loadRoster } from '@/lib/roster';
import { selectAll } from '@/lib/selectAll';
import { GUILD_TAG } from '@/lib/guild';
import { fetchCharAggs, fetchLiveStateRows, ilikeAnyFilter, type CharAgg } from '@/lib/capSafeReads';
import { loadLevels, tierOf } from '@/lib/listableChars';
import { isRoot, pickMain, lootSummary, topFights, NIGHT_ROLLOVER_MS, sessionForNight, type HubChar, type MainPick, type LootLite, type LootSummary } from '@/lib/meHub';
import { readParseSeries, type ParseFight } from '@/lib/parseTrend';
import { dayKey, RAID_TZ } from '@/lib/format';
import { zonedDayRangeUtc } from '@/lib/raidReview';
import { windowStart, buildNights, nightNames, type NightRaid, type NightTick } from '@/lib/raidHeatmap';
import { summarizeNights, type NightMinute } from '@/lib/raidReplay';

/** The member's characters (the whole family and household), best first: level high to low, a root above its alts. */
export const loadHubChars = cache(async (userId: string): Promise<HubChar[]> => {
  const owned = await ownedCharacters(userId);
  if (owned.length === 0) return [];
  const roster = await loadRoster();
  const flags = new Map(roster.map(r => [r.name.toLowerCase(), r]));
  // One call for the whole family, the max over /who and the spellbook taken in SQL, as the classic page does
  // (listableChars.ts loadLevels is the shared me_levels reader).
  const levels = await loadLevels(supabaseAdmin(), owned.map(c => c.name));
  return owned
    .map((c): HubChar => {
      const f = flags.get(c.name.toLowerCase());
      const level = levels.get(c.name.toLowerCase()) ?? null;
      return {
        name: c.name, main_name: c.main_name, class: c.class, rank: c.rank, active: !!c.active, level,
        tier: tierOf({ rank: c.rank, level, hidden: c.hidden_from_lists }),
        hidden: !!c.hidden_from_lists,
        excludeStats: !!f?.exclude_from_stats,
        excludeInventory: !!f?.exclude_inventory,
      };
    })
    .sort((a, b) =>
      (b.level ?? -1) - (a.level ?? -1)
      || (isRoot(a) === isRoot(b) ? 0 : isRoot(a) ? -1 : 1)
      || a.name.localeCompare(b.name));
});

export type Heartbeat = { lastSeen: string; lastFight: string | null; agentVersion: string | null };

/** Newest upload per character on ANY stream (the classic banner's rule), keyed by lower-cased name. */
export const loadHubHeartbeats = cache(async (userId: string): Promise<Map<string, Heartbeat>> => {
  const chars = await loadHubChars(userId);
  const filter = ilikeAnyFilter('character', chars.map(c => c.name));
  const out = new Map<string, Heartbeat>();
  if (!filter) return out;
  type StatRow = { character: string | null; endpoint: string | null; last_uploaded_at: string | null; agent_version: string | null };
  const admin = supabaseAdmin();
  const rows = await selectAll<StatRow>((from, to) => admin
    .from('agent_upload_stats')
    .select('character, endpoint, last_uploaded_at, agent_version')
    .eq('guild_id', GUILD_TAG)
    .or(filter)
    .order('character').order('endpoint')
    .range(from, to));
  for (const r of rows) {
    const key = String(r.character || '').toLowerCase();
    if (!key || !r.last_uploaded_at) continue;
    const at = new Date(r.last_uploaded_at).toISOString();
    const cur = out.get(key) ?? { lastSeen: at, lastFight: null, agentVersion: r.agent_version };
    if (at >= cur.lastSeen) { cur.lastSeen = at; cur.agentVersion = r.agent_version ?? cur.agentVersion; }
    if (r.endpoint === 'encounter' && (!cur.lastFight || at > cur.lastFight)) cur.lastFight = at;
    out.set(key, cur);
  }
  return out;
});

export type ResolvedMain = { char: HubChar; explicit: boolean };

/** The member's main. Only a member with no root character pays for the upload read (to name the stand-in). */
export const loadHubMain = cache(async (userId: string): Promise<ResolvedMain | null> => {
  const chars = await loadHubChars(userId);
  const hasRoot = chars.some(c => !c.excludeStats && isRoot(c));
  const beats = hasRoot ? new Map<string, Heartbeat>() : await loadHubHeartbeats(userId).catch(() => new Map<string, Heartbeat>());
  const pick: MainPick | null = pickMain(chars, n => beats.get(n.toLowerCase())?.lastSeen ?? null);
  const char = pick ? chars.find(c => c.name === pick.name) : undefined;
  return pick && char ? { char, explicit: pick.explicit } : null;
});

export type MainStats = {
  agg: CharAgg | null;
  recent: { id: string; npc: string | null; startedAt: string | null; damage: number }[];
};

/** Parse numbers and the latest fights for one character (the classic card's Parses and Recent encounters panels). */
export const loadMainStats = cache(async (name: string): Promise<MainStats> => {
  const admin = supabaseAdmin();
  const agg = (await fetchCharAggs(admin, [name])).get(name.toLowerCase()) ?? null;
  if (!agg || agg.recent.length === 0) return { agg, recent: [] };
  const npcIds = agg.recent.map(e => e.npc_id).filter((x): x is number => x != null);
  const { data } = npcIds.length
    ? await admin.from('eqemu_npc_types').select('id, name').in('id', npcIds).limit(20)
    : { data: [] };
  const npcName = new Map<number, string>(
    ((data ?? []) as { id: number; name: string }[]).map(n => [n.id, n.name.replace(/_/g, ' ').replace(/^#/, '')]));
  return {
    agg,
    recent: agg.recent.slice(0, 5).map(e => ({
      id: e.id, npc: e.npc_id != null ? (npcName.get(e.npc_id) ?? null) : null, startedAt: e.started_at, damage: e.damage,
    })),
  };
});

/** Last-seen zone from the live-state snapshot. */
export async function loadMainZone(name: string): Promise<{ zone: string | null; updatedAt: string | null } | null> {
  const rows = await fetchLiveStateRows(supabaseAdmin(), [name]);
  const r = rows.find(x => String(x.character || '').toLowerCase() === name.toLowerCase());
  return r ? { zone: r.zone_name ?? null, updatedAt: r.updated_at ?? null } : null;
}

/** The signed-in member's Discord display name, or null when the account is not linked to the guild yet. */
export const loadHubPack = cache(async (userId: string): Promise<{ discordId: string; nickname: string | null } | null> => {
  const { data } = await supabaseAdmin()
    .from('wolfpack_members')
    .select('discord_id, nickname')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.discord_id ? { discordId: String(data.discord_id), nickname: (data.nickname as string | null) ?? null } : null;
});

export type ToggleFlags = {
  tell_relay: boolean | null; tell_dm: boolean | null;
  show_inventory_publicly: boolean | null; show_quests_publicly: boolean | null;
};

/** The remaining per-character switches ExclusionToggles shows, keyed by lower-cased name. */
export async function loadToggleFlags(names: string[]): Promise<Map<string, ToggleFlags>> {
  const out = new Map<string, ToggleFlags>();
  if (names.length === 0) return out;
  const { data } = await supabaseAdmin()
    .from('characters')
    .select('name, tell_relay, tell_dm, show_inventory_publicly, show_quests_publicly')
    .eq('guild_id', GUILD_TAG)
    .in('name', names);
  for (const r of (data ?? []) as (ToggleFlags & { name: string })[]) out.set(r.name.toLowerCase(), r);
  return out;
}

export type MainFights = { byDamage: ParseFight[]; byDps: ParseFight[]; considered: number; truncated: boolean };
const FIGHTS_CAP = 400;   // the same cap /me/parses draws

/**
 * The main's best boss fights by damage and by DPS, picked from the newest FIGHTS_CAP boss fights since parses became
 * comparable. It is the series /me/parses and the Mimic tab read (my_parse_series_v2), narrowed to the one character;
 * the function itself leaves out a character that opted out of stats.
 */
export const loadMainFights = cache(async (userId: string, name: string): Promise<MainFights> => {
  const pack = await loadHubPack(userId);
  if (!pack) return { byDamage: [], byDps: [], considered: 0, truncated: false };
  const { data, error } = await supabaseAdmin().rpc('my_parse_series_v2', {
    p_discord_id: pack.discordId, p_since: null, p_until: null, p_bosses_only: true,
    p_character: name, p_cap: FIGHTS_CAP, p_zone: null, p_search: null,
  });
  if (error) throw new Error(error.message);
  const series = readParseSeries(data);
  const mine = series.fights.filter(f => f.char.toLowerCase() === name.toLowerCase());
  return { byDamage: topFights(mine, 'dmg'), byDps: topFights(mine, 'dps'), considered: mine.length, truncated: series.truncated };
});

/**
 * The main's latest loot and the DKP spent, from the OpenDKP mirror (opendkp_loot_recent, the classic card's source).
 * Awards are read for every character the member holds that has not opted out of stats, the family the guild pools
 * DKP onto, then summed per main and across all. The mirror carries what was spent, not the live balance.
 */
export const loadMainLoot = cache(async (userId: string, mainName: string): Promise<LootSummary> => {
  const names = (await loadHubChars(userId)).filter(c => !c.excludeStats).map(c => c.name);
  if (names.length === 0) return lootSummary([], mainName);
  const admin = supabaseAdmin();
  const rows = await selectAll<LootLite>((from, to) => admin
    .from('opendkp_loot_recent')
    .select('character_name, item_name, dkp, raid_date, raid_name')
    .in('character_name', names)
    .order('raid_date', { ascending: false })
    .order('auction_id')
    .order('character_name')
    .order('item_name')
    .range(from, to));
  return lootSummary(rows, mainName);
});

export type HubRaid = { date: string; names: string[]; ticks: number; from: number | null; to: number | null };
const RAIDS_SHOWN = 5;
const RAIDS_WINDOW_DAYS = 45;

/**
 * The latest raid nights the main was ticked into, each with the recorded session of that night when there is one.
 * The nights are the classic attendance rule (an official OpenDKP raid, a tick the character is in), for the main
 * alone. A night's session is the guild-raid stretch of raid_track_minutes starting that night; a night nobody
 * recorded has none, and the block says so.
 */
export async function loadMainRaids(name: string): Promise<HubRaid[]> {
  const admin = supabaseAdmin();
  const todayKey = dayKey(new Date().toISOString(), RAID_TZ);
  const { startIso } = zonedDayRangeUtc(windowStart(todayKey, RAIDS_WINDOW_DAYS), RAID_TZ);
  const raids = await selectAll<NightRaid>((from, to) => admin
    .from('opendkp_raids')
    .select('raid_id, ts, name')
    .gte('ts', startIso)
    .order('raid_id')
    .range(from, to));
  if (raids.length === 0) return [];
  const mine = await selectAll<NightTick>((from, to) => admin
    .from('opendkp_ticks')
    .select('raid_id, tick_id')
    .in('raid_id', raids.map(r => r.raid_id))
    .overlaps('attendees', [name])
    .order('tick_id')
    .range(from, to));
  const nights = [...buildNights(raids, mine).values()]
    .filter(n => n.tickIds.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, RAIDS_SHOWN);
  if (nights.length === 0) return [];

  const { startIso: recFrom } = zonedDayRangeUtc(nights[nights.length - 1].date, RAID_TZ);
  const minutes = await selectAll<NightMinute>((from, to) => admin
    .from('raid_track_minutes')
    .select('night_key, minute_at, zones, raiders')
    .eq('guild_id', GUILD_TAG)
    .gte('minute_at', recFrom)
    .order('minute_at')
    .range(from, to)).catch(() => [] as NightMinute[]);
  const sessions = summarizeNights(minutes).flatMap(n => n.sessions);
  const nightOf = (ms: number) => dayKey(new Date(ms - NIGHT_ROLLOVER_MS).toISOString(), RAID_TZ);
  return nights.map(n => {
    const s = sessionForNight(n.date, sessions, nightOf);
    return { date: n.date, names: nightNames(n), ticks: n.tickIds.length, from: s?.from ?? null, to: s?.to ?? null };
  });
}
