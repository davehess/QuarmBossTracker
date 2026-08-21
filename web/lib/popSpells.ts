// PoP spell turn-ins — which parchment buys which spell tier.
//
// Hitya 2026-08-20: "look at the PoP spell quests. Add some of that
// information to the spells page so people know what they need to turn in."
//
// HOW THIS WAS DERIVED (and why it generalises past the one script we saw).
// The quest script hands a RANDOM spell from a pool per turn-in item. Read
// naively that is a per-class list we would need every NPC's script to
// reproduce. But resolving all 25 spells in the cleric script against the
// catalog showed the pools are LEVEL TIERS, cleanly and without overlap:
//
//   Ethereal Parchment  → 61-62   (Faith, Symbol of Kazad, Ward of Gallantry,
//                                  Tarnation, Virtue, Condemnation, …)
//   Spectral Parchment  → 63-64   (Supernal Light, Sound of Might, Mark of
//                                  Kings, Word of Replenishment, …)
//   Glyphed Rune Word   → 65      (Yaulp VI, The Silent Command, Armor of the
//                                  Zealot, Mark of the Righteous, Hand of Virtue)
//
// So the tier is a function of the spell's LEVEL, which we already hold for
// every class in spell_level_seed — no other class's script required.
//
// ⚠ CONFIRMED AGAINST ONE CLASS (cleric). The rule fits all 25 of its spells
// with no exceptions, which is strong but is still one witness. When another
// class's script turns up (a local session can read D:\EQServer's quest
// files), check it against tierForLevel before trusting this for that class.
// A spell whose level we don't know returns null rather than a guess.

export type TurnInKey = 'ethereal' | 'spectral' | 'glyphed';

export type TurnIn = {
  key: TurnInKey;
  item: string;
  itemId: number;
  levels: [number, number];
  blurb: string;
};

export const POP_TURN_INS: Record<TurnInKey, TurnIn> = {
  ethereal: {
    key: 'ethereal', item: 'Ethereal Parchment', itemId: 29112, levels: [61, 62],
    blurb: 'Turn in for a random level 61-62 spell of your class.',
  },
  spectral: {
    key: 'spectral', item: 'Spectral Parchment', itemId: 29131, levels: [63, 64],
    blurb: 'Turn in for a random level 63-64 spell of your class.',
  },
  glyphed: {
    key: 'glyphed', item: 'Glyphed Rune Word', itemId: 29132, levels: [65, 65],
    blurb: 'Turn in for a random level 65 spell of your class.',
  },
};

export const POP_TURN_IN_ORDER: TurnInKey[] = ['ethereal', 'spectral', 'glyphed'];

/** Which parchment yields a spell of this level. null when the level is unknown or pre-PoP. */
export function tierForLevel(level: number | null | undefined): TurnIn | null {
  if (level == null) return null;
  const lv = Number(level);
  if (!Number.isFinite(lv)) return null;
  for (const k of POP_TURN_IN_ORDER) {
    const t = POP_TURN_INS[k];
    if (lv >= t.levels[0] && lv <= t.levels[1]) return t;
  }
  return null;
}

/** The random pool means a turn-in is a LOTTERY — worth saying out loud. */
export function tierOdds(poolSize: number): string {
  if (!Number.isFinite(poolSize) || poolSize <= 0) return '';
  return `random from ${poolSize} spell${poolSize === 1 ? '' : 's'} at this tier`;
}
