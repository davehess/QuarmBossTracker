// test/slow-ambiguous-yawn.test.js — a shared landing emote must not be
// presented as an identified slow with a percentage.
//
// The bug (Hitya, 2026-08-10): Ashieron — a PALADIN, who cannot cast a shaman
// slow at all — procced Willsapper and Mob Info showed "SHM SLOW Turgur's 75%".
// Verified against eqemu_spells, the two spells are indistinguishable on a mob:
//
//   Energy Sap      (1960, Willsapper proc)  "yawns."  65 ticks, formula 7, 35%
//   Turgur's Insects(1588, SHM 60)           "yawns."  65 ticks, formula 7, 75%
//
// Same emote, same duration; only the magnitude differs and it is never printed.
// Eleven spells share "yawns.", the junk guard drops the family, and the
// 2026-07-27 slow-rescue keeps the _isSlowSpell members — so parseDebuffLanding
// crowns the longest-duration survivor, Turgur's, for EVERY yawn. buff_casts
// holds 940 Turgur's rows and zero rows for any other yawns spell, ever.
//
// The badge number is what a tank plans around, so an unidentifiable slow now
// reports duration WITHOUT a spell, class or percentage.
//
// Run: npx vitest run test/slow-ambiguous-yawn.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);

// The real 11-spell "yawns." family, straight from eqemu_spells.
const YAWNS = [
  { id: 2267, name: "Curse of Turgur",        other: 'yawns.', dur: 65,  durf: 7, good: 0 },
  { id: 2266, name: "Curse of Walking Sleep", other: 'yawns.', dur: 35,  durf: 6, good: 0 },
  { id: 1056, name: "Debilitating Death",     other: 'yawns.', dur: 100, durf: 3, good: 0 },
  { id: 270,  name: "Drowsy",                 other: 'yawns.', dur: 35,  durf: 6, good: 0 },
  { id: 1960, name: "Energy Sap",             other: 'yawns.', dur: 65,  durf: 7, good: 0 },
  { id: 933,  name: "Mort Drowsy",            other: 'yawns.', dur: 5,   durf: 2, good: 0 },
  { id: 506,  name: "Tagar's Insects",        other: 'yawns.', dur: 35,  durf: 6, good: 0 },
  { id: 1589, name: "Tigir's Insects",        other: 'yawns.', dur: 35,  durf: 6, good: 0 },
  { id: 507,  name: "Togor's Insects",        other: 'yawns.', dur: 35,  durf: 6, good: 0 },
  { id: 1588, name: "Turgur's Insects",       other: 'yawns.', dur: 65,  durf: 7, good: 0 },
  { id: 505,  name: "Walking Sleep",          other: 'yawns.', dur: 35,  durf: 6, good: 0 },
  // An UNambiguous control: one spell owns this emote outright.
  { id: 1926, name: 'Wrath of Nature', other: "has been gripped by nature's wrath.", dur: 30, durf: 1, good: 0 },
];

function build() {
  const harness = `
    const _spellByNameLower = new Map();
    for (const e of ${JSON.stringify(YAWNS)}) _spellByNameLower.set(e.name.toLowerCase(), e);
    let _buffLandingBySuffix = new Map();
    let _debuffLandingBySuffix = new Map();
    function _isTrackedBuffName() { return false; }
    function _looksLikeTargetName(s) { return /^[A-Za-z][A-Za-z '\`]*$/.test(s); }
    // Live "now" — a fixed past date would let the 65-tick window expire before
    // the assertions run, which says nothing about attribution.
    function parseEqTimestamp() { return new Date(); }
    const stats = {};
    const _slowsByTarget = new Map();
    const SLOW_TARGET_CAP = 200, SLOW_PRUNE_GRACE_MS = 3000;
    const _slowCalloutState = new Map();
    function _rampageOnMainTarget() { return false; }   // silence the callout path
    function _maybeAnnounceSlowLand() {}                // callout path is not under test here
    function _assumedCasterLevel() { return 60; }
    function _durTicksForLevel(f, d) { return Number(d) || 0; }
    function _pickBestActiveSlow(entries) {
      return entries.slice().sort((a, b) => (b.magnitude || 0) - (a.magnitude || 0))[0] || null;
    }
    ${sliceBlock(src, 'const SLOW_SPELLS = new Set([', '\n}')}
    ${sliceBlock(src, 'const SLOW_MAGNITUDES = new Map([', '\n}')}
    ${sliceBlock(src, 'function _slowMagnitude(name)', '\n}')}
    ${sliceBlock(src, 'function _isTimedDurationFormula(f)', '\n}')}
    ${sliceBlock(src, 'function _rebuildBuffMatchers()', '\n}\n')}
    ${sliceBlock(src, 'function parseDebuffLanding(line, observer)', '\n}')}
    ${sliceBlock(src, 'function _bestSlowForTarget(targetLower, nowMs)', '\n}')}
    ${sliceBlock(src, 'function _noteSlowForTarget(evt, caster)', '\n}')}
    _rebuildBuffMatchers();
    return { parseDebuffLanding, _noteSlowForTarget, _bestSlowForTarget, _slowsByTarget };
  `;
  // eslint-disable-next-line no-new-func
  return new Function(harness)();
}

