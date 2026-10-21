'use client';

// The raid timeline at the top of /spectator and /spectator/replay (the guild lead, 2026-10-21: "a tracked
// timeline view ... the death timers between mobs ... easily and clearly displayed versus having to say it out
// loud"). Two previews of the same data, picked with ?v=b or ?v=c; no ?v shows neither (web/lib/raidTimeline.ts
// holds the rules, this file only draws them).
//
//   B  Timeline strip: one time axis for the night, a labelled tick per death, the gap written on each span,
//      the open pair window as a shrinking bar, the since-last-death clock at the right.
//   C  Stopwatch cards: three big numbers (last death, since last death, pair window) and a list of the night's
//      deaths with the gap under each.
//
// Two ways to get "now" and the kills:
//   live    no `kills` prop: polls /api/spectator/timeline every 10 s, ticks once a second off the local clock
//           (corrected by the server's `now`, so a wrong PC clock does not skew the countdown).
//   replay  `kills` and `nowMs` props: the replay board passes the night's bosses and its playhead, and a boss
//           that dies after the playhead is not yet on the timeline.
//
// Colour is semantic here: red is a death, orange a window running out (red under 60 s), green a window made.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildTimeline, fmtClock, shortName, type Kill, type PairState, type Timeline, type TimelineDeath } from '@/lib/raidTimeline';

export type TimelineVariant = 'b' | 'c';

/** `?v=` -> a variant, or null (no timeline). Anything else is the page as it is on production. */
export function timelineVariant(v: string | string[] | undefined): TimelineVariant | null {
  const s = (Array.isArray(v) ? v[0] : v)?.toLowerCase();
  return s === 'b' || s === 'c' ? s : null;
}

const etClock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
const hms = (ms: number) => etClock.format(ms);

const POLL_MS = 10_000;
const URGENT_SEC = 60;

type Props = { variant: TimelineVariant; kills?: Kill[]; nowMs?: number };

export default function RaidTimeline({ variant, kills, nowMs }: Props) {
  const controlled = kills !== undefined && nowMs !== undefined;
  const [fetched, setFetched] = useState<Kill[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error' | 'signedout'>('loading');
  const [skew, setSkew] = useState(0);
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    if (controlled) return;
    let alive = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch('/api/spectator/timeline');
        if (!alive) return;
        if (res.status === 401) { setStatus('signedout'); return; }
        if (!res.ok) { setStatus('error'); return; }
        const j = await res.json() as { now: number; kills: { npc_id: number; name: string; at: number }[] };
        if (!alive) return;
        setSkew(j.now - Date.now());
        setFetched(j.kills.map(k => ({ npcId: k.npc_id, name: k.name, atMs: k.at })));
        setStatus('ok');
      } catch { if (alive) setStatus('error'); }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [controlled]);

  useEffect(() => {
    if (controlled) return;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [controlled]);

  const now = controlled ? nowMs : tick + skew;
  const tl = useMemo(() => buildTimeline(controlled ? kills : fetched, now), [controlled, kills, fetched, now]);

  return (
    <section aria-label="Raid timeline" className="mb-4 rounded-md border border-border bg-panel p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 text-xs text-dim">
        <b className="text-sm text-text">Raid timeline</b>
        <span>{controlled ? 'at the replay playhead' : 'live, Eastern time'}</span>
        <span className="ml-auto">preview {variant.toUpperCase()}: {variant === 'b' ? 'timeline strip' : 'stopwatch cards'}</span>
      </div>
      {tl.deaths.length === 0 ? (
        <p className="text-sm text-dim">
          {!controlled && status === 'loading' ? 'Loading deaths…'
            : !controlled && status === 'signedout' ? 'Sign in to see the timeline.'
            : !controlled && status === 'error' ? 'The timeline is not answering. It will try again in a few seconds.'
            : 'No boss has died yet. The first death starts the clock, and the Decorin and Tallon/Vallon windows start with theirs.'}
        </p>
      ) : variant === 'b' ? <Strip tl={tl} now={now} /> : <Cards tl={tl} now={now} />}
      {!controlled && status === 'error' && tl.deaths.length > 0 && (
        <p className="mt-2 text-xs text-orange">The timeline could not refresh; the clocks are running from the last deaths seen.</p>
      )}
    </section>
  );
}

