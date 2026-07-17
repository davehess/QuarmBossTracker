// FightTimeline — a per-fight time axis with event markers, for reviewing what
// happened WHEN (and, once capture lands, which callouts fired vs should have).
//
// Phase 1 renders the one clean, already-stored signal: player DEATHS over the
// fight duration (from contributions.raw_parse.deaths, deduped upstream). A
// wipe reads as a vertical STACK of markers at one moment — exactly the "a
// large majority of us died" case this is built for. Raid-wide events
// (enrage/DT/AE) and trigger fires are additive lanes (props already accepted,
// wired when the P2 capture lands) — the death lane is the substrate.
//
// Design: single time axis (never dual). Deaths use the reserved status color
// (critical red) + a ☠ label, never color-alone. Server-rendered SVG with a
// native <title> per marker for hover — no client JS needed at this size.
// Colors mirror the site's tailwind tokens (web/tailwind.config.ts).

type TLDeath = { name: string; ts: string; class?: string | null; riposteDeath?: boolean };
// Reserved for P2/P3 — a raid-wide boss event or a trigger fire on the same axis.
export type TLEvent = { at: string; label: string; kind?: 'raid_event' | 'fire' };

const C = {
  axis:   '#6e7681',  // dim
  base:   '#30363d',  // border
  death:  '#f85149',  // red (critical / death)
  event:  '#ffa657',  // orange (raid-wide event)
  fire:   '#58a6ff',  // blue (trigger fired)
  ink:    '#c9d1d9',  // text
  panel:  '#161b22',
};

