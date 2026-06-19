'use client';

// "Buffs feel laggy" button shared by /raid and /buffs. Two effects on click:
//   1. POSTs to the reportBuffLag server action, which inserts a row into
//      buff_lag_reports so we can audit lag-felt timestamps against the
//      current throttle settings.
//   2. Drops the page into snappy refresh — calls router.refresh() once
//      immediately, then every 3s for 60s. After the window, it stops on its
//      own (and the parent page's normal 15s setInterval, if any, resumes).
// Quiet by default so it doesn't compete with the live data; turns green
// while snappy mode is active.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { reportBuffLag } from '@/lib/buff-lag-action';

const SNAPPY_MS     = 3_000;
const SNAPPY_WINDOW = 60_000;

export default function BuffLagButton({ source }: { source: 'web_raid' | 'web_buffs' }) {
  const router = useRouter();
  const [snappyUntil, setSnappyUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const active = now < snappyUntil;

  // While active: refresh on a 3s cadence and tick the local clock so the
  // button text reflects the remaining window. The setInterval auto-stops
  // when the window expires (the effect re-runs because `active` flips).
  useEffect(() => {
    if (!active) return;
    const refresh = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, SNAPPY_MS);
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    return () => { clearInterval(refresh); clearInterval(clock); };
  }, [active, router]);

  const onClick = () => {
    setSnappyUntil(Date.now() + SNAPPY_WINDOW);
    setNow(Date.now());
    router.refresh();
    reportBuffLag(source).catch(() => { /* best-effort audit */ });
  };

  const remaining = active ? Math.max(0, Math.ceil((snappyUntil - now) / 1000)) : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      title="Buff data feeling stale? Click to log it AND refresh every 3s for the next 60s."
      className={
        'text-xs px-2 py-1 rounded border transition-colors whitespace-nowrap ' +
        (active
          ? 'border-green-500/60 text-green-300 bg-green-500/10'
          : 'border-border text-dim hover:text-gold hover:border-gold')
      }
    >
      {active ? `fast · ${remaining}s` : 'buffs feel laggy?'}
    </button>
  );
}
