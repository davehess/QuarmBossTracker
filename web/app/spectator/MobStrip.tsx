'use client';
// /spectator?v=b: the scrub strip under the map. One time axis for the last stretch of recorded minutes, a marker for
// every moment worth a click (a boss died, a mob was pulled hard, the raid changed zone), a range input to drag, and
// the same moments as chips underneath (a marker is 28 px of tap target; a chip is a whole line). Picking any of them
// moves the PLAYHEAD, and the whole board (raiders and mobs) redraws as it stood then. "Live" lets go.
// Also used by ?v=c for its small scrub bar (no markers there: its lanes are the handles).
//
// Colour is semantic, the same words as the rest of the page: red is a death, gold a hard pull, dim a zone move.
import { useState } from 'react';
import type { Marker } from '@/lib/mobTrack';

const etClock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const etMin = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
export const clock = (ms: number) => etClock.format(ms);
export const clockMin = (ms: number) => etMin.format(ms);
/** 272_000 -> "4:32 ago" */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} ago`;
}

const GLYPH = { kill: '✕', pull: '▲', zone: '›' } as const;
const TONE = { kill: 'text-red', pull: 'text-gold', zone: 'text-dim' } as const;
const KIND = { kill: 'Kill', pull: 'Pull', zone: 'Zone' } as const;

export default function MobStrip({ start, end, playhead, onSeek, markers = [], onMarker, selectedLane, lookbackLabel }: {
  start: number; end: number;
  playhead: number | null;                  // null = the live edge
  onSeek: (t: number | null) => void;
  markers?: Marker[];
  onMarker?: (m: Marker) => void;
  selectedLane?: string | null;
  lookbackLabel: string;
}) {
  const span = Math.max(1, end - start);
  const at = playhead ?? end;
  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - start) / span) * 100))}%`;
  const [said, setSaid] = useState<Marker | null>(null);
  const pick = (m: Marker) => { setSaid(m); onMarker?.(m); };

  return (
    <section aria-label="Mob timeline" className="mt-3 rounded-md border border-border bg-panel p-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dim">
        <b className="text-sm text-text">Timeline</b>
        <span>{lookbackLabel}, Eastern time</span>
        <span className="ml-auto flex items-center gap-2">
          <span className="text-text tabular-nums">{playhead == null ? 'live edge' : clock(playhead)}</span>
          {playhead != null && <span className="tabular-nums">{ago(end - playhead)}</span>}
          <button type="button" aria-pressed={playhead == null} onClick={() => onSeek(null)}
            className={`rounded border px-2.5 py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue ${
              playhead == null ? 'border-accent bg-accent text-white' : 'border-border bg-panel text-text hover:bg-[#21262d]'}`}>
            {playhead == null ? '● Live' : 'Back to live'}
          </button>
        </span>
      </div>

      <div className="relative h-16">
        <div className="absolute inset-x-0 top-9 h-px bg-border" aria-hidden />
        {markers.map(m => (
          <button key={`${m.kind}-${m.t}-${m.label}`} type="button" onClick={() => pick(m)}
            title={`${KIND[m.kind]}: ${m.label}, ${clock(m.t)}`}
            aria-label={`${KIND[m.kind]}: ${m.label}, ${clock(m.t)}. Jump there.`}
            style={{ left: pct(m.t) }}
            className={`absolute top-0 flex h-9 w-7 -translate-x-1/2 items-center justify-center text-base leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue ${TONE[m.kind]} ${m.lane && m.lane === selectedLane ? 'font-bold underline' : ''}`}>
            {GLYPH[m.kind]}
          </button>
        ))}
        <div className="pointer-events-none absolute top-0 h-10 w-px bg-white/80" style={{ left: pct(at) }} aria-hidden />
        <input type="range" min={start} max={end} step={1000} value={Math.min(end, Math.max(start, at))}
          aria-label="Time on the map" aria-valuetext={playhead == null ? 'live edge' : clock(playhead)}
          onChange={e => { const v = Number(e.target.value); onSeek(v >= end - 1500 ? null : v); }}
          style={{ accentColor: '#58a6ff' }}
          className="absolute inset-x-0 bottom-0 h-7 w-full cursor-pointer" />
      </div>

      {markers.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Moments">
          {markers.map(m => (
            <li key={`c-${m.kind}-${m.t}-${m.label}`}>
              <button type="button" onClick={() => pick(m)}
                className="rounded border border-border bg-panel px-2 py-1.5 text-xs text-text hover:bg-[#21262d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue">
                <span className="tabular-nums text-dim">{clockMin(m.t)}</span>{' '}
                <span className={TONE[m.kind]}>{GLYPH[m.kind]}</span>{' '}
                {m.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-dim">
        <span className="text-red">✕</span> boss died · <span className="text-gold">▲</span> pulled hard (3+ raiders on it) · <span>›</span> raid changed zone.
        {said && <> Showing <span className="text-text">{said.label}</span> at {clock(said.t)}.</>}
      </p>
    </section>
  );
}
