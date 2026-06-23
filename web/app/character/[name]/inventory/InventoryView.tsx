'use client';

// Client-side inventory grid with a view-mode toggle (Uilnayar 2026-06-24:
// "Can the Inventory page get a condensed mode that's just text or a small
// mode that has smaller items?"). Three modes, persisted to localStorage:
//   • Normal — 32px icon boxes
//   • Small  — 20px icon boxes, denser grid
//   • Text   — no icons; a plain name list per container
//
// Per the same feedback: every icon box shows the ITEM NAME at the top of the
// box, and each bag box shows its fullness "used/capacity" in the top-right
// (10/10 = full). Bag capacity is a best-effort estimate — /outputfile's bag
// "Slots" column isn't captured in character_inventory yet, so we round the
// highest filled slot up to the nearest standard EQ bag size (4/6/8/10/…).

import { useEffect, useState } from 'react';
import ItemHover, { type ItemCard } from './ItemHover';
import ItemIcon from './ItemIcon';

export type CellData = {
  label: string;
  name: string | null;        // null = empty slot
  item_id: number | null;
  quantity: number;
  card: ItemCard | null;
};
export type ContainerData = {
  key: string;
  shortLabel: string;
  bagName: string | null;
  bagCard: ItemCard | null;
  used: number;
  capacity: number;
  cells: CellData[];
};
export type ViewData = {
  equipped: CellData[];
  bags: ContainerData[];
  bank: ContainerData[];
  sharedBank: ContainerData[];
};

type Mode = 'normal' | 'small' | 'text';

export default function InventoryView({ data }: { data: ViewData }) {
  const [mode, setMode] = useState<Mode>('normal');
  useEffect(() => {
    const saved = localStorage.getItem('wp-inv-mode');
    if (saved === 'small' || saved === 'text' || saved === 'normal') setMode(saved as Mode);
  }, []);
  const pick = (m: Mode) => { setMode(m); try { localStorage.setItem('wp-inv-mode', m); } catch { /* ignore */ } };

  const bagsUsed   = data.bags.reduce((s, c) => s + c.used, 0);
  const bankUsed   = data.bank.reduce((s, c) => s + c.used, 0);
  const sharedUsed = data.sharedBank.reduce((s, c) => s + c.used, 0);
  const equippedUsed = data.equipped.filter(c => c.name).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-dim">View:</span>
        {(['normal', 'small', 'text'] as Mode[]).map(m => (
          <button key={m} type="button" onClick={() => pick(m)}
            className={`px-2 py-0.5 rounded border ${mode === m ? 'border-blue text-blue bg-blue/10' : 'border-border text-dim hover:text-text'}`}>
            {m === 'normal' ? 'Normal' : m === 'small' ? 'Small' : 'Text'}
          </button>
        ))}
      </div>

      <Section title="Equipped" count={equippedUsed}>
        {mode === 'text'
          ? <TextList cells={data.equipped} />
          : <div className={mode === 'small'
              ? 'grid grid-cols-4 sm:grid-cols-6 md:grid-cols-10 lg:grid-cols-12 gap-1'
              : 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1.5'}>
              {data.equipped.map(c => <Cell key={c.label} c={c} mode={mode} />)}
            </div>}
      </Section>

      <Section title="Bags" count={bagsUsed}>
        <Containers list={data.bags} mode={mode} />
      </Section>

      <Section title="Bank" count={bankUsed}>
        <Containers list={data.bank} mode={mode} />
      </Section>

      <Section title="Shared bank" count={sharedUsed}>
        <p className="text-[11px] text-dim leading-5 mb-2">Shared across every character on the same EQ account.</p>
        <Containers list={data.sharedBank} mode={mode} />
      </Section>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="bg-panel border border-border rounded-lg p-5">
      <h3 className="text-lg text-orange mb-3">{title} <span className="text-dim text-xs font-normal">· {count}</span></h3>
      {children}
    </section>
  );
}

