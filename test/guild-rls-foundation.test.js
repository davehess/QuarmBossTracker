// test/guild-rls-foundation.test.js — the foundation of per-request guild scoping (docs/DESIGN-raidmimic-hosted.md
// section 3 steps 5 and 6, section 9b; decisions-inbox 490).
//
// Four layers, each with its own kind of proof:
//   1. the migration, as comment-stripped TEXT (policies, helper, guards, nothing dropped); its behaviour was run against a
//      real Postgres 16 with the roles and tables stubbed (the report says so), which a unit test cannot repeat;
//   2. the token minter and the on/off factory, as BEHAVIOUR (decode the JWT, verify its signature, spy on the HMAC);
//   3. utils/supabase.js recordParse under a stubbed fetch: which requests carry the guild token and which keep the service
//      key, with the flag on and off;
//   4. the encounter handler: its head is EVALUATED with stubs (flag on / off), and its call sites are text-asserted over
//      comment-stripped source.
//
// Run: npx vitest run test/guild-rls-foundation.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readSource, ROOT, stripJs, stripSql } from './_source-slice.js';

const require = createRequire(import.meta.url);
const guildScoped = require('../utils/guildScoped.js');
const supabase = require('../utils/supabase.js');

// A throwaway P-256 key per run: the JWK the bot would receive in SUPABASE_JWT_SIGNING_JWK, and its public half to verify with.
const KP = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const JWK = JSON.stringify({ ...KP.privateKey.export({ format: 'jwk' }), kid: 'test-kid-1' });
const OTHER_JWK = JSON.stringify({ ...crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' }), kid: 'test-kid-2' });
const verifies = (token) => {
  const [h, b, s] = token.split('.');
  return crypto.verify('sha256', Buffer.from(`${h}.${b}`), { key: KP.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
};
const SERVICE_KEY = 'service-key-for-tests';

const MIGRATION = stripSql(readSource(path.join(ROOT, 'supabase', 'migrations', '20261031180000_guild_rls_foundation.sql')));
const INDEX = readSource(path.join(ROOT, 'index.js'));

function decode(token) {
  const [h, b, s] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString()),
    claims: JSON.parse(Buffer.from(b, 'base64url').toString()),
    sig: s, signed: `${h}.${b}`,
  };
}

const ENV_KEYS = ['GUILD_RLS', 'SUPABASE_JWT_SIGNING_JWK', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_GUILD_ID'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  guildScoped._resetWarned();
  guildScoped._resetStatus();
  supabase._resetBreaker();
  supabase._resetScopedStats();
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('migration 20261031180000_guild_rls_foundation.sql', () => {
  it('creates the NOLOGIN role guild_scoped behind an existence guard, and grants it to authenticator', () => {
    expect(MIGRATION).toMatch(/if not exists \(select 1 from pg_roles where rolname = 'guild_scoped'\)/);
    expect(MIGRATION).toMatch(/create role guild_scoped nologin/);
    expect(MIGRATION).toMatch(/grant guild_scoped to authenticator/);
    expect(MIGRATION).toMatch(/exists \(select 1 from pg_roles where rolname = 'authenticator'\)/);
  });

  it('defines app_guild_id() as a stable, security invoker reader of the JWT guild_id claim', () => {
    const fn = /create or replace function public\.app_guild_id\(\)[\s\S]*?\$\$;/.exec(MIGRATION)?.[0] || '';
    expect(fn).toMatch(/returns text/);
    expect(fn).toMatch(/\bstable\b/);
    expect(fn).toMatch(/security invoker/);
    expect(fn).toMatch(/request\.jwt\.claims/);
    expect(fn).toMatch(/->> 'guild_id'/);
    expect(fn).toMatch(/nullif\(current_setting\('request\.jwt\.claims', true\), ''\)/);   // an unset GUC is '', not valid json
  });

  it('puts a select/insert/update/delete policy on exactly encounters, encounter_players and contributions', () => {
    expect(MIGRATION).toMatch(/array\['encounters', 'encounter_players', 'contributions'\]/);
    expect(MIGRATION).toMatch(/array\['select', 'insert', 'update', 'delete'\]/);
    expect(MIGRATION).toMatch(/pol := t \|\| '_guild_scoped_' \|\| c/);
    const policies = MIGRATION.match(/create policy [^;]*;/g) || [];
    expect(policies.length).toBe(3);   // insert / update / select+delete branches of the loop
    for (const p of policies) {
      expect(p).toMatch(/to guild_scoped/);
      expect(p).toMatch(/guild_id = public\.app_guild_id\(\)/);
    }
    expect(policies.find((p) => /for insert/.test(p))).toMatch(/with check/);
    expect(policies.find((p) => /for update/.test(p))).toMatch(/using[\s\S]*with check/);
  });

  it('guards every policy create, so a re-run adds nothing', () => {
    const guard = /if not exists \(select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = pol\)/;
    expect(MIGRATION).toMatch(guard);
    expect(MIGRATION.indexOf('create policy')).toBeGreaterThan(MIGRATION.search(guard));
  });

  it('grants the scoped role the three tables and the claim reader, and no other table', () => {
    const grants = MIGRATION.match(/grant [^;]*;/gi) || [];
    const onTables = grants.filter((g) => /\bon public\.\w+/.test(g)).map((g) => /on public\.(\w+)/.exec(g)[1]).sort();
    expect(onTables).toEqual(['contributions', 'encounter_players', 'encounters']);
    expect(MIGRATION).toMatch(/grant execute on function public\.app_guild_id\(\) to guild_scoped/);
  });

  it('is additive: nothing is dropped, disabled, renamed, or granted to the existing roles', () => {
    expect(MIGRATION).not.toMatch(/\bdrop\b/i);
    expect(MIGRATION).not.toMatch(/\btruncate\b/i);
    expect(MIGRATION).not.toMatch(/disable row level security/i);
    expect(MIGRATION).not.toMatch(/\balter policy\b/i);
    expect(MIGRATION).not.toMatch(/\bto (anon|authenticated|service_role|public)\b/i);
    expect(MIGRATION).not.toMatch(/\bwith check \(true\)|using \(true\)/i);
    // DML on rows would change data; this file is schema only.
    expect(MIGRATION).not.toMatch(/^\s*(insert into|update public|delete from)\b/im);
  });
});

describe('mintToken', () => {
  it('signs an ES256 JWT (kid in the header) carrying role guild_scoped, the guild_id claim and a short expiry', () => {
    const now = 1_800_000_000_000;
    const token = guildScoped.mintToken('acme', { jwk: JWK, nowMs: now });
    const { header, claims, sig } = decode(token);
    expect(header).toEqual({ alg: 'ES256', kid: 'test-kid-1', typ: 'JWT' });
    expect(Buffer.from(sig, 'base64url')).toHaveLength(64);   // IEEE P1363: r || s, not DER
    expect(claims.role).toBe('guild_scoped');
    expect(claims.guild_id).toBe('acme');
    expect(claims.iat).toBe(now / 1000);
    expect(claims.exp - claims.iat).toBeGreaterThan(0);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(300);
    expect(verifies(token)).toBe(true);
    expect(verifies(token.replace(/\.[^.]+\./, `.${Buffer.from(JSON.stringify({ ...claims, guild_id: 'other' })).toString('base64url')}.`))).toBe(false);
  });

  it('never lives longer than five minutes, whatever ttl is asked', () => {
    const { claims } = decode(guildScoped.mintToken('acme', { jwk: JWK, ttlSec: 86_400 }));
    expect(claims.exp - claims.iat).toBe(300);
    expect(decode(guildScoped.mintToken('acme', { jwk: JWK, ttlSec: 0 })).claims.exp - claims.iat).toBeLessThanOrEqual(300);
  });

  it('does not verify under another key, and mints nothing without a key or a guild', () => {
    expect(verifies(guildScoped.mintToken('acme', { jwk: OTHER_JWK }))).toBe(false);
    expect(guildScoped.mintToken('acme', { jwk: '' })).toBeNull();
    expect(guildScoped.mintToken('', { jwk: JWK })).toBeNull();
  });

  it('refuses a bad JWK (not JSON, wrong curve, no kid, no private part) with one warning that never echoes the value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good = JSON.parse(JWK);
    const bads = ['{not json', JSON.stringify({ ...good, crv: 'P-384' }), JSON.stringify({ ...good, kid: '' }),
      JSON.stringify({ ...good, d: undefined }), JSON.stringify({ ...good, kty: 'RSA' })];
    for (const bad of bads) expect(guildScoped.mintToken('acme', { jwk: bad })).toBeNull();
    expect(warn.mock.calls.length).toBeGreaterThan(0);
    for (const c of warn.mock.calls) expect(String(c[0])).not.toContain(good.d);
    expect(guildScoped.mintToken('acme', { jwk: bads[0] })).toBeNull();
    expect(warn.mock.calls.length).toBeLessThanOrEqual(2);   // the not-JSON and the invalid-shape messages, once each
  });

  it('reads SUPABASE_JWT_SIGNING_JWK from the environment by default', () => {
    process.env.SUPABASE_JWT_SIGNING_JWK = JWK;
    expect(verifies(guildScoped.mintToken('acme'))).toBe(true);
  });
});

describe('forIdentity / scopedClient (the factory)', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://example.supabase.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    process.env.SUPABASE_GUILD_ID = 'wolfpack';
  });

  it('flag off: returns null and mints nothing (the unchanged path)', () => {
    process.env.SUPABASE_JWT_SIGNING_JWK = JWK;
    const hmac = vi.spyOn(crypto, 'sign');
    expect(guildScoped.forIdentity({ guild_id: 'acme' }, {})).toBeNull();
    expect(guildScoped.forIdentity({ guild_id: 'acme' }, { flag_guild_rls: 0 })).toBeNull();
    expect(guildScoped.forIdentity({ guild_id: 'acme' }, undefined)).toBeNull();
    expect(hmac).not.toHaveBeenCalled();
  });

  it('flag on via the env var or the tuning map, with a secret: a scoped client for the IDENTITY guild', () => {
    process.env.SUPABASE_JWT_SIGNING_JWK = JWK;
    process.env.GUILD_RLS = '1';
    const viaEnv = guildScoped.forIdentity({ guild_id: 'acme' }, {});
    expect(viaEnv).toMatchObject({ scoped: true, guildId: 'acme' });
    expect(decode(viaEnv.token).claims.guild_id).toBe('acme');
    delete process.env.GUILD_RLS;
    const viaTuning = guildScoped.forIdentity({ guild_id: 'acme' }, { flag_guild_rls: 1 });
    expect(viaTuning).toMatchObject({ scoped: true, guildId: 'acme' });
  });

  it('takes the guild from the identity, not from SUPABASE_GUILD_ID; the env tag is only the fallback', () => {
    process.env.SUPABASE_JWT_SIGNING_JWK = JWK;
    process.env.GUILD_RLS = '1';
    expect(guildScoped.forIdentity({ guild_id: 'acme' }, {}).guildId).toBe('acme');
    expect(guildScoped.forIdentity({ guild_id: null }, {}).guildId).toBe('wolfpack');
    expect(guildScoped.forIdentity({}, {}).guildId).toBe('wolfpack');
  });

  it('flag on but no secret: fails open to the unchanged path and says so once', () => {
    process.env.GUILD_RLS = '1';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(guildScoped.forIdentity({ guild_id: 'acme' }, {})).toBeNull();
    expect(guildScoped.forIdentity({ guild_id: 'acme' }, {})).toBeNull();
    expect(warn.mock.calls.filter((c) => /SUPABASE_JWT_SIGNING_JWK/.test(String(c[0])))).toHaveLength(1);
  });

  it('scopedClient without a secret returns the service-key facade (no token), with a secret a token', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(guildScoped.scopedClient('acme')).toEqual({ guildId: 'acme', scoped: false, token: null });
    expect(guildScoped.scopedClient('acme', { jwk: JWK })).toMatchObject({ scoped: true, guildId: 'acme' });
  });

  it('is off when Supabase itself is not configured', () => {
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_JWT_SIGNING_JWK = JWK;
    process.env.GUILD_RLS = '1';
    expect(guildScoped.forIdentity({ guild_id: 'acme' }, {})).toBeNull();
  });
});

