'use client';

// MissingSpellsView — the missing-spells list with per-spell "where from"
// dropdowns, Expand all, and the zone-by-zone 🛒 Shopping list mode (Hitya
// 2026-08-18). Sources come pre-resolved from OUR mirror via
// spell_scroll_sources — PQDI is the escape hatch, not the answer.

import { useMemo, useState } from 'react';
import { tierForLevel } from '@/lib/popSpells';
import type { ItemSources } from '@/lib/spellSources';
import { shoppingList, type MissingForShopping } from '@/lib/spellSources';
import SpellLevelEditor from './SpellLevelEditor';

export type MissingSpellRow = {
  spell_name: string;
  scroll_item_id: number | null;
  spell_id: number | null;
  scribe_level: number | null;
  held_by: string[];
  buyable: boolean;
  pop: boolean;
};

const zoneLabel = (z: { short: string | null; long: string | null }) => z.long || z.short || 'unknown zone';

function SourcePanel({ src, itemId }: { src: ItemSources | undefined; itemId: number | null }) {
  const pqdi = itemId ? `https://www.pqdi.cc/item/${itemId}` : null;
  const merchants = src?.merchants ?? [];
  const drops = src?.drops ?? [];
  return (
    <div className="ml-7 mt-1 mb-2 text-xs border-l-2 border-border/60 pl-3 space-y-1">
      {merchants.length > 0 && (
        <div>
          <span className="text-[10px] text-orange uppercase tracking-wide">🛒 Sold by</span>
          <ul className="mt-0.5 space-y-0.5">
            {merchants.slice(0, 8).map(v => (
              <li key={`${v.npcId}-${v.name}`} className="text-text">
                {v.name}
                <span className="text-dim"> — {v.zones.length ? v.zones.map(zoneLabel).join(', ') : 'spawn spot unknown'}</span>
              </li>
            ))}
            {merchants.length > 8 && <li className="text-dim">…and {merchants.length - 8} more vendors</li>}
          </ul>
        </div>
      )}
      {drops.length > 0 && (
        <div>
          <span className="text-[10px] text-purple uppercase tracking-wide">⚔ Drops from</span>
          <ul className="mt-0.5 space-y-0.5">
            {drops.slice(0, 6).map(d => (
              <li key={`${d.npcId}-${d.name}`} className="text-text">
                {d.name}
                <span className="text-dim"> — {d.zones.length ? d.zones.map(zoneLabel).join(', ') : 'zone unknown'}</span>
              </li>
            ))}
            {drops.length > 6 && <li className="text-dim">…and {drops.length - 6} more droppers</li>}
          </ul>
        </div>
      )}
      {merchants.length === 0 && drops.length === 0 && (
        <div className="text-dim italic">
          No vendor or drop on record in our mirror — likely quest or research.
        </div>
      )}
      {pqdi && (
        <a href={pqdi} target="_blank" rel="noreferrer" className="text-blue text-[10px] hover:underline inline-block">
          cross-check on PQDI ↗
        </a>
      )}
    </div>
  );
}

