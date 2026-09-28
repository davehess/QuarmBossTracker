'use client';

// The PoP checklist (see page.tsx): which character, which filters, and the optimistic ticks. Ticking
// calls setGuideTick; a failure puts the box back and says why. Items named in a step show the site's
// item card on hover; every /say and /map line has a copy button.

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  GUIDE_ITEMS, GUIDE_SECTIONS, WHO_LABEL, ZONE_NAMES, mapCommand, recordedKeys, sayCommand, splitItems, tickedKeys,
  type Chain, type GuideItem, type Loc, type Who,
} from '@/lib/popGuide';
import ItemHover, { type ItemCard } from '@/app/character/[name]/inventory/ItemHover';
import CopyChip from '@/components/CopyChip';
import { setGuideTick } from './actions';

export type GuideChar = { name: string; cls: string | null; isMain: boolean; manual: string[]; flags: string[] };

const WHO_ICON: Record<Who, string> = { solo: '🧍', group: '👥', raid: '⚔' };
const WHOS: Who[] = ['solo', 'group', 'raid'];

export default function GuideChecklist(
  { chars, initial, cards }: { chars: GuideChar[]; initial: string | null; cards: Record<number, ItemCard> },
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
      if (!res.ok) { apply(!next); setError(`Could not save “${item.title.replace(/\[\[([^\]#]+)#\d+\]\]/g, '$1')}”: ${res.error ?? 'unknown error'}`); }
    });
  }

  const visible = (i: GuideItem) =>
    (!mustOnly || i.must) && (!hideDone || !done.has(i.key)) && (who === 'all' || i.who === who);

  const mustTotal = GUIDE_ITEMS.filter(i => i.must).length;
  const mustDone = GUIDE_ITEMS.filter(i => i.must && done.has(i.key)).length;
  const allDone = GUIDE_ITEMS.filter(i => done.has(i.key)).length;

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
          {(['all', ...WHOS] as const).map(w => (
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
        <p className="text-[11px] text-dim">
          ⧉ copies a line for the EQ chat box: <code className="text-text">/say</code> for what to tell an NPC,
          <code className="text-text"> /map Y X</code> to drop a Zeal map marker on them.
        </p>
        {error && <p className="text-xs text-red" role="alert">{error}</p>}
      </section>

      {GUIDE_SECTIONS.map(s => {
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
            <ul>
              {shown.map(i => (
                <Row key={i.key} item={i} checked={done.has(i.key)} recorded={recorded.has(i.key)}
                     disabled={!char} onToggle={toggle} cards={cards} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function WithItems({ text, cards }: { text: string; cards: Record<number, ItemCard> }) {
  return (
    <>
      {splitItems(text).map((p, n) => ('item' in p
        ? (
          // Inside the checkbox label, a click on the item must not tick the box (links in the card still work).
          <span key={n} onClick={e => { if (!(e.target as HTMLElement).closest('a')) e.preventDefault(); }}>
            <ItemHover card={cards[p.item.id]} fallbackName={p.item.name}
                       className="text-blue underline decoration-dotted underline-offset-2 cursor-help">
              {p.item.name}
            </ItemHover>
          </span>
        )
        : <span key={n}>{p.text}</span>))}
    </>
  );
}

function Place({ at }: { at: Loc }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 min-w-0">
      <span className="text-text">{at.npc}</span>
      {at.note && <span className="text-dim">({at.note})</span>}
      <CopyChip text={mapCommand(at)} />
    </span>
  );
}

// A quest chain (the guild lead, 2026-09-28: "show the first item that seems to be required …
// the full quest chain with minimize sections … Highlight stages where you will have
// input/output"). The first item stays in view; the hand-ins (item in → item out, gold) and
// the story fold away.
function ChainView({ chain, cards }: { chain: Chain; cards: Record<number, ItemCard> }) {
  return (
    <div className="mt-2 space-y-1.5 text-[11px]">
      <div className="rounded border border-gold/60 bg-gold/10 px-2 py-1.5">
        <div className="text-gold text-[10px] uppercase tracking-wide">Start with this</div>
        <p className="text-text"><WithItems text={chain.first.text} cards={cards} /></p>
        <div className="mt-1">📍 <Place at={chain.first.at} /></div>
      </div>
      <details className="rounded border border-border px-2 py-1">
        <summary className="cursor-pointer text-dim">Hand-ins, in order · {chain.handins.length}</summary>
        <ol className="mt-1 space-y-1">
          {chain.handins.map((s, n) => (
            <li key={n} className="border-l-2 border-gold/70 bg-gold/5 pl-2 py-0.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-dim">{n + 1}.</span>
                <Place at={s.at} />
              </div>
              <div className="mt-0.5">
                <span className="text-dim">give</span> <WithItems text={s.give ?? ''} cards={cards} />
                <span className="text-gold"> → </span>
                <span className="text-dim">get</span> <WithItems text={s.get ?? ''} cards={cards} />
              </div>
            </li>
          ))}
        </ol>
      </details>
      <details className="rounded border border-border px-2 py-1">
        <summary className="cursor-pointer text-dim">The story: who sends you where · {chain.talk.length}</summary>
        <ol className="mt-1 space-y-1">
          {chain.talk.map((s, n) => (
            <li key={n} className="pl-2 py-0.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-dim">{n + 1}.</span>
                <Place at={s.at} />
                {(s.say ?? []).map(t => <CopyChip key={t} text={sayCommand({ text: t })} />)}
              </div>
              {s.note && <div className="text-dim mt-0.5">{s.note}</div>}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function Row({ item, checked, recorded, disabled, onToggle, cards }: {
  item: GuideItem; checked: boolean; recorded: boolean; disabled: boolean; cards: Record<number, ItemCard>;
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
          <WithItems text={item.title} cards={cards} />
        </label>
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[10px]">
          <span className="px-1.5 rounded border border-border text-dim">{WHO_ICON[item.who]} {WHO_LABEL[item.who]}</span>
          {item.must && <span className="px-1.5 rounded border border-gold/60 text-gold">★ must</span>}
          {recorded && <span className="px-1.5 rounded border border-green/60 text-green">✓ recorded</span>}
          {item.check && <span className="px-1.5 rounded border border-border text-dim" title="Classic detail, not yet confirmed on Quarm">verify at launch</span>}
        </div>
        {(item.detail || item.link) && (
          <p className="text-xs text-dim mt-0.5">
            {item.detail && <WithItems text={item.detail} cards={cards} />}{' '}
            {item.link && (external
              ? <a href={item.link.href} target="_blank" rel="noopener noreferrer" className="text-blue hover:underline whitespace-nowrap">{item.link.label} ↗</a>
              : <Link href={item.link.href} className="text-blue hover:underline whitespace-nowrap">{item.link.label} →</Link>)}
          </p>
        )}
        {item.says && item.says.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[11px]">
            {item.says.map((s, n) => (
              <span key={n} className="inline-flex flex-wrap items-center gap-1 min-w-0 max-w-full">
                {(n === 0 || item.says![n - 1].to !== s.to) && <span className="text-dim">to {s.to}:</span>}
                <CopyChip text={sayCommand(s)} />
              </span>
            ))}
          </div>
        )}
        {item.where && item.where.length > 0 && (
          <div className="flex flex-col gap-1 mt-1.5 text-[11px]">
            {item.where.map((l, n) => (
              <span key={n} className="flex flex-wrap items-center gap-1.5 min-w-0">
                <span className="text-dim">📍 {l.npc}, {ZONE_NAMES[l.zone]}{l.note ? ` (${l.note})` : ''}</span>
                <CopyChip text={mapCommand(l)} />
              </span>
            ))}
          </div>
        )}
        {item.chain && <ChainView chain={item.chain} cards={cards} />}
      </div>
    </li>
  );
}
