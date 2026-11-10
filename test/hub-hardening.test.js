// test/hub-hardening.test.js — security hardening of the open guild registry (2026-11-10):
//   1. a Discord server is bound to a guild only for a person who manages it (owner or MANAGE_GUILD), proven by a signed
//      cookie the sign-in that read their server list writes (web/lib/hubManage.ts, web/lib/discord.ts, openSignIn.ts);
//   2. invite-code guessing is capped in the database: 8 failed tries per player and 20 per address in ten minutes,
//      only failures are recorded, and new codes are eight characters (web/app/guilds/actions.ts);
//   3. the one-day prune for hub_invite_attempts is in the bot's midnight chain, and the migration is server-only.
// Action code is EVALUATED against fakes; source-text assertions run over comment-stripped source.
//
// Run: npx vitest run test/hub-hardening.test.js

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import { managesServer, fetchManagedGuildIds } from '../web/lib/discord.ts';
import { signManageProof, readManageProof, managesDiscordServer, MANAGE_TTL_MS, MANAGE_MESSAGES } from '../web/lib/hubManage.ts';
import { countsAsFailedAttempt, INVITE_ATTEMPTS_PER_PLAYER, INVITE_ATTEMPTS_PER_IP, INVITE_ATTEMPT_WINDOW_MS, signInScopes } from '../web/lib/hubRegistry.ts';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const webRequire = createRequire(path.join(ROOT, 'web/package.json'));
function mockBoth(id, factory) {
  vi.doMock(id, factory);
  try { vi.doMock(webRequire.resolve(id), factory); } catch { /* not installed here */ }
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

const KEY = 'test-service-key';
const SERVER = '1168893924329402420';

// ── 1. Ownership of a Discord server ────────────────────────────────────────────────────────────────────────────
describe('who manages a Discord server', () => {
  it('the server owner passes', () => { expect(managesServer({ owner: true, permissions: '0' })).toBe(true); });
  it('MANAGE_GUILD (0x20) passes, including inside a large bitfield', () => {
    expect(managesServer({ owner: false, permissions: '32' })).toBe(true);
    expect(managesServer({ owner: false, permissions: '2147483647' })).toBe(true);
    expect(managesServer({ permissions: '1099511627776' })).toBe(false);   // a high bit only
    expect(managesServer({ permissions: '4398046511136' })).toBe(true);    // 2^42 + 0x20
    expect(managesServer({ permissions: '4398046511135' })).toBe(false);   // 2^42 + 0x1f: one bit short
  });
  it('a plain member is refused', () => {
    expect(managesServer({ owner: false, permissions: '104324673' })).toBe(false);   // a typical member bitfield: no 0x20
    expect(managesServer({ owner: false, permissions: '0' })).toBe(false);
  });
  it('missing, malformed or non-string permissions are refused', () => {
    for (const p of [undefined, null, 32, '', 'abc', '0x20', '-32', '3'.repeat(40)]) expect(managesServer({ owner: false, permissions: p }), String(p)).toBe(false);
    expect(managesServer({ owner: 'true', permissions: '0' })).toBe(false);   // only a real boolean true is an owner
  });

  it('fetchManagedGuildIds keeps only owned / managed servers from Discord’s list', async () => {
    vi.stubGlobal('fetch', async () => ({
      status: 200, ok: true,
      json: async () => [
        { id: '1', owner: true, permissions: '0' },
        { id: '2', owner: false, permissions: '32' },
        { id: '3', owner: false, permissions: '104324673' },
      ],
    }));
    expect(await fetchManagedGuildIds('tok')).toEqual(['1', '2']);
  });
  it('a refused token gives null, never an empty "you manage nothing"', async () => {
    vi.stubGlobal('fetch', async () => ({ status: 401, ok: false, json: async () => ({}) }));
    expect(await fetchManagedGuildIds('tok')).toBeNull();
  });
});

describe('the signed proof (web/lib/hubManage.ts)', () => {
  it('round-trips for the same person and lists their servers', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', KEY);
    const c = signManageProof('d-1', [SERVER, '42']);
    expect(readManageProof(c, 'd-1')).toEqual([SERVER, '42']);
    expect(managesDiscordServer(c, 'd-1', SERVER)).toBe(true);
    expect(managesDiscordServer(c, 'd-1', '999')).toBe(false);      // a fresh list that does not hold the server: refused
  });
  it('is refused for someone else, after 15 minutes, when tampered with, and when the key differs', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', KEY);
    const now = Date.now();
    const c = signManageProof('d-1', [SERVER], now);
    expect(managesDiscordServer(c, 'd-2', SERVER, now)).toBeNull();
    expect(managesDiscordServer(c, 'd-1', SERVER, now + MANAGE_TTL_MS + 1)).toBeNull();
    const [body, sig] = c.split('.');
    const forged = Buffer.from(JSON.stringify({ d: 'd-1', s: ['999'], x: now + 60_000 })).toString('base64url');
    expect(managesDiscordServer(`${forged}.${sig}`, 'd-1', '999', now)).toBeNull();
    expect(managesDiscordServer(`${body}.${sig.slice(0, -2)}xx`, 'd-1', SERVER, now)).toBeNull();
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'another-key');
    expect(managesDiscordServer(c, 'd-1', SERVER, now)).toBeNull();
  });
  it('nothing is signed or accepted without a server key, and garbage is just "no proof"', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(signManageProof('d-1', [SERVER])).toBeNull();
    for (const bad of [undefined, null, '', 'x', '.', 'a.b', '{"d":"d-1"}']) expect(readManageProof(bad, 'd-1'), String(bad)).toBeNull();
  });
  it('the "Confirm my server" flow asks Discord for the server list on a raidmimic host', () => {
    expect(signInScopes('raidmimic.com', 'manage')).toBe('identify guilds');
    expect(signInScopes('raidmimic.com')).toBe('identify');
  });
});

