// Inventory-window skins for the gear page (the guild lead, 2026-11-03: "display of the item layouts towards the top and
// different skin layouts that people may be used to, and let them set a default").
//
// A skin is DATA: a grid size, where each of the 21 equipment slots sits in it, which side the stats go on and how the
// stat names are written. The window component only reads this table, so adjusting a skin is a one-line edit here.
// These maps are a FIRST PASS drawn from screenshots of four in-game inventory windows; expect to refine the cell
// positions (and the names) once the guild lead has looked at them.
//
// Columns and rows are 1-based grid lines, like CSS grid-column / grid-row.

export const SLOT_IDS = [
  'Ear1', 'Neck', 'Face', 'Head', 'Ear2',
  'Finger1', 'Finger2', 'Wrist1', 'Wrist2', 'Arms', 'Hands',
  'Shoulders', 'Chest', 'Back', 'Waist', 'Legs', 'Feet',
  'Primary', 'Secondary', 'Range', 'Ammo',
] as const;
export type SlotId = (typeof SLOT_IDS)[number];

export const SLOT_LABEL: Record<SlotId, string> = {
  Ear1: 'Ear 1', Ear2: 'Ear 2', Neck: 'Neck', Face: 'Face', Head: 'Head',
  Finger1: 'Finger 1', Finger2: 'Finger 2', Wrist1: 'Wrist 1', Wrist2: 'Wrist 2',
  Arms: 'Arms', Hands: 'Hands', Shoulders: 'Shoulders', Chest: 'Chest', Back: 'Back',
  Waist: 'Waist', Legs: 'Legs', Feet: 'Feet',
  Primary: 'Primary', Secondary: 'Secondary', Range: 'Range', Ammo: 'Ammo',
};

// The gear data spells a slot several ways: the Quarmy export writes "Ear1" / "Wrist1" / "Fingers1", the upgrade table
// shows "Ear 1" / "Fingers 1", and an older inventory export says "Finger 1" or "Left Ear". All of them collapse to the
// 21 canonical ids. Charm (not an inventory-window slot) and anything unknown return null.
const ALIASES: Record<string, SlotId> = {};
function alias(id: SlotId, ...spellings: string[]) {
  for (const s of spellings) ALIASES[s] = id;
}
alias('Ear1', 'ear1', 'leftear', 'lear', 'earleft');
alias('Ear2', 'ear2', 'rightear', 'rear', 'earright');
alias('Finger1', 'finger1', 'fingers1', 'leftfinger', 'lfinger', 'ring1');
alias('Finger2', 'finger2', 'fingers2', 'rightfinger', 'rfinger', 'ring2');
alias('Wrist1', 'wrist1', 'leftwrist', 'lwrist');
alias('Wrist2', 'wrist2', 'rightwrist', 'rwrist');
alias('Neck', 'neck');
alias('Face', 'face');
alias('Head', 'head');
alias('Arms', 'arms', 'arm');
alias('Hands', 'hands', 'hand');
alias('Shoulders', 'shoulders', 'shoulder');
alias('Chest', 'chest');
alias('Back', 'back');
alias('Waist', 'waist');
alias('Legs', 'legs', 'leg');
alias('Feet', 'feet', 'foot');
alias('Primary', 'primary');
alias('Secondary', 'secondary');
alias('Range', 'range', 'ranged');
alias('Ammo', 'ammo');

export function normaliseSlot(raw: string | null | undefined): SlotId | null {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return ALIASES[key] ?? null;
}

export type SkinId = 'classic' | 'grid' | 'doll' | 'compact';
export type Cell = { slot: SlotId; col: number; row: number };
export type Skin = {
  id: SkinId;
  name: string;
  cols: number;
  cells: Cell[];
  statsSide: 'left' | 'right';
  // abbr = STR / MAGIC, full = Strength / Magic, short = Str / MR
  statsStyle: 'abbr' | 'full' | 'short';
  // Paper doll only: the central figure box, which no slot may overlap.
  figure?: { col: number; row: number; colSpan: number; rowSpan: number };
};

const row = (r: number, slots: SlotId[], startCol = 1): Cell[] =>
  slots.map((slot, i) => ({ slot, col: startCol + i, row: r }));

