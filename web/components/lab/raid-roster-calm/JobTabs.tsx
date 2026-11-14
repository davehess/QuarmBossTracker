'use client';
import { useEffect, useState } from 'react';
import { MANA_LOW, type CalmRaider, type CalmView, hpTone } from '@/lib/raidRosterCalmView';
import { HeaderLine, HP_TEXT, classAbbr, detailFor, hpLabel, type RenderDetail } from './shared';

// Version C, "Job tabs". Roster, Buffs, Mana, Curses: four focused lists with counts on the tabs. The chosen tab
// is remembered in this browser.
type Tab = 'roster' | 'buffs' | 'mana' | 'curses';
const KEY = 'raid-calm-tab';

export default function JobTabs({
  view, renderDetail, fullViewHref,
}: { view: CalmView; renderDetail?: RenderDetail; fullViewHref?: string }) {
  const [tab, setTab] = useState<Tab>('roster');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    try {
      const s = localStorage.getItem(KEY);
      if (s === 'roster' || s === 'buffs' || s === 'mana' || s === 'curses') setTab(s);
    } catch {}
  }, []);
  const choose = (t: Tab) => {
    setTab(t); setOpen(null);
    try { localStorage.setItem(KEY, t); } catch {}
  };
  const all = view.groups.flatMap((g) => g.raiders);
  const buffs = all.filter((r) => r.gaps.length > 0);
  const mana = all.filter((r) => r.mana != null).sort((a, b) => a.mana! - b.mana! || a.name.localeCompare(b.name));
  const lowMana = mana.filter((r) => r.mana! <= MANA_LOW).length;
  const curses = all.filter((r) => r.curse);
  const tabs: { key: Tab; label: string; n: number | null; hot: boolean }[] = [
    { key: 'roster', label: 'Roster', n: null, hot: false },
    { key: 'buffs', label: 'Buffs', n: buffs.length, hot: false },
    { key: 'mana', label: 'Mana', n: lowMana, hot: view.alerts.some((a) => a.kind === 'mana') },
    { key: 'curses', label: 'Curses', n: curses.length, hot: curses.length > 0 },
  ];
  const row = (r: CalmRaider, right: React.ReactNode) => (
    <li key={r.name}>
      <button
        type="button" aria-expanded={open === r.name} onClick={() => setOpen(open === r.name ? null : r.name)}
        className="grid min-h-[40px] w-full grid-cols-[minmax(0,1fr)_2.5rem_auto] items-center gap-x-2 px-3 py-1 text-left text-sm hover:bg-bg/60"
      >
        <span className={'truncate ' + (r.dead ? 'text-red' : 'text-text')}>{r.name}</span>
        <span className="text-text">{classAbbr(r.cls)}</span>
        <span className="text-right">{right}</span>
      </button>
      {open === r.name ? detailFor(renderDetail, r) : null}
    </li>
  );
  const empty = (t: string) => <li className="px-3 py-6 text-center text-sm text-green">{t}</li>;
  return (
    <div className="space-y-3 font-mono">
      <HeaderLine view={view} fullViewHref={fullViewHref} />
      <div role="tablist" className="grid grid-cols-4 gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => choose(t.key)}
            className={'min-h-[44px] rounded border px-1 text-sm ' + (tab === t.key ? 'border-accent bg-accent/20 text-text' : 'border-border bg-panel text-text') + (t.hot ? ' !border-red' : '')}
          >
            {t.label}{t.n != null ? ' ' : ''}
            {t.n != null ? <b className={t.hot ? 'text-red' : t.n > 0 ? 'text-orange' : 'text-text'}>{t.n}</b> : null}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-panel">
        {tab === 'roster' && view.groups.map((g) => (
          <div key={g.label}>
            <h2 className="border-b border-border bg-bg/60 px-3 py-1 text-sm text-gold">{g.label}</h2>
            <ul className="divide-y divide-border/50">
              {g.raiders.map((r) => row(r, <b className={'text-lg tabular-nums ' + HP_TEXT[hpTone(r.hp)]}>{hpLabel(r)}</b>))}
            </ul>
          </div>
        ))}
        {tab === 'buffs' && (
          <ul className="divide-y divide-border/50">
            {buffs.length === 0 ? empty('Everyone has their key buffs.') : buffs.map((r) => row(r, <span className="text-orange">{r.gaps.slice(0, 2).join(', ')}</span>))}
          </ul>
        )}
        {tab === 'mana' && (
          <ul className="divide-y divide-border/50">
            {mana.length === 0 ? empty('No mana readings yet.') : mana.map((r) => row(r, <b className={'text-lg tabular-nums ' + (r.mana! <= 10 ? 'text-red' : r.mana! <= MANA_LOW ? 'text-orange' : 'text-text')}>{r.mana}%</b>))}
          </ul>
        )}
        {tab === 'curses' && (
          <ul className="divide-y divide-border/50">
            {curses.length === 0 ? empty('Nobody is cursed.') : curses.map((r) => row(r, <b className="text-red">{r.curse}</b>))}
          </ul>
        )}
      </div>
    </div>
  );
}
