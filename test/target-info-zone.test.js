// #141 — cross-client Target Info / Mob Info zone-scoping. SOURCE-SLICE.
//
// The Mob Info / Target Info relays (target-buffs, target-casts, mob-info)
// merge observations by mob NAME. Two same-name mobs in different zones ("a
// geonid" in The Wakening Land vs Crystal Caverns) are byte-identical by name,
// so another zone's mob's debuffs/casts/stats used to leak into a requester's
// Target Info — the same gap #113 fixed for Extended Target. The fix scopes the
// merge to the requester's zone via the pure predicate _zoneScopeKeep, which
// lives inside the bot's index.js (can't be require()'d without booting
// Discord). We slice the SHIPPED function and eval it so a rename/delete throws
// loudly instead of passing on a stale copy.

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, BOT_INDEX } from './_source-slice.js';

const SRC = readSource(BOT_INDEX);

const zkBlock = sliceBlock(SRC, 'function _zoneScopeKeep(requesterZone, observerZone) {', '\n}');
// eslint-disable-next-line no-new-func
const _zoneScopeKeep = new Function(`${zkBlock}\nreturn _zoneScopeKeep;`)();

describe('#141 _zoneScopeKeep — cross-client Target Info zone filter', () => {
  it('same zone → keep (the useful case)', () => {
    expect(_zoneScopeKeep('The Wakening Land', 'The Wakening Land')).toBe(true);
  });

  it('different zone → drop (the wrong-zone leak — the geonid bug)', () => {
    // Requester in The Wakening Land, observation made in Crystal Caverns.
    expect(_zoneScopeKeep('The Wakening Land', 'Crystal Caverns')).toBe(false);
    // The live-evidence case: observer was in Tower of Frozen Shadow.
    expect(_zoneScopeKeep('The Wakening Land', 'Tower of Frozen Shadow')).toBe(false);
  });

  it('requester zone unknown → keep everything (FAIL-OPEN: serve as today)', () => {
    expect(_zoneScopeKeep(null, 'Crystal Caverns')).toBe(true);
    expect(_zoneScopeKeep('', 'The Wakening Land')).toBe(true);
    expect(_zoneScopeKeep(undefined, null)).toBe(true);
  });

  it('observation zone unknown (but requester known) → drop (can\'t prove same-zone)', () => {
    // Local observations are merged agent-side; the relay only carries other
    // clients', so shedding an unverifiable cross-client row is safe.
    expect(_zoneScopeKeep('The Wakening Land', null)).toBe(false);
    expect(_zoneScopeKeep('The Wakening Land', '')).toBe(false);
    expect(_zoneScopeKeep('The Wakening Land', undefined)).toBe(false);
  });

  it('is case/type-exact on the zone name (no accidental coercion match)', () => {
    expect(_zoneScopeKeep('Crystal Caverns', 'crystal caverns')).toBe(false);
    expect(_zoneScopeKeep('The Bazaar', 'The Bazaar')).toBe(true);
  });
});

// Characterize the row-level merge the way the shipped handlers use the
// predicate: a requester in zone A keeps only same-zone observations, and the
// geonid case (all leaked debuffs observed from another zone) yields ZERO rows.
describe('#141 relay merge applies the predicate per observation', () => {
  const OBS = [
    { spell: 'Enveloping Roots', observerZone: 'Tower of Frozen Shadow' }, // leaked
    { spell: 'Ensnare',          observerZone: 'Tower of Frozen Shadow' }, // leaked
    { spell: 'Tashani',          observerZone: 'The Wakening Land' },       // ours
    { spell: 'Mystery',          observerZone: null },                      // unverifiable
  ];
  const merge = (requesterZone) =>
    OBS.filter(o => _zoneScopeKeep(requesterZone, o.observerZone)).map(o => o.spell);

  it('requester in The Wakening Land → only same-zone debuffs survive', () => {
    expect(merge('The Wakening Land')).toEqual(['Tashani']);
  });

  it('requester zone unknown → fail-open, everything survives', () => {
    expect(merge(null)).toEqual(['Enveloping Roots', 'Ensnare', 'Tashani', 'Mystery']);
  });

  it('the reported geonid leak is fully closed for the Wakening Land requester', () => {
    // Enveloping Roots + Ensnare (observed cross-zone) never reach a Wakening
    // Land requester targeting THEIR geonid.
    expect(merge('The Wakening Land')).not.toContain('Enveloping Roots');
    expect(merge('The Wakening Land')).not.toContain('Ensnare');
  });
});
