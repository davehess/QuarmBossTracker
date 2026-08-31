// test/server-panel-auction-cache.test.js — one upstream call serves the fleet.
//
// 2026-08-25, from OpenDKP's own API Gateway logs: the "auctions"/"my-bids"
// panel keys forwarded EVERY dashboard poll upstream — 1,678 calls / 1.1 GB in
// one afternoon from ONE open dashboard (7s poll × ~665 KB full-history
// responses), which got our IP blocked by OpenDKP's owner. The fix this file
// characterizes: the panel now reads GET /clients/{name}/auctions/active
// (OpenDKP's own documented endpoint) through ONE shared bot-side cache —
// 15s TTL while auctions are live, 120s idle — so N dashboards cost the same
// as one and an idle fleet costs at most 30 upstream calls an hour.
//
// 2026-08-30 — the IDLE half of that had a second cost nobody had priced.
// "The loot is not posted quickly on the channel" (Hitya): every auction that
// raid ran for 2 MINUTES and the idle TTL was 120s, so a raider's panel could
// hold a cached EMPTY list for the entire bidding window. Two fixes, both
// characterized below: the officer's own post drops the cache in-process, and
// inside a raid window the idle TTL drops to 30s.
import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, sliceBlock, evalBlock, stripJs, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const block = sliceBlock(
  src,
  'const _PANEL_AUCTIONS_TTL_ACTIVE_MS',
  // ⚠ End on the COMMENT that follows the invalidator, not on the invalidator's
  // own body — anchoring on the body makes the slice throw when someone edits
  // it, which reads as "suite failed to load" instead of "this assertion
  // caught a regression".
  '// Pooled family DKP recomputed from OUR MIRROR',
);

function build({ inRaid = false } = {}) {
  const { _panelAuctions, _invalidatePanelAuctions } = evalBlock(
    'const console = { warn() {}, log() {} };\nconst process = { env: {} };\n' + block,
    ['_panelAuctions', '_invalidatePanelAuctions'],
  );
  let t = 1_000_000;
  const calls = [];
  let payload = [];
  let fail = false;
  return {
    calls,
    setPayload: p => { payload = p; },
    setFail: f => { fail = f; },
    advance: ms => { t += ms; },
    invalidate: () => _invalidatePanelAuctions(),
    get: (over = {}) => _panelAuctions({
      now: () => t,
      inRaid,
      fetch: async () => {
        if (fail) throw new Error('upstream down');
        calls.push(t);
        return payload;
      },
      ...over,
    }),
  };
}

describe('_panelAuctions cache', () => {
  it('serves every dashboard from one upstream call inside the TTL', async () => {
    const h = build();
    h.setPayload([{ AuctionId: 1 }]);
    await h.get(); await h.get(); await h.get();   // three "dashboards"
    expect(h.calls).toHaveLength(1);
  });

  it('refreshes after 15s while auctions are active', async () => {
    const h = build();
    h.setPayload([{ AuctionId: 1 }]);
    await h.get();
    h.advance(14_000); await h.get();
    expect(h.calls).toHaveLength(1);
    h.advance(2_000); await h.get();
    expect(h.calls).toHaveLength(2);
  });

  it('stretches to 120s off-raid when no auctions are up — the idle fleet is cheap', async () => {
    const h = build();
    h.setPayload([]);
    await h.get();
    h.advance(60_000); await h.get();              // would refetch on active TTL
    expect(h.calls).toHaveLength(1);
    h.advance(61_000); await h.get();
    expect(h.calls).toHaveLength(2);
  });

  it('serves stale on upstream failure rather than blanking a raid-night panel', async () => {
    const h = build();
    h.setPayload([{ AuctionId: 7 }]);
    const first = await h.get();
    h.advance(20_000);
    h.setFail(true);
    const second = await h.get();
    expect(second).toEqual(first);
  });

  it('throws only when there is no cache at all to fall back on', async () => {
    const h = build();
    h.setFail(true);
    await expect(h.get()).rejects.toThrow(/upstream down/);
  });

  it('accepts both response shapes ({Items:[…]} and bare array)', async () => {
    const h = build();
    h.setPayload({ Items: [{ AuctionId: 3 }] });
    expect(await h.get()).toEqual([{ AuctionId: 3 }]);
    const h2 = build();
    h2.setPayload([{ AuctionId: 4 }]);
    expect(await h2.get()).toEqual([{ AuctionId: 4 }]);
  });
});

