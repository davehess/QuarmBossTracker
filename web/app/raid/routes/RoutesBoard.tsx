'use client';

// /raid/routes: pick a zone, tick the recorded nights to average, read the route. Everything here is drawing and
// choosing; the maths is done on the server (web/lib/raidRoutesLoad.ts) and arrives as the finished answer.
//
// Frame: points arrive in the SERVER frame and are drawn north-up at (-x, -y), the site's convention (toScreen).
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { parseZoneMap, toScreen, type ZoneMap } from '@/lib/spectator';
import { sessionRange } from '@/lib/raidReplay';
import { fmtSecs, type ClearDot, type LegResult } from '@/lib/raidRoutes';
import type { NightOut, ZoneAnswer, ZoneListing } from '@/lib/raidRoutesLoad';
import { saveRoute } from './actions';

const NIGHT_COLORS = ['#39c5cf', '#f0883e', '#a371f7', '#56d364', '#58a6ff', '#f778ba', '#8b949e', '#ff7b72'];
const LEG_COLORS = ['#ff7b72', '#79c0ff', '#7ee787', '#d2a8ff', '#ffa657', '#f2cc60', '#a5d6ff', '#ffb1c8'];
const GOLD = '#e3b341';
const INK = '#0d1117';
const WALL = '#6e7681';
const MAX_WALLS = 6000;

const etDate = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
const etClock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit' });

// Legs are named by the stops they join: the first runs from the first engage to stop 1, the next from 1 to 2.
const legLabel = (i: number) => `${i === 0 ? 'Start' : i}→${i + 1}`;

type Load<T> = { status: 'loading' } | { status: 'error' } | { status: 'none' } | { status: 'ready'; data: T };

// ── walls ─────────────────────────────────────────────────────────────────────
function wallPath(map: ZoneMap | null, view: { x: number; y: number; w: number; h: number }): string {
  if (!map) return '';
  const pad = Math.max(view.w, view.h) * 0.05;
  const keep = (ax: number, ay: number, bx: number, by: number) =>
    Math.max(ax, bx) >= view.x - pad && Math.min(ax, bx) <= view.x + view.w + pad
    && Math.max(ay, by) >= view.y - pad && Math.min(ay, by) <= view.y + view.h + pad;
  const segs: [number, number, number, number][] = [];
  if (map.eqemu) for (const s of map.eqemu.segs) segs.push([-s[0], -s[1], -s[2], -s[3]]);
  else if (map.brewall) for (const l of map.brewall.lines) segs.push([-l[0], -l[1], -l[3], -l[4]]);
  const kept = segs.filter(s => keep(s[0], s[1], s[2], s[3]));
  if (kept.length > MAX_WALLS) kept.sort((a, b) => Math.hypot(b[2] - b[0], b[3] - b[1]) - Math.hypot(a[2] - a[0], a[3] - a[1]));
  return kept.slice(0, MAX_WALLS).map(s => `M${Math.round(s[0])} ${Math.round(s[1])}L${Math.round(s[2])} ${Math.round(s[3])}`).join('');
}

