// test/bot-auth-flood.test.js — unauthenticated traffic must not be able to knock the bot over (the guild lead, 2026-10-17).
//
// Four holes, one file:
//   1. random `wpms_<anything>` bearers each cost a Supabase read and a PERMANENT cache entry (unbounded Map → OOM);
//   2. no per-IP request ceiling and no failed-auth throttle (the #73 budgets are keyed per token, so random tokens
//      get fresh buckets);
//   3. no unhandledRejection handler (Node 20 exits on one);
//   4. the client IP was the FIRST x-forwarded-for hop, which the caller chooses.
//
// utils/ipLimiter.js and utils/clientIp.js are pure and run for real; utils/mimicLink.js runs for real with
// utils/supabase.js's functions swapped on the shared CJS module object (the pattern of
// test/mimic-session-member-retry.test.js). The two index.js assertions are text assertions on comment-stripped source.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { BOT_INDEX, readSource, stripJs } from './_source-slice.js';

const nodeRequire = createRequire(BOT_INDEX);
const supabase = nodeRequire('./utils/supabase');
const mimicLink = nodeRequire('./utils/mimicLink');
const { clientIp } = nodeRequire('./utils/clientIp');
const { createIpLimiter } = nodeRequire('./utils/ipLimiter');
const crypto = nodeRequire('node:crypto');

const freshToken = () => 'wpms_' + crypto.randomBytes(32).toString('hex');

describe('createIpLimiter', () => {
  let t;
  const mk = (o = {}) => createIpLimiter({ max: 3, windowMs: 1000, cleanupMs: 0, now: () => t, ...o });
  beforeEach(() => { t = 1_000_000; });

  it('limits the request after N, per IP', () => {
    const l = mk();
    for (let i = 0; i < 3; i++) expect(l.hit('1.1.1.1').limited).toBe(false);
    const over = l.hit('1.1.1.1');
    expect(over.limited).toBe(true);
    expect(over.tripped).toBe(true);
    expect(over.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(l.hit('1.1.1.1').tripped).toBe(false);   // logged once per window
    expect(l.hit('2.2.2.2').limited).toBe(false);   // another IP is independent
  });

  it('resets after the window', () => {
    const l = mk();
    for (let i = 0; i < 5; i++) l.hit('1.1.1.1');
    expect(l.isOver('1.1.1.1')).toBe(true);
    t += 1000;
    expect(l.isOver('1.1.1.1')).toBe(false);
    expect(l.hit('1.1.1.1').limited).toBe(false);
  });

  it('caps the tracked map and sweeps expired windows', () => {
    const l = mk({ maxIps: 100 });
    for (let i = 0; i < 1000; i++) l.hit('10.0.' + i);
    expect(l.size).toBeLessThanOrEqual(100);
    t += 1000;
    l.sweep();
    expect(l.size).toBe(0);
  });

  it('exempts nothing by itself (the /health exemption is at the call site) and honours a per-call limit', () => {
    const l = mk();
    for (let i = 0; i < 3; i++) l.hit('/health');
    expect(l.hit('/health').limited).toBe(true);
    expect(mk().hit('x', 0).limited).toBe(false);   // 0 = unlimited
    const l2 = mk();
    l2.hit('y', 1); expect(l2.hit('y', 1).limited).toBe(true);
  });
});

describe('clientIp', () => {
  it('prefers x-real-ip over everything', () => {
    expect(clientIp({ headers: { 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '6.6.6.6, 7.7.7.7' }, socket: { remoteAddress: '1.1.1.1' } })).toBe('9.9.9.9');
  });
  it('otherwise uses the LAST x-forwarded-for hop, never the caller-chosen first', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '6.6.6.6, 7.7.7.7' }, socket: { remoteAddress: '1.1.1.1' } })).toBe('7.7.7.7');
  });
  it('otherwise uses the socket, then "unknown"', () => {
    expect(clientIp({ headers: {}, socket: { remoteAddress: '1.1.1.1' } })).toBe('1.1.1.1');
    expect(clientIp({ headers: {} })).toBe('unknown');
  });
  it('caps a hostile header so it cannot become a giant Map key', () => {
    expect(clientIp({ headers: { 'x-real-ip': 'a'.repeat(5000) } }).length).toBeLessThanOrEqual(64);
  });
});

