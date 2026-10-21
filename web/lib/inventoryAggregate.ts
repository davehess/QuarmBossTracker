// The account-inventory aggregation, pure (no database, no session), so the hosted page
// (/me/inventory) and the local page that ships inside Mimic (web/local, "On this PC") run the SAME
// code over rows from different places. Moved out of app/me/inventory/page.tsx unchanged in behaviour:
// location grouping, category tags, the shared bank counted once per game account, and the per-item
// holdings the explorer renders. Tested by test/inventory-aggregate.test.js.
//
// Location comes from the slot_label (EQ /outputfile inventory path, which keeps Bank + SharedBank).
// Tags come from item meta (damage / ac / nodrop / itemtype / slots); with NO meta (the local page has
// no item catalog that carries those fields yet) only the name-based `spell` tag survives.

import type { InvItem, LocGroup } from '@/app/me/inventory/InventoryExplorer';
import { planSharedBanks, pickSharedRows, type AccountPlacement } from './sharedBank';

export type InvRow = {
  character_name: string;
  slot_label: string;
  item_id: number | null;
  item_name: string;
  quantity: number | null;
  observed_at: string | null;
};
export type ItemMeta = {
  id: number;
  damage: number | null;
  ac: number | null;
  nodrop: boolean | null;
  itemtype: number | null;
  slots: number | null;
};

export function locGroup(slot: string): LocGroup {
  const s = slot || '';
  if (/^SharedBank/i.test(s)) return 'shared';
  if (/^Bank/i.test(s)) return 'bank';
  if (/^(General|Cursor)/i.test(s) || /-Slot/i.test(s)) return 'bags';
  return 'equipped';
}

const CONSUMABLE_TYPES = new Set([14, 15, 20, 21, 38]); // food/drink/scroll/potion/alcohol

export function tagsFor(m: ItemMeta | undefined, name: string): string[] {
  const t: string[] = [];
  const isSpell = /^(Spell|Song|Tome|Ancient):\s/i.test(name) || m?.itemtype === 20;
  if (isSpell) t.push('spell');
  if (m) {
    if ((m.damage ?? 0) > 0) t.push('weapon');
    if ((m.ac ?? 0) > 0 && (m.damage ?? 0) === 0) t.push('armor');
    if (m.nodrop === false) t.push('nodrop');           // mirror stores NODROP as false
    // Tradeskill/components: best-effort — not equippable, not a weapon/armor,
    // not a spell, not a consumable. Catches ore/gems/pages/parts.
    if (!isSpell && (m.damage ?? 0) === 0 && (m.ac ?? 0) === 0 && (m.slots ?? 0) === 0
        && !CONSUMABLE_TYPES.has(m.itemtype ?? -1)) t.push('tradeskill');
  }
  return t;
}

const itemKeyOf = (r: InvRow) => (r.item_id ? `id:${r.item_id}` : `nm:${r.item_name.toLowerCase()}`);

export type InventoryAggregate = {
  items: InvItem[];
  /** Accounts counted for the header stat (shared banks seen). */
  sharedAccountCount: number;
  /** Clusters too large to be one account; left un-deduped, the caller logs them. */
  oversized: string[][];
};

/**
 * Aggregate every row of one person's characters into one list: the total of each item and exactly who
 * holds it. `placements` are the owner-set game accounts (empty = infer accounts from the shared banks);
 * `metaById` is the item catalog slice for the tags (empty = tags degrade to the name-based `spell`).
 */
export function aggregateInventory(
  rows: InvRow[],
  placements: AccountPlacement[] = [],
  metaById: ReadonlyMap<number, ItemMeta> = new Map(),
): InventoryAggregate {
  // Shared-bank dedup (the guild lead, 2026-08-20). The shared bank is ACCOUNT-level:
  // every character on a game account reads the SAME physical bank, so
  // summing their rows counted one stack once per character (ten characters
  // each reporting SharedBank6-Slot9 = Words of the Spectre x3).
  //
  // Grouping is by SLOT AGREEMENT, not by hashing the whole bank. The first
  // cut hashed every SharedBank row and grouped exact matches — useless in
  // practice, because each character's inventory file is written whenever
  // THAT character last ran /outputfile inventory. Snapshots sit minutes or
  // hours apart, stacks move, row counts drift (107 / 104 / 108 on one real
  // account), and one differing row broke the whole hash. Slot addresses are
  // account-scoped and stable, so a 4-rows-stale snapshot still agrees on
  // the other 100. See web/lib/sharedBank.ts.
  //
  // Game accounts (the guild lead, 2026-10-13): a character with an OPEN
  // `character_accounts` row is on that account — authoritative. Only the
  // characters without one are inferred from their banks (planSharedBanks).
  // Each account's shared bank then counts once, from its FRESHEST snapshot (pickSharedRows).
  const sharedRows = rows
    .filter(r => locGroup(r.slot_label) === 'shared')
    .map(r => ({
      character: r.character_name,
      slot:      r.slot_label,
      itemKey:   itemKeyOf(r) + '|' + String(r.quantity ?? 1),
      observedAt: r.observed_at,
      inv: r,
    }));
  const plan = planSharedBanks(sharedRows, placements);
  const countedShared = new Set<InvRow>(pickSharedRows(sharedRows, plan.accountOf).map(s => s.inv));
  const accountById = new Map(plan.accounts.map(a => [a.id, a]));

  // Aggregate by item (by id when present, else by name).
  const byKey = new Map<string, InvItem>();
  for (const r of rows) {
    // Shared-bank rows count once per ACCOUNT — skip every copy except the
    // account's freshest snapshot (see the dedup block above).
    const grp = locGroup(r.slot_label);
    if (grp === 'shared' && !countedShared.has(r)) continue;
    const key = itemKeyOf(r);
    let it = byKey.get(key);
    if (!it) {
      it = {
        key, item_id: r.item_id ?? null, name: r.item_name,
        total: 0, tags: tagsFor(r.item_id ? metaById.get(r.item_id) : undefined, r.item_name),
        holdings: [],
      };
      byKey.set(key, it);
    }
    const qty = Math.max(1, r.quantity ?? 1);
    it.total += qty;
    // A shared holding belongs to the ACCOUNT when it has more than one
    // character; a lone character's bank stays a plain character holding.
    const acct = grp === 'shared' ? accountById.get(plan.accountOf.get(r.character_name.toLowerCase()) ?? '') : undefined;
    const h = acct
      ? it.holdings.find(x => x.account?.id === acct.id)
      : it.holdings.find(x => !x.account && x.character === r.character_name && x.location === grp);
    if (h) h.qty += qty;
    else it.holdings.push(acct
      ? { character: acct.label, location: grp, qty, account: { id: acct.id, label: acct.label, members: acct.members, placed: acct.placed } }
      : { character: r.character_name, location: grp, qty });
  }
  const items = [...byKey.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return { items, sharedAccountCount: plan.accountCount, oversized: plan.oversized };
}
