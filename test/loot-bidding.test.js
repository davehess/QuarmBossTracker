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
const { _lootItemSummary, _mergeWishlist, _ilikeAnyClause } =
  evalBlock(block, ['_lootItemSummary', '_mergeWishlist', '_ilikeAnyClause']);

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
