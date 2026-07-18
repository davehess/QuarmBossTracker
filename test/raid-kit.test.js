// test/raid-kit.test.js — #95 Raid Kit readiness compute (rule 12).
//
// Real-imports the new pure lib (web/lib/raidKit.ts). Covers the MR-floor sum
// and its edge cases, the "no snapshot" state, the utility detection ladder
// (class-innate → scribed → item), and the Necromancer-coffin special (found in
// bags = covered; missing = not-covered WITH the bank-privacy note).

import { describe, it, expect } from 'vitest';
import {
  computeRaidKit,
  computeMrFromGear,
  MR_FLOOR,
} from '../web/lib/raidKit.ts';

// Minimal input builder — only the fields the compute reads.
function input(over = {}) {
  return {
    className: null,
    hasSnapshot: true,
    equipped: [],
    bagged: [],
    items: {},
    spellNames: {},
    scribedSpells: [],
    ...over,
  };
}

describe('computeMrFromGear', () => {
  it('sums mr across worn slots, treating null/missing as 0', () => {
    const equipped = [
      { slot: 'Head', item_id: 1, item_name: 'A' },
      { slot: 'Chest', item_id: 2, item_name: 'B' },
      { slot: 'Legs', item_id: 3, item_name: 'C' },   // missing from items map
      { slot: 'Feet', item_id: 4, item_name: 'D' },   // null mr
    ];
    const items = {
      1: { mr: 25, clickeffect: null, worneffect: null },
      2: { mr: 10, clickeffect: null, worneffect: null },
      4: { mr: null, clickeffect: null, worneffect: null },
    };
    expect(computeMrFromGear(equipped, items)).toBe(35);
  });

  it('is 0 for empty gear', () => {
    expect(computeMrFromGear([], {})).toBe(0);
  });
});

describe('MR floor', () => {
  it('meets the floor at exactly 100', () => {
    const r = computeRaidKit(input({
      equipped: [{ slot: 'Head', item_id: 1, item_name: 'A' }],
      items: { 1: { mr: 100, clickeffect: null, worneffect: null } },
    }));
    expect(r.mr.floor).toBe(MR_FLOOR);
    expect(r.mr.value).toBe(100);
    expect(r.mr.met).toBe(true);
  });

  it('fails the floor at 99', () => {
    const r = computeRaidKit(input({
      equipped: [{ slot: 'Head', item_id: 1, item_name: 'A' }],
      items: { 1: { mr: 99, clickeffect: null, worneffect: null } },
    }));
    expect(r.mr.met).toBe(false);
  });
});

describe('no snapshot', () => {
  it('surfaces hasSnapshot=false and does not fabricate MR', () => {
    const r = computeRaidKit(input({ hasSnapshot: false }));
    expect(r.hasSnapshot).toBe(false);
    expect(r.mr.value).toBe(0);
    // met is false but the UI gates on hasSnapshot, never showing this as a red fail.
    expect(r.mr.met).toBe(false);
  });
});

describe('utility detection ladder', () => {
  it('class-innate: a Druid self-covers EB / lev / invis / port with no items', () => {
    const r = computeRaidKit(input({ className: 'Druid' }));
    for (const k of ['eb', 'lev', 'invis', 'port']) {
      expect(r.utilities[k].covered).toBe(true);
      expect(r.utilities[k].source).toMatch(/self \(Druid\)/);
    }
  });

  it('folds a level title to its base class (Storm Warden = Druid)', () => {
    const r = computeRaidKit(input({ className: 'Storm Warden' }));
    expect(r.utilities.port.covered).toBe(true);
  });

  it('conservative map: a Warrior is NOT innately covered for anything', () => {
    const r = computeRaidKit(input({ className: 'Warrior' }));
    for (const k of ['eb', 'lev', 'invis', 'port']) {
      expect(r.utilities[k].covered).toBe(false);
    }
  });

  it('scribed spell covers a non-innate class', () => {
    const r = computeRaidKit(input({ className: 'Ranger', scribedSpells: ['Enduring Breath', 'Snare'] }));
    expect(r.utilities.eb.covered).toBe(true);
    expect(r.utilities.eb.source).toMatch(/scribed: Enduring Breath/);
  });

  it('item clicky in bags covers a self-port for a melee class', () => {
    const r = computeRaidKit(input({
      className: 'Monk',
      bagged: [{ item_id: 50, item_name: 'Ring of the Ancients' }],
      items: { 50: { mr: 0, clickeffect: 999, worneffect: null } },
      spellNames: { 999: 'Ring of Commons' },
    }));
    expect(r.utilities.port.covered).toBe(true);
    expect(r.utilities.port.source).toMatch(/Ring of the Ancients \(click\)/);
  });

  it('worn "See Invisible" does NOT count as self-invis', () => {
    const r = computeRaidKit(input({
      className: 'Monk',
      equipped: [{ slot: 'Back', item_id: 7, item_name: 'Crystal Shadow Cloak' }],
      items: { 7: { mr: 25, clickeffect: null, worneffect: 80 } },
      spellNames: { 80: 'See Invisible' },
    }));
    expect(r.utilities.invis.covered).toBe(false);
  });

  it('a worn EB effect on an equipped piece counts', () => {
    const r = computeRaidKit(input({
      className: 'Rogue',
      equipped: [{ slot: 'Neck', item_id: 8, item_name: 'Coral Necklace' }],
      items: { 8: { mr: 0, clickeffect: null, worneffect: 42 } },
      spellNames: { 42: 'Enduring Breath' },
    }));
    expect(r.utilities.eb.covered).toBe(true);
    expect(r.utilities.eb.source).toMatch(/Coral Necklace \(worn\)/);
  });
});

describe('necro coffin special', () => {
  it('non-necro: coffin is not applicable', () => {
    const r = computeRaidKit(input({ className: 'Warrior' }));
    expect(r.coffin.applicable).toBe(false);
    expect(r.coffin.covered).toBe(false);
  });

  it('necro with a coffin in bags is covered', () => {
    const r = computeRaidKit(input({
      className: 'Necromancer',
      bagged: [{ item_id: 3, item_name: 'Jade Inlaid Coffin' }],
      items: { 3: { mr: 0, clickeffect: null, worneffect: null } },
    }));
    expect(r.coffin.applicable).toBe(true);
    expect(r.coffin.covered).toBe(true);
    expect(r.coffin.source).toBe('Jade Inlaid Coffin');
  });

  it('necro with no coffin is not-covered WITH a bank-privacy note (never a hard fail)', () => {
    const r = computeRaidKit(input({ className: 'Necromancer' }));
    expect(r.coffin.applicable).toBe(true);
    expect(r.coffin.covered).toBe(false);
    expect(r.coffin.note).toMatch(/bank/i);
  });

  it('does not mistake a rogue "Coffin Poison Bottle" for a coffin', () => {
    const r = computeRaidKit(input({
      className: 'Necromancer',
      bagged: [{ item_id: 9, item_name: 'Coffin Poison Bottle' }],
    }));
    expect(r.coffin.covered).toBe(false);
  });

  it('folds the necro level title (Arch Lich) to Necromancer', () => {
    const r = computeRaidKit(input({ className: 'Arch Lich' }));
    expect(r.coffin.applicable).toBe(true);
  });
});
