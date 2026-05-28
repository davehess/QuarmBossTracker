// Per-night loot block. Renders items sorted by DKP descending so big-ticket
// pickups are at the top, then by item name.
import { fmtDkp } from '@/lib/format';

export type LootRow = {
  item_name: string;
  character_name: string;
  dkp: number;
  game_item_id: number | null;
  notes: string | null;
};

export default function LootBlock({ loot }: { loot: LootRow[] }) {
  if (loot.length === 0) return null;
  const sorted = [...loot].sort(
    (a, b) => b.dkp - a.dkp || a.item_name.localeCompare(b.item_name),
  );
  const totalDkp = sorted.reduce((s, l) => s + (l.dkp || 0), 0);

  return (
    <div className="bg-panel border border-border rounded-lg p-3">
      <div className="text-sm text-orange flex items-center gap-2 mb-2">
        <span aria-hidden>💰</span>
        <span>Loot</span>
        <span className="text-dim text-xs">
          · {sorted.length} item{sorted.length === 1 ? '' : 's'}
          {' · '}
          {totalDkp} DKP spent
        </span>
      </div>
      <ul className="text-xs grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-0.5">
        {sorted.map((l, i) => {
          const itemHref = l.game_item_id
            ? `https://www.pqdi.cc/item/${l.game_item_id}`
            : null;
          return (
            <li key={`${l.item_name}-${l.character_name}-${i}`} className="flex justify-between gap-2 border-b border-border/40 py-0.5">
              <span className="truncate">
                {itemHref ? (
                  <a href={itemHref} target="_blank" rel="noreferrer" className="text-text hover:text-blue hover:underline">
                    {l.item_name}
                  </a>
                ) : (
                  <span className="text-text">{l.item_name}</span>
                )}
                <span className="text-dim"> → </span>
                <span className="text-blue">{l.character_name}</span>
              </span>
              <span className="text-gold whitespace-nowrap">{fmtDkp(l.dkp)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
