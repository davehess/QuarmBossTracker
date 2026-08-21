// test/pop-spells.test.js — PoP spell turn-in tiers.
// Real-imports the pure catalog (web/lib/popSpells.ts).
//
// Hitya 2026-08-20: "look at the PoP spell quests. Add some of that
// information to the spells page so people know what they need to turn in."
//
// The quest script hands a RANDOM spell per turn-in item, which reads like a
// per-class list. Resolving all 25 spells in the one script we have against
// the catalog showed the pools are LEVEL TIERS with no overlap — which is what
// lets this work for every class off spell_level_seed instead of needing each
// class's script.

import { describe, it, expect } from 'vitest';
import { tierForLevel, POP_TURN_INS, POP_TURN_IN_ORDER } from '../web/lib/popSpells.ts';

describe('tierForLevel — the tier ladder', () => {
  it('matches the pools measured in the cleric script', () => {
    // Ethereal pool: Faith 61, Symbol of Kazad 61, Virtue 62, Condemnation 62.
    expect(tierForLevel(61).item).toBe('Ethereal Parchment');
    expect(tierForLevel(62).item).toBe('Ethereal Parchment');
    // Spectral pool: Supernal Light 63, Sound of Might 63, Mark of Kings 64.
    expect(tierForLevel(63).item).toBe('Spectral Parchment');
    expect(tierForLevel(64).item).toBe('Spectral Parchment');
    // Glyphed pool: Yaulp VI, The Silent Command, Hand of Virtue — all 65.
    expect(tierForLevel(65).item).toBe('Glyphed Rune Word');
  });

  it('pre-PoP levels have no turn-in', () => {
    expect(tierForLevel(60)).toBeNull();
    expect(tierForLevel(1)).toBeNull();
  });

  it('an unknown level returns null rather than guessing a tier', () => {
    expect(tierForLevel(null)).toBeNull();
    expect(tierForLevel(undefined)).toBeNull();
    expect(tierForLevel(NaN)).toBeNull();
  });

  it('the tiers cover 61-65 with no gaps and no overlap', () => {
    const seen = [];
    for (let lv = 61; lv <= 65; lv++) {
      const t = tierForLevel(lv);
      expect(t, `level ${lv}`).not.toBeNull();
      seen.push(t.key);
    }
    expect(seen).toEqual(['ethereal', 'ethereal', 'spectral', 'spectral', 'glyphed']);
  });

  it('carries the real turn-in item ids from the catalog', () => {
    expect(POP_TURN_INS.ethereal.itemId).toBe(29112);
    expect(POP_TURN_INS.spectral.itemId).toBe(29131);
    expect(POP_TURN_INS.glyphed.itemId).toBe(29132);
    expect(POP_TURN_IN_ORDER).toEqual(['ethereal', 'spectral', 'glyphed']);
  });
});