// A fake PostgREST: routes by path, records every request's bearer and body.
function fakeRest({ rejectScoped = false } = {}) {
  const calls = [];
  const fetchStub = vi.fn(async (url, init = {}) => {
    const u = new URL(url);
    const bearer = String(init.headers?.Authorization || '').replace(/^Bearer /, '');
    const body = init.body ? JSON.parse(init.body) : null;
    const call = { method: init.method || 'GET', path: u.pathname.replace('/rest/v1', ''), query: u.search, bearer, apikey: init.headers?.apikey, body };
    calls.push(call);
    const json = (data, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(data), headers: { get: () => null } });
    if (rejectScoped && bearer !== SERVICE_KEY) return json({ message: 'JWSError' }, 401);
    if (call.path === '/bosses_local') return json([{ npc_id: 5, zone_short: 'zone' }]);
    if (call.path === '/rpc/find_or_create_encounter') return json('enc-uuid-1');
    if (call.path === '/eqemu_npc_types') return json([{ name: 'A_Boss' }]);
    if (call.path === '/contributions') return json([{ id: 'contrib-1' }]);
    if (call.path === '/encounters' && call.method === 'GET') return json([{ npc_healed_total: 0 }]);
    return json([]);
  });
  return { calls, fetchStub };
}

async function runRecordParse(scoped) {
  return supabase.recordParse({
    bossInternalId: 'a_boss',
    parsed: { duration: 90, totalDamage: 1000, players: [{ name: 'Aldenmar' }] },
    timestampMs: Date.parse('2026-10-26T16:00:00Z'),     // a Monday noon: not a raid night, so no raid_nights traffic
    contributorDiscordId: null,
    contributorCharacter: 'Aldenmar',
    uploadedByDiscordId: 'd1',
    npcHealedTotal: 100,
    scoped,
  });
}

