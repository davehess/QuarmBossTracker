'use client';
// "Start a new raid here" on the raid session review. Two raids that ran back to back are one recorded
// session, so the review shows both. This cuts the window in two at a minute and offers each half as its own page
// (Open) and as its own public link (Share…, the officer's existing flow, for exactly that half). Nothing is saved
// when a cut is made: a split is just two windows (lib/raidSplit.ts).
//
// The cut starts from the replay's playhead, from any ✂ beside a time in the lists (`request`), or from the loader's
// suggestion (`hint`: the roster after some minute is mostly different people from the roster before it, see
// raidSplit.ts). The hint opens this panel at that minute, so its Open / Share… pair is the same one.
import { useEffect, useState, type MutableRefObject } from 'react';
import Link from 'next/link';
import { MINUTE_MS } from '@/lib/raidReplay';
import { snapCut, splitWindows, type RaidChange, type Win } from '@/lib/raidSplit';
import ShareControls from './ShareControls';

const etMin = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const etDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });

const chip = 'rounded border px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors '
  + 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue';
const chipIdle = 'border-border bg-panel text-text hover:bg-[#21262d]';
const chipOn = 'border-accent bg-accent text-white';

const fmtSpan = (ms: number) => {
  const m = Math.round(ms / MINUTE_MS);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
};
const sessionHref = (w: Win) => `/raid/session?from=${encodeURIComponent(new Date(w.fromMs).toISOString())}&to=${encodeURIComponent(new Date(w.toMs).toISOString())}`;

export type SplitRequest = { cut: number; n: number };

export default function SplitPanel({ fromMs, toMs, playheadRef, request, hint, live, canShare }: {
  fromMs: number; toMs: number;
  /** The replay's playhead, written by the board (epoch ms); null or at the window's start until it has moved. */
  playheadRef: MutableRefObject<number | null>;
  /** A ✂ beside a time in a list: open the panel at that time (n changes on every request). */
  request: SplitRequest | null;
  /** The suggestion, when the roster turns over inside the window. */
  hint: RaidChange | null;
  /** The window's last minute is recent: the second half is a raid still running. */
  live: boolean;
  /** An officer: each half gets a Share… button. */
  canShare: boolean;
}) {
  const win: Win = { fromMs, toMs };
  const [state, setState] = useState<{ cut: number; from: 'hint' | 'manual' } | null>(() => {
    const c = hint ? snapCut(hint.atMs, win) : null;
    return c == null ? null : { cut: c, from: 'hint' };
  });

  const reqN = request?.n ?? 0;
  const reqCut = request?.cut ?? null;
  useEffect(() => {
    if (!reqN || reqCut == null) return;
    const c = snapCut(reqCut, { fromMs, toMs });
    if (c != null) setState({ cut: c, from: 'manual' });
  }, [reqN, reqCut, fromMs, toMs]);

  /** The playhead when it has moved; otherwise the suggestion, otherwise the middle of the window. */
  const startAt = (ms: number | null) => {
    const t = ms != null && ms > fromMs + MINUTE_MS ? ms : (hint?.atMs ?? fromMs + (toMs - fromMs) / 2);
    const c = snapCut(t, win);
    if (c != null) setState({ cut: c, from: 'manual' });
  };
  const nudge = (min: number) => setState(s => {
    if (!s) return s;
    const c = snapCut(s.cut + min * MINUTE_MS, win);
    return c == null ? s : { cut: c, from: 'manual' };
  });

  const halves = state ? splitWindows(win, state.cut) : null;
  const hintCut = hint ? snapCut(hint.atMs, win) : null;

  const half = (label: 'Before' | 'After', w: Win) => {
    const isLive = label === 'After' && live;
    const open = <Link href={sessionHref(w)} className={`${chip} ${chipIdle}`}>Open</Link>;
    return (
      <div className="min-w-0 rounded border border-border bg-bg p-2.5">
        <p className="text-[11px] uppercase tracking-wider text-dim">{label}{isLive && <span className="ml-1.5 normal-case tracking-normal text-green">(live)</span>}</p>
        <p className="mb-2 mt-0.5 text-sm tabular-nums">
          {etMin.format(w.fromMs)} – {etMin.format(w.toMs)} <span className="text-xs text-dim">· {fmtSpan(w.toMs - w.fromMs)}</span>
        </p>
        {canShare
          ? <ShareControls key={`${w.fromMs}|${w.toMs}|${label}`} fromIso={new Date(w.fromMs).toISOString()} toIso={new Date(w.toMs).toISOString()}
              defaultTitle={`Raid session, ${etDay.format(w.fromMs)}, from ${etMin.format(w.fromMs)}`} defaultFollow={isLive} lead={open} />
          : open}
      </div>
    );
  };

  return (
    <div>
      <button type="button" aria-expanded={!!state} onClick={() => (state ? setState(null) : startAt(playheadRef.current))}
        className={`${chip} ${state ? chipOn : chipIdle}`}>
        ✂ Start a new raid here
      </button>
      {state && halves && (
        <div className="mt-2 rounded-md border border-border bg-panel p-3 text-sm" role="group" aria-label="Start a new raid here">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className={`min-w-0 flex-1 ${state.from === 'hint' ? 'text-gold' : 'text-text'}`}>
              {state.from === 'hint'
                ? <>Looks like a different raid from {etMin.format(state.cut)} — split here?</>
                : <>New raid from {etMin.format(state.cut)} ET</>}
            </p>
            <button type="button" onClick={() => setState(null)} aria-label="Close" className={`${chip} ${chipIdle} py-1`}>✕</button>
          </div>
          <p className="mt-1 text-xs text-dim">
            This only cuts the window in two. Nothing is saved: each half is its own page to open, and its own link to share.
            {state.from === 'hint' && ' Guessed from who was on the recording: most of the raiders after this minute were not there before it.'}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Move the cut">
            <span className="mr-1 text-xs text-dim">Move the cut</span>
            {[-5, -1, 1, 5].map(m => (
              <button key={m} type="button" onClick={() => nudge(m)} aria-label={`${m < 0 ? 'Earlier' : 'Later'} by ${Math.abs(m)} ${Math.abs(m) === 1 ? 'minute' : 'minutes'}`}
                className={`${chip} ${chipIdle} tabular-nums`}>{m > 0 ? `+${m}` : `−${-m}`}</button>
            ))}
            <button type="button" onClick={() => startAt(playheadRef.current)} className={`${chip} ${chipIdle}`}>At the playhead</button>
            {hintCut != null && hintCut !== state.cut && (
              <button type="button" onClick={() => setState({ cut: hintCut, from: 'hint' })} className={`${chip} ${chipIdle}`}>At the suggestion</button>
            )}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {half('Before', halves.before)}
            {half('After', halves.after)}
          </div>
        </div>
      )}
    </div>
  );
}
