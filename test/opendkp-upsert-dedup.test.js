// #138 OpenDKP upsert-batch dedup — REAL-IMPORT fidelity tier.
//
// Under test: dedupByConflictKey in utils/openDkpSync.js. PostgREST rejects the
// WHOLE upsert batch with SQLSTATE 21000 ("ON CONFLICT DO UPDATE command cannot
// affect row a second time") the moment two rows in one payload share the
// conflict-target key — so the rows silently never mirror. This helper collapses
// a batch to one row per conflict key BEFORE the upsert, matching each table's
// exact arbiter index (bids: plain NULLS DISTINCT; loot: NULLS NOT DISTINCT).
//
// The exact conflict keys were confirmed live against project zhtoekwakucbckvatfky:
//   opendkp_auction_bids_dedup   UNIQUE (auction_id, character_name, value)
//   opendkp_loot_dedup_plain     UNIQUE (raid_id, game_item_id, character_name, dkp) NULLS NOT DISTINCT

import { describe, it, expect } from 'vitest';
import { dedupByConflictKey } from '../utils/openDkpSync.js';

describe('dedupByConflictKey — bids key (auction_id, character_name, value)', () => {
  const KEY = ['auction_id', 'character_name', 'value'];

  it('collapses two rows sharing the full conflict key to one', () => {
    const rows = [
      { auction_id: 1, character_name: 'Kebarer', value: 100, bid_at: '2026-07-22T01:00:00Z' },
      { auction_id: 1, character_name: 'Kebarer', value: 100, bid_at: '2026-07-22T01:05:00Z' },
      { auction_id: 1, character_name: 'Gabekn', value: 90, bid_at: '2026-07-22T01:01:00Z' },
    ];
    const { rows: out, dropped } = dedupByConflictKey(rows, KEY, {
      preferNewer: (a, b) => String(a.bid_at || '') > String(b.bid_at || ''),
    });
    expect(dropped).toBe(1);
    expect(out).toHaveLength(2);
    // preferNewer keeps the later bid_at for the collapsed pair
    const kept = out.find(r => r.character_name === 'Kebarer');
    expect(kept.bid_at).toBe('2026-07-22T01:05:00Z');
  });

  it('keeps rows that differ only by value (distinct key → no collision)', () => {
    const rows = [
      { auction_id: 1, character_name: 'Kebarer', value: 100 },
      { auction_id: 1, character_name: 'Kebarer', value: 120 },
    ];
    const { rows: out, dropped } = dedupByConflictKey(rows, KEY);
    expect(dropped).toBe(0);
    expect(out).toHaveLength(2);
  });

  it('is case-sensitive on character_name (matches the DB arbiter, not lower())', () => {
    const rows = [
      { auction_id: 1, character_name: 'Kebarer', value: 100 },
      { auction_id: 1, character_name: 'KEBARER', value: 100 },
    ];
    const { rows: out, dropped } = dedupByConflictKey(rows, KEY);
    expect(dropped).toBe(0);
    expect(out).toHaveLength(2);
  });

  it('does NOT over-collapse null value under a plain (NULLS DISTINCT) index', () => {
    // Postgres treats each NULL as unique, so two null-value rows never collide
    // and the batch would NOT 21000 — the helper must keep both.
    const rows = [
      { auction_id: 1, character_name: 'Kebarer', value: null },
      { auction_id: 1, character_name: 'Kebarer', value: null },
    ];
    const { rows: out, dropped } = dedupByConflictKey(rows, KEY);
    expect(dropped).toBe(0);
    expect(out).toHaveLength(2);
  });

  it('does not confuse adjacent columns (delimited key)', () => {
    const rows = [
      { auction_id: 1, character_name: '2', value: 3 },
      { auction_id: 12, character_name: '', value: 3 },
    ];
    const { dropped } = dedupByConflictKey(rows, KEY);
    expect(dropped).toBe(0);
  });
});

describe('dedupByConflictKey — loot key, NULLS NOT DISTINCT', () => {
  const KEY = ['raid_id', 'game_item_id', 'character_name', 'dkp'];
  const OPTS = { nullsNotDistinct: true, preferNewer: (a, b) => String(a.fetched_at || '') > String(b.fetched_at || '') };

  it('collapses a duplicate award pair to one', () => {
    const rows = [
      { raid_id: 5, game_item_id: 1001, character_name: 'Melting', dkp: 30, fetched_at: '2026-07-22T01:00:00Z' },
      { raid_id: 5, game_item_id: 1001, character_name: 'Melting', dkp: 30, fetched_at: '2026-07-22T02:00:00Z' },
    ];
    const { rows: out, dropped } = dedupByConflictKey(rows, KEY, OPTS);
    expect(dropped).toBe(1);
    expect(out).toHaveLength(1);
    expect(out[0].fetched_at).toBe('2026-07-22T02:00:00Z');
  });

  it('collapses two rows with NULL game_item_id together (NULLS NOT DISTINCT)', () => {
    const rows = [
      { raid_id: 5, game_item_id: null, character_name: 'Gibobab', dkp: 0, fetched_at: 'a' },
      { raid_id: 5, game_item_id: null, character_name: 'Gibobab', dkp: 0, fetched_at: 'b' },
    ];
    const { rows: out, dropped } = dedupByConflictKey(rows, KEY, OPTS);
    expect(dropped).toBe(1);
    expect(out).toHaveLength(1);
  });

  it('keeps distinct items for the same character', () => {
    const rows = [
      { raid_id: 5, game_item_id: 1001, character_name: 'Gonobtik', dkp: 30 },
      { raid_id: 5, game_item_id: 1002, character_name: 'Gonobtik', dkp: 30 },
    ];
    const { dropped } = dedupByConflictKey(rows, KEY, OPTS);
    expect(dropped).toBe(0);
  });
});

describe('dedupByConflictKey — edge cases', () => {
  it('is idempotent (a deduped batch stays unchanged)', () => {
    const rows = [
      { auction_id: 1, character_name: 'A', value: 1 },
      { auction_id: 1, character_name: 'B', value: 2 },
    ];
    const first = dedupByConflictKey(rows, ['auction_id', 'character_name', 'value']);
    const second = dedupByConflictKey(first.rows, ['auction_id', 'character_name', 'value']);
    expect(second.dropped).toBe(0);
    expect(second.rows).toHaveLength(2);
  });

  it('tolerates a non-array input', () => {
    expect(dedupByConflictKey(null, ['x']).rows).toEqual([]);
    expect(dedupByConflictKey(undefined, ['x']).dropped).toBe(0);
  });

  it('defaults to keeping the FIRST row seen when no preferNewer is given', () => {
    const rows = [
      { auction_id: 1, character_name: 'A', value: 1, tag: 'first' },
      { auction_id: 1, character_name: 'A', value: 1, tag: 'second' },
    ];
    const { rows: out } = dedupByConflictKey(rows, ['auction_id', 'character_name', 'value']);
    expect(out[0].tag).toBe('first');
  });
});