// ── 2026-08-30: the bidding window is not allowed to expire inside the cache ──
describe('_panelAuctions — a raider must not wait out the auction', () => {
  it('holds the idle answer for only 30s inside a raid window', async () => {
    const h = build({ inRaid: true });
    h.setPayload([]);
    await h.get();
    h.advance(29_000); await h.get();
    expect(h.calls).toHaveLength(1);
    h.advance(2_000); await h.get();
    expect(h.calls).toHaveLength(2);
  });

  it('...and the shortened TTL is strictly shorter than the 2m bidding window', async () => {
    // The bug in one assertion: at the old idle TTL a poll made one second
    // after the officer opened bidding would still be serving the empty list
    // when the auction closed. Two minutes is the duration every post used on
    // the raid that produced the report.
    const AUCTION_WINDOW_MS = 120_000;
    const h = build({ inRaid: true });
    h.setPayload([]);
    await h.get();                       // caches "nothing up"
    h.advance(AUCTION_WINDOW_MS - 1_000);
    h.setPayload([{ AuctionId: 1 }]);    // an officer opened bidding meanwhile
    expect(await h.get()).toHaveLength(1);
    expect(h.calls).toHaveLength(2);
  });

  it('does not shorten the ACTIVE TTL — once loot is up, 15s still governs', async () => {
    const h = build({ inRaid: true });
    h.setPayload([{ AuctionId: 1 }]);
    await h.get();
    h.advance(14_000); await h.get();
    expect(h.calls).toHaveLength(1);
    h.advance(2_000); await h.get();
    expect(h.calls).toHaveLength(2);
  });

  it('keeps the cheap 120s idle TTL off-raid — nobody is bidding at 3pm Tuesday', async () => {
    const h = build({ inRaid: false });
    h.setPayload([]);
    await h.get();
    h.advance(119_000); await h.get();
    expect(h.calls).toHaveLength(1);
  });

  it('an officer opening bidding drops the cache, so the next poll goes upstream', async () => {
    const h = build({ inRaid: true });
    h.setPayload([]);
    await h.get();
    expect(h.calls).toHaveLength(1);
    h.advance(1_000);
    await h.get();                       // still inside the TTL — no call
    expect(h.calls).toHaveLength(1);
    h.setPayload([{ AuctionId: 42 }]);
    h.invalidate();                      // POST /api/agent/loot-post just ran
    expect(await h.get()).toEqual([{ AuctionId: 42 }]);
    expect(h.calls).toHaveLength(2);
  });

  it('invalidating with nothing cached is a no-op, not a throw', () => {
    const h = build();
    expect(() => h.invalidate()).not.toThrow();
  });

  it('a cached FAILURE still gets its own short TTL, raid or not', async () => {
    const h = build({ inRaid: true });
    h.setFail(true);
    await expect(h.get()).rejects.toThrow(/upstream down/);
    h.advance(19_000);
    await expect(h.get()).rejects.toThrow(/cached failure/);
    h.advance(2_000);
    h.setFail(false);
    h.setPayload([{ AuctionId: 9 }]);
    expect(await h.get()).toEqual([{ AuctionId: 9 }]);
  });
});

describe('where the panel reads from', () => {
  it('the auctions key uses the ACTIVE endpoint via the cache, never raw getAuctions', () => {
    const auctionsKey = src.slice(src.indexOf("if (key === 'auctions')"), src.indexOf("if (key === 'my-bids')"));
    expect(auctionsKey).toContain('_panelAuctions()');
    expect(auctionsKey).not.toContain('getAuctions()');
  });

  it('my-bids reads inline Bids[] from the same cache — the N+1 is gone', () => {
    const myBids = src.slice(src.indexOf("if (key === 'my-bids')"), src.indexOf("if (key === 'opendkp-auth-config')"));
    expect(myBids).toContain('_panelAuctions()');
    expect(myBids).toContain('_panelCharacters()');
    expect(myBids).not.toContain('getAuction(');
    expect(myBids).not.toContain('opendkp.getCharacters()');
  });

  // The invalidator only helps if it is WIRED. Comment-stripped, because this
  // file's own header names the call site (CLAUDE.md, "comments satisfy text
  // assertions") and the whole point is that a comment is not the code.
  it('the loot-post handler drops the cache when it opens auctions', () => {
    const clean = stripJs(src);
    const handler = sliceBlock(clean, 'async function _handleAgentLootPost(req, res) {',
                               "console.error('[loot-post] failed:', err);");
    expect(handler).toContain('_invalidatePanelAuctions()');
  });

  it('auth-config is halt-gated so agent-direct /dkp calls starve fleet-wide', () => {
    const cfg = src.slice(src.indexOf("if (key === 'opendkp-auth-config')"), src.indexOf("if (key === 'item-history')"));
    expect(cfg).toContain('opendkpHalted()');
    expect(cfg).toContain('503');
  });
});
