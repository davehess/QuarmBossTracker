'use client';

// The PoP checklist (see page.tsx): which character, which filters, and the optimistic ticks. Ticking
// calls setGuideTick; a failure puts the box back and says why. Items named in a step show the site's
// item card on hover; every /say and /map line has a copy button.

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  GUIDE_ITEMS, GUIDE_SECTIONS, WHO_LABEL, ZONE_NAMES, mapCommand, recordedKeys, sayCommand, seqRows, splitItems, tickedKeys,
  type Act, type Chain, type GuideItem, type Loc, type Who,
} from '@/lib/popGuide';
import ItemHover, { type ItemCard } from '@/app/character/[name]/inventory/ItemHover';
import CopyChip from '@/components/CopyChip';
import { setGuideTick } from './actions';

export type GuideChar = { name: string; cls: string | null; isMain: boolean; manual: string[]; flags: string[] };

const WHO_ICON: Record<Who, string> = { solo: '🧍', group: '👥', raid: '⚔' };
const WHOS: Who[] = ['solo', 'group', 'raid'];

// The character <option>s, with the characters nobody has a level for in a group at the bottom (the
// guild lead, 2026-10-03: "put any unknown characters into a minimized area"). Shared by both layouts.
export function CharOptions({ chars, noLevel }: { chars: Pick<GuideChar, 'name' | 'cls' | 'isMain'>[]; noLevel?: string[] }) {
  const unknown = new Set(noLevel ?? []);
  const opt = (c: Pick<GuideChar, 'name' | 'cls' | 'isMain'>) => (
    <option key={c.name} value={c.name}>{c.name}{c.isMain ? '' : ' (alt)'}{c.cls ? ` · ${c.cls}` : ''}</option>
  );
  const folded = chars.filter(c => unknown.has(c.name));
  return (
    <>
      {chars.filter(c => !unknown.has(c.name)).map(opt)}
      {folded.length > 0 && <optgroup label="No known level">{folded.map(opt)}</optgroup>}
    </>
  );
}

export default function GuideChecklist(
  { chars, initial, cards, noLevel }: { chars: GuideChar[]; initial: string | null; cards: Record<number, ItemCard>; noLevel?: string[] },
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
                <CharOptions chars={chars} noLevel={noLevel} />
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

export function WithItems({ text, cards }: { text: string; cards: Record<number, ItemCard> }) {
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

export function Place({ at }: { at: Loc }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 min-w-0">
      <span className="text-text">{at.npc}</span>
      {at.note && <span className="text-dim">({at.note})</span>}
      <CopyChip text={mapCommand(at)} />
    </span>
  );
}

// A step's seq as ONE numbered list (the guild lead, 2026-10-03: "the hand in items should be in order
// with the text we say to them"): "1. Hail Grand Librarian Maelin  2. /say lore ⧉  3. Give … → get …".
// The rows come from seqRows (web/lib/popGuide.ts): a `get` rides on the row before it, a `note` hangs
// under it, the zone-in that flags you is gold. Item names go through WithItems, so the site's item card
// shows on hover; a /say and a /sit are the same CopyChip as everywhere else on the page.
const ITEM_NAMES = (items: string[]) => {
  // The same item twice in a row of hand-ins reads "Name ×2" (two Esoteric Medallions), not a repeated name.
  const counts = new Map<string, number>();
  for (const t of items) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(', ');
};

function ActItems({ act, cards }: { act: Act; cards: Record<number, ItemCard> }) {
  return act.items && act.items.length > 0 ? <WithItems text={ITEM_NAMES(act.items)} cards={cards} /> : null;
}

function ActLine({ act, cards }: { act: Act; cards: Record<number, ItemCard> }) {
  const who = act.to ? <span className="text-text">{act.to}</span> : null;
  const aside = act.text && act.kind !== 'say' && act.kind !== 'get' ? <span className="text-dim"> ({act.text})</span> : null;
  switch (act.kind) {
    case 'hail':
      return <span className="inline-flex flex-wrap items-center gap-1.5 min-w-0"><span className="text-dim">Hail</span>{who}{aside}<CopyChip text={sayCommand({ text: 'Hail' })} /></span>;
    case 'say':
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5 min-w-0 max-w-full">
          <span className="text-dim">Say to</span>{who}<span className="text-dim">:</span>
          {act.sit && <><span className="text-gold">sit first</span><CopyChip text="/sit" /></>}
          <CopyChip text={sayCommand({ text: act.text ?? '' })} />
          {act.times && act.times > 1 && <span className="text-gold" title="Say it this many times in a row">×{act.times}</span>}
          {act.until && <span className="text-gold">repeat until {act.until}</span>}
        </span>
      );
    case 'give':
      return <span><span className="text-dim">Give</span> {who}<span className="text-dim">:</span> <ActItems act={act} cards={cards} />{aside}</span>;
    case 'get':
      return <span><span className="text-dim">Get</span> <GetBits act={act} cards={cards} /></span>;
    case 'kill':
      return <span><span className="text-dim">Kill</span> {who}{aside}</span>;
    case 'click':
      return <span><span className="text-dim">Click</span> {who}{act.items && act.items.length > 0 && <>: <ActItems act={act} cards={cards} /></>}{aside}</span>;
    case 'zone':
      return <span><span className="text-gold">Zone in:</span> {who}<span className="block text-dim">{act.text}</span></span>;
    case 'wait':
      return <span><span className="text-dim">Wait for</span> <span className="text-text">{act.text}</span></span>;
    default:
      return <span className="text-dim">{act.text}</span>;
  }
}

