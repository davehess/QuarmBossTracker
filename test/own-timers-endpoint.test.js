// test/own-timers-endpoint.test.js — a player's own pet/self buff timers, kept in the database.
//
// The guild lead (2026-10-13): timers on a player's own pet (and self) should pause while they are logged out
// and be "synced to the database so if I logged on from a different machine or if my installation failed I
// would still have those buff timers." POST /api/agent/own-timers saves the agent's set under bot_kv
// `own_timers:<name lowercased>`; GET ...?character=<Name> reads it back. What can go wrong without anyone noticing:
//   * a character that is not the caller's has its timers written or read (the person must come from the session);
//   * the row lands under the wrong key (case-sensitive, so a second spelling forks the copy) or the wrong guild;
//   * a malformed buff entry is stored and later crashes the agent's restore, or the caps are not enforced;
//   * a body of any size gets through, or the route skips auth;
//   * a failed database call is answered as success, or "never saved" is answered as an error.
// utils/ownTimers.js is tested through the real route glue sliced out of index.js, against a stub database and
// stub session; the dispatcher block is checked as text with comments stripped.
//
// Run: npx vitest run test/own-timers-endpoint.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, evalBlock, stripJs, BOT_INDEX } from './_source-slice.js';

const nodeRequire = createRequire(import.meta.url);
const ot = nodeRequire('../utils/ownTimers.js');

const buff = (o = {}) => ({ name: 'Spirit of Wolf', dur_ticks: 100, dur_formula: 3, landed_at: 1760000000000, ...o });

// Records every call and refuses anything but the methods the feature may use.
function stubDb({ family = ['Aldenmar', 'Brackwyn'], rows = [], upsertResult } = {}) {
  const db = {
    calls: [], family, rows, upsertResult,
    async rpc(fn, params) { db.calls.push({ m: 'rpc', fn, params }); return db.family; },
    async select(table, query) { db.calls.push({ m: 'select', table, query }); return db.rows; },
    async upsert(table, rows, onConflict) {
      db.calls.push({ m: 'upsert', table, rows, onConflict });
      return db.upsertResult !== undefined ? db.upsertResult : rows;
    },
  };
  return new Proxy(db, {
    get(t, k) {
      if (k in t || typeof k === 'symbol') return t[k];
      throw new Error('unexpected supabase.' + String(k) + ' — this feature upserts one bot_kv row and reads one');
    },
  });
}
const upserts = (db) => db.calls.filter(c => c.m === 'upsert');

