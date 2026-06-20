// web/lib/clicky-macros.ts — generate Zeal "swap-click" macros for must-equip
// clicky items. Pattern (from working in-game macros): equip the clicky, /use
// it, wait the cast, then swap the normal piece back. Bards get a
// /stopsong … /melody resume wrapper, EXCEPT for self-invis/travel clicks —
// those keep /stopsong but skip /melody resume so resuming the melody doesn't
// overwrite the invis.
//
// /swap slot numbers = the worn-slot bit position in eqemu_items.slots minus 1
// (Charm, bit 0, isn't swap-clickable), anchored on Chest (bit 17) = 16 from a
// confirmed working macro. /pause is in deciseconds (casttime_ms / 100):
// 30000ms → 300, 9000ms → 90.

export type SlotInfo = { bit: number; name: string; swap: number };

// name matches character_gear.slot (equipped) so we can find the worn item.
export const WORN_SLOTS: SlotInfo[] = [
  { bit: 1,  name: 'Ear1',      swap: 0 },
  { bit: 2,  name: 'Head',      swap: 1 },
  { bit: 3,  name: 'Face',      swap: 2 },
  { bit: 4,  name: 'Ear2',      swap: 3 },
  { bit: 5,  name: 'Neck',      swap: 4 },
  { bit: 6,  name: 'Shoulders', swap: 5 },
  { bit: 7,  name: 'Arms',      swap: 6 },
  { bit: 8,  name: 'Back',      swap: 7 },
  { bit: 9,  name: 'Wrist1',    swap: 8 },
  { bit: 10, name: 'Wrist2',    swap: 9 },
  { bit: 11, name: 'Range',     swap: 10 },
  { bit: 12, name: 'Hands',     swap: 11 },
  { bit: 13, name: 'Primary',   swap: 12 },
  { bit: 14, name: 'Secondary', swap: 13 },
  { bit: 15, name: 'Fingers1',  swap: 14 },
  { bit: 16, name: 'Fingers2',  swap: 15 },
  { bit: 17, name: 'Chest',     swap: 16 },
  { bit: 18, name: 'Legs',      swap: 17 },
  { bit: 19, name: 'Feet',      swap: 18 },
  { bit: 20, name: 'Waist',     swap: 19 },
  { bit: 21, name: 'Ammo',      swap: 20 },
];

// Bard self-invis / travel clicks: keep /stopsong, but do NOT /melody resume.
const INVIS_RX = /song of travel|invisib|superior camouflage|gather shadows/i;

// EQEmu item class bitmask is 1 << (classId - 1): WAR=1, CLR=2, … BST=16384.
export const CLASS_BIT: Record<string, number> = {
  warrior: 1, cleric: 2, paladin: 4, ranger: 8, 'shadow knight': 16, shadowknight: 16,
  druid: 32, monk: 64, bard: 128, rogue: 256, shaman: 512, necromancer: 1024,
  wizard: 2048, magician: 4096, enchanter: 8192, beastlord: 16384,
};

export function isMustEquipClicky(it: { clicktype: number | null; clickeffect: number | null }): boolean {
  return it.clicktype === 4 && (it.clickeffect ?? 0) > 0;
}

export function usableByClass(itemClasses: number | null, className: string | null | undefined): boolean {
  const bit = CLASS_BIT[(className || '').toLowerCase()];
  if (!bit || itemClasses == null) return false;
  return (itemClasses & bit) !== 0;
}

// Pick the worn slot for a clicky from its slots bitmask. Prefers a slot the
// character is actually wearing something in (so we know what to swap back);
// otherwise the lowest eligible slot.
export function pickSlot(slotsMask: number | null, wornBySlotName: Record<string, string>): SlotInfo | null {
  if (!slotsMask) return null;
  const candidates = WORN_SLOTS.filter(s => (slotsMask & (1 << s.bit)) !== 0);
  if (!candidates.length) return null;
  return candidates.find(s => wornBySlotName[s.name]) || candidates[0];
}

export type MacroInput = {
  className: string | null | undefined;
  clickyName: string;     // case-sensitive item name (used verbatim in /use)
  slot: SlotInfo;
  wornName: string | null;
  castMs: number | null;
  spellName: string | null;
};

export function buildClickyMacro(m: MacroInput): string[] {
  const isBard  = (m.className || '').toLowerCase() === 'bard';
  const isInvis = INVIS_RX.test(m.spellName || '');
  const ds = Math.max(1, Math.round((m.castMs || 0) / 100));   // /pause = deciseconds
  const lines: string[] = [];
  if (isBard) lines.push('/stopsong');
  lines.push(`/swap 0 ${m.slot.swap} ${m.clickyName}`);
  lines.push(`/pause ${ds}, /use ${m.clickyName}`);
  if (m.wornName) lines.push(`/swap 0 ${m.slot.swap} ${m.wornName}`);
  if (isBard && !isInvis) lines.push('/melody resume');
  return lines;
}
