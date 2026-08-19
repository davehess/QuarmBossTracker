// web/lib/spellSources.ts — grouping behind the spellbook "where from"
// dropdowns and the zone-by-zone shopping list (Hitya 2026-08-18: "say where
// it's from in a dropdown … then a shopping list mode where you can go zone
// by zone for ones that are only in a certain place").
//
// Input is spell_scroll_sources(int[]) rows — every vendor and dropper for a
// set of scroll item ids, zones resolved through the spawn tables. Pure; the
// root vitest suite real-imports it.

export type SourceRow = {
  item_id: number;
  kind: 'merchant' | 'drop';
  npc_id: number | null;
  npc_name: string | null;
  zone_short: string | null;
  zone_long: string | null;
};

export type NpcSource = { npcId: number | null; name: string; zones: { short: string | null; long: string | null }[] };
export type ItemSources = { merchants: NpcSource[]; drops: NpcSource[] };

const clean = (s: string) => s.replace(/^#/, '').replace(/_/g, ' ').trim();

// One entry per NPC with its zone list (an NPC that spawns in several zones —
// rare but real — keeps them all). Merchants and drops kept separate.
export function groupSources(rows: SourceRow[]): Map<number, ItemSources> {
  const byItem = new Map<number, ItemSources>();
  const npcBuckets = new Map<string, NpcSource>();
  for (const r of rows) {
    let e = byItem.get(r.item_id);
    if (!e) { e = { merchants: [], drops: [] }; byItem.set(r.item_id, e); }
    const name = clean(String(r.npc_name || '(unknown)'));
    const key = `${r.item_id}|${r.kind}|${r.npc_id ?? name}`;
    let npc = npcBuckets.get(key);
    if (!npc) {
      npc = { npcId: r.npc_id, name, zones: [] };
      npcBuckets.set(key, npc);
      (r.kind === 'merchant' ? e.merchants : e.drops).push(npc);
    }
    if (r.zone_short && !npc.zones.some(z => z.short === r.zone_short)) {
      npc.zones.push({ short: r.zone_short, long: r.zone_long });
    }
  }
  for (const e of byItem.values()) {
    e.merchants.sort((a, b) => a.name.localeCompare(b.name));
    e.drops.sort((a, b) => a.name.localeCompare(b.name));
  }
  return byItem;
}

export type ShoppingSpell = {
  spellName: string;
  level: number | null;
  pop: boolean;
  vendors: string[];        // vendor names IN THIS ZONE
  onlyHere: boolean;        // this zone is the spell's only vendor zone
  heldBy: string[];
};

export type ShoppingZone = {
  zoneShort: string;
  zoneLong: string;
  spells: ShoppingSpell[];
  exclusives: number;       // how many of them are only-here
};

export type MissingForShopping = {
  spell_name: string;
  scroll_item_id: number | null;
  scribe_level: number | null;
  pop: boolean;
  held_by: string[];
};

// Zone-by-zone shopping list over MERCHANT sources only (that is what
// shopping means). Zones sort by exclusives first, then spell count — the
// zones you MUST visit float to the top, which is the "only in a certain
// place" ask. Spells with no known vendor return separately.
export function shoppingList(missing: MissingForShopping[], sources: Map<number, ItemSources>) {
  const zones = new Map<string, ShoppingZone>();
  const noVendor: MissingForShopping[] = [];
  for (const m of missing) {
    const src = m.scroll_item_id ? sources.get(m.scroll_item_id) : undefined;
    const merchants = src?.merchants ?? [];
    if (!merchants.length) { noVendor.push(m); continue; }
    // All vendor zones for this spell → onlyHere when there is exactly one.
    const zonePairs = new Map<string, string>();
    for (const v of merchants) for (const z of v.zones) if (z.short) zonePairs.set(z.short, z.long || z.short);
    const onlyHere = zonePairs.size === 1;
    for (const [short, long] of zonePairs) {
      let zone = zones.get(short);
      if (!zone) { zone = { zoneShort: short, zoneLong: long, spells: [], exclusives: 0 }; zones.set(short, zone); }
      zone.spells.push({
        spellName: m.spell_name,
        level: m.scribe_level,
        pop: m.pop,
        vendors: merchants.filter(v => v.zones.some(z => z.short === short)).map(v => v.name),
        onlyHere,
        heldBy: m.held_by,
      });
      if (onlyHere) zone.exclusives++;
    }
    // A vendored spell whose vendors all lack spawn data still needs a home.
    if (zonePairs.size === 0) noVendor.push(m);
  }
  const list = [...zones.values()];
  for (const z of list) z.spells.sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || a.spellName.localeCompare(b.spellName));
  list.sort((a, b) => b.exclusives - a.exclusives || b.spells.length - a.spells.length || a.zoneLong.localeCompare(b.zoneLong));
  return { zones: list, noVendor };
}
