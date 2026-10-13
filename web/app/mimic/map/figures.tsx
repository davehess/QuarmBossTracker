// Drawings for the Map training page (/mimic/map). Every colour below is the Map's own default scheme, so a
// figure looks like the overlay does and a raider can match what they see to what they read. Inline SVG and
// CSS only: no screenshots, no images from elsewhere. Server components, no JS.
//
// The names in these drawings (Old Graymaw, a pale wolf, Aldenmar, Brackwyn, Corvale) are invented.
import type { ReactNode } from 'react';

// The Map's default colours. Meaning, not decoration: see the legend on the cheat sheet.
export const C = {
  ground: '#131a26',
  wall: '#c8d6ea',
  route: '#39c5cf',
  routeTarget: '#7ee787',
  dot: '#c9d1d9',
  named: '#f2cc60',
  raidTarget: '#ff7b72',
  up: '#56d364',
  ringWait: '#f85149',
  ringWindow: '#f0b429',
  flash: '#ffd866',
  candidate: '#d2a8ff',
  aggro: '#e5534b',
  aggroSafe: '#e3b341',
  aggroNone: '#56d364',
  pather: '#9ecbff',
  you: '#58a6ff',
  target: '#f0883e',
  tot: '#f778ba',
  group: '#56d364',
  raid: '#a371f7',
  trailPath: '#ffd23f',
  trailAway: '#ff3b30',
  trailBack: '#ff7a33',
  text: '#c9d1d9',
  dim: '#8b949e',
} as const;

const MONO = 'ui-monospace, Consolas, monospace';

// The frame every picture sits in: the Map's dark ground, a hairline, scales to its column.
export function Plate({ label, h = 180, children }: { label: string; h?: number; children: ReactNode }) {
  return (
    <svg
      viewBox={`0 0 320 ${h}`}
      role="img"
      aria-label={label}
      className="block h-auto w-full rounded-md border border-border"
      style={{ background: C.ground }}
      fontFamily={MONO}
    >
      <title>{label}</title>
      {children}
    </svg>
  );
}

// A few walls, so the dots have a room to stand in.
function Walls({ dx = 0, dy = 0 }: { dx?: number; dy?: number }) {
  return (
    <g fill="none" stroke={C.wall} strokeWidth="1.4" strokeOpacity="0.5" transform={`translate(${dx} ${dy})`}>
      <polyline points="14,22 14,150 120,150 120,120 200,120 200,150 306,150 306,22 220,22 220,60 130,60 130,22 14,22" />
      <polyline points="60,60 60,100 100,100" />
    </g>
  );
}

// Text with a dark halo, the way the Map draws names over walls.
function Tx({ x, y, children, fill = C.text, size = 9, anchor = 'start', bold = false }: {
  x: number; y: number; children: ReactNode; fill?: string; size?: number; anchor?: 'start' | 'middle' | 'end'; bold?: boolean;
}) {
  return (
    <text x={x} y={y} fontSize={size} fill={fill} textAnchor={anchor} fontWeight={bold ? 700 : 400}
      stroke="rgba(0,0,0,0.85)" strokeWidth="2.6" paintOrder="stroke">
      {children}
    </text>
  );
}

// You: an arrow that points the way you face. North is up.
function YouArrow({ x, y, turn = 0 }: { x: number; y: number; turn?: number }) {
  return (
    <polygon points="0,-9 5.5,6 0,3 -5.5,6" fill={C.you} stroke="#fff" strokeWidth="1.2" transform={`translate(${x} ${y}) rotate(${turn})`} />
  );
}

function SpawnDot({ x, y, kind = 'plain' }: { x: number; y: number; kind?: 'plain' | 'named' | 'raid' | 'up' }) {
  const r = kind === 'raid' ? 6.5 : kind === 'named' ? 5.5 : 4.2;
  const fill = kind === 'up' ? C.up : kind === 'raid' ? C.raidTarget : kind === 'named' ? C.named : C.dot;
  return (
    <g>
      {kind === 'up' && <circle cx={x} cy={y} r={r + 3.5} fill="none" stroke={C.up} strokeWidth="2.4" />}
      <circle cx={x} cy={y} r={r} fill={fill} stroke="#0d1117" strokeWidth="1.2" />
    </g>
  );
}

