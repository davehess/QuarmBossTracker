// ParseTrendChart: one dot per fight (when, DPS) with the raid-night average drawn as a line, for /me/parses.
// Server-rendered inline SVG, no JS; the page is a plain-link page and the dots explain themselves on hover.
//
// Palette is DamageCurve's (validated against the panel colour on 2026-08-13): boss fights in SERIES[0],
// everything else in the muted OTHER grey, the night average in SERIES[3]. #f85149 is absent on purpose, it
// means death/critical and a slow night is not that. The layout maths (scales, ticks, clock) lives in
// web/lib/parseTrend.ts so it can be tested without React.
import { buildTrend, fmtInt, type ParseSeries } from '@/lib/parseTrend';

const C = {
  boss: '#4493e8',    // DamageCurve SERIES[0]
  other: '#4a5568',   // DamageCurve OTHER
  avg: '#a371f7',     // DamageCurve SERIES[3]
  grid: '#30363d',
  label: '#6e7681',
  panel: '#161b22',
};

// A fixed viewBox: the SVG scales to its box, so on a phone the type shrinks with it. 640 wide keeps 12px
// labels near 7px at 400px wide, which is why this is not DamageCurve's 1000.
const W = 640, H = 300;
const PAD_R = 24, PAD_T = 18, PAD_B = 32;
const PLOT_H = H - PAD_T - PAD_B;
// The left gutter holds the DPS labels, so it is as wide as the longest one ("1,500 dps" needs more than "400 dps").
const gutter = (topLabel: string) => Math.max(44, Math.ceil(topLabel.length * 7) + 12);

export default function ParseTrendChart({
  series, sinceMs, nowMs, tz, multiChar = false,
}: {
  series: ParseSeries;
  /** The window's start; null = lifetime. */
  sinceMs: number | null;
  nowMs: number;
  tz: string;
  /** More than one character in the data: dot hovers name the character. */
  multiChar?: boolean;
}) {
  const m = buildTrend(series, { sinceMs, nowMs, tz, multiChar });
  const radius = m.dots.length <= 40 ? 5 : m.dots.length <= 150 ? 4 : 3;
  const last = m.avgs[m.avgs.length - 1];

  const yTicks = [
    { v: 0, label: '0' },
    { v: m.top / 2, label: fmtInt(m.top / 2) },
    { v: m.top, label: `${fmtInt(m.top)} dps` },
  ];
  const padL = gutter(yTicks[2].label);
  const plotW = W - padL - PAD_R;
  const px = (x: number) => padL + x * plotW;
  const py = (y: number) => PAD_T + (1 - y) * PLOT_H;

  // Trash first so boss dots sit on top of it where they overlap.
  const other = m.dots.filter(d => !d.boss);
  const boss = m.dots.filter(d => d.boss);

  // The last average, spelled out. It sits above its dot (below when that would leave the plot) and turns
  // to hang left of it when the dot is in the right half, so the text never leaves the viewBox.
  const lastX = last ? px(last.x) : 0;
  const lastY = last ? py(last.y) : 0;
  const lastAnchor = lastX > padL + plotW / 2 ? 'end' : 'start';
  const lastLabelY = lastY - 11 < PAD_T + 6 ? lastY + 21 : lastY - 11;

  return (
    <div className="bg-panel border border-border rounded-lg p-3 sm:p-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-dim">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: C.boss }} />
          Boss fight
        </span>
        {m.hasOther && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: C.other }} />
            Other fight
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-4" style={{ background: C.avg }} />
          Your average for the raid night
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Damage per second of each of your fights over time, with your average for each raid night as a line"
        style={{ width: '100%', height: 'auto', display: 'block' }}
      >
        {/* Gridlines at 0, half and the top; the unit rides on the top label. */}
        {yTicks.map(t => {
          const y = py(t.v / m.top);
          return (
            <g key={t.v}>
              <line x1={padL} y1={y} x2={W - PAD_R} y2={y} stroke={C.grid} strokeWidth={1} />
              <text x={padL - 8} y={y + 4} textAnchor="end" fill={C.label} fontSize={12}>{t.label}</text>
            </g>
          );
        })}

        {/* Day or hour marks on the baseline, labels under them. */}
        {m.xTicks.filter(t => t.mark).map(t => (
          <line key={`m${t.ms}`} x1={px(t.x)} y1={py(0)} x2={px(t.x)} y2={py(0) + 5} stroke={C.label} strokeWidth={1} />
        ))}
        {m.xTicks.filter(t => t.label).map(t => {
          const x = px(t.labelX);
          // A label this close to an edge turns inward so it stays inside the viewBox.
          const anchor = x < 20 ? 'start' : x > W - 20 ? 'end' : 'middle';
          return (
            <text key={`l${t.ms}`} x={x} y={H - 10} textAnchor={anchor} fill={C.label} fontSize={12}>{t.label}</text>
          );
        })}

        {/* The night average, under the dots so hovering a dot still works on the line. */}
        {m.avgs.length > 1 && (
          <polyline
            points={m.avgs.map(a => `${px(a.x)},${py(a.y)}`).join(' ')}
            fill="none" stroke={C.avg} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
            style={{ pointerEvents: 'none' }}
          />
        )}

        {[...other, ...boss].map((d, i) => (
          <circle
            key={`${d.eid}-${i}`} cx={px(d.x)} cy={py(d.y)} r={radius}
            fill={d.boss ? C.boss : C.other} fillOpacity={0.85}
            stroke="transparent" strokeWidth={8}
          >
            <title>{d.title}</title>
          </circle>
        ))}

        {m.avgs.map((a, i) => (
          <circle
            key={`a${i}`} cx={px(a.x)} cy={py(a.y)} r={i === m.avgs.length - 1 ? 5.5 : 3}
            fill={C.avg} stroke={C.panel} strokeWidth={1.5}
          >
            <title>{a.title}</title>
          </circle>
        ))}

        {last && (
          <text
            x={lastAnchor === 'end' ? lastX + 4 : lastX - 4} y={lastLabelY}
            textAnchor={lastAnchor} fill={C.avg} fontSize={13} fontWeight={600}
            stroke={C.panel} strokeWidth={3} paintOrder="stroke" strokeLinejoin="round"
            style={{ pointerEvents: 'none' }}
          >
            {`avg ${fmtInt(last.avg)}`}
          </text>
        )}
      </svg>
    </div>
  );
}
