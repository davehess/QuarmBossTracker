'use client';

// The Soft Reserve pick list: each target boss with its drops, a star to pick or drop an item. The tap shows at once
// (optimistic) and the server has the last word: if it refuses (a cap, a lock, a race) the tap is undone and the
// reason shown. Caps are checked here only to save a round trip; lib/softReserve.ts checkAdd on the server is the rule.
import { useState, useTransition } from 'react';
import ItemIcon from '@/app/character/[name]/inventory/ItemIcon';
import type { SrBoss } from '@/lib/softReserveLoad';
import { setPick } from './actions';

const pct = (n: number | null) => n == null ? '' : n >= 99.95 ? 'always' : `${Number(n.toFixed(1))}%`;
const key = (npc: number, item: number) => `${npc}:${item}`;

export default function SrPicker({ bosses, initialMine, perPerson, perBoss, canPick, closedNote }: {
  bosses: SrBoss[];
  initialMine: { npc_id: number; item_id: number }[];
  perPerson: number;
  perBoss: number | null;
  /** False when picks are locked, SR is off or there is no character to pick for. */
  canPick: boolean;
  closedNote: string | null;
}) {
  const [mine, setMine] = useState<Set<string>>(() => new Set(initialMine.map(p => key(p.npc_id, p.item_id))));
  const [adj, setAdj] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  const usedAt = (npc: number) => [...mine].filter(k => k.startsWith(`${npc}:`)).length;

  function toggle(npc: number, item: number) {
    const k = key(npc, item);
    const on = !mine.has(k);
    setMsg(null);
    if (on && mine.size >= perPerson) { setMsg(`You have used all ${perPerson} of your picks. Drop one to pick another.`); return; }
    if (on && perBoss != null && usedAt(npc) >= perBoss) { setMsg(`You can pick ${perBoss} from this boss. Drop one to pick another.`); return; }
    const apply = (to: boolean) => {
      setMine(prev => { const n = new Set(prev); if (to) n.add(k); else n.delete(k); return n; });
      setAdj(prev => ({ ...prev, [k]: (prev[k] ?? 0) + (to ? 1 : -1) }));
    };
    apply(on);
    setBusy(k);
    start(async () => {
      const res = await setPick(npc, item, on);
      if (!res.ok) { apply(!on); setMsg(res.message); }
      setBusy(null);
    });
  }

  return (
    <div>
      <p className="text-sm text-text" aria-live="polite">
        <b className="text-gold">{mine.size}</b> of {perPerson} picks used{perBoss != null && <span className="text-dim"> · up to {perBoss} per boss</span>}
      </p>
      {closedNote && <p className="mt-1 text-xs text-orange">{closedNote}</p>}
      {msg && <p role="alert" className="mt-1 text-xs text-red">{msg}</p>}

      {bosses.map(b => (
        <section key={b.npc} className="mt-4 rounded-lg border border-border bg-panel p-3" aria-label={b.name}>
          <h2 className="text-sm font-semibold text-text">
            {b.name}
            <span className="ml-2 text-xs font-normal text-dim">{usedAt(b.npc)} picked</span>
          </h2>
          {b.items.length === 0 ? (
            <p className="mt-1 text-xs text-dim">Drop table not loaded for this boss.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border/60">
              {b.items.map(it => {
                const k = key(b.npc, it.item_id);
                const on = mine.has(k);
                const count = it.count == null ? null : Math.max(0, it.count + (adj[k] ?? 0));
                return (
                  <li key={it.item_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                    <ItemIcon icon={it.icon} alt={it.name} size={28} className="shrink-0 rounded-sm border border-border/60" />
                    <div className="min-w-0 flex-1">
                      <a href={`https://www.pqdi.cc/item/${it.item_id}`} target="_blank" rel="noreferrer" className="text-sm text-blue hover:underline">{it.name}</a>
                      <span className="text-xs text-dim"> {pct(it.chance)}</span>
                      {it.names && it.names.length > 0 && (
                        <div className="text-[11px] text-dim">Reserved by {it.names.join(', ')}</div>
                      )}
                    </div>
                    {count != null && <span className="text-xs text-dim" title="How many have reserved this">{count} reserved</span>}
                    <button
                      type="button"
                      onClick={() => toggle(b.npc, it.item_id)}
                      disabled={!canPick || busy === k}
                      aria-pressed={on}
                      aria-label={`${on ? 'Drop' : 'Reserve'} ${it.name}`}
                      className={`min-h-[36px] min-w-[84px] rounded border px-2 text-xs ${on ? 'border-gold bg-gold/10 text-gold' : 'border-border text-dim hover:text-text'} disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      {on ? '⭐ Reserved' : 'Reserve'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
