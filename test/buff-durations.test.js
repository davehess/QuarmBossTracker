// test/buff-durations.test.js — measuring how long a buff actually lasted.
//
// Hitya, 2026-09-02: "Move buffs to the buffs tab and give it a more robust view
// of effects and timeframes ... also provide an estimate of how long cast buffs
// will last by character based on AA/Focus effects."
//
// ⚠ THE MEASUREMENT IS A LOWER BOUND, NOT AN ANSWER, and the whole design
// follows from that. Zeal reports REMAINING ticks per buff slot each poll, so
// the highest remaining reading we ever see for one instance is the reading
// taken closest to the moment it landed. If we first see a buff halfway through,
// the sample is half its real length. That is why the UI shows a median, a
// spread and n rather than a single confident number — and why nothing here may
// ever be presented as exact.
//
// ⚠ Why measured at all, rather than computed from AA focus data: our
// eqemu_aa_effects mirror CANNOT give the multiplier. Spell Casting Mastery
// (mana cost) and Spell Casting Reinforcement (buff duration) share effectid 5,
// and Natural Durability (max HP) and Combat Fury (crit) share effectid 9 — so
// base1 is not a percentage of anything identifiable. Reading "10" as "+10%
// duration" would be a confidently wrong number. Watching what actually happens
// sidesteps the whole question and is correct for Quarm's own tuning.
//
// Run: npx vitest run test/buff-durations.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import agent from '../packages/wolfpack-logsync/index.js';
import { readSource, AGENT_INDEX } from './_source-slice.js';

const { _noteBuffDurationsFromState, buffDurationStats, _noteBuffDurationSample } = agent;
const buff = (name, ticks) => ({ name, ticks });
const state = (...b) => ({ buffs: b });

let uniq = 0;
const spell = () => 'TestSpell' + (++uniq);

describe('watching a buff end', () => {
  // ⚠ Known and accepted false negative: a character carrying exactly ONE buff
  // which then expires looks identical to a zone, so that sample is discarded.
  // Losing a sample is the safe direction; recording a truncated one is not.
  it('records nothing while the buff is still up', () => {
    const sp = spell();
    _noteBuffDurationsFromState('hitya', state(), state(buff(sp, 100)));
    _noteBuffDurationsFromState('hitya', state(buff(sp, 100)), state(buff(sp, 90)));
    expect(buffDurationStats(sp)).toBe(null);
  });

  // A second buff stays up throughout, which is both realistic (a raider always
  // carries several) and required: a buff window that empties completely is
  // treated as a zone, not as an expiry — see the guard test below.
  it('records the HIGHEST reading when it disappears, not the last', () => {
    const sp = spell(), other = spell();
    _noteBuffDurationsFromState('hitya', state(), state(buff(sp, 100), buff(other, 500)));
    _noteBuffDurationsFromState('hitya', state(buff(sp, 100), buff(other, 500)), state(buff(sp, 40), buff(other, 490)));
    _noteBuffDurationsFromState('hitya', state(buff(sp, 40), buff(other, 490)), state(buff(other, 480)));
    const st = buffDurationStats(sp);
    expect(st.n).toBe(1);
    expect(st.median).toBe(600);   // 100 ticks × 6, not 40
  });

  // ⚠ Buffs do not all expire on the same tick. A poll where every buff vanished
  // at once is a client zoning, camping, or the pipe dropping — and sampling it
  // would record everything the character was carrying as truncated, dragging
  // every median down by however long they had left.
  it('ignores a poll where EVERY buff vanished at once (a zone, not an expiry)', () => {
    const a = spell(), b = spell();
    _noteBuffDurationsFromState('hitya', state(), state(buff(a, 100), buff(b, 100)));
    _noteBuffDurationsFromState('hitya', state(buff(a, 100), buff(b, 100)), state());
    expect(buffDurationStats(a)).toBe(null);
    expect(buffDurationStats(b)).toBe(null);
  });

  // ...but one buff ending while others remain is a real expiry and must count.
  it('still records a single buff ending while others remain up', () => {
    const a = spell(), b = spell();
    _noteBuffDurationsFromState('hitya', state(), state(buff(a, 100), buff(b, 100)));
    _noteBuffDurationsFromState('hitya', state(buff(a, 100), buff(b, 100)), state(buff(b, 90)));
    expect(buffDurationStats(a).n).toBe(1);
    expect(buffDurationStats(b)).toBe(null);
  });

  it('keeps characters separate — two people carrying one buff are two instances', () => {
    const sp = spell(), keep = spell();
    _noteBuffDurationsFromState('hitya',  state(), state(buff(sp, 100), buff(keep, 900)));
    _noteBuffDurationsFromState('canopy', state(), state(buff(sp, 30),  buff(keep, 900)));
    _noteBuffDurationsFromState('hitya',  state(buff(sp, 100), buff(keep, 900)), state(buff(keep, 890)));
    expect(buffDurationStats(sp).n).toBe(1);
    _noteBuffDurationsFromState('canopy', state(buff(sp, 30), buff(keep, 900)), state(buff(keep, 890)));
    const st = buffDurationStats(sp);
    expect(st.n).toBe(2);
    expect(st.min).toBe(180);
    expect(st.max).toBe(600);
  });

  // Permanent buffs (illusions, some clickies) report no tick count. That is a
  // fact about the buff, not a missing reading, and must not become a 0s sample.
  //
  // ⚠ This asserts the OUTCOME, not any one guard, and says so because mutation
  // testing showed why: three layers independently enforce it (the tracker skips
  // non-positive ticks, the disappearance path requires ticks > 0, and the
  // sample validator rejects non-positive seconds). Removing any single one
  // leaves the outcome correct, so no honest test can pin an individual guard —
  // and a test claiming to would be vacuous.
  it('never samples a buff that reported no ticks', () => {
    const sp = spell(), keep = spell();
    _noteBuffDurationsFromState('hitya', state(), state(buff(sp, 0), buff(keep, 900)));
    _noteBuffDurationsFromState('hitya', state(buff(sp, 0), buff(keep, 900)), state(buff(keep, 890)));
    expect(buffDurationStats(sp)).toBe(null);
  });
});

