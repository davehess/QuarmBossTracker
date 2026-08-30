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
