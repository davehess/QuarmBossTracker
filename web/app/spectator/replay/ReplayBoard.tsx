'use client';
// The /spectator/replay board: a recorded raid night played back on the same zone maps the live board uses.
//
// Rules this file keeps:
//   * The playhead, the frames and the view live in refs. React state holds only what the controls show
//     (the clock, the slider, the zone, the buffering note), updated a few times a second at most, so a dot
//     never costs a React render.
//   * One requestAnimationFrame loop, running only while playing; a pause, a scrub or a data arrival draws
//     once through the same guard.
//   * The data arrives in 15-minute windows (/api/spectator/replay). The window the playhead is in and the next
//     one are kept; the rest are dropped, so a whole night (~5.5 MB) is never held at once.
//   * Between two recorded frames (about 3 s apart) a dot is interpolated, so it glides instead of hopping.
// The coordinate rules (axis swap, north up, heading) live in lib/spectator.ts; the decoding in lib/raidReplay.ts.
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  classAbbr, classColor, coreRaiders, effectiveLayers, fitView, headingVec, layerBounds, lineNearZ, mapBox,
  median, nearestBand, needsRefit, parseZoneMap, raidBox, scaleBarUnits, toScreen, zoomAt,
  type View, type ZoneMap,
} from '@/lib/spectator';
import {
  FRAME_GAP_MS, MINUTE_MS, REPLAY_WINDOW_MS, decodeRows, frameIndexAt, nextSpanStart, pickReplayZone, windowIndex,
  zoneCounts, type NightSummary, type ReplayFrame, type ReplayRaider,
} from '@/lib/raidReplay';
import { bandColor, prepare, type Prepared } from '../SpectatorBoard';
import type { Bridge3D } from './Replay3D';

// three.js is only fetched when the 3D view is first shown.
const Replay3D = dynamic(() => import('./Replay3D'), {
  ssr: false,
  loading: () => <MapNote>Loading 3D…</MapNote>,
});

const BG = '#0d1117';
const PANEL = '#161b22';
const BORDER = '#30363d';
const TEXT = '#c9d1d9';
const FONT = '12px "Cascadia Code", Consolas, ui-monospace, monospace';
const DOT_R = 4.5;
const TAIL_MS = 30_000;
const TELEPORT = 200;   // a raider who moved further than this between two frames did not walk it: no glide, no tail
const SPEEDS = [1, 10, 30, 60];

type MapEntry =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'error' }
  | { status: 'ready'; map: ZoneMap; prep: Prepared };

type Win = { state: 'loading' | 'ok' | 'err'; at: number };
type Drawn = { name: string; cls: string | null; hp: number | null; px: number; py: number };

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

