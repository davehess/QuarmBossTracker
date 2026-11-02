// The database reads behind /pop/flag-events (server only, service role). Two halves:
//
//   1. The characters and what each one holds, guild-wide. Heavy (the roster, a level lookup, every PoP flag of ~hundreds
//      of characters, the hand ticks, and a full-read check per name), identical for every viewer and not personal, so it is
//      kept five minutes in the data cache. The page checks the session before calling.
//   2. The events themselves, their Raid-Helper links and sign-ups, read fresh each request so a post shows at once.
//
// Which characters: the /pop/guide rule (web/lib/listableChars.ts): a known level of 46 or more, not a Trader, not hidden
// by its owner. Also not exclude_from_stats (that owner opted out of being counted in guild lists). A character with no
// known level is left out: it is not proof of a low level, but a board of who "needs" a raid should not name someone who
// may be a bank mule.
//
// Flags: pop_flags through the pop_flags_distinct RPC (one row per character and flag, however many times it was read) plus
// the owner's hand ticks (pop_guide_ticks via flagForTickKey). NOT read here: /who sightings and loot (loadRoute proves
// extra gates from them). They are per-character heavy and only ever turn a "not recorded" into "done", so leaving them
// out can make the list longer, never wrongly short.
//
// "Full read" (a Seer recital or #popflags read lists everything the character holds, so an absent flag is a real no) is
// gateData.ts loadFullReads, asked only for the names that could still turn out to need something.

import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { selectAll } from '@/lib/selectAll';
import { fetchRoster } from '@/lib/roster';
import { loadLevels, tierOf } from '@/lib/listableChars';
import { SELF_TICK_KEYS, selfFlagsFromTicks } from '@/lib/popSelfFlags';
import { FLAG_TARGETS } from '@/lib/flagTargets';
import { needsFullReadCheck } from '@/lib/flagEventNeeds';
import { eventReadWindow, UPCOMING_DAYS } from '@/lib/flagEvents';
import type { SignupLite } from '@/lib/flagEventSigned';
import { GUILD_TAG } from '@/lib/guild';
import { loadFullReads } from '@/app/pop/guide/gateData';

export const CHARS_REVALIDATE_S = 5 * 60;

export type BoardChar = {
  name: string;
  class: string | null;
  main_name: string | null;
  active: boolean | null;
  rank: string | null;
  /** Server side only: used to match Raid-Helper sign-ups, never drawn. */
  discordId: string | null;
  flags: string[];
  fullRead: boolean;
};

export type CharsData = { chars: BoardChar[]; fetchedAt: string };

const chunks = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

async function readChars(): Promise<CharsData> {
  const sb = supabaseAdmin();
  const roster = await fetchRoster(sb);
  const levels = await loadLevels(sb, roster.map(r => r.name));
  const listed = roster.filter(r => r.exclude_from_stats !== true
    && tierOf({ rank: r.rank, level: levels.get(r.name.toLowerCase()), hidden: r.hidden_from_lists }) === 'listed');
  const names = listed.map(r => r.name);

  const [flagRows, tickRows] = await Promise.all([
    // One row per (character, flag); the RPC orders on a unique key, so the pages neither skip nor repeat.
    selectAll<{ character: string; flag_key: string }>((from, to) =>
      sb.rpc('pop_flags_distinct', { p_guild_id: GUILD_TAG, p_names: names }).range(from, to)),
    // (character_name, item_key) is the rest of the primary key once the guild is fixed.
    selectAll<{ character_name: string; item_key: string }>((from, to) => sb.from('pop_guide_ticks')
      .select('character_name, item_key')
      .eq('guild_id', GUILD_TAG).in('item_key', SELF_TICK_KEYS)
      .order('character_name', { ascending: true }).order('item_key', { ascending: true })
      .range(from, to)),
  ]);

  const held = new Map<string, Set<string>>();
  for (const r of flagRows) {
    const k = r.character.toLowerCase();
    if (!held.has(k)) held.set(k, new Set());
    held.get(k)!.add(r.flag_key);
  }
  for (const [k, flags] of selfFlagsFromTicks(tickRows)) {
    if (!held.has(k)) held.set(k, new Set());
    for (const f of flags) held.get(k)!.add(f);
  }
  const flagsOf = (name: string): string[] => [...(held.get(name.toLowerCase()) ?? [])];

  // Ask about full reads only for the names that could still need something; a chunk at a time, not hundreds at once.
  const check = needsFullReadCheck(FLAG_TARGETS, listed, r => ({ flags: flagsOf(r.name) }));
  const full = new Set<string>();
  for (const part of chunks([...check].map(r => r.name), 40)) {
    for (const n of await loadFullReads(part)) full.add(n);
  }

  return {
    chars: listed.map(r => ({
      name: r.name, class: r.class, main_name: r.main_name, active: r.active, rank: r.rank, discordId: r.discord_id,
      flags: flagsOf(r.name), fullRead: full.has(r.name.toLowerCase()),
    })),
    fetchedAt: new Date().toISOString(),
  };
}

