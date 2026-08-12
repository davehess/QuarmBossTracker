// test/ch-slot-conflict.test.js — two callers on one CH slot number must show
// BOTH names, in first-claimed order, never a silent overwrite.
//
// The incident (Hitya, 2026-08-10 Ssra; DESIGN-extended-target-v2.md §5):
// Mcdorf held slot 001; Pyxil called a CH as 001 and REPLACED Mcdorf on the
// overlay. The call (Hitya, 2026-08-11): "Mcdorf and Pyxil both having 001 in
// their numbering shouldn't overwrite the spot, it should show both of them in
// the order" — plus an ORDER CONFLICT banner. This is the display-side half;
// the officer-pushed authoritative rotation remains the structural fix and is
// still an open question.
//
// Run: npx vitest run test/ch-slot-conflict.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const block = sliceBlock(src, 'const CH_CLAIM_WINDOW_MS', '\n}')
            + sliceBlock(src, 'function _chReleaseClaimantsElsewhere', '\n}');

// eslint-disable-next-line no-new-func
const { _chMergeClaimants, _chReleaseClaimantsElsewhere, CH_CLAIM_WINDOW_MS } =
  new Function(block + '\nreturn { _chMergeClaimants, _chReleaseClaimantsElsewhere, CH_CLAIM_WINDOW_MS };')();

const T = 1_000_000;

describe('_chMergeClaimants', () => {
  it('the Mcdorf/Pyxil case: both kept, first claimant stays first', () => {
    const slot1 = { name: 'Mcdorf', lastAtMs: T, claimants: [{ name: 'Mcdorf', lastAtMs: T }] };
    const out = _chMergeClaimants(slot1, 'Pyxil', 'Pyxil', T + 5000);
    expect(out.map(c => c.name)).toEqual(['Mcdorf', 'Pyxil']);
  });

  it('the same caller repeating refreshes their stamp without duplicating', () => {
    const prev = { claimants: [{ name: 'Mcdorf', lastAtMs: T }] };
    const out = _chMergeClaimants(prev, 'Mcdorf', 'Mcdorf', T + 9000);
    expect(out).toHaveLength(1);
    expect(out[0].lastAtMs).toBe(T + 9000);
  });

  it('a claimant silent past the window is evicted — conflicts self-heal', () => {
    // Pyxil corrects their numbering; Mcdorf's row must not stay contested for
    // the rest of the night.
    const prev = { claimants: [
      { name: 'Mcdorf', lastAtMs: T },
      { name: 'Pyxil',  lastAtMs: T + 1000 },
    ] };
    const later = T + 1000 + CH_CLAIM_WINDOW_MS + 1;
    const out = _chMergeClaimants(prev, 'Mcdorf', 'Mcdorf', later);
    expect(out.map(c => c.name)).toEqual(['Mcdorf']);
  });

  it('legacy slots without a claimants array seed from the plain name', () => {
    // Rolling upgrade: a chain started on the previous build has {name} only.
    const out = _chMergeClaimants({ name: 'Mcdorf', lastAtMs: T }, 'Pyxil', 'Pyxil', T + 3000);
    expect(out.map(c => c.name)).toEqual(['Mcdorf', 'Pyxil']);
  });

  it('roster-resolved name and a DIFFERENT speaker both claim', () => {
    // The inverse direction of the bug: roster says the slot is Mcdorf's, so a
    // mis-calling Pyxil used to be invisible. Both must surface.
    const out = _chMergeClaimants({}, 'Mcdorf', 'Pyxil', T);
    expect(out.map(c => c.name).sort()).toEqual(['Mcdorf', 'Pyxil']);
  });

  it('non-character tokens never become claimants', () => {
    // "is" in slot 006 (findings §3) must not gain a second life here.
    const out = _chMergeClaimants({}, 'Mcdorf', "Shavimo`s warder", T);
    expect(out.map(c => c.name)).toEqual(['Mcdorf']);
  });

  // Per-claimant mana (Hitya, live test 2026-08-12): the overlay now renders one
  // ROW per claimant so each cleric's own cast bar is visible, which means each
  // claimant has to carry its own mana — a single shared number would print the
  // caller's mana against the other cleric's name.
  it('each claimant keeps their own mana, not the last caller\'s', () => {
    const first = _chMergeClaimants(null, 'Mcdorf', 'Mcdorf', T, 54);
    expect(first).toEqual([{ name: 'Mcdorf', lastAtMs: T, mana: 54 }]);

    const both = _chMergeClaimants({ name: 'Mcdorf', lastAtMs: T, claimants: first },
                                   'Stupidrichard', 'Stupidrichard', T + 5000, 95);
    expect(both.map(c => c.name)).toEqual(['Mcdorf', 'Stupidrichard']);
    expect(both.map(c => c.mana)).toEqual([54, 95]);   // Mcdorf's 54 survives
  });

  it('a repeat call updates that claimant\'s mana only', () => {
    const seed = _chMergeClaimants(null, 'Mcdorf', 'Mcdorf', T, 54);
    const two  = _chMergeClaimants({ claimants: seed }, 'Fargan', 'Fargan', T + 1000, 92);
    const back = _chMergeClaimants({ claimants: two }, 'Mcdorf', 'Mcdorf', T + 2000, 31);
    const byName = Object.fromEntries(back.map(c => [c.name, c.mana]));
    expect(byName).toEqual({ Mcdorf: 31, Fargan: 92 });
  });

  it('an older agent sending no mana leaves it null rather than guessing', () => {
    const out = _chMergeClaimants(null, 'Mcdorf', 'Mcdorf', T);
    expect(out[0].mana).toBeNull();
  });

  it('one clean caller produces one claimant — no conflict from normal play', () => {
    const out = _chMergeClaimants({}, 'Aimey', 'Aimey', T);
    expect(out).toHaveLength(1);
  });
});

