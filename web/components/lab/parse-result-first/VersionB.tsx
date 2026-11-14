'use client';
import { useEffect, useState } from 'react';
import type { ResultView } from '@/lib/parseResultFirstView';
import { CARD, ContributorsPanel, Fold, PANELS, ResultStrip, YouLine, type PanelKey } from './shared';

// B: one panel at a time under a sticky tab row. The last tab is remembered in this browser only.
const KEY = 'wp-parse-tab';
const TABS = PANELS.filter((p) => p.key !== 'contributors');

export default function VersionB({ v, linkNames }: { v: ResultView; linkNames?: boolean }) {
  const [tab, setTab] = useState<PanelKey>('damage');
  useEffect(() => {
    try { const s = localStorage.getItem(KEY); if (s && TABS.some((t) => t.key === s)) setTab(s as PanelKey); } catch { /* private window: stay on Damage */ }
  }, []);
  const pick = (k: PanelKey) => { setTab(k); try { localStorage.setItem(KEY, k); } catch { /* not remembered */ } };
  const cur = TABS.find((t) => t.key === tab) ?? TABS[0];
  const count = (k: PanelKey) => (k === 'deaths' ? v.deaths.length : k === 'loot' ? v.loot.length : null);
  return (
    <div className="space-y-4">
      <ResultStrip v={v} />
      <YouLine v={v} />
      <div className="sticky top-0 z-10 -mx-1 bg-bg px-1 pb-1 pt-1">
        <div role="tablist" aria-label="Fight detail" className="grid grid-cols-3 overflow-hidden rounded-lg sm:flex border border-border bg-panel">
          {TABS.map((t) => {
            const on = t.key === cur.key;
            const n = count(t.key);
            return (
              <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => pick(t.key)}
                className={`min-h-[44px] border-b-2 px-2 text-sm sm:flex-1 sm:px-4 ${on ? 'border-blue font-bold text-text' : 'border-transparent text-text hover:bg-bg'}`}>
                {t.label}
                {n != null ? <span className={`ml-1.5 text-xs ${t.key === 'deaths' && n > 0 ? 'text-red' : 'text-dim'}`}>{n}</span> : null}
              </button>
            );
          })}
        </div>
      </div>
      <section role="tabpanel" className={`${CARD} py-3`} aria-label={cur.label}>
        <p className="mb-2 px-3 text-sm text-text">{cur.headline(v)}</p>
        {cur.body(v, linkNames)}
      </section>
      <section className={CARD}>
        <Fold label="Contributors" headline={PANELS[6].headline(v)}><ContributorsPanel v={v} /></Fold>
      </section>
    </div>
  );
}
