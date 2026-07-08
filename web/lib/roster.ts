// Shared roster name resolution — fold alts into their main, and tell whether
// a name is even a known character. Used by /fun cards (dirge, Lord of Ire)
// and anywhere else that aggregates by character but should display by main.
//
// The classic trap this closes: parse-derived names can include stray-log
// ghosts (an old/foreign eqlog_<Name> file a member's agent tailed — e.g.
// "Ashaiya" from Chadivarius's machine), which are NOT roster characters and
// should not appear as raiders. isKnown() drops them; mainOf() folds real
// alts (Chadivarius → Moash) so cards match their detail pages.

import type { SupabaseClient } from '@supabase/supabase-js';

export type NameMap = {
  /** Canonical MAIN display name for any character (falls back to input). */
  mainOf: (name: string) => string;
  /** True only for names present in the characters table. */
  isKnown: (name: string) => boolean;
};

export async function loadNameMap(sb: SupabaseClient): Promise<NameMap> {
  const { data } = await sb.from('characters').select('name, main_name');
  const mainByLower = new Map<string, string>();
  const known = new Set<string>();
  for (const c of (data ?? []) as { name: string; main_name: string | null }[]) {
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
