// test/character-prefs-write.test.js — Mimic SETS a character's display and collection switches.
//
// The guild lead (2026-10-06): "the complete hide or hide from all but inventory should be with mimic during
// onboarding but the denotation on other side should be carried over." POST /api/agent/character-prefs writes
// the same three columns on the characters row that wolfpack.quest/me writes, and GET ...?mine=1 lists the
// caller's family with each one's current state. What can go wrong without anyone noticing:
//   * a mode writes the wrong flags (a "hidden from lists" choice that also stops collecting, or "hidden
//     completely" that still uploads), or the mode a row is NAMED by disagrees with the mode that wrote it;
//   * a character that is not the caller's gets its flags changed, or the person is taken from the body;
//   * a body that is not exactly right is coerced into a write ("yes" for true, an unknown mode for show),
//     or can reach a column that is not one of the three (tell_relay, discord_id);
//   * a character set to hidden completely drops out of the list, so it can never be switched back;
//   * a failed family read is treated as "owns nothing" (or the other way), or the family is read on every click;
//   * the route skips auth, lets a request body of any size through, or the existing GET changes behaviour.
// utils/characterPrefs.js is tested directly against a stub database; the real route glue and the real
// dispatcher block are sliced out of index.js and run against a stub session. Text assertions strip comments.
//
// Run: npx vitest run test/character-prefs-write.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, stripSql, BOT_INDEX, ROOT } from './_source-slice.js';

const nodeRequire = createRequire(import.meta.url);
const cp = nodeRequire('../utils/characterPrefs.js');
const { changesSince } = nodeRequire('../utils/onboarding.js');

const ALL = ['hidden_from_lists', 'exclude_from_stats', 'exclude_inventory'];
const flags = (hidden, stats, inv) => ({ hidden_from_lists: hidden, exclude_from_stats: stats, exclude_inventory: inv });

// A stand-in for utils/supabase that records every call and refuses anything but the three methods the
// feature may use, so a stray insert/upsert/del (an audit row, a second table) fails loudly.
function stubDb({ family = ['Aldenmar', 'Brackwyn', 'Corvale'], updateResult, selectResult } = {}) {
  const db = {
    calls: [], family, updateResult, selectResult,
    async rpc(fn, params) { db.calls.push({ m: 'rpc', fn, params }); return db.family; },
    async update(table, query, body) {
      db.calls.push({ m: 'update', table, query, body });
      if (db.updateResult !== undefined) return db.updateResult;
      const name = decodeURIComponent(query.match(/name=eq\.([^&]*)/)[1]);
      return [{ name, ...flags(false, false, false), ...body }];
    },
    async select(table, query) { db.calls.push({ m: 'select', table, query }); return db.selectResult; },
  };
  return new Proxy(db, {
    get(t, k) {
      if (k in t || typeof k === 'symbol') return t[k];
      throw new Error('unexpected supabase.' + String(k) + ' — this feature writes one characters row and nothing else');
    },
  });
}
const writes = (db) => db.calls.filter(c => c.m === 'update');

describe('modes', () => {
  it('each mode is exactly its three flags', () => {
    expect(cp.MODE_FLAGS.show).toEqual(flags(false, false, false));
    expect(cp.MODE_FLAGS.inventory).toEqual(flags(true, false, false));   // hidden from lists, still collected
    expect(cp.MODE_FLAGS.hidden).toEqual(flags(true, true, true));        // hidden, excluded from stats, inventory excluded
    expect(cp.MODES).toEqual(['show', 'inventory', 'hidden']);
    expect(Object.isFrozen(cp.MODE_FLAGS)).toBe(true);
    expect(Object.isFrozen(cp.MODE_FLAGS.hidden)).toBe(true);
  });

  it('modeOf names each mode back, and every other combination custom', () => {
    expect(cp.modeOf(flags(false, false, false))).toBe('show');
    expect(cp.modeOf(flags(true, false, false))).toBe('inventory');
    expect(cp.modeOf(flags(true, true, true))).toBe('hidden');
    for (const m of cp.MODES) expect(cp.modeOf(cp.MODE_FLAGS[m])).toBe(m);
    const custom = [flags(false, true, false), flags(false, false, true), flags(false, true, true), flags(true, true, false), flags(true, false, true)];
    for (const f of custom) expect(cp.modeOf(f)).toBe('custom');
    // the 8 combinations are 3 named + 5 custom, none left over
    const all8 = [0, 1].flatMap(h => [0, 1].flatMap(s => [0, 1].map(i => flags(!!h, !!s, !!i))));
    expect(all8.map(cp.modeOf).filter(m => m === 'custom')).toHaveLength(5);
  });

  it('null, absent and missing columns read as off, as the website reads them', () => {
    expect(cp.prefsOf({ hidden_from_lists: null })).toEqual(flags(false, false, false));
    expect(cp.prefsOf({})).toEqual(flags(false, false, false));
    expect(cp.prefsOf(null)).toEqual(flags(false, false, false));
    expect(cp.modeOf({ name: 'Aldenmar', hidden_from_lists: true, exclude_from_stats: null })).toBe('inventory');
    // only the three flags come out: a row's other columns (tell_relay, discord_id) are not carried along
    expect(Object.keys(cp.prefsOf({ name: 'x', tell_relay: true, discord_id: '1', hidden_from_lists: true })).sort()).toEqual([...ALL].sort());
  });
});

