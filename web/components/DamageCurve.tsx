'use client';

// DamageCurve — Hitya's napkin sketch (docs/DESIGN-fight-timeline.md), built,
// then reshaped by his 2026-08-16 parse review:
//
//   100 ┤╲                    Y = boss HP %
//    75 ┤ ╲░░░░░░░░           shaded = damage contribution   Wizard 23.4%
//     0 ┤            ╲___     (stacked BY CLASS, drillable)  Warrior 12.6%
//       └──────────────────   X = fight time                 ← right-edge labels
//   MT  ├──── Abrahms ────┤   swimlane: who was taking hits, when
//
// The stack groups BY CLASS at the top level with name+% labels on the right
// edge; clicking a class (band, chip, or legend row) drills into that class's
// characters with the same labels. Hovering a chip/legend/band highlights its
// region. In the drill view everything outside the class stays as ONE muted
// band at the bottom so the stack still sums to the fight total.
//
// ONE AXIS, deliberately. The sketch draws boss HP% and stacked damage together,
// which as separate scales would be a dual-axis chart — the most common way to
// make a chart look informative and read wrong. They are the same quantity from
// opposite directions: cumulative damage dealt IS HP removed, so the stack
// normalised to the fight's total damage has the HP-removed curve as its top
// edge. Both series are "% of the boss's health bar".
//
// Where the observed HP line sits ABOVE the stack, the boss healed (or damage
// went somewhere that was not this boss). That divergence is a real signal and
// is only legible because the two share an axis.
//
// Geometry note: this used to mirror FightTimeline.tsx exactly (W=1000,
// PADL/PADR=8) because both drew fight-time axes on /parses/[id]. That page now
// renders its events as a LIST (FightEventLog — Hitya: the marker view was
// "useless in this format"), so this chart is the only time axis there and the
// right pad is free to hold the label gutter. /raid/review still uses
// FightTimeline standalone — no cross-chart alignment to preserve.

import { useMemo, useState } from 'react';
import type { Band, MTSegment } from '@/lib/fightCurve';
import { groupSeriesByClass } from '@/lib/fightCurve';

// Validated 2026-08-13 against surface #0d1117 (dataviz validator): lightness
// band PASS, chroma floor PASS, normal-vision floor PASS (worst adjacent ΔE
// 20.7), contrast PASS, CVD separation WARN at ΔE 6.2 deutan for the
// pink↔green adjacent pair — legal only WITH secondary encoding, which is why
// the stack ships 2px surface gaps, a legend, and direct labels.
// ⚠ ORDER IS LOAD-BEARING: the CVD check is on ADJACENT pairs. Re-running the
// validator is mandatory before reordering or adding a hue.
// Our UI tokens (#58a6ff, #56d364, #d29922…) could NOT be used — tuned for text
// on dark, they sit at OKLCH L≈0.72–0.80, outside the 0.48–0.67 band a fill
// needs, and failed chroma + CVD as a set. Same hue families, re-stepped.
// #f85149 is absent on purpose: reserved for death/critical, never a series.
const SERIES = ['#4493e8', '#c9732a', '#18a3ad', '#a371f7', '#3aa864', '#e0619a', '#b08a2e'];
const OTHER = '#4a5568';   // muted — any folded "N others" band + drill's "everyone else"
const DIMMED = '#2b3240';  // a band that exists but is not highlighted
const C = {
  ink: '#c9d1d9', dim: '#6e7681', base: '#30363d', panel: '#161b22',
  hp: '#f0f6fc',          // derived HP curve — near-white, reads as "the boss"
  hpObs: '#ffa657',       // observed HP — orange, the warning-ish "measured" line
  mt: '#58a6ff',
};

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const fmt = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n));

function niceStep(durSec: number): number {
  const target = durSec / 6;
  for (const s of [5, 10, 15, 30, 60, 120, 300, 600]) if (s >= target) return s;
  return 600;
}

