// Essences of Power queue on /pop, laid out by essence (the guild lead picked "By essence" on the Decision
// Desk, 2026-10-19; DECISIONS §96, §383): four columns, each the order that essence goes out in, first one
// "next". It answers "who gets this drop" first. Data: ./essencesData.ts, rules in web/lib/essencesQueue.ts.

import Link from 'next/link';
import { ESSENCES, type EssenceKey, type NextUp, type QueueEntry } from '@/lib/essencesQueue';

const ICON: Record<EssenceKey, string> = { fire: '🔥', wind: '💨', water: '💧', earth: '🪨' };

type Props = {
  demo?: boolean;   // &demo=1: invented sample data, labelled on the card
  queue: QueueEntry[]; done: QueueEntry[]; next: NextUp[];
  classOf: Record<string, string | null>; raidLive: boolean;
};

function Present({ e, raidLive }: { e: QueueEntry; raidLive: boolean }) {
  if (!raidLive) return null;
  return e.present
    ? <span className="text-green text-[10px] ml-1" title="In the raid now (live roster)">● in raid</span>
    : <span className="text-dim text-[10px] ml-1" title="Not in the live raid roster">○ not here</span>;
}

function Rules() {
  return (
    <details className="text-xs text-dim mt-3">
      <summary className="cursor-pointer">How the queue works</summary>
      <ol className="list-decimal ml-5 mt-1 space-y-0.5 leading-5">
        <li>One OpenDKP bid buys the whole set. Winning it puts you in the queue, in the order you won.</li>
        <li>When an essence drops, it goes to the first person in the queue who does not have that one yet and is in the raid.</li>
        <li>Nobody like that there? Bid it again. The winner loots it and joins the end of the queue.</li>
        <li>Four pieces and you are done. Combine them for Power of the Planes (the <Link href="/pop/guide" className="text-blue">checklist</Link> has the quest).</li>
      </ol>
      <p className="mt-1 leading-5">
        Read from OpenDKP: every award of an essence, or of “Essences of Power”, in the order they were given; an award with DKP is a
        bid won, 0 DKP a queued hand-out. Mimic seeing someone loot an essence fills in a piece too. “In raid” is the live raid roster.
      </p>
    </details>
  );
}

function Empty() {
  return (
    <p className="text-sm text-dim">
      Nobody yet. The first essence that drops is bid for the whole set, and the winner starts the queue.
    </p>
  );
}

export default function EssencesQueue({ demo, queue, done, next, classOf, raidLive }: Props) {
  const cls = (n: string) => classOf[n.toLowerCase()] ?? null;
  const header = (
    <div className="flex items-baseline gap-3 mb-1 flex-wrap">
      <h3 className="text-base text-orange">💠 Essences of Power — who is next</h3>
      <span className="text-xs text-dim">{queue.length} in the queue · {done.length} done{raidLive ? '' : ' · no raid on right now'}</span>
      {demo && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-orange/20 border border-orange/60 text-orange uppercase">Sample data — invented names</span>}
    </div>
  );

  return (
    <section className="bg-panel border border-border rounded-lg p-4">
      {header}
      <p className="text-xs text-dim mb-3">When one drops, it goes to the first name in its column{raidLive ? ' who is in the raid' : ''}. An empty column means bid it.</p>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {ESSENCES.map(ess => {
          const n = next.find(x => x.key === ess.key)!;
          const waiting = queue.filter(e => !e.pieces[ess.key]);
          return (
            <div key={ess.key} className="border border-border rounded p-2">
              <div className="text-sm text-text">{ICON[ess.key]} {ess.name}</div>
              <div className="text-[10px] text-dim mb-2">{ess.god} · 40% a kill</div>
              <div className="text-xs mb-1">
                {n.bid
                  ? <span className="text-gold">Next drop: bid it</span>
                  : <>Next: <b className="text-gold">{n.name}</b></>}
              </div>
              <ol className="text-xs space-y-0.5">
                {waiting.map((e, i) => (
                  <li key={e.name} className={e.name === n.name ? 'text-gold' : 'text-text'}>
                    <span className="text-dim mr-1">{i + 1}.</span>{e.name}
                    {cls(e.name) && <span className="text-dim"> · {cls(e.name)}</span>}
                    <Present e={e} raidLive={raidLive} />
                  </li>
                ))}
                {!waiting.length && <li className="text-dim">nobody waiting</li>}
              </ol>
            </div>
          );
        })}
      </div>
      {queue.length > 0 && (
        <div className="text-xs text-dim mt-3 leading-5">
          <b className="text-text">Pieces held:</b>{' '}
          {queue.map(e => (
            <span key={e.name} className="mr-3 whitespace-nowrap">
              {e.name} {ESSENCES.map(x => e.pieces[x.key] ? ICON[x.key] : '·').join('')}
            </span>
          ))}
        </div>
      )}
      {done.length > 0 && <div className="text-xs text-dim mt-1">✓ Done: {done.map(e => e.name).join(', ')}</div>}
      {!queue.length && !done.length && <div className="mt-3"><Empty /></div>}
      <Rules />
    </section>
  );
}
