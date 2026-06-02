// LootBrowser — interactive loot table for /character/[name].
//
// The server hydrates EVERY loot row the character has won (no row cap), with
// category + era already classified. This component handles the UI state:
// expansion + category filters, DKP/date sort with direction, and incremental
// "+ more" pagination with a "show all" escape hatch. Pure client state — no
// network round-trips while the user filters.
'use client';

import { useMemo, useState } from 'react';
import { fmtDkp } from '@/lib/format';
import type { EraName } from '@/lib/eras';

export type LootCategory = 'weapon' | 'armor' | 'quest' | 'other';

export type LootEntry = {
  item_name: string;
  game_item_id: number | null;
  dkp: number;
  raid_name: string;
  raid_date: string;
  category: LootCategory;
  era: EraName | null;
};

// Display order matches game era progression so the filter dropdown reads left
// to right the way players think about content. 'Unknown' covers loot dated
// before our era table started.
const ERA_ORDER: (EraName | 'Unknown')[] = ['Classic', 'Kunark', 'Velious', 'Luclin', 'PoP', 'Unknown'];
const CATEGORY_LABEL: Record<LootCategory, string> = {
  weapon: 'Weapons',
  armor:  'Armor',
  quest:  'Quest / Misc',
  other:  'Other',
};

const PAGE_SIZE = 30;

type SortKey   = 'date' | 'dkp';
type SortDir   = 'desc' | 'asc';

