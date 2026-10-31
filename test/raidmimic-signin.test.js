// test/raidmimic-signin.test.js — raidmimic.com is a sign-in first, then "your guilds" (the guild lead, 2026-10-31,
// DECISIONS §492). Pins what the open path changes and, as important, what it leaves alone:
//   - the middleware lets /auth/*, /api/auth/* and /guilds through on a raidmimic host (and only those), through the
//     normal session flow, while every other path still lands on the landing page and eqmimic.quest is untouched;
//   - the sign-in callback RUNS the real route: a raidmimic host takes the open path (no Wolf Pack member lookup, no role
//     gate, hub_players upserted, redirect to /guilds), wolfpack.quest takes today's gated path (fetchGuildMember, the role
//     gate, wolfpack_members) and never touches a hub table;
//   - scopes follow the host: identify on raidmimic, `identify guilds` only on the optional second consent, Wolf Pack's
//     own pair on wolfpack.quest;
//   - "Find my guilds" (?flow=guilds) writes only the matched guild ids and never the token or the rest of the list;
//   - the invite rules (expired, used up, unknown, suspended, already in, the race for the last use) and the action's
//     rate limit, against an in-memory database;
//   - the registry migration is idempotent text, and the /guilds page reads only the signed-in player's own rows.
//
// Route and action code is EVALUATED (real source, stubbed collaborators); source-text assertions run over comment-stripped
// source (CLAUDE.md "comments satisfy text assertions").
//
// Run: npx vitest run test/raidmimic-signin.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import {
  isRaidmimicHost, isRaidmimicOrigin, isRaidmimicOpenPath, RAIDMIMIC_HOSTS,
} from '../web/lib/raidmimicHost.ts';
import {
  signInScopes, SCOPES_WOLFPACK, SCOPES_OPEN, SCOPES_FIND_GUILDS, openNext, matchRegisteredGuilds, splitMatchesByOpenJoin, closedMatchesFor,
  normaliseInviteCode, redeemInviteCode, profileOf, INVITE_CODE_RX,
} from '../web/lib/hubRegistry.ts';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel) => stripJs(read(rel));
const webRequire = createRequire(path.join(ROOT, 'web/package.json'));

// Register a mock under the bare id AND the path it resolves to on a machine with web/ installed (CI has only the root).
function mockBoth(id, factory) {
  vi.doMock(id, factory);
  try { vi.doMock(webRequire.resolve(id), factory); } catch { /* not installed here */ }
}

// ── An in-memory stand-in for the slice of supabase-js these paths use ──────────────────────────────────────────
// A table set to null models "relation does not exist" (the registry migration not applied).
function memDb(tables = {}) {
  const writes = [];
  const touched = new Set();
  let n = 0;
  return {
    tables, writes, touched,
    from(name) {
      touched.add(name);
      const q = { op: 'select', filters: [], payload: null, opts: null, returning: false, single: null };
      const rows = () => (tables[name] ??= []);
      const run = () => {
        if (tables[name] === null) return { data: null, error: { message: `relation "${name}" does not exist` } };
        const hit = (r) => q.filters.every(f => f(r));
        let out = [];
        if (q.op === 'select') out = rows().filter(hit);
        else if (q.op === 'update') {
          out = rows().filter(hit);
          out.forEach(r => Object.assign(r, q.payload));
          writes.push({ table: name, op: 'update', payload: JSON.parse(JSON.stringify(q.payload)) });
        } else if (q.op === 'upsert') {
          const keys = String(q.opts?.onConflict ?? '').split(',').filter(Boolean);
          const list = Array.isArray(q.payload) ? q.payload : [q.payload];
          writes.push({ table: name, op: 'upsert', payload: JSON.parse(JSON.stringify(q.payload)), opts: q.opts });
          for (const row of list) {
            const at = keys.length ? rows().find(r => keys.every(k => r[k] === row[k])) : null;
            if (at) { if (!q.opts?.ignoreDuplicates) Object.assign(at, row); out.push(at); }
            else { const r = { ...(name === 'hub_players' ? { player_id: `p${++n}` } : {}), ...row }; rows().push(r); out.push(r); }
          }
        }
        if (q.single === 'one') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: 'expected one row' } };
        if (q.single === 'maybe') return { data: out[0] ?? null, error: null };
        return { data: q.op === 'select' || q.returning ? out.map(r => ({ ...r })) : null, error: null };
      };
      const b = {
        select() { if (q.op !== 'select') q.returning = true; return b; },
        eq(c, v) { q.filters.push(r => r[c] === v); return b; },
        is(c, v) { q.filters.push(r => (v === null ? r[c] == null : r[c] === v)); return b; },
        not(c, op, v) { q.filters.push(r => !(op === 'is' && v === null ? r[c] == null : r[c] === v)); return b; },
        in(c, arr) { q.filters.push(r => arr.includes(r[c])); return b; },
        limit() { return b; },
        upsert(p, o) { q.op = 'upsert'; q.payload = p; q.opts = o; return b; },
        update(p) { q.op = 'update'; q.payload = p; return b; },
        single() { q.single = 'one'; return Promise.resolve(run()); },
        maybeSingle() { q.single = 'maybe'; return Promise.resolve(run()); },
        then(res, rej) { return Promise.resolve(run()).then(res, rej); },
      };
      return b;
    },
  };
}

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

// ── 1. The pure rules ───────────────────────────────────────────────────────────────────────────────────────────
describe('which paths a raidmimic host lets through', () => {
  it.each(['/auth/signin', '/auth/callback', '/auth/paused', '/auth/mimic-link', '/api/auth/anything', '/guilds', '/guilds/x'])('%s is open', (p) => {
    expect(isRaidmimicOpenPath(p)).toBe(true);
  });
  it.each(['/', '/setup', '/feedback', '/me', '/admin', '/api/agent/chat', '/api/authx', '/authx/y', '/guildsx', '/raidmimic/setup', '/GUILDS'])('%s is not', (p) => {
    expect(isRaidmimicOpenPath(p)).toBe(false);
  });
  it('isRaidmimicOrigin reads the scheme://host the callback has, and only raidmimic hosts', () => {
    for (const h of RAIDMIMIC_HOSTS) expect(isRaidmimicOrigin(`https://${h}`)).toBe(true);
    expect(isRaidmimicOrigin('https://RAIDMIMIC.com:443')).toBe(true);
    for (const o of ['https://wolfpack.quest', 'https://b.wolfpack.quest', 'http://localhost:3000', 'https://eqmimic.quest', '', null, undefined, 'not a url']) {
      expect(isRaidmimicOrigin(o), String(o)).toBe(false);
    }
  });
});

