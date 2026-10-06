'use client';
// The /screen board: one page the whole raid watches. An officer (the "leader only" bar) picks Map, Slides,
// Loot or Overview; everyone else's page polls /api/screen/state every few seconds and follows.
//
// Three feeds, each polled on its own and paused while the tab is hidden:
//   /api/screen/state      every STATE_POLL_MS   the mode, the slide, who is driving   (the thing that follows)
//   /api/screen/feed       every FEED_POLL_MS    loot, boss kills, next spawns
//   /api/spectator/positions  every POSITIONS_POLL_MS  who is where (the Map mode polls it faster itself)
//
// Rules this file keeps (the spectator board's, which it embeds):
//   * No animation. This is read from across a room or between pulls, and motion steals the eye.
//   * Colour is never the only carrier: Live / Reconnecting is a word, a mode is a labelled button.
//   * While the officer's own click is in flight, a poll that lands first does not undo it.
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import SpectatorBoard from '@/app/spectator/SpectatorBoard';
import {
  FEED_POLL_MS, MODE_LABEL, SCREEN_MODES, STATE_POLL_MS, TONIGHT_H, agoText, isScreenMode, untilText,
  type ScreenFeed, type ScreenMode, type ScreenState,
} from '@/lib/raidScreen';
import type { Positions } from '@/lib/spectator';
import SlideEditor from './SlideEditor';
import { LootView, OverviewView, SlidesView, SpawnList, card, label } from './ScreenPanels';

const POSITIONS_POLL_MS = 8000;

// The map is the spectator board with its own chrome dropped. Memoised so the rail's clock does not redraw it.
const MapPanel = memo(function MapPanel() { return <SpectatorBoard embedded />; });

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/**
 * Poll `url` every `ms`, one request at a time, paused while the tab is hidden and resumed the moment it is
 * shown. `data` gets each good answer, `fail` each bad one (status 401 stops the poll for good). The returned
 * function polls again now (after an officer's click, so the page does not wait out the interval).
 */
