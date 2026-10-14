// /admin/loot — what the raid has looted, highest value first.
//
// The guild lead, 2026-10-08: "make an admin page with loot, sortable by highest value. note at the
// top that who looted it is not always the person that ends up with it."
//
// The rows are `looted_items`: one "You have looted" line per raider's Mimic, each seen by the looter
// themselves. So the looter is whoever picked the item up, which is often not who keeps it (master
// looter, corpse runs, trades). The page says so at the top and does not pretend otherwise.
//
// Value is eqemu_items.price (base merchant value, copper) joined by exact name inside the RPCs
// (migration 20261008190000_loot_value_grouped.sql): the totals-by-character table is computed over EVERY
// row in the window; the list below it is one row per looter + item (count, each, row total), grouped,
// sorted and paged in the database, PAGE_SIZE rows at a time. The guild lead, 2026-10-08: the 1,000-row
// list "lags out my machine just to open it. Please paginate, and give distinct looter+item+count rows".
//
// A new route, so it carries the [beta] tag (DECISIONS §135). Officer only: the /admin layout checks,
// and so does the page itself (test/admin-pages-officer-gate.test.js).

import Link from 'next/link';
import NewPageTag from '@/components/NewPageTag';
import { supabaseAdmin } from '@/lib/supabase';
import { requireOfficer } from '@/lib/officer';
import { userTz } from '@/lib/timezone';
import { fmtPp } from '@/lib/lootValue';
import { GUILD_TAG } from '@/lib/guild';
import LootTable, { SORTS, type Sort, type LootGroupRow } from './LootTable';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: '[beta] Loot by value — Wolf Pack admin',
  description: 'What the raid has looted, ranked by value, over a day, a week or longer.',
};

const WINDOWS = [
  { label: '24h', days: 1 },
  { label: '7d',  days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];
const DEFAULT_DAYS = 7;
// One page of looter + item rows. The function caps a page at 200 itself.
const PAGE_SIZE = 50;
// The by-character table is one row per looter (~135 in 90 days); the API returns at most 1,000 rows per
// response (PostgREST max-rows), so it asks for that range explicitly.
const LOOTER_LIMIT = 1000;

type LooterRow = {
  looter_character: string;
  items: number;
  value_cp: number;
  nodrop_items: number;
  dkp_items: number;
  top_item: string | null;
};

// Only the allowed windows get through; anything else (missing, junk, 3650) is the default.
function clampDays(raw: string | undefined): number {
  const n = Number(raw);
  return WINDOWS.some(w => w.days === n) ? n : DEFAULT_DAYS;
}
function clampSort(raw: string | undefined): Sort {
  return (SORTS as readonly string[]).includes(raw ?? '') ? (raw as Sort) : 'total';
}
function clampPage(raw: string | undefined): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 10000) : 1;
}