describe('the statistics', () => {
  it('reports median, quartiles and range over the samples', () => {
    const sp = spell();
    for (const s of [100, 200, 300, 400, 500]) _noteBuffDurationSample(sp, s);
    const st = buffDurationStats(sp);
    expect(st.n).toBe(5);
    expect(st.median).toBe(300);
    expect(st.min).toBe(100);
    expect(st.max).toBe(500);
    expect(st.p25).toBeLessThanOrEqual(st.median);
    expect(st.p75).toBeGreaterThanOrEqual(st.median);
  });

  it('is order-independent', () => {
    const a = spell(), b = spell();
    for (const s of [10, 90, 50]) _noteBuffDurationSample(a, s);
    for (const s of [90, 50, 10]) _noteBuffDurationSample(b, s);
    expect(buffDurationStats(a)).toEqual(buffDurationStats(b));
  });

  it('rejects impossible samples rather than storing them', () => {
    const sp = spell();
    for (const bad of [0, -5, null, undefined, NaN, 25 * 3600]) _noteBuffDurationSample(sp, bad);
    expect(buffDurationStats(sp)).toBe(null);
  });

  // Bounded: a long raid must not grow this without limit.
  it('caps the samples it keeps per spell', () => {
    const sp = spell();
    for (let i = 0; i < 200; i++) _noteBuffDurationSample(sp, 100 + i);
    const st = buffDurationStats(sp);
    expect(st.n).toBeLessThanOrEqual(60);
    // Keeps the NEWEST, so a character who re-specs is not averaged against
    // their old focus forever.
    expect(st.max).toBe(299);
  });
});

// ── Item 3: the per-character duration factor ───────────────────────────────
//
// ⚠ MEASURED, NOT COMPUTED FROM AAs — and that is a finding, not a shortcut.
// Checked against our own mirror: in eqemu_aa_effects, Spell Casting Mastery
// (mana cost) and Spell Casting Reinforcement (buff DURATION) both carry
// effectid 5; Natural Durability (max HP) and Combat Fury (crit) both carry
// effectid 9. So effectid is not a semantic effect type and base1 is not a
// percentage of anything identifiable. Reading Reinforcement's base1 of 10 as
// "+10% duration" would be a confidently wrong number. Watching what actually
// happens sidesteps the question and is correct for Quarm's own tuning.
describe('the per-character duration factor', () => {
  const { buffDurationFactorFor, _noteBuffDurationsFromState: note } = agent;

  it('says why rather than inventing a number when it has too little', () => {
    const r = buffDurationFactorFor('nobodyatall');
    expect(r.factor).toBe(null);
    expect(String(r.why)).toMatch(/not enough/i);
  });

  it('refuses a character it has never seen', () => {
    expect(buffDurationFactorFor('')).toBe(null);
  });

  // ⚠ A box runs several characters, so attributing the machine's whole corpus
  // to each of them would not be "by character" at all.
  //
  // ⚠ ASSERTED ON THE CODE, NOT THE BEHAVIOUR, and labelled as such because
  // mutation testing showed a behavioural version here is VACUOUS: no spell
  // catalog is loaded in a test process, so _catalogDurationSec returns null for
  // every spell, every ratio list is empty, and the factor takes the "not enough
  // data" path no matter what the per-character filter does. Removing the filter
  // entirely still passed. Reaching it for real needs a catalog seam this does
  // not have; until then this pins the guard's presence and says so, rather than
  // implying coverage it has not got.
  it('filters the corpus to spells that character was seen carrying', () => {
    const src = readSource(AGENT_INDEX);
    expect(src).toContain("if (!_buffSeenByChar.has(ch + '|' + spellLower)) continue;");
    expect(src).toContain('_buffSeenByChar.add(key);');
  });

  // The factor is a median of per-spell RATIOS, not a ratio of totals — one
  // long buff would otherwise decide the whole answer.
  it('is documented as a median of ratios, not a ratio of totals', () => {
    const src = readSource(AGENT_INDEX);
    expect(src).toContain('median of per-spell ratios');
  });

  it('reports the spread so a noisy factor is not read as precision', () => {
    const r = buffDurationFactorFor('nobodyatall');
    // Even the refusal shape carries the fields the card renders.
    expect(r).toHaveProperty('spells');
    expect(r).toHaveProperty('character');
  });
});
