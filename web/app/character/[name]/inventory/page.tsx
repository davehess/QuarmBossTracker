// /character/[name]/inventory — Nillipuss-style bag/bank grid.
//
// Renders the character's stored character_inventory snapshot as:
//   • Equipped strip — paper-doll slots in a single row (no body diagram in v1)
//   • Bags — 8 General bag containers + their nested slots
//   • Bank — up to 24 Bank containers + nested slots
//   • Shared bank — up to 10 SharedBank containers + nested slots
//
// Slot families come straight from the EQ /outputfile inventory shape
// (Location column): "Ear","Chest",… for equipped; "General1"…"General8" for
// the bag tops + "General1-Slot1" for bag contents. Mirror semantics for
// Bank1-Slot* and SharedBank1-Slot*. (Validated against on-disk Canopy file:
// 35 equipped, 16 General containers, 60 Bank containers, 20 SharedBank
// containers across the guild snapshot.)
//
// Item details (name, lore, slot bits, AC/HP/Mana, weapon damage/delay/haste,
// resists, weight, price, click effect, class/race bitmasks) come from the new
// item_card_info RPC and are rendered in a hover popover via the ItemHover
// client component. Stats-only — no in-game icon — per the agreed v1 scope.
// Stat-attribute columns (astr/asta/aagi/etc.) aren't mirrored on Quarm, so
// "more stats" deep-links to PQDI.
//
// Visibility gate mirrors /character/[name]/quests: owner + officer always;
// others need characters.show_inventory_publicly.

import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';
import { type ItemCard } from './ItemHover';
import InventoryView, { type ViewData, type CellData, type ContainerData } from './InventoryView';

export const dynamic = 'force-dynamic';

// Equipped slot order — same flow as the in-game paper-doll, top to bottom.
const EQUIPPED_SLOTS = [
  'Charm','Ear','Head','Face','Neck','Shoulders','Arms','Back','Wrist',
  'Range','Hands','Primary','Secondary','Fingers','Chest','Legs','Feet',
  'Waist','Ammo','Held','Power Source',
];

type InvRow = {
  slot_label: string;
  item_id: number | null;
  item_name: string;
  quantity: number;
};

function parseChildSlot(slot: string): { parent: string; idx: number } | null {
  const m = slot.match(/^(.+?)-Slot(\d+)$/);
  return m ? { parent: m[1], idx: parseInt(m[2], 10) } : null;
}

