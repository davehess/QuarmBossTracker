// Personal trigger sync, the AGENT half (the guild lead, 2026-10-12: "Push and Pull buttons, like UI
// backups"; the bot half is test/personal-trigger-sync.test.js). Push sends this PC's personal triggers
// plus the "what you hear" rules; Pull fetches a push and either MERGES it in or REPLACES what is here.
//
// The REAL agent is driven (require): the merge/replace rules, the Discord switch-off, the backup
// rotation and the local-mode gate are the shipped functions. Files go to a temp dir: the agent's two
// save functions write beside logsync.stats.json, so the test redirects those two writes (and nothing
// else) into the temp dir; the backups take the temp dir as an argument.
//
// Run: npx vitest run test/personal-trigger-sync-agent.test.js

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { readSource, stripJs, AGENT_INDEX } from './_source-slice.js';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });

const AGENT_DIR = path.dirname(AGENT_INDEX);
const BOT = 'https://bot.example.test/api/agent/encounter';
const BASE = 'https://bot.example.test/api/agent';
const UUID = '0b8e3c1a-4d2f-4c55-9a67-123456789abc';

let tmp;
const realWrite = fs.writeFileSync, realRename = fs.renameSync;
const inTmp = (p) => (typeof p === 'string' && path.dirname(p) === AGENT_DIR && /^(personal_triggers|trigger_rules)\.json/.test(path.basename(p)))
  ? path.join(tmp, path.basename(p)) : p;
const queued = [];   // what the upload queue tried to write to disk (never written)

// A personal row as the dashboard stores it; every row has a text_overlay unless `actions` says otherwise.
const row = (id, name, over = {}) => ({
  id, name, pattern: 'pat ' + name, pattern_flags: 'i', use_regex: true, enabled: true,
  actions: [{ type: 'text_overlay', text: name, color: 'red', duration_ms: 4000 }], ...over,
});
const compile = (r) => agent._compilePersonalTrigger({ cooldown_seconds: 0, timer_duration_sec: 0, end_use_regex: true, zeal_condition: null, end_early_pattern: null, ...r });
const setLocal = (rows) => agent._setPersonalTriggersForTest(rows.map(compile));
const names = () => agent._getPersonalTriggersForTest().map(t => t.name);
const clearRules = () => { for (const k of Object.keys(agent._triggerRules)) delete agent._triggerRules[k]; };
const setRules = (o) => { clearRules(); Object.assign(agent._triggerRules, o); };
const pull = (triggers, rules, mode) => agent._applyTriggerPull({ triggers, rules: rules || {} }, mode, tmp);
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(tmp, f), 'utf8'));

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-trigsync-'));
  queued.length = 0;
  vi.spyOn(fs, 'writeFileSync').mockImplementation((p, ...a) => {
    if (/logsync\.queue\.json/.test(String(p))) { queued.push(String(a[0])); return; }
    return realWrite.call(fs, inTmp(p), ...a);
  });
  vi.spyOn(fs, 'renameSync').mockImplementation((a, b) => {
    if (/logsync\.queue\.json/.test(String(a))) return;
    return realRename.call(fs, inTmp(a), inTmp(b));
  });
  agent._setPersonalTriggersForTest([]);
  clearRules();
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  agent._setUploadOptsForTest(null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('merge: which local row a pulled row lands on', () => {
  it('the same id: the pulled row wins and takes the place', () => {
    setLocal([row('p_a', 'Old name', { pattern: 'old pattern' }), row('p_b', 'Other')]);
    const r = pull([row('p_a', 'New name', { pattern: 'new pattern' })], {}, 'merge');
    expect(r).toMatchObject({ ok: true, added: 0, updated: 1, kept: 1 });
    const list = agent._getPersonalTriggersForTest();
    expect(list.map(t => t.name)).toEqual(['New name', 'Other']);   // in place, not moved
    expect(list[0].pattern).toBe('new pattern');
  });

  it('no id match, same name in any case: the pulled row wins and brings its own id', () => {
    setLocal([row('p_x', 'Clarity Down', { pattern: 'old pattern' })]);
    const r = pull([row('p_y', 'clarity down', { pattern: 'new pattern' })], {}, 'merge');
    expect(r).toMatchObject({ added: 0, updated: 1, kept: 0 });
    const list = agent._getPersonalTriggersForTest();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'p_y', pattern: 'new pattern' });
  });

  it('id is tried before name, across the whole pull', () => {
    // pulled row {id b, name "one"}: id b is local row B, and the name "one" is local row A. B wins by id; A is kept.
    setLocal([row('a', 'one', { pattern: 'A pattern' }), row('b', 'two', { pattern: 'B pattern' })]);
    const r = pull([row('b', 'one', { pattern: 'pulled pattern' })], {}, 'merge');
    expect(r).toMatchObject({ added: 0, updated: 1, kept: 1 });
    const list = agent._getPersonalTriggersForTest();
    expect(list.map(t => [t.id, t.pattern])).toEqual([['a', 'A pattern'], ['b', 'pulled pattern']]);
  });

  it('a local-only row is kept and a new pulled row is added at the end', () => {
    setLocal([row('p_1', 'Only here'), row('p_2', 'Both')]);
    const r = pull([row('p_2', 'Both'), row('p_9', 'Only there')], {}, 'merge');
    expect(r).toMatchObject({ ok: true, added: 1, updated: 0, unchanged: 1, kept: 1 });
    expect(names()).toEqual(['Only here', 'Both', 'Only there']);
  });

  it('two pulled rows with one name do not both land on the one local row', () => {
    setLocal([row('p_1', 'Twin')]);
    const r = pull([row('p_7', 'Twin'), row('p_8', 'Twin')], {}, 'merge');
    expect(r).toMatchObject({ added: 1, updated: 1 });
    expect(names()).toEqual(['Twin', 'Twin']);
  });

  it('is written to personal_triggers.json, compiled and live', () => {
    setLocal([row('p_1', 'Keep me')]);
    pull([row('p_2', 'Fresh', { pattern: 'fresh \\d+' })], {}, 'merge');
    expect(readJson('personal_triggers.json').triggers.map(t => t.name)).toEqual(['Keep me', 'Fresh']);
    const fresh = agent._getPersonalTriggersForTest().find(t => t.name === 'Fresh');
    expect(fresh._regex.test('a fresh 12 line')).toBe(true);
  });

  it('refuses a mode that is not merge or replace, touching nothing', () => {
    setLocal([row('p_1', 'Keep me')]);
    expect(agent._applyTriggerPull({ triggers: [row('p_2', 'x')], rules: {} }, 'append', tmp)).toEqual({ ok: false, error: 'bad mode' });
    expect(names()).toEqual(['Keep me']);
    expect(fs.readdirSync(tmp)).toEqual([]);
  });
});

