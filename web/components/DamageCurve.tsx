'use client';

// DamageCurve — Hitya's napkin sketch (docs/DESIGN-fight-timeline.md), built.
//
//   100 ┤╲                    Y = boss HP %
//    75 ┤ ╲░░░░░░░░           shaded = damage contribution (stacked, filterable)
//     0 ┤            ╲___
//       └──────────────────   X = fight time
//   MT  ├──── Abrahms ────┤   swimlane: who held MT, when
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
// Geometry is deliberately identical to components/FightTimeline.tsx (W=1000,
// PADL/PADR=8) — both draw fight-time X axes on /parses/[id], and two time axes
// on one page that do not line up are worse than one.

import { useMemo, useState } from 'react';
import type { Band, MTSegment } from '@/lib/fightCurve';

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
const OTHER = '#4a5568';   // muted — the folded "N others" band
const DIMMED = '#2b3240';  // a band that exists but is not selected
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

export function DamageCurve({
  buckets, bands, totalDamage, mt, durationSec,
  observedHp = [], classOf = {}, repeatPullWarning = false,
}: {
  buckets: number[];
  bands: Band[];
  totalDamage: number;
  mt: MTSegment[];
  durationSec: number;
  observedHp?: { tSec: number; pct: number }[];
  classOf?: Record<string, string | null>;
  repeatPullWarning?: boolean;
}) {
  // One selection model, two ways to fill it (design doc "Open decision"):
  // a character set, with class buttons as bulk selectors over it.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  const W = 1000, PADL = 8, PADR = 8, plotW = W - PADL - PADR;
  const PLOT_H = 220, TOP = 14, AXIS_Y = TOP + PLOT_H;
  const MT_Y = AXIS_Y + 30, MT_H = 14;
  const H = MT_Y + MT_H + 26;

  const dur = Math.max(1, durationSec);
  const xFor = (tSec: number) => PADL + plotW * Math.min(1, Math.max(0, tSec / dur));
  const yFor = (pct: number) => TOP + PLOT_H * (1 - Math.min(1, Math.max(0, pct / 100)));

  const classes = useMemo(() => {
    const s = new Set<string>();
    for (const b of bands) { const c = classOf[b.name]; if (c) s.add(c); }
    return [...s].sort();
  }, [bands, classOf]);

  const anySelected = selected.size > 0;
  const isOn = (name: string) => !anySelected || selected.has(name);
  const toggle = (name: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  // Stack bottom-to-top. Each band's ribbon runs between the running total
  // BELOW it and its own cumulative total, both as a % of the fight's damage —
  // which is the same axis as boss HP removed.
  const ribbons = useMemo(() => {
    if (!totalDamage || !buckets.length) return [];
    const below = new Array(buckets.length).fill(0);
    return bands.map((band, bi) => {
      const lower = below.slice();
      for (let i = 0; i < buckets.length; i++) below[i] += band.cum[i] || 0;
      const upper = below.slice();
      const top = upper.map((v, i) => `${xFor(buckets[i])},${yFor((v / totalDamage) * 100)}`);
      const bot = lower.map((v, i) => `${xFor(buckets[i])},${yFor((v / totalDamage) * 100)}`).reverse();
      return { band, bi, points: [...top, ...bot].join(' ') };
    });
  }, [bands, buckets, totalDamage, dur]);

  // Derived HP remaining = 100% minus the share of total damage done so far.
  const derivedHp = useMemo(() => {
    if (!totalDamage || !buckets.length) return '';
    const running = new Array(buckets.length).fill(0);
    for (const b of bands) for (let i = 0; i < buckets.length; i++) running[i] += b.cum[i] || 0;
    return running.map((v, i) => `${xFor(buckets[i])},${yFor(100 - (v / totalDamage) * 100)}`).join(' ');
  }, [bands, buckets, totalDamage, dur]);

  const step = niceStep(dur);
  const gridPcts = [0, 25, 50, 75, 100];
  const visible = query.trim()
    ? bands.filter(b => b.name.toLowerCase().includes(query.trim().toLowerCase()))
    : bands;

  const colorFor = (bi: number, band: Band) =>
    band.isOther ? OTHER : SERIES[bi % SERIES.length];

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.base}`, borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <b style={{ color: C.ink }}>Damage over the fight</b>
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

      {/* Filters in one row above the chart. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Find a damage dealer…"
          aria-label="Filter the damage bands by character name"
          style={{ background: '#0d1117', color: C.ink, border: `1px solid ${C.base}`,
                   borderRadius: 6, padding: '4px 8px', fontSize: 12, minWidth: 180 }}
        />
        {classes.map(cls => {
          const members = bands.filter(b => classOf[b.name] === cls).map(b => b.name);
          const allOn = members.length > 0 && members.every(m => selected.has(m));
          return (
            <button
              key={cls}
              onClick={() => setSelected(prev => {
                const next = new Set(prev);
                members.forEach(m => (allOn ? next.delete(m) : next.add(m)));
                return next;
              })}
              aria-pressed={allOn}
              style={{ background: allOn ? '#1f6feb' : '#0d1117', color: allOn ? '#fff' : C.ink,
                       border: `1px solid ${allOn ? '#1f6feb' : C.base}`, borderRadius: 6,
                       padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}
            >{cls}</button>
          );
        })}
        {anySelected && (
          <button onClick={() => setSelected(new Set())}
            style={{ background: 'transparent', color: C.dim, border: `1px solid ${C.base}`,
                     borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>
            clear ({selected.size})
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
          const on = isOn(band.name);
          return (
            <polygon
              key={band.name} points={points}
              fill={on ? colorFor(bi, band) : DIMMED}
              fillOpacity={on ? 0.85 : 0.5}
              stroke={C.panel} strokeWidth={2} strokeLinejoin="round"
            >
              <title>{`${band.name} — ${fmt(band.total)} (${((band.total / totalDamage) * 100).toFixed(1)}%)`}</title>
            </polygon>
          );
        })}

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

        {/* MT swimlane. Gaps are real: no segment means nobody was taking hits. */}
        <text x={PADL} y={MT_Y - 3} fill={C.dim} fontSize={10}>MT</text>
        <line x1={PADL} y1={MT_Y + MT_H / 2} x2={W - PADR} y2={MT_Y + MT_H / 2}
              stroke={C.base} strokeWidth={1} />
        {mt.map((seg, i) => {
          const x = xFor(seg.fromSec), w = Math.max(2, xFor(seg.toSec) - x);
          const on = isOn(seg.name);
          return (
            <g key={`${seg.name}-${i}`}>
              <rect x={x} y={MT_Y} width={w} height={MT_H} rx={3}
                    fill={on ? C.mt : DIMMED} fillOpacity={on ? 0.8 : 0.45}
                    stroke={C.panel} strokeWidth={1}>
                <title>{`${seg.name} — MT ${mmss(seg.fromSec)}–${mmss(seg.toSec)} (${fmt(seg.took)} taken)`}</title>
              </rect>
              {w > 60 && (
                <text x={x + w / 2} y={MT_Y + MT_H - 3} fill="#0d1117" fontSize={10}
                      textAnchor="middle" fontWeight={600}>{seg.name}</text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend — always present for >=2 series, so identity is never colour alone. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
        {visible.map(band => {
          const bi = bands.indexOf(band);
          const on = isOn(band.name);
          return (
            <button
              key={band.name} onClick={() => toggle(band.name)} aria-pressed={selected.has(band.name)}
              title={`${band.name} — ${fmt(band.total)}`}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent',
                       border: 'none', padding: 0, cursor: 'pointer', opacity: on ? 1 : 0.45 }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 2, background: colorFor(bi, band),
                             display: 'inline-block', flex: '0 0 auto' }} />
              <span style={{ color: C.ink, fontSize: 12 }}>{band.name}</span>
              <span style={{ color: C.dim, fontSize: 11 }}>{fmt(band.total)}</span>
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
      </div>
    </div>
  );
}
