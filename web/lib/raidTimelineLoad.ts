// The raid timeline's one read: the curated bosses that died between two instants, for web/components/RaidTimeline.tsx.
// Shared by the members-only /api/spectator/timeline and the public /api/share/raid/<token>/timeline; each route does
// its own gate BEFORE calling this, and this file only reads.
//
// A boss is a bosses_local row with auto_registered = false (web/lib/bossFilter.ts), a kill is an encounter with an
// ended_at and no classification (not a wipe, a test or a PvP row). Only the columns the strip draws are selected: no
// player, no damage, no zone (the zone is never read, so a wrong or empty encounters.zone_short cannot drop a kill).
// Reads are bounded for the 1,000-row cap (test/db-read-discipline-web.test.js): the encounter read pages through
// selectAll on a unique order, the curated read is chunked.
//
// GUEST RAIDS (the guild lead, 2026-10-28: a shared session of another guild's raid showed "No boss has died yet";
// "these are other guild kills"). The bot stamps classification 'live' on a kill whose fighters are mostly not on our
// roster (utils/killContext.js, rule 3) and an officer stamps 'foreign'; both keep the fight out of OUR counts, which
// is why "no classification" is the default here. A SHARE is the opposite case: an officer picked the window on
// purpose, and the page is about that session, so with `guestRaids` the 'live' and 'foreign' kills are kept and
// carry `other: true` (the strip says "Another guild", as the session page does). A wipe, a PvP or a test fight is
// still never a kill.
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAll } from './selectAll';
import { GUILD_TAG } from './guild';
import { chunk, displayMobName } from './replayBosses';

const CHUNK = 100;

type EncRaw = {
  npc_id: number; ended_at: string; classification: string | null; is_wipe: boolean | null;
  eqemu_npc_types: { name: string | null } | { name: string | null }[] | null;
};
export type TimelineKill = { npc_id: number; name: string; at: number; other?: true };

/** Marks that still count as a kill in a guest raid's share: whose or where the fight was, never "did not die". */
const GUEST_MARKS = new Set(['live', 'foreign']);

export async function loadTimelineKills(
  admin: SupabaseClient, sinceIso: string, untilIso: string, guild: string = GUILD_TAG, opts: { guestRaids?: boolean } = {},
): Promise<TimelineKill[]> {
  const keep = (r: EncRaw) => r.classification == null || (!!opts.guestRaids && GUEST_MARKS.has(r.classification) && !r.is_wipe);
  // The marks are judged here, not in the query: one read for both callers, and a window holds a few dozen fights.
  const all = await selectAll<EncRaw>((from, to) => admin.from('encounters')
    .select('id, npc_id, ended_at, classification, is_wipe, eqemu_npc_types(name)')
    .eq('guild_id', guild)
    .not('ended_at', 'is', null)
    .gte('ended_at', sinceIso)
    .lt('ended_at', untilIso)
    .order('id')
    .range(from, to));
  const raw = all.filter(keep);

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
    const kill: TimelineKill = { npc_id: r.npc_id, name: displayMobName(t?.name) || 'Unknown boss', at: Date.parse(r.ended_at) };
    if (r.classification != null) kill.other = true;
    return kill;
  }).filter(k => Number.isFinite(k.at)).sort((a, b) => a.at - b.at || a.npc_id - b.npc_id);
}