describe('scopes follow the host', () => {
  it('raidmimic: identify alone; the second consent adds guilds', () => {
    for (const h of RAIDMIMIC_HOSTS) {
      expect(signInScopes(h)).toBe('identify');
      expect(signInScopes(h, 'guilds')).toBe('identify guilds');
    }
    expect(SCOPES_OPEN).toBe('identify');
    expect(SCOPES_FIND_GUILDS).toBe('identify guilds');
  });
  it('wolfpack.quest, its beta mirror and localhost keep exactly the scopes they always asked for, flow or not', () => {
    for (const h of ['wolfpack.quest', 'b.wolfpack.quest', 'localhost:3000']) {
      expect(signInScopes(h)).toBe('identify guilds.members.read');
      expect(signInScopes(h, 'guilds')).toBe('identify guilds.members.read');
    }
    expect(SCOPES_WOLFPACK).toBe('identify guilds.members.read');
  });
  it('the sign-in button asks for them by host and carries the flow to the callback', () => {
    const btn = code('web/components/SignInButton.tsx');
    expect(btn).toMatch(/scopes: signInScopes\(window\.location\.host, flow\)/);
    expect(btn).toMatch(/\$\{flow \? `&flow=\$\{encodeURIComponent\(flow\)\}` : ''\}/);
    expect(btn).not.toMatch(/'identify guilds\.members\.read'/);   // the literal lives in one place (hubRegistry)
  });
  it('/ becomes /guilds on the open path only, and any other page the caller asked for is kept', () => {
    expect(openNext('/')).toBe('/guilds');
    expect(openNext('/auth/mimic-link?code=K7M2QP')).toBe('/auth/mimic-link?code=K7M2QP');
    expect(openNext('/guilds')).toBe('/guilds');
  });
});

describe('profileOf (what identify already put in the session)', () => {
  it('prefers the global name, then the full name; takes an https avatar only', () => {
    expect(profileOf({ user_metadata: { custom_claims: { global_name: 'Aldenmar' }, full_name: 'ald#0', avatar_url: 'https://cdn.discordapp.com/a.png' } }))
      .toEqual({ displayName: 'Aldenmar', avatarUrl: 'https://cdn.discordapp.com/a.png' });
    expect(profileOf({ user_metadata: { full_name: 'Brackwyn', avatar_url: 'javascript:alert(1)' } })).toEqual({ displayName: 'Brackwyn', avatarUrl: null });
    expect(profileOf(null)).toEqual({ displayName: null, avatarUrl: null });
  });
});

describe('splitMatchesByOpenJoin', () => {
  const registry = [
    { guild_id: 'open-a', discord_guild_id: '1', open_join: true }, { guild_id: 'shut-b', discord_guild_id: '2', open_join: false },
    { guild_id: 'unk-c', discord_guild_id: '3', open_join: null }, { guild_id: 'none-d', discord_guild_id: '4' },
    { guild_id: 'str-e', discord_guild_id: '5', open_join: 'true' },
  ];
  it('open_join strictly true is open; false, null, missing and any other value are closed', () => {
    expect(splitMatchesByOpenJoin(['1', '2', '3', '4', '5', '9'], registry)).toEqual({ open: ['open-a'], closed: ['shut-b', 'unk-c', 'none-d', 'str-e'] });
  });
  it('no match, no lists', () => {
    expect(splitMatchesByOpenJoin(['9'], registry)).toEqual({ open: [], closed: [] });
  });
});

describe('closedMatchesFor (the "Guilds you’re in on Discord" list)', () => {
  const rows = [{ guild_id: 'closed-one', display_name: 'Closed One' }, { guild_id: 'aaa-guild', display_name: 'Aaa Guild' }];
  const reader = (calls = []) => async (slugs) => { calls.push(slugs); return rows; };
  it('names the closed guilds the redirect carried, sorted by name', async () => {
    expect(await closedMatchesFor('closed-one,aaa-guild', [], reader())).toEqual([
      { guild_id: 'aaa-guild', name: 'Aaa Guild' }, { guild_id: 'closed-one', name: 'Closed One' },
    ]);
  });
  it('nothing in the query, nothing listed, and no read at all', async () => {
    const calls = [];
    expect(await closedMatchesFor(undefined, [], reader(calls))).toEqual([]);
    expect(await closedMatchesFor('', [], reader(calls))).toEqual([]);
    expect(calls).toEqual([]);
  });
  it('a malformed or hostile entry never reaches the read; one the player is already in is dropped; at most ten are asked', async () => {
    const calls = [];
    await closedMatchesFor("closed-one,<script>,A_B,x,UPPER,../etc,in-already", ['in-already'], reader(calls));
    expect(calls).toEqual([['closed-one']]);
    const many = Array.from({ length: 15 }, (_, i) => `guild-${String(i).padStart(2, '0')}`).join(',');
    const c2 = [];
    await closedMatchesFor(many, [], reader(c2));
    expect(c2[0]).toHaveLength(10);
  });
  it('a guild the read does not confirm is not shown (a made-up slug in the URL names nobody)', async () => {
    expect(await closedMatchesFor('made-up-guild', [], async () => [])).toEqual([]);
    expect(await closedMatchesFor('made-up-guild', [], async () => rows)).toEqual([]);   // a row the query was not asked for is ignored
  });
  it('a failed read lists nothing instead of throwing', async () => {
    expect(await closedMatchesFor('closed-one', [], async () => { throw new Error('down'); })).toEqual([]);
  });
});

describe('matching the Discord server list against the registry', () => {
  const registry = [
    { guild_id: 'alpha', discord_guild_id: '111' }, { guild_id: 'beta', discord_guild_id: '222' },
    { guild_id: 'gamma', discord_guild_id: null }, { guild_id: 'delta', discord_guild_id: '333' },
  ];
  it('returns the registered guilds whose server the player is in, and nothing else', () => {
    expect(matchRegisteredGuilds(['999', '222', '111', '555'], registry)).toEqual(['alpha', 'beta']);
    expect(matchRegisteredGuilds([], registry)).toEqual([]);
    expect(matchRegisteredGuilds(['999'], registry)).toEqual([]);
  });
  it('a guild with no Discord server never matches, even on an empty id', () => {
    expect(matchRegisteredGuilds(['', 'null', 'undefined'], registry)).toEqual([]);
  });
});