describe('recordParse under a stubbed PostgREST', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://example.supabase.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    process.env.SUPABASE_GUILD_ID = 'wolfpack';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('flag off (scoped = null): every request carries the service key and no row names a guild', async () => {
    const { calls, fetchStub } = fakeRest();
    vi.stubGlobal('fetch', fetchStub);
    const out = await runRecordParse(null);
    expect(out).toMatchObject({ encounterId: 'enc-uuid-1', contributionId: 'contrib-1' });
    expect(calls.length).toBeGreaterThan(5);
    expect(calls.every((c) => c.bearer === SERVICE_KEY && c.apikey === SERVICE_KEY)).toBe(true);
    const contrib = calls.find((c) => c.path === '/contributions');
    expect(contrib.body[0]).not.toHaveProperty('guild_id');
    expect(calls.find((c) => c.path === '/rpc/find_or_create_encounter').body.p_guild_id).toBe('wolfpack');
  });

  it('flag on: contributions and encounters run under the guild token; every other table keeps the service key', async () => {
    const { calls, fetchStub } = fakeRest();
    vi.stubGlobal('fetch', fetchStub);
    const client = guildScoped.scopedClient('acme', { jwk: JWK });
    await runRecordParse(client);

    const scopedCalls = calls.filter((c) => c.bearer !== SERVICE_KEY);
    expect(scopedCalls.map((c) => `${c.method} ${c.path}`).sort()).toEqual([
      'GET /encounters', 'PATCH /encounters', 'PATCH /encounters', 'POST /contributions',
      'POST /rpc/find_or_create_encounter', 'POST /rpc/merge_encounter_players',   // slice 2 (test/guild-rls-slice2.test.js)
    ].sort());
    for (const c of scopedCalls) expect(decode(c.bearer).claims).toMatchObject({ role: 'guild_scoped', guild_id: 'acme' });

    // the rows name their guild (the column default is 'wolfpack', which RLS would refuse for another guild)
    expect(calls.find((c) => c.path === '/contributions').body[0].guild_id).toBe('acme');
    expect(calls.find((c) => c.path === '/rpc/find_or_create_encounter').body.p_guild_id).toBe('acme');

    // not yet covered, so still the service key: the catalog read and the snapshot claim
    const unscoped = calls.filter((c) => c.bearer === SERVICE_KEY).map((c) => c.path);
    expect(unscoped).toEqual(expect.arrayContaining(['/bosses_local', '/encounter_threat_snapshots']));
  });

  it('sends the anon key as the gateway apikey on a scoped request when the bot has one', async () => {
    process.env.SUPABASE_ANON_KEY = 'anon-key-for-tests';
    const { calls, fetchStub } = fakeRest();
    vi.stubGlobal('fetch', fetchStub);
    await runRecordParse(guildScoped.scopedClient('acme', { jwk: JWK }));
    expect(calls.filter((c) => c.bearer !== SERVICE_KEY).every((c) => c.apikey === 'anon-key-for-tests')).toBe(true);
    expect(calls.filter((c) => c.bearer === SERVICE_KEY).every((c) => c.apikey === SERVICE_KEY)).toBe(true);
  });

  it('a token the database rejects (401) is retried once with the service key, so a mis-set secret loses no parse', async () => {
    const { calls, fetchStub } = fakeRest({ rejectScoped: true });
    vi.stubGlobal('fetch', fetchStub);
    const out = await runRecordParse(guildScoped.scopedClient('acme', { jwk: OTHER_JWK }));
    expect(out).toMatchObject({ encounterId: 'enc-uuid-1', contributionId: 'contrib-1' });
    expect(supabase.scopedStats().rejected).toBe(6);
    const posts = calls.filter((c) => c.path === '/contributions');
    expect(posts.map((c) => c.bearer === SERVICE_KEY)).toEqual([false, true]);
  });

  it('a request made outside a scope is unaffected by one running at the same time', async () => {
    const { calls, fetchStub } = fakeRest();
    vi.stubGlobal('fetch', fetchStub);
    const client = guildScoped.scopedClient('acme', { jwk: JWK });
    await Promise.all([runRecordParse(client), supabase.select('bosses_local', 'internal_id=eq.x')]);
    expect(calls.filter((c) => c.path === '/bosses_local').every((c) => c.bearer === SERVICE_KEY)).toBe(true);
  });
});

