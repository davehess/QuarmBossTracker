// A buff or debuff wears off on its ENTITY's tick, not the server tick (the guild lead, 2026-09-27:
// "debuffs and buffs wear off on entity's ticks, which do not correspond with the server ticks..rather
// with when an entity spawned"). The mob-tick learner already knows some mobs' beats; this snaps
// their timers to them.
//
// Run: npx vitest run test/entity-tick-fade.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const { _entityTickFadeAt } = new Function(
  'const MOB_TICK_MS = 6000;\n' + sliceBlock(src, 'function _entityTickFadeAt(landedMs, durTicks, tick) {', '\n}\n')
  + '\nreturn { _entityTickFadeAt };')();

describe('_entityTickFadeAt', () => {
  const tick = { at: 100_000, half: 200 };   // this mob beats at 100_000, 106_000, 112_000 …
  it('with the mob\'s tick known, an N-tick buff fades on the Nth beat after it landed', () => {
    // Landed at 101_000: the first beat after it is 106_000; a 3-tick buff fades on the third: 118_000.
    expect(_entityTickFadeAt(101_000, 3, tick)).toEqual({ at: 118_000, snapped: true, half: 200 });
    // Landed just before a beat: that beat counts, so it fades 5 s sooner than the naive estimate.
    expect(_entityTickFadeAt(105_900, 3, tick).at).toBe(118_000);
    expect(105_900 + 3 * 6000 - _entityTickFadeAt(105_900, 3, tick).at).toBe(5_900);
    // Landed exactly on a beat: the next beat is the first one counted.
    expect(_entityTickFadeAt(106_000, 1, tick).at).toBe(112_000);
  });
  it('the beat is found on the 6 s cycle whatever the reference time', () => {
    expect(_entityTickFadeAt(100_000 + 60 * 6000 + 2_000, 2, tick).at).toBe(100_000 + 62 * 6000);
    expect(_entityTickFadeAt(100_000 - 4_000, 2, tick).at).toBe(106_000);   // landed before the reference
  });
  it('without the tick the naive estimate stands, and says it is not snapped', () => {
    expect(_entityTickFadeAt(101_000, 3, null)).toEqual({ at: 119_000, snapped: false });
    expect(_entityTickFadeAt(101_000, 3, { at: NaN })).toEqual({ at: 119_000, snapped: false });
  });
  it('a timer-less entry, or no landing time, is null', () => {
    expect(_entityTickFadeAt(101_000, 0, tick)).toBe(null);
    expect(_entityTickFadeAt(NaN, 3, tick)).toBe(null);
  });
});

describe('where it is used', () => {
  const s = stripJs(src);
  it('the trigger window\'s spell timer bars count to the mob\'s beat and mark the row', () => {
    expect(s).toMatch(/const fade = _entityTickFadeAt\(Number\(b\.landed_at\) \|\| 0, b\.dur_ticks, _mobTickFor\(mob, now\)\);\s*const remMs = fade \? fade\.at - now : 0;/);
    expect(s).toMatch(/tick_snapped: fade\.snapped/);
  });
  it('Target Info\'s rows on a mob do too, and keep the linger rules for timer-less entries', () => {
    expect(s).toMatch(/const fade = _entityTickFadeAt\(b\.landed_at \|\| now, b\.dur_ticks, _mobTickFor\(targetLower, now\)\);\s*let rem = fade \? \(fade\.at - now\) \/ 1000 : durSecs - \(now - \(b\.landed_at \|\| now\)\) \/ 1000;/);
    expect(s).toMatch(/tick_snapped: !!\(fade && fade\.snapped\)/);
  });
});
