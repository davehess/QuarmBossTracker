// web/lib/gearSetsLoad.ts — the reads behind the gear page's "Sets from what you own" and try-on (server only).
//
// Privacy: the CALLER has proven the viewer OWNS this character and has already run isOptedOut; the bank and the bags
// are the owner's alone (the inventory page gates them on owner / officer / show_inventory_publicly, and this
// goes further: owner only). Nothing here widens that. Reads: the character's inventory rows (slot label, item id,
// quantity), the catalog rows of the ids involved, the lore marker of those ids, and the owner's AA ranks for the caps.
// The maths is web/lib/gearSets.ts.

import type { SupabaseClient } from '@supabase/supabase-js';
import { GUILD_TAG } from './guild';
import { selectAll } from './selectAll';
import { chunk } from './selectInChunks';
import { isLoreItem } from './itemDecode';
import { levelCap, scoredClass, UPGRADE_SLOTS, type Equipped } from './gearUpgrades';
import { loadAaCapMods, loadItems } from './gearUpgradesLoad';
import { capsFor, type CapContext } from './gearCaps';
import type { AttrEnd } from './gearWeights';
import { buildSets, ownedFromRows, type OwnedItem, type SetsResult } from './gearSets';

type GearRow = { loc: string; slot: string; item_id: number; count?: number | null };

export async function loadGearSets(
  sb: SupabaseClient,
  input: { name: string; className: string | null; race: string | null; gear: GearRow[]; attrEnd: AttrEnd },
): Promise<SetsResult | null> {
  const base = scoredClass(input.className);
  if (!base) return null;
  const wornRows = input.gear.filter(g => g.loc === 'equipped' && UPGRADE_SLOTS.some(s => s.name === g.slot));
  if (wornRows.length === 0) return null;

  // A bank can run past the gateway's 1,000-row cap, so the read is paged.
  const invData = await selectAll<{ slot_label: string; item_id: number | null; quantity: number | null }>(
    (from, to) => sb.from('character_inventory')
      .select('slot_label, item_id, quantity')
      .eq('guild_id', GUILD_TAG)
      .ilike('character_name', input.name)
      .order('character_name').order('slot_label')     // unique together
      .range(from, to) as any);
  const stacks = ownedFromRows(
    input.gear.filter(g => g.loc === 'bag').map(g => ({ item_id: g.item_id, count: g.count ?? 1 })),
    invData,
  );

  const ids = [...new Set([...wornRows.map(g => g.item_id), ...stacks.map(s => s.id)])];
  const level = levelCap();
  const ctxBase = { level, base, attrEnd: input.attrEnd };
  const [items, loreIds, aa] = await Promise.all([
    loadItems(sb, ids),
    loadLoreIds(sb, ids),
    loadAaCapMods(sb, input.name, base),
  ]);

  const equipped: Equipped[] = [];
  for (const g of wornRows) {
    const it = items.get(g.item_id);
    if (it) equipped.push({ slot: g.slot, item: it });
  }
  const owned: OwnedItem[] = [];
  for (const s of stacks) {
    const it = items.get(s.id);
    if (it) owned.push({ item: it, where: s.where, count: s.count });
  }
  const ctx: CapContext = { ...ctxBase, aa };
  return buildSets({
    className: input.className, race: input.race, equipped, owned, loreIds, levelCap: level, caps: capsFor(ctx),
  });
}

/** Which of these ids are lore items (the leading asterisk on the lore string; `lore_flag` is false everywhere). */
async function loadLoreIds(sb: SupabaseClient, ids: number[]): Promise<Set<number>> {
  const out = new Set<number>();
  const parts = await Promise.all(chunk(ids, 100).map(part => sb.from('eqemu_items').select('id, lore').in('id', part).limit(100)));
  for (const p of parts) {
    if (p.error) throw new Error(`lore read failed: ${p.error.message}`);
    for (const r of (p.data ?? []) as { id: number; lore: string | null }[]) if (isLoreItem(r.lore)) out.add(r.id);
  }
  return out;
}