describe('the encounter handler (POST /api/agent/encounter)', () => {
  const START = INDEX.indexOf('async function _handleAgentUpload(req, res) {');
  const END = INDEX.indexOf('\n}\n', START) + 3;   // the handler's own closing brace, at column 0
  if (START < 0 || END < START) throw new Error('guild-rls: _handleAgentUpload markers not found');
  const HANDLER = INDEX.slice(START, END);
  const HEAD_END = HANDLER.indexOf('// Read body');
  if (HEAD_END < 0) throw new Error('guild-rls: handler head marker not found');
  const HEAD = HANDLER.slice(HANDLER.indexOf('{') + 1, HEAD_END);

  // The handler's opening, EVALUATED around stubs: auth, then the scoping decision. Returns what recordParse would receive.
  function runHead({ identity, tune }) {
    const factory = new Function('mimicLink', 'guildScoped', '_overlayTuningMap', 'req', 'res',
      `return (async () => {${HEAD}\nreturn { identity, guildDb };})();`);
    return factory({ requireAgentAuth: async () => identity }, guildScoped, async () => tune, {}, {});
  }

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://example.supabase.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    process.env.SUPABASE_GUILD_ID = 'wolfpack';
    process.env.SUPABASE_JWT_SIGNING_JWK = JWK;
  });

  it('flag on: the scoped client is built from the SESSION guild, not SUPABASE_GUILD_ID', async () => {
    const out = await runHead({ identity: { discord_id: 'd1', guild_id: 'acme' }, tune: { flag_guild_rls: 1 } });
    expect(out.guildDb).toMatchObject({ scoped: true, guildId: 'acme' });
    expect(decode(out.guildDb.token).claims.guild_id).toBe('acme');
  });

  it('flag off: no scoped client is created and nothing is minted (today\'s path)', async () => {
    const hmac = vi.spyOn(crypto, 'sign');
    const out = await runHead({ identity: { discord_id: 'd1', guild_id: 'acme' }, tune: {} });
    expect(out.guildDb).toBeNull();
    expect(hmac).not.toHaveBeenCalled();
  });

  it('a failed tuning read leaves the handler on today\'s path rather than failing the upload', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const factory = new Function('mimicLink', 'guildScoped', '_overlayTuningMap', 'req', 'res',
      `return (async () => {${HEAD}\nreturn { guildDb };})();`);
    const out = await factory({ requireAgentAuth: async () => ({ discord_id: 'd1' }) }, guildScoped,
      async () => { throw new Error('tuning store down'); }, {}, {});
    expect(out.guildDb).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('hands the client to recordParse and to the ended_at write, and to nothing else in the handler', () => {
    const code = stripJs(HANDLER);
    expect(code).toMatch(/guildScoped\.forIdentity\(identity, await _overlayTuningMap\(\)\)/);
    expect(code).toMatch(/supabase\.recordParse\(\{[\s\S]*?scoped: guildDb,[\s\S]*?\}\)\.catch/);
    expect(code).toMatch(/guildScoped\.run\(guildDb, \(\) => supabase\.update\('encounters'/);
    // let, assignment, scoped:, run, and the hub gate's null check (a hub session waits without a client: test/mimic-link-hub.test.js)
    expect(code.match(/guildDb/g).length).toBe(5);
    expect(code).toMatch(/if \(identity\.hub_guild && !guildDb\) \{/);
    // the guild is never taken from the process tag on this path
    expect(code.slice(code.indexOf('guildScoped.forIdentity'), code.indexOf('guildScoped.forIdentity') + 120)).not.toMatch(/SUPABASE_GUILD_ID/);
  });

  it('the session identity carries the guild (mimic_sessions.guild_id) in all three shapes', () => {
    const link = stripJs(readSource(path.join(ROOT, 'utils', 'mimicLink.js')));
    expect(link.match(/guild_id:\s+row\.guild_id \|\| null/g)).toHaveLength(3);
  });
});
