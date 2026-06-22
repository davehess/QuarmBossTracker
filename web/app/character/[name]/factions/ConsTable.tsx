'use client';

// Sortable /consider standings table for the faction page. Sort by Observed
// (most recent first) or Standing (best tier first). Each mob links to its
// PQDI npc page; when we've resolved the mob's faction it shows the faction
// name linking to its PQDI faction page, and an "ally" con is flagged as the
// maximum standing. Uilnayar 2026-06-23.

import { useMemo, useState } from 'react';
import type { ConEnriched } from './page';

const STANDING_COLORS: Record<string, string> = {
  ally: 'text-green', warmly: 'text-green', kindly: 'text-green', amiably: 'text-green',
  indifferently: 'text-dim', apprehensively: 'text-orange', dubiously: 'text-orange',
  threateningly: 'text-red', scowls: 'text-red',
};

type SortKey = 'observed' | 'standing';

function fmtDate(ts: string) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ConsTable({ rows, character }: { rows: ConEnriched[]; character: string }) {
  const [sortKey, setSortKey] = useState<SortKey>('standing');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  function toggle(k: SortKey) {
    if (k === sortKey) setDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setDir('desc'); }
  }

  const sorted = useMemo(() => {
    const mul = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === 'observed') return (a.eventTs.localeCompare(b.eventTs)) * mul;
      // standing: higher rank = better; ties broken by most-recent observed
      return (((a.rank ?? -1) - (b.rank ?? -1)) || a.eventTs.localeCompare(b.eventTs)) * mul;
    });
  }, [rows, sortKey, dir]);

  const haveFaction = rows.some(r => r.factionName);

  const Th = ({ k, label }: { k: SortKey; label: string }) => (
    <th
      className="py-1 pr-3 cursor-pointer select-none hover:text-text"
      onClick={() => toggle(k)}
    >
      {label}{sortKey === k ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-dim text-xs text-left">
          <th className="py-1 pr-3">Mob</th>
          {haveFaction && <th className="py-1 pr-3">Faction</th>}
          <Th k="standing" label="Standing" />
          <Th k="observed" label="Observed" />
        </tr>
      </thead>
      <tbody className="divide-y divide-border/50">
        {sorted.map(c => (
          <tr key={c.mob}>
            <td className="py-1.5 pr-3 text-text">
              {c.npcId != null ? (
                <a href={`https://www.pqdi.cc/npc/${c.npcId}`} target="_blank" rel="noreferrer"
                   className="text-text hover:text-blue hover:underline" title="Open this NPC on PQDI">
                  {c.mob} <span className="text-dim text-[10px]">↗</span>
                </a>
              ) : c.mob}
            </td>
            {haveFaction && (
              <td className="py-1.5 pr-3 text-dim">
                {c.factionName ? (
                  c.factionId != null ? (
                    <a href={`https://www.pqdi.cc/faction/${c.factionId}`} target="_blank" rel="noreferrer"
                       className="text-dim hover:text-blue hover:underline" title="Open this faction on PQDI">
                      {c.factionName} <span className="text-dim text-[10px]">↗</span>
                    </a>
                  ) : c.factionName
                ) : <span className="text-dim/50">—</span>}
              </td>
            )}
            <td className={`py-1.5 pr-3 ${STANDING_COLORS[c.standing] ?? 'text-dim'}`}>
              {c.standing}
              {c.isMax && <span className="ml-1.5 text-[10px] tracking-wide px-1.5 py-0.5 rounded bg-green/20 border border-green/50 text-green uppercase" title="Ally is the maximum standing — this faction can't con any higher.">max</span>}
            </td>
            <td className="py-1.5 text-dim text-xs">{fmtDate(c.eventTs)}</td>
          </tr>
        ))}
        {sorted.length === 0 && (
          <tr><td colSpan={haveFaction ? 4 : 3} className="py-3 text-dim text-sm">No non-hostile considers recorded yet for {character}.</td></tr>
        )}
      </tbody>
    </table>
  );
}