// ── shared pieces ────────────────────────────────────────────────────────────

const urgent = (left: number) => left < URGENT_SEC;

function PairLine({ p, now, bar }: { p: PairState; now: number; bar: boolean }) {
  if (p.status === 'waiting') return null;
  if (p.status === 'open') {
    const left = Math.max(0, Math.round((p.dueAtMs - now) / 1000));
    const hot = urgent(left);
    return (
      <div className="min-w-[14rem] flex-1" role="group" aria-label={`${p.rule.label} window`}>
        <div className={`flex flex-wrap items-baseline justify-between gap-x-2 text-sm ${hot ? 'text-red' : 'text-orange'}`}>
          <span>{shortName(p.secondName)} due in <b className="tabular-nums">{fmtClock(left)}</b></span>
          <span className="text-xs text-dim">{p.rule.label} · {fmtClock(p.rule.windowSec)} window</span>
        </div>
        {bar && (
          <div className="mt-1 h-2 overflow-hidden rounded bg-bg" aria-hidden="true">
            <div className={`h-full ${hot ? 'bg-red' : 'bg-orange'}`} style={{ width: `${Math.min(100, (left / p.rule.windowSec) * 100)}%` }} />
          </div>
        )}
      </div>
    );
  }
  if (p.status === 'made') {
    return (
      <div className="min-w-[14rem] flex-1 text-sm text-green">
        {p.rule.label} made in <b className="tabular-nums">{fmtClock(p.tookSec)}</b> ✓
        <span className="ml-2 text-xs text-dim">{fmtClock(p.rule.windowSec)} window</span>
      </div>
    );
  }
  return (
    <div className="min-w-[14rem] flex-1 text-sm text-red">
      {p.rule.label} missed{' '}
      <span className="text-xs text-dim">
        {p.tookSec != null
          ? `${shortName(p.secondName)} died ${fmtClock(p.tookSec - p.rule.windowSec)} past the ${fmtClock(p.rule.windowSec)} window`
          : `${shortName(p.secondName)} was still up when the ${fmtClock(p.rule.windowSec)} window ran out`}
      </span>
    </div>
  );
}

function PairLines({ tl, now, bar }: { tl: Timeline; now: number; bar: boolean }) {
  const live = tl.pairs.filter(p => p.status !== 'waiting');
  if (!live.length) return <p className="text-xs text-dim">Pair windows: the Decorins (6 min) and Tallon + Vallon (20 min) start on the first death of either.</p>;
  return <div className="flex flex-wrap gap-x-6 gap-y-3">{live.map(p => <PairLine key={p.rule.label} p={p} now={now} bar={bar} />)}</div>;
}

// ── B: timeline strip ────────────────────────────────────────────────────────

const LANE = 32;      // px per label lane above the axis
const MAX_LANES = 3;
const MINUTE = 60_000;