export default function ReplayBoard() {
  const [nights, setNights] = useState<NightSummary[] | null>(null);
  const [netErr, setNetErr] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [nightKey, setNightKey] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [pinned, setPinned] = useState<string | null>(null);
  const [tails, setTails] = useState(true);
  const [uiT, setUiT] = useState(0);
  const [shownZone, setShownZone] = useState<string | null>(null);
  const [counts, setCounts] = useState({ here: 0, elsewhere: 0 });
  const [state, setState] = useState<'ok' | 'buffering' | 'nodata' | 'failed'>('ok');
  const [maps, setMaps] = useState<Record<string, MapEntry>>({});
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [no3d, setNo3d] = useState(false);

  const night = nights ? (nights.find(n => n.night_key === nightKey) ?? nights[0] ?? null) : null;

  // ── refs: everything the drawing reads ─────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const viewRef = useRef<View | null>(null);
  const followRef = useRef(true);
  const nightRef = useRef<NightSummary | null>(null);
  const tRef = useRef(0);
  const playingRef = useRef(false);
  const speedRef = useRef(10);
  const tailsRef = useRef(true);
  const pinnedRef = useRef<string | null>(null);
  const autoZoneRef = useRef<string | null>(null);
  const reportedZone = useRef<string | null>(null);
  const viewZone = useRef<string | null>(null);
  const framesRef = useRef<ReplayFrame[]>([]);
  const winFrames = useRef(new Map<number, ReplayFrame[]>());
  const wins = useRef(new Map<number, Win>());
  const gen = useRef(0);
  const mapsRef = useRef<Record<string, MapEntry>>({});
  const mapReqs = useRef(new Set<string>());
  const drawn = useRef<Drawn[]>([]);
  const hoverRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const rafRef = useRef(0);
  const lastTs = useRef(0);
  const lastUi = useRef(0);
  const stepRef = useRef<(ts: number) => void>(() => {});
  const nextCache = useRef<{ frame: ReplayFrame | null; byName: Map<string, ReplayRaider> }>({ frame: null, byName: new Map() });
  // 3D: while it is showing, paint() hands each frame's raiders to the 3D view instead of drawing the canvas.
  const modeRef = useRef<'2d' | '3d'>('2d');
  const bridge3d = useRef<Bridge3D | null>(null);

  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(ts => stepRef.current(ts));
  }, []);

  // ── data ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let dead = false;
    fetch('/api/spectator/replay?nights=1')
      .then(async res => {
        if (res.status === 401) { if (!dead) setSignedOut(true); return; }
        if (!res.ok) throw new Error('bad');
        const j = await res.json();
        if (!dead) setNights(Array.isArray(j.nights) ? j.nights : []);
      })
      .catch(() => { if (!dead) setNetErr(true); });
    return () => { dead = true; };
  }, []);

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
    const have = wins.current.get(w);
    if (have && (have.state !== 'err' || Date.now() - have.at < 5000)) return;   // an error is retried after 5 s
    wins.current.set(w, { state: 'loading', at: Date.now() });
    const g = gen.current;
    const to = Math.min(from + REPLAY_WINDOW_MS, end);
    const url = '/api/spectator/replay?night=' + encodeURIComponent(n.night_key)
      + '&from=' + encodeURIComponent(new Date(from).toISOString())
      + '&to=' + encodeURIComponent(new Date(to).toISOString());
    fetch(url)
      .then(async res => {
        if (g !== gen.current) return;
        if (res.status === 401) { setSignedOut(true); return; }
        if (!res.ok) throw new Error('bad');
        const j = await res.json();
        if (g !== gen.current) return;
        winFrames.current.set(w, decodeRows(Array.isArray(j.rows) ? j.rows : []));
        wins.current.set(w, { state: 'ok', at: Date.now() });
        rebuild();
      })
      .catch(() => {
        if (g !== gen.current) return;
        wins.current.set(w, { state: 'err', at: Date.now() });
        schedule();
        setTimeout(schedule, 5000);   // the next pass asks again
      });
  }, [rebuild, schedule]);

  // A new night starts at its first minute, paused, with nothing loaded.
  useEffect(() => {
    nightRef.current = night;
    gen.current++;
    winFrames.current.clear();
    wins.current.clear();
    framesRef.current = [];
    playingRef.current = false;
    setPlaying(false);
    pinnedRef.current = null;
    setPinned(null);
    autoZoneRef.current = null;
    viewZone.current = null;
    reportedZone.current = null;
    setShownZone(null);
    if (!night) return;
    tRef.current = Date.parse(night.first);
    setUiT(tRef.current);
    ensureWindow(0);
    schedule();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [night?.night_key]);

  // The map for the zone on screen: once per zone, kept for the visit.
  const loadMap = useCallback((z: string) => {
    if (mapReqs.current.has(z)) return;
    mapReqs.current.add(z);
    const put = (e: MapEntry) => {
      mapsRef.current = { ...mapsRef.current, [z]: e };
      setMaps(mapsRef.current);
      schedule();
    };
    put({ status: 'loading' });
    fetch('/api/spectator/map?zone=' + encodeURIComponent(z))
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
    if (shownZone && !maps[shownZone] && mode === '2d') loadMap(shownZone);   // the 3D view fetches its own mesh
  }, [shownZone, maps, loadMap, mode]);

  // ── drawing ────────────────────────────────────────────────────────────────
  // Draws the picture at playhead `t`. Returns what the controls need to show.
  const paint = useCallback((t: number) => {
    const frames = framesRef.current;
    const idx = frameIndexAt(frames, t);
    const a = idx >= 0 && t - frames[idx].t <= FRAME_GAP_MS ? frames[idx] : null;
    const out = { zone: null as string | null, here: 0, elsewhere: 0, hasFrame: !!a };

    // Which zone: the pin, else the busiest one (with a little stickiness), else the last one shown.
    let zone = pinnedRef.current;
    if (!zone && a) autoZoneRef.current = pickReplayZone(zoneCounts(a), autoZoneRef.current);
    if (!zone) zone = autoZoneRef.current;
    out.zone = zone;
    // A new zone starts fresh: fit the raid, nobody picked.
    if (zone !== viewZone.current) {
      viewZone.current = zone;
      viewRef.current = null;
      followRef.current = true;
      selectedRef.current = null;
      hoverRef.current = null;
    }

    const cv = canvasRef.current;
    const { w, h, dpr } = sizeRef.current;
    if (!cv || !w || !h) return out;
    const ctx = cv.getContext('2d');
    if (!ctx) return out;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
    drawn.current = [];

    const here = a && zone ? a.raiders.filter(r => r.zone === zone) : [];
    out.here = here.length;
    out.elsewhere = a ? a.raiders.length - here.length : 0;

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
    const placed = here.map(r => {
      const n = b ? nextCache.current.byName.get(r.name) : undefined;
      if (n && n.zone === r.zone && Math.hypot(n.x - r.x, n.y - r.y) < TELEPORT) {
        return { r, x: lerp(r.x, n.x, f), y: lerp(r.y, n.y, f), z: lerp(r.z, n.z, f) };
      }
      return { r, x: r.x, y: r.y, z: r.z };
    });

    if (modeRef.current === '3d') {
      bridge3d.current?.feed(zone, placed.map(p => ({ name: p.r.name, cls: p.r.cls, hp: p.r.hp, x: p.x, y: p.y, z: p.z })));
      return out;
    }

    // The view: fit the raid once, then follow it only while it is about to leave the picture.
    if (followRef.current && placed.length) {
      const box = raidBox(coreRaiders(here))!;
      const v = viewRef.current;
      if (!v || needsRefit(v, box, w, h)) viewRef.current = fitView(box, w, h);
    }
    const v = viewRef.current;
    if (!v) return out;
    const ox = w / 2 - v.cx * v.scale;
    const oy = h / 2 - v.cy * v.scale;
    const refZ = median(here.map(r => r.z));

    // The zone's map underneath.
    const entry = zone ? mapsRef.current[zone] : undefined;
    if (entry?.status === 'ready') {
      const layers = effectiveLayers('brewall', entry.map);
      const { prep } = entry;
      const multi = prep.bands.length > 1 && refZ != null;
      if (prep.bw && layers.brewall) {
        ctx.lineCap = 'butt';
        ctx.lineWidth = 1;
        for (const bright of [false, true]) {
          ctx.globalAlpha = bright ? 0.9 : 0.22;
          for (const g of prep.bw.groups) {
            ctx.strokeStyle = g.css;
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
          ctx.strokeStyle = bandColor(bi, prep.gen!.length, bright ? 0.85 : 0.2);
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

    // Tails: where each raider in this zone was over the last TAIL_MS, fading toward the past.
    if (tailsRef.current && a && zone) {
      const since = t - TAIL_MS;
      let j = idx;
      while (j > 0 && frames[j - 1].t >= since) j--;
      const last = new Map<string, { x: number; y: number }>();
      ctx.lineCap = 'round';
      ctx.lineWidth = 1.5;
      for (let k = j; k <= idx; k++) {
        const fr = frames[k];
        const alpha = 0.55 * Math.max(0, (fr.t - since) / TAIL_MS);
        for (const r of fr.raiders) {
          if (r.zone !== zone) continue;
          const prev = last.get(r.name);
          if (prev && Math.hypot(r.x - prev.x, r.y - prev.y) < TELEPORT) {
            ctx.globalAlpha = alpha;
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

    // Dots, the picked one last.
    const sel = selectedRef.current;
    placed.sort((p, q) => Number(p.r.name === sel) - Number(q.r.name === sel));
    ctx.lineCap = 'butt';
    for (const { r, x, y } of placed) {
      const px = sx(x), py = sy(y);
      if (px < -20 || px > w + 20 || py < -20 || py > h + 20) continue;
      const color = classColor(r.cls);
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
      if (r.name === sel) {
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(px, py, DOT_R + 3.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      drawn.current.push({ name: r.name, cls: r.cls, hp: r.hp, px, py });
    }

    // Name labels: the hovered or tapped raider only.
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    for (const name of new Set([hoverRef.current, sel])) {
      const d = name ? drawn.current.find(q => q.name === name) : undefined;
      if (!d) continue;
      const text = `${d.name} · ${classAbbr(d.cls)}${d.hp != null ? ` · ${d.hp}%` : ''}`;
      const tw = ctx.measureText(text).width + 12;
      const lx = Math.max(4, Math.min(w - tw - 4, d.px + 10));
      const ly = Math.max(14, Math.min(h - 14, d.py - 14));
      ctx.fillStyle = PANEL;
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 1;
      ctx.fillRect(lx, ly - 10, tw, 20);
      ctx.strokeRect(lx + 0.5, ly - 9.5, tw - 1, 19);
      ctx.fillStyle = TEXT;
      ctx.fillText(text, lx + 6, ly);
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
    return out;
  }, []);

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
    const w = windowIndex(start, t);
    const here = wins.current.get(w);
    const loaded = here?.state === 'ok';
    if (!loaded) ensureWindow(w);

    if (playingRef.current) {
      const sp = nextSpanStart(n.spans, t);
      if (!sp.inside) {
        // A break in the raid (nobody recorded): jump over it.
        if (sp.next != null) t = sp.next; else { t = end - 1; playingRef.current = false; setPlaying(false); }
      } else if (loaded) {
        t += dt * speedRef.current;
        if (t >= end) { t = end - 1; playingRef.current = false; setPlaying(false); }
      }
      if (loaded) {
        ensureWindow(w + 1);
        if (speedRef.current >= 30) ensureWindow(w + 2);
      }
      tRef.current = t;
    }

    const info = paint(t);

    const buffering = !loaded && here?.state !== 'err';
    const next = buffering ? 'buffering'
      : here?.state === 'err' ? 'failed'
      : !info.hasFrame ? 'nodata' : 'ok';
    setState(next);
    if (info.zone !== reportedZone.current) { reportedZone.current = info.zone; setShownZone(info.zone); }
    setCounts(c => (c.here === info.here && c.elsewhere === info.elsewhere ? c : { here: info.here, elsewhere: info.elsewhere }));
    if (!playingRef.current || ts - lastUi.current > 200) { lastUi.current = ts; setUiT(t); }

    if (playingRef.current) schedule();
  }, [ensureWindow, paint, schedule]);
  stepRef.current = step;

  // ── controls ───────────────────────────────────────────────────────────────
  const seek = useCallback((t: number) => {
    const n = nightRef.current;
    if (!n) return;
    const lo = Date.parse(n.first), hi = Date.parse(n.last) + MINUTE_MS - 1;
    tRef.current = Math.min(hi, Math.max(lo, t));
    lastTs.current = 0;
    setUiT(tRef.current);
    schedule();
  }, [schedule]);

  const togglePlay = useCallback(() => {
    const n = nightRef.current;
    if (!n) return;
    const p = !playingRef.current;
    if (p && tRef.current >= Date.parse(n.last) + MINUTE_MS - 2000) tRef.current = Date.parse(n.first);
    playingRef.current = p;
    lastTs.current = 0;
    setPlaying(p);
    schedule();
  }, [schedule]);

  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { tailsRef.current = tails; schedule(); }, [tails, schedule]);
  // The same playhead, night and zone carry across: only where the frame is drawn changes.
  useEffect(() => { modeRef.current = mode; schedule(); }, [mode, schedule]);
  useEffect(() => {
    pinnedRef.current = pinned;
    schedule();
  }, [pinned, schedule]);

  // Canvas size: backing store at device pixels, drawn in CSS pixels.
  const ready = !!night;
  useEffect(() => {
    const wrap = wrapRef.current;
    const cv = canvasRef.current;
    if (!wrap || !cv) return;
    const measure = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.floor(r.width), h = Math.floor(r.height);
      sizeRef.current = { w, h, dpr };
      cv.width = Math.max(1, Math.floor(w * dpr));
      cv.height = Math.max(1, Math.floor(h * dpr));
      schedule();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => { ro.disconnect(); if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; } };
  }, [schedule, ready]);

  // Wheel needs a non-passive listener to stop the page scrolling under the map.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const { w, h } = sizeRef.current;
      if (!v || !w) return;
      const r = cv.getBoundingClientRect();
      viewRef.current = zoomAt(v, e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top, w, h);
      followRef.current = false;
      schedule();
    };
    cv.addEventListener('wheel', onWheel, { passive: false });
    return () => cv.removeEventListener('wheel', onWheel);
  }, [schedule, ready]);

  const zoomBy = useCallback((factor: number, px?: number, py?: number) => {
    if (modeRef.current === '3d') { bridge3d.current?.zoom(factor); return; }
    const { w, h } = sizeRef.current;
    const v = viewRef.current;
    if (!v || !w) return;
    viewRef.current = zoomAt(v, factor, px ?? w / 2, py ?? h / 2, w, h);
    followRef.current = false;
    schedule();
  }, [schedule]);

  const fitRaid = useCallback(() => {
    if (modeRef.current === '3d') { bridge3d.current?.fitRaid(); return; }
    viewRef.current = null;
    followRef.current = true;
    schedule();
  }, [schedule]);

  const fitZone = useCallback(() => {
    if (modeRef.current === '3d') { bridge3d.current?.fitZone(); return; }
    const { w, h } = sizeRef.current;
    const z = reportedZone.current;
    const e = z ? mapsRef.current[z] : undefined;
    if (!e || e.status !== 'ready' || !w) return;
    const box = layerBounds(e.map, effectiveLayers('brewall', e.map));
    if (!box) return;
    viewRef.current = fitView(mapBox(box), w, h, 16, 100);
    followRef.current = false;
    schedule();
  }, [schedule]);

  // Hover / tap / drag / pinch.
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: 0, pinch: 0 });
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const hit = (px: number, py: number, reach: number): string | null => {
    let best: string | null = null;
    let bd = reach * reach;
    for (const d of drawn.current) {
      const q = (d.px - px) ** 2 + (d.py - py) ** 2;
      if (q <= bd) { bd = q; best = d.name; }
    }
    return best;
  };
  const onPointerDown = (e: React.PointerEvent) => {
    canvasRef.current?.setPointerCapture(e.pointerId);
    ptrs.current.set(e.pointerId, local(e));
    gesture.current.moved = 0;
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      gesture.current.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.current.moved = 99;
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    const prev = ptrs.current.get(e.pointerId);
    const v = viewRef.current;
    if (!prev) {
      if (e.pointerType === 'mouse') {
        const name = hit(p.x, p.y, 12);
        if (name !== hoverRef.current) { hoverRef.current = name; schedule(); }
      }
      return;
    }
    ptrs.current.set(e.pointerId, p);
    if (!v) return;
    if (ptrs.current.size === 1) {
      const dx = p.x - prev.x, dy = p.y - prev.y;
      gesture.current.moved += Math.abs(dx) + Math.abs(dy);
      if (gesture.current.moved > 4) {
        viewRef.current = { ...v, cx: v.cx - dx / v.scale, cy: v.cy - dy / v.scale };
        followRef.current = false;
        schedule();
      }
    } else if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.current.pinch > 0 && dist > 0) zoomBy(dist / gesture.current.pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      gesture.current.pinch = dist;
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const wasTap = ptrs.current.size === 1 && gesture.current.moved <= 4;
    const p = local(e);
    ptrs.current.delete(e.pointerId);
    if (wasTap) { selectedRef.current = hit(p.x, p.y, e.pointerType === 'mouse' ? 12 : 22); schedule(); }
  };
  const onPointerLeave = () => { if (hoverRef.current) { hoverRef.current = null; schedule(); } };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(tRef.current - 10_000); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seek(tRef.current + 10_000); }
    else if (e.key === '+' || e.key === '=') zoomBy(1.4);
    else if (e.key === '-') zoomBy(1 / 1.4);
    else if (e.key === 'Home') fitRaid();
  };

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
  const entry = shownZone ? maps[shownZone] : undefined;
  const dur = Math.round((end - start) / 60_000);

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-dim">
        <label className="flex items-center gap-1.5">
          <span>Night</span>
          <select value={night.night_key} onChange={e => setNightKey(e.target.value)}
            className="rounded border border-border bg-panel px-2 py-1.5 text-xs text-text">
            {nights.map(n => (
              <option key={n.night_key} value={n.night_key}>
                {n.night_key} · {etDay.format(Date.parse(n.first))} · {Math.round(n.minutes / 6) / 10} h recorded
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span>Zone</span>
          <select value={pinned ?? ''} onChange={e => setPinned(e.target.value || null)}
            className="rounded border border-border bg-panel px-2 py-1.5 text-xs text-text">
            <option value="">Auto (busiest){!pinned && shownZone ? `: ${shownZone}` : ''}</option>
            {night.zones.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        </label>
        <span className="text-text">{shownZone ?? 'no zone'}</span>
        <span>{counts.here} {counts.here === 1 ? 'raider' : 'raiders'} here</span>
        {counts.elsewhere > 0 && <span>{counts.elsewhere} elsewhere</span>}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Map view">
        <button type="button" className={`${chip} ${chipIdle}`} onClick={() => zoomBy(1.4)} aria-label="Zoom in">+</button>
        <button type="button" className={`${chip} ${chipIdle}`} onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out">−</button>
        <button type="button" className={`${chip} ${chipIdle}`} onClick={fitRaid}>Fit raid</button>
        <button type="button" className={`${chip} ${chipIdle} disabled:opacity-40`} onClick={fitZone}
          disabled={mode === '2d' && entry?.status !== 'ready'}>Fit zone</button>
        {mode === '2d' && (
          <button type="button" aria-pressed={tails} className={`${chip} ${tails ? chipOn : chipIdle}`} onClick={() => setTails(t => !t)}>
            Tails
          </button>
        )}
        <div className="ml-auto flex gap-1.5" role="group" aria-label="Dimensions">
          {(['2d', '3d'] as const).map(m => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => { setNo3d(false); setMode(m); }}
              className={`${chip} ${mode === m ? chipOn : chipIdle}`}>{m === '2d' ? '2D' : '3D'}</button>
          ))}
        </div>
      </div>

      <div ref={wrapRef} className="relative h-[52vh] max-h-[720px] min-h-[320px] w-full overflow-hidden rounded-md border border-border bg-bg sm:h-[62vh]">
        <canvas ref={canvasRef}
          tabIndex={0}
          role="img"
          aria-label={`Replay of ${night.night_key}: top-down map of ${shownZone ?? 'the raid'} with ${counts.here} raiders. Space plays or pauses, left and right arrows step ten seconds, plus and minus zoom, Home fits the raid.`}
          style={{ touchAction: 'none', width: '100%', height: '100%' }}
          className={`block cursor-grab focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue active:cursor-grabbing${mode === '3d' ? ' invisible' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
          onKeyDown={onKeyDown} />
        {mode === '3d' && (
          <Replay3D zone={shownZone} bridgeRef={bridge3d} onReady={schedule} onKeyDown={onKeyDown}
            onFail={() => { setNo3d(true); setMode('2d'); }}
            label={`3D replay of ${night.night_key}: ${shownZone ?? 'the raid'} with ${counts.here} raiders. Space plays or pauses, left and right arrows step ten seconds, plus and minus zoom, Home fits the raid.`} />
        )}
        {no3d && <MapNote>3D needs WebGL, which this browser did not give us. Showing the 2D map.</MapNote>}
        {state === 'buffering' && <MapNote>Loading this part of the night…</MapNote>}
        {state === 'failed' && <MapNote>This part of the night did not load. Retrying.</MapNote>}
        {state === 'nodata' && <MapNote>Nobody was recorded at this moment.</MapNote>}
        {state === 'ok' && mode === '2d' && (!entry || entry.status === 'loading') && shownZone && <MapNote>Loading map…</MapNote>}
        {state === 'ok' && mode === '2d' && entry?.status === 'none' && <MapNote>No wall map for {shownZone} yet. Showing raiders only.</MapNote>}
        {state === 'ok' && mode === '2d' && entry?.status === 'error' && (
          <MapNote>
            The map did not load.{' '}
            <button type="button" className="pointer-events-auto underline" onClick={() => shownZone && loadMap(shownZone)}>Retry</button>
          </MapNote>
        )}
      </div>

      <div className="mt-3 rounded-md border border-border bg-panel p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button type="button" onClick={togglePlay} aria-pressed={playing}
            className={`${chip} ${playing ? chipOn : chipIdle} min-w-[4.5rem]`}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <div className="flex gap-1.5" role="group" aria-label="Speed">
            {SPEEDS.map(s => (
              <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}
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
        <h2 className="mb-1.5 text-xs uppercase tracking-wider text-dim">Zones tonight, in visit order</h2>
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