describe('posts to Discord arrive switched off', () => {
  const discordRow = (id, name) => row(id, name, { actions: [
    { type: 'text_overlay', text: name, color: 'red', duration_ms: 4000 },
    { type: 'discord', message: 'boss is up' },
    { type: 'voice', message: 'boss up', discord: true },
  ] });

  it('a discord action gets enabled:false; a voice action keeps speaking but stops broadcasting', () => {
    const r = pull([discordRow('p_1', 'Boss up')], {}, 'merge');
    expect(r).toMatchObject({ ok: true, added: 1, discord_off: 1 });
    const [a0, a1, a2] = agent._getPersonalTriggersForTest()[0].actions;
    expect(a0).toEqual({ type: 'text_overlay', text: 'Boss up', color: 'red', duration_ms: 4000 });
    expect(a1).toMatchObject({ type: 'discord', message: 'boss is up', enabled: false });
    expect(a2).toMatchObject({ type: 'voice', message: 'boss up', discord: false });
  });

  it('also when the pulled row replaces a local one, and in replace mode', () => {
    setLocal([row('p_1', 'Boss up', { actions: [{ type: 'discord', message: 'old' }] })]);
    pull([discordRow('p_1', 'Boss up')], {}, 'merge');
    expect(agent._getPersonalTriggersForTest()[0].actions[1].enabled).toBe(false);
    pull([discordRow('p_2', 'Another')], {}, 'replace');
    expect(agent._getPersonalTriggersForTest()[0].actions[1].enabled).toBe(false);
  });

  it('a local-only row that posts to Discord is left alone', () => {
    setLocal([row('p_1', 'Mine', { actions: [{ type: 'discord', message: 'mine' }] })]);
    pull([row('p_2', 'Theirs')], {}, 'merge');
    expect(agent._getPersonalTriggersForTest()[0].actions[0].enabled).toBeUndefined();
  });

  it('the fire loop honours it: an enabled discord action queues a post, enabled:false queues none', () => {
    agent._setUploadOptsForTest({ botUrl: BOT, token: 'wpms_t', dryRun: false });
    const fire = (actions) => {
      const before = agent._uploadQueueLenForTest();
      agent._fireTriggerActions({ id: 'x', name: 'Boss up', pattern: 'x', _scope: 'personal', actions }, {}, Date.now(), false, false);
      return agent._uploadQueueLenForTest() - before;
    };
    expect(fire([{ type: 'discord', message: 'boss is up' }])).toBe(1);
    expect(fire([{ type: 'discord', message: 'boss is up', enabled: false }])).toBe(0);
  });
});

