// The gear page's "Sets from what you own": three automatic sets (most mitigation, most damage or mana, best resists)
// built from the bags, the bank and what is worn, each compared with what is worn now, and the try-on under them.
// The same rule as UpgradeCheck: the gear page decides WHO sees this (the character's owner only, never an opted-out
// character); this component only draws what it is handed. The maths is web/lib/gearSets.ts.
import Link from 'next/link';
import ItemIcon from '../inventory/ItemIcon';
import { capNote, deltaText, type SetCard, type SetsResult, type Where } from '@/lib/gearSets';
import TryOn from './TryOn';

const WHERE_TEXT: Record<Where, string> = { worn: 'worn', bag: 'in your bags', bank: 'in the bank' };
const slotName = (s: string) => s.replace(/(\d)$/, ' $1');

export default function GearSets({ name, sets, initialTry }: { name: string; sets: SetsResult; initialTry: string }) {
  const hasBank = sets.cards.some(c => c.swaps.some(s => s.where === 'bank'));

  return (
    <section className="bg-panel border border-border rounded-lg p-4 space-y-3" aria-label={`Sets built from what ${name} owns`}>
      <div>
        <h3 className="text-sm text-orange mb-1">🧩 Sets from what you own</h3>
        <p className="text-xs text-dim">
          Only you see this. Built from your bags, your bank and what you wear, for a {sets.base}: the best piece per slot for each goal,
          with every stat judged against its cap. It is a starting point, not a perfect answer.
          {hasBank && ' Anything marked bank means a trip to the bank first.'}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {sets.cards.map(c => <Card key={c.id} card={c} />)}
      </div>

      <TryOn data={sets.tryOn} initial={initialTry} />
    </section>
  );
}

function Card({ card }: { card: SetCard }) {
  const head = card.deltas.filter(d => d.raw !== 0);
  const notes = card.deltas.map(capNote).filter((x): x is string => !!x);
  return (
    <div className="border border-border rounded p-3 min-w-0">
      <h4 className="text-sm text-text font-bold">{card.title}</h4>
      <p className="text-[11px] text-dim mb-2">{card.blurb}</p>
      {card.swaps.length === 0 ? (
        <p className="text-xs text-green">Nothing to swap: what you wear already wins.</p>
      ) : (
        <>
          <p className="text-sm text-green mb-2 break-words">
            {head.length > 0 ? head.map(deltaText).join(' · ') : 'No change in the stats this set weighs'}
          </p>
          <ul className="space-y-1.5 text-xs">
            {card.swaps.map(s => (
              <li key={s.slot} className="break-words">
                <span className="text-dim">{slotName(s.slot)} →</span>{' '}
                <span className="inline-flex items-center gap-1 align-middle">
                  <ItemIcon icon={s.to.icon ?? null} alt={s.to.name ?? `Item #${s.to.id}`} size={18} />
                  <Link href={`/db/item/${s.to.id}`} className="text-blue hover:underline">{s.to.name ?? `Item #${s.to.id}`}</Link>
                </span>{' '}
                <span className={s.where === 'bank' ? 'text-orange' : 'text-dim'}>
                  ({WHERE_TEXT[s.where]}{s.where === 'worn' && s.movedFrom ? `, from ${slotName(s.movedFrom)}` : ''})
                </span>
                {s.from && <div className="text-[11px] text-dim">replaces {s.from.name ?? `Item #${s.from.id}`}</div>}
              </li>
            ))}
          </ul>
          {notes.length > 0 && <p className="text-[11px] text-orange mt-2">{notes.join(' · ')}</p>}
        </>
      )}
    </div>
  );
}
