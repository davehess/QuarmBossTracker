'use client';
// The /spectator/replay board: a recorded raid night played back on the same zone maps the live board uses.
//
// Rules this file keeps:
//   * The playhead, the frames and the views live in refs. React state holds only what the controls show
//     (the clock, the slider, the zones, the buffering note, the picks), updated a few times a second at most,
//     so a dot never costs a React render.
//   * One requestAnimationFrame loop, running only while playing (or while a follow is still gliding); a pause,
//     a scrub or a data arrival draws once through the same guard. A split screen is two panes drawn by that one
//     loop: two canvases, two views, one set of frames and one set of fetches.
//   * The data arrives in 15-minute windows (/api/spectator/replay). The window the playhead is in and the next
//     one are kept; the rest are dropped, so a whole night (~5.5 MB) is never held at once.
//   * A raid still being recorded keeps arriving (the guild lead, 2026-10-17: "spectator should continuously pull
//     fresh raid days so it can be used live data"): the night list is asked again every minute while the page is
//     visible and merged in place (lib/raidReplay.ts mergeNights), a window loaded short is asked for again once the
//     night grows past it, and Live follows the newest recorded minute at 1x. The data is about a minute behind real
//     time: the recorder writes a minute when the next one begins. Bounded mode (below) does none of this.
//   * Between two recorded frames (about 3 s apart) a dot is interpolated, so it glides instead of hopping.
//   * Picks (highlighted raiders, the followed one, the split mode) are state in the URL, see lib/replayFollow.ts.
//   * A night (a whole calendar day) is replayed one SESSION at a time: the guild raid by default, the daytime and
//     other groups as options. The slider and coverage track span only that session. `?session=` is in the URL.
//   * Auto-framing holds the view still while the nearest 80% of the raid is in it and glides when it is not,
//     snapping only on a scrub, a zone change or a session change (lib/replayFraming.ts).
//   * The raid's PATH (the guild lead, 2026-10-22; picked: the whole night's path, always on, with a Path toggle): the
//     night's path faint, solid up to the playhead, numbered kills. The path is computed here from the frames this board
//     already decodes (lib/replayPath.ts): no new query, and the share page needs no new route. It is kept per window
//     for the whole night (a point per frame), and the board also reads the windows the playhead has not reached, one
//     at a time, so the whole night is drawn without playing it.
//   * The 2D background is None / Lines / Parchment (`?bg=`, one choice for both panes, default Parchment). The
//     parchment is paper plus a floor wash generated from the EQEmu floors mesh (lib/zoneFloor.ts), painted once per
//     zone and size bucket in idle time by lib/parchmentStore.ts and only blitted per frame; the wall lines go on
//     top in ink. The 3D view has no background choice: its floors are the shaded surface (Replay3D.tsx).
// The coordinate rules (axis swap, north up, heading) live in lib/spectator.ts; the decoding and the split rule
// in lib/raidReplay.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  classAbbr, classColor, effectiveLayers, fitView, headingVec, layerBounds, lineNearZ, mapBox,
  median, nearestBand, parseZoneMap, scaleBarUnits, toScreen, zoomAt,
  type View, type ZoneMap,
} from '@/lib/spectator';
import {
  FRAME_GAP_MS, MINUTE_MS, NIGHTS_POLL_MS, REPLAY_WINDOW_MS, SPLIT_INIT, decodeRows, defaultSessionIndex, frameIndexAt,
  glideTargets, growSession, liveAvailable, liveLagging, livePlayhead, mergeNights, newNightToFollow, newestSession,
  nextSpanStart, openingPlayhead, parseSessionParam, pickReplayZone, pickSplit, recentTargetNames, sessionLabel, sessionSearch,
  trailSlackMs, windowIndex, windowNeedsRefetch, zoneCounts,
  type NightSummary, type ReplayFrame, type ReplayRaider, type ReplaySession, type ReplayTarget, type SplitState,
} from '@/lib/raidReplay';
import { FRAME_SNAP_MS, easeScale, frameStep } from '@/lib/replayFraming';
import {
  NO_PICKS, collectRoster, decayOffset, groupRoster, isFollowed, isPicked, offsetSettled, parsePicks, pickedSet,
  picksSearch, toggleFollow, togglePick, type Offset, type Picks, type RosterEntry,
} from '@/lib/replayFollow';
import { activeSpawns, bossesInWindow, normMobName, parseBosses, type ActiveSpawn, type SpawnBoss } from '@/lib/replayBosses';
import {
  PathStore, buildSegments, headAt, killMarks, rankKills, segmentsDone,
  type PathPt, type RouteFeed, type Segments,
} from '@/lib/replayPath';
import { bandColor, prepare, type Prepared } from '../SpectatorBoard';
import { BGS, bgSearch, inkColor, parseBg, type Bg } from '@/lib/mapBackdrop';
import { ParchmentStore, drawParchmentLayer, paintPaper } from '@/lib/parchmentStore';
import type { Bridge3D } from './Replay3D';
import RaidTimeline from '@/components/RaidTimeline';
import type { Kill } from '@/lib/raidTimeline';

// three.js is only fetched when the 3D view is first shown.
const Replay3D = dynamic(() => import('./Replay3D'), {
  ssr: false,
  loading: () => <MapNote>Loading 3D…</MapNote>,
});

const BG = '#0d1117';
const PANEL = '#161b22';
const BORDER = '#30363d';
const TEXT = '#c9d1d9';
const TARGET_RED = '#ef4444';
const BOSS_R = 13;                     // a killed boss (where the raid fought it, or its spawn point): a big red dot
const FONT = '12px "Cascadia Code", Consolas, ui-monospace, monospace';
const DOT_R = 4.5;
const TAIL_MS = 30_000;
const TELEPORT = 200;   // a raider who moved further than this between two frames did not walk it: no glide, no tail
const SPEEDS = [1, 10, 30, 60];
const FOLLOW_SPAN = 700;            // ground a fresh view on a followed raider shows
const RECORDED_LOOKBACK_MS = 30_000;   // a boss targeted this recently hides its spawn-point marker
const PATH_PAPER = '#1f6feb';          // the raid's path on the parchment (the accent): reads on paper and on the dark page
const PATH_DARK = '#58a6ff';           // ... and on the dark backgrounds (blue)
const KILL_GOLD = '#d29922';
const KILL_LABEL_MS = 3 * 60 * 1000;   // a kill is named beside its number for this long after it happens
const FILL_PAUSE_MS = 250;             // between two windows of the whole-night path fill

type MapEntry =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'error' }
  | { status: 'ready'; map: ZoneMap; prep: Prepared };

// `to`: how far the window reached when it came in (a window loaded short is stale once the night grows past it);
// `busy`: an 'ok' window being asked for again, which keeps drawing what it has meanwhile.
type Win = { state: 'loading' | 'ok' | 'err'; at: number; to: number; busy?: boolean };
type Drawn = { name: string; cls: string | null; hp: number | null; px: number; py: number };
type Placed = { r: ReplayRaider; x: number; y: number; z: number };

/** One map pane. Two exist; the second is shown only while the split is open. Plain mutable state: nothing here is rendered by React. */
type Pane = {
  cv: HTMLCanvasElement | null;
  wrap: HTMLDivElement | null;
  size: { w: number; h: number; dpr: number };
  view: View | null;
  fit: boolean;                  // auto-framing: the view keeps the nearest 80% of the raid in it (lib/replayFraming.ts)
  goal: View | null;             // the auto-framing glide under way, if any
  snapPending: boolean;          // the playhead jumped: the next framing is a snap, not a glide
  zoomGoal: number | null;       // the follow camera closing in: the zoom it is easing to
  zone: string | null;
  drawn: Drawn[];
  hover: string | null;
  off: Offset;                   // follow glide: camera - followed raider, decaying (screen-frame units)
  kick: boolean;                 // a follow just began: start the glide from where the view is
  lastTs: number;
  holdsFollow: boolean;
  ptrs: Map<number, { x: number; y: number }>;
  moved: number;
  pinch: number;
  pathSeg: { series: readonly PathPt[]; seg: Segments } | null;   // the path's joined pairs, rebuilt only when the path changes
};
const newPane = (): Pane => ({
  cv: null, wrap: null, size: { w: 0, h: 0, dpr: 1 }, view: null, fit: true, goal: null, snapPending: false, zoomGoal: null, zone: null, drawn: [], hover: null,
  off: { x: 0, y: 0 }, kick: false, lastTs: 0, holdsFollow: false, ptrs: new Map(), moved: 0, pinch: 0, pathSeg: null,
});

type PaneArgs = {
  t: number; zone: string | null; here: Placed[]; targets: ReplayTarget[]; spawns: ActiveSpawn[];
  bosses: ReadonlySet<string>;   // normMobName of the night's killed bosses: a target in it draws as a big red dot
  frames: ReplayFrame[]; idx: number; hasFrame: boolean; tails: boolean; entry: MapEntry | undefined;
  hl: ReadonlySet<string>; picks: Picks; fol: Placed | null;
  snap: boolean;                 // the playhead jumped (a scrub, a new session): frame the raid at once, no glide
  bg: Bg;                        // none: raiders only; lines: the wall lines on the dark page; parchment: lines in ink on paper
  store: ParchmentStore;
  route: RouteFeed | null;       // the raid's path, null with the Path toggle off
};
type PaintInfo = {
  zones: [string | null, string | null];
  here: [number, number];
  elsewhere: number;
  hasFrame: boolean;
  followAbsent: boolean;
  animating: boolean;
};

const etClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit',
});
const etShort = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const etDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });

const chip = 'rounded border px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors '
  + 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue';
const chipIdle = 'border-border bg-panel text-text hover:bg-[#21262d]';
const chipOn = 'border-accent bg-accent text-white';

function lerp(a: number, b: number, f: number) { return a + (b - a) * f; }

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r * 1.3);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r * 1.3);
  ctx.lineTo(x - r, y);
  ctx.closePath();
}

/** A small framed label near (px, py), kept inside the pane. */
function tag(ctx: CanvasRenderingContext2D, w: number, h: number, text: string, px: number, py: number, border: string, color: string, dash = false) {
  const tw = ctx.measureText(text).width + 12;
  const lx = Math.max(4, Math.min(w - tw - 4, px + 10));
  const ly = Math.max(14, Math.min(h - 14, py - 14));
  ctx.fillStyle = PANEL;
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  if (dash) ctx.setLineDash([3, 3]);
  ctx.fillRect(lx, ly - 10, tw, 20);
  ctx.strokeRect(lx + 0.5, ly - 9.5, tw - 1, 19);
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.fillText(text, lx + 6, ly);
}

/**
 * The raid's path, UNDER the dots (lib/replayPath.ts): the whole night's path faint and the part the playhead has
 * passed solid. Screen positions come from `sx` / `sy`; nothing here is hit-tested.
 */