describe('replace', () => {
  it('the pulled list becomes the list; local-only rows are removed; rules become exactly the pulled rules', () => {
    setLocal([row('p_1', 'One'), row('p_2', 'Two'), row('p_3', 'Three')]);
    setRules({ 'personal:p_1': { '*': 'off' }, 'builtin:charm_break': { '*': 'overlay' } });
    const r = pull([row('p_1', 'One'), row('p_9', 'Nine')], { 'guild:g1': { '*': 'overlay' } }, 'replace');
    expect(r).toMatchObject({ ok: true, mode: 'replace', added: 1, unchanged: 1, updated: 0, kept: 0, removed: 2 });
    expect(names()).toEqual(['One', 'Nine']);
    expect(agent._triggerRules).toEqual({ 'guild:g1': { '*': 'overlay' } });
    expect(r.rules_changed).toBe(3);   // two cells gone, one added
    expect(readJson('trigger_rules.json')).toEqual({ version: 1, rules: { 'guild:g1': { '*': 'overlay' } } });
    expect(readJson('personal_triggers.json').triggers.map(t => t.name)).toEqual(['One', 'Nine']);
  });

  it('an empty pull empties the list (the dashboard asks first)', () => {
    setLocal([row('p_1', 'One')]);
    setRules({ 'builtin:blind': { '*': 'off' } });
    expect(pull([], {}, 'replace')).toMatchObject({ ok: true, removed: 1, rules_changed: 1 });
    expect(names()).toEqual([]);
    expect(agent._triggerRules).toEqual({});
  });

  it('a pull where nothing would load replaces nothing and makes no backup', () => {
    setLocal([row('p_1', 'One')]);
    realWrite.call(fs, path.join(tmp, 'personal_triggers.json'), '{"triggers":[]}');
    const r = pull([{ id: 'bad', name: 'No pattern' }], {}, 'replace');
    expect(r.ok).toBe(false);
    expect(names()).toEqual(['One']);
    expect(fs.readdirSync(tmp).filter(f => f.includes('.bak-'))).toEqual([]);
  });
});

describe('"what you hear" rules', () => {
  it('merge goes key by key and character by character; the pulled value wins', () => {
    setRules({ 'guild:a': { '*': 'off' }, 'builtin:charm_break': { '*': 'overlay' }, 'guild:keep': { fenrisk: 'off' } });
    const r = pull([], { 'guild:a': { '*': 'speak', Fenrisk: 'off' }, 'guild:b': { '*': 'overlay' } }, 'merge');
    expect(agent._triggerRules).toEqual({
      'guild:a': { '*': 'speak', fenrisk: 'off' },       // '*' replaced, a new character cell added (lowercased)
      'builtin:charm_break': { '*': 'overlay' },          // not in the pull: kept
      'guild:keep': { fenrisk: 'off' },
      'guild:b': { '*': 'overlay' },
    });
    expect(r.rules_changed).toBe(3);                       // a/* changed, a/fenrisk added, b/* added
    expect(readJson('trigger_rules.json').rules['guild:b']).toEqual({ '*': 'overlay' });
  });

  it('an identical pulled rule changes nothing', () => {
    setRules({ 'guild:a': { '*': 'off' } });
    expect(pull([], { 'guild:a': { '*': 'off' } }, 'merge').rules_changed).toBe(0);
  });

  it('a malformed key, mode or prototype key in a pull is dropped, not stored', () => {
    const rules = JSON.parse('{"nonsense":{"*":"off"},"guild:ok":{"*":"loud"},"__proto__":{"*":"off"},"guild:fine":{"*":"off"}}');
    pull([], rules, 'merge');
    expect(agent._triggerRules).toEqual({ 'guild:fine': { '*': 'off' } });
    expect(({}).polluted).toBeUndefined();
  });

  it('a reply with no triggers array or no rules object is refused untouched', () => {
    setLocal([row('p_1', 'One')]);
    expect(agent._applyTriggerPull({ rules: {} }, 'merge', tmp).ok).toBe(false);
    expect(agent._applyTriggerPull({ triggers: [] }, 'merge', tmp).ok).toBe(false);
    expect(names()).toEqual(['One']);
  });
});