function Diamond({ x, y, r = 2.6, fill }: { x: number; y: number; r?: number; fill: string }) {
  return <polygon points={`${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`} fill={fill} />;
}

function Arrowhead({ x, y, ang, size = 6, fill }: { x: number; y: number; ang: number; size?: number; fill: string }) {
  return <polygon points={`0,0 ${-size},${-size * 0.6} ${-size},${size * 0.6}`} fill={fill} transform={`translate(${x} ${y}) rotate(${ang})`} />;
}

// ── Lesson 1: open it ──────────────────────────────────────────────────────────────────────────
export function FigOpen() {
  return (
    <Plate label="The Map window before it has anything to draw: a message in the middle says it is waiting for Zeal, and the timers list on the right is empty.">
      <rect x="6" y="6" width="230" height="168" rx="6" fill="#131a26" stroke="#30363d" />
      <rect x="242" y="6" width="72" height="168" rx="6" fill="#0e1520" stroke="#30363d" />
      <text x="160" y="86" fontSize="10" fill="rgba(255,255,255,0.7)" textAnchor="middle">waiting for Zeal…</text>
      <text x="160" y="101" fontSize="9" fill="rgba(255,255,255,0.5)" textAnchor="middle">(log in and zone)</text>
      <text x="278" y="22" fontSize="9" fill="#79c0ff" textAnchor="middle">Map [beta]</text>
      <text x="278" y="40" fontSize="8" fill="#6e7681" textAnchor="middle">RESPAWNS (0)</text>
      <text x="278" y="60" fontSize="7.5" fill="rgba(255,255,255,0.45)" textAnchor="middle">no timers yet</text>
      <rect x="30" y="14" width="46" height="14" rx="3" fill="rgba(14,17,22,0.7)" stroke="rgba(110,118,129,0.6)" />
      <text x="53" y="24" fontSize="8" fill={C.text} textAnchor="middle">Follow me</text>
      <rect x="196" y="12" width="38" height="14" rx="3" fill="rgba(14,17,22,0.7)" stroke="rgba(110,118,129,0.6)" />
      <text x="215" y="22" fontSize="8" fill={C.text} textAnchor="middle">Timers ▸</text>
    </Plate>
  );
}

// ── Lesson 2: find yourself ────────────────────────────────────────────────────────────────────
export function FigYou() {
  return (
    <Plate label="A zone from above, north at the top. You are a blue arrow pointing the way you face, your group are green dots and your raid are purple dots.">
      <Walls />
      <Tx x={20} y={36} fill={C.dim} size={8}>N ↑  north is up</Tx>
      <Tx x={20} y={170} fill="#e6edf3" size={9}>-412, 806, 30 · 24 u/s</Tx>
      {[[196, 86], [214, 100], [180, 104]].map(([x, y]) => <circle key={`g${x}`} cx={x} cy={y} r="4" fill={C.group} stroke="#0d1117" />)}
      {[[250, 126], [262, 134], [272, 122], [284, 132]].map(([x, y]) => <circle key={`r${x}`} cx={x} cy={y} r="3" fill={C.raid} stroke="#0d1117" />)}
      <YouArrow x={160} y={92} turn={35} />
      <Tx x={146} y={112} fill={C.you} size={9} anchor="end">you</Tx>
      <Tx x={220} y={82} fill={C.group} size={9}>your group</Tx>
      <Tx x={254} y={150} fill={C.raid} size={9}>your raid</Tx>
    </Plate>
  );
}

