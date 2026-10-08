// Essences of Power queue on /pop, in two layouts to pick from (beta: ?v=b and ?v=c):
//   b — by person: the queue in order, one row each, with the four pieces they hold.
//   c — by essence: four columns, each the order that essence goes out in, first one "next".
// Same data (./essencesData.ts, rules in web/lib/essencesQueue.ts); they differ only in which question
// they answer first — "who has what" (b) or "who gets this drop" (c).

import Link from 'next/link';
import { ESSENCES, type EssenceKey, type NextUp, type QueueEntry } from '@/lib/essencesQueue';

const ICON: Record<EssenceKey, string> = { fire: '🔥', wind: '💨', water: '💧', earth: '🪨' };
const SHORT: Record<EssenceKey, string> = { fire: 'Fire', wind: 'Wind', water: 'Water', earth: 'Earth' };

type Props = {
  layout: 'b' | 'c';
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

export default function EssencesQueue({ layout, demo, queue, done, next, classOf, raidLive }: Props) {
  const cls = (n: string) => classOf[n.toLowerCase()] ?? null;
  const header = (
    <div className="flex items-baseline gap-3 mb-1 flex-wrap">
      <h3 className="text-base text-orange">💠 Essences of Power — who is next</h3>
      <span className="text-xs text-dim">{queue.length} in the queue · {done.length} done{raidLive ? '' : ' · no raid on right now'}</span>
      {demo && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-orange/20 border border-orange/60 text-orange uppercase">Sample data — invented names</span>}
    </div>
  );

  if (layout === 'c') {
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

  return (
    <section className="bg-panel border border-border rounded-lg p-4">
      {header}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mb-3">
        <span className="text-dim">Next drop:</span>
        {next.map(n => (
          <span key={n.key} className="whitespace-nowrap">
            {ICON[n.key]} {SHORT[n.key]} → {n.bid ? <span className="text-gold">bid it</span> : <b className="text-gold">{n.name}</b>}
          </span>
        ))}
      </div>
      {queue.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-dim text-left border-b border-border">
                <th className="py-1 pr-2 font-normal">#</th>
                <th className="py-1 pr-2 font-normal">Character</th>
                {ESSENCES.map(x => <th key={x.key} className="py-1 px-1 font-normal text-center" title={`${x.name} (${x.god})`}>{ICON[x.key]}</th>)}
                <th className="py-1 pl-2 font-normal">Joined</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((e, i) => (
                <tr key={e.name} className="border-b border-border/50">
                  <td className="py-1 pr-2 text-dim">{i + 1}</td>
                  <td className="py-1 pr-2 text-text whitespace-nowrap">
                    {e.name}{cls(e.name) && <span className="text-dim"> · {cls(e.name)}</span>}
                    <Present e={e} raidLive={raidLive} />
                  </td>
                  {ESSENCES.map(x => {
                    const p = e.pieces[x.key];
                    const isNext = next.find(n => n.key === x.key)?.name === e.name;
                    return (
                      <td key={x.key} className="py-1 px-1 text-center"
                        title={p ? `${x.name}: ${p.source === 'opendkp' ? `OpenDKP${p.dkp ? `, ${p.dkp} DKP` : ', 0 DKP'}` : 'Mimic saw the loot'}${p.at ? ` · ${String(p.at).slice(0, 10)}` : ''}` : isNext ? `Next ${x.name} goes here` : `Needs ${x.name}`}>
                        {p ? <span className="text-green">✓</span> : isNext ? <span className="text-gold">next</span> : <span className="text-dim">·</span>}
                      </td>
                    );
                  })}
                  <td className="py-1 pl-2 text-dim whitespace-nowrap">
                    {e.joinedAt ? String(e.joinedAt).slice(0, 10) : '—'}{e.joinedDkp ? ` · ${e.joinedDkp} DKP` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty />}
      {done.length > 0 && <div className="text-xs text-dim mt-2">✓ Done: {done.map(e => e.name).join(', ')}</div>}
      <Rules />
    </section>
  );
}
