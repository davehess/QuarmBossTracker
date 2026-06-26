// /character/[name]/quests — per-character quest tracker.
//
// Visibility:
//   • Always visible to the character's owner (characters.discord_id ==
//     viewer's wolfpack_members.discord_id).
//   • Always visible to officers.
//   • Visible to other signed-in members only if the character has set
//     characters.show_inventory_publicly = true.
//
// Data:
//   • quest_catalog + quest_required_item — the curated list of trackable
//     quests (managed by officers via /admin/quests).
//   • character_inventory — populated by the future agent file-watcher on
//     <character>-Inventory.txt. Until that lands, the page renders red-X
//     for every item, which is honest — we haven't observed the inventory.
//   • Family-aware: cross-character hint shows when ANOTHER character in
//     the same main_name family has the item (useful for MQ planning).
//
// Sections on the page (top → bottom):
//   1. Active quests — catalog quests + turn-ins the character pinned from
//      discovery (▲ to active). At the top per Uilnayar 2026-06-24.
//   2. Inferred zone access — locked zones proven by NO DROP loot held.
//   3. Inventory-driven discovery — scripted NPC turn-ins matched to held
//      items, triaged: Ready to turn in → NO DROP vs tradeable → gems folded.
//      "Item — Turn-in NPC — zone" format, PQDI links, ✓/✗ per component.
//   4. Stack turn-ins — table view for repeatable stack turn-ins.
//   5. Completed quests — held rewards + deduped turn-in rewards w/ counts.
//   6. Inventory dead-weight — items not useful to this character (placeholder).

import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';
import { QuestActionButtons, QuestUnhideButton, TurninControls } from './QuestPrefsControls';
import { EPIC_COMPONENTS, EPIC_ROOT, EPIC_CLASSES_BY_ITEM } from '@/lib/eq-epics';

export const dynamic = 'force-dynamic';

type Quest = {
  id: number;
  name: string;
  category: string | null;
  zone: string | null;
  pqdi_quest_url: string | null;
  notes: string | null;
  is_stack_turnin: boolean;
  reward_item_id: number | null;
  reward_item_name: string | null;
  display_order: number;
};
type QuestItem = {
  id: number;
  quest_id: number;
  item_id: number | null;
  item_name: string;
  quantity: number;
  optional: boolean;
  notes: string | null;
  display_order: number;
};
type InventoryRow = {
  character_name: string;
  slot_label: string;
  item_id: number | null;
  item_name: string;
  quantity: number;
};

async function load(decoded: string) {
  const sb = supabaseAdmin();
  const [
    charRes, questsRes, itemsRes, invRes, keysRes, prefsRes,
  ] = await Promise.all([
    sb.from('characters')
      .select('name, class, race, main_name, discord_id, show_inventory_publicly')
      .ilike('name', decoded)
      .limit(1),
    sb.from('quest_catalog')
      .select('id, name, category, zone, pqdi_quest_url, notes, is_stack_turnin, reward_item_id, reward_item_name, display_order')
      .eq('guild_id', 'wolfpack')
      .eq('active', true)
      .order('display_order', { ascending: true }),
    sb.from('quest_required_item')
      .select('id, quest_id, item_id, item_name, quantity, optional, notes, display_order')
      .order('display_order', { ascending: true }),
    // The character's inventory plus everyone in the same family
    // (family = same main_name) so we can hint "X has this on Y."
    sb.from('character_inventory')
      .select('character_name, slot_label, item_id, item_name, quantity')
      .eq('guild_id', 'wolfpack')
      .limit(10000),
    // Keyring (Key of Veeshan, Trakanon Idol, etc.) — quests complete when you
    // hold the reward, in inventory OR on the keyring.
    sb.from('character_keys')
      .select('item_id, key_name')
      .eq('guild_id', 'wolfpack')
      .ilike('character_name', decoded),
    sb.from('character_quest_prefs')
      .select('quest_id, display_order, hidden, dismissed')
      .eq('guild_id', 'wolfpack')
      .ilike('character_name', decoded),
  ]);

  const char = (charRes.data && charRes.data[0]) as
    | { name: string; class: string | null; race: string | null; main_name: string | null; discord_id: string | null; show_inventory_publicly: boolean }
    | undefined;
  if (!char) return null;

  // Family lookup → main_name (or own name if main).
  const main = (char.main_name && char.main_name.trim()) || char.name;
  const { data: familyRows } = await sb
    .from('characters')
    .select('name')
    .eq('guild_id', 'wolfpack')
    .or(`name.eq.${main},main_name.eq.${main}`);
  const familyNames = new Set(((familyRows ?? []) as { name: string }[]).map(r => r.name.toLowerCase()));

  const quests = (questsRes.data ?? []) as Quest[];
  const questItems = (itemsRes.data ?? []) as QuestItem[];

  // Key inference: holding a NO-DROP item exclusive to a locked zone proves
  // you had the key (Uilnayar 2026-06-24). This implies the catalog quest
  // whose reward IS that key — VP key, Trakanon Idol, VT Scepter of Shadows.
  // The Howling Stones row has no key_item_id (no single mirrored key item),
  // so its catalog implication is currently null but the evidence is still
  // reported for the diagnostic line.
  const { data: inferredRows } = await sb
    .rpc('inferred_keys_for_character', { p_guild_id: 'wolfpack', p_character: decoded });
  type InferredKey = {
    zone_short: string; zone_long: string;
    key_item_id: number | null; key_item_name: string;
    evidence_items: string[]; evidence_count: number;
    quest_catalog_id: number | null;
  };
  const inferredKeys = (inferredRows ?? []) as InferredKey[];

  // Inventory-driven quest discovery from scripted_npc_turnins (Uilnayar
  // 2026-06-24: "start populating quests based on the inventories"). For every
  // item id the character holds, surface the NPC turn-ins where that item is
  // either an input (piece-of-quest) or an output (completed turn-in). We
  // resolve the in/out item names via eqemu_items in one batched call so the
  // page can render "Captain Bvellos: Storm Giant Toes → +Kromzek faction".
  const ownInventoryIds = Array.from(new Set(
    (invRes.data ?? []).filter(r => r.character_name.toLowerCase() === decoded.toLowerCase() && r.item_id != null).map(r => r.item_id as number)
  ));
  type Money = { plat?: number; gold?: number; silver?: number; copper?: number };
  type TurninCore = {
    turnin_id: number; zone_short: string; npc_name: string; npc_id: number | null;
    inputs:  { item_id: number; qty: number }[];
    outputs: { item_id: number; kind: 'fixed' | 'random' }[];
    faction_changes: { faction_id: number; delta: number }[] | null;
    exp_award: number | null;
    cash:           Money | null;
    money_required: Money | null;
    random_outputs: boolean;
  };
  type Discovered = TurninCore & {
    evidence: 'piece' | 'completed';
    matched_item_id: number;
  };
  let discovered: Discovered[] = [];
  if (ownInventoryIds.length > 0) {
    const { data: dRows } = await sb.rpc('discover_quests_for_item', { p_item_ids: ownInventoryIds });
    discovered = (dRows ?? []) as Discovered[];
  }

  // Per-character turn-in prefs (Uilnayar 2026-06-24): 'active' = pinned into
  // the Active section, 'dismissed' = hidden from discovery. Fetch the pinned +
  // dismissed turn-ins by id so they render even if the matching inventory item
  // was since consumed.
  const { data: activeRows } = await sb
    .from('character_active_turnins')
    .select('turnin_id, status')
    .eq('guild_id', 'wolfpack')
    .ilike('character_name', decoded);
  const prefRows = ((activeRows ?? []) as { turnin_id: number; status: string }[]);
  const promotedTurninIds = prefRows.filter(r => r.status === 'active').map(r => r.turnin_id);
  const dismissedTurninIds = prefRows.filter(r => r.status === 'dismissed').map(r => r.turnin_id);
  const prefIds = [...promotedTurninIds, ...dismissedTurninIds];
  let prefTurnins: TurninCore[] = [];
  if (prefIds.length > 0) {
    const { data: pRows } = await sb.rpc('turnins_by_id', { p_ids: prefIds });
    prefTurnins = (pRows ?? []) as TurninCore[];
  }
  const promotedTurnins = prefTurnins.filter(t => promotedTurninIds.includes(t.turnin_id));
  const dismissedTurnins = prefTurnins.filter(t => dismissedTurninIds.includes(t.turnin_id));

  // Resolve input/output item names + NO-DROP flag for display in one batch.
  // (eqemu_items.nodrop is INVERTED on this mirror: false = NO DROP.)
  // Include every held item id so the bottom dead-weight / broken-item lists
  // can classify the whole inventory by class/race + NO DROP + value.
  const discoveryItemIds = Array.from(new Set([
    ...discovered.flatMap(d => [...d.inputs.map(i => i.item_id), ...d.outputs.map(o => o.item_id), d.matched_item_id]),
    ...prefTurnins.flatMap(t => [...t.inputs.map(i => i.item_id), ...t.outputs.map(o => o.item_id)]),
    ...ownInventoryIds,
  ]));
  type ItemMeta = { name: string; nodrop: boolean; classes: number | null; races: number | null; price: number | null; slots: number | null; damage: number | null; clickeffect: number | null; clicktype: number | null };
  const itemMetaById = new Map<number, ItemMeta>();
  if (discoveryItemIds.length > 0) {
    const { data: irows } = await sb.from('eqemu_items').select('id, name, nodrop, classes, races, price, slots, damage, clickeffect, clicktype').in('id', discoveryItemIds);
    for (const r of ((irows ?? []) as ({ id: number } & ItemMeta)[])) {
      itemMetaById.set(r.id, { name: r.name, nodrop: r.nodrop, classes: r.classes, races: r.races, price: r.price, slots: r.slots, damage: r.damage, clickeffect: r.clickeffect, clicktype: r.clicktype });
    }
  }

  // Authoritative per-item display data (canonical name, lore, drop zone) for
  // every required + reward item id. Lore is the ONLY way to tell apart items
  // that share a name (the 10 VT "A Lucid Shard" components), so we resolve it
  // from eqemu_items rather than trusting the seeded item_name.
  const itemIds = Array.from(new Set([
    ...questItems.map(q => q.item_id).filter((x): x is number => x != null),
    ...quests.map(q => q.reward_item_id).filter((x): x is number => x != null),
  ]));
  const itemInfo = new Map<number, { name: string; lore: string | null; zones: string[] }>();
  if (itemIds.length > 0) {
    const { data: info } = await sb.rpc('quest_item_info', { p_item_ids: itemIds });
    for (const r of ((info ?? []) as { item_id: number; name: string; lore: string | null; zones: string[] | null }[])) {
      itemInfo.set(r.item_id, { name: r.name, lore: r.lore, zones: r.zones ?? [] });
    }
  }

  const prefs = ((prefsRes.data ?? []) as { quest_id: number; display_order: number | null; hidden: boolean; dismissed: boolean }[]);
  const prefByQuest = new Map<number, { display_order: number | null; hidden: boolean; dismissed: boolean }>();
  for (const p of prefs) prefByQuest.set(p.quest_id, { display_order: p.display_order, hidden: p.hidden, dismissed: p.dismissed });

  return {
    char,
    quests,
    questItems,
    inventory: (invRes.data ?? []) as InventoryRow[],
    keys: (keysRes.data ?? []) as { item_id: number | null; key_name: string }[],
    familyNames,
    itemInfo,
    prefByQuest,
    inferredKeys,
    discovered,
    itemMetaById,
    promotedTurnins,
    promotedTurninIds,
    dismissedTurnins,
    dismissedTurninIds,
  };
}

