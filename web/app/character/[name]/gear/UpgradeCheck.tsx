// The gear page's upgrade check: per worn slot, the best swap in the current era and what it is worth, and where the
// worn set stands against the game's caps (ATK 250, Flowing Thought, HP regen, AC, stats). The same evaluation as
// /me/upgrades (web/lib/gearUpgradesRun.ts), read-only: no wishlist, no bids, nothing the finder page does not show
// its owner. The gear page decides WHO sees this (the character's owner only, and never an opted-out character); this
// component only draws what it is handed. Each slot links to its card on the finder.
import Link from 'next/link';
import ItemIcon from '../inventory/ItemIcon';
import { resolveWeights, capRows, capRowText, sourceLine, type ItemStats } from '@/lib/gearUpgrades';
import type { UpgradeEval } from '@/lib/gearUpgradesRun';
import { STAT_KEYS } from '@/lib/gearWeights';

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

export default function UpgradeCheck({ name, ev }: { name: string; ev: UpgradeEval }) {
  const weights = resolveWeights(ev.base, ev.equipped.map(e => e.item));
  const keys = STAT_KEYS.filter(k => weights[k] > 0);
  const caps = ev.capNow.filter(r => keys.includes(r.key));
  const enc = encodeURIComponent(name);
  const rows = ev.perSlot.filter(p => p.r.current);
  const label = (it: ItemStats) => it.name ?? `Item #${it.id}`;

  return (
    <section className="bg-panel border border-border rounded-lg p-4">
      <h3 className="text-sm text-orange mb-1 flex items-center gap-2">
        <span>⬆ Upgrade check</span>
        <Link href={`/me/upgrades?c=${enc}`} className="text-[11px] text-blue hover:underline font-normal">open the full finder →</Link>
      </h3>
      <p className="text-xs text-dim mb-3">
        Only you see this. Each slot&apos;s best swap that exists in the current era, scored for a {ev.base}, against the game&apos;s caps.
      </p>

      {caps.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs mb-3">
          {caps.map(r => {
            const full = r.kind === 'sum' && r.cap != null && r.have >= r.cap;
            const text = r.kind === 'max' ? `${r.label} ${r.have}%`
              : r.kind === 'soft' ? `${r.label} ${r.have} / soft cap ${r.cap}`
              : `${r.label} ${r.have} / ${r.cap}`;
            return <li key={r.key} title={r.detail ?? undefined} className={full ? 'text-green' : 'text-text'}>{text}{full ? ' ✓' : ''}</li>;
          })}
        </ul>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-dim text-xs uppercase">
            <tr>
              <th className="text-left py-1">Slot</th>
              <th className="text-left py-1">Wearing</th>
              <th className="text-left py-1 pl-4">Best upgrade</th>
              <th className="text-right py-1 pl-4">Gain</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, top }) => {
              const best = top[0];
              const it = best ? (ev.finalistItems.get(best.item.id) ?? best.item) : null;
              const cap = best ? capRows(it!, r.current, ev.equipped.filter(e => e.slot !== r.slot).map(e => e.item), ev.caps).slice(0, 3).map(capRowText) : [];
              return (
                <tr key={r.slot} className="border-t border-border align-top">
                  <td className="py-1 text-dim">
                    <Link href={`/me/upgrades?c=${enc}#${r.slot}`} className="text-blue hover:underline">{r.slot.replace(/(\d)$/, ' $1')}</Link>
                  </td>
                  <td className="py-1">
                    <span className="inline-flex items-center gap-1.5">
                      <ItemIcon icon={r.current!.icon} alt={label(r.current!)} size={20} />
                      <span className="text-text">{label(r.current!)}</span>
                    </span>
                  </td>
                  <td className="py-1 pl-4">
                    {best && it ? (
                      <div>
                        <span className="inline-flex items-center gap-1.5">
                          <ItemIcon icon={it.icon} alt={label(it)} size={20} />
                          <Link href={`/db/item/${it.id}`} className="text-blue hover:underline">{label(it)}</Link>
                        </span>
                        <div className="text-[11px] text-dim">{sourceLine(best.best)}</div>
                        {cap.length > 0 && <div className="text-[11px] text-dim">{cap.join(' · ')}</div>}
                      </div>
                    ) : <span className="text-dim">{r.candidates.length > 0 ? 'none with a known source' : '—'}</span>}
                  </td>
                  <td className="py-1 pl-4 text-right text-green">{best ? `+${fmt(best.gain)}` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-dim mt-2">
        Gain is the finder&apos;s score for a {ev.base}; stats count only for the part that lands under their cap.
        {!ev.altOk && ' Quest and crafted sources could not be read just now.'}
      </p>
    </section>
  );
}
