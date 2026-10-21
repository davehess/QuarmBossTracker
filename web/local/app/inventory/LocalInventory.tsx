'use client';

// Account inventory, built on this PC. The rows come from the agent on the same origin
// (GET /api/local/inventory, which reads the <Char>-Inventory.txt files EQ wrote) and go through the SAME
// aggregation and the SAME explorer as the website's /me/inventory. Nothing is uploaded anywhere.
import { useCallback, useEffect, useMemo, useState } from 'react';
import InventoryExplorer from '@/app/me/inventory/InventoryExplorer';
import { aggregateInventory, type InvRow, type ItemMeta } from '@/lib/inventoryAggregate';

type LocalInventoryResponse = {
  ok: boolean;
  characters: { name: string; observed_at: string | null; rows: number }[];
  rows: InvRow[];
  /** Item facts for the type chips. Empty until the agent has a catalog that carries them. */
  meta: ItemMeta[];
};

export default function LocalInventory() {
  const [data, setData] = useState<LocalInventoryResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/local/inventory', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`the agent answered ${r.status}`))))
      .then((j: LocalInventoryResponse) => { setData(j); setErr(null); })
      .catch((e: Error) => setErr(e.message || 'could not reach the agent'));
  }, []);

  // Load once, and again whenever the window regains focus: you run /outputfile inventory in game, tab
  // back, and the list is current without a reload.
  useEffect(() => {
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const agg = useMemo(() => {
    if (!data) return null;
    return aggregateInventory(data.rows, [], new Map(data.meta.map(m => [m.id, m])));
  }, [data]);

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <div className="flex items-start gap-3">
          <h2 className="text-2xl text-gold mb-1"><span aria-hidden>🎒 </span>My account inventory</h2>
          <button type="button" onClick={load}
            className="ml-auto text-[11px] px-2 py-0.5 rounded border border-border text-dim hover:text-text">
            Reload
          </button>
        </div>
        <div className="text-sm text-dim leading-6">
          Everything across <b className="text-text">all your characters</b> at once, with the total of each item and
          exactly who is holding it. Items in the <b className="text-purple">shared bank</b> are tagged and count{' '}
          <b className="text-text">once per game account</b>. Data comes from the{' '}
          <code>/outputfile inventory</code> files on this PC.
        </div>
        {data && agg && (
          <div className="mt-3 text-xs text-dim flex flex-wrap gap-x-6 gap-y-1">
            <span>Characters: <span className="text-text">{data.characters.length}</span></span>
            <span>Inventory rows: <span className="text-text">{data.rows.length.toLocaleString()}</span></span>
            <span>Distinct items: <span className="text-text">{agg.items.length.toLocaleString()}</span></span>
            {agg.sharedAccountCount > 0 && (
              <span>Shared banks: <span className="text-text">{agg.sharedAccountCount} account{agg.sharedAccountCount === 1 ? '' : 's'}</span></span>
            )}
          </div>
        )}
      </section>

      {err && !data ? (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
          Could not read your inventory from Mimic ({err}). Open this page from Mimic&apos;s dashboard, with the agent running.
        </section>
      ) : !data || !agg ? (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">Reading your inventory files…</section>
      ) : agg.items.length === 0 ? (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
          No inventory files found yet. In EQ run <code className="text-text">/outputfile inventory</code> on each
          character; the <code className="text-text">&lt;Char&gt;-Inventory.txt</code> file it writes lands in your EverQuest
          folder and shows up here.
        </section>
      ) : (
        <InventoryExplorer
          items={agg.items}
          characters={data.characters.map(c => ({ name: c.name, cls: null, active: true }))}
        />
      )}
    </div>
  );
}
