// Server-rendered loadouts page. Queries the bot's Supabase for any
// character_inventories the agents have uploaded, joins each slot against
// eqemu_items + eqemu_spells via the item_with_proc view.
//
// Currently a read-only stub — uploads from the agent aren't wired into
// Supabase yet (the agent stores inventories locally). Next steps:
//   1. Add /api/agent/inventory endpoint on the bot (POST from agent)
//   2. Insert into a new supabase table `character_inventories`
//   3. Re-query here for the cross-guild view
//
// For now we render a placeholder showing the SHAPE of the data so the
// page structure is reviewable end-to-end.
import { supabase } from '@/lib/supabase';

// Sample query to validate the table chain — once inventories are uploading
// this becomes the real source. For now it returns the schema-confirming
// view we just added.
async function loadItemSamples() {
  const { data, error } = await supabase
    .from('item_with_proc')
    .select('item_id, item_name, damage, delay, proc_spell_name, proc_hate_hint')
    .not('proc_spell_id', 'is', null)
    .limit(20);
  if (error) return { samples: [], error: error.message };
  return { samples: data || [], error: null };
}

export const dynamic = 'force-dynamic';

export default async function LoadoutsPage() {
  const { samples, error } = await loadItemSamples();
  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-3">🗡️ Guild Loadouts</h2>
        <p className="text-sm text-dim mb-4">
          Every tank's currently-equipped bandolier set, plus their saved alternates.
          Click a weapon to open its PQDI page.
        </p>
        <p className="text-sm text-orange">
          Coming online once the agent starts uploading inventories to Supabase. Until
          then this page validates the data layer with a sample query against{' '}
          <code>item_with_proc</code>.
        </p>
      </section>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h3 className="text-sm text-gold mb-3 uppercase tracking-wide">Schema check — top 20 procced items</h3>
        {error && <div className="text-red text-sm">DB error: {error}</div>}
        {!error && samples.length === 0 && (
          <div className="text-dim text-sm">
            No items with proc_effect found in <code>eqemu_items</code>. Either the
            table isn't synced yet or the migration was just applied. Run the EQEmu
            sync once before this page becomes useful.
          </div>
        )}
        {samples.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-dim text-xs uppercase">
              <tr>
                <th className="text-left py-1">Item</th>
                <th className="text-right py-1">DMG</th>
                <th className="text-right py-1">Delay</th>
                <th className="text-left py-1 pl-4">Proc</th>
                <th className="text-right py-1">Hate hint</th>
              </tr>
            </thead>
            <tbody>
              {samples.map((s: any) => (
                <tr key={s.item_id} className="border-t border-border hover:bg-[#1f242c]">
                  <td className="py-1">
                    <a href={`https://www.pqdi.cc/item/${s.item_id}`} target="_blank" rel="noreferrer">
                      {s.item_name}
                    </a>
                  </td>
                  <td className="text-right">{s.damage ?? '—'}</td>
                  <td className="text-right">{s.delay ?? '—'}</td>
                  <td className="pl-4">{s.proc_spell_name ?? <span className="text-dim">—</span>}</td>
                  <td className="text-right">{s.proc_hate_hint ?? <span className="text-dim">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
