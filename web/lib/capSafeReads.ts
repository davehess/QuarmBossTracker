// Cap-safe reads for /me, /me/tells and the character pages.
//
// THE PROBLEM: PostgREST silently returns at most 1,000 rows per response. A
// `.limit(5000)` does not raise that, a one-call `.range(0, N)` does not raise
// it, a set-returning RPC is capped the same way, and the only thing that is
// NOT capped is a single jsonb VALUE (precedent: who_directory_json). The
// 2026-10-04 audit found every read in this file broken on live data — a
// raider's /me stats were computed over the first 1,000 of 3,807 parses, the
// faction baseline was missing 52% of the faction list, the family's active
// characters were not in the first 1,000 live-state rows, and so on.
//
// Each loader here takes the Supabase client as `db` so the root vitest suite
// can run the REAL function against a fake that enforces the cap
// (test/_fake-supabase-me.js). Three shapes, picked per read:
//   · a SQL aggregate returned as one jsonb value (the migration
//     20261004140600_cap_safe_me.sql) — when the page renders a summary;
//   · `selectAll` over a stable unique `.order()` — when the page needs rows;
//   · a narrower filter — when only a few rows were ever wanted.
// Pure and import-light on purpose (no `@/` alias): tests real-import it.

import { selectAll } from './selectAll';
import { GUILD_TAG } from './guild';
import type { SourceRow } from './spellSources';

/** The slice of the Supabase client these loaders touch. */
export type Db = {
  from(table: string): any;
  rpc(fn: string, args?: Record<string, unknown>): any;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);

// ── /me: live state ─────────────────────────────────────────────────────────

/**
 * `column.ilike.<name>,…` for a PostgREST `.or()` — letters only, because an
 * ilike with no wildcard is a case-insensitive equality and a name has none.
 * '' when no name survives (the caller must not send an empty `.or()`).
 */
export function ilikeAnyFilter(column: string, names: string[]): string {
  return names
    .map(n => String(n ?? '').replace(/[^A-Za-z]/g, ''))
    .filter(Boolean)
    .map(n => `${column}.ilike.${n}`)
    .join(',');
}

export type LiveStateRow = {
  character: string;
  zone_name: string | null;
  buff_count: number | null;
  buffs: unknown;
  self_hp_pct: number | null;
  updated_at: string | null;
};

/**
 * The live-state rows for THESE characters. The table holds 1,500+ rows (one
 * per character any agent has ever reported), so the old "fetch the guild's
 * rows and match in JS" read got the first 1,000 in heap order — and none of
 * the 14 characters updated in the last 15 minutes were in them.
 */
export async function fetchLiveStateRows(db: Db, names: string[]): Promise<LiveStateRow[]> {
  const filter = ilikeAnyFilter('character', names);
  if (!filter) return [];
  const { data } = await db.from('character_live_state')
    .select('character, zone_name, buff_count, buffs, self_hp_pct, updated_at')
    .eq('guild_id', GUILD_TAG)
    .or(filter);
  return asArray(data) as LiveStateRow[];
}

// ── /me: the two whole-guild views ──────────────────────────────────────────

export type FloorRow = { member_since: string | null; floor_source: string | null };
export type CoverageRow = {
  encounters_total: number | null;
  encounters_with_detail: number | null;
  encounters_resubmittable: number | null;
};

/** jsonb arrays from me_floor_json / me_coverage_json → lower-cased entry lists. */
export function floorCoverageEntries(floorJson: unknown, coverageJson: unknown): {
  floors: [string, FloorRow][];
  coverage: [string, CoverageRow][];
} {
  const floors: [string, FloorRow][] = [];
  for (const r of asArray(floorJson)) {
    if (r?.character_name) floors.push([String(r.character_name).toLowerCase(), { member_since: r.member_since ?? null, floor_source: r.floor_source ?? null }]);
  }
  const coverage: [string, CoverageRow][] = [];
  for (const r of asArray(coverageJson)) {
    if (r?.character_name) coverage.push([String(r.character_name).toLowerCase(), {
      encounters_total: r.encounters_total ?? null,
      encounters_with_detail: r.encounters_with_detail ?? null,
      encounters_resubmittable: r.encounters_resubmittable ?? null,
    }]);
  }
  return { floors, coverage };
}

