// Full-set reads for the pages the 2026-10-04 audit found reading a SILENTLY TRUNCATED set.
//
// PostgREST returns at most 1,000 rows per response (Supabase's `max-rows`) and says nothing:
// no error, no flag, a short array and a 200. Neither `.limit(N > 1000)` nor a one-call
// `.range(0, N)` raises it (both verified live on 2026-10-04), and a set-returning RPC or a VIEW
// is capped exactly like a table. The fixes here are of two kinds:
//   · page the read with `selectAll` over a STABLE, UNIQUE `.order()`; or
//   · let SQL do the counting (an aggregate, or a `distinct on`) so the answer is a few rows.
// Each loader is a thin function over a Supabase client so a test can hand it a fake that
// ENFORCES the 1,000-row cap (test/_fake-supabase-js.js) and prove it still returns the whole set.
//
// What was truncated, and where it is used (the guild lead, 2026-10-04):
//   loadTicksForRaids       /parses attendance: 1,578 ticks, none of the last 30 days in the first 1,000
//   loadLootRecent          /parses + /raid/review: opendkp_loot_recent, 9,251 rows lifetime
//   loadLootSpend           /leaderboards: per-character DKP spent, summed in SQL
//   loadOffcardRollup       /parses: parses_offcard_rollup, 1,185 rows lifetime
//   loadReviewEncounters    /raid/review: curated encounters, 1,893 lifetime
//   loadNightSlows/Fires    /raid/review/[date]: one night is 8k-33k buff_casts and 1.3k-10.9k fires
//   loadEventsForEncounters /raid/review/[date]: 2,356 timeline events on one night
//   loadActiveBuffCasts     /raid: 3 h of buff_casts peaks at 14,900 rows
//   loadGuideKillRollup     /guide: kills per boss, 27,948 encounters
//   loadDropperCounts       /guide/[bossId], /db/item/[id]: distinct droppers per item
//   loadAwardsForItems      /guide/[bossId]: OpenDKP awards for a boss's drops
//   loadEncounterEvents     /parses/[id]: 11 encounters have more than 1,000 timeline events
//   loadAgentVersionsAround /parses/[id]: the newest agent version uploading near the fight
//   loadItemDrops           /db/item/[id]: 124 items have more than 500 droppers
//   loadSpawn2              /db/npc/[id]: 4 NPCs have more spawn points than the old limit
//   loadPvpBossKills        /pvp: boss timers, 90 days
//
// The SQL these RPCs call is supabase/migrations/20261004140700_cap_safe_raid.sql.
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAll } from './selectAll';

// ── OpenDKP ──────────────────────────────────────────────────────────────────

export type TickAttendees = { raid_id: number; attendees: string[] | null };

/** Every tick of the given raids. opendkp_ticks has no window column, so the raid ids ARE the
 *  window (the same shape as /raidhistory). Ordered on tick_id, the primary key. */
export async function loadTicksForRaids(sb: SupabaseClient, raidIds: number[]): Promise<TickAttendees[]> {
  if (raidIds.length === 0) return [];
  return selectAll<TickAttendees>((from, to) => sb
    .from('opendkp_ticks')
    .select('raid_id, attendees')
    .in('raid_id', raidIds)
    .order('tick_id')
    .range(from, to));
}

/** opendkp_loot_recent (a VIEW) from `sinceDate` (YYYY-MM-DD) or lifetime. Ordered on
 *  (raid_date, auction_id, character_name): auction_id alone is NOT unique — the view joins the
 *  winner to `characters`, and an OpenDKP id that matches two rows there repeats the auction
 *  (26 repeated ids on 2026-10-04) — so the character name breaks the tie. `columns` is the caller's select list; it need not include the order keys. */
export async function loadLootRecent<T>(sb: SupabaseClient, columns: string, sinceDate: string | null): Promise<T[]> {
  return selectAll<T>((from, to) => {
    let q = sb.from('opendkp_loot_recent').select(columns);
    if (sinceDate) q = q.gte('raid_date', sinceDate);
    return q.order('raid_date').order('auction_id').order('character_name').range(from, to) as any;
  });
}

