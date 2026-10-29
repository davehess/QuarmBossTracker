'use client';
// /spectator?v=b and ?v=c: the live board with the mobs on it and a timeline you can click into (the guild lead,
// 2026-10-29: "show mobs more in the spectator view" and "a timeline view that lets us click in on those").
//
//   B  "Mobs on the map"       the map is the page; a scrub strip under it carries a marker for every kill, hard pull
//                              and zone change. Click one and the map plays that moment.
//   C  "Fight timeline first"  a row per mob on a time axis is the page; the map is its companion. Click a row (or a
//                              moment on it) and the map centres on that mob at that time.
//
// Both are the SAME board (SpectatorBoard, handed a feed and a mobs layer) over the SAME record: the last 30 or 45
// minutes of recorded minutes (useMobHistory). At the live edge the raiders are the bot's 3-second feed and the mobs
// are the newest recorded sample (1 to 2 minutes behind: the recorder writes a minute at a time); with the playhead
// back in time BOTH come from the recording, so a moment is one consistent picture. Without ?v= the page is as it was.
import { useCallback, useEffect, useMemo, useState } from 'react';
import SpectatorBoard from './SpectatorBoard';
import MobStrip, { ago, clock } from './MobStrip';
import MobLanes, { LaneDetail } from './MobLanes';
import { useMobHistory } from './useMobHistory';
import { useScreenLive } from '@/lib/useScreenLive';
import { frameIndexAt } from '@/lib/raidReplay';
import {
  buildMarkers, buildMobLanes, framePositions, lanePositionAt, liveEdge, sightingsAt,
  type Marker, type MobDot, type MobLane, type SpawnTrack,
} from '@/lib/mobTrack';
import type { PositionsFeed } from '@/lib/screenLive';

// A recorded sample is never stale; the board decides that from rxAt, so the recording's feed claims to be from the future.
const NEVER_STALE = Date.now() + 10 * 365 * 86_400_000;
const MIN = 60_000;
const C_ROWS = 14;

