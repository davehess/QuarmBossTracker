// Shared item-card decoders for wpqdi + any other server surface that renders
// an eqemu_items stat block. The item_card_info RPC returns the ItemCard shape;
// these turn its bitmask/price fields into display text.
//
// NOTE: web/app/character/[name]/inventory/ItemHover.tsx has parallel PRIVATE
// copies of these tables/functions (it predates this module). They describe
// immutable EQ game constants (class/race/slot bits never change), so the
// duplication is low-risk; fold ItemHover onto this module in a later cleanup.

export type ItemCard = {
  item_id: number;
  name: string;
  lore: string | null;
  icon: number | null;
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

// Class bit → 3-letter tag, in-game order. (Berserker omitted — post-PoP.)
export const CLASS_TAGS: [number, string][] = [
  [1,'WAR'],[2,'CLR'],[4,'PAL'],[8,'RNG'],[16,'SHD'],
  [32,'DRU'],[64,'MNK'],[128,'BRD'],[256,'ROG'],[512,'SHM'],
  [1024,'NEC'],[2048,'WIZ'],[4096,'MAG'],[8192,'ENC'],[16384,'BST'],
];
export const ALL_CLASS_MASK = CLASS_TAGS.reduce((s, [b]) => s | b, 0);

export const RACE_TAGS: [number, string][] = [
  [1,'HUM'],[2,'BAR'],[4,'ERU'],[8,'ELF'],[16,'HIE'],
  [32,'DEF'],[64,'HEL'],[128,'DWF'],[256,'TRL'],[512,'OGR'],
  [1024,'HFL'],[2048,'GNM'],[4096,'IKS'],[8192,'VAH'],[16384,'FRG'],
];
// Froglok (16384) is the 15th race and isn't playable everywhere, so an
// "all races" item is commonly 16383 (the classic 14) rather than the full
// 32767. Treat either as ALL — otherwise a plain all-race item spells out
// fourteen tags, which is exactly what the in-game card avoids.
export const ALL_RACE_MASK = RACE_TAGS.reduce((s, [b]) => s | b, 0);
export const CLASSIC_RACE_MASK = ALL_RACE_MASK & ~16384;

// EQ wearable slot bits — the REAL layout. EQ gives the paired slots (both
// ears, both wrists, both fingers) their own bit each, and an earlier version
// of this table omitted those duplicates, which shifted every slot above Neck
// by three positions: Journeyman's Boots (slots=524288, FEET) rendered as
// "Ammo". Duplicate labels are collapsed at display time, so an item usable in
// either ear reads "EAR", not "EAR EAR".
export const SLOT_TAGS: [bigint, string][] = [
  [1n,'CHARM'],[2n,'EAR'],[4n,'HEAD'],[8n,'FACE'],[16n,'EAR'],[32n,'NECK'],
  [64n,'SHOULDERS'],[128n,'ARMS'],[256n,'BACK'],[512n,'WRIST'],[1024n,'WRIST'],
  [2048n,'RANGE'],[4096n,'HANDS'],[8192n,'PRIMARY'],[16384n,'SECONDARY'],
  [32768n,'FINGER'],[65536n,'FINGER'],[131072n,'CHEST'],[262144n,'LEGS'],
  [524288n,'FEET'],[1048576n,'WAIST'],[2097152n,'AMMO'],
];
const ALL_SLOT_MASK = SLOT_TAGS.reduce((s, [b]) => s | b, 0n);

export function decodeMask(mask: number | null, tags: [number, string][], allMask: number, allLabel = 'ALL'): string {
  if (mask == null || mask === 0) return '—';
  if ((mask & allMask) === allMask) return allLabel;
  // Races: the classic-14 mask counts as ALL too (see CLASSIC_RACE_MASK).
  if (allMask === ALL_RACE_MASK && (mask & CLASSIC_RACE_MASK) === CLASSIC_RACE_MASK) return allLabel;
  const hits = tags.filter(([b]) => (mask & b) > 0).map(([, t]) => t);
  return hits.length ? hits.join(' ') : '—';
}

// EQEmu stores weight in TENTHS of a stone — 25 means 2.5. Rendering the raw
// column made every item ten times heavier than it is in game.
export function fmtWeight(w: number | null): string {
  if (w == null) return '—';
  return (w / 10).toFixed(1).replace(/\.0$/, '');
}

export function decodeSlots(slots: number | null): string {
  if (slots == null || slots === 0) return '—';
  const big = BigInt(slots);
  if ((big & ALL_SLOT_MASK) === ALL_SLOT_MASK) return 'ALL';
  const hits: string[] = [];
  for (const [b, t] of SLOT_TAGS) {
    if ((big & b) > 0n && !hits.includes(t)) hits.push(t);   // collapse EAR/WRIST/FINGER pairs
  }
  return hits.length ? hits.join(' ') : '—';
}

// EQ price is in copper. Render as platinum when ≥1 pp, gold otherwise.
export function fmtPrice(cp: number | null): string {
  if (cp == null || cp <= 0) return '—';
  const pp = Math.floor(cp / 1000);
  if (pp >= 1) return `${pp.toLocaleString()} pp`;
  const gp = Math.floor(cp / 100);
  if (gp >= 1) return `${gp} gp`;
  return `${cp} cp`;
}

// eqemu era code (eqemu_zone.expansion) → short label.
export const ERA_LABEL: Record<number, string> = {
  0: 'Classic', 1: 'Kunark', 2: 'Velious', 3: 'Luclin', 4: 'PoP',
};
