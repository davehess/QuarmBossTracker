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
export const ALL_RACE_MASK = RACE_TAGS.reduce((s, [b]) => s | b, 0);

// EQ wearable slot bits (subset that appears on gear).
export const SLOT_TAGS: [bigint, string][] = [
  [1n,'Charm'],[2n,'Ear'],[4n,'Head'],[8n,'Face'],[16n,'Neck'],
  [32n,'Shoulders'],[64n,'Arms'],[128n,'Back'],[256n,'Wrist'],[512n,'Range'],
  [1024n,'Hands'],[2048n,'Primary'],[4096n,'Secondary'],[8192n,'Fingers'],
  [16384n,'Chest'],[32768n,'Legs'],[65536n,'Feet'],[131072n,'Waist'],
  [262144n,'Power Source'],[524288n,'Ammo'],
];

export function decodeMask(mask: number | null, tags: [number, string][], allMask: number, allLabel = 'ALL'): string {
  if (mask == null || mask === 0) return '—';
  if ((mask & allMask) === allMask) return allLabel;
  const hits = tags.filter(([b]) => (mask & b) > 0).map(([, t]) => t);
  return hits.length ? hits.join(' ') : '—';
}

export function decodeSlots(slots: number | null): string {
  if (slots == null || slots === 0) return '—';
  const big = BigInt(slots);
  const hits = SLOT_TAGS.filter(([b]) => (big & b) > 0n).map(([, t]) => t);
  return hits.length ? hits.join(' / ') : '—';
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
