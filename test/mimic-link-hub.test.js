// test/mimic-link-hub.test.js — the link flow carries the chosen guild, and a player who is not in Wolf Pack finishes it
// on raidmimic.com (the guild lead, 2026-10-31, DECISIONS §499: the Mimic guild picker, the slice after the directory).
//
// Four layers, each run for real where it can be:
//   1. utils/mimicLink.js — handleStart, handlePoll and requireAgentAuth — with utils/supabase.js's functions swapped on the
//      shared CJS module object (the pattern of test/guest-link.test.js), so the hub column, the session's guild_id, the
//      membership check and the restricted allowlist are exercised as shipped.
//   2. web/lib/mimicLinkHub.ts — the claim rules and its supabase-js implementation — against a small in-memory supabase
//      client that honours the filters the code asks for (a claim that dropped one would show).
//   3. The migration, as comment-stripped text (it needs a database to run; idempotence is asserted on its statements).
//   4. The page and the bot's index.js, as comment-stripped text. The page's Wolf Pack half is pinned by a hash of its
//      normalised source, taken from origin/main on 2026-10-31, so "unchanged" is a check and not a claim.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BOT_INDEX, ROOT, readSource, sliceBlock, stripJs, stripSql } from './_source-slice.js';
import { claimHubCode, checkHubLink, cleanLinkCode, hubLinkDb } from '../web/lib/mimicLinkHub.ts';
import { isRaidmimicOpenPath } from '../web/lib/raidmimicHost.ts';

const nodeRequire = createRequire(BOT_INDEX);
const supabase = nodeRequire('./utils/supabase');
const mimicLink = nodeRequire('./utils/mimicLink');
const lockout = nodeRequire('./utils/memberLockout');
const freshToken = () => 'wpms_' + crypto.randomBytes(32).toString('hex');

const HUB = 'ironhide';
const NOW = Date.UTC(2026, 9, 31, 20, 0, 0);
const iso = (ms) => new Date(ms).toISOString();

// ── a request/response pair the handlers accept ──────────────────────────────
let ipCounter = 0;
function jsonReq(body) {
  const ip = `203.0.113.${(++ipCounter % 250) + 1}`;   // a fresh address per request: /start is limited per IP
  return {
    headers: { 'x-real-ip': ip },
    socket: { remoteAddress: ip },
    on(ev, fn) {
      if (ev === 'data') setImmediate(() => fn(JSON.stringify(body)));
      if (ev === 'end') setImmediate(() => setImmediate(fn));
      return this;
    },
  };
}
const fakeRes = () => ({ status: null, headers: null, body: null, writeHead(s, h) { this.status = s; this.headers = h; }, end(b) { this.body = b; } });
const parsed = (res) => JSON.parse(res.body);