describe('the backup before a pull', () => {
  it('copies both files as they were, and names them by time', () => {
    setLocal([row('p_1', 'Before')]);
    agent._applyTriggerPull({ triggers: [], rules: { 'builtin:blind': { '*': 'off' } } }, 'merge', tmp);   // writes both files
    const trigBefore = fs.readFileSync(path.join(tmp, 'personal_triggers.json'), 'utf8');
    const rulesBefore = fs.readFileSync(path.join(tmp, 'trigger_rules.json'), 'utf8');
    fs.readdirSync(tmp).filter(f => f.includes('.bak-')).forEach(f => fs.unlinkSync(path.join(tmp, f)));
    pull([row('p_2', 'After')], { 'builtin:blind': { '*': 'speak' } }, 'replace');
    const baks = fs.readdirSync(tmp).filter(f => f.includes('.bak-')).sort();
    expect(baks).toHaveLength(2);
    expect(baks[0]).toMatch(/^personal_triggers\.json\.bak-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
    expect(baks[1]).toMatch(/^trigger_rules\.json\.bak-/);
    expect(fs.readFileSync(path.join(tmp, baks[0]), 'utf8')).toBe(trigBefore);   // what was there BEFORE the pull
    expect(fs.readFileSync(path.join(tmp, baks[1]), 'utf8')).toBe(rulesBefore);
    expect(readJson('personal_triggers.json').triggers.map(t => t.name)).toEqual(['After']);
  });

  it('a file that does not exist yet is simply not backed up', () => {
    expect(agent._tsBackupLocal(tmp)).toEqual({ ok: true, made: [] });
    fs.writeFileSync(path.join(tmp, 'trigger_rules.json'), '{}');
    expect(agent._tsBackupLocal(tmp, Date.UTC(2026, 9, 12)).made).toEqual(['trigger_rules.json.bak-2026-10-12T00-00-00-000Z']);
  });

  it('keeps the newest three of each, per file, and touches nothing else', () => {
    fs.writeFileSync(path.join(tmp, 'personal_triggers.json'), '{"triggers":[]}');
    fs.writeFileSync(path.join(tmp, 'trigger_rules.json'), '{"rules":{}}');
    fs.writeFileSync(path.join(tmp, 'logsync.stats.json.bak-2020'), 'not ours');
    const day = (d) => Date.UTC(2026, 9, d);
    for (let d = 1; d <= 5; d++) agent._tsBackupLocal(tmp, day(d));
    const left = fs.readdirSync(tmp).sort();
    const dayOf = (f) => f.match(/\.bak-(\d{4}-\d{2}-\d{2})/)[1];
    expect(left.filter(f => f.startsWith('personal_triggers.json.bak-')).map(dayOf)).toEqual(['2026-10-03', '2026-10-04', '2026-10-05']);
    expect(left.filter(f => f.startsWith('trigger_rules.json.bak-')).map(dayOf)).toEqual(['2026-10-03', '2026-10-04', '2026-10-05']);
    expect(left).toContain('logsync.stats.json.bak-2020');
  });

  it('a backup that cannot be made stops the pull before anything changes', () => {
    setLocal([row('p_1', 'Before')]);
    fs.writeFileSync(path.join(tmp, 'personal_triggers.json'), '{"triggers":[]}');
    vi.spyOn(fs, 'copyFileSync').mockImplementation(() => { throw new Error('disk full'); });
    const r = pull([row('p_2', 'After')], {}, 'replace');
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/back up/);
    expect(names()).toEqual(['Before']);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('local mode makes no request, ever', () => {
  let fetchSpy;
  beforeEach(() => { fetchSpy = vi.fn(async () => { throw new Error('a request was made'); }); vi.stubGlobal('fetch', fetchSpy); });

  for (const [label, opts] of [['no token', { botUrl: BOT, token: '', dryRun: false }], ['null token', { botUrl: BOT, token: null, dryRun: false }], ['agent not started', null]]) {
    it(`${label}: push, list and pull all answer "needs a linked account"`, async () => {
      agent._setUploadOptsForTest(opts);
      setLocal([row('p_1', 'One')]);
      for (const out of [await agent._triggerSyncPush(), await agent._triggerSyncList(), await agent._triggerSyncPull({ mode: 'merge' }, tmp)]) {
        expect(out).toMatchObject({ ok: false, status: 0, local: true });
        expect(out.error).toMatch(/linked Wolf Pack account/);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(names()).toEqual(['One']);
      expect(fs.readdirSync(tmp)).toEqual([]);
    });
  }

  it('over HTTP: the three routes answer 400 with that line and the bot is never asked', async () => {
    agent._setUploadOptsForTest({ botUrl: BOT, token: null, dryRun: false });
    let server;
    const orig = http.createServer;
    http.createServer = function (...a) { server = orig.apply(this, a); return server; };
    try { agent.startWebDashboard(0); } finally { http.createServer = orig; }
    await new Promise(r => server.once('listening', r));
    const port = server.address().port;
    const call = (method, p, headers = {}, body = '{}') => new Promise((res, rej) => {
      const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', ...headers } }, r => {
        let d = ''; r.on('data', c => { d += c; }); r.on('end', () => res({ status: r.statusCode, body: d ? JSON.parse(d) : null }));
      });
      req.on('error', rej); req.end(method === 'POST' ? body : undefined);
    });
    try {
      for (const r of [await call('GET', '/api/trigger-sync/list'), await call('POST', '/api/trigger-sync/push'),
        await call('POST', '/api/trigger-sync/pull', {}, '{"mode":"merge"}')]) {
        expect(r.status).toBe(400);
        expect(r.body).toMatchObject({ ok: false, local: true });
      }
      // a web page that is not one of ours may not POST (the neighbouring write routes do the same)
      expect((await call('POST', '/api/trigger-sync/push', { Origin: 'https://evil.example' })).status).toBe(403);
      expect((await call('POST', '/api/trigger-sync/pull', { Origin: 'https://evil.example' }, '{"mode":"replace"}')).status).toBe(403);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { await new Promise(r => server.close(r)); }
  });
});

describe('with a linked account: the three bot calls', () => {
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  let fetchSpy;
  const stub = (impl) => { fetchSpy = vi.fn(impl); vi.stubGlobal('fetch', fetchSpy); };
  beforeEach(() => { agent._setUploadOptsForTest({ botUrl: BOT, token: 'wpms_tok', dryRun: false }); });

  it('push: POSTs the personal triggers without _ keys, the rules, this machine and the agent version', async () => {
    setLocal([row('p_1', 'One'), row('suggested:self_stunned', 'Stunned')]);
    setRules({ 'personal:p_1': { '*': 'off' } });
    stub(async () => reply(200, { ok: true, id: UUID, created_at: '2026-10-12T20:00:00Z', trigger_count: 2, rule_count: 1 }));
    const out = await agent._triggerSyncPush();
    expect(out).toMatchObject({ ok: true, id: UUID, trigger_count: 2, rule_count: 1 });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(BASE + '/personal-triggers/push');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer wpms_tok');
    const body = JSON.parse(init.body);
    expect(body.triggers.map(t => t.name)).toEqual(['One', 'Stunned']);
    expect(body.triggers.every(t => Object.keys(t).every(k => !k.startsWith('_')))).toBe(true);
    expect(JSON.stringify(body.triggers)).not.toContain('"_regex"');
    expect(body.rules).toEqual({ 'personal:p_1': { '*': 'off' } });
    expect(body.machine_name).toBe(os.hostname());
    expect(body.agent_version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('list: GETs the bot list and returns its pushes', async () => {
    const pushes = [{ id: UUID, created_at: '2026-10-12T20:00:00Z', machine_name: 'DESK', trigger_count: 4, rule_count: 2, agent_version: '3.7.129' }];
    stub(async () => reply(200, { pushes }));
    expect(await agent._triggerSyncList()).toEqual({ ok: true, pushes });
    expect(fetchSpy.mock.calls[0][0]).toBe(BASE + '/personal-triggers/list');
    expect(fetchSpy.mock.calls[0][1].method).toBe('GET');
  });

  it('pull: GETs by id (or newest), applies it, and returns the counts', async () => {
    setLocal([row('p_1', 'Mine')]);
    stub(async () => reply(200, { id: UUID, machine_name: 'DESK', triggers: [row('p_2', 'Theirs')], rules: { 'builtin:blind': { '*': 'off' } } }));
    const out = await agent._triggerSyncPull({ id: UUID, mode: 'merge' }, tmp);
    expect(out).toMatchObject({ ok: true, added: 1, updated: 0, kept: 1, rules_changed: 1 });
    expect(fetchSpy.mock.calls[0][0]).toBe(BASE + '/personal-triggers/pull?id=' + UUID);
    expect(names()).toEqual(['Mine', 'Theirs']);
    await agent._triggerSyncPull({ mode: 'merge' }, tmp);
    expect(fetchSpy.mock.calls[1][0]).toBe(BASE + '/personal-triggers/pull');
  });

  it.each([[403, 'not yours'], [404, 'nothing pushed yet'], [413, 'payload too large (max 512 KB)'], [503, 'supabase disabled'], [400, 'invalid id']])(
    'a %i from the bot is passed through as { ok:false, status, error }, and nothing local changes', async (status, error) => {
      setLocal([row('p_1', 'Mine')]);
      stub(async () => reply(status, { error }));
      expect(await agent._triggerSyncPull({ id: UUID, mode: 'replace' }, tmp)).toEqual({ ok: false, status, error });
      expect(await agent._triggerSyncPush()).toEqual({ ok: false, status, error });
      expect(names()).toEqual(['Mine']);
      expect(fs.readdirSync(tmp)).toEqual([]);
    });

  it('an unreachable bot is status 0 with a plain sentence', async () => {
    stub(async () => { throw new Error('ECONNRESET'); });
    expect(await agent._triggerSyncList()).toEqual({ ok: false, status: 0, error: 'could not reach the Wolf Pack server' });
  });

  it('a bad mode or id never reaches the bot', async () => {
    stub(async () => reply(200, {}));
    expect(await agent._triggerSyncPull({ mode: 'append' }, tmp)).toMatchObject({ ok: false, error: 'bad mode' });
    expect(await agent._triggerSyncPull({ id: '../../x', mode: 'merge' }, tmp)).toMatchObject({ ok: false, error: 'bad id' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('the Triggers tab card', () => {
  const html = readSource(path.join(AGENT_DIR, 'dashboard.html'));
  it('emits one stable placeholder, and the only thing baked into it is local mode', () => {
    const src = stripJs(html);
    expect(src).toMatch(/id="wpTrigSync" class="card wide"' \+ \(s\.localOnly \? ' data-local="1"' : ''\) \+ '>/);
    expect(src).toMatch(/window\._wpTrigSync\.mount\(\)/);
  });
  it('only a click fetches: the card never polls', () => {
    const iife = html.slice(html.indexOf('(function setupTriggerSync(){'), html.indexOf('window._wpTrigSync = { mount: mount };'));
    expect(iife).not.toMatch(/setInterval|setTimeout/);
    expect(iife).toContain("'/api/trigger-sync/list'");
    expect(iife).toContain("'/api/trigger-sync/push'");
    expect(iife).toContain("'/api/trigger-sync/pull'");
    expect(iife).not.toContain('<details');
  });
  it('local mode shows the one line and no buttons', () => {
    const iife = html.slice(html.indexOf('(function setupTriggerSync(){'), html.indexOf('window._wpTrigSync = { mount: mount };'));
    expect(iife).toMatch(/if \(localMode\(\)\) return h \+ '<div class="dim" style="font-size:12px">Sync needs a linked Wolf Pack account\.<\/div>';/);
  });
});

afterAll(() => { vi.restoreAllMocks(); });
