// web/lib/gearUpgradesLoad.ts — the database reads behind /me/upgrades (server only).
//
// Everything is read from tables that already exist; the finder adds no migration. The expensive part is the
// candidate pool (every wearable item with a stat, ~14k rows): it is read once per server process and kept for
// POOL_TTL_MS, because the catalog only changes with the weekly sync-quarm run. Later this is the one read to
// replace with a set-returning SQL function (the pool filtered to the class and the slot in the database).
//
// Sources follow docs/eqemu-catalog-cheatsheet.md: an NPC's zone is floor(npc_id / 1000), a merchant's zone is
// floor(merchantid / 1000), and `eqemu_zone.expansion` says whether it is current-era content (0..4 once PoP is
// live; -1 and 99 are special zones: GM, test, system). The denormalized eqemu_npc_types.zone_short is NULL
// everywhere, so it is never read.
//
// Privacy: nothing here is keyed by a member. The wishlist read selects item_id and priority for ONE character
// the page has already proven the viewer owns, and never the bid columns.

import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAll } from './selectAll';
import { chunk } from './selectInChunks';
import { isEraExpansion, type ItemStats, type Source } from './gearUpgrades';

export const ITEM_COLS =
  'id, name, slots, classes, races, required_level, itemtype, ac, hp, mana, damage, delay, str, sta, agi, dex, wis, intel, cha, '
  + 'mr, cr, dr, fr, pr, attack, haste, regen, manaregen, damageshield, focus_effect, worneffect, proc_effect, clickeffect';
// The pool leaves the name out (14k names would double its size); finalists' names are read afterwards.
const POOL_COLS = ITEM_COLS.replace('id, name, ', 'id, ');

// An item with none of these > 0 can never score, so it is not in the pool. (`norent` is stored inverted in the
// mirror: true is a normal item, false is a temporary one that vanishes on camp.)
const STAT_GATE = [
  'ac', 'hp', 'mana', 'damage', 'str', 'sta', 'agi', 'dex', 'wis', 'intel', 'cha',
  'mr', 'cr', 'dr', 'fr', 'pr', 'attack', 'haste', 'regen', 'manaregen', 'damageshield',
].map(c => `${c}.gt.0`).join(',');

const POOL_TTL_MS = 6 * 60 * 60 * 1000;
let poolCache: { at: number; cap: number; rows: ItemStats[] } | null = null;
let poolInflight: Promise<ItemStats[]> | null = null;

/** Every wearable, stat-bearing, non-temporary item up to the level cap. Kept in memory for six hours. */
export async function loadItemPool(sb: SupabaseClient, maxLevel: number): Promise<ItemStats[]> {
  if (poolCache && poolCache.cap === maxLevel && Date.now() - poolCache.at < POOL_TTL_MS) return poolCache.rows;
  if (poolInflight) return poolInflight;
  poolInflight = (async () => {
    // The same four filters on the count and on every page; the pages go out in parallel (selectAll walks them
    // one at a time, ~15 round trips), each ordered on the primary key so the pages tile exactly.
    const head = await sb.from('eqemu_items').select('id', { count: 'exact', head: true })
      .eq('norent', true).gt('slots', 0).lte('required_level', maxLevel).or(STAT_GATE);
    if (head.error || head.count == null) throw new Error(`item pool count failed: ${head.error?.message ?? 'no count'}`);
    const pages = Math.ceil(head.count / 1000);
    const parts = await Promise.all(Array.from({ length: pages }, (_, i) => sb.from('eqemu_items').select(POOL_COLS)
      .eq('norent', true).gt('slots', 0).lte('required_level', maxLevel).or(STAT_GATE)
      .order('id').range(i * 1000, i * 1000 + 999)));
    const rows: ItemStats[] = [];
    for (const p of parts) {
      if (p.error || !p.data) throw new Error(`item pool page failed: ${p.error?.message ?? 'no data'}`);
      rows.push(...(p.data as unknown as ItemStats[]));
    }
    poolCache = { at: Date.now(), cap: maxLevel, rows };
    return rows;
  })();
  try { return await poolInflight; } finally { poolInflight = null; }
}

/** Full rows (with names) for specific ids: the worn items, the bag items, the finalists. */
export async function loadItems(sb: SupabaseClient, ids: number[]): Promise<Map<number, ItemStats>> {
  const out = new Map<number, ItemStats>();
  const uniq = [...new Set(ids.filter(i => Number.isInteger(i) && i > 0))];
  const parts = await Promise.all(chunk(uniq, 100).map(part => sb.from('eqemu_items').select(ITEM_COLS).in('id', part).limit(100)));
  for (const p of parts) {
    if (p.error) throw new Error(`items read failed: ${p.error.message}`);
    for (const r of (p.data ?? []) as unknown as ItemStats[]) out.set(r.id, r);
  }
  return out;
}

export type ZoneInfo = { long_name: string | null; short_name: string; expansion: number | null };
let zoneCache: { at: number; rows: Map<number, ZoneInfo> } | null = null;

