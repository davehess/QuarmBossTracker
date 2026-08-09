// test/buff-duration-formula.test.js — _durTicksForLevel against EQMac's
// CalcBuffDuration_formula semantics.
//
// From the pq-companion comparison (2026-08-07): formula 6 carries a +2 term
// we never implemented, and EQMac integer division is FLOOR, not ceil. On our
// live catalog f6/base-35 is 25 spells — essentially the entire slow line —
// so every slow timer ran 12s short at L60 and the #130 tracker called "Slow
// dropped" into a still-live slow. Vectors below were verified against
// eqemu_spells (spell id / formula / base ticks noted per row).
//
// Run: npx vitest run test/buff-duration-formula.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const block = sliceBlock(
  readSource(AGENT_INDEX),
  'function _durTicksForLevel(formula, capTicks, level)',
  '\n}',
);

// eslint-disable-next-line no-new-func
const _durTicksForLevel = new Function(block + '\nreturn _durTicksForLevel;')();

describe('_durTicksForLevel', () => {
  it('formula 6: floor(lvl/2)+2 — the slow line (Forlorn Deeds 1712, f6/35)', () => {
    expect(_durTicksForLevel(6, 35, 60)).toBe(32);   // was 30 → 12s short
    expect(_durTicksForLevel(6, 35, 57)).toBe(30);   // old code got 30 by luck (ceil)
    expect(_durTicksForLevel(6, 3, 60)).toBe(3);     // base-capped stays capped
  });

  it('formula 1/2: floor semantics move odd-level results only', () => {
    expect(_durTicksForLevel(1, 1000, 57)).toBe(28); // ceil gave 29
    expect(_durTicksForLevel(1, 1000, 60)).toBe(30); // even level unchanged
    expect(_durTicksForLevel(2, 39, 55)).toBe(32);   // floor(27.5)+5, ceil gave 33
    expect(_durTicksForLevel(2, 39, 1)).toBe(6);     // the L<=1 special case
  });

  it('formulas 7-11 unchanged (Turgur 1588 f7/65, Cripple 1592 f8/75, Tashania 678 f9/140, Chloroplast 145 f10/205)', () => {
    expect(_durTicksForLevel(7, 65, 60)).toBe(60);
    expect(_durTicksForLevel(8, 75, 60)).toBe(70);
    expect(_durTicksForLevel(9, 140, 60)).toBe(130);
    expect(_durTicksForLevel(10, 205, 60)).toBe(190);
    expect(_durTicksForLevel(11, 300, 5)).toBe(240); // lvl*30+90 == (lvl+3)*30
  });

  it('formula 3 cap-domination unchanged (Aegolism 1447 f3/1500, Clarity II 1693 f3/350)', () => {
    expect(_durTicksForLevel(3, 1500, 60)).toBe(1500);
    expect(_durTicksForLevel(3, 350, 60)).toBe(350);
    expect(_durTicksForLevel(3, 1950, 60)).toBe(1800); // Tunare's Request: formula < cap
  });

  it('formula 4: fixed 50, capped by base — and no longer 0 when cap is 0', () => {
    expect(_durTicksForLevel(4, 30, 60)).toBe(30);   // cap binds, same as before
    expect(_durTicksForLevel(4, 0, 60)).toBe(50);    // was 0 via `cap || 50`… then `!(t>0)`
  });

  it('guards unchanged: permanent, no level, unknown formula', () => {
    expect(_durTicksForLevel(50, 100, 60)).toBe(100);
    expect(_durTicksForLevel(6, 35, 0)).toBe(35);    // no level → spell max
    expect(_durTicksForLevel(99, 77, 60)).toBe(77);  // unknown formula → cap
  });
});