/**
 * Every row of both views (1,570 + 3,237 today), as one jsonb value each. The
 * views re-aggregate the whole guild per call (~2.9 s / ~2.6 s), so a paged
 * read would pay that once per page; this pays it once, in parallel. THROWS on
 * an RPC error so the caller's 30-minute cache never stores an empty map.
 */
export async function fetchFloorAndCoverage(db: Db): Promise<ReturnType<typeof floorCoverageEntries>> {
  const [f, c] = await Promise.all([db.rpc('me_floor_json'), db.rpc('me_coverage_json')]);
  if (f.error || c.error) throw new Error(`me floor/coverage rpc failed: ${(f.error || c.error).message ?? 'unknown'}`);
  return floorCoverageEntries(f.data, c.data);
}

// ── /me: per-character parse / upload / rollup stats ────────────────────────

export type CharAgg = {
  name: string;
  encounter_count: number;
  total_damage: number;
  top_damage: number;
  top_encounter_id: string | null;
  recent: { id: string; started_at: string | null; npc_id: number | null; damage: number; dps: number }[];
  upload_count: number;
  last_upload: string | null;
  latest_agent_version: string | null;
  rollup_hits: number;
  rollup_damage: number;
  self_attack_count: number;
  top_skills: { skill: string; hits: number; dmg: number }[];
};

/** What a character with no rows at all aggregates to (a mule, or a failed RPC). */
export const EMPTY_AGG: Omit<CharAgg, 'name'> = {
  encounter_count: 0, total_damage: 0, top_damage: 0, top_encounter_id: null, recent: [],
  upload_count: 0, last_upload: null, latest_agent_version: null,
  rollup_hits: 0, rollup_damage: 0, self_attack_count: 0, top_skills: [],
};

/** me_char_stats jsonb → lower-cased name → aggregate. */
export function charAggsFromRpc(json: unknown): Map<string, CharAgg> {
  const out = new Map<string, CharAgg>();
  for (const r of asArray(json)) {
    if (!r?.name) continue;
    out.set(String(r.name).toLowerCase(), {
      name: String(r.name),
      encounter_count: num(r.encounter_count),
      total_damage: num(r.total_damage),
      top_damage: num(r.top_damage),
      top_encounter_id: r.top_encounter_id ?? null,
      recent: asArray(r.recent).map(e => ({
        id: String(e.id), started_at: e.started_at ?? null, npc_id: e.npc_id ?? null, damage: num(e.damage), dps: num(e.dps),
      })),
      upload_count: num(r.upload_count),
      last_upload: r.last_upload ?? null,
      latest_agent_version: r.latest_agent_version ?? null,
      rollup_hits: num(r.rollup_hits),
      rollup_damage: num(r.rollup_damage),
      self_attack_count: num(r.self_attack_count),
      top_skills: asArray(r.top_skills).map(s => ({ skill: String(s.skill), hits: num(s.hits), dmg: num(s.dmg) })),
    });
  }
  return out;
}

/**
 * Parse, upload and rollup stats for every name, in SQL — encounter_players
 * (3,807 rows for the heaviest raider), contributions (4,036) and
 * encounter_combat_rollup (3,914) all exceed what a PostgREST response can
 * carry, and the page used to sum the first 1,000 / 500 / 1,000 of them.
 */
export async function fetchCharAggs(db: Db, names: string[]): Promise<Map<string, CharAgg>> {
  if (names.length === 0) return new Map();
  const { data } = await db.rpc('me_char_stats', { p_names: names });
  return charAggsFromRpc(data);
}

// ── /me: The Scrap ──────────────────────────────────────────────────────────

