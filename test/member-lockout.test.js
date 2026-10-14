// test/member-lockout.test.js — member lockout, bot half (the guild lead, 2026-10-13).
//
// Three layers. utils/memberLockout.js and utils/mimicLink.js run for real, with utils/supabase.js's functions
// swapped on the shared CJS module object (restored after each test). index.js, commands/token.js and the
// device-link poll cannot be booted here, so those are checked as TEXT with comments stripped (stripJs).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readSource, stripJs, BOT_INDEX, ROOT } from './_source-slice.js';

const nodeRequire = createRequire(BOT_INDEX);
const supabase = nodeRequire('./utils/supabase');
const lockout = nodeRequire('./utils/memberLockout');
const mimicLink = nodeRequire('./utils/mimicLink');

const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const iso = (ms) => new Date(ms).toISOString();

const saved = {};
beforeEach(() => {
  for (const k of ['isEnabled', 'select', 'update', 'insert', 'del']) saved[k] = supabase[k];
  supabase.isEnabled = () => true;
});
afterEach(() => {
  for (const k of Object.keys(saved)) supabase[k] = saved[k];
  lockout._setForTest([]);
});

describe('memberLockout.isLocked', () => {
  it('honours until: null = locked, future = locked, past = not locked', () => {
    lockout._setForTest([
      { discord_id: '100', until: null },
      { discord_id: '200', until: iso(NOW + 3600_000) },
      { discord_id: '300', until: iso(NOW - 1000) },
    ]);
    expect(lockout.isLocked('100', NOW)).toBe(true);
    expect(lockout.isLocked('200', NOW)).toBe(true);
    expect(lockout.isLocked('300', NOW)).toBe(false);
    expect(lockout.isLocked('999', NOW)).toBe(false);
    expect(lockout.isLocked(200, NOW + 7200_000)).toBe(false);   // a lock that has run out stops counting
    expect(lockout.isLocked(undefined, NOW)).toBe(false);
  });
});

describe('memberLockout.refresh', () => {
  it('replaces the set from the table, reading only the columns it needs', async () => {
    let query = null;
    supabase.select = async (t, q) => { query = [t, q]; return [{ discord_id: '100', until: null, reason: 'x' }]; };
    lockout._setForTest([{ discord_id: '555', until: null }]);
    expect(await lockout.refresh()).toBe(true);
    expect(query[0]).toBe('member_lockouts');
    expect(query[1]).toContain('select=discord_id,until,reason');
    expect(query[1]).toMatch(/limit=\d+/);
    expect(lockout.isLocked('100')).toBe(true);
    expect(lockout.isLocked('555')).toBe(false);   // unlocked rows leave the set
  });

  it('keeps the last known set when the read fails (null), and when it throws', async () => {
    lockout._setForTest([{ discord_id: '100', until: null }]);
    supabase.select = async () => null;
    expect(await lockout.refresh()).toBe(false);
    expect(lockout.isLocked('100')).toBe(true);
    supabase.select = async () => { throw new Error('boom'); };
    expect(await lockout.refresh()).toBe(false);
    expect(lockout.isLocked('100')).toBe(true);
  });

  it('an empty table really does clear the set', async () => {
    lockout._setForTest([{ discord_id: '100', until: null }]);
    supabase.select = async () => [];
    await lockout.refresh();
    expect(lockout.isLocked('100')).toBe(false);
  });
});

