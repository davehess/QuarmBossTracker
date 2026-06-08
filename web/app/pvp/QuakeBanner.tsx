'use client';

// Live countdown to the next server-wide PvP earthquake. A quake repops every
// PvP mob, so this sits above the boss timers (it resets all of them). The time
// itself is registered by the agent parsing the in-game "The next earthquake
// will begin in…" line → bot → pvp_quake; here we just tick it down.

import { useEffect, useState } from 'react';

function fmt(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0 || d > 0) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(' ');
}

export default function QuakeBanner({ nextAt }: { nextAt: string }) {
  const target = new Date(nextAt).getTime();
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const remain = target - now;
  const imminent = remain <= 60 * 60 * 1000;   // < 1h → amber
  const live = remain <= 0;

  return (
    <section
      className={[
        'rounded-lg p-4 border flex items-center gap-3 flex-wrap',
        live
          ? 'bg-[#2a1010]/70 border-red-400/60'
          : imminent
            ? 'bg-[#2a1f10]/70 border-orange/60'
            : 'bg-[#161b22] border-border',
      ].join(' ')}
    >
      <span className="text-2xl" aria-hidden>🌋</span>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-widest text-dim">Next earthquake · PvP repop</div>
        <div className={['text-2xl tabular-nums', live ? 'text-red-300' : imminent ? 'text-orange' : 'text-text'].join(' ')}>
          {live ? 'happening now — all PvP timers reset' : fmt(remain)}
        </div>
      </div>
      <div className="ml-auto text-[11px] text-dim text-right max-w-[18rem]">
        Resets every PvP boss timer below. Auto-detected from in-game by any
        Mimic running during the quake announcement.
      </div>
    </section>
  );
}
