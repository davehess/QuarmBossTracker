'use client';

// Version A: one list across every expansion, soonest first. The per-expansion sections go underneath as `children`.
import { useState, type ReactNode } from 'react';
import { sortNextUp, type NextUpBoss } from '@/lib/boardsNextUpView';
import { BossRow, Card, HeadRow, useNow } from './shared';

export default function NextUpList({
  bosses, nowMs, tick = false, limit = 10, children,
}: { bosses: NextUpBoss[]; nowMs: number; tick?: boolean; limit?: number; children?: ReactNode }) {
  const now = useNow(nowMs, tick);
  const [all, setAll] = useState(false);
  const sorted = sortNextUp(bosses, now);
  const shown = all ? sorted : sorted.slice(0, limit);
  return (
    <div className="space-y-6 font-mono">
      <Card className="overflow-hidden">
        <div className="p-3 sm:p-4"><HeadRow title="Next up" bosses={bosses} now={now} /></div>
        {sorted.length === 0 ? (
          <p className="border-t border-border p-4 text-sm text-text">No boss timers yet. They appear after the next kill is logged.</p>
        ) : (
          <ul className="border-t border-border">{shown.map((b) => <BossRow key={b.id} b={b} now={now} />)}</ul>
        )}
        {sorted.length > limit && (
          <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-sm">
            <span className="text-text">Showing {shown.length} of {sorted.length}</span>
            <button type="button" onClick={() => setAll((v) => !v)} className="min-h-[2.25rem] px-2 text-blue hover:underline">
              {all ? 'Show fewer' : `Show all ${sorted.length}`}
            </button>
          </div>
        )}
      </Card>
      {children ? <div className="space-y-3"><h3 className="text-xs uppercase tracking-wide text-dim">By expansion</h3>{children}</div> : null}
    </div>
  );
}