// ── Lesson 3: read a spawn point ───────────────────────────────────────────────────────────────
export function FigSpawn() {
  return (
    <Plate label="Three spawn points: a plain grey dot, a bigger gold dot for a named mob, and the biggest red dot for a raid target. Hovering one opens a card listing what can spawn there, its level and chance, and its respawn time.">
      <Walls />
      <SpawnDot x={50} y={88} />
      <SpawnDot x={82} y={132} kind="named" />
      <SpawnDot x={58} y={40} kind="raid" />
      <Tx x={64} y={92} fill={C.pather} size={9}>↻</Tx>
      <Tx x={92} y={136} fill={C.named} size={9} bold>Old Graymaw</Tx>
      <Tx x={70} y={36} fill="#ffa198" size={9} bold>Lord of the Pit</Tx>
      <Tx x={36} y={106} fill={C.dim} size={8}>grey: ordinary</Tx>
      {/* the hover card */}
      <g>
        <rect x="150" y="66" width="156" height="92" rx="5" fill="rgba(14,17,22,0.96)" stroke="rgba(110,118,129,0.7)" />
        <text x="158" y="80" fontSize="10" fontWeight="700" fill="#e6edf3">Old Graymaw</text>
        <text x="158" y="92" fontSize="8" fill="#8b949e">respawn 6h00m</text>
        <text x="158" y="103" fontSize="8" fill="#8b949e">↻ walks a route</text>
        <text x="158" y="116" fontSize="8.5" fontWeight="700" fill={C.named}>Old Graymaw L58</text>
        <text x="298" y="116" fontSize="8" fill="#8b949e" textAnchor="end">10%</text>
        <text x="158" y="128" fontSize="8.5" fill={C.text}>a pale wolf L55 👁</text>
        <text x="298" y="128" fontSize="8" fill="#8b949e" textAnchor="end">90%</text>
        <text x="158" y="146" fontSize="8.5" fill="#f0b429">up in 4m–6m · seen</text>
      </g>
    </Plate>
  );
}

// ── Lesson 4: aggro rings ──────────────────────────────────────────────────────────────────────
export function FigAggro() {
  const ring = (x: number, y: number, r: number, col: string, dashedR?: number) => (
    <g>
      <circle cx={x} cy={y} r={r} fill={col} fillOpacity="0.07" stroke={col} strokeOpacity="0.6" />
      {dashedR && <circle cx={x} cy={y} r={dashedR} fill="none" stroke={col} strokeOpacity="0.5" strokeDasharray="5 4" />}
      <circle cx={x} cy={y} r="4.2" fill={C.dot} stroke="#0d1117" strokeWidth="1.2" />
    </g>
  );
  return (
    <Plate label="Three spawn points with rings around them. A red ring means the mob attacks you on sight, yellow means it attacks some players but not you, green means it attacks nobody. A dashed outer ring shows how far it comes to help a friend.">
      {ring(62, 76, 34, C.aggro, 54)}
      {ring(160, 76, 26, C.aggroSafe)}
      {ring(256, 76, 30, C.aggroNone, 46)}
      <YouArrow x={96} y={118} turn={-60} />
      <Tx x={62} y={142} fill={C.aggro} size={9} anchor="middle">red: KOS to you</Tx>
      <Tx x={160} y={142} fill={C.aggroSafe} size={9} anchor="middle">yellow: not you</Tx>
      <Tx x={256} y={142} fill={C.aggroNone} size={9} anchor="middle">green: nobody</Tx>
      <Tx x={160} y={166} fill={C.dim} size={8.5} anchor="middle">dashed ring = comes to help a friend</Tx>
    </Plate>
  );
}

