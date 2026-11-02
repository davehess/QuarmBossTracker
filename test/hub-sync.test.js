// test/hub-sync.test.js — free PoP-flag syncing for players outside Wolf Pack (the guild lead, 2026-11-02, DECISIONS
// §526/§527: "we need to build that ASAP"; docs/DESIGN-raidmimic-hosted.md §8e: what costs us money is what we charge for).
//
// Slice 1 (the claimed tier). What is pinned, and how:
//   a. index.js's _handleAgentPopFlags hands a hub or player session to utils/hubSync.js BEFORE any Wolf Pack side effect
//      (a text check over the real handler, comments stripped).
//   b. utils/hubSync.js cannot reach a Wolf Pack surface (comment-stripped text: no kill, lockout, flag table, stats, card)
//      and touches exactly four tables.
//   c. the claim rule, as a pure function.
//   d. the free/paid gate in requireAgentAuth, run for real over a fake store: a free hub session is refused the parse
//      upload, a managed one is not, a player session may sync flags and nothing else.
//   e. the migration's shape: RLS on, no policy, revoked from anon and authenticated, no guild_id.
//   f. the upload end to end over a fake store, and the parity of its flag reading with the Wolf Pack handler's.
// Characters named here (Aldenmar, Brackwyn, Corvale) are invented.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BOT_INDEX, ROOT, readSource, sliceBlock, evalBlock, stripJs, stripSql } from './_source-slice.js';
import { claimHubCode, checkHubLink } from '../web/lib/mimicLinkHub.ts';

const nodeRequire = createRequire(BOT_INDEX);
const supabase = nodeRequire('./utils/supabase');
const mimicLink = nodeRequire('./utils/mimicLink');
const hubSync = nodeRequire('./utils/hubSync');
const S = nodeRequire('./utils/popFlagStages');
const lockout = nodeRequire('./utils/memberLockout');

const freshToken = () => 'wpms_' + crypto.randomBytes(32).toString('hex');
const iso = (ms) => new Date(ms).toISOString();

// ── a. the dispatch line precedes every Wolf Pack side effect ───────────────────────────────────────────────────
describe('_handleAgentPopFlags hands a hub or player session over before it does anything of Wolf Pack\'s', () => {
  const bot = readSource(BOT_INDEX);
  const handler = stripJs(sliceBlock(bot, 'async function _handleAgentPopFlags(req, res) {', '\n}\n'));
  const DISPATCH = "if (identity.hub_guild || identity.scope === 'player') return require('./utils/hubSync').handleRequest(";

  it('the dispatch line exists, comes right after the auth, and hands over the response', () => {
    const at = handler.indexOf(DISPATCH);
    const auth = handler.indexOf('await mimicLink.requireAgentAuth(req, res)');
    expect(at).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(auth);
    // nothing but the auth guard sits between them
    expect(handler.slice(auth, at).split('\n').map(l => l.trim()).filter(Boolean)).toEqual([
      'await mimicLink.requireAgentAuth(req, res);',
      'if (!identity) return;',
    ]);
  });

  it('every Wolf Pack side effect and read in the handler comes after it', () => {
    const at = handler.indexOf(DISPATCH);
    expect(at).toBeGreaterThan(-1);
    const effects = [
      'for await (const chunk of req)',   // the body is read by hubSync under the same limits
      "supabase.upsert('pop_flags'",
      '_callerOwnNames(',
      '_trackUpload(',
      '_hailGrants(',
      '_popStatusInst',
      "process.env.SUPABASE_GUILD_ID || 'wolfpack'",
      'guild_id:  guildId',
      "const supabase = require('./utils/supabase');",   // the dispatch line has its own require; this is the handler's
    ];
    for (const e of effects) {
      const i = handler.indexOf(e);
      expect(i, `${e} is in the handler`).toBeGreaterThan(-1);
      expect(i, `${e} comes after the dispatch`).toBeGreaterThan(at);
    }
  });

  it('the poll serves a player session no stream (it would otherwise be handed Wolf Pack\'s triggers and tuning)', () => {
    const poll = stripJs(sliceBlock(bot, 'async function _handleAgentPoll(req, res) {', '\n}\n'));
    const clear = poll.indexOf("if (identity.scope === 'player') want.clear();");
    expect(clear).toBeGreaterThan(-1);
    expect(clear).toBeLessThan(poll.indexOf("if (themeWanted) want.add('theme');"));
    expect(clear).toBeLessThan(poll.indexOf('_overlayTuningMap()'));
  });

  it('the dispatch passes the stage tables and the boss map from index.js, not copies', () => {
    const at = handler.indexOf(DISPATCH);
    const line = handler.slice(at, handler.indexOf('\n', at));
    expect(line).toContain('popFlagStages');
    expect(line).toContain('bossFlagMap: POP_FLAG_BY_BOSS');
    expect(line).toContain('bossKey: _popBossKey');
  });
});