export default function MissingSpellsView({
  missing, sources, officer, character,
}: {
  missing: MissingSpellRow[];
  sources: Record<number, ItemSources>;
  officer: boolean;
  character: string;
}) {
  const [mode, setMode] = useState<'levels' | 'shopping'>('levels');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [allOpen, setAllOpen] = useState(false);

  const sourceMap = useMemo(() => {
    const m = new Map<number, ItemSources>();
    for (const [k, v] of Object.entries(sources)) m.set(Number(k), v);
    return m;
  }, [sources]);

  const byLevel = useMemo(() => {
    const groups = new Map<number | 'unknown', MissingSpellRow[]>();
    for (const m of missing) {
      const k: number | 'unknown' = m.scribe_level ?? 'unknown';
      const arr = groups.get(k) ?? [];
      arr.push(m);
      groups.set(k, arr);
    }
    const keys = [...groups.keys()].sort((a, b) => {
      if (a === 'unknown') return 1;
      if (b === 'unknown') return -1;
      return (a as number) - (b as number);
    });
    return { groups, keys };
  }, [missing]);

  const shopping = useMemo(
    () => shoppingList(missing as MissingForShopping[], sourceMap),
    [missing, sourceMap],
  );

  const isOpen = (name: string) => allOpen || open.has(name);
  const toggle = (name: string) => setOpen(prev => {
    const next = new Set(prev);
    if (allOpen) return next;          // individual toggles are moot while all-open
    next.has(name) ? next.delete(name) : next.add(name);
    return next;
  });

  const btn = (active: boolean) =>
    `px-2 py-1 rounded text-xs border cursor-pointer ${active ? 'bg-blue/20 border-blue/60 text-blue' : 'border-border text-dim hover:text-text'}`;

  return (
    <div>
      {/* Mode + expand controls — the "expand all at the top" ask. */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button className={btn(mode === 'levels')} onClick={() => setMode('levels')}>By level</button>
        <button className={btn(mode === 'shopping')} onClick={() => setMode('shopping')}>🛒 Shopping list</button>
        {mode === 'levels' && (
          <button
            className={btn(allOpen)}
            onClick={() => { setAllOpen(v => !v); setOpen(new Set()); }}
          >
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>

      {mode === 'levels' ? (
        <div className="space-y-5">
          {byLevel.keys.map(lk => {
            const rows = byLevel.groups.get(lk)!;
            return (
              <div key={String(lk)}>
                <h3 className="text-sm text-orange mb-1.5">
                  {lk === 'unknown' ? 'Level unknown' : `Level ${lk}`}
                  <span className="text-dim font-normal"> · {rows.length}</span>
                  {lk === 'unknown' && officer && (
                    <span className="text-dim font-normal text-[10px]"> · type a level to file it (applies guild-wide)</span>
                  )}
                </h3>
                <ul className="text-sm space-y-0">
                  {rows.map(m => (
                    <li key={m.spell_name}>
                      <div className="flex items-baseline gap-2">
                        <span title={m.buyable ? 'Sold by a vendor' : 'Not sold — quest / drop / planar'}>
                          {m.buyable ? '🛒' : '⚔'}
                        </span>
                        <button
                          onClick={() => toggle(m.spell_name)}
                          className={`${m.pop ? 'text-dim' : 'text-text'} hover:text-blue text-left`}
                          title="Show where this comes from"
                        >
                          {m.spell_name} <span className="text-dim text-[10px]">{isOpen(m.spell_name) ? '▾' : '▸'}</span>
                        </button>
                        {m.pop && (() => {
                          // Name the TURN-IN, not just the era: a PoP spell is
                          // bought with a parchment whose tier follows the
                          // spell's level (web/lib/popSpells.ts).
                          const t = tierForLevel(m.scribe_level);
                          return (
                            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-blue/20 border border-blue/60 text-blue"
                                  title={t
                                    ? `${t.blurb} Hand a ${t.item} to your class's spell NPC — the spell you get is random from that tier.`
                                    : "Planes of Power — locked until Oct 1. Can't scribe it yet."}>
                              {t ? `PoP · ${t.item}` : 'PoP'}
                            </span>
                          );
                        })()}
                        {m.held_by.length > 0 && (
                          <span className="text-green text-[10px]" title="A guildmate is holding this scroll">
                            🎒 {m.held_by.join(', ')}
                          </span>
                        )}
                        {officer && lk === 'unknown' && m.spell_id && (
                          <SpellLevelEditor spellId={m.spell_id} character={character} />
                        )}
                      </div>
                      {isOpen(m.spell_name) && (
                        <SourcePanel src={m.scroll_item_id ? sourceMap.get(m.scroll_item_id) : undefined} itemId={m.scroll_item_id} />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-5">
          {shopping.zones.length === 0 && (
            <p className="text-sm text-dim italic">
              No vendor data resolved yet — vendor→zone rows land with the weekly catalog sync. Drops and quests live under each spell in the By-level view.
            </p>
          )}
          {shopping.zones.map(z => (
            <div key={z.zoneShort}>
              <h3 className="text-sm text-orange mb-1.5">
                📍 {z.zoneLong}
                <span className="text-dim font-normal"> · {z.spells.length} spell{z.spells.length === 1 ? '' : 's'}</span>
                {z.exclusives > 0 && (
                  <span className="ml-2 text-[9px] font-bold px-1 py-0.5 rounded bg-orange/20 border border-orange/60 text-orange"
                        title={`${z.exclusives} of these are sold ONLY in this zone — you have to come here.`}>
                    {z.exclusives} only here
                  </span>
                )}
              </h3>
              <ul className="text-sm space-y-0.5">
                {z.spells.map(s => (
                  <li key={s.spellName} className="flex items-baseline gap-2">
                    <span className={s.pop ? 'text-dim' : 'text-text'}>
                      {s.spellName}
                      {s.level != null && <span className="text-dim text-[10px]"> · L{s.level}</span>}
                    </span>
                    {s.onlyHere && (
                      <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-orange/20 border border-orange/60 text-orange"
                            title="Sold only in this zone.">only here</span>
                    )}
                    {s.pop && (() => {
                      const t = tierForLevel(s.level ?? null);
                      return (
                        <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-blue/20 border border-blue/60 text-blue"
                              title={t ? t.blurb : 'Planes of Power'}>
                          {t ? `PoP · ${t.item}` : 'PoP'}
                        </span>
                      );
                    })()}
                    <span className="text-dim text-[10px]">{s.vendors.slice(0, 3).join(', ')}{s.vendors.length > 3 ? ` +${s.vendors.length - 3}` : ''}</span>
                    {s.heldBy.length > 0 && <span className="text-green text-[10px]">🎒 {s.heldBy.join(', ')}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {shopping.noVendor.length > 0 && (
            <div>
              <h3 className="text-sm text-purple mb-1.5">⚔ No vendor — quest, drop, or research <span className="text-dim font-normal">· {shopping.noVendor.length}</span></h3>
              <p className="text-xs text-dim mb-1">Open these in the By-level view for their droppers.</p>
              <ul className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
                {shopping.noVendor.map(m => (
                  <li key={m.spell_name} className={m.pop ? 'text-dim' : 'text-text'}>
                    {m.spell_name}{m.scribe_level != null && <span className="text-dim text-[10px]"> · L{m.scribe_level}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