export default async function CharacterQuestsPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  if (!/^[A-Za-z]{2,}$/.test(decoded)) notFound();

  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/character/${encodeURIComponent(name)}/quests`);

  const data = await load(decoded);
  if (!data) notFound();
  const { char, quests, questItems, inventory, keys, familyNames, itemInfo, prefByQuest, inferredKeys, discovered, itemMetaById, promotedTurnins, promotedTurninIds, dismissedTurnins, dismissedTurninIds } = data;

  // The viewed character's keyring — a quest completes when its reward sits
  // here (keys) OR in inventory (combine outputs / quest rewards). Components
  // are consumed on turn-in, so don't require them once the reward is held.
  const ownKeyIds = new Set<number>();
  const ownKeyNames = new Set<string>();
  for (const k of keys) {
    if (k.item_id != null) ownKeyIds.add(k.item_id);
    if (k.key_name) ownKeyNames.add(k.key_name.toLowerCase());
  }

  // Visibility gate. Officer or owner always; everyone else needs the
  // character's show_inventory_publicly flag.
  const officer = await isOfficer(user.id);
  let isOwner = false;
  if (char.discord_id) {
    const { data: me } = await supabaseAdmin()
      .from('wolfpack_members')
      .select('discord_id')
      .eq('user_id', user.id)
      .maybeSingle();
    isOwner = !!me?.discord_id && me.discord_id === char.discord_id;
  }
  if (!officer && !isOwner && !char.show_inventory_publicly) {
    return (
      <div className="space-y-4">
        <div className="text-sm"><Link href={`/character/${encodeURIComponent(decoded)}`} className="text-blue hover:underline">← back to {decoded}</Link></div>
        <section className="bg-panel border border-border rounded-lg p-6">
          <h2 className="text-xl text-gold">🔒 Private</h2>
          <p className="text-sm text-dim mt-2">
            {decoded} hasn&apos;t made their quest tracker public yet. Only the owner
            (and officers) can see this page.
          </p>
        </section>
      </div>
    );
  }

  // Index inventory by lowercase item name (we may not have item_id for
  // every row from the eventual upload). Sum quantities across slots so
  // stacks-of-10-in-different-bags count correctly.
  const ownInvByName = new Map<string, number>();
  const ownInvSlotByName = new Map<string, string[]>();
  const familyInvByName = new Map<string, Map<string, number>>();  // item -> { charName -> qty }
  // Parallel id-keyed maps. item_id is the reliable join when items share a
  // name (e.g. the 10 identical "A Lucid Shard" components) — name matching
  // would lump them together and falsely complete the quest off one shard.
  const ownInvById = new Map<number, number>();
  const familyInvById = new Map<number, Map<string, number>>();
  for (const row of inventory) {
    const isOwn = row.character_name.toLowerCase() === decoded.toLowerCase();
    const isFamily = familyNames.has(row.character_name.toLowerCase());
    if (!isOwn && !isFamily) continue;
    const itemKey = row.item_name.toLowerCase();
    if (isOwn) {
      ownInvByName.set(itemKey, (ownInvByName.get(itemKey) ?? 0) + row.quantity);
      const slots = ownInvSlotByName.get(itemKey) ?? [];
      slots.push(row.slot_label);
      ownInvSlotByName.set(itemKey, slots);
      if (row.item_id != null) ownInvById.set(row.item_id, (ownInvById.get(row.item_id) ?? 0) + row.quantity);
    } else {
      const sub = familyInvByName.get(itemKey) ?? new Map();
      sub.set(row.character_name, (sub.get(row.character_name) ?? 0) + row.quantity);
      familyInvByName.set(itemKey, sub);
      if (row.item_id != null) {
        const subId = familyInvById.get(row.item_id) ?? new Map();
        subId.set(row.character_name, (subId.get(row.character_name) ?? 0) + row.quantity);
        familyInvById.set(row.item_id, subId);
      }
    }
  }

  const itemsByQuest = new Map<number, QuestItem[]>();
  for (const it of questItems) {
    const list = itemsByQuest.get(it.quest_id) ?? [];
    list.push(it);
    itemsByQuest.set(it.quest_id, list);
  }

  // Quest completion: required items where ownInv quantity >= required.
  // "Has the reward" → completed (folded into a separate section).
  type ItemInfo = { name: string; lore: string | null; zones: string[] };
  type QuestProgress = {
    quest: Quest;
    items: { ri: QuestItem; have: number; need: number; familyHints: { name: string; qty: number }[]; info?: ItemInfo }[];
    haveCount: number;
    needCount: number;
    completed: boolean;        // owns the reward (directly or via a downstream output)
    impliedBy: string | null;  // name of the downstream quest that proves this one done
  };
  const progress: QuestProgress[] = quests.map(q => {
    const reqs = itemsByQuest.get(q.id) ?? [];
    const items = reqs.map(ri => {
      const byId = ri.item_id != null;
      const have = byId
        ? (ownInvById.get(ri.item_id!) ?? 0)
        : (ownInvByName.get(ri.item_name.toLowerCase()) ?? 0);
      const sub = byId ? familyInvById.get(ri.item_id!) : familyInvByName.get(ri.item_name.toLowerCase());
      const familyHints = sub ? [...sub.entries()].map(([name, qty]) => ({ name, qty })) : [];
      const info = ri.item_id != null ? itemInfo.get(ri.item_id) : undefined;
      return { ri, have, need: ri.quantity, familyHints, info };
    });
    const haveCount = items.filter(x => x.have >= x.need && !x.ri.optional).length;
    const needCount = items.filter(x => !x.ri.optional).length;
    const rewardKey = (q.reward_item_name || '').toLowerCase();
    // Direct: hold the reward, in inventory OR keyring (Key of Veeshan, etc.).
    const directComplete =
      (q.reward_item_id != null && ((ownInvById.get(q.reward_item_id) ?? 0) >= 1 || ownKeyIds.has(q.reward_item_id))) ||
      (!!rewardKey && ((ownInvByName.get(rewardKey) ?? 0) >= 1 || ownKeyNames.has(rewardKey)));
    return { quest: q, items, haveCount, needCount, completed: directComplete, impliedBy: null as string | null };
  });

  // Key inference: a catalog quest whose reward is a locked-zone key gets
  // marked completed when the character holds NO-DROP loot exclusive to that
  // zone — they couldn't have looted it without the key. The implication
  // message names the strongest piece of evidence so the page explains itself.
  for (const k of inferredKeys) {
    if (k.quest_catalog_id == null) continue;          // no catalog quest seeded for this zone
    const target = progress.find(p => p.quest.id === k.quest_catalog_id);
    if (!target || target.completed) continue;
    target.completed = true;
    const sample = k.evidence_items[0];
    target.impliedBy = sample
      ? `inventory loot from ${k.zone_long} (${sample})`
      : `inventory loot from ${k.zone_long}`;
  }

  // Chain-implication: if you hold a downstream output, the upstream steps that
  // feed it are provably done — their components were consumed in the combine.
  // (Uilnayar 2026-06-23: "If someone has the Vex Thal key, they definitely did
  // the first part of the quest.") Edge: quest Q's reward_item_id appears as a
  // required item of quest P ⇒ completing P implies Q. Propagate to a fixpoint
  // so a 3+-step chain fully resolves.
  const progressById = new Map(progress.map(p => [p.quest.id, p]));
  const consumersOf = new Map<number, QuestProgress[]>();   // questId → quests that consume its reward
  for (const p of progress) {
    for (const ri of (itemsByQuest.get(p.quest.id) ?? [])) {
      if (ri.item_id == null) continue;
      const upstream = progress.find(u => u.quest.reward_item_id === ri.item_id && u.quest.id !== p.quest.id);
      if (upstream) {
        const arr = consumersOf.get(upstream.quest.id) ?? [];
        arr.push(p);
        consumersOf.set(upstream.quest.id, arr);
      }
    }
  }
  // Memoized backward reachability to a directly-complete consumer.
  const resolving = new Set<number>();
  function impliedComplete(p: QuestProgress): { done: boolean; via: string | null } {
    if (p.completed) return { done: true, via: p.impliedBy };
    if (resolving.has(p.quest.id)) return { done: false, via: null };   // cycle guard
    resolving.add(p.quest.id);
    for (const consumer of (consumersOf.get(p.quest.id) ?? [])) {
      const r = consumer.completed ? { done: true, via: consumer.quest.name } : impliedComplete(consumer);
      if (r.done) { resolving.delete(p.quest.id); return { done: true, via: consumer.quest.name }; }
    }
    resolving.delete(p.quest.id);
    return { done: false, via: null };
  }
  for (const p of progress) {
    if (p.completed) continue;
    const r = impliedComplete(p);
    if (r.done) { p.completed = true; p.impliedBy = r.via; }
  }
  void progressById;

  // Apply per-character layout overrides. Custom display_order (from
  // character_quest_prefs) trumps the catalog's, falling back to it.
  function effectiveOrder(qid: number, catalogOrder: number): number {
    const o = prefByQuest.get(qid)?.display_order;
    return (o ?? null) !== null ? (o as number) : catalogOrder;
  }
  const isHidden    = (qid: number) => !!prefByQuest.get(qid)?.hidden;
  const isDismissed = (qid: number) => !!prefByQuest.get(qid)?.dismissed;

  const sortByPref = (a: QuestProgress, b: QuestProgress) =>
    effectiveOrder(a.quest.id, a.quest.display_order) - effectiveOrder(b.quest.id, b.quest.display_order)
    || a.quest.name.localeCompare(b.quest.name);

  const visibleProgress = progress.filter(p => !isHidden(p.quest.id) && !isDismissed(p.quest.id)).sort(sortByPref);
  const hiddenProgress    = progress.filter(p => isHidden(p.quest.id) && !isDismissed(p.quest.id)).sort(sortByPref);
  const dismissedProgress = progress.filter(p => isDismissed(p.quest.id)).sort(sortByPref);

  const active     = visibleProgress.filter(p => !p.completed && !p.quest.is_stack_turnin);
  const stacks     = visibleProgress.filter(p => !p.completed &&  p.quest.is_stack_turnin);
  const completed  = visibleProgress.filter(p => p.completed);

  // ---- Class Epic 1.0 components held (Uilnayar 2026-06-26: "Epics section at
  // the top that shows pieces of epic 1.0 quests that you have on your character
  // by class … e.g. dragon scales of kedge backbone"). Walk the character's
  // inventory; for every held item that appears in any class's Epic 1.0 chain,
  // surface it under each class that needs it. We group by class and skip any
  // class with no matches, so the section only renders when there's something
  // to say. Sorted within a class by chain-depth (depth 1 = final-stage piece →
  // closer to finishing), then alphabetically.
  type EpicHit = { itemId: number; name: string; depth: number; qty: number };
  const epicsByClass = new Map<string, EpicHit[]>();
  for (const [itemId, qty] of ownInvById) {
    if (qty <= 0) continue;
    const classes = EPIC_CLASSES_BY_ITEM.get(itemId);
    if (!classes) continue;
    for (const cls of classes) {
      const def = EPIC_COMPONENTS[cls]?.find(c => c.itemId === itemId);
      if (!def) continue;
      const arr = epicsByClass.get(cls) ?? [];
      arr.push({ itemId, name: def.name, depth: def.depth, qty });
      epicsByClass.set(cls, arr);
    }
  }
  const epicClassesSorted = [...epicsByClass.entries()]
    .map(([cls, hits]) => ({
      cls,
      weapon: EPIC_ROOT[cls]?.weapon ?? null,
      rewardId: EPIC_ROOT[cls]?.rewardId ?? null,
      hits: hits.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.hits.length - a.hits.length || a.cls.localeCompare(b.cls));

  // ---- Inventory-driven discovery presentation (Uilnayar 2026-06-24 rework) ----
  // One row per turn-in (deduped), classified for triage:
  //   • Ready to turn in (hold every component) → top
  //   • In progress, NO DROP component vs tradeable-only → two groups
  //   • Gem turn-ins where the only thing held is a common gem → minimized
  //   • Completed (hold an output) → deduped by item w/ held count, shown in
  //     the Completed section
  // PQDI link on every item + (when unambiguously resolvable) the NPC.
  type Turnin = {
    turnin_id: number; zone_short: string; npc_name: string; npc_id: number | null;
    inputs: { item_id: number; qty: number }[];
    outputs: { item_id: number; kind: string }[];
    faction_changes: { faction_id: number; delta: number }[] | null;
    exp_award: number | null;
    money_required: { plat?: number; gold?: number; silver?: number; copper?: number } | null;
    random_outputs: boolean;
  };
  const dItemName = (id: number) => itemMetaById.get(id)?.name || `#${id}`;
  // eqemu_items.nodrop is INVERTED on this Quarm mirror: false = NO DROP.
  const dIsNoDrop = (id: number) => itemMetaById.get(id)?.nodrop === false;
  const dIsDroppable = (id: number) => itemMetaById.get(id)?.nodrop === true;   // tradeable
  const GEM_RE = /\b(gems?|jade|ruby|sapphire|emerald|diamond|opal|pearl|topaz|peridot|amber|garnet|malachite|lapis|jacinth|jasper|turquoise|onyx|bloodstone|moonstone|sunstone|quartz|coral)\b/i;
  const dIsGem = (id: number) => GEM_RE.test(itemMetaById.get(id)?.name || '');
  const itemPqdi = (id: number) => `https://www.pqdi.cc/item/${id}`;
  const npcPqdi = (npcId: number | null) => (npcId ? `https://www.pqdi.cc/npc/${npcId}` : null);
  const heldQty = (id: number) => ownInvById.get(id) ?? 0;
  const promotedSet = new Set<number>(promotedTurninIds);
  const dismissedSet = new Set<number>(dismissedTurninIds);

  // ── Class/race usability (Uilnayar 2026-06-24: "say the classes/races that
  // can use the item; if it's not one that that character can use and it's
  // droppable" → route to 'don't need'). eqemu_items.classes / .races are EQ
  // bitmasks. The viewed character's bit is matched against them.
  const CLASS_BITS: Record<string, number> = {
    warrior: 1, cleric: 2, paladin: 4, ranger: 8, 'shadow knight': 16, shadowknight: 16,
    druid: 32, monk: 64, bard: 128, rogue: 256, shaman: 512, necromancer: 1024,
    wizard: 2048, magician: 4096, mage: 4096, enchanter: 8192, beastlord: 16384,
  };
  const RACE_BITS: Record<string, number> = {
    human: 1, barbarian: 2, erudite: 4, 'wood elf': 8, 'high elf': 16, 'dark elf': 32,
    'half elf': 64, dwarf: 128, troll: 256, ogre: 512, halfling: 1024, gnome: 2048,
    iksar: 4096, 'vah shir': 8192, 'vahshir': 8192,
  };
  const CLASS_TAGS: [number, string][] = [
    [1, 'WAR'], [2, 'CLR'], [4, 'PAL'], [8, 'RNG'], [16, 'SHD'], [32, 'DRU'], [64, 'MNK'],
    [128, 'BRD'], [256, 'ROG'], [512, 'SHM'], [1024, 'NEC'], [2048, 'WIZ'], [4096, 'MAG'],
    [8192, 'ENC'], [16384, 'BST'],
  ];
  const ALL_CLASS_MASK = CLASS_TAGS.reduce((s, [b]) => s | b, 0);
  const charClassBit = CLASS_BITS[(char.class || '').toLowerCase()] ?? 0;
  const charRaceBit  = RACE_BITS[(char.race || '').toLowerCase()] ?? 0;
  const usableByChar = (id: number) => {
    const m = itemMetaById.get(id);
    if (!m) return true;                                   // unknown → don't flag
    const cOk = !charClassBit || !m.classes || (m.classes & charClassBit) !== 0;
    const rOk = !charRaceBit  || !m.races   || (m.races   & charRaceBit)  !== 0;
    return cOk && rOk;
  };
  const classTagsFor = (id: number) => {
    const m = itemMetaById.get(id);
    if (!m || !m.classes || (m.classes & ALL_CLASS_MASK) === ALL_CLASS_MASK) return 'ALL';
    const tags = CLASS_TAGS.filter(([b]) => (m.classes! & b) !== 0).map(([, t]) => t);
    return tags.length ? tags.join(' ') : 'ALL';
  };
  // A clicky usable from inventory (any slot) is useful to ANY class — clicktype
  // 4 = "must equip", anything else with a click effect works from bags. (Manastone,
  // Amulet of Necropotence, etc.) Weapons may be carried for pets. (Uilnayar 2026-06-24.)
  const hasInventoryClicky = (id: number) => { const m = itemMetaById.get(id); return !!m && (m.clickeffect ?? 0) > 0 && m.clicktype !== 4; };
  const isWeapon = (id: number) => (itemMetaById.get(id)?.damage ?? 0) > 0;
  const isEquippable = (id: number) => (itemMetaById.get(id)?.slots ?? 0) > 0;

  // Group discovered "piece" rows (held item is a component) by turn-in.
  // Skip promoted (render in Active) and dismissed (hidden) turn-ins.
  const pieceById = new Map<number, { t: Turnin; matched: Set<number> }>();
  for (const d of discovered) {
    if (d.evidence !== 'piece' || promotedSet.has(d.turnin_id) || dismissedSet.has(d.turnin_id)) continue;
    let e = pieceById.get(d.turnin_id);
    if (!e) { e = { t: d as Turnin, matched: new Set<number>() }; pieceById.set(d.turnin_id, e); }
    e.matched.add(d.matched_item_id);
  }
  type Entry = { t: Turnin; matched: Set<number> };
  const readyList: Entry[] = [];     // hold every component
  const tradeList: Entry[] = [];     // in progress, ALL components tradeable → just trade to one person
  const mqList: Entry[] = [];        // in progress, has a NO DROP component → multi-quest it
  const notForList: Entry[] = [];    // reward is tradeable but not usable by this char
  const gemList: Entry[] = [];       // jeweler/cosmetic/gem noise
  for (const e of pieceById.values()) {
    const ready = e.t.inputs.every(i => heldQty(i.item_id) >= i.qty);
    const hasNoDrop = e.t.inputs.some(i => dIsNoDrop(i.item_id));
    // Gem noise: inputs all common gems (Diamond → H.E.L.M device etc.), or the
    // only thing held is a gem and the real piece is missing.
    const allGems = e.t.inputs.length > 0 && e.t.inputs.every(i => dIsGem(i.item_id));
    const matchedAllGems = e.matched.size > 0 && [...e.matched].every(id => dIsGem(id));
    const gemNoise = allGems || (!ready && matchedAllGems);
    // Reward not for this character: the (primary) reward is tradeable AND the
    // char's class/race can't use it → not worth doing for them.
    const reward = e.t.outputs[0];
    const rewardNotForChar = !!reward && dIsDroppable(reward.item_id) && !usableByChar(reward.item_id);
    if (gemNoise) gemList.push(e);
    else if (ready) readyList.push(e);
    else if (rewardNotForChar) notForList.push(e);
    else if (hasNoDrop) mqList.push(e);    // NO DROP piece → can't consolidate by trading → multi-quest
    else tradeList.push(e);                 // all tradeable → just trade everything to one person
  }
  const byZoneNpc = (a: Entry, b: Entry) =>
    a.t.zone_short.localeCompare(b.t.zone_short) || a.t.npc_name.localeCompare(b.t.npc_name);
  readyList.sort(byZoneNpc); tradeList.sort(byZoneNpc); mqList.sort(byZoneNpc); notForList.sort(byZoneNpc); gemList.sort(byZoneNpc);
  const discoveryCount = pieceById.size;

  // Group a list of turn-ins by the held item that drives them, so one flooding
  // item (e.g. Sky Jewel feeding 30 NPCs) collapses into one expandable group.
  // Primary held item = the matched item shared by the most turn-ins in the list.
  const groupByHeld = (entries: Entry[]): [number, Entry[]][] => {
    const cnt = new Map<number, number>();
    for (const e of entries) for (const id of e.matched) cnt.set(id, (cnt.get(id) ?? 0) + 1);
    const groups = new Map<number, Entry[]>();
    for (const e of entries) {
      let primary = -1, best = -1;
      for (const id of e.matched) {
        const c = cnt.get(id) ?? 0;
        if (c > best || (c === best && (primary < 0 || id < primary))) { best = c; primary = id; }
      }
      if (primary < 0) primary = e.t.inputs[0]?.item_id ?? 0;
      const arr = groups.get(primary) ?? []; arr.push(e); groups.set(primary, arr);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length || dItemName(a[0]).localeCompare(dItemName(b[0])));
  };

  // Completed turn-ins: dedup by output item held, with the held quantity.
  const completedHeld = new Map<number, number>();
  for (const d of discovered) {
    if (d.evidence !== 'completed') continue;
    if (!completedHeld.has(d.matched_item_id)) completedHeld.set(d.matched_item_id, heldQty(d.matched_item_id));
  }
  const completedTurninItems = [...completedHeld.entries()]
    .map(([item_id, qty]) => ({ item_id, qty }))
    .sort((a, b) => dItemName(a.item_id).localeCompare(dItemName(b.item_id)));

  // Promoted (pinned to Active) and dismissed (hidden) turn-ins.
  const toEntry = (t: Turnin) => ({ t, matched: new Set<number>(t.inputs.filter(i => heldQty(i.item_id) >= i.qty).map(i => i.item_id)) });
  const promoted = promotedTurnins.map(toEntry).sort(byZoneNpc);
  const dismissed = dismissedTurnins.map(toEntry).sort(byZoneNpc);

  // Shared row renderer for a discovered/promoted/dismissed turn-in. Format the
  // header as "Item — Turn-in NPC — where" (the held item drives discovery),
  // then a ✓/✗ give-list and the reward. (Uilnayar 2026-06-24.)
  const turninRow = (t: Turnin, matched: Set<number>, kind: 'discovery' | 'promoted' | 'dismissed') => {
    const ready = t.inputs.every(i => heldQty(i.item_id) >= i.qty);
    const headId = [...matched][0] ?? t.inputs[0]?.item_id ?? t.outputs[0]?.item_id ?? null;
    const m = t.money_required;
    const moneyStr = m ? [
      m.plat ? `${m.plat}pp` : '', m.gold ? `${m.gold}gp` : '',
      m.silver ? `${m.silver}sp` : '', m.copper ? `${m.copper}cp` : '',
    ].filter(Boolean).join(' ') : '';
    const npcUrl = npcPqdi(t.npc_id);
    return (
      <li key={t.turnin_id} className="border-l-2 border-purple/30 pl-3 py-0.5">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="flex items-baseline gap-1.5 flex-wrap text-xs">
            {ready && <span className="text-green" title="You hold every component">✅</span>}
            {headId != null
              ? <a href={itemPqdi(headId)} target="_blank" rel="noreferrer" className="text-text font-medium hover:text-blue hover:underline">{dItemName(headId)}</a>
              : <span className="text-text font-medium">turn-in</span>}
            <span className="text-dim/60">—</span>
            {npcUrl
              ? <a href={npcUrl} target="_blank" rel="noreferrer" className="text-blue hover:underline">{t.npc_name}</a>
              : <span className="text-text">{t.npc_name}</span>}
            <span className="text-dim/60">—</span>
            <span className="text-dim">{t.zone_short}</span>
            {t.exp_award ? <span className="text-blue/80 text-[10px]">{t.exp_award.toLocaleString()} xp</span> : null}
            {/* MQ matters when there's a NO DROP component you can't just trade
                to one person — the NO DROP holder does the final hand-in while
                others contribute the tradeable pieces. All-tradeable turn-ins
                don't need MQ; just trade everything to one person. (Uilnayar
                2026-06-24.) */}
            {t.inputs.length >= 2 && t.inputs.some(i => dIsNoDrop(i.item_id)) && (
              <span className="text-[9px] text-purple/90 border border-purple/40 rounded px-1" title="Multi-questable — the NO DROP holder does the final hand-in; others contribute the tradeable pieces">MQ</span>
            )}
            {t.inputs.length >= 2 && t.inputs.every(i => dIsDroppable(i.item_id)) && (
              <span className="text-[9px] text-blue/70 border border-blue/30 rounded px-1" title="All components tradeable — no MQ needed, just trade the pieces to one person">trade</span>
            )}
          </div>
          <TurninControls character={decoded} turninId={t.turnin_id} kind={kind} />
        </div>
        <ul className="text-[11px] mt-0.5 space-y-0.5">
          {t.inputs.map((i, idx) => {
            const have = heldQty(i.item_id); const ok = have >= i.qty;
            return (
              <li key={idx} className="flex items-baseline gap-1.5 flex-wrap">
                <span className={ok ? 'text-green' : 'text-red-400'}>{ok ? '✓' : '✗'}</span>
                <a href={itemPqdi(i.item_id)} target="_blank" rel="noreferrer" className={`hover:underline ${ok ? 'text-text' : 'text-dim'}`}>{dItemName(i.item_id)}</a>
                {i.qty > 1 && <span className="text-dim">× {i.qty}</span>}
                {ok && have > i.qty && <span className="text-dim/50">(have {have})</span>}
                {dIsNoDrop(i.item_id) && <span className="text-orange/70 text-[9px] uppercase tracking-wide">no drop</span>}
              </li>
            );
          })}
          {moneyStr && (
            <li className="flex items-baseline gap-1.5">
              <span className="text-dim/60">·</span>
              <span className="text-dim">{moneyStr}</span>
            </li>
          )}
        </ul>
        {t.outputs.length > 0 && (
          <div className="text-[10px] text-dim/80 mt-0.5">
            Reward: {t.outputs.map((o, idx) => {
              const usable = usableByChar(o.item_id);
              return (
                <span key={idx}>
                  {idx > 0 && ', '}
                  <a href={itemPqdi(o.item_id)} target="_blank" rel="noreferrer" className="text-blue/80 hover:underline">{dItemName(o.item_id)}</a>
                  {/* class/race tags next to the reward; red when this char can't use it */}
                  <span className={usable ? 'text-dim/50' : 'text-red-400/80'}> [{classTagsFor(o.item_id)}]{!usable && ' ✗ not your class/race'}</span>
                </span>
              );
            })}
            {t.random_outputs && <span className="text-orange/70"> (random)</span>}
          </div>
        )}
      </li>
    );
  };

  // Render a list of turn-ins grouped by the held item that drives them — each
  // group a collapsible "Item ✓ — N turn-ins" (auto-open when small). Fixes the
  // flood from one item feeding many NPCs. (Uilnayar 2026-06-24.)
  const renderGroups = (entries: Entry[]) =>
    groupByHeld(entries).map(([itemId, list]) => (
      <details key={itemId} open={list.length <= 2} className="border-l-2 border-purple/20 pl-2">
        <summary className="cursor-pointer text-xs text-text hover:text-blue py-0.5">
          <span className="text-green">✓</span> {dItemName(itemId)}
          <span className="text-dim"> — {list.length} turn-in{list.length === 1 ? '' : 's'}</span>
        </summary>
        <ul className="space-y-2 mt-1 mb-2">{list.map(e => turninRow(e.t, e.matched, 'discovery'))}</ul>
      </details>
    ));

  // ── Inventory dead-weight + broken items (Uilnayar 2026-06-24) ──
  // Classify held bag/bank items (not equipped). A "quest piece" is any held
  // item that feeds or is rewarded by a discovered turn-in.
  const questPieceIds = new Set<number>(discovered.map(d => d.matched_item_id));
  const heldNonEquipped = new Map<number, number>();   // item_id → qty (bags/bank only)
  for (const row of inventory) {
    if (row.character_name.toLowerCase() !== decoded.toLowerCase() || row.item_id == null) continue;
    if (!/^(General|Bank|SharedBank)/.test(row.slot_label)) continue;   // skip equipped slots
    heldNonEquipped.set(row.item_id, (heldNonEquipped.get(row.item_id) ?? 0) + row.quantity);
  }
  const dontNeed: { id: number; qty: number }[] = [];     // tradeable but not usable by this char
  const brokenItems: { id: number; qty: number }[] = [];  // NO DROP + no value + dead-end + unusable
  for (const [id, qty] of heldNonEquipped) {
    const m = itemMetaById.get(id);
    if (!m) continue;
    const usable = usableByChar(id);
    // Clickies usable from inventory (any class) and weapons (often carried for
    // pets) are NOT dead-weight even if the class can't wear them. (Uilnayar
    // 2026-06-24: Amulet of Necropotence / Shield of the Immaculate / Blade of
    // the Earthcaller.)
    if (hasInventoryClicky(id) || isWeapon(id)) continue;
    if (m.nodrop === true && !usable) dontNeed.push({ id, qty });
    // Broken = NO DROP, no value, feeds no quest, can't use, and not even
    // equippable (slotless junk). Equippable NO DROP armor is almost always a
    // quest/turn-in piece (Velious armor molds), so never call it broken.
    else if (m.nodrop === false && (m.price ?? 0) <= 0 && !questPieceIds.has(id) && !usable && !isEquippable(id)) brokenItems.push({ id, qty });
  }
  dontNeed.sort((a, b) => dItemName(a.id).localeCompare(dItemName(b.id)));
  brokenItems.sort((a, b) => dItemName(a.id).localeCompare(dItemName(b.id)));
  // Compact coin value from a copper price.
  const coin = (price: number | null | undefined) => {
    const p = price ?? 0;
    if (p <= 0) return '—';
    if (p >= 1000) return `${Math.floor(p / 1000)}pp`;
    if (p >= 100) return `${Math.floor(p / 100)}gp`;
    if (p >= 10) return `${Math.floor(p / 10)}sp`;
    return `${p}cp`;
  };

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href={`/character/${encodeURIComponent(decoded)}`} className="text-blue hover:underline">← back to {decoded}</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold flex items-center gap-3 mb-1">
          📋 {decoded} — Quest tracker
          {!char.show_inventory_publicly && (
            <span className="text-[10px] tracking-widest font-bold px-2 py-0.5 rounded bg-dim/20 border border-dim/60 text-dim uppercase" title="Owner/officer only. Toggle on /me to share with the guild.">
              🔒 Private
            </span>
          )}
          <span className="text-[10px] tracking-widest font-bold px-2 py-0.5 rounded bg-orange/20 border border-orange/60 text-orange uppercase">Beta</span>
        </h2>
        <p className="text-sm text-dim leading-6">
          Curated quests we track against {decoded}&apos;s inventory. Green ✓
          on items {decoded} has; red ✗ on items they need. A hint in
          parentheses shows when another character in their family
          (<code>{(char.main_name || char.name)}</code>) has the item —
          useful for MQ planning. Catalog is officer-managed at{' '}
          <Link href="/admin/quests" className="text-blue hover:underline">/admin/quests</Link>.
        </p>
        {inventory.length === 0 && (
          <p className="text-xs text-orange mt-3">
            ⚠ No inventory data yet for any character. The page will light up
            once the agent&apos;s upcoming inventory file watcher ships and a
            recent <code>/outputfile inventory</code> has run.
          </p>
        )}
      </section>

      {/* Class Epic 1.0 components held (Uilnayar 2026-06-26). Grouped by
          class — the same piece can feed more than one class chain (e.g.
          Shining Metallic Robes feeds both the Rogue and Enchanter epics),
          so it shows up under every relevant section. Sorted by held-count
          descending so the class the character is closest to finishing
          floats to the top. */}
      {epicClassesSorted.length > 0 && (
        <section className="bg-panel border border-purple/40 rounded-lg p-5">
          <h3 className="text-lg text-purple mb-2">⚔️ Epic 1.0 components held</h3>
          <p className="text-xs text-dim leading-5 mb-3">
            Pieces of Class Epic 1.0 quest chains in {decoded}&apos;s inventory, grouped by
            class. <span className="text-dim/70">Depth = how many turn-in steps from the final
            reward (depth 1 = the last hand-in&apos;s direct inputs).</span> A piece that feeds multiple
            class chains is listed under each.
          </p>
          <div className="space-y-3">
            {epicClassesSorted.map(({ cls, weapon, rewardId, hits }) => (
              <div key={cls} className="border-l-2 border-purple/30 pl-3">
                <div className="flex items-baseline gap-2 flex-wrap text-sm">
                  <span className="text-text font-medium">{cls}</span>
                  <span className="text-dim text-[10px]">—</span>
                  {weapon && rewardId ? (
                    <a href={`https://www.pqdi.cc/item/${rewardId}`} target="_blank" rel="noreferrer"
                       className="text-blue hover:underline text-xs">{weapon}</a>
                  ) : (
                    <span className="text-dim text-xs">{weapon ?? '—'}</span>
                  )}
                  <span className="text-dim text-[10px]">· {hits.length} piece{hits.length === 1 ? '' : 's'} held</span>
                </div>
                <ul className="text-xs mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {hits.map(h => (
                    <li key={h.itemId} className="flex items-baseline gap-1">
                      <span className="text-green">✓</span>
                      <a href={`https://www.pqdi.cc/item/${h.itemId}`} target="_blank" rel="noreferrer"
                         className="text-text hover:text-blue hover:underline">{h.name}</a>
                      {h.qty > 1 && <span className="text-dim/70">×{h.qty}</span>}
                      <span className="text-dim/40 text-[9px]">d{h.depth}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Active quests — catalog quests + turn-ins the character pinned from
          discovery. Pinned ones render first. (Uilnayar 2026-06-24: "Let people
          move those quests to the active quests section and have that be at the
          top of the page.") */}
      <section className="bg-panel border border-border rounded-lg p-5">
        <h3 className="text-lg text-orange mb-3">Active quests ({active.length + promoted.length})</h3>
        {promoted.length > 0 && (
          <ul className="space-y-2 mb-4">
            {promoted.map(e => turninRow(e.t, e.matched, 'promoted'))}
          </ul>
        )}
        {active.length === 0 && promoted.length === 0 ? (
          <p className="text-sm text-dim italic">No active quests. Pin a turn-in from Inventory-driven discovery below (▲ to active) to track it here.</p>
        ) : active.length === 0 ? null : (
          <div className="space-y-4">
            {active.map(p => (
              <div key={p.quest.id} className="border-l-2 border-border/60 pl-3">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <div>
                    <span className="text-text">{p.quest.name}</span>
                    {p.quest.zone && <span className="text-dim text-xs"> · {p.quest.zone}</span>}
                    {p.quest.pqdi_quest_url && (
                      <a href={p.quest.pqdi_quest_url} target="_blank" rel="noreferrer"
                         className="text-blue text-[10px] hover:underline ml-2">PQDI ↗</a>
                    )}
                  </div>
                  <div className="flex items-baseline gap-3">
                    <span className="text-dim text-xs">{p.haveCount}/{p.needCount} pieces</span>
                    <QuestActionButtons character={decoded} questId={p.quest.id} />
                  </div>
                </div>
                {p.quest.notes && <p className="text-[11px] text-dim italic mt-0.5">{p.quest.notes}</p>}
                <ul className="text-xs mt-1.5 space-y-0.5">
                  {p.items.map(it => {
                    const ok = it.have >= it.need;
                    return (
                      <li key={it.ri.id} className="flex items-baseline gap-2 flex-wrap">
                        <span className={ok ? 'text-green' : it.ri.optional ? 'text-dim' : 'text-red-400'}>
                          {ok ? '✓' : it.ri.optional ? '·' : '✗'}
                        </span>
                        <span className={ok ? 'text-text' : 'text-dim'}>
                          {it.info?.name ?? it.ri.item_name}
                          {it.info?.lore && it.info.lore !== it.info.name && <span className="text-purple/90 text-[10px]"> ({it.info.lore})</span>}
                          {it.need > 1 && <> × {it.need}</>}
                          {ok && it.have > it.need && <span className="text-dim/60"> (have {it.have})</span>}
                        </span>
                        {it.info?.zones?.length ? (
                          <span className="text-blue/70 text-[10px]">📍 {it.info.zones.slice(0, 2).join(', ')}</span>
                        ) : null}
                        {!ok && it.familyHints.length > 0 && (
                          <span className="text-dim/70 text-[10px]">
                            (also on family: {it.familyHints.map(h => `${h.name}${h.qty > 1 ? ` ×${h.qty}` : ''}`).join(', ')})
                          </span>
                        )}
                        {it.ri.notes && <span className="text-dim/60 text-[10px] italic">— {it.ri.notes}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Inferred zone access — derived from NO DROP loot in inventory that
          drops ONLY in a locked zone. Surfaces even when no catalog quest is
          seeded for the zone (e.g. Howling Stones), so the evidence is always
          visible. (Uilnayar 2026-06-24.) */}
      {inferredKeys.length > 0 && (
        <section className="bg-panel border border-gold/40 rounded-lg p-5">
          <h3 className="text-lg text-gold mb-2">🗝 Inferred zone access</h3>
          <p className="text-xs text-dim leading-5 mb-3">
            {decoded} is provably holding NO DROP loot exclusive to these locked
            zones — they could not have looted it without the key.
          </p>
          <ul className="space-y-2 text-sm">
            {inferredKeys.map(k => (
              <li key={k.zone_short} className="flex items-baseline gap-2 flex-wrap">
                <span className="text-green">✓</span>
                <span className="text-text">{k.zone_long}</span>
                <span className="text-dim text-xs">
                  {k.key_item_name && `· ${k.key_item_name}`}
                </span>
                <span className="text-dim/70 text-[10px]">
                  {k.evidence_count} item{k.evidence_count === 1 ? '' : 's'} held — {k.evidence_items.slice(0, 3).join(', ')}{k.evidence_items.length < k.evidence_count ? '…' : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Inventory-driven discovery — scripted NPC turn-ins matched against the
          player's inventory (ProjectEQ quest scripts → scripted_npc_turnins).
          Reworked (Uilnayar 2026-06-24): ready-to-turn-in first, NO DROP vs
          tradeable split, gem-only matches minimized, "Item — NPC — where"
          format with PQDI links and ✓/✗ per component. */}
      {(discoveryCount > 0 || completedTurninItems.length > 0 || dismissed.length > 0) && (
        <section className="bg-panel border border-purple/40 rounded-lg p-5">
          <h3 className="text-lg text-purple mb-2">🔍 Inventory-driven discovery</h3>
          <p className="text-xs text-dim leading-5 mb-3">
            NPC turn-ins matched against {decoded}&apos;s inventory, from the ProjectEQ
            quest scripts. Format is <span className="text-dim/80">Item — Turn-in NPC — zone</span>;
            ✓ marks a component held, ✗ one still needed. Pin one to Active quests with ▲,
            or 🚫 dismiss ones you don&apos;t care about.
          </p>

          {readyList.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm text-green mb-1.5">✅ Ready to turn in ({readyList.length})</h4>
              <ul className="space-y-2">{readyList.map(e => turninRow(e.t, e.matched, 'discovery'))}</ul>
            </div>
          )}

          {tradeList.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm text-blue mb-1.5">🤝 Tradeable — just consolidate ({tradeList.length})</h4>
              <p className="text-[10px] text-dim mb-1.5">Every component is tradeable, so no MQ needed — gather the pieces (or trade them to one person) and turn in. Grouped by the item you hold; click to expand.</p>
              <div className="space-y-0.5">{renderGroups(tradeList)}</div>
            </div>
          )}

          {mqList.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm text-purple mb-1.5">🔀 Multi-questable — has a NO DROP component ({mqList.length})</h4>
              <p className="text-[10px] text-dim mb-1.5">A NO DROP piece can&apos;t be traded together, so MQ it: the NO DROP holder does the final hand-in while others contribute the tradeable pieces. Grouped by the item you hold.</p>
              <div className="space-y-0.5">{renderGroups(mqList)}</div>
            </div>
          )}

          {notForList.length > 0 && (
            <details className="mt-2">
              <summary className="text-sm text-dim cursor-pointer hover:text-blue">🚷 Reward not usable by your class/race ({notForList.length})</summary>
              <p className="text-[10px] text-dim mt-1 mb-1.5">The reward is tradeable but {char.class || 'this character'} can&apos;t use it — only worth doing to MQ for someone else.</p>
              <div className="space-y-0.5 mt-1">{renderGroups(notForList)}</div>
            </details>
          )}

          {gemList.length > 0 && (
            <details className="mt-2">
              <summary className="text-sm text-dim cursor-pointer hover:text-blue">💎 Gem turn-ins — only a common gem held ({gemList.length})</summary>
              <div className="space-y-0.5 mt-2">{renderGroups(gemList)}</div>
            </details>
          )}

          {dismissed.length > 0 && (
            <details className="mt-2">
              <summary className="text-sm text-dim cursor-pointer hover:text-blue">🚫 Dismissed turn-ins ({dismissed.length}) — restore any</summary>
              <ul className="space-y-2 mt-2">{dismissed.map(e => turninRow(e.t, e.matched, 'dismissed'))}</ul>
            </details>
          )}
        </section>
      )}

      {/* Stack turn-ins */}
      <section className="bg-panel border border-border rounded-lg p-5">
        <h3 className="text-lg text-orange mb-2">Stack turn-ins ({stacks.length})</h3>
        <p className="text-xs text-dim mb-3">
          Repeatable faction / DKP turn-ins where stacks of the same item drive value.
          Bone chips, goblin ears, Kael giant toes, Crushbone belts, etc.
        </p>
        {stacks.length === 0 ? (
          <p className="text-sm text-dim italic">No stack turn-ins in the catalog yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-dim text-xs text-left">
                <th className="py-1 pr-3">Item</th>
                <th className="py-1 pr-3">For</th>
                <th className="py-1 pr-3 text-right">Have</th>
                <th className="py-1 pr-3 text-right">Per turn-in</th>
                <th className="py-1">Family stash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {stacks.flatMap(p => p.items.map(it => {
                const familyTotal = it.familyHints.reduce((s, h) => s + h.qty, 0);
                return (
                  <tr key={`${p.quest.id}-${it.ri.id}`}>
                    <td className="py-1.5 pr-3 text-text">
                      {it.info?.name ?? it.ri.item_name}
                      {it.info?.lore && it.info.lore !== it.info.name && <span className="text-purple/90 text-[10px]"> ({it.info.lore})</span>}
                      {it.info?.zones?.length ? <span className="text-blue/70 text-[10px] block">📍 {it.info.zones.slice(0, 2).join(', ')}</span> : null}
                    </td>
                    <td className="py-1.5 pr-3 text-dim text-xs">
                      {p.quest.pqdi_quest_url
                        ? <a href={p.quest.pqdi_quest_url} target="_blank" rel="noreferrer" className="text-blue hover:underline">{p.quest.name} ↗</a>
                        : p.quest.name}
                    </td>
                    <td className={`py-1.5 pr-3 text-right tabular-nums ${it.have >= it.need ? 'text-green' : 'text-dim'}`}>{it.have}</td>
                    <td className="py-1.5 pr-3 text-right text-dim tabular-nums">{it.need}</td>
                    <td className="py-1.5 text-dim text-xs">
                      {familyTotal > 0
                        ? `+${familyTotal} across ${it.familyHints.length} char${it.familyHints.length === 1 ? '' : 's'}`
                        : '—'}
                    </td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        )}
      </section>

      {/* Completed quests (collapsible-ish — just a dim folded list) */}
      <section className="bg-panel border border-border rounded-lg p-5">
        <h3 className="text-lg text-orange mb-2">Completed quests ({completed.length})</h3>
        {completed.length === 0 && completedTurninItems.length === 0 ? (
          <p className="text-sm text-dim italic">No completed quests recorded yet. A quest completes when you hold its reward — in inventory or on your keyring (upload via 📖/🗝 on /me).</p>
        ) : completed.length === 0 ? null : (
          <ul className="text-sm space-y-1">
            {completed.map(p => {
              const rk = (p.quest.reward_item_name || '').toLowerCase();
              const slots = rk ? ownInvSlotByName.get(rk) : undefined;
              const onKeyring =
                (p.quest.reward_item_id != null && ownKeyIds.has(p.quest.reward_item_id)) ||
                (!!rk && ownKeyNames.has(rk));
              return (
                <li key={p.quest.id} className="flex items-baseline gap-2 text-dim">
                  <span className="text-green">✓</span>
                  <span className="text-text">{p.quest.name}</span>
                  {p.quest.zone && <span className="text-xs">· {p.quest.zone}</span>}
                  {p.quest.pqdi_quest_url && (
                    <a href={p.quest.pqdi_quest_url} target="_blank" rel="noreferrer" className="text-blue text-[10px] hover:underline">PQDI turn-in ↗</a>
                  )}
                  {slots ? (
                    <span className="text-[10px]">— in {slots.join(', ')}</span>
                  ) : onKeyring ? (
                    <span className="text-[10px] text-green/80">— 🗝 on keyring</span>
                  ) : p.impliedBy ? (
                    <span className="text-[10px] text-green/80">— done via {p.impliedBy}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {/* Turn-in rewards held — deduped by item with a held count (Uilnayar
            2026-06-24: "there shouldn't be multiples displayed - we should see a
            count (x)"). Holding a turn-in's reward implies the turn-in was done. */}
        {completedTurninItems.length > 0 && (
          <div className="mt-4">
            <h4 className="text-sm text-green mb-1">Turn-in rewards held ({completedTurninItems.length})</h4>
            <p className="text-[11px] text-dim mb-1.5">
              Reward items from scripted turn-ins that are in {decoded}&apos;s inventory — the turn-in was almost certainly completed.
            </p>
            <ul className="text-xs grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
              {completedTurninItems.map(c => (
                <li key={c.item_id} className="flex items-baseline gap-1.5">
                  <span className="text-green">✓</span>
                  <a href={itemPqdi(c.item_id)} target="_blank" rel="noreferrer" className="text-text hover:text-blue hover:underline">{dItemName(c.item_id)}</a>
                  <span className="text-dim/70">({c.qty})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Hidden / Dismissed — restore from here. Hidden = "out of the way for now",
          dismissed = "I'm not doing this." Both stay in the database; restore
          buttons bring them back to active. */}
      {(hiddenProgress.length > 0 || dismissedProgress.length > 0) && (
        <section className="bg-panel border border-border rounded-lg p-5 space-y-3">
          {hiddenProgress.length > 0 && (
            <details>
              <summary className="text-sm text-dim cursor-pointer hover:text-blue">
                👁 Hidden ({hiddenProgress.length})
              </summary>
              <ul className="mt-2 text-xs space-y-1">
                {hiddenProgress.map(p => (
                  <li key={p.quest.id} className="flex items-baseline gap-2">
                    <span className="text-dim/80">{p.quest.name}</span>
                    {p.quest.zone && <span className="text-dim text-[10px]">· {p.quest.zone}</span>}
                    <QuestUnhideButton character={decoded} questId={p.quest.id} label="unhide" />
                  </li>
                ))}
              </ul>
            </details>
          )}
          {dismissedProgress.length > 0 && (
            <details>
              <summary className="text-sm text-dim cursor-pointer hover:text-blue">
                ✕ Dismissed ({dismissedProgress.length})
              </summary>
              <ul className="mt-2 text-xs space-y-1">
                {dismissedProgress.map(p => (
                  <li key={p.quest.id} className="flex items-baseline gap-2">
                    <span className="text-dim/80">{p.quest.name}</span>
                    {p.quest.zone && <span className="text-dim text-[10px]">· {p.quest.zone}</span>}
                    <QuestUnhideButton character={decoded} questId={p.quest.id} label="restore" />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {/* Dead-weight: held (bag/bank) items that are tradeable but the char's
          class/race can't use. (Uilnayar 2026-06-24.) */}
      <section className="bg-panel border border-border rounded-lg p-5">
        <h3 className="text-lg text-orange mb-2">Quest pieces you probably don&apos;t need ({dontNeed.length})</h3>
        <p className="text-xs text-dim leading-6 mb-2">
          Tradeable items in {decoded}&apos;s bags/bank that {char.class || 'this character'} can&apos;t
          use — sell, trade, or hand off to an alt. Class/race tags + value shown.
        </p>
        {dontNeed.length === 0 ? (
          <p className="text-sm text-dim italic">Nothing flagged — every tradeable item {decoded} is holding is usable by their class/race (or has no class restriction).</p>
        ) : (
          <ul className="text-xs grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
            {dontNeed.map(({ id, qty }) => (
              <li key={id} className="flex items-baseline gap-1.5">
                <a href={itemPqdi(id)} target="_blank" rel="noreferrer" className="text-text hover:text-blue hover:underline">{dItemName(id)}</a>
                {qty > 1 && <span className="text-dim/70">×{qty}</span>}
                <span className="text-red-400/70 text-[10px]">[{classTagsFor(id)}]</span>
                <span className="text-dim/50 text-[10px]">{coin(itemMetaById.get(id)?.price)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Broken quest items — NO DROP, no value, feed no quest, unusable.
          Advisory only ("safe to destroy"); double-check before deleting. */}
      {brokenItems.length > 0 && (
        <section className="bg-panel border border-red/30 rounded-lg p-5">
          <h3 className="text-lg text-red-400 mb-2">🗑 Broken quest items ({brokenItems.length})</h3>
          <p className="text-xs text-dim leading-6 mb-2">
            NO DROP, no vendor value, feed no known turn-in, and {char.class || 'this character'} can&apos;t
            use them — almost certainly safe to destroy. Double-check on PQDI first.
          </p>
          <ul className="text-xs grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
            {brokenItems.map(({ id, qty }) => (
              <li key={id} className="flex items-baseline gap-1.5">
                <a href={itemPqdi(id)} target="_blank" rel="noreferrer" className="text-text hover:text-blue hover:underline">{dItemName(id)}</a>
                {qty > 1 && <span className="text-dim/70">×{qty}</span>}
                <span className="text-orange/60 text-[9px] uppercase tracking-wide">no drop</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