export type ScrapRow = { character_name: string; total_damage: number; best_dps: number; encounters: number };
export type ScrapRanked = ScrapRow & { rank: number };
export type ScrapView = {
  contenders: number;
  top: ScrapRanked;
  me: ScrapRanked | null;
  rival: ScrapRanked | null;
};

const scrapRanked = (r: any): ScrapRanked | null => r ? ({
  character_name: String(r.character_name),
  total_damage: num(r.total_damage),
  best_dps: num(r.best_dps),
  encounters: num(r.encounters),
  rank: num(r.rank),
}) : null;

/** scrap_leaderboard_view jsonb → the card's four facts (null: no contenders). */
export function scrapViewFromRpc(json: unknown): ScrapView | null {
  const j = json as any;
  const top = scrapRanked(j?.top);
  if (!j || !top) return null;
  return { contenders: num(j.contenders), top, me: scrapRanked(j.me), rival: scrapRanked(j.rival) };
}

/** Ranked over EVERY contender in SQL — 1,106 over 30 days, past the row cap. */
export async function fetchScrapView(db: Db, names: string[], sinceIso: string): Promise<ScrapView | null> {
  const { data } = await db.rpc('scrap_leaderboard_view', { p_since: sinceIso, p_names: names });
  return scrapViewFromRpc(data);
}

// ── /me/tells: PRIVATE conversation totals ──────────────────────────────────

export type TellConversation = {
  other: string;
  total: number;
  incoming: number;
  outgoing: number;
  lastTs: string;
  lastText: string;
  lastDirection: 'incoming' | 'outgoing';
  lastChar: string;
};
export type TellSummary = {
  conversations: number;
  total: number;
  incoming: number;
  outgoing: number;
  top: TellConversation[];
};

export const EMPTY_TELL_SUMMARY: TellSummary = { conversations: 0, total: 0, incoming: 0, outgoing: 0, top: [] };

export function tellSummaryFromRpc(json: unknown): TellSummary {
  const j = json as any;
  if (!j || typeof j !== 'object') return { ...EMPTY_TELL_SUMMARY, top: [] };
  return {
    conversations: num(j.conversations),
    total: num(j.total),
    incoming: num(j.incoming),
    outgoing: num(j.outgoing),
    top: asArray(j.top).map(c => ({
      other: String(c.other),
      total: num(c.total),
      incoming: num(c.incoming),
      outgoing: num(c.outgoing),
      lastTs: String(c.last_ts),
      lastText: String(c.last_text ?? ''),
      lastDirection: c.last_direction === 'outgoing' ? 'outgoing' : 'incoming',
      lastChar: String(c.last_char ?? ''),
    })),
  };
}

/**
 * Conversation totals over every tell the owner has (9,156 for the heaviest;
 * the page used to count the newest 1,000). PRIVATE: the function filters on
 * owner_discord_id itself and is granted to service_role only — so this must
 * be called with an id the SERVER resolved from the signed-in session, and an
 * empty id never reaches the database.
 */
export async function fetchTellSummary(db: Db, ownerDiscordId: string, limit = 50): Promise<TellSummary> {
  if (!ownerDiscordId) return { ...EMPTY_TELL_SUMMARY, top: [] };
  const { data } = await db.rpc('me_tell_summary', { p_owner_discord_id: ownerDiscordId, p_limit: limit });
  return tellSummaryFromRpc(data);
}

// ── /character/<name>: parse summary ────────────────────────────────────────

/** The shape the character page renders (the old encounter_players embed). */
export type ParseRow = {
  encounter_id: string;
  character_name: string;
  total_damage: number;
  dps: number;
  duration_sec: number | null;
  rank: number | null;
  has_pets: boolean | null;
  encounters: { id: string; started_at: string; duration_sec: number | null; zone_short: string | null; eqemu_npc_types: { name: string } | null } | null;
};