describe('parseSetBody', () => {
  it('a mode writes all three flags', () => {
    for (const m of cp.MODES) {
      expect(cp.parseSetBody({ character: 'Aldenmar', mode: m })).toEqual({ ok: true, character: 'Aldenmar', patch: cp.MODE_FLAGS[m] });
    }
  });

  it('the patch is its own object, so writing it cannot reach the mode table', () => {
    const r = cp.parseSetBody({ character: 'Aldenmar', mode: 'hidden' });
    r.patch.hidden_from_lists = false;
    expect(cp.MODE_FLAGS.hidden.hidden_from_lists).toBe(true);
  });

  it('an explicit boolean overrides the mode on that one flag', () => {
    expect(cp.parseSetBody({ character: 'Aldenmar', mode: 'hidden', exclude_from_stats: false }).patch).toEqual(flags(true, false, true));
    expect(cp.parseSetBody({ character: 'Aldenmar', mode: 'show', hidden_from_lists: true }).patch).toEqual(flags(true, false, false));
    expect(cp.parseSetBody({ character: 'Aldenmar', mode: 'inventory', hidden_from_lists: false, exclude_inventory: true }).patch).toEqual(flags(false, false, true));
  });

  it('booleans alone change only the flags that were sent', () => {
    expect(cp.parseSetBody({ character: 'Aldenmar', exclude_from_stats: true }).patch).toEqual({ exclude_from_stats: true });
    expect(cp.parseSetBody({ character: 'Aldenmar', hidden_from_lists: false, exclude_inventory: true }).patch).toEqual({ hidden_from_lists: false, exclude_inventory: true });
  });

  it('trims the name and only ever patches the three columns', () => {
    const r = cp.parseSetBody({
      character: '  Brackwyn ', mode: 'show',
      tell_relay: true, tell_dm: true, discord_id: '999', main_name: 'Rethlan', show_inventory_publicly: true, guild_id: 'other', rank: 'Trader',
    });
    expect(r.character).toBe('Brackwyn');
    expect(Object.keys(r.patch).sort()).toEqual([...ALL].sort());
  });

  it('refuses a body that is not a JSON object', () => {
    for (const bad of [null, undefined, [], [{ character: 'Aldenmar', mode: 'show' }], 'Aldenmar', 5, true]) {
      expect(cp.parseSetBody(bad)).toEqual({ ok: false, error: 'json object required' });
    }
  });

  it('refuses a missing or non-name character', () => {
    for (const character of [undefined, null, '', '   ', 'Nyssara1', 'a;b', 'x=1', 'a,b', '<b>', 'Rethlan%20', ['Aldenmar'], 12, 'a'.repeat(65)]) {
      expect(cp.parseSetBody({ character, mode: 'show' })).toEqual({ ok: false, error: 'character required' });
    }
  });

  it('refuses an unknown or non-string mode, prototype names included (no fallback to show)', () => {
    for (const mode of ['Hidden', 'SHOW', ' show', 'all', 'custom', '', 'constructor', '__proto__', 'toString', 'hasOwnProperty', null, 0, 1, true, ['show'], {}]) {
      const r = cp.parseSetBody({ character: 'Aldenmar', mode });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/^mode must be one of: show, inventory, hidden$/);
    }
  });

  it('refuses a flag that is not exactly true or false (nothing is coerced)', () => {
    for (const c of ALL) {
      for (const v of ['true', 'false', 'yes', 1, 0, null, [], {}, 'on']) {
        expect(cp.parseSetBody({ character: 'Aldenmar', mode: 'show', [c]: v })).toEqual({ ok: false, error: c + ' must be a boolean' });
      }
    }
  });

  it('a body with neither a mode nor a flag has nothing to write', () => {
    const r = cp.parseSetBody({ character: 'Aldenmar' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/mode or at least one of/);
    expect(cp.parseSetBody({ character: 'Aldenmar', tell_relay: true }).ok).toBe(false);
  });
});

