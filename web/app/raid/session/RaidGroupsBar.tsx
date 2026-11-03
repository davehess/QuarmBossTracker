// Which raid is this? (the guild lead, 2026-10-26: a sliced window "is still showing characters from the previous raid
// in it, because there were multiple raids active at that timeframe".) Members' page only.
//
// A window holds every raider any of our uploaders saw in it, so two raids on the ground at once, or one crew replaced by
// another, read as one big roster. lib/sessionGroups.ts finds the raids; this bar names them. With more than one raid
// listed, each is a toggle chip (RaidPicker): pick one or several (a leader hand-off can split one raid into several
// groups) and "Show selected" narrows the whole review (attendance, fights, deaths, loot, the replay's dots) to their
// union; narrowed, the bar says so and offers the whole window back.
import Link from 'next/link';
import { groupIdsOf, groupLabel, raidsIn, type RaidGroup } from '@/lib/sessionGroups';
import { chip, chipIdle, etMin, fmtSpan, windowHref } from './nightStyle';
import RaidPicker from './RaidPicker';

/** `parent`: the window the raids were counted in (this review's own, or the larger one it is a part of). `active`: the narrowed set's key. */
export type GroupsView = { list: RaidGroup[]; active: string | null; parent: { fromMs: number; toMs: number } };

export default function RaidGroupsBar({ fromMs, toMs, groups }: { fromMs: number; toMs: number; groups: GroupsView }) {
  const { active, parent } = groups;
  const list = raidsIn(groups.list, { fromMs, toMs });
  if (list.length < 2 && !active) return null;
  const on = list.filter(g => groupIdsOf(active).includes(g.id));
  return (
    <section aria-label="Raids in this window" className="mb-3 rounded-md border border-border bg-panel p-3 text-sm">
      {on.length ? (
        <p className="mb-2 text-xs text-dim">
          <span className="text-text">Showing {on.length === 1 ? 'one raid' : `${on.length} raids together`}: {on.map(groupLabel).join('; ')}.</span>{' '}
          Attendance, fights, deaths, loot and the replay&apos;s dots are theirs; ticks, rolls and bids are the whole window&apos;s.
        </p>
      ) : (
        <p className="mb-2 text-xs text-dim">
          This window holds {list.length} raids that were on the ground at the same time or one after another. Tick one or more,
          then show them, to see only their raiders.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <RaidPicker key={active ?? ''} fromMs={fromMs} toMs={toMs} parent={parent} raids={list} active={active}
          detail={g => `${etMin.format(Math.max(g.fromMs, fromMs))}–${etMin.format(Math.min(g.toMs, toMs))} · ${fmtSpan(Math.min(g.toMs, toMs) - Math.max(g.fromMs, fromMs))}`} />
        {active && <Link href={windowHref(fromMs, toMs)} className={`${chip} ${chipIdle} inline-block`}>Everyone in the window</Link>}
      </div>
    </section>
  );
}