// ── Lesson 5: a roamer's path ──────────────────────────────────────────────────────────────────
export function FigPath() {
  return (
    <Plate h={190} label="A targeted mob's walked path. The line is yellow while it follows its route, turns red with a glowing spot where it stepped off the route, and orange while it walks back. An arrowhead shows its direction and a dashed line runs on ahead of it. A note under it says how far it is from its spawn point.">
      {/* the route */}
      <g fill="none" stroke={C.routeTarget} strokeWidth="1.8" strokeDasharray="7 3" opacity="0.9">
        <polyline points="30,150 110,150 110,90 210,90" />
      </g>
      <SpawnDot x={30} y={150} />
      <Tx x={38} y={166} fill={C.pather} size={9}>spawn point ↻</Tx>
      {/* trail, with the dark casing the Map draws under it */}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="30,150 110,150 110,118" stroke="rgba(0,0,0,0.55)" strokeWidth="4.5" />
        <polyline points="110,118 130,100 168,70" stroke="rgba(0,0,0,0.55)" strokeWidth="4.5" />
        <polyline points="168,70 190,60 214,54" stroke="rgba(0,0,0,0.55)" strokeWidth="4.5" />
        <polyline points="30,150 110,150 110,118" stroke={C.trailPath} strokeWidth="2.4" />
        <polyline points="110,118 130,100 168,70" stroke={C.trailAway} strokeWidth="2.4" />
        <polyline points="168,70 190,60 214,54" stroke={C.trailBack} strokeWidth="2.4" />
      </g>
      <defs>
        <radialGradient id="leaveGlow">
          <stop offset="0" stopColor="#ff3b30" stopOpacity="0.95" />
          <stop offset="0.45" stopColor="#ff3b30" stopOpacity="0.45" />
          <stop offset="1" stopColor="#ff3b30" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="110" cy="118" r="11" fill="url(#leaveGlow)" />
      <circle cx="110" cy="118" r="3" fill={C.trailAway} />
      {/* where it is now, the arrow, and the dashed line on ahead */}
      <circle cx="214" cy="54" r="6" fill="none" stroke={C.target} strokeWidth="2" />
      <circle cx="214" cy="54" r="2" fill={C.target} />
      <Arrowhead x={236} y={50} ang={-10} size={8} fill={C.trailBack} />
      <line x1="244" y1="49" x2="304" y2="38" stroke={C.trailBack} strokeWidth="1.8" strokeDasharray="6 6" opacity="0.8" />
      <Tx x={122} y={112} fill={C.trailAway} size={9}>stepped off its route</Tx>
      <Tx x={176} y={92} fill={C.trailBack} size={9}>walking back</Tx>
      <Tx x={36} y={140} fill={C.trailPath} size={9}>on its route</Tx>
      <Tx x={222} y={72} fill={C.target} size={8.5}>84 from spawn</Tx>
    </Plate>
  );
}

// ── Lesson 5b / 8: legs the Map has learned ────────────────────────────────────────────────────
export function FigLegs() {
  const pts: [number, number][] = [[40, 120], [110, 50], [200, 130], [280, 60], [150, 160]];
  const legs: { a: number; b: number; n: number; arrows: 'ab' | 'ba' | 'both' }[] = [
    { a: 0, b: 1, n: 4, arrows: 'both' }, { a: 1, b: 2, n: 3, arrows: 'ab' }, { a: 2, b: 3, n: 1, arrows: 'ab' }, { a: 2, b: 4, n: 2, arrows: 'ba' },
  ];
  const at = (a: [number, number], b: [number, number]) => ({ x: a[0] + (b[0] - a[0]) * 0.6, y: a[1] + (b[1] - a[1]) * 0.6, ang: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI });
  return (
    <Plate h={190} label="A roamer's waypoints drawn as diamonds, with the walks between them that the Map has seen. Walks seen more than once are solid and thicker; a walk seen once is faint and dashed. Arrows show which way it went.">
      {legs.map((l, i) => {
        const A = pts[l.a], B = pts[l.b];
        return (
          <g key={i}>
            <line x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} stroke={C.route} strokeWidth={(l.n >= 2 ? 1 : 1) + Math.min(l.n, 5) * 0.3}
              strokeOpacity={l.n >= 2 ? 0.9 : 0.55} strokeDasharray={l.n >= 2 ? undefined : '3 4'} />
            {(l.arrows === 'ab' || l.arrows === 'both') && (() => { const p = at(A, B); return <Arrowhead x={p.x} y={p.y} ang={p.ang} size={6} fill={C.route} />; })()}
            {(l.arrows === 'ba' || l.arrows === 'both') && (() => { const p = at(B, A); return <Arrowhead x={p.x} y={p.y} ang={p.ang} size={6} fill={C.route} />; })()}
          </g>
        );
      })}
      {pts.map(([x, y], i) => <Diamond key={i} x={x} y={y} r={3.2} fill={C.route} />)}
      <Tx x={14} y={20} fill={C.route} size={9}>solid + thick: seen walked again and again</Tx>
      <Tx x={14} y={34} fill={C.route} size={9}>faint + dashed: seen once</Tx>
      <Tx x={236} y={92} fill={C.dim} size={8.5}>seen once</Tx>
    </Plate>
  );
}

