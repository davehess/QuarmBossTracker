// test/guest-extend.test.js — the Command Center's guest list and the +1h / +3h extend (utils/guestLinks.js)
// (the guild lead, 2026-10-30: "add guests to the command center for officers/admins with an extend button for +1/+3").
//
// The handlers run for real behind the real requireAgentAuth, with utils/supabase.js's functions swapped on the shared
// CJS module object (the pattern of test/guest-link.test.js), so the officer gate, the allowlist, the expiry math, the
// revival window and the cache bust are exercised as shipped. Source assertions run on comment-stripped text.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { BOT_INDEX, readSource, stripJs } from './_source-slice.js';

const nodeRequire = createRequire(BOT_INDEX);
const supabase = nodeRequire('./utils/supabase');
const mimicLink = nodeRequire('./utils/mimicLink');
const guestLinks = nodeRequire('./utils/guestLinks');
const crypto = nodeRequire('node:crypto');
const freshToken = () => 'wpms_' + crypto.randomBytes(32).toString('hex');

const NOW = Date.UTC(2026, 9, 31, 1, 0, 0);   // 2026-10-31T01:00:00Z
const H = 3600_000;
const SID = '7b2f0c1e-0000-4000-8000-000000000001';
const iso = (ms) => new Date(ms).toISOString();

describe('extendedExpiry', () => {
  it('adds the hours to the current expiry while the key still has time', () => {
    expect(guestLinks.extendedExpiry(iso(NOW + 2 * H), 1, NOW)).toBe(iso(NOW + 3 * H));
    expect(guestLinks.extendedExpiry(iso(NOW + 2 * H), 3, NOW)).toBe(iso(NOW + 5 * H));
  });
  it('counts from now once the key has lapsed (max(now, expiry) + hours)', () => {
    expect(guestLinks.extendedExpiry(iso(NOW - 5 * 60_000), 1, NOW)).toBe(iso(NOW + H));
    expect(guestLinks.extendedExpiry(iso(NOW - 11 * H), 3, NOW)).toBe(iso(NOW + 3 * H));
    expect(guestLinks.extendedExpiry(null, 3, NOW)).toBe(iso(NOW + 3 * H));
  });
  it('is null for any hours outside {1, 3}', () => {
    for (const h of [0, 2, 4, 24, -1, 1.5, '1', null, undefined, NaN]) expect(guestLinks.extendedExpiry(iso(NOW), h, NOW), String(h)).toBeNull();
  });
});

describe('canRevive', () => {
  it('allows a lapse of up to 12 hours and nothing older', () => {
    expect(guestLinks.canRevive(iso(NOW + H), NOW)).toBe(true);
    expect(guestLinks.canRevive(iso(NOW - 11.9 * H), NOW)).toBe(true);
    expect(guestLinks.canRevive(iso(NOW - 12 * H), NOW)).toBe(false);
    expect(guestLinks.canRevive(iso(NOW - 30 * H), NOW)).toBe(false);
    expect(guestLinks.canRevive(null, NOW)).toBe(false);
  });
});

// ── the handlers ─────────────────────────────────────────────────────────────
const saved = {};
let rows;     // the guest mimic_sessions row the extend read returns
let list;     // the rows the list read returns
let calls;    // every [kind, table, query/body]
let officerRoles;
let updateResult;
const tokens = { officer: null, member: null, guest: null };

