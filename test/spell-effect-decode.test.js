// test/spell-effect-decode.test.js — what a buff actually gives you.
//
// Hitya, 2026-09-02, with two in-game spell descriptions: "The buffs on the
// buffs page should give the affects that they're providing each, and then a
// summary below of all of the things that are provided."
//
// ⚠ EVERY EXPECTATION HERE IS GROUND TRUTH, NOT A GUESS. The eff/base arrays
// are the real rows from our eqemu_spells mirror, and the expected strings are
// what the GAME prints for the same spell. That pairing is the only thing that
// makes a SPA label trustworthy — a plausible-but-wrong stat label is worse
// than an opaque "SPA 132", because people act on it.
//
// Run: npx vitest run test/spell-effect-decode.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

const { _decodeSpellEffects } = evalBlock(
  sliceBlock(
    readSource(BOT_INDEX),
    'const _SPA_LABEL = {',
    '\n// ── Spell catalog endpoint ',
  ),
  ['_decodeSpellEffects'],
);

// Real mirror rows: raw.eff / raw.base as stored.
const row = (eff, base) => ({ raw: { eff, base } });
const F = 254;   // empty slot

describe('spells whose in-game text we can check against', () => {
  it('Girdle of Karana — "Increase Strength by 42"', () => {
    expect(_decodeSpellEffects(row([4, F, F], [42, 0, 0]))).toEqual(['STR +42']);
  });

  it('Mask of the Stalker — all four of its listed effects', () => {
    // Game: "1: Increase Target Size by 25%  2: Increase Magnification by 115%
    //        3: Increase Mana by 3  4: See Invisible"
    // Note 89 stores 125 for "+25%" and 11-style percentages are the same
    // shape — a raw base would read "Target size 125%", which is wrong.
    expect(_decodeSpellEffects(row([89, 87, 15, 13, F], [125, 115, 3, 1, 0])))
      .toEqual(['Target size +25%', 'Magnification 115%', 'Mana +3/tick', 'See Invisible']);
  });

  it('Ancient: Legacy of Blades — a damage shield, shown as damage not as a negative', () => {
    // SPA 59 is stored NEGATIVE for a real DS (the bot's own _dsMagnitude
    // relies on that); the number a player wants is the per-hit damage.
    expect(_decodeSpellEffects(row([59, F], [-34, 0]))).toEqual(['Damage shield 34/hit']);
  });

  it('Celerity — haste is stored as a multiplier, not a bonus', () => {
    // 128 means +28%. Printing "Haste 128%" would overstate every haste buff
    // in the game by 100 points.
    expect(_decodeSpellEffects(row([11, F], [128, 0]))).toEqual(['Haste +28%']);
  });

  it('Spirit of Wolf — the run-speed slot, past a filler slot', () => {
    expect(_decodeSpellEffects(row([10, 3, F], [0, 30, 0]))).toEqual(['Run speed +30%']);
  });

  it('Aegolism — real stats kept, stacking-rule slots dropped', () => {
    // 148/149 are "block/overwrite if slot X" bookkeeping. Rendering them as
    // "SPA 148: 69" next to real stats reads as a missing label rather than as
    // something deliberately withheld.
    expect(_decodeSpellEffects(row([148, 69, 79, 1, 149, F], [69, 1100, 1100, 180, 69, 0])))
      .toEqual(['Max HP +1100', 'HP +1100', 'AC +180']);
  });

  it('the whole resist block, pinned end to end', () => {
    // Pinned through the middle, not inferred from the two ends: Resist Fire is
    // 46 and Resist Magic is 50, and Endure Cold/Poison/Disease fix 47/48/49.
    expect(_decodeSpellEffects(row([46, F], [10, 0]))).toEqual(['Fire resist +10']);
    expect(_decodeSpellEffects(row([47, F], [15, 0]))).toEqual(['Cold resist +15']);
    expect(_decodeSpellEffects(row([48, F], [10, 0]))).toEqual(['Poison resist +10']);
    expect(_decodeSpellEffects(row([49, F], [10, 0]))).toEqual(['Disease resist +10']);
    expect(_decodeSpellEffects(row([50, F], [10, 0]))).toEqual(['Magic resist +10']);
  });

  it('the flag-style effects read as words, not as "+1"', () => {
    expect(_decodeSpellEffects(row([12, F], [1, 0]))).toEqual(['Invisibility']);
    expect(_decodeSpellEffects(row([57, F], [1, 0]))).toEqual(['Levitate']);
    expect(_decodeSpellEffects(row([66, F], [1, 0]))).toEqual(['Ultravision']);
  });
});

describe('what it refuses to invent', () => {
  it('falls back to a raw SPA rather than guessing a label', () => {
    // The house rule from web/lib/spellDecode.ts: nothing is mislabeled.
    expect(_decodeSpellEffects(row([132, F], [45, 0]))).toEqual(['SPA 132: 45']);
  });

  it('drops the inert filler slot that 1166 buffs carry', () => {
    expect(_decodeSpellEffects(row([10, 10, F], [0, 0, 0]))).toEqual([]);
  });

  it('keeps SPA 10 when it actually carries a value', () => {
    // Dropping it unconditionally would hide a real effect on the ~few spells
    // that use the slot for something.
    expect(_decodeSpellEffects(row([10, F], [25, 0]))).toEqual(['SPA 10: 25']);
  });

  it('reads the indexed columns when raw is absent', () => {
    expect(_decodeSpellEffects({ effect_id_1: 4, effect_base_value_1: 42, effect_id_2: 254 }))
      .toEqual(['STR +42']);
  });

  it('survives a row with no effect data at all', () => {
    expect(_decodeSpellEffects({})).toEqual([]);
    expect(_decodeSpellEffects({ raw: null })).toEqual([]);
  });

  it('shows a negative stat as negative', () => {
    // Not every beneficial spell is purely upside (Aegolism-style trades, and
    // debuff-shaped rows reaching this by mistake).
    expect(_decodeSpellEffects(row([4, F], [-10, 0]))).toEqual(['STR -10']);
  });
});