export const SKINS: Skin[] = [
  {
    id: 'classic', name: 'Classic', cols: 6, statsSide: 'right', statsStyle: 'abbr',
    cells: [
      ...row(1, ['Ear1', 'Neck', 'Face', 'Head', 'Ear2']),
      ...row(2, ['Finger1', 'Wrist1', 'Arms', 'Hands', 'Wrist2', 'Finger2']),
      ...row(3, ['Shoulders', 'Chest', 'Back', 'Waist', 'Legs', 'Feet']),
      ...row(4, ['Primary', 'Secondary', 'Range', 'Ammo']),
    ],
  },
  {
    id: 'grid', name: 'Inventory grid', cols: 5, statsSide: 'right', statsStyle: 'full',
    cells: [
      ...row(1, ['Ear1', 'Neck', 'Face', 'Head', 'Ear2']),
      ...row(2, ['Finger1', 'Wrist1', 'Arms', 'Hands', 'Finger2']),
      ...row(3, ['Shoulders', 'Chest', 'Back', 'Waist', 'Wrist2']),
      ...row(4, ['Legs', 'Feet']),
      ...row(5, ['Primary', 'Secondary', 'Range', 'Ammo']),
    ],
  },
  {
    id: 'doll', name: 'Paper doll', cols: 5, statsSide: 'left', statsStyle: 'full',
    figure: { col: 2, row: 2, colSpan: 3, rowSpan: 4 },
    cells: [
      ...row(1, ['Ear1', 'Neck', 'Face', 'Head', 'Ear2']),
      ...['Chest', 'Arms', 'Wrist1', 'Finger1', 'Shoulders'].map((slot, i) => ({ slot: slot as SlotId, col: 1, row: 2 + i })),
      ...['Back', 'Waist', 'Hands', 'Wrist2', 'Finger2'].map((slot, i) => ({ slot: slot as SlotId, col: 5, row: 2 + i })),
      { slot: 'Legs' as SlotId, col: 2, row: 6 },
      { slot: 'Feet' as SlotId, col: 4, row: 6 },
      ...row(7, ['Primary', 'Secondary', 'Range', 'Ammo']),
    ],
  },
  {
    id: 'compact', name: 'Compact', cols: 3, statsSide: 'right', statsStyle: 'short',
    cells: [
      ...row(1, ['Ear1', 'Neck', 'Ear2']),
      ...row(2, ['Face', 'Head', 'Shoulders']),
      ...row(3, ['Chest', 'Back', 'Arms']),
      ...row(4, ['Wrist1', 'Wrist2', 'Hands']),
      ...row(5, ['Finger1', 'Finger2', 'Waist']),
      ...row(6, ['Legs', 'Feet', 'Ammo']),
      ...row(7, ['Primary', 'Secondary', 'Range']),
    ],
  },
];

export const DEFAULT_SKIN: SkinId = 'classic';

export function skinById(id: string | null | undefined): Skin | null {
  return SKINS.find(s => s.id === id) ?? null;
}

// Stat labels per style. Keys match the gear page's own sums (gearStat / gearResist).
export const ATTR_KEYS = ['str', 'sta', 'agi', 'dex', 'wis', 'intel', 'cha'] as const;
export const RESIST_KEYS = ['mr', 'fr', 'cr', 'dr', 'pr'] as const;
export const ATTR_LABEL: Record<Skin['statsStyle'], Record<(typeof ATTR_KEYS)[number], string>> = {
  abbr:  { str: 'STR', sta: 'STA', agi: 'AGI', dex: 'DEX', wis: 'WIS', intel: 'INT', cha: 'CHA' },
  full:  { str: 'Strength', sta: 'Stamina', agi: 'Agility', dex: 'Dexterity', wis: 'Wisdom', intel: 'Intelligence', cha: 'Charisma' },
  short: { str: 'Str', sta: 'Sta', agi: 'Agi', dex: 'Dex', wis: 'Wis', intel: 'Int', cha: 'Cha' },
};
export const RESIST_LABEL: Record<Skin['statsStyle'], Record<(typeof RESIST_KEYS)[number], string>> = {
  abbr:  { mr: 'MAGIC', fr: 'FIRE', cr: 'COLD', dr: 'DISEASE', pr: 'POISON' },
  full:  { mr: 'Magic', fr: 'Fire', cr: 'Cold', dr: 'Disease', pr: 'Poison' },
  short: { mr: 'MR', fr: 'FR', cr: 'CR', dr: 'DR', pr: 'PR' },
};
// Token colour classes, in-game convention (magic purple, fire red, cold blue, disease yellow, poison green).
export const RESIST_COLOUR: Record<(typeof RESIST_KEYS)[number], string> = {
  mr: 'text-purple', fr: 'text-red', cr: 'text-blue', dr: 'text-gold', pr: 'text-green',
};
