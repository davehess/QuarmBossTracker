'use client';

// Version B: a sticky filter box and a pin per boss, remembered in this browser. First visit pins the five that
// open soonest, so the page is useful before anyone has pinned anything.
import { useEffect, useState } from 'react';
import { matchesQuery, sortNextUp, type NextUpBoss } from '@/lib/boardsNextUpView';
import { BossRow, Card, HeadRow, useNow } from './shared';

const KEY = 'wp.boards.pins';
const SEED = 5;

export default function WatchList({ bosses, nowMs, tick = false }: { bosses: NextUpBoss[]; nowMs: number; tick?: boolean }) {
  const now = useNow(nowMs, tick);
  const [q, setQ] = useState('');
  const [stored, setStored] = useState<string[] | null>(null);
  const sorted = sortNextUp(bosses, now);
  const seed = sorted.slice(0, SEED).map((b) => b.id);
  const pins = stored ?? seed;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) setStored(parsed.filter((x) => typeof x === 'string'));
      else window.localStorage.setItem(KEY, JSON.stringify(seed));
    } catch { /* private mode: pins last for this visit only */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string) => {
    const next = pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id];
    setStored(next);
    try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const hit = sorted.filter((b) => matchesQuery(b, q));
  const pinned = hit.filter((b) => pins.includes(b.id));
  const rest = hit.filter((b) => !pins.includes(b.id));
  const pinBtn = (b: NextUpBoss) => {
    const on = pins.includes(b.id);
    return (
      <button
        type="button" onClick={() => toggle(b.id)} aria-pressed={on}
        className={`min-h-[2.5rem] shrink-0 rounded border px-2 text-xs ${on ? 'border-gold text-gold' : 'border-border text-blue hover:border-blue'}`}
      >{on ? 'Pinned' : 'Pin'}</button>
    );
  };

  return (
    <div className="space-y-4 font-mono">
      <div className="sticky top-0 z-10 -mx-1 bg-bg px-1 py-2">
        <Card className="p-3 sm:p-4">
          <HeadRow title="Watch list" bosses={bosses} now={now} />
          <div className="mt-3 flex items-center gap-2">
            <input
              type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a boss or zone"
              aria-label="Find a boss or zone"
              className="min-h-[2.5rem] w-full rounded border border-border bg-bg px-3 text-sm text-text placeholder:text-dim focus:border-blue focus:outline-none"
            />
            {q && <button type="button" onClick={() => setQ('')} className="min-h-[2.5rem] shrink-0 px-2 text-sm text-blue hover:underline">Clear</button>}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-baseline justify-between px-3 py-2 sm:px-4">
          <h3 className="text-sm font-semibold text-gold">Pinned</h3>
          <span className="text-xs text-text">{pinned.length} of {pins.length}</span>
        </div>
        {pinned.length ? (
          <ul className="border-t border-border">{pinned.map((b) => <BossRow key={b.id} b={b} now={now} action={pinBtn(b)} />)}</ul>
        ) : (
          <p className="border-t border-border p-3 text-sm text-text">
            {q ? 'No pinned boss matches the filter.' : 'Nothing pinned. Press Pin on any boss below to keep it here.'}
          </p>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-baseline justify-between px-3 py-2 sm:px-4">
          <h3 className="text-sm font-semibold text-text">All bosses</h3>
          <span className="text-xs text-text">Showing {hit.length} of {bosses.length}</span>
        </div>
        {rest.length ? (
          <ul className="border-t border-border">{rest.map((b) => <BossRow key={b.id} b={b} now={now} action={pinBtn(b)} />)}</ul>
        ) : (
          <p className="border-t border-border p-3 text-sm text-text">
            {hit.length ? 'Everything that matches is pinned above.' : `No boss or zone matches "${q.trim()}". Clear the filter to see all ${bosses.length}.`}
          </p>
        )}
      </Card>
    </div>
  );
}