const YAWN_LINE = '[Sun Aug 09 21:50:25 2026] A sun revenant yawns.';

describe('parseDebuffLanding marks a shared emote as ambiguous', () => {
  it('flags the yawn and lists the family it could not choose between', () => {
    const h = build();
    const evt = h.parseDebuffLanding(YAWN_LINE, 'Ashieron');
    expect(evt).toBeTruthy();
    expect(evt.ambiguous).toBe(true);
    // The rescue keeps the _isSlowSpell members; Energy Sap is not one of them,
    // which is exactly why a Willsapper proc could never be attributed.
    expect(evt.family).toContain("Turgur's Insects");
    expect(evt.family.length).toBeGreaterThan(1);
  });

  it('does NOT flag a landing whose emote belongs to one spell', () => {
    const h = build();
    const evt = h.parseDebuffLanding(
      "[Sun Aug 09 21:49:14 2026] A sun revenant has been gripped by nature's wrath.", 'Ashieron');
    expect(evt.ambiguous).toBe(false);
    expect(evt.spell_name).toBe('Wrath of Nature');
    expect(evt.spell_id).toBe(1926);
  });
});

describe('the slow badge for an unidentifiable slow', () => {
  it('reports a duration but no spell, class or percentage', () => {
    const h = build();
    h._noteSlowForTarget(h.parseDebuffLanding(YAWN_LINE, 'Ashieron'), null);
    const badge = h._bestSlowForTarget('a sun revenant', Date.now());
    expect(badge).toBeTruthy();
    // The reported bug, asserted directly: no "SHM", no "75%".
    expect(badge.ambiguous).toBe(true);
    expect(badge.magnitude).toBeNull();
    expect(badge.cls).toBeNull();
    expect(badge.display_name).toBe('SLOWED');
    // Duration still shows — it is the useful half and the family agrees closely.
    expect(badge.remaining_secs).toBeGreaterThan(0);
  });

  it('a NAMED cast still shows its real strength', () => {
    const h = build();
    // A shaman's own client resolves the spell exactly, so nothing is lost for
    // the case the badge was built for.
    h._noteSlowForTarget(
      { target: 'a sun revenant', spell_name: "Turgur's Insects", dur_ticks: 65, dur_formula: 7,
        cast_at: new Date().toISOString(), ambiguous: true },
      'Shammy');
    const badge = h._bestSlowForTarget('a sun revenant', Date.now());
    expect(badge.ambiguous).toBe(false);
    expect(badge.magnitude).toBe(75);
    expect(badge.cls).toBe('SHM');
    expect(badge.caster).toBe('Shammy');
  });

  it('a later named cast clears an earlier ambiguous flag on the same slow', () => {
    const h = build();
    h._noteSlowForTarget(h.parseDebuffLanding(YAWN_LINE, 'Ashieron'), null);
    expect(h._bestSlowForTarget('a sun revenant', Date.now()).ambiguous).toBe(true);
    h._noteSlowForTarget(
      { target: 'a sun revenant', spell_name: "Turgur's Insects", dur_ticks: 65, dur_formula: 7,
        cast_at: new Date().toISOString() },
      'Shammy');
    const badge = h._bestSlowForTarget('a sun revenant', Date.now());
    expect(badge.ambiguous).toBe(false);
    expect(badge.magnitude).toBe(75);
  });
});
