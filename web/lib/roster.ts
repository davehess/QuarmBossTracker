// The guild roster, read ONCE per request, plus the name resolution built on it.
//
// loadRoster() is the one reader of the `characters` table for pages that want
// "the whole roster": paged through selectAll (the API caps a plain select at
// 1,000 rows, silently) and wrapped in React's cache() so every caller in one
// render shares a single read. Before this, 20-odd pages each ran their own
// `.from('characters').select(...)`; the table is 556 rows today, so none was
// over the cap yet, but each would have lost its tail with no error the day it
// grew past 1,000 (the guild lead, 2026-10-04: "review all of the other tables
// for silent … caps"). New whole-roster reads go through here, not a fresh select.
//
// Columns are the union of what those pages asked for, so a page takes the
// fields it needs and the request still pays for one read. discord_id is for
// server-side joins only: do not pass a RosterChar row to a client component.
//
// loadNameMap folds alts into their main and tells whether a name is even a known
// character. Used by /fun cards (dirge, Lord of Ire) and anywhere else that
// aggregates by character but should display by main. The classic trap this
// closes: parse-derived names can include stray-log ghosts (an old/foreign
// eqlog_<Name> file a member's agent tailed), which are NOT roster characters and
// should not appear as raiders. isKnown() drops them; mainOf() folds real alts
// into their main so cards match their detail pages.

import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase';
import { selectAll } from './selectAll';

export type RosterChar = {
  name: string;
  class: string | null;
  rank: string | null;
  main_name: string | null;
  main_name_override: string | null;
  active: boolean | null;
  discord_id: string | null;
  opendkp_id: number | null;
  exclude_from_stats: boolean | null;
  exclude_inventory: boolean | null;
  hidden_from_lists: boolean | null;
};

/** Every character of the guild, name order. `characters` is keyed (guild_id, name),
 *  so with the guild fixed `name` is a unique page key. Throws if a page fails. */
export async function fetchRoster(sb: SupabaseClient, guildId = 'wolfpack'): Promise<RosterChar[]> {
  return selectAll<RosterChar>((from, to) => sb
    .from('characters')
    .select('name, class, rank, main_name, main_name_override, active, discord_id, opendkp_id, exclude_from_stats, exclude_inventory, hidden_from_lists')
    .eq('guild_id', guildId)
    .order('name')
    .range(from, to));
}

/** The roster, read once per request (React cache); callers must treat it as read-only. */
export const loadRoster = cache(() => fetchRoster(supabaseAdmin()));

export type NameMap = {
  /** Canonical MAIN display name for any character (falls back to input). */
  mainOf: (name: string) => string;
  /** True only for names present in the characters table. */
  isKnown: (name: string) => boolean;
};

export async function loadNameMap(): Promise<NameMap> {
  const roster = await loadRoster();
  const mainByLower = new Map<string, string>();
  const known = new Set<string>();
  for (const c of roster) {
    if (!c.name) continue;
    const lower = c.name.toLowerCase();
    known.add(lower);
    mainByLower.set(lower, c.main_name || c.name);
  }
  return {
    mainOf:  (n) => mainByLower.get(String(n ?? '').toLowerCase()) ?? n,
    isKnown: (n) => known.has(String(n ?? '').toLowerCase()),
  };
}