/** The guild's listable characters and what each holds, served from the data cache for five minutes. */
export const loadCharsData = unstable_cache(readChars, ['flag-events-chars-v1'], { revalidate: CHARS_REVALIDATE_S });

// ── The events ───────────────────────────────────────────────────────────────────────────────────

export type FlagEventRow = {
  id: number; target_key: string; starts_at: string; note: string | null; rh_event_id: string | null; posted_by_discord_id: string;
};
export type RhOption = { id: string; title: string | null; start_time: string | null };

export type BoardData = {
  events: FlagEventRow[];
  /** Linked Raid-Helper events by id. */
  rhById: Record<string, RhOption>;
  /** Sign-ups by Raid-Helper event id. */
  signups: Record<string, SignupLite[]>;
  /** Display names of the people who posted, by Discord id. */
  posters: Record<string, string>;
  /** Upcoming Raid-Helper events an officer can link (empty for everyone else). */
  options: RhOption[];
};

export async function loadBoard(now: Date, withOptions: boolean): Promise<BoardData> {
  const sb = supabaseAdmin();
  const { from, to } = eventReadWindow(now);

  // At most a window of events a guild posts by hand; 200 is far over it.
  const { data: evRows, error: evErr } = await sb.from('flag_events')
    .select('id, target_key, starts_at, note, rh_event_id, posted_by_discord_id')
    .eq('guild_id', GUILD_TAG).gte('starts_at', from).lte('starts_at', to)
    .order('starts_at', { ascending: true }).order('id', { ascending: true }).limit(200);
  if (evErr) throw new Error(`flag_events: ${evErr.message}`);
  const events = (evRows ?? []) as FlagEventRow[];

  const linked = [...new Set(events.map(e => e.rh_event_id).filter((x): x is string => !!x))];
  const posterIds = [...new Set(events.map(e => e.posted_by_discord_id))];

  const [rhRes, signupRows, memRes, optRes] = await Promise.all([
    linked.length
      ? sb.from('rh_events').select('id, title, start_time').eq('guild_id', GUILD_TAG).in('id', linked).limit(200)
      : Promise.resolve({ data: [] as RhOption[], error: null }),
    linked.length
      ? selectAll<SignupLite & { event_id: string }>((f, t) => sb.from('rh_signups')
        .select('event_id, discord_id, user_name, status, class_name')
        .eq('guild_id', GUILD_TAG).in('event_id', linked)
        .order('event_id', { ascending: true }).order('signup_id', { ascending: true })
        .range(f, t))
      : Promise.resolve([] as (SignupLite & { event_id: string })[]),
    posterIds.length
      ? sb.from('wolfpack_members').select('discord_id, nickname, global_name').in('discord_id', posterIds).limit(200)
      : Promise.resolve({ data: [] as { discord_id: string; nickname: string | null; global_name: string | null }[], error: null }),
    withOptions
      ? sb.from('rh_events').select('id, title, start_time').eq('guild_id', GUILD_TAG)
        .gte('start_time', now.toISOString())
        .lte('start_time', new Date(now.getTime() + UPCOMING_DAYS * 24 * 3600_000).toISOString())
        .order('start_time', { ascending: true }).order('id', { ascending: true }).limit(100)
      : Promise.resolve({ data: [] as RhOption[], error: null }),
  ]);

  const rhById: Record<string, RhOption> = {};
  for (const r of (rhRes.data ?? []) as RhOption[]) rhById[r.id] = r;
  const signups: Record<string, SignupLite[]> = {};
  for (const s of signupRows) (signups[s.event_id] ??= []).push(s);
  const posters: Record<string, string> = {};
  for (const m of (memRes.data ?? []) as { discord_id: string; nickname: string | null; global_name: string | null }[]) {
    const name = m.nickname || m.global_name;
    if (name) posters[m.discord_id] = name;
  }
  return { events, rhById, signups, posters, options: (optRes.data ?? []) as RhOption[] };
}
