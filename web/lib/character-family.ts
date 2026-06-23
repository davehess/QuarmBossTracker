// Family + main-detection helpers for /character/[name].
//
// A "family" is everyone in the OpenDKP roster that points at the same
// `main_name` root. The root is itself a row whose `main_name` equals its own
// `name`.
//
// "Main" is a moving target — it changes when an officer renames the family
// or when a player swaps their primary character. Two deterministic signals,
// in priority order:
//
//   1. *Only mains can bid more than 100 DKP on an item.* If a family member
//      placed a bid > 100 in a given era, that's the main during that era.
//      The auction's end timestamp is our era anchor (opendkp_auction_bids
//      .bid_at is uniformly NULL right now; we join through
//      opendkp_auctions.end_at as the proxy).
//
//   2. *Only mains get ticks in raid.* Alts don't get attendance credit, so
//      whichever family member appears in the most ticks during an era was
//      the main for that era. Tick attendance is a much higher-volume signal
//      than bidding, so this picks up mains who never bid > 100.
//
// Fallback (no big bids, no tick activity for the family in an era):
//   - highest-ranked living member of the family by RANK_PRIORITY.
//
// Caveat — historical bid data: bids placed before mid-March 2026 didn't
// capture the OpenDKP CharacterId, so we can only resolve by character_name
// (= OpenDKP login, not the EQ character name) which doesn't join cleanly.
// Best-effort: when character_id is null we try matching character_name
// case-insensitively against the family's name list. Rank-fallback covers
// the rest.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ERAS, eraForTimestamp, rankIndex, type EraName } from './eras';

export type FamilyMember = {
  name: string;
  rank: string | null;
  class: string | null;
  race: string | null;
  main_name: string | null;
  opendkp_id: number | null;
  active: boolean | null;
  discord_id?: string | null;
};

export type EraSummary = {
  era: EraName;
  start: string;
  end: string;
  main: string | null;          // detected main for this era
  mainSource: 'big_bid' | 'ticks' | 'carry_forward' | 'rank_fallback' | 'no_activity';
  mainSince: string | null;     // approx date this era's main took over (their first tick in-era)
  swappedFrom: string | null;   // the prior era's main, when the main changed at this era's boundary
  dkpEarned: number;            // sum of tick.value for family members in era (raids attended * tick value approximation)
  dkpSpent: number;             // sum of loot DKP for family members in era
  itemsWon: number;
  raidsAttended: number;        // distinct raid_ids the family attended in era
};

const FAMILY_COLS = 'name, rank, class, race, main_name, opendkp_id, active, discord_id';

export async function loadFamily(
  sb: SupabaseClient,
  characterName: string,
): Promise<{ root: FamilyMember | null; members: FamilyMember[] }> {
  // Step 1: find the row matching this character so we know the family root.
  const { data: selfRows } = await sb
    .from('characters')
    .select(FAMILY_COLS)
    .ilike('name', characterName)
    .eq('guild_id', 'wolfpack')
    .limit(1);

  const self = (selfRows && selfRows[0]) as FamilyMember | undefined;
  if (!self) return { root: null, members: [] };

  // The OpenDKP main_name root (the row whose name === main_name).
  const rootName = self.main_name || self.name;

  // Step 2: pull family members by BOTH signals and union them.
  //   (a) OpenDKP main_name linkage (the historical grouping).
  //   (b) Same discord_id — the strongest identity signal. The main_name
  //       grouping sometimes splits ONE person's characters across roots
  //       (e.g. when an officer's newer main becomes its own root), which
  //       breaks the era timeline because each split sees only part of the
  //       person's DKP history. (Uilnayar 2026-06-23: Hitya was its own root,
  //       split from Canopy/Melting, so Hitya's page claimed Hitya was the
  //       Classic main when the player was actually Canopy then.)
  const queries = [
    sb.from('characters').select(FAMILY_COLS)
      .or(`main_name.eq.${rootName},name.eq.${rootName}`)
      .eq('guild_id', 'wolfpack'),
  ];
  if (self.discord_id) {
    queries.push(
      sb.from('characters').select(FAMILY_COLS)
        .eq('discord_id', self.discord_id)
        .eq('guild_id', 'wolfpack'),
    );
  }
  const results = await Promise.all(queries);

  // Dedup by lowercased name (a character can match both queries).
  const byName = new Map<string, FamilyMember>();
  for (const res of results) {
    for (const r of ((res.data ?? []) as FamilyMember[])) {
      const k = r.name.toLowerCase();
      if (!byName.has(k)) byName.set(k, r);
    }
  }
  const members = [...byName.values()].sort((a, b) => {
    const ai = rankIndex(a.rank);
    const bi = rankIndex(b.rank);
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });

  // Root = the actual current main (highest rank), so "alt of X" points at the
  // real main rather than a stale main_name root. Keeps the page's Main badge
  // (isMain → currentMain) and the "alt of …" link consistent.
  const root = currentMain(members) || members.find(m => m.name === rootName) || null;

  return { root, members };
}

