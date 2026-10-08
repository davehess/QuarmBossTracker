// NPC decoders for wpqdi's /db/npc page. A COPY of the bot's special-ability
// table (utils/mobSpecials.js `MOB_SPECIAL_CODES`) in Project Quarm's numbering
// (EQMacEmu common/emu_constants.h `namespace SpecialAbility`, 1-54), so the web
// page and the in-game Mob Info overlay agree on the same labels.
//
// It is a copy, not an import, on purpose: Vercel builds from web/ and its
// ignoreCommand assumes nothing in web/ reads from outside it. The drift guard
// is test/mob-specials-web-parity.test.js, which fails when the two tables
// disagree on any code's label, show flag or danger flag. Change both together.
//
// show:   render this as a chip on the page.
// danger: a combat warning; rendered in the warning colour, ahead of the rest.

export type MobSpecialDef = { label: string; show: boolean; danger: boolean };

export const MOB_SPECIAL_CODES: Record<number, MobSpecialDef> = {
  1: { label: 'Summon', show: true, danger: true },
  2: { label: 'Enrage', show: true, danger: true },
  3: { label: 'Rampage', show: true, danger: true },
  4: { label: 'Area Rampage', show: true, danger: true },
  5: { label: 'Flurry', show: true, danger: true },
  6: { label: 'Triple Attack', show: true, danger: false },
  7: { label: 'Dual Wield', show: false, danger: false },
  8: { label: 'Does Not Equip', show: true, danger: false },
  9: { label: 'Bane', show: true, danger: false },
  10: { label: 'Magical', show: true, danger: false },
  11: { label: 'Ranged', show: true, danger: false },
  12: { label: 'Unslowable', show: true, danger: false },
  13: { label: 'Unmezzable', show: true, danger: false },
  14: { label: 'Uncharmable', show: true, danger: false },
  15: { label: 'Unstunnable', show: true, danger: false },
  16: { label: 'Unsnareable', show: true, danger: false },
  17: { label: 'Unfearable', show: true, danger: false },
  18: { label: 'Undispellable', show: true, danger: false },
  19: { label: 'Immune Melee', show: true, danger: false },
  20: { label: 'Immune Magic', show: true, danger: false },
  21: { label: 'Immune Fleeing', show: true, danger: false },
  22: { label: 'Immune Melee Except Bane', show: true, danger: false },
  23: { label: 'Immune Non-Magical', show: true, danger: false },
  24: { label: 'Will Not Aggro', show: false, danger: false },
  25: { label: 'Immune Aggro On', show: false, danger: false },
  26: { label: 'Immune Ranged Spells', show: true, danger: false },
  27: { label: 'Immune Feign Death', show: true, danger: false },
  28: { label: 'Immune Taunt', show: true, danger: false },
  29: { label: 'Tunnel Vision', show: false, danger: false },
  30: { label: 'No Buff/Heal Friends', show: false, danger: false },
  31: { label: 'Immune Pacify', show: true, danger: false },
  32: { label: 'Leash', show: false, danger: false },
  33: { label: 'Tether', show: false, danger: false },
  34: { label: 'Permaroot Flee', show: false, danger: false },
  35: { label: 'No Harm From Client', show: false, danger: false },
  36: { label: 'Always Flee', show: true, danger: false },
  37: { label: 'Flee At Percent', show: true, danger: false },
  38: { label: 'Allow Beneficial', show: false, danger: false },
  39: { label: 'Disable Melee', show: true, danger: false },
  40: { label: 'Chase Distance', show: false, danger: false },
  41: { label: 'Allowed To Tank', show: false, danger: false },
  42: { label: 'Proximity Aggro', show: false, danger: false },
  43: { label: 'Always Call For Help', show: false, danger: false },
  44: { label: 'Use Warrior Skills', show: false, danger: false },
  45: { label: 'Always Flee On Low Con', show: false, danger: false },
  46: { label: 'No Loitering', show: false, danger: false },
  47: { label: 'Block Handin On Bad Faction', show: false, danger: false },
  48: { label: 'PC Deathblow To Corpse', show: false, danger: false },
  49: { label: 'Corpse Camper', show: false, danger: false },
  50: { label: 'Reverse Slow — slowing hastes it', show: true, danger: true },
  51: { label: 'Immune Haste', show: false, danger: false },
  52: { label: 'Immune Disarm', show: false, danger: false },
  53: { label: 'Immune Riposte', show: false, danger: false },
  54: { label: 'Proximity Aggro 2', show: false, danger: false },
};

// Legacy npcspecialattks character flags — only read when special_abilities is
// empty (same as the bot).
export const NPCSPECIALATTKS_FLAGS: Record<string, string> = {
  E: 'Enrage', F: 'Flurry', R: 'Rampage', r: 'Area Rampage', S: 'Summon',
  T: 'Triple Attack', Q: 'Quad Attack', b: 'Bane', m: 'Magical', a: 'Ranged',
};

export const MOB_CLASS_NAMES: Record<number, string> = {
  1: 'Warrior', 2: 'Cleric', 3: 'Paladin', 4: 'Ranger', 5: 'Shadow Knight', 6: 'Druid',
  7: 'Monk', 8: 'Bard', 9: 'Rogue', 10: 'Shaman', 11: 'Necromancer', 12: 'Wizard',
  13: 'Magician', 14: 'Enchanter', 15: 'Beastlord', 16: 'Berserker',
};

// special_abilities format: "id,val^id,val^…" (val 0 = disabled). Falls back to
// the legacy npcspecialattks char flags when special_abilities is empty.
// Chips come back in catalog order; the page puts the danger ones first.
export function decodeMobSpecialChips(special_abilities?: string | null, npcspecialattks?: string | null): { label: string; danger: boolean }[] {
  const out: { label: string; danger: boolean }[] = [];
  const add = (label: string, danger: boolean) => { if (!out.some(c => c.label === label)) out.push({ label, danger }); };
  if (special_abilities) {
    for (const part of String(special_abilities).split('^')) {
      const bits = part.split(',');
      const id = parseInt(bits[0], 10);
      if (!Number.isFinite(id)) continue;
      if (bits[1] != null && String(bits[1]).trim() === '0') continue;   // disabled
      const def = MOB_SPECIAL_CODES[id];
      if (def && def.show) add(def.label, def.danger);
    }
  } else if (npcspecialattks) {
    for (const ch of String(npcspecialattks)) if (NPCSPECIALATTKS_FLAGS[ch]) add(NPCSPECIALATTKS_FLAGS[ch], false);
  }
  return out;
}

export function decodeMobSpecials(special_abilities?: string | null, npcspecialattks?: string | null): string[] {
  return decodeMobSpecialChips(special_abilities, npcspecialattks).map(c => c.label);
}

export const deUnderscore = (s: string | null | undefined) => String(s ?? '').replace(/_/g, ' ').trim();
