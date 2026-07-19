// #108 loot bidding — SOURCE-SLICE fidelity tier.
//
// The Loot bidding panel's server-side derivations live inside the bot monolith
// (index.js) and aren't exported (require()-ing index.js boots Discord). We read
// the real source and eval JUST the pure #108 helpers, so the test tracks the
// shipped code: edit the derivation and this exercises the new behavior; rename
// or delete it and the slice throws. Same technique as test/budgets.test.js.

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const block = sliceBlock(src, 'function _lootItemSummary(auctionsDesc, bidsByAuction) {', '// ── end #108 pure helpers ──');
const {
  _lootItemSummary, _mergeWishlist, _ilikeAnyClause,
  _resolveCharIdNames, _suggestFamily, _pruneWonWishlist, _eraFromPool, _buildMisses, _familyDkpTotals,
} = evalBlock(block, [
  '_lootItemSummary', '_mergeWishlist', '_ilikeAnyClause',
  '_resolveCharIdNames', '_suggestFamily', '_pruneWonWishlist', '_eraFromPool', '_buildMisses', '_familyDkpTotals',
]);

describe('_lootItemSummary — last winner + runner-up (real index.js)', () => {
  it('picks the most-recent settled auction with a winner', () => {
    const aucs = [
      { auction_id: 3, item_name: 'Cloak', winner: null, bid_amount: null, end_at: '2026-07-03' },
      { auction_id: 2, item_name: 'Cloak', winner: 'Bippo', bid_amount: 40, end_at: '2026-07-02' },
      { auction_id: 1, item_name: 'Cloak', winner: 'Hitya', bid_amount: 22, end_at: '2026-07-01' },
    ];
    const s = _lootItemSummary(aucs, {});
    expect(s.winner).toBe('Bippo');
    expect(s.winning_bid).toBe(40);
  });

  it('runner-up = highest LOSING bid (drops one copy of the winning value)', () => {
    const aucs = [{ auction_id: 9, item_name: 'Ring', winner: 'A', bid_amount: 50, end_at: 'x' }];
    const s = _lootItemSummary(aucs, { 9: [{ value: 50 }, { value: 30 }, { value: 45 }] });
    expect(s.winning_bid).toBe(50);
    expect(s.runner_up).toBe(45);
  });

  it('runner-up is null when only the winning bid was mirrored (sealed discard)', () => {
    const aucs = [{ auction_id: 9, item_name: 'Ring', winner: 'A', bid_amount: 50, end_at: 'x' }];
    const s = _lootItemSummary(aucs, { 9: [{ value: 50 }] });
    expect(s.runner_up).toBe(null);
  });

  it('a tie for the winning value still surfaces a runner-up (only one copy removed)', () => {
    const aucs = [{ auction_id: 9, item_name: 'Ring', winner: 'A', bid_amount: 50, end_at: 'x' }];
    const s = _lootItemSummary(aucs, { 9: [{ value: 50 }, { value: 50 }] });
    expect(s.runner_up).toBe(50);
  });

  it('returns null when no auctions at all', () => {
    expect(_lootItemSummary([], {})).toBe(null);
  });
});

describe('_mergeWishlist — prereg vs from-bid-history (real index.js)', () => {
  it('prereg wins when an item is in both; prereg sorts first by priority', () => {
    const prereg = [{ item_id: 2, item_name: 'B', priority: 2 }, { item_id: 1, item_name: 'A', priority: 1 }];
    const bidItems = [{ item_id: 1, item_name: 'A' }, { item_id: 3, item_name: 'C' }];
    const wl = _mergeWishlist(prereg, bidItems);
    expect(wl.map(w => [w.item_id, w.source])).toEqual([[1, 'prereg'], [2, 'prereg'], [3, 'bid_history']]);
  });

  it('bid-history-only items are tagged from bid history', () => {
    const wl = _mergeWishlist([], [{ item_id: 7, item_name: 'Z' }]);
    expect(wl).toEqual([{ item_id: 7, item_name: 'Z', source: 'bid_history', priority: null }]);
  });

  it('handles empty inputs', () => {
    expect(_mergeWishlist(null, null)).toEqual([]);
  });
});

describe('_ilikeAnyClause — case-insensitive multi-name PostgREST filter', () => {
  it('builds an or=() ilike clause and drops invalid names', () => {
    expect(_ilikeAnyClause('character_name', ['Hitya', 'x', 'Bippo']))
      .toBe('or=(character_name.ilike.Hitya,character_name.ilike.Bippo)');
  });
  it('returns null for an empty/all-invalid list', () => {
    expect(_ilikeAnyClause('character_name', ['', '1'])).toBe(null);
  });
});

