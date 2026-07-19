'use client';

// The July-sprint work board on /roadmap — sortable by phase / complexity /
// focus area. Aspect colors are the SAME six as /platform (PlatformMap tints)
// so the two pages read as one system.

import { useMemo, useState } from 'react';
import { sprintItems, sprintPhases, type SprintAspect, type SprintItem } from '@/lib/roadmapData';

const ASPECT_META: Record<SprintAspect, { label: string; hex: string }> = {
  mimic:   { label: 'miMIC Desktop', hex: '#58a6ff' },
  agent:   { label: 'Logsync Agent', hex: '#56d364' },
  bot:     { label: 'Discord Bot',   hex: '#d29922' },
  web:     { label: 'wolfpack.quest', hex: '#a371f7' },
  data:    { label: 'Data Platform', hex: '#ffa657' },
  liveops: { label: 'Live Ops',      hex: '#f85149' },
};
const ASPECT_ORDER: SprintAspect[] = ['mimic', 'agent', 'bot', 'web', 'data', 'liveops'];

const CX_META: Record<SprintItem['cx'], { label: string; cls: string; rank: number }> = {
  S:      { label: 'S',      cls: 'bg-green/15 text-green border-green/40',   rank: 1 },
  M:      { label: 'M',      cls: 'bg-blue/15 text-blue border-blue/40',      rank: 2 },
  L:      { label: 'L',      cls: 'bg-orange/15 text-orange border-orange/40', rank: 3 },
  XL:     { label: 'XL',     cls: 'bg-red/15 text-red border-red/40',         rank: 4 },
  design: { label: 'design', cls: 'bg-purple/15 text-purple border-purple/40', rank: 0 },
};

type SortKey = 'phase' | 'complexity' | 'number';

export default function SprintBoard() {
  const [sortKey, setSortKey] = useState<SortKey>('phase');
  const [aspect, setAspect] = useState<SprintAspect | null>(null);

  const rows = useMemo(() => {
    const filtered = aspect ? sprintItems.filter((i) => i.aspects.includes(aspect)) : sprintItems;
    const phaseRank = (p: string) => {
      const i = (sprintPhases as readonly string[]).indexOf(p);
      return i === -1 ? 99 : i;
    };
    const numRank = (n: string) => {
      const m = n.match(/\d+/);
      return m ? parseInt(m[0], 10) : -1;
    };
    return [...filtered].sort((a, b) => {
      if (sortKey === 'phase') return phaseRank(a.phase) - phaseRank(b.phase) || numRank(a.num) - numRank(b.num);
      if (sortKey === 'complexity') return CX_META[b.cx].rank - CX_META[a.cx].rank || phaseRank(a.phase) - phaseRank(b.phase);
      return numRank(a.num) - numRank(b.num);
    });
  }, [sortKey, aspect]);

  // Group headers only make sense in phase order.
  let lastPhase = '';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-dim">Sort:</span>
        {(['phase', 'complexity', 'number'] as SortKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setSortKey(k)}
            className={`px-2 py-0.5 rounded border font-mono ${
              sortKey === k ? 'bg-gold/15 text-gold border-gold/40' : 'text-dim border-border hover:text-text'
            }`}
          >
            {k}
          </button>
        ))}
        <span className="text-dim ml-3">Focus:</span>
        {ASPECT_ORDER.map((a) => (
          <button
            key={a}
            onClick={() => setAspect(aspect === a ? null : a)}
            title={ASPECT_META[a].label}
            className={`px-2 py-0.5 rounded border font-mono flex items-center gap-1.5 ${
              aspect === a ? 'text-text border-border bg-panel' : 'text-dim border-border/60 hover:text-text'
            }`}
          >
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: ASPECT_META[a].hex }} />
            {ASPECT_META[a].label.split(' ')[0]}
          </button>
        ))}
        {aspect && (
          <button onClick={() => setAspect(null)} className="text-dim hover:text-text underline">
            clear
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        {rows.map((item) => {
          const showHeader = sortKey === 'phase' && item.phase !== lastPhase;
          lastPhase = item.phase;
          return (
            <div key={item.num + item.title}>
              {showHeader && (
                <div className="text-[11px] uppercase tracking-wide text-orange mt-4 mb-1.5">{item.phase}</div>
              )}
              <div className="flex items-start gap-3 bg-panel/60 border border-border/60 rounded-lg px-3 py-2">
                <span className="text-[10px] font-mono text-dim mt-1 w-10 shrink-0">{item.num}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded border font-mono mt-0.5 shrink-0 ${CX_META[item.cx].cls}`}
                  title="How much of the platform this touched"
                >
                  {CX_META[item.cx].label}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text font-semibold leading-5">{item.title}</div>
                  <div className="text-xs text-dim mt-0.5 leading-5">{item.note}</div>
                </div>
                <div className="flex gap-1 mt-1.5 shrink-0" title={item.aspects.map((a) => ASPECT_META[a].label).join(' · ')}>
                  {item.aspects.map((a) => (
                    <span key={a} className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: ASPECT_META[a].hex }} />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