export default function LootBrowser({ loot }: { loot: LootEntry[] }) {
  const [eraFilter, setEraFilter] = useState<EraName | 'Unknown' | 'all'>('all');
  const [catFilter, setCatFilter] = useState<LootCategory | 'all'>('all');
  const [sortKey,   setSortKey]   = useState<SortKey>('date');
  const [sortDir,   setSortDir]   = useState<SortDir>('desc');
  const [visible,   setVisible]   = useState<number>(PAGE_SIZE);

  // Restrict the era + category dropdowns to values actually present in this
  // character's loot — no point offering 'PoP' if they have none. Built once;
  // doesn't shrink as the user filters (would be confusing).
  const eraOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const l of loot) seen.add(l.era || 'Unknown');
    return ERA_ORDER.filter(e => seen.has(e));
  }, [loot]);
  const catOptions = useMemo(() => {
    const seen = new Set<LootCategory>();
    for (const l of loot) seen.add(l.category);
    return (Object.keys(CATEGORY_LABEL) as LootCategory[]).filter(c => seen.has(c));
  }, [loot]);

  const filtered = useMemo(() => {
    const out: LootEntry[] = [];
    for (const l of loot) {
      if (eraFilter !== 'all' && (l.era || 'Unknown') !== eraFilter) continue;
      if (catFilter !== 'all' && l.category !== catFilter) continue;
      out.push(l);
    }
    out.sort((a, b) => {
      let cmp: number;
      if (sortKey === 'dkp') {
        cmp = (a.dkp || 0) - (b.dkp || 0);
      } else {
        cmp = new Date(a.raid_date).getTime() - new Date(b.raid_date).getTime();
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return out;
  }, [loot, eraFilter, catFilter, sortKey, sortDir]);

  // Reset the paging window whenever the result set changes so we don't strand
  // the user 200 rows deep into a 12-row filtered list.
  const totalDkp = useMemo(() => filtered.reduce((s, l) => s + (l.dkp || 0), 0), [filtered]);
  const shown = filtered.slice(0, visible);
  const hidden = Math.max(0, filtered.length - visible);

  function resetVisible() { setVisible(PAGE_SIZE); }

  const headerCount = filtered.length === loot.length
    ? `${loot.length} item${loot.length === 1 ? '' : 's'}, ${totalDkp} DKP`
    : `${filtered.length} of ${loot.length} item${loot.length === 1 ? '' : 's'}, ${totalDkp} DKP shown`;

  return (
    <section className="bg-panel border border-border rounded-lg p-4">
      <h3 className="text-sm text-gold mb-3 flex items-center gap-2 flex-wrap">
        <span aria-hidden>💰</span>
        <span>Loot won</span>
        <span className="text-dim text-xs">· {headerCount}</span>
      </h3>

      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <label className="flex items-center gap-1 text-dim">
          <span>Era:</span>
          <select
            value={eraFilter}
            onChange={e => { setEraFilter(e.target.value as typeof eraFilter); resetVisible(); }}
            className="bg-bg border border-border rounded px-2 py-0.5 text-text"
          >
            <option value="all">All</option>
            {eraOptions.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </label>

        <label className="flex items-center gap-1 text-dim">
          <span>Type:</span>
          <select
            value={catFilter}
            onChange={e => { setCatFilter(e.target.value as typeof catFilter); resetVisible(); }}
            className="bg-bg border border-border rounded px-2 py-0.5 text-text"
          >
            <option value="all">All</option>
            {catOptions.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </label>

        <label className="flex items-center gap-1 text-dim ml-2">
          <span>Sort:</span>
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            className="bg-bg border border-border rounded px-2 py-0.5 text-text"
          >
            <option value="date">Date</option>
            <option value="dkp">DKP</option>
          </select>
          <button
            type="button"
            onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
            title={sortDir === 'desc' ? 'Descending — click for ascending' : 'Ascending — click for descending'}
            className="border border-border rounded px-1.5 py-0.5 text-text hover:text-blue"
          >
            {sortDir === 'desc' ? '↓' : '↑'}
          </button>
        </label>

        {(eraFilter !== 'all' || catFilter !== 'all') && (
          <button
            type="button"
            onClick={() => { setEraFilter('all'); setCatFilter('all'); resetVisible(); }}
            className="ml-auto text-dim hover:text-blue underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="text-dim text-xs py-2">No loot matches the current filters.</div>
      ) : (
        <ul className="text-xs grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
          {shown.map((l, i) => {
            // Item name → PQDI item page; DKP amount → OpenDKP bidding results
            // for that item across all bidders. Both keyed on the same game item
            // id (PQDI /item/<id>, OpenDKP /#/items/<id>).
            const pqdiHref   = l.game_item_id ? `https://www.pqdi.cc/item/${l.game_item_id}` : null;
            const opendkpHref = l.game_item_id ? `https://wolfpack.opendkp.com/#/items/${l.game_item_id}` : null;
            return (
              <li key={`${l.item_name}-${l.raid_date}-${i}`} className="flex justify-between gap-2 border-b border-border/40 py-0.5">
                <span className="truncate">
                  {pqdiHref ? (
                    <a href={pqdiHref} target="_blank" rel="noreferrer" className="text-text hover:text-blue hover:underline">{l.item_name}</a>
                  ) : (
                    <span className="text-text">{l.item_name}</span>
                  )}
                  <span className="text-dim ml-2">{new Date(l.raid_date).toLocaleDateString()}</span>
                </span>
                {opendkpHref ? (
                  <a
                    href={opendkpHref}
                    target="_blank"
                    rel="noreferrer"
                    title="Bidding results for this item on OpenDKP"
                    className="text-gold whitespace-nowrap hover:underline"
                  >
                    {fmtDkp(l.dkp)}
                  </a>
                ) : (
                  <span className="text-gold whitespace-nowrap">{fmtDkp(l.dkp)}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hidden > 0 && (
        <div className="flex items-center gap-3 mt-3 text-xs">
          <button
            type="button"
            onClick={() => setVisible(v => v + PAGE_SIZE)}
            className="border border-border rounded px-3 py-1 text-text hover:text-blue hover:border-blue"
          >
            + {Math.min(PAGE_SIZE, hidden)} more
          </button>
          <button
            type="button"
            onClick={() => setVisible(filtered.length)}
            className="border border-border rounded px-3 py-1 text-dim hover:text-blue hover:border-blue"
          >
            Show all ({hidden} hidden)
          </button>
        </div>
      )}
    </section>
  );
}
