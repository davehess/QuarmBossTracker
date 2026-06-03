// Snooze button row for the Tells Discord DM relay. Lives on /me/tells. The
// tells themselves still store while paused — only the DM is silenced — so
// the user can review on the page or in the local dashboard without losing
// any data. Calls the bot-side gate via the same wolfpack_members.tells_dm_
// paused_until column the bot reads in _handleAgentTells before _relayTellsToDM.
'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setTellsDmPause } from '../actions';

const PRESETS: { label: string; minutes: number }[] = [
  { label: '15m',  minutes: 15 },
  { label: '1h',   minutes: 60 },
  { label: '4h',   minutes: 240 },
  { label: '8h',   minutes: 480 },
  { label: '24h',  minutes: 1440 },
];

function fmtCountdown(ms: number): string {
  if (ms <= 0) return '0m';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function TellsSnoozeControl({ pausedUntil: initialPausedUntil }: { pausedUntil: string | null }) {
  const [pausedUntil, setPausedUntil] = useState<string | null>(initialPausedUntil);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const router = useRouter();

  // Tick the countdown every 15s so the remaining-time label stays current
  // without re-rendering the whole page.
  useEffect(() => {
    const isPaused = pausedUntil && new Date(pausedUntil).getTime() > Date.now();
    if (!isPaused) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [pausedUntil]);

  const remainingMs = pausedUntil ? new Date(pausedUntil).getTime() - now : 0;
  const isPaused = remainingMs > 0;

  function apply(minutes: number | null) {
    setErr(null);
    startTransition(async () => {
      const r = await setTellsDmPause(minutes);
      if (!r.ok) { setErr(r.error || 'failed'); return; }
      setPausedUntil(r.until ?? null);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      <span className="text-dim">
        {isPaused
          ? <>Discord DMs <span className="text-orange">paused</span> · resume in <span className="text-text">{fmtCountdown(remainingMs)}</span></>
          : <>Pause Discord DMs:</>
        }
      </span>
      {!isPaused && PRESETS.map(p => (
        <button
          key={p.minutes}
          type="button"
          disabled={pending}
          onClick={() => apply(p.minutes)}
          className="border border-border text-dim rounded px-2 py-0.5 hover:text-blue hover:border-blue disabled:opacity-50"
          title={`Mute incoming Tells DM for ${p.label}`}
        >
          {p.label}
        </button>
      ))}
      {isPaused && (
        <button
          type="button"
          disabled={pending}
          onClick={() => apply(null)}
          className="border border-green/40 text-green rounded px-3 py-0.5 hover:bg-green/10 disabled:opacity-50"
        >
          {pending ? 'Resuming…' : 'Resume now'}
        </button>
      )}
      {err && <span className="text-red">Error: {err}</span>}
    </div>
  );
}
