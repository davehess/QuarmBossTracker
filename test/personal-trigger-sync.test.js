// Personal trigger sync (the guild lead, 2026-10-12): Push / Pull buttons for personal triggers + the
// per-user "what you hear" rules, encrypted, visible to the owner's household only.
//
// Runs the bot's REAL handlers (sliced out of index.js) against a fake Supabase that applies the query's
// filters, with the household walk injected the way ui-layout-list-scope.test.js does. The gate is
// mutation-checked: remove the household check from the pull handler and the 403 / empty-list tests fail.
// Run: npx vitest run test/personal-trigger-sync.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { readSource, BOT_INDEX, sliceBlock } from './_source-slice.js';

const nodeRequire = createRequire(import.meta.url);
const sync = nodeRequire('../utils/personalTriggerSync.js');
const bidCrypto = nodeRequire('../utils/bidCrypto.js');

const block = sliceBlock(readSource(BOT_INDEX), 'function _ptsReadBody(req, max) {', '// ── end personal trigger sync ──');

// R is the household root; A and B are accounts merged into it; S is a stranger with their own household.
const HOUSEHOLDS = { R: ['R', 'A', 'B'], A: ['R', 'A', 'B'], B: ['R', 'A', 'B'], S: ['S'] };
const ROOTS = { R: 'R', A: 'R', B: 'R', S: 'S' };

let table;
let seq;
function applyFilters(rows, query) {
  const params = new URLSearchParams(query);
  let out = rows.filter(r => [...params].every(([k, v]) => {
    let m = v.match(/^eq\.(.*)$/);
    if (m) return String(r[k]) === m[1];
    m = v.match(/^in\.\((.*)\)$/);
    if (m) return m[1].split(',').map(decodeURIComponent).includes(String(r[k]));
    return true;
  }));
  out = out.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const offset = parseInt(params.get('offset') || '0', 10);
  const limit = parseInt(params.get('limit') || '1000', 10);
  const cols = (params.get('select') || '').split(',').filter(Boolean);   // PostgREST projects the columns asked for
  return out.slice(offset, offset + limit).map(r => (cols.length ? Object.fromEntries(cols.map(c => [c, r[c]])) : r));
}
const fakeSupabase = {
  isEnabled: () => true,
  guildId: () => 'wolfpack',
  insert: async (_t, rows) => rows.map(r => {
    const n = ++seq;
    const row = { ...r, id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
                  created_at: new Date(Date.UTC(2026, 9, 12, 0, 0, n)).toISOString() };
    table.push(row);
    return [row][0];
  }),
  select: async (_t, q) => applyFilters(table, q).map(r => ({ ...r })),
  del: async (_t, q) => {
    const ids = q.match(/^id=in\.\((.*)\)$/)[1].split(',');
    table = table.filter(r => !ids.includes(r.id));
    return null;
  },
};

function makeHandlers() {
  const req = (m) => (m === './utils/supabase' ? fakeSupabase : m === './utils/bidCrypto' ? bidCrypto
    : m === './utils/personalTriggerSync' ? sync : null);
  const mimicLink = { requireAgentAuth: async (r) => (r.__as ? { discord_id: r.__as } : null) };
  const household = async (id) => new Set(HOUSEHOLDS[id] || [id]);
  const root = async (id) => ROOTS[id] || id;
  // eslint-disable-next-line no-new-func
  return new Function('require', 'mimicLink', '_householdDiscordIds', '_householdRootDiscordId',
    block + '\nreturn { push: _handlePersonalTriggersPush, list: _handlePersonalTriggersList, pull: _handlePersonalTriggersPull };')(
    req, mimicLink, household, root);
}

// Drives a handler with a fake request/response; resolves { status, json }.
async function call(handler, { as, method = 'GET', url, body, headers = {} }) {
  const req = new EventEmitter();
  req.method = method; req.url = url; req.headers = headers; req.__as = as;
  let status = 0; let out = '';
  const res = { writeHead(c) { status = c; return res; }, end(b) { out = b || ''; return res; } };
  const done = handler(req, res);
  if (method === 'POST') {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    setImmediate(() => { req.emit('data', Buffer.from(text)); req.emit('end'); });
  }
  await done;
  return { status, json: out ? JSON.parse(out) : null };
}

const TRIGGERS = [
  { name: 'Clarity dropping', pattern: 'Your Clarity spell has worn off', actions: [{ type: 'text_overlay', text: 'CLARITY' }],
    _regex: {}, _scope: 'x', _aliases: [1] },
  { name: 'Second', pattern: 'x' },
];
const RULES = { 'guild:mez-broke': { '*': 'speak', Aldenmar: 'overlay', Brackwyn: 'off' } };

let h;
beforeAll(() => { process.env.WISHLIST_BID_KEY = 'ab'.repeat(32); });
const fresh = () => { table = []; seq = 0; h = makeHandlers(); };
const push = (as, extra = {}) => call(h.push, { as, method: 'POST', url: '/api/agent/personal-triggers/push',
  body: { triggers: TRIGGERS, rules: RULES, machine_name: 'RAID-PC', agent_version: '3.7.0', ...extra } });