const saved = {};
const envSaved = {};
beforeEach(() => {
  for (const k of ['isEnabled', 'select', 'update', 'insert', 'del']) saved[k] = supabase[k];
  for (const k of ['HUB_SITE_URL', 'MIMIC_LINK_VERIFICATION_URL', 'SUPABASE_GUILD_ID']) { envSaved[k] = process.env[k]; delete process.env[k]; }
  supabase.isEnabled = () => true;
  supabase.update = async () => [];
  supabase.del = async () => [];
  lockout._setForTest([]);
});
afterEach(() => {
  for (const k of Object.keys(saved)) supabase[k] = saved[k];
  for (const [k, v] of Object.entries(envSaved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  vi.restoreAllMocks();
  lockout._setForTest([]);
});

// ── 1a. POST /api/mimic-link/start ───────────────────────────────────────────
describe('start carries the chosen guild', () => {
  let inserted;
  beforeEach(() => {
    inserted = [];
    supabase.insert = async (table, rows) => { inserted.push({ table, row: rows[0] }); return [{ id: 1 }]; };
  });

  it('without a hub it is Wolf Pack exactly as before: no hub column written, no hub key answered, today\'s address', async () => {
    const res = fakeRes();
    await mimicLink.handleStart(jsonReq({ agent_version: 'mimic 4.0.0' }), res);
    expect(res.status).toBe(200);
    const out = parsed(res);
    expect(Object.keys(inserted[0].row).sort()).toEqual(['agent_version', 'device_code', 'expires_at', 'user_code']);
    expect(out.verification_url).toBe('https://wolfpack.quest/auth/mimic-link');
    expect(out.verification_url_complete).toBe(`https://wolfpack.quest/auth/mimic-link?code=${out.user_code}`);
    expect(Object.keys(out).sort()).toEqual(['device_code', 'expires_in', 'poll_interval', 'user_code', 'verification_url', 'verification_url_complete']);
  });

  it('Wolf Pack\'s address still honours its own override', async () => {
    process.env.MIMIC_LINK_VERIFICATION_URL = 'https://beta.example/auth/mimic-link';
    const res = fakeRes();
    await mimicLink.handleStart(jsonReq({}), res);
    expect(parsed(res).verification_url).toBe('https://beta.example/auth/mimic-link');
  });

  it('a hub is stored on the code row and answered on the guild\'s site (raidmimic.com by default)', async () => {
    const res = fakeRes();
    await mimicLink.handleStart(jsonReq({ hub: HUB, agent_version: 'mimic 4.0.0' }), res);
    expect(res.status).toBe(200);
    const out = parsed(res);
    expect(inserted[0].table).toBe('mimic_link_codes');
    expect(inserted[0].row.hub).toBe(HUB);
    expect(out.hub).toBe(HUB);
    expect(out.verification_url).toBe('https://raidmimic.com/auth/mimic-link');
    expect(out.verification_url_complete).toBe(`https://raidmimic.com/auth/mimic-link?code=${out.user_code}`);
  });

  it('the site is HUB_SITE_URL when it is an https address (trailing slash trimmed), and the default when it is not', async () => {
    process.env.HUB_SITE_URL = 'https://guilds.example.test/';
    let res = fakeRes();
    await mimicLink.handleStart(jsonReq({ hub: HUB }), res);
    expect(parsed(res).verification_url).toBe('https://guilds.example.test/auth/mimic-link');
    for (const bad of ['http://guilds.example.test', 'guilds.example.test', 'javascript:alert(1)', 'https://']) {
      process.env.HUB_SITE_URL = bad;
      res = fakeRes();
      await mimicLink.handleStart(jsonReq({ hub: HUB }), res);
      expect(parsed(res).verification_url, bad).toBe('https://raidmimic.com/auth/mimic-link');
    }
  });

  it('naming this process\'s own guild is Wolf Pack, not a hub', async () => {
    const res = fakeRes();
    await mimicLink.handleStart(jsonReq({ hub: 'wolfpack' }), res);
    expect('hub' in inserted[0].row).toBe(false);
    expect(parsed(res).verification_url).toBe('https://wolfpack.quest/auth/mimic-link');
    process.env.SUPABASE_GUILD_ID = 'otherguild';
    const res2 = fakeRes();
    await mimicLink.handleStart(jsonReq({ hub: 'otherguild' }), res2);
    expect('hub' in inserted[1].row).toBe(false);
  });

  it('refuses anything that is not a slug with a 400 and writes nothing', async () => {
    for (const bad of ['Iron Hide', 'IRONHIDE', 'a', 'ab', 'x'.repeat(30), '-ironhide', 'ironhide-', '../etc', 'iron_hide', 5, {}, ['ironhide'], true]) {
      const res = fakeRes();
      await mimicLink.handleStart(jsonReq({ hub: bad }), res);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(parsed(res)).toEqual({ error: 'invalid hub' });
    }
    expect(inserted).toEqual([]);
  });

  it('treats an empty or null hub as none', async () => {
    for (const none of [null, '']) {
      const res = fakeRes();
      await mimicLink.handleStart(jsonReq({ hub: none }), res);
      expect(res.status).toBe(200);
      expect(parsed(res).verification_url).toBe('https://wolfpack.quest/auth/mimic-link');
    }
    expect(inserted.every(i => !('hub' in i.row))).toBe(true);
  });
});

// ── 1b. POST /api/mimic-link/poll ────────────────────────────────────────────
describe('poll mints the session in the code\'s guild, and only for a member of it', () => {
  const DISCORD = '210000000000000001';
  let codeRow, tables, sessions, deleted;
  beforeEach(() => {
    sessions = [];
    deleted = [];
    codeRow = {
      user_code: 'ABC234', device_code: 'd'.repeat(64), expires_at: iso(Date.now() + 600_000), hub: HUB,
      authorized_at: iso(Date.now() - 1000), authorized_user_id: 'u-1', authorized_discord_id: DISCORD,
      agent_version: 'mimic 4.0.0',
    };
    tables = {
      hub_guilds: [{ guild_id: HUB, suspended_at: null }],
      hub_players: [{ discord_id: DISCORD, player_id: 'p-1', display_name: 'Aldenmar', deleted_at: null }],
      hub_memberships: [{ guild_id: HUB, player_id: 'p-1', role: 'member', left_at: null }],
      wolfpack_members: [{ discord_id: DISCORD, nickname: 'Brackwyn', role_names: ['Officer'] }],
    };
    const reads = [];
    tables._reads = reads;
    supabase.select = async (table, q) => {
      reads.push([table, q]);
      if (table === 'mimic_link_codes') return [codeRow];
      if (table === 'hub_guilds') return tables.hub_guilds.filter(r => q.includes(`guild_id=eq.${r.guild_id}&`) || q.startsWith(`guild_id=eq.${r.guild_id}`));
      if (table === 'hub_players') return tables.hub_players.filter(r => q.includes(`discord_id=eq.${r.discord_id}`));
      if (table === 'hub_memberships') {
        return tables.hub_memberships.filter(r => q.includes(`guild_id=eq.${r.guild_id}`) && q.includes(`player_id=eq.${r.player_id}`) && q.includes('left_at=is.null') && !r.left_at);
      }
      if (table === 'wolfpack_members') return tables.wolfpack_members;
      return [];
    };
    supabase.insert = async (table, rows) => { sessions.push({ table, row: rows[0] }); return [{ id: 'sess-1' }]; };
    supabase.del = async (table, q) => { deleted.push([table, q]); return []; };
  });
  const poll = async () => { const res = fakeRes(); await mimicLink.handlePoll(jsonReq({ device_code: 'd'.repeat(64) }), res); return parsed(res); };

  it('a member: the session row carries guild_id = the hub and the player\'s discord id, and the answer comes from the hub roster', async () => {
    const out = await poll();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].table).toBe('mimic_sessions');
    expect(sessions[0].row).toMatchObject({ guild_id: HUB, discord_id: DISCORD, user_id: 'u-1', agent_version: 'mimic 4.0.0' });
    expect(out).toMatchObject({ status: 'linked', discord_id: DISCORD, display_name: 'Aldenmar', is_officer: false, role_names: [], scope: 'member', guild_id: HUB, hub_role: 'member' });
    expect(out.session_token).toMatch(/^wpms_[0-9a-f]{64}$/);
    expect(deleted).toHaveLength(1);                                          // the code is spent
    expect(tables._reads.some(([t]) => t === 'wolfpack_members')).toBe(false); // Wolf Pack's roster is never read for a hub link
  });

  it('the hub role decides is_officer: owner and officer are officers, member and guest are not', async () => {
    for (const [role, officer] of [['owner', true], ['officer', true], ['member', false], ['guest', false]]) {
      tables.hub_memberships[0].role = role;
      const out = await poll();
      expect(out.is_officer, role).toBe(officer);
    }
  });

  it('not a member of the code\'s guild: no session, the code is deleted, the device is told expired', async () => {
    for (const cut of [
      () => { tables.hub_memberships.length = 0; },                                   // never joined
      () => { tables.hub_memberships[0].left_at = iso(Date.now() - 1000); },          // joined and left
      () => { tables.hub_memberships[0].guild_id = 'someotherguild'; },               // a member of a different guild only
      () => { tables.hub_players.length = 0; },                                       // no hub account at all
      () => { tables.hub_players[0].deleted_at = iso(Date.now() - 1000); },           // deleted account
      () => { tables.hub_guilds[0].suspended_at = iso(Date.now() - 1000); },          // guild suspended
      () => { tables.hub_guilds.length = 0; },                                        // guild unknown
    ]) {
      beforeEachReset();
      cut();
      sessions.length = 0; deleted.length = 0;
      const out = await poll();
      expect(out).toEqual({ status: 'expired' });
      expect(sessions).toEqual([]);
      expect(deleted).toHaveLength(1);
    }
    function beforeEachReset() {
      tables.hub_guilds = [{ guild_id: HUB, suspended_at: null }];
      tables.hub_players = [{ discord_id: DISCORD, player_id: 'p-1', display_name: 'Aldenmar', deleted_at: null }];
      tables.hub_memberships = [{ guild_id: HUB, player_id: 'p-1', role: 'member', left_at: null }];
    }
  });

  it('a Wolf Pack officer-assisted stamp on a hub code mints nothing for a stranger (the bot is the enforcer, not the page)', async () => {
    codeRow.authorized_via = 'officer';
    codeRow.authorized_by_discord_id = '999';
    tables.hub_memberships.length = 0;
    expect(await poll()).toEqual({ status: 'expired' });
    expect(sessions).toEqual([]);
  });

  it('a guest approval is Wolf Pack\'s alone: on a hub code it is expired, never a guest session', async () => {
    // a real guest approval stamps no discord id; one is left on here so that only the guest rule, not an empty id, can refuse it
    Object.assign(codeRow, { authorized_via: 'guest', guest_label: 'Corvale', guest_expires_at: iso(Date.now() + 3600_000) });
    expect(await poll()).toEqual({ status: 'expired' });
    expect(sessions).toEqual([]);
  });

  it('a failed read keeps the code and answers pending, so the next poll asks again', async () => {
    const real = supabase.select;
    supabase.select = async (table, q) => (table === 'hub_memberships' ? null : real(table, q));
    expect(await poll()).toEqual({ status: 'pending' });
    expect(sessions).toEqual([]);
    expect(deleted).toEqual([]);
  });

  it('a locked member still gets no session on a hub link', async () => {
    lockout._setForTest([{ discord_id: DISCORD, until: null }]);
    expect(await poll()).toEqual({ status: 'expired' });
    expect(sessions).toEqual([]);
  });

  it('Wolf Pack is unchanged: a code with no hub mints a row WITHOUT guild_id and answers from wolfpack_members', async () => {
    delete codeRow.hub;
    const out = await poll();
    expect('guild_id' in sessions[0].row).toBe(false);
    expect(Object.keys(sessions[0].row).sort()).toEqual(['agent_version', 'discord_id', 'linked_by_discord_id', 'linked_via', 'session_token', 'user_id']);
    expect(out).toMatchObject({ status: 'linked', display_name: 'Brackwyn', is_officer: true, role_names: ['Officer'] });
    expect('scope' in out).toBe(false);
    expect(tables._reads.some(([t]) => t.startsWith('hub_'))).toBe(false);
  });

  it('a code whose hub is this process\'s own guild is Wolf Pack too', async () => {
    codeRow.hub = 'wolfpack';
    const out = await poll();
    expect('guild_id' in sessions[0].row).toBe(false);
    expect(out.display_name).toBe('Brackwyn');
  });
});

