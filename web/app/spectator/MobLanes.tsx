'use client';
// /spectator?v=c: the fight timeline. One row per mob NAME (a swarm of twelve is one row, "×12"), on one time axis.
//   bar height   how many raiders had it targeted (taller = more)
//   bar shade    how many spawns of that name were being targeted at once (darker = more)
//   ✕            the boss died here (the encounter record)
// A row is a button: tapping it (anywhere on its bar, or Enter) moves the playhead to that moment, picks the lane and
// centres the map on where it stood. The detail card below lists the spawns, each one a jump of its own.
import { BUCKET_MS, laneFocusTime, type MobLane, type SpawnTrack } from '@/lib/mobTrack';
import { ago, clock, clockMin } from './MobStrip';

const LABEL = 'w-28 sm:w-40';
const ROW_H = 26;

function ticks(start: number, end: number): number[] {
  const step = (end - start) > 40 * 60_000 ? 10 * 60_000 : 5 * 60_000;
  const out: number[] = [];
  for (let t = Math.ceil(start / step) * step; t <= end; t += step) out.push(t);
  return out;
}

export default function MobLanes({ lanes, start, end, playhead, selected, onPick, rows }: {
  lanes: MobLane[]; start: number; end: number;
  playhead: number | null;
  selected: string | null;
  onPick: (lane: MobLane, t: number) => void;
  rows: number;
}) {
  const span = Math.max(1, end - start);
  const x = (t: number) => Math.min(100, Math.max(0, ((t - start) / span) * 100));
  const b0 = Math.floor(start / BUCKET_MS);
  const nB = Math.max(1, Math.ceil(end / BUCKET_MS) - b0 + 1);
  const shown = lanes.slice(0, rows);

  const click = (lane: MobLane, e: React.MouseEvent<HTMLButtonElement>) => {
    const track = e.currentTarget.querySelector('[data-track]') as HTMLElement | null;
    const r = track?.getBoundingClientRect();
    // detail 0 is a keyboard "click": no pointer, so the lane's own best moment
    const t = r && e.detail > 0 ? start + ((e.clientX - r.left) / r.width) * span : laneFocusTime(lane);
    onPick(lane, Math.min(lane.to, Math.max(lane.from, t)));
  };

  return (
    <div className="relative">
      <div className="flex items-end text-[10px] text-dim">
        <div className={`${LABEL} shrink-0`} />
        <div className="relative h-5 min-w-0 flex-1" aria-hidden>
          {ticks(start, end).map(t => (
            <span key={t} className="absolute top-0 -translate-x-1/2 tabular-nums" style={{ left: `${x(t)}%` }}>{clockMin(t).replace(' ', '')}</span>
          ))}
        </div>
      </div>
      <ul className="border-t border-border">
        {shown.map(l => {
          const on = l.key === selected;
          return (
            <li key={l.key} className="border-b border-border/60">
              <button type="button" onClick={e => click(l, e)} aria-pressed={on}
                aria-label={`${l.name}${l.spawns.length > 1 ? `, ${l.spawns.length} spawns` : ''}, up to ${l.peakN} raiders on it${l.killedAt != null ? `, killed ${clock(l.killedAt)}` : ''}. Jump to it on the map.`}
                className={`flex w-full items-center text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${on ? 'bg-accent/20' : 'hover:bg-[#21262d]'}`}
                style={{ height: ROW_H + 8 }}>
                <span className={`${LABEL} flex shrink-0 items-baseline px-1.5 text-xs ${l.boss ? 'text-text' : 'text-dim'}`}>
                  {l.boss && <span className="shrink-0 text-red">●&nbsp;</span>}
                  <span className="min-w-0 truncate">{l.name}</span>
                  {l.spawns.length > 1 && <span className="shrink-0 text-dim">&nbsp;×{l.spawns.length}</span>}
                </span>
                <span data-track className="relative block min-w-0 flex-1" style={{ height: ROW_H }}>
                  <svg viewBox={`0 0 ${nB} ${ROW_H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden shapeRendering="crispEdges">
                    <rect x={Math.floor(l.from / BUCKET_MS) - b0} y={ROW_H - 1} width={Math.max(1, Math.ceil((l.to - l.from) / BUCKET_MS) + 1)} height={1} fill="#30363d" />
                    {l.buckets.map(b => {
                      const h = 4 + Math.min(b.n, 8) / 8 * (ROW_H - 6);
                      return <rect key={b.t} x={b.t / BUCKET_MS - b0} y={ROW_H - 1 - h} width={1.05} height={h}
                        fill="#ef4444" fillOpacity={0.4 + Math.min(b.spawns, 6) * 0.1} />;
                    })}
                  </svg>
                  {l.killedAt != null && (
                    <span className="absolute top-0 -translate-x-1/2 text-sm font-bold leading-none text-white [text-shadow:0_0_3px_#0d1117,0_0_3px_#0d1117]"
                      style={{ left: `${x(l.killedAt)}%` }} aria-hidden>✕</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {/* the playhead, over every lane */}
      {playhead != null && (
        <div className="pointer-events-none absolute bottom-0 top-5 flex" aria-hidden style={{ left: 0, right: 0 }}>
          <div className={`${LABEL} shrink-0`} />
          <div className="relative min-w-0 flex-1"><div className="absolute inset-y-0 w-px bg-white/80" style={{ left: `${x(playhead)}%` }} /></div>
        </div>
      )}
      {lanes.length > rows && <p className="mt-1 text-xs text-dim">{lanes.length - rows} more mobs further down the list.</p>}
    </div>
  );
}

export function LaneDetail({ lane, playhead, end, onSeek, onSpawn }: {
  lane: MobLane;
  playhead: number | null;
  end: number;
  onSeek: (t: number) => void;
  onSpawn: (s: SpawnTrack) => void;
}) {
  const sorted = [...lane.spawns].sort((a, b) => b.peakN - a.peakN || a.first - b.first).slice(0, 8);
  const btn = 'rounded border border-border bg-panel px-2.5 py-1.5 text-xs text-text hover:bg-[#21262d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue';
  return (
    <section aria-label={`${lane.name} detail`} className="rounded-md border border-border bg-panel p-3 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <b className="text-sm text-text">{lane.name}</b>
        {lane.boss && <span className="text-red">boss{lane.killedAt != null && <> · died {clock(lane.killedAt)}</>}</span>}
        <span className="text-dim">{lane.spawns.length} {lane.spawns.length === 1 ? 'spawn' : 'spawns'} · up to {lane.peakN} {lane.peakN === 1 ? 'raider' : 'raiders'} on it</span>
      </div>
      <p className="mt-1 text-dim">
        Targeted from {clock(lane.from)} to {clock(lane.to)} ({ago(end - lane.to)} was its last sighting).
        The record holds what the raid had targeted; only a boss has a recorded death.
        {playhead == null ? '' : ` Playhead at ${clock(playhead)}.`}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" className={btn} onClick={() => onSeek(lane.from)}>Jump to first seen</button>
        {lane.killedAt != null && <button type="button" className={btn} onClick={() => onSeek(Math.max(lane.from, (lane.killedAt as number) - 3000))}>Jump to the kill</button>}
      </div>
      {lane.spawns.length > 1 && (
        <ul className="mt-2 space-y-1" aria-label="Spawns">
          {sorted.map(s => (
            <li key={`${s.sid}-${s.first}`}>
              <button type="button" onClick={() => onSpawn(s)} className={`${btn} flex w-full items-center gap-2 text-left`}>
                <span className="w-16 shrink-0 text-dim">{s.sid != null ? `#${s.sid}` : 'no id'}</span>
                <span className="min-w-0 flex-1 tabular-nums">{clockMin(s.first)} to {clockMin(s.last)}</span>
                <span className="shrink-0 text-dim">{s.peakN} on it</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
