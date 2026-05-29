'use client';

// Collapsible per-expansion section for /boards. Server passes in the list of
// bosses + their already-resolved cooldown state; this component just toggles
// visibility. Default expanded; user clicks the header to collapse.
//
// Collapsed view: header + a compact strip showing each boss currently on
// cooldown ("active timer") so the most useful info stays visible. Available
// bosses just contribute to the "N of M available" count in the header.

import { useEffect, useState } from 'react';
import BoardTicker from './ticker';

type Boss = {
  boss_id:     string;
  name:        string | null;
  zone:        string | null;
  emoji:       string | null;
  pqdi_url:    string | null;
  killed_at:   string | null;
  next_spawn:  string | null;
  timer_hours: number | null;
};

type ZoneGroup = { zone: string; bosses: Boss[] };

type Props = {
  expansion: string;
  label: string;
  accentClass: string;
  zones: ZoneGroup[];
};

function fmtRemaining(ms: number): string {
  if (ms <= 0) return 'Available';
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0)  return `${d}d ${h}h ${m}m`;
  if (h > 0)  return `${h}h ${m}m`;
  if (m > 0)  return `${m}m ${s}s`;
  return `${s}s`;
}

export default function ExpansionSection({ expansion, label, accentClass, zones }: Props) {
  // Persist collapse state per expansion across page loads.
  const storageKey = `wp.boards.collapsed.${expansion}`;
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated]   = useState(false);
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(storageKey);
      if (v === '1') setCollapsed(true);
    } catch {}
    setHydrated(true);
  }, [storageKey]);

  // Tick once per second so the collapsed view's active timers stay accurate.
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const toggle = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { window.localStorage.setItem(storageKey, next ? '1' : '0'); } catch {}
      return next;
    });
  };

  const allBosses = zones.flatMap(z => z.bosses);
  const onCooldown = allBosses
    .filter(b => b.next_spawn && new Date(b.next_spawn).getTime() > now)
    .sort((a, b) => new Date(a.next_spawn!).getTime() - new Date(b.next_spawn!).getTime());
  const availableCount = allBosses.length - onCooldown.length;

  return (
    <section className={`bg-panel border ${accentClass} rounded-lg p-4`}>
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between gap-3 text-left hover:opacity-80 transition-opacity"
        aria-expanded={!collapsed}
      >
        <h3 className="text-base text-text font-semibold flex items-center gap-2">
          <span className={`text-dim text-xs font-mono w-3 inline-block ${collapsed ? '' : 'rotate-90'} transition-transform`}>▶</span>
          <span>{label}</span>
        </h3>
        <div className="text-xs text-dim flex items-center gap-3">
          <span>
            <span className="text-green">{availableCount}</span> of {allBosses.length} available
          </span>
          {onCooldown.length > 0 && (
            <span className="text-orange">{onCooldown.length} on cooldown</span>
          )}
        </div>
      </button>

      {/* Collapsed strip — only render after hydration to avoid a flash of the
          wrong state. Shows active timers compactly so officers can see
          what's next without expanding. */}
      {hydrated && collapsed && onCooldown.length > 0 && (
        <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1 text-xs">
          {onCooldown.map(b => {
            const remaining = new Date(b.next_spawn!).getTime() - now;
            const urgent = remaining < 30 * 60 * 1000;
            return (
              <li
                key={b.boss_id}
                className="flex items-center justify-between bg-bg border border-border/40 rounded px-2 py-1"
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <span aria-hidden className="shrink-0">{b.emoji || '⚔️'}</span>
                  <span className="truncate text-text">{b.name || b.boss_id}</span>
                </span>
                <span className={`font-mono shrink-0 ml-2 ${urgent ? 'text-orange' : 'text-dim'}`}>
                  {fmtRemaining(remaining)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* Expanded grid — the full per-zone breakdown. */}
      {(!hydrated || !collapsed) && (
        <div className="space-y-3 mt-3">
          {zones.map(({ zone, bosses }) => (
            <div key={zone}>
              <div className="text-xs text-dim uppercase tracking-wide mb-1">{zone}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {bosses.map(b => (
                  <BoardTicker
                    key={b.boss_id}
                    bossId={b.boss_id}
                    name={b.name || b.boss_id}
                    emoji={b.emoji || '⚔️'}
                    pqdiUrl={b.pqdi_url}
                    nextSpawnIso={b.next_spawn}
                    killedAtIso={b.killed_at}
                    timerHours={b.timer_hours}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
