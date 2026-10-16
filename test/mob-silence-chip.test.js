// test/mob-silence-chip.test.js — the "Silences" / "Silences (AoE)" chip on Target Info.
//
// The guild lead, 2026-10-16: "ADD IN A CARD for SILENCES or SILENCES(AOE) for mobs that silence", on a blood raven
// hatchling whose spell list carries Deafening Screech (spell 1150: SPA 96 silence, targettype 8 targeted AE).
// The bot reads the mob's castable spells and adds the label to `specials`, which Mimic already renders as chips.
//
// Run: npx vitest run test/mob-silence-chip.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, stripJs, BOT_INDEX } from './_source-slice.js';

const require = createRequire(import.meta.url);
const { silenceLabel } = require('../utils/mobSpecials.js');

// Shapes as the mob-info catalog read returns them (eff = raw->eff, 12 slots, 254 = empty).
const SCREECH = { id: 1150, name: 'Deafening Screech', good_effect: 0, targettype: 8, eff: [96, 79, 254, 254] };
const WAVE    = { id: 2,    name: 'Wave of White Noise', good_effect: 0, targettype: 4, eff: [96, 254] };
const SINGLE  = { id: 3,    name: 'a single-target silence', good_effect: 0, targettype: 5, eff: [96, 254] };
const NUKE    = { id: 4,    name: 'a nuke', good_effect: 0, targettype: 5, eff: [0, 254] };
const BUFF    = { id: 5,    name: 'a beneficial 96', good_effect: 1, targettype: 4, eff: [96, 254] };

describe('silenceLabel', () => {
  it('a targeted-AE silence (Deafening Screech) reads "Silences (AoE)"', () => {
    expect(silenceLabel([NUKE, SCREECH])).toBe('Silences (AoE)');
  });
  it('a point-blank AE silence reads "Silences (AoE)"', () => {
    expect(silenceLabel([WAVE])).toBe('Silences (AoE)');
  });
  it('a single-target silence reads "Silences"', () => {
    expect(silenceLabel([SINGLE, NUKE])).toBe('Silences');
  });
  it('AoE wins when the mob has both', () => {
    expect(silenceLabel([SINGLE, WAVE])).toBe('Silences (AoE)');
  });
  it('no silence, or only a beneficial spell carrying the effect: no chip', () => {
    expect(silenceLabel([NUKE])).toBe(null);
    expect(silenceLabel([BUFF])).toBe(null);
    expect(silenceLabel(null)).toBe(null);
  });
  it('falls back to the three effect columns when raw is absent', () => {
    expect(silenceLabel([{ good_effect: 0, targettype: 8, effect_id_1: 79, effect_id_2: 96 }])).toBe('Silences (AoE)');
  });
});

describe('the mob-info endpoint wires it', () => {
  const src = stripJs(readSource(BOT_INDEX));
  it('reads the effects and target type with the spell catalog, then labels from them', () => {
    expect(src).toContain('cast_on_other,cast_on_you,targettype,eff:raw->eff&limit=80');
    expect(src).toContain('silenceChip = mobSpecials.silenceLabel(catRows);');
  });
});
