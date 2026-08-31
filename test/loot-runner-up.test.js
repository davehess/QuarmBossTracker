// Second place on a settled auction — the number people bid against.
//
// Hitya, 2026-08-30, against OpenDKP's own results pages: Thorny Chain Sleeves
// showed 10 when second was 5; Bone Chill Shield showed 20 when second was 7.
// Cause: BOTH auctions carry two rows at the winning value (the account login
// and the character name are the same bid, mirrored twice, both position 1),
// and the old rule dropped one instance of the winning value and took the max
// of the rest — so the winner's own duplicate became "second place".
//
// The discriminator is `position`, OpenDKP's own ranking, because a value rule
// cannot tell a duplicated winner apart from a genuine tie.
import { describe, it, expect } from 'vitest';
import { BOT_INDEX, readSource, sliceBlock, evalBlock } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const { _lootItemSummary } = evalBlock(
  sliceBlock(src, 'function _lootItemSummary(auctionsDesc, bidsByAuction)', '\n}'),
  ['_lootItemSummary'],
);
const auction = (id, winner, bid) => [{ auction_id: id, winner, bid_amount: bid, item_name: 'X' }];

describe('second place', () => {
  it('Thorny Chain Sleeves 1068644 — real data: 5, not the duplicated 10', () => {
    const bids = [
      { value: 10, position: 1 },   // FawxFF  (account login)
      { value: 10, position: 1 },   // Fawx    (same bid, character name)
      { value: 5,  position: 2 },   // Fittir  ← real second
      { value: 4,  position: 3 }, { value: 4, position: 4 }, { value: 3, position: 5 },
    ];
    const s = _lootItemSummary(auction(1068644, 'FawxFF', 10), { 1068644: bids });
    expect(s.runner_up).toBe(5);
  });

  it('Bone Chill Shield 1068673 — real data: 7, not the duplicated 20', () => {
    const bids = [
      { value: 20, position: 1 }, { value: 20, position: 1 },
      { value: 7, position: 2 },  // Ellah ← real second
      { value: 5, position: 3 }, { value: 5, position: 4 }, { value: 4, position: 5 },
    ];
    const s = _lootItemSummary(auction(1068673, 'fromuthman', 20), { 1068673: bids });
    expect(s.runner_up).toBe(7);
  });

  it('keeps a GENUINE tie at the winning value — Thorny Chain Helm', () => {
    // Fayce@15 (1), Philomena@15 (2), Smokestomp@7 (3). Philomena is a second
    // bidder who really did bid 15, and Hitya asked for 15 here. This is the
    // case a "drop every row at the winning value" rule would get wrong, which
    // is why the rule is position and not value.
    const bids = [
      { value: 15, position: 1 }, { value: 15, position: 2 }, { value: 7, position: 3 },
    ];
    const s = _lootItemSummary(auction(1010784, 'Fayce', 15), { 1010784: bids });
    expect(s.runner_up).toBe(15);
  });

  it('falls back to the value rule when nothing is ranked yet', () => {
    // List-path only: winners-only rows, all position 1, detail not synced.
    const bids = [{ value: 12, position: 1 }];
    expect(_lootItemSummary(auction(9, 'A', 12), { 9: bids }).runner_up).toBeNull();
    const two = [{ value: 12, position: 1 }, { value: 6, position: 1 }];
    expect(_lootItemSummary(auction(9, 'A', 12), { 9: two }).runner_up).toBe(6);
  });

  it('handles no bids and a sole bidder', () => {
    expect(_lootItemSummary(auction(1, 'A', 5), {}).runner_up).toBeNull();
    expect(_lootItemSummary(auction(1, 'A', 5), { 1: [{ value: 5, position: 1 }] }).runner_up).toBeNull();
  });

  it('still reports the winner and winning bid unchanged', () => {
    const s = _lootItemSummary(auction(3, 'Zonais', 3), { 3: [{ value: 3, position: 1 }] });
    expect(s.winner).toBe('Zonais');
    expect(s.winning_bid).toBe(3);
  });

  it('both bid queries actually select position, or the rule never fires', () => {
    const selects = src.match(/select=auction_id,value[^`]*/g) || [];
    expect(selects.length).toBeGreaterThanOrEqual(2);
    for (const q of selects) expect(q).toMatch(/^select=auction_id,value,position/);
  });
});
