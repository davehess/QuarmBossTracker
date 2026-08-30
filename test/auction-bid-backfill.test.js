// Full auction bids: the missing half of RECENT MISSES.
//
// Hitya's field report (2026-08-30): Utoh bid 8 on Vengeful Mail of the Void
// and lost — no row; a 15/15 tie showed a blank runner-up; Rockin's WIN of a
// second Thorny Chain Helm rendered as a family miss with CHAR "—".
// Measured cause: the auctions LIST payload carries only winning bids (1.08
// bids/auction mirrored, 92% of auctions with zero losing bids), and
// syncAuctionBids — the function that fetches the full detail — had NO
// CALLERS. Plus the char_id→name MODE heuristic failing where the
// characters.opendkp_id table had the real answer.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BOT_INDEX, readSource, sliceBlock, stripJs } from './_source-slice.js';

const ROOT = path.dirname(BOT_INDEX);
const syncSrc = readSource(path.join(ROOT, 'utils', 'openDkpSync.js'));
const syncCode = stripJs(syncSrc);
const botCode = stripJs(readSource(BOT_INDEX));

describe('pending-bids pass', () => {
  const pass = stripJs(sliceBlock(syncSrc, 'async function syncPendingAuctionBids()', '\n}'));

  it('is actually called — syncAuctionBids had no callers for its whole life', () => {
    const tail = syncCode.slice(syncCode.indexOf('async function syncAuctions'));
    expect(tail).toMatch(/await syncPendingAuctionBids\(\)/);
  });

  it('asks once per auction, ever: closed + unsynced + newest first', () => {
    expect(pass).toMatch(/bids_synced_at=is\.null/);
    expect(pass).toMatch(/winner_character_id=not\.is\.null/);   // open auctions still change
    expect(pass).toMatch(/order=end_at\.desc/);                  // misses window heals first
    expect(pass).toMatch(/bids_synced_at: new Date\(\)/);        // marked after answering
  });

  it('caps the pass and lets 0 disable it', () => {
    const cap = stripJs(sliceBlock(syncSrc, 'const BIDS_PER_PASS', '};'));
    expect(cap).toMatch(/OPENDKP_BIDS_PER_PASS/);
    expect(cap).toMatch(/Math\.min\(50/);
    expect(pass).toMatch(/cap === 0/);
    expect(pass).toMatch(/limit=\$\{cap\}/);
  });

  it('aborts on the first error instead of hammering a struggling API', () => {
    const idx = pass.indexOf('r.error');
    expect(idx).toBeGreaterThan(-1);
    expect(pass.slice(idx, idx + 260)).toMatch(/return \{/);
    // and the marker is NOT set on the failed auction, so it retries next pass
    expect(pass.slice(0, pass.indexOf('r.error'))).not.toMatch(/bids_synced_at: new Date/);
  });

  it('spaces the detail calls', () => {
    expect(pass).toMatch(/setTimeout\(res, 250\)/);
  });
});

describe('pending-bids pass — executed against a stub', () => {
  // ⚠ Behaviour, not text. The marker write shipped with update()'s arguments
  // SWAPPED — update(table, body, queryString) against a helper whose
  // signature is update(table, queryString, body). It PATCHed garbage, matched
  // nothing, threw nothing, and left every marker NULL, so the pass re-detailed
  // the same newest 10 auctions forever. Every text assertion stayed green
  // through that; only running the code against the real signature shape
  // catches an argument-order bug.
  async function run({ pending, bidResult }) {
    const calls = { select: [], update: [], details: [] };
    const block =
      'const supabase = {\n' +
      '  select: async (t, q) => { calls.select.push([t, q]); return pending; },\n' +
      '  update: async (t, q, body) => { calls.update.push([t, q, body]); return []; },\n' +
      '};\n' +
      'const syncAuctionBids = async (id) => { calls.details.push(id); return bidResult; };\n' +
      'const console = { warn: () => {}, log: () => {} };\n' +
      'const setTimeout = (fn) => fn();\n' +   // no real 250ms waits in tests
      sliceBlock(syncSrc, 'const BIDS_PER_PASS', '};') + '\n' +
      sliceBlock(syncSrc, 'async function syncPendingAuctionBids()', '\n}');
    const fn = new Function('calls', 'pending', 'bidResult', block + '\nreturn syncPendingAuctionBids();');
    const result = await fn(calls, pending, bidResult);
    return { calls, result };
  }

  it('marks each detailed auction with a QUERYSTRING filter and a body patch', async () => {
    const { calls } = await run({ pending: [{ auction_id: 777 }], bidResult: { bids_written: 3 } });
    expect(calls.details).toEqual([777]);
    expect(calls.update).toHaveLength(1);
    const [table, q, body] = calls.update[0];
    expect(table).toBe('opendkp_auctions');
    expect(q).toBe('auction_id=eq.777');                      // arg 2 is the FILTER
    expect(body).toHaveProperty('bids_synced_at');            // arg 3 is the PATCH
    expect(typeof body.bids_synced_at).toBe('string');
  });

  it('does not mark an auction whose detail call failed', async () => {
    const { calls, result } = await run({ pending: [{ auction_id: 1 }, { auction_id: 2 }], bidResult: { error: 'boom' } });
    expect(calls.details).toEqual([1]);                       // aborted after the first
    expect(calls.update).toHaveLength(0);
    expect(result.error).toBe('boom');
  });
});

describe('char_id → name resolution', () => {
  it('prefers characters.opendkp_id and keeps MODE as fallback only', () => {
    const h = botCode.slice(botCode.indexOf("if (key === 'bid-history')"));
    const authoritative = h.indexOf('select=name,opendkp_id');
    const fallback = h.indexOf('_resolveCharIdNames(wonAuctions, lootRows)');
    expect(authoritative).toBeGreaterThan(-1);
    expect(fallback).toBeGreaterThan(authoritative);
    // fallback must not clobber: only fill ids the table did not know
    expect(h.slice(fallback, fallback + 400)).toMatch(/nameByCharId\[cid\] == null/);
  });
});

describe('the migration', () => {
  const sql = fs.readFileSync(
    path.join(ROOT, 'supabase', 'migrations', '20260830210000_auction_bids_synced_marker.sql'),
    'utf8').replace(/^\s*--.*$/gm, '');

  it('is idempotent and indexes the exact pending-picker shape', () => {
    expect(sql).toMatch(/add column if not exists bids_synced_at/);
    expect(sql).toMatch(/create index if not exists/);
    expect(sql).toMatch(/where bids_synced_at is null and winner_character_id is not null/);
  });
});