// Highest-ranked family member by RANK_PRIORITY. Ties broken alphabetically.
export function currentMain(family: FamilyMember[]): FamilyMember | null {
  if (family.length === 0) return null;
  // Skip Raid Alts when picking the main — they're explicitly second-class.
  const eligible = family.filter(m => (m.rank || '').toLowerCase() !== 'raid alt');
  const pool = eligible.length > 0 ? eligible : family;
  return [...pool].sort((a, b) => {
    const ai = rankIndex(a.rank);
    const bi = rankIndex(b.rank);
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  })[0] || null;
}

// True if this name *is* the current main of the family.
export function isMain(family: FamilyMember[], name: string): boolean {
  const m = currentMain(family);
  return !!m && m.name.toLowerCase() === name.toLowerCase();
}

// Build per-era summary: detect main via bids > 100, plus aggregate DKP/items
// for the whole family in that window.
export async function loadEraTimeline(
  sb: SupabaseClient,
  family: FamilyMember[],
): Promise<EraSummary[]> {
  if (family.length === 0) return [];

  const familyNames    = family.map(m => m.name);
  const familyIds      = family.map(m => m.opendkp_id).filter((x): x is number => x != null);
  const familyNamesLower = new Set(familyNames.map(n => n.toLowerCase()));

  // Pull all relevant data in parallel; filter into era buckets in JS.
  // We split the bid lookup into id+name passes rather than trying to pack
  // both into a single .or() clause — PostgREST quoting rules around array
  // values with spaces get gnarly.
  const bidSelect = 'character_id, character_name, value, auction_id, opendkp_auctions!inner(end_at)';
  const [bidsById, bidsByName, lootRes, ticksRes] = await Promise.all([
    familyIds.length > 0
      ? sb.from('opendkp_auction_bids').select(bidSelect).gt('value', 100).in('character_id', familyIds).limit(1000)
      : Promise.resolve({ data: [] as unknown[] }),
    sb.from('opendkp_auction_bids').select(bidSelect).gt('value', 100).is('character_id', null).in('character_name', familyNames).limit(1000),
    sb.from('opendkp_loot_recent').select('character_name, dkp, raid_date, item_name').in('character_name', familyNames).order('raid_date', { ascending: true }).limit(2000),
    sb.from('opendkp_ticks').select('value, attendees, raid_id, opendkp_raids!inner(ts)').overlaps('attendees', familyNames).limit(10000),
  ]);

  type BidRow   = { character_id: number | null; character_name: string | null; value: number | null; auction_id: number | null; opendkp_auctions: { end_at: string | null } | { end_at: string | null }[] | null };
  type LootRow  = { character_name: string | null; dkp: number | null; raid_date: string | null; item_name: string | null };
  type TickRow  = { value: number | null; attendees: string[] | null; raid_id: number | null; opendkp_raids: { ts: string | null } | { ts: string | null }[] | null };

  const bigBids = [
    ...(bidsById.data  || []),
    ...(bidsByName.data || []),
  ] as BidRow[];
  const loot    = (lootRes.data    || []) as LootRow[];
  const ticks   = (ticksRes.data   || []) as TickRow[];

  // Helper to map a raw character_id back to family name (or fall back to
  // case-insensitive name match).
  const idToName = new Map<number, string>();
  for (const m of family) if (m.opendkp_id != null) idToName.set(m.opendkp_id, m.name);

  function resolveBidder(b: BidRow): string | null {
    if (b.character_id != null && idToName.has(b.character_id)) return idToName.get(b.character_id) || null;
    if (b.character_name && familyNamesLower.has(b.character_name.toLowerCase())) {
      return family.find(m => m.name.toLowerCase() === b.character_name!.toLowerCase())?.name || null;
    }
    return null;
  }

  function nestedTimestamp<T extends { opendkp_auctions?: unknown; opendkp_raids?: unknown }>(
    row: T,
    key: 'opendkp_auctions' | 'opendkp_raids',
    field: 'end_at' | 'ts',
  ): string | null {
    const v = row[key] as { [k: string]: string | null } | { [k: string]: string | null }[] | undefined;
    if (!v) return null;
    if (Array.isArray(v)) return (v[0] && v[0][field]) || null;
    return v[field] || null;
  }

  const famByName = new Map<string, FamilyMember>();
  for (const m of family) famByName.set(m.name, m);

  // First pass: detect each era's main from REAL signals only (leave null when
  // the family had no presence that era — we do NOT fabricate a main yet).
  const results: EraSummary[] = ERAS.map(era => {
    const inEra = (iso: string | null) => !!iso && iso >= era.start && iso < era.end;

    // Big bids landing in this era → bid votes.
    const bidVotes = new Map<string, number>();
    for (const b of bigBids) {
      const ts = nestedTimestamp(b, 'opendkp_auctions', 'end_at');
      if (!inEra(ts)) continue;
      const resolved = resolveBidder(b);
      if (!resolved) continue;
      bidVotes.set(resolved, (bidVotes.get(resolved) || 0) + 1);
    }

    // DKP spent (loot) in era.
    let dkpSpent = 0;
    let itemsWon = 0;
    for (const l of loot) {
      if (!inEra(l.raid_date)) continue;
      dkpSpent += l.dkp || 0;
      itemsWon += 1;
    }

    // DKP earned + per-member tick counts (the primary main signal) + each
    // member's first tick date in-era (powers the "main swap" timestamp).
    let dkpEarned = 0;
    const raidIds = new Set<number>();
    const tickCounts = new Map<string, number>();      // family member name → tick count
    const firstTickByMember = new Map<string, string>(); // family member name → earliest in-era tick ts
    for (const t of ticks) {
      const ts = nestedTimestamp(t, 'opendkp_raids', 'ts');
      if (!inEra(ts)) continue;
      let touched = false;
      for (const attendee of (t.attendees || [])) {
        const key = (attendee || '').toLowerCase();
        if (!familyNamesLower.has(key)) continue;
        const canonical = family.find(m => m.name.toLowerCase() === key)?.name;
        if (!canonical) continue;
        tickCounts.set(canonical, (tickCounts.get(canonical) || 0) + 1);
        const prev = firstTickByMember.get(canonical);
        if (ts && (!prev || ts < prev)) firstTickByMember.set(canonical, ts);
        touched = true;
      }
      if (touched) {
        dkpEarned += t.value || 0;
        if (t.raid_id != null) raidIds.add(t.raid_id);
      }
    }

    // Main = whoever the family attended raids AS the most that era. Tick
    // attendance is the high-volume, era-wide signal (a member can swap mains
    // mid-era; whoever logged the most ticks was the main for the bulk of it).
    // A single end-of-era big bid shouldn't override a season of attendance,
    // so big-bid count is only a tiebreaker — and stands in alone when there
    // were no ticks at all (e.g. a main who bid but whose ticks predate our
    // OpenDKP history). Rank breaks remaining ties. (Uilnayar 2026-06-23:
    // big-bid-first wrongly flipped Classic from Canopy→Melting on one bid.)
    const candidates = new Set<string>([...tickCounts.keys(), ...bidVotes.keys()]);
    let detectedMain: string | null = null;
    let mainSource: EraSummary['mainSource'] = 'no_activity';
    if (candidates.size > 0) {
      const ranked = [...candidates].sort((a, b) => {
        const ta = tickCounts.get(a) || 0, tb = tickCounts.get(b) || 0;
        if (tb !== ta) return tb - ta;
        const ba = bidVotes.get(a) || 0, bb = bidVotes.get(b) || 0;
        if (bb !== ba) return bb - ba;
        return rankIndex(famByName.get(a)?.rank) - rankIndex(famByName.get(b)?.rank);
      });
      detectedMain = ranked[0];
      mainSource = (tickCounts.get(detectedMain) || 0) > 0 ? 'ticks' : 'big_bid';
    }

    return {
      era: era.name,
      start: era.start,
      end: era.end,
      main: detectedMain,
      mainSource,
      mainSince: detectedMain ? (firstTickByMember.get(detectedMain) ?? null) : null,
      swappedFrom: null,   // filled in the swap-detection pass below
      dkpEarned,
      dkpSpent,
      itemsWon,
      raidsAttended: raidIds.size,
    };
  });

  // Second pass: fill gaps. Once we know who the main was, carry it FORWARD
  // through quiet eras (the main doesn't revert just because a season had no
  // bid/tick activity). Eras BEFORE the family's first signal stay null — we
  // genuinely don't know who the main was then, which is more honest than
  // stamping the current main onto pre-history (the original bug).
  let lastKnown: string | null = null;
  for (const r of results) {
    if (r.main) { lastKnown = r.main; continue; }
    if (lastKnown) { r.main = lastKnown; r.mainSource = 'carry_forward'; }
  }

  // If the family never produced ANY signal in any era, fall back to the
  // current main across the board so the timeline isn't entirely blank.
  if (results.every(r => !r.main)) {
    const cm = currentMain(family);
    if (cm) for (const r of results) { r.main = cm.name; r.mainSource = 'rank_fallback'; }
  }

  // Mark main swaps: an era whose main differs from the previous known main.
  // Runs AFTER carry-forward so quiet eras (which inherit the prior main)
  // don't register a false swap. (Uilnayar 2026-06-23: surface WHEN the main
  // changed in the timeline.)
  let prevMain: string | null = null;
  for (const r of results) {
    if (r.main && prevMain && r.main !== prevMain) r.swappedFrom = prevMain;
    if (r.main) prevMain = r.main;
  }

  return results;
}

