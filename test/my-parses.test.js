// test/my-parses.test.js — GET /api/agent/my-parses, the bot's side of Mimic's My parses chart.
//
// A member asked (2026-10-06) for a graph of their own parses over a variable window; the guild lead picked a
// Mimic tab and a web page reading ONE Postgres function (my_parse_series). What can go wrong without anyone
// noticing:
//   * the person is taken from anywhere but the Mimic session (a query-string id would let a raider read
//     somebody else's parses);
//   * a window key resolves to the wrong start (the website and the bot disagree on where "this expansion"
//     begins, or w=constructor reaches a prototype property);
//   * a character name that is not a name reaches the database;
//   * the cache serves one person's answer to another, never expires, grows without bound, or keeps a FAILED read;
//   * a failed read is shown as an empty answer instead of a 502;
//   * the route is shed or budgeted like an ingest stream (it is a read route), or a thrown error leaks.
// The helper module is unit-tested directly; the real handler and the real dispatcher block are sliced out of
// index.js and run against a stub session and a stub database. Text assertions strip comments first.
//
// Run: npx vitest run test/my-parses.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
import { readSource, sliceBlock, evalBlock, stripJs, BOT_INDEX, ROOT } from './_source-slice.js';
import path from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const mp = nodeRequire('../utils/myParses.js');
const { changesSince } = nodeRequire('../utils/onboarding.js');

const NOW = Date.UTC(2026, 9, 6, 15, 0, 0);          // 2026-10-06 15:00Z: inside the PoP era
const DAY = 86400_000;
const iso = (ms) => new Date(ms).toISOString();

describe('resolveWindow', () => {
  it('rolling windows start N days before now and carry their labels', () => {
    expect(mp.resolveWindow('1d', NOW)).toEqual({ key: '1d', label: '1 day', since: iso(NOW - 1 * DAY) });
    expect(mp.resolveWindow('7d', NOW)).toEqual({ key: '7d', label: '1 week', since: iso(NOW - 7 * DAY) });
    expect(mp.resolveWindow('30d', NOW)).toEqual({ key: '30d', label: '30 days', since: iso(NOW - 30 * DAY) });
    expect(mp.resolveWindow('90d', NOW)).toEqual({ key: '90d', label: '90 days', since: iso(NOW - 90 * DAY) });
  });

  it('life has no lower bound', () => {
    expect(mp.resolveWindow('life', NOW)).toEqual({ key: 'life', label: 'Lifetime', since: null });
  });

  it('exp starts at the current expansion, named in the label', () => {
    expect(mp.resolveWindow('exp', NOW)).toEqual({ key: 'exp', label: 'PoP era', since: '2026-10-01T00:00:00.000Z' });
    // The day before PoP unlocks it is still Luclin; the second PoP begins it is PoP.
    expect(mp.resolveWindow('exp', Date.UTC(2026, 8, 30, 23, 59, 59))).toMatchObject({ label: 'Luclin era', since: '2025-10-01T00:00:00.000Z' });
    expect(mp.resolveWindow('exp', Date.UTC(2026, 9, 1, 0, 0, 0))).toMatchObject({ label: 'PoP era' });
    expect(mp.resolveWindow('exp', Date.UTC(2025, 5, 1))).toMatchObject({ label: 'Velious era', since: '2025-04-01T00:00:00.000Z' });
    expect(mp.resolveWindow('exp', Date.UTC(2024, 7, 1))).toMatchObject({ label: 'Kunark era', since: '2024-07-01T00:00:00.000Z' });
  });

  it('an unknown or non-string key is the 7 day default, prototype names included', () => {
    const week = mp.resolveWindow('7d', NOW);
    for (const raw of [undefined, null, '', '60d', '7D', ' 7d', 'year', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 7, ['30d'], {}]) {
      expect(mp.resolveWindow(raw, NOW)).toEqual(week);
    }
  });

  it('keeps in step with EXPANSION_STARTS in web/lib/timeWindow.ts', () => {
    const web = stripJs(readSource(path.join(ROOT, 'web', 'lib', 'timeWindow.ts')));
    const block = sliceBlock(web, 'export const EXPANSION_STARTS', '];');
    const rows = [...block.matchAll(/name:\s*'(\w+)',\s*startMs:\s*(Date\.UTC\([^)]*\)|\d+)/g)]
      .map(m => ({ name: m[1], startMs: new Function('return ' + m[2])() }));
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(mp.EXPANSION_STARTS).toEqual(rows);
  });
});