export type LootSpendRow = { character_name: string; total_dkp: number; items: number };

/** The top spenders, summed in SQL (leaderboard_loot_spend): one row per character, so the answer
 *  never approaches the cap however many awards there are. */
export async function loadLootSpend(sb: SupabaseClient, sinceDate: string | null, limit = 20): Promise<LootSpendRow[]> {
  const { data } = await sb.rpc('leaderboard_loot_spend', { p_since: sinceDate, p_limit: limit });
  return ((data ?? []) as LootSpendRow[]).map(r => ({ ...r, total_dkp: Number(r.total_dkp) || 0 }));
}

// ── /parses ──────────────────────────────────────────────────────────────────

export type OffcardRollupRow = { day: string; zone_short: string | null; is_raid: boolean; kills: number; total_damage: number };

/** parses_offcard_rollup(p_since). The function now ends in ORDER BY day, zone_short, is_raid —
 *  the grouping key, so unique — which is what makes paging it stable. */
export async function loadOffcardRollup(sb: SupabaseClient, sinceIso: string | null): Promise<OffcardRollupRow[]> {
  const since = sinceIso ?? '1970-01-01T00:00:00Z';
  return selectAll<OffcardRollupRow>((from, to) => sb
    .rpc('parses_offcard_rollup', { p_since: since })
    .range(from, to));
}

// ── /raid/review ─────────────────────────────────────────────────────────────

/** The curated, non-empty encounters of the review index, newest first. (started_at, id) is
 *  unique: id is the primary key.
 *  Unlike the other loaders this one THROWS when a page fails: the review index reported a failed
 *  encounter read as an error message, and `selectAll` alone would turn it into an empty list of
 *  nights. The page's own try/catch shows the message. */
export async function loadReviewEncounters<T>(sb: SupabaseClient, curated: number[], sinceIso: string | null): Promise<T[]> {
  const state: { failure: { message?: string } | null } = { failure: null };
  const rows = await selectAll<T>((from, to) => {
    let q = sb
      .from('encounters')
      .select(`
        id, started_at, ended_at, duration_sec, total_damage, zone_short, classification,
        eqemu_npc_types ( name, zone_short ),
        encounter_players ( character_name, total_damage )
      `)
      .gt('total_damage', 0)
      .in('npc_id', curated);
    if (sinceIso) q = q.gte('started_at', sinceIso);
    return Promise.resolve(q.order('started_at', { ascending: false }).order('id').range(from, to) as any)
      .then((res: { data: T[] | null; error: { message?: string } | null }) => {
        if (res.error && !state.failure) state.failure = res.error;
        return res;
      });
  });
  if (state.failure) throw new Error(state.failure.message || 'encounter read failed');
  return rows;
}

/** The [start, end] a night's day-wide streams (slows, mechanics fires) are read over, in ISO.
 *  It is the night's fight span (first start - 30 min .. last kill + 30 min, from `activitySpan`)
 *  clipped to the Eastern day the page covers; null when the night has no fights.
 *  The old reads took the WHOLE day and cut it to the span in JS — after the row cap had already
 *  kept the first 1,000 rows of the day, which is pre-raid. */
export function nightStreamWindow(
  span: { startMs: number; endMs: number } | null,
  dayStartIso: string,
  dayEndIso: string,
): { startIso: string; endIso: string } | null {
  if (!span) return null;
  const lo = Math.max(span.startMs, Date.parse(dayStartIso));
  // The day's end is exclusive and the span's is inclusive; one millisecond keeps both true.
  const hi = Math.min(span.endMs, Date.parse(dayEndIso) - 1);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return null;
  return { startIso: new Date(lo).toISOString(), endIso: new Date(hi).toISOString() };
}