// ── 1c. requireAgentAuth with a hub session ──────────────────────────────────
describe('a hub session is a member of its guild and may use only the restricted allowlist', () => {
  const DISCORD = '210000000000000001';
  let sessionRow, tables, hubReads, failMembership;
  beforeEach(() => {
    hubReads = 0;
    failMembership = false;
    sessionRow = { user_id: 'u-1', discord_id: DISCORD, revoked_at: null, guild_id: HUB };
    tables = {
      hub_guilds: [{ guild_id: HUB, suspended_at: null }],
      hub_players: [{ discord_id: DISCORD, player_id: 'p-1', display_name: 'Aldenmar', deleted_at: null }],
      hub_memberships: [{ guild_id: HUB, player_id: 'p-1', role: 'officer', left_at: null }],
      wolfpack_members: [{ nickname: 'Brackwyn', role_names: ['Officer'] }],
    };
    supabase.select = async (table) => {
      if (table === 'mimic_sessions') return [sessionRow];
      if (table.startsWith('hub_')) { hubReads++; if (failMembership && table === 'hub_memberships') return null; return tables[table]; }
      if (table === 'wolfpack_members') return tables.wolfpack_members;
      return [];
    };
  });
  function call(method, url, token = freshToken()) {
    const req = { method, url, headers: { authorization: `Bearer ${token}` }, socket: { remoteAddress: '203.0.113.9' } };
    const res = fakeRes();
    return mimicLink.requireAgentAuth(req, res).then((identity) => ({ identity, res, token }));
  }

  it('resolves through the hub roster: scope member, the hub role, the guild on the identity', async () => {
    const r = await call('POST', '/api/agent/encounter');
    expect(r.res.status).toBeNull();
    expect(r.identity).toMatchObject({
      discord_id: DISCORD, display_name: 'Aldenmar', scope: 'member', guild_id: HUB, hub_guild: HUB, hub_role: 'officer',
      is_officer: true, role_names: [],
    });
  });

  it('allows exactly the guest routes (parse upload, poll, version) and answers 403 hub_scope with a message everywhere else', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    for (const [m, u] of [['POST', '/api/agent/encounter'], ['GET', '/api/agent/poll?streams=tuning'], ['GET', '/api/agent/latest-version?channel=beta']]) {
      const r = await call(m, u);
      expect(r.identity, `${m} ${u}`).toBeTruthy();
      expect(r.res.status).toBeNull();
    }
    for (const [m, u] of [
      ['POST', '/api/agent/chat'], ['POST', '/api/agent/live-state'], ['POST', '/api/agent/buff_casts'], ['POST', '/api/agent/place-bid'],
      ['GET', '/api/agent/guild-triggers'], ['GET', '/api/agent/recent-fires'], ['GET', '/api/agent/reporter-poll'],
      ['POST', '/api/agent/tells'], ['GET', '/api/agent/encounter'], ['POST', '/api/agent/poll'], ['POST', '/api/agent/encounter/extra'],
      ['POST', '/api/agent/who-override'], ['GET', '/api/me'], ['POST', '/api/admin/anything'],
    ]) {
      const r = await call(m, u);
      expect(r.identity, `${m} ${u}`).toBeNull();
      expect(r.res.status, `${m} ${u}`).toBe(403);
      const body = JSON.parse(r.res.body);
      expect(body.error).toBe('hub_scope');
      expect(body.message).toMatch(/another guild/);
    }
    expect(log.mock.calls.some(c => String(c[0]).startsWith('[hub]'))).toBe(true);
  });

  it('a hub OFFICER gets no officer route: the role is the hub\'s, and the gate does not look at it', async () => {
    const r = await call('POST', '/api/agent/chat');
    expect(r.identity).toBeNull();
    expect(r.res.status).toBe(403);
  });

  it('the allowlist is the guest three plus the link routes, defined in one place', () => {
    expect(mimicLink.HUB_ALLOWED_ROUTES.slice(0, mimicLink.GUEST_ALLOWED_ROUTES.length)).toEqual(mimicLink.GUEST_ALLOWED_ROUTES);
    expect(mimicLink.HUB_ALLOWED_ROUTES.slice(mimicLink.GUEST_ALLOWED_ROUTES.length)).toEqual([
      ['POST', '/api/mimic-link/start'], ['POST', '/api/mimic-link/poll'], ['POST', '/api/mimic-link/revoke'],
    ]);
    expect(mimicLink.hubRouteAllowed('POST', '/api/agent/encounter')).toBe(true);
    expect(mimicLink.hubRouteAllowed('GET', '/api/agent/encounter')).toBe(false);
    expect(mimicLink.hubRouteAllowed('POST', '/api/agent/chat')).toBe(false);
  });

  it('leaving the guild ends the session like a revoke: 401, not a hub identity', async () => {
    tables.hub_memberships[0].left_at = iso(Date.now() - 1000);
    // the fake ignores the left_at filter on purpose here: a membership row that has a left_at must not count even if the read returned it
    const real = supabase.select;
    supabase.select = async (table, q) => (table === 'hub_memberships' ? [] : real(table, q));
    const r = await call('POST', '/api/agent/encounter');
    expect(r.identity).toBeNull();
    expect(r.res.status).toBe(401);
  });

  it('a suspended guild, an unknown guild and a deleted player end the session too', async () => {
    for (const cut of [
      () => { tables.hub_guilds[0].suspended_at = iso(Date.now() - 1000); },
      () => { tables.hub_guilds.length = 0; },
      () => { tables.hub_players[0].deleted_at = iso(Date.now() - 1000); },
      () => { tables.hub_players.length = 0; },
    ]) {
      tables.hub_guilds = [{ guild_id: HUB, suspended_at: null }];
      tables.hub_players = [{ discord_id: DISCORD, player_id: 'p-1', display_name: 'Aldenmar', deleted_at: null }];
      cut();
      const r = await call('POST', '/api/agent/encounter');
      expect(r.res.status).toBe(401);
    }
  });

  it('a failed roster read is a retry, never a verdict: a fresh token gets a non-officer identity, a known one keeps its last good one', async () => {
    failMembership = true;
    const fresh = await call('POST', '/api/agent/encounter');
    expect(fresh.identity).toMatchObject({ is_officer: false, hub_guild: HUB, scope: 'member' });
    expect(fresh.res.status).toBeNull();

    failMembership = false;
    const good = await call('POST', '/api/agent/encounter');               // caches an officer identity
    expect(good.identity.is_officer).toBe(true);
    failMembership = true;
    const again = await call('POST', '/api/agent/encounter', good.token);  // served from the cache
    expect(again.identity.is_officer).toBe(true);
  });

  it('a Wolf Pack session is untouched: it resolves through wolfpack_members, reads no hub table and is not restricted', async () => {
    for (const guild_id of [undefined, null, 'wolfpack']) {
      sessionRow = { user_id: null, discord_id: DISCORD, revoked_at: null, ...(guild_id === undefined ? {} : { guild_id }) };
      hubReads = 0;
      const r = await call('POST', '/api/agent/chat');
      expect(r.identity, String(guild_id)).toMatchObject({ discord_id: DISCORD, display_name: 'Brackwyn', is_officer: true });
      expect(r.identity.hub_guild).toBeUndefined();
      expect(r.identity.scope).toBeUndefined();
      expect(hubReads).toBe(0);
    }
  });

  it('the guest allowlist still works and still wins for a guest', async () => {
    sessionRow = { user_id: null, discord_id: 'guest:7b2f0c1e-0000-4000-8000-000000000001', revoked_at: null, scope: 'guest', guest_label: 'Corvale', expires_at: iso(Date.now() + 3600_000) };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect((await call('POST', '/api/agent/encounter')).identity).toMatchObject({ scope: 'guest' });
    const r = await call('POST', '/api/agent/chat');
    expect(JSON.parse(r.res.body)).toEqual({ error: 'guest_scope' });
  });
});