// ── b. utils/hubSync.js reaches nothing of Wolf Pack's ──────────────────────────────────────────────────────────
describe('utils/hubSync.js', () => {
  const src = stripJs(readSource(path.join(ROOT, 'utils', 'hubSync.js')));

  it('never mentions a kill, a lockout, the guild flag table, upload stats or a kill card', () => {
    for (const rx of [/recordKill/, /character_lockouts/, /from\(\s*['"`]pop_flags['"`]/, /['"`]pop_flags['"`]/, /agent_upload_stats/, /postKillUpdate/,
      /_trackUpload/, /_hailGrants/, /hail_board|hailBoard/, /popStatus/, /bosskill/i, /encounters?\b['"`]/]) {
      expect(src, String(rx)).not.toMatch(rx);
    }
  });

  it('reads and writes exactly four tables: hub_players, characters (Wolf Pack\'s link, read-only), hub_characters, hub_flags', () => {
    const calls = [...src.matchAll(/supabase\.(select|update|insertIgnoreDuplicates|insert|upsert|del)\(\s*'([a-z_]+)'/g)].map(m => [m[1], m[2]]);
    expect(calls.length).toBeGreaterThan(4);
    expect([...new Set(calls.map(c => c[1]))].sort()).toEqual(['characters', 'hub_characters', 'hub_flags', 'hub_players']);
    // Wolf Pack's table is only ever read
    expect(calls.filter(c => c[1] === 'characters').map(c => c[0])).toEqual(['select']);
  });

  it('reads Wolf Pack\'s characters scoped to its own guild', () => {
    const at = src.indexOf("supabase.select('characters'");
    expect(src.slice(at, at + 160)).toMatch(/guild_id=eq\./);
  });
});

// ── c. the claim rule ───────────────────────────────────────────────────────────────────────────────────────────
describe('decideClaim', () => {
  const ME = { playerId: 'p-1', discordId: '2100' };
  const call = (over = {}) => hubSync.decideClaim({ ...ME, wolfpackDiscordId: undefined, holders: [], ...over });

  it('claims a name nobody holds and Wolf Pack does not link', () => {
    expect(call()).toEqual({ verdict: 'claimed', proof: 'claimed' });
    expect(call({ wolfpackDiscordId: null })).toEqual({ verdict: 'claimed', proof: 'claimed' });   // a Wolf Pack row with no Discord link
    expect(call({ wolfpackDiscordId: '' })).toEqual({ verdict: 'claimed', proof: 'claimed' });
  });

  it('refuses a name Wolf Pack links to another Discord id', () => {
    expect(call({ wolfpackDiscordId: '9999' })).toEqual({ verdict: 'refused', reason: 'wolfpack_linked' });
    // however the holders look
    expect(call({ wolfpackDiscordId: '9999', holders: [{ player_id: 'p-1', proof: 'claimed' }] }).verdict).toBe('refused');
  });

  it('claims a name Wolf Pack links to this player\'s own Discord id (numbers compare as text)', () => {
    expect(call({ wolfpackDiscordId: '2100' }).verdict).toBe('claimed');
    expect(call({ wolfpackDiscordId: 2100 }).verdict).toBe('claimed');
  });

  it('contests a name another player already holds, for both', () => {
    expect(call({ holders: [{ player_id: 'p-2', proof: 'claimed' }] })).toEqual({ verdict: 'contested', proof: 'contested' });
    expect(call({ holders: [{ player_id: 'p-2', proof: 'contested' }, { player_id: 'p-3', proof: 'contested' }] }).verdict).toBe('contested');
    expect(call({ holders: [{ player_id: 'p-1', proof: 'claimed' }, { player_id: 'p-2', proof: 'claimed' }] }).verdict).toBe('contested');
  });

  it('keeps what the player already holds: claimed stays claimed, contested stays contested, proven stays proven', () => {
    expect(call({ holders: [{ player_id: 'p-1', proof: 'claimed' }] })).toEqual({ verdict: 'claimed', proof: 'claimed' });
    expect(call({ holders: [{ player_id: 'p-1', proof: 'contested' }] })).toEqual({ verdict: 'contested', proof: 'contested' });
    expect(call({ holders: [{ player_id: 'p-1', proof: 'proven' }, { player_id: 'p-2', proof: 'claimed' }] })).toEqual({ verdict: 'claimed', proof: 'proven' });
  });

  it('refuses a claim against another player\'s proven character', () => {
    expect(call({ holders: [{ player_id: 'p-2', proof: 'proven' }] })).toEqual({ verdict: 'refused', reason: 'held_by_other' });
  });
});

// ── d. the free/paid gate, run for real ─────────────────────────────────────────────────────────────────────────
const fakeRes = () => ({ status: null, headers: null, body: null, writeHead(s, h) { this.status = s; this.headers = h; }, end(b) { this.body = b; } });

describe('requireAgentAuth: free routes for every hub session, the parse upload only for a managed guild', () => {
  const DISCORD = '210000000000000001';
  const HUB = 'ironhide';
  let sessionRow, tables, reads, saved;
  beforeEach(() => {
    saved = {};
    for (const k of ['isEnabled', 'select', 'update']) saved[k] = supabase[k];
    supabase.isEnabled = () => true;
    supabase.update = async () => [];
    lockout._setForTest([]);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    reads = [];
    sessionRow = { user_id: 'u-1', discord_id: DISCORD, revoked_at: null, guild_id: HUB };
    tables = {
      hub_guilds: [{ guild_id: HUB, suspended_at: null, plan: 'commons' }],
      hub_players: [{ discord_id: DISCORD, player_id: 'p-1', display_name: 'Aldenmar', deleted_at: null }],
      hub_memberships: [{ guild_id: HUB, player_id: 'p-1', role: 'owner', left_at: null }],
      wolfpack_members: [{ nickname: 'Brackwyn', role_names: ['Officer'] }],
    };
    supabase.select = async (table) => {
      reads.push(table);
      if (table === 'mimic_sessions') return [sessionRow];
      if (table in tables) return tables[table];
      return [];
    };
  });
  afterEach(() => {
    for (const k of Object.keys(saved)) supabase[k] = saved[k];
    vi.restoreAllMocks();
    lockout._setForTest([]);
  });
  function call(method, url) {
    // the request has no body stream: a handler that tried to read one would throw, so a refusal is proven to come first
    const req = { method, url, headers: { authorization: `Bearer ${freshToken()}` }, socket: { remoteAddress: '203.0.113.9' } };
    const res = fakeRes();
    return mimicLink.requireAgentAuth(req, res).then((identity) => ({ identity, res, body: res.body ? JSON.parse(res.body) : null }));
  }
  const FREE = [['POST', '/api/agent/pop_flags'], ['GET', '/api/agent/poll?streams=tuning'], ['GET', '/api/agent/latest-version?channel=beta']];
  const NOT_LISTED = [
    ['POST', '/api/agent/chat'], ['POST', '/api/agent/live-state'], ['POST', '/api/agent/buff_casts'], ['POST', '/api/agent/place-bid'],
    ['POST', '/api/agent/bosskill'], ['POST', '/api/agent/lockout'], ['POST', '/api/agent/tells'], ['POST', '/api/agent/quarmy'],
    ['POST', '/api/agent/trigger'], ['POST', '/api/agent/who-override'], ['POST', '/api/agent/hail-mark'], ['POST', '/api/agent/rescan-done'],
    ['GET', '/api/agent/guild-triggers'], ['GET', '/api/agent/recent-fires'], ['GET', '/api/agent/reporter-poll'], ['GET', '/api/agent/hail-board'],
    ['GET', '/api/agent/raid-fights'], ['GET', '/api/agent/encounter'], ['GET', '/api/agent/pop_flags'], ['POST', '/api/agent/poll'],
    ['POST', '/api/agent/encounter/extra'], ['POST', '/api/agent/pop_flags/extra'], ['GET', '/api/me'], ['POST', '/api/admin/anything'],
  ];

  it('a FREE guild (commons) session: the free routes pass, the parse upload is 403 plan_required, every other stream is 403 hub_scope', async () => {
    for (const [m, u] of FREE) {
      const r = await call(m, u);
      expect(r.identity, `${m} ${u}`).toMatchObject({ hub_guild: HUB, hub_plan: 'commons' });
      expect(r.res.status).toBeNull();
    }
    const enc = await call('POST', '/api/agent/encounter');
    expect(enc.identity).toBeNull();
    expect(enc.res.status).toBe(403);
    expect(enc.body.error).toBe('plan_required');
    for (const [m, u] of NOT_LISTED) {
      const r = await call(m, u);
      expect(r.identity, `${m} ${u}`).toBeNull();
      expect(r.res.status, `${m} ${u}`).toBe(403);
      expect(r.body.error, `${m} ${u}`).toBe('hub_scope');
    }
  });

  it('a self-hosted guild is free as well: only the managed plan is paid', async () => {
    tables.hub_guilds[0].plan = 'self_hosted';
    expect((await call('POST', '/api/agent/encounter')).body.error).toBe('plan_required');
  });

  it('a MANAGED guild session may also upload parses; nothing else changes for it', async () => {
    tables.hub_guilds[0].plan = 'managed';
    for (const [m, u] of [...FREE, ['POST', '/api/agent/encounter']]) {
      const r = await call(m, u);
      expect(r.identity, `${m} ${u}`).toMatchObject({ hub_guild: HUB, hub_plan: 'managed' });
    }
    for (const [m, u] of NOT_LISTED) {
      const r = await call(m, u);
      expect(r.res.status, `${m} ${u}`).toBe(403);
      expect(r.body.error).toBe('hub_scope');
    }
  });

  it('a hub role never buys a paid route: a free guild\'s owner is still refused the parse upload', async () => {
    tables.hub_memberships[0].role = 'owner';
    const r = await call('POST', '/api/agent/encounter');
    expect(r.identity).toBeNull();
    expect(r.body.error).toBe('plan_required');
  });

  describe('a player session (no guild)', () => {
    beforeEach(() => {
      sessionRow = { user_id: 'u-1', discord_id: DISCORD, revoked_at: null, scope: 'player', guild_id: mimicLink.PLAYER_HUB };
    });

    it('resolves through hub_players alone: no guild, no roster, no wolfpack_members, and a marker for a guild id', async () => {
      const r = await call('POST', '/api/agent/pop_flags');
      expect(r.identity).toMatchObject({
        scope: 'player', player_id: 'p-1', hub_guild: null, hub_player: true, discord_id: DISCORD,
        is_officer: false, role_names: [], guild_id: '~player',
      });
      expect(reads).toContain('hub_players');
      for (const t of ['hub_guilds', 'hub_memberships', 'wolfpack_members']) expect(reads, t).not.toContain(t);
    });

    it('may sync flags, poll and check for updates; the parse upload is plan_required; everything else is hub_scope', async () => {
      for (const [m, u] of FREE) expect((await call(m, u)).identity, `${m} ${u}`).toMatchObject({ scope: 'player' });
      const enc = await call('POST', '/api/agent/encounter');
      expect(enc.identity).toBeNull();
      expect(enc.res.status).toBe(403);
      expect(enc.body.error).toBe('plan_required');
      for (const [m, u] of NOT_LISTED) {
        const r = await call(m, u);
        expect(r.identity, `${m} ${u}`).toBeNull();
        expect(r.res.status, `${m} ${u}`).toBe(403);
        expect(r.body.error, `${m} ${u}`).toBe('hub_scope');
      }
    });

    it('a deleted hub account ends the session like a revoke', async () => {
      tables.hub_players[0].deleted_at = iso(Date.now() - 1000);
      expect((await call('POST', '/api/agent/pop_flags')).res.status).toBe(401);
      tables.hub_players.length = 0;
      expect((await call('POST', '/api/agent/pop_flags')).res.status).toBe(401);
    });

    it('is not mistaken for a Wolf Pack member: a locked Discord id gets nothing either', async () => {
      lockout._setForTest([{ discord_id: DISCORD, until: null }]);
      expect((await call('POST', '/api/agent/pop_flags')).res.status).toBe(401);
    });
  });
});

describe('the link: a player link is minted with no membership read', () => {
  const DISCORD = '210000000000000001';
  let codeRow, sessions, deleted, reads, saved, lastIp = 0;
  const jsonReq = (body) => {
    const ip = `203.0.113.${(++lastIp % 250) + 1}`;
    return {
      headers: { 'x-real-ip': ip }, socket: { remoteAddress: ip },
      on(ev, fn) { if (ev === 'data') setImmediate(() => fn(JSON.stringify(body))); if (ev === 'end') setImmediate(() => setImmediate(fn)); return this; },
    };
  };
  beforeEach(() => {
    saved = {};
    for (const k of ['isEnabled', 'select', 'update', 'insert', 'del']) saved[k] = supabase[k];
    supabase.isEnabled = () => true;
    supabase.update = async () => [];
    lockout._setForTest([]);
    sessions = []; deleted = []; reads = [];
    codeRow = {
      user_code: 'ABC234', device_code: 'd'.repeat(64), expires_at: iso(Date.now() + 600_000), hub: '~player',
      authorized_at: iso(Date.now() - 1000), authorized_user_id: 'u-1', authorized_discord_id: DISCORD, agent_version: 'mimic 4.0.0',
    };
    supabase.select = async (table) => {
      reads.push(table);
      if (table === 'mimic_link_codes') return [codeRow];
      if (table === 'hub_players') return [{ discord_id: DISCORD, player_id: 'p-1', display_name: 'Aldenmar', deleted_at: null }];
      return [];
    };
    supabase.insert = async (table, rows) => { sessions.push({ table, row: rows[0] }); return [{ id: 'sess-1' }]; };
    supabase.del = async (table, q) => { deleted.push([table, q]); return []; };
  });
  afterEach(() => { for (const k of Object.keys(saved)) supabase[k] = saved[k]; lockout._setForTest([]); });
  const poll = async () => { const res = fakeRes(); await mimicLink.handlePoll(jsonReq({ device_code: 'd'.repeat(64) }), res); return JSON.parse(res.body); };

  it('start accepts {player:true}: the code row carries ~player, the answer says player and uses the hosted site', async () => {
    const inserted = [];
    supabase.insert = async (table, rows) => { inserted.push({ table, row: rows[0] }); return [{ id: 1 }]; };
    const res = fakeRes();
    await mimicLink.handleStart(jsonReq({ player: true, agent_version: 'mimic 4.0.0' }), res);
    expect(res.status).toBe(200);
    const out = JSON.parse(res.body);
    expect(inserted[0].row.hub).toBe('~player');
    expect(out.player).toBe(true);
    expect('hub' in out).toBe(false);
    expect(out.verification_url).toBe('https://raidmimic.com/auth/mimic-link');
  });

  it('start refuses a player link that also names a guild, and a client cannot send ~player as a hub', async () => {
    for (const body of [{ player: true, hub: 'ironhide' }, { hub: '~player' }, { player: 'yes', hub: '~player' }]) {
      const inserted = [];
      supabase.insert = async (t, rows) => { inserted.push(rows[0]); return [{ id: 1 }]; };
      const res = fakeRes();
      await mimicLink.handleStart(jsonReq(body), res);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(inserted).toEqual([]);
    }
  });

  it('a stamped player code mints a scope player session with the ~player marker and reads no guild table', async () => {
    const out = await poll();
    expect(sessions[0].row).toMatchObject({ scope: 'player', guild_id: '~player', discord_id: DISCORD, user_id: 'u-1' });
    expect(out).toMatchObject({ status: 'linked', scope: 'player', discord_id: DISCORD, display_name: 'Aldenmar', is_officer: false, role_names: [] });
    expect('guild_id' in out).toBe(false);
    expect(deleted).toHaveLength(1);
    for (const t of ['hub_guilds', 'hub_memberships', 'wolfpack_members']) expect(reads, t).not.toContain(t);
  });

  it('a stamp without a live hub account mints nothing; a failed read keeps the code', async () => {
    const real = supabase.select;
    supabase.select = async (t, q) => (t === 'hub_players' ? [] : real(t, q));
    expect(await poll()).toEqual({ status: 'expired' });
    expect(sessions).toEqual([]);
    supabase.select = async (t, q) => (t === 'hub_players' ? null : real(t, q));
    deleted.length = 0;
    expect(await poll()).toEqual({ status: 'pending' });
    expect(deleted).toEqual([]);
  });

  it('a guest approval never becomes a player session', async () => {
    Object.assign(codeRow, { authorized_via: 'guest', guest_label: 'Corvale', guest_expires_at: iso(Date.now() + 3600_000) });
    expect(await poll()).toEqual({ status: 'expired' });
    expect(sessions).toEqual([]);
  });
});

// ── the website half: any signed-in player claims a player code ─────────────────────────────────────────────────
describe('web/lib/mimicLinkHub.ts: the player branch', () => {
  const NOW = Date.UTC(2026, 10, 2, 20, 0, 0);
  let code, player, stamps, consulted;
  const db = () => ({
    getCode: async () => code,
    getGuild: async () => { consulted.push('guild'); return null; },
    getPlayer: async () => { consulted.push('player'); return player; },
    getMembership: async () => { consulted.push('membership'); return null; },
    stampCode: async (c, s) => { stamps.push(s); return true; },
  });
  beforeEach(() => {
    consulted = []; stamps = [];
    code = { user_code: 'ABC234', expires_at: iso(NOW + 600_000), authorized_at: null, hub: '~player' };
    player = { player_id: 'p-1', deleted_at: null };
  });
  const args = { userCode: 'ABC234', userId: 'u-1', discordId: '2100', now: new Date(NOW) };

  it('a signed-in player with a hub account claims it with no guild and no membership read', async () => {
    const r = await claimHubCode(db(), args);
    expect(r.ok).toBe(true);
    expect(stamps).toEqual([{ userId: 'u-1', discordId: '2100', at: iso(NOW) }]);
    expect(consulted).toEqual(['player']);
  });

  it('check says claimable with the player marker, so the page can word it for no guild', async () => {
    expect(await checkHubLink(db(), args)).toMatchObject({ state: 'claimable', player: true, guildId: '~player' });
  });

  it('no hub account, or a deleted one, is refused and the code is left unstamped', async () => {
    player = null;
    expect(await claimHubCode(db(), args)).toMatchObject({ ok: false, reason: 'no_account' });
    player = { player_id: 'p-1', deleted_at: iso(NOW - 1) };
    expect(await claimHubCode(db(), args)).toMatchObject({ ok: false, reason: 'no_account' });
    expect(stamps).toEqual([]);
  });

  it('an expired or already-claimed player code behaves like any other', async () => {
    code.expires_at = iso(NOW - 1);
    expect(await claimHubCode(db(), args)).toMatchObject({ ok: false, reason: 'expired' });
    code.expires_at = iso(NOW + 600_000);
    code.authorized_at = iso(NOW - 5000);
    expect(await claimHubCode(db(), args)).toMatchObject({ ok: true, already: true });
    expect(stamps).toEqual([]);
  });
});

// ── e. the migration ────────────────────────────────────────────────────────────────────────────────────────────
describe('20261102210000_hub_sync.sql', () => {
  const raw = readSource(path.join(ROOT, 'supabase', 'migrations', '20261102210000_hub_sync.sql'));
  const sql = stripSql(raw);
  const block = (name) => sql.slice(sql.indexOf(`create table if not exists public.${name}`), sql.indexOf(');', sql.indexOf(`create table if not exists public.${name}`)) + 2);

  it('creates both tables idempotently, with the unique keys the upload relies on and no guild_id', () => {
    for (const t of ['hub_characters', 'hub_flags']) {
      expect(sql, t).toMatch(new RegExp(`create table if not exists public\\.${t} \\(`));
      expect(block(t), t).not.toMatch(/guild_id/);
      expect(block(t), t).toMatch(/references public\.hub_players \(player_id\)/);
    }
    expect(block('hub_characters')).toMatch(/unique \(player_id, name_lc\)/);
    expect(block('hub_characters')).toMatch(/proof in \('claimed', 'proven', 'contested'\)/);
    expect(block('hub_characters')).toMatch(/proof\s+text\s+not null default 'claimed'/);
    expect(block('hub_flags')).toMatch(/unique \(player_id, name_lc, flag_key, earned_at\)/);
    expect(sql).toMatch(/create index if not exists hub_characters_name_lc_idx/);
  });

  it('RLS on, revoked from anon and authenticated, and no policy and no grant to anyone', () => {
    for (const t of ['hub_characters', 'hub_flags']) {
      expect(sql, t).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security;`));
      expect(sql, t).toMatch(new RegExp(`revoke all on public\\.${t}\\s+from anon, authenticated;`));
    }
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/\bgrant\b/i);
  });

  it('lets the link code carry ~player, re-runnably, and still refuses any other non-slug', () => {
    expect(sql).toMatch(/drop constraint if exists mimic_link_codes_hub_slug_shape;/);
    expect(sql).toMatch(/hub is null or hub = '~player' or hub ~ '\^\[a-z0-9\]\[a-z0-9-\]\{1,22\}\[a-z0-9\]\$'/);
    // '~' is outside the slug alphabet, so the marker cannot be a guild
    expect('~player').not.toMatch(/^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$/);
  });

  // It sorts after the migrations it builds on (hub_players, the link codes); later migrations may follow it. (It used to
  // assert "is the newest", which the next migration of any kind broke.)
  it('sorts after the hub registry and the link-code migrations it alters', () => {
    const files = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter(f => f.endsWith('.sql')).sort();
    const at = files.indexOf('20261102210000_hub_sync.sql');
    expect(at).toBeGreaterThan(-1);
    for (const dep of files.filter(f => /open_hub_registry|mimic_link/.test(f))) expect(files.indexOf(dep), dep).toBeLessThan(at);
  });

  it('the guild-scope tooling leaves them alone: they are person tables, not in the guild-table snapshot', () => {
    const tables = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'guild-tables.json'), 'utf8')).tables;
    expect(tables).not.toContain('hub_flags');
    expect(tables).not.toContain('hub_characters');
  });
});

// ── f. the upload over a fake store ─────────────────────────────────────────────────────────────────────────────
function fakeStore({ characters = [], holders = [], players, failOn = {} } = {}) {
  const calls = [];
  const flagKeys = new Set();
  const inserted = { hub_characters: [], hub_flags: [] };
  const db = {
    calls, inserted,
    guildId: () => 'wolfpack',
    async select(table, q) {
      calls.push({ op: 'select', table, q });
      if (failOn.select === table) return null;
      if (table === 'hub_players') return players === undefined ? [{ player_id: 'p-1', deleted_at: null }] : players;
      if (table === 'characters') return characters;
      if (table === 'hub_characters') return holders.filter(h => q.includes(h.name_lc));
      return [];
    },
    async insertIgnoreDuplicates(table, rows) {
      calls.push({ op: 'insert', table, rows });
      if (failOn.insert === table) return null;
      const fresh = [];
      for (const r of rows) {
        const k = table === 'hub_flags' ? `${r.player_id}|${r.name_lc}|${r.flag_key}|${r.earned_at}` : `${r.player_id}|${r.name_lc}`;
        if (table === 'hub_flags') { if (flagKeys.has(k)) continue; flagKeys.add(k); }
        fresh.push(r);
      }
      inserted[table].push(...fresh);
      return fresh;
    },
    async update(table, q, body) {
      calls.push({ op: 'update', table, q, body });
      return failOn.update === table ? null : [];
    },
  };
  return db;
}
const botMaps = (() => {
  const bot = readSource(BOT_INDEX);
  return evalBlock(sliceBlock(bot, 'const POP_FLAG_BY_BOSS = {', ".replace(/_/g, ' ').toLowerCase() : '');"), ['POP_FLAG_BY_BOSS', '_popBossKey']);
})();
const depsFor = (supabaseFake) => ({ supabase: supabaseFake, popFlagStages: S, bossFlagMap: botMaps.POP_FLAG_BY_BOSS, bossKey: botMaps._popBossKey });
const ME = { discord_id: '2100', player_id: 'p-1' };
const grummus = (name, extra = {}) => ({ character: name, ts: '2026-10-01T20:00:00Z', zone: '205', boss: 'Grummus', ...extra });
const mavuin3 = (name) => ({ character: name, ts: '2026-10-01T20:05:00Z', kind: 'grant', zone: '201', prev: "Mavuin tells you, 'So you have pleaded my case to the Tribunal" });

describe('handlePopFlags', () => {
  it('claims the character, stores its flags in hub_flags keyed by the player, and answers stored/refused', async () => {
    const db = fakeStore();
    const out = await hubSync.handlePopFlags(ME, { events: [grummus('Aldenmar'), mavuin3('Aldenmar')] }, depsFor(db));
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true, stored: db.inserted.hub_flags.length, refused: [] });
    expect(db.inserted.hub_characters).toHaveLength(1);
    expect(db.inserted.hub_characters[0]).toMatchObject({ player_id: 'p-1', name: 'Aldenmar', name_lc: 'aldenmar', proof: 'claimed' });
    const keys = db.inserted.hub_flags.map(r => r.flag_key).sort();
    expect(keys).toEqual(['fuirstel_2', 'grummus_dead', 'mavuin_3', 'trial_justice']);
    for (const r of db.inserted.hub_flags) {
      expect(r).toMatchObject({ player_id: 'p-1', character: 'Aldenmar', name_lc: 'aldenmar' });
      expect(Object.keys(r).sort()).toEqual(['character', 'earned_at', 'flag_key', 'name_lc', 'player_id', 'source', 'stage']);   // no guild_id, no zone, no boss
    }
    // the character is written before its flags
    const order = db.calls.filter(c => c.op === 'insert').map(c => c.table);
    expect(order).toEqual(['hub_characters', 'hub_flags']);
  });

  it('touches only hub_players, characters (read), hub_characters and hub_flags', async () => {
    const db = fakeStore({ holders: [{ player_id: 'p-1', name_lc: 'brackwyn', proof: 'claimed' }] });
    await hubSync.handlePopFlags({ discord_id: '2100' }, { events: [grummus('Aldenmar'), grummus('Brackwyn')] }, depsFor(db));
    expect([...new Set(db.calls.map(c => c.table))].sort()).toEqual(['characters', 'hub_characters', 'hub_flags', 'hub_players']);
    expect(db.calls.filter(c => c.table === 'characters').map(c => c.op)).toEqual(['select']);
  });

  it('refuses a character Wolf Pack links to another Discord id: no rows for it, the others still stored, the name reported', async () => {
    const db = fakeStore({ characters: [{ name: 'Brackwyn', discord_id: '9999' }] });
    const out = await hubSync.handlePopFlags(ME, { events: [grummus('Aldenmar'), grummus('brackwyn'), mavuin3('BRACKWYN')] }, depsFor(db));
    expect(out.status).toBe(200);
    expect(out.body.refused).toEqual(['brackwyn']);
    expect(db.inserted.hub_flags.every(r => r.name_lc === 'aldenmar')).toBe(true);
    expect(db.inserted.hub_characters.map(r => r.name_lc)).toEqual(['aldenmar']);
  });

  it('refuses everything and writes nothing when every character is Wolf Pack\'s', async () => {
    const db = fakeStore({ characters: [{ name: 'Aldenmar', discord_id: '9999' }] });
    const out = await hubSync.handlePopFlags(ME, { events: [grummus('Aldenmar')] }, depsFor(db));
    expect(out.body).toEqual({ ok: true, stored: 0, refused: ['Aldenmar'] });
    expect(db.calls.some(c => c.op === 'insert' || c.op === 'update')).toBe(false);
  });

  it('a Wolf Pack link to this player\'s own Discord id is not a refusal; an unlinked Wolf Pack row is not either', async () => {
    const db = fakeStore({ characters: [{ name: 'Aldenmar', discord_id: '2100' }, { name: 'Brackwyn', discord_id: null }] });
    const out = await hubSync.handlePopFlags(ME, { events: [grummus('Aldenmar'), grummus('Brackwyn')] }, depsFor(db));
    expect(out.body.refused).toEqual([]);
    expect(db.inserted.hub_characters.map(r => r.name_lc).sort()).toEqual(['aldenmar', 'brackwyn']);
  });

  it('asks Wolf Pack\'s characters only about the uploaded names, scoped to its guild, with a bound', async () => {
    const db = fakeStore();
    await hubSync.handlePopFlags(ME, { events: [grummus('Aldenmar')] }, depsFor(db));
    const q = db.calls.find(c => c.table === 'characters').q;
    expect(q).toContain('guild_id=eq.wolfpack');
    expect(q).toContain('name.ilike.aldenmar');
    expect(q).toMatch(/limit=\d+/);
  });

  it('a name another player already holds: both are contested, the rows are still stored', async () => {
    const db = fakeStore({ holders: [{ player_id: 'p-2', name_lc: 'aldenmar', proof: 'claimed' }] });
    const out = await hubSync.handlePopFlags(ME, { events: [grummus('Aldenmar')] }, depsFor(db));
    expect(out.body.refused).toEqual([]);
    expect(out.body.stored).toBeGreaterThan(0);
    expect(db.inserted.hub_characters[0]).toMatchObject({ player_id: 'p-1', proof: 'contested' });
    const flip = db.calls.find(c => c.op === 'update' && c.body && c.body.proof === 'contested');
    expect(flip).toBeTruthy();
    expect(flip.q).toContain('name_lc=in.(aldenmar)');
    expect(flip.q).toContain('proof=eq.claimed');   // a proven row is never flipped
  });

  it('a name another player has PROVEN is refused', async () => {
    const db = fakeStore({ holders: [{ player_id: 'p-2', name_lc: 'aldenmar', proof: 'proven' }] });
    const out = await hubSync.handlePopFlags(ME, { events: [grummus('Aldenmar')] }, depsFor(db));
    expect(out.body).toMatchObject({ stored: 0, refused: ['Aldenmar'] });
    expect(db.inserted.hub_flags).toEqual([]);
  });

  it('a character the player already holds is not inserted again; only its last_seen_at moves', async () => {
    const db = fakeStore({ holders: [{ player_id: 'p-1', name_lc: 'aldenmar', proof: 'claimed' }] });
    await hubSync.handlePopFlags(ME, { events: [grummus('Aldenmar')] }, depsFor(db));
    expect(db.inserted.hub_characters).toEqual([]);
    const upd = db.calls.find(c => c.op === 'update');
    expect(upd).toMatchObject({ table: 'hub_characters' });
    expect(upd.q).toContain('player_id=eq.p-1');
    expect(Object.keys(upd.body)).toEqual(['last_seen_at']);
  });

  it('a second upload of the same events stores nothing new', async () => {
    const db = fakeStore();
    const events = [grummus('Aldenmar')];
    const first = await hubSync.handlePopFlags(ME, { events }, depsFor(db));
    const second = await hubSync.handlePopFlags(ME, { events }, depsFor(db));
    expect(first.body.stored).toBeGreaterThan(0);
    expect(second.body.stored).toBe(0);
  });

  it('drops a witnessed hail and an event the tables cannot name (no unmapped funnel for the free tier)', async () => {
    const db = fakeStore();
    const out = await hubSync.handlePopFlags(ME, { events: [
      { character: 'Aldenmar', ts: '2026-10-01T20:00:00Z', source: 'hail_witnessed', npc: 'Mavuin', zone: '201' },
      { character: 'Aldenmar', ts: '2026-10-01T20:00:00Z', zone: '201' },
      { character: 'Aldenmar', ts: '2026-10-01T20:00:00Z', kind: 'recital', text: 'Some other line.' },
    ] }, depsFor(db));
    expect(out.body).toEqual({ ok: true, stored: 0, refused: [] });
    expect(db.calls.some(c => c.op === 'insert')).toBe(false);
  });

  it('drops a bad name, a bad time and a time a day ahead, and never puts a bad name in a query', async () => {
    const db = fakeStore();
    const future = new Date(Date.now() + 3 * 86400_000).toISOString();
    const out = await hubSync.handlePopFlags(ME, { events: [
      grummus('Ald;DROP'), grummus('A'), grummus('x'.repeat(30)), grummus('Aldenmar', { ts: 'nope' }), grummus('Aldenmar', { ts: future }),
      grummus('Corvale'),
    ] }, depsFor(db));
    expect(out.status).toBe(200);
    expect(db.inserted.hub_characters.map(r => r.name_lc)).toEqual(['corvale']);
    expect(JSON.stringify(db.calls)).not.toMatch(/DROP|xxxxxxxx/);
  });

  it('a failed read or write is a retryable 503 (a 4xx would be dropped by the agent\'s queue) and nothing half-written is reported stored', async () => {
    for (const failOn of [{ select: 'characters' }, { select: 'hub_characters' }, { insert: 'hub_characters' }, { insert: 'hub_flags' }, { update: 'hub_characters' }]) {
      const db = fakeStore({ failOn, holders: [{ player_id: 'p-1', name_lc: 'aldenmar', proof: 'claimed' }] });
      const out = await hubSync.handlePopFlags(ME, { events: [grummus('Aldenmar'), grummus('Corvale')] }, depsFor(db));
      expect(out.status, JSON.stringify(failOn)).toBe(503);
      expect(out.body).toMatchObject({ error: 'store_unavailable', retry: true });
    }
  });

  it('a session without a player id is looked up; no live hub account is a 403, a failed read a 503', async () => {
    const ok = fakeStore();
    expect((await hubSync.handlePopFlags({ discord_id: '2100' }, { events: [grummus('Aldenmar')] }, depsFor(ok))).status).toBe(200);
    expect(ok.inserted.hub_flags[0].player_id).toBe('p-1');
    expect((await hubSync.handlePopFlags({ discord_id: '2100' }, { events: [grummus('Aldenmar')] }, depsFor(fakeStore({ players: [] })))).status).toBe(403);
    expect((await hubSync.handlePopFlags({ discord_id: '2100' }, { events: [grummus('Aldenmar')] }, depsFor(fakeStore({ players: [{ player_id: 'p-1', deleted_at: 'x' }] })))).status).toBe(403);
    expect((await hubSync.handlePopFlags({ discord_id: '2100' }, { events: [grummus('Aldenmar')] }, depsFor(fakeStore({ failOn: { select: 'hub_players' } })))).status).toBe(503);
  });

  it('an empty body is a quiet 200 with no reads', async () => {
    const db = fakeStore();
    expect((await hubSync.handlePopFlags(ME, { events: [] }, depsFor(db))).body).toEqual({ ok: true, stored: 0, refused: [] });
    expect((await hubSync.handlePopFlags(ME, null, depsFor(db))).status).toBe(200);
    expect(db.calls).toEqual([]);
  });
});

describe('handleRequest keeps the Wolf Pack handler\'s body limits', () => {
  const reqOf = (...bufs) => ({ [Symbol.asyncIterator]: async function* () { for (const b of bufs) yield b; } });
  const run = async (req, db = fakeStore()) => {
    const res = fakeRes();
    await hubSync.handleRequest(req, res, ME, depsFor(db));
    return { res, db };
  };

  it('413 over 256 KB, 400 on bad JSON, 200 with the stored count otherwise', async () => {
    expect((await run(reqOf(Buffer.alloc(256 * 1024 + 1, 'a')))).res.status).toBe(413);
    expect((await run(reqOf(Buffer.from('{nope')))).res.status).toBe(400);
    const { res } = await run(reqOf(Buffer.from(JSON.stringify({ events: [grummus('Aldenmar')] }))));
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, refused: [] });
    expect(JSON.parse(res.body).stored).toBeGreaterThan(0);
  });

  it('an unexpected throw is a retryable 503, not a crash', async () => {
    const db = fakeStore();
    db.select = async () => { throw new Error('boom'); };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { res } = await run(reqOf(Buffer.from(JSON.stringify({ events: [grummus('Aldenmar')] }))), db);
    expect(res.status).toBe(503);
    vi.restoreAllMocks();
  });
});

// ── the flag reading is the Wolf Pack handler's ─────────────────────────────────────────────────────────────────
describe('parity: hubSync reads events the way _handleAgentPopFlags does', () => {
  const bot = readSource(BOT_INDEX);
  const handler = sliceBlock(bot, 'async function _handleAgentPopFlags(req, res) {', '\n}\n');

  async function wolfPackRows(events) {
    let written = null;
    const sb = { isEnabled: () => true, upsert: async (_t, rows) => { written = rows; return rows; } };
    // eslint-disable-next-line no-new-func
    const fn = new Function('mimicLink', 'require', 'popFlagStages', 'POP_FLAG_BY_BOSS', '_popBossKey', '_trackUpload', '_hailGrants', '_popStatusInst', '_callerOwnNames',
      `${handler}\nreturn _handleAgentPopFlags;`)(
      { requireAgentAuth: async () => ({ discord_id: '1' }) }, () => sb, S, botMaps.POP_FLAG_BY_BOSS, botMaps._popBossKey, () => {}, () => {}, null, async (_who, names) => names);
    const body = Buffer.from(JSON.stringify({ events }));
    await fn({ [Symbol.asyncIterator]: async function* () { yield body; } }, { writeHead: () => {}, end: () => {} });
    return written || [];
  }
  const shape = (r) => `${String(r.character).toLowerCase()}|${r.flag_key}|${r.earned_at}|${r.source}|${r.stage}`;

  it('the same events give the same flags (but for the unmapped funnel and the hail, which the free tier does not keep)', async () => {
    const [firstRecital] = S.RECITAL_STAGES;
    const stages = [...S.POPFLAGS_KEYS].slice(0, 3);
    const events = [
      grummus('Aldenmar'),
      mavuin3('Aldenmar'),
      { character: 'Brackwyn', ts: '2026-10-01T20:00:00Z', zone: '209x', boss: 'Agnarr the Storm Lord' },
      { character: 'Brackwyn', ts: '2026-10-01T21:00:00Z', boss: '#Xegony_the_Queen_of_Air' },
      { character: 'Corvale', ts: '2026-10-02T20:00:00Z', source: 'popflags', stages },
      { character: 'Corvale', ts: '2026-10-02T20:01:00Z', kind: 'recital', text: firstRecital[0] + ' and more words' },
      { character: 'Corvale', ts: '2026-10-02T20:02:00Z', kind: 'checklist', zone: '214', boss: 'Tallon Zek' },
      { character: 'Corvale', ts: '2026-10-02T20:03:00Z', kind: 'recital', text: 'Some other line.' },
      { character: 'Corvale', ts: '2026-10-02T20:04:00Z', zone: '201' },
      { character: 'Corvale', ts: '2026-10-02T20:05:00Z', source: 'hail_witnessed', npc: 'Mavuin', zone: '201' },
      grummus('Aldenmar'),   // a duplicate inside one upload
    ];
    const wp = (await wolfPackRows(events)).filter(r => r.flag_key !== 'unmapped' && r.flag_key !== 'hail').map(shape).sort();
    const hub = hubSync.flagRowsFromEvents(events, depsFor(fakeStore())).map(shape).sort();
    expect(wp.length).toBeGreaterThan(8);   // the corpus is not vacuous
    expect(hub).toEqual(wp);
  });
});