export type ParseSummary = {
  count: number;
  totalDamage: number;
  firstStarted: string | null;
  best: ParseRow | null;
  recent: ParseRow[];
};

const toParseRow = (r: any, character: string): ParseRow => ({
  encounter_id: String(r.encounter_id),
  character_name: character,
  total_damage: num(r.total_damage),
  dps: num(r.dps),
  duration_sec: r.duration_sec ?? null,
  rank: r.rank ?? null,
  has_pets: null,
  encounters: {
    id: String(r.encounter_id),
    started_at: r.started_at,
    duration_sec: null,
    zone_short: r.zone_short ?? null,
    eqemu_npc_types: r.npc_name ? { name: String(r.npc_name) } : null,
  },
});

export function parseSummaryFromRpc(json: unknown, character: string): ParseSummary {
  const j = json as any;
  return {
    count: num(j?.parses),
    totalDamage: num(j?.total_damage),
    firstStarted: j?.first_started ?? null,
    best: j?.best ? toParseRow(j.best, character) : null,
    recent: asArray(j?.recent).map(r => toParseRow(r, character)),
  };
}

/**
 * Parse count, total damage, best fight, 30 newest fights and first-seen for
 * one character, in SQL. The page used to pull every encounter_players row
 * (`.limit(10000)`) — 3,807 for the heaviest raider, so 38 characters were
 * summed over their top-1,000 fights by damage, and the "recent parses" list
 * could not see their newest weak fights.
 */
export async function fetchParseSummary(db: Db, character: string): Promise<ParseSummary> {
  const { data } = await db.rpc('character_parse_summary', { p_name: character });
  return parseSummaryFromRpc(data, character);
}

// ── /character/<name>/factions ──────────────────────────────────────────────

export type FactionConRow = { mob: string; standing: string; rank: number | null; event_ts: string };

/**
 * Every latest-con row for a character. 16 characters have more than the old
 * `.limit(500)` (max 3,234). `faction_cons` is unique per (guild, character,
 * mob); `id` is the unique tiebreak under the newest-first order the page
 * shows.
 */
export async function fetchFactionCons(db: Db, character: string): Promise<FactionConRow[]> {
  return selectAll<FactionConRow>((from, to) => db.from('faction_cons')
    .select('mob, standing, rank, event_ts')
    .ilike('character', character)
    .order('event_ts', { ascending: false })
    .order('id', { ascending: true })
    .range(from, to));
}

export type NpcTypeRow = { id: number; name: string; npc_faction_id: number | null };

/**
 * NPC rows for a list of mob names (underscore form). Names repeat across
 * zones, so a chunk of 80 names has returned 854 rows — close enough to the
 * cap that each chunk is drained with `selectAll` (ordered by the primary key)
 * rather than trusted. Chunks run a few at a time: a character with 3,234 cons
 * is ~40 of them.
 */
export async function fetchNpcTypesByName(db: Db, names: string[], chunk = 80, parallel = 8): Promise<NpcTypeRow[]> {
  const slices: string[][] = [];
  for (let i = 0; i < names.length; i += chunk) slices.push(names.slice(i, i + chunk));
  const out: NpcTypeRow[] = [];
  for (let i = 0; i < slices.length; i += parallel) {
    const parts = await Promise.all(slices.slice(i, i + parallel).map(slice =>
      selectAll<NpcTypeRow>((from, to) => db.from('eqemu_npc_types')
        .select('id, name, npc_faction_id')
        .in('name', slice)
        .order('id', { ascending: true })
        .range(from, to))));
    for (const p of parts) out.push(...p);
  }
  return out;
}

export type FactionListRow = { id: number; name: string | null; base: number | null };

/** All 2,123 factions — a `.limit(5000)` returned 1,000 and seeded the rest at 0. */
export async function fetchFactionListFull(db: Db): Promise<FactionListRow[]> {
  return selectAll<FactionListRow>((from, to) => db.from('eqemu_faction_list_full')
    .select('id, name, base')
    .order('id', { ascending: true })
    .range(from, to));
}