function Strip({ tl, now }: { tl: Timeline; now: number }) {
  const due = tl.pairs.reduce((m, p) => (p.status === 'open' ? Math.max(m, p.dueAtMs) : m), now);
  const start = Math.floor(tl.deaths[0].atMs / MINUTE) * MINUTE - MINUTE;
  const end = Math.ceil(Math.max(now, due) / MINUTE) * MINUTE + MINUTE;
  const span = Math.max(1, end - start);
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - start) / span) * 100));

  // The axis's width in px, so a label's width can be turned into a share of the axis (640 until measured).
  const [px, setPx] = useState(640);
  const axisRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    setPx(Math.max(200, el.clientWidth));
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => setPx(Math.max(200, el.clientWidth))).observe(el);
  }, []);

  // Label lanes: a label goes in the first lane whose last label ends before it starts. Labels near the right
  // edge grow leftward.
  const lanes = useMemo(() => {
    const ends: number[] = [];
    return tl.deaths.map(d => {
      const x = pct(d.atMs);
      const w = (Math.max(d.name.length, 8) * 6.6 + 12) / px * 100;
      const left = x > 78;
      const a = left ? x - w : x, b = left ? x : x + w;
      let lane = ends.findIndex(e => e <= a);
      if (lane < 0) lane = ends.length < MAX_LANES ? ends.length : ends.indexOf(Math.min(...ends));
      ends[lane] = b + 0.5;
      return { lane, left };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tl.deaths, start, span, px]);
  const laneCount = Math.min(MAX_LANES, Math.max(1, ...lanes.map(l => l.lane + 1)));

  const open = tl.pairs.filter((p): p is Extract<PairState, { status: 'open' }> => p.status === 'open');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
      <div className="min-w-0 flex-1">
        <div ref={axisRef}>
          <div className="relative" style={{ height: laneCount * LANE }}>
            {tl.deaths.map((d, i) => (
              <div key={`${d.npcId}-${d.atMs}`} className="absolute bottom-0 border-l border-red/60"
                style={{ left: `${pct(d.atMs)}%`, height: (lanes[i].lane + 1) * LANE }}>
                <div className={`absolute top-0 whitespace-nowrap text-[11px] leading-tight ${lanes[i].left ? 'right-1 text-right' : 'left-1'}`}>
                  <div className="text-text">{d.name}</div>
                  <div className="tabular-nums text-dim">{hms(d.atMs)}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="relative h-11" aria-hidden="true">
            <div className="absolute inset-x-0 top-[6px] border-t border-border" />
            {open.map(p => {
              const hot = urgent(Math.max(0, Math.round((p.dueAtMs - now) / 1000)));
              return (
                <div key={p.rule.label}>
                  <div className={`absolute top-[4px] h-[5px] rounded-sm opacity-30 ${hot ? 'bg-red' : 'bg-orange'}`}
                    style={{ left: `${pct(p.first.atMs)}%`, width: `${Math.max(0, pct(now) - pct(p.first.atMs))}%` }} />
                  <div className={`absolute top-[4px] h-[5px] rounded-sm ${hot ? 'bg-red' : 'bg-orange'}`}
                    style={{ left: `${pct(now)}%`, width: `${Math.max(0, pct(p.dueAtMs) - pct(now))}%` }} />
                </div>
              );
            })}
            {tl.deaths.map(d => (
              <span key={`${d.npcId}-${d.atMs}-dot`} className="absolute top-[2px] h-[9px] w-[9px] -translate-x-1/2 rounded-full bg-red"
                style={{ left: `${pct(d.atMs)}%` }} />
            ))}
            <span className="absolute top-0 h-[13px] border-l border-blue" style={{ left: `${pct(now)}%` }} />
            {tl.deaths.map((d, i) => {
              if (i === 0 || d.gapSec == null) return null;
              const a = pct(tl.deaths[i - 1].atMs), b = pct(d.atMs);
              if (b - a < 52 / px * 100) return null;   // no room for "+11:18" on the span
              return (
                <span key={`${d.npcId}-${d.atMs}-gap`} className="absolute top-[18px] -translate-x-1/2 whitespace-nowrap text-[11px] tabular-nums text-text"
                  style={{ left: `${(a + b) / 2}%` }}>+{fmtClock(d.gapSec)}</span>
              );
            })}
          </div>
        </div>
      </div>
      <div className="order-first flex shrink-0 flex-col justify-center border-border md:order-none md:w-44 md:border-l md:pl-4">
        <div className="text-xs text-dim">Since last death</div>
        <div className="text-3xl font-bold tabular-nums text-text">{fmtClock(tl.sinceLastSec ?? 0)}</div>
        <div className="text-xs text-dim">{tl.last?.name}</div>
      </div>
      </div>
      <PairLines tl={tl} now={now} bar />
    </div>
  );
}

// ── C: stopwatch cards ───────────────────────────────────────────────────────

function Card({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-md border border-border bg-bg p-3 ${className}`}>
      <div className="text-xs text-dim">{label}</div>
      {children}
    </div>
  );
}

function Cards({ tl, now }: { tl: Timeline; now: number }) {
  const shown = tl.pairs.filter(p => p.status !== 'waiting');
  const recent: TimelineDeath[] = tl.deaths.slice().reverse();
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Card label="Last death">
          <div className="text-xl font-bold leading-tight text-red sm:text-2xl">{tl.last?.name}</div>
          <div className="mt-1 text-sm tabular-nums text-dim">{tl.last ? hms(tl.last.atMs) : ''} ET</div>
        </Card>
        <Card label="Since last death">
          <div className="text-3xl font-bold tabular-nums text-text sm:text-4xl">{fmtClock(tl.sinceLastSec ?? 0)}</div>
          <div className="mt-1 text-sm text-dim">{tl.last && tl.last.gapSec != null ? `it came ${fmtClock(tl.last.gapSec)} after the one before` : 'the first of the night'}</div>
        </Card>
        <Card label="Pair window" className="col-span-2 sm:col-span-1">
          {shown.length === 0
            ? <div className="text-sm text-dim">Waiting for a Decorin or Tallon / Vallon to die.</div>
            : <div className="flex flex-col gap-3">{shown.map(p => <PairBig key={p.rule.label} p={p} now={now} />)}</div>}
        </Card>
      </div>
      <ol className="mt-3 text-sm" aria-label="Deaths tonight, newest first">
        {recent.map((d, i) => (
          <li key={`${d.npcId}-${d.atMs}`}>
            <div className="flex items-baseline gap-3">
              <span className="tabular-nums text-dim">{hms(d.atMs)}</span>
              <span className="text-text">{d.name}</span>
            </div>
            {i < recent.length - 1 && d.gapSec != null && (
              <div className="py-0.5 pl-3 text-xs tabular-nums text-dim">↑ {fmtClock(d.gapSec)} after {recent[i + 1].name}</div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function PairBig({ p, now }: { p: PairState; now: number }) {
  if (p.status === 'open') {
    const left = Math.max(0, Math.round((p.dueAtMs - now) / 1000));
    const hot = urgent(left);
    return (
      <div>
        <div className={`text-3xl font-bold tabular-nums sm:text-4xl ${hot ? 'text-red' : 'text-orange'}`}>{fmtClock(left)}</div>
        <div className={`text-sm ${hot ? 'text-red' : 'text-orange'}`}>{shortName(p.secondName)} due</div>
        <div className="text-xs text-dim">{p.rule.label} · {fmtClock(p.rule.windowSec)} window</div>
      </div>
    );
  }
  if (p.status === 'made') {
    return (
      <div>
        <div className="text-3xl font-bold tabular-nums text-green sm:text-4xl">{fmtClock(p.tookSec)} ✓</div>
        <div className="text-sm text-green">{p.rule.label} made</div>
        <div className="text-xs text-dim">{fmtClock(p.rule.windowSec)} window</div>
      </div>
    );
  }
  if (p.status !== 'missed') return null;
  return (
    <div>
      <div className="text-3xl font-bold text-red sm:text-4xl">missed</div>
      <div className="text-sm text-red">{p.rule.label}</div>
      <div className="text-xs text-dim">
        {p.tookSec != null ? `${shortName(p.secondName)} ${fmtClock(p.tookSec - p.rule.windowSec)} late` : `${shortName(p.secondName)} still up`}
      </div>
    </div>
  );
}
