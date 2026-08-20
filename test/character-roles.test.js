// test/character-roles.test.js — the raid-alt level ladder + trader defaults.
// Real-imports the pure lib (web/lib/characterRoles.ts) shared by the officer
// surface (/admin/links) and the member surface (/me).
//
// The rule (Hitya 2026-08-20): "Raid Alts must be 46 or higher at minimum for
// classic raids, 50+ for Kunark, 55+ for velius, 60 for luclin. Anything else,
// they don't need to be put into openDKP. They can be non-raiding alts or
// traders." And the thing that was blocking him: "I can't easily make them
// traders because of the class requirement."

import { describe, it, expect } from 'vitest';
import {
  eligibleEras, raidAltVerdict, RAID_ALT_MIN_LEVEL, TRADER_DEFAULTS,
  isLocalOnlyRank,
} from '../web/lib/characterRoles.ts';

describe('eligibleEras — the ladder', () => {
  it('below 46 raids nothing', () => {
    expect(eligibleEras(1)).toEqual([]);
    expect(eligibleEras(45)).toEqual([]);
  });

  it('each rung opens exactly one more era', () => {
    expect(eligibleEras(46)).toEqual(['classic']);
    expect(eligibleEras(49)).toEqual(['classic']);
    expect(eligibleEras(50)).toEqual(['classic', 'kunark']);
    expect(eligibleEras(54)).toEqual(['classic', 'kunark']);
    expect(eligibleEras(55)).toEqual(['classic', 'kunark', 'velious']);
    expect(eligibleEras(59)).toEqual(['classic', 'kunark', 'velious']);
    expect(eligibleEras(60)).toEqual(['classic', 'kunark', 'velious', 'luclin']);
  });

  it('the rungs match the stated minimums', () => {
    expect(RAID_ALT_MIN_LEVEL).toEqual({ classic: 46, kunark: 50, velious: 55, luclin: 60 });
  });

  it('a missing or junk level raids nothing rather than throwing', () => {
    expect(eligibleEras(null)).toEqual([]);
    expect(eligibleEras(undefined)).toEqual([]);
    expect(eligibleEras(NaN)).toEqual([]);
  });
});

describe('raidAltVerdict — what the member is told', () => {
  it('under the floor is a refusal that names the alternative, not a scolding', () => {
    const v = raidAltVerdict(30);
    expect(v.ok).toBe(false);
    expect(v.eras).toEqual([]);
    expect(v.message).toMatch(/below the raid-alt floor/i);
    expect(v.message).toMatch(/trader/i);
  });

  it('a mid-level alt is a YES that says which eras, and what the next rung costs', () => {
    const v = raidAltVerdict(50);
    expect(v.ok).toBe(true);
    expect(v.eras).toEqual(['classic', 'kunark']);
    expect(v.message).toMatch(/Classic \+ Kunark/);
    expect(v.message).toMatch(/55 for Velious/);
  });

  it('60 clears everything', () => {
    const v = raidAltVerdict(60);
    expect(v.ok).toBe(true);
    expect(v.message).toMatch(/every era through Luclin/i);
  });

  it('an unknown level is refused with the whole ladder spelled out', () => {
    const v = raidAltVerdict(null);
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/46\+/);
    expect(v.message).toMatch(/60 \(Luclin\)/);
  });
});

describe('traders', () => {
  it('carry fixed placeholders — no class to pick, which was the blocker', () => {
    expect(TRADER_DEFAULTS).toEqual({ level: 1, race: 'Human', cls: 'Unknown' });
  });

  it('trader + non-raid alt are the ranks kept off OpenDKP (matches the bot)', () => {
    expect(isLocalOnlyRank('Trader')).toBe(true);
    expect(isLocalOnlyRank('trader')).toBe(true);
    expect(isLocalOnlyRank('Non-raid Alt')).toBe(true);
    expect(isLocalOnlyRank('non raid alt')).toBe(true);
    expect(isLocalOnlyRank('Raid Alt')).toBe(false);
    expect(isLocalOnlyRank(null)).toBe(false);
  });

  it('a level-1 trader would fail the raid-alt gate — which is why it bypasses it', () => {
    expect(raidAltVerdict(TRADER_DEFAULTS.level).ok).toBe(false);
  });
});
