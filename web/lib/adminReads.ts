// Complete reads for the officer pages that PostgREST's 1,000-row ceiling was truncating.
//
// The ceiling: the Supabase REST gateway returns AT MOST 1,000 rows per response, silently — no
// error, no flag, a short array and a 200 (lib/selectAll.ts has the history). Neither
// `.limit(50000)` nor ONE `.range(0, 49999)` lifts it; both are upper bounds applied on top of
// the cap. (Several of these pages' comments said `.range(0, N)` did. Measured against
// production 2026-10-04: one range call returns 1,000 rows.) The 2026-10-04 audit ("review all of
// the other tables for silent 500 or 100 caps") measured each page below returning a fraction of
// its table:
//   /admin/encounters  5,949 encounters in 7 d, 1,000 shown; children cut at 1,000 rows
//   /admin/agents      1,721 stat rows, 1,000 read (the newest 1,000 hold 245 of 435 characters)
//   /admin/links       1,682 uploader rows, 1,000 read; the targeted /who lookup at risk
//   /admin/anomalies   114 curated kills in 21 d buried under 14,516 trash rows; 500-row window
//   /admin/signups     16 of 46 events' players and 22 of 46 events' /who sightings over 1,000
//
// Every loader here pages with selectAll over a UNIQUE ordering, or asks the database for the
// aggregate (supabase/migrations/20261004140500_cap_safe_admin2.sql). They take the client as an
// argument and import nothing server-only, so test/cap-safe-admin2.test.js runs them against a
// fake that enforces the cap.
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAll } from './selectAll';
import { selectInChunks } from './selectInChunks';

// A PostgREST filter builder, chained dynamically. Typing it would mean typing the schema, and
// the pages that call these already treat rows as `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;
const db = (sb: SupabaseClient): Q => sb;

/** The first error any page of a drain reported. selectAll stops at an error and returns what it
 *  has, which is right for a list but wrong for a page that SHOWS the error (the spells page). */
function firstError() {
  const seen: { error: { message: string } | null } = { error: null };
  const watch = <R extends { error: unknown }>(res: R): R => {
    const e = res.error as { message?: string } | null;
    if (e && !seen.error) seen.error = { message: e.message ?? String(e) };
    return res;
  };
  return { seen, watch };
}

// ── agent_upload_stats ───────────────────────────────────────────────────────

/** PK is (guild_id, character, endpoint): the only ordering that is unique by construction. */
export function loadAgentUploadStats<T>(
  sb: SupabaseClient,
  select: string,
  filter: (q: Q) => Q = q => q,
): Promise<T[]> {
  return selectAll<T>((from, to) =>
    filter(db(sb).from('agent_upload_stats').select(select))
      .order('guild_id').order('character').order('endpoint')
      .range(from, to));
}

// ── guild_triggers ───────────────────────────────────────────────────────────

export async function loadEnabledTriggerPatterns(sb: SupabaseClient): Promise<string[]> {
  const rows = await selectAll<{ id: string; pattern: string | null }>((from, to) =>
    db(sb).from('guild_triggers').select('id, pattern').eq('enabled', true)
      .order('id')
      .range(from, to));
  return rows.map(r => r.pattern ?? '');
}

// ── who_observations, by name ────────────────────────────────────────────────

export type WhoRow = { character: string; level: number | null; class: string | null; observed_at: string };

/** Names per request: 20-char names are ~25 chars of URL each, so 100 keeps a request under 3 KB. */
export const WHO_NAME_CHUNK = 100;

/**
 * Every /who sighting of the given characters, newest first within each name. A name appears in
 * exactly one chunk, so "first row per name is the newest" still holds for the caller.
 * (id breaks ties between sightings in the same instant — the order has to be unique to page.)
 */
