// The database reads behind /pop/events (server only). The event list is committed (web/lib/popEvents.ts); this reads
// what the server's tables know about it: the drops (eqemu_npc_drops), the item stats (eqemu_items, the finder's own
// columns) and what the guild paid (opendkp_loot). Kept six hours: the tables move with the weekly mirror sync, and a
// page that scores ~870 items should not do it per request. Members only: the page checks the session before calling.
//
// The read is the /pop/raid pattern (service client, paged, narrow columns). Reads cost egress, not quota, so the
// columns are the fewest the scorer needs; the DKP read selects two columns of the guild's own awards.

import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { selectInChunks } from '@/lib/selectInChunks';
import { loadItems } from '@/lib/gearUpgradesLoad';
import type { ItemStats } from '@/lib/gearUpgrades';
import { eventNpcIds, eventRewardIds } from '@/lib/popEvents';
import { dkpByName, isWearable, type DropRow } from '@/lib/popEventsScore';

export const EVENTS_REVALIDATE_S = 6 * 60 * 60;

export type EventsData = {
  drops: DropRow[];
  items: ItemStats[];
  /** [lower-cased item name, average DKP paid, awards]. Empty when that read failed (`dkpOk` false). */
  dkp: [string, number, number][];
  dkpOk: boolean;
  fetchedAt: string;
};

async function read(): Promise<EventsData> {
  const sb = supabaseAdmin();
  // A mob can have 60 or more rows, so a few mobs per request, each drained across pages. eqemu_npc_drops is a view with no
  // unique key (an NPC can reach one item through two loot drops): ordering on the whole key tuple, as the gear finder and
  // the soft-reserve read do, makes rows that tie identical, so a page boundary cannot lose one.
  const drops = await selectInChunks<number, DropRow>(eventNpcIds(), (npcs, from, to) => sb
    .from('eqemu_npc_drops')
    .select('npc_id, item_id, item_name, effective_chance, multiplier')
    .in('npc_id', npcs)
    .order('effective_chance', { ascending: true }).order('npc_id', { ascending: true }).order('item_id', { ascending: true })
    .range(from, to), { size: 10 });

  const ids = [...new Set([...drops.map(d => d.item_id), ...eventRewardIds()])];
  const items = [...(await loadItems(sb, ids)).values()];

  let dkp: EventsData['dkp'] = [];
  let dkpOk = true;
  try {
    const names = items.filter(isWearable).map(i => i.name).filter((n): n is string => !!n);
    const rows = await selectInChunks<string, { item_name: string | null; dkp: number | null }>(names, (part, from, to) => sb
      .from('opendkp_loot').select('item_name, dkp').in('item_name', part).order('id').range(from, to), { size: 40 });
    dkp = [...dkpByName(rows)].map(([k, v]) => [k, v.avg, v.n]);
  } catch {
    dkp = [];
    dkpOk = false;   // the page says so; scores and drops do not depend on it
  }
  return { drops, items, dkp, dkpOk, fetchedAt: new Date().toISOString() };
}

/** Drops, items and DKP, served from the data cache for six hours. */
export const loadEventsData = unstable_cache(read, ['pop-events-data-v1'], { revalidate: EVENTS_REVALIDATE_S });
