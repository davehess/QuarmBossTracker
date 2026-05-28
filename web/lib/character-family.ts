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
};

export type EraSummary = {
  era: EraName;
  start: string;
  end: string;
  main: string | null;          // detected main for this era
  mainSource: 'big_bid' | 'ticks' | 'rank_fallback' | 'no_activity';
  dkpEarned: number;            // sum of tick.value for family members in era (raids attended * tick value approximation)
  dkpSpent: number;             // sum of loot DKP for family members in era
  itemsWon: number;
  raidsAttended: number;        // distinct raid_ids the family attended in era
};

export async function loadFamily(
  sb: SupabaseClient,
  characterName: string,
): Promise<{ root: FamilyMember | null; members: FamilyMember[] }> {
  // Step 1: find the row matching this character so we know the family root.
  const { data: selfRows } = await sb
    .from('characters')
    .select('name, rank, class, race, main_name, opendkp_id, active')
    .ilike('name', characterName)
    .eq('guild_id', 'wolfpack')
    .limit(1);

  const self = (selfRows && selfRows[0]) as FamilyMember | undefined;
  if (!self) return { root: null, members: [] };

  // Root: the character whose name matches self.main_name (or self if self IS
  // the root — main_name === name).
  const rootName = self.main_name || self.name;

  // Step 2: pull all family members.
  const { data: famRows } = await sb
    .from('characters')
    .select('name, rank, class, race, main_name, opendkp_id, active')
    .or(`main_name.eq.${rootName},name.eq.${rootName}`)
    .eq('guild_id', 'wolfpack');

  const members = ((famRows ?? []) as FamilyMember[]).sort((a, b) => {
    const ai = rankIndex(a.rank);
    const bi = rankIndex(b.rank);
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });

  const root = members.find(m => m.name === rootName) || null;

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

  return ERAS.map(era => {
    const inEra = (iso: string | null) => !!iso && iso >= era.start && iso < era.end;

    // Big bids landing in this era → main votes.
    const mainVotes = new Map<string, number>();
    let bigBidActivity = 0;
    for (const b of bigBids) {
      const ts = nestedTimestamp(b, 'opendkp_auctions', 'end_at');
      if (!inEra(ts)) continue;
      const resolved = resolveBidder(b);
      if (!resolved) continue;
      bigBidActivity++;
      mainVotes.set(resolved, (mainVotes.get(resolved) || 0) + 1);
    }

    // DKP spent (loot) in era.
    let dkpSpent = 0;
    let itemsWon = 0;
    for (const l of loot) {
      if (!inEra(l.raid_date)) continue;
      dkpSpent += l.dkp || 0;
      itemsWon += 1;
    }

    // DKP earned + per-member tick counts (for main-by-ticks fallback).
    let dkpEarned = 0;
    const raidIds = new Set<number>();
    const tickCounts = new Map<string, number>(); // family member name → tick count
    for (const t of ticks) {
      const ts = nestedTimestamp(t, 'opendkp_raids', 'ts');
      if (!inEra(ts)) continue;
      // Track each family member that appears in this tick's attendee list.
      // Members can appear by multiple casings; lowercase-normalize lookup.
      let touched = false;
      for (const attendee of (t.attendees || [])) {
        const key = (attendee || '').toLowerCase();
        if (!familyNamesLower.has(key)) continue;
        const canonical = family.find(m => m.name.toLowerCase() === key)?.name;
        if (!canonical) continue;
        tickCounts.set(canonical, (tickCounts.get(canonical) || 0) + 1);
        touched = true;
      }
      if (touched) {
        dkpEarned += t.value || 0;
        if (t.raid_id != null) raidIds.add(t.raid_id);
      }
    }

    // Priority 1: bids > 100 (deterministic — only mains can bid that high).
    // Priority 2: tick attendance (alts don't get ticked in).
    // Priority 3: rank fallback.
    let detectedMain: string | null = null;
    let mainSource: EraSummary['mainSource'] = 'no_activity';
    if (mainVotes.size > 0) {
      const ranked = [...mainVotes.entries()].sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        const fa = family.find(m => m.name === a[0]);
        const fb = family.find(m => m.name === b[0]);
        return rankIndex(fa?.rank) - rankIndex(fb?.rank);
      });
      detectedMain = ranked[0][0];
      mainSource = 'big_bid';
    } else if (tickCounts.size > 0) {
      const ranked = [...tickCounts.entries()].sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        const fa = family.find(m => m.name === a[0]);
        const fb = family.find(m => m.name === b[0]);
        return rankIndex(fa?.rank) - rankIndex(fb?.rank);
      });
      detectedMain = ranked[0][0];
      mainSource = 'ticks';
    } else {
      const fallback = currentMain(family);
      if (fallback) {
        detectedMain = fallback.name;
        mainSource = 'rank_fallback';
      }
    }

    void bigBidActivity; // bookkeeping only

    return {
      era: era.name,
      start: era.start,
      end: era.end,
      main: detectedMain,
      mainSource,
      dkpEarned,
      dkpSpent,
      itemsWon,
      raidsAttended: raidIds.size,
    };
  });
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
