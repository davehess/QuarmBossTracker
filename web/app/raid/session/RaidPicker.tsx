'use client';
// Pick one raid, or several, of a window (the guild lead, 2026-11-03: "the selection should be multi-select" — one guild's
// raid can be recorded as three groups when the leader changes, and a public link must carry all three). Each raid is a
// toggle chip; "Show selected (k)" opens the review narrowed to the SET: `group=<id1>,<id2>` (lib/sessionGroups.ts), the
// union of the raids' raiders. One chip picked is the single-raid link it always was. Used by the raids bar and by each
// segment's "N raids at once" line.
import { useState } from 'react';
import Link from 'next/link';
import { groupIdsOf, groupKey, groupLabel, type RaidGroup } from '@/lib/sessionGroups';
import { chip, chipIdle, chipOn, windowHref } from './nightStyle';

export default function RaidPicker({ fromMs, toMs, parent, raids, active, detail }: {
  fromMs: number; toMs: number;
  /** The window the raids were counted in (this review's own, or the larger one it is a part of). */
  parent: { fromMs: number; toMs: number };
  /** The raids to choose from, already limited to those standing in this span. */
  raids: readonly RaidGroup[];
  /** The set the review is narrowed to now (a group key), so the chips start pressed. */
  active?: string | null;
  /** Small text after a raid's name (its hours, say). */
  detail?: (g: RaidGroup) => string;
}) {
  const [picked, setPicked] = useState<string[]>(() => groupIdsOf(active).filter(id => raids.some(g => g.id === id)));
  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  const key = groupKey(picked);
  return (
    <>
      {raids.map(g => {
        const on = picked.includes(g.id);
        return (
          <button key={g.id} type="button" aria-pressed={on} onClick={() => toggle(g.id)} className={`${chip} ${on ? chipOn : chipIdle}`}>
            {groupLabel(g)}{detail ? <span className={on ? 'opacity-80' : 'text-dim'}> · {detail(g)}</span> : null}
          </button>
        );
      })}
      {picked.length > 0
        ? <Link href={windowHref(fromMs, toMs, key, parent)} className={`${chip} ${chipIdle} inline-block`}>Show selected ({picked.length})</Link>
        : <span aria-disabled="true" className={`${chip} border-border text-dim opacity-60`}>Show selected (0)</span>}
    </>
  );
}
