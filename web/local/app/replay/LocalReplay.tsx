'use client';

// My replay, built on this PC. The website's own replay board (web/app/spectator/replay/ReplayBoard.tsx) in BOUNDED
// mode, with every route pointed at the agent on the same origin: the nights and the 15-minute windows come from the
// recorder Mimic keeps for the raids you were in (GET /api/local/track/*), the boss kills from the agent's own fight
// records, the map lines from the Brewall files this PC already reads for the Mimic map. Nothing is uploaded.
//
// What the website has and this does not: the 3D view and the parchment's floor wash (both need a zone mesh the agent
// does not hold; the board is mounted `flat`, so the switch is off and the parchment falls back to paper and ink),
// and Live (bounded mode never offers it). The raid timeline strip rides on the board's `timeline` prop, fed from the
// same boss list and the playhead, exactly as /spectator/replay does it.
import { useCallback, useEffect, useMemo, useState } from 'react';
import ReplayBoard, { type BoundedReplay } from '@/app/spectator/replay/ReplayBoard';
import {
  MINUTE_MS, defaultSessionIndex, sessionLabel, summarizeNights,
  type NightMinute, type NightSummary, type ReplaySession,
} from '@/lib/raidReplay';

const API = '/api/local/track';

/** The routes the board reads. `baseMs` is the window's first minute, so the board's 15-minute windows line up. */
function localUrls(): BoundedReplay['urls'] {
  return {
    window: (night, fromIso, toIso) => `${API}?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&night=${encodeURIComponent(night)}`,
    bosses: night => `${API}/bosses?night=${encodeURIComponent(night)}`,
    map: zone => `${API}/map?zone=${encodeURIComponent(zone)}`,
    mesh: zone => `${API}/mesh?zone=${encodeURIComponent(zone)}`,   // never asked: the board is flat
  };
}

/** One session played as if it were the whole night: its first and last minute, spans and zone visits. */
function sessionNight(n: NightSummary, s: ReplaySession): NightSummary {
  return {
    ...n,
    first: new Date(s.from).toISOString(),
    last: new Date(s.to - MINUTE_MS).toISOString(),
    minutes: s.minutes,
    zones: s.zones,
    runs: s.runs,
    spans: s.spans,
    sessions: [],   // bounded mode plays the window as it is
  };
}

const etDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
const select = 'rounded border border-border bg-panel px-2 py-1.5 text-xs text-text';

export default function LocalReplay() {
  const [nights, setNights] = useState<NightSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nightKey, setNightKey] = useState<string | null>(null);
  const [sessionFrom, setSessionFrom] = useState<number | null>(null);

  const load = useCallback(() => {
    fetch(`${API}/nights`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`the agent answered ${r.status}`))))
      .then((j: { rows?: NightMinute[] }) => { setNights(summarizeNights(Array.isArray(j.rows) ? j.rows : [])); setErr(null); })
      .catch((e: Error) => setErr(e.message || 'could not reach the agent'));
  }, []);
  // Once on open, and again when the window regains focus: a raid you just finished is in the list on tab-back.
  useEffect(() => {
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const night = useMemo(() => nights?.find(n => n.night_key === nightKey) ?? nights?.[0] ?? null, [nights, nightKey]);
  const session = useMemo(() => {
    if (!night) return null;
    return night.sessions.find(s => s.from === sessionFrom) ?? night.sessions[defaultSessionIndex(night.sessions)] ?? null;
  }, [night, sessionFrom]);
  const bounded = useMemo<BoundedReplay | null>(
    () => (night && session ? { night: sessionNight(night, session), urls: localUrls(), flat: true } : null),
    [night, session]);

  return (
    <div className="space-y-4">
      <section className="bg-panel border border-border rounded-lg p-6">
        <div className="flex items-start gap-3">
          <h2 className="text-2xl text-gold mb-1"><span aria-hidden>🎬 </span>My replay</h2>
          <button type="button" onClick={load}
            className="ml-auto text-[11px] px-2 py-0.5 rounded border border-border text-dim hover:text-text">
            Reload
          </button>
        </div>
        <div className="text-sm text-dim leading-6">
          Play back where you and your raid stood, minute by minute, from the recording Mimic keeps <b className="text-text">on this PC</b>{' '}
          while you play with Zeal connected. Pick a night and drag the time slider, or press play. Solo or in a group, it records just you.
        </div>
        {nights && nights.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-dim">
            <label className="flex items-center gap-1.5">
              <span>Night</span>
              <select className={select} value={night?.night_key ?? ''} onChange={e => { setSessionFrom(null); setNightKey(e.target.value); }}>
                {nights.map(n => (
                  <option key={n.night_key} value={n.night_key}>
                    {n.night_key} · {etDay.format(Date.parse(n.first))} · {n.sessions.length} {n.sessions.length === 1 ? 'session' : 'sessions'}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span>Session</span>
              <select className={select} value={session?.from ?? ''} onChange={e => setSessionFrom(Number(e.target.value))}>
                {(night?.sessions ?? []).map(s => <option key={s.from} value={s.from}>{sessionLabel(s)}</option>)}
              </select>
            </label>
          </div>
        )}
      </section>

      {err && (
        <p className="rounded-md border border-border bg-panel p-4 text-sm text-orange">
          Could not read the recording: {err}. Is Mimic running?
        </p>
      )}
      {!err && nights && nights.length === 0 && (
        <p className="rounded-md border border-border bg-panel p-4 text-sm text-dim">
          Nothing is recorded yet. Mimic starts a recording when Zeal is connected and you are in a zone; play a while and
          it appears here.
        </p>
      )}
      {!err && !nights && <p className="text-sm text-dim">Reading the recording…</p>}
      {bounded && (
        // The board reads its night once, so another session is another board.
        <ReplayBoard key={`${bounded.night.night_key}|${bounded.night.first}`} bounded={bounded} timeline />
      )}
      <p className="text-xs text-dim">
        Positions are the ones Zeal reported to Mimic on this PC. Map lines: Brewall&apos;s EverQuest maps, read from the files Mimic keeps on this PC.
        Boss kills come from your own fight log.
      </p>
    </div>
  );
}
