// The threat-snapshot retention sweep, batched (2026-10-15).
//
// The old sweep was one `DELETE ... WHERE snapshot_at < cutoff` over ~1M rows with
// no usable index; it seq-scanned, hit the bot client's 10s abort every night, and
// the catch only warned — so it never removed a row. It is now the
// prune_threat_snapshots RPC (a bounded batch per call) driven by
// _sweepThreatSnapshots (loop + pause + time budget). These tests check the
// migration text (comments stripped — the header names the very things it avoids)
// and run the REAL loop from index.js against a fake supabase.
//
// Run: npx vitest run test/prune-threat-snapshots.test.js

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { ROOT, readSource, sliceBlock, evalBlock, stripJs, stripSql, BOT_INDEX } from './_source-slice.js';

const migration = stripSql(fs.readFileSync(
  path.join(ROOT, 'supabase', 'migrations', '20261015041000_prune_threat_snapshots.sql'), 'utf8'));
const src = readSource(BOT_INDEX);
const { _sweepThreatSnapshots } = evalBlock(
  sliceBlock(src, 'async function _sweepThreatSnapshots(supabase, cutoffIso, {', '  return { deleted, batches, stop };\n}'),
  ['_sweepThreatSnapshots'],
);

describe('prune_threat_snapshots migration', () => {
  it('bounds every call with a clamped batch limit', () => {
    expect(migration).toMatch(/p_batch\s+integer default 2000/);
    expect(migration).toMatch(/least\(greatest\(coalesce\(p_batch, 2000\), 1\), 10000\)/);
    // both delete passes select their victims with the batch limit
    expect(migration.match(/limit v_batch/g).length).toBeGreaterThanOrEqual(3);
  });
  it('deletes by primary key from a victims set, never an open-ended predicate', () => {
    expect(migration.match(/delete from public\.encounter_threat_snapshots s\s+using victims v\s+where s\.id = v\.id/g)).toHaveLength(2);
    expect(migration).not.toMatch(/delete from public\.encounter_threat_snapshots\s+where snapshot_at/);
  });
  it('drives the unbound pass off the partial index shape and the bound pass off encounters', () => {
    expect(migration).toMatch(/where encounter_id is null\s+and snapshot_at < p_cutoff\s+order by snapshot_at/);
    expect(migration).toMatch(/from public\.encounters e\s+where e\.started_at < p_cutoff\s+order by e\.started_at/);
    expect(migration).toMatch(/s\.encounter_id = e\.id\s+and s\.snapshot_at < p_cutoff/);
  });
  it('refuses a null or too-recent cutoff', () => {
    expect(migration).toMatch(/p_cutoff is null/);
    expect(migration).toMatch(/p_cutoff > now\(\) - interval '7 days'/);
  });
  it('is invoker, search_path pinned, and callable only by service_role', () => {
    expect(migration).toMatch(/security invoker/);
    expect(migration).toMatch(/set search_path = public/);
    expect(migration).toMatch(/revoke all on function public\.prune_threat_snapshots\(timestamptz, integer\) from public;/);
    expect(migration).toMatch(/revoke all on function public\.prune_threat_snapshots\(timestamptz, integer\) from anon;/);
    expect(migration).toMatch(/revoke all on function public\.prune_threat_snapshots\(timestamptz, integer\) from authenticated;/);
    expect(migration).toMatch(/grant execute on function public\.prune_threat_snapshots\(timestamptz, integer\) to service_role;/);
  });
  it('is idempotent and builds no index', () => {
    expect(migration).toMatch(/create or replace function/);
    expect(migration).not.toMatch(/create\s+(unique\s+)?index/i);
  });
});

// A fake clock: sleep() advances it, every rpc costs `rpcMs`.
function harness(replies, { rpcMs = 0 } = {}) {
  let t = 0;
  const calls = [];
  const sleeps = [];
  const supabase = {
    rpc: async (fn, params) => {
      calls.push({ fn, params });
      t += rpcMs;
      const r = replies.length ? replies.shift() : 0;
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return { supabase, calls, sleeps, opts: { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } } };
}

describe('_sweepThreatSnapshots — the loop', () => {
  it('stops when a call returns 0, summing what it removed', async () => {
    const h = harness([2000, 2000, 731, 0, 999]);
    const r = await _sweepThreatSnapshots(h.supabase, '2026-09-01T00:00:00.000Z', { ...h.opts, batch: 2000, budgetMs: 1e9, pauseMs: 50 });
    expect(r).toEqual({ deleted: 4731, batches: 3, stop: 'done' });
    expect(h.calls).toHaveLength(4);          // the 5th reply was never asked for
    expect(h.calls[0]).toEqual({ fn: 'prune_threat_snapshots', params: { p_cutoff: '2026-09-01T00:00:00.000Z', p_batch: 2000 } });
    expect(h.sleeps).toEqual([50, 50, 50]);   // pauses between deleting calls, none after the 0
  });
  it('a first call that returns 0 is done with nothing deleted', async () => {
    const h = harness([0]);
    expect(await _sweepThreatSnapshots(h.supabase, 'x', { ...h.opts })).toEqual({ deleted: 0, batches: 0, stop: 'done' });
  });
  it('stops at the time budget even though rows remain, and issues no call past it', async () => {
    const h = harness(Array(1000).fill(2000), { rpcMs: 500 });
    const r = await _sweepThreatSnapshots(h.supabase, 'x', { ...h.opts, budgetMs: 10_000, pauseMs: 500 });
    expect(r.stop).toBe('budget');
    expect(r.batches).toBe(10);               // 10 x (500ms call + 500ms pause) = 10s
    expect(r.deleted).toBe(20000);
    expect(h.calls).toHaveLength(10);
  });
  it('a failed call (null / non-number) stops the sweep without throwing', async () => {
    const h = harness([2000, null, 2000]);
    expect(await _sweepThreatSnapshots(h.supabase, 'x', { ...h.opts })).toEqual({ deleted: 2000, batches: 1, stop: 'error' });
    expect(h.calls).toHaveLength(2);
  });
  it('a thrown rpc is swallowed, not propagated', async () => {
    const h = harness([new Error('boom')]);
    const r = await _sweepThreatSnapshots(h.supabase, 'x', { ...h.opts });
    expect(r).toEqual({ deleted: 0, batches: 0, stop: 'error' });
  });
});

describe('midnight job wiring', () => {
  const clean = stripJs(src);
  it('uses the batched sweep and no longer issues the single DELETE', () => {
    expect(clean).toMatch(/await _sweepThreatSnapshots\(supabase, cutoff, \{ batch, budgetMs: budgetSec \* 1000 \}\)/);
    expect(clean).not.toMatch(/supabase\.del\(\s*'encounter_threat_snapshots'/);
  });
});