// The live sequence Hitya reported (2026-08-12): Mcdorf and Stupidrichard both
// call 002 (conflict, correctly), then Stupidrichard moves to 003 — at which
// point 002 is uncontested and the banner must clear IMMEDIATELY, not after the
// 120s claim window, and not only if someone happens to call 002 again.
describe('_chReleaseClaimantsElsewhere', () => {
  const conflicted = () => ({
    2: { name: 'Mcdorf', lastAtMs: T, claimants: [
          { name: 'Mcdorf', lastAtMs: T, mana: 54 },
          { name: 'Stupidrichard', lastAtMs: T + 1000, mana: 95 } ] },
  });

  it('switching to a new number clears the old slot the moment it happens', () => {
    const c = { slots: conflicted() };
    // Stupidrichard now calls 003.
    c.slots[3] = { name: 'Stupidrichard', lastAtMs: T + 5000,
                   claimants: _chMergeClaimants(null, 'Stupidrichard', 'Stupidrichard', T + 5000, 93) };
    _chReleaseClaimantsElsewhere(c, ['Stupidrichard', 'Stupidrichard'], 3);

    expect(c.slots[2].claimants.map(x => x.name)).toEqual(['Mcdorf']);   // 002 uncontested
    expect(c.slots[3].claimants.map(x => x.name)).toEqual(['Stupidrichard']);
  });

  it('leaves the slot being claimed untouched', () => {
    const c = { slots: conflicted() };
    _chReleaseClaimantsElsewhere(c, ['Mcdorf'], 2);
    expect(c.slots[2].claimants.map(x => x.name)).toEqual(['Mcdorf', 'Stupidrichard']);
  });

  it('is case-insensitive on names', () => {
    const c = { slots: conflicted() };
    _chReleaseClaimantsElsewhere(c, ['stupidRICHARD'], 3);
    expect(c.slots[2].claimants.map(x => x.name)).toEqual(['Mcdorf']);
  });

  it('emptying a slot is allowed — it keeps its own name for the single row', () => {
    const c = { slots: { 2: { name: 'Mcdorf', lastAtMs: T, claimants: [{ name: 'Mcdorf', lastAtMs: T }] } } };
    _chReleaseClaimantsElsewhere(c, ['Mcdorf'], 5);
    expect(c.slots[2].claimants).toEqual([]);
    expect(c.slots[2].name).toBe('Mcdorf');
  });

  it('does nothing when the mover held no other slot', () => {
    const c = { slots: conflicted() };
    _chReleaseClaimantsElsewhere(c, ['Fargan'], 4);
    expect(c.slots[2].claimants).toHaveLength(2);
  });
});