// What actually gets stacked in the current view — a class group, a character,
// or a merged filler ("everyone else" while drilled / "N more" past the
// palette). `members` lists the character names a key stands for, so hover and
// search can resolve either level to the same highlight set.
type DrawBand = {
  key: string;
  label: string;
  total: number;
  cum: number[];
  members: string[];
  muted?: boolean;
  drillable?: boolean;
};

export function DamageCurve({
  buckets, bands, totalDamage, mt, durationSec,
  observedHp = [], classOf = {}, repeatPullWarning = false, series,
}: {
  buckets: number[];
  bands: Band[];
  totalDamage: number;
  mt: MTSegment[];
  durationSec: number;
  observedHp?: { tSec: number; pct: number }[];
  classOf?: Record<string, string | null>;
  repeatPullWarning?: boolean;
  /** Unfolded per-character series (FightCurve.series). Without it the class
   *  grouping falls back to the folded bands and the long tail lumps into
   *  whatever the fold called it. */
  series?: Band[];
}) {
  // View state: which class we're drilled into (null = class overview), which
  // band key the pointer is on (chip, legend row, or ribbon), pinned highlight
  // keys (clicked in the legend), and the name search.
  const [drill, setDrill] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  const perChar = (series && series.length ? series : bands.filter(b => !b.isOther));
  const classGroups = useMemo(
    () => groupSeriesByClass(perChar, classOf),
    [perChar, classOf],
  );
  const drilled = drill ? classGroups.find(g => g.klass === drill) ?? null : null;

  // Bands for the current view. Drill keeps the one-axis premise by stacking
  // "everyone else" (muted) under the class's characters — the top edge is
  // still the fight's whole HP-removed curve.
  const drawBands = useMemo<DrawBand[]>(() => {
    const nB = buckets.length;
    if (!drilled) {
      return classGroups.map(g => ({
        key: g.klass, label: g.klass, total: g.total, cum: g.cum,
        members: g.members.map(m => m.name),
        muted: g.isOther, drillable: true,
      }));
    }
    const out: DrawBand[] = [];
    const restCum = new Array(nB).fill(0);
    let restTotal = 0;
    for (const g of classGroups) {
      if (g.klass === drilled.klass) continue;
      for (let i = 0; i < nB; i++) restCum[i] += g.cum[i] || 0;
      restTotal += g.total;
    }
    if (restTotal > 0) {
      out.push({ key: '__rest', label: 'everyone else', total: restTotal, cum: restCum,
                 members: [], muted: true });
    }
    // Palette discipline inside the drill too: 7 hues, then one muted fold.
    // Ribbons stack bottom-to-top in array order, so largest-first here puts
    // the biggest member just above the muted base — same read as the overview.
    const kept = drilled.members.slice(0, SERIES.length);
    const more = drilled.members.slice(SERIES.length);
    for (const m of kept) {
      out.push({ key: m.name, label: m.name, total: m.total, cum: m.cum, members: [m.name] });
    }
    if (more.length) {
      const moreCum = new Array(nB).fill(0);
      for (const m of more) for (let i = 0; i < nB; i++) moreCum[i] += m.cum[i] || 0;
      out.push({ key: '__more', label: `${more.length} more`, members: more.map(m => m.name),
                 total: more.reduce((a, m) => a + m.total, 0), cum: moreCum, muted: true });
    }
    return out;
  }, [classGroups, drilled, buckets.length]);

  // Geometry. PADR carries the right-edge label gutter.
  const W = 1000, PADL = 8, PADR = 148, plotW = W - PADL - PADR;
  const PLOT_H = 220, TOP = 14, AXIS_Y = TOP + PLOT_H;
  const MT_Y = AXIS_Y + 30, MT_H = 14;
  const H = MT_Y + MT_H + 26;

  const dur = Math.max(1, durationSec);
  const xFor = (tSec: number) => PADL + plotW * Math.min(1, Math.max(0, tSec / dur));
  const yFor = (pct: number) => TOP + PLOT_H * (1 - Math.min(1, Math.max(0, pct / 100)));

  // Highlight set: hover wins, then the search query, then pinned legend picks.
  // Keys resolve through `members`, so a class-level key highlights when a
  // member matches the query.
  const q = query.trim().toLowerCase();
  const active: Set<string> | null = useMemo(() => {
    if (hover) return new Set([hover]);
    if (q) {
      const s = new Set<string>();
      for (const b of drawBands) {
        if (b.label.toLowerCase().includes(q) || b.members.some(m => m.toLowerCase().includes(q))) {
          s.add(b.key);
        }
      }
      return s.size ? s : null;
    }
    return pinned.size ? new Set([...pinned]) : null;
  }, [hover, q, pinned, drawBands]);
  const isOn = (key: string) => !active || active.has(key);
  // MT segments follow the same highlight: by class in the overview, by
  // character in the drill.
  const mtOn = (name: string) => {
    if (!active) return true;
    const key = drilled ? name : (classOf[name] || 'Unknown');
    return active.has(key) || active.has(name);
  };

  const colorFor = (b: DrawBand, bi: number) => {
    if (b.muted) return OTHER;
    // In the drill, index colors AFTER the muted base band so member hues match
    // the legend order; in the overview bi is the class rank directly.
    return SERIES[bi % SERIES.length];
  };
  // Color index that skips muted bands, so hues stay stable as bands shift.
  const hueIndex = (idx: number) => {
    let n = 0;
    for (let i = 0; i < idx; i++) if (!drawBands[i].muted) n++;
    return n;
  };

  // Stack bottom-to-top. Each band's ribbon runs between the running total
  // BELOW it and its own cumulative total, both as a % of the fight's damage —
  // which is the same axis as boss HP removed. The final lower/upper values
  // also place the right-edge labels.
  const ribbons = useMemo(() => {
    if (!totalDamage || !buckets.length) return [];
    const below = new Array(buckets.length).fill(0);
    return drawBands.map((band, bi) => {
      const lower = below.slice();
      for (let i = 0; i < buckets.length; i++) below[i] += band.cum[i] || 0;
      const upper = below.slice();
      const top = upper.map((v, i) => `${xFor(buckets[i])},${yFor((v / totalDamage) * 100)}`);
      const bot = lower.map((v, i) => `${xFor(buckets[i])},${yFor((v / totalDamage) * 100)}`).reverse();
      return {
        band, bi,
        points: [...top, ...bot].join(' '),
        loFinal: lower[lower.length - 1] || 0,
        hiFinal: upper[upper.length - 1] || 0,
      };
    });
  }, [drawBands, buckets, totalDamage, dur]);

  // Right-edge labels (ask #3): name + % of the fight's damage, sitting beside
  // each band's final span. A simple downward collision pass keeps them 13px
  // apart; spans under 1.5% skip the label (it's in the legend) so a long tail
  // doesn't smear.
  const edgeLabels = useMemo(() => {
    const out: { key: string; text: string; y: number; color: string; muted?: boolean }[] = [];
    for (const r of ribbons) {
      const share = totalDamage > 0 ? ((r.band.total / totalDamage) * 100) : 0;
      if (share < 1.5) continue;
      const yMid = (yFor((r.loFinal / totalDamage) * 100) + yFor((r.hiFinal / totalDamage) * 100)) / 2;
      out.push({
        key: r.band.key,
        text: `${r.band.label} ${share.toFixed(1)}%`,
        y: yMid,
        color: r.band.muted ? C.dim : SERIES[hueIndex(r.bi) % SERIES.length],
        muted: r.band.muted,
      });
    }
    // Stack grows bottom-up so labels arrive bottom-most first; walk from the
    // bottom pushing upward, clamp at the top, then a second downward pass
    // re-spaces whatever the clamp squashed together.
    out.sort((a, b) => b.y - a.y);
    const GAP = 13;
    let floor = AXIS_Y - 2;
    for (const l of out) {
      if (l.y > floor) l.y = floor;
      floor = l.y - GAP;
    }
    let ceil = TOP + 8;
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].y < ceil) out[i].y = ceil;
      ceil = out[i].y + GAP;
    }
    return out;
  }, [ribbons, totalDamage]);

  // MT-lane gaps ≥10s (ask #2): nobody was taking hits — the mob was moving,
  // kited, feared, or off the raid entirely. Sub-10s holes were already
  // bridged in the lane math (snapshot-cadence aliasing, measured 2026-08-16).
  const mtGaps = useMemo(() => {
    const gaps: { fromSec: number; toSec: number }[] = [];
    let prev = 0;
    for (const seg of mt) {
      if (seg.fromSec - prev >= 10) gaps.push({ fromSec: prev, toSec: seg.fromSec });
      prev = Math.max(prev, seg.toSec);
    }
    if (dur - prev >= 10) gaps.push({ fromSec: prev, toSec: dur });
    return gaps;
  }, [mt, dur]);

  const step = niceStep(dur);
  const gridPcts = [0, 25, 50, 75, 100];

  const derivedHp = useMemo(() => {
    if (!totalDamage || !buckets.length) return '';
    const running = new Array(buckets.length).fill(0);
    for (const b of drawBands) for (let i = 0; i < buckets.length; i++) running[i] += b.cum[i] || 0;
    return running.map((v, i) => `${xFor(buckets[i])},${yFor(100 - (v / totalDamage) * 100)}`).join(' ');
  }, [drawBands, buckets, totalDamage, dur]);

  const enterDrill = (klass: string) => {
    setDrill(klass); setPinned(new Set()); setHover(null);
  };
  const exitDrill = () => { setDrill(null); setPinned(new Set()); setHover(null); };
  const togglePin = (key: string) =>
    setPinned(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.base}`, borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <b style={{ color: C.ink }}>
          Damage over the fight
          {drilled && <span style={{ color: C.dim, fontWeight: 400 }}> · {drilled.klass}</span>}
        </b>
        <span style={{ color: C.dim, fontSize: 11 }}>
          share of the boss&rsquo;s health bar &middot; {fmt(totalDamage)} total &middot; {mmss(dur)}
        </span>
      </div>

      {repeatPullWarning && (
        <div style={{ marginTop: 8, padding: '6px 8px', borderRadius: 6,
                      border: '1px solid #7a5b1a', background: '#251d0c', color: '#ffa657', fontSize: 12 }}>
          ⚠ This boss was pulled more than once inside the window. Snapshots cannot yet be
          separated per pull, so the curve may combine attempts.
        </div>
      )}

      {/* Class chips: hover highlights that class's region (ask #1), click
          drills into it (ask #4). While drilled, the active chip is lit and a
          back chip leads out. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
        {drilled && (
          <button onClick={exitDrill}
            style={{ background: '#0d1117', color: C.ink, border: `1px solid ${C.base}`,
                     borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>
            ◂ all classes
          </button>
        )}
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Find a damage dealer…"
          aria-label="Highlight damage bands by character name"
          style={{ background: '#0d1117', color: C.ink, border: `1px solid ${C.base}`,
                   borderRadius: 6, padding: '4px 8px', fontSize: 12, minWidth: 180 }}
        />
        {classGroups.map(g => {
          const isActive = drilled?.klass === g.klass;
          return (
            <button
              key={g.klass}
              onClick={() => (isActive ? exitDrill() : enterDrill(g.klass))}
              onMouseEnter={() => !drilled && setHover(g.klass)}
              onMouseLeave={() => setHover(h => (h === g.klass ? null : h))}
              onFocus={() => !drilled && setHover(g.klass)}
              onBlur={() => setHover(h => (h === g.klass ? null : h))}
              aria-pressed={isActive}
              title={`${g.klass} — ${fmt(g.total)} (${totalDamage > 0 ? ((g.total / totalDamage) * 100).toFixed(1) : 0}%). Click to break out each ${g.isOther ? 'member' : g.klass}.`}
              style={{ background: isActive ? '#1f6feb' : '#0d1117', color: isActive ? '#fff' : C.ink,
                       border: `1px solid ${isActive ? '#1f6feb' : C.base}`, borderRadius: 6,
                       padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}
            >{g.klass}</button>
          );
        })}
        {pinned.size > 0 && (
          <button onClick={() => setPinned(new Set())}
            style={{ background: 'transparent', color: C.dim, border: `1px solid ${C.base}`,
                     borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>
            clear ({pinned.size})
          </button>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: 'block' }}
           aria-label={`Stacked damage contribution and boss health over ${mmss(dur)}`}>
        {/* Recessive grid. */}
        {gridPcts.map(p => (
          <g key={p}>
            <line x1={PADL} y1={yFor(p)} x2={W - PADR} y2={yFor(p)} stroke={C.base} strokeWidth={1} />
            <text x={PADL} y={yFor(p) - 3} fill={C.dim} fontSize={10}>{p}%</text>
          </g>
        ))}

        {/* Stacked ribbons. 2px surface-coloured gap between segments is the
            secondary encoding the CVD warn requires — it also just reads better. */}
        {ribbons.map(({ band, bi, points }) => {
          const on = isOn(band.key);
          return (
            <polygon
              key={band.key} points={points}
              fill={on ? colorFor(band, hueIndex(bi)) : DIMMED}
              fillOpacity={on ? (active ? 0.95 : 0.85) : 0.35}
              stroke={C.panel} strokeWidth={2} strokeLinejoin="round"
              style={{ cursor: band.drillable ? 'pointer' : undefined }}
              onClick={band.drillable ? () => enterDrill(band.key) : undefined}
              onMouseEnter={() => setHover(band.key)}
              onMouseLeave={() => setHover(h => (h === band.key ? null : h))}
            >
              <title>{`${band.label} — ${fmt(band.total)} (${((band.total / totalDamage) * 100).toFixed(1)}%)${band.drillable ? ' · click to break out' : ''}`}</title>
            </polygon>
          );
        })}

        {/* Right-edge labels (ask #3): who/what + % of the fight's damage. */}
        {edgeLabels.map(l => (
          <text key={l.key} x={W - PADR + 6} y={l.y + 4}
                fill={isOn(l.key) ? (l.muted ? C.dim : l.color) : C.dim}
                fontSize={11} fontWeight={isOn(l.key) && active ? 700 : 500}>
            {l.text}
          </text>
        ))}

        {/* Boss HP. Derived is the complement of the stack; observed is drawn
            over it when we have it, and a gap between them means the boss healed. */}
        {derivedHp && (
          <polyline points={derivedHp} fill="none" stroke={C.hp} strokeWidth={2}
                    strokeLinejoin="round" opacity={0.9} />
        )}
        {observedHp.length > 1 && (
          <polyline
            points={observedHp.map(p => `${xFor(p.tSec)},${yFor(p.pct)}`).join(' ')}
            fill="none" stroke={C.hpObs} strokeWidth={2} strokeDasharray="5 3" strokeLinejoin="round"
          />
        )}

        {/* Time axis. */}
        <line x1={PADL} y1={AXIS_Y} x2={W - PADR} y2={AXIS_Y} stroke={C.base} strokeWidth={2} />
        {Array.from({ length: Math.floor(dur / step) + 1 }, (_, i) => i * step).map(s => (
          <g key={s}>
            <line x1={xFor(s)} y1={AXIS_Y} x2={xFor(s)} y2={AXIS_Y + 4} stroke={C.dim} strokeWidth={1} />
            <text x={xFor(s)} y={AXIS_Y + 15} fill={C.dim} fontSize={10} textAnchor="middle">{mmss(s)}</text>
          </g>
        ))}

        {/* Taking-hits swimlane. Gaps ≥10s are real: nobody was taking hits —
            the mob was moving, kited, feared, or off the raid (ask #2: the
            Moash "it ran" read was correct — hover a gap for its window). */}
        <text x={PADL} y={MT_Y - 3} fill={C.dim} fontSize={10}>
          MT
          <title>Who was taking hits, when. A gap means NOBODY was taking hits — the mob was moving, kited, or off the raid — not that the tank changed.</title>
        </text>
        <line x1={PADL} y1={MT_Y + MT_H / 2} x2={W - PADR} y2={MT_Y + MT_H / 2}
              stroke={C.base} strokeWidth={1} />
        {mtGaps.map((g, i) => {
          const x = xFor(g.fromSec), w = Math.max(2, xFor(g.toSec) - x);
          return (
            <rect key={`gap${i}`} x={x} y={MT_Y} width={w} height={MT_H} rx={3}
                  fill="#ffffff" fillOpacity={0.04} stroke={C.base} strokeDasharray="3 3" strokeWidth={1}>
              <title>{`Nobody taking hits ${mmss(g.fromSec)}–${mmss(g.toSec)} — the mob was moving, kited, or off the raid.`}</title>
            </rect>
          );
        })}
        {mt.map((seg, i) => {
          const x = xFor(seg.fromSec), w = Math.max(2, xFor(seg.toSec) - x);
          const on = mtOn(seg.name);
          return (
            <g key={`${seg.name}-${i}`}>
              <rect x={x} y={MT_Y} width={w} height={MT_H} rx={3}
                    fill={on ? C.mt : DIMMED} fillOpacity={on ? 0.8 : 0.45}
                    stroke={C.panel} strokeWidth={1}>
                <title>{`${seg.name} — taking hits ${mmss(seg.fromSec)}–${mmss(seg.toSec)} (${fmt(seg.took)} taken)`}</title>
              </rect>
              {w > 60 && (
                <text x={x + w / 2} y={MT_Y + MT_H - 3} fill="#0d1117" fontSize={10}
                      textAnchor="middle" fontWeight={600}>{seg.name}</text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend — identity is never colour alone. Overview rows drill; drill
          rows pin their character's highlight. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
        {drawBands.map((band, bi) => {
          const on = isOn(band.key);
          const share = totalDamage > 0 ? ((band.total / totalDamage) * 100).toFixed(1) : '0';
          return (
            <button
              key={band.key}
              onClick={() => (band.drillable ? enterDrill(band.key) : band.key.startsWith('__') ? undefined : togglePin(band.key))}
              onMouseEnter={() => setHover(band.key)}
              onMouseLeave={() => setHover(h => (h === band.key ? null : h))}
              aria-pressed={pinned.has(band.key)}
              title={`${band.label} — ${fmt(band.total)} (${share}%)`}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent',
                       border: 'none', padding: 0, cursor: 'pointer', opacity: on ? 1 : 0.45 }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 2, background: colorFor(band, hueIndex(bi)),
                             display: 'inline-block', flex: '0 0 auto' }} />
              <span style={{ color: C.ink, fontSize: 12 }}>{band.label}</span>
              <span style={{ color: C.dim, fontSize: 11 }}>{fmt(band.total)} · {share}%</span>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 14, marginTop: 8, color: C.dim, fontSize: 11, flexWrap: 'wrap' }}>
        <span><span style={{ display: 'inline-block', width: 14, height: 2, background: C.hp,
                              verticalAlign: 'middle', marginRight: 4 }} />boss HP (from damage dealt)</span>
        {observedHp.length > 1 && (
          <span><span style={{ display: 'inline-block', width: 14, height: 2, background: C.hpObs,
                                verticalAlign: 'middle', marginRight: 4 }} />boss HP (observed)</span>
        )}
        <span>bands stack to 100% of damage done — the top edge is the health removed</span>
        <span>MT gaps = nobody taking hits (mob moving / kited / off the raid)</span>
      </div>
    </div>
  );
}