describe('fetchUserGuilds (web/lib/discord.ts)', () => {
  const page = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: String(1000 + from + i), name: `Server ${from + i}`, owner: true, permissions: '8' }));
  it('returns ids only (names and permissions are dropped), follows pages, and sends the bearer token to the guilds endpoint', async () => {
    const { fetchUserGuilds } = await import('../web/lib/discord.ts');
    const urls = [];
    vi.stubGlobal('fetch', async (u, init) => {
      urls.push([String(u), init.headers.Authorization]);
      return { ok: true, status: 200, json: async () => (urls.length === 1 ? page(200) : page(3, 200)) };
    });
    const ids = await fetchUserGuilds('TKN');
    vi.unstubAllGlobals();
    expect(ids).toHaveLength(203);
    expect(ids.every(x => typeof x === 'string')).toBe(true);
    expect(urls[0]).toEqual(['https://discord.com/api/v10/users/@me/guilds?limit=200', 'Bearer TKN']);
    expect(urls[1][0]).toBe('https://discord.com/api/v10/users/@me/guilds?limit=200&after=1199');
  });
  it('a refused token is null; any other failure throws', async () => {
    const { fetchUserGuilds } = await import('../web/lib/discord.ts');
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 401 }));
    expect(await fetchUserGuilds('x')).toBeNull();
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500 }));
    await expect(fetchUserGuilds('x')).rejects.toThrow(/500/);
    vi.unstubAllGlobals();
  });
});

// ── 2. The middleware, run ──────────────────────────────────────────────────────────────────────────────────────
describe('the middleware, run', () => {
  let sessionClients;
  function fakeNextServer() {
    class NextRequest {
      constructor(url, init = {}) {
        const nu = new URL(url);
        nu.clone = () => new URL(nu.href);
        this.url = url; this.method = init.method || 'GET';
        this.headers = new Headers(init.headers || {}); this.nextUrl = nu;
        this.cookies = { getAll: () => [], get: () => undefined, set() {} };
      }
    }
    const res = (h) => ({ headers: new Headers(h) });
    return { NextRequest, NextResponse: { next: () => res({ 'x-middleware-next': '1' }), rewrite: (u) => res({ 'x-middleware-rewrite': String(u) }) } };
  }
  async function run(url) {
    vi.resetModules();
    sessionClients = 0;
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-key');
    const fake = fakeNextServer();
    mockBoth('next/server', () => fake);
    mockBoth('@supabase/ssr', () => ({ createServerClient: () => { sessionClients++; return { auth: { getUser: async () => ({ data: { user: null } }) } }; } }));
    const { middleware } = await import('../web/middleware.ts');
    const res = await middleware(new fake.NextRequest(url, { headers: { host: new URL(url).host } }), { waitUntil() {} });
    const to = res.headers.get('x-middleware-rewrite');
    return { to: to ? new URL(to) : null, next: res.headers.get('x-middleware-next') };
  }

  it.each(RAIDMIMIC_HOSTS)('%s: /auth/*, /api/auth/* and /guilds go on to the normal flow (session built), not the landing page', async (h) => {
    for (const p of ['/auth/signin?next=%2Fguilds', '/auth/callback?code=abc&next=%2Fguilds&flow=guilds', '/auth/paused', '/api/auth/x', '/guilds', '/guilds/anything']) {
      const { to, next } = await run(`https://${h}${p}`);
      expect(to, `${h}${p}`).toBeNull();
      expect(next, `${h}${p}`).toBe('1');
      expect(sessionClients, `${h}${p} must refresh the session`).toBe(1);
    }
  });
  it('every other path on a raidmimic host is still the landing page, no query, no session', async () => {
    for (const [u, want] of [
      ['https://raidmimic.com/', '/raidmimic'], ['https://raidmimic.com/me?x=1', '/raidmimic'], ['https://raidmimic.com/feedback', '/raidmimic'],
      ['https://raidmimic.com/setup', '/raidmimic/setup'], ['https://raidmimic.com/api/agent/chat', '/raidmimic'], ['https://raidmimic.com/authx', '/raidmimic'],
      ['https://raidmimic.com/guildsx', '/raidmimic'], ['https://www.raidmimic.net/admin', '/raidmimic'],
    ]) {
      const { to } = await run(u);
      expect(to.pathname, u).toBe(want);
      expect(to.search, u).toBe('');
      expect(sessionClients, u).toBe(0);
    }
  });
  it('/_next/ assets are still let through without a session', async () => {
    const { to, next } = await run('https://raidmimic.com/_next/data/x.json');
    expect(to).toBeNull();
    expect(next).toBe('1');
    expect(sessionClients).toBe(0);
  });
  it('eqmimic.quest is untouched: /auth/* and /guilds there are the eqmimic landing page, and no session is built', async () => {
    for (const p of ['/auth/callback', '/guilds', '/auth/signin']) {
      const { to } = await run(`https://eqmimic.quest${p}`);
      expect(to.pathname, p).toBe('/eqmimic');
      expect(sessionClients, p).toBe(0);
    }
  });
  it('wolfpack.quest is unchanged: /guilds and /auth/* take the normal flow, exactly as every other path does', async () => {
    for (const p of ['/guilds', '/auth/signin', '/me']) {
      const { to, next } = await run(`https://wolfpack.quest${p}`);
      expect(to, p).toBeNull();
      expect(next, p).toBe('1');
      expect(sessionClients, p).toBe(1);
    }
  });
});