// What comes back: the items, then the words ("a character flag", "100,000 experience").
function GetBits({ act, cards }: { act: Act; cards: Record<number, ItemCard> }) {
  return (
    <>
      <ActItems act={act} cards={cards} />
      {act.text && <span className="text-dim">{act.items && act.items.length > 0 ? ` (${act.text})` : act.text}</span>}
    </>
  );
}

export function SeqView({ seq, cards }: { seq: Act[]; cards: Record<number, ItemCard> }) {
  const { lead, rows } = seqRows(seq);
  return (
    <div className="mt-1.5 text-[11px]">
      {lead.map((a, n) => (
        <p key={n} className="text-dim mb-1"><WithItems text={a.text ?? ''} cards={cards} /><ActItems act={a} cards={cards} /></p>
      ))}
      <ol className="space-y-1">
        {rows.map(r => (
          <li key={r.n} className={`flex gap-1.5 ${r.act.kind === 'zone' ? 'border-l-2 border-gold/70 bg-gold/5 pl-1.5 py-0.5' : ''}`}>
            <span className="text-dim shrink-0 w-4 text-right">{r.n}.</span>
            <div className="min-w-0">
              <ActLine act={r.act} cards={cards} />
              {r.gets.map((g, k) => (
                <span key={k}><span className="text-gold"> → </span><span className="text-dim">get</span> <GetBits act={g} cards={cards} /></span>
              ))}
              {r.notes.map((a, k) => (
                <div key={k} className="text-dim mt-0.5"><WithItems text={a.text ?? ''} cards={cards} />{a.items && a.items.length > 0 && <> <ActItems act={a} cards={cards} /></>}</div>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// A quest chain (the guild lead, 2026-09-28: "show the first item that seems to be required …
// the full quest chain with minimize sections … Highlight stages where you will have
// input/output"). The first item stays in view; the hand-ins (item in → item out, gold) and
// the story fold away. `skipHandins`: the step's seq already lists them in order (SeqView above), so the
// folded copy would only repeat them.
export function ChainView({ chain, cards, skipHandins }: { chain: Chain; cards: Record<number, ItemCard>; skipHandins?: boolean }) {
  return (
    <div className="mt-2 space-y-1.5 text-[11px]">
      <div className="rounded border border-gold/60 bg-gold/10 px-2 py-1.5">
        <div className="text-gold text-[10px] uppercase tracking-wide">Start here</div>
        <p className="text-text"><WithItems text={chain.first.text} cards={cards} /></p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          📍 <Place at={chain.first.at} />
          {(chain.first.say ?? []).map(t => <CopyChip key={t} text={sayCommand({ text: t })} />)}
        </div>
        {chain.first.fetch && <div className="mt-1">📖 <Place at={chain.first.fetch} /></div>}
      </div>
      {!skipHandins && (
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
      )}
      <details className="rounded border border-border px-2 py-1">
        <summary className="cursor-pointer text-dim">Optional: the story, from {chain.talk[0]?.at.npc ?? 'the start'} · {chain.talk.length}</summary>
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
        {item.seq && item.seq.length > 0 ? <SeqView seq={item.seq} cards={cards} /> : item.says && item.says.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[11px]">
            {item.says.map((s, n) => (
              <span key={n} className="inline-flex flex-wrap items-center gap-1 min-w-0 max-w-full">
                {(n === 0 || item.says![n - 1].to !== s.to) && <span className="text-dim">to {s.to}:</span>}
                {s.sit && <><span className="text-gold">sit first</span><CopyChip text="/sit" /></>}
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
        {item.chain && <ChainView chain={item.chain} cards={cards} skipHandins={!!item.seq} />}
      </div>
    </li>
  );
}
