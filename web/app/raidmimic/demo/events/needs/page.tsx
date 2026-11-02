// raidmimic.com/demo/events/needs: OPTION B of the event board, "Needs board drives the schedule". Demand first: every flag
// target is a row ranked by how many raiders still need it, with the night it is already scheduled for, or a Schedule
// button when nobody has posted one. The other option is /demo/events (calendar first). Static, like the rest of the demo.
import type { Metadata } from 'next';
import { AVAILABLE_THIS_WEEK, CHARS, TARGETS, eventByTarget, needsFor } from '@/lib/demoGuild';
import DemoShell, { DemoButton, PANEL, demoBase } from '../../_parts/DemoShell';

export const metadata: Metadata = {
  title: { absolute: '[beta] Demo guild · Flag needs board' },
  description: 'Option B for coordinating flag events: every flag target ranked by how many raiders still need it, with a schedule button. Invented guild.',
  robots: { index: false, follow: false },
};

export default function DemoNeedsPage() {
  const BASE = demoBase();
  const total = CHARS.length;
  const rows = TARGETS.map(t => {
    const n = needsFor(t);
    const ev = eventByTarget(t.key);
    // Needs it, said they are free this week, and is not on this target's event (there is none, for an unscheduled one).
    const idle = n.need.filter(c => AVAILABLE_THIS_WEEK.includes(c.name) && !(ev?.signed ?? []).includes(c.name));
    return { t, n, idle, ev };
  }).sort((a, b) => b.n.need.length - a.n.need.length || a.t.label.localeCompare(b.t.label));
  const scheduled = rows.filter(r => r.ev).length;

  return (
    <DemoShell active="needs" title="What the guild needs, most first"
      lead="Option B · Needs board drives the schedule. Demand first: the board ranks what raiders are missing, and the leader schedules from the top.">
      <div className="flex flex-col gap-4">
        <p className="m-0 text-xs text-dim">
          {total} raiders · {rows.length} targets · {scheduled} scheduled · the posted events below came from this board
        </p>

        <ol aria-label="Flag targets by need" className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map(({ t, n, idle, ev }, i) => (
            <li key={t.key} className={`${PANEL} grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_14rem]`}>
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span aria-hidden className="text-xs text-dim">{i + 1}</span>
                  <h2 className="m-0 text-sm text-[#f2ede1]">{t.label}</h2>
                  <span className="text-[11px] text-dim">{t.blurb}</span>
                </div>
                <div role="img" aria-label={`${n.need.length} need it, ${n.unsure.length} not recorded, ${n.done.length} done`}
                     className="flex h-2 overflow-hidden rounded bg-bg">
                  <span className="bg-orange" style={{ width: `${(n.need.length / total) * 100}%` }} />
                  <span className="bg-border" style={{ width: `${(n.unsure.length / total) * 100}%` }} />
                  <span className="bg-green/70" style={{ width: `${(n.done.length / total) * 100}%` }} />
                </div>
                <p className="m-0 text-xs leading-5">
                  <b className="text-orange">{n.need.length} need it</b>
                  <span className="text-dim"> · {n.unsure.length} not recorded · {n.done.length} done</span>
                </p>
                <p className="m-0 text-[11px] leading-5 text-dim">
                  {idle.length > 0
                    ? <><b className="text-text">{idle.length}</b> of them {idle.length === 1 ? 'is' : 'are'} free this week and not signed for it yet: {idle.map(c => c.name).join(', ')}.</>
                    : 'Everyone who needs it and is free this week is already signed for it.'}
                </p>
              </div>

              <div className="flex flex-col items-start gap-1.5 sm:items-end sm:text-right">
                {ev ? (
                  <>
                    <span className="text-xs text-green">Scheduled</span>
                    <span className="text-sm text-text">{ev.day} {ev.time}</span>
                    <span className="text-[11px] text-dim">{ev.signed.length} signed · posted by {ev.by}</span>
                    <a href={`${BASE}/events`} className="text-[11px] text-blue hover:underline">open the event</a>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-dim">Not scheduled</span>
                    <DemoButton>Schedule this</DemoButton>
                    <span className="text-[11px] text-dim">demo: nothing is saved</span>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>

        <p className="text-xs leading-5 text-dim">
          <span className="text-orange">Orange</span> needs it (their own full read lacks it) · <span className="text-dim">grey</span> not recorded ·{' '}
          <span className="text-green">green</span> done, including flags a raid leader reported that the owner has not confirmed yet.
          Prefer to start from the calendar? That is <a href={`${BASE}/events`} className="text-blue hover:underline">option A</a>.
        </p>
      </div>
    </DemoShell>
  );
}
