'use client';

// Zone timers on /boards (beta variant ?v=b): zone events that run on a window, not a fixed time (the Plane of Tactics
// stampede). Ticks once a second on the client; the windows come from the bot (lib/zoneTimers.ts).

import { useEffect, useState } from 'react';
import { fmtRemaining, visibleCleared, windowStatus, zoneLabel, type ZoneTimers } from '@/lib/zoneTimers';

function ago(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ${m % 60} min ago`;
}

export default function ZoneTimersPanel({ timers }: { timers: ZoneTimers }) {
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const live = timers.windows.filter((w) => windowStatus(w, now) !== 'overdue');
  const closed = timers.windows.filter((w) => windowStatus(w, now) === 'overdue');
  const notes = visibleCleared(timers);

  return (
    <section className="bg-panel border border-purple/60 rounded-lg p-4" aria-label="Zone timers">
      <h3 className="text-lg text-gold">Zone timers</h3>
      <p className="text-xs text-dim mt-1">
        Events that happen inside a window, not at a set time. A raider who sees the start sets the clock for everyone;
        whoever zones in later gets the time that is left.
      </p>
      {live.length === 0 && closed.length === 0 && notes.length === 0 && (
        <p className="text-sm text-dim mt-3">No zone timer is running.</p>
      )}
      <ul className="mt-3 space-y-2">
        {live.map((w) => {
          const st = windowStatus(w, now);
          return (
            <li key={w.windowId} className="bg-bg border border-border/60 rounded px-3 py-2">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <span className="text-sm text-text">{zoneLabel(w.zone)}</span>
                <span className={`text-xs font-mono ${st === 'open' ? 'text-orange' : 'text-blue'}`}>
                  {st === 'open' ? 'Possible now' : `Earliest in ${fmtRemaining(w.minAtMs - now)}`}
                </span>
              </div>
              <div className="text-xs text-dim mt-1 font-mono">
                {st === 'open'
                  ? `Overdue in ${fmtRemaining(w.maxAtMs - now)}: after that it has happened unobserved.`
                  : `Latest in ${fmtRemaining(w.maxAtMs - now)}.`}
              </div>
            </li>
          );
        })}
        {closed.map((w) => (
          <li key={w.windowId} className="bg-bg border border-border/60 rounded px-3 py-2 text-sm text-dim">
            {zoneLabel(w.zone)}: the window has closed. It happened unobserved, so there is no timer until the next one is seen.
          </li>
        ))}
        {notes.map((c) => (
          <li key={`${c.zone}|${c.trigger}`} className="bg-bg border border-border/60 rounded px-3 py-2 text-sm text-dim">
            {zoneLabel(c.zone)}: no timer.{' '}
            {c.reason === 'expired'
              ? `The last window passed unobserved (${ago(now - c.atMs)}).`
              : `Replaced by a fresh sighting (${ago(now - c.atMs)}).`}
          </li>
        ))}
      </ul>
    </section>
  );
}
