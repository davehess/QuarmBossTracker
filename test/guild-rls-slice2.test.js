// test/guild-rls-slice2.test.js — slice 2 of per-request guild scoping (decisions-inbox 496, "next three tables").
//
//   1. migration 20261031200000: three tables x four policies, the grants, both RPC guards, and the two RPC bodies kept
//      whole (the slice-2 body minus the guard must equal the body of the migration it was copied from);
//   2. utils/supabase.js recordParse under a stubbed fetch, on a raid night with a rollup and timeline events: with a
//      client every raid_nights / rollup / encounter_events request and both RPCs carry the guild token and the rows carry
//      the session's guild; with none (flag off) the same requests go out on the service key with today's guild tag.
//
// Source assertions run over comment-stripped text. Mutation-checked: see the report.
//
// Run: npx vitest run test/guild-rls-slice2.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readSource, ROOT, stripJs, stripSql } from './_source-slice.js';

const require = createRequire(import.meta.url);
const guildScoped = require('../utils/guildScoped.js');
const supabase = require('../utils/supabase.js');

const JWK = JSON.stringify({ ...crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' }), kid: 'test-kid-1' });
const SERVICE_KEY = 'service-key-for-tests';

const MIG_DIR = path.join(ROOT, 'supabase', 'migrations');
const MIGRATION = stripSql(readSource(path.join(MIG_DIR, '20261031200000_guild_rls_slice2.sql')));
const OLD_FIND = stripSql(readSource(path.join(MIG_DIR, '20261023130000_find_or_create_gap_split.sql')));
const OLD_MERGE = stripSql(readSource(path.join(MIG_DIR, '20261015040000_merge_encounter_players_concurrency.sql')));
const SUPABASE_SRC = stripJs(readSource(path.join(ROOT, 'utils', 'supabase.js')));

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const TABLES = ['raid_nights', 'encounter_combat_rollup', 'encounter_events'];

describe('migration 20261031200000_guild_rls_slice2.sql', () => {
  it('puts a select/insert/update/delete policy on exactly the three tables, each on the claim', () => {
    expect(MIGRATION).toMatch(/array\['raid_nights', 'encounter_combat_rollup', 'encounter_events'\]/);
    expect(MIGRATION).toMatch(/array\['select', 'insert', 'update', 'delete'\]/);
    expect(MIGRATION).toMatch(/pol := t \|\| '_guild_scoped_' \|\| c/);
    const policies = MIGRATION.match(/create policy [^;]*;/g) || [];
    expect(policies.length).toBe(3);   // insert / update / select+delete branches, looped over 3 tables = 12 policies
    for (const p of policies) {
      expect(p).toMatch(/to guild_scoped/);
      expect(p).toMatch(/guild_id = public\.app_guild_id\(\)/);
    }
    expect(policies.find((p) => /for insert/.test(p))).toMatch(/with check/);
    expect(policies.find((p) => /for update/.test(p))).toMatch(/using[\s\S]*with check/);
    expect(MIGRATION).toMatch(/if not exists \(select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = pol\)/);
  });

  it('grants the three tables, the bulk-insert helper and the two RPCs to guild_scoped, and nothing else', () => {
    const grants = MIGRATION.match(/grant [^;]*;/gi) || [];
    const onTables = grants.filter((g) => /\bon public\.\w+\s+to/.test(g)).map((g) => /on public\.(\w+)/.exec(g)[1]).sort();
    expect(onTables).toEqual([...TABLES].sort());
    for (const fn of ['insert_ignore_duplicates\\(text, jsonb, boolean\\)', 'find_or_create_encounter\\(text, integer, timestamptz, integer, integer, text\\)', 'merge_encounter_players\\(uuid\\)']) {
      expect(MIGRATION).toMatch(new RegExp(`grant execute on function public\\.${fn} to guild_scoped`));
    }
    expect(grants.every((g) => /to guild_scoped;$/.test(g))).toBe(true);
  });

  it('is additive: nothing dropped, disabled or granted to the existing roles, no row data touched', () => {
    expect(MIGRATION).not.toMatch(/\bdrop\b/i);
    expect(MIGRATION).not.toMatch(/\btruncate\b/i);
    expect(MIGRATION).not.toMatch(/disable row level security/i);
    expect(MIGRATION).not.toMatch(/\bto (anon|authenticated|service_role|public)\b/i);
    expect(MIGRATION).not.toMatch(/\bwith check \(true\)|using \(true\)/i);
    expect(MIGRATION).not.toMatch(/^\s*(insert into|update|delete from) public\./im);   // the RPC bodies' own DML is unqualified
  });

  it('find_or_create_encounter refuses a guild other than the claim, and is the old body otherwise', () => {
    const body = (s) => /\$function\$([\s\S]*?)\$function\$/.exec(s)?.[1] || '';
    const next = body(MIGRATION.slice(MIGRATION.indexOf('FUNCTION public.find_or_create_encounter')));
    const old = body(OLD_FIND);
    expect(next).toMatch(/if public\.app_guild_id\(\) is not null and p_guild_id is distinct from public\.app_guild_id\(\) then\s+raise exception 'guild mismatch';\s+end if;/);
    const guard = /if public\.app_guild_id\(\) is not null and p_guild_id is distinct from public\.app_guild_id\(\) then\s+raise exception 'guild mismatch';\s+end if;/;
    expect(norm(next.replace(guard, ''))).toBe(norm(old));
    // the guard comes before the advisory lock and the first read
    expect(next.search(guard)).toBeLessThan(next.indexOf('pg_advisory_xact_lock'));
    // the old body's distinctive lines are still there
    for (const line of ["v_gap       interval := interval '15 minutes'", 'and v_ended is not null', 'hashtextextended(p_guild_id']) expect(next).toContain(line);
    // header and settings survive (CREATE OR REPLACE would otherwise drop the search_path pin)
    expect(MIGRATION).toMatch(/SECURITY DEFINER\s+SET search_path TO 'public'/);
  });

  it('merge_encounter_players refuses an encounter of another guild, and is the old body otherwise', () => {
    const body = (s) => /returns void as \$\$([\s\S]*?)\$\$ language plpgsql security definer;/.exec(s)?.[1] || '';
    const next = body(MIGRATION);
    const old = body(OLD_MERGE);
    expect(old.length).toBeGreaterThan(500);
    const guard = /if public\.app_guild_id\(\) is not null then\s+select e\.guild_id into v_guild from encounters e where e\.id = p_encounter_id;\s+if v_guild is distinct from public\.app_guild_id\(\) then\s+raise exception 'guild mismatch';\s+end if;\s+end if;/;
    expect(next).toMatch(guard);
    expect(norm(next.replace(guard, '').replace('v_guild text;', ''))).toBe(norm(old));
    expect(next.search(guard)).toBeLessThan(next.indexOf('pg_advisory_xact_lock'));
    for (const line of ['leaving existing rows intact', "lower(player->>'name') <> v_boss", "hashtext('merge_encounter_players:'"]) expect(next).toContain(line);
  });

  it('a null claim skips both guards (the service role keeps working)', () => {
    expect((MIGRATION.match(/app_guild_id\(\) is not null/g) || []).length).toBe(2);
  });
});

// A fake PostgREST. insert_ignore_duplicates is the RPC the bot writes raid_nights and encounter_events through.
function fakeRest() {
  const calls = [];
  const fetchStub = vi.fn(async (url, init = {}) => {
    const u = new URL(url);
    const bearer = String(init.headers?.Authorization || '').replace(/^Bearer /, '');
    const body = init.body ? JSON.parse(init.body) : null;
    const call = { method: init.method || 'GET', path: u.pathname.replace('/rest/v1', ''), query: u.search, bearer, apikey: init.headers?.apikey, body };
    calls.push(call);
    const json = (data, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(data), headers: { get: () => null } });
    if (call.path === '/bosses_local') return json([{ npc_id: 5, zone_short: 'zone' }]);
    if (call.path === '/rpc/find_or_create_encounter') return json('enc-uuid-1');
    if (call.path === '/rpc/insert_ignore_duplicates') return json([]);
    if (call.path === '/raid_nights') return json([{ id: 'night-1' }]);
    if (call.path === '/contributions') return json([{ id: 'contrib-1' }]);
    if (call.path === '/encounter_combat_rollup') return json([{ id: 'r1' }]);
    if (call.path === '/encounters' && call.method === 'GET') return json([{ npc_healed_total: 0 }]);
    return json([]);
  });
  return { calls, fetchStub };
}

// A Sunday, Wednesday or Thursday night 21:00 ET, so linkEncounterToRaidNight does its work. One per run: the night id is
// cached per process and guild, which would hide the second run's traffic.
const NIGHTS = ['2026-10-26T01:00:00Z', '2026-10-29T01:00:00Z', '2026-10-30T01:00:00Z', '2026-10-23T01:00:00Z'];
let nightAt = 0;

async function runRecordParse(scoped) {
  return supabase.recordParse({
    bossInternalId: 'a_boss',
    parsed: { duration: 90, totalDamage: 1000, players: [{ name: 'Aldenmar' }] },
    timestampMs: Date.parse(NIGHTS[nightAt++ % NIGHTS.length]),
    contributorDiscordId: null,
    contributorCharacter: 'Aldenmar',
    uploadedByDiscordId: 'd1',
    rollupByChar: { Aldenmar: { by_skill: { crush: { hits: 1, dmg: 5 } }, total_hits: 1, total_damage: 5 }, Brackwyn: { total_hits: 2, total_damage: 9 } },
    timelineEvents: [{ at: '2026-10-29T01:01:00Z', kind: 'raid_event', subtype: 'enrage', label: 'Enrage' }],
    scoped,
  });
}

const ENV_KEYS = ['GUILD_RLS', 'SUPABASE_JWT_SIGNING_JWK', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_GUILD_ID'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.SUPABASE_URL = 'https://example.supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.SUPABASE_GUILD_ID = 'wolfpack';
  supabase._resetBreaker();
  supabase._resetScopedStats();
  supabase._resetIgnoreRpc();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const decode = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
const ignoreBody = (calls, table) => calls.filter((c) => c.path === '/rpc/insert_ignore_duplicates' && c.body.p_table === table);

describe('recordParse under a stubbed PostgREST: slice 2', () => {
  it('flag on: raid_nights, the rollup, encounter_events and both RPCs carry the guild token, and the rows the guild', async () => {
    const { calls, fetchStub } = fakeRest();
    vi.stubGlobal('fetch', fetchStub);
    await runRecordParse(guildScoped.scopedClient('acme', { jwk: JWK }));

    const scoped = calls.filter((c) => c.bearer !== SERVICE_KEY);
    for (const c of scoped) expect(decode(c.bearer)).toMatchObject({ role: 'guild_scoped', guild_id: 'acme' });
    const paths = scoped.map((c) => (c.path === '/rpc/insert_ignore_duplicates' ? `${c.path}:${c.body.p_table}` : c.path));
    expect(paths).toEqual(expect.arrayContaining([
      '/rpc/find_or_create_encounter', '/rpc/merge_encounter_players',
      '/rpc/insert_ignore_duplicates:raid_nights', '/raid_nights',
      '/encounter_combat_rollup', '/rpc/insert_ignore_duplicates:encounter_events',
    ]));

    expect(ignoreBody(calls, 'raid_nights')[0].body.p_rows[0].guild_id).toBe('acme');
    expect(calls.find((c) => c.path === '/raid_nights').query).toContain('guild_id=eq.acme');
    const rollup = calls.find((c) => c.path === '/encounter_combat_rollup');
    expect(rollup.body).toHaveLength(2);
    expect(rollup.body.every((r) => r.guild_id === 'acme')).toBe(true);
    expect(ignoreBody(calls, 'encounter_events')[0].body.p_rows.every((r) => r.guild_id === 'acme')).toBe(true);
    expect(calls.find((c) => c.path === '/rpc/find_or_create_encounter').body.p_guild_id).toBe('acme');

    // the night-id stamp on the encounter is a PATCH of a scoped table, so it is scoped too
    expect(scoped.some((c) => c.method === 'PATCH' && c.path === '/encounters' && /raid_night_id/.test(JSON.stringify(c.body)))).toBe(true);

    // not covered yet, still the service key
    const service = calls.filter((c) => c.bearer === SERVICE_KEY).map((c) => c.path);
    expect(service).toEqual(expect.arrayContaining(['/bosses_local', '/encounter_threat_snapshots']));
    expect(service).not.toContain('/encounter_combat_rollup');
    expect(service).not.toContain('/raid_nights');
    expect(service).not.toContain('/rpc/merge_encounter_players');
  });

  it('flag off: the same requests, in the same order, on the service key, with today\'s guild tag', async () => {
    const off = fakeRest();
    vi.stubGlobal('fetch', off.fetchStub);
    await runRecordParse(null);
    expect(off.calls.every((c) => c.bearer === SERVICE_KEY && c.apikey === SERVICE_KEY)).toBe(true);
    expect(ignoreBody(off.calls, 'raid_nights')[0].body.p_rows[0].guild_id).toBe('wolfpack');
    expect(off.calls.find((c) => c.path === '/encounter_combat_rollup').body.every((r) => r.guild_id === 'wolfpack')).toBe(true);
    expect(ignoreBody(off.calls, 'encounter_events')[0].body.p_rows.every((r) => r.guild_id === 'wolfpack')).toBe(true);
    expect(off.calls.find((c) => c.path === '/rpc/find_or_create_encounter').body.p_guild_id).toBe('wolfpack');
    // slice 2 must be on the path at all (a no-op would pass the checks above)
    expect(off.calls.map((c) => c.path)).toEqual(expect.arrayContaining(['/raid_nights', '/encounter_combat_rollup', '/rpc/merge_encounter_players']));

    // the flag-on run makes exactly the same requests (method + path + table), only the identity differs
    const on = fakeRest();
    vi.stubGlobal('fetch', on.fetchStub);
    await runRecordParse(guildScoped.scopedClient('wolfpack', { jwk: JWK }));
    const shape = (calls) => calls.map((c) => `${c.method} ${c.path}${c.body?.p_table ? ':' + c.body.p_table : ''}`);
    expect(shape(on.calls)).toEqual(shape(off.calls));
  });

  it('keeps the unscoped helpers\' signatures: a caller that passes no client gets today\'s tag', async () => {
    const { calls, fetchStub } = fakeRest();
    vi.stubGlobal('fetch', fetchStub);
    await supabase.upsertCombatRollup('enc-1', '1.0.0', { Aldenmar: { total_hits: 1 } });
    expect(calls[0]).toMatchObject({ bearer: SERVICE_KEY });
    expect(calls[0].body[0].guild_id).toBe('wolfpack');
  });
});

describe('utils/supabase.js source (comment-stripped)', () => {
  it('wraps each slice-2 call in _asGuild', () => {
    expect(SUPABASE_SRC).toMatch(/_asGuild\(scoped, \(\) => rpc\('find_or_create_encounter', params\)\)/);
    expect(SUPABASE_SRC).toMatch(/_asGuild\(scoped, \(\) => rpc\('merge_encounter_players'/);
    expect(SUPABASE_SRC).toMatch(/_asGuild\(scoped, \(\) => insertIgnoreDuplicates\('encounter_events'/);
    expect(SUPABASE_SRC).toMatch(/_asGuild\(scoped, \(\) => upsert\('encounter_combat_rollup'/);
    expect(SUPABASE_SRC).toMatch(/_asGuild\(scoped, \(\) => insertIgnoreDuplicates\('raid_nights'/);
    expect(SUPABASE_SRC).toMatch(/_asGuild\(scoped, \(\) => select\('raid_nights'/);
  });
});