export default async function AdminLootPage({ searchParams }: { searchParams: Promise<{ days?: string; sort?: string; page?: string }> }) {
  await requireOfficer();
  const { days: rawDays, sort: rawSort, page: rawPage } = await searchParams;
  const days = clampDays(rawDays);
  const sort = clampSort(rawSort);
  const pageNo = clampPage(rawPage);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const sb = supabaseAdmin();
  const tz = await userTz();
  const [itemsRes, looterRes] = await Promise.all([
    // DKP items are listed but left out of every total (the guild lead, 2026-10-08: "If something has a DKP
    // bid associated with it, don't count that in the totals").
    sb.rpc('loot_value_grouped', {
      p_guild_id: GUILD_TAG, p_since: since, p_sort: sort, p_limit: PAGE_SIZE, p_offset: (pageNo - 1) * PAGE_SIZE,
    }).range(0, PAGE_SIZE - 1),
    sb.rpc('loot_value_by_looter_v3', { p_guild_id: GUILD_TAG, p_since: since }).range(0, LOOTER_LIMIT - 1),
  ]);
  const items = (itemsRes.data ?? []) as LootGroupRow[];
  const looters = (looterRes.data ?? []) as LooterRow[];
  const error = itemsRes.error || looterRes.error;
  const totalGroups = items.length ? Number(items[0].total_groups) : 0;
  const pages = Math.max(1, Math.ceil(totalGroups / PAGE_SIZE));
  const href = (q: { sort?: Sort; page?: number }) => {
    const s = q.sort ?? sort, p = q.page ?? pageNo;
    return `/admin/loot?days=${days}${s !== 'total' ? `&sort=${s}` : ''}${p > 1 ? `&page=${p}` : ''}`;
  };

  const totalItems = looters.reduce((n, l) => n + Number(l.items), 0);
  const totalDkp = looters.reduce((n, l) => n + Number(l.dkp_items || 0), 0);
  const totalCp = looters.reduce((n, l) => n + Number(l.value_cp), 0);
  const windowLabel = WINDOWS.find(w => w.days === days)!.label;

  return (
    <div className="space-y-6">
      <NewPageTag />
      <div className="text-sm"><Link href="/admin" className="text-blue hover:underline">← back to admin</Link></div>

      <section className="bg-panel border border-border rounded-lg p-4 sm:p-6">
        <div className="flex items-baseline justify-between gap-4 flex-wrap mb-2">
          <h1 className="text-xl text-gold">💰 Loot by value</h1>
          <div className="flex items-center gap-1 text-xs">
            {WINDOWS.map(w => (
              <Link key={w.label}
                href={`/admin/loot?days=${w.days}${sort !== 'total' ? `&sort=${sort}` : ''}`}
                className={`px-2 py-0.5 rounded border ${w.days === days ? 'border-blue text-blue bg-blue/10' : 'border-border text-dim hover:text-text'}`}>
                {w.label}
              </Link>
            ))}
          </div>
        </div>
        <p role="note" className="text-sm text-orange leading-6 border-l-2 border-orange/60 pl-3">
          Who looted an item is not always who ends up with it. Items are often looted by one raider and
          handed to another (master looter, corpse runs, trades). These rows are the &ldquo;You have
          looted&rdquo; lines each raider&rsquo;s Mimic saw. Gear a charmer hands to a charmed pet (negative
          magic resist, plus a short officer list) is not counted as loot, and neither is gear a charmer
          loots back from their own pet&rsquo;s corpse.
        </p>
        <p className="text-xs text-dim leading-5 mt-3">
          Last <span className="text-text">{windowLabel}</span>:{' '}
          <span className="text-text">{totalItems.toLocaleString()}</span> items looted, worth{' '}
          <span className="text-gold">{fmtPp(totalCp)} pp</span> in base value
          {totalDkp > 0 && <> (not counting the <span className="text-text">{totalDkp.toLocaleString()}</span> that went through DKP)</>}.
        </p>
        {error && <p className="text-xs text-red mt-3">⚠ {error.message}</p>}
      </section>

      <section className="bg-panel border border-border rounded-lg p-4 sm:p-5">
        <h2 className="text-sm text-orange mb-3">By character ({looters.length})</h2>
        {looters.length === 0 ? (
          <p className="text-sm text-dim italic">No loot recorded in this window.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-dim text-xs text-left">
                  <th className="py-1 pr-3">Character</th>
                  <th className="py-1 pr-3 text-right">Items</th>
                  <th className="py-1 pr-3 text-right">Value (pp)</th>
                  <th className="py-1 pr-3 text-right">NO DROP</th>
                  <th className="py-1 pr-3 text-right" title="Items that went through a DKP auction or award. Not counted in Value.">DKP</th>
                  <th className="py-1 pr-3">Most valuable item</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {looters.map(l => (
                  <tr key={l.looter_character} className="hover:bg-[#1a212c]">
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      <Link href={`/character/${encodeURIComponent(l.looter_character)}`} className="text-blue hover:underline">{l.looter_character}</Link>
                    </td>
                    <td className="py-1.5 pr-3 text-right">{Number(l.items).toLocaleString()}</td>
                    <td className="py-1.5 pr-3 text-right text-gold whitespace-nowrap">{fmtPp(Number(l.value_cp))}</td>
                    <td className="py-1.5 pr-3 text-right text-dim">{Number(l.nodrop_items).toLocaleString()}</td>
                    <td className="py-1.5 pr-3 text-right text-dim">{Number(l.dkp_items || 0).toLocaleString()}</td>
                    <td className="py-1.5 pr-3 text-text">{l.top_item || <span className="text-dim/60">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-panel border border-border rounded-lg p-4 sm:p-5">
        <h2 className="text-sm text-orange mb-1">By looter and item ({totalGroups.toLocaleString()})</h2>
        <p className="text-xs text-dim mb-3">
          One row per looter and item: how many they looted, the value of one, and the row total. Click a column
          to sort by it.
        </p>
        <LootTable rows={items} tz={tz} sort={sort} href={href} />
        {(pages > 1 || pageNo > 1) && (
          <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-xs mt-3">
            {pageNo > 1
              ? <Link href={href({ page: pageNo - 1 })} className="px-2 py-0.5 rounded border border-border text-blue hover:bg-blue/10">← Previous</Link>
              : <span />}
            <span className="text-dim">Page {pageNo.toLocaleString()} of {pages.toLocaleString()}</span>
            {pageNo < pages
              ? <Link href={href({ page: pageNo + 1 })} className="px-2 py-0.5 rounded border border-border text-blue hover:bg-blue/10">Next →</Link>
              : pageNo > pages
                ? <Link href={href({ page: 1 })} className="px-2 py-0.5 rounded border border-border text-blue hover:bg-blue/10">First page</Link>
                : <span />}
          </nav>
        )}
        <p className="text-xs text-dim leading-5 mt-4">
          Values are each item&rsquo;s base merchant value from the item database, not bazaar prices. A dash
          means the item name is not in the database. <span className="border border-border rounded px-1 text-[10px]">ND</span>{' '}
          marks a NO DROP item. <span className="border border-purple/60 text-purple rounded px-1 text-[10px]">DKP</span>{' '}
          marks an item that went through a DKP auction or award near the time it was looted (×N when only some of
          the row did); those are listed but not counted in any total.
        </p>
      </section>
    </div>
  );
}
