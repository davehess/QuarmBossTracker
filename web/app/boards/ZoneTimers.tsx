'use client';

// Zone timers on /boards (beta variant ?v=b): zone events that run on a window, not a fixed time (the Plane of Tactics
// boar stampede). Ticks once a second on the client; the windows come from the bot (lib/zoneTimers.ts).

import { useEffect, useState } from 'react';
import { eventInfo, fmtRemaining, pqdiNpcUrl, visibleCleared, windowStatus, zoneLabel, type ZoneTimers } from '@/lib/zoneTimers';

function ago(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ${m % 60} min ago`;
}

// The viewer's own clock, so "9:14 PM" means their 9:14. Rendered only after mount: the server's locale and zone
// are not the viewer's, and a mismatch would fail hydration.
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function ZoneTimersPanel({ timers }: { timers: ZoneTimers }) {
  const [now, setNow] = useState<number>(Date.now());
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
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
          const ev = eventInfo(w.trigger);
          return (
            <li key={w.windowId} className="bg-bg border border-border/60 rounded px-3 py-3">
              <div className="flex items-baseline justify-between gap-x-3 gap-y-1 flex-wrap">
                <span className="text-base text-text">{ev.title}</span>
                <span className="text-xs text-dim">{zoneLabel(w.zone)}</span>
              </div>
              {ev.blurb && <p className="text-xs text-dim mt-1 leading-5">{ev.blurb}</p>}
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm font-mono">
                <dt className="text-dim">Earliest start</dt>
                <dd className={st === 'open' ? 'text-orange' : 'text-blue'}>
                  {st === 'open' ? 'possible now' : `in ${fmtRemaining(w.minAtMs - now)}`}
                  {mounted && <span className="text-dim"> · about {clock(w.minAtMs)}</span>}
                </dd>
                <dt className="text-dim">Latest start</dt>
                <dd className="text-text">
                  {`in ${fmtRemaining(w.maxAtMs - now)}`}
                  {mounted && <span className="text-dim"> · about {clock(w.maxAtMs)}</span>}
                </dd>
              </dl>
              <p className="text-xs text-dim mt-2">
                Observed: the clock started when a raider heard the emote{mounted ? ` at ${clock(w.observedAtMs)}` : ''}.
                {st === 'open' ? ' It can start any moment.' : ''} After the latest time it has happened unobserved.
              </p>
              {ev.pqdi && (
                <p className="text-xs mt-2">
                  <a className="text-blue hover:underline" href={pqdiNpcUrl(ev.pqdi.npcId)} target="_blank" rel="noreferrer">
                    {ev.pqdi.label} on PQDI ↗
                  </a>
                </p>
              )}
            </li>
          );
        })}
        {closed.map((w) => (
          <li key={w.windowId} className="bg-bg border border-border/60 rounded px-3 py-2 text-sm text-dim">
            {eventInfo(w.trigger).title} ({zoneLabel(w.zone)}): the window has closed. It happened unobserved, so there is no timer until the next one is seen.
          </li>
        ))}
        {notes.map((c) => (
          <li key={`${c.zone}|${c.trigger}`} className="bg-bg border border-border/60 rounded px-3 py-2 text-sm text-dim">
            {eventInfo(c.trigger).title} ({zoneLabel(c.zone)}): no timer.{' '}
            {c.reason === 'expired'
              ? `The last window passed unobserved (${ago(now - c.atMs)}).`
              : `Replaced by a fresh sighting (${ago(now - c.atMs)}).`}
          </li>
        ))}
      </ul>
    </section>
  );
}
