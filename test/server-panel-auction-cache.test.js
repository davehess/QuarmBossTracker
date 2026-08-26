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
import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, sliceBlock, evalBlock, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const block = sliceBlock(
  src,
  'const _PANEL_AUCTIONS_TTL_ACTIVE_MS',
  '\n  _panelAuctionsCache = { at: now(), list };\n  return list;\n}',
);

function build() {
  const { _panelAuctions } = evalBlock(
    'const console = { warn() {} };\n' + block,
    ['_panelAuctions'],
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
    get: () => _panelAuctions({
      now: () => t,
      fetch: async () => {
        if (fail) throw new Error('upstream down');
        calls.push(t);
        return payload;
      },
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

  it('stretches to 120s when no auctions are up — the idle fleet is cheap', async () => {
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

  it('auth-config is halt-gated so agent-direct /dkp calls starve fleet-wide', () => {
    const cfg = src.slice(src.indexOf("if (key === 'opendkp-auth-config')"), src.indexOf("if (key === 'item-history')"));
    expect(cfg).toContain('opendkpHalted()');
    expect(cfg).toContain('503');
  });
});
