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
// Three sections on the page:
//   1. Active quests — progress bars + per-item check/X
//   2. Stack turn-ins — separate table view per Uilnayar 2026-06-24
//      ("for items where you typically would turn in stacks, highlight
//       those in a table")
//   3. Inventory dead-weight — items in the inventory that aren't useful
//      to this character (no-drop, wrong class/race, no quest claim).

import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';
import { QuestActionButtons, QuestUnhideButton } from './QuestPrefsControls';

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
  const { char, quests, questItems, inventory, keys, familyNames, itemInfo, prefByQuest } = data;

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
    completed: boolean;        // owns the reward item already (quest done)
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
    // Hold the reward → done, whether it's in inventory OR on the keyring
    // (Key of Veeshan, Trakanon Idol, etc.). Match by item id first, name second.
    const completed =
      (q.reward_item_id != null && ((ownInvById.get(q.reward_item_id) ?? 0) >= 1 || ownKeyIds.has(q.reward_item_id))) ||
      (!!rewardKey && ((ownInvByName.get(rewardKey) ?? 0) >= 1 || ownKeyNames.has(rewardKey)));
    return { quest: q, items, haveCount, needCount, completed };
  });

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

  // Dead-weight: inventory items that are NOT required by any active quest
  // and the character isn't using as gear. Heuristic for v1 — refined as
  // we learn the data. Items with item_id that we recognize from
  // eqemu_items but aren't equipped (slot starts with 'General') and
  // aren't a quest reagent are surfaced as dead-weight candidates.
  // (Skipped until inventory data lands; placeholder section below.)

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

      {/* Active quests */}
      <section className="bg-panel border border-border rounded-lg p-5">
        <h3 className="text-lg text-orange mb-3">Active quests ({active.length})</h3>
        {active.length === 0 ? (
          <p className="text-sm text-dim italic">All seeded quests completed or none active.</p>
        ) : (
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
        {completed.length === 0 ? (
          <p className="text-sm text-dim italic">No completed quests recorded yet. A quest completes when you hold its reward — in inventory or on your keyring (upload via 📖/🗝 on /me).</p>
        ) : (
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
                  ) : null}
                </li>
              );
            })}
          </ul>
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

      {/* Dead-weight inventory — placeholder until the heuristic + inventory data are wired */}
      <section className="bg-panel border border-border rounded-lg p-5">
        <h3 className="text-lg text-orange mb-2">Quest pieces you probably don&apos;t need</h3>
        <p className="text-xs text-dim leading-6">
          Items in {decoded}&apos;s inventory that don&apos;t feed a quest they
          could finish (wrong class/race reward, no-drop dead end, no
          faction value) and aren&apos;t equipped will surface here.
          <span className="text-orange"> Wired to render when the agent inventory
          upload lands and we&apos;ve scored items against the character&apos;s
          class/race — placeholder for now.</span>
        </p>
      </section>
    </div>
  );
}
