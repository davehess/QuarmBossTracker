// test/loot-won-set.test.js — the "already won" set must NOT be the display list.
//
// The bug (Hitya, 2026-08-09): items the family had genuinely won kept showing
// up under "your wishlist · bid on but not yet won" and in RECENT MISSES.
//
// Cause: `wonItemIds` was seeded from the `wins` array, and `wins` is the
// DISPLAY list — `opendkp_loot … order=fetched_at.desc&limit=100`. The family
// Hitya/Melting/Canopy has 187 awards, so 87 of them fell off the end of that
// page and read as unwon. The three items reported were at rows 101, 120 and
// 184 of that ordering. `fetched_at` made it worse: that is the MIRROR SYNC
// time, not the award time, so which 100 survived was effectively arbitrary.
//
// Rule enforced here: the won-item set comes from its own uncapped item_id-only
// sweep, and the display list is ordered by award order (raid_id), not sync time.
//
// This is a SOURCE-SHAPE test (the derivation lives inline in an async HTTP
// handler that can't be sliced and eval'd), plus behavioural coverage of the two
// pure consumers that were producing the wrong rows.
//
// Run: npx vitest run test/loot-won-set.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

const src = readSource(BOT_INDEX);

// The bid-history handler, from its key check to the wishlist prune.
const handler = sliceBlock(
  src,
  "if (key === 'bid-history') {",
  'const wishlist = _pruneWonWishlist(',
);

describe('bid-history: the won-item set is independent of the display cap', () => {
  it('builds wonItemIds from its own opendkp_loot sweep, not from `wins`', () => {
    expect(handler).toMatch(/const wonItemIds = new Set\(\);/);
    // The seeding loop reads the dedicated sweep…
    expect(handler).toMatch(/for \(const r of wonIdRows\)/);
    expect(handler).toMatch(/wonItemIds\.add\(r\.item_id\)/);
    // …and NOT the capped display list. This exact line was the bug.
    expect(handler).not.toMatch(/for \(const w of wins\)[^\n]*wonItemIds\.add/);
  });

  it('the won-set sweep stays narrow and is not capped at the display limit', () => {
    // character_name joined it on 2026-08-29 so ownership can be answered PER
    // CHARACTER; it is still two tiny columns and still uncapped relative to
    // the display list, which is the property that mattered.
    const sweep = handler.slice(handler.indexOf('const wonItemIds'));
    const q = sweep.match(/`select=item_id,character_name&\$\{famClause\}&limit=(\d+)`/);
    expect(q, 'won-set query should select item_id + character_name only').toBeTruthy();
    expect(Number(q[1])).toBeGreaterThanOrEqual(5000);
  });

  it('orders the display list by award order (raid_id), never mirror sync time', () => {
    const winsQuery = handler.slice(handler.indexOf('let wins = []'), handler.indexOf('const wonItemIds'));
    expect(winsQuery).toMatch(/order=raid_id\.desc/);
    expect(winsQuery).not.toMatch(/order=fetched_at\.desc/);
  });
});

// The two consumers, exercised against the real shipped helpers.
const helpers = evalBlock(
  sliceBlock(src, 'function _pruneWonWishlist(wishlist, wonItemIds) {', '// ── end #121 loot bidding v2 pure helpers ──'),
  ['_pruneWonWishlist', '_buildMisses'],
);

describe('a won item never resurfaces as wishlist or miss', () => {
  // The three items Hitya reported, with the row they sat at under the old
  // fetched_at.desc/limit=100 ordering.
  const WON = [11616, 30506, 28996];   // rows 101, 120, 184 — all past the cap

  it('prunes won items out of the wishlist (inferred entries)', () => {
    const wl = WON.map(id => ({ item_id: id, source: 'bid-history' }));
    expect(helpers._pruneWonWishlist(wl, WON)).toEqual([]);
  });

  it('keeps an explicit prereg even after the win — that is deliberate', () => {
    const wl = [{ item_id: 11616, source: 'prereg' }, { item_id: 30506, source: 'bid-history' }];
    expect(helpers._pruneWonWishlist(wl, WON).map(w => w.item_id)).toEqual([11616]);
  });

  it('drops a miss once THAT character holds the item, even if it lost the auction', () => {
    // Bid and lost on auction 1, then got the item later. Still not a miss for
    // that character — this is the 2026-08-09 intent, now scoped per character.
    const bidRows = [
      { auction_id: 1, character_id: 108064, value: 40, item_id: 28996, item_name: 'Bracer of Black Blood', winner_character_id: 999, end_at: '2026-07-01', raid_id: 7 },
    ];
    const misses = helpers._buildMisses({
      bidRows, nameByCharId: { 108064: 'Hitya' }, wonByChar: { 108064: new Set(WON) },
    });
    expect(misses).toEqual([]);
  });

  it('still reports a genuine miss on an item that character has never had', () => {
    const bidRows = [
      { auction_id: 5, character_id: 108064, value: 40, item_id: 12345, item_name: 'Cloak of Flames', winner_character_id: 999, end_at: '2026-07-01', raid_id: 7 },
    ];
    const misses = helpers._buildMisses({
      bidRows, nameByCharId: { 108064: 'Hitya' }, wonByChar: { 108064: new Set(WON) },
    });
    expect(misses).toHaveLength(1);
    expect(misses[0].item_name).toBe('Cloak of Flames');
    expect(misses[0].character).toBe('Hitya');
  });
});