describe('mimicLink under a token flood (real module, stubbed store)', () => {
  const saved = {};
  let selects;
  let sessionRows;   // what mimic_sessions returns: [] = unknown, [row] = valid, or null = store down
  beforeEach(() => {
    for (const k of ['isEnabled', 'select', 'update']) saved[k] = supabase[k];
    supabase.isEnabled = () => true;
    supabase.update = async () => [];
    selects = [];
    sessionRows = [];
    supabase.select = async (table) => {
      selects.push(table);
      if (table === 'mimic_sessions') return sessionRows;
      if (table === 'wolfpack_members') return [{ nickname: 'Aldenmar', global_name: null, role_names: [] }];
      return [];
    };
    mimicLink._sessionCache.clear();
    mimicLink._sessionMissCache.clear();
    mimicLink.setFailAuthPerMin(60);
  });
  afterEach(() => {
    for (const k of Object.keys(saved)) supabase[k] = saved[k];
    mimicLink._failAuth.sweep();
  });

  const GOOD_ROW = [{ user_id: null, discord_id: '111111111111111111', revoked_at: null }];
  const mockRes = () => ({ statusCode: null, headers: null, writeHead(c, h) { this.statusCode = c; this.headers = h; return this; }, end(b) { this.body = b; return this; } });
  const bearer = (token, ip) => ({ headers: { authorization: 'Bearer ' + token, 'x-real-ip': ip } });
  const ui = (token, ip) => ({ headers: { 'x-wolfpack-mimic-session': token, 'x-real-ip': ip } });

  it('a malformed token does no select call and caches nothing', async () => {
    for (const bad of ['wpms_', 'wpms_abc', 'wpms_' + 'g'.repeat(64), 'wpms_' + 'a'.repeat(63), 'wpms_' + 'a'.repeat(65), 'wpms_' + 'A'.repeat(64), 'x' + freshToken()]) {
      const res = mockRes();
      expect(await mimicLink.requireAgentAuth(bearer(bad, '3.3.3.3'), res)).toBeNull();
      expect(res.statusCode).toBe(401);
      expect(await mimicLink.resolveMimicSession(ui(bad, '3.3.3.3'))).toBeNull();
    }
    expect(selects).toEqual([]);
    expect(mimicLink._sessionCache.size + mimicLink._sessionMissCache.size).toBe(0);
  });

  it('3000 distinct well-formed unknown tokens leave the miss cache capped and the positive cache untouched', async () => {
    sessionRows = GOOD_ROW;
    const member = freshToken();
    expect(await mimicLink.resolveMimicSession(ui(member, '4.4.4.4'))).not.toBeNull();
    sessionRows = [];
    for (let i = 0; i < 3000; i++) {
      // a different IP each time (a distributed flood) so the failed-auth throttle does not mask the cap
      await mimicLink.resolveMimicSession(ui(freshToken(), `20.${i >> 8}.${i & 255}.1`));
    }
    expect(mimicLink._sessionMissCache.size).toBeLessThanOrEqual(2000);
    expect(mimicLink._sessionMissCache.size).toBeGreaterThan(1500);
    expect(mimicLink._sessionCache.size).toBe(1);
    expect(mimicLink._sessionCache.has(member)).toBe(true);
  });

  it('the positive cache is FIFO-capped at 10,000', async () => {
    sessionRows = GOOD_ROW;
    for (let i = 0; i < 10_050; i++) {
      await mimicLink.resolveMimicSession(ui(freshToken(), '5.5.5.5'));
    }
    expect(mimicLink._sessionCache.size).toBe(10_000);
  }, 30_000);

  it('a not-found answer is cached briefly: the same unknown token is read once', async () => {
    const tok = freshToken();
    await mimicLink.resolveMimicSession(ui(tok, '6.6.6.1'));
    await mimicLink.resolveMimicSession(ui(tok, '6.6.6.1'));
    expect(selects.filter(s => s === 'mimic_sessions').length).toBe(1);
  });

  it('a revoked token is evicted from both caches', async () => {
    const tok = freshToken();
    sessionRows = GOOD_ROW;
    await mimicLink.resolveMimicSession(ui(tok, '7.7.7.1'));
    expect(mimicLink._sessionCache.has(tok)).toBe(true);
    mimicLink.invalidateSessionCache(tok);
    expect(mimicLink._sessionCache.has(tok)).toBe(false);
    sessionRows = [{ ...GOOD_ROW[0], revoked_at: '2026-10-17T00:00:00Z' }];
    expect(await mimicLink.resolveMimicSession(ui(tok, '7.7.7.1'))).toBeNull();
    expect(mimicLink._sessionMissCache.has(tok)).toBe(true);
    expect(mimicLink._sessionCache.has(tok)).toBe(false);
    mimicLink.invalidateSessionCache(tok);
    expect(mimicLink._sessionMissCache.has(tok)).toBe(false);
    expect(mimicLink._sessionCache.has(tok)).toBe(false);
  });

  it('a down store is neither cached nor answered with a 401 (503, retryable)', async () => {
    sessionRows = null;
    const tok = freshToken();
    const res = mockRes();
    expect(await mimicLink.requireAgentAuth(bearer(tok, '8.8.8.1'), res)).toBeNull();
    expect(res.statusCode).toBe(503);
    expect(mimicLink._sessionCache.size + mimicLink._sessionMissCache.size).toBe(0);
  });

  it('failed auth: after the limit an IP gets 429 with no lookup, but a known-good cached token still passes', async () => {
    const ip = '9.9.9.1';
    sessionRows = GOOD_ROW;
    const member = freshToken();
    expect(await mimicLink.requireAgentAuth(bearer(member, ip), mockRes())).not.toBeNull();   // cached
    sessionRows = [];
    for (let i = 0; i < 60; i++) {
      const res = mockRes();
      await mimicLink.requireAgentAuth(bearer(freshToken(), ip), res);
      expect(res.statusCode).toBe(401);
    }
    selects.length = 0;
    const res = mockRes();
    expect(await mimicLink.requireAgentAuth(bearer(freshToken(), ip), res)).toBeNull();
    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBe('60');
    expect(selects).toEqual([]);                                                              // no store read
    expect(await mimicLink.resolveMimicSession(ui(freshToken(), ip))).toBeNull();
    expect(selects).toEqual([]);
    expect(await mimicLink.requireAgentAuth(bearer(member, ip), mockRes())).not.toBeNull();   // cached member passes
    // another IP is unaffected
    const other = mockRes();
    await mimicLink.requireAgentAuth(bearer(freshToken(), '9.9.9.2'), other);
    expect(other.statusCode).toBe(401);
  });

  it('a known member whose cache entry has aged out still refreshes from a throttled IP; a revoke on refresh moves it to the miss cache', async () => {
    const ip = '9.9.9.4';
    sessionRows = GOOD_ROW;
    const member = freshToken();
    expect(await mimicLink.requireAgentAuth(bearer(member, ip), mockRes())).not.toBeNull();
    sessionRows = [];
    for (let i = 0; i < 60; i++) await mimicLink.requireAgentAuth(bearer(freshToken(), ip), mockRes());
    expect(mimicLink._failAuth.isOver(ip, 60)).toBe(true);
    mimicLink._sessionCache.get(member).resolvedAt = 0;   // past the 5-minute TTL
    sessionRows = GOOD_ROW;
    expect(await mimicLink.requireAgentAuth(bearer(member, ip), mockRes())).not.toBeNull();   // refreshed, not 429
    mimicLink._sessionCache.get(member).resolvedAt = 0;
    sessionRows = [{ ...GOOD_ROW[0], revoked_at: '2026-10-17T00:00:00Z' }];
    const res = mockRes();
    expect(await mimicLink.requireAgentAuth(bearer(member, ip), res)).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(mimicLink._sessionCache.has(member)).toBe(false);
    expect(mimicLink._sessionMissCache.has(member)).toBe(true);
  });

  it('a stale install repeating ONE bad token costs one strike, not sixty (it hits the miss cache)', async () => {
    const ip = '9.9.9.3';
    const tok = freshToken();
    for (let i = 0; i < 200; i++) await mimicLink.requireAgentAuth(bearer(tok, ip), mockRes());
    expect(mimicLink._failAuth.isOver(ip, 60)).toBe(false);
    expect(selects.filter(s => s === 'mimic_sessions').length).toBe(1);
  });
});