export default function SpectatorMobs({ variant }: { variant: 'b' | 'c' }) {
  const lookbackMs = (variant === 'c' ? 45 : 30) * MIN;
  const hist = useMobHistory(lookbackMs);
  const live = useScreenLive();
  const { frames, kills } = hist;

  const [playhead, setPlayhead] = useState<number | null>(null);   // null = the live edge
  const [pick, setPick] = useState<string | null>(null);           // a lane key
  const [focus, setFocus] = useState<{ x: number; y: number; k: number } | null>(null);
  const [allRows, setAllRows] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const start = frames.length ? frames[0].t : 0;
  const end = frames.length ? frames[frames.length - 1].t : 0;
  const hasRange = frames.length > 1 && end - start >= MIN;
  const ph = playhead == null || !hasRange ? null : Math.min(end, Math.max(start, playhead));   // the lookback slides: keep it on the axis

  const frame = ph != null ? frames[frameIndexAt(frames, ph)] : undefined;
  const zoneNames = useMemo(() => new Map((live.feed?.data.zones ?? []).map(z => [z.zone, z.name])), [live.feed]);
  const feed = useMemo<PositionsFeed | null>(
    () => (frame ? { data: framePositions(frame, zoneNames), rxAt: NEVER_STALE } : live.feed),
    [frame, zoneNames, live.feed],
  );
  const shared = useMemo(() => ({ feed, netErr: live.netErr, signedOut: live.signedOut }), [feed, live.netErr, live.signedOut]);

  const edge = liveEdge(frames, now);
  const at = ph ?? edge;
  const dots = useMemo<MobDot[]>(() => (at == null ? [] : sightingsAt(frames, at, kills)), [frames, kills, at]);
  const lanes = useMemo(() => buildMobLanes(frames, kills), [frames, kills]);
  const markers = useMemo(() => (variant === 'b' && hasRange ? buildMarkers(frames, lanes, kills, start, end) : []), [variant, hasRange, frames, lanes, kills, start, end]);
  const lane = lanes.find(l => l.key === pick) ?? null;

  const lookAt = useCallback((laneKey: string, t: number, sid?: number | null) => {
    const p = lanePositionAt(frames, laneKey, t, sid);
    if (p) setFocus({ x: p.x, y: p.y, k: Date.now() });
  }, [frames]);

  const seek = (t: number | null) => setPlayhead(t);
  const pickLane = (l: MobLane, t: number) => {
    setPick(l.key);
    setPlayhead(t);
    lookAt(l.key, t);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      document.getElementById('mob-map')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };
  const pickMarker = (m: Marker) => {
    setPlayhead(m.t);
    if (m.lane) { setPick(m.lane); lookAt(m.lane, m.t); }
  };
  const pickSpawn = (s: SpawnTrack) => {
    if (!lane) return;
    setPlayhead(s.first);
    lookAt(lane.key, s.first, s.sid);
  };

  const layer = {
    dots, selected: pick, focus,
    onPick: (d: MobDot | null) => {
      setPick(d ? d.lane : null);
      if (d && at != null) setFocus({ x: d.x, y: d.y, k: Date.now() });
    },
  };

  const note = hist.status === 'signedout' ? 'Your session ended. Sign in again to see the mobs.'
    : hist.status === 'loading' ? 'Reading the last few minutes of recorded raid…'
    : hist.status === 'error' && !frames.length ? 'The recorder is not answering right now. The board shows the raiders only.'
    : !frames.length ? `No recorded minutes in the last ${lookbackMs / MIN} minutes, so no mobs yet. The recorder writes a minute at a time while a raid is on.`
    : ph != null ? `Showing ${clock(ph)}: raiders and mobs as recorded, ${ago(end - ph)}.`
    : edge == null ? 'The newest recorded minute is more than five minutes old, so no mobs are shown.'
    : `${dots.length} ${dots.length === 1 ? 'mob' : 'mobs'} on the map as of ${ago(now - edge)} (the recorder writes a minute at a time); the raiders are live.`;

  const legend = (
    <p className="mt-2 text-xs text-dim">
      <span className="text-red">◆</span> a mob the raid had targeted (bigger = more raiders on it) · <span className="text-red">●</span> a boss (✕ once it has died).
      Tap a mob to pick it{variant === 'c' ? ' and light up its row' : ' and see its details below the timeline'}. Mobs nobody targeted are not recorded.
    </p>
  );

  const status = <p role="status" className="mb-2 text-xs text-dim">{note}</p>;

  if (variant === 'b') {
    return (
      <div className="min-w-0">
        {status}
        <SpectatorBoard shared={shared} mobs={layer} />
        {legend}
        {hasRange && (
          <MobStrip start={start} end={end} playhead={ph} onSeek={seek} markers={markers} onMarker={pickMarker}
            selectedLane={pick} lookbackLabel={`last ${lookbackMs / MIN} minutes`} />
        )}
        {lane && (
          <div className="mt-3">
            <LaneDetail lane={lane} playhead={ph} end={end} onSeek={t => { setPlayhead(t); lookAt(lane.key, t); }} onSpawn={pickSpawn} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      {status}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div id="mob-map" className="order-1 min-w-0 lg:order-2 lg:sticky lg:top-2 lg:self-start">
          <SpectatorBoard embedded shared={shared} mobs={layer} />
          {legend}
        </div>
        <div className="order-2 min-w-0 lg:order-1">
          {hasRange ? (
            <>
              <MobStrip start={start} end={end} playhead={ph} onSeek={seek} lookbackLabel={`last ${lookbackMs / MIN} minutes`} />
              <section aria-label="Mobs on a timeline" className="mt-3 rounded-md border border-border bg-panel p-3">
                <div className="mb-2 flex flex-wrap items-baseline gap-x-3 text-xs text-dim">
                  <b className="text-sm text-text">Fights</b>
                  <span>one row per mob · taller = more raiders on it · darker = more spawns at once</span>
                </div>
                {lanes.length ? (
                  <MobLanes lanes={lanes} start={start} end={end} playhead={ph} selected={pick} onPick={pickLane} rows={allRows ? lanes.length : C_ROWS} />
                ) : (
                  <p className="text-xs text-dim">The raid has not targeted a mob in this stretch.</p>
                )}
                {lanes.length > C_ROWS && (
                  <button type="button" onClick={() => setAllRows(a => !a)} aria-pressed={allRows}
                    className="mt-2 rounded border border-border bg-panel px-2.5 py-1.5 text-xs text-text hover:bg-[#21262d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue">
                    {allRows ? 'Show the top few' : `Show all ${lanes.length}`}
                  </button>
                )}
              </section>
              {lane && (
                <div className="mt-3">
                  <LaneDetail lane={lane} playhead={ph} end={end} onSeek={t => { setPlayhead(t); lookAt(lane.key, t); }} onSpawn={pickSpawn} />
                </div>
              )}
            </>
          ) : (
            <p className="rounded-md border border-border bg-panel p-3 text-xs text-dim">
              The timeline fills in once the recorder has a couple of minutes of this raid.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
