// web/lib/gearUpgradesRun.ts — the gear upgrade evaluation both pages run (server only).
//
// /me/upgrades shows it in full; /character/<name>/gear shows the best swap per slot and the cap headroom. One
// function so the two cannot drift: it reads the catalog and the character's AAs, ranks every slot with the
// character's OWN cap table (web/lib/gearCaps.ts), looks the finalists' sources up (drops and vendors first, then
// quest rewards and tradeskill recipes for what has neither), and returns what a page renders.
//
// Privacy: the CALLER hands in the gear rows and has already proven the viewer may see this character, and has
// already run isOptedOut. Nothing here reads `characters` or `character_gear`. The one character-keyed read is the
// owner's AA ranks (loadAaCapMods).

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  candidateIds, capStatus, expansionCap, levelCap, rankUpgrades, scoredClass, selectTop, UPGRADE_SLOTS,
  type CapStatus, type Equipped, type ItemStats, type SlotResult, type Source, type Upgrade,
} from './gearUpgrades';
import {
  loadAaCapMods, loadAltSources, loadItemPool, loadItems, loadSources, loadZones,
} from './gearUpgradesLoad';
import { capsFor, type CapContext } from './gearCaps';
import { DEFAULT_ATTR_END, type AttrEnd, type CapTable } from './gearWeights';

export type WornGearRow = { loc: string; slot: string; item_id: number };

export type UpgradeEval = {
  base: string;
  level: number;
  ctx: CapContext;
  caps: CapTable;
  equipped: Equipped[];
  results: SlotResult[];
  perSlot: { r: SlotResult; top: Upgrade[] }[];
  finalistItems: Map<number, ItemStats>;   // every candidate (with name and icon), for display
  wornItems: Map<number, ItemStats>;       // the worn and bagged items
  bagIds: Set<number>;
  capNow: CapStatus[];                     // the worn set against every cap
  altOk: boolean;                          // false: quest / tradeskill sources could not be read (migration not applied)
};

/** `?ends=` → High end / Low end, High by default. */
export const parseAttrEnd = (v: string | null | undefined): AttrEnd => (v === 'low' ? 'low' : DEFAULT_ATTR_END);

export async function runUpgradeEval(
  sb: SupabaseClient,
  input: { name: string; className: string | null; race: string | null; gear: WornGearRow[]; attrEnd: AttrEnd },
): Promise<UpgradeEval | null> {
  const base = scoredClass(input.className);
  if (!base) return null;
  const wornRows = input.gear.filter(g => g.loc === 'equipped');
  if (wornRows.length === 0) return null;

  const now = new Date();
  const level = levelCap(now);
  const expCap = expansionCap(now);
  const bagIds = new Set(input.gear.filter(g => g.loc === 'bag').map(g => g.item_id));

  const [pool, wornItems, zones, aa] = await Promise.all([
    loadItemPool(sb, level),
    loadItems(sb, [...wornRows.map(g => g.item_id), ...bagIds]),
    loadZones(sb),
    loadAaCapMods(sb, input.name, base),
  ]);

  const equipped: Equipped[] = [];
  for (const g of wornRows) {
    const it = wornItems.get(g.item_id);
    if (it && UPGRADE_SLOTS.some(s => s.name === g.slot)) equipped.push({ slot: g.slot, item: it });
  }
  // Items in the bags are candidates even when they are not in the pool (their stats were read above).
  const poolIds = new Set(pool.map(p => p.id));
  const bagExtras = [...bagIds].map(id => wornItems.get(id)).filter((x): x is ItemStats => !!x && !poolIds.has(x.id));

  const ctx: CapContext = { level, base, attrEnd: input.attrEnd, aa };
  const caps = capsFor(ctx);
  const results = rankUpgrades({
    className: input.className, race: input.race, equipped, pool: [...pool, ...bagExtras], levelCap: level, caps,
  });
  if (!results) return null;

  const ids = candidateIds(results);
  const [sources, finalistItems] = await Promise.all([
    loadSources(sb, ids, zones, expCap),
    loadItems(sb, ids),
  ]);
  // Anything already carried needs no source.
  for (const id of ids) {
    if (bagIds.has(id)) sources.set(id, [{ kind: 'bag', zone: null, expansion: null, npc: null, chance: null }, ...(sources.get(id) ?? [])]);
  }
  // Quest rewards and tradeskill recipes, only for what has no drop, vendor or bag: an item you can already shop for
  // or pull does not need a second line, and the lookup is a regex over the quest scripts per id.
  const bare = ids.filter(id => !(sources.get(id)?.length));
  const alt = await loadAltSources(sb, bare, finalistItems, expCap, level);
  for (const [id, list] of alt.sources) sources.set(id, [...(sources.get(id) ?? []), ...list]);

  const perSlot = results.map(r => ({ r, top: selectTop(r.candidates, sources as Map<number, Source[]>) }));
  return {
    base, level, ctx, caps, equipped, results, perSlot, finalistItems, wornItems, bagIds,
    capNow: capStatus(equipped.map(e => e.item), caps, ctx), altOk: alt.ok,
  };
}
