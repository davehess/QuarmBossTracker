// One zone map as inline SVG for /pop/raid: the EQEmu wall layer underneath, then markers, the numbered
// dashed route and the solid patrol. Server component, no JS.
//
// Frame: the data is in the SERVER frame (the spawn table's x, y). The picture is north-up, so a point is
// drawn at (-x, -y), the site's convention (toScreen in web/lib/spectator.ts). Strokes are thin and
// non-scaling so they stay one pixel wide whatever the zone's size; text carries a dark halo.
import { toScreen } from '@/lib/spectator';
import type { MapMarker, Pt, RoutePt } from '@/lib/raidPlan';
import type { Walls } from './walls';

const MIN_SEG = 2;       // drop wall pieces shorter than this
const MAX_SEGS = 6000;   // keep the page small: the longest walls win

const WALL = '#6e7681';
const ROUTE = '#ffa657';
const ALT = '#58a6ff';
const PATROL = '#a371f7';
const KIND_COLOR = { boss: '#f85149', zonein: '#56d364', npc: '#d29922' } as const;
const INK = '#0d1117';
const TEXT = '#c9d1d9';

function wallPath(walls: Walls): string {
  const kept = walls.segs
    .map(s => ({ s, len: Math.hypot(s[2] - s[0], s[3] - s[1]) }))
    .filter(o => o.len >= MIN_SEG);
  if (kept.length > MAX_SEGS) kept.sort((a, b) => b.len - a.len);
  return kept.slice(0, MAX_SEGS)
    .map(({ s }) => {
      const a = toScreen(s[0], s[1]);
      const b = toScreen(s[2], s[3]);
      return `M${Math.round(a.sx)} ${Math.round(a.sy)}L${Math.round(b.sx)} ${Math.round(b.sy)}`;
    })
    .join('');
}

const niceStep = (span: number) => {
  const raw = span / 6;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow;
};

export default function ZoneSvg({ walls, markers, route, altRoutes = [], patrol, label }: {
  walls: Walls | null;
  markers: MapMarker[];
  route: RoutePt[];
  altRoutes?: RoutePt[][];
  patrol?: Pt[];
  label: string;
}) {
  const pts: Pt[] = [...markers, ...route, ...altRoutes.flat(), ...(patrol ?? [])];
  const scr = pts.map(p => toScreen(p.x, p.y));
  const xs = scr.map(p => p.sx);
  const ys = scr.map(p => p.sy);
  if (walls) {
    const b = walls.bounds;
    xs.push(-b.maxX, -b.minX);
    ys.push(-b.maxY, -b.minY);
  }
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 100);
  const pad = span * 0.06;
  const vx = minX - pad, vy = minY - pad, vw = maxX - minX + pad * 2, vh = maxY - minY + pad * 2;
  const big = Math.max(vw, vh);
  const fs = big * 0.028;
  const r = big * 0.009;
  const halo = fs * 0.28;

  const d = walls ? wallPath(walls) : '';
  const step = niceStep(big);
  const gridX: number[] = [];
  const gridY: number[] = [];
  if (!d) {
    for (let g = Math.ceil(vx / step) * step; g <= vx + vw; g += step) gridX.push(g);
    for (let g = Math.ceil(vy / step) * step; g <= vy + vh; g += step) gridY.push(g);
  }

  const line = (p: Pt[]) => p.map(q => { const s = toScreen(q.x, q.y); return `${s.sx},${s.sy}`; }).join(' ');
  const text = { fontSize: fs, fill: TEXT, stroke: INK, strokeWidth: halo, paintOrder: 'stroke' as const, strokeLinejoin: 'round' as const };

  const numbered = (rt: RoutePt[], color: string, keyPrefix: string) => (
    <g key={keyPrefix}>
      <polyline points={line(rt)} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
      {rt.map((p, i) => {
        const s = toScreen(p.x, p.y);
        const bx = s.sx - r * 2, by = s.sy - r * 2;
        return (
          <g key={`${keyPrefix}${i}`}>
            <circle cx={bx} cy={by} r={r * 1.25} fill={INK} stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <text x={bx} y={by} textAnchor="middle" dominantBaseline="central" fontSize={fs * 0.8} fill={color} fontFamily="ui-monospace, monospace">{i + 1}</text>
          </g>
        );
      })}
    </g>
  );

  return (
    <svg
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height={360}
      role="img"
      aria-label={label}
      className="rounded border border-border bg-black/30"
    >
      {gridX.map(g => <line key={`gx${g}`} x1={g} y1={vy} x2={g} y2={vy + vh} stroke={WALL} strokeOpacity={0.25} strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
      {gridY.map(g => <line key={`gy${g}`} x1={vx} y1={g} x2={vx + vw} y2={g} stroke={WALL} strokeOpacity={0.25} strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
      {d && <path d={d} fill="none" stroke={WALL} strokeOpacity={0.85} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      {patrol && patrol.length > 1 && (
        <polyline points={line(patrol)} fill="none" stroke={PATROL} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      )}
      {numbered(route, ROUTE, 'r')}
      {altRoutes.map((rt, i) => numbered(rt, ALT, `a${i}`))}
      {markers.map(m => {
        const s = toScreen(m.x, m.y);
        const c = KIND_COLOR[m.kind];
        const right = s.sx > vx + vw * 0.72;
        const lx = right ? s.sx - r * 1.9 : s.sx + r * 1.9;
        const shape = m.kind === 'boss'
          ? <circle cx={s.sx} cy={s.sy} r={r} fill={c} stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          : m.kind === 'zonein'
            ? <polygon points={`${s.sx},${s.sy - r * 1.3} ${s.sx + r * 1.3},${s.sy} ${s.sx},${s.sy + r * 1.3} ${s.sx - r * 1.3},${s.sy}`} fill={c} stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            : <polygon points={`${s.sx},${s.sy - r * 1.3} ${s.sx + r * 1.2},${s.sy + r} ${s.sx - r * 1.2},${s.sy + r}`} fill={c} stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />;
        return (
          <g key={`${m.label}${m.x},${m.y}`}>
            {shape}
            <text x={lx} y={s.sy} textAnchor={right ? 'end' : 'start'} dominantBaseline="central" {...text}>{m.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