export function loadWhoForNames(sb: SupabaseClient, guildId: string, names: readonly string[]): Promise<WhoRow[]> {
  return selectInChunks<string, WhoRow>(names, (part, from, to) =>
    db(sb).from('who_observations')
      .select('character, level, class, observed_at')
      .eq('guild_id', guildId)
      .in('character', part)
      .order('observed_at', { ascending: false }).order('id')
      .range(from, to),
    { size: WHO_NAME_CHUNK });
}

// ── /admin/anomalies ─────────────────────────────────────────────────────────
// Both loaders are CURATED-boss only (bosses_local.auto_registered = false — web/lib/bossFilter.ts).
// Since bot 3.1.52 every exactly-matched mob self-registers, so 97% of `encounters` is farm trash:
// 14,516 rows in the 21-day window against 114 curated kills, and 24,921 since April against 949.
// A newest-500 window over that was about 20 hours of trash. Foreign-raid review and the off-hours
// queue are about bosses (/parses shows only curated rows, which is what auto-hide protects), so
// the filter is the fix and the paging is the guarantee.

export async function loadAnomalyWindow<T>(sb: SupabaseClient, sinceIso: string, curated: readonly number[]): Promise<T[]> {
  if (curated.length === 0) return [];
  return selectAll<T>((from, to) =>
    db(sb).from('encounters')
      .select(`id, started_at, classification, total_damage,
               eqemu_npc_types ( name ),
               encounter_players ( character_name, total_damage )`)
      .gt('total_damage', 0)
      .gte('started_at', sinceIso)
      .in('npc_id', curated as number[])
      .order('started_at', { ascending: false }).order('id')
      .range(from, to));
}

export async function loadOffHoursEncounters<T>(sb: SupabaseClient, sinceIso: string, curated: readonly number[]): Promise<T[]> {
  if (curated.length === 0) return [];
  return selectAll<T>((from, to) =>
    db(sb).from('encounters')
      .select('id, started_at, classification, npc_id, eqemu_npc_types ( name )')
      .gt('total_damage', 0)
      .gte('started_at', sinceIso)
      .in('npc_id', curated as number[])
      .order('started_at', { ascending: false }).order('id')
      .range(from, to));
}

export type EncounterPlayerRow = { encounter_id: string; character_name: string; total_damage: number };

/** encounter_players for a set of encounters. PK (encounter_id, character_name) is the unique order. */
export function loadPlayersForEncounters(sb: SupabaseClient, ids: readonly string[]): Promise<EncounterPlayerRow[]> {
  return selectInChunks<string, EncounterPlayerRow>(ids, (part, from, to) =>
    db(sb).from('encounter_players')
      .select('encounter_id, character_name, total_damage')
      .in('encounter_id', part)
      .order('encounter_id').order('character_name')
      .range(from, to));
}

// ── /admin/signups ───────────────────────────────────────────────────────────

export type SignupStatusRow = { event_id: string; signup_id: string; status: string | null };

/** Sign-up rows (event_id + status) for a set of events. 60 days of events is 2,046 rows. */
export function loadSignupStatuses(sb: SupabaseClient, eventIds: readonly string[]): Promise<SignupStatusRow[]> {
  return selectInChunks<string, SignupStatusRow>(eventIds, (part, from, to) =>
    db(sb).from('rh_signups')
      .select('event_id, signup_id, status')
      .in('event_id', part)
      .order('event_id').order('signup_id')
      .range(from, to));
}

/**
 * Distinct character names seen in [lo, hi): in a fight (encounter_players) or on /who. Computed
 * in the database — a 6-hour raid window is up to 2,854 player rows and 3,166 /who rows, and the
 * page only wants "who was around", so the names (581 at the busiest) are all that should travel.
 * The function orders by name, which is unique after the UNION, so paging is stable.
 * `error` is the first failure: without it a function that is missing or timed out reads as "nobody
 * else was around", and the page would call real attendees no-shows.
 */
