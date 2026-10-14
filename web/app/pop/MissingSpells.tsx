// "Your PoP spells still needed" on /pop My Characters (the guild lead, 2026-10-14). A native <details>, closed:
// the summary is the one-line totals, and opening it lists, per character, every spell still missing with a PQDI
// link, its level, the scroll that buys it, a line on what it does, and a copy button for the plain list. Server
// component (no client JS of its own; the copy button is the shared CopyChip). The rules live in
// web/lib/popMissingSpells.ts.

import Link from 'next/link';
import CopyChip from '@/components/CopyChip';
import {
  copyLines, missingRows, missingTotals, pqdiSpellUrl, spellBlurb, totalsText,
  type MissingChar, type SpellInfo,
} from '@/lib/popMissingSpells';

const TIER_CLS: Record<string, string> = {
  Ethereal: 'text-orange', Spectral: 'text-orange', 'Rune Word': 'text-orange', Other: 'text-purple',
};

export default function MissingSpells({ chars, info }: { chars: MissingChar[]; info: Map<number, SpellInfo> }) {
  const totals = missingTotals(chars);
  return (
    <details className="bg-bg/40 border border-border/60 rounded min-w-0 max-w-full">
      <summary className="cursor-pointer select-none px-3 py-3 text-sm text-text hover:text-gold min-h-[44px] flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{totalsText(totals)}</span>
        <span className="text-xs text-blue ml-auto">▾ the list, what each does, PQDI links, copy</span>
      </summary>
      <div className="px-3 pb-3 space-y-5">
        {chars.map(n => {
          const rows = missingRows(n);
          const lines = copyLines(n);
          return (
            <section key={n.name} aria-label={`${n.name}: spells still needed`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 border-b border-border/60">
                <Link href={`/character/${encodeURIComponent(n.name)}/spells`} className="text-blue hover:underline text-sm">{n.name}</Link>
                {!n.isMain && <span className="text-[10px] text-dim">alt</span>}
                <span className="text-xs text-dim">{n.cls ?? '—'}{n.level ? ` · level ${n.level}` : ''}</span>
                <span className="text-xs text-text">{n.total} still needed</span>
                <span className="ml-auto flex flex-wrap items-center gap-1.5">
                  {lines.map((line, i) => (
                    <CopyChip key={i} text={line}
                              label={lines.length === 1 ? 'Copy list' : `Copy ${i + 1}/${lines.length}`} />
                  ))}
                </span>
              </div>
              <ul className="divide-y divide-border/40">
                {rows.map((r, i) => {
                  const blurb = r.id ? spellBlurb(info.get(r.id)) : '';
                  return (
                    <li key={`${r.id ?? r.name}-${i}`}
                        className="py-2 grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,15rem)_3.5rem_6rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm leading-6 items-baseline">
                      <span className="min-w-0 break-words">
                        {r.id
                          ? <a href={pqdiSpellUrl(r.id)} target="_blank" rel="noreferrer" className="text-text hover:text-blue hover:underline">{r.name}<span className="text-dim"> ↗</span></a>
                          : <span className="text-text">{r.name}</span>}
                      </span>
                      <span className="text-xs text-dim sm:text-right">{r.level ? `L${r.level}` : '—'}</span>
                      <span className={`text-xs ${TIER_CLS[r.tierLabel] ?? 'text-dim'} col-start-1 sm:col-start-auto`}>{r.tierLabel}</span>
                      <span className="text-xs text-dim col-span-2 sm:col-span-1 sm:col-start-auto min-w-0 break-words">{blurb || '—'}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        <p className="text-[11px] text-dim leading-5">
          Ethereal, Spectral and Rune Word are the parchments you turn in to your class trainer for a random spell from
          that list; Other is not on this class&apos;s turn-in lists (research, or another class&apos;s scroll). Levels and
          descriptions come from the spell catalog where it has them. Names open on PQDI.
        </p>
      </div>
    </details>
  );
}
