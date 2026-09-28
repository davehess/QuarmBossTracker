'use client';

// The PoP checklist (see page.tsx). Both layouts on beta share this state: which character, which
// filters, and the optimistic ticks. Ticking calls setGuideTick; a failure puts the box back and says why.

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  GUIDE_ITEMS, GUIDE_SECTIONS, WHO_LABEL, recordedKeys, tickedKeys,
  type GuideItem, type Who,
} from '@/lib/popGuide';
import { setGuideTick } from './actions';

export type GuideChar = { name: string; cls: string | null; isMain: boolean; manual: string[]; flags: string[] };

const WHO_ICON: Record<Who, string> = { solo: '🧍', group: '👥', raid: '⚔' };
const WHOS: Who[] = ['solo', 'group', 'raid'];

export default function GuideChecklist(
  { layout, chars, initial }: { layout: 'path' | 'who'; chars: GuideChar[]; initial: string | null },
) {
  const [charName, setCharName] = useState<string | null>(initial);
  const [manualBy, setManualBy] = useState<Record<string, Set<string>>>(
    () => Object.fromEntries(chars.map(c => [c.name, new Set(c.manual)])));
  const [who, setWho] = useState<Who | 'all'>('all');
  const [mustOnly, setMustOnly] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const char = chars.find(c => c.name === charName) ?? null;
  const manual = (char && manualBy[char.name]) || new Set<string>();
  const recorded = useMemo(() => recordedKeys(char?.flags ?? []), [char]);
  const done = useMemo(() => tickedKeys(manual, char?.flags ?? []), [manual, char]);

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
    if (!char || recorded.has(item.key)) return;
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
      if (!res.ok) { apply(!next); setError(`Could not save “${item.title}”: ${res.error ?? 'unknown error'}`); }
    });
  }

  const visible = (i: GuideItem) =>
    (!mustOnly || i.must) && (!hideDone || !done.has(i.key)) && (layout === 'who' || who === 'all' || i.who === who);

  const mustTotal = GUIDE_ITEMS.filter(i => i.must).length;
  const mustDone = GUIDE_ITEMS.filter(i => i.must && done.has(i.key)).length;
  const allDone = GUIDE_ITEMS.filter(i => done.has(i.key)).length;

  const row = (i: GuideItem, compact = false) => (
    <Row key={i.key} item={i} checked={done.has(i.key)} recorded={recorded.has(i.key)}
         disabled={!char} onToggle={toggle} compact={compact} />
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Character + progress + filters */}
      <section className="bg-panel border border-border rounded-lg p-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {chars.length > 0 ? (
            <label className="flex items-center gap-2">
              <span className="text-dim">Character</span>
              <select value={charName ?? ''} onChange={e => pick(e.target.value)}
                      className="bg-bg border border-border rounded px-2 py-1 text-text focus:outline focus:outline-2 focus:outline-blue">
                {chars.map(c => (
                  <option key={c.name} value={c.name}>{c.name}{c.isMain ? '' : ' (alt)'}{c.cls ? ` · ${c.cls}` : ''}</option>
                ))}
              </select>
            </label>
          ) : (
            <span className="text-orange">
              No characters linked to you yet, so ticks can&apos;t be saved. <Link href="/me" className="text-blue hover:underline">Link one on /me</Link>.
            </span>
          )}
          <span className="text-dim">
            Must-haves <b className="text-gold">{mustDone}</b>/{mustTotal}
            <span className="mx-2">·</span>
            Everything <b className="text-text">{allDone}</b>/{GUIDE_ITEMS.length}
          </span>
        </div>
        <div className="h-1.5 bg-bg rounded overflow-hidden" aria-hidden>
          <div className="h-full bg-gold" style={{ width: `${Math.round((mustDone / Math.max(1, mustTotal)) * 100)}%` }} />
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {layout === 'path' && (['all', ...WHOS] as const).map(w => (
            <button key={w} type="button" onClick={() => setWho(w)} aria-pressed={who === w}
                    className={`px-2 py-0.5 rounded border ${who === w ? 'border-gold text-gold' : 'border-border text-dim hover:text-text'}`}>
              {w === 'all' ? 'All' : `${WHO_ICON[w]} ${WHO_LABEL[w]}`}
            </button>
          ))}
          <label className="flex items-center gap-1 text-dim cursor-pointer">
            <input type="checkbox" checked={mustOnly} onChange={e => setMustOnly(e.target.checked)} className="accent-gold" />
            Must-haves only
          </label>
          <label className="flex items-center gap-1 text-dim cursor-pointer">
            <input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} className="accent-gold" />
            Hide done
          </label>
        </div>
        {error && <p className="text-xs text-red" role="alert">{error}</p>}
      </section>

      {layout === 'path' ? (
        // ── A: the path — one list in progression order ─────────────────────
        GUIDE_SECTIONS.map(s => {
          const items = GUIDE_ITEMS.filter(i => i.section === s.key);
          const shown = items.filter(visible);
          if (shown.length === 0) return null;
          const n = items.filter(i => done.has(i.key)).length;
          return (
            <section key={s.key} className="bg-panel border border-border rounded-lg p-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm text-text font-semibold">{s.title}</h2>
                <span className={`text-xs ${n === items.length ? 'text-green' : 'text-dim'}`}>{n}/{items.length}</span>
              </div>
              <p className="text-xs text-dim mb-1">{s.blurb}</p>
              <ul>{shown.map(i => row(i))}</ul>
            </section>
          );
        })
      ) : (
        // ── B: who's with you — next must-haves, then Solo / Group / Raid ───
        <>
          {(() => {
            const next = GUIDE_ITEMS.filter(i => i.must && !done.has(i.key)).slice(0, 5);
            return (
              <section className="bg-panel border border-gold/50 rounded-lg p-3">
                <h2 className="text-sm text-gold font-semibold">Your next must-haves</h2>
                {next.length === 0
                  ? <p className="text-sm text-green mt-1">Every must-have is done.</p>
                  : <ul>{next.map(i => row(i))}</ul>}
              </section>
            );
          })()}
          <div className="grid gap-4 md:grid-cols-3">
            {WHOS.map(w => {
              const items = GUIDE_ITEMS.filter(i => i.who === w);
              const shown = items.filter(visible);
              const n = items.filter(i => done.has(i.key)).length;
              let lastSection = '';
              return (
                <section key={w} className="bg-panel border border-border rounded-lg p-3 min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-sm text-text font-semibold">{WHO_ICON[w]} {WHO_LABEL[w]}</h2>
                    <span className={`text-xs ${n === items.length ? 'text-green' : 'text-dim'}`}>{n}/{items.length}</span>
                  </div>
                  <ul>
                    {shown.flatMap(i => {
                      const title = GUIDE_SECTIONS.find(s => s.key === i.section)?.title ?? '';
                      const head = title !== lastSection;
                      lastSection = title;
                      return [
                        ...(head ? [<li key={`h-${i.key}`} className="text-[10px] uppercase tracking-wide text-dim mt-3">{title}</li>] : []),
                        row(i, true),
                      ];
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ item, checked, recorded, disabled, onToggle, compact }: {
  item: GuideItem; checked: boolean; recorded: boolean; disabled: boolean; compact: boolean;
  onToggle: (item: GuideItem, next: boolean) => void;
}) {
  const id = `guide-${item.key}`;
  const external = item.link?.href.startsWith('http');
  return (
    <li className="flex gap-3 py-2 border-t border-border first:border-t-0">
      <input id={id} type="checkbox" checked={checked} disabled={disabled || recorded}
             onChange={e => onToggle(item, e.target.checked)}
             className="mt-0.5 h-4 w-4 shrink-0 accent-green cursor-pointer disabled:cursor-default"
             title={recorded ? 'Mimic recorded this flag for you' : undefined} />
      <div className="flex-1 min-w-0">
        <label htmlFor={id} className={`text-sm cursor-pointer ${checked ? 'text-dim' : 'text-text'}`}>
          {item.title}
        </label>
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[10px]">
          {!compact && <span className="px-1.5 rounded border border-border text-dim">{WHO_ICON[item.who]} {WHO_LABEL[item.who]}</span>}
          {item.must && <span className="px-1.5 rounded border border-gold/60 text-gold">★ must</span>}
          {recorded && <span className="px-1.5 rounded border border-green/60 text-green">✓ recorded</span>}
          {item.check && <span className="px-1.5 rounded border border-border text-dim" title="Classic detail, not yet confirmed on Quarm">verify at launch</span>}
        </div>
        {(item.detail || item.link) && (
          <p className="text-xs text-dim mt-0.5">
            {item.detail}{' '}
            {item.link && (external
              ? <a href={item.link.href} target="_blank" rel="noopener noreferrer" className="text-blue hover:underline whitespace-nowrap">{item.link.label} ↗</a>
              : <Link href={item.link.href} className="text-blue hover:underline whitespace-nowrap">{item.link.label} →</Link>)}
          </p>
        )}
      </div>
    </li>
  );
}
