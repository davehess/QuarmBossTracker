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
const block = sliceBlock(src, 'const CH_CLAIM_WINDOW_MS', '\n}');

// eslint-disable-next-line no-new-func
const { _chMergeClaimants, CH_CLAIM_WINDOW_MS } =
  new Function(block + '\nreturn { _chMergeClaimants, CH_CLAIM_WINDOW_MS };')();

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

  it('one clean caller produces one claimant — no conflict from normal play', () => {
    const out = _chMergeClaimants({}, 'Aimey', 'Aimey', T);
    expect(out).toHaveLength(1);
  });
});