describe('push', () => {
  it('stores an encrypted row owned by the household root and answers with counts', async () => {
    fresh();
    const r = await push('B');                       // pushed from a merged alt
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, trigger_count: 2, rule_count: 1 });
    expect(r.json.id).toBeTruthy(); expect(r.json.created_at).toBeTruthy();
    expect(table).toHaveLength(1);
    expect(table[0].owner_discord_id).toBe('R');     // household root, not the pusher
    expect(table[0].pushed_by_discord_id).toBe('B');
    expect(table[0].payload_enc).not.toContain('Clarity');
    expect(table[0].machine_name).toBe('RAID-PC');
  });

  it('round trip: what was encrypted is what comes back, minus compiled underscore fields', async () => {
    fresh();
    await push('R');
    const plain = JSON.parse(bidCrypto.decryptBlob(table[0].payload_enc));
    expect(plain.schema).toBe(1);
    expect(plain.rules).toEqual(RULES);
    expect(plain.triggers[0]).toEqual({ name: 'Clarity dropping', pattern: 'Your Clarity spell has worn off',
      actions: [{ type: 'text_overlay', text: 'CLARITY' }] });
    const pulled = await call(h.pull, { as: 'R', url: '/api/agent/personal-triggers/pull' });
    expect(pulled.json.triggers).toEqual(plain.triggers);
    expect(pulled.json.rules).toEqual(RULES);
  });

  it('rejects a bad mode, a non-object trigger and non-array triggers', async () => {
    fresh();
    for (const bad of [
      { rules: { k: { '*': 'shout' } } },
      { rules: { k: 'speak' } },
      { triggers: ['nope'] },
      { triggers: { a: 1 } },
      { rules: [] },
    ]) {
      const r = await push('R', bad);
      expect(r.status).toBe(400);
    }
    expect(table).toHaveLength(0);
  });

  it('rejects oversize: over 2000 triggers (400) and over 512 KB (413, by header and by streamed size)', async () => {
    fresh();
    const many = await push('R', { triggers: Array.from({ length: 2001 }, (_, i) => ({ name: 't' + i })) });
    expect(many.status).toBe(400);
    const byHeader = await call(h.push, { as: 'R', method: 'POST', url: '/x', body: {}, headers: { 'content-length': String(600 * 1024) } });
    expect(byHeader.status).toBe(413);
    const big = await call(h.push, { as: 'R', method: 'POST', url: '/x',
      body: { triggers: [{ name: 'x'.repeat(600 * 1024) }], rules: {} } });
    expect(big.status).toBe(413);
    expect(table).toHaveLength(0);
  });

  it('keeps only the newest 20 per owner', async () => {
    fresh();
    for (let i = 0; i < 23; i++) await push(i % 2 ? 'A' : 'R');
    await push('S');
    expect(table.filter(r => r.owner_discord_id === 'R')).toHaveLength(20);
    expect(table.filter(r => r.owner_discord_id === 'S')).toHaveLength(1);
  });
});

describe('the household gate', () => {
  it('owner and a merged alt pull; a stranger is refused', async () => {
    fresh();
    const { json: { id } } = await push('R');
    for (const who of ['R', 'A', 'B']) {
      const r = await call(h.pull, { as: who, url: `/api/agent/personal-triggers/pull?id=${id}` });
      expect(r.status).toBe(200);
      expect(r.json.triggers).toHaveLength(2);
    }
    const s = await call(h.pull, { as: 'S', url: `/api/agent/personal-triggers/pull?id=${id}` });
    expect(s.status).toBe(403);
    expect(JSON.stringify(s.json)).not.toContain('Clarity');
  });

  it('a stranger gets no list; the household sees its pushes without payloads', async () => {
    fresh();
    await push('R'); await push('A');
    expect((await call(h.list, { as: 'S', url: '/api/agent/personal-triggers/list' })).json.pushes).toEqual([]);
    const mine = await call(h.list, { as: 'B', url: '/api/agent/personal-triggers/list' });
    expect(mine.json.pushes).toHaveLength(2);
    expect(mine.json.pushes[0]).toHaveProperty('machine_name');
    expect(JSON.stringify(mine.json)).not.toContain('payload');
  });

  it('pull with no id is the newest of the household only; none yet is 404; a bad id is 400', async () => {
    fresh();
    await push('S');                                  // the stranger's push must never be served to R
    expect((await call(h.pull, { as: 'R', url: '/api/agent/personal-triggers/pull' })).status).toBe(404);
    const first = (await push('R')).json.id;
    await push('S');
    const r = await call(h.pull, { as: 'A', url: '/api/agent/personal-triggers/pull' });
    expect(r.status).toBe(200); expect(r.json.id).toBe(first);
    expect((await call(h.pull, { as: 'R', url: '/api/agent/personal-triggers/pull?id=00000000-0000-4000-8000-999999999999' })).status).toBe(404);
    expect((await call(h.pull, { as: 'R', url: '/api/agent/personal-triggers/pull?id=nope' })).status).toBe(400);
  });
});

describe('validatePush', () => {
  it('accepts the documented shape and strips every underscore key', () => {
    const v = sync.validatePush({ triggers: [{ a: 1, _regex: 2, _x: 3 }], rules: { k: { '*': 'off', Z: 'speak' } } });
    expect(v.ok).toBe(true);
    expect(v.triggers).toEqual([{ a: 1 }]);
  });
  it('refuses prototype-poisoning keys', () => {
    const bad = JSON.parse('{"triggers":[],"rules":{"__proto__":{"*":"off"}}}');
    expect(sync.validatePush(bad).ok).toBe(false);
  });
});