describe('findOwned', () => {
  it('finds a name whatever its case and returns the STORED spelling', () => {
    expect(cp.findOwned(['Aldenmar', 'Brackwyn'], 'aldenmar')).toBe('Aldenmar');
    expect(cp.findOwned(['Aldenmar', 'Brackwyn'], 'BRACKWYN')).toBe('Brackwyn');
    expect(cp.findOwned(["Bri`an"], "bri`an")).toBe("Bri`an");
  });
  it('is null for a name outside the family, a partial name, or a bad list', () => {
    expect(cp.findOwned(['Aldenmar'], 'Rethlan')).toBeNull();
    expect(cp.findOwned(['Aldenmar'], 'Alden')).toBeNull();
    expect(cp.findOwned(['Aldenmar'], 'Aldenmarx')).toBeNull();
    expect(cp.findOwned([], 'Aldenmar')).toBeNull();
    expect(cp.findOwned(null, 'Aldenmar')).toBeNull();
    expect(cp.findOwned(['Aldenmar'], null)).toBeNull();
    expect(cp.findOwned([null, 5, {}], 'Aldenmar')).toBeNull();
  });
});

describe('ownedNames', () => {
  it('asks owned_character_names for the person and returns the names', async () => {
    const db = stubDb();
    expect(await cp.ownedNames(db, cp.createOwnedCache(), '111')).toEqual(['Aldenmar', 'Brackwyn', 'Corvale']);
    expect(db.calls).toEqual([{ m: 'rpc', fn: 'owned_character_names', params: { p_discord_id: '111' } }]);
  });

  it('keeps the family five minutes, per person', async () => {
    let t = 1_000_000;
    const cache = cp.createOwnedCache({ now: () => t });
    const db = stubDb();
    await cp.ownedNames(db, cache, '111');
    await cp.ownedNames(db, cache, '111');
    expect(db.calls).toHaveLength(1);
    await cp.ownedNames(db, cache, '222');                  // another person never reads this person's slot
    expect(db.calls).toHaveLength(2);
    t += 5 * 60 * 1000 - 1;
    await cp.ownedNames(db, cache, '111');
    expect(db.calls).toHaveLength(2);                       // still inside the five minutes
    t += 1;
    await cp.ownedNames(db, cache, '111');
    expect(db.calls).toHaveLength(3);                       // expired: read again
  });

  it('a failed read is null and is not remembered', async () => {
    const cache = cp.createOwnedCache();
    for (const bad of [null, undefined, {}, 'oops', 0]) {
      const db = stubDb();
      db.family = bad;                                      // (a default parameter would swallow undefined)
      expect(await cp.ownedNames(db, cache, '111')).toBeNull();
    }
    expect(cache.size).toBe(0);
    const ok = stubDb();
    expect(await cp.ownedNames(ok, cache, '111')).toHaveLength(3);   // the next ask is not served the failure
  });

  it('an empty family is answered but not remembered (a person who just linked a character is not told "none")', async () => {
    const cache = cp.createOwnedCache();
    const db = stubDb({ family: [] });
    expect(await cp.ownedNames(db, cache, '111')).toEqual([]);
    expect(cache.size).toBe(0);
    db.family = ['Aldenmar'];
    expect(await cp.ownedNames(db, cache, '111')).toEqual(['Aldenmar']);
  });

  it('drops anything in the list that is not a name', async () => {
    const db = stubDb({ family: ['Aldenmar', null, '', 7, { a: 1 }, 'Brackwyn'] });
    expect(await cp.ownedNames(db, cp.createOwnedCache(), '111')).toEqual(['Aldenmar', 'Brackwyn']);
  });
});