/** eqemu_zone by numeric zone id (192 rows; kept for six hours). */
export async function loadZones(sb: SupabaseClient): Promise<Map<number, ZoneInfo>> {
  if (zoneCache && Date.now() - zoneCache.at < POOL_TTL_MS) return zoneCache.rows;
  const { data, error } = await sb.from('eqemu_zone').select('zone_id, short_name, long_name, expansion');
  if (error || !data) throw new Error(`zones read failed: ${error?.message ?? 'no data'}`);
  const rows = new Map<number, ZoneInfo>();
  for (const z of data as { zone_id: number; short_name: string; long_name: string | null; expansion: number | null }[]) {
    rows.set(z.zone_id, { long_name: z.long_name, short_name: z.short_name, expansion: z.expansion });
  }
  zoneCache = { at: Date.now(), rows };
  return rows;
}

const zoneOf = (entityId: number) => Math.floor(entityId / 1000);
const npcLabel = (name: string | null) => (name ? name.replace(/_/g, ' ').replace(/^#/, '').trim() : null);

/**
 * Where each item can be had in the current era: drops (zone + NPC + chance) and vendors (zone + merchant).
 * An item with no current-era source is absent from the map. `zones` comes from loadZones.
 */
export async function loadSources(
  sb: SupabaseClient, itemIds: number[], zones: Map<number, ZoneInfo>, expCap: number,
): Promise<Map<number, Source[]>> {
  const out = new Map<number, Source[]>();
  const add = (itemId: number, s: Source) => {
    const list = out.get(itemId) ?? [];
    list.push(s);
    out.set(itemId, list);
  };
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) return out;

  const [dropParts, vendParts] = await Promise.all([
    Promise.all(chunk(ids, 25).map(part => selectAll<{ item_id: number; npc_id: number; npc_name: string | null; effective_chance: number | null }>(
      (from, to) => sb.from('eqemu_npc_drops')
        .select('item_id, npc_id, npc_name, effective_chance')
        .in('item_id', part)
        // every selected column is in the order, so rows that tie are identical rows (see selectAll's header)
        .order('effective_chance', { ascending: false, nullsFirst: false }).order('npc_id').order('item_id')
        .range(from, to) as any))),
    Promise.all(chunk(ids, 60).map(part => selectAll<{ item: number; merchantid: number; slot: number }>(
      (from, to) => sb.from('eqemu_merchantlist')
        .select('item, merchantid, slot')
        .in('item', part)
        .order('merchantid').order('slot')
        .range(from, to) as any))),
  ]);

  // Best three era drops per item (the page shows the best and counts the rest).
  const seenDrop = new Set<string>();
  for (const rows of dropParts) {
    for (const d of rows) {
      const z = zones.get(zoneOf(d.npc_id));
      if (!z || !isEraExpansion(z.expansion, expCap)) continue;
      const key = `${d.item_id}:${d.npc_id}`;
      if (seenDrop.has(key)) continue;
      seenDrop.add(key);
      add(d.item_id, {
        kind: 'drop', zone: z.long_name ?? z.short_name, expansion: z.expansion, npc: npcLabel(d.npc_name),
        chance: d.effective_chance == null ? null : Math.round(Number(d.effective_chance) * 10) / 10,
      });
    }
  }

  // Vendors: one entry per (item, zone); the merchant name is resolved for the ones kept.
  const vend: { item: number; merchantid: number; zone: ZoneInfo }[] = [];
  const seenVend = new Set<string>();
  for (const rows of vendParts) {
    for (const m of rows) {
      const z = zones.get(zoneOf(m.merchantid));
      if (!z || !isEraExpansion(z.expansion, expCap)) continue;
      const key = `${m.item}:${zoneOf(m.merchantid)}`;
      if (seenVend.has(key)) continue;
      seenVend.add(key);
      vend.push({ item: m.item, merchantid: m.merchantid, zone: z });
    }
  }
  const merchantNames = new Map<number, string>();
  const mids = [...new Set(vend.map(v => v.merchantid))];
  const nameParts = await Promise.all(chunk(mids, 100).map(part => sb.from('eqemu_npc_types').select('id, name').in('id', part).limit(100)));
  for (const p of nameParts) for (const r of (p.data ?? []) as { id: number; name: string }[]) merchantNames.set(r.id, r.name);
  for (const v of vend) {
    add(v.item, {
      kind: 'vendor', zone: v.zone.long_name ?? v.zone.short_name, expansion: v.zone.expansion,
      npc: npcLabel(merchantNames.get(v.merchantid) ?? null), chance: null,
    });
  }
  return out;
}

/** Spell names for the focus / worn / proc / click effect ids of the finalists, for the "Focus: …" line. */
export async function loadSpellNames(sb: SupabaseClient, ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const uniq = [...new Set(ids.filter(i => Number.isInteger(i) && i > 0))];
  const parts = await Promise.all(chunk(uniq, 100).map(part => sb.from('eqemu_spells').select('id, name').in('id', part).limit(100)));
  for (const p of parts) for (const r of (p.data ?? []) as { id: number; name: string }[]) out.set(r.id, r.name);
  return out;
}

/** The character's wishlist as item id → priority. The caller has proven the viewer owns `character`. Never reads a bid. */
export async function loadWishlist(sb: SupabaseClient, character: string): Promise<Map<number, number | null>> {
  const { data } = await sb.from('wishlists').select('item_id, priority').eq('character_name', character).limit(1000);
  const out = new Map<number, number | null>();
  for (const r of (data ?? []) as { item_id: number; priority: number | null }[]) out.set(r.item_id, r.priority);
  return out;
}
