// test/instanced-target-gate.test.js — instanced mob names must not silence callouts.
//
// Vex Thal is instanced, so Zeal reports the target as "#Diabo_Xi_Va_Temariel"
// while the log emote carrying a slow landing says "Diabo Xi Va Temariel".
// _rampageOnMainTarget compared those two strings raw, so the SLOW LANDED
// callout was suppressed for the entire instance — a Beastlord slow and a Shaman
// slow both landed on the boss and nobody heard either (Hitya, live 2026-08-13).
//
// This is the nastiest shape of bug in this codebase: the debuffs still appeared
// in Target Info (that path deliberately skips the Zeal name match), so every
// visible surface looked healthy. A suppressed callout is indistinguishable from
// a callout that was never meant to fire.
//
// The hazard was already documented one function away, in parseDebuffLanding:
// "breaks on instanced mob names like #Diabo_Xi_Va_Temariel vs the emote's
// Diabo Xi Va Temariel". The gate simply never got the same treatment — which is
// why this file asserts the gate NORMALIZES rather than merely that it works
// today.
//
// Run: npx vitest run test/instanced-target-gate.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const gate = sliceBlock(src, 'function _rampageOnMainTarget(attacker) {', '\n}');

// Mirror of the shipped normalizer.
const norm = (n) => String(n || '').trim().toLowerCase()
  .replace(/'s\s+corpse$/, '')
  .replace(/[\s`'’]+/g, '_')
  .replace(/^#/, '');

describe('the gate normalizes both sides', () => {
  it('does not compare raw lowercase any more', () => {
    expect(gate, 'a raw === compare is what suppressed the slow callout')
      .not.toMatch(/String\(mainName\)\.trim\(\)\.toLowerCase\(\)/);
  });

  it('runs the attacker through _normMobNameAgent', () => {
    expect(gate).toMatch(/const a = _normMobNameAgent\(attacker\)/);
  });

  it('runs the resolved main target through it too', () => {
    expect(gate).toMatch(/return a === _normMobNameAgent\(mainName\)/);
  });

  it('still fails OPEN when the main target cannot be resolved', () => {
    // A cold cache must never cost the raid a boss rampage callout.
    expect(gate).toMatch(/if \(!mainName\) return true;/);
    expect(gate).toMatch(/if \(!attacker\) return true;/);
  });
});

describe('the instanced pairs that were being missed', () => {
  const PAIRS = [
    ['#Diabo_Xi_Va_Temariel', 'Diabo Xi Va Temariel'],
    ['#Thall_Va_Xakra',       'Thall Va Xakra'],
    ['#Aten_Ha_Ra',           'Aten Ha Ra'],
  ];
  for (const [zealName, emoteName] of PAIRS) {
    it(`matches ${zealName} to ${emoteName}`, () => {
      expect(norm(zealName)).toBe(norm(emoteName));
    });
  }

  it('would NOT have matched before the fix', () => {
    // Characterisation: prove the old comparison really did fail, so a revert
    // to raw lowercase fails here loudly rather than silently going quiet again.
    for (const [zealName, emoteName] of PAIRS) {
      expect(zealName.trim().toLowerCase()).not.toBe(emoteName.trim().toLowerCase());
    }
  });
});

describe('it still tells genuinely different mobs apart', () => {
  it('does not collapse two different bosses', () => {
    expect(norm('#Diabo_Xi_Va_Temariel')).not.toBe(norm('Thall Va Xakra'));
    expect(norm('a thought horror evoker')).not.toBe(norm('an elder thought horror'));
  });

  it('does not let the corpse strip merge unrelated names', () => {
    expect(norm("Vyzh`dra the Exiled's corpse")).toBe(norm('Vyzh`dra the Exiled'));
    expect(norm("Vyzh`dra the Exiled's corpse")).not.toBe(norm('Vyzh`dra the Cursed'));
  });
});