export async function loadRaidWindowNames(sb: SupabaseClient, loIso: string, hiIso: string): Promise<{ names: string[]; error: { message: string } | null }> {
  const { seen, watch } = firstError();
  const rows = await selectAll<{ character_name: string }>((from, to) =>
    Promise.resolve(db(sb).rpc('raid_window_names', { p_lo: loIso, p_hi: hiIso }).range(from, to)).then(watch));
  return { names: rows.map(r => r.character_name), error: seen.error };
}

// ── /admin/spells ────────────────────────────────────────────────────────────

/**
 * guild_held_spell_needs is set-returning (555 rows today; a row per held scroll). It orders by
 * spell_name, which is unique (one row per lower-cased scroll name). The page shows the error, so
 * this keeps the first one rather than letting selectAll's partial-result rule hide it behind
 * "no scrolls observed".
 */
export async function loadHeldSpellNeeds<T>(sb: SupabaseClient, guildId: string): Promise<{ rows: T[]; error: { message: string } | null }> {
  const { seen, watch } = firstError();
  const rows = await selectAll<T>((from, to) =>
    Promise.resolve(db(sb).rpc('guild_held_spell_needs', { p_guild_id: guildId }).range(from, to)).then(watch));
  return { rows, error: seen.error };
}

// ── /admin/encounters ────────────────────────────────────────────────────────

export type GapRow = {
  id: string;
  npc_id: number | null;
  npc_name: string | null;
  expected_hp: number | null;
  zone_short: string | null;
  started_at: string | null;
  duration_sec: number | null;
  total_damage: number | null;
  total_dps: number | null;
  data_incomplete: boolean;
  data_incomplete_reason: string | null;
  contribs: number;
  players: number;
  candidates: string[] | null;
};

/** Encounters read per audit. 7 days is 5,949; 14 days ~8,700; beyond that the page is the newest
 *  10,000 and says so (the old label fired at 5,000 while really showing 1,000). */
export const GAP_HARD_CAP = 10_000;

/** A row whose damage is MISSING — the audit's first problem (data_incomplete, zero damage, or
 *  under 75% of the catalog HP). Mirrors the `gap` CTE in encounter_gap_audit, which is the only
 *  place backfill candidates are computed. */
export function hasMissingDamage(r: { data_incomplete?: boolean | null; total_damage: number | null; expected_hp: number | null }): boolean {
  if (r.data_incomplete) return true;
  if ((r.total_damage ?? 0) === 0) return true;
  return r.expected_hp != null && r.expected_hp > 0 && r.total_damage != null && r.total_damage < 0.75 * r.expected_hp;
}

/**
 * One row per encounter since `sinceIso`, newest first: the encounter, its catalog name + HP, the
 * contributions / players counts, and for rows with missing damage the guild members seen within
 * 15 minutes who are not in encounter_players (`names` = guild members minus excluded).
 *
 * The function pages itself (p_limit / p_offset) because it is not inlinable, so a plain `.range`
 * would run the whole thing once per page. Rows are de-duplicated by id: a kill landing while the
 * pages are being read shifts every offset by one and would repeat the row at a page boundary.
 */
export async function loadEncounterGap(
  sb: SupabaseClient,
  sinceIso: string,
  names: readonly string[],
  hardCap: number = GAP_HARD_CAP,
): Promise<{ rows: GapRow[]; truncated: boolean; error: { message: string } | null }> {
  const { seen, watch } = firstError();
  let truncated = false;
  const raw = await selectAll<GapRow>(
    (from, to) => Promise.resolve(
      db(sb).rpc('encounter_gap_audit', {
        p_since: sinceIso, p_names: names as string[], p_limit: to - from + 1, p_offset: from,
      })).then(watch),
    { hardCap, onTruncate: () => { truncated = true; } },
  );
  const byId = new Map<string, GapRow>();
  for (const r of raw) if (!byId.has(r.id)) byId.set(r.id, r);
  return { rows: [...byId.values()], truncated, error: seen.error };
}