describe('setPrefs', () => {
  let db, cache;
  beforeEach(() => { db = stubDb(); cache = cp.createOwnedCache(); });
  const set = (body, who = '111') => cp.setPrefs(db, cache, who, body);

  it('writes the mode\'s three flags on the stored row, in the wolfpack guild, and answers the row\'s state', async () => {
    const out = await set({ character: 'aldenmar', mode: 'inventory' });
    expect(out).toEqual({
      status: 200,
      body: { ok: true, character: 'Aldenmar', prefs: flags(true, false, false), mode: 'inventory' },
    });
    expect(writes(db)).toHaveLength(1);
    const w = writes(db)[0];
    expect(w.table).toBe('characters');
    expect(w.body).toEqual(flags(true, false, false));
    const q = new URLSearchParams(w.query);
    expect(q.get('guild_id')).toBe('eq.wolfpack');
    expect(q.get('name')).toBe('eq.Aldenmar');                       // the stored spelling, not what was typed
    expect(q.get('select')).toBe('name,hidden_from_lists,exclude_from_stats,exclude_inventory');
  });

  it('each mode round-trips: what the row holds afterwards names the mode that wrote it', async () => {
    for (const m of cp.MODES) {
      const out = await set({ character: 'Brackwyn', mode: m });
      expect(out.status).toBe(200);
      expect(out.body.mode).toBe(m);
      expect(out.body.prefs).toEqual(cp.MODE_FLAGS[m]);
    }
  });

  it('a lone boolean writes just that column and the answer is the whole row\'s state', async () => {
    db.updateResult = [{ name: 'Corvale', hidden_from_lists: true, exclude_from_stats: true, exclude_inventory: false }];
    const out = await set({ character: 'Corvale', exclude_from_stats: true });
    expect(writes(db)[0].body).toEqual({ exclude_from_stats: true });
    expect(out.body.prefs).toEqual(flags(true, true, false));
    expect(out.body.mode).toBe('custom');
  });

  it('a character outside the caller\'s family is a 403 and nothing is written', async () => {
    for (const character of ['Rethlan', 'Alden', 'Aldenmarx']) {
      expect(await set({ character, mode: 'hidden' })).toEqual({ status: 403, body: { error: 'not your character' } });
    }
    expect(writes(db)).toHaveLength(0);
  });

  it('the person is the argument, never anything in the body', async () => {
    const out = await set({ character: 'Aldenmar', mode: 'hidden', discord_id: '999', user_id: 'u9', p_discord_id: '999', owner: '999' }, '111');
    expect(out.status).toBe(200);
    expect(db.calls.filter(c => c.m === 'rpc').map(c => c.params.p_discord_id)).toEqual(['111']);
    expect(JSON.stringify(db.calls)).not.toContain('999');
  });

  it('a session with no Discord id is a 403 and the database is not asked anything', async () => {
    for (const who of ['', null, undefined]) {
      expect(await cp.setPrefs(db, cache, who, { character: 'Aldenmar', mode: 'show' })).toEqual({ status: 403, body: { error: 'no linked account' } });
    }
    expect(db.calls).toHaveLength(0);
  });

  it('a body that cannot be honoured is a 400 before any read or write', async () => {
    for (const body of [null, [], { mode: 'show' }, { character: 'Aldenmar' }, { character: 'Aldenmar', mode: 'Hidden' }, { character: 'Aldenmar', mode: 'show', exclude_inventory: 'yes' }]) {
      const out = await set(body);
      expect(out.status).toBe(400);
      expect(typeof out.body.error).toBe('string');
    }
    expect(db.calls).toHaveLength(0);
  });

  it('a failed family read is a 502 and nothing is written (it is not "owns nothing")', async () => {
    db.family = null;
    expect(await set({ character: 'Aldenmar', mode: 'show' })).toEqual({ status: 502, body: { error: 'unavailable' } });
    expect(writes(db)).toHaveLength(0);
  });

  it('a failed write is a 502; a row that has gone is a 404', async () => {
    db.updateResult = null;
    expect(await set({ character: 'Aldenmar', mode: 'show' })).toEqual({ status: 502, body: { error: 'unavailable' } });
    db.updateResult = [];
    expect(await set({ character: 'Aldenmar', mode: 'show' })).toEqual({ status: 404, body: { error: 'unknown character' } });
  });

  it('reads the family once for a run of clicks, and writes the row each time', async () => {
    await set({ character: 'Aldenmar', mode: 'inventory' });
    await set({ character: 'Aldenmar', mode: 'hidden' });
    await set({ character: 'Brackwyn', mode: 'show' });
    expect(db.calls.filter(c => c.m === 'rpc')).toHaveLength(1);
    expect(writes(db)).toHaveLength(3);
  });

  it('writes the characters row and nothing else: no audit_log row, no second table (the website\'s switch writes none)', async () => {
    await set({ character: 'Aldenmar', mode: 'hidden' });
    expect(db.calls.map(c => c.m)).toEqual(['rpc', 'update']);          // the stub throws on insert/upsert/del
    expect(db.calls.filter(c => c.m === 'update').every(c => c.table === 'characters')).toBe(true);
  });
});