describe('index.js wiring (comment-stripped text)', () => {
  const src = stripJs(readSource(BOT_INDEX));

  it('the createServer callback calls the per-IP limiter before the first route, and exempts /health', () => {
    const at = src.indexOf('http.createServer(async (req, res) => {');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at);
    expect(body).toMatch(/const _lim = _ipLimiter\.hit\(_ip, /);
    expect(body).toMatch(/if \(_lim\.limited\) \{/);
    const hit = body.indexOf('_ipLimiter.hit(');
    const firstRoute = body.indexOf("'/api/");
    expect(hit).toBeGreaterThan(-1);
    expect(firstRoute).toBeGreaterThan(-1);
    expect(hit).toBeLessThan(firstRoute);
    expect(body.slice(0, hit)).toMatch(/healthz\?/);
    expect(body.slice(hit, hit + 600)).toMatch(/429/);
  });

  it('registers an unhandledRejection handler (and leaves uncaughtException alone)', () => {
    expect(src).toMatch(/process\.on\('unhandledRejection'/);
    expect(src).not.toMatch(/process\.on\('uncaughtException'/);
  });

  it('requireAgentAuth applies the strict token shape itself, ahead of any lookup', () => {
    const ml = stripJs(readSource(nodeRequire.resolve('./utils/mimicLink')));
    const fn = ml.slice(ml.indexOf('async function requireAgentAuth('));
    expect(fn.indexOf('SESSION_TOKEN_RE.test(bearer)')).toBeGreaterThan(-1);
    expect(fn.indexOf('SESSION_TOKEN_RE.test(bearer)')).toBeLessThan(fn.indexOf('_resolveSessionToken('));
    expect(ml).toMatch(/const SESSION_TOKEN_RE = \/\^wpms_\[0-9a-f\]\{64\}\$\//);
  });

  it('both call sites use the shared clientIp helper, not the first x-forwarded-for hop', () => {
    expect(src).not.toMatch(/x-forwarded-for/);
    expect(stripJs(readSource(nodeRequire.resolve('./utils/mimicLink')))).not.toMatch(/x-forwarded-for/);
    expect(src).toMatch(/'ip' \+ clientIp\(req\)/);
  });
});
