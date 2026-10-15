// The reads behind GET /api/spectator/replay/bosses, lifted out so the members' route and the public share
// route (/api/share/raid/[token]/bosses) run the SAME code: the killed curated bosses whose fight overlaps
// [fromIso, toIso], with their spawn points. What counts as a boss and a kill, and what the points mean, is in
// lib/replayBosses.ts and the route header.
//
// Every read is bounded for the 1,000-row cap (test/db-read-discipline-web.test.js): the encounter and spawn
// reads page through selectAll on a unique order, the `in (...)` lists are chunked so the URL stays short, and
// the curated-boss read asks for at most one chunk's worth of rows.
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAll } from './selectAll';
import { GUILD_TAG } from './guild';
import {
  buildSpawnBosses, chunk, type EncounterRow, type Spawn2Row, type SpawnBoss, type SpawnEntryRow,
} from './replayBosses';

const CHUNK = 100;

type EncRaw = {
  npc_id: number; started_at: string; ended_at: string | null; zone_short: string | null;
  eqemu_npc_types: { name: string | null } | { name: string | null }[] | null;
};

/** Throws on a failed read; the caller turns that into its own error response. */
export async function loadSpawnBosses(admin: SupabaseClient, fromIso: string, toIso: string): Promise<SpawnBoss[]> {
  const raw = await selectAll<EncRaw>((from, to) => admin.from('encounters')
    .select('id, npc_id, started_at, ended_at, zone_short, eqemu_npc_types(name)')
    .eq('guild_id', GUILD_TAG)
    .is('classification', null)
    .not('ended_at', 'is', null)
    .gte('ended_at', fromIso)
    .lte('started_at', toIso)
    .order('id')
    .range(from, to));
  const npcIds = [...new Set(raw.map(r => r.npc_id))];

  // Curated bosses only: the rest of the night's encounters are trash.
  const curated = new Set<number>();
  for (const ids of chunk(npcIds, CHUNK)) {
    const { data, error } = await admin.from('bosses_local')
      .select('npc_id')
      .eq('auto_registered', false)
      .in('npc_id', ids)
      .limit(100);   // a literal, equal to CHUNK: one row at most per id asked for, and the guard reads numbers
    if (error) throw error;
    for (const r of (data ?? []) as { npc_id: number }[]) curated.add(r.npc_id);
  }
  const encounters: EncounterRow[] = raw.filter(r => curated.has(r.npc_id)).map(r => {
    const t = Array.isArray(r.eqemu_npc_types) ? r.eqemu_npc_types[0] : r.eqemu_npc_types;
    return { npc_id: r.npc_id, name: t?.name ?? null, zone_short: r.zone_short, started_at: r.started_at, ended_at: r.ended_at };
  });
  if (!encounters.length) return [];

  const bossIds = [...new Set(encounters.map(e => e.npc_id))];
  const entries: SpawnEntryRow[] = [];
  for (const ids of chunk(bossIds, 50)) {
    entries.push(...await selectAll<SpawnEntryRow>((from, to) => admin.from('eqemu_spawnentry')
      .select('spawngroup_id, npc_id')
      .in('npc_id', ids)
      .order('spawngroup_id').order('npc_id')
      .range(from, to)));
  }
  const groupIds = [...new Set(entries.map(e => e.spawngroup_id))];
  const spawns: Spawn2Row[] = [];
  for (const ids of chunk(groupIds, CHUNK)) {
    spawns.push(...await selectAll<Spawn2Row>((from, to) => admin.from('eqemu_spawn2')
      .select('id, spawngroup_id, zone_short, x, y, z')
      .in('spawngroup_id', ids)
      .order('id')
      .range(from, to)));
  }
  return buildSpawnBosses(encounters, entries, spawns);
}
