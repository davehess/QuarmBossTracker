'use client';
// The recent past of the raid for /spectator?v=b and ?v=c: the last `lookbackMs` of recorded minutes (their mobs
// and raiders) plus the bosses that died. Nothing new on the server: it reads the routes /spectator/replay and the
// timeline strip already use.
//
//   GET /api/spectator/replay?night=&from=&to=   15-minute windows, once at the start (2-3 calls), then ONE call a minute
//                                                for the minutes since the last read (REREAD_MS of overlap)
//   GET /api/spectator/timeline                  the boss kills of the last six hours, every 30 s (the route keeps a
//                                                10 s memo, and RaidTimeline polls the same one)
//
// A recorded minute lands a little after it ends, so the newest frame is 1 to 2 minutes old: mobs here are "as of a
// minute ago", never the bot's 3-second feed. Both polls pause while the tab is hidden and run again when it is shown.
import { useEffect, useRef, useState } from 'react';
import { MINUTE_MS, decodeMinute, type MinuteRow, type ReplayFrame } from '@/lib/raidReplay';
import { nightKeyOf, readFrom, windowsBetween, type MobKill } from '@/lib/mobTrack';

export type MobHistory = {
  frames: ReplayFrame[];
  kills: MobKill[];
  status: 'loading' | 'ok' | 'error' | 'signedout';
};

const POLL_MS = MINUTE_MS;
const KILLS_POLL_MS = 30_000;

export function useMobHistory(lookbackMs: number): MobHistory {
  const [frames, setFrames] = useState<ReplayFrame[]>([]);
  const [kills, setKills] = useState<MobKill[]>([]);
  const [status, setStatus] = useState<MobHistory['status']>('loading');
  const minutes = useRef(new Map<number, ReplayFrame[]>());   // minute start -> its frames
  const fetchedTo = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    const ac = new AbortController();
    const load = async () => {
      if (document.hidden) return;
      const now = Date.now();
      try {
        for (const w of windowsBetween(readFrom(now, lookbackMs, fetchedTo.current), now + MINUTE_MS)) {
          const q = new URLSearchParams({ night: nightKeyOf(w.from), from: new Date(w.from).toISOString(), to: new Date(w.to).toISOString() });
          const res = await fetch('/api/spectator/replay?' + q, { signal: ac.signal });
          if (!alive) return;
          if (res.status === 401) { setStatus('signedout'); return; }
          if (!res.ok) { setStatus('error'); return; }
          const j = await res.json() as { rows?: MinuteRow[] };
          for (const row of j.rows ?? []) {
            const at = Date.parse(row.minute_at);
            if (Number.isFinite(at)) minutes.current.set(at, decodeMinute(row));
          }
        }
        fetchedTo.current = now;
        const keep = now - lookbackMs;
        for (const at of [...minutes.current.keys()]) if (at + MINUTE_MS < keep) minutes.current.delete(at);
        setFrames([...minutes.current.entries()].sort((a, b) => a[0] - b[0]).flatMap(e => e[1]));
        setStatus('ok');
      } catch { if (alive && !ac.signal.aborted) setStatus('error'); }
    };
    load();
    const id = setInterval(load, POLL_MS);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; ac.abort(); clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [lookbackMs]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch('/api/spectator/timeline');
        if (!alive || !res.ok) return;
        const j = await res.json() as { kills?: { name: string; at: number }[] };
        if (alive) setKills((j.kills ?? []).map(k => ({ name: k.name, atMs: k.at })));
      } catch { /* the strip keeps the kills it had */ }
    };
    load();
    const id = setInterval(load, KILLS_POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return { frames, kills, status };
}