export type NightSlowRow = { target: string; spell_name: string; cast_at: string; observer: string | null };
export type NightFireRow = { at: string; subtype: string | null; actor: string | null; label: string | null };

/** Slow-spell casts in [startIso, endIso]. `spells` is the caller's lowercase slow-spell list
 *  (SLOW_SPELLS), so the list stays in one place; the RPC matches it case- and backtick-blind,
 *  the way isSlowSpell does. */
export async function loadNightSlows(
  sb: SupabaseClient, win: { startIso: string; endIso: string }, spells: string[],
): Promise<NightSlowRow[]> {
  return selectAll<NightSlowRow>((from, to) => sb
    .rpc('raid_night_slows', { p_guild_id: 'wolfpack', p_start: win.startIso, p_end: win.endIso, p_spells: spells })
    .range(from, to));
}

/** Callout fires in [startIso, endIso] with the personal-fail noise (`noise`, lowercase) dropped
 *  in SQL. Most of a night's 1.3k-10.9k fires ARE that noise. */
export async function loadNightFires(
  sb: SupabaseClient, win: { startIso: string; endIso: string }, noise: string[],
): Promise<NightFireRow[]> {
  return selectAll<NightFireRow>((from, to) => sb
    .rpc('raid_night_fires', { p_guild_id: 'wolfpack', p_start: win.startIso, p_end: win.endIso, p_noise: noise })
    .range(from, to));
}

/** Timeline events of the given encounters, oldest first. (at, id): id is the primary key. */
export async function loadEventsForEncounters<T>(sb: SupabaseClient, encounterIds: string[]): Promise<T[]> {
  if (encounterIds.length === 0) return [];
  return selectAll<T>((from, to) => sb
    .from('encounter_events')
    .select('encounter_id, at, kind, subtype, actor, label')
    .in('encounter_id', encounterIds)
    .order('at', { ascending: true })
    .order('id')
    .range(from, to) as any);
}

// ── /raid ────────────────────────────────────────────────────────────────────

export type ActiveCastRow = { target: string; spell_name: string; dur_ticks: number | null; cast_at: string };

/** The newest cast of each (target, spell) since `sinceIso` that has not yet run its duration out.
 *  Three hours of casts is up to 14,900 rows; what /raid needs is one per pair (a few hundred),
 *  so the RPC does the `distinct on` and the expiry test. */
export async function loadActiveBuffCasts(sb: SupabaseClient, sinceIso: string): Promise<ActiveCastRow[]> {
  return selectAll<ActiveCastRow>((from, to) => sb
    .rpc('raid_active_buff_casts', { p_guild_id: 'wolfpack', p_since: sinceIso })
    .range(from, to));
}

// ── /guide ───────────────────────────────────────────────────────────────────

export type GuideKillRollup = { npc_id: number; kills: number; median_duration_sec: number | null };

/** Complete kills and median kill time per curated boss, rolled up in SQL (guide_kill_rollup) over
 *  every encounter. The page used to pull 20,000 encounter rows and got 1,000 of 27,948, so every
 *  boss's kill count was understated by roughly 2.6x. At most one row per curated boss. */
export async function loadGuideKillRollup(sb: SupabaseClient): Promise<GuideKillRollup[]> {
  const { data } = await sb.rpc('guide_kill_rollup');
  return ((data ?? []) as GuideKillRollup[]).map(r => ({
    npc_id: r.npc_id,
    kills: Number(r.kills) || 0,
    median_duration_sec: r.median_duration_sec == null ? null : Number(r.median_duration_sec),
  }));
}

/** item_id -> how many DISTINCT NPCs drop it, counted in SQL (item_dropper_counts). The caller
 *  used to read every (item, npc) row of the loot tables — 24,108 for one boss — and count them. */
export async function loadDropperCounts(sb: SupabaseClient, itemIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (itemIds.length === 0) return out;
  const rows = await selectAll<{ item_id: number; droppers: number }>((from, to) => sb
    .rpc('item_dropper_counts', { p_item_ids: itemIds })
    .range(from, to));
  for (const r of rows) out.set(r.item_id, Number(r.droppers) || 0);
  return out;
}

