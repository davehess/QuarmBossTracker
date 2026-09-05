// RaidNightsCalendar — variant C of the attendance view (beta preview,
// 2026-09-04): real MINI CALENDARS, one per month, newest first. Every day of
// the month is drawn in its weekday column; raid nights are coloured with the
// same meaning the other variants use, and every other day is a faint number.
//
// What this trades against the month blocks (variant A) and the strips (B):
//   + the most familiar shape there is — a wall calendar — so the cadence
//     (Sun/Wed/Thu), a skipped week, a holiday move, all read by position;
//   + dense: a whole year is twelve small boxes, two rows on a wide screen;
//   + zero client JavaScript — the raid name is the native `title` tooltip
//     (and the link's accessible name), so on a phone it is tap-to-open only;
//   − empty days take space that carries no information, and at this size the
//     raider count cannot sit inside the cell.
// A server component; nothing moves.

import Link from 'next/link';
import { groupByMonth, weekdayOf } from '@/lib/raidHeatmap';

export type CalNight = {
  date: string;
  color: string;
  alpha?: number;
  outline?: boolean;
  /** Tooltip + accessible name: date, raid name(s), the count. */
  title: string;
  href?: string;
};

const INK = '#0d1117';
const HEAD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function daysIn(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export default function RaidNightsCalendar({ nights, label }: { nights: CalNight[]; label: string }) {
  const months = groupByMonth(nights);
  return (
    <div role="list" aria-label={label} className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {months.map(m => {
        const byDate = new Map(m.items.map(n => [n.date, n]));
        const offset = weekdayOf(`${m.month}-01`);
        const cells: (string | null)[] = [
          ...Array<null>(offset).fill(null),
          ...Array.from({ length: daysIn(m.month) }, (_, i) => `${m.month}-${String(i + 1).padStart(2, '0')}`),
        ];
        return (
          <section key={m.month} role="listitem" className="bg-bg border border-border/60 rounded p-2">
            <div className="text-[11px] text-text mb-1">{m.title}</div>
            <div className="grid grid-cols-7 gap-px text-center">
              {HEAD.map((h, i) => <span key={`h${i}`} className="text-[8px] leading-4 text-dim/70">{h}</span>)}
              {cells.map((d, i) => {
                if (!d) return <span key={`p${i}`} aria-hidden="true" />;
                const day = Number(d.slice(8, 10));
                const n = byDate.get(d);
                if (!n) return <span key={d} className="h-5 text-[9px] leading-5 text-dim/40 tabular-nums">{day}</span>;
                const style = n.outline
                  ? { boxShadow: `inset 0 0 0 1px ${n.color}`, color: n.color }
                  : { backgroundColor: n.color, color: INK, opacity: n.alpha ?? 1 };
                const cls = 'block h-5 rounded-sm text-[10px] leading-5 tabular-nums focus:outline-none focus-visible:ring-1 focus-visible:ring-blue';
                return n.href
                  ? <Link key={d} href={n.href} title={n.title} aria-label={n.title} className={cls} style={style}>{day}</Link>
                  : <span key={d} title={n.title} aria-label={n.title} tabIndex={0} className={cls} style={style}>{day}</span>;
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
