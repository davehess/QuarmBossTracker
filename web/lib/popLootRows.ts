// Reads pop_loot_sightings (supabase/migrations/20261003190000) for the PoP pages, a page of rows at a time.
// One row is a (character, plane) pair, and the API returns at most 1,000 rows a request whatever the
// function returns, so a guild that has raided every plane would otherwise lose its tail silently — the
// same trap pop_flags hit on 2026-09-29. The function orders its rows (character, plane: its group key),
// so the pages never overlap. The walk is selectAll's, so a page that fails throws instead of ending the
// read with the rows so far (this used to ignore the error and hand back a short list).
// Server-only: the RPC is service-role.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LootSighting } from './popWho';
import { selectAll } from './selectAll';

export type LootRow = LootSighting & { character_key: string };

export async function loadLootSightings(sb: SupabaseClient, guildId = 'wolfpack'): Promise<LootRow[]> {
  return selectAll<LootRow>((from, to) => sb.rpc('pop_loot_sightings', { p_guild_id: guildId }).range(from, to));
}
