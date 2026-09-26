// Pictures for /about (the guild lead, 2026-09-26: "could use some updating, possibly some generated
// images and assets so it's not just blocks of text"). One figure per chapter, drawn in the overlays'
// own chrome — translucent black card, ✥ and ✕ in the corners, mono type with a hard outline — so the
// page's pictures look like the product rather than like a slide deck.
//
// Server-rendered HTML and SVG, no client JS: the only motion is CSS, and it stops for
// prefers-reduced-motion. Names are the invented set from OverlayDemo.tsx (Aldenmar, Brackwyn, Corvale,
// Rethlan, Nyssara, Mirenne, Kelbrin, Elowin, Thessaly, Wyldane, Zarrin): this page is public.
import type { ReactNode } from 'react';

const OUTLINE = { textShadow: '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000,0 1px 2px #000' };

// The overlay window every figure sits in.
export function OverlayFrame({ title, accent = '#a371f7', children, className = '' }: {
  title: string; accent?: string; children: ReactNode; className?: string;
}) {
  return (
    <div className={`relative rounded-lg border bg-[#0e1116]/90 p-3 sm:p-4 font-mono shadow-[0_8px_30px_rgba(0,0,0,0.45)] ${className}`}
         style={{ borderColor: accent + '73' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-dim opacity-60" aria-hidden>✥</span>
        <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: accent, ...OUTLINE }}>{title}</span>
        <span className="text-[10px] text-dim opacity-60" aria-hidden>✕</span>
      </div>
      {children}
    </div>
  );
}

const MOTION = `@media (prefers-reduced-motion: reduce){.fig-anim,.fig-anim *{animation:none !important;opacity:1 !important}}`;

/* ── 01: the boss board ─────────────────────────────────────────────────── */

const BOSSES = [
  { name: 'Lord Nagafen', zone: "Nagafen's Lair", left: '6h 12m', pct: 22, up: false },
  { name: 'Lady Vox', zone: 'Permafrost', left: '1h 40m', pct: 78, up: false },
  { name: 'Trakanon', zone: 'Old Sebilis', left: 'in window', pct: 100, up: true },
];