function mmss(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Pick a "nice" gridline interval so we show ~4–8 ticks across the fight.
function niceStep(durSec: number): number {
  const target = durSec / 6;
  const steps = [5, 10, 15, 30, 60, 120, 300, 600];
  for (const s of steps) if (s >= target) return s;
  return steps[steps.length - 1];
}

export function FightTimeline({
  startedAt,
  endedAt,
  durationSec,
  deaths,
  events = [],
  fires = [],
}: {
  startedAt: string;
  endedAt?: string | null;
  durationSec: number | null;
  deaths: TLDeath[];
  events?: TLEvent[];
  fires?: TLEvent[];
}) {
  const start = new Date(startedAt).getTime();
  // Prefer explicit duration; fall back to ended_at; last resort span the
  // events we have. Guard against zero/negative so the math never divides by 0.
  const end = endedAt ? new Date(endedAt).getTime() : NaN;
  let fightMs =
    (durationSec && durationSec > 0 ? durationSec * 1000 : 0) ||
    (Number.isFinite(end) && end > start ? end - start : 0);
  const allTs = [...deaths.map(d => d.ts), ...events.map(e => e.at), ...fires.map(f => f.at)]
    .map(t => new Date(t).getTime())
    .filter(t => Number.isFinite(t) && t >= start);
  if (fightMs <= 0) fightMs = allTs.length ? Math.max(...allTs) - start : 1;
  fightMs = Math.max(fightMs, 1);
  const durSec = fightMs / 1000;

  // Geometry (viewBox units; the SVG scales to its container width).
  const W = 1000, PADL = 8, PADR = 8, plotW = W - PADL - PADR;
  const AXIS_Y = 30;             // time axis baseline
  const PIN_GAP = 13;            // vertical spacing when deaths stack
  const xFor = (t: number) => PADL + plotW * Math.min(1, Math.max(0, (t - start) / fightMs));

  // Stack deaths that land within ~1.2% of the fight of each other so a wipe
  // becomes a readable column instead of overlapping dots.
  const sorted = [...deaths]
    .map(d => ({ ...d, t: new Date(d.ts).getTime() }))
    .filter(d => Number.isFinite(d.t))
    .sort((a, b) => a.t - b.t);
  const CLUSTER_MS = fightMs * 0.012;
  type Placed = TLDeath & { t: number; x: number; level: number };
  const placed: Placed[] = [];
  let clusterEndT = -Infinity;
  let level = 0;
  for (const d of sorted) {
    if (d.t - clusterEndT <= CLUSTER_MS) level += 1;
    else { level = 0; clusterEndT = d.t; }
    placed.push({ ...d, x: xFor(d.t), level });
  }
  // Bound the column height — a 40-person wipe shouldn't render a 700px stack.
  // Beyond the cap, dots overlap at the last row (the header's "N died together"
  // conveys the magnitude, and the Deaths list below has every name + time).
  const MAX_STACK = 12;
  const maxLevel = Math.min(MAX_STACK, placed.reduce((m, p) => Math.max(m, p.level), 0));
  const H = AXIS_Y + 24 + (maxLevel + 1) * PIN_GAP;

  const step = niceStep(durSec);
  const ticks: number[] = [];
  for (let s = 0; s <= durSec + 0.001; s += step) ticks.push(s);

  const eventMarks = events.map(e => ({ ...e, t: new Date(e.at).getTime() })).filter(e => Number.isFinite(e.t));
  const fireMarks  = fires.map(f => ({ ...f, t: new Date(f.at).getTime() })).filter(f => Number.isFinite(f.t));

  // Biggest simultaneous cluster → the headline "N died together". Derive it
  // from the death CLUSTERING (level resets to 0 per cluster and increments),
  // not per-pixel — a wipe that spans a few px must still count as one cluster.
  const worstCluster = placed.length ? Math.max(...placed.map(p => p.level)) + 1 : 0;

  return (
    <section className="bg-panel border border-border rounded-lg p-4 md:p-5">
      <div className="flex items-baseline justify-between gap-2 mb-1 flex-wrap">
        <h3 className="text-sm text-orange flex items-center gap-2">
          🕒 Fight timeline
        </h3>
        <span className="text-[11px] text-dim">
          {mmss(durSec)} · {deaths.length} death{deaths.length === 1 ? '' : 's'}
          {worstCluster >= 3 && <span className="text-red"> · {worstCluster} died together</span>}
        </span>
      </div>
      <p className="text-[11px] text-dim mb-3 leading-4">
        Deaths across the fight — a vertical stack is a wipe moment. Hover a marker for who and when.
        {events.length + fires.length === 0 && (
          <span className="text-dim/80"> Raid-wide events + which callouts fired land here next.</span>
        )}
      </p>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label={`Fight timeline: ${deaths.length} deaths over ${mmss(durSec)}`}
          style={{ minWidth: 480 }}
        >
          {/* time axis */}
          <line x1={PADL} y1={AXIS_Y} x2={W - PADR} y2={AXIS_Y} stroke={C.base} strokeWidth={2} />
          {ticks.map((s, i) => {
            const x = PADL + plotW * (s / durSec);
            return (
              <g key={i}>
                <line x1={x} y1={AXIS_Y - 4} x2={x} y2={AXIS_Y + 4} stroke={C.axis} strokeWidth={1} />
                <text x={x} y={AXIS_Y - 9} fill={C.axis} fontSize={11} textAnchor="middle" fontFamily="ui-monospace, monospace">
                  {mmss(s)}
                </text>
              </g>
            );
          })}

          {/* raid-wide event ticks above the axis (P2) */}
          {eventMarks.map((e, i) => {
            const x = xFor(e.t);
            return (
              <g key={`ev${i}`}>
                <line x1={x} y1={AXIS_Y - 4} x2={x} y2={12} stroke={C.event} strokeWidth={2} />
                <title>{e.label} · {mmss((e.t - start) / 1000)}</title>
              </g>
            );
          })}

          {/* trigger fires just under the axis (P2) */}
          {fireMarks.map((f, i) => {
            const x = xFor(f.t);
            return (
              <g key={`fr${i}`}>
                <circle cx={x} cy={AXIS_Y + 8} r={3} fill={C.fire} />
                <title>📢 {f.label} · {mmss((f.t - start) / 1000)}</title>
              </g>
            );
          })}

          {/* death markers, stacked downward */}
          {placed.map((p, i) => {
            const y = AXIS_Y + 22 + Math.min(p.level, MAX_STACK) * PIN_GAP;
            return (
              <g key={`d${i}`}>
                <line x1={p.x} y1={AXIS_Y + 2} x2={p.x} y2={y} stroke={C.death} strokeWidth={1} opacity={0.35} />
                <circle cx={p.x} cy={y} r={4.5} fill={C.death} stroke={C.panel} strokeWidth={1.5} />
                <title>
                  ☠ {p.name}{p.class ? ` (${p.class})` : ''} · {mmss((p.t - start) / 1000)}{p.riposteDeath ? ' · riposte kill' : ''}
                </title>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
