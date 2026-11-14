'use client';

// Pieces the three boards drafts share: the clock, the heading row, and one boss row.
import { useEffect, useState, type ReactNode } from 'react';
import { fmtRemaining } from '@/app/boards/ticker';
import { isSoon, isUp, summarize, type NextUpBoss } from '@/lib/boardsNextUpView';

/** The current time. Starts at the server's `nowMs` (so server and browser render the same), then ticks if asked. */
export function useNow(nowMs: number, tick: boolean): number {
  const [now, setNow] = useState(nowMs);
  useEffect(() => {
    if (!tick) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [tick]);
  return now;
}

export const toneOf = (b: NextUpBoss, now: number): string =>
  isUp(b, now) ? 'text-green' : isSoon(b, now) ? 'text-orange' : 'text-text';

export const countdownText = (b: NextUpBoss, now: number): string =>
  isUp(b, now) ? 'Up now' : fmtRemaining((b.opensAtMs as number) - now);

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`bg-panel border border-border rounded-lg ${className}`}>{children}</section>;
}

/** Title with the two numbers that matter: how many are up and how many are about to be. */
export function HeadRow({ title, bosses, now, right }: { title: string; bosses: NextUpBoss[]; now: number; right?: ReactNode }) {
  const s = summarize(bosses, now);
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span className={s.up ? 'text-green' : 'text-text'}><b className="text-xl tabular-nums">{s.up}</b> available now</span>
        <span className={s.soon ? 'text-orange' : 'text-text'}><b className="text-xl tabular-nums">{s.soon}</b> within 30m</span>
        {right}
      </div>
    </div>
  );
}

export function BossName({ b, className = '' }: { b: NextUpBoss; className?: string }) {
  return b.url
    ? <a href={b.url} target="_blank" rel="noreferrer" className={`text-text hover:underline ${className}`}>{b.name}</a>
    : <span className={`text-text ${className}`}>{b.name}</span>;
}

/** One boss: countdown first and biggest, then the name and where it is. `action` is an optional right-hand control. */
export function BossRow({ b, now, action }: { b: NextUpBoss; now: number; action?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 border-t border-border px-3 py-2 first:border-t-0 min-h-[3.25rem]">
      <div className={`w-32 shrink-0 text-xl font-bold tabular-nums ${toneOf(b, now)}`}>{countdownText(b, now)}</div>
      <div className="min-w-0 flex-1">
        <BossName b={b} className="block break-words text-sm leading-snug" />
        <div className="break-words text-xs text-text">{b.zone} · {b.expansion}</div>
      </div>
      {action}
    </li>
  );
}