export function BossBoardFigure() {
  return (
    <div className="rounded-md border border-border bg-[#2b2d31] p-3 sm:p-4 font-sans max-w-md" aria-label="The Discord boss board">
      <div className="flex gap-3">
        <div className="w-1 rounded bg-gold shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[#f2f3f5]">⏳ Active cooldowns</div>
          <div className="text-[11px] text-[#b5bac1] mt-0.5">Respawn windows with the ±variance done for you</div>
          <ul className="mt-3 space-y-2.5">
            {BOSSES.map(b => (
              <li key={b.name}>
                <div className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="text-[#f2f3f5] font-medium truncate">{b.name} <span className="text-[#949ba4] font-normal">· {b.zone}</span></span>
                  <span className={b.up ? 'text-green font-semibold' : 'text-[#dbdee1] tabular-nums'}>{b.up ? '🟢 ' : ''}{b.left}</span>
                </div>
                <div className="mt-1 h-1.5 rounded bg-[#1e1f22] overflow-hidden" aria-hidden>
                  <div className={b.up ? 'h-full bg-green' : 'h-full bg-gold/80'} style={{ width: `${b.pct}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ── 02: what happens to a line of your log ─────────────────────────────── */

const LINES = [
  { t: 'Brackwyn hits Shei Vinitras for 212 points of damage.', ok: true, note: 'combat → the parse' },
  { t: "Corvale tells you, 'need a port after?'", ok: false, note: 'tell → stays on your PC' },
  { t: "Rethlan tells the raid, 'CH on Wyldane'", ok: true, note: 'raid chat → the relay' },
  { t: "Nyssara tells the group, 'afk 2'", ok: false, note: 'group → stays on your PC' },
  { t: 'Shei Vinitras has been slain by Aldenmar!', ok: true, note: 'kill → timers + the fight card' },
];

export function LogLineFigure() {
  return (
    <div className="grid md:grid-cols-[1fr_auto] gap-4 items-center fig-anim">
      <style>{`.fig-ll li{opacity:0;animation:figln 10s ease-out infinite}
        @keyframes figln{0%{opacity:0;transform:translateX(-6px)}6%,86%{opacity:1;transform:none}100%{opacity:0}}${MOTION}`}</style>
      <OverlayFrame title="eqlog_Brackwyn_pq.proj.txt" accent="#56d364">
        <ul className="fig-ll space-y-1.5 text-[11px] leading-snug">
          {LINES.map((l, i) => (
            <li key={i} className="flex gap-2 items-start" style={{ animationDelay: `${i * 0.9}s` }}>
              <span className={`shrink-0 w-4 text-center ${l.ok ? 'text-green' : 'text-red'}`} aria-label={l.ok ? 'sent' : 'kept'}>{l.ok ? '↑' : '✕'}</span>
              <span className="min-w-0">
                <span className={l.ok ? 'text-text' : 'text-dim line-through decoration-red/60'}>{l.t}</span>
                <span className={`block text-[10px] ${l.ok ? 'text-green/80' : 'text-red/80'}`}>{l.note}</span>
              </span>
            </li>
          ))}
        </ul>
      </OverlayFrame>
      <div className="text-[11px] text-dim md:max-w-[12rem] leading-relaxed">
        <span className="text-text">Filtered on your PC</span>, byte by byte, before anything is parsed or sent.
        Tells, group and officer chat never leave the machine.
      </div>
    </div>
  );
}

/* ── 03: a merged parse card ─────────────────────────────────────────────── */

const PARSE = [
  { n: 'Aldenmar', c: 'Monk', d: 18240 },
  { n: 'Zarrin', c: 'Wizard', d: 16910 },
  { n: 'Corvale', c: 'Ranger', d: 14075 },
  { n: 'Wyldane', c: 'Warrior', d: 9960 },
  { n: 'Mirenne', c: 'Druid', d: 7430 },
];

export function ParseCardFigure() {
  const max = PARSE[0].d;
  return (
    <div className="rounded-lg border border-border bg-panel p-4 max-w-md" aria-label="A merged parse card">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm text-text font-semibold">Shei Vinitras</div>
        <div className="text-[11px] text-dim tabular-nums">3:42 · 4 logs merged</div>
      </div>
      <div className="flex gap-1 mt-1.5" aria-hidden>
        {['#58a6ff', '#56d364', '#d29922', '#a371f7'].map(c => <span key={c} className="h-1.5 w-6 rounded" style={{ background: c }} />)}
      </div>
      <ul className="mt-3 space-y-1.5">
        {PARSE.map(p => (
          <li key={p.n} className="text-[11px]">
            <div className="flex justify-between"><span className="text-text">{p.n} <span className="text-dim">{p.c}</span></span>
              <span className="text-dim tabular-nums">{p.d.toLocaleString()}</span></div>
            <div className="h-1.5 mt-0.5 rounded bg-bg overflow-hidden"><div className="h-full bg-blue/70" style={{ width: `${(p.d / max) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
      <div className="text-[10px] text-dim mt-3">Each log saw the whole fight; the card keeps the best record of each player.</div>
    </div>
  );
}

/* ── 04: a real overlay, rendered ────────────────────────────────────────── */

export function OverlayShot({ src, alt, caption, width, height }: {
  src: string; alt: string; caption: ReactNode; width: number; height: number;
}) {
  return (
    <figure className="m-0">
      {/* A real render of a Mimic overlay (static file); next/image would re-encode a UI screenshot. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} width={width} height={height} loading="lazy"
           className="w-full h-auto rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.5)]" />
      <figcaption className="text-[11px] text-dim mt-2">{caption}</figcaption>
    </figure>
  );
}

/* ── 05: it follows you ──────────────────────────────────────────────────── */

const SEATS = [
  { who: 'Thessaly', cls: 'Cleric', view: 'CH chain', line: 'Your slot: 3 of 5 · next in 4s', color: '#58a6ff' },
  { who: 'Zarrin', cls: 'Shaman', view: 'Buff queue', line: 'Feral Avatar → Wyldane, Corvale', color: '#56d364' },
  { who: 'Brackwyn', cls: 'Bard', view: 'Melody', line: 'Lcea’s missing: Mirenne, Elowin', color: '#a371f7' },
];

export function FollowYouFigure() {
  return (
    <div className="grid sm:grid-cols-2 gap-4 items-center fig-anim">
      <style>{`.fig-seat{animation:figseat 9s infinite}.fig-view{opacity:0;animation:figview 9s infinite}
        @keyframes figseat{0%,30%{border-color:var(--c);background:rgba(255,255,255,0.05)}34%,100%{border-color:#30363d;background:transparent}}
        @keyframes figview{0%,30%{opacity:1}34%,100%{opacity:0}}${MOTION}
        @media (prefers-reduced-motion: reduce){.fig-views{height:auto !important;display:grid;gap:8px}.fig-views .fig-view{position:static}}`}</style>
      <OverlayFrame title="Your EQ folder" accent="#8b949e">
        <ul className="space-y-1.5 text-[11px]">
          {SEATS.map((s, i) => (
            <li key={s.who} className="fig-seat rounded border border-border px-2 py-1.5 flex justify-between"
                style={{ animationDelay: `${i * 3}s`, ['--c' as string]: s.color }}>
              <span className="text-text">eqlog_{s.who}_pq.proj.txt</span><span className="text-dim">{s.cls}</span>
            </li>
          ))}
        </ul>
        <div className="text-[10px] text-dim mt-2">All of them tailed at once. Whoever you are playing, Mimic is on.</div>
      </OverlayFrame>
      <div className="fig-views relative h-[92px]">
        {SEATS.map((s, i) => (
          <div key={s.who} className="fig-view absolute inset-0" style={{ animationDelay: `${i * 3}s` }}>
            <OverlayFrame title={s.view} accent={s.color}>
              <div className="text-[11px] text-text" style={OUTLINE}>{s.who} <span className="text-dim">· {s.cls}</span></div>
              <div className="text-[11px] mt-1" style={{ color: s.color, ...OUTLINE }}>{s.line}</div>
            </OverlayFrame>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 06: a raid night ────────────────────────────────────────────────────── */

export function RaidNightFigure() {
  // 8 PM → 12 AM across 640 units; x = (minutes after 8 PM) / 240 * 600 + 20.
  const x = (m: number) => 20 + (m / 240) * 600;
  const ticks = [30, 90, 150, 210];
  const loot = [52, 118, 176, 226];
  return (
    <div className="rounded-lg border border-border bg-bg/40 p-3 sm:p-4 max-w-3xl" aria-label="A raid night: ticks and loot windows">
      <div className="overflow-x-auto">
        <svg viewBox="0 0 640 132" className="w-full min-w-[520px] h-auto font-mono" role="img">
          <title>Ticks recorded at 8:30, 9:30, 10:30 and 11:30; each drop opens a two-minute bid window.</title>
          <line x1="20" y1="70" x2="620" y2="70" stroke="#30363d" strokeWidth="2" />
          {[0, 60, 120, 180, 240].map((m, i) => (
            <g key={m}>
              <line x1={x(m)} y1="64" x2={x(m)} y2="76" stroke="#6e7681" />
              <text x={x(m)} y="94" fill="#8b949e" fontSize="11" textAnchor="middle">{['8 PM', '9', '10', '11', '12'][i]}</text>
            </g>
          ))}
          {ticks.map((m, i) => (
            <g key={m}>
              <rect x={x(m) - 6} y="64" width="12" height="12" transform={`rotate(45 ${x(m)} 70)`} fill="#d29922" />
              <text x={x(m)} y="50" fill="#d29922" fontSize="11" textAnchor="middle">tick {i + 1}</text>
              <text x={x(m)} y="36" fill="#c9d1d9" fontSize="10" textAnchor="middle">✓ recorded</text>
            </g>
          ))}
          {loot.map(m => (
            <g key={m}>
              <rect x={x(m)} y="104" width={(2 / 240) * 600 * 4} height="8" rx="2" fill="#a371f7" opacity="0.8" />
              <circle cx={x(m)} cy="108" r="4" fill="#a371f7" />
            </g>
          ))}
          <text x="20" y="126" fill="#a371f7" fontSize="10">● a drop, and its 2-minute bid window (read out loud by Mimic)</text>
        </svg>
      </div>
    </div>
  );
}

/* ── 07: the week, and when nothing ships ────────────────────────────────── */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const RAID = new Set(['Wed', 'Thu', 'Sun']);

export function FreezeWeekFigure({ tests, files }: { tests: string; files: string }) {
  // 6 PM → 2 AM (8 hours) down the column; the freeze is 7:30 PM → 12:30 AM.
  const H = 8 * 60;
  const top = ((90) / H) * 100;
  const height = ((5 * 60) / H) * 100;
  return (
    <div className="grid sm:grid-cols-[1fr_auto] gap-4 items-center">
      <div className="rounded-lg border border-border bg-bg/40 p-3 sm:p-4" aria-label="The deploy freeze on raid nights">
        <div className="grid grid-cols-7 gap-1.5 text-center">
          {DAYS.map(d => (
            <div key={d}>
              <div className={`text-[10px] mb-1 ${RAID.has(d) ? 'text-red' : 'text-dim'}`}>{d}</div>
              <div className="relative h-28 rounded bg-panel border border-border overflow-hidden">
                {RAID.has(d) && (
                  <div className="absolute inset-x-0 bg-red/25 border-y border-red/60" style={{ top: `${top}%`, height: `${height}%` }}>
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] text-red [writing-mode:vertical-rl] rotate-180">no deploys</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-dim mt-1.5"><span>6 PM</span><span>raid window 7:30 PM – 12:30 AM ET</span><span>2 AM</span></div>
      </div>
      <div className="flex sm:flex-col gap-4 sm:gap-3 font-mono">
        <div><div className="text-2xl text-green font-bold tabular-nums">{tests}</div><div className="text-[10px] text-dim">tests</div></div>
        <div><div className="text-2xl text-green font-bold tabular-nums">{files}</div><div className="text-[10px] text-dim">test files</div></div>
        <div><div className="text-2xl text-orange font-bold">1</div><div className="text-[10px] text-dim">kill switch for the fleet</div></div>
      </div>
    </div>
  );
}

/* ── 08: in the game itself ──────────────────────────────────────────────── */

// Copies of the gallery's marks (web/public/zeal/marks), so /about does not depend on that page shipping.
const TAGS = ['wolf', 'skull', 'star', 'moon', 'cross', 'lasso', 'lute', 'flame', 'badge-3', 'paw-K'];

export function TagStripFigure() {
  return (
    <div className="rounded-lg border border-border bg-[radial-gradient(ellipse_at_50%_0%,rgba(120,130,110,0.2),transparent_70%)] bg-bg/60 p-4">
      <div className="flex flex-wrap gap-3 items-end justify-center">
        {TAGS.map(t => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={t} src={`/about/tags/${t}.png`} alt={`${t} tag`} width={48} height={48} loading="lazy"
               className="w-10 h-10 sm:w-12 sm:h-12 drop-shadow-[0_4px_6px_rgba(0,0,0,0.6)]" />
        ))}
      </div>
      <div className="text-[11px] text-dim text-center mt-3">Marks Zeal draws over a target’s head, from <span className="text-text">/tag</span>. Everyone in the raid sees the same one.</div>
    </div>
  );
}