function usePoll<T>(url: string, ms: number, data: (d: T) => void, fail: (status: number) => void) {
  const handlers = useRef({ data, fail });
  handlers.current = { data, fail };
  const kick = useRef<() => void>(() => {});
  useEffect(() => {
    let stop = false;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ctrl: AbortController | undefined;
    const run = async () => {
      timer = undefined;
      if (stop || busy || document.hidden) return;
      busy = true;
      ctrl = new AbortController();
      try {
        const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
        if (res.status === 401) { handlers.current.fail(401); stop = true; return; }
        if (!res.ok) throw new Error('status ' + res.status);
        const j = await res.json();
        if (!stop) handlers.current.data(j as T);
      } catch (e) {
        if (!stop && (e as Error)?.name !== 'AbortError') handlers.current.fail(0);
      } finally {
        busy = false;
      }
      if (!stop && !document.hidden) timer = setTimeout(run, ms);
    };
    const onVisibility = () => {
      if (document.hidden) { if (timer) clearTimeout(timer); timer = undefined; ctrl?.abort(); }
      else if (!timer && !busy) run();
    };
    kick.current = () => { if (timer) clearTimeout(timer); timer = undefined; run(); };
    document.addEventListener('visibilitychange', onVisibility);
    run();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
      ctrl?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [url, ms]);
  return useCallback(() => kick.current(), []);
}

const modeBtn = 'rounded border px-3 py-1.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue disabled:opacity-60';

export default function ScreenBoard({ canDrive }: { canDrive: boolean }) {
  const [state, setState] = useState<ScreenState | null>(null);
  const [stateErr, setStateErr] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [feed, setFeed] = useState<ScreenFeed | null>(null);
  const [positions, setPositions] = useState<Positions | null>(null);
  const [busy, setBusy] = useState(false);
  const [driveErr, setDriveErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const flying = useRef(false);
  const stateRef = useRef<ScreenState | null>(null);
  stateRef.current = state;
  const panelNow = useNow(10_000);

  const fail = (status: number) => { if (status === 401) setSignedOut(true); };

  const kickState = usePoll<ScreenState>('/api/screen/state', STATE_POLL_MS, d => {
    if (!isScreenMode(d?.mode) || typeof d.slideCount !== 'number') { setStateErr(true); return; }
    // The officer's own click is on its way: let its answer, not this older one, be what shows.
    if (flying.current) return;
    setState(d); setStateErr(false);
  }, s => { fail(s); if (s !== 401) setStateErr(true); });

  usePoll<ScreenFeed>('/api/screen/feed', FEED_POLL_MS, d => {
    if (Array.isArray(d?.awards) && Array.isArray(d?.looted) && Array.isArray(d?.kills) && Array.isArray(d?.spawns)) setFeed(d);
  }, fail);

  usePoll<Positions>('/api/spectator/positions', POSITIONS_POLL_MS, d => {
    if (Array.isArray(d?.raiders) && Array.isArray(d?.zones)) setPositions(d);
  }, fail);

  // What the officer picked, applied here at once and then confirmed by the server's answer.
  const drive = useCallback(async (patch: { mode?: ScreenMode; slideIndex?: number }) => {
    if (!canDrive) return;
    flying.current = true;
    setBusy(true);
    setDriveErr(null);
    setState(s => (s ? { ...s, ...patch, slide: patch.mode && patch.mode !== 'slides' ? null : s.slide } : s));
    try {
      const res = await fetch('/api/screen/state', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        setDriveErr(j?.error ?? `That did not work (${res.status}).`);
      } else if (isScreenMode(j?.mode)) {
        setState(j as ScreenState); setStateErr(false);
      }
    } catch {
      setDriveErr('The screen did not answer. Try again.');
    } finally {
      flying.current = false;
      setBusy(false);
      kickState();
    }
  }, [canDrive, kickState]);

  const step = (delta: -1 | 1) => {
    const s = stateRef.current;
    if (s) void drive({ mode: 'slides', slideIndex: s.slideIndex + delta });
  };

  if (signedOut) {
    return (
      <div role="status" className={`${card} px-4 py-10 text-center text-sm text-dim`}>
        Your session ended. <a href="/auth/signin?next=/screen" className="underline">Sign in again</a> to see the raid screen.
      </div>
    );
  }

  // Until the first answer the Map is shown, which is also what a screen nobody has driven yet shows.
  const mode: ScreenMode = state?.mode ?? 'map';
  // "4 min ago" and "closes in 2m" in the main panel: a coarse clock is enough, and the memoised map is not
  // redrawn by it (the rail keeps its own, faster one).
  const live = !!state && !stateErr;

  return (
    <div className="min-w-0">
      <div className={`${card} mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2`}>
        {canDrive && (
          <>
            <span className="rounded border border-gold/50 bg-gold/10 px-1.5 py-0.5 text-[10px] tracking-wider text-gold">LEADER ONLY</span>
            <div role="group" aria-label="Screen mode" className="flex flex-wrap gap-1.5">
              {SCREEN_MODES.map(m => (
                <button key={m} type="button" aria-pressed={mode === m} disabled={busy || !state}
                  onClick={() => { if (mode !== m) void drive({ mode: m }); }}
                  className={`${modeBtn} ${mode === m ? 'border-accent bg-accent text-white' : 'border-border bg-panel text-text hover:bg-[#21262d]'}`}>
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </>
        )}
        <span className={`inline-flex items-center gap-1.5 text-sm ${live ? 'text-green' : 'text-orange'}`}>
          <span aria-hidden className={`h-2 w-2 rounded-full ${live ? 'bg-green' : 'bg-orange'}`} />
          {live ? 'Live' : state ? 'Reconnecting…' : 'Connecting…'}
        </span>
        <span className="text-sm text-dim">
          Driving: <span className="text-gold">{state?.updatedBy ?? 'nobody yet'}</span>
        </span>
        {!canDrive && <span className="text-sm text-dim">Showing: <span className="text-text">{MODE_LABEL[mode]}</span></span>}
        {canDrive && <span className="ml-auto text-xs text-dim">only the raid leader sees this bar</span>}
        {driveErr && <span role="alert" className="basis-full text-xs text-red">{driveErr}</span>}
      </div>

      {/* Says what changed to a screen reader, since nothing else announces a switch the leader made. */}
      <p className="sr-only" role="status" aria-live="polite">{state ? `Showing ${MODE_LABEL[mode]}.` : ''}</p>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          {mode === 'map' && <MapPanel />}
          {mode === 'slides' && state && (
            <>
              <SlidesView state={state} canDrive={canDrive} busy={busy} editing={editing}
                onStep={step} onToggleEdit={() => setEditing(e => !e)} />
              {canDrive && editing && (
                <SlideEditor onChanged={kickState} onShow={i => void drive({ mode: 'slides', slideIndex: i })} />
              )}
            </>
          )}
          {mode === 'loot' && <LootView feed={feed} now={panelNow} />}
          {mode === 'overview' && <OverviewView positions={positions} feed={feed} now={panelNow} />}
        </div>

        <Rail state={state} feed={feed} positions={positions} />
      </div>
    </div>
  );
}

// ── The right rail: stacks under the main panel on a phone ──────────────────

function Rail({ state, feed, positions }: {
  state: ScreenState | null; feed: ScreenFeed | null; positions: Positions | null;
}) {
  const now = useNow(1000);
  const zone = positions && positions.zones[0];
  const lastKill = feed?.kills[0];
  const open = feed?.awards.filter(a => a.open) ?? [];
  const done = feed?.awards.filter(a => !a.open) ?? [];
  const lead = open.length ? open : done;

  return (
    <aside className="min-w-0 space-y-4" aria-label="Raid screen sidebar">
      <section className={card} aria-label="Now">
        <h2 className={`${label} border-b border-border px-3 py-2`}>Now</h2>
        <div className="space-y-1 px-3 py-3 text-sm">
          {zone
            ? <p className="text-text">{zone.name} <span className="text-dim">· {positions!.raiders.length} {positions!.raiders.length === 1 ? 'raider' : 'raiders'}</span></p>
            : <p className="text-dim">{positions ? 'No raid positions right now.' : 'Looking for the raid…'}</p>}
          <p className="text-dim">
            {lastKill
              ? <>Last kill: <span className="text-text">{lastKill.name}</span> {agoText(lastKill.at, now)}</>
              : feed ? `No boss kills in the last ${TONIGHT_H} h.` : ''}
          </p>
        </div>
      </section>

      <section className={card} aria-label="Next spawns">
        <h2 className={`${label} border-b border-border px-3 py-2`}>Next spawns · 24 h</h2>
        {feed ? <SpawnList spawns={feed.spawns} now={now} max={4} /> : <p className="px-3 py-4 text-sm text-dim">Loading…</p>}
      </section>

      <section className={card} aria-label="Loot">
        <h2 className={`${label} flex items-center gap-2 border-b border-border px-3 py-2`}>
          {open.length ? 'Up for bid' : 'Loot · awarded'}
          <span className="rounded bg-border px-1.5 text-text">{lead.length}</span>
        </h2>
        {!feed && <p className="px-3 py-4 text-sm text-dim">Loading…</p>}
        {feed && lead.length === 0 && <p className="px-3 py-4 text-sm text-dim">Nothing awarded in the last {TONIGHT_H} hours.</p>}
        <ul>
          {lead.slice(0, 3).map(a => (
            <li key={a.id} className="border-b border-border/60 px-3 py-2 last:border-b-0">
              <span className="block truncate text-text">{a.item}</span>
              <span className="block truncate text-xs text-dim">
                {a.open ? `closes in ${untilText(a.at, now)}` : agoText(a.at, now)}{a.who ? ` · ${a.who}` : ''}{a.dkp != null ? ` · ${a.dkp} DKP` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="px-1 text-xs text-dim">
        Driving: {state?.updatedBy ?? 'nobody yet'}
        {state?.updatedAt ? ` · updated ${agoText(state.updatedAt, now)}` : ''}
      </p>
    </aside>
  );
}
