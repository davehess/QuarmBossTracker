'use client';

// "Buffs feel laggy" button shared by /raid and /buffs. Three effects on click:
//   1. POSTs to the reportBuffLag server action, which inserts a row into
//      buff_lag_reports so we can audit lag-felt timestamps against the
//      current throttle settings.
//   2. Drops the page into snappy refresh — calls router.refresh() once
//      immediately, then every 3s for the locked duration. After the window
//      ends, it stops on its own (and the parent page's normal 15s
//      setInterval, if any, resumes).
//   3. Default duration is 60s (the original behavior); a dropdown lets the
//      user lock fast mode for a full raid (1h or 3h) or turn it off early
//      (Uilnayar 2026-06-22 — "lockable for longer timeframes like 1h then
//      3h, and also toggle off").
// Quiet by default so it doesn't compete with the live data; turns green
// while snappy mode is active.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { reportBuffLag } from '@/lib/buff-lag-action';

const SNAPPY_MS = 3_000;

type DurationOption = { label: string; ms: number };
const DURATIONS: DurationOption[] = [
  { label: '60s',     ms:    60_000 },
  { label: '1 hour',  ms:  3_600_000 },
  { label: '3 hours', ms: 10_800_000 },
];

function fmtRemaining(ms: number): string {
  const totalSecs = Math.max(0, Math.ceil(ms / 1000));
  if (totalSecs < 60) return `${totalSecs}s`;
  const totalMins = Math.ceil(totalSecs / 60);
  if (totalMins < 60) return `${totalMins}m`;
  const hours = Math.floor(totalMins / 60);
  const mins  = totalMins % 60;
  return mins === 0 ? `${hours}h` : `${hours}h${mins}m`;
}

export default function BuffLagButton({ source }: { source: 'web_raid' | 'web_buffs' }) {
  const router = useRouter();
  const [snappyUntil, setSnappyUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const active = now < snappyUntil;

  // Refresh + clock tickers run only while active.
  useEffect(() => {
    if (!active) return;
    const refresh = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, SNAPPY_MS);
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    return () => { clearInterval(refresh); clearInterval(clock); };
  }, [active, router]);

  // Close the picker when clicking outside.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  function startFor(ms: number) {
    setSnappyUntil(Date.now() + ms);
    setNow(Date.now());
    setMenuOpen(false);
    router.refresh();
    // Only audit the lag report on the default 60s (matches original
    // "buffs feel laggy" intent — a 3h lock is a raid-session preference,
    // not a lag report).
    if (ms === DURATIONS[0].ms) reportBuffLag(source).catch(() => { /* best-effort */ });
  }
  function stop() {
    setSnappyUntil(0);
    setMenuOpen(false);
  }

  const remaining = active ? Math.max(0, snappyUntil - now) : 0;
  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => active ? setMenuOpen(o => !o) : startFor(DURATIONS[0].ms)}
        title={active
          ? 'Fast refresh on — click to change duration or stop.'
          : 'Buff data feeling stale? Click to log it AND refresh every 3s for 60s. ▾ for longer durations.'}
        className={
          'text-xs px-2 py-1 rounded-l border transition-colors whitespace-nowrap ' +
          (active
            ? 'border-green-500/60 text-green-300 bg-green-500/10'
            : 'border-border text-dim hover:text-gold hover:border-gold')
        }
      >
        {active ? `fast · ${fmtRemaining(remaining)}` : 'buffs feel laggy?'}
      </button>
      <button
        type="button"
        onClick={() => setMenuOpen(o => !o)}
        title="Pick how long fast refresh stays on (60s default, 1h or 3h for a raid lock, or off)."
        aria-label="Choose fast-refresh duration"
        className={
          'text-xs px-1.5 py-1 rounded-r border border-l-0 transition-colors ' +
          (active
            ? 'border-green-500/60 text-green-300 bg-green-500/10 hover:bg-green-500/20'
            : 'border-border text-dim hover:text-gold hover:border-gold')
        }
      >
        ▾
      </button>
      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-20 bg-panel border border-border rounded shadow-lg min-w-[10rem] text-xs"
        >
          {DURATIONS.map(d => (
            <button
              key={d.label}
              type="button"
              role="menuitem"
              onClick={() => startFor(d.ms)}
              className="block w-full text-left px-3 py-1.5 hover:bg-bg/60 text-text"
            >
              Fast for <span className="text-gold">{d.label}</span>
            </button>
          ))}
          {active && (
            <button
              type="button"
              role="menuitem"
              onClick={stop}
              className="block w-full text-left px-3 py-1.5 hover:bg-bg/60 text-orange border-t border-border"
            >
              Turn off
            </button>
          )}
        </div>
      )}
    </div>
  );
}
