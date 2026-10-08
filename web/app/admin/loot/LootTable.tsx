// The looter + item list for /admin/loot: one row per looter and item, with the count and the row total.
//
// The guild lead, 2026-10-08: "it lags out my machine just to open it. Please paginate, and give distinct
// looter+item+count rows instead, and totals for that row." So nothing is sorted or held in the browser: the
// database groups, sorts and pages (loot_value_grouped), each column header is a link to the same page sorted
// by that column, and the pager links step through ?page=. No client JavaScript.

import Link from 'next/link';
import { fmtShort } from '@/lib/timezone-shared';
import { fmtPp } from '@/lib/lootValue';

export type LootGroupRow = {
  looter_character: string;
  item_name: string;
  looted: number;
  dkp_count: number;       // lines of this group that went through DKP: listed, not counted in the total
  unit_cp: number | null;  // NULL when the item name is not in the item database
  total_cp: number;        // unit value x the non-DKP lines
  nodrop: boolean | null;
  zone: string | null;
  last_looted_at: string;
  total_groups: number;
};

// Each sort runs one way: biggest / newest first for numbers and time, A→Z for names.
export const SORTS = ['total', 'unit', 'count', 'recent', 'looter', 'item'] as const;
export type Sort = (typeof SORTS)[number];

export default function LootTable({ rows, tz, sort, href }: {
  rows: LootGroupRow[];
  tz: string;
  sort: Sort;
  href: (q: { sort?: Sort; page?: number }) => string;
}) {
  function th(k: Sort, label: string, right?: boolean) {
    const on = k === sort;
    const asc = k === 'looter' || k === 'item';
    return (
      <th key={k} className={`py-1 pr-3 ${right ? 'text-right' : ''}`} aria-sort={on ? (asc ? 'ascending' : 'descending') : 'none'}>
        <Link href={href({ sort: k, page: 1 })} className={`hover:text-text ${on ? 'text-blue' : ''}`}>
          {label}{on ? (asc ? ' ▲' : ' ▼') : ''}
        </Link>
      </th>
    );
  }

  if (rows.length === 0) return <p className="text-sm text-dim italic">No loot recorded in this window.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-dim text-xs text-left">
            {th('looter', 'Looter')}
            {th('item', 'Item')}
            {th('count', 'Count', true)}
            {th('unit', 'Each (pp)', true)}
            {th('total', 'Total (pp)', true)}
            {th('recent', 'Last looted')}
            <th className="py-1 pr-3">Zone</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rows.map(r => (
            <tr key={`${r.looter_character}|${r.item_name}`} className="hover:bg-[#1a212c]">
              <td className="py-1.5 pr-3 whitespace-nowrap">
                <Link href={`/character/${encodeURIComponent(r.looter_character)}`} className="text-blue hover:underline">{r.looter_character}</Link>
              </td>
              <td className="py-1.5 pr-3 text-text">
                {r.item_name}
                {r.nodrop && <span className="ml-1.5 text-[10px] text-dim border border-border rounded px-1" title="NO DROP">ND</span>}
                {Number(r.dkp_count) > 0 && (
                  <span className="ml-1.5 text-[10px] text-purple border border-purple/60 rounded px-1"
                    title="Went through a DKP auction or award — not counted in the total">
                    DKP{Number(r.dkp_count) < Number(r.looted) ? ` ×${Number(r.dkp_count)}` : ''}
                  </span>
                )}
              </td>
              <td className="py-1.5 pr-3 text-right">{Number(r.looted).toLocaleString()}</td>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap text-dim">{fmtPp(r.unit_cp)}</td>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                <span className={r.unit_cp == null ? 'text-dim/60' : 'text-gold'}>{r.unit_cp == null ? '—' : fmtPp(Number(r.total_cp))}</span>
              </td>
              <td className="py-1.5 pr-3 text-dim whitespace-nowrap">{fmtShort(r.last_looted_at, tz)}</td>
              <td className="py-1.5 pr-3 text-dim text-xs">{r.zone || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
