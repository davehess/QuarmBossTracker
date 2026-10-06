'use client';
// The /spectator board: a canvas with the zone's map underneath (Brewall's lines, the generated walls, or
// both) and the raid's dots on top.
//
// Rules this file keeps:
//   * No free-running loop. A frame is drawn only when something changed (a poll, a pan, a toggle, a
//     resize), through one requestAnimationFrame guard.
//   * The poll pauses while the tab is hidden and resumes at once when it is shown again.
//   * The map for a zone is fetched once and kept for the visit.
//   * Colour is never the only carrier: the roster beside the map spells out class, group and HP.
// The coordinate rules (axis swap, north up, heading) live in lib/spectator.ts with their tests.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DOT_STALE_S, classAbbr, classColor, deriveBands, effectiveLayers, fitView, headingVec, layerBounds,
  coreRaiders, lineNearZ, liftColor, mapBox, median, needsRefit, nearestBand, parseZoneMap, pickZone, raidBox,
  scaleBarUnits, toScreen, zoomAt,
  type LayerChoice, type Positions, type Raider, type View, type ZoneMap,
} from '@/lib/spectator';

const POLL_MS = 3000;   // positions are uploaded every ~3 s, so polling faster only repeats the same rows
const BG = '#0d1117';
const PANEL = '#161b22';
const BORDER = '#30363d';
const TEXT = '#c9d1d9';
const FONT = '12px "Cascadia Code", Consolas, ui-monospace, monospace';
const LABEL_FONT = '10px "Cascadia Code", Consolas, ui-monospace, monospace';
const DOT_R = 5.5;
// Brewall's place names are drawn only once the map is zoomed in this far (pixels per game unit), cut to
// LABEL_CHARS, and never over another name, so a zone is lines and dots with a few words, not a wall of text.
// (Checked on a real zone: at fit-the-zone scale, 0.15 piled forty names on top of each other.)
const LABEL_MIN_SCALE = 0.35;
const LABEL_MAX = 60;
const LABEL_CHARS = 26;

// A zone's map, ready to draw: everything already in the picture's frame (x, y negated), in flat typed
// arrays so a frame is a loop. `bands` are the floors the chips show: the generated walls' own, else
// worked out from Brewall's line heights.
type BwGroup = { css: string; xy: Float32Array; z: Float32Array; band: Uint16Array };
type BwLabelP = { sx: number; sy: number; z: number; band: number; text: string };
type Prepared = {
  gen: Float32Array[] | null;
  bw: { groups: BwGroup[]; labels: BwLabelP[] } | null;
  bands: number[];
};

type MapEntry =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'error' }
  | { status: 'ready'; map: ZoneMap; prep: Prepared };

function prepare(map: ZoneMap): Prepared {
  const bands = map.eqemu ? map.eqemu.bands : map.brewall ? deriveBands(map.brewall.lines) : [];

  let gen: Float32Array[] | null = null;
  if (map.eqemu) {
    const { segs } = map.eqemu;
    const counts = map.eqemu.bands.map(() => 0);
    for (const s of segs) if (s[4] >= 0 && s[4] < counts.length) counts[s[4]]++;
    gen = counts.map(n => new Float32Array(n * 4));
    const at = counts.map(() => 0);
    for (const s of segs) {
      const b = s[4];
      if (b < 0 || b >= gen.length) continue;
      const i = at[b]++ * 4;
      gen[b][i] = -s[0]; gen[b][i + 1] = -s[1]; gen[b][i + 2] = -s[2]; gen[b][i + 3] = -s[3];
    }
  }

  let bw: Prepared['bw'] = null;
  if (map.brewall) {
    const by = new Map<string, { xy: number[]; z: number[]; band: number[] }>();
    for (const l of map.brewall.lines) {
      const key = liftColor(l[6], l[7], l[8]).join(',');
      let g = by.get(key);
      if (!g) by.set(key, g = { xy: [], z: [], band: [] });
      g.xy.push(-l[0], -l[1], -l[3], -l[4]);
      g.z.push(Math.min(l[2], l[5]), Math.max(l[2], l[5]));
      g.band.push(Math.max(0, nearestBand(bands, (l[2] + l[5]) / 2)));
    }
    bw = {
      groups: [...by].map(([key, g]) => ({
        css: `rgb(${key})`, xy: Float32Array.from(g.xy), z: Float32Array.from(g.z), band: Uint16Array.from(g.band),
      })),
      labels: map.brewall.labels.map(l => ({
        sx: -l[0], sy: -l[1], z: l[2], band: Math.max(0, nearestBand(bands, l[2])), text: l[3].slice(0, 40),
      })),
    };
  }
  return { gen, bw, bands };
}