beforeEach(() => {
  for (const k of ['isEnabled', 'select', 'update', 'insert']) saved[k] = supabase[k];
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  guestLinks._forgetListCache();
  calls = []; officerRoles = ['Officer']; updateResult = undefined;
  tokens.officer = freshToken(); tokens.member = freshToken(); tokens.guest = freshToken();
  rows = {
    id: SID, session_token: freshToken(), discord_id: `guest:${SID}`, scope: 'guest', guest_label: 'Brackwyn of Another Guild',
    created_at: iso(NOW - 3 * H), expires_at: iso(NOW + H), last_used_at: iso(NOW - 60_000), revoked_at: null, linked_by_discord_id: '111',
  };
  list = [rows];
  supabase.isEnabled = () => true;
  supabase.insert = async (table, body) => { calls.push(['insert', table, body]); return [{}]; };
  supabase.update = async (table, q, body) => {
    calls.push(['update', table, q, body]);
    if (/^session_token=/.test(q)) return [];   // last_used_at bumps
    return updateResult !== undefined ? updateResult : [{ id: SID }];
  };
  supabase.select = async (table, q) => {
    calls.push(['select', table, q]);
    if (table === 'mimic_sessions' && q.startsWith('session_token=')) {
      const t = decodeURIComponent(q.slice('session_token=eq.'.length).split('&')[0]);
      if (t === tokens.guest) return [{ ...rows, session_token: t }];
      return [{ user_id: null, discord_id: t === tokens.officer ? '900' : '901', revoked_at: null, scope: null }];
    }
    if (table === 'wolfpack_members' && q.includes('discord_id=eq.900')) return [{ nickname: 'Officer Olwen', global_name: null, role_names: officerRoles }];
    if (table === 'wolfpack_members' && q.includes('discord_id=eq.901')) return [{ nickname: 'Raider Rue', global_name: null, role_names: ['Pack Member'] }];
    if (table === 'wolfpack_members') return [{ discord_id: '111', nickname: 'Approver Ann', global_name: null }];
    if (table === 'mimic_sessions' && q.startsWith('id=eq.')) return rows ? [rows] : [];
    if (table === 'mimic_sessions') return list;
    if (table === 'contributions') return [
      { uploaded_by_discord_id: `guest:${SID}`, created_at: iso(NOW - 600_000) },
      { uploaded_by_discord_id: `guest:${SID}`, created_at: iso(NOW - 3600_000) },
    ];
    return [];
  };
});
afterEach(() => {
  for (const k of Object.keys(saved)) supabase[k] = saved[k];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function request(method, url, token, body) {
  const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
    method, url, headers: { authorization: `Bearer ${token}` }, socket: { remoteAddress: '203.0.113.9' },
  });
  const res = { status: null, body: null, headersSent: false, writeHead(s) { this.status = s; }, end(b) { this.body = b; } };
  return { req, res };
}
const getList = async (token) => { const { req, res } = request('GET', '/api/agent/guest-links', token); await guestLinks.handleList(req, res); return res; };
const postExtend = async (token, body) => { const { req, res } = request('POST', '/api/agent/guest-links/extend', token, body); await guestLinks.handleExtend(req, res); return res; };
const json = (res) => JSON.parse(res.body);

describe('officer gate', () => {
  it('refuses a member who is not an officer, on both routes, before any guest data is read', async () => {
    const a = await getList(tokens.member);
    expect(a.status).toBe(403);
    expect(json(a)).toEqual({ error: 'officers only' });
    const b = await postExtend(tokens.member, { id: SID, hours: 1 });
    expect(b.status).toBe(403);
    expect(calls.some(c => c[1] === 'contributions' || (c[0] === 'update' && c[1] === 'mimic_sessions' && c[3] && c[3].expires_at))).toBe(false);
  });
  it('refuses a guest link itself (the allowlist answers guest_scope first), and a bad token', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const g = request('GET', '/api/agent/guest-links', tokens.guest);
    await guestLinks.handleList(g.req, g.res);
    expect(g.res.status).toBe(403);
    expect(json(g.res)).toEqual({ error: 'guest_scope' });
    const x = request('POST', '/api/agent/guest-links/extend', tokens.guest, { id: SID, hours: 3 });
    await guestLinks.handleExtend(x.req, x.res);
    expect(json(x.res)).toEqual({ error: 'guest_scope' });
    const bad = await getList('not-a-token');
    expect(bad.status).toBe(401);
  });
  it('a guest can never reach the routes: they are not on the allowlist', () => {
    expect(mimicLink.guestRouteAllowed('GET', '/api/agent/guest-links')).toBe(false);
    expect(mimicLink.guestRouteAllowed('POST', '/api/agent/guest-links/extend')).toBe(false);
  });
});

describe('GET /api/agent/guest-links', () => {
  it('lists each guest with the approver, the revoked flag and the fight count', async () => {
    const res = await getList(tokens.officer);
    expect(res.status).toBe(200);
    const body = json(res);
    expect(body.guests).toEqual([{
      id: SID, label: 'Brackwyn of Another Guild', approved_by: 'Approver Ann', created_at: rows.created_at, expires_at: rows.expires_at,
      last_used_at: rows.last_used_at, revoked: false, fights: 2, last_fight_at: iso(NOW - 600_000),
    }]);
  });
  it('reads guests of this guild only, from the last 24 hours, newest first and capped', async () => {
    await getList(tokens.officer);
    const q = calls.find(c => c[0] === 'select' && c[1] === 'mimic_sessions' && c[2].startsWith('guild_id='))[2];
    expect(q).toContain('scope=eq.guest');
    expect(decodeURIComponent(q)).toContain(`expires_at=gte.${iso(NOW - 24 * H)}`);
    expect(q).toContain('order=created_at.desc');
    expect(q).toMatch(/limit=\d+/);
  });
  it('answers from a 15 s cache and rereads after it', async () => {
    const reads = () => calls.filter(c => c[0] === 'select' && c[1] === 'contributions').length;
    await getList(tokens.officer);
    await getList(tokens.officer);
    expect(reads()).toBe(1);
    vi.setSystemTime(NOW + 16_000);
    await getList(tokens.officer);
    expect(reads()).toBe(2);
  });
  it('an unreadable store is a 503 the agent can retry, not an empty list', async () => {
    list = null;
    supabase.select = async (table, q) => (table === 'mimic_sessions' && q.startsWith('guild_id=') ? null : [{ user_id: null, discord_id: '900', revoked_at: null, nickname: 'O', role_names: ['Officer'] }]);
    const res = await getList(tokens.officer);
    expect(res.status).toBe(503);
  });
  it('an empty window is an empty list', async () => {
    list = [];
    const res = await getList(tokens.officer);
    expect(json(res).guests).toEqual([]);
  });
});

