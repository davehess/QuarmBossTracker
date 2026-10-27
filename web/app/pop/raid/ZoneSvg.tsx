// One zone map as inline SVG for /pop/raid: Brewall's map underneath, then the patrol, the numbered route and the
// lettered markers. Server component, no JS.
//
// Frame: the data is in the SERVER frame (the spawn table's x, y; Brewall's files are converted into it by
// lib/zoneMap/brewall.ts). The picture is north-up, so a point is drawn at (-x, -y), the site's convention (toScreen in
// web/lib/spectator.ts). One conversion for the art, the markers and the routes is what keeps them lined up; the
// frame and the wall path are lib/popRaidMap.ts.
//
// Names are NOT drawn on the map: a marker is a coloured shape with a letter in it, and the legend under the map (page.tsx)
// says which letter is which. Names set beside their shapes piled on each other wherever a plan packs several points
// into one corner of a zone (the Lair's door, statues and boss).
//
// Walls: Brewall's lines in one muted colour, every line of every layer file the loader merges. The EQEmu slice is
// drawn only for a zone Brewall has no map for: its pieces read as broken white fragments next to the art.
import { toScreen } from '@/lib/spectator';
import type { MapMarker, Pt, RoutePt } from '@/lib/raidPlan';
import { brewallPath, markerLetter, planFrame, spreadGlyphs, type DrawnRoute } from '@/lib/popRaidMap';
import type { Walls } from './walls';

const MIN_SEG = 2;       // EQEmu fallback only: drop wall pieces shorter than this
const MAX_SEGS = 6000;   // EQEmu fallback only: keep the page small, the longest walls win

const WALL = '#6e7681';
const ROUTE = '#ffa657';
const ALT = '#58a6ff';
const PATROL = '#a371f7';
const KIND_COLOR = { boss: '#f85149', zonein: '#56d364', npc: '#d29922' } as const;
const INK = '#0d1117';

function eqemuPath(walls: Walls): string {
  const kept = (walls.segs ?? [])
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
  route: DrawnRoute;
  altRoutes?: RoutePt[][];
  patrol?: Pt[];
  label: string;
}) {
  const brewall = walls?.brewall ?? null;
  const pts: Pt[] = [...markers, ...route.legs.flat(), ...route.stops, ...altRoutes.flat(), ...(patrol ?? [])];
  const f = planFrame(pts, brewall ? brewall.bounds : walls?.bounds ?? null);
  const { vx, vy, vw, vh } = f;
  const big = Math.max(vw, vh);
  const gr = big * 0.02;          // a marker's half-size
  const br = gr * 0.8;            // a route number's radius
  const glyphs = spreadGlyphs(markers, gr);

  const d = brewall ? brewallPath(brewall.lines, f) : walls ? eqemuPath(walls) : '';
  const step = niceStep(big);
  const gridX: number[] = [];
  const gridY: number[] = [];
  if (!d) {
    for (let g = Math.ceil(vx / step) * step; g <= vx + vw; g += step) gridX.push(g);
    for (let g = Math.ceil(vy / step) * step; g <= vy + vh; g += step) gridY.push(g);
  }

  const line = (p: Pt[]) => p.map(q => { const s = toScreen(q.x, q.y); return `${s.sx},${s.sy}`; }).join(' ');

  // A route number sits up and left of its point, clear of the marker drawn on the same spot.
  const badges = (rt: Pt[], color: string, keyPrefix: string) => rt.map((p, i) => {
    const s = toScreen(p.x, p.y);
    const bx = s.sx - (gr + br) * 0.85, by = s.sy - (gr + br) * 0.85;
    return (
      <g key={`${keyPrefix}${i}`}>
        <circle cx={bx} cy={by} r={br} fill={INK} stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <text x={bx} y={by} textAnchor="middle" dominantBaseline="central" fontSize={br * 1.25} fill={color} fontFamily="ui-monospace, monospace">{i + 1}</text>
      </g>
    );
  });

  const walked = route.kind !== 'planned';

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
      {d && <path d={d} fill="none" stroke={WALL} strokeOpacity={brewall ? 0.7 : 0.85} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      {patrol && patrol.length > 1 && (
        <polyline points={line(patrol)} fill="none" stroke={PATROL} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      )}
      {route.legs.map((leg, i) => (
        <polyline
          key={`l${i}`} points={line(leg)} fill="none" stroke={ROUTE} strokeWidth={walked ? 2 : 1.5}
          strokeDasharray={walked ? undefined : '6 4'} strokeLinejoin="round" vectorEffect="non-scaling-stroke"
        />
      ))}
      {badges(route.stops, ROUTE, 'r')}
      {altRoutes.map((rt, i) => (
        <g key={`a${i}`}>
          <polyline points={line(rt)} fill="none" stroke={ALT} strokeWidth={1.5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
          {badges(rt, ALT, `a${i}`)}
        </g>
      ))}
      {markers.map((m, i) => {
        const s = { sx: glyphs[i].sx, sy: glyphs[i].sy };
        const away = Math.hypot(s.sx - glyphs[i].ox, s.sy - glyphs[i].oy) > gr * 0.3;
        const c = KIND_COLOR[m.kind];
        const shape = m.kind === 'boss'
          ? <circle cx={s.sx} cy={s.sy} r={gr} fill={c} stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          : m.kind === 'zonein'
            ? <polygon points={`${s.sx},${s.sy - gr * 1.3} ${s.sx + gr * 1.3},${s.sy} ${s.sx},${s.sy + gr * 1.3} ${s.sx - gr * 1.3},${s.sy}`} fill={c} stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            : <polygon points={`${s.sx},${s.sy - gr * 1.3} ${s.sx + gr * 1.25},${s.sy + gr} ${s.sx - gr * 1.25},${s.sy + gr}`} fill={c} stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />;
        return (
          <g key={`${m.label}${m.x},${m.y}`}>
            {away && <line x1={glyphs[i].ox} y1={glyphs[i].oy} x2={s.sx} y2={s.sy} stroke={c} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
            {away && <circle cx={glyphs[i].ox} cy={glyphs[i].oy} r={gr * 0.2} fill={c} />}
            {shape}
            <text
              x={s.sx} y={s.sy + (m.kind === 'npc' ? gr * 0.3 : 0)} textAnchor="middle" dominantBaseline="central"
              fontSize={gr * 1.15} fontWeight={700} fill={INK} fontFamily="ui-monospace, monospace"
            >{markerLetter(i)}</text>
          </g>
        );
      })}
    </svg>
  );
}
