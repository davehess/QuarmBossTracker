// Which raid is this? (the guild lead, 2026-10-26: a sliced window "is still showing characters from the previous raid
// in it, because there were multiple raids active at that timeframe".) Members' page only.
//
// A window holds every raider any of our uploaders saw in it, so two raids on the ground at once, or one crew replaced by
// another, read as one big roster. lib/sessionGroups.ts finds the raids; this bar names them. With more than one raid
// listed, each is a link that narrows the whole review (attendance, fights, deaths, loot, the replay's dots) to that
// raid; narrowed, the bar says so and offers the whole window back.
import Link from 'next/link';
import { groupLabel, raidsIn, type RaidGroup } from '@/lib/sessionGroups';
import { chip, chipIdle, chipOn, etMin, fmtSpan, windowHref } from './nightStyle';

/** `parent`: the window the raids were counted in (this review's own, or the larger one it is a part of). */
export type GroupsView = { list: RaidGroup[]; active: string | null; parent: { fromMs: number; toMs: number } };

export default function RaidGroupsBar({ fromMs, toMs, groups }: { fromMs: number; toMs: number; groups: GroupsView }) {
  const { active, parent } = groups;
  const list = raidsIn(groups.list, { fromMs, toMs });
  if (list.length < 2 && !active) return null;
  const on = list.find(g => g.id === active) ?? null;
  return (
    <section aria-label="Raids in this window" className="mb-3 rounded-md border border-border bg-panel p-3 text-sm">
      {on ? (
        <p className="mb-2 text-xs text-dim">
          <span className="text-text">Showing one raid: {groupLabel(on)}.</span>{' '}
          Attendance, fights, deaths, loot and the replay&apos;s dots are this raid&apos;s; ticks, rolls and bids are the whole window&apos;s.
        </p>
      ) : (
        <p className="mb-2 text-xs text-dim">
          This window holds {list.length} raids that were on the ground at the same time or one after another. Pick one to see only its raiders.
        </p>
      )}
      <ul className="flex flex-wrap gap-2">
        {list.map(g => (
          <li key={g.id}>
            <Link href={windowHref(fromMs, toMs, g.id, parent)} aria-current={g.id === active ? 'true' : undefined}
              className={`${chip} ${g.id === active ? chipOn : chipIdle} inline-block`}>
              {groupLabel(g)} <span className={g.id === active ? 'opacity-80' : 'text-dim'}>· {etMin.format(Math.max(g.fromMs, fromMs))}–{etMin.format(Math.min(g.toMs, toMs))} · {fmtSpan(Math.min(g.toMs, toMs) - Math.max(g.fromMs, fromMs))}</span>
            </Link>
          </li>
        ))}
        {active && (
          <li>
            <Link href={windowHref(fromMs, toMs)} className={`${chip} ${chipIdle} inline-block`}>Everyone in the window</Link>
          </li>
        )}
      </ul>
    </section>
  );
}
