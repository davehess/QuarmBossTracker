// /pop — "PoP Flags" (built ahead of the 2026-10-01 PoP unlock; live since).
//
// Primarily a GRAPHICAL progression chart (modeled on Samanna's classic planar
// chart): tier bands top-to-bottom, one card per zone with its gate, the flags
// earned inside, and live counts of how many rostered characters hold each
// flag / can enter each zone. Below the chart sits the raid-night planner —
// for each runnable target, how many raiders can attend and how many people a
// kill would push through which gate (unlock leverage), which is the "what do
// we run Sunday" question in one table.
//
// Flag data: pop_flags (agent-detected "You have received a character flag!"
// grants attributed by zone + recent boss kill; Seer Mal Nae recital parsing
// lands at launch for authoritative backfill). Catalog: web/lib/popFlags.ts —
// data-only edits when Quarm's documented QoL deviations land. 'unmapped'
// rows are grants we saw but couldn't name (the catalog's TODO list).
// /who adds the rest (2026-10-01): a character any raider's /who showed inside a gated plane holds its
// gate and the gates on the way in (pop_who_sightings + web/lib/popWho.ts), shown as a blue ✓.
// A member's own word counts too (the guild lead, 2026-10-03: "check off their own flags for their own
// characters outside of using mimic"): pop_guide_ticks, the table the /pop/guide checklist writes, read by
// web/lib/popSelfFlags.ts and shown as a gold ☑. Mimic's flag and /who both outrank it. On the matrix and
// My Characters the viewer's own cells are buttons (SelfFlagCells.tsx); everyone else's are plain marks.
// Loot counts as presence too (the guild lead, 2026-10-03: "if anyone has looted any distinct items from any
// of the planes we should go through and flag them up to that plane"): a character that looted inside a
// gated plane, or holds a NO DROP item that drops only in one, was there, so it holds the same flags a /who
// sighting there proves (pop_loot_sightings + flagsFromLoot in web/lib/popWho.ts), shown as a purple ✓.
// Proof precedence, strongest first: Mimic > /who > loot > the owner's tick.
//
// Views: default = chart + planner · ?zone=<key> = who's in/missing ·
// ?view=matrix = roster × zone table · ?view=mine = the signed-in member's
// own characters (mains AND alts — see the scope note below).
//
// ?scope=mains (default) | all — governs the guild-wide surfaces (chart,
// matrix, and the "PoP spells ... still need" table below). Default
// is mains: that's the number an officer planning a raid night cares about.
// The planner ignores it: every number there is mains with alts in parentheses.
// It does NOT apply to ?view=mine — PoP flagging is commonly done on alts
// (a chance at Justice trial loot, a Storms-quest medallion run, whatever's
// up), so a member tracking their OWN roster needs every character they own,
// not just the one flagged as their main (the guild lead, 2026-08-26: "due to the
// nature of pop flagging they may do it for many of their toons and we
// shouldn't only track mains").
//
// ?all=1 — My Characters and the spell-needs table leave out Traders, characters under level 46 and
// characters their owner hid, and fold the ones with no known level into a collapsed area
// (web/lib/listableChars.ts); this shows all of them inline again. Not a scope: it composes with ?scope and ?view.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { selectAll } from '@/lib/selectAll';
import {
  POP_ZONES, POP_ZONE_BY_KEY, POP_FLAGS, POP_FLAG_DEFS, TIER_LABELS, TIER_COLORS, JUSTICE_MARKS, MARK_OF_JUSTICE,
  zoneAccess, missingFor, type PopNode,
} from '@/lib/popFlags';
import {
  WHO_ZONE_NAMES, flagsFromLoot, flagsFromSightings, lootText, seenText, type LootProof, type Sighting, type WhoProof,
} from '@/lib/popWho';
import { loadLootSightings, type LootRow } from '@/lib/popLootRows';
import { SELF_TICK_KEYS, SELF_TICK_TITLE, gateState, proofFor, selfFlagsFromTicks } from '@/lib/popSelfFlags';
import { POP_TURN_INS, POP_TURN_IN_ORDER, type TurnInKey } from '@/lib/popSpells';
import { ownedCharacters } from '@/lib/ownedCharacters';
import { LIST_MIN_LEVEL, loadHiddenNames, loadLevels, loadTraderNames, partitionTiers } from '@/lib/listableChars';
import { popRoster, RAIDER_RANKS, RAID_ALT_RANKS, POP_MIN_LEVEL } from '@/lib/popRoster';
import SpellbookSubmit from './SpellbookSubmit';
import GateMark from './GateMark';
import { OwnedFlagCount, OwnedGateCell, SelfFlagsProvider } from './SelfFlagCells';
import EssencesQueue from './EssencesQueue';
import { loadEssenceQueue } from './essencesData';
import { demoEssenceQueue } from '@/lib/essencesQueue';
import { GUILD_TAG } from '@/lib/guild';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'PoP Flags — Wolf Pack' };

type FlagRow = { character: string; flag_key: string; earned_at: string; boss: string | null; zone: string | null };
// flags = recorded + seen + looted + self; seen = the flags only /who proves (a character standing in a gated plane);
// looted = the flags only loot proves (a character that looted in one; Mimic and /who outrank it, so a flag they
// prove is never here); self = the flags only the owner's own tick holds (Mimic, /who and loot all outrank it).
type CharFlags = {
  name: string; flags: Set<string>; unmapped: number; main: boolean;
  seen: Map<string, WhoProof>; looted: Map<string, LootProof>; self: Set<string>;
};

// One row per (character, PoP spell they haven't scribed) — main OR alt, as
// of pop_spell_needs v4 (2026-08-26). Ordered by character level descending
// in the RPC — first to the level gets first dibs.
type SpellNeed = {
  spell_name: string; spell_id: number | null; scroll_item_id: number | null;
  spell_level: number | null;
  // Which parchment buys this spell FOR THIS CHARACTER'S CLASS, straight from
  // the quest-script pools (pop_parchment_pools). null = their class's
  // turn-ins can't award it (research, or another class's tradeable scroll).
  tier: TurnInKey | null;
  character_name: string; char_class: string | null;
  char_level: number | null; held_by: string[];
  is_main: boolean;
};

type NeedByChar = {
  name: string; cls: string | null; level: number | null; isMain: boolean;
  tiers: Record<TurnInKey, SpellNeed[]>;
  // Needed, but NOT awarded by this class's turn-ins — kept visible instead
  // of miscounted into a tier (the v1 bug Lacunanight caught: "necros have 9
  // spells but shows 12").
  other: SpellNeed[];
  total: number;
};

// Group the flat RPC rows per character, then per turn-in tier — because a
// parchment hands out a RANDOM spell from its tier, so "how many does this
// person still need at this tier" is the number that decides who gets it.
function groupNeeds(rows: SpellNeed[]): NeedByChar[] {
  const by = new Map<string, NeedByChar>();
  for (const r of rows) {
    let e = by.get(r.character_name);
    if (!e) {
      e = { name: r.character_name, cls: r.char_class, level: r.char_level, isMain: r.is_main,
            tiers: { ethereal: [], spectral: [], glyphed: [] }, other: [], total: 0 };
      by.set(r.character_name, e);
    }
    // r.tier comes from the actual quest-script pools, per class. No level
    // guessing — a spell outside the class's pools lands in `other`.
    if (r.tier) e.tiers[r.tier].push(r); else e.other.push(r);
    e.total++;
  }
  // RPC already sorts by level desc; keep that order and break ties by name.
  return [...by.values()].sort((a, b) =>
    (b.level ?? -1) - (a.level ?? -1) || a.name.localeCompare(b.name));
}

const KIND_ICONS: Record<string, string> = {
  kill: '⚔', trial: '🏛', quest: '📜', event: '✨', loot: '🎁',
};

