'use client';
// RaidHeatmap — raid nights as month blocks of day chips, shared by /me and
// /raidhistory (Hitya, 2026-09-03; reshaped 2026-09-04: the week×weekday grid
// "looks odd … come up with a better format that is both mobile and desktop
// friendly"). The pages decide what a chip MEANS (gold for "I was there" on
// /me; red→orange→green fill on /raidhistory) and hand the colours in; this
// component only lays them out and answers hover.
//
// Why month blocks: the guild raids three nights a week, so a calendar grid
// is mostly empty ground, and at 12px a cell cannot carry a date. A chip can:
// weekday on top, day number underneath, an optional figure below that (the
// raider count on /raidhistory). Blocks stack one-per-row on a phone and tile
// four-across on a desktop with the same markup. Newest month first, because
// that is the one anyone opens the page for.
//
// The tooltip is one fixed-position element: a CSS-only tooltip would be
// clipped by any scroller and a native `title` cannot put the raid name on its
// own line. It disappears on scroll so it can never drift off its chip.
// Everything else is static markup: no animation, nothing that moves.
//
// Every chip that is a night is a real link to that night's review, so a tap
// on a phone (no hover) still goes somewhere useful.

import { useEffect, useState } from 'react';
import { groupByMonth, weekdayOf, DAY_SHORT } from '@/lib/raidHeatmap';

export type NightChip = {
  /** YYYY-MM-DD — the night. */
  date: string;
  /** Chip colour — a hex from the platform palette. */
  color: string;
  /** 0–1; the member's tick share on /me. Omit for a solid chip. */
  alpha?: number;
  /** Outline-only: a raid was held and this member was not in it. */
  outline?: boolean;
  /** Small figure under the day number — the raider count on /raidhistory. */
  sub?: string;
  /** Tooltip, one string per line: date, raid name(s), then the count. */
  lines: string[];
  /** Where the chip goes on click. */
  href?: string;
};

type Tip = { x: number; y: number; lines: string[] };

// Text on a filled chip is the page ground colour — every fill in the palette
// (gold, green, orange, red) is light enough for it. An outline chip keeps its
// own colour for the text.
const INK = '#0d1117';

export default function RaidHeatmap({ nights, label, monthSummaries }: {
  nights: NightChip[];
  /** Accessible name for the whole list. */
  label: string;
  /** Optional right-hand text per month header, keyed 'YYYY-MM' — e.g. "9 nights · avg 46". */
  monthSummaries?: Record<string, string>;
}) {
  const [tip, setTip] = useState<Tip | null>(null);

  // A fixed tooltip anchored to a chip's viewport position goes stale the
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
  const hide = () => setTip(null);

  const months = groupByMonth(nights);

  return (
    <div>
      <div role="list" aria-label={label} className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {months.map(m => (
          <section key={m.month} role="listitem" className="bg-bg border border-border/60 rounded p-3">
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <span className="text-xs text-text">{m.title}</span>
              {monthSummaries?.[m.month] && <span className="text-[10px] text-dim">{monthSummaries[m.month]}</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {m.items.map(n => {
                const text = n.lines.join(' · ');
                const style = n.outline
                  ? { boxShadow: `inset 0 0 0 1px ${n.color}`, color: n.color }
                  : { backgroundColor: n.color, opacity: n.alpha ?? 1, color: INK };
                const cls = 'flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded leading-none ' +
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue';
                const body = (
                  <>
                    <span className="text-[9px] opacity-80">{DAY_SHORT[weekdayOf(n.date)]}</span>
                    <span className="text-sm tabular-nums mt-0.5">{Number(n.date.slice(8, 10))}</span>
                    {n.sub && <span className="text-[9px] tabular-nums mt-0.5 opacity-90">{n.sub}</span>}
                  </>
                );
                return n.href ? (
                  <a key={n.date} href={n.href} className={cls} style={style} aria-label={text}
                     onMouseEnter={e => show(e.currentTarget, n.lines)} onMouseLeave={hide}
                     onFocus={e => show(e.currentTarget, n.lines)} onBlur={hide}>
                    {body}
                  </a>
                ) : (
                  <span key={n.date} tabIndex={0} className={cls} style={style} aria-label={text}
                        onMouseEnter={e => show(e.currentTarget, n.lines)} onMouseLeave={hide}
                        onFocus={e => show(e.currentTarget, n.lines)} onBlur={hide}>
                    {body}
                  </span>
                );
              })}
            </div>
          </section>
        ))}
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
