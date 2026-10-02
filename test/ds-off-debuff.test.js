// test/ds-off-debuff.test.js — a shield-cancelling debuff turns the damage
// shield OFF on the HUD and the Tank overlay (the guild lead, 2026-10-02, with a
// screenshot of Mark of the Plague Lords: "this debuff exists for damage shield
// reduction and should be reflected in the hud and overlays").
//
// The Quarm server does not subtract it: a positive SPA 59 replaces every
// shield in the spell-bonus sum, and a positive total heals whoever lands a
// melee hit (zone/bonuses.cpp SE_DamageShield, zone/attack.cpp
// Mob::DamageShield). The bot's catalog carries that as `ds_heal`; these run the
// agent's real _knownDsPerHitFor / _dsOffFrom against it.
//
// Run: npx vitest run test/ds-off-debuff.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, AGENT_INDEX } from './_source-slice.js';

const agent = readSource(AGENT_INDEX);

function load({ zealBuffs = null, observed = [] } = {}) {
  const block = `
    const _zealState = ${JSON.stringify(zealBuffs ? { Aldenmar: { buffs: zealBuffs } } : {})};
    const _mtLiveStateByName = new Map();
    function targetBuffsFor() { return ${JSON.stringify(observed)}; }
    const _targetBuffsByName = new Map();
    function _relayCacheKey(n) { return String(n).toLowerCase(); }
    const _spellByNameLower = new Map([
      ['spikecoat', { name: 'Spikecoat', ds: 23 }],
      ['shield of lava', { name: 'Shield of Lava', ds: 25 }],
      ['mark of the plague lords', { name: 'Mark of the Plague Lords', ds_heal: 50 }],
    ]);
    ${sliceBlock(agent, 'function _knownDsPerHitFor(name, out) {', '\n}')}
    ${sliceBlock(agent, 'function _dsOffFrom(list) {', '\n}')}
    ${sliceBlock(agent, 'function _dsKindOf(text) {', '\n}')}
  `;
  return evalBlock(block, ['_knownDsPerHitFor', '_dsOffFrom']);
}

describe('damage shield off under Mark of the Plague Lords', () => {
  it('sums the shields worn when no cancelling debuff is up', () => {
    const h = load({ zealBuffs: [{ name: 'Spikecoat', seconds: 7000 }, { name: 'Shield of Lava', seconds: 900 }] });
    const out = {};
    expect(h._knownDsPerHitFor('Aldenmar', out)).toBe(48);
    expect(out.off).toBeUndefined();
  });

  it('is 0 a hit while the Mark is up, whatever shields are worn — and says which debuff and for how long', () => {
    const h = load({ zealBuffs: [{ name: 'Spikecoat', seconds: 7000 }, { name: 'Mark of the Plague Lords', seconds: 180 }] });
    const out = {};
    expect(h._knownDsPerHitFor('Aldenmar', out)).toBe(0);
    expect(out.off).toEqual({ name: 'Mark of the Plague Lords', heals: 50, seconds: 180 });
  });

  it('reads observed landings too (remaining_secs), and ignores one that fell off', () => {
    const live = load({ observed: [{ name: 'Spikecoat', remaining_secs: 6000 }, { name: 'Mark of the Plague Lords', remaining_secs: 95 }] });
    const out = {};
    expect(live._knownDsPerHitFor('Aldenmar', out)).toBe(0);
    expect(out.off.seconds).toBe(95);
    const faded = load({ observed: [{ name: 'Spikecoat', remaining_secs: 6000 }, { name: 'Mark of the Plague Lords', remaining_secs: 0, fell_off: true }] });
    expect(faded._knownDsPerHitFor('Aldenmar', {})).toBe(23);
  });

  it('_dsOffFrom is null for a list with no cancelling debuff, and for an empty one', () => {
    const h = load();
    expect(h._dsOffFrom([{ name: 'Spikecoat', seconds: 10 }])).toBeNull();
    expect(h._dsOffFrom(null)).toBeNull();
  });

  it('the Tank overlay\'s two DS cards carry the off state', () => {
    // The HUD's button (/api/me combat.ds) is run for real in me-hud-timers; the
    // tank-state builder is too wide to boot here, so these two read its source.
    expect(agent).toMatch(/const dsOff = _dsOffFrom\(buffsOut\);/);
    expect(agent).toMatch(/sources: dsSources\.slice\(0, 8\),\n\s+off: dsOff,/);
    expect(agent).toMatch(/sources: mtDsSources\.slice\(0, 8\), off: _dsOffFrom\(mtBuffs\) \}/);
  });
});
