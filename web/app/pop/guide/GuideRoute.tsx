'use client';

// The PoP checklist's two beta layouts (the guild lead, 2026-09-29: "the pop guide page needs some
// love. more detail, maps, who to turn things into, expectations and who you will go back to. a
// sidebar nav with sections. automatic fill in when someone is running mimic … and note when it's been
// filled in by database or mimic in a line item"). Both share the sidebar and the row; they differ in
// where the detail and the map go:
//   b — Guide: each step opens in place to its detail and its zone maps.
//   c — Route: a compact list, and one detail panel beside it that follows the step you pick.
// Production (no ?v=) is GuideChecklist.tsx, untouched.

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  GUIDE_ITEMS, GUIDE_SECTIONS, WHO_LABEL, ZONE_NAMES, mapCommand, sayCommand,
  type GuideItem, type Loc, type Who,
} from '@/lib/popGuide';
import { STEP_MORE, stepPlaces } from '@/lib/popGuideMore';
import { type ItemCard } from '@/app/character/[name]/inventory/ItemHover';
import CopyChip from '@/components/CopyChip';
import { setGuideTick } from './actions';
import { ChainView, Place, WithItems } from './GuideChecklist';
import ZoneMap, { type ZoneOutline } from './ZoneMap';

// How a step got its tick. mimic = Mimic saw it happen; database = our records already show it.
export type Evidence = { source: 'mimic' | 'database'; what: string; at: string | null };
export type RouteChar = {
  name: string; cls: string | null; isMain: boolean;
  manual: string[];
  auto: Record<string, Evidence>;
};

const WHO_ICON: Record<Who, string> = { solo: '🧍', group: '👥', raid: '⚔' };
const WHOS: Who[] = ['solo', 'group', 'raid'];

function when(at: string | null) {
  if (!at) return '';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : ' · ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function SourceBadge({ ev, manual }: { ev?: Evidence; manual: boolean }) {
  if (ev) {
    const mimic = ev.source === 'mimic';
    return (
      <span className={`px-1.5 rounded border ${mimic ? 'border-green/60 text-green' : 'border-blue/60 text-blue'}`}
            title={ev.what}>
        {mimic ? '✓ filled by Mimic' : '✓ from our records'}{when(ev.at)}
      </span>
    );
  }
  return manual ? <span className="px-1.5 rounded border border-border text-dim">✓ ticked by you</span> : null;
}