export type FactionModRow = { faction_id: number; mod: number | null; mod_name: string };

/** The race / class / deity modifiers for a character (669 rows for the widest). */
export async function fetchFactionMods(db: Db, modCodes: string[]): Promise<FactionModRow[]> {
  if (modCodes.length === 0) return [];
  return selectAll<FactionModRow>((from, to) => db.from('eqemu_faction_list_mod')
    .select('faction_id, mod, mod_name')
    .in('mod_name', modCodes)
    .order('id', { ascending: true })
    .range(from, to));
}

// ── /character/<name>/quests ────────────────────────────────────────────────

export type InventoryRow = {
  character_name: string;
  slot_label: string;
  item_id: number | null;
  item_name: string;
  quantity: number;
};

/**
 * The whole family's inventory (the page shows "a family member holds this").
 * Families run to 8,302 rows (10 are over 1,000) and the old `.limit(10000)`
 * returned 1,000 in heap order, so a character's OWN rows could be missing.
 * character_inventory is unique per (guild, lower(character_name), slot_label),
 * which is exactly the order used here.
 */
export async function fetchFamilyInventory(db: Db, familyNames: string[]): Promise<InventoryRow[]> {
  const filter = familyNames.map(n => `character_name.ilike.${n}`).join(',');
  if (!filter) return [];
  return selectAll<InventoryRow>((from, to) => db.from('character_inventory')
    .select('character_name, slot_label, item_id, item_name, quantity')
    .eq('guild_id', GUILD_TAG)
    .or(filter)
    .order('character_name', { ascending: true })
    .order('slot_label', { ascending: true })
    .range(from, to));
}

/**
 * Scripted turn-ins matched to held items. The function used to end in
 * `LIMIT 500` (4 of the top-25 inventories hit it, and it sorts 'piece' before
 * 'completed', so completed turn-ins were what got cut); it now has a total
 * order, and the result is drained in pages in case it ever passes 1,000.
 */
export async function fetchDiscoveredQuests<T>(db: Db, itemIds: number[]): Promise<T[]> {
  if (itemIds.length === 0) return [];
  return selectAll<T>((from, to) => db.rpc('discover_quests_for_item', { p_item_ids: itemIds })
    .order('evidence', { ascending: false })
    .order('zone_short', { ascending: true })
    .order('npc_name', { ascending: true })
    .order('turnin_id', { ascending: true })
    .order('matched_item_id', { ascending: true })
    .range(from, to));
}

/**
 * eqemu_items rows for a list of ids, in chunks. A held inventory plus the
 * inputs and outputs of its discovered turn-ins is 1,045–1,335 distinct ids for
 * the heaviest characters, and a single `.in('id', …)` returns at most 1,000
 * rows (and puts ~10 KB in the URL). Ids are unique, so a chunk of 300 can
 * never reach the cap and needs no paging.
 */
export async function fetchItemsByIds<T>(db: Db, select: string, ids: number[], chunk = 300): Promise<T[]> {
  const slices: number[][] = [];
  for (let i = 0; i < ids.length; i += chunk) slices.push(ids.slice(i, i + chunk));
  const parts = await Promise.all(slices.map(async slice => {
    const { data } = await db.from('eqemu_items').select(select).in('id', slice);
    return asArray(data) as T[];
  }));
  return parts.flat();
}

// ── /character/<name>/spells ────────────────────────────────────────────────

/**
 * Every vendor and dropper for a set of scroll ids as one jsonb array — one
 * spellbook is 4,632 rows, past the cap, and the underlying function has no
 * ORDER BY. A failure costs only the where-from dropdown.
 */
export async function fetchScrollSources(db: Db, itemIds: number[]): Promise<SourceRow[]> {
  if (itemIds.length === 0) return [];
  const { data } = await db.rpc('spell_scroll_sources_json', { p_item_ids: itemIds });
  return asArray(data) as SourceRow[];
}
