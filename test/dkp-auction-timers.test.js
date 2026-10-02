// test/dkp-auction-timers.test.js — one timer per live OpenDKP auction.
//
// The guild lead, 2026-10-02: "add in loot auction timers on the control center as well as in
// the timers window for each individual one. note that as people bid when it's low time left, it
// does extend it further out. So the timers for those may end up changing."
//
// Runs the agent's real _applyDkpAuctions / _dkpAuctionsSnapshot over the bot panel's shape.
//
// Run: npx vitest run test/dkp-auction-timers.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock } from './_source-slice.js';

const agent = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const block = sliceBlock(agent, '// ── OpenDKP auctions, one timer each', '\n// Every 20 s, every 10 s while an auction is open.');

function load() {
  // eslint-disable-next-line no-new-func
  return new Function('const _activeTimers = new Map();\n' + block
    + '\nreturn { _applyDkpAuctions, _dkpAuctionsSnapshot, _activeTimers, _dkpAuctionsDismissed };')();
}

const T0 = Date.parse('2026-10-02T03:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

describe('OpenDKP auctions as timers', () => {
  it('opens one timer per auction, and a late bid moves its end', () => {
    const h = load();
    h._applyDkpAuctions([
      { auction_id: 11, item_name: 'Sceptre of Destruction', started_at: iso(T0 - 60_000), ends_at: iso(T0 + 120_000) },
      { auction_id: 12, item_name: 'Earring of Influence', started_at: iso(T0 - 60_000), ends_at: iso(T0 + 60_000) },
    ], T0);
    expect([...h._activeTimers.keys()].sort()).toEqual(['auction|11', 'auction|12']);
    const t = h._activeTimers.get('auction|11');
    expect(t).toMatchObject({ kind: 'loot', ends_at_ms: T0 + 120_000, duration_sec: 180, name: 'Sceptre of Destruction', warn_ms: 0 });
    // A bid at 0:10 left: OpenDKP pushes the end out.
    h._applyDkpAuctions([
      { auction_id: 11, item_name: 'Sceptre of Destruction', started_at: iso(T0 - 60_000), ends_at: iso(T0 + 120_000) },
      { auction_id: 12, item_name: 'Earring of Influence', started_at: iso(T0 - 60_000), ends_at: iso(T0 + 150_000) },
    ], T0 + 50_000);
    expect(h._activeTimers.get('auction|12')).toMatchObject({ ends_at_ms: T0 + 150_000, duration_sec: 210, name: 'Earring of Influence · extended' });
    const snap = h._dkpAuctionsSnapshot(T0 + 50_000);
    expect(snap.map(a => [a.id, a.extended, a.ms_left])).toEqual([['11', false, 70_000], ['12', true, 100_000]]);
  });

  it('a closed or vanished auction drops its timer; one ✕\'d stays gone until it closes', () => {
    const h = load();
    const two = [
      { auction_id: 1, item_name: 'A', ends_at: iso(T0 + 60_000) },
      { auction_id: 2, item_name: 'B', ends_at: iso(T0 + 90_000) },
    ];
    h._applyDkpAuctions(two, T0);
    h._activeTimers.delete('auction|2');           // the timers window's ✕
    h._dkpAuctionsDismissed.add('2');
    h._applyDkpAuctions(two, T0 + 5_000);
    expect(h._activeTimers.has('auction|2')).toBe(false);
    expect(h._dkpAuctionsSnapshot(T0 + 5_000).map(a => a.id)).toEqual(['1', '2']);   // still listed on the board
    h._applyDkpAuctions([two[1]], T0 + 61_000);   // 1 closed
    expect(h._activeTimers.has('auction|1')).toBe(false);
    h._applyDkpAuctions([], T0 + 91_000);
    expect(h._dkpAuctionsDismissed.size).toBe(0);
  });

  it('an auction with no end, or one already past, makes no timer', () => {
    const h = load();
    h._applyDkpAuctions([{ auction_id: 5, item_name: 'C', ends_at: null }, { auction_id: 6, item_name: 'D', ends_at: iso(T0 - 1) }], T0);
    expect(h._activeTimers.size).toBe(0);
  });
});