describe('cleanScope', () => {
  it('only "all" widens it; everything else is the curated bosses', () => {
    expect(mp.cleanScope('all')).toBe('all');
    for (const raw of ['bosses', 'ALL', 'All', ' all', '', null, undefined, 'trash', ['all']]) {
      expect(mp.cleanScope(raw)).toBe('bosses');
    }
  });
});

describe('cleanChar', () => {
  it('accepts a name, trimmed, with the characters a name can carry', () => {
    expect(mp.cleanChar('Aldenmar')).toBe('Aldenmar');
    expect(mp.cleanChar('  Brackwyn \t')).toBe('Brackwyn');
    expect(mp.cleanChar("Bri`an")).toBe("Bri`an");
    expect(mp.cleanChar("O'Neil")).toBe("O'Neil");
    expect(mp.cleanChar('Foo-Bar')).toBe('Foo-Bar');
    expect(mp.cleanChar('Foo Bar')).toBe('Foo Bar');
  });

  it('ignores what is not a name', () => {
    for (const raw of [undefined, null, '', '   ', 'Nyssara1', 'a;b', 'x=1', 'Zarrin|Corvale', 'a,b', '<b>', 'Rethlan%20', 'Rethlán', 'a\nb', ['Aldenmar'], 12]) {
      expect(mp.cleanChar(raw)).toBeNull();
    }
  });

  it('allows 64 characters and ignores 65', () => {
    expect(mp.cleanChar('a'.repeat(64))).toBe('a'.repeat(64));
    expect(mp.cleanChar('a'.repeat(65))).toBeNull();
    // The limit is on the trimmed name, not the raw string.
    expect(mp.cleanChar('  ' + 'a'.repeat(64) + '  ')).toBe('a'.repeat(64));
  });
});

describe('parseQuery', () => {
  it('defaults: 7 days, bosses, every character', () => {
    expect(mp.parseQuery('/api/agent/my-parses', NOW)).toEqual({
      w: { key: '7d', label: '1 week', since: iso(NOW - 7 * DAY) }, scope: 'bosses', char: null,
    });
  });

  it('reads w, scope and char', () => {
    const q = mp.parseQuery('/api/agent/my-parses?w=30d&scope=all&char=Aldenmar', NOW);
    expect(q.w.key).toBe('30d');
    expect(q.scope).toBe('all');
    expect(q.char).toBe('Aldenmar');
    expect(mp.parseQuery('/api/agent/my-parses?w=life', NOW).w.since).toBeNull();
  });

  it('decodes an encoded character name and ignores a bad one', () => {
    expect(mp.parseQuery('/x?char=Bri%60an', NOW).char).toBe('Bri`an');
    expect(mp.parseQuery('/x?char=Foo%20Bar', NOW).char).toBe('Foo Bar');
    expect(mp.parseQuery('/x?char=Foo%3BBar', NOW).char).toBeNull();
  });

  it('never reads a person from the query string', () => {
    const q = mp.parseQuery('/x?discord_id=999&user_id=u&user=someone&p_discord_id=999&w=1d', NOW);
    expect(Object.keys(q).sort()).toEqual(['char', 'scope', 'w']);
    expect(JSON.stringify(q)).not.toContain('999');
  });

  it('survives a URL that will not parse', () => {
    expect(mp.parseQuery('http://[bad', NOW).w.key).toBe('7d');
  });
});

describe('cacheKey', () => {
  const q = (url) => mp.parseQuery(url, NOW);
  it('is one slot per person, window, scope and character', () => {
    const base = mp.cacheKey('111', q('/x?w=7d&scope=bosses&char=Aldenmar'));
    expect(mp.cacheKey('111', q('/x?w=7d&scope=bosses&char=Aldenmar'))).toBe(base);
    expect(mp.cacheKey('222', q('/x?w=7d&scope=bosses&char=Aldenmar'))).not.toBe(base);
    expect(mp.cacheKey('111', q('/x?w=30d&scope=bosses&char=Aldenmar'))).not.toBe(base);
    expect(mp.cacheKey('111', q('/x?w=7d&scope=all&char=Aldenmar'))).not.toBe(base);
    expect(mp.cacheKey('111', q('/x?w=7d&scope=bosses&char=Brackwyn'))).not.toBe(base);
    expect(mp.cacheKey('111', q('/x?w=7d&scope=bosses'))).not.toBe(base);
  });

  it('folds the character name, which the database matches case-insensitively', () => {
    expect(mp.cacheKey('111', q('/x?char=ALDENMAR'))).toBe(mp.cacheKey('111', q('/x?char=aldenmar')));
  });

  it('a bad window or scope shares the slot of the default it falls back to', () => {
    expect(mp.cacheKey('111', q('/x?w=bogus&scope=bogus'))).toBe(mp.cacheKey('111', q('/x')));
  });
});