describe('minePrefs', () => {
  let db, cache;
  beforeEach(() => { db = stubDb(); cache = cp.createOwnedCache(); });

  it('lists every family character with its three flags and its mode, sorted by name', async () => {
    db.family = ['Zarrin', 'aldenmar', 'Brackwyn', 'Corvale', 'Nyssara'];
    db.selectResult = [
      { name: 'Zarrin',   hidden_from_lists: true,  exclude_from_stats: true,  exclude_inventory: true },
      { name: 'Brackwyn', hidden_from_lists: false, exclude_from_stats: false, exclude_inventory: false },
      { name: 'aldenmar', hidden_from_lists: true,  exclude_from_stats: false, exclude_inventory: false },
      { name: 'Corvale',  hidden_from_lists: false, exclude_from_stats: true,  exclude_inventory: false },
      { name: 'Nyssara',  hidden_from_lists: null,  exclude_from_stats: null,  exclude_inventory: null, tell_relay: true, discord_id: '1' },
    ];
    const out = await cp.minePrefs(db, cache, '111');
    expect(out.status).toBe(200);
    expect(out.body).toEqual({
      ok: true,
      characters: [
        { name: 'aldenmar', ...flags(true, false, false),  mode: 'inventory' },
        { name: 'Brackwyn', ...flags(false, false, false), mode: 'show' },
        { name: 'Corvale',  ...flags(false, true, false),  mode: 'custom' },
        { name: 'Nyssara',  ...flags(false, false, false), mode: 'show' },
        { name: 'Zarrin',   ...flags(true, true, true),    mode: 'hidden' },
      ],
    });
  });

  it('keeps the characters the caller has hidden completely, so they can be switched back', async () => {
    db.family = ['Aldenmar'];
    db.selectResult = [{ name: 'Aldenmar', hidden_from_lists: true, exclude_from_stats: true, exclude_inventory: true }];
    const out = await cp.minePrefs(db, cache, '111');
    expect(out.body.characters).toHaveLength(1);
    expect(out.body.characters[0].mode).toBe('hidden');
  });

  it('asks for the family\'s names in the wolfpack guild, quoting each, and for only the three flags', async () => {
    db.family = ['Aldenmar', 'Bri`an', "O'Neil", 'We"ird\\Name'];
    db.selectResult = [];
    await cp.minePrefs(db, cache, '111');
    const sel = db.calls.find(c => c.m === 'select');
    expect(sel.table).toBe('characters');
    const q = new URLSearchParams(sel.query);
    expect(q.get('guild_id')).toBe('eq.wolfpack');
    expect(q.get('select')).toBe('name,hidden_from_lists,exclude_from_stats,exclude_inventory');
    expect(q.get('name')).toBe('in.("Aldenmar","Bri`an","O\'Neil","We\\"ird\\\\Name")');
  });

  it('is built from the Mimic session\'s person only, and reads the family once for the rpc', async () => {
    db.selectResult = [];
    await cp.minePrefs(db, cache, '111');
    await cp.minePrefs(db, cache, '111');
    expect(db.calls.filter(c => c.m === 'rpc').map(c => c.params)).toEqual([{ p_discord_id: '111' }]);
  });

  it('a session with no Discord id is a 403 and asks nothing', async () => {
    expect(await cp.minePrefs(db, cache, '')).toEqual({ status: 403, body: { error: 'no linked account' } });
    expect(db.calls).toHaveLength(0);
  });

  it('an empty family is an empty list without a second read', async () => {
    db.family = [];
    expect(await cp.minePrefs(db, cache, '111')).toEqual({ status: 200, body: { ok: true, characters: [] } });
    expect(db.calls.filter(c => c.m === 'select')).toHaveLength(0);
  });

  it('a failed family read or flags read is a 502, never an empty list', async () => {
    db.family = null;
    expect(await cp.minePrefs(db, cache, '111')).toEqual({ status: 502, body: { error: 'unavailable' } });
    db.family = ['Aldenmar'];
    db.selectResult = null;
    expect(await cp.minePrefs(db, cache, '111')).toEqual({ status: 502, body: { error: 'unavailable' } });
  });
});

describe('inList', () => {
  it('double-quotes each value and escapes a backslash or quote inside it', () => {
    expect(cp.inList(['A', 'B'])).toBe('("A","B")');
    expect(cp.inList(['a"b'])).toBe('("a\\"b")');
    expect(cp.inList(['a\\b'])).toBe('("a\\\\b")');
  });
});

