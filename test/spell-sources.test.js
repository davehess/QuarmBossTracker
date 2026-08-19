// test/spell-sources.test.js — the spellbook where-from grouping + the
// zone-by-zone shopping list (Hitya 2026-08-18). The claim that must hold:
// "only here" means the spell's ENTIRE vendor footprint is one zone — not
// merely that a vendor in this zone sells it — and zones you must visit sort
// first.
//
// Run: npx vitest run test/spell-sources.test.js

import { describe, it, expect } from 'vitest';
import { groupSources, shoppingList } from '../web/lib/spellSources.ts';

const row = (item_id, kind, npc_id, npc_name, zone_short, zone_long) =>
  ({ item_id, kind, npc_id, npc_name, zone_short, zone_long });

describe('groupSources', () => {
  it('splits merchants from drops, cleans #_ names, aggregates an NPC\'s zones', () => {
    const m = groupSources([
      row(27973, 'merchant', 1, 'Bleep_Blornsbury', 'twilight', 'The Twilight Sea'),
      row(27973, 'merchant', 1, 'Bleep_Blornsbury', 'katta', 'Katta Castellum'),
      row(27973, 'drop', 9, '#The_Hollow_One', 'akheva', 'Akheva Ruins'),
    ]);
    const e = m.get(27973);
    expect(e.merchants).toHaveLength(1);
    expect(e.merchants[0].name).toBe('Bleep Blornsbury');
    expect(e.merchants[0].zones.map(z => z.short)).toEqual(['twilight', 'katta']);
    expect(e.drops[0].name).toBe('The Hollow One');
  });
});

describe('shoppingList', () => {
  const missing = (name, item, extra = {}) =>
    ({ spell_name: name, scroll_item_id: item, scribe_level: 29, pop: false, held_by: [], ...extra });

  it('"only here" = the spell\'s whole vendor footprint is one zone', () => {
    const sources = groupSources([
      row(1, 'merchant', 10, 'Solo_Seller', 'twilight', 'The Twilight Sea'),
      row(2, 'merchant', 11, 'Seller_A', 'twilight', 'The Twilight Sea'),
      row(2, 'merchant', 12, 'Seller_B', 'commons', 'West Commonlands'),
    ]);
    const { zones } = shoppingList([missing('Exclusive Spell', 1), missing('Common Spell', 2)], sources);
    const twilight = zones.find(z => z.zoneShort === 'twilight');
    expect(twilight.spells.find(s => s.spellName === 'Exclusive Spell').onlyHere).toBe(true);
    expect(twilight.spells.find(s => s.spellName === 'Common Spell').onlyHere).toBe(false);
    expect(twilight.exclusives).toBe(1);
  });

  it('zones you MUST visit sort first (exclusives beat raw counts)', () => {
    const sources = groupSources([
      row(1, 'merchant', 10, 'A', 'mustgo', 'Must Go'),
      row(2, 'merchant', 11, 'B', 'big', 'Big Mart'), row(2, 'merchant', 12, 'C', 'other', 'Other'),
      row(3, 'merchant', 13, 'D', 'big', 'Big Mart'), row(3, 'merchant', 14, 'E', 'other', 'Other'),
    ]);
    const { zones } = shoppingList([missing('S1', 1), missing('S2', 2), missing('S3', 3)], sources);
    expect(zones[0].zoneShort).toBe('mustgo');   // 1 spell but exclusive > 2 shared
  });

  it('drop-only and unsourced spells land in noVendor, never a zone', () => {
    const sources = groupSources([row(5, 'drop', 20, 'Some_Boss', 'sleeper', "Sleeper's Tomb")]);
    const { zones, noVendor } = shoppingList([missing('Dropped Spell', 5), missing('Mystery Spell', null)], sources);
    expect(zones).toHaveLength(0);
    expect(noVendor.map(m => m.spell_name)).toEqual(['Dropped Spell', 'Mystery Spell']);
  });

  it('spells inside a zone sort by level then name', () => {
    const sources = groupSources([
      row(1, 'merchant', 10, 'V', 'z', 'Z'), row(2, 'merchant', 10, 'V', 'z', 'Z'),
    ]);
    const { zones } = shoppingList([
      missing('Zeta', 1, { scribe_level: 24 }),
      missing('Alpha', 2, { scribe_level: 51 }),
    ], sources);
    expect(zones[0].spells.map(s => s.spellName)).toEqual(['Zeta', 'Alpha']);
  });
});