// ── Lesson 6: respawn timers ───────────────────────────────────────────────────────────────────
export function FigTimers() {
  const row = (y: number, col: string, name: string, time: string, src: string, bold = false) => (
    <g>
      <rect x="196" y={y} width="118" height="28" rx="3" fill="rgba(255,255,255,0.05)" />
      <rect x="196" y={y} width="3" height="28" fill={col} />
      <text x="204" y={y + 11} fontSize="8.5" fill="#e6edf3">{name}</text>
      <text x="310" y={y + 11} fontSize="8.5" fill={col} textAnchor="end" fontWeight={bold ? 700 : 400}>{time}</text>
      <text x="204" y={y + 22} fontSize="7.5" fill="#6e7681">{src}</text>
    </g>
  );
  const dot = (x: number, y: number, ring: string, label: string) => (
    <g>
      <circle cx={x} cy={y} r="7.7" fill="none" stroke={ring} strokeWidth="2.4" />
      <circle cx={x} cy={y} r="4.2" fill={C.dot} stroke="#0d1117" strokeWidth="1.2" />
      <Tx x={x} y={y + 22} fill={ring} size={8.5} anchor="middle">{label}</Tx>
    </g>
  );
  return (
    <Plate h={190} label="Spawn points with coloured rings, and the timers list beside them. A red ring means not yet, yellow means it could be up any moment, green means it should be up. The list shows the same, with a range of time rather than a single time.">
      {dot(30, 40, C.ringWait, 'not yet')}
      {dot(96, 40, C.ringWindow, 'any moment')}
      {dot(162, 40, C.up, 'up')}
      <g>
        <circle cx="30" cy="110" r="7.7" fill="none" stroke={C.flash} strokeWidth="2.4" />
        <circle cx="30" cy="110" r="4.2" fill={C.dot} stroke="#0d1117" strokeWidth="1.2" />
        <Tx x={30} y={132} fill={C.flash} size={8.5} anchor="middle">flashing</Tx>
      </g>
      <g>
        <circle cx="96" cy="110" r="7.7" fill="none" stroke={C.candidate} strokeWidth="1.8" strokeDasharray="3 2" />
        <circle cx="96" cy="110" r="4.2" fill={C.dot} stroke="#0d1117" strokeWidth="1.2" />
        <Tx x={96} y={97} fill={C.candidate} size={11} anchor="middle" bold>?</Tx>
        <Tx x={96} y={132} fill={C.candidate} size={8.5} anchor="middle">not sure which</Tx>
      </g>
      <g>
        <circle cx="162" cy="110" r="7.7" fill="none" stroke={C.up} strokeWidth="2.4" />
        <circle cx="162" cy="110" r="4.2" fill={C.up} stroke="#0d1117" strokeWidth="1.2" />
        <Tx x={162} y={132} fill={C.up} size={8.5} anchor="middle">seen alive</Tx>
      </g>
      <text x="196" y="18" fontSize="8" fill="#6e7681">RESPAWNS (3)</text>
      {row(24, C.ringWait, 'a sand giant', 'up in 4m–6m', 'seen · by Aldenmar')}
      {row(56, C.ringWindow, 'a cave bear', 'up now–2m', 'marked')}
      {row(88, C.up, 'Old Graymaw', 'UP', 'seen · by Brackwyn', true)}
      <text x="196" y="132" fontSize="8" fill="#6e7681">UP · SEEN (1)</text>
      <rect x="196" y="138" width="118" height="28" rx="3" fill="rgba(86,211,100,0.12)" />
      <rect x="196" y="138" width="3" height="28" fill={C.up} />
      <text x="204" y="149" fontSize="8.5" fill="#e6edf3">a pale wolf</text>
      <text x="310" y="149" fontSize="8.5" fill={C.up} textAnchor="end">3m ago</text>
      <text x="204" y="160" fontSize="7.5" fill="#6e7681">spawn #812 · by Corvale</text>
    </Plate>
  );
}

