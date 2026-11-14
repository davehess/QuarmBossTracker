'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import BlockersStrip, { AllSet } from './BlockersStrip';
import type { BlockersView } from '@/lib/popTonightBlockersView';

export type MineRow = { name: string; cls: string; needs: { zone: string; missing: string[] }[] };
const KEY = 'pop-tonight-tab';

// B: one page, two tabs, one shared header. The tab you used last is the one you get.
export default function VersionB({ view, mine }: { view: BlockersView; mine: MineRow[] }) {
  const [tab, setTab] = useState<'raid' | 'mine'>('raid');
  useEffect(() => {
    try { if (localStorage.getItem(KEY) === 'mine') setTab('mine'); } catch { /* no storage: stay on Raid */ }
  }, []);
  const pick = (t: 'raid' | 'mine') => { setTab(t); try { localStorage.setItem(KEY, t); } catch { /* ignore */ } };
  const n = view.blockedPeople;
  const tabCls = (t: string) => `min-h-[40px] flex-1 rounded border px-3 py-2 text-sm font-semibold ${tab === t ? 'border-accent bg-accent/20 text-text' : 'border-border text-text hover:bg-panel'}`;
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <header className="rounded-lg border border-border bg-panel p-3">
        <h2 className="text-sm font-semibold text-text">Tonight: {view.zones.map((z) => z.zone).join(' · ')}</h2>
        <p className={`mt-1 text-xl font-semibold ${n ? 'text-red' : 'text-green'}`}>
          {n ? `${n} of ${view.raiders} cannot enter every target` : 'Everyone can enter all targets'}
        </p>
      </header>
      <div role="tablist" className="flex gap-2">
        <button role="tab" aria-selected={tab === 'raid'} className={tabCls('raid')} onClick={() => pick('raid')}>Raid</button>
        <button role="tab" aria-selected={tab === 'mine'} className={tabCls('mine')} onClick={() => pick('mine')}>Mine</button>
      </div>
      {tab === 'raid' ? (
        <div className="space-y-3">
          <BlockersStrip view={view} headline={false} />
          <div className="rounded-lg border border-border bg-panel p-3">
            <h3 className="text-sm font-semibold text-text">The plan</h3>
            <ol className="mt-2 space-y-2 text-sm text-text">
              {view.zones.map((z, i) => (
                <li key={z.id}><b>{i + 1}. {z.zone}</b>{z.how ? <> {z.how}</> : null}</li>
              ))}
            </ol>
          </div>
        </div>
      ) : (
        <div id="mine" className="space-y-2">
          {mine.map((c) => (
            <div key={c.name} className="rounded-lg border border-border bg-panel p-3">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="text-sm font-semibold text-text">{c.name} <span className="font-normal text-dim">{c.cls}</span></h3>
                {c.needs.length === 0 && <AllSet />}
              </div>
              {c.needs.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {c.needs.map((x) => (
                    <li key={x.zone}><b className="text-red">{x.zone}</b> <span className="text-text">needs {x.missing.join(' + ')}</span></li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <p className="text-sm"><Link href="/pop/raid/me" className="text-blue hover:underline">Open the full list of steps</Link></p>
        </div>
      )}
    </div>
  );
}