function Containers({ list, mode }: { list: ContainerData[]; mode: Mode }) {
  if (list.length === 0) return <p className="text-sm text-dim italic">Empty.</p>;
  return (
    <div className="space-y-3">
      {list.map(c => {
        const full = c.capacity > 0 && c.used >= c.capacity;
        return (
          <details key={c.key} open className="bg-bg/40 border border-border/60 rounded">
            <summary className="cursor-pointer px-2.5 py-1.5 text-xs flex items-center gap-2 hover:bg-bg/60">
              <span className="text-dim w-14 shrink-0">{c.shortLabel}</span>
              {c.bagName ? (
                <ItemHover card={c.bagCard ?? undefined} fallbackName={c.bagName} className="text-text truncate">
                  <span>{c.bagName}</span>
                </ItemHover>
              ) : (
                <span className="text-dim italic">(empty bag slot)</span>
              )}
              {/* Fullness in the top-right corner — 10/10 = full. */}
              <span className={`ml-auto text-[10px] tabular-nums shrink-0 ${full ? 'text-orange' : 'text-dim'}`}
                    title="Filled slots / estimated bag capacity">
                {c.used}/{c.capacity}
              </span>
            </summary>
            {mode === 'text'
              ? <div className="px-2.5 py-2"><TextList cells={c.cells} /></div>
              : <div className={mode === 'small'
                  ? 'px-2.5 py-2 grid grid-cols-5 sm:grid-cols-8 md:grid-cols-12 lg:grid-cols-16 gap-1'
                  : 'px-2.5 py-2 grid grid-cols-3 sm:grid-cols-5 md:grid-cols-8 lg:grid-cols-10 gap-1.5'}>
                  {c.cells.map((cell, i) => <Cell key={i} c={cell} mode={mode} />)}
                </div>}
          </details>
        );
      })}
    </div>
  );
}

function Cell({ c, mode }: { c: CellData; mode: Mode }) {
  const size = mode === 'small' ? 20 : 32;
  if (!c.name) {
    return (
      <div className="aspect-square bg-bg/40 border border-border/40 rounded flex items-end p-1">
        <span className="text-[8px] text-dim/60 truncate">{c.label}</span>
      </div>
    );
  }
  const nodrop = c.card?.nodrop;
  const magic  = c.card?.magic;
  const borderClass = nodrop ? 'border-gold/60' : magic ? 'border-blue/60' : 'border-border';
  return (
    <ItemHover card={c.card ?? undefined} fallbackName={c.name}
      className={`group aspect-square bg-bg border ${borderClass} rounded p-1 flex flex-col items-center justify-between text-center hover:border-blue overflow-hidden`}>
      {/* Item name at the top of the box (Uilnayar 2026-06-24). */}
      <span className={`${mode === 'small' ? 'text-[7px] leading-[1.1] line-clamp-1' : 'text-[8px] leading-tight line-clamp-2'} text-text w-full`}>
        {c.name}
      </span>
      {c.card?.icon
        ? <ItemIcon icon={c.card.icon} alt={c.name} size={size} />
        : <span className="text-[8px] text-dim/40">—</span>}
      <div className="flex items-end justify-between gap-1 w-full">
        <span className="text-[8px] text-dim/70 truncate">{c.label}</span>
        {c.quantity > 1 && <span className="text-[9px] text-orange font-medium shrink-0">×{c.quantity}</span>}
      </div>
    </ItemHover>
  );
}

// Condensed text list — names only, with qty + slot. Empty slots omitted.
function TextList({ cells }: { cells: CellData[] }) {
  const filled = cells.filter(c => c.name);
  if (filled.length === 0) return <span className="text-xs text-dim italic">empty</span>;
  return (
    <ul className="text-xs columns-1 sm:columns-2 lg:columns-3 gap-x-6">
      {filled.map((c, i) => (
        <li key={i} className="break-inside-avoid flex items-baseline gap-1.5 py-0.5">
          <span className="text-dim/60 text-[10px] w-10 shrink-0 truncate">{c.label}</span>
          <ItemHover card={c.card ?? undefined} fallbackName={c.name!} className="text-text hover:text-blue">
            <span>{c.name}</span>
          </ItemHover>
          {c.quantity > 1 && <span className="text-orange text-[10px]">×{c.quantity}</span>}
        </li>
      ))}
    </ul>
  );
}