// ── #121 loot bidding v2 (real index.js) ────────────────────────────────────
describe('_resolveCharIdNames — char_id → real name via MODE over loot join', () => {
  it('takes the most-frequent loot name per char_id (2x-drop noise dropped)', () => {
    // char 108064 won item 1 in raid 100 (loot → Hitya) and item 2 in raid 101
    // (Hitya again); a 2x-drop in raid 100 also awarded item 1 to Bippo → noise.
    const wonAuctions = [
      { winner_character_id: 108064, raid_id: 100, item_id: 1 },
      { winner_character_id: 108064, raid_id: 101, item_id: 2 },
    ];
    const lootRows = [
      { raid_id: 100, item_id: 1, character_name: 'Hitya' },
      { raid_id: 100, item_id: 1, character_name: 'Bippo' },  // 2x-drop noise
      { raid_id: 101, item_id: 2, character_name: 'Hitya' },
    ];
    expect(_resolveCharIdNames(wonAuctions, lootRows)[108064]).toBe('Hitya');
  });
  it('omits char_ids with no matching loot', () => {
    expect(_resolveCharIdNames([{ winner_character_id: 5, raid_id: 9, item_id: 9 }], [])).toEqual({});
  });
});

describe('_suggestFamily — main = most wins, alts de-duped', () => {
  it('picks the most-won char as main', () => {
    const s = _suggestFamily([
      { char_id: 1, name: 'Melting', wins: 46 },
      { char_id: 2, name: 'Hitya', wins: 91 },
      { char_id: 3, name: 'Canopy', wins: 42 },
      { char_id: 4, name: null, wins: 5 },   // unresolved → dropped
    ]);
    expect(s.main).toBe('Hitya');
    expect(s.alts).toEqual(['Melting', 'Canopy']);
  });
  it('handles no resolvable names', () => {
    expect(_suggestFamily([{ char_id: 1, name: null, wins: 3 }])).toEqual({ main: null, alts: [] });
  });
});

describe('_pruneWonWishlist — drop won items but keep preregs', () => {
  it('removes bid-history items already won, keeps prereg even if won', () => {
    const wl = [
      { item_id: 1, source: 'prereg' },
      { item_id: 2, source: 'bid_history' },
      { item_id: 3, source: 'bid_history' },
    ];
    expect(_pruneWonWishlist(wl, [1, 2]).map(w => w.item_id)).toEqual([1, 3]);
  });
});

describe('_eraFromPool — OpenDKP pool → expansion label', () => {
  it('maps the four live pools', () => {
    expect(_eraFromPool('SoL')).toBe('Luclin');
    expect(_eraFromPool('SoV')).toBe('Velious');
    expect(_eraFromPool('Kunark')).toBe('Kunark');
    expect(_eraFromPool('Classic')).toBe('Classic');
  });
  it('passes unknown pools through and tolerates null', () => {
    expect(_eraFromPool('Weird')).toBe('Weird');
    expect(_eraFromPool(null)).toBe(null);
  });
});

describe('_buildMisses — bid-and-lost, grouped per item', () => {
  const nameByCharId = { 108064: 'Hitya', 100899: 'Melting' };
  it('keeps only lost items and the top-bidding family char', () => {
    const bidRows = [
      // Robe: family char 108064 bid 126 but auction won by a stranger (500) → miss
      { auction_id: 10, character_id: 108064, value: 126, item_id: 1, item_name: 'Robe', winner_character_id: 500, end_at: '2026-07-02', raid_id: 60463 },
      // Katana: 100899 lost
      { auction_id: 11, character_id: 100899, value: 46, item_id: 2, item_name: 'Katana', winner_character_id: 999, end_at: '2026-07-05', raid_id: 60900 },
      // Cloak: family WON this auction → not a miss
      { auction_id: 12, character_id: 108064, value: 40, item_id: 3, item_name: 'Cloak', winner_character_id: 108064, end_at: '2026-07-06', raid_id: 61000 },
    ];
    const rows = _buildMisses({ bidRows, famCharIds: [108064, 100899], nameByCharId, wonItemIds: [] });
    expect(rows.map(r => r.item_name)).toEqual(['Katana', 'Robe']);  // most-recent end first
    const robe = rows.find(r => r.item_id === 1);
    expect(robe.character).toBe('Hitya');
    expect(robe.my_last_bid).toBe(126);
    expect(robe.raid_id).toBe(60463);
  });
  it('excludes items the family won in ANY auction (wonItemIds)', () => {
    const bidRows = [{ auction_id: 10, character_id: 108064, value: 126, item_id: 1, item_name: 'Robe', winner_character_id: 500, end_at: 'x', raid_id: 1 }];
    expect(_buildMisses({ bidRows, famCharIds: [108064], nameByCharId, wonItemIds: [1] })).toEqual([]);
  });
});

describe('_familyDkpTotals — family-pooled balance', () => {
  it('sums earned + adjustments − spent across the family', () => {
    // vaporjesus-shaped: main negative per-char, family nets positive.
    const t = _familyDkpTotals([
      { name: 'Hitya', earned: 3182, adjustments: -25, spent: 3282 },   // −125 solo
      { name: 'Melting', earned: 1710, adjustments: 0, spent: 1170 },   // +540
      { name: 'Canopy', earned: 830, adjustments: 10, spent: 314 },     // +526
    ]);
    expect(t.per_character.Hitya.net).toBe(-125);
    expect(t.per_character.Melting.net).toBe(540);
    expect(t.per_character.Canopy.net).toBe(526);
    expect(t.family_total).toBe(941);   // −125 + 540 + 526
  });
});