export default async function CharacterInventoryPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  if (!/^[A-Za-z]{2,}$/.test(decoded)) notFound();

  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/character/${encodeURIComponent(name)}/inventory`);

  const sb = supabaseAdmin();
  const { data: charRows } = await sb
    .from('characters')
    .select('name, class, discord_id, show_inventory_publicly')
    .eq('guild_id', 'wolfpack')
    .ilike('name', decoded)
    .limit(1);
  const char = (charRows && charRows[0]) as
    | { name: string; class: string | null; discord_id: string | null; show_inventory_publicly: boolean }
    | undefined;
  if (!char) notFound();

  // Visibility gate (same rule as quests).
  const officer = await isOfficer(user.id);
  let isOwner = false;
  if (char.discord_id) {
    const { data: me } = await sb.from('wolfpack_members')
      .select('discord_id').eq('user_id', user.id).maybeSingle();
    isOwner = !!me?.discord_id && me.discord_id === char.discord_id;
  }
  if (!officer && !isOwner && !char.show_inventory_publicly) {
    return (
      <div className="space-y-4">
        <div className="text-sm"><Link href={`/character/${encodeURIComponent(decoded)}`} className="text-blue hover:underline">← back to {decoded}</Link></div>
        <section className="bg-panel border border-border rounded-lg p-6">
          <h2 className="text-xl text-gold">🔒 Private</h2>
          <p className="text-sm text-dim mt-2">{decoded} hasn&apos;t made their inventory public yet. Only the owner (and officers) can see this page.</p>
        </section>
      </div>
    );
  }

  // Pull the character's whole snapshot. Inventory rows are bounded (a few
  // hundred per character), so one fetch + groupBy in JS is fine.
  const { data: rows } = await sb
    .from('character_inventory')
    .select('slot_label, item_id, item_name, quantity')
    .eq('guild_id', 'wolfpack')
    .ilike('character_name', decoded)
    .limit(2000);
  const inv = (rows ?? []) as InvRow[];

  // Resolve item card data for every item id (one RPC call).
  const ids = Array.from(new Set(inv.map(r => r.item_id).filter((x): x is number => x != null)));
  const cards = new Map<number, ItemCard>();
  if (ids.length > 0) {
    const { data: info } = await sb.rpc('item_card_info', { p_item_ids: ids });
    for (const r of ((info ?? []) as ItemCard[])) cards.set(r.item_id, r);
  }

  // Group by family.
  const equipped = new Map<string, InvRow>();           // slot → row
  const generalContainers = new Map<number, InvRow>();  // 1..8
  const bankContainers = new Map<number, InvRow>();
  const sharedBankContainers = new Map<number, InvRow>();
  // parent slot → sparse map of childIdx → row
  const childrenByParent = new Map<string, Map<number, InvRow>>();
  for (const r of inv) {
    if (EQUIPPED_SLOTS.includes(r.slot_label)) { equipped.set(r.slot_label, r); continue; }
    const child = parseChildSlot(r.slot_label);
    if (child) {
      const m = childrenByParent.get(child.parent) ?? new Map<number, InvRow>();
      m.set(child.idx, r);
      childrenByParent.set(child.parent, m);
      continue;
    }
    const gm = r.slot_label.match(/^General(\d+)$/);
    const bm = r.slot_label.match(/^Bank(\d+)$/);
    const sm = r.slot_label.match(/^SharedBank(\d+)$/);
    if (gm) generalContainers.set(parseInt(gm[1], 10), r);
    else if (bm) bankContainers.set(parseInt(bm[1], 10), r);
    else if (sm) sharedBankContainers.set(parseInt(sm[1], 10), r);
  }

  const totalSlotsUsed = inv.filter(r => parseChildSlot(r.slot_label) || EQUIPPED_SLOTS.includes(r.slot_label)).length;
  const updatedAt = inv.length === 0 ? null : '(uploaded snapshot)';

  // Build serializable view data for the client InventoryView (mode toggle +
  // name-at-top + bag fullness). Bag capacity is estimated by rounding the
  // highest filled slot up to a standard EQ bag size — /outputfile's "Slots"
  // column isn't captured in character_inventory yet.
  const STD_BAG = [4, 6, 8, 10, 16, 20, 24];
  const bagCapacity = (observedMax: number) => {
    for (const s of STD_BAG) if (observedMax <= s) return s;
    return observedMax || 10;
  };
  const toCell = (label: string, row?: InvRow): CellData => row
    ? { label, name: row.item_name, item_id: row.item_id, quantity: row.quantity, card: (row.item_id != null ? cards.get(row.item_id) ?? null : null) }
    : { label, name: null, item_id: null, quantity: 0, card: null };
  const buildContainers = (prefix: string, count: number, containers: Map<number, InvRow>): ContainerData[] => {
    const out: ContainerData[] = [];
    for (let i = 1; i <= count; i++) {
      const slotName = `${prefix}${i}`;
      const bag = containers.get(i);
      const contents = childrenByParent.get(slotName);
      if (!bag && (!contents || contents.size === 0)) continue;   // hide empty container slots
      const observedMax = contents ? Math.max(0, ...contents.keys()) : 0;
      const capacity = bagCapacity(observedMax);
      const cells: CellData[] = [];
      for (let j = 1; j <= capacity; j++) cells.push(toCell(`#${j}`, contents?.get(j)));
      out.push({
        key: slotName,
        shortLabel: prefix === 'SharedBank' ? `Shared ${i}` : `${prefix.charAt(0)}${i}`,
        bagName: bag?.item_name ?? null,
        bagCard: bag?.item_id != null ? cards.get(bag.item_id) ?? null : null,
        used: contents?.size ?? 0,
        capacity,
        cells,
      });
    }
    return out;
  };
  const viewData: ViewData = {
    equipped: EQUIPPED_SLOTS.map(slot => toCell(slot, equipped.get(slot))),
    bags: buildContainers('General', 8, generalContainers),
    bank: buildContainers('Bank', 24, bankContainers),
    sharedBank: buildContainers('SharedBank', 10, sharedBankContainers),
  };

  return (
    <div className="space-y-6">
      <div className="text-sm flex gap-4">
        <Link href={`/character/${encodeURIComponent(decoded)}`} className="text-blue hover:underline">← back to {decoded}</Link>
        <Link href={`/character/${encodeURIComponent(decoded)}/quests`} className="text-blue hover:underline">quests →</Link>
        <Link href={`/character/${encodeURIComponent(decoded)}/spells`} className="text-blue hover:underline">spells →</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold flex items-center gap-3 mb-1">
          🎒 {decoded} — Inventory
          {!char.show_inventory_publicly && (
            <span className="text-[10px] tracking-widest font-bold px-2 py-0.5 rounded bg-dim/20 border border-dim/60 text-dim uppercase" title="Owner/officer only. Toggle on /me to share with the guild.">🔒 Private</span>
          )}
          <span className="text-[10px] tracking-widest font-bold px-2 py-0.5 rounded bg-orange/20 border border-orange/60 text-orange uppercase">Beta</span>
        </h2>
        <p className="text-sm text-dim leading-6">
          Stored snapshot from {decoded}&apos;s last <code className="text-text">/outputfile inventory</code>{' '}
          (Mimic uploads this automatically in 1.0.78+). Hover an item for stats. Click through to PQDI for the full sheet.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-dim">
          <span>Total items: <span className="text-text">{totalSlotsUsed.toLocaleString()}</span></span>
          <span>Equipped: <span className="text-text">{equipped.size}</span></span>
          <span>Bag slots filled: <span className="text-text">{[...childrenByParent.entries()].filter(([p]) => p.startsWith('General')).reduce((s, [, m]) => s + m.size, 0)}</span></span>
          <span>Bank slots filled: <span className="text-text">{[...childrenByParent.entries()].filter(([p]) => p.startsWith('Bank')).reduce((s, [, m]) => s + m.size, 0)}</span></span>
          <span>Shared bank: <span className="text-text">{[...childrenByParent.entries()].filter(([p]) => p.startsWith('SharedBank')).reduce((s, [, m]) => s + m.size, 0)}</span></span>
        </div>
        {inv.length === 0 && (
          <p className="text-xs text-orange mt-3">
            ⚠ No inventory snapshot yet for {decoded}. Run <code>/outputfile inventory</code> in EQ — Mimic 1.0.78+ uploads it automatically. Or upload manually via 🎒 on <Link href="/me" className="text-blue hover:underline">/me</Link>.
          </p>
        )}
      </section>

      {/* Bag/bank grid with view-mode toggle (Normal / Small / Text), item
          names at the top of each box, and bag fullness in the top-right. */}
      <InventoryView data={viewData} />
      {updatedAt && <p className="text-[10px] text-dim text-right">{updatedAt}</p>}
    </div>
  );
}