// ── Lesson 8: the three shelves ────────────────────────────────────────────────────────────────
export function FigShelves() {
  const shelf = (x: number, col: string, head: string, lines: string[]) => (
    <g>
      <rect x={x} y="8" width="98" height="164" rx="5" fill="#0e1520" stroke={col} strokeOpacity="0.7" />
      <rect x={x} y="8" width="98" height="20" rx="5" fill={col} fillOpacity="0.18" />
      <text x={x + 49} y="22" fontSize="9" fontWeight="700" fill={col} textAnchor="middle">{head}</text>
      {lines.map((t, i) => <text key={i} x={x + 8} y={46 + i * 17} fontSize="8.5" fill={C.text}>{t}</text>)}
    </g>
  );
  return (
    <Plate label="Three shelves: what the Map keeps on your computer, what it shares with your raid, and what it forgets when you zone or restart.">
      {shelf(8, C.up, 'KEPT HERE', ['roamer paths', 'respawn timers', 'zone spawn data', 'toolbar spot', 'colours, settings', 'pet buff clock'])}
      {shelf(111, C.ringWindow, 'SHARED', ['deaths it is sure of', 'your clicks on dots', 'with your raid / group', 'never your position', 'pet buffs: backup', 'to your guild server'])}
      {shelf(214, C.ringWait, 'FORGOTTEN', ['walked-path trails', 'dead mobs’ faint paths', 'live-mob pins', 'Follow target', 'when you zone', 'or restart Mimic'])}
    </Plate>
  );
}

// ── Small swatches for the cheat sheet legend ──────────────────────────────────────────────────
export function Sw({ children, w = 34 }: { children: ReactNode; w?: number }) {
  return (
    <svg viewBox={`0 0 ${w} 20`} width={w} height="20" aria-hidden="true" className="shrink-0 rounded border border-border" style={{ background: C.ground }}>
      {children}
    </svg>
  );
}

