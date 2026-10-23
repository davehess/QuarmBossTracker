'use client';
// The night on one time axis: three rows over the whole window.
//   top      the segments an officer confirmed (or is drafting): a bar each, coloured by kind.
//   middle   the named fights: a green dot for a kill, a red cross for a wipe, an orange ring for another guild's fight.
//   bottom   the recording (a grey bar where minutes were recorded, so a hole reads as a hole) and, in red, each moment
//            of mass death with its count.
// Everything with a time seeks the replay (`onSeek`). The axis is hourly, in Eastern time.
import { MINUTE_MS, type Span } from '@/lib/raidReplay';
import { KIND_LABEL, type FightMark, type MassDeath, type SliceKind } from '@/lib/nightSlices';
import { KIND_BAR, etHour, etMin, fmtDur, plural } from './nightStyle';

export type StripSlice = { id: string; fromMs: number; toMs: number; kind: SliceKind; label: string; draft?: boolean };

const HOUR_MS = 60 * MINUTE_MS;

export default function NightStrip({ fromMs, toMs, spans, fights, mass, slices, onSeek, drawRule }: {
  fromMs: number; toMs: number;
  spans: readonly Span[]; fights: readonly FightMark[]; mass: readonly MassDeath[];
  slices: readonly StripSlice[];
  onSeek?: (ms: number) => void;
  /** What the segments row says when it is empty. */
  drawRule?: string;
}) {
  const span = Math.max(1, toMs - fromMs);
  const pct = (ms: number) => `${(Math.min(toMs, Math.max(fromMs, ms)) - fromMs) / span * 100}%`;
  const width = (a: number, b: number) => `${Math.max(0.4, (Math.min(toMs, b) - Math.max(fromMs, a)) / span * 100)}%`;

  const ticks: number[] = [];
  for (let t = Math.ceil(fromMs / HOUR_MS) * HOUR_MS; t < toMs; t += HOUR_MS) ticks.push(t);
  const tickEvery = ticks.length > 14 ? 2 : 1;

  return (
    <div className="select-none">
      {/* segments */}
      <div className="relative h-9 rounded border border-border bg-bg" role="group" aria-label="Segments of the night">
        {slices.length === 0 && (
          <span className="pointer-events-none absolute inset-0 flex items-center px-2 text-xs text-dim">{drawRule ?? 'No segments yet.'}</span>
        )}
        {slices.map(s => (
          <div key={s.id}
            title={`${KIND_LABEL[s.kind]}${s.label ? `: ${s.label}` : ''}, ${etMin.format(s.fromMs)} to ${etMin.format(s.toMs)} ET`}
            style={{ left: pct(s.fromMs), width: width(s.fromMs, s.toMs) }}
            className={`absolute top-0.5 bottom-0.5 overflow-hidden whitespace-nowrap rounded border px-1.5 text-left text-[11px] leading-7 ${KIND_BAR[s.kind]} ${s.draft ? 'opacity-80' : ''}`}>
            {s.label || KIND_LABEL[s.kind]}
          </div>
        ))}
      </div>

      {/* fights */}
      <div className="relative mt-1 h-6" role="group" aria-label="Named fights">
        {fights.map(f => {
          const other = f.tag === 'foreign';
          const wipe = f.result === 'wipe';
          return (
            <button key={f.id} type="button" onClick={() => onSeek?.(f.startMs)} style={{ left: pct(f.startMs) }}
              title={`${f.name}: ${wipe ? 'wipe' : 'kill'}${other ? ", another guild's" : f.tag ? ` (${f.tag})` : ''}, ${etMin.format(f.startMs)} ET${f.durationSec != null ? `, ${fmtDur(f.durationSec)}` : ''}`}
              aria-label={`${f.name}, ${wipe ? 'wipe' : 'kill'}${other ? ", another guild's fight" : ''}, ${etMin.format(f.startMs)}`}
              className={`absolute top-1 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full text-[10px] leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue ${
                other ? 'border-2 border-orange text-orange' : wipe ? 'text-red' : 'bg-green text-bg'}`}>
              {wipe ? '✕' : null}
            </button>
          );
        })}
      </div>

      {/* recording and mass deaths */}
      <div className="relative mt-0.5 h-4" role="group" aria-label="Recording and mass deaths">
        {spans.map((s, i) => (
          <div key={i} aria-hidden="true" className="absolute top-1.5 h-1 rounded bg-border" style={{ left: pct(s.from), width: width(s.from, s.to) }} />
        ))}
        {mass.map((m, i) => (
          <button key={i} type="button" onClick={() => onSeek?.(m.fromMs)} style={{ left: pct(m.fromMs), width: width(m.fromMs, m.toMs) }}
            title={`${plural(m.count, 'death')} within a minute, ${etMin.format(m.fromMs)} ET`}
            aria-label={`Mass death: ${plural(m.count, 'death')} at ${etMin.format(m.fromMs)}`}
            className="absolute top-0 h-4 min-w-[6px] rounded-sm bg-red/80 text-[9px] font-medium leading-4 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue">
            <span className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 whitespace-nowrap text-[10px] text-red">{m.count}</span>
          </button>
        ))}
      </div>

      {/* axis */}
      <div className="relative mt-3 h-4 text-[10px] text-dim" aria-hidden="true">
        {ticks.filter((_, i) => i % tickEvery === 0).map(t => (
          <span key={t} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pct(t) }}>{etHour.format(t)}</span>
        ))}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-dim">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-green align-middle" />kill</span>
        <span><span className="mr-1 text-red">✕</span>wipe</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full border-2 border-orange align-middle" />another guild&apos;s fight</span>
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm bg-red/80 align-middle" />mass death (number of deaths)</span>
        <span><span className="mr-1 inline-block h-1 w-3 rounded bg-border align-middle" />recorded</span>
      </p>
    </div>
  );
}