export default function GuideRoute({ chars, initial, cards, outlines, layout }: {
  chars: RouteChar[]; initial: string | null; cards: Record<number, ItemCard>;
  outlines: Record<string, ZoneOutline>; layout: 'b' | 'c';
}) {
  const [charName, setCharName] = useState<string | null>(initial);
  const [manualBy, setManualBy] = useState<Record<string, Set<string>>>(
    () => Object.fromEntries(chars.map(c => [c.name, new Set(c.manual)])));
  const [who, setWho] = useState<Who | 'all'>('all');
  const [mustOnly, setMustOnly] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [activeSec, setActiveSec] = useState<string>(GUIDE_SECTIONS[0].key);
  const [, start] = useTransition();

  const char = chars.find(c => c.name === charName) ?? null;
  const manual = (char && manualBy[char.name]) || new Set<string>();
  const auto = useMemo(() => char?.auto ?? {}, [char]);
  const done = useMemo(() => new Set([...manual, ...Object.keys(auto)]), [manual, auto]);

  // The sidebar follows the section on screen.
  useEffect(() => {
    const els = GUIDE_SECTIONS.map(s => document.getElementById(`sec-${s.key}`)).filter(Boolean) as HTMLElement[];
    if (!('IntersectionObserver' in window) || els.length === 0) return;
    const io = new IntersectionObserver(entries => {
      const top = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setActiveSec(top.target.id.slice(4));
    }, { rootMargin: '-20% 0px -70% 0px' });
    els.forEach(e => io.observe(e));
    return () => io.disconnect();
  }, [who, mustOnly, hideDone, charName]);

  function pick(name: string) {
    setCharName(name);
    setError(null);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('c', name);
      window.history.replaceState(null, '', url.toString());
    } catch { /* the URL is only a convenience */ }
  }

  function toggle(item: GuideItem, next: boolean) {
    if (!char || auto[item.key]) return;
    const name = char.name;
    const apply = (on: boolean) => setManualBy(prev => {
      const s = new Set(prev[name] ?? []);
      if (on) s.add(item.key); else s.delete(item.key);
      return { ...prev, [name]: s };
    });
    apply(next);
    setError(null);
    start(async () => {
      const res = await setGuideTick(name, item.key, next);
      if (!res.ok) { apply(!next); setError(`Could not save that step: ${res.error ?? 'unknown error'}`); }
    });
  }

  const visible = (i: GuideItem) =>
    (!mustOnly || i.must) && (!hideDone || !done.has(i.key)) && (who === 'all' || i.who === who);
  const mustTotal = GUIDE_ITEMS.filter(i => i.must).length;
  const mustDone = GUIDE_ITEMS.filter(i => i.must && done.has(i.key)).length;
  const autoN = Object.keys(auto).length;
  const pickedItem = GUIDE_ITEMS.find(i => i.key === picked) ?? null;

  const sidebar = (
    <nav aria-label="Checklist sections" className="flex flex-col gap-3 text-sm">
      {chars.length > 0 ? (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-dim uppercase tracking-wide">Character</span>
          <select value={charName ?? ''} onChange={e => pick(e.target.value)}
                  className="bg-bg border border-border rounded px-2 py-1 text-text focus:outline focus:outline-2 focus:outline-blue">
            {chars.map(c => <option key={c.name} value={c.name}>{c.name}{c.isMain ? '' : ' (alt)'}{c.cls ? ` · ${c.cls}` : ''}</option>)}
          </select>
        </label>
      ) : (
        <span className="text-orange text-xs">No characters linked yet. <Link href="/me" className="text-blue hover:underline">Link one on /me</Link>.</span>
      )}
      <div>
        <div className="text-dim text-xs">Must-haves <b className="text-gold">{mustDone}</b>/{mustTotal}</div>
        <div className="h-1.5 bg-bg rounded overflow-hidden mt-1" aria-hidden>
          <div className="h-full bg-gold" style={{ width: `${Math.round((mustDone / Math.max(1, mustTotal)) * 100)}%` }} />
        </div>
        {autoN > 0 && <div className="text-[11px] text-green mt-1">{autoN} filled in for you</div>}
      </div>
      <ol className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible -mx-1 px-1 pb-1 lg:pb-0">
        {GUIDE_SECTIONS.map(s => {
          const items = GUIDE_ITEMS.filter(i => i.section === s.key);
          const n = items.filter(i => done.has(i.key)).length;
          const on = activeSec === s.key;
          return (
            <li key={s.key} className="shrink-0">
              <a href={`#sec-${s.key}`}
                 className={`flex items-baseline justify-between gap-3 rounded px-2 py-1 whitespace-nowrap lg:whitespace-normal no-underline border-l-2 ${on ? 'border-gold bg-gold/10 text-gold' : 'border-transparent text-dim hover:text-text'}`}>
                <span className="min-w-0">{s.title}</span>
                <span className={`shrink-0 text-[11px] ${n === items.length ? 'text-green' : ''}`}>{n}/{items.length}</span>
              </a>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {(['all', ...WHOS] as const).map(w => (
          <button key={w} type="button" onClick={() => setWho(w)} aria-pressed={who === w}
                  className={`px-2 py-0.5 rounded border ${who === w ? 'border-gold text-gold' : 'border-border text-dim hover:text-text'}`}>
            {w === 'all' ? 'All' : `${WHO_ICON[w]} ${WHO_LABEL[w]}`}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1 text-dim text-xs cursor-pointer">
        <input type="checkbox" checked={mustOnly} onChange={e => setMustOnly(e.target.checked)} className="accent-gold" /> Must-haves only
      </label>
      <label className="flex items-center gap-1 text-dim text-xs cursor-pointer">
        <input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} className="accent-gold" /> Hide done
      </label>
      <p className="text-[11px] text-dim">
        <span className="text-green">Filled by Mimic</span>: Mimic saw it happen.{' '}
        <span className="text-blue">From our records</span>: the database already shows it.
      </p>
    </nav>
  );

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
      <aside className="lg:w-60 shrink-0 min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto bg-panel border border-border rounded-lg p-3">
        {sidebar}
      </aside>
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        {error && <p className="text-xs text-red" role="alert">{error}</p>}
        <div className={layout === 'c' ? 'grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4 items-start' : ''}>
          <div className="flex flex-col gap-4 min-w-0">
            {GUIDE_SECTIONS.map(s => {
              const items = GUIDE_ITEMS.filter(i => i.section === s.key);
              const shown = items.filter(visible);
              if (shown.length === 0) return null;
              return (
                <section key={s.key} id={`sec-${s.key}`} className="bg-panel border border-border rounded-lg p-3 scroll-mt-4">
                  <h2 className="text-sm text-text font-semibold">{s.title}</h2>
                  <p className="text-xs text-dim mb-1">{s.blurb}</p>
                  <ul>
                    {shown.map(i => (
                      <li key={i.key} className="border-t border-border first:border-t-0">
                        <StepRow item={i} layout={layout} checked={done.has(i.key)} ev={auto[i.key]}
                                 manual={manual.has(i.key)} disabled={!char} onToggle={toggle} cards={cards}
                                 outlines={outlines} picked={picked === i.key}
                                 onPick={() => setPicked(p => (p === i.key ? null : i.key))} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
          {layout === 'c' && (
            <aside className="hidden lg:block lg:sticky lg:top-4 bg-panel border border-border rounded-lg p-3 max-h-[calc(100vh-2rem)] overflow-y-auto">
              {pickedItem
                ? <StepDetail item={pickedItem} cards={cards} outlines={outlines} mapHeight={260} />
                : <p className="text-sm text-dim">Pick a step to see who you need, what to say, who takes what, who you go back to, and where they stand.</p>}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

function StepRow({ item, layout, checked, ev, manual, disabled, onToggle, cards, outlines, picked, onPick }: {
  item: GuideItem; layout: 'b' | 'c'; checked: boolean; ev?: Evidence; manual: boolean; disabled: boolean;
  onToggle: (item: GuideItem, next: boolean) => void; cards: Record<number, ItemCard>;
  outlines: Record<string, ZoneOutline>; picked: boolean; onPick: () => void;
}) {
  const id = `route-${item.key}`;
  return (
    <div className={`flex gap-3 py-2 ${layout === 'c' && picked ? 'bg-gold/5 -mx-3 px-3' : ''}`}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled || !!ev}
             onChange={e => onToggle(item, e.target.checked)}
             className="mt-0.5 h-4 w-4 shrink-0 accent-green cursor-pointer disabled:cursor-default"
             title={ev ? ev.what : undefined} />
      <div className="flex-1 min-w-0">
        <label htmlFor={id} className={`text-sm cursor-pointer ${checked ? 'text-dim' : 'text-text'}`}>
          <WithItems text={item.title} cards={cards} />
        </label>
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[10px]">
          <span className="px-1.5 rounded border border-border text-dim">{WHO_ICON[item.who]} {WHO_LABEL[item.who]}</span>
          {item.must && <span className="px-1.5 rounded border border-gold/60 text-gold">★ must</span>}
          <SourceBadge ev={ev} manual={manual && !ev} />
          {item.check && <span className="px-1.5 rounded border border-border text-dim" title="Classic detail, not yet confirmed on Quarm">verify at launch</span>}
          <button type="button" onClick={onPick} aria-expanded={picked}
                  className={`px-1.5 rounded border ${picked ? 'border-gold text-gold' : 'border-border text-blue hover:text-text'} ${layout === 'c' ? 'lg:hidden' : ''}`}>
            {picked ? '▾ less' : '▸ details & map'}
          </button>
          {layout === 'c' && (
            <button type="button" onClick={onPick} aria-pressed={picked}
                    className={`hidden lg:inline px-1.5 rounded border ${picked ? 'border-gold text-gold' : 'border-border text-blue hover:text-text'}`}>
              {picked ? '● shown' : '→ show'}
            </button>
          )}
        </div>
        {picked && (
          <div className={layout === 'c' ? 'lg:hidden mt-2' : 'mt-2'}>
            <StepDetail item={item} cards={cards} outlines={outlines} mapHeight={180} />
          </div>
        )}
      </div>
    </div>
  );
}

export function StepDetail({ item, cards, outlines, mapHeight }: {
  item: GuideItem; cards: Record<number, ItemCard>; outlines: Record<string, ZoneOutline>; mapHeight: number;
}) {
  const more = STEP_MORE[item.key];
  const places = stepPlaces(item, more);
  const zones = [...new Set(places.map(p => p.zone))];
  const external = item.link?.href.startsWith('http');
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="text-sm text-text"><WithItems text={item.title} cards={cards} /></div>
      {more?.expect && (
        <div className="rounded border border-border px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-dim">What to expect</div>
          <p className="text-text"><WithItems text={more.expect} cards={cards} /></p>
        </div>
      )}
      {(item.detail || item.link) && (
        <p className="text-dim">
          {item.detail && <WithItems text={item.detail} cards={cards} />}{' '}
          {item.link && (external
            ? <a href={item.link.href} target="_blank" rel="noopener noreferrer" className="text-blue hover:underline whitespace-nowrap">{item.link.label} ↗</a>
            : <Link href={item.link.href} className="text-blue hover:underline whitespace-nowrap">{item.link.label} →</Link>)}
        </p>
      )}
      {item.says && item.says.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-dim">What to say</div>
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px]">
            {item.says.map((s, n) => (
              <span key={n} className="inline-flex flex-wrap items-center gap-1 min-w-0 max-w-full">
                {(n === 0 || item.says![n - 1].to !== s.to) && <span className="text-dim">to {s.to}:</span>}
                {s.sit && <><span className="text-gold">sit first</span><CopyChip text="/sit" /></>}
                <CopyChip text={sayCommand(s)} />
              </span>
            ))}
          </div>
        </div>
      )}
      {more?.turnIn && more.turnIn.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-dim">Who takes what</div>
          <ul className="mt-0.5 space-y-1">
            {more.turnIn.map((t, n) => (
              <li key={n} className="border-l-2 border-gold/70 bg-gold/5 pl-2 py-0.5">
                <Place at={t.to} />
                <div className="mt-0.5">
                  <span className="text-dim">give</span> <WithItems text={t.give} cards={cards} />
                  {t.get && <><span className="text-gold"> → </span><span className="text-dim">get</span> <WithItems text={t.get} cards={cards} /></>}
                </div>
                {t.note && <div className="text-dim mt-0.5">{t.note}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {more?.back && more.back.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-dim">Then go back to</div>
          <div className="flex flex-col gap-1 mt-0.5">
            {more.back.map((b, n) => (
              <span key={n} className="flex flex-wrap items-center gap-1.5 min-w-0">
                <span aria-hidden>↩</span><Place at={b} /><span className="text-dim">{ZONE_NAMES[b.zone]}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {item.where && item.where.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-dim">Where</div>
          <div className="flex flex-col gap-1 mt-0.5 text-[11px]">
            {item.where.map((l: Loc, n: number) => (
              <span key={n} className="flex flex-wrap items-center gap-1.5 min-w-0">
                <span className="text-dim">📍 {l.npc}, {ZONE_NAMES[l.zone]}{l.note ? ` (${l.note})` : ''}</span>
                <CopyChip text={mapCommand(l)} />
              </span>
            ))}
          </div>
        </div>
      )}
      {item.chain && <ChainView chain={item.chain} cards={cards} />}
      {zones.map(z => (
        <ZoneMap key={z} outline={outlines[z] ?? null} height={mapHeight}
                 title={`${ZONE_NAMES[z as keyof typeof ZONE_NAMES] ?? z}: where to go`}
                 marks={places.filter(p => p.zone === z).map(p => ({ x: p.x, y: p.y, label: p.npc }))} />
      ))}
      {more?.auto && <p className="text-[11px] text-dim">⟳ {more.auto}</p>}
    </div>
  );
}