export const swatch = {
  you: <Sw><polygon points="0,-8 5,5 0,2.5 -5,5" fill={C.you} stroke="#fff" strokeWidth="1" transform="translate(17 11)" /></Sw>,
  group: <Sw><circle cx="17" cy="10" r="4" fill={C.group} stroke="#0d1117" /></Sw>,
  raid: <Sw><circle cx="17" cy="10" r="3" fill={C.raid} stroke="#0d1117" /></Sw>,
  target: <Sw><circle cx="17" cy="10" r="6" fill="none" stroke={C.target} strokeWidth="2" /><circle cx="17" cy="10" r="2" fill={C.target} /></Sw>,
  targetLine: <Sw><line x1="3" y1="10" x2="31" y2="10" stroke={C.target} strokeWidth="1.5" strokeDasharray="2 4" /></Sw>,
  tot: <Sw><line x1="3" y1="10" x2="24" y2="10" stroke={C.tot} strokeWidth="1.6" strokeDasharray="5 3" /><Arrowhead x={31} y={10} ang={0} size={6} fill={C.tot} /></Sw>,
  pin: <Sw><line x1="3" y1="10" x2="31" y2="10" stroke={C.routeTarget} strokeWidth="1" /></Sw>,
  dot: <Sw><circle cx="17" cy="10" r="4.2" fill={C.dot} stroke="#0d1117" /></Sw>,
  named: <Sw><circle cx="17" cy="10" r="5.5" fill={C.named} stroke="#0d1117" /></Sw>,
  raidTarget: <Sw><circle cx="17" cy="10" r="6.5" fill={C.raidTarget} stroke="#0d1117" /></Sw>,
  seen: <Sw><circle cx="17" cy="10" r="7.7" fill="none" stroke={C.up} strokeWidth="2.4" /><circle cx="17" cy="10" r="4.2" fill={C.up} stroke="#0d1117" /></Sw>,
  ringWait: <Sw><circle cx="17" cy="10" r="7.7" fill="none" stroke={C.ringWait} strokeWidth="2.4" /><circle cx="17" cy="10" r="3.4" fill={C.dot} /></Sw>,
  ringWindow: <Sw><circle cx="17" cy="10" r="7.7" fill="none" stroke={C.ringWindow} strokeWidth="2.4" /><circle cx="17" cy="10" r="3.4" fill={C.dot} /></Sw>,
  ringUp: <Sw><circle cx="17" cy="10" r="7.7" fill="none" stroke={C.up} strokeWidth="2.4" /><circle cx="17" cy="10" r="3.4" fill={C.dot} /></Sw>,
  ringFlash: <Sw><circle cx="17" cy="10" r="7.7" fill="none" stroke={C.flash} strokeWidth="2.4" /><circle cx="17" cy="10" r="3.4" fill={C.dot} /></Sw>,
  candidate: <Sw><circle cx="17" cy="11" r="7" fill="none" stroke={C.candidate} strokeWidth="1.8" strokeDasharray="3 2" /><circle cx="17" cy="11" r="3.4" fill={C.dot} /></Sw>,
  aggro: <Sw><circle cx="17" cy="10" r="8" fill={C.aggro} fillOpacity="0.12" stroke={C.aggro} strokeOpacity="0.8" /></Sw>,
  aggroSafe: <Sw><circle cx="17" cy="10" r="8" fill={C.aggroSafe} fillOpacity="0.12" stroke={C.aggroSafe} strokeOpacity="0.8" /></Sw>,
  aggroNone: <Sw><circle cx="17" cy="10" r="8" fill={C.aggroNone} fillOpacity="0.12" stroke={C.aggroNone} strokeOpacity="0.8" /></Sw>,
  assist: <Sw><circle cx="17" cy="10" r="9" fill="none" stroke={C.dim} strokeDasharray="4 3" /><circle cx="17" cy="10" r="4" fill="none" stroke={C.dim} /></Sw>,
  route: <Sw><line x1="3" y1="10" x2="31" y2="10" stroke={C.route} strokeWidth="1.4" strokeDasharray="4 4" /></Sw>,
  routeTarget: <Sw><line x1="3" y1="10" x2="31" y2="10" stroke={C.routeTarget} strokeWidth="2" strokeDasharray="7 3" /></Sw>,
  wander: <Sw><Diamond x={7} y={10} fill={C.route} /><Diamond x={17} y={5} fill={C.route} /><Diamond x={27} y={13} fill={C.route} /></Sw>,
  legSolid: <Sw><line x1="3" y1="10" x2="31" y2="10" stroke={C.route} strokeWidth="2.3" strokeOpacity="0.9" /></Sw>,
  legFaint: <Sw><line x1="3" y1="10" x2="31" y2="10" stroke={C.route} strokeWidth="1.3" strokeOpacity="0.55" strokeDasharray="3 4" /></Sw>,
  trailPath: <Sw><line x1="3" y1="10" x2="31" y2="10" stroke={C.trailPath} strokeWidth="2.6" strokeLinecap="round" /></Sw>,
  trailAway: <Sw><line x1="3" y1="10" x2="31" y2="10" stroke={C.trailAway} strokeWidth="2.6" strokeLinecap="round" /></Sw>,
  trailBack: <Sw><line x1="3" y1="10" x2="31" y2="10" stroke={C.trailBack} strokeWidth="2.6" strokeLinecap="round" /></Sw>,
  glow: <Sw><circle cx="17" cy="10" r="9" fill={C.trailAway} fillOpacity="0.3" /><circle cx="17" cy="10" r="3" fill={C.trailAway} /></Sw>,
  heading: <Sw><line x1="3" y1="10" x2="31" y2="10" stroke={C.trailBack} strokeWidth="1.8" strokeDasharray="6 6" /></Sw>,
  arrow: <Sw><Arrowhead x={24} y={10} ang={0} size={9} fill={C.trailPath} /></Sw>,
  walker: <Sw><text x="17" y="14" fontSize="12" fill={C.pather} textAnchor="middle">↻</text></Sw>,
};

// ── A toolbar button, drawn the way the Map draws it ───────────────────────────────────────────
export function Btn({ children, on = false }: { children: ReactNode; on?: boolean }) {
  return (
    <span
      className="inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded px-2 font-mono text-[11px] leading-none text-text"
      style={{
        background: on ? 'rgba(88,166,255,0.35)' : 'rgba(14,17,22,0.9)',
        border: `1px solid ${on ? '#58a6ff' : 'rgba(110,118,129,0.55)'}`,
        color: on ? '#fff' : undefined,
      }}
    >
      {children}
    </span>
  );
}