describe('createCache', () => {
  it('serves within the TTL and drops the entry after it', () => {
    let t = 1000;
    const c = mp.createCache({ ttlMs: 300_000, now: () => t });
    c.set('k', 'v');
    expect(c.get('k')).toBe('v');
    t += 299_999;
    expect(c.get('k')).toBe('v');
    t += 1;
    expect(c.get('k')).toBeUndefined();
    expect(c.size).toBe(0);
  });

  it('is five minutes and 500 entries unless told otherwise', () => {
    expect(mp.CACHE_TTL_MS).toBe(5 * 60 * 1000);
    expect(mp.CACHE_MAX).toBe(500);
  });

  it('drops the OLDEST entry past the bound, and a re-set counts as new', () => {
    const c = mp.createCache({ max: 3, now: () => 0 });
    c.set('a', 1); c.set('b', 2); c.set('c', 3);
    c.set('a', 11);                                   // a is now the newest
    c.set('d', 4);                                    // evicts b, the oldest
    expect(c.size).toBe(3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(11);
    expect(c.get('c')).toBe(3);
    expect(c.get('d')).toBe(4);
  });

  it('the default bound holds', () => {
    const c = mp.createCache({ now: () => 0 });
    for (let i = 0; i < mp.CACHE_MAX + 50; i++) c.set('k' + i, i);
    expect(c.size).toBe(mp.CACHE_MAX);
    expect(c.get('k0')).toBeUndefined();
    expect(c.get('k' + (mp.CACHE_MAX + 49))).toBe(mp.CACHE_MAX + 49);
  });
});

describe('fetchSeries', () => {
  const RPC_OBJ = { floor: '2026-07-14T00:00:00Z', characters: [], total: 0, truncated: false, fights: [], nights: [] };
  const stub = (result) => { const calls = []; return { calls, rpc: async (fn, params) => { calls.push({ fn, params }); return result; } }; };

  it('calls my_parse_series with the person, the window start and the scope', async () => {
    const sb = stub(RPC_OBJ);
    const q = mp.parseQuery('/x?w=30d', NOW);
    await mp.fetchSeries(sb, '111', q);
    expect(sb.calls).toHaveLength(1);
    expect(sb.calls[0].fn).toBe('my_parse_series');
    expect(sb.calls[0].params).toEqual({ p_discord_id: '111', p_since: iso(NOW - 30 * DAY), p_bosses_only: true });
  });

  it('scope=all turns bosses_only off; lifetime sends a null start; a character is passed through', async () => {
    const sb = stub(RPC_OBJ);
    await mp.fetchSeries(sb, '111', mp.parseQuery('/x?w=life&scope=all&char=Aldenmar', NOW));
    expect(sb.calls[0].params).toEqual({ p_discord_id: '111', p_since: null, p_bosses_only: false, p_character: 'Aldenmar' });
  });

  it('answers the function\'s object plus the window and scope it was asked for', async () => {
    const out = await mp.fetchSeries(stub(RPC_OBJ), '111', mp.parseQuery('/x?w=exp&scope=all', NOW));
    expect(out).toEqual({
      ...RPC_OBJ,
      window: { key: 'exp', label: 'PoP era', since: '2026-10-01T00:00:00.000Z' },
      scope: 'all',
    });
  });

  it('a failed read (null) or a value that is not the one object is null, never an empty answer', async () => {
    const q = mp.parseQuery('/x', NOW);
    for (const bad of [null, undefined, [], [RPC_OBJ], 'oops', 0, false]) {
      expect(await mp.fetchSeries(stub(bad), '111', q)).toBeNull();
    }
  });
});

describe('the route', () => {
  const src = readSource(BOT_INDEX);
  const handlerSrc = sliceBlock(src, "const myParses = require('./utils/myParses');", '\n}\n');
  const dispatchSrc = sliceBlock(src,
    "if (req.method === 'GET' && req.url.startsWith('/api/agent/my-parses')) {",
    "internal error' }));\n    }\n  }");

  let S, handler;
  function fakeRes() {
    return {
      code: null, headers: null, body: null,
      writeHead(code, headers) { this.code = code; this.headers = headers || {}; },
      end(body) { this.body = body; },
      json() { return JSON.parse(Buffer.isBuffer(this.body) ? zlib.gunzipSync(this.body).toString() : this.body); },
    };
  }
  const req = (url, headers = {}) => ({ url, method: 'GET', headers });
  const RPC_OBJ = {
    floor: '2026-07-14T00:00:00Z', characters: [{ name: 'Aldenmar', class: 'Warrior', active: true }],
    total: 1, truncated: false,
    fights: [{ t: '2026-10-05T01:00:00Z', eid: 7, npc_id: 1, name: 'Lord Nagafen', boss: true, char: 'Aldenmar', dps: 410, dmg: 50000, dur: 120, rank: 1, usual: 395 }],
    nights: [{ night: '2026-10-04', fights: 1, bosses: 1, avg_dps: 410, best_dps: 410 }],
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    S = {
      nodeRequire, auth: { discord_id: '111', user_id: 'u1' }, rpcCalls: [], rpcResult: RPC_OBJ, rpcThrows: false,
      SB: { rpc: async (fn, params) => { S.rpcCalls.push({ fn, params }); if (S.rpcThrows) throw new Error('boom'); return S.rpcResult; } },
    };
    globalThis.__myParsesTest = S;
    const prefix = `
      const __s = globalThis.__myParsesTest;
      const require = (m) => m === './utils/supabase' ? __s.SB : m === './utils/myParses' ? __s.nodeRequire('../utils/myParses.js') : __s.nodeRequire(m);
      const mimicLink = { requireAgentAuth: async (req, res) => {
        if (!__s.auth) { res.writeHead(401, {}); res.end('{"error":"unauthorized"}'); return null; }
        return __s.auth;
      } };
    `;
    handler = evalBlock(prefix + handlerSrc, ['_handleAgentMyParses', '_myParsesCache'])._handleAgentMyParses;
  });
  afterEach(() => { vi.useRealTimers(); delete globalThis.__myParsesTest; });

  it('answers the function\'s object with the window and scope, as JSON', async () => {
    const res = fakeRes();
    await handler(req('/api/agent/my-parses?w=30d&scope=all&char=Aldenmar'), res);
    expect(res.code).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(res.json()).toEqual({
      ...RPC_OBJ,
      window: { key: '30d', label: '30 days', since: iso(NOW - 30 * DAY) },
      scope: 'all',
    });
    expect(S.rpcCalls).toEqual([{
      fn: 'my_parse_series',
      params: { p_discord_id: '111', p_since: iso(NOW - 30 * DAY), p_bosses_only: false, p_character: 'Aldenmar' },
    }]);
  });

  it('with no query it is the last week of the curated bosses across every character', async () => {
    const res = fakeRes();
    await handler(req('/api/agent/my-parses'), res);
    expect(res.json().window).toEqual({ key: '7d', label: '1 week', since: iso(NOW - 7 * DAY) });
    expect(res.json().scope).toBe('bosses');
    expect(S.rpcCalls[0].params).toEqual({ p_discord_id: '111', p_since: iso(NOW - 7 * DAY), p_bosses_only: true });
  });

  it('asks about the Mimic session\'s person and nobody a query string names', async () => {
    const res = fakeRes();
    await handler(req('/api/agent/my-parses?discord_id=999&user_id=u9&p_discord_id=999&user=999'), res);
    expect(res.code).toBe(200);
    expect(S.rpcCalls).toHaveLength(1);
    expect(S.rpcCalls[0].params.p_discord_id).toBe('111');
    expect(JSON.stringify(S.rpcCalls)).not.toContain('999');
  });

  it('a request without a good session is turned away and asks the database nothing', async () => {
    S.auth = null;
    const res = fakeRes();
    await handler(req('/api/agent/my-parses'), res);
    expect(res.code).toBe(401);
    expect(S.rpcCalls).toHaveLength(0);
  });

  it('a session with no Discord id is a 403 and asks the database nothing', async () => {
    for (const bad of [{ user_id: 'u1' }, { discord_id: '', user_id: 'u1' }, { discord_id: null }]) {
      S.auth = bad;
      const res = fakeRes();
      await handler(req('/api/agent/my-parses'), res);
      expect(res.code).toBe(403);
    }
    expect(S.rpcCalls).toHaveLength(0);
  });

  it('a failed read is a 502 "unavailable", and is not remembered', async () => {
    S.rpcResult = null;
    const failed = fakeRes();
    await handler(req('/api/agent/my-parses?w=1d'), failed);
    expect(failed.code).toBe(502);
    expect(JSON.parse(failed.body)).toEqual({ error: 'unavailable' });

    S.rpcResult = RPC_OBJ;                                  // the very next ask succeeds and is not served the failure
    const ok = fakeRes();
    await handler(req('/api/agent/my-parses?w=1d'), ok);
    expect(ok.code).toBe(200);
    expect(S.rpcCalls).toHaveLength(2);
  });

  it('keeps an answer five minutes per person, window, scope and character', async () => {
    const ask = async (url, who = '111') => { S.auth = { discord_id: who }; const r = fakeRes(); await handler(req(url), r); return r; };
    await ask('/api/agent/my-parses?w=7d');
    await ask('/api/agent/my-parses?w=7d');
    await ask('/api/agent/my-parses');                      // no w is the same slot as w=7d
    await ask('/api/agent/my-parses?w=7d&char=aldenmar');   // a new slot ...
    await ask('/api/agent/my-parses?w=7d&char=ALDENMAR');   // ... that the other spelling shares
    expect(S.rpcCalls).toHaveLength(2);
    await ask('/api/agent/my-parses?w=7d', '222');          // another person never reads this person's slot
    await ask('/api/agent/my-parses?w=30d');
    await ask('/api/agent/my-parses?w=7d&scope=all');
    expect(S.rpcCalls).toHaveLength(5);
    expect(S.rpcCalls.filter(c => c.params.p_discord_id === '222')).toHaveLength(1);

    vi.setSystemTime(NOW + 5 * 60 * 1000 - 1);
    await ask('/api/agent/my-parses?w=7d');
    expect(S.rpcCalls).toHaveLength(5);                     // still inside the five minutes
    vi.setSystemTime(NOW + 5 * 60 * 1000);
    await ask('/api/agent/my-parses?w=7d');
    expect(S.rpcCalls).toHaveLength(6);                     // expired: read again
  });

  it('gzips for a client that takes gzip, and says the body varies on it', async () => {
    const plain = fakeRes();
    await handler(req('/api/agent/my-parses', {}), plain);
    expect(plain.headers['Content-Encoding']).toBeUndefined();
    expect(plain.headers['Vary']).toBe('Accept-Encoding');
    expect(typeof plain.body).toBe('string');

    const gz = fakeRes();
    await handler(req('/api/agent/my-parses', { 'accept-encoding': 'gzip, deflate, br' }), gz);
    expect(gz.code).toBe(200);
    expect(gz.headers['Content-Encoding']).toBe('gzip');
    expect(gz.headers['Vary']).toBe('Accept-Encoding');
    expect(Buffer.isBuffer(gz.body)).toBe(true);
    expect(zlib.gunzipSync(gz.body).toString()).toBe(plain.body);

    const idOnly = fakeRes();
    await handler(req('/api/agent/my-parses', { 'accept-encoding': 'identity' }), idOnly);
    expect(idOnly.headers['Content-Encoding']).toBeUndefined();
  });

  describe('dispatch', () => {
    let route, handlerCalls, logged;
    beforeEach(() => {
      handlerCalls = []; logged = [];
      const make = new Function('__h', '__log', `
        const console = { error: (...a) => __log.push(a) };
        const _handleAgentMyParses = __h;
        return async function route(req, res) {
          ${dispatchSrc}
          return 'fell-through';
        };`);
      route = (h) => make(h, logged);
    });

    it('handles GET /api/agent/my-parses (with or without a query) and nothing else', async () => {
      const h = async (rq) => { handlerCalls.push(rq.url); return 'handled'; };
      const r = route(h);
      expect(await r(req('/api/agent/my-parses'), fakeRes())).toBe('handled');
      expect(await r(req('/api/agent/my-parses?w=1d'), fakeRes())).toBe('handled');
      expect(handlerCalls).toHaveLength(2);
      expect(await r({ ...req('/api/agent/my-parses'), method: 'POST' }, fakeRes())).toBe('fell-through');
      expect(await r(req('/api/agent/mob-info'), fakeRes())).toBe('fell-through');
      expect(handlerCalls).toHaveLength(2);
    });

    it('a handler that throws is a logged 500 "internal error", not a crash or a leak', async () => {
      const res = fakeRes();
      await route(async () => { throw new Error('secret detail'); })(req('/api/agent/my-parses'), res);
      expect(res.code).toBe(500);
      expect(JSON.parse(res.body)).toEqual({ error: 'internal error' });
      expect(res.body).not.toContain('secret detail');
      expect(logged[0][0]).toBe('[my-parses] handler error:');
    });

    it('is a read route: no shed flag, no admission budget in front of it', () => {
      const code = stripJs(dispatchSrc);
      expect(code).not.toMatch(/_overBudget|_isShedded|_shed/);
      expect(code).toMatch(/_handleAgentMyParses/);
    });
  });
});

describe('release bookkeeping', () => {
  it('3.1.210 has a changelog line about the parses', () => {
    const lines = changesSince('3.1.209').filter(l => l.startsWith('**3.1.210**'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/parses/i);
  });
});