// Low floors cool, high floors warm: a hue per band index. Muted (the dots are the loud thing on this page).
function bandColor(i: number, n: number, alpha: number) {
  const hue = n <= 1 ? 205 : 215 - (i / (n - 1)) * 190;
  return `hsla(${hue.toFixed(0)}, 42%, 60%, ${alpha})`;
}

const chip = 'rounded border px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors '
  + 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue';
const chipIdle = 'border-border bg-panel text-text hover:bg-[#21262d]';
const chipOn = 'border-accent bg-accent text-white';
// Floors are all on by default, so their "on" is a quiet outline: six solid blue chips read as six alarms.
const chipFloorOn = 'border-accent bg-accent/15 text-text';
const chipOff ='disabled:opacity-40 disabled:hover:bg-panel';

// `embedded`: the board inside /screen, which owns the page chrome. It drops the roster column and the help
// line (the screen's right rail has its own panels), the "Live" word (the screen's bar says it), and lets the
// map take the height of the window. Everything else is the same board, with the same poll.
export default function SpectatorBoard({ embedded = false }: { embedded?: boolean } = {}) {
  const [feed, setFeed] = useState<{ data: Positions; rxAt: number } | null>(null);
  const [netErr, setNetErr] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [maps, setMaps] = useState<Record<string, MapEntry>>({});
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [following, setFollowingState] = useState(true);
  const [layer, setLayer] = useState<LayerChoice>('brewall');

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const followRef = useRef(true);
  const rafRef = useRef(0);
  const hoverRef = useRef<string | null>(null);
  const mapReqs = useRef(new Set<string>());
  const live = useRef({
    raiders: [] as Raider[], map: null as Extract<MapEntry, { status: 'ready' }> | null,
    hidden: new Set<number>(), focusBand: -1, selected: null as string | null, rxAt: 0,
    layers: { brewall: false, generated: false },
    refZ: null as number | null,   // the raid's median z
    filter: false,                 // more than one floor, so lines off the raid's floor are dimmed
  });

  const setFollow = useCallback((on: boolean) => { followRef.current = on; setFollowingState(on); }, []);

  // ── derived ────────────────────────────────────────────────────────────────
  const zones = feed?.data.zones ?? [];
  const zone = pickZone(zones, chosen);
  const zoneName = zones.find(z => z.zone === zone)?.name ?? zone ?? '';
  const raiders = useMemo(
    () => (feed && zone ? feed.data.raiders.filter(r => r.zone === zone) : []),
    [feed, zone],
  );
  const otherZones = feed ? feed.data.raiders.length - raiders.length : 0;
  // Raiders the framing leaves out (a straggler, a corpse run): said on the page so a dot off the edge is not a mystery.
  const awayCount = raiders.length - coreRaiders(raiders).length;
  const entry = zone ? maps[zone] : undefined;
  const ready = entry?.status === 'ready' ? entry : null;
  const bands = ready ? ready.prep.bands : [];
  const refZ = median(raiders.map(r => r.z));
  const focusBand = ready ? nearestBand(bands, refZ) : -1;
  // Which layers show: the viewer's pick, but never one the zone lacks.
  const layers = ready ? effectiveLayers(layer, ready.map) : { brewall: false, generated: false };
  const layerBrewall = layers.brewall, layerGenerated = layers.generated;
  const hasBoth = !!ready && !!ready.map.eqemu && !!ready.map.brewall;
  // The canvas exists only while there is something to show; effects that touch it key on this.
  const showBoard = !signedOut && !!feed && !!zone && raiders.length > 0;

  // ── drawing ────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const cv = canvasRef.current;
    const { w, h, dpr } = sizeRef.current;
    const v = viewRef.current;
    if (!cv || !w || !h) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const s = live.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
    if (!v) return;
    const ox = w / 2 - v.cx * v.scale;
    const oy = h / 2 - v.cy * v.scale;

    // Brewall's map, underneath: its own colours, dimmed so the dots stay the loudest thing. With more than
    // one floor, lines within FLOOR_BAND_Z of the raid's z are drawn brighter (second pass), the rest dim;
    // a floor switched off by its chip is not drawn.
    const bw = s.map?.prep.bw;
    if (bw && s.layers.brewall) {
      // (Brighter than first drafted: at 0.7 / 0.16 a zone-wide view of Brewall's lines was barely there.)
      const alpha = s.layers.generated ? { on: 0.55, off: 0.12 } : { on: 0.9, off: 0.22 };
      ctx.lineCap = 'butt';
      ctx.lineWidth = 1;
      for (const bright of [false, true]) {
        ctx.globalAlpha = bright ? alpha.on : alpha.off;
        for (const g of bw.groups) {
          ctx.strokeStyle = g.css;
          ctx.beginPath();
          for (let i = 0, n = g.band.length; i < n; i++) {
            if (s.hidden.has(g.band[i])) continue;
            const near = !s.filter || lineNearZ(g.z[2 * i], g.z[2 * i + 1], s.refZ as number);
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

    // Generated walls, one stroke per band: the raid's floor bright, the rest dim.
    const gen = s.map?.prep.gen;
    if (gen && s.layers.generated) {
      const n = gen.length;
      ctx.lineCap = 'round';
      for (let b = 0; b < n; b++) {
        if (s.hidden.has(b)) continue;
        const bright = b === s.focusBand;
        ctx.strokeStyle = bandColor(b, n, bright ? 0.85 : 0.2);
        ctx.lineWidth = bright ? 1.4 : 1;
        const a = gen[b];
        ctx.beginPath();
        for (let i = 0; i < a.length; i += 4) {
          const x1 = a[i] * v.scale + ox, y1 = a[i + 1] * v.scale + oy;
          const x2 = a[i + 2] * v.scale + ox, y2 = a[i + 3] * v.scale + oy;
          if ((x1 < 0 && x2 < 0) || (x1 > w && x2 > w) || (y1 < 0 && y2 < 0) || (y1 > h && y2 > h)) continue;
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
        }
        ctx.stroke();
      }
    }

    // Brewall's place names: only when zoomed in, on the raid's floor, cut short, and never over another name.
    // A halo in the page colour keeps a name readable where it crosses a wall.
    if (bw && s.layers.brewall && v.scale >= LABEL_MIN_SCALE) {
      ctx.font = LABEL_FONT;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = BG;
      ctx.fillStyle = TEXT;
      const placed: [number, number, number, number][] = [];   // x0, y0, x1, y1 of names already drawn
      for (const L of bw.labels) {
        if (placed.length >= LABEL_MAX) break;
        if (s.hidden.has(L.band)) continue;
        if (s.filter && !lineNearZ(L.z, L.z, s.refZ as number)) continue;
        const px = L.sx * v.scale + ox, py = L.sy * v.scale + oy;
        if (py < 7 || py > h - 7) continue;
        const name = L.text.replace(/^#/, '');   // "#" marks a placed NPC in the map files
        const text = name.length > LABEL_CHARS ? name.slice(0, LABEL_CHARS - 1) + '…' : name;
        const hw = ctx.measureText(text).width / 2 + 3;
        const box: [number, number, number, number] = [px - hw, py - 7, px + hw, py + 7];
        if (box[0] < 0 || box[2] > w) continue;   // a name cut by the edge of the picture is not drawn
        if (placed.some(p => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
        placed.push(box);
        ctx.globalAlpha = 0.85;
        ctx.strokeText(text, px, py);
        ctx.fillText(text, px, py);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'start';
    }

    // Dots: stale ones first so a live dot is never hidden under a faded one; the selected one last.
    const elapsed = (Date.now() - s.rxAt) / 1000;
    const pos = (r: Raider) => {
      const p = toScreen(r.x, r.y);
      return { px: p.sx * v.scale + ox, py: p.sy * v.scale + oy };
    };
    const staleOf = (r: Raider) => r.age_s + elapsed > DOT_STALE_S;
    const order = [...s.raiders].sort((a, b) =>
      Number(staleOf(b)) - Number(staleOf(a)) || Number(a.name === s.selected) - Number(b.name === s.selected));
    ctx.lineCap = 'butt';
    for (const r of order) {
      const { px, py } = pos(r);
      if (px < -20 || px > w + 20 || py < -20 || py > h + 20) continue;
      const color = classColor(r.cls);
      ctx.globalAlpha = staleOf(r) ? 0.35 : 1;
      if (r.heading != null) {
        const { dx, dy } = headingVec(r.heading);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px + dx * DOT_R, py + dy * DOT_R);
        ctx.lineTo(px + dx * (DOT_R + 7), py + dy * (DOT_R + 7));
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.strokeStyle = BG;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, DOT_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (r.name === s.selected) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, DOT_R + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Labels for the dot under the pointer and the one picked.
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    for (const name of new Set([hoverRef.current, s.selected])) {
      const r = name ? s.raiders.find(x => x.name === name) : undefined;
      if (!r) continue;
      const { px, py } = pos(r);
      const text = `${r.name} · ${classAbbr(r.cls)}${r.level ? ' ' + r.level : ''}${r.hp != null ? ' · ' + r.hp + '%' : ''}`
        + (staleOf(r) ? ` · ${Math.round(r.age_s + elapsed)}s ago` : '');
      const tw = ctx.measureText(text).width + 12;
      let lx = px + 12;
      if (lx + tw > w - 4) lx = px - 12 - tw;
      const ly = Math.max(14, Math.min(h - 14, py));
      ctx.fillStyle = PANEL;
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 1;
      ctx.fillRect(lx, ly - 10, tw, 20);
      ctx.strokeRect(lx + 0.5, ly - 9.5, tw - 1, 19);
      ctx.fillStyle = TEXT;
      ctx.fillText(text, lx + 6, ly);
    }

    // Scale bar (bottom-left) and north (top-right; north is always up).
    const units = scaleBarUnits(v.scale);
    const len = units * v.scale;
    // Words get a halo in the page colour: a wall line runs through them otherwise.
    ctx.lineJoin = 'round';
    ctx.strokeStyle = BG;
    ctx.fillStyle = TEXT;
    ctx.lineWidth = 3;
    ctx.strokeText(`${units.toLocaleString()} units`, 14, h - 34);
    ctx.fillText(`${units.toLocaleString()} units`, 14, h - 34);
    ctx.textAlign = 'center';
    ctx.strokeText('N', w - 22, 36);
    ctx.fillText('N', w - 22, 36);
    ctx.textAlign = 'start';
    ctx.strokeStyle = TEXT;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(14, h - 26); ctx.lineTo(14, h - 18); ctx.lineTo(14 + len, h - 18); ctx.lineTo(14 + len, h - 26);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w - 22, 12); ctx.lineTo(w - 16, 26); ctx.lineTo(w - 22, 22); ctx.lineTo(w - 28, 26); ctx.closePath();
    ctx.fill();
  }, []);

  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; draw(); });
  }, [draw]);

  // While following, re-fit only when the raid is leaving the picture (see needsRefit). "The raid" is its
  // core (coreRaiders): one straggler does not set the zoom.
  const sync = useCallback(() => {
    const { w, h } = sizeRef.current;
    const rs = live.current.raiders;
    if (w && h && followRef.current && rs.length) {
      const box = raidBox(coreRaiders(rs))!;
      const v = viewRef.current;
      if (!v || needsRefit(v, box, w, h)) viewRef.current = fitView(box, w, h);
    }
    schedule();
  }, [schedule]);

  // ── effects ────────────────────────────────────────────────────────────────

  // The poll: sequential (the next one starts POLL_MS after the last answer), paused while hidden.
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
        const res = await fetch('/api/spectator/positions', { cache: 'no-store', signal: ctrl.signal });
        if (res.status === 401) { setSignedOut(true); stop = true; return; }
        if (!res.ok) throw new Error('feed ' + res.status);
        const j = await res.json();
        if (!Array.isArray(j?.raiders) || !Array.isArray(j?.zones)) throw new Error('feed shape');
        if (!stop) { setFeed({ data: j as Positions, rxAt: Date.now() }); setNetErr(false); }
      } catch (e) {
        if (!stop && (e as Error)?.name !== 'AbortError') setNetErr(true);
      } finally {
        busy = false;
      }
      if (!stop && !document.hidden) timer = setTimeout(run, POLL_MS);
    };
    const onVisibility = () => {
      if (document.hidden) { if (timer) clearTimeout(timer); timer = undefined; ctrl?.abort(); }
      else if (!timer && !busy) run();
    };
    document.addEventListener('visibilitychange', onVisibility);
    run();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
      ctrl?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // The map for the zone on screen: once per zone, kept for the visit. 404 = no map yet.
  const loadMap = useCallback((z: string) => {
    if (mapReqs.current.has(z)) return;
    mapReqs.current.add(z);
    setMaps(m => ({ ...m, [z]: { status: 'loading' } }));
    const put = (e: MapEntry) => setMaps(m => ({ ...m, [z]: e }));
    fetch('/api/spectator/map?zone=' + encodeURIComponent(z))
      .then(async res => {
        if (res.status === 404) return put({ status: 'none' });
        if (!res.ok) return put({ status: 'error' });
        const map = parseZoneMap(await res.json());
        put(map ? { status: 'ready', map, prep: prepare(map) } : { status: 'none' });
      })
      .catch(() => put({ status: 'error' }))
      .finally(() => mapReqs.current.delete(z));
  }, []);
  useEffect(() => {
    if (zone && !entry) loadMap(zone);
  }, [zone, entry, loadMap]);

  // A new zone starts fresh: follow the raid, all floors on, nobody picked.
  useEffect(() => {
    viewRef.current = null;
    setFollow(true);
    setHidden(new Set());
    setSelected(null);
    hoverRef.current = null;
  }, [zone, setFollow]);

  // Hand the latest data to the drawing code and draw.
  useEffect(() => {
    live.current = {
      raiders, map: ready, hidden, focusBand, selected, rxAt: feed?.rxAt ?? 0,
      layers: { brewall: layerBrewall, generated: layerGenerated },
      refZ, filter: bands.length > 1 && refZ != null,
    };
    sync();
  }, [raiders, ready, hidden, focusBand, selected, feed, sync, layerBrewall, layerGenerated, refZ, bands.length]);

  // Canvas size: backing store at device pixels, drawn in CSS pixels.
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
      sync();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => { ro.disconnect(); if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; } };
  }, [sync, showBoard]);

  // ── interaction ────────────────────────────────────────────────────────────
  const stopFollowing = useCallback(() => { if (followRef.current) setFollow(false); }, [setFollow]);

  const zoomBy = useCallback((factor: number, px?: number, py?: number) => {
    const { w, h } = sizeRef.current;
    const v = viewRef.current;
    if (!v || !w) return;
    viewRef.current = zoomAt(v, factor, px ?? w / 2, py ?? h / 2, w, h);
    stopFollowing();
    schedule();
  }, [schedule, stopFollowing]);

  const fitRaid = useCallback(() => {
    const { w, h } = sizeRef.current;
    const box = raidBox(coreRaiders(live.current.raiders));
    if (!box || !w) return;
    viewRef.current = fitView(box, w, h);
    setFollow(true);
    schedule();
  }, [schedule, setFollow]);

  const fitZone = useCallback(() => {
    const { w, h } = sizeRef.current;
    const m = live.current.map;
    const box = m && layerBounds(m.map, live.current.layers);
    if (!box || !w) return;
    viewRef.current = fitView(mapBox(box), w, h, 16, 100);
    setFollow(false);
    schedule();
  }, [schedule, setFollow]);

  const locate = useCallback((name: string) => {
    const { w, h } = sizeRef.current;
    const r = live.current.raiders.find(x => x.name === name);
    setSelected(name);
    if (!r || !w) return;
    const p = toScreen(r.x, r.y);
    const v = viewRef.current;
    // Close enough to read the neighbourhood (about 400 units across), never zoomed further out than now.
    viewRef.current = { cx: p.sx, cy: p.sy, scale: Math.max(v?.scale ?? 0, Math.min(w, h) / 400) };
    setFollow(false);
    schedule();
    wrapRef.current?.scrollIntoView({ block: 'nearest' });
  }, [schedule, setFollow]);

  const hit = useCallback((px: number, py: number, reach: number): string | null => {
    const { w, h } = sizeRef.current;
    const v = viewRef.current;
    if (!v) return null;
    let best: string | null = null;
    let bd = reach * reach;
    for (const r of live.current.raiders) {
      const p = toScreen(r.x, r.y);
      const dx = (p.sx - v.cx) * v.scale + w / 2 - px;
      const dy = (p.sy - v.cy) * v.scale + h / 2 - py;
      const d = dx * dx + dy * dy;
      if (d <= bd) { bd = d; best = r.name; }
    }
    return best;
  }, []);

  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: 0, pinch: 0 });
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
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
        const name = hit(p.x, p.y, 14);
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
        stopFollowing();
        schedule();
      }
    } else if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.current.pinch > 0 && dist > 0) {
        zoomBy(dist / gesture.current.pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      gesture.current.pinch = dist;
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const wasTap = ptrs.current.size === 1 && gesture.current.moved <= 4;
    const p = local(e);
    ptrs.current.delete(e.pointerId);
    if (wasTap) setSelected(hit(p.x, p.y, e.pointerType === 'mouse' ? 14 : 22));
  };
  const onPointerLeave = () => { if (hoverRef.current) { hoverRef.current = null; schedule(); } };

  // Wheel needs a non-passive listener to stop the page scrolling under the map.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    cv.addEventListener('wheel', onWheel, { passive: false });
    return () => cv.removeEventListener('wheel', onWheel);
  }, [zoomBy, showBoard]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const v = viewRef.current;
    const { w, h } = sizeRef.current;
    if (!v) return;
    const step = 0.15 * Math.min(w, h) / v.scale;
    const pan = (dx: number, dy: number) => {
      viewRef.current = { ...v, cx: v.cx + dx * step, cy: v.cy + dy * step };
      stopFollowing();
      schedule();
    };
    switch (e.key) {
      case 'ArrowLeft': pan(-1, 0); break;
      case 'ArrowRight': pan(1, 0); break;
      case 'ArrowUp': pan(0, -1); break;
      case 'ArrowDown': pan(0, 1); break;
      case '+': case '=': zoomBy(1.4); break;
      case '-': case '_': zoomBy(1 / 1.4); break;
      case 'Home': fitRaid(); break;
      default: return;
    }
    e.preventDefault();
  };

  const toggleBand = (i: number) => setHidden(prev => {
    const n = new Set(prev);
    if (n.has(i)) n.delete(i); else n.add(i);
    return n;
  });

  // ── render ─────────────────────────────────────────────────────────────────
  if (signedOut) {
    return (
      <Panel>
        Your session ended.{' '}
        <a href={embedded ? '/auth/signin?next=/screen' : '/auth/signin?next=/spectator'} className="underline">Sign in again</a> to see the board.
      </Panel>
    );
  }
  if (!feed) {
    return <Panel>{netErr ? 'The positions feed is not answering. Retrying.' : 'Loading positions…'}</Panel>;
  }
  if (!zone || !raiders.length) {
    return (
      <Panel>
        <p className="text-text">No raid positions in the last 30 seconds — the board fills in when Mimic raiders are in a raid.</p>
        {feed.data.unplaced > 0 && (
          <p className="mt-2 text-xs">
            {feed.data.unplaced} {feed.data.unplaced === 1 ? 'raider has' : 'raiders have'} a position but no known zone yet.
          </p>
        )}
        {netErr && <p className="mt-2 text-xs text-orange">Reconnecting…</p>}
      </Panel>
    );
  }

  const bandOrder = bands.map((z, i) => i).sort((a, b) => bands[b] - bands[a]);
  const groups = new Map<number | null, Raider[]>();
  for (const r of raiders) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  const groupKeys = [...groups.keys()].sort((a, b) => (a ?? 1e9) - (b ?? 1e9));
  const elapsed = (Date.now() - feed.rxAt) / 1000;

  return (
    <div className={embedded ? 'min-w-0' : 'grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]'}>
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dim">
          {(!embedded || netErr) && (
            <span className={netErr ? 'text-orange' : 'text-green'}>{netErr ? 'Reconnecting…' : '● Live'}</span>
          )}
          <span className="text-text">{zoneName}</span>
          <span>{raiders.length} {raiders.length === 1 ? 'raider' : 'raiders'}</span>
          {awayCount > 0 && <span>{awayCount} away from the raid{embedded ? '' : ' (tap one in the roster)'}</span>}
          {otherZones > 0 && <span>{otherZones} in other zones</span>}
          {feed.data.unplaced > 0 && <span>{feed.data.unplaced} not placed (zone unknown)</span>}
        </div>

        {zones.length > 1 && (
          <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Zone">
            {zones.map(z => (
              <button key={z.zone} type="button" aria-pressed={z.zone === zone}
                onClick={() => setChosen(z.zone)}
                className={`${chip} ${z.zone === zone ? chipOn : chipIdle}`}>
                {z.name} · {z.count}
              </button>
            ))}
          </div>
        )}

        <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Map view">
          <button type="button" className={`${chip} ${chipIdle}`} onClick={() => zoomBy(1.4)} aria-label="Zoom in">+</button>
          <button type="button" className={`${chip} ${chipIdle}`} onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out">−</button>
          <button type="button" aria-pressed={following} className={`${chip} ${following ? chipOn : chipIdle}`} onClick={fitRaid}>
            Fit raid
          </button>
          <button type="button" className={`${chip} ${chipIdle} ${chipOff}`} onClick={fitZone} disabled={!ready}>
            Fit zone
          </button>
        </div>

        <div ref={wrapRef}
          className={`relative w-full overflow-hidden rounded-md border border-border bg-bg min-h-[320px] ${
            embedded ? 'h-[56vh] lg:h-[calc(100vh-17rem)]' : 'h-[52vh] max-h-[720px] sm:h-[62vh]'}`}>
          <canvas ref={canvasRef}
            tabIndex={0}
            role="img"
            aria-label={`Top-down map of ${zoneName} with ${raiders.length} raiders. Arrow keys pan, plus and minus zoom, Home fits the raid. The roster lists everyone.`}
            style={{ touchAction: 'none', width: '100%', height: '100%' }}
            className="block cursor-grab focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerLeave}
            onKeyDown={onKeyDown} />
          {(!entry || entry.status === 'loading') && (
            <MapNote>Loading map…</MapNote>
          )}
          {entry?.status === 'none' && (
            <MapNote>No wall map for {zoneName} yet. Showing raiders only.</MapNote>
          )}
          {entry?.status === 'error' && (
            <MapNote>
              The map did not load.{' '}
              <button type="button" className="pointer-events-auto underline" onClick={() => zone && loadMap(zone)}>Retry</button>
            </MapNote>
          )}
        </div>

        {hasBoth && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Map layer">
            <span className="text-xs text-dim">Map</span>
            {([['brewall', 'Brewall map'], ['generated', 'Generated walls'], ['both', 'Both']] as [LayerChoice, string][]).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={layer === id} onClick={() => setLayer(id)}
                className={`${chip} ${layer === id ? chipOn : chipIdle}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {bands.length > 1 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Floors">
            <span className="text-xs text-dim">Floors (z)</span>
            {bandOrder.map(i => (
              <button key={i} type="button" aria-pressed={!hidden.has(i)}
                title={i === focusBand ? "The raid's floor, drawn bright" : undefined}
                onClick={() => toggleBand(i)}
                className={`${chip} ${hidden.has(i) ? chipIdle + ' opacity-60' : chipFloorOn} ${i === focusBand ? 'font-bold' : ''}`}>
                {i === focusBand ? '● ' : ''}{Math.round(bands[i])}
              </button>
            ))}
          </div>
        )}
        {!embedded && (
          <p className="mt-2 text-xs text-dim">
            Drag to pan, scroll or pinch to zoom. Dots point the way each raider faces and fade when a position is more than {DOT_STALE_S} seconds old.
            {bands.length > 1 ? ' The bright lines are the floor the raid is on.' : ''}
          </p>
        )}
      </div>

      {!embedded && (
      <aside className="min-w-0 rounded-md border border-border bg-panel p-2 lg:max-h-[80vh] lg:overflow-y-auto" aria-label="Raid roster">
        <ul className="space-y-3">
          {groupKeys.map(g => (
            <li key={g ?? 'none'}>
              <div className="mb-1 flex justify-between px-1 text-xs text-dim">
                <span>{g == null ? 'Ungrouped' : `Group ${g}`}</span>
                <span>{groups.get(g)!.length}</span>
              </div>
              <ul>
                {groups.get(g)!.map(r => {
                  const stale = r.age_s + elapsed > DOT_STALE_S;
                  const on = r.name === selected;
                  return (
                    <li key={r.name}>
                      <button type="button" onClick={() => locate(r.name)} aria-label={`Locate ${r.name}`} aria-current={on || undefined}
                        className={`flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-xs hover:bg-[#21262d] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${on ? 'bg-accent/20' : ''} ${stale ? 'opacity-60' : ''}`}>
                        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: classColor(r.cls) }} />
                        <span className="w-8 shrink-0 text-dim">{classAbbr(r.cls)}</span>
                        <span className="min-w-0 flex-1 truncate text-text">{r.name}</span>
                        {stale && <span className="shrink-0 text-dim">{Math.round(r.age_s + elapsed)}s</span>}
                        <HpCell hp={r.hp} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </aside>
      )}
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

function HpCell({ hp }: { hp: number | null }) {
  // Most raiders send no HP (only some uploaders' Zeal does): a dash alone, not forty empty bars.
  const bar = hp == null ? '' : hp > 50 ? 'bg-green' : hp > 25 ? 'bg-orange' : 'bg-red';
  return (
    <span className="flex w-14 shrink-0 items-center justify-end gap-1.5">
      {hp != null && (
        <span className="h-1 w-6 overflow-hidden rounded bg-border">
          <span className={`block h-full ${bar}`} style={{ width: `${hp}%` }} />
        </span>
      )}
      <span className={`w-8 text-right tabular-nums ${hp == null ? 'text-dim' : 'text-text'}`}>{hp == null ? '–' : `${hp}%`}</span>
    </span>
  );
}