describe('POST /api/agent/guest-links/extend', () => {
  it('adds the hours to a running key and returns the updated row', async () => {
    const res = await postExtend(tokens.officer, { id: SID, hours: 3 });
    expect(res.status).toBe(200);
    expect(json(res).guest).toMatchObject({ id: SID, expires_at: iso(NOW + 4 * H), revoked: false });
    const upd = calls.find(c => c[0] === 'update' && c[3] && c[3].expires_at);
    expect(upd[3]).toEqual({ expires_at: iso(NOW + 4 * H) });
  });
  it('only 1 and 3 are accepted', async () => {
    for (const hours of [0, 2, 4, 24, '3', null, undefined, 1.5]) {
      const res = await postExtend(tokens.officer, { id: SID, hours });
      expect(res.status, String(hours)).toBe(400);
    }
    expect(calls.some(c => c[0] === 'update' && c[3] && c[3].expires_at)).toBe(false);
  });
  it('refuses a malformed id or body before touching the store', async () => {
    expect((await postExtend(tokens.officer, { id: 'x', hours: 1 })).status).toBe(400);
    expect((await postExtend(tokens.officer, { id: `${SID}&revoked_at=is.null`, hours: 1 })).status).toBe(400);
    const r2 = request('POST', '/api/agent/guest-links/extend', tokens.officer);
    const bad = Object.assign(Readable.from([Buffer.from('{not json')]), { method: 'POST', url: r2.req.url, headers: r2.req.headers, socket: r2.req.socket });
    await guestLinks.handleExtend(bad, r2.res);
    expect(r2.res.status).toBe(400);
  });
  it('revives a key that lapsed within 12 hours, counting from now', async () => {
    rows.expires_at = iso(NOW - 5 * 60_000);
    const res = await postExtend(tokens.officer, { id: SID, hours: 1 });
    expect(res.status).toBe(200);
    expect(json(res).guest.expires_at).toBe(iso(NOW + H));
    const audit = calls.find(c => c[0] === 'insert' && c[1] === 'audit_log');
    expect(audit[2][0].payload.revived).toBe(true);
  });
  it('refuses a key that lapsed more than 12 hours ago', async () => {
    rows.expires_at = iso(NOW - 12.5 * H);
    const res = await postExtend(tokens.officer, { id: SID, hours: 3 });
    expect(res.status).toBe(409);
    expect(calls.some(c => c[0] === 'update' && c[3] && c[3].expires_at)).toBe(false);
  });
  it('never revives a revoked session, even one that is still inside its time', async () => {
    rows.revoked_at = iso(NOW - 60_000);
    const res = await postExtend(tokens.officer, { id: SID, hours: 3 });
    expect(res.status).toBe(409);
    expect(json(res)).toEqual({ error: 'revoked' });
    expect(calls.some(c => c[0] === 'update' && c[3] && c[3].expires_at)).toBe(false);
  });
  it('writes with revoked_at IS NULL, so a Revoke that lands mid-request wins', async () => {
    updateResult = [];   // the revoke got there first: nothing matched
    const res = await postExtend(tokens.officer, { id: SID, hours: 1 });
    expect(res.status).toBe(409);
    const upd = calls.find(c => c[0] === 'update' && c[3] && c[3].expires_at);
    expect(upd[2]).toContain('revoked_at=is.null');
    expect(upd[2]).toContain('scope=eq.guest');
    expect(calls.some(c => c[0] === 'insert' && c[1] === 'audit_log')).toBe(false);
  });
  it('is 404 for an id that is not a guest session of this guild, and 503 when the store cannot be read', async () => {
    rows = null;
    expect((await postExtend(tokens.officer, { id: SID, hours: 1 })).status).toBe(404);
    const sel = supabase.select;
    supabase.select = async (table, q) => (table === 'mimic_sessions' && q.startsWith('id=eq.') ? null : sel(table, q));
    expect((await postExtend(tokens.officer, { id: SID, hours: 1 })).status).toBe(503);
  });
  it('writes an audit_log row naming the officer, the guest, the hours and both expiries', async () => {
    await postExtend(tokens.officer, { id: SID, hours: 1 });
    const audit = calls.find(c => c[0] === 'insert' && c[1] === 'audit_log')[2][0];
    expect(audit).toMatchObject({ action: 'guest_link_extended', actor_discord_id: '900', actor_name: 'Officer Olwen' });
    expect(audit.payload).toMatchObject({ session_id: SID, guest_label: 'Brackwyn of Another Guild', hours: 1, from: rows.expires_at, to: iso(NOW + 2 * H), revived: false });
    expect(audit.guild_id).toBe(supabase.guildId());
  });
  it('busts the guest from the session caches so the new expiry applies at once', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // The guest's own token is cached as a guest identity carrying the OLD expiry ...
    const warm = request('POST', '/api/agent/encounter', tokens.guest);
    expect(await mimicLink.requireAgentAuth(warm.req, warm.res)).toMatchObject({ scope: 'guest', expires_at: rows.expires_at });
    expect(mimicLink._sessionCache.has(tokens.guest)).toBe(true);
    // ... and the extend (which learns the token from the row) drops it, so the next request rereads the store.
    rows.session_token = tokens.guest;
    await postExtend(tokens.officer, { id: SID, hours: 3 });
    expect(mimicLink._sessionCache.has(tokens.guest)).toBe(false);
    rows.expires_at = iso(NOW + 4 * H);
    const again = request('POST', '/api/agent/encounter', tokens.guest);
    expect(await mimicLink.requireAgentAuth(again.req, again.res)).toMatchObject({ expires_at: iso(NOW + 4 * H) });
  });
  it('lets a guest whose key had lapsed (and was cached as a miss) back in at once', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    rows.session_token = tokens.guest;
    rows.expires_at = iso(NOW - 60_000);
    const dead = request('POST', '/api/agent/encounter', tokens.guest);
    expect(await mimicLink.requireAgentAuth(dead.req, dead.res)).toBeNull();
    expect(mimicLink._sessionMissCache.has(tokens.guest)).toBe(true);
    await postExtend(tokens.officer, { id: SID, hours: 1 });
    expect(mimicLink._sessionMissCache.has(tokens.guest)).toBe(false);
    rows.expires_at = iso(NOW + H);
    const back = request('POST', '/api/agent/encounter', tokens.guest);
    expect(await mimicLink.requireAgentAuth(back.req, back.res)).toMatchObject({ scope: 'guest' });
  });
  it('drops the list cache, so the Command Center sees the new expiry on its next poll', async () => {
    await getList(tokens.officer);
    await postExtend(tokens.officer, { id: SID, hours: 1 });
    await getList(tokens.officer);
    expect(calls.filter(c => c[0] === 'select' && c[1] === 'contributions')).toHaveLength(2);
  });
});