// ── 3. The sign-in callback, run ────────────────────────────────────────────────────────────────────────────────
describe('the sign-in callback, run (web/app/auth/callback/route.ts)', () => {
  const TOKEN = 'DISCORD-TOKEN-SECRET-xyz';
  let st;
  const fresh = (over = {}) => ({
    db: memDb({
      wolfpack_roles: [{ role_id: 'r-pack', name: 'Pack Member' }],
      wolfpack_members: [],
      hub_players: [],
      hub_memberships: [],
      hub_guilds: [
        { guild_id: 'alpha', display_name: 'Alpha', discord_guild_id: '111', suspended_at: null, open_join: true },
        { guild_id: 'beta', display_name: 'Beta', discord_guild_id: '222', suspended_at: null, open_join: true },
        { guild_id: 'nodisc', display_name: 'No Discord', discord_guild_id: null, suspended_at: null, open_join: true },
        { guild_id: 'paused', display_name: 'Paused', discord_guild_id: '333', suspended_at: '2026-10-01T00:00:00Z', open_join: true },
        { guild_id: 'closed-one', display_name: 'Closed One', discord_guild_id: '444', suspended_at: null, open_join: false },
        { guild_id: 'closed-two', display_name: 'Closed Two', discord_guild_id: '555', suspended_at: null, open_join: null },
      ],
    }),
    calls: { fetchGuildMember: 0, fetchUserGuilds: [], signOut: 0, exchange: 0 },
    member: { nick: 'Aldenmar', user: { id: 'd-100', username: 'ald', global_name: 'Ald', avatar: null }, roles: ['r-pack'], joined_at: '2026-01-01T00:00:00Z', avatar: null },
    userGuilds: ['111', '999'],
    providerToken: TOKEN,
    locked: false,
    ...over,
  });

  async function load() {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-key');
    vi.stubEnv('ALLOWED_ROLE_NAMES', 'Pack Member');
    mockBoth('next/server', () => ({ NextResponse: { redirect: (u) => ({ location: String(u) }) } }));
    mockBoth('@supabase/supabase-js', () => ({ createClient: () => st.db }));
    vi.doMock('@/lib/supabase-server', () => ({
      supabaseServer: () => ({
        auth: {
          exchangeCodeForSession: async () => {
            st.calls.exchange++;
            return { data: { session: {
              provider_token: st.providerToken,
              user: { id: 'auth-u1', user_metadata: { provider_id: 'd-100', custom_claims: { global_name: 'Aldenmar' }, avatar_url: 'https://cdn.discordapp.com/avatars/d-100/a.png' } },
            } }, error: null };
          },
          signOut: async () => { st.calls.signOut++; },
        },
      }),
    }));
    vi.doMock('@/lib/discord', () => ({
      fetchGuildMember: async () => { st.calls.fetchGuildMember++; return st.member; },
      memberAvatarUrl: () => 'https://cdn.discordapp.com/x.png',
      memberDisplayName: (m) => m.nick,
      fetchUserGuilds: async (t) => { st.calls.fetchUserGuilds.push(t); return st.userGuilds; },
    }));
    vi.doMock('@/lib/lockout', () => ({ isLockedOut: async () => st.locked }));
    vi.doMock('@/lib/request-origin', async () => await import('../web/lib/request-origin.ts'));
    vi.doMock('@/lib/raidmimicHost', async () => await import('../web/lib/raidmimicHost.ts'));
    vi.doMock('@/lib/hubRegistry', async () => await import('../web/lib/hubRegistry.ts'));
    vi.doMock('@/lib/openSignIn', async () => await import('../web/lib/openSignIn.ts'));
    return (await import('../web/app/auth/callback/route.ts')).GET;
  }
  const req = (host, query) => ({ url: `https://${host}/auth/callback?${query}`, headers: new Headers({ host }) });
  const where = (res) => res.location;

  beforeEach(() => { st = fresh(); });

  describe('raidmimic.com: the open path', () => {
    it('signs a player in with no Wolf Pack lookup, no role gate, and lands on /guilds', async () => {
      const GET = await load();
      st.member = null;   // would be "not a Wolf Pack member" on the gated path
      const res = await GET(req('raidmimic.com', 'code=abc&next=%2F'));
      expect(where(res)).toBe('https://raidmimic.com/guilds');
      expect(st.calls.fetchGuildMember).toBe(0);
      expect(st.calls.fetchUserGuilds).toEqual([]);
      expect(st.calls.signOut).toBe(0);
      expect(st.db.touched.has('wolfpack_roles')).toBe(false);
      expect(st.db.touched.has('wolfpack_members')).toBe(false);
    });
    it('upserts the hub_players row from the identify profile: id, display name, avatar', async () => {
      const GET = await load();
      await GET(req('www.raidmimic.net', 'code=abc'));
      const w = st.db.writes.filter(x => x.table === 'hub_players');
      expect(w).toHaveLength(1);
      expect(w[0].opts).toEqual({ onConflict: 'discord_id' });
      expect(w[0].payload).toMatchObject({ discord_id: 'd-100', display_name: 'Aldenmar', avatar_url: 'https://cdn.discordapp.com/avatars/d-100/a.png' });
      expect(Object.keys(w[0].payload).sort()).toEqual(['avatar_url', 'discord_id', 'display_name', 'last_seen_at']);   // never deleted_at
      expect(st.db.tables.hub_players).toHaveLength(1);
    });
    it('a player in no guild at all still signs in (no gate of any kind)', async () => {
      const GET = await load();
      st.member = { ...st.member, roles: [] };
      const res = await GET(req('raidmimic.com', 'code=abc&next=%2Fguilds'));
      expect(where(res)).toBe('https://raidmimic.com/guilds');
      expect(st.db.tables.hub_memberships).toEqual([]);
    });
    it('keeps the page the caller asked for (/auth/mimic-link?code=…), and still refuses an off-site next', async () => {
      const GET = await load();
      expect(where(await GET(req('raidmimic.com', 'code=abc&next=' + encodeURIComponent('/auth/mimic-link?code=K7M2QP'))))).toBe('https://raidmimic.com/auth/mimic-link?code=K7M2QP');
      expect(where(await GET(req('raidmimic.com', 'code=abc&next=' + encodeURIComponent('//evil.example/x'))))).toBe('https://raidmimic.com/guilds');
      expect(where(await GET(req('raidmimic.com', 'code=abc&next=' + encodeURIComponent('https://evil.example'))))).toBe('https://raidmimic.com/guilds');
    });
    it('a locked-out Discord id is signed out and sent to /auth/paused, with nothing written', async () => {
      const GET = await load();
      st.locked = true;
      const res = await GET(req('raidmimic.com', 'code=abc'));
      expect(where(res)).toBe('https://raidmimic.com/auth/paused');
      expect(st.calls.signOut).toBe(1);
      expect(st.db.writes).toEqual([]);
    });
    it('no code is an error on /auth/signin, not a crash', async () => {
      const GET = await load();
      expect(where(await GET(req('raidmimic.com', 'next=%2F')))).toBe('https://raidmimic.com/auth/signin?error=missing_code');
      expect(st.calls.exchange).toBe(0);
    });
  });

  describe('wolfpack.quest: today’s gated path, unchanged', () => {
    it.each(['wolfpack.quest', 'b.wolfpack.quest', 'localhost:3000'])('%s asks Discord for the member and enforces the role gate', async (host) => {
      const GET = await load();
      st.member = { ...st.member, roles: [] };   // in the server, no role
      const res = await GET(req(host, 'code=abc&next=%2Fme'));
      expect(st.calls.fetchGuildMember).toBe(1);
      expect(decodeURIComponent(where(res))).toMatch(/\/auth\/signin\?error=You need one of these roles to sign in: Pack Member\. You have: \(none\)\./);
      expect(st.calls.signOut).toBe(1);
      expect(st.db.writes).toEqual([]);
    });
    it('not in the Wolf Pack server: signed out with the member message', async () => {
      const GET = await load();
      st.member = null;
      const res = await GET(req('wolfpack.quest', 'code=abc'));
      expect(st.calls.fetchGuildMember).toBe(1);
      expect(decodeURIComponent(where(res))).toMatch(/Not a Wolf Pack EQ member/);
    });
    it('a member with the role gets the wolfpack_members upsert and lands on next; no hub table is ever touched', async () => {
      const GET = await load();
      const res = await GET(req('wolfpack.quest', 'code=abc&next=%2Fme'));
      expect(where(res)).toBe('https://wolfpack.quest/me');
      expect(st.calls.fetchGuildMember).toBe(1);
      expect(st.db.touched.has('wolfpack_roles')).toBe(true);
      expect(st.db.writes.map(w => w.table)).toEqual(['wolfpack_members']);
      for (const t of st.db.touched) expect(t).not.toMatch(/^hub_/);
    });
    it('/ stays / on wolfpack.quest (the /guilds redirect is the open path’s alone)', async () => {
      const GET = await load();
      expect(where(await GET(req('wolfpack.quest', 'code=abc&next=%2F')))).toBe('https://wolfpack.quest/');
    });
    it('?flow=guilds means nothing here: no server list is read, no membership written', async () => {
      const GET = await load();
      const res = await GET(req('wolfpack.quest', 'code=abc&next=%2Fguilds&flow=guilds'));
      expect(where(res)).toBe('https://wolfpack.quest/guilds');
      expect(st.calls.fetchUserGuilds).toEqual([]);
      expect(st.db.tables.hub_memberships).toEqual([]);
    });
    it('a locked-out member is still turned away', async () => {
      const GET = await load();
      st.locked = true;
      expect(where(await GET(req('wolfpack.quest', 'code=abc')))).toBe('https://wolfpack.quest/auth/paused');
    });
  });

  describe('Find my guilds (?flow=guilds on a raidmimic host)', () => {
    const find = (extra = '') => `code=abc&next=%2Fguilds&flow=guilds${extra}`;
    it('reads the server list once with the token, writes one member row per MATCHED guild and nothing else', async () => {
      const GET = await load();
      st.userGuilds = ['111', '222', '777', '888'];
      const res = await GET(req('raidmimic.com', find()));
      expect(where(res)).toBe('https://raidmimic.com/guilds?find=ok&found=2');
      expect(st.calls.fetchUserGuilds).toEqual([TOKEN]);
      const adds = st.db.writes.filter(w => w.table === 'hub_memberships');
      expect(adds).toHaveLength(1);
      expect(adds[0].opts).toEqual({ onConflict: 'guild_id,player_id', ignoreDuplicates: true });
      expect(adds[0].payload.map(r => r.guild_id).sort()).toEqual(['alpha', 'beta']);
      for (const r of adds[0].payload) expect(Object.keys(r).sort()).toEqual(['guild_id', 'player_id', 'role']);
      expect(adds[0].payload.every(r => r.role === 'member')).toBe(true);
    });
    it('the token and the unmatched server ids appear in NO write and in no redirect', async () => {
      const GET = await load();
      st.userGuilds = ['111', '777', '888'];
      const res = await GET(req('raidmimic.com', find()));
      const everything = JSON.stringify(st.db.writes) + where(res);
      expect(everything).not.toContain(TOKEN);
      expect(everything).not.toMatch(/777|888/);
      expect(JSON.stringify(st.db.tables)).not.toContain(TOKEN);
    });
    it('a player already in a guild keeps their row (insert-if-missing, never an overwrite)', async () => {
      const GET = await load();
      st.userGuilds = ['111'];
      st.db.tables.hub_players.push({ player_id: 'p-old', discord_id: 'd-100' });
      st.db.tables.hub_memberships.push({ guild_id: 'alpha', player_id: 'p-old', role: 'owner', left_at: null });
      await GET(req('raidmimic.com', find()));
      expect(st.db.tables.hub_memberships).toEqual([{ guild_id: 'alpha', player_id: 'p-old', role: 'owner', left_at: null }]);
    });
    it('a matched guild that is NOT open_join is not joined: no row for it, and the redirect names it so the page can say so', async () => {
      const GET = await load();
      st.userGuilds = ['111', '444', '555', '777'];
      const res = await GET(req('raidmimic.com', find()));
      expect(where(res)).toBe('https://raidmimic.com/guilds?find=ok&found=1&closed=closed-one,closed-two');
      expect(st.db.tables.hub_memberships.map(r => r.guild_id)).toEqual(['alpha']);
      const adds = st.db.writes.filter(w => w.table === 'hub_memberships');
      expect(adds).toHaveLength(1);
      const stored = JSON.stringify(st.db.writes) + JSON.stringify(st.db.tables.hub_players);
      expect(stored).not.toMatch(/closed-|444|555|777/);   // the closed and unmatched ids are not stored anywhere
      expect(stored).not.toContain(TOKEN);
    });
    it('only closed matches: nothing is written to hub_memberships at all', async () => {
      const GET = await load();
      st.userGuilds = ['444'];
      const res = await GET(req('raidmimic.com', find()));
      expect(where(res)).toBe('https://raidmimic.com/guilds?find=ok&found=0&closed=closed-one');
      expect(st.db.writes.filter(w => w.table === 'hub_memberships')).toEqual([]);
      expect(st.db.tables.hub_memberships).toEqual([]);
    });
    it('only open matches: no closed list in the redirect', async () => {
      const GET = await load();
      st.userGuilds = ['222'];
      expect(where(await GET(req('raidmimic.com', find())))).toBe('https://raidmimic.com/guilds?find=ok&found=1');
      expect(st.db.tables.hub_memberships.map(r => r.guild_id)).toEqual(['beta']);
    });
    it('a suspended guild is not matched, and a guild with no Discord server never is', async () => {
      const GET = await load();
      st.userGuilds = ['333', 'null'];
      expect(where(await GET(req('raidmimic.com', find())))).toBe('https://raidmimic.com/guilds?find=ok&found=0');
      expect(st.db.tables.hub_memberships).toEqual([]);
    });
    it('no match writes no membership and says so', async () => {
      const GET = await load();
      st.userGuilds = ['777'];
      const res = await GET(req('raidmimic.com', find()));
      expect(where(res)).toBe('https://raidmimic.com/guilds?find=ok&found=0');
      expect(st.db.writes.filter(w => w.table === 'hub_memberships')).toEqual([]);
    });
    it('a refused token, a missing token and a Discord error each report themselves and write nothing', async () => {
      let GET = await load();
      st.userGuilds = null;
      expect(where(await GET(req('raidmimic.com', find())))).toBe('https://raidmimic.com/guilds?find=refused');
      st = fresh({ providerToken: null });
      GET = await load();
      expect(where(await GET(req('raidmimic.com', find())))).toBe('https://raidmimic.com/guilds?find=no_token');
      expect(st.calls.fetchUserGuilds).toEqual([]);
      expect(st.db.writes.filter(w => w.table === 'hub_memberships')).toEqual([]);
    });
    it('a plain sign-in NEVER reads the server list, even when Discord handed over a token', async () => {
      const GET = await load();
      await GET(req('raidmimic.com', 'code=abc&next=%2Fguilds'));
      expect(st.calls.fetchUserGuilds).toEqual([]);
      expect(st.db.touched.has('hub_guilds')).toBe(false);
    });
    it('the lockout check comes before the list is read', async () => {
      const GET = await load();
      st.locked = true;
      await GET(req('raidmimic.com', find()));
      expect(st.calls.fetchUserGuilds).toEqual([]);
    });
  });
});

