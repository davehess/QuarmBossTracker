// RaidNightsStrips — variant B of the attendance view (beta preview,
// 2026-09-04): a LOG. One row per week, newest first; inside it, one pill per
// raid night carrying the weekday, the date, the raid's NAME and a figure
// (raider count on /raidhistory, "4/4 ticks" on /me). Colour = the same
// meaning the other variants use.
//
// What this trades against the month blocks (variant A):
//   + the raid name is READ, not hovered — nothing depends on a tooltip, so a
//     phone gets the full information with no interaction at all;
//   + zero client JavaScript: this is a server component of plain markup;
//   − longer: a year is 52 rows (two columns on a desktop), a scroll on a
//     phone; the shape of a month is not visible at a glance.
// No tooltip, no state, nothing that moves.

import Link from 'next/link';
import { addDays, weekdayOf, DAY_SHORT } from '@/lib/raidHeatmap';

export type StripNight = {
  date: string;
  color: string;
  alpha?: number;
  outline?: boolean;
  /** The raid's name(s), shown inline. */
  name: string;
  /** Right-hand figure: "47" raiders, or "4/4" ticks. */
  figure?: string;
  href?: string;
};

const INK = '#0d1117';

function weekLabel(sunday: string): string {
  return new Date(sunday + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function RaidNightsStrips({ nights, label }: { nights: StripNight[]; label: string }) {
  const byWeek = new Map<string, StripNight[]>();
  for (const n of nights) {
    const sunday = addDays(n.date, -weekdayOf(n.date));
    byWeek.set(sunday, [...(byWeek.get(sunday) ?? []), n]);
  }
  const weeks = [...byWeek.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <ol aria-label={label} className="grid gap-1.5 grid-cols-1 lg:grid-cols-2">
      {weeks.map(([sunday, ns]) => (
        <li key={sunday} className="flex items-start gap-3 bg-bg border border-border/60 rounded px-3 py-2 min-w-0">
          <span className="text-[11px] text-dim w-14 shrink-0 pt-1.5 whitespace-nowrap">{weekLabel(sunday)}</span>
          <div className="flex flex-wrap gap-1.5 min-w-0">
            {ns.slice().sort((a, b) => a.date.localeCompare(b.date)).map(n => {
              const style = n.outline
                ? { boxShadow: `inset 0 0 0 1px ${n.color}`, color: n.color }
                : { backgroundColor: n.color, color: INK, opacity: n.alpha ?? 1 };
              const cls = 'inline-flex items-center gap-2 rounded px-2 py-1 text-xs min-w-0 max-w-full ' +
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue';
              const inner = (
                <>
                  <span className="tabular-nums shrink-0">{DAY_SHORT[weekdayOf(n.date)]} {Number(n.date.slice(8, 10))}</span>
                  <span className="truncate opacity-90">{n.name}</span>
                  {n.figure && <span className="tabular-nums shrink-0 opacity-80">{n.figure}</span>}
                </>
              );
              return n.href
                ? <Link key={n.date} href={n.href} className={cls} style={style}>{inner}</Link>
                : <span key={n.date} className={cls} style={style}>{inner}</span>;
            })}
          </div>
        </li>
      ))}
    </ol>
  );
}
