// Which of a member's characters earn a place in a list (the guild lead, 2026-10-03: "low level
// characters do not need to show up on the pop flag page. all of my traders and mule characters
// destroy my views anywhere we display all of our logs").
//
// A character is NOT listed when it is a Trader (the rank the guild already uses to mark them), or when
// its level is KNOWN and under LIST_MIN_LEVEL. A non-trader whose level nobody has seen stays listed:
// no /who and no scribed spell is not proof of a low level, and hiding a raider because nobody has
// /who'd them would be the worse mistake. 46 is the lowest zone-in gate in Planes of Power
// (apps/mimic/pop-raids.js: "Access levels differ by source (46 / 55 / 60 / 62 per-zone")): a character
// under it can't be flagging anything.
//
// This is a DISPLAY rule for lists of characters, never a data rule. Do not use it on mule inventory
// (/me/inventory, /quartermaster, the mule upload): a bank mule's inventory is the point there. It is
// also not exclude_from_stats / exclude_inventory, which stop data being collected.

import type { SupabaseClient } from '@supabase/supabase-js';

export const LIST_MIN_LEVEL = 46;

export type ListFacts = { rank?: string | null; level?: number | null };

// A level of 0 or less is "unknown", the way me_levels and the agent report it, not "level zero".
export function isListable({ rank, level }: ListFacts): boolean {
  if (String(rank ?? '').trim().toLowerCase() === 'trader') return false;
  if (level != null && level > 0 && level < LIST_MIN_LEVEL) return false;
  return true;
}

// Split a list into the rows that are listed and the rows that are tucked away, order kept, so a page
// can show "N hidden" and a "show all" link from the same pass.
export function partitionListable<T>(items: T[], factsOf: (item: T) => ListFacts): { listed: T[]; hidden: T[] } {
  const listed: T[] = [];
  const hidden: T[] = [];
  for (const item of items) (isListable(factsOf(item)) ? listed : hidden).push(item);
  return { listed, hidden };
}

// Best-known level per name: the higher of /who history and the highest scribed spell, which is what
// /me already shows (me_levels, service role). Keys are lowercase; a name nobody has a level for is
// simply absent, so `.get()` is undefined = unknown. The admin client is passed in so this file stays
// importable by a plain test.
export async function loadLevels(admin: SupabaseClient, names: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const wanted = [...new Set(names.filter(Boolean))];
  if (wanted.length === 0) return out;
  const { data } = await admin.rpc('me_levels', { p_names: wanted });
  for (const r of (data ?? []) as { name: string; level: number }[]) {
    const lvl = Number(r.level) || 0;
    if (lvl > 0) out.set(String(r.name).toLowerCase(), lvl);
  }
  return out;
}

// Lowercase names of every guild Trader, for a caller that holds only a name (the /pop spell-needs rows
// carry a name and a level but no rank). ~36 rows, so one read is cheaper than looking names up.
export async function loadTraderNames(admin: SupabaseClient): Promise<Set<string>> {
  const { data } = await admin.from('characters').select('name')
    .eq('guild_id', 'wolfpack').ilike('rank', 'trader').limit(1000);
  return new Set(((data ?? []) as { name: string }[]).map(r => r.name.toLowerCase()));
}
