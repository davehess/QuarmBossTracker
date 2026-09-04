'use client';
// RaidHeatmap — the GitHub-style raid-night grid shared by /me and
// /raidhistory (Hitya, 2026-09-03). One column per week, one row per weekday,
// one cell per night. The pages decide what a cell MEANS (gold for "I was
// there" on /me; red→orange→green fill on /raidhistory) and hand the colours
// in; this component only lays them out and answers hover.
//
// Why a client component at all: the tooltip. A CSS-only tooltip is clipped
// by the horizontal scroller the grid needs on a phone (overflow-x: auto
// clips on BOTH axes), and a native `title` is a second-late grey box that
// cannot show the raid name on its own line. So one fixed-position tooltip
// follows whichever cell is hovered or focused — `position: fixed` escapes
// the scroller — and disappears on scroll so it can never drift off its cell.
// Everything else is static markup: no animation, nothing that moves.
//
// Every cell that is a night is a real link to that night's review, so a tap
// on a phone (no hover) still goes somewhere useful.

import { useEffect, useRef, useState } from 'react';

export type HeatCell = {
  /** Cell colour — a hex from the platform palette. */
  color: string;
  /** 0–1; the member's tick share on /me. Omit for a solid cell. */
  alpha?: number;
  /** Tooltip, one string per line: date, raid name(s), then the count. */
  lines: string[];
  /** Where the cell goes on click. */
  href?: string;
  /** Outline-only: a raid was held and this member was not in it. */
  outline?: boolean;
};

// Rows are the guild's raid days (Hitya, 2026-09-04: "it should just be our
// raid days") — the page passes them, from lib/raidHeatmap's rowsFor, which
// adds any other weekday that actually carries a raid so nothing goes unseen.
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const CELL = 12;   // px
const GAP  = 2;    // px

type Tip = { x: number; y: number; lines: string[] };

export default function RaidHeatmap({ weeks, months, cells, rows, label }: {
  weeks: string[][];
  months: (string | null)[];
  cells: Record<string, HeatCell>;
  /** Weekday indices to draw, 0 = Sunday. */
  rows: number[];
  /** Accessible name for the grid. */
  label: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  // Newest week sits at the right edge, which on a phone is off-screen. Start
  // there — the recent nights are what anyone opening this is looking for.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  // A fixed tooltip anchored to a cell's viewport position goes stale the
  // moment anything scrolls; hide it rather than chase it.
  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    window.addEventListener('scroll', hide, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', hide, { capture: true } as EventListenerOptions);
  }, [tip]);

  const show = (el: HTMLElement, lines: string[]) => {
    const r = el.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top - 6, lines });
  };

  return (
    <div>
      <div ref={scroller} className="overflow-x-auto pb-1">
        <div
          role="img"
          aria-label={label}
          className="inline-grid"
          style={{
            gridTemplateColumns: `28px repeat(${weeks.length}, ${CELL}px)`,
            gridAutoRows: `${CELL}px`,
            gap: `${GAP}px`,
          }}
        >
          {/* Month row — a label only where a month begins; the text overflows
              its 12px column to the right, which is fine because the next label
              is at least four columns away. */}
          <span aria-hidden="true" style={{ height: 14 }} />
          {months.map((m, i) => (
            <span key={`m${i}`} aria-hidden="true"
                  className="text-[10px] leading-none text-dim whitespace-nowrap overflow-visible"
                  style={{ height: 14 }}>
              {m ?? ''}
            </span>
          ))}

          {rows.map(d => (
            <RowFragment key={`r${d}`} d={d} rowLabel={DAY_NAMES[d] ?? ''} weeks={weeks} cells={cells} onShow={show} onHide={() => setTip(null)} />
          ))}
        </div>
      </div>

      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded border border-border bg-bg px-2 py-1 text-[11px] leading-snug text-text shadow-lg whitespace-nowrap"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.lines.map((l, i) => (
            <div key={i} className={i === 0 ? 'text-gold' : i === tip.lines.length - 1 ? 'text-dim' : ''}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// One weekday row: its label cell, then one cell per week. Kept as a sibling
// component so the grid's children stay a flat list (CSS grid places direct
// children only — a wrapper element per row would break the column math).
function RowFragment({ d, rowLabel, weeks, cells, onShow, onHide }: {
  d: number;
  rowLabel: string;
  weeks: string[][];
  cells: Record<string, HeatCell>;
  onShow: (el: HTMLElement, lines: string[]) => void;
  onHide: () => void;
}) {
  return (
    <>
      <span aria-hidden="true" className="text-[10px] leading-3 text-dim">{rowLabel}</span>
      {weeks.map((col, w) => {
        const key = col[d];
        // The future: nothing to draw.
        if (!key) return <span key={`${w}-${d}`} aria-hidden="true" />;
        const cell = cells[key];
        // A day with no raid — the quiet ground the lit cells sit on.
        if (!cell) return <span key={key} aria-hidden="true" className="block rounded-[2px] bg-border/40" style={{ width: CELL, height: CELL }} />;
        const style = cell.outline
          ? { width: CELL, height: CELL, boxShadow: `inset 0 0 0 1px ${cell.color}` }
          : { width: CELL, height: CELL, backgroundColor: cell.color, opacity: cell.alpha ?? 1 };
        const text = cell.lines.join(' · ');
        const cls = 'block rounded-[2px] focus:outline-none focus-visible:ring-1 focus-visible:ring-blue';
        return cell.href ? (
          <a key={key} href={cell.href} className={cls} style={style} aria-label={text}
             onMouseEnter={e => onShow(e.currentTarget, cell.lines)} onMouseLeave={onHide}
             onFocus={e => onShow(e.currentTarget, cell.lines)} onBlur={onHide} />
        ) : (
          <span key={key} tabIndex={0} className={cls} style={style} aria-label={text}
                onMouseEnter={e => onShow(e.currentTarget, cell.lines)} onMouseLeave={onHide}
                onFocus={e => onShow(e.currentTarget, cell.lines)} onBlur={onHide} />
        );
      })}
    </>
  );
}
