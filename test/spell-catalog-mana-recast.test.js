// test/spell-catalog-mana-recast.test.js — the spell catalog carries each
// spell's mana cost and recast time.
//
// The Me overlay (the guild lead, 2026-09-24: "clerics focus on how many CHs
// are left · enchanters, charms or mezzes left, theft of thought or harvest
// timers") needs both, and the catalog carried neither: the agent could see a
// spell's name, landing text and cast time, but not what it costs or how long
// until it can go again.
//
// Run: npx vitest run test/spell-catalog-mana-recast.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, stripJs, sliceBlock, evalBlock } from './_source-slice.js';

const src = stripJs(readSource(BOT_INDEX));

describe('spell catalog', () => {
  it('reads mana and recast_time from eqemu_spells', () => {
    const m = src.match(/const SELECT = 'select=([^']+)'/);
    expect(m).not.toBeNull();
    const cols = m[1].split(',');
    expect(cols).toContain('mana');
    expect(cols).toContain('recast_time');
  });

  it('ships them on each entry, only when non-zero', () => {
    expect(src).toContain('mana:   Number(r.mana) > 0 ? Number(r.mana) : undefined,');
    expect(src).toContain('recast: Number(r.recast_time) > 0 ? Number(r.recast_time) : undefined,');
  });

  // "mezzes left" and Blind Mode both key on the spell's EFFECT, not a name
  // list: SPA 31 mesmerize, SPA 20 blindness.
  it('flags mez (SPA 31) and blind (SPA 20) spells', () => {
    expect(src).toContain('mez:   _hasSpa(r, 31) ? 1 : undefined,');
    expect(src).toContain('blind: _hasSpa(r, 20) ? 1 : undefined,');
  });

  it('carries the element (resist type) for the HUD\'s damage colours', () => {
    const m = src.match(/const SELECT = 'select=([^']+)'/);
    expect(m[1].split(',')).toContain('resist_type');
    expect(src).toContain('rt:    Number(r.resist_type) > 0 ? Number(r.resist_type) : undefined,');
  });
});

describe('_manaDrain', () => {
  const fn = sliceBlock(readSource(BOT_INDEX), '      function _manaDrain(r) {', '\n      }');
  const drain = evalBlock(fn, ['_manaDrain'])._manaDrain;
  const raw = (base, formula, max) => ({ eff: [15, 254], base: [base, 0], formula: [formula, 100], max: [max, 0] });
  it('reads a detrimental SPA-15 drain: Theft of Thought -40, formula 6, max 400', () => {
    expect(drain({ good_effect: 0, raw: raw(-40, 6, 400) })).toEqual({ b: 40, f: 6, m: 400 });
  });
  it('the same SPA on a beneficial spell is the caster\'s cost, not a drain (Succor)', () => {
    expect(drain({ good_effect: 1, raw: raw(-150, 100, 0) })).toBeNull();
  });
  it('a mana GAIN is not a drain', () => {
    expect(drain({ good_effect: 0, raw: raw(25, 100, 0) })).toBeNull();
  });
  it('ships on the catalog entry', () => {
    expect(src).toContain('drain: _manaDrain(r) || undefined,');
  });
});

describe('_hasSpa', () => {
  const fn = sliceBlock(readSource(BOT_INDEX), '      function _hasSpa(r, spa) {', '\n      }');
  const hasSpa = evalBlock(fn, ['_hasSpa'])._hasSpa;
  it('finds an effect in any of the twelve raw slots', () => {
    expect(hasSpa({ raw: { eff: [254, 254, 254, 254, 254, 254, 254, 254, 254, 254, 254, 31] } }, 31)).toBe(true);
    expect(hasSpa({ raw: { eff: [0, 15] } }, 31)).toBe(false);
  });
  it('falls back to the three indexed columns without raw', () => {
    expect(hasSpa({ effect_id_2: 20 }, 20)).toBe(true);
    expect(hasSpa({ effect_id_1: 0 }, 20)).toBe(false);
  });
});