// ── the picture ───────────────────────────────────────────────────────────────
function RouteMap({ answer, map, showNights, showClears, showBand }: {
  answer: ZoneAnswer; map: ZoneMap | null; showNights: boolean; showClears: boolean; showBand: boolean;
}) {
  const { route, nights } = answer;
  const sc = (x: number, y: number) => { const s = toScreen(x, y); return [s.sx, s.sy] as const; };

  const view = useMemo(() => {
    const xs: number[] = [], ys: number[] = [];
    const add = (x: number, y: number) => { const [a, b] = sc(x, y); xs.push(a); ys.push(b); };
    for (const l of route.legs) for (const p of l.pts) add(p[0], p[1]);
    for (const s of route.stops) if (s.x != null && s.y != null) add(s.x, s.y);
    for (const c of route.clears) add(c.x, c.y);
    for (const n of nights) if (n.included) for (const p of n.path) add(p[0], p[1]);
    if (!xs.length && map?.eqemu) { const b = map.eqemu.bounds; xs.push(-b.maxX, -b.minX); ys.push(-b.maxY, -b.minY); }
    if (!xs.length) return { x: -100, y: -100, w: 200, h: 200 };
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY, 200);
    const pad = span * 0.1;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer, map]);

  const walls = useMemo(() => wallPath(map, view), [map, view]);
  const big = Math.max(view.w, view.h);
  const r = big * 0.0085;
  const fs = big * 0.022;

  const line = (pts: readonly (readonly [number, number])[]) => pts.map(p => sc(p[0], p[1]).join(',')).join(' ');

  // the spread band of a leg: a polygon from offsets along the normal
  const bandPath = (l: LegResult) => {
    if (l.pts.length < 3 || l.trackNights < 2) return '';
    const cap = big * 0.12;
    const left: string[] = [], right: string[] = [];
    l.pts.forEach((p, i) => {
      const a = l.pts[Math.max(0, i - 1)], b = l.pts[Math.min(l.pts.length - 1, i + 1)];
      const [ax, ay] = sc(a[0], a[1]), [bx, by] = sc(b[0], b[1]), [px, py] = sc(p[0], p[1]);
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const nx = -(by - ay) / len, ny = (bx - ax) / len;
      const w = Math.min(l.band[i] ?? 0, cap);
      left.push(`${px + nx * w},${py + ny * w}`);
      right.push(`${px - nx * w},${py - ny * w}`);
    });
    return `M${left.join('L')}L${right.reverse().join('L')}Z`;
  };

  const arrows = route.legs.flatMap(l => [0.25, 0.5, 0.75].flatMap(f => {
    const i = Math.round((l.pts.length - 1) * f);
    if (l.pts.length < 4 || i < 1) return [];
    const a = l.pts[i - 1], b = l.pts[Math.min(l.pts.length - 1, i + 1)], p = l.pts[i];
    const [ax, ay] = sc(a[0], a[1]), [bx, by] = sc(b[0], b[1]), [px, py] = sc(p[0], p[1]);
    if (Math.hypot(bx - ax, by - ay) < big * 0.004) return [];
    return [{ px, py, deg: (Math.atan2(by - ay, bx - ax) * 180) / Math.PI, k: `${l.index}-${f}` }];
  }));

  const halo = { stroke: INK, strokeWidth: fs * 0.28, paintOrder: 'stroke' as const, strokeLinejoin: 'round' as const };
  const dots = showClears ? route.clears : [];

  return (
    <svg
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height={560}
      role="img"
      aria-label={`Averaged route through ${answer.name}: ${route.stops.length} named stops`}
      className="rounded border border-border bg-black/30"
    >
      {walls && <path d={walls} fill="none" stroke={WALL} strokeOpacity={0.8} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      {showNights && nights.filter(n => n.included && n.path.length > 1).map(n => (
        <polyline key={n.key} points={line(n.path)} fill="none" stroke={NIGHT_COLORS[nights.indexOf(n) % NIGHT_COLORS.length]}
          strokeOpacity={0.45} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      ))}
      {showBand && route.legs.map(l => { const d = bandPath(l); return d ? <path key={`b${l.index}`} d={d} fill={GOLD} fillOpacity={0.16} /> : null; })}
      {dots.map((c: ClearDot, i) => {
        const [cx, cy] = sc(c.x, c.y);
        const col = LEG_COLORS[c.leg % LEG_COLORS.length];
        const always = c.of > 0 && c.nights >= c.of;
        return (
          <circle key={`c${i}`} cx={cx} cy={cy} r={r * (always ? 1.15 : 0.9)}
            fill={always ? col : 'none'} fillOpacity={0.9} stroke={col} strokeWidth={1.2} vectorEffect="non-scaling-stroke">
            <title>{`${c.name}: cleared on ${c.nights} of ${c.of} nights (${c.kills} kills), leg ${c.leg + 1}`}</title>
          </circle>
        );
      })}
      {route.legs.filter(l => l.pts.length > 1).map(l => (
        <polyline key={`l${l.index}`} points={line(l.pts)} fill="none" stroke={GOLD} strokeWidth={4} strokeLinejoin="round"
          strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      ))}
      {arrows.map(a => (
        <path key={a.k} d={`M${-r * 1.1} ${-r * 0.8}L${r * 1.1} 0L${-r * 1.1} ${r * 0.8}Z`} fill={INK} stroke={GOLD} strokeWidth={1.2}
          vectorEffect="non-scaling-stroke" transform={`translate(${a.px} ${a.py}) rotate(${a.deg})`} />
      ))}
      {route.start && (() => {
        const [sx, sy] = sc(route.start[0], route.start[1]);
        return (
          <g>
            <circle cx={sx} cy={sy} r={r * 1.2} fill={INK} stroke="#56d364" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            <text x={sx + r * 2} y={sy} fontSize={fs} fill="#56d364" dominantBaseline="central" {...halo}>First engage</text>
          </g>
        );
      })()}
      {route.stops.map(s => {
        if (s.x == null || s.y == null) return null;
        const [sx, sy] = sc(s.x, s.y);
        return (
          <g key={s.npc_id}>
            <circle cx={sx} cy={sy} r={r * 1.7} fill={GOLD} stroke={INK} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            <text x={sx} y={sy} fontSize={fs * 0.95} fill={INK} textAnchor="middle" dominantBaseline="central" fontWeight={700}>{s.n}</text>
            <text x={sx + r * 2.6} y={sy} fontSize={fs} fill="#c9d1d9" dominantBaseline="central" {...halo}>{s.name}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── the board ─────────────────────────────────────────────────────────────────
export default function RoutesBoard({ officer }: { officer: boolean }) {
  const [zones, setZones] = useState<Load<ZoneListing[]>>({ status: 'loading' });
  const [zone, setZone] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string> | null>(null);   // null = every night (before the first answer)
  const [answer, setAnswer] = useState<Load<ZoneAnswer>>({ status: 'loading' });
  const [map, setMap] = useState<ZoneMap | null>(null);
  const [showNights, setShowNights] = useState(true);
  const [showClears, setShowClears] = useState(true);
  const [showBand, setShowBand] = useState(true);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const req = useRef(0);

  useEffect(() => {
    const ac = new AbortController();
    fetch('/api/raid/routes?zones=1', { signal: ac.signal })
      .then(async res => {
        if (!res.ok) return setZones({ status: 'error' });
        const list = ((await res.json()) as { zones: ZoneListing[] }).zones;
        if (!list.length) return setZones({ status: 'none' });
        setZones({ status: 'ready', data: list });
        const want = new URLSearchParams(window.location.search).get('zone');
        setZone(list.find(z => z.zone === want)?.zone ?? [...list].sort((a, b) => b.visits.length - a.visits.length)[0].zone);
      })
      .catch(() => { if (!ac.signal.aborted) setZones({ status: 'error' }); });
    return () => ac.abort();
  }, []);

  const pickZone = (z: string) => { setZone(z); setChecked(null); setAnswer({ status: 'loading' }); setSaveMsg(null); };

  // the answer, for the zone and the ticked nights
  const checkedKey = checked ? [...checked].sort().join(',') : null;
  useEffect(() => {
    if (!zone) return;
    const mine = ++req.current;
    const ac = new AbortController();
    const t = setTimeout(() => {
      const url = `/api/raid/routes?zone=${encodeURIComponent(zone)}` + (checkedKey != null ? `&nights=${encodeURIComponent(checkedKey)}` : '');
      fetch(url, { signal: ac.signal })
        .then(async res => {
          if (mine !== req.current) return;
          if (res.status === 404) return setAnswer({ status: 'none' });
          if (!res.ok) return setAnswer({ status: 'error' });
          const a = (await res.json()) as ZoneAnswer;
          setAnswer({ status: 'ready', data: a });
          if (checkedKey == null) setChecked(new Set(a.selected));
        })
        .catch(() => { if (!ac.signal.aborted && mine === req.current) setAnswer({ status: 'error' }); });
    }, checkedKey == null ? 0 : 250);
    return () => { clearTimeout(t); ac.abort(); };
  }, [zone, checkedKey]);

  // the walls, once per zone (the spectator map answer, kept an hour by the browser)
  useEffect(() => {
    if (!zone) return;
    setMap(null);
    const ac = new AbortController();
    fetch(`/api/spectator/map?zone=${encodeURIComponent(zone)}`, { signal: ac.signal })
      .then(async res => { if (res.ok) setMap(parseZoneMap(await res.json())); })
      .catch(() => {});
    return () => ac.abort();
  }, [zone]);

  const toggle = useCallback((key: string) => {
    setChecked(prev => {
      const next = new Set(prev ?? []);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const save = () => {
    if (!zone || !checked) return;
    setSaveMsg(null);
    startSave(async () => {
      const res = await saveRoute(zone, [...checked]);
      setSaveMsg(res.ok ? `Saved: ${res.saved} points for the ${answer.status === 'ready' ? answer.data.name : zone} route.` : res.error);
    });
  };

  if (zones.status === 'loading') return <p className="text-sm text-dim">Loading the recorded zones...</p>;
  if (zones.status === 'error') return <p className="text-sm text-red">Could not load the recorded zones. Reload to try again.</p>;
  if (zones.status === 'none') return <p className="text-sm text-dim">No raid night has been recorded in a zone yet.</p>;

  const a = answer.status === 'ready' ? answer.data : null;
  const listing = zones.data.find(z => z.zone === zone);

  return (
    <div>
      <label className="block text-xs text-dim" htmlFor="route-zone">Zone</label>
      <select id="route-zone" value={zone ?? ''} onChange={e => pickZone(e.target.value)}
        className="mt-1 mb-4 w-full max-w-sm rounded border border-border bg-panel px-2 py-1.5 text-sm text-text">
        {zones.data.map(z => <option key={z.zone} value={z.zone}>{z.name} ({z.visits.length} {z.visits.length === 1 ? 'night' : 'nights'})</option>)}
      </select>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* the nights */}
        <section aria-label="Recorded nights" className="rounded-lg border border-border bg-panel p-3">
          <h2 className="text-sm text-gold">Recorded nights</h2>
          <p className="mt-1 text-xs text-dim">
            Tick the nights to average. The clock on each starts at its <b className="text-text">first engage</b>, the first mob of any kind pulled in
            this zone, not at zone-in. Untick a night that was pre-cleared or is not comparable.
          </p>
          <ul className="mt-3 space-y-3">
            {(a ? a.nights : listing?.visits.map(v => ({ ...v, included: checked?.has(v.key) ?? true, flags: [], named: [], preTrash: 0, preMinutes: null, engageToNamedS: null, firstEngage: null, trashKills: 0, path: [] } as NightOut)) ?? []).map((n, i) => (
              <NightRow key={n.key} n={n} color={NIGHT_COLORS[i % NIGHT_COLORS.length]} on={checked ? checked.has(n.key) : true} onToggle={() => toggle(n.key)} ready={!!a} />
            ))}
          </ul>
        </section>

        {/* the map and the table */}
        <div className="min-w-0">
          {answer.status === 'loading' && <p className="text-sm text-dim">Working out the route...</p>}
          {answer.status === 'error' && <p className="text-sm text-red">Could not work out the route. Try again in a minute.</p>}
          {answer.status === 'none' && <p className="text-sm text-dim">No recorded nights in this zone.</p>}
          {a && (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-dim">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={showNights} onChange={e => setShowNights(e.target.checked)} /> each night</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={showBand} onChange={e => setShowBand(e.target.checked)} /> spread band</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={showClears} onChange={e => setShowClears(e.target.checked)} /> spawn points cleared</label>
                <span className="ml-auto">
                  <span style={{ color: GOLD }}>&#9632;</span> averaged route
                  {' · '}<span className="text-text">filled dot</span> cleared every night, <span className="text-text">ring</span> some nights
                </span>
              </div>
              {a.route.stops.length === 0
                ? <p className="rounded border border-border bg-panel p-3 text-sm text-dim">
                    None of the ticked nights killed a named boss, so there is no route to draw. Tick a night that did, or pick a zone with a named boss.
                  </p>
                : <>
                    {a.route.fallback && (
                      <p role="note" className="mb-2 rounded border border-orange/50 bg-orange/10 p-2 text-xs text-text">
                        The ticked nights ({a.route.fallback.of}) share no named kill, so there is nothing to average. This is the route of the most recent
                        one, {etDate.format(a.nights.find(n => n.key === a.route.fallback?.nightKey)?.from ?? 0)}. Tick a single night to read another.
                      </p>
                    )}
                    <RouteMap answer={a} map={map} showNights={showNights} showClears={showClears} showBand={showBand} />
                  </>}
              <p className="mt-1 text-xs text-dim">
                {map ? 'Walls: ' + (map.eqemu ? 'EQEmu maps (GPLv2+).' : "Brewall's EverQuest maps (via Zeal).") : 'No wall map cached for this zone; the route is drawn on its own.'}
              </p>

              <LegTable answer={a} />

              {officer && a.route.stops.length > 0 && (
                <div className="mt-4 rounded-lg border border-border bg-panel p-3">
                  <button type="button" onClick={save} disabled={saving || !checked || checked.size === 0}
                    className="rounded border border-accent bg-accent px-3 py-1.5 text-sm text-white hover:brightness-110 disabled:opacity-50">
                    {saving ? 'Saving...' : 'Make this our route'}
                  </button>
                  <p className="mt-2 text-xs text-dim">
                    Officers only. Saves this zone&apos;s averaged route, its stops, the leg times and the nights it came from, so Mimic can draw it later.
                    It replaces the route saved for this zone before.
                  </p>
                  {saveMsg && <p role="status" className="mt-2 text-xs text-text">{saveMsg}</p>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function NightRow({ n, color, on, onToggle, ready }: { n: NightOut; color: string; on: boolean; onToggle: () => void; ready: boolean }) {
  const noNamed = n.flags.includes('no-named');
  const cleared = n.flags.includes('precleared');
  const id = `night-${n.key}`;
  return (
    <li className={`rounded border p-2 text-xs ${on ? 'border-border' : 'border-border/50 opacity-70'}`}>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-2">
        <input id={id} type="checkbox" className="mt-0.5" checked={on && !noNamed} disabled={noNamed} onChange={onToggle} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm text-text">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
            {etDate.format(n.from)}
          </span>
          <span className="block text-dim">{sessionRange(n.from, n.to)} ET · {n.minutes} min in zone · {n.peak} raiders</span>
        </span>
      </label>
      {ready && (
        <dl className="mt-1.5 space-y-0.5 pl-6 text-dim">
          <div><dt className="inline">First engage </dt><dd className="inline text-text">{n.firstEngage != null ? etClock.format(n.firstEngage) : 'none recorded'}</dd></div>
          <div>
            <dt className="inline">Pre-clear </dt>
            <dd className="inline text-text">
              {n.preMinutes != null
                ? `${n.preTrash} trash killed, ${Math.round(n.preMinutes)} min in the zone before the first named`
                : 'no named kill'}
            </dd>
          </div>
          {n.engageToNamedS != null && <div><dt className="inline">First engage to first named dead </dt><dd className="inline text-text">{fmtSecs(n.engageToNamedS)}</dd></div>}
          <div><dt className="inline">Named killed </dt><dd className="inline text-text">{n.named.length}</dd><dt className="inline"> · trash </dt><dd className="inline text-text">{n.trashKills}</dd></div>
        </dl>
      )}
      {ready && (cleared || noNamed || n.flags.includes('short-track')) && (
        <p className="mt-1.5 flex flex-wrap gap-1 pl-6">
          {cleared && <span className="rounded border border-orange/50 bg-orange/10 px-1.5 py-0.5 text-orange" title="The first named died within a few minutes of the first engage: the zone was probably cleared earlier.">cleared earlier</span>}
          {noNamed && <span className="rounded border border-border px-1.5 py-0.5 text-dim">no named kill</span>}
          {n.flags.includes('short-track') && <span className="rounded border border-border px-1.5 py-0.5 text-dim">short track</span>}
        </p>
      )}
    </li>
  );
}

function LegTable({ answer }: { answer: ZoneAnswer }) {
  const { legs, stops } = answer.route;
  if (!legs.length) return null;
  return (
    <section aria-label="Legs" className="mt-4">
      <h2 className="text-sm text-gold">Legs, from first engage</h2>
      <div className="mt-2 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="bg-panel text-dim">
            <tr>
              <th scope="col" className="px-2 py-1.5 font-normal">Leg</th>
              <th scope="col" className="px-2 py-1.5 font-normal">Median</th>
              <th scope="col" className="px-2 py-1.5 font-normal">Best</th>
              <th scope="col" className="px-2 py-1.5 font-normal">Nights</th>
              <th scope="col" className="px-2 py-1.5 font-normal">Clock at the kill</th>
            </tr>
          </thead>
          <tbody>
            {legs.map(l => (
              <tr key={l.index} className="border-t border-border align-top">
                <td className="px-2 py-1.5 text-text">
                  <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: LEG_COLORS[l.index % LEG_COLORS.length] }} />
                  {legLabel(l.index)}: {l.from} &rarr; {l.to}
                </td>
                <td className="px-2 py-1.5 font-mono text-text">{fmtSecs(l.medianS)}</td>
                <td className="px-2 py-1.5 font-mono text-text">{fmtSecs(l.bestS)}</td>
                <td className="px-2 py-1.5 text-text">{l.nights}</td>
                <td className="px-2 py-1.5 font-mono text-dim">{fmtSecs(stops[l.index]?.medianClockS)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-4 text-sm text-gold">Clearing</h2>
      <p className="mt-1 text-xs text-dim">
        The trash killed between two named kills: how many, how long the clearing took (first trash pull to last trash death), and how much of the leg was
        everything else (the previous named fight, walking, the pull). Dots on the map are the spawn points those kills came from.
      </p>
      <ul className="mt-2 space-y-2 text-xs">
        {legs.map(l => (
          <li key={l.index} className="rounded border border-border bg-panel p-2">
            <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: LEG_COLORS[l.index % LEG_COLORS.length] }} />
            <b className="text-text">Leg {legLabel(l.index)}</b>
            {' '}<span className="text-dim">({l.from} to {l.to})</span>:{' '}
            <span className="text-text">{l.clear.medianKills ?? 0} kills, {fmtSecs(l.clear.medianClearS)} clearing</span>
            <span className="text-dim">, {fmtSecs(l.clear.medianOtherS)} other (median per night)</span>
            {l.clear.top.length > 0 && (
              <span className="text-dim"> &mdash; {l.clear.top.map(t => `${t.name} ×${t.perNight < 1 ? t.perNight.toFixed(1) : Math.round(t.perNight)}`).join(', ')}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
