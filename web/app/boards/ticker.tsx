'use client';

// Per-boss countdown cell. Server hands us the next-spawn ISO; this
// component ticks once per second on the client to keep the remaining
// time fresh without round-tripping. Falls back to "Available now" once
// the timestamp is in the past or null.

import { useEffect, useState } from 'react';

type Props = {
  bossId: string;
  name: string;
  emoji: string;
  pqdiUrl: string | null;
  nextSpawnIso: string | null;
  killedAtIso: string | null;
  timerHours: number | null;
};

function fmtRemaining(ms: number): string {
  if (ms <= 0) return '';
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0)  return `${d}d ${h}h ${m}m`;
  if (h > 0)  return `${h}h ${m}m ${s}s`;
  if (m > 0)  return `${m}m ${s}s`;
  return `${s}s`;
}

export default function BoardTicker({ name, emoji, pqdiUrl, nextSpawnIso, killedAtIso, timerHours }: Props) {
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const nextMs    = nextSpawnIso ? new Date(nextSpawnIso).getTime() : null;
  const isUp      = !nextMs || nextMs <= now;
  const remaining = nextMs ? Math.max(0, nextMs - now) : 0;

  // Color the row based on urgency:
  //   < 30 min  → orange (spawn alert window — bot pings at this point too)
  //   < 2 hours → blue   (heads-up)
  //   else      → default
  let accent = 'text-text';
  if (isUp)                       accent = 'text-green';
  else if (remaining < 30 * 60 * 1000) accent = 'text-orange';
  else if (remaining < 2 * 60 * 60 * 1000) accent = 'text-blue';

  const inner = (
    <div className="flex items-center justify-between bg-bg border border-border/60 rounded px-2 py-1.5 hover:border-blue/60 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        <span aria-hidden className="shrink-0">{emoji}</span>
        <span className="truncate text-sm text-text">{name}</span>
      </div>
      <div className={`text-xs font-mono shrink-0 ml-2 ${accent}`}>
        {isUp ? 'Available now' : fmtRemaining(remaining)}
      </div>
    </div>
  );

  if (pqdiUrl) {
    return (
      <a
        href={pqdiUrl}
        target="_blank"
        rel="noreferrer"
        title={killedAtIso ? `Killed ${new Date(killedAtIso).toLocaleString()} · ${timerHours ?? '?'}h timer` : 'No kill recorded'}
        className="no-underline"
      >
        {inner}
      </a>
    );
  }
  return inner;
}
