'use client';

// Version A: running timers across every expansion, soonest first. Available bosses fold underneath as a plain list,
// and the per-expansion sections go below that as `children`.
import { useState, type ReactNode } from 'react';
import { splitNextUp, type NextUpBoss } from '@/lib/boardsNextUpView';
import { BossRow, Card, HeadRow, useNow } from './shared';

export default function NextUpList({
  bosses, nowMs, tick = false, limit = 10, children,
}: { bosses: NextUpBoss[]; nowMs: number; tick?: boolean; limit?: number; children?: ReactNode }) {
  const now = useNow(nowMs, tick);
  const [all, setAll] = useState(false);
  const { timers, available } = splitNextUp(bosses, now);
  const shown = all ? timers : timers.slice(0, limit);
  return (
    <div className="space-y-6 font-mono">
      <Card className="overflow-hidden">
        <div className="p-3 sm:p-4"><HeadRow title="Next up" bosses={bosses} now={now} /></div>
        {bosses.length === 0 ? (
          <p className="border-t border-border p-4 text-sm text-text">No boss timers yet. They appear after the next kill is logged.</p>
        ) : timers.length === 0 ? (
          <p className="border-t border-border p-4 text-sm text-text">No timers running. Every boss is available.</p>
        ) : (
          <ul className="border-t border-border">{shown.map((b) => <BossRow key={b.id} b={b} now={now} />)}</ul>
        )}
        {timers.length > limit && (
          <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-sm">
            <span className="text-text">Showing {shown.length} of {timers.length}</span>
            <button type="button" onClick={() => setAll((v) => !v)} className="min-h-[40px] px-2 text-blue hover:underline">
              {all ? 'Show fewer' : `Show all ${timers.length}`}
            </button>
          </div>
        )}
        {available.length > 0 && (
          <details className="border-t border-border">
            <summary className="flex min-h-[40px] cursor-pointer items-center px-3 text-sm font-semibold text-green sm:px-4">Available now ({available.length})</summary>
            <ul className="border-t border-border">
              {available.map((b) => (
                <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-border px-3 py-1.5 text-sm first:border-t-0 sm:px-4">
                  <span className="min-w-0 break-words text-text">{b.name}</span>
                  <span className="min-w-0 break-words text-xs text-text">{b.zone}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
      {children ? <div className="space-y-3"><h3 className="text-xs uppercase tracking-wide text-dim">By expansion</h3>{children}</div> : null}
    </div>
  );
}
