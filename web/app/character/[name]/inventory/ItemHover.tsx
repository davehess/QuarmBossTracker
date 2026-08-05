'use client';

// Stats-only item hover card for the inventory page (Uilnayar 2026-06-23:
// "hover-over that shows an item card like we get in game"). No icon in v1 —
// eqemu_items.icon is a numeric index into the EQ gequip*.png sprite atlas we
// don't host yet. Once we mirror the sprite, the icon slot at the top of the
// card swaps in without changing any of the data flow.
//
// Display gracefully degrades:
//   • If the item id resolved (card != null), render full stats.
//   • If only fallbackName arrived (id was null on the inventory row), render
//     name + "no detail mirrored" + a PQDI search link.
//
// Implementation is a CSS-positioned popover that toggles via mouseenter +
// focus. No portal, no library — keeps the page server-rendered everywhere
// except this one tooltip surface.

import { useId, useRef, useState } from 'react';
import ItemIcon from './ItemIcon';
import WpDbLink from '@/components/WpDbLink';

// Decoders now come from the shared module. This file used to carry its own
// copies, and its SLOT table was missing EQ's paired slot bits (both ears,
// both wrists, both fingers) — which shifted everything above Neck by three
// and made Journeyman's Boots (FEET) read as "Ammo". Same table, same bug, two
// places; folded onto one so a fix can't land in only half of them.
import {
  type ItemCard, decodeMask, decodeSlots, fmtPrice, fmtWeight,
  CLASS_TAGS, RACE_TAGS, ALL_CLASS_MASK, ALL_RACE_MASK, isNoDrop,
} from '@/lib/itemDecode';

export type { ItemCard };

export default function ItemHover({ card, fallbackName, className, children }: {
  card?: ItemCard;
  fallbackName: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipId = useId();
  const pqdiHref = card ? `https://pqdi.cc/item/${card.item_id}` : `https://pqdi.cc/search?term=${encodeURIComponent(fallbackName)}`;

  // Close on a short delay so the cursor can travel from the item up to the
  // tooltip (crossing the small gap) without it vanishing — that gap was the
  // reason the PQDI link inside couldn't be clicked. Any enter cancels it.
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const openNow = () => { cancelClose(); setOpen(true); };
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 180); };

  return (
    <span className={`relative inline-block ${className ?? ''}`}
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
      onFocus={openNow}
      onBlur={scheduleClose}
      tabIndex={0}
      aria-describedby={open ? tipId : undefined}
    >
      {children}
      {open && (
        <div
          id={tipId}
          role="tooltip"
          // pt-1.5 (padding, not margin) keeps the gap visually but as part of
          // the hover target, so the cursor never crosses dead space.
          className="absolute left-1/2 -translate-x-1/2 bottom-full pt-1.5 z-50 w-64 max-w-[16rem] text-[11px] text-left pointer-events-auto"
          onMouseEnter={openNow}
          onMouseLeave={scheduleClose}
        >
        <div className="bg-bg border border-blue/70 rounded p-2.5 shadow-xl">
          <div className="flex items-start gap-2">
            {card?.icon ? <ItemIcon icon={card.icon} alt={card.name} size={32} className="shrink-0 rounded-sm border border-border/60" /> : null}
            <div className="min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-text font-medium leading-tight">{card?.name ?? fallbackName}</span>
                {isNoDrop(card) && <span className="text-[9px] text-gold uppercase tracking-wider">NO DROP</span>}
                {card?.magic  && <span className="text-[9px] text-blue uppercase tracking-wider">MAGIC</span>}
              </div>
            </div>
          </div>
          {card?.lore && card.lore !== card.name && (
            <div className="text-purple/90 text-[10px] mt-0.5">Lore: {card.lore}</div>
          )}
          {!card && (
            <p className="text-dim text-[10px] mt-1 italic">Item id not in our mirror — open PQDI for details.</p>
          )}
          {card && (
            <div className="mt-2 space-y-1">
              <Row k="Slot">{decodeSlots(card.slots)}</Row>
              {!!card.ac    && <Row k="AC">{card.ac}</Row>}
              {!!card.hp    && <Row k="HP" tone={card.hp > 0 ? 'good' : 'bad'}>{card.hp > 0 ? `+${card.hp}` : card.hp}</Row>}
              {!!card.mana  && <Row k="Mana" tone={card.mana > 0 ? 'good' : 'bad'}>{card.mana > 0 ? `+${card.mana}` : card.mana}</Row>}
              {!!card.damage && <Row k="Damage">{card.damage}</Row>}
              {!!card.delay  && <Row k="Delay">{card.delay}</Row>}
              {!!card.attack && <Row k="Atk" tone="good">+{card.attack}</Row>}
              {!!card.haste  && <Row k="Haste" tone="good">+{card.haste}%</Row>}
              {(card.mr || card.cr || card.dr || card.fr || card.pr) ? (
                <Row k="Resists">
                  {[
                    card.mr && `MR ${card.mr}`,
                    card.cr && `CR ${card.cr}`,
                    card.dr && `DR ${card.dr}`,
                    card.fr && `FR ${card.fr}`,
                    card.pr && `PR ${card.pr}`,
                  ].filter(Boolean).join(' · ')}
                </Row>
              ) : null}
              <Row k="Class">{decodeMask(card.classes, CLASS_TAGS, ALL_CLASS_MASK)}</Row>
              <Row k="Race">{decodeMask(card.races, RACE_TAGS, ALL_RACE_MASK)}</Row>
              {!!card.required_level && <Row k="Req">{card.required_level}</Row>}
              {!!card.recommended_level && <Row k="Rec">{card.recommended_level}</Row>}
              {card.clickeffect != null && card.clickeffect > 0 && (
                <Row k="Clicky">
                  <a href={`https://pqdi.cc/spell/${card.clickeffect}`} target="_blank" rel="noreferrer" className="text-blue hover:underline">
                    spell #{card.clickeffect}
                  </a>
                  <WpDbLink kind="spell" id={card.clickeffect} />
                  {!!card.clicklevel && <span className="text-dim"> (L{card.clicklevel})</span>}
                </Row>
              )}
              {(!!card.weight || !!card.price) && (
                <Row k="Wt / Sell">{`${fmtWeight(card.weight)} st · ${fmtPrice(card.price)}`}</Row>
              )}
            </div>
          )}
          <div className="mt-2 pt-1.5 border-t border-border/60 text-[10px] flex justify-between">
            <span>
              <a href={pqdiHref} target="_blank" rel="noreferrer" className="text-blue hover:underline">PQDI ↗</a>
              {card && <WpDbLink kind="item" id={card.item_id} />}
            </span>
            <span className="text-dim/70">stats-only · v1</span>
          </div>
        </div>
        </div>
      )}
    </span>
  );
}

function Row({ k, children, tone }: { k: string; children: React.ReactNode; tone?: 'good' | 'bad' }) {
  const v = tone === 'good' ? 'text-green' : tone === 'bad' ? 'text-red-400' : 'text-text';
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-dim text-[10px] uppercase tracking-wide">{k}</span>
      <span className={`text-right ${v}`}>{children}</span>
    </div>
  );
}
