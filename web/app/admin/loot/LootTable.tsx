'use client';

// Sortable item list for /admin/loot. The rows are fetched on the server (highest value first, capped);
// sorting here only reorders what is already on the page. Value sorts highest first by default, and
// unpriced rows always sink to the bottom whichever way value is sorted.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { fmtShort } from '@/lib/timezone-shared';
import { fmtPp } from '@/lib/lootValue';

export type LootRow = {
  looted_at: string;
  looter_character: string;
  item_name: string;
  zone: string | null;
  value_cp: number | null;
  nodrop: boolean | null;
  dkp?: boolean | null;   // went through a DKP auction or award: listed, not counted in totals
};
type Key = 'value' | 'time' | 'looter' | 'item';
type Dir = 'asc' | 'desc';

// The direction a column starts in when first clicked.
const FIRST_DIR: Record<Key, Dir> = { value: 'desc', time: 'desc', looter: 'asc', item: 'asc' };

function compare(a: LootRow, b: LootRow, key: Key, dir: Dir): number {
  const sign = dir === 'asc' ? 1 : -1;
  if (key === 'value') {
    if (a.value_cp == null && b.value_cp == null) return 0;
    if (a.value_cp == null) return 1;
    if (b.value_cp == null) return -1;
    return (a.value_cp - b.value_cp) * sign;
  }
  if (key === 'time') return (Date.parse(a.looted_at) - Date.parse(b.looted_at)) * sign;
  const x = key === 'looter' ? a.looter_character : a.item_name;
  const y = key === 'looter' ? b.looter_character : b.item_name;
  return x.localeCompare(y, undefined, { sensitivity: 'base' }) * sign;
}

export default function LootTable({ rows, tz }: { rows: LootRow[]; tz: string }) {
  const [key, setKey] = useState<Key>('value');
  const [dir, setDir] = useState<Dir>('desc');

  const sorted = useMemo(() => {
    // Ties fall back to newest first so the order is stable between clicks.
    return [...rows].sort((a, b) => compare(a, b, key, dir) || Date.parse(b.looted_at) - Date.parse(a.looted_at));
  }, [rows, key, dir]);

  function pick(k: Key) {
    if (k === key) setDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setKey(k); setDir(FIRST_DIR[k]); }
  }

  function th(k: Key, label: string, right?: boolean) {
    const on = k === key;
    return (
      <th key={k} className={`py-1 pr-3 ${right ? 'text-right' : ''}`} aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" onClick={() => pick(k)}
          className={`hover:text-text ${on ? 'text-blue' : ''}`}>
          {label}{on ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
        </button>
      </th>
    );
  }

  if (rows.length === 0) return <p className="text-sm text-dim italic">No loot recorded in this window.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-dim text-xs text-left">
            {th('time', 'Time')}
            {th('looter', 'Looter')}
            {th('item', 'Item')}
            <th className="py-1 pr-3">Zone</th>
            {th('value', 'Value (pp)', true)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {sorted.map((r, i) => (
            <tr key={`${r.looter_character}|${r.item_name}|${r.looted_at}|${i}`} className="hover:bg-[#1a212c]">
              <td className="py-1.5 pr-3 text-dim whitespace-nowrap">{fmtShort(r.looted_at, tz)}</td>
              <td className="py-1.5 pr-3 whitespace-nowrap">
                <Link href={`/character/${encodeURIComponent(r.looter_character)}`} className="text-blue hover:underline">{r.looter_character}</Link>
              </td>
              <td className="py-1.5 pr-3 text-text">{r.item_name}</td>
              <td className="py-1.5 pr-3 text-dim text-xs">{r.zone || '—'}</td>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                <span className={r.value_cp == null ? 'text-dim/60' : 'text-gold'}>{fmtPp(r.value_cp)}</span>
                {r.nodrop && <span className="ml-1.5 text-[10px] text-dim border border-border rounded px-1" title="NO DROP">ND</span>}
                {r.dkp && <span className="ml-1.5 text-[10px] text-purple border border-purple/60 rounded px-1" title="Went through a DKP auction or award — not counted in totals">DKP</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