export type AwardRowLite = { item_name: string; character_name: string | null; dkp: number | null };

/** OpenDKP awards of the named items. Ordered on id, the primary key. */
export async function loadAwardsForItems(sb: SupabaseClient, itemNames: string[]): Promise<AwardRowLite[]> {
  if (itemNames.length === 0) return [];
  return selectAll<AwardRowLite>((from, to) => sb
    .from('opendkp_loot')
    .select('item_name, character_name, dkp')
    .in('item_name', itemNames)
    .order('id')
    .range(from, to));
}

// ── /parses/[id] ─────────────────────────────────────────────────────────────

/** One encounter's timeline events, oldest first. 11 encounters have more than 1,000 (max 1,941). */
export async function loadEncounterEvents<T>(sb: SupabaseClient, encounterId: string): Promise<T[]> {
  return selectAll<T>((from, to) => sb
    .from('encounter_events')
    .select('at, kind, subtype, actor, label')
    .eq('encounter_id', encounterId)
    .order('at', { ascending: true })
    .order('id')
    .range(from, to) as any);
}

/** The distinct agent versions that uploaded in [loIso, hiIso]. The page wants the newest of them
 *  ("what was current when this fight was parsed"); it used to read 21,485 contribution rows and
 *  got 1,000, so the newest version could be missing and a stale uploader read as current. */
export async function loadAgentVersionsAround(sb: SupabaseClient, loIso: string, hiIso: string): Promise<string[]> {
  const rows = await selectAll<{ agent_version: string | null }>((from, to) => sb
    .rpc('contribution_agent_versions', { p_lo: loIso, p_hi: hiIso })
    .range(from, to));
  return rows.map(r => r.agent_version).filter((v): v is string => !!v);
}

// ── /db ──────────────────────────────────────────────────────────────────────

export type ItemDropRow = { npc_id: number; npc_name: string | null; effective_chance: number | null };

/** The best-chance droppers of an item. 124 items have more than 500, so the order decides which
 *  500 these are; NULL chances sort last. The page shows the top 60 and the exact total comes from
 *  `loadDropperCounts`. */
export async function loadItemDrops(sb: SupabaseClient, itemId: number): Promise<ItemDropRow[]> {
  const { data } = await sb
    .from('eqemu_npc_drops')
    .select('npc_id, npc_name, effective_chance')
    .eq('item_id', itemId)
    .order('effective_chance', { ascending: false, nullsFirst: false })
    .order('npc_id')
    .limit(500);
  return (data ?? []) as ItemDropRow[];
}

/** Spawn points of the given spawn groups. Ordered on id, the primary key. */
export async function loadSpawn2<T>(sb: SupabaseClient, spawngroupIds: number[]): Promise<T[]> {
  if (spawngroupIds.length === 0) return [];
  return selectAll<T>((from, to) => sb
    .from('eqemu_spawn2')
    .select('spawngroup_id, zone_short, x, y, z, respawntime')
    .in('spawngroup_id', spawngroupIds)
    .order('id')
    .range(from, to) as any);
}

// ── /pvp ─────────────────────────────────────────────────────────────────────

/** pvp_boss_kills since `sinceIso`, newest first. killed_at alone is not unique; id breaks ties. */
export async function loadPvpBossKills<T>(sb: SupabaseClient, sinceIso: string): Promise<T[]> {
  return selectAll<T>((from, to) => sb
    .from('pvp_boss_kills')
    .select('boss_id, boss_name, zone, timer_hours, killed_at, killed_by, killed_by_guild, spawn_earliest, spawn_latest, spawn_earliest_override')
    .eq('guild_id', 'wolfpack')
    .gte('killed_at', sinceIso)
    .order('killed_at', { ascending: false })
    .order('id')
    .range(from, to) as any);
}