// Aggregate stats across the whole family.
export async function loadFamilyAggregates(
  sb: SupabaseClient,
  family: FamilyMember[],
): Promise<{ totalDkpSpent: number; totalItems: number; firstAttended: string | null; lastAttended: string | null; totalRaids: number }> {
  if (family.length === 0) {
    return { totalDkpSpent: 0, totalItems: 0, firstAttended: null, lastAttended: null, totalRaids: 0 };
  }
  const names = family.map(m => m.name);

  const [lootRes, attRes] = await Promise.all([
    sb.from('opendkp_loot_recent').select('dkp').in('character_name', names),
    sb.from('opendkp_attendance_recent').select('raids_attended, first_attended, last_attended').in('character_name', names),
  ]);

  const loot = (lootRes.data || []) as { dkp: number | null }[];
  const att  = (attRes.data  || []) as { raids_attended: number | null; first_attended: string | null; last_attended: string | null }[];

  return {
    totalDkpSpent: loot.reduce((s, l) => s + (l.dkp || 0), 0),
    totalItems:    loot.length,
    firstAttended: att.reduce<string | null>((min, a) => {
      if (!a.first_attended) return min;
      if (!min || a.first_attended < min) return a.first_attended;
      return min;
    }, null),
    lastAttended: att.reduce<string | null>((max, a) => {
      if (!a.last_attended) return max;
      if (!max || a.last_attended > max) return a.last_attended;
      return max;
    }, null),
    totalRaids: att.reduce((s, a) => s + (a.raids_attended || 0), 0),
  };
}

export { eraForTimestamp };