function drawRouteUnder(ctx: CanvasRenderingContext2D, w: number, h: number, p: Pane, r: RouteFeed, ink: boolean, sx: (x: number) => number, sy: (y: number) => number) {
  const col = ink ? PATH_PAPER : PATH_DARK;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const ser = r.series;
  if (ser.length < 2) return;
  if (!p.pathSeg || p.pathSeg.series !== ser) p.pathSeg = { series: ser, seg: buildSegments(ser) };
  const seg = p.pathSeg.seg;
  const done = segmentsDone(seg, r.t);
  const run = (from: number, to: number) => {
    ctx.beginPath();
    for (let k = from; k < to; k++) {
      const i = seg.from[k];
      if (k === from || i !== seg.from[k - 1] + 1) ctx.moveTo(sx(ser[i].x), sy(ser[i].y));
      ctx.lineTo(sx(ser[i + 1].x), sy(ser[i + 1].y));
    }
    ctx.stroke();
  };
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = ink ? 0.42 : 0.35;
  run(0, seg.count);                                    // the night, faint
  if (done > 0) {
    ctx.strokeStyle = ink ? 'rgba(245,238,220,0.85)' : BG;   // a halo, so the solid part reads over map lines
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.9;
    run(0, done);
    ctx.strokeStyle = col;
    ctx.lineWidth = 3.5;
    ctx.globalAlpha = 1;
    run(0, done);
  }
  // On to the playhead, inside the segment it is in (when that one is joined to the last finished).
  const lastI = done > 0 ? seg.from[done - 1] + 1 : -1;
  const head = lastI >= 0 && done < seg.count && seg.from[done] === lastI ? headAt(ser, r.t) : null;
  if (head) {
    ctx.beginPath();
    ctx.moveTo(sx(ser[lastI].x), sy(ser[lastI].y));
    ctx.lineTo(sx(head.x), sy(head.y));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  drawRouteMarks(ctx, w, h, r, ink, sx, sy);
}

/** The path's marks, still UNDER the raiders (they are what the page is about): the raid centre as a ring, and the numbered kills. */
function drawRouteMarks(ctx: CanvasRenderingContext2D, w: number, h: number, r: RouteFeed, ink: boolean, sx: (x: number) => number, sy: (y: number) => number) {
  const col = ink ? PATH_PAPER : PATH_DARK;
  const head = headAt(r.series, r.t);
  if (head) {
    const px = sx(head.x), py = sy(head.y);
    ctx.fillStyle = BG;
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, 2, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  }
  ctx.font = FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const m of r.marks) {
    const px = sx(m.x), py = sy(m.y);
    if (px < -20 || px > w + 20 || py < -20 || py > h + 20) continue;
    ctx.globalAlpha = m.done ? 1 : 0.55;
    ctx.fillStyle = PANEL;
    ctx.strokeStyle = KILL_GOLD;
    ctx.lineWidth = m.done ? 2.5 : 1.5;
    if (!m.done) ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.arc(px, py, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = m.done ? '#f0f6fc' : KILL_GOLD;
    ctx.fillText(String(m.n), px, py + 0.5);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'start';
}

/** The name of the kill that just happened, beside its number: over the raiders, so it can be read. */
function drawRouteLabel(ctx: CanvasRenderingContext2D, w: number, h: number, r: RouteFeed, sx: (x: number) => number, sy: (y: number) => number) {
  let latest: (typeof r.marks)[number] | null = null;
  for (const m of r.marks) if (m.done && m.t <= r.t && r.t - m.t <= KILL_LABEL_MS && (!latest || m.t > latest.t)) latest = m;
  if (!latest) return;
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  tag(ctx, w, h, `${latest.n} · ${latest.name}`, sx(latest.x) + 6, sy(latest.y), KILL_GOLD, '#f0f6fc');
}

/** Draws one pane at one moment. Returns true while a follow glide is still settling (the loop must run again). */
function drawPane(p: Pane, o: PaneArgs): boolean {
  const { w, h, dpr } = p.size;
  const cv = p.cv;
  p.holdsFollow = !!o.fol;
  if (o.snap) p.snapPending = true;   // kept until a frame with raiders in this pane can be framed
  if (!cv || !w || !h) return false;
  const ctx = cv.getContext('2d');
  if (!ctx) return false;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  p.drawn = [];
  const { here, hl } = o;
  const anyHl = hl.size > 0;
  let animating = false;
  const now = performance.now();
  const dtm = p.lastTs ? Math.min(100, now - p.lastTs) : 0;
  p.lastTs = now;

  // The view. Following a raider: centre on them, keep the zoom the viewer chose, glide in from where the view
  // was when the follow began. Otherwise auto-framing (lib/replayFraming.ts): the view holds still while the
  // nearest 80% of the raid is in it, and glides to a new frame when it is clearly wrong; a snap re-frames at once.
  if (o.fol) {
    const tx = -o.fol.x, ty = -o.fol.y;
    let v = p.view;
    if (!v) {
      v = fitView({ minX: tx - FOLLOW_SPAN / 2, maxX: tx + FOLLOW_SPAN / 2, minY: ty - FOLLOW_SPAN / 2, maxY: ty + FOLLOW_SPAN / 2 }, w, h);
      p.off = { x: 0, y: 0 };
      p.kick = false;
      p.zoomGoal = null;
    } else if (p.kick) {
      p.off = { x: v.cx - tx, y: v.cy - ty };
      p.kick = false;
      const need = Math.min(w, h) / (FOLLOW_SPAN * 1.5);
      p.zoomGoal = v.scale < need ? need : null;   // zoomed far out: ease in so the raider is more than a speck
    }
    if (p.zoomGoal != null) {
      const e = easeScale(v.scale, p.zoomGoal, dtm);
      v = { ...v, scale: e.scale };
      if (e.done) p.zoomGoal = null; else animating = true;
    }
    p.off = decayOffset(p.off, dtm);
    if (!offsetSettled(p.off)) animating = true;
    p.view = { ...v, cx: tx + p.off.x, cy: ty + p.off.y };
    p.fit = false;
    p.goal = null;
  } else if (p.fit && here.length) {
    const fs = frameStep(
      { view: p.view, goal: p.goal },
      here.map(q => { const s = toScreen(q.x, q.y); return { x: s.sx, y: s.sy }; }),
      w, h, dtm, p.snapPending);
    p.snapPending = false;
    p.view = fs.view;
    p.goal = fs.goal;
    if (fs.animating) animating = true;
  }
  const v = p.view;
  if (!v) return animating;
  const ox = w / 2 - v.cx * v.scale;
  const oy = h / 2 - v.cy * v.scale;
  const refZ = median(here.map(q => q.z));

  // The parchment under the lines: paper over the whole pane, then the zone's floor wash (painted once per zone and
  // size bucket by the store; null until it is ready, so the paper alone shows first). The lines go on top in ink.
  const ink = o.bg === 'parchment';
  if (ink) {
    paintPaper(ctx, w, h);
    const lay = o.zone ? o.store.layer(o.zone, w, h) : null;
    if (lay) drawParchmentLayer(ctx, lay, v, ox, oy);
  }

  // The zone's map underneath.
  const entry = o.entry;
  if (entry?.status === 'ready' && o.bg !== 'none') {
    const layers = effectiveLayers('brewall', entry.map);
    const { prep } = entry;
    const multi = prep.bands.length > 1 && refZ != null;
    if (prep.bw && layers.brewall) {
      ctx.lineCap = 'butt';
      ctx.lineWidth = 1;
      for (const bright of [false, true]) {
        ctx.globalAlpha = bright ? 0.9 : 0.22;
        for (const g of prep.bw.groups) {
          ctx.strokeStyle = ink ? inkColor(bright ? 0.9 : 0.3) : g.css;
          ctx.beginPath();
          for (let i = 0, n = g.band.length; i < n; i++) {
            const near = !multi || lineNearZ(g.z[2 * i], g.z[2 * i + 1], refZ as number);
            if (near !== bright) continue;
            const x1 = g.xy[4 * i] * v.scale + ox, y1 = g.xy[4 * i + 1] * v.scale + oy;
            const x2 = g.xy[4 * i + 2] * v.scale + ox, y2 = g.xy[4 * i + 3] * v.scale + oy;
            if ((x1 < 0 && x2 < 0) || (x1 > w && x2 > w) || (y1 < 0 && y2 < 0) || (y1 > h && y2 > h)) continue;
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
          }
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    if (prep.gen && layers.generated) {
      const focus = multi ? nearestBand(prep.bands, refZ) : 0;
      ctx.lineCap = 'round';
      prep.gen.forEach((arr, bi) => {
        const bright = bi === focus;
        ctx.strokeStyle = ink ? inkColor(bright ? 0.85 : 0.28) : bandColor(bi, prep.gen!.length, bright ? 0.85 : 0.2);
        ctx.lineWidth = bright ? 1.4 : 1;
        ctx.beginPath();
        for (let i = 0; i < arr.length; i += 4) {
          const x1 = arr[i] * v.scale + ox, y1 = arr[i + 1] * v.scale + oy;
          const x2 = arr[i + 2] * v.scale + ox, y2 = arr[i + 3] * v.scale + oy;
          if ((x1 < 0 && x2 < 0) || (x1 > w && x2 > w) || (y1 < 0 && y2 < 0) || (y1 > h && y2 > h)) continue;
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
        }
        ctx.stroke();
      });
    }
  }
  const sx = (x: number) => -x * v.scale + ox;
  const sy = (y: number) => -y * v.scale + oy;

  // Spawn points of the bosses fought now: a big red DASHED ring, underneath everything else — where the boss stands
  // when it appears, not where the raid fought it (the filled dot below is that).
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  for (const s of o.spawns) {
    const px = sx(s.x), py = sy(s.y);
    if (px < -24 || px > w + 24 || py < -24 || py > h + 24) continue;
    ctx.fillStyle = TARGET_RED;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(px, py, BOSS_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = TARGET_RED;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    tag(ctx, w, h, `${s.name} · spawn point`, px + BOSS_R, py, TARGET_RED, '#fecaca');
    ctx.globalAlpha = 1;
  }

  // Tails: where each raider in this zone was over the last TAIL_MS, fading toward the past.
  if (o.tails && o.hasFrame && o.zone) {
    const frames = o.frames;
    const since = o.t - TAIL_MS;
    let j = o.idx;
    while (j > 0 && frames[j - 1].t >= since) j--;
    const last = new Map<string, { x: number; y: number }>();
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.5;
    for (let k = j; k <= o.idx; k++) {
      const fr = frames[k];
      const alpha = 0.55 * Math.max(0, (fr.t - since) / TAIL_MS);
      for (const r of fr.raiders) {
        if (r.zone !== o.zone) continue;
        const prev = last.get(r.name);
        if (prev && Math.hypot(r.x - prev.x, r.y - prev.y) < TELEPORT) {
          ctx.globalAlpha = anyHl && !isPicked(hl, r.name) ? alpha * 0.4 : alpha;
          ctx.strokeStyle = classColor(r.cls);
          ctx.beginPath();
          ctx.moveTo(sx(prev.x), sy(prev.y));
          ctx.lineTo(sx(r.x), sy(r.y));
          ctx.stroke();
        }
        last.set(r.name, { x: r.x, y: r.y });
      }
    }
    ctx.globalAlpha = 1;
  }

  // The raid's path, under the dots.
  if (o.route) drawRouteUnder(ctx, w, h, p, o.route, ink, sx, sy);

  // Dots, the picked ones last (on top), everyone else dimmed while anyone is picked.
  const placed = here.slice().sort((a, b) => Number(isPicked(hl, a.r.name)) - Number(isPicked(hl, b.r.name)));
  ctx.lineCap = 'butt';
  for (const { r, x, y } of placed) {
    const px = sx(x), py = sy(y);
    if (px < -20 || px > w + 20 || py < -20 || py > h + 20) continue;
    const pick = anyHl && isPicked(hl, r.name);
    const color = classColor(r.cls);
    ctx.globalAlpha = anyHl && !pick ? 0.3 : 1;
    if (pick) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.28;
      ctx.beginPath();
      ctx.arc(px, py, DOT_R + 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (r.h != null) {
      const { dx, dy } = headingVec(r.h);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + dx * DOT_R, py + dy * DOT_R);
      ctx.lineTo(px + dx * (DOT_R + 6), py + dy * (DOT_R + 6));
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.strokeStyle = BG;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, py, DOT_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (pick) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, DOT_R + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    p.drawn.push({ name: r.name, cls: r.cls, hp: r.hp, px, py });
  }

  // Recorded targets: red diamonds, bigger the more raiders had it targeted. A killed boss is a big red dot with a
  // white ring, so it is the thing to point at on the raid screen.
  for (const tg of o.targets) {
    const px = sx(tg.x), py = sy(tg.y);
    if (px < -30 || px > w + 30 || py < -30 || py > h + 30) continue;
    ctx.fillStyle = TARGET_RED;
    if (o.bosses.has(normMobName(tg.name))) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(px, py, BOSS_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      continue;
    }
    const r = Math.min(16, 6 + 2 * Math.sqrt(tg.n));
    ctx.strokeStyle = BG;
    ctx.lineWidth = 1.5;
    diamond(ctx, px, py, r);
    ctx.fill();
    ctx.stroke();
  }

  if (o.route) drawRouteLabel(ctx, w, h, o.route, sx, sy);

  // Labels: the hovered raider, every picked one, every recorded target.
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  for (const d of p.drawn) {
    const pick = anyHl && isPicked(hl, d.name);
    if (!pick && d.name !== p.hover) continue;
    tag(ctx, w, h, `${d.name} · ${classAbbr(d.cls)}${d.hp != null ? ` · ${d.hp}%` : ''}`, d.px, d.py, pick ? '#f0f6fc' : BORDER, pick ? '#f0f6fc' : TEXT);
  }
  for (const tg of o.targets) {
    const px = sx(tg.x), py = sy(tg.y);
    if (px < -30 || px > w + 30 || py < -30 || py > h + 30) continue;
    const boss = o.bosses.has(normMobName(tg.name));
    tag(ctx, w, h, `${tg.name}${tg.n > 1 ? ` ×${tg.n}` : ''}`, px + (boss ? BOSS_R : 6), py, TARGET_RED, boss ? '#ffffff' : '#fecaca');
  }

  // Scale bar and north.
  const units = scaleBarUnits(v.scale);
  const len = units * v.scale;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = BG;
  ctx.fillStyle = TEXT;
  ctx.lineWidth = 3;
  ctx.strokeText(`${units.toLocaleString()} units`, 14, h - 34);
  ctx.fillText(`${units.toLocaleString()} units`, 14, h - 34);
  ctx.strokeStyle = TEXT;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(14, h - 26); ctx.lineTo(14, h - 18); ctx.lineTo(14 + len, h - 18); ctx.lineTo(14 + len, h - 26);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.strokeStyle = BG;
  ctx.lineWidth = 3;
  ctx.strokeText('N', w - 22, 24);
  ctx.fillText('N', w - 22, 24);
  ctx.textAlign = 'start';
  return animating;
}

/**
 * BOUNDED MODE (the raid session review and the public share page): the board plays ONE fixed window of a
 * recording. `night` is that window as a NightSummary (first = the window's start, so the 15-minute windows line up
 * with the server's), there is no night or session picker and nothing is written to `?session=`, and every fetch
 * goes through `urls` so the caller decides which routes (and which credential) the data comes from. `seek` is a
 * request from outside to move the playhead (a click on a kill, a roll or a loot line); `n` changes on every
 * request so the same time can be asked for twice.
 */
export type BoundedReplay = {
  night: NightSummary;
  urls: {
    window: (nightKey: string, fromIso: string, toIso: string) => string;
    bosses: ((nightKey: string) => string) | null;
    map: (zone: string) => string;
    mesh: (zone: string, floors: '' | '1' | 'only') => string;
  };
  seek?: { t: number; n: number } | null;
  /** The caller has no zone mesh to serve (the local site): the 2D/3D switch is left off and the map stays 2D. */
  flat?: boolean;
  /** Called with the playhead (epoch ms) as it moves, about five times a second while playing. Keep it a ref write. */
  onPlayhead?: (t: number) => void;
};

/** The route one 15-minute window comes from: the caller's (bounded) or the members' replay route. */
function windowUrl(urls: BoundedReplay['urls'] | null, nightKey: string, from: number, to: number): string {
  const f = new Date(from).toISOString(), t = new Date(to).toISOString();
  return urls
    ? urls.window(nightKey, f, t)
    : '/api/spectator/replay?night=' + encodeURIComponent(nightKey) + '&from=' + encodeURIComponent(f) + '&to=' + encodeURIComponent(t);
}

export default function ReplayBoard({ bounded, timeline }: { bounded?: BoundedReplay; timeline?: boolean } = {}) {
  // The bosses the route sent: a whole NIGHT's on the Spectator and the members' review, the share's window's on a share.
  // Nothing below reads this directly: `bosses` is the part that died inside the window on screen.
  const [allBosses, setAllBosses] = useState<SpawnBoss[]>([]);
  const urlsRef = useRef(bounded?.urls ?? null);
  urlsRef.current = bounded?.urls ?? null;
  const [nights, setNights] = useState<NightSummary[] | null>(bounded ? [bounded.night] : null);
  // Bounded: the same window handed over again, grown (a shared raid that follows the raid redraws itself, see
  // lib/shareFollow.ts). It replaces the one night in place; the reset below keys on the window's start, so the playhead stays.
  const boundedNight = bounded?.night;
  const boundedSig = boundedNight ? `${boundedNight.first}|${boundedNight.last}|${boundedNight.minutes}` : '';
  useEffect(() => {
    if (boundedNight) setNights(prev => (prev && prev.length === 1 && prev[0] === boundedNight ? prev : [boundedNight]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundedSig]);
  const [netErr, setNetErr] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [nightKey, setNightKey] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [pinned, setPinned] = useState<string | null>(null);
  const [tails, setTails] = useState(true);
  const [uiT, setUiT] = useState(0);
  // Bounded mode: tell the caller where the playhead is (a ref write on its side, so playback never re-renders the page).
  const onPlayheadRef = useRef(bounded?.onPlayhead);
  onPlayheadRef.current = bounded?.onPlayhead;
  useEffect(() => { onPlayheadRef.current?.(uiT); }, [uiT]);
  const [info, setInfo] = useState<{ zones: [string | null, string | null]; here: [number, number]; elsewhere: number; followAbsent: boolean }>(
    { zones: [null, null], here: [0, 0], elsewhere: 0, followAbsent: false });
  const [state, setState] = useState<'ok' | 'buffering' | 'nodata' | 'failed'>('ok');
  const [maps, setMaps] = useState<Record<string, MapEntry>>({});
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [no3d, setNo3d] = useState(false);
  const [floors, setFloors] = useState(true);
  const [bg, setBg] = useState<Bg>(parseBg(''));   // the 2D background; `?bg=` in the URL, one choice for both panes
  const [, setFloorTick] = useState(0);            // the parchment store's status changed: the notes re-read it
  const [showBosses, setShowBosses] = useState(true);
  const [picks, setPicks] = useState<Picks>(NO_PICKS);
  const [urlReady, setUrlReady] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [groupBy, setGroupBy] = useState<'class' | 'alpha'>('class');
  const [rosterVer, setRosterVer] = useState(0);
  const [live, setLive] = useState(false);                  // following the newest recorded minute, at 1x
  const [nowMs, setNowMs] = useState(() => Date.now());     // refreshed with each poll: whether Live is still on offer
  const [tailLast, setTailLast] = useState<number | null>(null);   // newest minute the tail window has seen past the list
  // The raid's path (lib/replayPath.ts).
  const [showPath, setShowPath] = useState(true);          // the Path toggle (on by default)
  const [pathVer, setPathVer] = useState(0);               // the path grew: the "so far" note re-reads it

  // The session being replayed (`?session=` names it, and so its night, in a shared link). A night is a whole
  // calendar day, so the night list's default is its guild raid; the other sessions are options (lib/raidReplay.ts).
  const [sessionFrom, setSessionFrom] = useState<number | null>(null);
  const chosen = useMemo(() => {
    if (!nights) return null;
    const n = (sessionFrom != null ? nights.find(x => x.sessions.some(s => s.from === sessionFrom)) : undefined)
      ?? nights.find(x => x.night_key === nightKey) ?? nights[0];
    if (!n) return null;
    const i = n.sessions.findIndex(s => s.from === sessionFrom);
    const session: ReplaySession | null = n.sessions[i >= 0 ? i : defaultSessionIndex(n.sessions)] ?? null;
    return { night: n, session };
  }, [nights, nightKey, sessionFrom]);
  // Everything below plays the chosen session as if it were the whole night: its first and last minute, its
  // coverage spans and its zone visits. The night_key stays the whole night's, which is what the data request needs.
  const night = useMemo<NightSummary | null>(() => {
    if (!chosen) return null;
    const { night: n, session: picked } = chosen;
    if (!picked) return n;
    // a minute the live tail has seen before the list has; only the newest session can be the one being recorded
    // (a session cut where the raid changed ends short of the one after it, and must not be stretched into it)
    const s = picked === n.sessions[n.sessions.length - 1] ? growSession(picked, tailLast) : picked;
    return { ...n, first: new Date(s.from).toISOString(), last: new Date(s.to - MINUTE_MS).toISOString(), minutes: s.minutes, zones: s.zones, runs: s.runs, spans: s.spans };
  }, [chosen, tailLast]);
  // The bosses of the window on screen, and nothing else: the numbered chips, the numbers on the path, the spawn rings and
  // the timeline strip all read these. A night holds the daytime groups and, after a raid change, the other raid too
  // (the guild lead, 2026-10-23: the second of two back-to-back raids numbered the first one's kills), and the bosses
  // are read for the night (or a share's window) once, see the bosses effect below. A review window ends exactly where
  // its Kills tab does; a session may trail two minutes past its last row, but not into the session after it.
  const nextSessionFrom = useMemo(() => {
    const list = chosen?.night.sessions ?? [];
    const i = chosen?.session ? list.findIndex(s => s.from === chosen.session?.from) : -1;
    return i >= 0 && i + 1 < list.length ? list[i + 1].from : null;
  }, [chosen]);
  const bosses = useMemo<SpawnBoss[]>(() => {
    if (!night) return allBosses;
    const from = Date.parse(night.first), to = Date.parse(night.last) + MINUTE_MS;
    return bossesInWindow(allBosses, from, to, chosen?.session ? trailSlackMs(to, nextSessionFrom) : 0);
  }, [allBosses, night, chosen, nextSessionFrom]);
  const sessionKills = useMemo<Kill[]>(() => bosses.map(b => ({ npcId: b.npc_id, name: b.name, atMs: b.to })), [bosses]);
  const split = info.zones[1] !== null;

  // ── refs: everything the drawing reads ─────────────────────────────────────
  const [panes] = useState<Pane[]>(() => [newPane(), newPane()]);
  const nightRef = useRef<NightSummary | null>(null);
  const tRef = useRef(0);
  const playingRef = useRef(false);
  const speedRef = useRef(10);
  const tailsRef = useRef(true);
  const pinnedRef = useRef<string | null>(null);
  const picksRef = useRef<Picks>(NO_PICKS);
  const hlRef = useRef<Set<string>>(new Set());
  const autoZoneRef = useRef<string | null>(null);
  const splitRef = useRef<SplitState>(SPLIT_INIT);
  const framesRef = useRef<ReplayFrame[]>([]);
  const winFrames = useRef(new Map<number, ReplayFrame[]>());
  const wins = useRef(new Map<number, Win>());
  const gen = useRef(0);
  const liveRef = useRef(false);
  const nightsRef = useRef<NightSummary[] | null>(null);   // the list as last merged, for the poll to compare against
  const viewKeyRef = useRef<string | null>(null);          // the night on screen
  viewKeyRef.current = chosen?.night.night_key ?? null;
  const pendingLiveRef = useRef<{ from: number } | null>(null);   // go Live once the session starting here has loaded
  const urlSessionRef = useRef<number | null>(null);       // the session the opening URL named, if any
  const bootRef = useRef(false);
  const mapsRef = useRef<Record<string, MapEntry>>({});
  const mapReqs = useRef(new Set<string>());
  const rafRef = useRef(0);
  const lastTs = useRef(0);
  const lastUi = useRef(0);
  const stepRef = useRef<(ts: number) => void>(() => {});
  const nextCache = useRef<{ frame: ReplayFrame | null; byName: Map<string, ReplayRaider> }>({ frame: null, byName: new Map() });
  const lastPaintT = useRef<number | null>(null);
  const rosterRef = useRef(new Map<string, RosterEntry>());
  const bossesRef = useRef<SpawnBoss[]>([]);
  const bossNamesRef = useRef<ReadonlySet<string>>(new Set());
  const showBossesRef = useRef(true);
  const pathStore = useRef(new PathStore());
  const routeRef = useRef<{ path: boolean }>({ path: true });
  const killsRef = useRef<{ name: string; to: number; zones: string[] }[]>([]);   // the night's boss deaths, for the numbered markers
  // 3D: while it is showing, paint() hands each pane's raiders to its 3D view instead of drawing the canvas.
  const modeRef = useRef<'2d' | '3d'>('2d');
  const bridgeA = useRef<Bridge3D | null>(null);
  const bridgeB = useRef<Bridge3D | null>(null);
  const bridges = [bridgeA, bridgeB];

  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(ts => stepRef.current(ts));
  }, []);
  // The parchment floors, fetched and painted once per zone and size bucket (lib/parchmentStore.ts).
  const bgRef = useRef<Bg>(bg);
  const parchment = useMemo(() => new ParchmentStore(() => { setFloorTick(n => n + 1); schedule(); }), [schedule]);
  useEffect(() => () => parchment.dispose(), [parchment]);

  // ── data ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (urlsRef.current) return;   // bounded: the one window came in as a prop
    let dead = false;
    let busy = false;
    // The first pull is the whole list; every later one asks only for the last two days and is merged in.
    const pull = () => {
      if (busy) return;
      busy = true;
      const first = !nightsRef.current;
      fetch('/api/spectator/replay?nights=1' + (first ? '' : '&recent=1'), first ? undefined : { cache: 'no-store' })
        .then(async res => {
          if (res.status === 401) { if (!dead) setSignedOut(true); return; }
          if (!res.ok) throw new Error('bad');
          const j = await res.json();
          if (dead) return;
          const fresh: NightSummary[] = Array.isArray(j.nights) ? j.nights : [];
          const prev = nightsRef.current;
          const next = mergeNights(prev, fresh);
          setNowMs(Date.now());
          setNetErr(false);
          if (next === prev) return;
          nightsRef.current = next;
          setNights(next);
          // Today's raid starting is not a reason to move anyone, unless they are following the last one live.
          const go = prev ? newNightToFollow(prev, next, viewKeyRef.current, liveRef.current) : null;
          const s = go ? newestSession([go]) : null;
          if (go && s) {
            pendingLiveRef.current = { from: s.from };
            setSessionFrom(s.from);
            setNightKey(go.night_key);
          }
        })
        .catch(() => { if (!dead && !nightsRef.current) setNetErr(true); })
        .finally(() => { busy = false; });
    };
    pull();
    // Once a minute while the page is on screen, and at once when it comes back to the front.
    const timer = setInterval(() => { if (!document.hidden) pull(); }, NIGHTS_POLL_MS);
    const onVisible = () => { if (!document.hidden) { pull(); schedule(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => { dead = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [schedule]);

  // Keep the windows around the playhead (the one it is in, one behind, two ahead), drop the rest.
  const rebuild = useCallback(() => {
    const n = nightRef.current;
    if (!n) return;
    const cw = windowIndex(Date.parse(n.first), tRef.current);
    for (const k of [...winFrames.current.keys()]) if (k < cw - 1 || k > cw + 2) winFrames.current.delete(k);
    for (const k of [...wins.current.keys()]) if (k < cw - 1 || k > cw + 2) wins.current.delete(k);
    framesRef.current = [...winFrames.current.keys()].sort((a, b) => a - b).flatMap(k => winFrames.current.get(k) as ReplayFrame[]);
    nextCache.current = { frame: null, byName: new Map() };
    schedule();
  }, [schedule]);

  const ensureWindow = useCallback((w: number) => {
    const n = nightRef.current;
    if (!n || w < 0) return;
    const start = Date.parse(n.first);
    const end = Date.parse(n.last) + MINUTE_MS;
    const from = start + w * REPLAY_WINDOW_MS;
    if (from >= end) return;
    const now = Date.now();
    const have = wins.current.get(w);
    const following = liveRef.current && !urlsRef.current;
    let refresh = false;
    if (have) {
      if (have.state === 'loading' || have.busy) return;
      if (have.state === 'err') {
        if (now - have.at < 5000) return;   // an error is retried after 5 s
      } else if (windowNeedsRefetch(have.to, have.at, from, end, now, following)) {
        refresh = true;   // loaded short and the night has grown past it, or Live and this is the tail
      } else return;
    }
    // Live asks for the whole tail window, not just up to the end the list knows: the rows past it are the news.
    const tail = following && end <= from + REPLAY_WINDOW_MS;
    wins.current.set(w, have && refresh ? { ...have, busy: true } : { state: 'loading', at: now, to: from });
    const g = gen.current;
    const to = tail ? from + REPLAY_WINDOW_MS : Math.min(from + REPLAY_WINDOW_MS, end);
    fetch(windowUrl(urlsRef.current, n.night_key, from, to))
      .then(async res => {
        if (g !== gen.current) return;
        if (res.status === 401) { setSignedOut(true); return; }
        if (!res.ok) throw new Error('bad');
        const j = await res.json();
        if (g !== gen.current) return;
        const rows: { minute_at: string }[] = Array.isArray(j.rows) ? j.rows : [];
        const decoded = decodeRows(rows as Parameters<typeof decodeRows>[0]);
        winFrames.current.set(w, decoded);
        pathStore.current.addWindow(w, decoded); setPathVer(v => v + 1);   // the path keeps the window's centre for the night
        // The newest minute that came back, which a tail request can find past the end the list knew.
        const newest = rows.reduce((m, r) => Math.max(m, Date.parse(r.minute_at) || 0), 0);
        wins.current.set(w, { state: 'ok', at: Date.now(), to: tail ? Math.min(from + REPLAY_WINDOW_MS, Math.max(end, newest + MINUTE_MS)) : to });
        if (tail && newest + MINUTE_MS > end) setTailLast(p => Math.max(p ?? 0, newest));
        if (collectRoster(decoded, rosterRef.current)) setRosterVer(v => v + 1);
        rebuild();
      })
      .catch(() => {
        if (g !== gen.current) return;
        // A refresh that failed keeps the frames it has and tries again on the next due pass.
        wins.current.set(w, have && refresh ? { ...have, busy: false, at: Date.now() } : { state: 'err', at: Date.now(), to: from });
        schedule();
        setTimeout(schedule, 5000);   // the next pass asks again
      });
  }, [rebuild, schedule]);

  // Hold on to the night and session on screen. Until now an unset pick meant "the newest night", which would carry
  // the viewer to a brand-new night the moment the list poll finds one.
  useEffect(() => {
    if (urlsRef.current || !urlReady || !chosen) return;
    if (nightKey == null) setNightKey(chosen.night.night_key);
    if (sessionFrom == null && chosen.session) setSessionFrom(chosen.session.from);
  }, [chosen, nightKey, sessionFrom, urlReady]);

  // Live: the playhead on the newest recorded minute (less LIVE_LAG_MS), playing at 1x. Any scrub or pause ends it.
  const setLiveOff = useCallback(() => { liveRef.current = false; setLive(false); }, []);
  const startLive = useCallback(() => {
    const n = nightRef.current;
    if (!n) return;
    liveRef.current = true;
    setLive(true);
    speedRef.current = 1;
    setSpeed(1);
    playingRef.current = true;
    setPlaying(true);
    tRef.current = livePlayhead(Date.parse(n.first), Date.parse(n.last) + MINUTE_MS);
    lastTs.current = 0;
    setUiT(tRef.current);
    schedule();
  }, [schedule]);

  // Choosing a night or session that is not the one on screen waits here until it has loaded, then starts Live.
  // The page opens in Live when the newest session is being recorded and the URL did not name another one.
  useEffect(() => {
    if (urlsRef.current || bootRef.current || !nights || !urlReady) return;
    bootRef.current = true;
    const s = urlSessionRef.current == null ? newestSession(nights) : null;
    if (!s || !liveAvailable(s.to, Date.now())) return;
    pendingLiveRef.current = { from: s.from };
    setSessionFrom(s.from);
    setNightKey(nights[0].night_key);
  }, [nights, urlReady]);

  // A new night starts at its first minute, paused, with nothing loaded.
  useEffect(() => {
    nightRef.current = night;
    liveRef.current = false;
    setLive(false);
    setTailLast(null);
    gen.current++;
    winFrames.current.clear();
    wins.current.clear();
    framesRef.current = [];
    pathStore.current.clear();
    setPathVer(v => v + 1);
    rosterRef.current = new Map();
    setRosterVer(v => v + 1);
    playingRef.current = false;
    setPlaying(false);
    pinnedRef.current = null;
    setPinned(null);
    autoZoneRef.current = null;
    splitRef.current = SPLIT_INIT;
    for (const p of panes) { p.zone = null; p.view = null; p.goal = null; p.zoomGoal = null; p.snapPending = false; }
    lastPaintT.current = null;   // the first picture of a new session is framed at once
    setInfo(i => (i.zones[0] === null && i.zones[1] === null ? i : { ...i, zones: [null, null] }));
    if (!night) return;
    tRef.current = openingPlayhead(night.spans, Date.parse(night.first));   // a window that starts before its first recorded minute opens on that minute
    const wantLive = pendingLiveRef.current;
    if (wantLive && wantLive.from === Date.parse(night.first)) {
      pendingLiveRef.current = null;
      if (liveAvailable(Date.parse(night.last) + MINUTE_MS, Date.now())) startLive();
    }
    setUiT(tRef.current);
    ensureWindow(windowIndex(Date.parse(night.first), tRef.current));
    schedule();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [night?.night_key, night?.first]);

  // The same session grown (a later last minute from the list poll or the live tail): the refs follow, in place. The
  // reset above keys on night_key and the session's first minute and never sees this, so nothing is cleared, the
  // playhead stays, and the window that was loaded short now reads as stale and is asked for again (ensureWindow).
  useEffect(() => {
    nightRef.current = night;
    schedule();
    const t = setTimeout(schedule, 2100);   // a paused board still takes the stale tail once STALE_RETRY_MS has passed
    return () => clearTimeout(t);
  }, [night, schedule]);

  // Live is on offer only while the session is being recorded; it ends by itself when the raid does.
  useEffect(() => {
    if (live && night && !liveAvailable(Date.parse(night.last) + MINUTE_MS, nowMs)) setLiveOff();
  }, [live, night, nowMs, setLiveOff]);

  // The night's killed bosses with their spawn points: for nights recorded before the recorder kept targets.
  // Read again when the address changes: a bounded caller's names its window, so a page moved to another window of the
  // same night asks for that window's bosses, not the last one's.
  const bossUrl = !night ? null
    : bounded ? (bounded.urls.bosses ? bounded.urls.bosses(night.night_key) : null)   // null: bounded, and the caller serves no boss markers
    : '/api/spectator/replay/bosses?night=' + encodeURIComponent(night.night_key);
  useEffect(() => {
    setAllBosses([]);
    if (!bossUrl) return;
    const ac = new AbortController();
    fetch(bossUrl, { signal: ac.signal })
      .then(async res => {
        if (!res.ok) return;
        setAllBosses(parseBosses(await res.json()));
      })
      .catch(() => {});
    return () => ac.abort();
  }, [bossUrl]);
  // What the drawing reads is the window's bosses only (the memo above), set the moment the window or the read changes.
  useEffect(() => {
    bossesRef.current = bosses;
    bossNamesRef.current = new Set(bosses.map(b => normMobName(b.name)));
    killsRef.current = bosses.map(b => ({ name: b.name, to: b.to, zones: [...new Set(b.points.map(p => p.zone))] }));
    schedule();
  }, [bosses, schedule]);

  // The map for a zone on screen: once per zone, kept for the visit.
  const loadMap = useCallback((z: string) => {
    if (mapReqs.current.has(z)) return;
    mapReqs.current.add(z);
    const put = (e: MapEntry) => {
      mapsRef.current = { ...mapsRef.current, [z]: e };
      setMaps(mapsRef.current);
      schedule();
    };
    put({ status: 'loading' });
    fetch(urlsRef.current ? urlsRef.current.map(z) : '/api/spectator/map?zone=' + encodeURIComponent(z))
      .then(async res => {
        if (res.status === 404) return put({ status: 'none' });
        if (!res.ok) return put({ status: 'error' });
        const map = parseZoneMap(await res.json());
        put(map ? { status: 'ready', map, prep: prepare(map) } : { status: 'none' });
      })
      .catch(() => put({ status: 'error' }))
      .finally(() => mapReqs.current.delete(z));
  }, [schedule]);
  useEffect(() => {
    if (mode !== '2d') return;   // the 3D view fetches its own mesh
    for (const z of info.zones) if (z && !maps[z]) loadMap(z);
  }, [info.zones, maps, loadMap, mode]);

  // ── drawing ────────────────────────────────────────────────────────────────
  // Draws the picture at playhead `t`. Returns what the controls need to show.
  const paint = useCallback((t: number): PaintInfo => {
    const frames = framesRef.current;
    const idx = frameIndexAt(frames, t);
    const a = idx >= 0 && t - frames[idx].t <= FRAME_GAP_MS ? frames[idx] : null;
    const pk = picksRef.current;
    const hl = hlRef.current;
    const out: PaintInfo = { zones: [null, null], here: [0, 0], elsewhere: 0, hasFrame: !!a, followAbsent: false, animating: false };
    // A playhead jump of a minute or more (a scrub, a break skipped, a new session) re-frames at once; playback glides.
    const prevT = lastPaintT.current;
    lastPaintT.current = t;
    const snap = prevT === null || Math.abs(t - prevT) > FRAME_SNAP_MS;

    // The glide target: the next frame, if it is close enough in time to be the same movement.
    let b: ReplayFrame | null = null;
    if (a && idx + 1 < frames.length) {
      const nx = frames[idx + 1];
      if (nx.t > a.t && nx.t - a.t <= FRAME_GAP_MS) b = nx;
    }
    if (nextCache.current.frame !== b) {
      nextCache.current = { frame: b, byName: new Map(b ? b.raiders.map(r => [r.name, r]) : []) };
    }
    const f = a && b ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
    const placedAll: Placed[] = a ? a.raiders.map(r => {
      const n = b ? nextCache.current.byName.get(r.name) : undefined;
      if (n && n.zone === r.zone && Math.hypot(n.x - r.x, n.y - r.y) < TELEPORT) {
        return { r, x: lerp(r.x, n.x, f), y: lerp(r.y, n.y, f), z: lerp(r.z, n.z, f) };
      }
      return { r, x: r.x, y: r.y, z: r.z };
    }) : [];

    // The followed raider, wherever they are.
    const fol = pk.follow ? placedAll.find(q => isFollowed(pk, q.r.name)) ?? null : null;
    out.followAbsent = !!pk.follow && !fol && !!a;

    // Which zones: the pin, else the followed raider's, else the busiest (with a little stickiness), else the last one shown.
    const counts = a ? zoneCounts(a) : new Map<string, number>();
    let primary = pinnedRef.current;
    if (!primary && fol?.r.zone) { primary = fol.r.zone; autoZoneRef.current = primary; }
    if (!primary && a) autoZoneRef.current = pickReplayZone(counts, autoZoneRef.current);
    if (!primary) primary = autoZoneRef.current;
    let second: string | null = null;
    if (pk.split === 'auto' && primary) {
      if (a) splitRef.current = pickSplit(counts, primary, splitRef.current, t);
      second = splitRef.current.second !== primary ? splitRef.current.second : null;
    } else {
      splitRef.current = SPLIT_INIT;
    }
    out.zones = [primary, second];

    const targetsAll = glideTargets(a, b, f, TELEPORT);
    let spawnsAll: ActiveSpawn[] = [];
    if (showBossesRef.current && bossesRef.current.length) {
      const recorded = new Set([...recentTargetNames(frames, idx, t, RECORDED_LOOKBACK_MS)].map(normMobName));
      spawnsAll = activeSpawns(bossesRef.current, t, recorded);
    }

    let heldTotal = 0;
    for (let i = 0; i < 2; i++) {
      const zone = out.zones[i];
      const pane = panes[i];
      if (zone !== pane.zone) {
        // A new zone in a pane starts fresh: fit the raid, nobody hovered.
        pane.zone = zone;
        pane.view = null;
        pane.goal = null;
        pane.zoomGoal = null;
        pane.fit = true;
        pane.hover = null;
        pane.kick = false;
      }
      if (!zone) { pane.holdsFollow = false; continue; }
      const here = placedAll.filter(q => q.r.zone === zone);
      out.here[i] = here.length;
      heldTotal += here.length;
      const folHere = fol && fol.r.zone === zone ? fol : null;
      const targets = targetsAll.filter(x => x.zone === zone);
      const spawns = spawnsAll.filter(x => x.zone === zone);

      // The raid's path for this zone, or null with the Path toggle off. The series is the zone's centre path from every
      // window loaded so far.
      let route: RouteFeed | null = null;
      if (routeRef.current.path) {
        const series = pathStore.current.seriesFor(zone);
        route = { series, t, marks: killMarks(killsRef.current, series, zone, t) };
      }

      if (modeRef.current === '3d') {
        pane.holdsFollow = !!folHere;
        bridges[i].current?.feed(zone, here.map(q => ({ name: q.r.name, cls: q.r.cls, hp: q.r.hp, x: q.x, y: q.y, z: q.z })), {
          hl, follow: folHere ? pk.follow : null,
          targets: targets.map(x => ({ name: x.name, n: x.n, x: x.x, y: x.y, z: x.z, boss: bossNamesRef.current.has(normMobName(x.name)) })),
          spawns, snap, route,
        });
        continue;
      }
      if (drawPane(pane, {
        t, zone, here, targets, spawns, bosses: bossNamesRef.current, frames, idx, hasFrame: !!a, tails: tailsRef.current,
        entry: mapsRef.current[zone], hl, picks: pk, fol: folHere, snap, bg: bgRef.current, store: parchment, route,
      })) out.animating = true;
    }
    out.elsewhere = a ? a.raiders.length - heldTotal : 0;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes, parchment]);

  // One pass: advance the playhead if playing, make sure the data is coming, draw, report to the controls.
  const step = useCallback((ts: number) => {
    rafRef.current = 0;
    const n = nightRef.current;
    if (!n) return;
    const start = Date.parse(n.first);
    const end = Date.parse(n.last) + MINUTE_MS;
    const dt = lastTs.current ? Math.min(250, ts - lastTs.current) : 0;
    lastTs.current = ts;
    let t = tRef.current;
    // Live: back to the tail if the playhead fell far behind it (a hidden tab), and keep the tail window fresh.
    if (liveRef.current) {
      if (liveLagging(t, end)) t = tRef.current = livePlayhead(start, end);
      ensureWindow(windowIndex(start, end - 1));
    }
    const w = windowIndex(start, t);
    // Always asked: it returns at once for a window that is loaded and current, and refetches one that fell behind.
    ensureWindow(w);
    const here = wins.current.get(w);
    const loaded = here?.state === 'ok';

    if (playingRef.current) {
      const sp = nextSpanStart(n.spans, t);
      if (!sp.inside) {
        // A break in the raid (nobody recorded): jump over it. Live waits at the tail for the next minute instead.
        if (sp.next != null) t = sp.next; else { t = end - 1; if (!liveRef.current) { playingRef.current = false; setPlaying(false); } }
      } else if (loaded) {
        t += dt * speedRef.current;
        if (t >= end) { t = end - 1; if (!liveRef.current) { playingRef.current = false; setPlaying(false); } }
      }
      if (loaded) {
        ensureWindow(w + 1);
        if (speedRef.current >= 30) ensureWindow(w + 2);
      }
      tRef.current = t;
    }

    const p = paint(t);

    const buffering = !loaded && here?.state !== 'err';
    const next = buffering ? 'buffering'
      : here?.state === 'err' ? 'failed'
      : !p.hasFrame ? 'nodata' : 'ok';
    setState(next);
    setInfo(c => (
      c.zones[0] === p.zones[0] && c.zones[1] === p.zones[1] && c.here[0] === p.here[0] && c.here[1] === p.here[1]
      && c.elsewhere === p.elsewhere && c.followAbsent === p.followAbsent
        ? c : { zones: p.zones, here: p.here, elsewhere: p.elsewhere, followAbsent: p.followAbsent }));
    if (!playingRef.current || ts - lastUi.current > 200) { lastUi.current = ts; setUiT(t); }

    if (playingRef.current || p.animating) schedule();
  }, [ensureWindow, paint, schedule]);
  stepRef.current = step;

  // ── controls ───────────────────────────────────────────────────────────────
  const seek = useCallback((t: number) => {
    const n = nightRef.current;
    if (!n) return;
    const lo = Date.parse(n.first), hi = Date.parse(n.last) + MINUTE_MS - 1;
    tRef.current = Math.min(hi, Math.max(lo, t));
    lastTs.current = 0;
    setLiveOff();   // a scrub leaves the tail
    setUiT(tRef.current);
    schedule();
  }, [schedule, setLiveOff]);

  // A request from outside (bounded mode): move the playhead there and pause, so the picture stays on that moment.
  const seekN = bounded?.seek?.n ?? 0;
  const seekT = bounded?.seek?.t ?? null;
  useEffect(() => {
    if (seekT == null || !seekN) return;
    playingRef.current = false;
    setPlaying(false);
    seek(seekT);
  }, [seekN, seekT, seek]);

  const togglePlay = useCallback(() => {
    const n = nightRef.current;
    if (!n) return;
    const p = !playingRef.current;
    if (p && tRef.current >= Date.parse(n.last) + MINUTE_MS - 2000) tRef.current = Date.parse(n.first);
    if (!p) setLiveOff();   // a pause leaves the tail
    playingRef.current = p;
    lastTs.current = 0;
    setPlaying(p);
    schedule();
  }, [schedule, setLiveOff]);

  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { tailsRef.current = tails; schedule(); }, [tails, schedule]);
  useEffect(() => { showBossesRef.current = showBosses; schedule(); }, [showBosses, schedule]);
  // The same playhead, night and zone carry across: only where the frame is drawn changes.
  useEffect(() => { modeRef.current = mode; schedule(); }, [mode, schedule]);
  useEffect(() => {
    pinnedRef.current = pinned;
    schedule();
  }, [pinned, schedule]);

  // Picks: from the URL once on arrival, back into it on every change (replaceState: no history entry per tap).
  useEffect(() => {
    try {
      setPicks(parsePicks(window.location.search));
      urlSessionRef.current = parseSessionParam(window.location.search);
      setSessionFrom(urlSessionRef.current);
      setBg(parseBg(window.location.search));    } catch { /* no URL to read */ }
    setUrlReady(true);
  }, []);
  // The session in the URL (so a link opens the same one). Always written once there is one: the default is not
  // "no param", because the default moves as new nights are recorded.
  const urlSession = chosen?.session?.from ?? null;
  useEffect(() => {
    if (!urlReady || urlSession == null || urlsRef.current) return;   // bounded: the page names the window, not ?session=
    try {
      const s = sessionSearch(urlSession, window.location.search);
      if (s !== window.location.search) window.history.replaceState(null, '', window.location.pathname + s + window.location.hash);
    } catch { /* a blocked history API only costs the shareable link */ }
  }, [urlSession, urlReady]);
  useEffect(() => {
    picksRef.current = picks;
    hlRef.current = pickedSet(picks);
    schedule();
    if (!urlReady) return;
    try {
      const s = picksSearch(picks, window.location.search);
      if (s !== window.location.search) window.history.replaceState(null, '', window.location.pathname + s + window.location.hash);
    } catch { /* a blocked history API only costs the shareable link */ }
  }, [picks, urlReady, schedule]);
  // The background, both panes at once, kept in the URL like the picks (the default is left out of it).
  useEffect(() => {
    bgRef.current = bg;
    schedule();
    if (!urlReady) return;
    try {
      const s = bgSearch(bg, window.location.search);
      if (s !== window.location.search) window.history.replaceState(null, '', window.location.pathname + s + window.location.hash);
    } catch { /* a blocked history API only costs the shareable link */ }
  }, [bg, urlReady, schedule]);
  // The path: the choice the drawing reads, and the windows already decoded.
  useEffect(() => {
    routeRef.current = { path: showPath };
    let grew = false;
    for (const [w, fr] of winFrames.current) if (!pathStore.current.has(w)) { pathStore.current.addWindow(w, fr); grew = true; }
    if (grew) setPathVer(v => v + 1);
    schedule();
  }, [showPath, schedule]);

  // The path draws the whole night, so it reads the windows the playhead has not reached: one at a time, after the
  // playhead's own window, through the same route the board plays from, and keeps only each window's centre path (the
  // frames are dropped). Windows the board already holds are skipped, and a live tail the board refreshes replaces its own.
  useEffect(() => {
    if (!showPath || !night) return;
    let dead = false;
    const g = gen.current;
    const pause = (ms: number) => new Promise<void>(res => setTimeout(res, ms));
    (async () => {
      const n = nightRef.current;
      if (!n) return;
      const start = Date.parse(n.first), end = Date.parse(n.last) + MINUTE_MS;
      const total = Math.ceil((end - start) / REPLAY_WINDOW_MS);
      for (let w = 0; w < total && !dead; w++) {
        while (!dead && wins.current.get(windowIndex(start, tRef.current))?.state !== 'ok') await pause(500);   // the picture first
        for (let tries = 0; tries < 2 && !dead && !pathStore.current.has(w); tries++) {
          const from = start + w * REPLAY_WINDOW_MS;
          try {
            const res = await fetch(windowUrl(urlsRef.current, n.night_key, from, Math.min(from + REPLAY_WINDOW_MS, end)));
            if (dead || g !== gen.current) return;
            if (res.status === 401) { setSignedOut(true); return; }
            if (!res.ok) throw new Error('bad');
            const j = await res.json();
            if (dead || g !== gen.current) return;
            const rows: { minute_at: string }[] = Array.isArray(j.rows) ? j.rows : [];
            if (!pathStore.current.has(w)) pathStore.current.addWindow(w, decodeRows(rows as Parameters<typeof decodeRows>[0]));
            setPathVer(v => v + 1);
            schedule();
          } catch { await pause(3000); }
        }
        await pause(FILL_PAUSE_MS);
      }
    })();
    return () => { dead = true; };
  }, [showPath, night?.night_key, night?.first, schedule]);   // eslint-disable-line react-hooks/exhaustive-deps

  // A new follow glides in from where the view was, and takes the zone pin off so the zone can follow the raider.
  useEffect(() => {
    for (const p of panes) p.kick = !!picks.follow;
    if (picks.follow) setPinned(null);
    schedule();
  }, [picks.follow, panes, schedule]);

  const pick = useCallback((name: string) => setPicks(p => togglePick(p, name)), []);
  // Dragging the map takes it back from a follow (the raider stays highlighted).
  const panAway = useCallback(() => setPicks(p => (p.follow ? { ...p, follow: null } : p)), []);

  // Canvas size: backing store at device pixels, drawn in CSS pixels.
  const ready = !!night;
  useEffect(() => {
    const ros: ResizeObserver[] = [];
    for (const p of panes) {
      const wrap = p.wrap;
      const cv = p.cv;
      if (!wrap || !cv) continue;
      const measure = () => {
        const r = wrap.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = Math.floor(r.width), h = Math.floor(r.height);
        p.size = { w, h, dpr };
        cv.width = Math.max(1, Math.floor(w * dpr));
        cv.height = Math.max(1, Math.floor(h * dpr));
        schedule();
      };
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(wrap);
      ros.push(ro);
    }
    return () => { for (const ro of ros) ro.disconnect(); if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; } };
  }, [panes, schedule, ready]);

  // Wheel needs a non-passive listener to stop the page scrolling under the map.
  useEffect(() => {
    const offs: (() => void)[] = [];
    panes.forEach(p => {
      const cv = p.cv;
      if (!cv) return;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const v = p.view;
        const { w, h } = p.size;
        if (!v || !w) return;
        const r = cv.getBoundingClientRect();
        p.view = zoomAt(v, e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top, w, h);
        p.fit = false;   // the viewer has the camera until Fit raid
        p.goal = null;
        p.zoomGoal = null;
        schedule();
      };
      cv.addEventListener('wheel', onWheel, { passive: false });
      offs.push(() => cv.removeEventListener('wheel', onWheel));
    });
    return () => offs.forEach(f => f());
  }, [panes, schedule, ready]);

  const zoomBy = useCallback((factor: number, px?: number, py?: number, only?: Pane) => {
    if (modeRef.current === '3d') { bridgeA.current?.zoom(factor); bridgeB.current?.zoom(factor); return; }
    for (const p of only ? [only] : panes) {
      const { w, h } = p.size;
      const v = p.view;
      if (!v || !w) continue;
      p.view = zoomAt(v, factor, px ?? w / 2, py ?? h / 2, w, h);
      p.fit = false;
      p.goal = null;
      p.zoomGoal = null;
    }
    schedule();
  }, [panes, schedule]);

  const fitRaid = useCallback(() => {
    if (modeRef.current === '3d') { bridgeA.current?.fitRaid(); bridgeB.current?.fitRaid(); return; }
    for (const p of panes) { p.view = null; p.goal = null; p.zoomGoal = null; p.fit = true; }
    schedule();
  }, [panes, schedule]);

  const fitZone = useCallback(() => {
    if (modeRef.current === '3d') { bridgeA.current?.fitZone(); bridgeB.current?.fitZone(); return; }
    for (const p of panes) {
      const e = p.zone ? mapsRef.current[p.zone] : undefined;
      if (!e || e.status !== 'ready' || !p.size.w) continue;
      const box = layerBounds(e.map, effectiveLayers('brewall', e.map));
      if (!box) continue;
      p.view = fitView(mapBox(box), p.size.w, p.size.h, 16, 100);
      p.fit = false;
    }
    schedule();
  }, [panes, schedule]);

  // The path's deliberate view, like Fit zone: Fit raid takes the camera back to the raid. It frames the whole night's path.
  const fitPath = useCallback(() => {
    panes.forEach((p, i) => {
      const ser = p.zone ? pathStore.current.seriesFor(p.zone) : [];
      let box: { minX: number; maxX: number; minY: number; maxY: number; z: number } | null = null;
      if (ser.length >= 2) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const q of ser) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); }
        box = { minX, maxX, minY, maxY, z: ser[Math.floor(ser.length / 2)].z };
      }
      if (!box) return;
      if (modeRef.current === '3d') { bridges[i].current?.fitBox(box); return; }
      if (!p.size.w) return;
      p.view = fitView(mapBox(box), p.size.w, p.size.h, 40, 300);
      p.fit = false;
      p.goal = null;
      p.zoomGoal = null;
    });
    schedule();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes, schedule]);
  // Once the whole night has been read, the first view of it is the whole path (once per night; Fit raid goes back).
  const fitDoneRef = useRef<string | null>(null);
  const pathReady = showPath && !!night && pathVer >= 0 && pathStore.current.size >= Math.max(1, Math.ceil((Date.parse(night.last) + MINUTE_MS - Date.parse(night.first)) / REPLAY_WINDOW_MS));
  useEffect(() => {
    if (!pathReady || !night || fitDoneRef.current === night.night_key + night.first) return;
    fitDoneRef.current = night.night_key + night.first;
    fitPath();
  }, [pathReady, night, fitPath, pathVer]);

  // Hover / tap / drag / pinch, per pane.
  const local = (p: Pane, e: { clientX: number; clientY: number }) => {
    const r = p.cv!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const hit = (p: Pane, px: number, py: number, reach: number): string | null => {
    let best: string | null = null;
    let bd = reach * reach;
    for (const d of p.drawn) {
      const q = (d.px - px) ** 2 + (d.py - py) ** 2;
      if (q <= bd) { bd = q; best = d.name; }
    }
    return best;
  };
  const handlers = (p: Pane) => ({
    onPointerDown: (e: React.PointerEvent) => {
      p.cv?.setPointerCapture(e.pointerId);
      p.ptrs.set(e.pointerId, local(p, e));
      p.moved = 0;
      if (p.ptrs.size === 2) {
        const [a, b] = [...p.ptrs.values()];
        p.pinch = Math.hypot(a.x - b.x, a.y - b.y);
        p.moved = 99;
      }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const pt = local(p, e);
      const prev = p.ptrs.get(e.pointerId);
      const v = p.view;
      if (!prev) {
        if (e.pointerType === 'mouse') {
          const name = hit(p, pt.x, pt.y, 12);
          if (name !== p.hover) { p.hover = name; schedule(); }
        }
        return;
      }
      p.ptrs.set(e.pointerId, pt);
      if (!v) return;
      if (p.ptrs.size === 1) {
        const dx = pt.x - prev.x, dy = pt.y - prev.y;
        p.moved += Math.abs(dx) + Math.abs(dy);
        if (p.moved > 4) {
          p.view = { ...v, cx: v.cx - dx / v.scale, cy: v.cy - dy / v.scale };
          p.fit = false;
          p.goal = null;
          p.zoomGoal = null;
          if (p.holdsFollow) panAway();
          schedule();
        }
      } else if (p.ptrs.size === 2) {
        const [a, b] = [...p.ptrs.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (p.pinch > 0 && dist > 0) zoomBy(dist / p.pinch, (a.x + b.x) / 2, (a.y + b.y) / 2, p);
        p.pinch = dist;
      }
    },
    onPointerUp: (e: React.PointerEvent) => {
      const wasTap = p.ptrs.size === 1 && p.moved <= 4;
      const pt = local(p, e);
      p.ptrs.delete(e.pointerId);
      if (wasTap) {
        const name = hit(p, pt.x, pt.y, e.pointerType === 'mouse' ? 12 : 22);
        if (name) pick(name);
      }
    },
    onPointerLeave: () => { if (p.hover) { p.hover = null; schedule(); } },
  });
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(tRef.current - 10_000); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seek(tRef.current + 10_000); }
    else if (e.key === '+' || e.key === '=') zoomBy(1.4);
    else if (e.key === '-') zoomBy(1 / 1.4);
    else if (e.key === 'Home') fitRaid();
  };

  // The picker's list: everyone seen in the windows loaded so far (the whole night once it has been played).
  const roster = useMemo(() => [...rosterRef.current.values()], [rosterVer]);   // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => groupRoster(roster, query, groupBy), [roster, query, groupBy]);
  const hlNow = useMemo(() => pickedSet(picks), [picks]);
  const clsOf = (name: string) => rosterRef.current.get(name.toLowerCase())?.cls ?? null;

  // ── render ─────────────────────────────────────────────────────────────────
  if (signedOut) {
    return <Panel>Your session ended. <a href="/auth/signin?next=/spectator/replay" className="underline">Sign in again</a> to see the replay.</Panel>;
  }
  if (!nights) return <Panel>{netErr ? 'The replay list is not answering. Reload to try again.' : 'Loading recorded nights…'}</Panel>;
  if (!night) return <Panel>No raid nights are recorded yet. A night appears here once Mimic raiders have been in a raid.</Panel>;

  const start = Date.parse(night.first);
  const end = Date.parse(night.last) + MINUTE_MS;
  const total = Math.max(1, Math.round((end - start) / 1000));
  const pos = Math.min(total, Math.max(0, Math.round((uiT - start) / 1000)));
  const dur = Math.round((end - start) / 60_000);
  const hereTotal = info.here[0] + info.here[1];
  // How much of the night's path has been read, and the kills in the order they died (the numbers on the map).
  const pathTotal = Math.max(1, Math.ceil((end - start) / REPLAY_WINDOW_MS));
  const pathParts = pathVer >= 0 ? Math.min(pathTotal, pathStore.current.size) : 0;
  const ranked = rankKills(sessionKills.map(k => ({ ...k, to: k.atMs })));
  const liveOn = !bounded && liveAvailable(end, nowMs);   // the session is being recorded: Live can follow it
  const where = split ? `${info.zones[0]} and ${info.zones[1]}` : (info.zones[0] ?? 'the raid');
  const aria = (mode === '3d' ? '3D replay' : 'Replay') + ` of ${night.night_key}: ${where} with ${hereTotal} raiders. `
    + 'Space plays or pauses, left and right arrows step ten seconds, plus and minus zoom, Home fits the raid.';

  return (
    <div className="min-w-0">
      {timeline && <RaidTimeline kills={sessionKills} nowMs={uiT} />}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-dim">
        {!bounded && (<>
        <label className="flex items-center gap-1.5">
          <span>Night</span>
          <select value={night.night_key} onChange={e => { setSessionFrom(null); setNightKey(e.target.value); }}
            className="rounded border border-border bg-panel px-2 py-1.5 text-xs text-text">
            {nights.map(n => (
              <option key={n.night_key} value={n.night_key}>
                {n.night_key} · {etDay.format(Date.parse(n.first))} · {n.sessions.length} {n.sessions.length === 1 ? 'session' : 'sessions'}
                {n.sessions.some(s => s.raid) ? ' · raid' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span>Session</span>
          <select value={chosen?.session?.from ?? ''} onChange={e => setSessionFrom(Number(e.target.value))}
            className="rounded border border-border bg-panel px-2 py-1.5 text-xs text-text">
            {(chosen?.night.sessions ?? []).map(s => (
              <option key={s.from} value={s.from}>{sessionLabel(s)}</option>
            ))}
          </select>
        </label>
        {chosen?.session && (
          <a href={`/raid/session?from=${encodeURIComponent(new Date(chosen.session.from).toISOString())}&to=${encodeURIComponent(new Date(chosen.session.to).toISOString())}`}
            className="underline hover:text-text">Review this session</a>
        )}
        </>)}
        <label className="flex items-center gap-1.5">
          <span>Zone</span>
          <select value={pinned ?? ''} onChange={e => setPinned(e.target.value || null)}
            className="rounded border border-border bg-panel px-2 py-1.5 text-xs text-text">
            <option value="">Auto (busiest){!pinned && info.zones[0] ? `: ${info.zones[0]}` : ''}</option>
            {night.zones.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        </label>
        <span className="text-text">{split ? `${info.zones[0]} + ${info.zones[1]}` : (info.zones[0] ?? 'no zone')}</span>
        <span>{hereTotal} {hereTotal === 1 ? 'raider' : 'raiders'} {split ? 'in these zones' : 'here'}</span>
        {info.elsewhere > 0 && <span>{info.elsewhere} elsewhere</span>}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Map view">
        <button type="button" className={`${chip} ${chipIdle}`} onClick={() => zoomBy(1.4)} aria-label="Zoom in">+</button>
        <button type="button" className={`${chip} ${chipIdle}`} onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out">−</button>
        <button type="button" className={`${chip} ${chipIdle}`} onClick={fitRaid}>Fit raid</button>
        <button type="button" className={`${chip} ${chipIdle}`} onClick={fitZone}>Fit zone</button>
        {mode === '2d' && (
          <button type="button" aria-pressed={tails} className={`${chip} ${tails ? chipOn : chipIdle}`} onClick={() => setTails(t => !t)}>
            Tails
          </button>
        )}
        {mode === '2d' && (
          <div className="flex items-center gap-1.5" role="group" aria-label="Map background">
            <span className="text-xs text-dim">Background</span>
            {BGS.map(b => (
              <button key={b} type="button" aria-pressed={bg === b} onClick={() => setBg(b)}
                className={`${chip} ${bg === b ? chipOn : chipIdle}`}>{b === 'none' ? 'None' : b === 'lines' ? 'Lines' : 'Parchment'}</button>
            ))}
          </div>
        )}
        {mode === '3d' && (
          <button type="button" aria-pressed={floors} className={`${chip} ${floors ? chipOn : chipIdle}`} onClick={() => setFloors(f => !f)}>
            Floors
          </button>
        )}
        <button type="button" aria-pressed={showBosses} className={`${chip} ${showBosses ? chipOn : chipIdle}`} onClick={() => setShowBosses(b => !b)}>
          Bosses
        </button>
        <button type="button" aria-expanded={pickerOpen} className={`${chip} ${pickerOpen ? chipOn : chipIdle}`} onClick={() => setPickerOpen(o => !o)}>
          Raiders{picks.hl.length ? ` (${picks.hl.length})` : ''}
        </button>
        <div className="flex items-center gap-1.5" role="group" aria-label="Split screen">
          <span className="text-xs text-dim">Split</span>
          {(['auto', 'off'] as const).map(m => (
            <button key={m} type="button" aria-pressed={picks.split === m} onClick={() => setPicks(p => ({ ...p, split: m }))}
              className={`${chip} ${picks.split === m ? chipOn : chipIdle}`}>{m === 'auto' ? 'Auto' : 'Off'}</button>
          ))}
        </div>
        {!bounded?.flat && (
        <div className="ml-auto flex gap-1.5" role="group" aria-label="Dimensions">
          {(['2d', '3d'] as const).map(m => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => { setNo3d(false); setMode(m); }}
              className={`${chip} ${mode === m ? chipOn : chipIdle}`}>{m === '2d' ? '2D' : '3D'}</button>
          ))}
        </div>
        )}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-dim" role="group" aria-label="Raid path">
        <button type="button" aria-pressed={showPath} className={`${chip} ${showPath ? chipOn : chipIdle}`} onClick={() => setShowPath(s => !s)}>
          Path
        </button>
        {showPath && <button type="button" className={`${chip} ${chipIdle}`} onClick={fitPath}>Fit path</button>}
        {showPath && pathParts < pathTotal && <span>Reading the rest of the night: {pathParts} of {pathTotal} parts</span>}
        {showPath && ranked.length > 0 && (
          <ol className="flex flex-wrap items-center gap-1" aria-label="Kills along the path, in order">
            {ranked.map(k => (
              <li key={`${k.n}-${k.name}`}>
                <button type="button" onClick={() => seek(k.atMs)} title={`${k.name}: go to this kill`}
                  className="inline-flex items-center gap-1 rounded border border-border bg-panel px-1.5 py-1 text-xs text-text hover:bg-[#21262d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue">
                  <span className="inline-block min-w-[1.1rem] rounded-full border border-gold px-1 text-center text-[11px] leading-4 text-gold">{k.n}</span>
                  {k.name}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      {pickerOpen && (
        <div className="mb-2 rounded-md border border-border bg-panel p-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search raiders or classes"
              aria-label="Search raiders"
              className="min-w-[12rem] flex-1 rounded border border-border bg-bg px-2 py-1.5 text-xs text-text" />
            <div className="flex gap-1.5" role="group" aria-label="Group raiders by">
              {(['class', 'alpha'] as const).map(g => (
                <button key={g} type="button" aria-pressed={groupBy === g} onClick={() => setGroupBy(g)}
                  className={`${chip} ${groupBy === g ? chipOn : chipIdle}`}>{g === 'class' ? 'By class' : 'A to Z'}</button>
              ))}
            </div>
            <span className="text-dim">{roster.length} seen so far</span>
          </div>
          <div className="mt-2 max-h-56 overflow-y-auto">
            {groups.length === 0 && <p className="text-dim">{roster.length ? 'Nobody matches.' : 'Raiders appear here as the night loads.'}</p>}
            {groups.map(g => (
              <div key={g.label} className="mb-2">
                {groupBy === 'class' && <h3 className="mb-1 text-[11px] uppercase tracking-wider text-dim">{g.label}</h3>}
                <div className="flex flex-wrap gap-1.5">
                  {g.raiders.map(r => {
                    const on = isPicked(hlNow, r.name);
                    return (
                      <button key={r.name} type="button" aria-pressed={on} onClick={() => pick(r.name)}
                        className={`${chip} ${on ? chipOn : chipIdle} inline-flex items-center gap-1.5`}>
                        <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: classColor(r.cls) }} />
                        {r.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {picks.hl.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Highlighted raiders">
          {picks.hl.map(n => {
            const fol = isFollowed(picks, n);
            return (
              <span key={n} className="inline-flex items-stretch overflow-hidden rounded border border-border bg-panel text-xs">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-text">
                  <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: classColor(clsOf(n)) }} />
                  {n}
                </span>
                <button type="button" aria-pressed={fol} onClick={() => setPicks(p => toggleFollow(p, n))}
                  className={`border-l border-border px-2.5 py-1.5 ${fol ? 'bg-accent text-white' : 'text-text hover:bg-[#21262d]'}`}>
                  {fol ? 'Following' : 'Follow'}
                </button>
                <button type="button" aria-label={`Stop highlighting ${n}`} onClick={() => pick(n)}
                  className="border-l border-border px-2.5 py-1.5 text-dim hover:bg-[#21262d] hover:text-text">✕</button>
              </span>
            );
          })}
          <button type="button" className={`${chip} ${chipIdle}`} onClick={() => setPicks(p => ({ ...p, hl: [], follow: null }))}>Clear</button>
          {picks.follow && info.followAbsent && state === 'ok' && (
            <span className="text-xs text-dim">{picks.follow} is not recorded at this moment.</span>
          )}
        </div>
      )}

      <div className="relative h-[52vh] max-h-[720px] min-h-[320px] w-full overflow-hidden rounded-md border border-border bg-bg sm:h-[62vh]">
        <div className="flex h-full flex-col md:flex-row">
          {panes.map((p, i) => {
            const z = info.zones[i];
            const entry = z ? maps[z] : undefined;
            return (
              <div key={i}
                className={`relative flex min-h-0 min-w-0 flex-1 flex-col${i === 1 ? (split ? ' border-t border-border md:border-l md:border-t-0' : ' hidden') : ''}`}>
                {split && (
                  <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-panel px-2 py-1 text-xs">
                    <span className="truncate text-text">{z}</span>
                    <span className="whitespace-nowrap text-dim">{info.here[i]} {info.here[i] === 1 ? 'raider' : 'raiders'}</span>
                  </div>
                )}
                <div ref={el => { p.wrap = el; }} className="relative min-h-0 flex-1">
                  <canvas ref={el => { p.cv = el; }}
                    tabIndex={0}
                    role="img"
                    aria-label={aria}
                    style={{ touchAction: 'none', width: '100%', height: '100%' }}
                    className={`absolute inset-0 block cursor-grab focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue active:cursor-grabbing${mode === '3d' ? ' invisible' : ''}`}
                    {...handlers(p)}
                    onPointerCancel={handlers(p).onPointerUp}
                    onKeyDown={onKeyDown} />
                  {mode === '3d' && z && (
                    <Replay3D zone={z} floors={floors} meshUrl={bounded?.urls.mesh} bridgeRef={bridges[i]} onReady={schedule} onKeyDown={onKeyDown}
                      onPick={pick} onPanAway={panAway}
                      onFail={() => { setNo3d(true); setMode('2d'); }}
                      label={aria} />
                  )}
                  {i === 0 && no3d && <MapNote>3D needs WebGL, which this browser did not give us. Showing the 2D map.</MapNote>}
                  {i === 0 && state === 'buffering' && <MapNote>Loading this part of the night…</MapNote>}
                  {i === 0 && state === 'failed' && <MapNote>This part of the night did not load. Retrying.</MapNote>}
                  {i === 0 && state === 'nodata' && <MapNote>Nobody was recorded at this moment.</MapNote>}
                  {state === 'ok' && mode === '2d' && (!entry || entry.status === 'loading') && z && <MapNote>Loading map…</MapNote>}
                  {state === 'ok' && mode === '2d' && entry?.status === 'none' && <MapNote>No wall map for {z} yet. Showing raiders only.</MapNote>}
                  {mode === '2d' && bg === 'parchment' && z && parchment.status(z) === 'loading' && !(state === 'ok' && (!entry || entry.status === 'loading')) && (
                    <MapNote>Loading the parchment floors…</MapNote>
                  )}
                  {mode === '2d' && bg === 'parchment' && z && parchment.status(z) === 'error' && (
                    <MapNote>
                      The floors did not load; showing the paper alone.{' '}
                      <button type="button" className="pointer-events-auto underline" onClick={() => parchment.retry(z)}>Retry</button>
                    </MapNote>
                  )}
                  {state === 'ok' && mode === '2d' && entry?.status === 'error' && (
                    <MapNote>
                      The map did not load.{' '}
                      <button type="button" className="pointer-events-auto underline" onClick={() => z && loadMap(z)}>Retry</button>
                    </MapNote>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 rounded-md border border-border bg-panel p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button type="button" onClick={togglePlay} aria-pressed={playing}
            className={`${chip} ${playing ? chipOn : chipIdle} min-w-[4.5rem]`}>
            {playing ? 'Pause' : 'Play'}
          </button>
          {liveOn && (
            <button type="button" aria-pressed={live} onClick={live ? setLiveOff : startLive}
              className={`${chip} ${live ? chipOn : chipIdle}`}>
              <span aria-hidden="true" className={live ? 'text-red-400' : undefined}>●</span> Live
            </button>
          )}
          <div className="flex gap-1.5" role="group" aria-label="Speed">
            {SPEEDS.map(s => (
              <button key={s} type="button" aria-pressed={speed === s} onClick={() => { setSpeed(s); if (s !== 1) setLiveOff(); }}
                className={`${chip} ${speed === s ? chipOn : chipIdle}`}>{s}×</button>
            ))}
          </div>
          <span className="ml-auto font-mono text-sm tabular-nums text-text" aria-live="off">
            {etClock.format(uiT)} <span className="text-xs text-dim">ET</span>
          </span>
        </div>

        <div className="relative mt-3">
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded bg-border" aria-hidden="true">
            {night.spans.map((s, i) => (
              <span key={i} className="absolute top-0 h-full rounded bg-accent/60"
                style={{ left: `${((s.from - start) / (end - start)) * 100}%`, width: `${((s.to - s.from) / (end - start)) * 100}%` }} />
            ))}
          </div>
          <input type="range" min={0} max={total} step={1} value={pos}
            onChange={e => seek(start + Number(e.target.value) * 1000)}
            aria-label="Time in the night" aria-valuetext={etClock.format(uiT)}
            className="relative block h-6 w-full cursor-pointer appearance-none bg-transparent accent-white" />
        </div>
        <div className="mt-1 flex justify-between text-xs text-dim">
          <span>{etShort.format(start)}</span>
          <span>{dur >= 60 ? `${Math.floor(dur / 60)} h ${dur % 60} min` : `${dur} min`}</span>
          <span>{etShort.format(end)}</span>
        </div>
      </div>

      <div className="mt-3">
        <h2 className="mb-1.5 text-xs uppercase tracking-wider text-dim">Zones in this session, in visit order</h2>
        <ol className="flex flex-wrap gap-1.5">
          {night.runs.map((r, i) => {
            const on = uiT >= r.from && uiT < r.to;
            return (
              <li key={i}>
                <button type="button" onClick={() => seek(r.from)} aria-current={on ? 'true' : undefined}
                  className={`${chip} ${on ? chipOn : chipIdle}`}>
                  {r.zone} <span className={on ? 'text-white/80' : 'text-dim'}>{etShort.format(r.from)}–{etShort.format(r.to)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="rounded-md border border-border bg-panel px-4 py-10 text-center text-sm text-dim">
      {children}
    </div>
  );
}

function MapNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute left-2 top-2 max-w-[80%] rounded border border-border bg-panel/90 px-2 py-1 text-xs text-dim">
      {children}
    </div>
  );
}