describe('the route and the open path, as source', () => {
  const route = code('web/app/auth/callback/route.ts');
  const open = code('web/lib/openSignIn.ts');
  it('the route dispatches on the request origin BEFORE the code exchange, in one line', () => {
    const at = route.indexOf('isRaidmimicOrigin(origin)');
    expect(at).toBeGreaterThan(0);
    expect(route).toMatch(/if \(isRaidmimicOrigin\(origin\)\) return openSignInCallback\(req, origin, next\);/);
    expect(at).toBeLessThan(route.indexOf('exchangeCodeForSession'));
    expect(at).toBeLessThan(route.indexOf('fetchGuildMember('));
  });
  it('the gated path still has its three gates after the dispatch', () => {
    const after = route.slice(route.indexOf('isRaidmimicOrigin(origin)'));
    expect(after).toMatch(/fetchGuildMember\(providerToken\)/);
    expect(after).toMatch(/ALLOWED_ROLE_NAMES/);
    expect(after).toMatch(/isLockedOut\(/);
    expect(after).toMatch(/from\('wolfpack_members'\)\.upsert/);
  });
  it('Find my guilds reads open_join with the registry (the fake database returns every column, so the select is asserted here)', () => {
    expect(open).toMatch(/\.select\('guild_id, discord_guild_id, open_join'\)/);
    expect(open).toMatch(/splitMatchesByOpenJoin\(serverIds,/);
  });
  it('the open path has no Wolf Pack gate in it', () => {
    expect(open).not.toMatch(/fetchGuildMember|wolfpack_roles|wolfpack_members|ALLOWED_ROLE_NAMES|memberAvatarUrl/);
    expect(open).toMatch(/isLockedOut\(/);
  });
  it('the open path never writes the token: it is passed to one function and nowhere else', () => {
    const uses = open.match(/provider_token|\btoken\b/g) || [];
    expect(uses.length).toBeGreaterThan(0);
    expect(open).not.toMatch(/console\./);
    expect(open).not.toMatch(/(?:upsert|insert|update)\([^)]*token/i);
  });
});

// ── 4. Invite codes ─────────────────────────────────────────────────────────────────────────────────────────────
describe('redeemInviteCode', () => {
  const NOW = new Date('2026-10-31T12:00:00Z');
  const later = '2026-11-07T12:00:00Z';
  function db(over = {}) {
    const s = {
      invites: { K7M2QP: { code: 'K7M2QP', guild_id: 'alpha', expires_at: later, max_uses: 2, uses: 0 } },
      guilds: { alpha: { guild_id: 'alpha', display_name: 'Alpha', suspended_at: null } },
      members: {},
      log: [],
      raceLosses: 0,
      addError: null,
      ...over,
    };
    return {
      s,
      getInvite: async (c) => { s.log.push('getInvite'); return s.invites[c] ? { ...s.invites[c] } : null; },
      getGuild: async (g) => s.guilds[g] ?? null,
      getMembership: async (g, p) => s.members[`${g}/${p}`] ?? null,
      claimUse: async (c, expected) => {
        s.log.push('claimUse');
        if (s.raceLosses > 0) { s.raceLosses--; s.invites[c].uses++; return false; }   // somebody else got there first
        if (s.invites[c].uses !== expected) return false;
        s.invites[c].uses++;
        return true;
      },
      addMember: async (g, p) => { s.log.push('addMember'); if (s.addError) return s.addError; s.members[`${g}/${p}`] = { role: 'member', left_at: null }; return null; },
    };
  }
  const redeem = (d, rawCode = 'K7M2QP', playerId = 'p1') => redeemInviteCode(d, { playerId, rawCode, now: NOW });

  it('joins the guild, takes one use, writes the member row', async () => {
    const d = db();
    expect(await redeem(d)).toEqual({ ok: true, guildId: 'alpha', guildName: 'Alpha' });
    expect(d.s.invites.K7M2QP.uses).toBe(1);
    expect(d.s.members['alpha/p1']).toEqual({ role: 'member', left_at: null });
  });
  it('takes the use BEFORE it writes the member', async () => {
    const d = db();
    await redeem(d);
    expect(d.s.log.indexOf('claimUse')).toBeGreaterThan(-1);
    expect(d.s.log.indexOf('claimUse')).toBeLessThan(d.s.log.indexOf('addMember'));
  });
  it('accepts a code typed in lower case with spaces or dashes', async () => {
    expect((await redeem(db(), ' k7m-2qp ')).ok).toBe(true);
    expect(normaliseInviteCode('k7m 2qp')).toBe('K7M2QP');
  });
  it.each(['', 'K7M2Q', 'K7M2QPP', 'K7M2Q0', 'K7M2QO', 'K7M2Q1', 'K7M2QI', 'K7M2QL', 'K7M2Q!', null, 12345])('refuses the badly shaped code %j without touching storage', async (raw) => {
    const d = db();
    const r = await redeem(d, raw);
    expect(r).toMatchObject({ ok: false, reason: 'bad_code' });
    expect(d.s.log).toEqual([]);
  });
  it('the code shape is the hub_invites check constraint', () => {
    const sql = stripSql(read('supabase/migrations/20261023160000_open_hub_registry.sql'));
    expect(sql).toContain(INVITE_CODE_RX.source.replace(/\\/g, '\\'));
  });
  it('an unknown code', async () => {
    const d = db();
    expect(await redeem(d, 'ABCDEF')).toMatchObject({ ok: false, reason: 'unknown' });
    expect(d.s.log).not.toContain('claimUse');
  });
  it('an expired code (at the instant of expiry too), and it spends nothing', async () => {
    for (const exp of ['2026-10-31T11:59:59Z', '2026-10-31T12:00:00Z', 'garbage']) {
      const d = db({ invites: { K7M2QP: { code: 'K7M2QP', guild_id: 'alpha', expires_at: exp, max_uses: 2, uses: 0 } } });
      expect(await redeem(d), exp).toMatchObject({ ok: false, reason: 'expired' });
      expect(d.s.invites.K7M2QP.uses).toBe(0);
      expect(d.s.members).toEqual({});
    }
  });
  it('a code whose uses are all taken', async () => {
    const d = db({ invites: { K7M2QP: { code: 'K7M2QP', guild_id: 'alpha', expires_at: later, max_uses: 2, uses: 2 } } });
    expect(await redeem(d)).toMatchObject({ ok: false, reason: 'used_up' });
    expect(d.s.members).toEqual({});
  });
  it('max_uses is a real cap: the last use works once and then the code is spent', async () => {
    const d = db({ invites: { K7M2QP: { code: 'K7M2QP', guild_id: 'alpha', expires_at: later, max_uses: 1, uses: 0 } } });
    expect((await redeem(d, 'K7M2QP', 'p1')).ok).toBe(true);
    expect(await redeem(d, 'K7M2QP', 'p2')).toMatchObject({ ok: false, reason: 'used_up' });
    expect(Object.keys(d.s.members)).toEqual(['alpha/p1']);
  });
  it('a suspended guild, or an invite whose guild is gone', async () => {
    expect(await redeem(db({ guilds: { alpha: { guild_id: 'alpha', display_name: 'Alpha', suspended_at: '2026-10-01T00:00:00Z' } } }))).toMatchObject({ reason: 'suspended' });
    expect(await redeem(db({ guilds: {} }))).toMatchObject({ reason: 'unknown' });
  });
  it('already in the guild: refused and no use is spent; a player who LEFT can come back', async () => {
    const d = db({ members: { 'alpha/p1': { role: 'member', left_at: null } } });
    expect(await redeem(d)).toMatchObject({ ok: false, reason: 'already' });
    expect(d.s.invites.K7M2QP.uses).toBe(0);
    const back = db({ members: { 'alpha/p1': { role: 'member', left_at: '2026-10-01T00:00:00Z' } } });
    expect((await redeem(back)).ok).toBe(true);
  });
  it('losing a race for a use re-reads the invite and tries again; losing every time is "busy", never a double use', async () => {
    const once = db({ raceLosses: 1, invites: { K7M2QP: { code: 'K7M2QP', guild_id: 'alpha', expires_at: later, max_uses: 3, uses: 0 } } });
    expect((await redeem(once)).ok).toBe(true);
    expect(once.s.invites.K7M2QP.uses).toBe(2);   // the other person's use plus ours
    const always = db({ raceLosses: 99, invites: { K7M2QP: { code: 'K7M2QP', guild_id: 'alpha', expires_at: later, max_uses: 99, uses: 0 } } });
    expect(await redeem(always)).toMatchObject({ ok: false, reason: 'busy' });
    expect(always.s.members).toEqual({});
  });
  it('the race for the LAST use: the loser is told it is used up', async () => {
    const d = db({ raceLosses: 1, invites: { K7M2QP: { code: 'K7M2QP', guild_id: 'alpha', expires_at: later, max_uses: 1, uses: 0 } } });
    expect(await redeem(d)).toMatchObject({ ok: false, reason: 'used_up' });
    expect(d.s.members).toEqual({});
  });
  it('a storage error is reported, not thrown', async () => {
    expect(await redeem(db({ addError: 'boom' }))).toMatchObject({ ok: false, reason: 'error' });
    const d = db();
    d.getInvite = async () => { throw new Error('down'); };
    expect(await redeem(d)).toMatchObject({ ok: false, reason: 'error' });
  });
});

describe('the redeemInvite server action, run (web/app/guilds/actions.ts)', () => {
  let store, user;
  async function loadAction() {
    vi.resetModules();
    mockBoth('next/cache', () => ({ revalidatePath() {} }));
    vi.doMock('@/lib/supabase-server', () => ({ supabaseServer: () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }));
    vi.doMock('@/lib/supabase', () => ({ supabaseAdmin: () => store }));
    vi.doMock('@/lib/lockout', async () => await import('../web/lib/lockout.ts'));
    vi.doMock('@/lib/popRecitalSave', async () => await import('../web/lib/popRecitalSave.ts'));
    vi.doMock('@/lib/hubRegistry', async () => await import('../web/lib/hubRegistry.ts'));
    return (await import('../web/app/guilds/actions.ts')).redeemInvite;
  }
  const soon = () => new Date(Date.now() + 7 * 864e5).toISOString();
  beforeEach(() => {
    user = { id: 'auth-u1', app_metadata: { provider_id: 'd-100' }, user_metadata: { custom_claims: { global_name: 'Aldenmar' } } };
    store = memDb({
      hub_players: [], hub_memberships: [],
      hub_guilds: [{ guild_id: 'alpha', display_name: 'Alpha', suspended_at: null }],
      hub_invites: [{ code: 'K7M2QP', guild_id: 'alpha', expires_at: soon(), max_uses: 100, uses: 0 }],
    });
  });

  it('refuses a signed-out caller and writes nothing', async () => {
    user = null;
    const redeemInvite = await loadAction();
    expect(await redeemInvite('K7M2QP')).toEqual({ ok: false, message: 'Sign in first.' });
    expect(store.writes).toEqual([]);
  });
  it('joins as the SIGNED-IN player (made on the spot if they have no hub_players row yet)', async () => {
    const redeemInvite = await loadAction();
    expect(await redeemInvite('k7m2qp')).toEqual({ ok: true, message: 'You joined Alpha.' });
    expect(store.tables.hub_players).toHaveLength(1);
    expect(store.tables.hub_players[0]).toMatchObject({ discord_id: 'd-100', display_name: 'Aldenmar' });
    expect(store.tables.hub_memberships).toEqual([expect.objectContaining({ guild_id: 'alpha', player_id: store.tables.hub_players[0].player_id, role: 'member', left_at: null })]);
    expect(store.tables.hub_invites[0].uses).toBe(1);
  });
  it('eight tries in ten minutes, then "Too many tries" even for a valid code', async () => {
    const redeemInvite = await loadAction();
    for (let i = 0; i < 8; i++) expect((await redeemInvite('ABCDEF')).ok).toBe(false);
    const ninth = await redeemInvite('K7M2QP');
    expect(ninth).toEqual({ ok: false, message: 'Too many tries. Wait a few minutes and try again.' });
    expect(store.tables.hub_memberships).toEqual([]);
  });
  it('the limit is per player: another player is not held back', async () => {
    const redeemInvite = await loadAction();
    for (let i = 0; i < 9; i++) await redeemInvite('ABCDEF');
    user = { id: 'auth-u2', app_metadata: { provider_id: 'd-200' }, user_metadata: {} };
    expect((await redeemInvite('K7M2QP')).ok).toBe(true);
  });
  it('a database without the registry says so instead of throwing', async () => {
    store = memDb({ hub_players: null });
    const redeemInvite = await loadAction();
    expect(await redeemInvite('K7M2QP')).toEqual({ ok: false, message: 'The guild registry is not open yet.' });
  });
});

// ── 5. The migration and the page ───────────────────────────────────────────────────────────────────────────────
describe('migration 20261031150000_hub_registry_discord_guild.sql', () => {
  const sql = stripSql(read('supabase/migrations/20261031150000_hub_registry_discord_guild.sql'));
  it('adds discord_guild_id to hub_guilds: nullable text, unique where set', () => {
    expect(sql).toMatch(/alter table hub_guilds add column if not exists discord_guild_id text;/);
    expect(sql).toMatch(/create unique index if not exists hub_guilds_discord_guild_uidx on hub_guilds \(discord_guild_id\) where discord_guild_id is not null;/);
    expect(sql).not.toMatch(/discord_guild_id text not null/);
  });
  it('adds the avatar the player signed in with', () => {
    expect(sql).toMatch(/alter table hub_players add column if not exists avatar_url text;/);
  });
  it('is idempotent: every statement guards itself, and nothing destroys or rewrites', () => {
    // a DO block holds its own semicolons: take those out whole, check each swallows duplicate_object, then split the rest
    const blocks = sql.match(/do \$\$[\s\S]*?end \$\$;/g) || [];
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) expect(b).toMatch(/exception when duplicate_object then null/);
    const statements = blocks.reduce((s, b) => s.replace(b, ''), sql).split(';').map(s => s.trim()).filter(Boolean);
    expect(statements.length).toBeGreaterThan(1);
    for (const s of statements) expect(s, s).toMatch(/\bif not exists\b/);
    expect(sql).not.toMatch(/\b(drop|delete|truncate|update|insert)\b/i);
    expect(sql).not.toMatch(/create table/i);          // the registry migration is not rewritten
  });
  it('the Discord server id constraint can be added twice (duplicate_object is swallowed)', () => {
    expect(sql).toMatch(/add constraint hub_guilds_discord_guild_shape check \(discord_guild_id is null or discord_guild_id ~ '\^\[0-9\]\{5,25\}\$'\)/);
  });
  it('the registry migration it builds on is unchanged in kind: still service-role only (RLS on, no policy)', () => {
    const base = stripSql(read('supabase/migrations/20261023160000_open_hub_registry.sql'));
    expect(base).toMatch(/alter table hub_guilds\s+enable row level security;/);
    expect(base).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/create policy|disable row level security|grant /i);
  });
});

describe('the /guilds page', () => {
  const page = code('web/app/guilds/page.tsx');
  it('requires a sign-in and sends the visitor back to /guilds after it', () => {
    expect(page).toMatch(/if \(!user\) redirect\('\/auth\/signin\?next=\/guilds'\);/);
  });
  it('reads only the signed-in player’s own rows: Discord id or the player id taken from it', () => {
    expect(page).toMatch(/from\('wolfpack_members'\)[^;]*\.eq\('discord_id', discordId\)/);
    expect(page).toMatch(/from\('characters'\)[^;]*\.eq\('guild_id', GUILD_TAG\)[^;]*\.eq\('discord_id', discordId\)/);
    expect(page).toMatch(/from\('hub_players'\)[^;]*\.eq\('discord_id', discordId\)/);
    expect(page).toMatch(/from\('hub_memberships'\)[^;]*\.eq\('player_id', player\.player_id\)/);
    expect(page).toMatch(/from\('hub_guilds'\)[^;]*\.in\('guild_id', mine\.map/);
    // every .from( on the page is one of those reads (the sixth is the closed-match names, below)
    expect((page.match(/\.from\('/g) || []).length).toBe(6);
  });
  it('lists the closed Discord matches under their own heading, with the ask for an invite code, and reads only closed, unsuspended guilds', () => {
    expect(page).toMatch(/\{closed\.length > 0 && \(\s*<div className=\{CARD\} aria-label="Guilds you're in on Discord">/);
    expect(page).toMatch(/Guilds you&rsquo;re in on Discord/);
    expect(page).toMatch(/Ask an officer for an invite code/);
    expect(page).toMatch(/\.in\('guild_id', slugs\)\.eq\('open_join', false\)\.is\('suspended_at', null\)/);
    expect(page).toMatch(/searchParams\.find === 'ok' \? await loadClosedMatches\(searchParams\.closed, hub\)/);
    expect(page).not.toMatch(/\.(?:insert|upsert|update)\(/);   // the page never writes: the closed list is shown, not stored
  });
  it('is marked [beta], not indexed, and has its Discord card entry', () => {
    expect(page).toMatch(/title: '\[beta\] Your guilds'/);
    expect(page).toMatch(/robots: \{ index: false, follow: false \}/);
    expect(page).toMatch(/<NewPageTag/);
    expect(code('web/lib/pageMeta.ts')).toMatch(/'\/guilds':\s+\{ title: '\[beta\] Your guilds'/);
  });
  it('shows "Find my guilds" only where the second consent works (a raidmimic host)', () => {
    expect(page).toMatch(/\{onHost \? \([\s\S]*flow="guilds"/);
    expect(page).not.toMatch(/provider_token/);
  });
  it('"Start a guild" is a link to the form on /guilds/new (test/guilds-new.test.js), not a form of its own', () => {
    const start = page.slice(page.indexOf('Start a guild</h2>'));
    expect(start).toMatch(/href="\/guilds\/new"/);
    expect(start).not.toMatch(/<form|<input|<button|action=/);
  });
});
