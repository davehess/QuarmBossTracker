// Reads pop_loot_sightings (supabase/migrations/20261003190000) for the PoP pages, a page of rows at a time.
// One row is a (character, plane) pair, and the API returns at most 1,000 rows a request whatever the
// function returns, so a guild that has raided every plane would otherwise lose its tail silently — the
// same trap pop_flags hit on 2026-09-29. The function orders its rows, so the pages never overlap.
// Server-only: the RPC is service-role.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LootSighting } from './popWho';

export type LootRow = LootSighting & { character_key: string };

export async function loadLootSightings(sb: SupabaseClient, guildId = 'wolfpack'): Promise<LootRow[]> {
  const out: LootRow[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data } = await sb.rpc('pop_loot_sightings', { p_guild_id: guildId }).range(from, from + 999);
    const rows = (data ?? []) as LootRow[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
