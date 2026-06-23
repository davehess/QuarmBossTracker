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

export type ItemCard = {
  item_id: number;
  name: string;
  lore: string | null;
  nodrop: boolean | null;
  magic: boolean | null;
  itemtype: number | null;
  slots: number | null;            // bitmask of EQ wearable slots
  classes: number | null;          // bitmask
  races: number | null;            // bitmask
  required_level: number | null;
  recommended_level: number | null;
  ac: number | null;
  hp: number | null;
  mana: number | null;
  damage: number | null;
  delay: number | null;
  attack: number | null;
  haste: number | null;
  mr: number | null;
  cr: number | null;
  dr: number | null;
  fr: number | null;
  pr: number | null;
  weight: number | null;
  price: number | null;
  clickeffect: number | null;
  clicktype: number | null;
  clicklevel: number | null;
};

// Class bit → 3-letter tag. Mirrors the in-game order. (Berserker omitted —
// post-PoP and not on Quarm.)
const CLASS_TAGS: [number, string][] = [
  [1,'WAR'],[2,'CLR'],[4,'PAL'],[8,'RNG'],[16,'SHD'],
  [32,'DRU'],[64,'MNK'],[128,'BRD'],[256,'ROG'],[512,'SHM'],
  [1024,'NEC'],[2048,'WIZ'],[4096,'MAG'],[8192,'ENC'],[16384,'BST'],
];
const ALL_CLASS_MASK = CLASS_TAGS.reduce((s, [b]) => s | b, 0);

// Race bits per EQ standard. Half-Elf is the union of Human + Elf historically;
// items show the explicit combined bit. We render "ALL" when every race is set.
const RACE_TAGS: [number, string][] = [
  [1,'HUM'],[2,'BAR'],[4,'ERU'],[8,'ELF'],[16,'HIE'],
  [32,'DEF'],[64,'HEL'],[128,'DWF'],[256,'TRL'],[512,'OGR'],
  [1024,'HFL'],[2048,'GNM'],[4096,'IKS'],[8192,'VAH'],[16384,'FRG'],
];
const ALL_RACE_MASK = RACE_TAGS.reduce((s, [b]) => s | b, 0);

// EQ wearable slot bits (subset that actually appears on gear). Used to tell
// "1HS Sword (Primary)" from "1HS Sword (Primary/Secondary)" without depending
// on the (separately-mirrored) item_with_proc view.
const SLOT_TAGS: [bigint, string][] = [
  [1n,'Charm'],[2n,'Ear'],[4n,'Head'],[8n,'Face'],[16n,'Neck'],
  [32n,'Shoulders'],[64n,'Arms'],[128n,'Back'],[256n,'Wrist'],[512n,'Range'],
  [1024n,'Hands'],[2048n,'Primary'],[4096n,'Secondary'],[8192n,'Fingers'],
  [16384n,'Chest'],[32768n,'Legs'],[65536n,'Feet'],[131072n,'Waist'],
  [262144n,'Power Source'],[524288n,'Ammo'],
];

function decodeMask(mask: number | null, tags: [number, string][], allMask: number, allLabel = 'ALL'): string {
  if (mask == null || mask === 0) return '—';
  if ((mask & allMask) === allMask) return allLabel;
  const hits = tags.filter(([b]) => (mask & b) > 0).map(([, t]) => t);
  return hits.length ? hits.join(' ') : '—';
}
function decodeSlots(slots: number | null): string {
  if (slots == null || slots === 0) return '—';
  const big = BigInt(slots);
  const hits = SLOT_TAGS.filter(([b]) => (big & b) > 0n).map(([, t]) => t);
  return hits.length ? hits.join(' / ') : '—';
}

// EQ price is in copper. Render as platinum when ≥1000 pp, gold otherwise.
function fmtPrice(cp: number | null): string {
  if (cp == null || cp <= 0) return '—';
  const pp = Math.floor(cp / 1000);
  if (pp >= 1) return `${pp.toLocaleString()} pp`;
  const gp = Math.floor(cp / 100);
  if (gp >= 1) return `${gp} gp`;
  return `${cp} cp`;
}

export default function ItemHover({ card, fallbackName, className, children }: {
  card?: ItemCard;
  fallbackName: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  const tipId = useId();
  const pqdiHref = card ? `https://pqdi.cc/item/${card.item_id}` : `https://pqdi.cc/search?term=${encodeURIComponent(fallbackName)}`;
  return (
    <span ref={ref} className={`relative inline-block ${className ?? ''}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
      aria-describedby={open ? tipId : undefined}
    >
      {children}
      {open && (
        <div
          id={tipId}
          role="tooltip"
          className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 z-50 w-64 max-w-[16rem] bg-bg border border-blue/70 rounded p-2.5 shadow-xl text-[11px] text-left pointer-events-auto"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <div className="flex items-baseline gap-2">
            <span className="text-text font-medium leading-tight">{card?.name ?? fallbackName}</span>
            {card?.nodrop && <span className="text-[9px] text-gold uppercase tracking-wider">NO DROP</span>}
            {card?.magic  && <span className="text-[9px] text-blue uppercase tracking-wider">MAGIC</span>}
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
              {!!card.clickeffect && (
                <Row k="Clicky">
                  <a href={`https://pqdi.cc/spell/${card.clickeffect}`} target="_blank" rel="noreferrer" className="text-blue hover:underline">
                    spell #{card.clickeffect}
                  </a>
                  {!!card.clicklevel && <span className="text-dim"> (L{card.clicklevel})</span>}
                </Row>
              )}
              {(!!card.weight || !!card.price) && (
                <Row k="Wt / Sell">{`${card.weight ?? '?'} st · ${fmtPrice(card.price)}`}</Row>
              )}
            </div>
          )}
          <div className="mt-2 pt-1.5 border-t border-border/60 text-[10px] flex justify-between">
            <a href={pqdiHref} target="_blank" rel="noreferrer" className="text-blue hover:underline">PQDI ↗</a>
            <span className="text-dim/70">stats-only · v1</span>
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