export default async function PopFlagsPage(
  { searchParams }: { searchParams: Promise<{ zone?: string; view?: string; scope?: string; v?: string; demo?: string; all?: string }> },
) {
  const { zone: zoneKey, view, scope: scopeParam, v, demo, all: allParam } = await searchParams;
  const showAll = allParam === '1';
  const scope: 'mains' | 'all' = scopeParam === 'all' ? 'all' : 'mains';
  const { data: { user } } = await supabaseServer().auth.getUser();
  // Keep the query through sign-in, so a shared ?v=b&demo=1 or ?zone= link still opens what it names.
  if (!user) redirect(`/auth/signin?next=${encodeURIComponent('/pop?' + new URLSearchParams(await searchParams as Record<string, string>))}`);
  // 💠 The Essences of Power queue, two layouts on beta until one is picked (DECISIONS §96). No ?v= is
  // production as it was. &demo=1 swaps in labelled sample data, to compare the layouts before any drop.
  const essLayout: 'b' | 'c' | null = v === 'b' || v === 'c' ? v : null;
  const essDemo = demo === '1';
  const essences = essLayout ? (essDemo ? demoEssenceQueue() : await loadEssenceQueue()) : null;

  // PoP spell needs + the viewer's own characters (for the submit widget and
  // the My Characters view — that one deliberately ignores `scope`, see the
  // header note).
  const sbAdmin = supabaseAdmin();
  // pop_spell_needs returns one row per (spell, character): 2,712 of them on 2026-10-04, and the API
  // hands back 1,000 a request, so the first read showed 37% of the table and 29 characters read as
  // "nothing missing". Read a page at a time; the function's ORDER BY ends on a unique key
  // (20261004140800_cap_safe_pop.sql) so the pages never skip or repeat a row.
  const [needRows, myCharsAll, traderNames, flaggedHidden] = await Promise.all([
    selectAll<SpellNeed>((from, to) => sbAdmin.rpc('pop_spell_needs', { p_guild_id: GUILD_TAG }).range(from, to)),
    ownedCharacters(user.id),
    loadTraderNames(sbAdmin),
    loadHiddenNames(sbAdmin),
  ]);
  const spellNeedsAll = groupNeeds(needRows);

  // Traders, characters under level 46 and characters their owner hid are tucked away on the two lists
  // that name individual characters (My Characters and the spell-needs table), behind ?all=1 (the guild
  // lead, 2026-10-03: "low level characters do not need to show up on the pop flag page. all of my
  // traders and mule characters destroy my views"). Characters with no known level are not hidden but
  // folded into a collapsed area under each list ("put any unknown characters into a minimized area").
  // They are split ONCE here, so every use below follows: the My Characters table, your spells needed
  // and the /who sightings. The spellbook picker is the exception: it gets every owned character, because
  // an upload is how an unknown one gets a level. The chart, matrix and planner count the raid roster
  // already (popRoster). Only the names whose level is not already known to clear 46 are looked up,
  // which keeps the me_levels call small.
  const lookup = [
    ...myCharsAll.map(c => c.name),
    ...spellNeedsAll.filter(n => n.level == null || n.level < LIST_MIN_LEVEL).map(n => n.name),
  ];
  const bestLevels = await loadLevels(sbAdmin, lookup);
  const bestLevel = (name: string, known: number | null) => Math.max(bestLevels.get(name.toLowerCase()) ?? 0, known ?? 0) || null;
  const minePart = partitionTiers(myCharsAll, c => ({ rank: c.rank, level: bestLevel(c.name, null), hidden: c.hidden_from_lists }));
  const needPart = partitionTiers(spellNeedsAll, n => ({
    rank: traderNames.has(n.name.toLowerCase()) ? 'Trader' : null, level: bestLevel(n.name, n.level),
    hidden: flaggedHidden.has(n.name.toLowerCase()),
  }));
  const hiddenNames = new Set([...minePart.hidden.map(c => c.name), ...needPart.hidden.map(n => n.name)].map(n => n.toLowerCase()));
  const unknownNames = new Set([...minePart.unknown.map(c => c.name), ...needPart.unknown.map(n => n.name)].map(n => n.toLowerCase()));
  const myChars = showAll ? myCharsAll : minePart.listed;
  const myUnknown = showAll ? [] : minePart.unknown;
  const spellNeeds = showAll ? spellNeedsAll : needPart.listed;
  const scopedSpellNeeds = scope === 'all' ? spellNeeds : spellNeeds.filter(n => n.isMain);
  const unknownNeeds = showAll ? [] : needPart.unknown;
  const scopedUnknownNeeds = scope === 'all' ? unknownNeeds : unknownNeeds.filter(n => n.isMain);

  // My Characters' own spell-needs slice (main + alt, scope-independent) and
  // which of those characters have a spellbook on file at all — lets the
  // empty state say "caught up" instead of the guild table's unavoidable
  // "nothing missing, or nothing submitted" hedge (we can actually check,
  // here, because the character list is short and known).
  const myNameSet = new Set(myChars.map(c => c.name.toLowerCase()));
  const myNeeds = spellNeeds.filter(n => myNameSet.has(n.name.toLowerCase()));
  let mySpellbookNames = new Set<string>();
  if (myChars.length > 0) {
    // Which of them have any spellbook rows: asked of the database as one lowered name each
    // (pop_spellbook_names). Reading the rows themselves and keeping the names stopped at the API's
    // 1,000-row cap, and one household has 1,095, so a character whose rows all sat past the first
    // 1,000 would have read as "no spellbook on file".
    const haveBook = await selectAll<{ character_key: string }>((from, to) => sbAdmin
      .rpc('pop_spellbook_names', { p_guild_id: GUILD_TAG, p_names: myChars.map(c => c.name.toLowerCase()) })
      .range(from, to));
    mySpellbookNames = new Set(haveBook.map(r => r.character_key));
  }
  const mineOrder = (rows: typeof myCharsAll) => [...rows].sort((a, b) =>
    (a.main_name ? 1 : 0) - (b.main_name ? 1 : 0) || a.name.localeCompare(b.name));
  const myCharsSorted = mineOrder(myChars);
  const myUnknownSorted = mineOrder(myUnknown);

  const sb = supabaseAdmin();
  // pop_flags holds ~10k 'unmapped' rows (the hail rows, §86) older than any real flag, and the API
  // returns at most 1,000 rows a request: the old single .limit(20000) read stopped at row 1,000, so
  // every real flag, being newer, would never have been read (the guild lead, 2026-09-29: "I see 1000
  // unmapped grants so that's probably a database row restriction"). Real flags are read a page at a
  // time; the unmapped are only counted.
  async function mappedFlagRows(): Promise<FlagRow[]> {
    // selectAll (not a loop of our own): a page that fails throws instead of ending the read with the
    // flags so far, which would draw a half-flagged guild as if it were the whole one.
    // 'hail' rows are witnessed hails (who talked to which NPC), evidence and not flags (§119).
    return selectAll<FlagRow>((from, to) => sb.from('pop_flags')
      .select('character, flag_key, earned_at, boss, zone')
      .not('flag_key', 'in', '(unmapped,hail)')
      .order('earned_at', { ascending: true }).order('id', { ascending: true })
      .range(from, to));
  }
  // The flags members ticked for their own characters (the guild lead, 2026-10-03). The same table the
  // /pop/guide checklist writes, read by the keys that stand for a flag; paged by its primary key because
  // the API returns at most 1,000 rows a request.
  async function selfTickRows(): Promise<{ character_name: string; item_key: string }[]> {
    // (character_name, item_key) is the rest of the primary key once the guild is fixed.
    return selectAll<{ character_name: string; item_key: string }>((from, to) => sb.from('pop_guide_ticks')
      .select('character_name, item_key')
      .eq('guild_id', GUILD_TAG).in('item_key', SELF_TICK_KEYS)
      .order('character_name', { ascending: true }).order('item_key', { ascending: true })
      .range(from, to));
  }
  // Justice trial marks each character holds (the guild lead, 2026-10-01: "For Justice capture the Marks
  // they have based on the one that they did"). A mark looted in the Plane of Justice counts for anyone;
  // a mark in an uploaded inventory counts unless that character opted out of inventory (exclude_inventory).
  async function marksByChar(): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    const add = (name: string, mark: string) => {
      const k = name.toLowerCase();
      if (!out.has(k)) out.set(k, new Set());
      out.get(k)!.add(mark);
    };
    const byName = new Map<string, string>(JUSTICE_MARKS.map(m => [m.name, m.name]));
    byName.set(MARK_OF_JUSTICE.name, MARK_OF_JUSTICE.name);
    const byId = new Map<number, string>(JUSTICE_MARKS.map(m => [m.id, m.name]));
    byId.set(MARK_OF_JUSTICE.id, MARK_OF_JUSTICE.name);
    // A page at a time (selectAll): the API returns at most 1,000 rows a request, whatever limit is asked,
    // and a page that fails throws rather than leaving a character without the marks it holds.
    const [loots, inv] = await Promise.all([
      selectAll<{ looter_character: string; item_name: string }>((from, to) => sb.from('looted_items')
        .select('looter_character, item_name')
        .eq('guild_id', GUILD_TAG).eq('zone', '201').in('item_name', [...byName.keys()])
        .order('id', { ascending: true }).range(from, to)),
      selectAll<{ character_name: string; item_id: number }>((from, to) => sb.from('character_inventory')
        .select('character_name, item_id')
        .eq('guild_id', GUILD_TAG).in('item_id', [...byId.keys()])
        .order('id', { ascending: true }).range(from, to)),
    ]);
    for (const r of loots) add(r.looter_character, r.item_name);
    const invRows = inv;
    if (invRows.length) {
      const names = [...new Set(invRows.map(r => r.character_name))];
      const { data: optedOut } = await sb.from('characters').select('name')
        .eq('guild_id', GUILD_TAG).eq('exclude_inventory', true).in('name', names).limit(1000);
      const hidden = new Set(((optedOut ?? []) as { name: string }[]).map(r => r.name.toLowerCase()));
      for (const r of invRows) {
        const mark = byId.get(r.item_id);
        if (mark && !hidden.has(r.character_name.toLowerCase())) add(r.character_name, mark);
      }
    }
    return out;
  }

  const [flagRows, { count: unmappedCount }, { data: rosterRaw }, { count: rosterCount }, marks, tickRows] = await Promise.all([
    mappedFlagRows(),
    sb.from('pop_flags').select('id', { count: 'exact', head: true }).eq('flag_key', 'unmapped'),
    sb.from('characters')
      .select('name, rank, active')
      .eq('guild_id', GUILD_TAG)
      .in('rank', [...RAIDER_RANKS, ...RAID_ALT_RANKS])
      .limit(1000),
    sb.from('characters')
      .select('name', { count: 'exact', head: true })
      .eq('guild_id', GUILD_TAG),
    marksByChar(),
    selfTickRows(),
  ]);
  const marksOf = (name: string): string[] => {
    const s = marks.get(name.toLowerCase());
    return s ? JUSTICE_MARKS.filter(m => s.has(m.name)).map(m => m.trial) : [];
  };
  const hasMarkOfJustice = (name: string) => !!marks.get(name.toLowerCase())?.has(MARK_OF_JUSTICE.name);

  // Levels from each character's last /who (who_directory), a hundred names a request.
  const rosterRows = (rosterRaw ?? []) as { name: string; rank: string | null; active: boolean | null }[];
  const levelOf = new Map<string, number>();
  for (let i = 0; i < rosterRows.length; i += 100) {
    const { data } = await sb.from('who_directory').select('character_key, level')
      .in('character_key', rosterRows.slice(i, i + 100).map(r => r.name.toLowerCase())).limit(1000);
    for (const w of (data ?? []) as { character_key: string; level: number | null }[]) {
      if (w.level != null && w.level > (levelOf.get(w.character_key) ?? 0)) levelOf.set(w.character_key, w.level);
    }
  }
  const members = popRoster(rosterRows.map(r => ({ ...r, level: levelOf.get(r.name.toLowerCase()) ?? null })));

  // Per-character flag sets (canonical casing = first seen), for anyone with a real flag — the My
  // Characters view reads these for the viewer's own toons, whatever their rank.
  const byChar = new Map<string, CharFlags>();
  for (const r of flagRows) {
    const k = r.character.toLowerCase();
    let c = byChar.get(k);
    if (!c) { c = { name: r.character, flags: new Set(), unmapped: 0, main: true, seen: new Map(), looted: new Map(), self: new Set() }; byChar.set(k, c); }
    c.flags.add(r.flag_key);
  }
  // /who, for the roster and the viewer's own characters (the guild lead, 2026-10-01: "from /who in the
  // zone for users that don't have mimic, and if they're in that zone that requires other zones we
  // should note it"). Standing in a gated plane proves its gate and the gates on the way in
  // (web/lib/popWho.ts). Those flags count everywhere below, kept in `seen` so the page can say so.
  const nameOf = new Map([...members.map(m => m.name), ...myChars.map(c => c.name), ...myUnknown.map(c => c.name)].map(n => [n.toLowerCase(), n]));
  // Loot is read beside it (pop_loot_sightings, every character, a page at a time) and kept for the same
  // names, so one more round trip does not wait on the first.
  // /who is paged like the loot: 133 sightings for the roster after four days of PoP and growing, and the
  // API stops at 1,000 a request. pop_who_sightings orders its rows (character, zone), its group key.
  type SightRow = Sighting & { character_key: string };
  const [sightRows, lootRows] = await Promise.all([
    nameOf.size
      ? selectAll<SightRow>((from, to) =>
        sb.rpc('pop_who_sightings', { p_guild_id: GUILD_TAG, p_names: [...nameOf.keys()], p_zones: WHO_ZONE_NAMES }).range(from, to))
      : Promise.resolve([] as SightRow[]),
    nameOf.size ? loadLootSightings(sb) : Promise.resolve([] as LootRow[]),
  ]);
  const sightBy = new Map<string, Sighting[]>();
  for (const r of sightRows) {
    if (!sightBy.has(r.character_key)) sightBy.set(r.character_key, []);
    sightBy.get(r.character_key)!.push(r);
  }
  for (const [k, rows] of sightBy) {
    let c = byChar.get(k);
    if (!c) { c = { name: nameOf.get(k) ?? k, flags: new Set(), unmapped: 0, main: true, seen: new Map(), looted: new Map(), self: new Set() }; byChar.set(k, c); }
    for (const [f, proof] of flagsFromSightings(rows)) {
      if (c.flags.has(f)) continue;
      c.flags.add(f);
      c.seen.set(f, proof);
    }
  }
  // Loot next (the guild lead, 2026-10-03: "if anyone has looted any distinct items from any of the planes we
  // should go through and flag them up to that plane"): the same proof of presence as a /who sighting, so the
  // same flags. It comes after /who and before the ticks: a flag Mimic or /who already holds keeps that mark,
  // so where /who and loot prove the same flag the blue /who ✓ is the one shown (the older, wider record, and
  // it leaves purple to mean "only the loot says so"), and a tick never shows over a loot.
  const lootBy = new Map<string, LootRow[]>();
  for (const r of lootRows) {
    if (!nameOf.has(r.character_key)) continue;
    if (!lootBy.has(r.character_key)) lootBy.set(r.character_key, []);
    lootBy.get(r.character_key)!.push(r);
  }
  for (const [k, rows] of lootBy) {
    let c = byChar.get(k);
    if (!c) { c = { name: nameOf.get(k) ?? k, flags: new Set(), unmapped: 0, main: true, seen: new Map(), looted: new Map(), self: new Set() }; byChar.set(k, c); }
    for (const [f, proof] of flagsFromLoot(rows)) {
      if (c.flags.has(f)) continue;
      c.flags.add(f);
      c.looted.set(f, proof);
    }
  }
  // The owners' own word, last, so Mimic's record and /who's sighting both outrank it: a flag already held
  // is never marked as a tick (the guild lead, 2026-10-03). Only the roster and the viewer's characters are
  // looked at, like /who above.
  for (const [k, flags] of selfFlagsFromTicks(tickRows)) {
    if (!nameOf.has(k)) continue;
    let c = byChar.get(k);
    if (!c) { c = { name: nameOf.get(k) ?? k, flags: new Set(), unmapped: 0, main: true, seen: new Map(), looted: new Map(), self: new Set() }; byChar.set(k, c); }
    for (const f of flags) {
      if (c.flags.has(f)) continue;
      c.flags.add(f);
      c.self.add(f);
    }
  }
  const seenCount = [...byChar.values()].filter(c => c.seen.size > 0).length;
  const lootCount = [...byChar.values()].filter(c => c.looted.size > 0).length;
  const selfCount = [...byChar.values()].filter(c => c.self.size > 0).length;
  // The characters the viewer owns, hidden and low-level ones included: their cells are the buttons.
  const ownedKeys = new Set(myCharsAll.map(c => c.name.toLowerCase()));
  // The guild-wide surfaces count the raid roster only (popRoster): raiders are the mains, raid alts the
  // alts. Their flags come from byChar; someone with none yet can still enter the open tier.
  const chars: CharFlags[] = members
    .map(m => {
      const c = byChar.get(m.name.toLowerCase());
      return { name: m.name, flags: c?.flags ?? new Set<string>(), unmapped: 0, main: m.main,
               seen: c?.seen ?? new Map<string, WhoProof>(), looted: c?.looted ?? new Map<string, LootProof>(),
               self: c?.self ?? new Set<string>() };
    })
    .sort((a, b) => b.flags.size - a.flags.size || a.name.localeCompare(b.name));
  const totalUnmapped = unmappedCount ?? 0;

  // Everything below this line — counts, the chart, the matrix, the planner —
  // reads `scopedChars`, not `chars`. Default is mains (the raider ranks); `?scope=all` adds the raid
  // alts. `byChar` (unscoped) stays around only for the My Characters view, which always wants the
  // viewer's full roster regardless of scope.
  const scopedChars = scope === 'all' ? chars : chars.filter(c => c.main);

  // Counts.
  const flagCount = new Map<string, number>();
  for (const c of scopedChars) for (const f of c.flags) flagCount.set(f, (flagCount.get(f) ?? 0) + 1);
  // How many of those holders are the owner's own word: a ticked flag, not one Mimic or /who saw.
  const selfFlagCount = new Map<string, number>();
  for (const c of scopedChars) for (const f of c.self) selfFlagCount.set(f, (selfFlagCount.get(f) ?? 0) + 1);
  const selfNote = (f: string) => {
    const s = selfFlagCount.get(f) ?? 0;
    return s > 0 ? ` (${s} ticked by their owners)` : '';
  };
  // Justice marks held across the scoped roster, one count per trial.
  const markCount = new Map<string, number>();
  for (const c of scopedChars) for (const t of marksOf(c.name)) markCount.set(t, (markCount.get(t) ?? 0) + 1);
  const eligibleCount = new Map<string, number>();
  const eligibleChars = new Map<string, CharFlags[]>();
  for (const z of POP_ZONES) {
    const list = scopedChars.filter(c => zoneAccess(z, c.flags));
    eligibleCount.set(z.key, list.length);
    eligibleChars.set(z.key, list);
  }

  // ── Raid-night planner ────────────────────────────────────────────────────
  // For each earnable flag F in zone Z: who could ATTEND (eligible for Z),
  // who would GAIN F, and what that unlocks — per downstream gate W where F is
  // required, the characters missing ONLY F for W ("one flag away through F").
  // It counts the scoped roster, like the rest of the page (the guild lead, 2026-09-29: "it should be mains
  // only when i'm on mains, vs all characters"). On All characters each number is mains with the raid alts
  // in parentheses ("make this mains and in parenths alts"); ranked by mains either way.
  type Split = { mains: number; alts: number };
  const split = (list: CharFlags[]): Split => {
    const mains = list.filter(c => c.main).length;
    return { mains, alts: list.length - mains };
  };
  type PlanRow = {
    flag: string; zone: PopNode; attend: Split; gains: Split;
    unlocks: { zone: PopNode; count: Split; mains: string[]; alts: string[] }[];
    leverage: Split;
  };
  const plan: PlanRow[] = [];
  for (const z of POP_ZONES) {
    for (const fk of z.grants) {
      const def = POP_FLAGS[fk];
      if (!def || def.kind === 'loot') continue;
      const attendList = scopedChars.filter(c => zoneAccess(z, c.flags));
      const gains = attendList.filter(c => !c.flags.has(fk));
      const unlocks = POP_ZONES
        .filter(w => w.requires.includes(fk))
        .map(w => {
          const oneAway = scopedChars.filter(c => {
            const miss = missingFor(w, c.flags);
            return miss.length === 1 && miss[0] === fk;
          });
          return { zone: w, count: split(oneAway),
            mains: oneAway.filter(c => c.main).map(c => c.name),
            alts: oneAway.filter(c => !c.main).map(c => c.name) };
        })
        .filter(u => u.count.mains + u.count.alts > 0);
      const leverage = unlocks.reduce((n, u) => ({ mains: n.mains + u.count.mains, alts: n.alts + u.count.alts }), { mains: 0, alts: 0 });
      plan.push({ flag: fk, zone: z, attend: split(attendList), gains: split(gains), unlocks, leverage });
    }
  }
  plan.sort((a, b) => b.leverage.mains - a.leverage.mains || b.gains.mains - a.gains.mains
    || b.leverage.alts - a.leverage.alts || b.gains.alts - a.gains.alts || a.zone.tier - b.zone.tier);
  const planTop = plan.filter(p => p.leverage.mains + p.leverage.alts > 0 || p.gains.mains + p.gains.alts > 0).slice(0, 12);
  const MainsAlts = ({ s }: { s: Split }) => <>{s.mains}{scope === 'all' && <span className="text-dim"> ({s.alts})</span>}</>;

  const selected = zoneKey ? POP_ZONE_BY_KEY[zoneKey] ?? null : null;
  const topLevel = POP_ZONES.filter(z => !z.subZoneOf);
  const childrenOf = (key: string) => POP_ZONES.filter(z => z.subZoneOf === key);
  const gatedZones = POP_ZONES.filter(z => z.requires.length > 0);

  // Nav + scope-toggle links. Every link preserves the OTHER dimension it
  // doesn't explicitly change — flipping scope while looking at a zone stays
  // on that zone; switching Chart/Matrix keeps whichever scope is set.
  function hrefFor(overrides: { view?: string | null; zone?: string | null; scope?: string | null; all?: string | null }) {
    const next = {
      view: view ?? null, zone: zoneKey ?? null, scope: scope === 'all' ? 'all' : null, all: showAll ? '1' : null,
      ...overrides,
    };
    const params = new URLSearchParams();
    if (next.zone) params.set('zone', next.zone);
    if (next.view) params.set('view', next.view);
    if (next.scope) params.set('scope', next.scope);
    if (next.all) params.set('all', next.all);
    const qs = params.toString();
    return '/pop' + (qs ? `?${qs}` : '');
  }
  const navCls = (active: boolean) =>
    `px-2 py-0.5 rounded border ${active ? 'border-gold text-gold' : 'border-border hover:text-text'}`;

  // The trials a character has a mark from, shown beside their name on the Justice page.
  function markTag(name: string) {
    if (selected?.key !== 'justice') return null;
    const t = marksOf(name);
    if (!t.length && !hasMarkOfJustice(name)) return null;
    return (
      <span className="text-[11px] text-gold" title="Justice trial marks held">
        {' '}· {t.join(', ')}{hasMarkOfJustice(name) ? `${t.length ? ', ' : ''}Mark of Justice` : ''}
      </span>
    );
  }

  // A gate that only /who proves for a character: its ✓ is blue and says where they were seen, and
  // the zone page adds "seen in Storms on /who" beside the name.
  const seenFor = (z: PopNode, c: { seen: Map<string, WhoProof> }) =>
    z.requires.map(f => c.seen.get(f)).filter((p): p is WhoProof => !!p);
  function seenTitle(proofs: WhoProof[]) {
    const byZone = [...new Map(proofs.map(p => [p.zone, p])).values()];
    return byZone.map(p => `${seenText(p.zone)} First seen ${new Date(p.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.`).join(' ');
  }
  // A flag only loot proves (pop_loot_sightings): a purple ✓ that says where they looted. Mimic and /who
  // outrank it, so a flag either one holds is never in `looted` (see the merge above).
  const lootedFor = (z: PopNode, c: { looted: Map<string, LootProof> }) =>
    z.requires.map(f => c.looted.get(f)).filter((p): p is LootProof => !!p);
  function lootTitle(proofs: LootProof[]) {
    const byZone = [...new Map(proofs.map(p => [p.zone, p])).values()];
    return byZone.map(p => `${lootText(p.zone, p.source)} First ${p.source === 'inventory' ? 'seen held' : 'looted'} ${new Date(p.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.`).join(' ');
  }
  // What a cell's tooltip says about the proof behind it: where /who saw them, where they looted.
  function proofTitle(z: PopNode, c: { seen: Map<string, WhoProof>; looted: Map<string, LootProof> }) {
    const seen = seenFor(z, c);
    const looted = lootedFor(z, c);
    return [seen.length ? seenTitle(seen) : '', looted.length ? lootTitle(looted) : ''].filter(Boolean).join(' ');
  }
  // A flag a member only ticked (web/lib/popSelfFlags.ts) is their own word, shown as a gold ☑ that says
  // so. A gate is only as proven as its weakest flag, so one ticked flag makes the whole cell ☑.
  const selfOf = (z: PopNode, c: { self: Set<string> }) => z.requires.filter(f => c.self.has(f));
  function selfTitle(z: PopNode, c: { self: Set<string> }) {
    return `${SELF_TICK_TITLE}: ${selfOf(z, c).map(f => POP_FLAGS[f]?.label ?? f).join(', ')}.`;
  }
  type MarkSource = { flags: Set<string>; seen: Map<string, WhoProof>; looted: Map<string, LootProof>; self: Set<string> };
  function AccessMark({ z, c }: { z: PopNode; c: MarkSource }) {
    const g = gateState(z.requires, proofFor(z.requires, c), c.self);
    if (g.mark === 'none') return <span className="text-dim">—</span>;
    const title = [g.mark === 'self' ? selfTitle(z, c) : '', proofTitle(z, c)].filter(Boolean).join(' ');
    return <GateMark kind={g.mark} title={title || undefined} />;
  }
  // One gate cell, as the owner's button when the viewer owns the character and as AccessMark for everyone
  // else's. The button decides for itself whether anything is left to tick (SelfFlagCells.tsx).
  function GateCell({ z, c, owned }: { z: PopNode; c: MarkSource & { name: string }; owned: boolean }) {
    if (!owned) return <AccessMark z={z} c={c} />;
    return (
      <OwnedGateCell character={c.name} zone={z.name}
                     requires={z.requires.map(f => ({ key: f, label: POP_FLAGS[f]?.label ?? f }))}
                     proof={proofFor(z.requires, c)} proofTitle={proofTitle(z, c)} />
    );
  }
  // What a row's Flags number starts from: every flag Mimic or /who holds. The viewer's ticks are added live.
  const provenOf = (c: MarkSource) => [...c.flags].filter(f => !c.self.has(f));
  // The viewer's own ticks for the rows of a table, to seed its SelfFlagsProvider.
  const ownTicks = (rows: { name: string; self: Set<string> }[]) =>
    Object.fromEntries(rows.filter(r => ownedKeys.has(r.name.toLowerCase())).map(r => [r.name.toLowerCase(), [...r.self]]));
  function seenTag(c: CharFlags) {
    if (!selected) return null;
    const seen = seenFor(selected, c);
    if (!seen.length) return null;
    const zones = [...new Set(seen.map(p => POP_ZONE_BY_KEY[p.zone]?.short ?? p.zone))];
    return <span className="text-[11px] text-blue" title={seenTitle(seen)}> · seen in {zones.join(', ')} on /who</span>;
  }
  function lootTag(c: CharFlags) {
    if (!selected) return null;
    const looted = lootedFor(selected, c);
    if (!looted.length) return null;
    const zones = [...new Set(looted.map(p => POP_ZONE_BY_KEY[p.zone]?.short ?? p.zone))];
    return <span className="text-[11px] text-purple" title={lootTitle(looted)}> · looted in {zones.join(', ')}</span>;
  }
  function selfTag(c: CharFlags) {
    if (!selected || selfOf(selected, c).length === 0) return null;
    return <span className="text-[11px] text-gold" title={selfTitle(selected, c)}> · ☑ ticked by its owner</span>;
  }

  // ── Card renderer (server-side JSX helper) ────────────────────────────────
  function ZoneCard({ z }: { z: PopNode }) {
    const color = TIER_COLORS[z.tier];
    const elig = eligibleCount.get(z.key) ?? 0;
    const kids = childrenOf(z.key);
    return (
      <div className="bg-panel border border-border rounded-lg p-3 flex flex-col gap-2"
           style={{ borderTop: `3px solid ${color}` }}>
        <div className="flex items-start justify-between gap-2">
          <Link href={`/pop?zone=${z.key}`} className="text-sm text-text font-semibold hover:underline leading-tight">
            {z.name}{!z.verified && <span className="text-dim" title="gate unverified until launch"> *</span>}
          </Link>
          <span className={`text-[11px] px-1.5 py-0.5 rounded border whitespace-nowrap ${elig > 0 ? 'border-green/60 text-green' : 'border-border text-dim'}`}
                title="characters who can enter">
            {elig} in
          </span>
        </div>
        {z.requires.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {z.requires.map(f => (
              <span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-black/30 border border-border text-dim"
                    title={`${POP_FLAGS[f]?.label ?? f} — ${flagCount.get(f) ?? 0} have it${selfNote(f)}`}>
                ⤓ {POP_FLAGS[f]?.label ?? f} <b className="text-text">{flagCount.get(f) ?? 0}</b>
              </span>
            ))}
          </div>
        )}
        <ul className="space-y-0.5">
          {z.grants.map(f => {
            const def = POP_FLAGS[f];
            const n = flagCount.get(f) ?? 0;
            return (
              <li key={f} className="text-xs flex items-center justify-between gap-2">
                <span className="text-dim">{KIND_ICONS[def?.kind ?? 'event']} {def?.label ?? f}{def && !def.verified && ' *'}</span>
                <span className="text-[11px]">
                  <span className={n > 0 ? 'text-green' : 'text-dim'}>👤 {n}</span>
                  {(selfFlagCount.get(f) ?? 0) > 0 && (
                    <span className="text-gold" title={`${selfFlagCount.get(f)} of them ticked by their owners on the site, not seen by Mimic or /who`}> ☑{selfFlagCount.get(f)}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {z.key === 'justice' && (
          <div className="flex flex-wrap gap-1" title="Trial marks held: looted in Justice, or in an uploaded inventory">
            {JUSTICE_MARKS.map(m => (
              <span key={m.trial} className="text-[10px] px-1.5 py-0.5 rounded bg-black/30 border border-border text-dim">
                {m.trial} <b className={(markCount.get(m.trial) ?? 0) > 0 ? 'text-gold' : 'text-dim'}>{markCount.get(m.trial) ?? 0}</b>
              </span>
            ))}
          </div>
        )}
        {z.levelBypass && (
          <div className="text-[10px] text-dim">classic: enter unflagged at {z.levelBypass}+</div>
        )}
        {z.note && <div className="text-[10px] text-dim italic leading-tight">{z.note}</div>}
        {kids.map(k => (
          <div key={k.key} className="mt-1 rounded border border-dashed border-border p-2">
            <ZoneCard z={k} />
          </div>
        ))}
      </div>
    );
  }

  // The My Characters table, once for the listed characters and once inside the "no known level" fold.
  function MineTable({ rows }: { rows: typeof myCharsAll }) {
    const flagsOf = (c: (typeof rows)[number]): CharFlags => byChar.get(c.name.toLowerCase())
      ?? { name: c.name, flags: new Set<string>(), unmapped: 0, main: !c.main_name, seen: new Map<string, WhoProof>(), looted: new Map<string, LootProof>(), self: new Set<string>() };
    // Every row here is the viewer's own character, so every gate cell is theirs to tick (SelfFlagCells.tsx).
    return (
      <SelfFlagsProvider initial={ownTicks(rows.map(flagsOf))}>
        <div className="overflow-x-auto">
          <table className="text-sm min-w-full">
            <thead>
              <tr className="text-dim text-xs text-left">
                <th className="py-1 pr-3">Character</th>
                <th className="py-1 pr-3">Class</th>
                {gatedZones.map(z => <th key={z.key} className="py-1 px-2 text-center" title={z.name}>{z.short}</th>)}
                <th className="py-1 px-2" title="Justice trial marks held">Marks</th>
                <th className="py-1 pl-2 text-right">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {rows.map(c => {
                const f = flagsOf(c);
                return (
                  <tr key={c.name}>
                    <td className="py-1.5 pr-3">
                      <Link href={`/character/${encodeURIComponent(c.name)}`} className="text-text hover:underline">{c.name}</Link>
                      {!c.main_name && <span className="ml-1 text-[10px] text-gold" title="main">★</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-dim">{c.class ?? '—'}</td>
                    {gatedZones.map(z => (
                      <td key={z.key} className="py-1.5 px-2 text-center">
                        <GateCell z={z} c={f} owned />
                      </td>
                    ))}
                    <td className="py-1.5 px-2 text-xs text-gold whitespace-nowrap">
                      {[...marksOf(c.name), ...(hasMarkOfJustice(c.name) ? ['Mark of Justice'] : [])].join(', ') || <span className="text-dim">—</span>}
                    </td>
                    <td className="py-1.5 pl-2 text-right text-dim text-xs"><OwnedFlagCount character={c.name} proven={provenOf(f)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SelfFlagsProvider>
    );
  }

  // The spell-needs table, once for the listed characters and once inside the "no known level" fold.
  function NeedsTable({ rows }: { rows: NeedByChar[] }) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-dim text-xs text-left">
              <th className="py-1 pr-3">Character</th>
              <th className="py-1 pr-3">Class</th>
              <th className="py-1 pr-3 text-right">Level</th>
              {POP_TURN_IN_ORDER.map(k => (
                <th key={k} className="py-1 pr-3 text-right" title={POP_TURN_INS[k].blurb}>
                  {POP_TURN_INS[k].item.replace(' Parchment', '').replace('Glyphed Rune Word', 'Rune Word')}
                </th>
              ))}
              <th className="py-1 pr-3 text-right"
                  title="Needed, but not awarded by this class's parchment turn-ins — research spells, or another class's tradeable scroll (e.g. necro Destroy Undead rides a cleric 64 scroll).">
                Other
              </th>
              <th className="py-1 pr-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {rows.map(n => (
              <tr key={n.name} className="hover:bg-[#1a212c] align-top">
                <td className="py-1.5 pr-3">
                  <Link href={`/character/${encodeURIComponent(n.name)}/spells`} className="text-blue hover:underline">{n.name}</Link>
                  {!n.isMain && <span className="ml-1 text-[10px] text-dim">alt</span>}
                </td>
                <td className="py-1.5 pr-3 text-dim">{n.cls ?? '—'}</td>
                <td className="py-1.5 pr-3 text-right text-text">{n.level ?? '—'}</td>
                {POP_TURN_IN_ORDER.map(k => {
                  const list = n.tiers[k];
                  return (
                    <td key={k} className="py-1.5 pr-3 text-right"
                        title={list.length ? list.map(x => x.spell_name).join(', ') : 'nothing needed at this tier'}>
                      <span className={list.length ? 'text-orange' : 'text-dim/50'}>{list.length || '—'}</span>
                    </td>
                  );
                })}
                <td className="py-1.5 pr-3 text-right"
                    title={n.other.length ? n.other.map(x => x.spell_name).join(', ') : 'nothing outside the turn-in lists'}>
                  <span className={n.other.length ? 'text-purple' : 'text-dim/50'}>{n.other.length || '—'}</span>
                </td>
                <td className="py-1.5 pr-3 text-right text-text">{n.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // The collapsed area for characters nobody has a level for (the guild lead, 2026-10-03: "put any
  // unknown characters into a minimized area"). Closed by default; it wraps, so it cannot widen the page.
  const noLevelFold = (n: number, body: React.ReactNode) => (
    <details className="bg-bg/40 border border-border/60 rounded min-w-0 max-w-full">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs text-dim hover:text-text">
        {n} character{n === 1 ? '' : 's'} with no known level — upload a spellbook or get {n === 1 ? 'it' : 'them'} seen in /who to place {n === 1 ? 'it' : 'them'}
      </summary>
      <div className="p-2">{body}</div>
    </details>
  );

  // The marks the matrix and My Characters use, next to the tables that show them.
  const gateLegend = (
    <p className="text-[11px] text-dim mt-3 leading-5">
      <span className="text-green">✓</span> Mimic saw it · <span className="text-blue">✓</span> seen on /who ·{' '}
      <span className="text-purple">✓</span> looted in the plane ·{' '}
      <span className="text-gold">☑</span> {SELF_TICK_TITLE.toLowerCase()}, their own word · — not yet.{' '}
      On your own characters a cell is a button: tap it to tick or untick.
    </p>
  );

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold flex items-center gap-3 mb-1">
          <span>🌀 PoP Flags</span>
        </h2>
        <p className="text-sm text-dim leading-6">
          The guild&apos;s road to <b className="text-text">Quarm</b> — every gate, who&apos;s through it, and what to
          raid next to move the most people forward. Counts update from the flags Mimic sees: each grant is named by
          what the flag NPC said just before it, and sitting with Seer Mal Nae`Shi in Knowledge (say &quot;guided
          meditation&quot;) records everything a character holds. <b className="text-text">/who</b> fills in the rest,
          Mimic or not: anyone a raider&apos;s /who shows inside a flagged plane holds that plane&apos;s gate, and the
          gates of the planes they came through (a <span className="text-blue">blue ✓</span>; hover it for where).
          So does <b className="text-text">loot</b>: anyone who looted inside a flagged plane was there, and gets
          the same gates (a <span className="text-purple">purple ✓</span>).
          Anyone can also tick their <b className="text-text">own</b> characters&apos; gates on the Matrix or My
          Characters views, or on <Link href="/pop/guide" className="underline">their checklist</Link>: that is their
          own word, a <span className="text-gold">gold ☑</span>, and Mimic or /who outranks it.
          The gates are Quarm&apos;s own, read from the server&apos;s portal script; there is no level bypass. Zones
          marked <b className="text-text">*</b> are not yet confirmed that way.
        </p>
        <div className="flex flex-wrap gap-4 mt-3 text-xs text-dim items-center">
          <span>
            <span title={`Raiders (Pack Leader, Officer, Raid Pack, Recruit) and raid alts, active, level ${POP_MIN_LEVEL}+ on their last /who. Traders and inactive characters are left out.`}>
              👥 <b className="text-text">{scopedChars.length}</b> {scope === 'mains' ? 'raiders' : 'raiders and raid alts'} at {POP_MIN_LEVEL}+
              {scope === 'mains' && chars.length > scopedChars.length && (
                <span className="text-dim"> ({chars.length - scopedChars.length} raid alts)</span>
              )}
            </span>
            {' '}· roster {rosterCount ?? '—'}
          </span>
          <span>🚩 <b className="text-text">{flagRows.length}</b> flags recorded</span>
          {seenCount > 0 && (
            <span title="Characters a raider's /who showed inside a plane behind a gate: their flags for it count, Mimic or not.">
              👁 <b className="text-text">{seenCount}</b> placed by /who
            </span>
          )}
          {lootCount > 0 && (
            <span title="Characters who looted inside a plane behind a gate (or hold a NO DROP item that drops only there) and were not already placed by Mimic or /who: their flags for it count, marked with a purple ✓.">
              🎒 <b className="text-text">{lootCount}</b> placed by loot
            </span>
          )}
          {selfCount > 0 && (
            <span title="Characters whose owner ticked a flag on the site that Mimic and /who have not shown: it counts everywhere, marked ☑.">
              ☑ <b className="text-text">{selfCount}</b> with ticked flags
            </span>
          )}
          {totalUnmapped > 0 && <span className="text-orange">⚠ {totalUnmapped} unmapped grants (catalog TODO)</span>}
          {(hiddenNames.size > 0 || unknownNames.size > 0) && (
            <span title={`Applies to My Characters and the spell-needs table. A character is hidden when it is a Trader, its owner hid it from /me, or its level is known and under ${LIST_MIN_LEVEL}, the lowest level any Planes of Power zone lets in. A character with no known level is not hidden: it sits in a collapsed area under each list.`}>
              {showAll ? `Traders, hidden characters and characters under ${LIST_MIN_LEVEL} shown. ` : `Traders, hidden characters and characters under ${LIST_MIN_LEVEL} hidden. `}
              <Link href={hrefFor({ all: showAll ? null : '1' })} className="underline hover:text-text">
                {showAll ? 'Hide them' : `Show all (${hiddenNames.size} hidden${unknownNames.size > 0 ? `, ${unknownNames.size} no level` : ''})`}
              </Link>
            </span>
          )}
          <span className="ml-auto flex flex-wrap gap-2 items-center">
            <span className="flex gap-1 mr-1" title={`Applies to the chart, matrix and the spell-needs table below — not to the planner, which always shows mains with alts in parentheses, nor to My Characters, which shows every character you own (traders, hidden characters and characters under ${LIST_MIN_LEVEL} sit behind Show all; ones with no known level are folded away).`}>
              <Link href={hrefFor({ scope: null })} className={navCls(scope === 'mains')}>Mains</Link>
              <Link href={hrefFor({ scope: 'all' })} className={navCls(scope === 'all')}>All characters</Link>
            </span>
            <Link href={hrefFor({ view: null, zone: null })} className={navCls(!selected && view !== 'matrix' && view !== 'mine')}>Chart</Link>
            <Link href={hrefFor({ view: 'matrix', zone: null })} className={navCls(view === 'matrix')}>Matrix</Link>
            <Link href={hrefFor({ view: 'mine', zone: null })} className={navCls(view === 'mine')}>🧍 My Characters</Link>
            <Link href="/pop/guide" className={navCls(false)}>☑ My checklist</Link>
          </span>
        </div>
      </section>

      {essLayout && essences && <EssencesQueue layout={essLayout} demo={essDemo} {...essences} />}

      {selected ? (
        // ── Zone detail: who's in, who's missing what ─────────────────────────
        <section className="bg-panel border border-border rounded-lg p-4">
          <div className="flex items-center gap-3 mb-1">
            <h3 className="text-base text-orange">{selected.name}</h3>
            <span className="text-xs text-dim">{TIER_LABELS[selected.tier].name}{!selected.verified && ' · gate unverified'}</span>
            <Link href="/pop" className="ml-auto text-xs text-dim hover:text-text">← back to chart</Link>
          </div>
          <p className="text-xs text-dim mb-3">
            Gate: {selected.requires.map(f => POP_FLAGS[f]?.label ?? f).join(' + ') || 'open'}
            {selected.levelBypass ? ` · classic unflagged entry at ${selected.levelBypass}+` : ''}
          </p>
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs text-green mb-1">✓ Can enter ({(eligibleChars.get(selected.key) ?? []).length})</div>
              <ul className="space-y-0.5">
                {(eligibleChars.get(selected.key) ?? []).map(c => (
                  <li key={c.name}><Link href={`/character/${encodeURIComponent(c.name)}`} className="text-text hover:underline">{c.name}</Link>{markTag(c.name)}{seenTag(c)}{lootTag(c)}{selfTag(c)}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-xs text-red mb-1">✗ Missing ({scopedChars.filter(c => !zoneAccess(selected, c.flags)).length})</div>
              <ul className="space-y-0.5">
                {scopedChars.filter(c => !zoneAccess(selected, c.flags)).map(c => (
                  <li key={c.name} className="text-dim">
                    <Link href={`/character/${encodeURIComponent(c.name)}`} className="hover:underline">{c.name}</Link>
                    <span className="text-xs"> — {missingFor(selected, c.flags).map(f => POP_FLAGS[f]?.label ?? f).join(', ')}</span>
                    {markTag(c.name)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : view === 'matrix' ? (
        // ── Roster × zone matrix (secondary view) ─────────────────────────────
        <section className="bg-panel border border-border rounded-lg p-4 overflow-x-auto">
          {scopedChars.length === 0 ? (
            <p className="text-sm text-dim">No flags recorded yet — the matrix fills in as grants land.</p>
          ) : (
            // The viewer's own rows are buttons: tick a gate you hold that Mimic never saw (the guild lead,
            // 2026-10-03). Everyone else's cells stay plain marks. Still the one horizontal scroller (this
            // section), so the header row cannot widen the page on a phone.
            <SelfFlagsProvider initial={ownTicks(scopedChars)}>
              <table className="text-sm min-w-full">
                <thead>
                  <tr className="text-dim text-xs text-left">
                    <th className="py-1 pr-3">Character</th>
                    {gatedZones.map(z => <th key={z.key} className="py-1 px-2 text-center" title={z.name}>{z.short}</th>)}
                    <th className="py-1 pl-2 text-right">Flags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {scopedChars.map(c => {
                    const owned = ownedKeys.has(c.name.toLowerCase());
                    return (
                      <tr key={c.name}>
                        <td className="py-1.5 pr-3">
                          <Link href={`/character/${encodeURIComponent(c.name)}`} className="text-text hover:underline">{c.name}</Link>
                        </td>
                        {gatedZones.map(z => (
                          <td key={z.key} className="py-1.5 px-2 text-center">
                            <GateCell z={z} c={c} owned={owned} />
                          </td>
                        ))}
                        <td className="py-1.5 pl-2 text-right text-dim text-xs">
                          {owned ? <OwnedFlagCount character={c.name} proven={provenOf(c)} /> : c.flags.size}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </SelfFlagsProvider>
          )}
          {scopedChars.length > 0 && gateLegend}
        </section>
      ) : view === 'mine' ? (
        // ── My Characters — every character on the viewer's account, main
        // AND alt. Deliberately ignores the Mains/All scope toggle above:
        // PoP flagging isn't a mains-only activity, so tracking your own
        // roster means tracking every toon you own (the guild lead, 2026-08-26).
        <section className="bg-panel border border-border rounded-lg p-4 space-y-4">
          <div>
            <h3 className="text-base text-orange mb-1">🧍 My Characters</h3>
            <p className="text-xs text-dim">
              Every character linked to your account — alts included. Zone columns mirror the
              Matrix view. A cell is yours to tick: tap a — to say you hold that gate (Mimic hasn&apos;t seen
              it; hover for what&apos;s missing), tap a ☑ to take it back. Gates Mimic, /who or loot proved
              can&apos;t be unticked. Every other flag is on your <Link href="/pop/guide" className="underline">checklist</Link>.
            </p>
          </div>

          {myChars.length === 0 && myUnknown.length === 0 ? (
            <div className="bg-bg border border-orange/40 rounded p-4 text-sm">
              <div className="text-orange mb-1">
                {myCharsAll.length > 0
                  ? `Every character on your account is a trader, hidden by you or under level ${LIST_MIN_LEVEL}.`
                  : 'No characters linked to your account yet.'}
              </div>
              <div className="text-dim text-xs">
                {myCharsAll.length > 0 ? (
                  <><Link href={hrefFor({ all: '1' })} className="underline">Show all</Link> to list them anyway.</>
                ) : (
                  <>Characters show up here once Mimic sees them in your EQ logs, or once an officer
                  links them on <Link href="/admin/links" className="underline">/admin/links</Link>.</>
                )}
              </div>
            </div>
          ) : (
            <>
              {myChars.length > 0
                ? <MineTable rows={myCharsSorted} />
                : <p className="text-sm text-dim">None of your characters has a known level of {LIST_MIN_LEVEL} or more yet.</p>}
              {myUnknown.length > 0 && noLevelFold(myUnknown.length, <MineTable rows={myUnknownSorted} />)}
              {gateLegend}
            </>
          )}

          {myChars.length > 0 && (
            <div>
              <h4 className="text-sm text-gold mb-1">📜 Your PoP spells still needed</h4>
              {myNeeds.length === 0 ? (
                <p className="text-sm text-dim">
                  {myChars.every(c => mySpellbookNames.has(c.name.toLowerCase()))
                    ? 'Every character with a submitted spellbook is caught up. 🐺'
                    : 'Submit a spellbook below to see what any of your characters still need.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-dim text-xs text-left">
                        <th className="py-1 pr-3">Character</th>
                        <th className="py-1 pr-3">Class</th>
                        {POP_TURN_IN_ORDER.map(k => (
                          <th key={k} className="py-1 pr-3 text-right" title={POP_TURN_INS[k].blurb}>
                            {POP_TURN_INS[k].item.replace(' Parchment', '').replace('Glyphed Rune Word', 'Rune Word')}
                          </th>
                        ))}
                        <th className="py-1 pr-3 text-right">Other</th>
                        <th className="py-1 pr-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {myNeeds.map(n => (
                        <tr key={n.name} className="align-top">
                          <td className="py-1.5 pr-3">
                            <Link href={`/character/${encodeURIComponent(n.name)}/spells`} className="text-blue hover:underline">{n.name}</Link>
                            {!n.isMain && <span className="ml-1 text-[10px] text-dim">alt</span>}
                          </td>
                          <td className="py-1.5 pr-3 text-dim">{n.cls ?? '—'}</td>
                          {POP_TURN_IN_ORDER.map(k => {
                            const list = n.tiers[k];
                            return (
                              <td key={k} className="py-1.5 pr-3 text-right"
                                  title={list.length ? list.map(x => x.spell_name).join(', ') : 'nothing needed at this tier'}>
                                <span className={list.length ? 'text-orange' : 'text-dim/50'}>{list.length || '—'}</span>
                              </td>
                            );
                          })}
                          <td className="py-1.5 pr-3 text-right"
                              title={n.other.length ? n.other.map(x => x.spell_name).join(', ') : 'nothing outside the turn-in lists'}>
                            <span className={n.other.length ? 'text-purple' : 'text-dim/50'}>{n.other.length || '—'}</span>
                          </td>
                          <td className="py-1.5 pr-3 text-right text-text">{n.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {myChars.some(c => !mySpellbookNames.has(c.name.toLowerCase())) && (
                <p className="text-[11px] text-dim mt-2">
                  No spellbook on file yet for:{' '}
                  <b className="text-text">
                    {myChars.filter(c => !mySpellbookNames.has(c.name.toLowerCase())).map(c => c.name).join(', ')}
                  </b>. Use the submit button below.
                </p>
              )}
            </div>
          )}
        </section>
      ) : (
        <>
          {/* ── The chart — tier bands, Samanna-style ── */}
          <section className="max-w-5xl mx-auto space-y-3">
            {[1, 2, 3, 4, 5].map(tier => {
              const zones = topLevel.filter(z => z.tier === tier).sort((a, b) => a.col - b.col);
              if (zones.length === 0) return null;
              const t = TIER_LABELS[tier];
              return (
                <div key={tier} className="relative rounded-lg border border-border/60 p-3 pt-2"
                     style={{ background: 'rgba(110,118,129,0.05)' }}>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-xs font-bold tracking-wide" style={{ color: TIER_COLORS[tier] }}>{t.name}</span>
                    <span className="text-[10px] text-dim">{t.sub}</span>
                  </div>
                  <div className={`grid gap-3 ${tier === 5 ? 'sm:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
                    {tier === 5 && <div className="hidden sm:block" />}
                    {zones.map(z => <ZoneCard key={z.key} z={z} />)}
                  </div>
                  {tier < 5 && (
                    <div className="text-center text-dim text-xs leading-none mt-2 select-none">▼</div>
                  )}
                </div>
              );
            })}
            <p className="text-[10px] text-dim text-center">
              Chart topology after Samanna&apos;s classic planar progression chart · ⤓ gate flag with holder count ·
              👤 characters holding the flag · &quot;N in&quot; = can enter today · counts include characters /who
              showed, or loot placed, inside a gated plane · <span className="text-gold">☑ N</span> of the holders are an owner&apos;s
              own tick on the site
            </p>
          </section>

          {/* ── Raid-night planner ── */}
          <section className="bg-panel border border-border rounded-lg p-4">
            <h3 className="text-base text-orange mb-1">⚔ Raid-night planner</h3>
            <p className="text-xs text-dim mb-3">
              What to run to move the most raiders forward. <b className="text-text">Attend</b> = can enter the zone
              today · <b className="text-text">gain</b> = attendees still missing the flag · <b className="text-text">unlocks</b> =
              people this kill pushes through a later gate (they have every OTHER flag for it). Every number is
              <b className="text-text"> mains</b>, with <b className="text-text">alts</b> in parentheses; ranked by mains.
              Flags an owner ticked on the site (<span className="text-gold">☑</span>) count here like any other.
            </p>
            {chars.length === 0 ? (
              <p className="text-sm text-dim">
                No flags recorded yet. As members raid the planes with Mimic running, grants land here
                automatically and this table ranks itself.
              </p>
            ) : planTop.length === 0 ? (
              <p className="text-sm text-dim">Everyone with recorded flags is caught up — nothing to chase. 🐺</p>
            ) : (
              <table className="text-sm w-full">
                <thead>
                  <tr className="text-dim text-xs text-left">
                    <th className="py-1 pr-3">Target</th>
                    <th className="py-1 px-2">Zone</th>
                    <th className="py-1 px-2 text-right">Attend</th>
                    <th className="py-1 px-2 text-right">Gain flag</th>
                    <th className="py-1 pl-2">Unlocks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {planTop.map(p => (
                    <tr key={p.flag}>
                      <td className="py-1.5 pr-3 text-text">{KIND_ICONS[POP_FLAGS[p.flag]?.kind ?? 'kill']} {POP_FLAGS[p.flag]?.label ?? p.flag}</td>
                      <td className="py-1.5 px-2 text-dim text-xs">
                        <Link href={`/pop?zone=${p.zone.key}`} className="hover:underline">{p.zone.short}</Link>
                      </td>
                      <td className="py-1.5 px-2 text-right text-dim"><MainsAlts s={p.attend} /></td>
                      <td className="py-1.5 px-2 text-right text-text"><MainsAlts s={p.gains} /></td>
                      <td className="py-1.5 pl-2 text-xs">
                        {p.unlocks.length === 0 ? <span className="text-dim">—</span> : p.unlocks.map(u => (
                          <details key={u.zone.key} className="inline-block mr-3 align-top">
                            <summary className="cursor-pointer text-green">+{u.count.mains}<span className="text-dim"> ({u.count.alts})</span> → {u.zone.short}</summary>
                            <span className="text-dim">{u.mains.join(', ')}{u.alts.length > 0 && ` (alts: ${u.alts.join(', ')})`}</span>
                          </details>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      {/* ── PoP spells [scope] still need ─────────────────────────────────── */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg text-gold mb-1">
              📜 PoP spells {scope === 'mains' ? 'mains' : 'characters'} still need
            </h2>
            <p className="text-sm text-dim leading-6 max-w-3xl">
              PoP spells come from turning a parchment in to your class&apos;s spell NPC, and each turn-in
              gives a <b className="text-text">random</b> spell from that trainer&apos;s hand-picked list for that
              parchment (read from the actual quest scripts — not guessed from spell levels) — so what matters is
              how many a person still needs from each list. Highest level first: whoever reaches the level first gets first dibs.
              Only {scope === 'mains' ? 'mains' : 'characters'} who have{' '}
              <b className="text-text">submitted a spellbook</b> appear — without one we
              can&apos;t tell &ldquo;doesn&apos;t have it&rdquo; from &ldquo;we don&apos;t know&rdquo;.{' '}
              {scope === 'mains' && (
                <>Alts need PoP spells too — see <Link href={hrefFor({ scope: 'all' })} className="underline">all characters</Link>{' '}
                or your own full roster under <Link href={hrefFor({ view: 'mine', zone: null })} className="underline">My Characters</Link>.</>
              )}
            </p>
          </div>
          {/* min-w-0, not shrink-0: a no-shrink box sized itself to the whole picker row and ran off a phone
              screen, so the page scrolled sideways (the guild lead, 2026-10-03). Now the row wraps. */}
          <div className="min-w-0 max-w-full">
            <SpellbookSubmit
              listed={minePart.listed.map(c => c.name)}
              unknown={minePart.unknown.map(c => c.name)}
              hidden={minePart.hidden.map(c => c.name)}
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          {POP_TURN_IN_ORDER.map(k => (
            <span key={k} className="px-2 py-0.5 rounded border border-border text-dim" title={POP_TURN_INS[k].blurb}>
              <b className="text-text">{POP_TURN_INS[k].item}</b> → random from your class trainer&apos;s list
            </span>
          ))}
        </div>

        {scopedSpellNeeds.length === 0 ? (
          <p className="text-sm text-dim mt-3">
            Nobody with a submitted spellbook is missing a PoP spell yet — or no spellbooks have been submitted.
          </p>
        ) : (
          <div className="mt-3">
            <NeedsTable rows={scopedSpellNeeds} />
            <p className="text-[11px] text-dim mt-2">
              Hover a count to see the exact spells. <b>Other</b> = needed but not in this class&apos;s turn-in
              lists (research, or another class&apos;s tradeable scroll). Click a name for their full missing-spell list.
            </p>
          </div>
        )}
        {scopedUnknownNeeds.length > 0 && (
          <div className="mt-3">{noLevelFold(scopedUnknownNeeds.length, <NeedsTable rows={scopedUnknownNeeds} />)}</div>
        )}
      </section>

      <section className="bg-panel border border-border rounded-lg p-4 text-xs text-dim leading-5">
        <b className="text-text">How this fills in:</b> agents detect the universal grant line and the bot attributes
        it from the zone + the boss just killed; unattributable grants stay visible as <i>unmapped</i> until the
        catalog names them. At launch: verify every * gate against Quarm&apos;s documented QoL changes (data-only
        edits), wire Seer Mal Nae recital parsing for authoritative backfill, and split multi-step gates (earth
        rings, Time phases) if Quarm keeps them. Sources: TAKP progression wiki · EQProgression planar guide ·
        Samanna chart v3.0.
      </section>
    </div>
  );
}