describe('createGuild binds a Discord server only with a valid proof', () => {
  let cookie, calls;
  async function load() {
    vi.resetModules();
    calls = [];
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', KEY);
    mockBoth('next/cache', () => ({ revalidatePath() {} }));
    mockBoth('next/navigation', () => ({ redirect: () => { throw new Error('NEXT_REDIRECT'); } }));
    mockBoth('next/headers', () => ({ cookies: () => ({ get: (n) => (n === 'rm_manage' && cookie ? { value: cookie } : undefined) }) }));
    vi.doMock('@/lib/supabase-server', () => ({ supabaseServer: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1', app_metadata: { provider_id: 'd-1' }, user_metadata: {} } } }) } }) }));
    // Any database touch means the refusal came too late.
    vi.doMock('@/lib/supabase', () => ({ supabaseAdmin: () => { calls.push('admin'); throw new Error('database reached'); } }));
    vi.doMock('@/lib/lockout', async () => await import('../web/lib/lockout.ts'));
    vi.doMock('@/lib/hubRegistry', async () => await import('../web/lib/hubRegistry.ts'));
    vi.doMock('@/lib/hubGuilds', async () => await import('../web/lib/hubGuilds.ts'));
    vi.doMock('@/lib/hubManage', async () => await import('../web/lib/hubManage.ts'));
    return (await import('../web/app/guilds/new/actions.ts')).createGuild;
  }
  const input = { displayName: 'Brackwyn Raiders', slug: 'brackwyn-raiders', discordGuildId: SERVER, openJoin: true };

  it('no proof at all: refused with the re-sign-in message and the confirm flag; the database is not touched', async () => {
    cookie = undefined;
    const create = await load();
    expect(await create(input)).toEqual({ ok: false, confirmServer: true, errors: { discordGuildId: 'Sign in again to confirm you manage this server.' } });
    expect(calls).toEqual([]);
  });
  it('an expired or someone else’s proof is the same as none', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', KEY);
    cookie = signManageProof('d-1', [SERVER], Date.now() - MANAGE_TTL_MS - 5);
    let create = await load();
    expect((await create(input)).confirmServer).toBe(true);
    cookie = signManageProof('d-someone-else', [SERVER]);
    create = await load();
    expect((await create(input)).confirmServer).toBe(true);
    expect(calls).toEqual([]);
  });
  it('a fresh proof that does not list the server (plain member, or not in the list): refused, no re-sign-in loop', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', KEY);
    cookie = signManageProof('d-1', ['111111111', '222222222']);
    const create = await load();
    expect(await create(input)).toEqual({ ok: false, errors: { discordGuildId: MANAGE_MESSAGES.notManager } });
    expect(calls).toEqual([]);
  });
  it('a client-sent flag changes nothing: the input has no field the server reads for ownership', async () => {
    cookie = undefined;
    const create = await load();
    const r = await create({ ...input, isOwner: true, owner: true, confirmed: true });
    expect(r.confirmServer).toBe(true);
  });
  it('a guild with no Discord server needs no proof (the database is reached)', async () => {
    cookie = undefined;
    const create = await load();
    await expect(create({ ...input, discordGuildId: '' })).rejects.toThrow('database reached');
  });
  it('the proof check comes before any database write in the source', () => {
    const src = stripJs(read('web/app/guilds/new/actions.ts'));
    expect(src.indexOf('managesDiscordServer(')).toBeGreaterThan(0);
    expect(src.indexOf('managesDiscordServer(')).toBeLessThan(src.indexOf('supabaseAdmin()'));
  });
  it('the sign-in writes the cookie HttpOnly, Secure and scoped to /guilds, and never stores the list', () => {
    const src = stripJs(read('web/lib/openSignIn.ts'));
    expect(src).toMatch(/httpOnly: true, secure: true, sameSite: 'lax', path: '\/guilds'/);
    expect(src).toMatch(/FLOW_MANAGE/);
  });
});

// ── 2. Invite-code guessing ─────────────────────────────────────────────────────────────────────────────────────
describe('redeemInvite counts failed attempts in the database', () => {
  const limits = { player: INVITE_ATTEMPTS_PER_PLAYER, ip: INVITE_ATTEMPTS_PER_IP };
  let tables, inserts, failCount, ip;

  // Just enough of supabase-js for the redeem path: upsert/select/eq/gte/is/insert/update + count heads.
  function fakeAdmin() {
    return {
      from(name) {
        const q = { filters: [], head: false, op: 'select', payload: null };
        const rows = () => (tables[name] ?? []).filter(r => q.filters.every(f => f(r)));
        const run = () => {
          if (q.op === 'insert') { inserts.push({ table: name, row: q.payload }); (tables[name] ??= []).push({ ...q.payload, at: new Date().toISOString() }); return { data: null, error: null }; }
          if (q.op === 'upsert') return name === 'hub_players' ? { data: { player_id: 'p1' }, error: null } : { data: null, error: null };
          if (q.op === 'update') { const hit = rows(); hit.forEach(r => Object.assign(r, q.payload)); return { data: hit.map(r => ({ code: r.code })), error: null }; }
          if (q.head) return failCount ? { count: null, error: { message: 'down' } } : { count: rows().length, error: null };
          return { data: rows()[0] ?? null, error: null };
        };
        const b = {
          select(_c, o) { q.head = !!o?.head; return b; },
          update(p) { q.op = 'update'; q.payload = p; return b; },
          upsert(p) { q.op = 'upsert'; q.payload = p; return b; },
          insert(p) { q.op = 'insert'; q.payload = p; return b; },
          eq(c, v) { q.filters.push(r => r[c] === v); return b; },
          gte(c, v) { q.filters.push(r => r[c] >= v); return b; },
          single() { return Promise.resolve(run()); },
          maybeSingle() { return Promise.resolve(run()); },
          then(res, rej) { return Promise.resolve(run()).then(res, rej); },
        };
        return b;
      },
    };
  }

  async function load() {
    vi.resetModules();
    inserts = []; failCount = false;
    vi.stubEnv('ANON_FEEDBACK_SALT', 'salt-for-test');
    mockBoth('next/cache', () => ({ revalidatePath() {} }));
    mockBoth('next/headers', () => ({ headers: () => ({ get: (n) => (n === 'x-forwarded-for' ? ip : null) }) }));
    vi.doMock('@/lib/supabase-server', () => ({ supabaseServer: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1', app_metadata: { provider_id: 'd-1' }, user_metadata: {} } } }) } }) }));
    vi.doMock('@/lib/supabase', () => ({ supabaseAdmin: () => fakeAdmin() }));
    vi.doMock('@/lib/lockout', async () => await import('../web/lib/lockout.ts'));
    vi.doMock('@/lib/hubRegistry', async () => await import('../web/lib/hubRegistry.ts'));
    // a fresh in-memory limiter per load, wide open, so the database layer is what these cases exercise
    vi.doMock('@/lib/popRecitalSave', () => ({ makeLimiter: () => () => true }));
    return (await import('../web/app/guilds/actions.ts')).redeemInvite;
  }
  const attempt = (player_id, ip_hash, ago = 0) => ({ player_id, ip_hash, at: new Date(Date.now() - ago).toISOString() });

  it('the numbers: 8 per player, 20 per address, ten minutes', () => {
    expect(limits).toEqual({ player: 8, ip: 20 });
    expect(INVITE_ATTEMPT_WINDOW_MS).toBe(600_000);
  });

  it('a wrong code is recorded with the player and an HMAC of the address (never the address)', async () => {
    ip = '203.0.113.9'; tables = { hub_invites: [], hub_invite_attempts: [] };
    const redeem = await load();
    const r = await redeem('ZZZZZZZZ');
    expect(r.ok).toBe(false);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('hub_invite_attempts');
    expect(inserts[0].row.player_id).toBe('p1');
    expect(inserts[0].row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(inserts)).not.toContain('203.0.113.9');
    expect(JSON.stringify(inserts)).not.toContain('ZZZZZZZZ');   // the guess itself is not kept either
  });
  it('a malformed code is a failed attempt too (it is what a guesser sends)', async () => {
    ip = '198.51.100.1'; tables = { hub_invites: [], hub_invite_attempts: [] };
    const redeem = await load();
    await redeem('not a code');
    expect(inserts).toHaveLength(1);
  });
  it('the ninth try in ten minutes by one player is refused without reading the code, and records nothing', async () => {
    ip = '198.51.100.2'; tables = { hub_invites: [], hub_invite_attempts: Array.from({ length: 8 }, () => attempt('p1', 'other')) };
    const redeem = await load();
    expect(await redeem('ZZZZZZZZ')).toEqual({ ok: false, message: 'Too many tries. Wait a few minutes and try again.' });
    expect(inserts).toEqual([]);
  });
  it('the seventh failure still gets the normal answer', async () => {
    ip = '198.51.100.3'; tables = { hub_invites: [], hub_invite_attempts: Array.from({ length: 7 }, () => attempt('p1', 'other')) };
    const redeem = await load();
    expect((await redeem('ZZZZZZZZ')).message).toMatch(/No guild has that invite code/);
  });
  it('twenty failures from one address (many players) refuse a new player at that address', async () => {
    ip = '198.51.100.4'; tables = { hub_invites: [] };
    const redeem0 = await load();
    // the hash the action computes for this address
    await redeem0('ZZZZZZZZ');
    const hash = inserts[0].row.ip_hash;
    tables = { hub_invites: [], hub_invite_attempts: Array.from({ length: 20 }, (_, i) => attempt(`px${i}`, hash)) };
    const redeem = await load();
    expect(await redeem('ZZZZZZZZ')).toEqual({ ok: false, message: 'Too many tries. Wait a few minutes and try again.' });
    tables = { hub_invites: [], hub_invite_attempts: Array.from({ length: 19 }, (_, i) => attempt(`px${i}`, hash)) };
    const again = await load();
    expect((await again('ZZZZZZZZ')).message).toMatch(/No guild has that invite code/);
  });
  it('attempts older than ten minutes do not count', async () => {
    ip = '198.51.100.5'; tables = { hub_invites: [], hub_invite_attempts: Array.from({ length: 30 }, () => attempt('p1', 'other', 11 * 60_000)) };
    const redeem = await load();
    expect((await redeem('ZZZZZZZZ')).message).toMatch(/No guild has that invite code/);
  });
  it('a count that cannot be read refuses (fail closed) and writes nothing', async () => {
    ip = '198.51.100.6'; tables = { hub_invites: [], hub_invite_attempts: [] };
    const redeem = await load();
    failCount = true;
    expect(await redeem('ZZZZZZZZ')).toEqual({ ok: false, message: 'Could not join just now. Try again in a minute.' });
    expect(inserts).toEqual([]);
  });
  it('a successful redeem records nothing', async () => {
    ip = '198.51.100.7';
    tables = { hub_invites: [], hub_invite_attempts: [] };
    const redeem = await load();
    // wire a valid code through the real rules: the fake serves the invite, the guild and no membership
    tables.hub_invites.push({ code: 'K7M2QP4X', guild_id: 'alpha', expires_at: new Date(Date.now() + 3600_000).toISOString(), max_uses: 25, uses: 0 });
    tables.hub_guilds = [{ guild_id: 'alpha', display_name: 'Alpha', suspended_at: null }];
    tables.hub_memberships = [];
    expect(await redeem('k7m2-qp4x')).toEqual({ ok: true, message: 'You joined Alpha.' });
    expect(inserts.filter(i => i.table === 'hub_invite_attempts')).toEqual([]);
    expect(tables.hub_invite_attempts).toEqual([]);
  });
  it('which answers count as a guess: everything but our own fault and a lost race', () => {
    for (const r of ['bad_code', 'unknown', 'expired', 'used_up', 'suspended', 'already']) expect(countsAsFailedAttempt(r), r).toBe(true);
    for (const r of ['error', 'busy']) expect(countsAsFailedAttempt(r), r).toBe(false);
  });
  it('the in-memory limiter stays as the first, cheap layer, ahead of any database read', () => {
    const src = stripJs(read('web/app/guilds/actions.ts'));
    expect(src).toMatch(/makeLimiter\(INVITE_ATTEMPTS_PER_PLAYER, INVITE_ATTEMPT_WINDOW_MS\)/);
    expect(src.indexOf('attemptAllowed(discordId)')).toBeLessThan(src.indexOf('hub_invite_attempts'));
  });
});

// ── 3. The migration and the prune ──────────────────────────────────────────────────────────────────────────────
describe('hub_invite_attempts migration and prune', () => {
  const sql = stripSql(read('supabase/migrations/20261110140000_hub_invite_attempts.sql'));
  it('is idempotent, indexed both ways, and server-only (RLS on, no policy)', () => {
    expect(sql).toMatch(/create table if not exists hub_invite_attempts/);
    expect(sql).toMatch(/create index if not exists \w+\s+on hub_invite_attempts \(player_id, at\)/);
    expect(sql).toMatch(/create index if not exists \w+\s+on hub_invite_attempts \(ip_hash, at\)/);
    expect(sql).toMatch(/alter table hub_invite_attempts enable row level security/);
    expect(sql).not.toMatch(/create policy/i);
  });
  it('widens the code constraint to six or eight characters, replacing the old one', () => {
    expect(sql).toMatch(/drop constraint if exists hub_invites_code_check/);
    expect(sql).toContain('^([A-HJKMNP-Z2-9]{6}|[A-HJKMNP-Z2-9]{8})$');
  });
  it('the bot’s midnight chain deletes rows older than a day and logs one stdout line', () => {
    const idx = stripJs(read('index.js'));
    expect(idx).toMatch(/supabase\.del\('hub_invite_attempts', `at=lt\.\$\{encodeURIComponent\(cutoff\)\}`\)/);
    expect(idx).toMatch(/console\.log\('\[midnight\] swept hub_invite_attempts older than 1 day'\)/);
  });
});