// ── 2. The claim (web/lib/mimicLinkHub.ts) over an in-memory supabase client ─
function fakeAdmin(tables, log = []) {
  const from = (table) => {
    const q = { table, op: 'select', patch: null, eqs: [], iss: [] };
    const matches = () => (tables[table] || []).filter(r =>
      q.eqs.every(([c, v]) => r[c] === v) && q.iss.every(([c, v]) => (v === null ? r[c] == null : r[c] === v)));
    const chain = {
      select() { return chain; },
      update(patch) { q.op = 'update'; q.patch = patch; return chain; },
      eq(c, v) { q.eqs.push([c, v]); return chain; },
      is(c, v) { q.iss.push([c, v]); return chain; },
      limit() { return chain; },
      then(resolve, reject) {
        log.push({ table, op: q.op, eqs: q.eqs, iss: q.iss, patch: q.patch });
        if (tables._fail === table) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(resolve, reject);
        const rows = matches();
        if (q.op === 'update') for (const r of rows) Object.assign(r, q.patch);
        return Promise.resolve({ data: rows.map(r => ({ ...r })), error: null }).then(resolve, reject);
      },
    };
    return chain;
  };
  return { from };
}

describe('claiming a code on a hub site', () => {
  const DISCORD = '210000000000000001';
  let tables, log, db;
  const CODE = 'ABC234';
  const claim = (over = {}) => claimHubCode(db, { userCode: CODE, userId: 'u-1', discordId: DISCORD, now: new Date(NOW), ...over });
  beforeEach(() => {
    log = [];
    tables = {
      mimic_link_codes: [{ user_code: CODE, expires_at: iso(NOW + 600_000), authorized_at: null, authorized_user_id: null, authorized_discord_id: null, hub: HUB }],
      hub_guilds: [{ guild_id: HUB, display_name: 'Ironhide Company', suspended_at: null }, { guild_id: 'otherguild', display_name: 'Other Guild', suspended_at: null }],
      hub_players: [{ discord_id: DISCORD, player_id: 'p-1', deleted_at: null }],
      hub_memberships: [{ guild_id: HUB, player_id: 'p-1', role: 'member', left_at: null }],
    };
    db = hubLinkDb(fakeAdmin(tables, log));
  });
  const stamped = () => tables.mimic_link_codes[0].authorized_at !== null;

  it('an active member of the code\'s guild claims it: the code is stamped with their account and discord id', async () => {
    const r = await claim();
    expect(r).toEqual({ ok: true, already: false, guildId: HUB, guildName: 'Ironhide Company' });
    expect(tables.mimic_link_codes[0]).toMatchObject({ authorized_at: iso(NOW), authorized_user_id: 'u-1', authorized_discord_id: DISCORD, hub: HUB });
    const upd = log.find(l => l.op === 'update');
    expect(upd.iss).toContainEqual(['authorized_at', null]);   // the stamp is conditional: two claims cannot both win
  });

  it('is read-only until it knows the player belongs: a non-member leaves the code untouched', async () => {
    for (const cut of [
      () => { tables.hub_memberships.length = 0; },
      () => { tables.hub_memberships[0].left_at = iso(NOW - 1000); },
      () => { tables.hub_memberships[0].guild_id = 'otherguild'; },
      () => { tables.hub_memberships[0].player_id = 'p-2'; },
      () => { tables.hub_players.length = 0; },
      () => { tables.hub_players[0].deleted_at = iso(NOW - 1000); },
    ]) {
      tables.hub_players = [{ discord_id: DISCORD, player_id: 'p-1', deleted_at: null }];
      tables.hub_memberships = [{ guild_id: HUB, player_id: 'p-1', role: 'member', left_at: null }];
      cut();
      const r = await claim();
      expect(r).toEqual({ ok: false, reason: 'join_first', guildId: HUB, guildName: 'Ironhide Company' });
      expect(stamped()).toBe(false);
    }
    expect(log.some(l => l.op === 'update')).toBe(false);
  });

  it('someone else\'s discord id never reaches a membership: the player is looked up by the signed-in id', async () => {
    const r = await claim({ discordId: '299999999999999999' });
    expect(r).toMatchObject({ ok: false, reason: 'join_first' });
    expect(stamped()).toBe(false);
  });

  it('a Wolf Pack code (no hub) is not claimable here, however good the player\'s standing is', async () => {
    tables.mimic_link_codes[0].hub = null;
    expect(await claim()).toEqual({ ok: false, reason: 'wolfpack_code', guildId: undefined, guildName: undefined });
    expect(stamped()).toBe(false);
  });

  it('unknown, expired, suspended and unknown-guild codes are refused with their reason', async () => {
    expect(await claim({ userCode: 'ZZZZZZ' })).toMatchObject({ ok: false, reason: 'unknown_code' });
    tables.mimic_link_codes[0].expires_at = iso(NOW - 1);
    expect(await claim()).toMatchObject({ ok: false, reason: 'expired' });
    tables.mimic_link_codes[0].expires_at = iso(NOW + 600_000);
    tables.hub_guilds[0].suspended_at = iso(NOW - 1000);
    expect(await claim()).toMatchObject({ ok: false, reason: 'suspended', guildName: 'Ironhide Company' });
    tables.hub_guilds[0].suspended_at = null;
    tables.mimic_link_codes[0].hub = 'ghostguild';
    expect(await claim()).toMatchObject({ ok: false, reason: 'unknown_guild' });
    tables.mimic_link_codes[0].hub = 'Not A Slug';
    expect(await claim()).toMatchObject({ ok: false, reason: 'unknown_guild' });
    expect(stamped()).toBe(false);
  });

  it('a code that is already claimed is an idempotent success and is not rewritten', async () => {
    tables.mimic_link_codes[0].authorized_at = iso(NOW - 5000);
    tables.mimic_link_codes[0].authorized_discord_id = '555';
    const r = await claim();
    expect(r).toMatchObject({ ok: true, already: true, guildId: HUB });
    expect(tables.mimic_link_codes[0].authorized_discord_id).toBe('555');
    expect(log.some(l => l.op === 'update')).toBe(false);
  });

  it('losing the race to stamp is update_failed, and a second claim finds it taken', async () => {
    expect(await claim()).toMatchObject({ ok: true, already: false });
    // a second player's check ran before the first stamp landed: simulate by making the read look unclaimed
    const real = db.getCode;
    db.getCode = async (c) => ({ ...(await real(c)), authorized_at: null });
    const second = await claimHubCode(db, { userCode: CODE, userId: 'u-2', discordId: DISCORD, now: new Date(NOW) });
    expect(second).toMatchObject({ ok: false, reason: 'update_failed' });
    expect(tables.mimic_link_codes[0].authorized_user_id).toBe('u-1');
  });

  it('a failed read or write is an error, never a claim', async () => {
    tables._fail = 'hub_memberships';
    expect(await claim()).toEqual({ ok: false, reason: 'error', guildId: undefined, guildName: undefined });
    delete tables._fail;
    tables._fail = 'mimic_link_codes';
    expect(await claim()).toMatchObject({ ok: false, reason: 'error' });
  });

  it('checkHubLink reports the state the page shows before the button', async () => {
    expect(await checkHubLink(db, { userCode: CODE, discordId: DISCORD, now: new Date(NOW) })).toEqual({ state: 'claimable', guildId: HUB, guildName: 'Ironhide Company', role: 'member' });
    tables.hub_memberships.length = 0;
    expect(await checkHubLink(db, { userCode: CODE, discordId: DISCORD, now: new Date(NOW) })).toMatchObject({ state: 'refused', reason: 'join_first', guildName: 'Ironhide Company' });
  });

  it('cleanLinkCode upper-cases and drops the spaces and dashes a person types around a code', () => {
    expect(cleanLinkCode(' abc-234 ')).toBe('ABC234');
    expect(cleanLinkCode(null)).toBe('');
  });
});