describe('the route', () => {
  const src = readSource(BOT_INDEX);
  const glueSrc = sliceBlock(src, "const ownTimers = require('./utils/ownTimers');",
    "url.searchParams.get('character') || ''));\n}");

  let S, h;
  function fakeRes() {
    return {
      code: null, headers: null, body: null,
      writeHead(code, headers) { this.code = code; this.headers = headers || {}; },
      end(body) { this.body = body; },
      json() { return JSON.parse(this.body); },
    };
  }
  const getReq = (url) => ({ url, method: 'GET', headers: {} });
  const postReq = (body) => {
    const chunks = typeof body === 'string' || Buffer.isBuffer(body) ? [Buffer.from(body)] : [Buffer.from(JSON.stringify(body))];
    return { url: '/api/agent/own-timers', method: 'POST', headers: {}, async *[Symbol.asyncIterator]() { for (const c of chunks) yield c; } };
  };
  const goodBody = (o = {}) => ({ character: 'Aldenmar', pet_name: 'Gabber', last_line_ms: 1760000001000, pet_buffs: [buff()], ...o });

  beforeEach(() => {
    S = { nodeRequire, db: stubDb(), auth: { discord_id: '111', user_id: 'u1' } };
    globalThis.__otTest = S;
    const prefix = `
      const __s = globalThis.__otTest;
      const require = (m) => m === './utils/supabase' ? __s.db : __s.nodeRequire(m.replace('./utils/', '../utils/') + '.js');
      const mimicLink = { requireAgentAuth: async (req, res) => {
        if (!__s.auth) { res.writeHead(401, {}); res.end('{"error":"unauthorized"}'); return null; }
        return __s.auth;
      } };
      const characterPrefs = require('./utils/characterPrefs');
      const _ownedCharsCache = characterPrefs.createOwnedCache();
      function _sendPrefsResult(res, out) {
        res.writeHead(out.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(out.body));
      }
    `;
    h = evalBlock(prefix + glueSrc, ['_handleAgentOwnTimersSet', '_handleAgentOwnTimersGet']);
  });

  describe('POST', () => {
    it('stores the owner\'s timers under own_timers:<lowercased name> in the deployment guild', async () => {
      const res = fakeRes();
      await h._handleAgentOwnTimersSet(postReq(goodBody({ character: 'aldenmar' })), res);
      expect(res.code).toBe(200);
      const out = res.json();
      expect(out.ok).toBe(true);
      expect(upserts(S.db)).toHaveLength(1);
      const u = upserts(S.db)[0];
      expect(u.table).toBe('bot_kv');
      expect(u.onConflict).toBe('guild_id,key');
      expect(u.rows).toHaveLength(1);
      expect(u.rows[0].key).toBe('own_timers:aldenmar');
      expect(u.rows[0].guild_id).toBe(ot.GUILD);
      expect(u.rows[0].value).toEqual({
        character: 'Aldenmar', pet_name: 'Gabber', last_line_ms: 1760000001000,
        pet_buffs: [buff()], saved_at: out.saved_at,
      });
      expect(new Date(out.saved_at).toISOString()).toBe(out.saved_at);
    });

    it('a different spelling of the same name writes the same key', async () => {
      for (const c of ['Aldenmar', 'ALDENMAR']) await h._handleAgentOwnTimersSet(postReq(goodBody({ character: c })), fakeRes());
      const keys = upserts(S.db).map(u => u.rows[0].key);
      expect(keys).toEqual(['own_timers:aldenmar', 'own_timers:aldenmar']);
    });

    it('null pet_name and last_line_ms are kept as null', async () => {
      const res = fakeRes();
      await h._handleAgentOwnTimersSet(postReq(goodBody({ pet_name: null, last_line_ms: null, pet_buffs: [] })), res);
      expect(res.code).toBe(200);
      const v = upserts(S.db)[0].rows[0].value;
      expect(v.pet_name).toBeNull();
      expect(v.last_line_ms).toBeNull();
      expect(v.pet_buffs).toEqual([]);
    });

    it('a character that is not the caller\'s is a 403 and writes nothing', async () => {
      const res = fakeRes();
      await h._handleAgentOwnTimersSet(postReq(goodBody({ character: 'Zarrin' })), res);
      expect(res.code).toBe(403);
      expect(res.json()).toEqual({ error: 'not your character' });
      expect(upserts(S.db)).toHaveLength(0);
    });

    it('takes the person from the session, never the body', async () => {
      const res = fakeRes();
      await h._handleAgentOwnTimersSet(postReq(goodBody({ discord_id: '999' })), res);
      expect(res.code).toBe(200);
      expect(JSON.stringify(S.db.calls)).not.toContain('999');
      expect(S.db.calls.find(c => c.m === 'rpc').params).toEqual({ p_discord_id: '111' });
    });

    it('drops malformed buff entries silently and keeps the good ones', async () => {
      const good = buff({ name: 'Good' });
      const edge = buff({ name: 'Edge', dur_ticks: 100000, dur_formula: null });
      const bad = [
        null, 'x', 7, [],
        buff({ name: '' }), buff({ name: 5 }), buff({ name: 'n'.repeat(65) }),
        buff({ dur_ticks: -1 }), buff({ dur_ticks: 100001 }), buff({ dur_ticks: '10' }), buff({ dur_ticks: NaN }),
        buff({ dur_formula: 'x' }), buff({ dur_formula: true }),
        buff({ landed_at: '1760000000000' }), buff({ landed_at: null }), buff({ landed_at: undefined }),
      ];
      const res = fakeRes();
      await h._handleAgentOwnTimersSet(postReq(goodBody({ pet_buffs: [...bad, good, edge] })), res);
      expect(res.code).toBe(200);
      expect(upserts(S.db)[0].rows[0].value.pet_buffs).toEqual([good, edge]);
    });

    it('strips fields it does not know from a buff entry', async () => {
      await h._handleAgentOwnTimersSet(postReq(goodBody({ pet_buffs: [{ ...buff(), extra: 'x' }] })), fakeRes());
      expect(Object.keys(upserts(S.db)[0].rows[0].value.pet_buffs[0]).sort())
        .toEqual(['dur_formula', 'dur_ticks', 'landed_at', 'name']);
    });

    it('keeps at most 40 buffs', async () => {
      const many = Array.from({ length: 55 }, (_, i) => buff({ name: 'b' + i }));
      await h._handleAgentOwnTimersSet(postReq(goodBody({ pet_buffs: many })), fakeRes());
      const stored = upserts(S.db)[0].rows[0].value.pet_buffs;
      expect(stored).toHaveLength(40);
      expect(stored[39].name).toBe('b39');
    });

    it('a bad envelope is a 400 and asks the database nothing', async () => {
      const cases = [
        goodBody({ character: 'Al1' }), goodBody({ character: 'x' }), goodBody({ character: 'A'.repeat(21) }),
        goodBody({ character: undefined }),
        goodBody({ pet_name: 'p'.repeat(65) }), goodBody({ pet_name: 5 }),
        goodBody({ last_line_ms: 'now' }), goodBody({ last_line_ms: true }),
        goodBody({ pet_buffs: 'nope' }), goodBody({ pet_buffs: undefined }),
        [], 'null',
      ];
      for (const body of cases) {
        const res = fakeRes();
        await h._handleAgentOwnTimersSet(postReq(body), res);
        expect(res.code).toBe(400);
      }
      expect(S.db.calls).toHaveLength(0);
    });

    it('invalid JSON is a 400', async () => {
      const res = fakeRes();
      await h._handleAgentOwnTimersSet(postReq('{nope'), res);
      expect(res.code).toBe(400);
      expect(S.db.calls).toHaveLength(0);
    });

    it('a body over 16 KB is a 413 and nothing is asked; one just under still goes through', async () => {
      const res = fakeRes();
      await h._handleAgentOwnTimersSet(postReq(goodBody({ pet_name: 'p'.repeat(17 * 1024) })), res);
      expect(res.code).toBe(413);
      expect(S.db.calls).toHaveLength(0);
      const ok = fakeRes();
      const pad = '{"character":"Aldenmar","pet_buffs":[],"pad":"' + 'p'.repeat(16 * 1024 - 60) + '"}';
      await h._handleAgentOwnTimersSet(postReq(pad), ok);
      expect(ok.code).toBe(200);
    });

    it('a request without a good session is turned away before anything is asked', async () => {
      S.auth = null;
      const res = fakeRes();
      await h._handleAgentOwnTimersSet(postReq(goodBody()), res);
      expect(res.code).toBe(401);
      expect(S.db.calls).toHaveLength(0);
    });

    it('a session with no Discord id is a 403', async () => {
      S.auth = { user_id: 'u1' };
      const res = fakeRes();
      await h._handleAgentOwnTimersSet(postReq(goodBody()), res);
      expect(res.code).toBe(403);
      expect(S.db.calls).toHaveLength(0);
    });

    it('a failed family read or a failed write is a 502, never an ok', async () => {
      S.db.family = null;
      const a = fakeRes();
      await h._handleAgentOwnTimersSet(postReq(goodBody()), a);
      expect(a.code).toBe(502);
      expect(upserts(S.db)).toHaveLength(0);

      S.db = stubDb({ upsertResult: null });
      const b = fakeRes();
      await h._handleAgentOwnTimersSet(postReq(goodBody()), b);
      expect(b.code).toBe(502);
    });
  });

  describe('GET', () => {
    const stored = { character: 'Aldenmar', pet_name: 'Gabber', last_line_ms: 5, pet_buffs: [buff()], saved_at: '2026-10-13T00:00:00.000Z' };

    it('returns the stored value for the owner, read from the lowercased key', async () => {
      S.db.rows = [{ value: stored }];
      const res = fakeRes();
      await h._handleAgentOwnTimersGet(getReq('/api/agent/own-timers?character=ALDENMAR'), res);
      expect(res.code).toBe(200);
      expect(res.json()).toEqual({ ok: true, timers: stored });
      const sel = S.db.calls.find(c => c.m === 'select');
      expect(sel.table).toBe('bot_kv');
      expect(decodeURIComponent(sel.query)).toContain('key=eq.own_timers:aldenmar');
      expect(decodeURIComponent(sel.query)).toContain('guild_id=eq.' + ot.GUILD);
    });

    it('returns timers: null when nothing was ever saved', async () => {
      S.db.rows = [];
      const res = fakeRes();
      await h._handleAgentOwnTimersGet(getReq('/api/agent/own-timers?character=Brackwyn'), res);
      expect(res.code).toBe(200);
      expect(res.json()).toEqual({ ok: true, timers: null });
    });

    it('a character that is not the caller\'s is a 403 and reads nothing', async () => {
      S.db.rows = [{ value: stored }];
      const res = fakeRes();
      await h._handleAgentOwnTimersGet(getReq('/api/agent/own-timers?character=Zarrin'), res);
      expect(res.code).toBe(403);
      expect(res.body).not.toContain('Gabber');
      expect(S.db.calls.filter(c => c.m === 'select')).toHaveLength(0);
    });

    it('a missing or malformed character is a 400', async () => {
      for (const q of ['', '?character=', '?character=A1', '?character=' + 'A'.repeat(21)]) {
        const res = fakeRes();
        await h._handleAgentOwnTimersGet(getReq('/api/agent/own-timers' + q), res);
        expect(res.code).toBe(400);
      }
      expect(S.db.calls).toHaveLength(0);
    });

    it('a failed read is a 502, not "never saved"', async () => {
      S.db.rows = null;
      const res = fakeRes();
      await h._handleAgentOwnTimersGet(getReq('/api/agent/own-timers?character=Aldenmar'), res);
      expect(res.code).toBe(502);
    });

    it('a request without a good session is turned away before anything is asked', async () => {
      S.auth = null;
      const res = fakeRes();
      await h._handleAgentOwnTimersGet(getReq('/api/agent/own-timers?character=Aldenmar'), res);
      expect(res.code).toBe(401);
      expect(S.db.calls).toHaveLength(0);
    });
  });
});

describe('the dispatcher', () => {
  const src = stripJs(readSource(BOT_INDEX));
  it('routes GET (prefix) and POST (exact) to the two handlers', () => {
    expect(src).toMatch(/req\.method === 'GET' && req\.url\.startsWith\('\/api\/agent\/own-timers'\)[\s\S]{0,120}_handleAgentOwnTimersGet\(req, res\)/);
    expect(src).toMatch(/req\.method === 'POST' && req\.url === '\/api\/agent\/own-timers'[\s\S]{0,120}_handleAgentOwnTimersSet\(req, res\)/);
  });
  it('is not a shed kind: restore data stays on', () => {
    const shed = sliceBlock(src, 'const _SHED_KINDS = new Set([', ']);');
    expect(shed).not.toMatch(/own_timers/);
  });
});