describe('mimicLink honours the lockout', () => {
  const SESSION_ROW = { user_id: null, discord_id: '100', revoked_at: null };
  const wire = () => {
    supabase.select = async (table) => (table === 'mimic_sessions' ? [SESSION_ROW] : [{ nickname: 'Aldenmar', role_names: [] }]);
    supabase.update = async () => [];
  };
  const fakeRes = () => ({ status: null, body: '', writeHead(s) { this.status = s; }, end(b) { this.body = b; } });
  const reqFor = (tok) => ({ headers: { authorization: `Bearer ${tok}`, 'x-wolfpack-mimic-session': tok } });

  it('requireAgentAuth answers 401 for a locked member, even when the session is already cached, and recovers on unlock', async () => {
    wire();
    const tok = 'wpms_' + 'a'.repeat(64);

    let res = fakeRes();
    const ok = await mimicLink.requireAgentAuth(reqFor(tok), res);
    expect(ok && ok.discord_id).toBe('100');   // resolved and now sits in the 5-minute cache

    lockout._setForTest([{ discord_id: '100', until: null }]);
    res = fakeRes();
    expect(await mimicLink.requireAgentAuth(reqFor(tok), res)).toBeNull();
    expect(res.status).toBe(401);
    expect(res.body).toContain('session token invalid or revoked');
    expect(await mimicLink.resolveMimicSession(reqFor(tok))).toBeNull();

    lockout._setForTest([]);
    res = fakeRes();
    const again = await mimicLink.requireAgentAuth(reqFor(tok), res);
    expect(again && again.discord_id).toBe('100');
  });

  it('mintSessionForUser refuses a locked member without writing', async () => {
    let inserted = false;
    supabase.insert = async () => { inserted = true; return [{ id: 1 }]; };
    lockout._setForTest([{ discord_id: '100', until: null }]);
    expect(await mimicLink.mintSessionForUser({ userId: null, discordId: '100' })).toBeNull();
    expect(inserted).toBe(false);
    lockout._setForTest([]);
    expect(await mimicLink.mintSessionForUser({ userId: null, discordId: '100' })).toMatchObject({ sessionId: 1 });
  });

  it('handlePoll will not mint a session for a locked member and answers expired', async () => {
    let sessionInserted = false;
    supabase.select = async () => [{
      user_code: 'ABC234', expires_at: iso(Date.now() + 600_000), authorized_at: iso(Date.now() - 1000),
      authorized_user_id: null, authorized_discord_id: '100',
    }];
    supabase.insert = async () => { sessionInserted = true; return [{ id: 1 }]; };
    supabase.del = async () => [];
    lockout._setForTest([{ discord_id: '100', until: null }]);

    const req = {
      on(ev, fn) {
        if (ev === 'data') setImmediate(() => fn(JSON.stringify({ device_code: 'd'.repeat(64) })));
        if (ev === 'end') setImmediate(() => setImmediate(fn));
        return this;
      },
    };
    const res = fakeRes();
    await mimicLink.handlePoll(req, res);
    expect(JSON.parse(res.body)).toEqual({ status: 'expired' });
    expect(sessionInserted).toBe(false);
  });
});

describe('call sites (source, comments stripped)', () => {
  const indexSrc = stripJs(readSource(path.join(ROOT, 'index.js')));
  const tokenSrc = stripJs(readSource(path.join(ROOT, 'commands', 'token.js')));
  const linkSrc  = stripJs(readSource(path.join(ROOT, 'utils', 'mimicLink.js')));

  it('the InteractionCreate handler checks the lockout before any dispatch', () => {
    const at = indexSrc.indexOf('client.on(Events.InteractionCreate');
    expect(at).toBeGreaterThan(-1);
    const body = indexSrc.slice(at, at + 1200);
    const check = body.indexOf('memberLockout');
    expect(check).toBeGreaterThan(-1);
    expect(body).toMatch(/isLocked\(interaction\.user\?*\.id\)/);
    expect(body).toMatch(/interaction\.respond\(\[\]\)/);
    expect(check).toBeLessThan(body.indexOf('client.commands.get'));
  });

  it('the bot starts the refresh loop at ready', () => {
    expect(indexSrc).toMatch(/require\('\.\/utils\/memberLockout'\)\.start\(\)/);
  });

  it('/token refuses a locked member for self-mint and for officer-mint-for-someone', () => {
    expect(tokenSrc).toMatch(/memberLockout\.isLocked\(interaction\.user\.id\)/);
    expect(tokenSrc).toMatch(/memberLockout\.isLocked\(target\.id\)/);
    const selfAt = tokenSrc.indexOf('async function handleTokenMint');
    expect(tokenSrc.indexOf('isLocked(interaction.user.id)', selfAt)).toBeLessThan(tokenSrc.indexOf('mintSessionForUser', selfAt));
    const offAt = tokenSrc.indexOf('async function _handleOfficerMintFor');
    expect(tokenSrc.indexOf('isLocked(target.id)', offAt)).toBeLessThan(tokenSrc.indexOf('mintSessionForUser', offAt));
  });

  it('mimicLink checks the lockout centrally in the session resolver, in poll and in mint', () => {
    const resolver = linkSrc.slice(linkSrc.indexOf('async function _resolveSessionToken'), linkSrc.indexOf('async function _lookupSessionToken'));
    expect(resolver).toMatch(/memberLockout\.isLocked/);
    const poll = linkSrc.slice(linkSrc.indexOf('async function handlePoll'), linkSrc.indexOf('async function handleRevoke'));
    expect(poll.indexOf('memberLockout.isLocked')).toBeGreaterThan(-1);
    expect(poll.indexOf('memberLockout.isLocked')).toBeLessThan(poll.indexOf("supabase.insert('mimic_sessions'"));
    const mint = linkSrc.slice(linkSrc.indexOf('async function mintSessionForUser'), linkSrc.indexOf('async function revokeSessionForUser'));
    expect(mint.indexOf('memberLockout.isLocked')).toBeLessThan(mint.indexOf("supabase.insert('mimic_sessions'"));
  });
});
