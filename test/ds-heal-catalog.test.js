// test/ds-heal-catalog.test.js — the spell catalog marks a shield-CANCELLING
// debuff (the guild lead, 2026-10-02, on Mark of the Plague Lords: "this debuff
// exists for damage shield reduction and should be reflected in the hud and
// overlays").
//
// A positive SPA 59 is not a smaller shield on the Quarm server: it replaces
// every shield in the spell-bonus sum, and a positive total heals whoever lands
// a melee hit (zone/bonuses.cpp SE_DamageShield; zone/attack.cpp
// Mob::DamageShield). The catalog carries it as `ds_heal`; the agent turns the
// wearer's shield off while it is up (_dsOffFrom).
//
// Run: npx vitest run test/ds-heal-catalog.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, stripJs, BOT_INDEX } from './_source-slice.js';

const bot = readSource(BOT_INDEX);
const { _dsHealMagnitude } = evalBlock(sliceBlock(bot, 'function _dsHealMagnitude(r) {', '\n      }'), ['_dsHealMagnitude']);

// Effect arrays as eqemu_spells.raw stores them (checked against the live catalog).
const MARK_PLAGUE = { raw: { eff: [59, 254, 254], base: [50, 0, 0] } };            // id 1067
const MARK_KARN   = { raw: { eff: [59, 254, 254], base: [6, 0, 0] } };             // id 1548
const SPIKECOAT   = { raw: { eff: [46, 0, 59], base: [5, 20, -4] } };             // a real shield: negative
const NO_DS       = { raw: { eff: [0, 254], base: [-10, 0] } };

describe('ds_heal — a positive SPA 59', () => {
  it('is the per-hit heal for Mark of the Plague Lords and Mark of Karn', () => {
    expect(_dsHealMagnitude(MARK_PLAGUE)).toBe(50);
    expect(_dsHealMagnitude(MARK_KARN)).toBe(6);
  });

  it('is nothing for a real (negative) shield or a spell with no SPA 59', () => {
    expect(_dsHealMagnitude(SPIKECOAT)).toBeNull();
    expect(_dsHealMagnitude(NO_DS)).toBeNull();
  });

  it('falls back to the indexed effect columns when raw is missing', () => {
    expect(_dsHealMagnitude({ effect_id_1: 59, effect_base_value_1: 50 })).toBe(50);
    expect(_dsHealMagnitude({ effect_id_1: 59, effect_base_value_1: -28 })).toBeNull();
  });

  it('rides the catalog entry beside `ds`', () => {
    expect(stripJs(bot)).toMatch(/ds: _dsMagnitude\(r\) \|\| undefined,\s*ds_heal: _dsHealMagnitude\(r\) \|\| undefined,/);
  });
});
