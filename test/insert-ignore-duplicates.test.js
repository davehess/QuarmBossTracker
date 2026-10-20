// test/insert-ignore-duplicates.test.js — one duplicate no longer costs a whole batch (2026-10-20).
//
// The postgres log, 24 h: 220 x 23505 on "encounter_events_dedup", 3 x on "faction_hits_dedup_idx", each from
// `INSERT … ON CONFLICT("id") DO NOTHING`. PostgREST's `resolution=ignore-duplicates` targets the PRIMARY KEY
// only, so any other unique index rejected the entire batch. insertIgnoreDuplicates now calls
// public.insert_ignore_duplicates (ON CONFLICT DO NOTHING, no target). Also here: the rollup upsert's row
// order (4 x 40P01 deadlocks) and the charm_sessions integer columns (6 x 22P02 on "50.346").
//
// Run: npx vitest run test/insert-ignore-duplicates.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, ROOT, BOT_INDEX, sliceBlock, evalBlock, stripSql, stripJs } from './_source-slice.js';

process.env.SUPABASE_URL = 'https://test.invalid.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

import supabase from '../utils/supabase.js';

const realFetch = global.fetch;
const RES = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  text: async () => (body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)),
});
const MISSING = { code: 'PGRST202', message: 'Could not find the function public.insert_ignore_duplicates(p_rows, p_table) in the schema cache' };

