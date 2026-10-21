// The Essences of Power card, minimized, for the /pop sidebar previews (?v=b / ?v=c; the guild lead, 2026-10-21:
// "the essences of power should be minimized and under the elementals section"). One line says what the card
// would: how many are queued and who gets the next drop ("bid it" when nobody is in line). It opens to the same
// four-column card the page has always had (EssencesQueue), unchanged.

import EssencesQueue from './EssencesQueue';
import OpenOnHash from './OpenOnHash';
import { ESSENCES_ANCHOR, dropGroups } from '@/lib/popSidebar';
import type { NextUp, QueueEntry } from '@/lib/essencesQueue';

type Props = {
  demo?: boolean;
  queue: QueueEntry[]; done: QueueEntry[]; next: NextUp[];
  classOf: Record<string, string | null>; raidLive: boolean;
};

export default function EssencesFold({ demo, ...q }: Props) {
  const groups = dropGroups(q.next);
  return (
    <details id={ESSENCES_ANCHOR} className="group mt-4 bg-panel border border-border rounded-lg scroll-mt-32">
      <summary className="cursor-pointer select-none px-4 py-2.5 text-xs flex flex-wrap items-baseline gap-x-2 gap-y-1 hover:bg-white/5 rounded-lg">
        <span className="text-orange">💠 Essences of Power</span>
        <span className="text-dim">· {q.queue.length} queued · next drop:</span>
        {groups.map((g, i) => (
          <span key={i} className={g.who ? 'text-text' : 'text-gold'}>
            {i > 0 && <span className="text-dim">· </span>}
            {g.who ? <>{g.icons} <b>{g.who}</b></> : groups.length === 1 ? 'bid it' : <>{g.icons} bid it</>}
          </span>
        ))}
        {demo && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-orange/20 border border-orange/60 text-orange uppercase">Sample data</span>}
        <span className="ml-auto text-blue group-open:hidden">show the queue</span>
        <span className="ml-auto text-dim hidden group-open:inline">hide</span>
      </summary>
      <EssencesQueue demo={demo} {...q} bare />
      <OpenOnHash id={ESSENCES_ANCHOR} />
    </details>
  );
}
