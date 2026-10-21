// The raid timeline's one read: the curated bosses that died between two instants, for web/components/RaidTimeline.tsx.
// Shared by the members-only /api/spectator/timeline and the public /api/share/raid/<token>/timeline; each route does
// its own gate BEFORE calling this, and this file only reads.
//
// A boss is a bosses_local row with auto_registered = false (web/lib/bossFilter.ts), a kill is an encounter with an
// ended_at and no classification (not a wipe, a test or a PvP row). Only the columns the strip draws are selected: no
// player, no damage, no zone. Reads are bounded for the 1,000-row cap (test/db-read-discipline-web.test.js): the
// encounter read pages through selectAll on a unique order, the curated read is chunked.
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAll } from '@/lib/selectAll';
import { GUILD_TAG } from '@/lib/guild';
import { chunk, displayMobName } from '@/lib/replayBosses';

const CHUNK = 100;

type EncRaw = {
  npc_id: number; ended_at: string;
  eqemu_npc_types: { name: string | null } | { name: string | null }[] | null;
};
export type TimelineKill = { npc_id: number; name: string; at: number };

export async function loadTimelineKills(admin: SupabaseClient, sinceIso: string, untilIso: string, guild: string = GUILD_TAG): Promise<TimelineKill[]> {
  const raw = await selectAll<EncRaw>((from, to) => admin.from('encounters')
    .select('id, npc_id, ended_at, eqemu_npc_types(name)')
    .eq('guild_id', guild)
    .is('classification', null)
    .not('ended_at', 'is', null)
    .gte('ended_at', sinceIso)
    .lt('ended_at', untilIso)
    .order('id')
    .range(from, to));

  const npcIds = [...new Set(raw.map(r => r.npc_id))];
  const curated = new Set<number>();
  for (const ids of chunk(npcIds, CHUNK)) {
    const { data, error } = await admin.from('bosses_local')
      .select('npc_id')
      .eq('auto_registered', false)
      .in('npc_id', ids)
      .limit(100);   // a literal, equal to CHUNK: one row at most per id asked for
    if (error) throw error;
    for (const r of (data ?? []) as { npc_id: number }[]) curated.add(r.npc_id);
  }

  return raw.filter(r => curated.has(r.npc_id)).map(r => {
    const t = Array.isArray(r.eqemu_npc_types) ? r.eqemu_npc_types[0] : r.eqemu_npc_types;
    return { npc_id: r.npc_id, name: displayMobName(t?.name) || 'Unknown boss', at: Date.parse(r.ended_at) };
  }).filter(k => Number.isFinite(k.at)).sort((a, b) => a.at - b.at || a.npc_id - b.npc_id);
}