let warn;
beforeEach(() => {
  supabase._resetBreaker();
  supabase._resetIgnoreRpc();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { global.fetch = realFetch; warn.mockRestore(); });

const sent = (f) => f.mock.calls.map(([url, init]) => ({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : undefined, prefer: init.headers.Prefer }));

describe('insertIgnoreDuplicates — RPC path', () => {
  it('posts to /rpc/insert_ignore_duplicates with the table and the rows', async () => {
    global.fetch = vi.fn(async () => RES(200, []));
    await supabase.insertIgnoreDuplicates('encounter_events', [{ a: 1, b: 2 }, { a: 3, b: 4 }]);
    const [c] = sent(global.fetch);
    expect(c.url).toBe('https://test.invalid.supabase.co/rest/v1/rpc/insert_ignore_duplicates');
    expect(c.method).toBe('POST');
    expect(c.body).toEqual({ p_table: 'encounter_events', p_rows: [{ a: 1, b: 2 }, { a: 3, b: 4 }], p_return_rows: false });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('groups rows by key set, so a row never receives NULL for a column it omitted', async () => {
    global.fetch = vi.fn(async () => RES(200, []));
    await supabase.insertIgnoreDuplicates('raid_nights', [
      { guild_id: 'g', date: 'd1' },
      { guild_id: 'g', date: 'd2', zone_main: 'z' },
      { date: 'd3', guild_id: 'g' },            // same keys as the first, different order
    ]);
    const calls = sent(global.fetch);
    expect(calls).toHaveLength(2);
    const byLen = calls.map(c => c.body.p_rows).sort((a, b) => a.length - b.length);
    expect(byLen[0]).toEqual([{ guild_id: 'g', date: 'd2', zone_main: 'z' }]);
    expect(byLen[1]).toHaveLength(2);
  });

  it('strips a ?select= from the table argument', async () => {
    global.fetch = vi.fn(async () => RES(200, [{ name_key: 'x' }]));
    const out = await supabase.insertIgnoreDuplicates('raid_night_appearance?select=name_key', [{ name_key: 'x' }], { representation: true });
    expect(sent(global.fetch)[0].body.p_table).toBe('raid_night_appearance');
    expect(sent(global.fetch)[0].body.p_return_rows).toBe(true);   // rows come back only when the caller asked
    expect(out).toEqual([{ name_key: 'x' }]);
  });

  it('representation returns the inserted rows across groups; the default stays null like before', async () => {
    let n = 0;
    global.fetch = vi.fn(async () => RES(200, [{ id: ++n }]));
    const rows = [{ a: 1 }, { b: 2 }];
    expect(await supabase.insertIgnoreDuplicates('t', rows, { representation: true })).toEqual([{ id: 1 }, { id: 2 }]);
    global.fetch = vi.fn(async () => RES(200, [{ id: 9 }]));
    expect(await supabase.insertIgnoreDuplicates('t', rows)).toBe(null);
  });

  it('representation: an empty answer (everything was a duplicate) is [] and not null', async () => {
    global.fetch = vi.fn(async () => RES(200, []));
    expect(await supabase.insertIgnoreDuplicates('t', [{ a: 1 }], { representation: true })).toEqual([]);
  });

  it('a real failure (400) resolves to null and does NOT fall back to the plain POST', async () => {
    global.fetch = vi.fn(async () => RES(400, { code: '42703', message: 'no insertable column' }));
    expect(await supabase.insertIgnoreDuplicates('t', [{ a: 1 }], { representation: true })).toBe(null);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('insertIgnoreDuplicates — function not installed yet', () => {
  it('falls back to the old PostgREST POST, warns once, and skips the RPC afterwards', async () => {
    global.fetch = vi.fn(async (url) => String(url).includes('/rpc/') ? RES(404, MISSING) : RES(201, [{ id: 1 }]));
    const out = await supabase.insertIgnoreDuplicates('encounter_events', [{ a: 1 }], { representation: true });
    expect(out).toEqual([{ id: 1 }]);
    const calls = sent(global.fetch);
    expect(calls[0].url).toMatch(/\/rpc\/insert_ignore_duplicates$/);
    expect(calls[1].url).toBe('https://test.invalid.supabase.co/rest/v1/encounter_events');
    expect(calls[1].prefer).toBe('return=representation,resolution=ignore-duplicates');
    expect(calls[1].body).toEqual([{ a: 1 }]);

    global.fetch = vi.fn(async () => RES(201, null));
    await supabase.insertIgnoreDuplicates('encounter_events', [{ a: 2 }]);
    expect(sent(global.fetch).map(c => c.url)).toEqual(['https://test.invalid.supabase.co/rest/v1/encounter_events']);
    expect(warn.mock.calls.filter(c => /insert_ignore_duplicates RPC is not installed/.test(String(c[0])))).toHaveLength(1);
  });

  it('keeps the ?select= on the fallback POST, as before', async () => {
    global.fetch = vi.fn(async (url) => String(url).includes('/rpc/') ? RES(404, MISSING) : RES(201, []));
    await supabase.insertIgnoreDuplicates('raid_night_appearance?select=name_key', [{ name_key: 'x' }], { representation: true });
    expect(sent(global.fetch)[1].url).toBe('https://test.invalid.supabase.co/rest/v1/raid_night_appearance?select=name_key');
  });

  it('a 404 that is NOT the missing function (e.g. unknown table) is not mistaken for it', async () => {
    global.fetch = vi.fn(async () => RES(404, { code: 'PGRST205', message: 'Could not find the table' }));
    expect(await supabase.insertIgnoreDuplicates('t', [{ a: 1 }])).toBe(null);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('migration 20261020200000_insert_ignore_duplicates_rpc.sql', () => {
  const file = path.join(ROOT, 'supabase', 'migrations', '20261020200000_insert_ignore_duplicates_rpc.sql');
  const sql = stripSql(fs.readFileSync(file, 'utf8')).replace(/\s+/g, ' ');

  it('is a security-invoker function with a pinned search_path, callable by service_role only', () => {
    expect(sql).toMatch(/create or replace function public\.insert_ignore_duplicates\(p_table text, p_rows jsonb, p_return_rows boolean default false\) returns jsonb/);
    expect(sql).toMatch(/security invoker/);
    expect(sql).toMatch(/set search_path = public/);
    expect(sql).toMatch(/revoke execute on function public\.insert_ignore_duplicates\(text, jsonb, boolean\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.insert_ignore_duplicates\(text, jsonb, boolean\) to service_role/);
    expect(sql).not.toMatch(/security definer/);
  });

  it('sends rows back only when asked (egress): the default branch returns an empty array', () => {
    expect(sql).toMatch(/if not coalesce\(p_return_rows, false\) then execute format\( 'insert into public\.%1\$I \(%2\$s\) ' 'select %2\$s from jsonb_populate_recordset\(null::public\.%1\$I, \$1\) ' 'on conflict do nothing', p_table, v_cols\) using p_rows; return '\[\]'::jsonb; end if;/);
  });

  it('inserts with ON CONFLICT DO NOTHING and no conflict target, and returns the inserted rows', () => {
    expect(sql).toMatch(/on conflict do nothing/);
    expect(sql).not.toMatch(/on conflict\s*\(/);
    expect(sql).not.toMatch(/on conflict on constraint/);
    expect(sql).toMatch(/returning \*/);
    expect(sql).toMatch(/jsonb_populate_recordset\(null::public\.%1\$I/);
  });

  it('validates the table and every column before building the statement, quoting names with %I', () => {
    expect(sql).toMatch(/to_regclass\(format\('public\.%I', p_table\)\)/);
    expect(sql).toMatch(/relkind in \('r', 'p'\)/);
    expect(sql).toMatch(/from pg_attribute a/);
    expect(sql).toMatch(/not a\.attisdropped and a\.attgenerated = ''/);
    expect(sql).toMatch(/raise exception 'insert_ignore_duplicates: public\.% has no insertable column %'/);
    expect(sql).toMatch(/format\('%I', k\)/);
    // the validation precedes the dynamic statement
    expect(sql.indexOf('to_regclass')).toBeLessThan(sql.indexOf('execute format'));
    expect(sql.indexOf('pg_attribute')).toBeLessThan(sql.indexOf('execute format'));
  });

  it('asks PostgREST to reload its schema so the function is not a 404 until a restart', () => {
    expect(sql).toMatch(/notify pgrst, 'reload schema'/);
  });
});

describe('upsertCombatRollup — one lock order', () => {
  it('sends rows sorted by character_name whatever order the caller built them in', async () => {
    process.env.SUPABASE_GUILD_ID = 'wolfpack';
    global.fetch = vi.fn(async () => RES(200, []));
    await supabase.upsertCombatRollup('enc-1', '3.0.0', { Zarrin: {}, Aldenmar: {}, Nyssara: {}, Brackwyn: {} });
    const [c] = sent(global.fetch);
    expect(c.url).toMatch(/encounter_combat_rollup\?on_conflict=encounter_id,character_name$/);
    expect(c.body.map(r => r.character_name)).toEqual(['Aldenmar', 'Brackwyn', 'Nyssara', 'Zarrin']);
  });
});

describe('charm_sessions integer columns', () => {
  const src = readSource(BOT_INDEX);
  const block = sliceBlock(src, 'const charmRows = encounter.charm_sessions.map(', '}));');
  const build = (sessions) => {
    const fn = new Function('encounter', 'recParseResult', 'character', 'guildId', 'charmSpellName', 'charmRanFull',
      block + '\nreturn charmRows;');
    return fn({ charm_sessions: sessions }, { encounterId: 'e' }, 'Aldenmar', 'wolfpack', (s) => s || null, (r) => r ?? null);
  };
  const S = (o) => ({ pet: 'a pet', owner: 'Brackwyn', started_at: 1760000000000, ...o });

  it('rounds decimal duration and damage (the "50.346" that 22P02-ed the upsert)', () => {
    const [r] = build([S({ duration_sec: 50.346, total_damage: 1234.6 })]);
    expect(r.duration_sec).toBe(50);
    expect(r.total_damage).toBe(1235);
  });

  it('keeps null when the duration is absent and 0 when the damage is', () => {
    const [r] = build([S({})]);
    expect(r.duration_sec).toBe(null);
    expect(r.total_damage).toBe(0);
  });

  it('only the integer columns are rounded', () => {
    expect(stripJs(block)).not.toMatch(/Math\.round\([^)]*(started_at|ended_at)/);
  });
});
