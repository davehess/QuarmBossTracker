// NPC decoders for wpqdi's /db/npc page. Mirrors the bot's mob-info resolver
// (index.js `_decodeMobSpecials` / `_MOB_SPECIAL_LABELS` / `_MOB_CLASS_NAMES`)
// so the web page and the in-game Mob Info overlay agree on the same labels.
// Keep in sync with index.js if the bot map changes.

export const MOB_SPECIAL_LABELS: Record<number, string> = {
  1: 'Summon', 2: 'Enrage', 3: 'Rampage', 4: 'Area Rampage', 5: 'Flurry',
  6: 'Triple Attack', 7: 'Quad Attack', 9: 'Bane', 10: 'Magical', 11: 'Ranged',
  12: 'Unslowable', 13: 'Unmezzable', 14: 'Uncharmable', 15: 'Unstunnable',
  16: 'Unsnareable', 17: 'Unfearable', 18: 'Undispellable', 19: 'Immune Melee',
  20: 'Immune Magic', 21: 'Immune Fleeing', 23: 'Immune Non-Magical',
  27: 'Immune Feign Death', 28: 'Immune Taunt', 31: 'Immune Pacify',
};

export const MOB_CLASS_NAMES: Record<number, string> = {
  1: 'Warrior', 2: 'Cleric', 3: 'Paladin', 4: 'Ranger', 5: 'Shadow Knight', 6: 'Druid',
  7: 'Monk', 8: 'Bard', 9: 'Rogue', 10: 'Shaman', 11: 'Necromancer', 12: 'Wizard',
  13: 'Magician', 14: 'Enchanter', 15: 'Beastlord', 16: 'Berserker',
};

// special_abilities format: "id,val^id,val^…" (val 0 = disabled). Falls back to
// the legacy npcspecialattks char flags when special_abilities is empty.
export function decodeMobSpecials(special_abilities?: string | null, npcspecialattks?: string | null): string[] {
  const out: string[] = [];
  if (special_abilities) {
    for (const part of String(special_abilities).split('^')) {
      const bits = part.split(',');
      const id = parseInt(bits[0], 10);
      if (!Number.isFinite(id)) continue;
      if (bits[1] != null && String(bits[1]).trim() === '0') continue;   // disabled
      const label = MOB_SPECIAL_LABELS[id];
      if (label && !out.includes(label)) out.push(label);
    }
  } else if (npcspecialattks) {
    const FLAG: Record<string, string> = {
      E: 'Enrage', F: 'Flurry', R: 'Rampage', r: 'Area Rampage', S: 'Summon',
      T: 'Triple Attack', Q: 'Quad Attack', b: 'Bane', m: 'Magical', a: 'Ranged',
    };
    for (const ch of String(npcspecialattks)) if (FLAG[ch] && !out.includes(FLAG[ch])) out.push(FLAG[ch]);
  }
  return out;
}

export const deUnderscore = (s: string | null | undefined) => String(s ?? '').replace(/_/g, ' ').trim();