// ── 3. The migration ─────────────────────────────────────────────────────────
describe('migration 20261031190000_mimic_link_hub.sql', () => {
  const file = path.join(ROOT, 'supabase', 'migrations', '20261031190000_mimic_link_hub.sql');
  const sql = stripSql(fs.readFileSync(file, 'utf8'));
  it('adds one nullable text column, IF NOT EXISTS, with nothing destructive and no NOT NULL', () => {
    expect(sql).toMatch(/ALTER TABLE mimic_link_codes\s+ADD COLUMN IF NOT EXISTS hub text\s*;/i);
    expect((sql.match(/ADD COLUMN\b/gi) || []).length).toBe(1);
    expect(sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i);
    expect(sql).not.toMatch(/NOT NULL|DEFAULT/i);
  });
  it('guards the slug check so a second apply is a no-op, and the check is the registry\'s slug shape', () => {
    expect(sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'mimic_link_codes_hub_slug_shape'\)/);
    expect(sql).toContain("CHECK (hub IS NULL OR hub ~ '^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$')");
    expect((sql.match(/ADD CONSTRAINT\b/gi) || []).length).toBe(1);
  });
  it('is the next migration in order (after the guild RLS foundation)', () => {
    const names = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).sort();
    expect(names.indexOf('20261031190000_mimic_link_hub.sql')).toBeGreaterThan(names.indexOf('20261031180000_guild_rls_foundation.sql'));
  });
});

