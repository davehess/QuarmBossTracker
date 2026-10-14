// "By stage": B's grouping (the guild lead, 2026-10-14), in the cards the /pop chart uses. One card per progression
// line that anybody advanced in the window, its steps in dependency order, each with who earned it (A-Z, "and N
// more" opens) and what relies on it. The order, the places and the "unlocks" lines are all derived from the step
// catalog in web/lib/popLatestView.ts. Server component; every fold is a native <details>.

import Link from 'next/link';
import { TIER_COLORS } from '@/lib/popFlags';
import { NAMES_SHOWN, type StageBoard as Board, type StageCard, type StageStep } from '@/lib/popLatestView';
import ExpandList from './ExpandList';

const charHref = (name: string) => `/character/${encodeURIComponent(name)}`;

function Step({ s, n }: { s: StageStep; n: number }) {
  const count = s.characters.length;
  const unlocks = [
    ...s.unlocks.steps.map(u => ({ key: `s:${u.key}`, text: u.label })),
    ...s.unlocks.zones.map(z => ({ key: `z:${z.key}`, text: `enter ${z.name}` })),
  ];
  return (
    <li className={count === 0 ? 'opacity-60' : ''}>
      <div className="text-xs flex items-baseline justify-between gap-2">
        <span className="text-dim">
          <span className="text-dim/60 tabular-nums">{n}. </span>
          <span className={count > 0 ? 'text-text' : ''}>{s.label}</span>
          {s.place && <span className="text-dim/60" title={s.place.name}> · {s.place.name}</span>}
        </span>
        <span className={`text-[11px] whitespace-nowrap ${count > 0 ? 'text-green' : 'text-dim'}`}>👤 {count}</span>
      </div>
      {count > 0 && (
        <div className="text-xs text-dim pl-4">
          <ExpandList items={s.characters.map(w => ({ key: w.name, node: <Link href={charHref(w.name)} className="hover:underline">{w.name}</Link> }))} limit={NAMES_SHOWN} />
        </div>
      )}
      {unlocks.length > 0 && (
        <div className="text-[10px] text-dim/80 pl-4 italic">
          unlocks → {unlocks.map((u, i) => <span key={u.key}>{i > 0 && ' · '}{u.text}</span>)}
        </div>
      )}
    </li>
  );
}

function Card({ card }: { card: StageCard }) {
  const color = card.tier > 0 ? TIER_COLORS[card.tier] : '#8b949e';
  return (
    <div className="bg-panel border border-border rounded-lg p-3 flex flex-col gap-2" style={{ borderTop: `3px solid ${color}` }}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm text-text font-semibold leading-tight">{card.label}</span>
        <span className="text-[11px] px-1.5 py-0.5 rounded border border-green/60 text-green whitespace-nowrap"
              title="Characters who earned a step on this line in the window">
          {card.raiders} {card.raiders === 1 ? 'raider' : 'raiders'}
        </span>
      </div>
      <ol className="space-y-2">
        {card.steps.map((s, i) => <Step key={s.key} s={s} n={i + 1} />)}
      </ol>
    </div>
  );
}

export default function StageBoard({ board }: { board: Board }) {
  return (
    <div className="space-y-3">
      {board.tiers.map(t => (
        <div key={t.tier} className="rounded-lg border border-border/60 p-3 pt-2" style={{ background: 'rgba(110,118,129,0.05)' }}>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-xs font-bold tracking-wide" style={{ color: TIER_COLORS[t.tier] }}>{t.name}</span>
            <span className="text-[10px] text-dim">{t.sub}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {t.cards.map(c => <Card key={c.key} card={c} />)}
          </div>
        </div>
      ))}
      {board.other && (
        <div className="rounded-lg border border-border/60 p-3 pt-2" style={{ background: 'rgba(110,118,129,0.05)' }}>
          <div className="text-xs font-bold tracking-wide text-dim mb-2">Not on a progression line</div>
          <div className="grid gap-3 sm:grid-cols-2"><Card card={board.other} /></div>
        </div>
      )}
    </div>
  );
}
