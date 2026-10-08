// test/pop-spells.test.js — the PoP parchment helpers (web/lib/popSpells.ts).
//
// HISTORY: this file used to characterize tierForLevel(), the level→parchment
// ladder inferred from the one quest script we could read. Its own header
// called it a one-witness inference, and the second witness killed it
// (Lacunanight, 2026-08-25, with Quarm's necro script in hand): pools are
// hand-curated per class, the necro Glyphed awards exactly three spells, and
// Destroy Undead (cleric 64 / necro 65) rides the CLERIC Spectral pool. The
// old tests asserted the disproven behavior, so they died with the function —
// what's characterized now is the pool lookup that replaced it.
import { describe, it, expect } from 'vitest';
import { POP_TURN_INS, POP_TURN_IN_ORDER, poolTierByName } from '../web/lib/popSpells.ts';

const POOLS = [
  // The verified necro Glyphed trio — byte-for-byte what Quarm's script awards.
  { class_name: 'Necromancer',   tier: 'glyphed',  scroll_item_id: 28416, spell_name: 'Blood of Thule' },
  { class_name: 'Necromancer',   tier: 'glyphed',  scroll_item_id: 28425, spell_name: 'Child of Bertoxxulous' },
  { class_name: 'Necromancer',   tier: 'glyphed',  scroll_item_id: 28427, spell_name: 'Word of Terris' },
  // The cross-class case that broke the level rule: cleric SPECTRAL, level 64.
  { class_name: 'Cleric',        tier: 'spectral', scroll_item_id: 28426, spell_name: 'Destroy Undead' },
  { class_name: 'Shadow Knight', tier: 'ethereal', scroll_item_id: 21649, spell_name: 'Mental Corruption' },
];

describe('poolTierByName — quest-script pools, per class', () => {
  it('resolves the verified necro Glyphed trio', () => {
    const t = poolTierByName(POOLS, 'Necromancer');
    expect(t['blood of thule']).toBe('glyphed');
    expect(t['child of bertoxxulous']).toBe('glyphed');
    expect(t['word of terris']).toBe('glyphed');
  });

  it('Destroy Undead is a CLERIC spectral reward and absent from necro pools', () => {
    // The exact case Lacunanight reported: necro learns it at 65, but the
    // necro Glyphed cannot award it — the scroll is cleric-tier.
    expect(poolTierByName(POOLS, 'Cleric')['destroy undead']).toBe('spectral');
    expect(poolTierByName(POOLS, 'Necromancer')['destroy undead']).toBeUndefined();
  });

  it('class matching survives the Shadow Knight spelling split', () => {
    // characters.class carries both 'Shadow Knight' and 'Shadowknight'.
    expect(poolTierByName(POOLS, 'Shadowknight')['mental corruption']).toBe('ethereal');
    expect(poolTierByName(POOLS, 'Shadow Knight')['mental corruption']).toBe('ethereal');
  });

  it('an unknown class or empty pools yields an empty map, never a guess', () => {
    expect(poolTierByName(POOLS, null)).toEqual({});
    expect(poolTierByName(POOLS, 'Warrior')).toEqual({});
    expect(poolTierByName([], 'Necromancer')).toEqual({});
  });
});

describe('the turn-in constants', () => {
  it('cover the three parchments with their real item ids', () => {
    expect(POP_TURN_IN_ORDER).toEqual(['ethereal', 'spectral', 'glyphed']);
    expect(POP_TURN_INS.ethereal.itemId).toBe(29112);
    expect(POP_TURN_INS.spectral.itemId).toBe(29131);
    expect(POP_TURN_INS.glyphed.itemId).toBe(29132);
  });

  it('no blurb promises a level range — the pools are hand-curated, not level tiers', () => {
    for (const k of POP_TURN_IN_ORDER) {
      expect(POP_TURN_INS[k].blurb).not.toMatch(/level \d+-\d+ spell/);
      expect(POP_TURN_INS[k].blurb).toMatch(/trainer/i);
    }
  });
});
