// Rows for the Essences of Power queue (web/lib/essencesQueue.ts has the rules). Guild-wide, members-only
// like the rest of /pop: the guild lead, 2026-09-29, wants everyone to "see who has which pieces".

import { supabaseAdmin } from '@/lib/supabase';
import { ESSENCES, BID_ITEM_NAMES, buildEssenceQueue, type Award, type Looted } from '@/lib/essencesQueue';
import { GUILD_TAG } from '@/lib/guild';

// The live raid: a roster row captured in the last 15 minutes (the /raid page's window).
const ROSTER_FRESH_MS = 15 * 60 * 1000;

export async function loadEssenceQueue() {
  const admin = supabaseAdmin();
  const itemNames = [...ESSENCES.map(e => e.name), ...BID_ITEM_NAMES];
  const since = new Date(Date.now() - ROSTER_FRESH_MS).toISOString();
  const [{ data: loot }, { data: looted }, { data: roster }] = await Promise.all([
    admin.from('opendkp_loot').select('id, raid_id, character_name, item_name, dkp').in('item_name', itemNames).limit(1000),
    admin.from('looted_items').select('looter_character, item_name, looted_at').eq('guild_id', GUILD_TAG)
      .in('item_name', ESSENCES.map(e => e.name)).limit(1000),
    admin.from('raid_roster').select('name').eq('guild_id', GUILD_TAG).gte('captured_at', since).limit(200),
  ]);
  const lootRows = (loot ?? []) as { id: number; raid_id: number; character_name: string; item_name: string; dkp: number | null }[];
  const raidIds = [...new Set(lootRows.map(r => r.raid_id))];
  const { data: raids } = raidIds.length
    ? await admin.from('opendkp_raids').select('raid_id, ts').in('raid_id', raidIds)
    : { data: [] as { raid_id: number; ts: string }[] };
  const raidTs = new Map(((raids ?? []) as { raid_id: number; ts: string }[]).map(r => [r.raid_id, r.ts]));
  // Oldest raid first, and within one raid the order OpenDKP recorded them.
  const awards: Award[] = lootRows
    .map(r => ({ r, ts: raidTs.get(r.raid_id) ?? null }))
    .sort((a, b) => String(a.ts ?? '9999').localeCompare(String(b.ts ?? '9999')) || a.r.id - b.r.id)
    .map(({ r, ts }) => ({ character: r.character_name, item: r.item_name, dkp: Number(r.dkp) || 0, at: ts }));
  const lootedRows: Looted[] = ((looted ?? []) as { looter_character: string; item_name: string; looted_at: string }[])
    .map(r => ({ character: r.looter_character, item: r.item_name, at: r.looted_at }));
  const rosterNames = ((roster ?? []) as { name: string }[]).map(r => r.name.toLowerCase());
  const present = rosterNames.length ? new Set(rosterNames) : null;
  const result = buildEssenceQueue(awards, lootedRows, present);

  const names = [...result.queue, ...result.done].map(e => e.name);
  const { data: chars } = names.length
    ? await admin.from('characters').select('name, class').in('name', names)
    : { data: [] as { name: string; class: string | null }[] };
  const classOf = Object.fromEntries(((chars ?? []) as { name: string; class: string | null }[]).map(c => [c.name.toLowerCase(), c.class]));
  return { ...result, classOf, raidLive: !!present };
}