// ── 4. The page, as text ─────────────────────────────────────────────────────
describe('/auth/mimic-link on a raidmimic host', () => {
  const raw = readSource(path.join(ROOT, 'web', 'app', 'auth', 'mimic-link', 'page.tsx'));
  const page = stripJs(raw);
  const hubPage = page.slice(page.indexOf('async function HubLinkPage('));
  const hubAction = page.slice(page.indexOf('async function authorizeHubCode('), page.indexOf('async function HubLinkPage('));

  it('the path is under /auth/, so the raidmimic hosts let it through to the normal session flow', () => {
    expect(isRaidmimicOpenPath('/auth/mimic-link')).toBe(true);
    expect(isRaidmimicOpenPath('/auth/signin')).toBe(true);
  });

  it('branches on the request host before the Wolf Pack signed-out/signed-in code', () => {
    const main = page.slice(page.indexOf('export default async function MimicLinkPage'));
    const branch = main.indexOf("if (isRaidmimicHost(headers().get('host'))) return <HubLinkPage user={user} searchParams={searchParams} />;");
    expect(branch).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(main.indexOf('if (!user) {'));
  });

  it('requires the open sign-in: signed out goes to /auth/signin with next = this page and the code', () => {
    expect(hubPage).toMatch(/if \(!user\) redirect\(`\/auth\/signin\?next=\$\{encodeURIComponent\('\/auth\/mimic-link' \+ \(codeOk \? `\?code=\$\{prefilled\}` : ''\)\)\}`\);/);
    expect(hubAction).toMatch(/if \(!user\) redirect\(`\/auth\/signin\?next=/);
  });

  it('claims through the guild-membership rules only, with the signed-in user\'s id and the Discord id from their session', () => {
    expect(hubAction).toMatch(/claimHubCode\(hubLinkDb\(supabaseAdmin\(\)\), \{ userCode, userId: user!\.id, discordId \}\)/);
    expect(hubAction).not.toMatch(/wolfpack_members/);
    expect(hubAction).not.toMatch(/\.from\('mimic_link_codes'\)/);   // the stamp goes through the rules, never straight from the action
    expect(page).toMatch(/String\(meta\.provider_id \?\? meta\.sub \?\? ''\)/);
  });

  it('tells a player who is not in the guild "Join <guild> first" and links to /guilds', () => {
    expect(hubPage).toMatch(/refusal\?\.reason === 'join_first'/);
    expect(hubPage).toMatch(/Join \{guildName\} first/);
    expect(hubPage).toMatch(/<Link href="\/guilds"/);
  });

  it('sends a Wolf Pack code to wolfpack.quest instead of claiming it', () => {
    expect(hubPage).toMatch(/refusal\?\.reason === 'wolfpack_code'/);
    expect(hubPage).toContain('https://wolfpack.quest/auth/mimic-link?code=');
  });

  it('the Wolf Pack page never reads the hub tables', () => {
    const wolf = page.slice(page.indexOf('async function authorizeCode('), page.indexOf('const HUB_ERROR_LABELS'));
    expect(wolf.length).toBeGreaterThan(2000);
    expect(wolf).not.toMatch(/hub_|hubLinkDb|claimHubCode|checkHubLink/);
  });

  // The pin. Normalised (comments stripped, whitespace collapsed) sha256 of the two Wolf Pack pieces, taken from origin/main
  // at 5ab8ecac on 2026-10-31: the authorizeCode action with the one raidmimic guard line removed, and MimicLinkPage from
  // its signed-out check to the end of the component. Change Wolf Pack's flow on purpose and re-pin it; change it by
  // accident and this fails.
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const sha = (s) => crypto.createHash('sha256').update(norm(s)).digest('hex').slice(0, 16);
  it('Wolf Pack hosts: the claim action and the page are byte-for-byte what main shipped (apart from the one guard line)', () => {
    const a0 = page.indexOf('async function authorizeCode(formData: FormData) {');
    const action = page.slice(a0, page.indexOf('\n}\n', a0) + 3);
    const guard = "if (isRaidmimicHost(headers().get('host'))) redirect('/auth/mimic-link?error=wrong_site');";
    expect(action).toContain(guard);
    expect(sha(action.replace(guard, ''))).toBe('99bfc86fad1a1e0b');

    const main = page.slice(page.indexOf('export default async function MimicLinkPage'));
    const p0 = main.indexOf('if (!user) {');
    const rest = main.slice(p0, main.indexOf('\n}\n', p0) + 3);
    expect(sha(rest)).toBe('eb20f3443a1ce7fc');
  });

  it('the one guard keeps a raidmimic-only account from posting to Wolf Pack\'s action', () => {
    expect(page).toMatch(/async function authorizeCode\(formData: FormData\) \{\s*'use server';\s*if \(isRaidmimicHost\(headers\(\)\.get\('host'\)\)\) redirect\('\/auth\/mimic-link\?error=wrong_site'\);/);
  });
});

// ── 5. The bot's index.js, as text ───────────────────────────────────────────
describe('index.js treats a hub session like a guest where another guild\'s data is at stake', () => {
  const idx = readSource(BOT_INDEX);
  const poll = stripJs(sliceBlock(idx, 'async function _handleAgentPoll(req, res) {', '\n}\n'));
  const upload = stripJs(sliceBlock(idx, 'async function _handleAgentUpload(req, res) {', '\n}\n'));

  it('the poll serves a hub session no stream, as it does a guest', () => {
    expect(poll).toMatch(/if \(identity\.hub_guild\) want\.clear\(\);/);
    expect(poll).toMatch(/if \(identity\.scope === 'guest'\) want\.clear\(\)/);
  });

  it('the upload keeps a hub session\'s parse but runs no member-keyed write or live side effect for it', () => {
    expect(upload).toMatch(/const isGuest\s*=\s*identity\.scope === 'guest' \|\| !!identity\.hub_guild;/);
    expect(upload).toMatch(/const isBackfill = payload\?\.backfill === true \|\| isGuest/);
  });

  it('the upload waits (503, which the agent retries) rather than write a hub session\'s parse under this process\'s guild', () => {
    const gate = upload.indexOf('if (identity.hub_guild && !guildDb) {');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(upload.indexOf('guildScoped.forIdentity('));
    expect(gate).toBeLessThan(upload.indexOf('for await (const chunk of req)'));
    expect(upload.slice(gate, gate + 200)).toMatch(/res\.writeHead\(503/);
  });

  it('the hub gate sits after the guest gate in requireAgentAuth and reads the allowlist, not the role', () => {
    const src = stripJs(readSource(path.join(ROOT, 'utils', 'mimicLink.js')));
    const body = src.slice(src.indexOf('async function requireAgentAuth('));
    const guest = body.indexOf("identity.scope === 'guest' && !guestRouteAllowed");
    const hub = body.indexOf('identity.hub_guild && !hubRouteAllowed(req.method, req.url)');
    expect(guest).toBeGreaterThan(-1);
    expect(hub).toBeGreaterThan(guest);
    expect(body.slice(hub, hub + 900)).not.toMatch(/is_officer|hub_role/);
  });
});