describe('the route', () => {
  const src = readSource(BOT_INDEX);
  const glueSrc = sliceBlock(src, "const characterPrefs = require('./utils/characterPrefs');", 'return _sendPrefsResult(res, out);\n}');
  const dispatchSrc = sliceBlock(src,
    "if (req.method === 'POST' && req.url === '/api/agent/character-prefs') {",
    "internal error' }));\n    }\n  }");

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
  const postReq = (body, url = '/api/agent/character-prefs') => {
    const chunks = typeof body === 'string' || Buffer.isBuffer(body) ? [Buffer.from(body)] : [Buffer.from(JSON.stringify(body))];
    return { url, method: 'POST', headers: {}, async *[Symbol.asyncIterator]() { for (const c of chunks) yield c; } };
  };

  beforeEach(() => {
    const db = stubDb();
    db.selectResult = [{ name: 'Aldenmar', hidden_from_lists: true, exclude_from_stats: false, exclude_inventory: false }];
    db.family = ['Aldenmar', 'Brackwyn'];
    S = { nodeRequire, db, auth: { discord_id: '111', user_id: 'u1' }, legacyCalls: [], logs: [] };
    globalThis.__cpTest = S;
    const prefix = `
      const __s = globalThis.__cpTest;
      const require = (m) => m === './utils/supabase' ? __s.db : __s.nodeRequire(m.replace('./utils/', '../utils/') + '.js');
      const mimicLink = { requireAgentAuth: async (req, res) => {
        if (!__s.auth) { res.writeHead(401, {}); res.end('{"error":"unauthorized"}'); return null; }
        return __s.auth;
      } };
      const console = { log: (...a) => __s.logs.push(a.join(' ')), error: () => {} };
      const _characterPrefsFor = async (chars) => { __s.legacyCalls.push(chars); return { prefs: { Legacy: { hidden_from_lists: false } } }; };
    `;
    h = evalBlock(prefix + glueSrc, ['_handleAgentCharacterPrefs', '_handleAgentCharacterPrefsSet', '_ownedCharsCache']);
  });

  describe('GET', () => {
    it('without mine=1 it is the route it was: the per-character prefs, keyed by name', async () => {
      const res = fakeRes();
      await h._handleAgentCharacterPrefs(getReq('/api/agent/character-prefs?characters=Aldenmar,Brackwyn'), res);
      expect(res.code).toBe(200);
      expect(res.json()).toEqual({ prefs: { Legacy: { hidden_from_lists: false } } });
      expect(S.legacyCalls).toEqual([['Aldenmar', 'Brackwyn']]);
      expect(S.db.calls).toHaveLength(0);
      // anything but exactly mine=1 is that same route
      for (const q of ['mine=0', 'mine=true', 'mine=', 'mine=11']) {
        const r = fakeRes();
        await h._handleAgentCharacterPrefs(getReq('/api/agent/character-prefs?characters=Aldenmar&' + q), r);
        expect(r.json()).toEqual({ prefs: { Legacy: { hidden_from_lists: false } } });
      }
      expect(S.db.calls).toHaveLength(0);
    });

    it('mine=1 answers the family list and does not run the per-character read', async () => {
      const res = fakeRes();
      await h._handleAgentCharacterPrefs(getReq('/api/agent/character-prefs?mine=1&characters=Corvale'), res);
      expect(res.code).toBe(200);
      expect(res.headers).toMatchObject({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      expect(res.json()).toEqual({
        ok: true,
        characters: [{ name: 'Aldenmar', hidden_from_lists: true, exclude_from_stats: false, exclude_inventory: false, mode: 'inventory' }],
      });
      expect(S.legacyCalls).toHaveLength(0);
      expect(S.db.calls.find(c => c.m === 'rpc').params).toEqual({ p_discord_id: '111' });
    });

    it('mine=1 asks about the session\'s person and nobody a query string names', async () => {
      const res = fakeRes();
      await h._handleAgentCharacterPrefs(getReq('/api/agent/character-prefs?mine=1&discord_id=999&user=999'), res);
      expect(res.code).toBe(200);
      expect(JSON.stringify(S.db.calls)).not.toContain('999');
    });

    it('a request without a good session is turned away and asks the database nothing', async () => {
      S.auth = null;
      for (const q of ['?mine=1', '?characters=Aldenmar']) {
        const res = fakeRes();
        await h._handleAgentCharacterPrefs(getReq('/api/agent/character-prefs' + q), res);
        expect(res.code).toBe(401);
      }
      expect(S.db.calls).toHaveLength(0);
      expect(S.legacyCalls).toHaveLength(0);
    });

    it('mine=1 with a session that has no Discord id is a 403', async () => {
      S.auth = { user_id: 'u1' };
      const res = fakeRes();
      await h._handleAgentCharacterPrefs(getReq('/api/agent/character-prefs?mine=1'), res);
      expect(res.code).toBe(403);
      expect(S.db.calls).toHaveLength(0);
    });
  });

  describe('POST', () => {
    it('sets the mode and answers { ok, character, prefs, mode }', async () => {
      const res = fakeRes();
      await h._handleAgentCharacterPrefsSet(postReq({ character: 'aldenmar', mode: 'hidden' }), res);
      expect(res.code).toBe(200);
      expect(res.headers).toMatchObject({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      expect(res.json()).toEqual({ ok: true, character: 'Aldenmar', prefs: flags(true, true, true), mode: 'hidden' });
      expect(writes(S.db)).toHaveLength(1);
      expect(writes(S.db)[0].body).toEqual(flags(true, true, true));
    });

    it('takes the person from the session, never the body', async () => {
      const res = fakeRes();
      await h._handleAgentCharacterPrefsSet(postReq({ character: 'Aldenmar', mode: 'show', discord_id: '999' }), res);
      expect(res.code).toBe(200);
      expect(JSON.stringify(S.db.calls)).not.toContain('999');
      expect(S.db.calls.find(c => c.m === 'rpc').params.p_discord_id).toBe('111');
    });

    it('a request without a good session is turned away before the body is read or anything asked', async () => {
      S.auth = null;
      let read = false;
      const rq = { url: '/api/agent/character-prefs', method: 'POST', headers: {}, async *[Symbol.asyncIterator]() { read = true; yield Buffer.from('{}'); } };
      const res = fakeRes();
      await h._handleAgentCharacterPrefsSet(rq, res);
      expect(res.code).toBe(401);
      expect(read).toBe(false);
      expect(S.db.calls).toHaveLength(0);
    });

    it('a character that is not the caller\'s is a 403 and nothing is written or logged as a change', async () => {
      const res = fakeRes();
      await h._handleAgentCharacterPrefsSet(postReq({ character: 'Rethlan', mode: 'hidden' }), res);
      expect(res.code).toBe(403);
      expect(res.json()).toEqual({ error: 'not your character' });
      expect(writes(S.db)).toHaveLength(0);
      expect(S.logs).toHaveLength(0);
    });

    it('a session with no Discord id is a 403', async () => {
      S.auth = { user_id: 'u1' };
      const res = fakeRes();
      await h._handleAgentCharacterPrefsSet(postReq({ character: 'Aldenmar', mode: 'show' }), res);
      expect(res.code).toBe(403);
      expect(S.db.calls).toHaveLength(0);
    });

    it('a body that is not JSON is a 400 with a JSON content type', async () => {
      const res = fakeRes();
      await h._handleAgentCharacterPrefsSet(postReq('{not json'), res);
      expect(res.code).toBe(400);
      expect(res.headers['Content-Type']).toBe('application/json');
      expect(res.json()).toEqual({ error: 'invalid JSON' });
      expect(S.db.calls).toHaveLength(0);
    });

    it('a body that is JSON but not a good request is the validation 400', async () => {
      for (const body of [{ character: 'Aldenmar', mode: 'nope' }, { mode: 'show' }, [], 'null']) {
        const res = fakeRes();
        await h._handleAgentCharacterPrefsSet(postReq(body), res);
        expect(res.code).toBe(400);
      }
      expect(S.db.calls).toHaveLength(0);
    });

    it('a body over 16 KB is a 413 and nothing is asked', async () => {
      const res = fakeRes();
      await h._handleAgentCharacterPrefsSet(postReq({ character: 'Aldenmar', mode: 'show', pad: 'x'.repeat(17 * 1024) }), res);
      expect(res.code).toBe(413);
      expect(S.db.calls).toHaveLength(0);
      const ok = fakeRes();
      await h._handleAgentCharacterPrefsSet(postReq({ character: 'Aldenmar', mode: 'show', pad: 'x'.repeat(8 * 1024) }), ok);
      expect(ok.code).toBe(200);
    });

    it('logs one line for a change that was made, naming the person, the character and the mode', async () => {
      await h._handleAgentCharacterPrefsSet(postReq({ character: 'Aldenmar', mode: 'inventory' }), fakeRes());
      expect(S.logs).toHaveLength(1);
      expect(S.logs[0]).toMatch(/^\[character-prefs\] 111 set Aldenmar .* inventory /);
    });

    it('a failed write is a 502 and is not logged as a change', async () => {
      S.db.updateResult = null;
      const res = fakeRes();
      await h._handleAgentCharacterPrefsSet(postReq({ character: 'Aldenmar', mode: 'show' }), res);
      expect(res.code).toBe(502);
      expect(S.logs).toHaveLength(0);
    });
  });

  describe('dispatch', () => {
    let route, logged;
    const make = (handler) => new Function('__h', '__log', `
      const console = { error: (...a) => __log.push(a) };
      const _handleAgentCharacterPrefsSet = __h;
      return async function route(req, res) {
        ${dispatchSrc}
        return 'fell-through';
      };`)(handler, logged);
    beforeEach(() => { logged = []; });

    it('handles POST /api/agent/character-prefs and nothing else', async () => {
      const seen = [];
      route = make(async (rq) => { seen.push(rq.url); return 'handled'; });
      expect(await route(postReq({}), fakeRes())).toBe('handled');
      expect(await route({ ...getReq('/api/agent/character-prefs') }, fakeRes())).toBe('fell-through');
      expect(await route(postReq({}, '/api/agent/character-prefs-x'), fakeRes())).toBe('fell-through');
      expect(await route(postReq({}, '/api/agent/bid-prefs'), fakeRes())).toBe('fell-through');
      expect(seen).toHaveLength(1);
    });

    it('a handler that throws is a logged 500 "internal error", not a crash or a leak', async () => {
      const res = fakeRes();
      await make(async () => { throw new Error('secret detail'); })(postReq({}), res);
      expect(res.code).toBe(500);
      expect(res.json()).toEqual({ error: 'internal error' });
      expect(res.body).not.toContain('secret detail');
      expect(logged[0][0]).toBe('[character-prefs set] handler error:');
    });

    it('the GET route is still dispatched where it was', () => {
      const code = stripJs(src);
      expect(code).toMatch(/req\.method === 'GET' && req\.url\.startsWith\('\/api\/agent\/character-prefs'\)/);
      expect(code).toMatch(/_handleAgentCharacterPrefs\(req, res\)/);
    });

    it('is a write by the owner, not an ingest stream: no shed flag, no admission budget in front of it', () => {
      const code = stripJs(dispatchSrc + glueSrc);
      expect(code).not.toMatch(/_overBudget|_isShedded|_shed/);
      expect(code).toMatch(/_handleAgentCharacterPrefsSet/);
    });
  });
});

describe('owned_character_names migration', () => {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const sql = stripSql(fs.readFileSync(path.join(dir, '20261007010000_owned_character_names.sql'), 'utf8'));
  const tiers = stripSql(fs.readFileSync(path.join(dir, '20261006210000_my_parse_series_char_tiers.sql'), 'utf8'));
  const norm = (s) => s.replace(/\s+/g, ' ').trim();

  it('is the function the bot calls, pinned the way the other service_role functions are', () => {
    expect(sql).toMatch(/create or replace function public\.owned_character_names\(p_discord_id text\)/);
    expect(sql).toMatch(/returns text\[\]/);
    expect(sql).toMatch(/\bstable\b/);
    expect(sql).toMatch(/security invoker/);
    expect(sql).toMatch(/set search_path = public/);
  });

  it('is granted to service_role alone', () => {
    expect(sql).toMatch(/revoke all on function public\.owned_character_names\(text\) from public;/);
    expect(sql).toMatch(/revoke all on function public\.owned_character_names\(text\) from anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.owned_character_names\(text\) to service_role;/);
    expect(sql.match(/grant execute/g)).toHaveLength(1);
  });

  it('is idempotent and has no destructive statement', () => {
    expect(sql).not.toMatch(/\bdrop\b/i);
    expect(sql).not.toMatch(/\b(delete|truncate)\b/i);
    expect(sql).not.toMatch(/\bupdate\b|\binsert\b/i);
  });

  it('resolves the family exactly as my_parse_series does (household -> anchored characters -> main_name)', () => {
    const family = (s) => norm(sliceBlock(s, 'root as (', "in (select id from household where id is not null)\n  )"));
    expect(family(sql)).toBe(family(tiers));
    expect(sql).toMatch(/lower\(coalesce\(c\.main_name, c\.name\)\) in \(select fam from roots\)/);
    expect(sql).toMatch(/c\.guild_id = 'wolfpack'/);
  });

  it('keeps a hidden or excluded character in the list (it must be switchable back)', () => {
    expect(sql).not.toMatch(/exclude_from_stats|exclude_inventory|hidden_from_lists|rank/);
  });
});

describe('release bookkeeping', () => {
  it('has a changelog line about marking a character inventory-only or hidden from Mimic', () => {
    const lines = changesSince('3.1.212').filter(l => /Mimic can now mark a character inventory-only or hidden/.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/My Stats on wolfpack\.quest/);
  });
});
