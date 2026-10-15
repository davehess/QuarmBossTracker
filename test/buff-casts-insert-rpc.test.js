// test/buff-casts-insert-rpc.test.js — buff landings go in through insert_buff_casts, not a plain insert.
//
// Raid night 2026-10-14: buff_casts dedups through two PARTIAL unique indexes, and the bot's
// `Prefer: resolution=ignore-duplicates` insert only skips primary-key conflicts, so one duplicate landing
// 409'd the whole batch and every new landing in it was lost. The handler now calls the insert_buff_casts
// RPC (ON CONFLICT DO NOTHING with no target) once for the whole batch, and falls back to the old two
// inserts only when that call fails, so it is never worse than before.
//
// Runs the handler's REAL write block against a fake Supabase.
// Run: npx vitest run test/buff-casts-insert-rpc.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, ROOT, sliceBlock } from './_source-slice.js';

const bot = readSource(path.join(ROOT, 'index.js'));
const block = sliceBlock(bot, "  let written = 0;\n  // buff_casts dedups through two PARTIAL unique indexes", '  // P1b: feed the coverage counter');

function run({ rpcResult, resolved, ambiguous }) {
  const calls = { rpc: [], insert: [] };
  const supabase = {
    rpc: async (name, params) => { calls.rpc.push([name, params]); if (rpcResult instanceof Error) throw rpcResult; return rpcResult; },
    insertIgnoreDuplicates: async (table, rows) => { calls.insert.push([table, rows.length]); return undefined; },
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('supabase', 'resolved', 'ambiguous', 'console',
    'return (async () => {' + block + '\nreturn written; })();');
  return fn(supabase, resolved, ambiguous, { warn() {} }).then(written => ({ written, calls }));
}

const R = [{ target: 'A', spell_id: 5 }, { target: 'B', spell_id: 6 }];
const A = [{ target: 'C', spell_id: 0, landing_text: 'x' }];

describe('buff_casts write path', () => {
  it('sends the whole batch, resolved and ambiguous together, to insert_buff_casts once', async () => {
    const { written, calls } = await run({ rpcResult: 2, resolved: R, ambiguous: A });
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0][0]).toBe('insert_buff_casts');
    expect(calls.rpc[0][1].p_rows).toHaveLength(3);
    expect(calls.insert).toHaveLength(0);
    expect(written).toBe(2);   // what the function says it inserted, duplicates excluded
  });

  it('an all-duplicate batch is a success with nothing written, not a fallback', async () => {
    const { written, calls } = await run({ rpcResult: 0, resolved: R, ambiguous: [] });
    expect(written).toBe(0);
    expect(calls.insert).toHaveLength(0);
  });

  it('a failed call (store down, function missing) falls back to the old inserts', async () => {
    for (const rpcResult of [null, new Error('boom')]) {
      const { calls } = await run({ rpcResult, resolved: R, ambiguous: A });
      expect(calls.insert.map(c => c[0])).toEqual(['buff_casts', 'buff_casts']);
    }
  });

  it('nothing to write calls nothing', async () => {
    const { written, calls } = await run({ rpcResult: 5, resolved: [], ambiguous: [] });
    expect([written, calls.rpc.length, calls.insert.length]).toEqual([0, 0, 0]);
  });
});

describe('the migration', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261015014500_insert_buff_casts.sql'), 'utf8')
    .split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  it('skips a conflict on ANY unique index (no conflict target) and is callable by the bot only', () => {
    expect(sql).toMatch(/on conflict do nothing/i);
    expect(sql).not.toMatch(/on conflict\s*\(/i);
    expect(sql).toMatch(/revoke all on function public\.insert_buff_casts\(jsonb\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.insert_buff_casts\(jsonb\) to service_role/);
  });
});
