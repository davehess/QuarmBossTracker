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
import ItemHover, { type ItemCard } from './ItemHover';
import ItemIcon from './ItemIcon';

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

      {/* Equipped strip */}
      <SectionCard title="Equipped" count={equipped.size}>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1.5">
          {EQUIPPED_SLOTS.map(slot => {
            const row = equipped.get(slot);
            return <Cell key={slot} label={slot} row={row} card={row?.item_id ? cards.get(row.item_id) : undefined} />;
          })}
        </div>
      </SectionCard>

      {/* Bags */}
      <SectionCard title="Bags" count={[...childrenByParent.entries()].filter(([p]) => p.startsWith('General')).reduce((s, [, m]) => s + m.size, 0)}>
        <ContainerGroup
          prefix="General"
          count={8}
          containers={generalContainers}
          children_={childrenByParent}
          cards={cards}
        />
      </SectionCard>

      {/* Bank */}
      <SectionCard title="Bank" count={[...childrenByParent.entries()].filter(([p]) => p.startsWith('Bank')).reduce((s, [, m]) => s + m.size, 0)}>
        <ContainerGroup
          prefix="Bank"
          count={24}
          containers={bankContainers}
          children_={childrenByParent}
          cards={cards}
        />
      </SectionCard>

      {/* Shared bank */}
      <SectionCard title="Shared bank" count={[...childrenByParent.entries()].filter(([p]) => p.startsWith('SharedBank')).reduce((s, [, m]) => s + m.size, 0)}>
        <p className="text-[11px] text-dim leading-5 mb-2">Shared across every character on the same EQ account.</p>
        <ContainerGroup
          prefix="SharedBank"
          count={10}
          containers={sharedBankContainers}
          children_={childrenByParent}
          cards={cards}
        />
      </SectionCard>
      {updatedAt && <p className="text-[10px] text-dim text-right">{updatedAt}</p>}
    </div>
  );
}

function SectionCard({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="bg-panel border border-border rounded-lg p-5">
      <h3 className="text-lg text-orange mb-3">{title} <span className="text-dim text-xs font-normal">· {count}</span></h3>
      {children}
    </section>
  );
}

function ContainerGroup({ prefix, count, containers, children_, cards }: {
  prefix: string;
  count: number;
  containers: Map<number, InvRow>;
  children_: Map<string, Map<number, InvRow>>;
  cards: Map<number, ItemCard>;
}) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }, (_, i) => {
        const idx = i + 1;
        const slotName = `${prefix}${idx}`;
        const bag = containers.get(idx);
        const contents = children_.get(slotName);
        if (!bag && (!contents || contents.size === 0)) return null;   // hide empty container slots
        const bagCard = bag?.item_id ? cards.get(bag.item_id) : undefined;
        // Bag size: prefer the parent row's slot count (col 5 in /outputfile),
        // fall back to the highest child idx we observed. EQ bags are 4/6/8/10.
        const observedMax = contents ? Math.max(0, ...contents.keys()) : 0;
        const declaredSize = bag?.quantity && bag.quantity >= 4 ? null : null;   // quantity field is item count, not bag size; ignore
        void declaredSize;
        const bagSize = Math.max(observedMax, 10);
        return (
          <details key={slotName} open className="bg-bg/40 border border-border/60 rounded">
            <summary className="cursor-pointer px-2.5 py-1.5 text-xs flex items-center gap-2 hover:bg-bg/60">
              <span className="text-dim w-12">{prefix === 'SharedBank' ? `Shared ${idx}` : `${prefix.charAt(0)}${idx}`}</span>
              {bag ? (
                <ItemHover card={bagCard} fallbackName={bag.item_name} className="text-text">
                  <span>{bag.item_name}</span>
                </ItemHover>
              ) : (
                <span className="text-dim italic">(empty bag slot)</span>
              )}
              {contents && contents.size > 0 && (
                <span className="text-dim text-[10px] ml-auto">{contents.size} item{contents.size === 1 ? '' : 's'}</span>
              )}
            </summary>
            {contents && contents.size > 0 && (
              <div className="px-2.5 py-2 grid grid-cols-3 sm:grid-cols-5 md:grid-cols-8 lg:grid-cols-10 gap-1.5">
                {Array.from({ length: bagSize }, (_, j) => {
                  const childIdx = j + 1;
                  const row = contents.get(childIdx);
                  return <Cell key={childIdx} label={`#${childIdx}`} row={row} card={row?.item_id ? cards.get(row.item_id) : undefined} />;
                })}
              </div>
            )}
          </details>
        );
      })}
    </div>
  );
}

function Cell({ label, row, card }: { label: string; row?: InvRow; card?: ItemCard }) {
  if (!row) {
    return (
      <div className="aspect-square bg-bg/40 border border-border/40 rounded flex items-end p-1">
        <span className="text-[9px] text-dim/60">{label}</span>
      </div>
    );
  }
  // Color hints: gold border for NODROP, blue for MAGIC, default for normal.
  const nodrop = card?.nodrop;
  const magic  = card?.magic;
  const borderClass = nodrop ? 'border-gold/60' : magic ? 'border-blue/60' : 'border-border';
  return (
    <ItemHover card={card} fallbackName={row.item_name} className={`group aspect-square bg-bg border ${borderClass} rounded p-1 flex flex-col items-center justify-between text-center hover:border-blue`}>
      {/* Icon when we have one; the name caption is always present so a missing
          icon (unreachable host / unknown id) still reads. */}
      {card?.icon
        ? <ItemIcon icon={card.icon} alt={row.item_name} size={32} className="mt-0.5" />
        : <span className="text-[10px] leading-tight line-clamp-2 text-text mt-0.5">{row.item_name}</span>}
      <div className="flex items-end justify-between gap-1 w-full">
        <span className="text-[9px] text-dim/70 truncate">{label}</span>
        {row.quantity > 1 && <span className="text-[10px] text-orange font-medium shrink-0">×{row.quantity}</span>}
      </div>
    </ItemHover>
  );
}
