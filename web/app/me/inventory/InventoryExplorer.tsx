'use client';

// Account-wide inventory explorer. All aggregation is done server-side; this
// handles the interactive filtering: category chips, per-character include/
// exclude, per-location include/exclude (equipped / bags / bank / shared bank),
// and a name search. Item totals recompute against the enabled char+location
// set so counts always reflect the current filter.

import { useMemo, useState } from 'react';

export type LocGroup = 'equipped' | 'bags' | 'bank' | 'shared';
export type Holding = { character: string; location: LocGroup; qty: number };
export type InvItem = {
  key: string;
  item_id: number | null;
  name: string;
  total: number;
  tags: string[];
  holdings: Holding[];
};

const CATEGORIES: { key: string; label: string }[] = [
  { key: 'weapon', label: 'Weapon' },
  { key: 'armor', label: 'Armor' },
  { key: 'tradeskill', label: 'Tradeskill' },
  { key: 'nodrop', label: 'No-Drop' },
  { key: 'spell', label: 'Spell' },
];
const LOCATIONS: { key: LocGroup; label: string; icon: string }[] = [
  { key: 'equipped', label: 'Equipped', icon: '🗡' },
  { key: 'bags', label: 'Bags', icon: '🎒' },
  { key: 'bank', label: 'Bank', icon: '🏛' },
  { key: 'shared', label: 'Shared bank', icon: '🏦' },
];
const LOC_TAG: Record<LocGroup, { short: string; cls: string }> = {
  equipped: { short: 'equipped', cls: 'text-blue' },
  bags:     { short: 'bags',     cls: 'text-dim' },
  bank:     { short: 'bank',     cls: 'text-orange' },
  shared:   { short: 'shared bank', cls: 'text-purple' },
};

export default function InventoryExplorer(
  { items, characters }: { items: InvItem[]; characters: { name: string; cls: string | null; active: boolean }[] },
) {
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [offChars, setOffChars] = useState<Set<string>>(new Set());
  const [offLocs, setOffLocs] = useState<Set<LocGroup>>(new Set());
  const [q, setQ] = useState('');

  const toggle = <T,>(set: Set<T>, v: T): Set<T> => {
    const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); return n;
  };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out: { it: InvItem; shownTotal: number; holds: Holding[]; hasShared: boolean }[] = [];
    for (const it of items) {
      if (cats.size > 0 && !it.tags.some(t => cats.has(t))) continue;
      if (needle && !it.name.toLowerCase().includes(needle)) continue;
      const holds = it.holdings.filter(h => !offChars.has(h.character) && !offLocs.has(h.location));
      if (holds.length === 0) continue;
      const shownTotal = holds.reduce((n, h) => n + h.qty, 0);
      out.push({ it, shownTotal, holds, hasShared: holds.some(h => h.location === 'shared') });
    }
    out.sort((a, b) => b.shownTotal - a.shownTotal || a.it.name.localeCompare(b.it.name));
    return out;
  }, [items, cats, offChars, offLocs, q]);

  const shownItems = rows.length;
  const shownUnits = rows.reduce((n, r) => n + r.shownTotal, 0);

  const chip = (on: boolean) =>
    `px-2 py-0.5 rounded border text-[11px] transition-colors ${on ? 'border-gold text-gold' : 'border-border text-dim hover:text-text'}`;

  return (
    <div className="space-y-4">
      <section className="bg-panel border border-border rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-dim w-16">Type</span>
          {CATEGORIES.map(c => (
            <button key={c.key} type="button" className={chip(cats.has(c.key))}
              onClick={() => setCats(s => toggle(s, c.key))}>{c.label}</button>
          ))}
          {cats.size > 0 && <button type="button" className="text-[11px] text-blue hover:underline" onClick={() => setCats(new Set())}>clear</button>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-dim w-16">Where</span>
          {LOCATIONS.map(l => (
            <button key={l.key} type="button" className={chip(!offLocs.has(l.key))}
              onClick={() => setOffLocs(s => toggle(s, l.key))}>{l.icon} {l.label}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-dim w-16">Characters</span>
          {characters.map(c => (
            <button key={c.name} type="button" className={chip(!offChars.has(c.name))}
              onClick={() => setOffChars(s => toggle(s, c.name))}
              title={c.cls || undefined}>
              {c.name}{!c.active && <span className="opacity-50"> ·</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search item name…"
            className="flex-1 max-w-sm bg-bg border border-border rounded px-2 py-1 text-sm" />
          <span className="text-xs text-dim">{shownItems.toLocaleString()} items · {shownUnits.toLocaleString()} total</span>
        </div>
      </section>

      <section className="bg-panel border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-dim text-xs text-left border-b border-border">
              <th className="py-2 px-3">Item</th>
              <th className="py-2 px-2 text-right w-16">Qty</th>
              <th className="py-2 px-3">Who has it</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {rows.map(({ it, shownTotal, holds, hasShared }) => (
              <tr key={it.key} className="hover:bg-[#1a212c]">
                <td className="py-1.5 px-3">
                  {it.item_id
                    ? <a href={`https://pqdi.cc/item/${it.item_id}`} target="_blank" rel="noreferrer" className="text-text hover:text-blue hover:underline">{it.name}</a>
                    : <span className="text-text">{it.name}</span>}
                  {hasShared && <span className="ml-1.5 text-[10px] text-purple" title="In your shared bank — any of your characters can pull it">🏦 shared</span>}
                  {it.tags.filter(t => t !== 'nodrop').slice(0, 1).map(t => (
                    <span key={t} className="ml-1.5 text-[9px] uppercase tracking-wide text-dim">{t}</span>
                  ))}
                  {it.tags.includes('nodrop') && <span className="ml-1 text-[9px] uppercase tracking-wide text-red-400">no-drop</span>}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums text-text">{shownTotal}</td>
                <td className="py-1.5 px-3 text-xs">
                  {holds
                    .sort((a, b) => b.qty - a.qty || a.character.localeCompare(b.character))
                    .map((h, i) => (
                      <span key={h.character + h.location}>
                        {i > 0 && <span className="text-dim"> · </span>}
                        <span className="text-text">{h.character}</span>
                        <span className="text-dim"> ×{h.qty} </span>
                        <span className={LOC_TAG[h.location].cls}>({LOC_TAG[h.location].short})</span>
                      </span>
                    ))}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={3} className="py-4 px-3 text-dim italic text-sm">Nothing matches the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
