// /admin/quests — officer admin for the quest_catalog + quest_required_item
// tables. CRUD only; no fancy UI. Each quest is a card with its required
// items inline and an "add item" form at the bottom.

import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { createQuest, addRequiredItem, deleteQuest, deleteItem, toggleActive } from './actions';

export const dynamic = 'force-dynamic';

type Quest = {
  id: number; name: string; category: string | null; zone: string | null;
  pqdi_quest_url: string | null; notes: string | null; display_order: number;
  active: boolean; is_stack_turnin: boolean;
  reward_item_id: number | null; reward_item_name: string | null;
};
type Item = { id: number; quest_id: number; item_id: number | null; item_name: string; quantity: number; optional: boolean; display_order: number; notes: string | null };

export default async function AdminQuestsPage() {
  const sb = supabaseAdmin();
  const [{ data: quests }, { data: items }] = await Promise.all([
    sb.from('quest_catalog').select('*').eq('guild_id', 'wolfpack').order('display_order'),
    sb.from('quest_required_item').select('*').order('display_order'),
  ]);
  const itemsByQuest = new Map<number, Item[]>();
  for (const it of ((items ?? []) as Item[])) {
    const list = itemsByQuest.get(it.quest_id) ?? [];
    list.push(it);
    itemsByQuest.set(it.quest_id, list);
  }

  return (
    <div className="space-y-6">
      <div className="text-sm"><Link href="/admin" className="text-blue hover:underline">← back to admin</Link></div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">📋 Quest catalog</h2>
        <p className="text-sm text-dim leading-6">
          Drives the per-character quest tracker on{' '}
          <code>/character/[name]/quests</code> and the rollup on{' '}
          <code>/me/quests</code>. Add a quest, then add the required items
          (use the same item names the inventory file uses; item ids
          auto-resolve later).
        </p>
      </section>

      {/* New quest form */}
      <section className="bg-panel border border-border rounded-lg">
        <h3 className="text-sm text-orange px-4 py-3 border-b border-border">+ Add quest</h3>
        <form action={createQuest} className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <label className="flex flex-col gap-1">
            Name *
            <input name="name" required className="bg-bg border border-border rounded px-2 py-1 text-text" />
          </label>
          <label className="flex flex-col gap-1">
            Category
            <select name="category" className="bg-bg border border-border rounded px-2 py-1 text-text">
              <option value="">—</option>
              <option value="key">key</option>
              <option value="armor">armor</option>
              <option value="epic">epic</option>
              <option value="stack-turnin">stack-turnin</option>
              <option value="other">other</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Zone
            <input name="zone" className="bg-bg border border-border rounded px-2 py-1 text-text" />
          </label>
          <label className="flex flex-col gap-1">
            PQDI quest URL
            <input name="pqdi_quest_url" placeholder="https://www.pqdi.cc/quest/12345" className="bg-bg border border-border rounded px-2 py-1 text-text" />
          </label>
          <label className="flex flex-col gap-1">
            Reward item name (used to detect "completed")
            <input name="reward_item_name" className="bg-bg border border-border rounded px-2 py-1 text-text" />
          </label>
          <label className="flex flex-col gap-1">
            Display order
            <input name="display_order" type="number" defaultValue={100} className="bg-bg border border-border rounded px-2 py-1 text-text w-24" />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            Notes
            <textarea name="notes" className="bg-bg border border-border rounded px-2 py-1 text-text min-h-[3rem]" />
          </label>
          <label className="flex items-center gap-2 text-text">
            <input type="checkbox" name="is_stack_turnin" /> Stack turn-in (shows on the table view)
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="px-3 py-1.5 rounded border border-blue bg-[#1f6feb] text-white">Create quest</button>
          </div>
        </form>
      </section>

      {/* List of quests */}
      <section className="space-y-4">
        {((quests ?? []) as Quest[]).map(q => {
          const reqs = itemsByQuest.get(q.id) ?? [];
          return (
            <div key={q.id} className={`bg-panel border border-border rounded-lg p-4 ${q.active ? '' : 'opacity-60'}`}>
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <div>
                  <span className="text-text font-medium">{q.name}</span>
                  {q.category && <span className="text-dim text-xs ml-2">[{q.category}]</span>}
                  {q.zone && <span className="text-dim text-xs ml-2">· {q.zone}</span>}
                  {q.is_stack_turnin && <span className="text-orange text-[10px] ml-2 uppercase">stack</span>}
                  {!q.active && <span className="text-red text-[10px] ml-2 uppercase">inactive</span>}
                  {q.pqdi_quest_url && (
                    <a href={q.pqdi_quest_url} target="_blank" rel="noreferrer" className="ml-2 text-blue text-[10px] hover:underline">
                      PQDI ↗
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <form action={toggleActive}>
                    <input type="hidden" name="id" value={q.id} />
                    <button type="submit" className="px-2 py-1 rounded border border-border text-dim text-[10px] hover:border-orange hover:text-orange">
                      {q.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </form>
                  <form action={deleteQuest}>
                    <input type="hidden" name="id" value={q.id} />
                    <button type="submit" className="px-2 py-1 rounded border border-border text-dim text-[10px] hover:border-red hover:text-red">Delete</button>
                  </form>
                </div>
              </div>
              {q.notes && <p className="text-[11px] text-dim italic mt-1">{q.notes}</p>}
              {q.reward_item_name && (
                <p className="text-[11px] text-dim mt-1">Reward item: <span className="text-text">{q.reward_item_name}</span></p>
              )}
              <ul className="mt-2 text-xs space-y-1">
                {reqs.map(it => (
                  <li key={it.id} className="flex items-center gap-2">
                    <span className="text-dim w-6">{it.display_order}</span>
                    <span className="text-text flex-1">
                      {it.item_name}{it.quantity > 1 ? <> × {it.quantity}</> : null}
                      {it.optional && <span className="text-dim/70"> (optional)</span>}
                      {it.notes && <span className="text-dim/60 italic"> — {it.notes}</span>}
                    </span>
                    <form action={deleteItem}>
                      <input type="hidden" name="id" value={it.id} />
                      <button type="submit" className="text-dim text-[10px] hover:text-red" title="Remove this item">✕</button>
                    </form>
                  </li>
                ))}
              </ul>
              <form action={addRequiredItem} className="mt-2 flex flex-wrap items-end gap-2 text-xs border-t border-border/40 pt-2">
                <input type="hidden" name="quest_id" value={q.id} />
                <label className="flex flex-col gap-0.5">
                  Item name
                  <input name="item_name" required className="bg-bg border border-border rounded px-2 py-1 text-text w-48" />
                </label>
                <label className="flex flex-col gap-0.5">
                  Qty
                  <input name="quantity" type="number" defaultValue={1} min={1} className="bg-bg border border-border rounded px-2 py-1 text-text w-16" />
                </label>
                <label className="flex flex-col gap-0.5">
                  Order
                  <input name="display_order" type="number" defaultValue={100} className="bg-bg border border-border rounded px-2 py-1 text-text w-16" />
                </label>
                <label className="flex flex-col gap-0.5">
                  Notes
                  <input name="notes" placeholder="optional" className="bg-bg border border-border rounded px-2 py-1 text-text w-56" />
                </label>
                <label className="flex items-center gap-1 text-dim self-end">
                  <input type="checkbox" name="optional" /> optional
                </label>
                <button type="submit" className="px-2 py-1 rounded border border-blue bg-[#1f6feb] text-white">+ Item</button>
              </form>
            </div>
          );
        })}
        {(quests ?? []).length === 0 && (
          <div className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
            No quests yet — use the form above.
          </div>
        )}
      </section>
    </div>
  );
}
