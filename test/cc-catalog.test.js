// test/cc-catalog.test.js — the spell catalog names the crowd control a
// detrimental spell carries, so the agent's suggested triggers can match "a mez
// landed on you" by the spell's effect instead of a hand-kept list of texts
// (the guild lead, 2026-10-02: "We need more in suggested triggers").
//
// Run: npx vitest run test/cc-catalog.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, stripJs, BOT_INDEX } from './_source-slice.js';

const bot = readSource(BOT_INDEX);
const { _ccKinds } = evalBlock(
  sliceBlock(bot, "const _CC_SPA = { 31: 'mez'", '\n      }'),
  ['_ccKinds']);

// Effect arrays as eqemu_spells.raw stores them (checked against the live catalog).
const sp = (good, eff, base) => ({ good_effect: good, raw: { eff, base } });

describe('cc — crowd control on a detrimental spell', () => {
  it('names mez, fear, root, stun, charm and silence by their effect', () => {
    expect(_ccKinds(sp(0, [31, 254], [0, 0]))).toEqual(['mez']);           // Mesmerize
    expect(_ccKinds(sp(0, [23], [0]))).toEqual(['fear']);
    expect(_ccKinds(sp(0, [99, 21], [-10000, 0]))).toEqual(['root', 'stun']);
    expect(_ccKinds(sp(0, [22], [0]))).toEqual(['charm']);
    expect(_ccKinds(sp(0, [96], [1]))).toEqual(['silence']);
  });

  it('a negative run speed is a snare; an attack speed under 100 is a slow', () => {
    expect(_ccKinds(sp(0, [3], [-40]))).toEqual(['snare']);                 // Ensnare
    expect(_ccKinds(sp(0, [11], [85]))).toEqual(['slow']);                  // Turgur's Insects
    expect(_ccKinds(sp(0, [11], [128]))).toBeNull();                        // a haste number
  });

  it('nothing for a beneficial spell or a plain nuke', () => {
    expect(_ccKinds(sp(1, [3, 11], [40, 128]))).toBeNull();                 // Spirit of Wolf / Celerity
    expect(_ccKinds(sp(0, [0], [-200]))).toBeNull();
  });

  it('rides the catalog entry', () => {
    expect(stripJs(bot)).toMatch(/cc: _ccKinds\(r\) \|\| undefined,/);
  });
});

// The guild lead, 2026-10-05: the Me HUD counts "stuns/aggro spells you've put into the mob". A stun is
// cc 'stun' above; an aggro spell is one that ADDS hate — effect 92 with a positive base. A negative
// base takes hate off (Jolt, Concussion), so it is not one. Checked against the live catalog the same
// day: 23 spells carry a positive 92 (the Terror line, Taunting/Enraging/Frenzying Blow, Pique, …).
const { _hateAdded } = evalBlock(sliceBlock(bot, 'function _hateAdded(r) {', '\n      }'), ['_hateAdded']);

describe('hate — what a spell adds to its target', () => {
  it('a positive effect-92 base is hate added', () => {
    expect(_hateAdded(sp(0, [92], [450]))).toBe(450);                       // Terror of Death
    expect(_hateAdded(sp(0, [92, 254], [700, 0]))).toBe(700);               // Enraging Blow
    expect(_hateAdded(sp(0, [92, 0], [100, -50]))).toBe(100);               // Pique
    expect(_hateAdded(sp(0, [21, 0, 92], [0, -100, 650]))).toBe(650);       // Anger: a stun that also adds hate
  });

  it('a negative base takes hate off — Jolt, Concussion — and a plain nuke or buff carries none', () => {
    expect(_hateAdded(sp(0, [92], [-500]))).toBeNull();                     // Jolt
    expect(_hateAdded(sp(0, [92], [-400]))).toBeNull();                     // Concussion
    expect(_hateAdded(sp(0, [0], [-200]))).toBeNull();
    expect(_hateAdded(sp(1, [4], [42]))).toBeNull();
  });

  it('reads the three indexed columns when a row carries no raw arrays', () => {
    expect(_hateAdded({ effect_id_1: 92, effect_base_value_1: 250, effect_id_2: 254, effect_base_value_2: 0 })).toBe(250);
    expect(_hateAdded({ effect_id_1: 92, effect_base_value_1: -500 })).toBeNull();
  });

  it('rides the catalog entry', () => {
    expect(stripJs(bot)).toMatch(/hate: _hateAdded\(r\) \|\| undefined,/);
  });
});
