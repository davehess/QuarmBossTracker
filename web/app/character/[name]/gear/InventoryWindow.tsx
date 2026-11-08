'use client';

// The gear page's inventory window: the equipped items drawn as icons in the slot positions of an in-game skin
// (web/lib/inventorySkins.ts holds the skin maps). Equipment only: the page has no bag-top rows and no coin data, so
// neither is drawn.
//
// Which skin: `?skin=<id>` wins for one view; otherwise the viewer's saved default; otherwise Classic. The default is
// kept in this browser's localStorage (no per-member preference store exists on the site; DECISIONS 2026-11-03), so
// every access is guarded and the window renders Classic when storage is unavailable.
//
// The numbers are the gear page's own sums (worn gear only), passed in; this component never recomputes them.

import { useEffect, useState } from 'react';
import ItemIcon from '../inventory/ItemIcon';
import {
  SKINS, DEFAULT_SKIN, SLOT_LABEL, ATTR_KEYS, ATTR_LABEL, RESIST_KEYS, RESIST_LABEL, RESIST_COLOUR,
  skinById, type SkinId, type SlotId,
} from '@/lib/inventorySkins';

export type WornSlot = { itemId: number; name: string; icon: number | null };
export type WindowStats = {
  ac: number; hp: number; atk: number;
  attrs: Record<string, number>;
  resists: Record<string, number>;
};

const STORE_KEY = 'wp.inventorySkin';
const readDefault = (): SkinId | null => {
  try { return skinById(window.localStorage.getItem(STORE_KEY))?.id ?? null; } catch { return null; }
};

export default function InventoryWindow({ charName, className, worn, stats, urlSkin }: {
  charName: string;
  className: string | null;
  worn: Partial<Record<SlotId, WornSlot>>;
  stats: WindowStats;
  urlSkin: string | null;
}) {
  const fromUrl = skinById(urlSkin)?.id ?? null;
  const [skinId, setSkinId] = useState<SkinId>(fromUrl ?? DEFAULT_SKIN);
  const [saved, setSaved] = useState<SkinId | null>(null);

  useEffect(() => {
    const d = readDefault();
    setSaved(d);
    if (!fromUrl && d) setSkinId(d);
  }, [fromUrl]);

  const skin = skinById(skinId) ?? SKINS[0];
  const makeDefault = () => {
    try { window.localStorage.setItem(STORE_KEY, skin.id); setSaved(skin.id); } catch { /* storage blocked: stays a one-view choice */ }
  };

  const statsBlock = (
    <div className="text-xs min-w-[8.5rem] space-y-2" aria-label="Stats from worn gear only">
      <div>
        <div className="text-gold text-sm">{charName}</div>
        {className && <div className="text-dim">{className}</div>}
      </div>
      <div className="space-y-0.5">
        {([['HP', stats.hp], ['AC', stats.ac], ['ATK', stats.atk]] as const).map(([l, v]) => (
          <div key={l} className="flex justify-between gap-3"><span className="text-dim">{l}</span><span className="text-text">{v}</span></div>
        ))}
      </div>
      <div className="space-y-0.5">
        {ATTR_KEYS.map(k => (
          <div key={k} className="flex justify-between gap-3">
            <span className="text-dim">{ATTR_LABEL[skin.statsStyle][k]}</span><span className="text-text">{stats.attrs[k] ?? 0}</span>
          </div>
        ))}
      </div>
      <div className="space-y-0.5">
        {RESIST_KEYS.map(k => (
          <div key={k} className="flex justify-between gap-3">
            <span className={RESIST_COLOUR[k]}>{RESIST_LABEL[skin.statsStyle][k]}</span><span className="text-text">{stats.resists[k] ?? 0}</span>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-dim leading-4">From worn gear only, not in-game totals.</div>
    </div>
  );

  const slotGrid = (
    <div
      role="group"
      aria-label={`${charName} equipped items, ${skin.name} layout`}
      className="grid gap-1 content-start"
      style={{ gridTemplateColumns: `repeat(${skin.cols}, 40px)`, gridAutoRows: '40px' }}
    >
      {skin.figure && (
        <div
          aria-hidden="true"
          className="border border-border rounded bg-bg/60 flex items-center justify-center text-center text-[10px] text-dim p-1"
          style={{ gridColumn: `${skin.figure.col} / span ${skin.figure.colSpan}`, gridRow: `${skin.figure.row} / span ${skin.figure.rowSpan}` }}
        >
          {className ?? ''}
        </div>
      )}
      {skin.cells.map(c => {
        const w = worn[c.slot];
        const label = SLOT_LABEL[c.slot];
        const pos = { gridColumn: c.col, gridRow: c.row };
        return w ? (
          <a
            key={c.slot}
            href={`https://www.pqdi.cc/item/${w.itemId}`}
            target="_blank"
            rel="noreferrer"
            title={w.name}
            style={pos}
            className="flex items-center justify-center border border-border rounded bg-bg hover:border-gold"
          >
            <ItemIcon icon={w.icon} alt="" size={36} />
            <span className="sr-only">{label}: {w.name}</span>
          </a>
        ) : (
          <div
            key={c.slot}
            style={pos}
            className="flex items-center justify-center border border-border/60 rounded bg-bg/40 text-[9px] leading-3 text-dim text-center px-0.5"
          >
            <span aria-hidden="true">{label}</span>
            <span className="sr-only">{label}: empty</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <section className="bg-panel border border-border rounded-lg p-4" aria-label="Inventory window">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm text-orange">Inventory</h3>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Window layout" className="inline-flex rounded border border-border overflow-hidden text-xs">
            {SKINS.map(s => (
              <button
                key={s.id}
                type="button"
                aria-pressed={s.id === skin.id}
                onClick={() => setSkinId(s.id)}
                className={`px-2 py-1 border-r border-border last:border-r-0 ${s.id === skin.id ? 'bg-accent/30 text-text' : 'text-dim hover:text-text'}`}
              >
                {s.name}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={makeDefault}
            disabled={saved === skin.id}
            className="px-2 py-1 rounded border border-border text-xs text-blue hover:border-blue disabled:text-dim disabled:hover:border-border"
          >
            {saved === skin.id ? '✓ Your default' : 'Make default'}
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="inline-flex gap-4 items-start border border-border rounded bg-bg/50 p-3">
          {skin.statsSide === 'left' && statsBlock}
          {slotGrid}
          {skin.statsSide === 'right' && statsBlock}
        </div>
      </div>
    </section>
  );
}
