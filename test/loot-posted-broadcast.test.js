// #149 loot-posted broadcast (bot half) — SOURCE-SLICE fidelity tier.
//
// The officer "Post for bidding" action (_handleAgentLootPost) records a
// loot-posted event in an in-memory ring so every agent's fast poll can fire the
// raid-wide "Loot posted — N items" TTS off the REAL post instead of sniffing
// guild chat. The ring + its recorder/slice live inside the bot monolith
// (index.js) and aren't exported (require()-ing index.js boots Discord), so we
// read the real source and eval JUST the #149 ring block — the test tracks the
// shipped code: edit it and this exercises the new behavior; rename/delete it and
// the slice throws. Same technique as test/loot-bidding.test.js.

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const block = sliceBlock(
  src,
  'const LOOT_POSTED_TTL_MS      = 10 * 60_000;',
  '// ── end #149 loot-posted ring ──',
);
const { _recordLootPosted, _lootPostedSince } = evalBlock(block, ['_recordLootPosted', '_lootPostedSince']);

describe('_recordLootPosted — records names/quantities only (real index.js)', () => {
  it('stores item_count, names + quantities, posted_by, window_sec', () => {
    const e = _recordLootPosted({
      items: [{ name: 'Cloak of Flames', quantity: 1 }, { name: 'Fungus Covered Scale Tunic', quantity: 2 }],
      postedBy: 'Hitya',
      windowSec: 180,
    });
    expect(e.item_count).toBe(2);
    expect(e.items).toEqual([
      { name: 'Cloak of Flames', quantity: 1 },
      { name: 'Fungus Covered Scale Tunic', quantity: 2 },
    ]);
    expect(e.posted_by).toBe('Hitya');
    expect(e.window_sec).toBe(180);
    expect(typeof e.at).toBe('string');
  });

  it('NEVER carries bid amounts — item entries are name/quantity only', () => {
    const e = _recordLootPosted({
      // A caller that fat-fingers bid data in still only gets name+quantity out.
      items: [{ name: 'Ring', quantity: 1, value: 500, bid: 999, bids: [{ value: 42 }] }],
      postedBy: 'Officer',
      windowSec: 120,
    });
    expect(Object.keys(e.items[0]).sort()).toEqual(['name', 'quantity']);
    const json = JSON.stringify(e);
    expect(json).not.toMatch(/value|bid/i);
  });

  it('defaults quantity to 1 and drops nameless items', () => {
    const e = _recordLootPosted({ items: [{ name: 'Belt' }, { quantity: 3 }, { name: '' }], postedBy: '', windowSec: NaN });
    expect(e.item_count).toBe(1);
    expect(e.items).toEqual([{ name: 'Belt', quantity: 1 }]);
    expect(e.posted_by).toBe('an officer');
    expect(e.window_sec).toBe(null);
  });

  it('returns null when there is nothing valid to record', () => {
    expect(_recordLootPosted({ items: [], postedBy: 'X', windowSec: 60 })).toBe(null);
    expect(_recordLootPosted({ items: [{ name: '' }], postedBy: 'X', windowSec: 60 })).toBe(null);
    expect(_recordLootPosted({ items: 'nope', postedBy: 'X', windowSec: 60 })).toBe(null);
  });

  it('ids seed from a monotonic boot base (not 1) so a redeploy never sorts below a stored cursor', () => {
    const e = _recordLootPosted({ items: [{ name: 'Spear', quantity: 1 }], postedBy: 'X', windowSec: 60 });
    // Boot base is Date.now() at module eval — far above 1; a fleet cursor stored
    // pre-redeploy can never be above a fresh id.
    expect(e.id).toBeGreaterThan(1e12);
  });
});

describe('_lootPostedSince — replay-guarded cursor (mirrors recent-fires)', () => {
  it('returns only entries newer than loot_since_id and advances loot_next_id', () => {
    const a = _recordLootPosted({ items: [{ name: 'A', quantity: 1 }], postedBy: 'O', windowSec: 60 });
    const b = _recordLootPosted({ items: [{ name: 'B', quantity: 1 }], postedBy: 'O', windowSec: 60 });

    // A client caught up through `a` only sees `b`.
    const after = _lootPostedSince(a.id);
    const names = after.loot_posted.map(x => x.items[0].name);
    expect(names).toContain('B');
    expect(names).not.toContain('A');
    // Advancing to loot_next_id then re-polling yields nothing (no re-announce).
    const drained = _lootPostedSince(after.loot_next_id);
    expect(drained.loot_posted).toEqual([]);
    expect(drained.loot_next_id).toBe(after.loot_next_id);
  });

  it('a fresh reconnect (loot_since_id=0) replays only the events still in the ring', () => {
    const first = _lootPostedSince(0);
    expect(Array.isArray(first.loot_posted)).toBe(true);
    // sliced entries carry names only — no bid fields leak on the wire
    for (const ev of first.loot_posted) {
      for (const it of ev.items) expect(Object.keys(it).sort()).toEqual(['name', 'quantity']);
    }
  });

  it('caps the ring at 10 entries (oldest evicted)', () => {
    for (let i = 0; i < 15; i++) _recordLootPosted({ items: [{ name: 'Item' + i, quantity: 1 }], postedBy: 'O', windowSec: 60 });
    const all = _lootPostedSince(0);
    expect(all.loot_posted.length).toBeLessThanOrEqual(10);
  });
});
