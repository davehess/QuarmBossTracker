// The fan-in cache must protect OpenDKP while it is DOWN, not only while it works.
import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const block = sliceBlock(src, 'const _PANEL_AUCTIONS_TTL_ACTIVE_MS',
  '\n  _panelAuctionsCache = { at: now(), list };\n  return list;\n}');

function build() {
  const { _panelAuctions } = evalBlock('const console = { warn() {}, log() {} };\n' + block, ['_panelAuctions']);
  let t = 1_000_000, calls = 0, fail = false;
  return {
    get calls() { return calls; },
    setFail: (f) => { fail = f; },
    advance: (ms) => { t += ms; },
    get: () => _panelAuctions({
      now: () => t,
      fetch: async () => { calls++; if (fail) throw new Error('upstream down'); return [{ AuctionId: 1 }]; },
    }),
  };
}

describe('negative caching', () => {
  it('a COLD cache + failing upstream costs ONE attempt, not one per poll', async () => {
    // This is the 2026-08-26 hole: a failure cached nothing, so the fan-in
    // guarantee ("N dashboards cost what one costs") evaporated exactly when
    // OpenDKP was unreachable — the moment it matters most.
    const h = build();
    h.setFail(true);
    for (let i = 0; i < 20; i++) await h.get().catch(() => {});
    expect(h.calls).toBe(1);
  });

  it('retries after a short window — recovery is seconds, not minutes', async () => {
    const h = build();
    h.setFail(true);
    await h.get().catch(() => {});
    h.advance(21_000);
    await h.get().catch(() => {});
    expect(h.calls).toBe(2);
  });

  it('a cached failure THROWS — it must never look like "no auctions open"', async () => {
    const h = build();
    h.setFail(true);
    await h.get().catch(() => {});
    await expect(h.get()).rejects.toThrow(/cached failure/);
  });

  it('recovers to real data once upstream returns', async () => {
    const h = build();
    h.setFail(true);
    await h.get().catch(() => {});
    h.advance(21_000);
    h.setFail(false);
    expect(await h.get()).toEqual([{ AuctionId: 1 }]);
  });

  it('a failure does not inherit the 120s idle TTL', async () => {
    // Otherwise "upstream broken" and "nothing up for bid" are indistinguishable
    // for two minutes.
    const h = build();
    h.setFail(true);
    await h.get().catch(() => {});
    h.advance(30_000);
    await h.get().catch(() => {});
    expect(h.calls).toBe(2);
  });
});
