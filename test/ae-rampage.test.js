// How wide is a mob's Area Rampage (the guild lead, 2026-10-15). REAL-IMPORT for the maths in
// utils/aeRampage.js; the last block reads index.js (comments stripped) to prove mob-info carries
// the result. The rule is Project Quarm's server (EQMacEmu): reach = 0.75 x (mob radius + player
// radius 5), at least 14, +2 while the mob stands still, at most 75 (60 if it can never move);
// the mob's radius is a per-race base (6.0 by default) x size / 5.
//
// Worked example, A_Recuso_Degenerate (eqemu_npc_types id 211045): race 237, size 12, ability
// `4,1,5`: radius 14.4, reach 14.55 moving and 16.55 standing, 5% per round.
//
// Run: npx vitest run test/ae-rampage.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { BOT_INDEX, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const ae = require('../utils/aeRampage.js');

describe('boundingRadius', () => {
  it('scales the default 6.0 by size / 5 (Recuso: race 237, size 12)', () => {
    expect(ae.boundingRadius(237, 12)).toBeCloseTo(14.4, 5);
    expect(ae.boundingRadius(237, 5)).toBeCloseTo(6, 5);
  });

  it('fixes the playable races at radius 5 whatever the catalog size says', () => {
    for (const race of [1, 8, 12, 128, 130]) {
      expect(ae.boundingRadius(race, 12)).toBe(5);
      expect(ae.boundingRadius(race, null)).toBe(5);
    }
  });

  it('uses a different base radius for the races that differ (Velious dragons 9.48)', () => {
    expect(ae.boundingRadius(184, 5)).toBeCloseTo(9.48, 5);
    expect(ae.boundingRadius(184, 10)).toBeCloseTo(18.96, 5);
    expect(ae.boundingRadius(19, 5)).toBeCloseTo(10.48, 5);
  });

  it('replaces the size for a lava dragon (32.5), wurm (16) and bat (5)', () => {
    expect(ae.boundingRadius(49, 1)).toBeCloseTo(39, 5);
    expect(ae.boundingRadius(158, 99)).toBeCloseTo(19.2, 5);
    expect(ae.boundingRadius(34, 20)).toBeCloseTo(6, 5);
  });

  it('is null when the size is unknown rather than a guess', () => {
    expect(ae.boundingRadius(237, null)).toBeNull();
    expect(ae.boundingRadius(237, 0)).toBeNull();
    expect(ae.boundingRadius(237, 'x')).toBeNull();
  });
});

describe('aeRampageRadius', () => {
  it('Recuso: 14.55 while moving, 16.55 standing', () => {
    expect(ae.aeRampageRadius(237, 12, { moving: true })).toBeCloseTo(14.55, 5);
    expect(ae.aeRampageRadius(237, 12, { moving: false })).toBeCloseTo(16.55, 5);
    expect(ae.aeRampageRadius(237, 12)).toBeCloseTo(16.55, 5);   // standing is the default
  });

  it('never goes under 14 (+2 standing)', () => {
    // radius 6 x 1/5 = 1.2 -> 0.75 x 6.2 = 4.65, lifted to 14
    expect(ae.aeRampageRadius(237, 1, { moving: true })).toBe(14);
    expect(ae.aeRampageRadius(237, 1, { moving: false })).toBe(16);
  });

  it('never goes over 75, and 60 for a mob that can never move', () => {
    expect(ae.aeRampageRadius(237, 200, { moving: true })).toBe(75);
    expect(ae.aeRampageRadius(237, 200, { moving: false })).toBe(75);
    expect(ae.aeRampageRadius(237, 200, { moving: false, rooted: true })).toBe(60);
  });

  it('a mob of a playable race reaches 0.75 x 10 = 7.5, lifted to 14', () => {
    expect(ae.aeRampageRadius(1, 5, { moving: true })).toBe(14);
  });

  it('is null when the size is unknown', () => {
    expect(ae.aeRampageRadius(237, null)).toBeNull();
  });
});

describe('aeRampageParams', () => {
  it('reads chance, targets and damage from ability 4 (Recuso: 4,1,5)', () => {
    expect(ae.aeRampageParams('1,1^4,1,5^31,1')).toEqual({ chance: 5, targets: null, damagePct: 100 });
    expect(ae.aeRampageParams('4,1,10,3,50')).toEqual({ chance: 10, targets: 3, damagePct: 50 });
  });

  it('defaults to 20% / everyone / 100% when the parameters are blank or 0', () => {
    expect(ae.aeRampageParams('4,1')).toEqual({ chance: 20, targets: null, damagePct: 100 });
    expect(ae.aeRampageParams('4,1,0,0,0')).toEqual({ chance: 20, targets: null, damagePct: 100 });
    expect(ae.aeRampageParams('4,1,,,')).toEqual({ chance: 20, targets: null, damagePct: 100 });
  });

  it('is null without ability 4, switched off, or with no string at all', () => {
    expect(ae.aeRampageParams('1,1^3,1')).toBeNull();
    expect(ae.aeRampageParams('4,0,5')).toBeNull();
    expect(ae.aeRampageParams('')).toBeNull();
    expect(ae.aeRampageParams(null)).toBeNull();
  });
});

describe('aeRampageInfo (the mob-info field)', () => {
  const recuso = { race: 237, size: 12, special_abilities: '4,1,5', runspeed: 1.25 };

  it('Recuso: both radii, chance 5, everyone, 100%', () => {
    expect(ae.aeRampageInfo(recuso)).toEqual({
      radius_still: 16.55, radius_moving: 14.55, chance: 5, targets: null, damage_pct: 100,
    });
  });

  it('is null for a mob without Area Rampage or without a size', () => {
    expect(ae.aeRampageInfo({ ...recuso, special_abilities: '3,1' })).toBeNull();
    expect(ae.aeRampageInfo({ ...recuso, size: null })).toBeNull();
    expect(ae.aeRampageInfo(null)).toBeNull();
  });

  it('caps a rooted mob (runspeed 0) at 60', () => {
    const r = ae.aeRampageInfo({ race: 237, size: 200, special_abilities: '4,1', runspeed: 0 });
    expect(r.radius_still).toBe(60);
    expect(ae.aeRampageInfo({ race: 237, size: 200, special_abilities: '4,1', runspeed: 1 }).radius_still).toBe(75);
  });
});

describe('mob-info wiring', () => {
  const src = stripJs(fs.readFileSync(BOT_INDEX, 'utf8'));

  it('mobSpecials hands the bot the same answer', () => {
    const ms = require('../utils/mobSpecials.js');
    expect(ms.aeRampageInfo({ race: 237, size: 12, special_abilities: '4,1,5', runspeed: 1 }).radius_still).toBe(16.55);
  });

  it('selects size with the race and builds ae_rampage from the picked row', () => {
    expect(src).toMatch(/see_improved_hide,race,size,gender&limit=200/);
    expect(src).toMatch(/const aeRampage = mobSpecials\.aeRampageInfo\(r\);/);
    expect(src).toMatch(/\.\.\.\(aeRampage \? \{ ae_rampage: aeRampage \} : \{\}\)/);
  });
});
