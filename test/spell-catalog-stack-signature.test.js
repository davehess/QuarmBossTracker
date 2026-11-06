// test/spell-catalog-stack-signature.test.js — the spell catalog ships each detrimental
// spell's stacking signature (`st`, `sws`) so the agent can tell that Malosinia overwrites
// Malo (the guild lead, 2026-11-06). Runs the real _stackSignature + _dsFormulaValue.
//
// Run: npx vitest run test/spell-catalog-stack-signature.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, stripJs, BOT_INDEX } from './_source-slice.js';

const bot = readSource(BOT_INDEX);
const { _stackSignature, _dsFormulaValue, _STACK_IGNORED_SPA } = evalBlock(
  'const _dsFormulaWarned = new Set();\n' +
  sliceBlock(bot, 'function _dsFormulaValue(', '\n      }') + '\n' +
  sliceBlock(bot, 'const _STACK_IGNORED_SPA', '\n  return { st: st.length ? st : undefined, sws: sws ? 1 : undefined };\n}'),
  ['_stackSignature', '_dsFormulaValue', '_STACK_IGNORED_SPA']);

const sig = (r) => _stackSignature(r, 65, _dsFormulaValue);
const pad = (a, v) => a.concat(Array(12 - a.length).fill(v));
const malo = {
  good_effect: 0, buffduration: 1000, buffdurationformula: 3,
  raw: { eff: pad([10, 47, 50, 48, 46], 254), base: pad([0, -10, -10, -10, -10], 0),
         max: pad([0, 45, 45, 45, 45], 0), formula: pad([100, 102, 102, 102, 102], 100) },
};
const malosinia = {
  good_effect: 0, buffduration: 1000, buffdurationformula: 3,
  raw: { eff: pad([10, 47, 50, 48, 46], 254), base: pad([0, -70, -70, -70, -70], 0),
         max: pad([0, 0, 0, 0, 0], 0), formula: pad([100, 100, 100, 100, 100], 100) },
};

describe('spell catalog — debuff stacking signature', () => {
  it('Malo and Malosinia both carry st; slot 1 is cold (47); values at level 65', () => {
    const a = sig(malo), b = sig(malosinia);
    expect(a.st[0]).toEqual([1, 47, -45]);      // -10 + 65 = 75, capped at 45
    expect(b.st[0]).toEqual([1, 47, -70]);
    expect(a.st).toHaveLength(4);               // the CHA spacer (slot 0) is not listed
    expect(a.sws).toBeUndefined();
  });

  it('a beneficial spell or an instant has no signature', () => {
    expect(sig({ ...malo, good_effect: 1 })).toBeNull();
    expect(sig({ ...malo, buffduration: 0 })).toBeNull();
  });

  it('drops ignored SPAs, DoT HP / negative AC, and stops at the first blank slot', () => {
    const r = { good_effect: 0, buffduration: 10, buffdurationformula: 1, raw: {
      eff: pad([13, 0, 1, 11, 254, 47], 254), base: pad([1, -50, -20, 70, 0, -9], 0),
      max: pad([], 0), formula: pad([100, 100, 100, 100, 100, 100], 100) } };
    const s = sig(r);
    expect(s.st).toEqual([[3, 11, 70]]);        // 13 ignored, 0/1 negative skipped, slot 5 is past the blank
    expect(s.sws).toBe(1);                      // carries SE_CurrentHP -> DoTs from two casters coexist
  });

  it('lists the ignored SPA ids from the server', () => {
    for (const id of [13, 24, 35, 36, 57, 65, 66, 79, 116, 124, 144, 148, 149, 254]) expect(_STACK_IGNORED_SPA.has(id)).toBe(true);
    expect(_STACK_IGNORED_SPA.has(47)).toBe(false);
  });

  it('a spell with nothing that can collide carries nothing', () => {
    const r = { good_effect: 0, buffduration: 10, buffdurationformula: 1, raw: { eff: pad([13], 254), base: pad([1], 0), max: pad([], 0), formula: pad([], 100) } };
    expect(sig(r)).toBeNull();
  });

  it('the handler attaches st/sws to the entry (text check, comments stripped)', () => {
    const code = stripJs(bot);
    expect(code).toMatch(/st:\s+_sig \? _sig\.st : undefined/);
    expect(code).toMatch(/sws: _sig \? _sig\.sws : undefined/);
  });
});
