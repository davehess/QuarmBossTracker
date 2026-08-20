// Curated-boss display filter (Hitya 2026-08-19: "THESE are not the right
// parses to display here for nonbosses").
//
// Since bot 3.1.52, encounter persistence self-registers ANY exactly-matched
// mob into bosses_local so a first kill can never be silently dropped —
// collection is open by design. Display is not: until then the curated
// allowlist was accidentally the page's boss filter, so kill-card surfaces
// now filter explicitly to curated rows (auto_registered = false). Everything
// else — farm trash, raid trash, uncurated nameds — stays collected and rolls
// up into per-zone lines via the parses_offcard_rollup RPC.
//
// To promote an auto-registered named to card status, flip its
// bosses_local.auto_registered to false; it keeps its whole kill history.
import type { SupabaseClient } from '@supabase/supabase-js';

export async function curatedNpcIds(sb: SupabaseClient): Promise<number[]> {
  const { data } = await sb
    .from('bosses_local')
    .select('npc_id')
    .eq('auto_registered', false)
    .not('npc_id', 'is', null);
  return ((data ?? []) as { npc_id: number }[]).map(r => r.npc_id);
}
