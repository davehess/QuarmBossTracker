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