describe('forgetGuestSession', () => {
  it('finds a cached guest by its stand-in id when the caller has no token', () => {
    const t = freshToken();
    mimicLink._sessionCache.set(t, { resolvedAt: Date.now(), value: { discord_id: `guest:${SID}`, scope: 'guest' } });
    const other = freshToken();
    mimicLink._sessionCache.set(other, { resolvedAt: Date.now(), value: { discord_id: 'guest:other', scope: 'guest' } });
    mimicLink.forgetGuestSession(SID, null);
    expect(mimicLink._sessionCache.has(t)).toBe(false);
    expect(mimicLink._sessionCache.has(other)).toBe(true);
    mimicLink._sessionCache.delete(other);
  });
});

describe('wiring in index.js', () => {
  const src = stripJs(readSource(BOT_INDEX));
  it('dispatches both routes to guestLinks with the right methods', () => {
    expect(src).toMatch(/req\.method === 'GET' && req\.url\.split\('\?'\)\[0\] === '\/api\/agent\/guest-links'\)[\s\S]{0,80}guestLinks'\)\.handleList\(req, res\)/);
    expect(src).toMatch(/req\.method === 'POST' && req\.url === '\/api\/agent\/guest-links\/extend'\)[\s\S]{0,80}guestLinks'\)\.handleExtend\(req, res\)/);
  });
  it('keeps the officer gate and the auth in the handler module, and the guild id off the inline fallback', () => {
    const mod = stripJs(readSource(BOT_INDEX.replace('index.js', 'utils/guestLinks.js')));
    expect(mod).toContain('mimicLink.requireAgentAuth(req, res)');
    expect(mod).toMatch(/if \(!identity\.is_officer\) \{ _json\(res, 403, \{ error: 'officers only' \}\)/);
    expect(mod).toContain('supabase.guildId()');
    expect(mod).not.toMatch(/\|\| 'wolfpack'/);
  });
});
