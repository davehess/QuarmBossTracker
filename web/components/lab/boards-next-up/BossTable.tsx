'use client';

// Version C: one dense sortable table. Click a header to sort; the window column drops out at phone width.
import { useState } from 'react';
import { fmtWindow, sortNextUp, type NextUpBoss } from '@/lib/boardsNextUpView';
import { BossName, Card, HeadRow, countdownText, toneOf, useNow } from './shared';

type Col = 'name' | 'zone' | 'opens' | 'window';

export default function BossTable({ bosses, nowMs, tick = false }: { bosses: NextUpBoss[]; nowMs: number; tick?: boolean }) {
  const now = useNow(nowMs, tick);
  const [col, setCol] = useState<Col>('opens');
  const [dir, setDir] = useState<1 | -1>(1);
  const sortBy = (c: Col) => { if (c === col) setDir((d) => (d === 1 ? -1 : 1)); else { setCol(c); setDir(1); } };

  const base = sortNextUp(bosses, now);
  const rows = col === 'opens'
    ? (dir === 1 ? base : [...base].reverse())
    : [...base].sort((a, b) => {
        const r = col === 'name' ? a.name.localeCompare(b.name, 'en')
          : col === 'zone' ? a.zone.localeCompare(b.zone, 'en')
          : (a.timerHours ?? 0) - (b.timerHours ?? 0);
        return r * dir;
      });

  const th = (c: Col, label: string, cls = '') => (
    <th scope="col" aria-sort={col === c ? (dir === 1 ? 'ascending' : 'descending') : 'none'} className={`sticky top-0 z-10 bg-panel border-b border-border p-0 text-left ${cls}`}>
      <button type="button" onClick={() => sortBy(c)} className={`flex min-h-[2.5rem] w-full items-center gap-1 px-3 text-xs uppercase tracking-wide hover:text-text ${col === c ? 'text-gold' : 'text-dim'}`}>
        {label}<span aria-hidden>{col === c ? (dir === 1 ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );

  return (
    <div className="space-y-4 font-mono">
      <Card className="p-3 sm:p-4"><HeadRow title="Spawn table" bosses={bosses} now={now} right={<span className="text-xs text-text">{bosses.length} bosses</span>} /></Card>
      <Card>
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-text">No boss timers yet. They appear after the next kill is logged.</p>
        ) : (
          <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {th('name', 'Boss')}
                {th('zone', 'Zone', 'hidden sm:table-cell sm:w-[26%]')}
                {th('opens', 'Opens in', 'w-[9rem]')}
                {th('window', 'Window', 'hidden sm:table-cell w-[5.5rem]')}
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="hover:bg-bg">
                  <td className="border-b border-border/60 px-3 py-1.5 align-top leading-snug break-words"><BossName b={b} /><div className="break-words text-xs text-text sm:hidden">{b.zone}</div></td>
                  <td className="hidden border-b border-border/60 px-3 py-1.5 align-top text-xs text-text sm:table-cell">{b.zone}</td>
                  <td className={`border-b border-border/60 px-3 py-1.5 align-top text-base font-bold tabular-nums ${toneOf(b, now)}`}>{countdownText(b, now)}</td>
                  <td className="hidden border-b border-border/60 px-3 py-1.5 align-top text-xs text-text sm:table-cell">{fmtWindow(b.timerHours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
