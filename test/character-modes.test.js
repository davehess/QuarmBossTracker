// test/character-modes.test.js — Main / alt · Inventory only · Hide completely, one choice per character.
//
// The guild lead, 2026-10-06: "the complete hide or hide from all but inventory should be with mimic during
// onboarding but the denotation on other side should be carried over." wolfpack.quest/me keeps three switches
// per character (hidden_from_lists, exclude_from_stats, exclude_inventory); Mimic's setup walkthrough and the
// dashboard's Me card ask ONE question and both sides show the same state.
//
// Every piece runs for real, none of it as a text assertion about behaviour:
//   1. the agent: the mode rules, the proxy to the bot (stubbed fetch — nothing leaves the machine), the
//      merge with this PC's logs, and the two localhost routes;
//   2. "Hide completely stops the log being read": the decision (modeStopsLog) → Mimic's don't-transmit list
//      (excludedAfterMode, the IPC) → the env the agent is launched with → the agent's real boot filter;
//   3. the setup walkthrough's characters step: preselection from a fixture, the choice, the restart;
//   4. the dashboard's Me card control: the same.
// Comments are stripped before any text match. Fixture names are invented.
//
// Run: npx vitest run test/character-modes.test.js

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import http from 'node:http';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT, AGENT_INDEX } from './_source-slice.js';

const agentSrc = readSource(AGENT_INDEX);
const agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');
const MIMIC = path.join(ROOT, 'apps', 'mimic');
const main = readSource(path.join(MIMIC, 'main.js'));
const preload = readSource(path.join(MIMIC, 'preload.js'));
const page = readSource(path.join(MIMIC, 'welcome.html'));
const script = page.slice(page.indexOf('<script>'), page.lastIndexOf('</script>'));
const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const tick = () => new Promise(r => setTimeout(r, 0));
const BOT = 'https://bot.example/api/agent/encounter';

// ── 1. the agent ────────────────────────────────────────────────────────────
// The real block, evaluated against the few outer bindings it reads. _saveOptInState is a counter: the real
// one writes logsync.optin.json beside the agent.
const modesBlock = sliceBlock(agentSrc, '// ── Character modes: ONE three-way choice', '// ── end character modes');
function agentHarness({ token = 't0k', session = 'sess-abcd1234', dryRun = false, fetchImpl } = {}) {
  const env = {
    calls: [], saves: 0, renders: 0, opts: { botUrl: BOT, token, dryRun }, session,
    fetch: async (url, init) => { env.calls.push({ url: String(url), init }); return fetchImpl(url, init); },
  };
  const prelude = `
    const AGENT_VERSION = '9.9.9';
    const stats = { characterPrefs: {}, watchedLogs: [], excludedLogs: [] };
    const _optinState = { characterModes: {} };
    let _uploadOpts = __e.opts;
    let _mimicSessionToken = __e.session;
    let _stateJsonCache = { at: 123, body: 'x' };
    function _canAskGuildForFights() { return !!(_uploadOpts && !_uploadOpts.dryRun && _uploadOpts.botUrl && _uploadOpts.token); }
    function _localOnly() { return !!(_uploadOpts && !_uploadOpts.token); }
    function _saveOptInState() { __e.saves++; }
    function scheduleRender() { __e.renders++; }
    const fetch = (...a) => __e.fetch(...a);
  `;
  const api = new Function('__e', prelude + modesBlock + `
    return { CHARACTER_MODES, characterModeFromFlags, characterModeToFlags, modeStopsLog, characterModeRow,
      _cleanCharacterModes, _pcCharacterModeRows, setCharacterMode, characterModesPayload, fetchCharacterModesMine,
      stats, _optinState, cacheReset: () => _stateJsonCache };`)(env);
  return { ...api, env };
}
const ok = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const flags = (h, s, i) => ({ hidden_from_lists: h, exclude_from_stats: s, exclude_inventory: i });

describe('the three modes are the website\'s three switches', () => {
  const a = agentHarness({ fetchImpl: async () => ok({}) });
  it('show = all off, inventory = hidden from lists only, hidden = all three on', () => {
    expect(a.characterModeToFlags('show')).toEqual(flags(false, false, false));
    expect(a.characterModeToFlags('inventory')).toEqual(flags(true, false, false));
    expect(a.characterModeToFlags('hidden')).toEqual(flags(true, true, true));
    expect(a.characterModeToFlags('custom')).toBeNull();
    expect(a.characterModeToFlags('bogus')).toBeNull();
  });
  it('reads the same three back, and calls any other mix custom (shown, never produced here)', () => {
    for (const m of a.CHARACTER_MODES) expect(a.characterModeFromFlags(a.characterModeToFlags(m))).toBe(m);
    expect(a.CHARACTER_MODES).toEqual(['show', 'inventory', 'hidden']);
    expect(a.characterModeFromFlags(flags(false, true, false))).toBe('custom');
    expect(a.characterModeFromFlags(flags(false, false, true))).toBe('custom');
    expect(a.characterModeFromFlags(flags(true, true, false))).toBe('custom');
    expect(a.characterModeFromFlags(null)).toBe('show');
    expect(a.characterModeFromFlags({})).toBe('show');
  });
  it('only Hide completely stops this PC reading the log; Inventory only keeps it read for the inventory exports', () => {
    expect(a.modeStopsLog('hidden')).toBe(true);
    expect(a.modeStopsLog('inventory')).toBe(false);
    expect(a.modeStopsLog('show')).toBe(false);
    expect(a.modeStopsLog('custom')).toBe(false);
    expect(a.modeStopsLog(undefined)).toBe(false);
  });
});

describe('which mode a character SHOWS, and where it came from', () => {
  const a = agentHarness({ fetchImpl: async () => ok({}) });
  const row = (o) => a.characterModeRow('Aldenmar', o);
  it('the website\'s flags are the truth when it knows the character', () => {
    expect(row({ prefs: flags(true, false, false) })).toMatchObject({ mode: 'inventory', src: 'site', pending: false });
    expect(row({ prefs: flags(true, true, true), local: { mode: 'show', synced: true } })).toMatchObject({ mode: 'hidden', src: 'site' });
  });
  it('a choice the website never took wins until it is synced, so it does not quietly flip back', () => {
    expect(row({ prefs: flags(false, false, false), local: { mode: 'hidden', synced: false } })).toMatchObject({ mode: 'hidden', src: 'local', pending: true });
  });
  it('with no website answer: the saved choice, then the don\'t-transmit list, then Main / alt — never a guess', () => {
    expect(row({ local: { mode: 'inventory', synced: true } })).toMatchObject({ mode: 'inventory', src: 'local', pending: false });
    expect(row({ excluded: true })).toMatchObject({ mode: 'hidden', src: 'local', log_read: false });
    expect(row({})).toMatchObject({ mode: 'show', src: 'default', log_read: true });
  });
  it('ignores a saved mode it does not know', () => {
    expect(row({ local: { mode: 'weird', synced: false } })).toMatchObject({ mode: 'show', src: 'default', pending: false });
  });
  it('reads saved choices back from disk: plain names with a known mode only', () => {
    expect(a._cleanCharacterModes({
      Aldenmar: { mode: 'hidden', at: 5, synced: false },
      brackwyn: { mode: 'inventory' },
      'bad name': { mode: 'show' }, corvale: { mode: 'nope' }, rethlan: null,
    })).toEqual({ aldenmar: { mode: 'hidden', at: 5, synced: false }, brackwyn: { mode: 'inventory', at: 0, synced: true } });
    expect(a._cleanCharacterModes(undefined)).toEqual({});
    expect(a._cleanCharacterModes('x')).toEqual({});
  });
});

describe('this PC\'s characters, including the ones whose log it no longer reads', () => {
  it('lists watched logs and excluded logs once each, sorted, with the mode each shows', () => {
    const a = agentHarness({ fetchImpl: async () => ok({}) });
    a.stats.watchedLogs = [{ character: 'Corvale' }, { character: 'Aldenmar' }, { character: 'Aldenmar' }];
    a.stats.excludedLogs = [{ character: 'Brackwyn' }];
    a.stats.characterPrefs = { aldenmar: { ...flags(true, false, false), tell_relay: false } };
    expect(a._pcCharacterModeRows()).toEqual([
      { name: 'Aldenmar', mode: 'inventory', src: 'site', pending: false, log_read: true },
      { name: 'Brackwyn', mode: 'hidden', src: 'local', pending: false, log_read: false },
      { name: 'Corvale', mode: 'show', src: 'default', pending: false, log_read: true },
    ]);
  });
  it('is byte-stable between calls (it rides /api/state every 2 seconds)', () => {
    const a = agentHarness({ fetchImpl: async () => ok({}) });
    a.stats.watchedLogs = [{ character: 'Aldenmar' }, { character: 'Brackwyn' }];
    expect(JSON.stringify(a._pcCharacterModeRows())).toBe(JSON.stringify(a._pcCharacterModeRows()));
  });
  it('rides the dashboard state', () => {
    expect(stripJs(agentSrc)).toMatch(/characterModes:\s+_pcCharacterModeRows\(\),/);
  });
});

describe('making a choice: the proxy to the bot', () => {
  let h;
  const make = (o) => { h = agentHarness(o); return h; };

  it('POSTs { character, mode } to /character-prefs as the signed-in raider, then keeps it here and applies it NOW', async () => {
    make({ fetchImpl: async () => ok({ ok: true, character: 'Aldenmar', mode: 'inventory', prefs: {} }) });
    h.stats.characterPrefs = { aldenmar: { exclude_from_stats: false, exclude_inventory: false, hidden_from_lists: false, tell_relay: true } };
    const r = await h.setCharacterMode('Aldenmar', 'inventory');
    expect(h.env.calls).toHaveLength(1);
    expect(h.env.calls[0].url).toBe('https://bot.example/api/agent/character-prefs');
    expect(h.env.calls[0].init.method).toBe('POST');
    expect(JSON.parse(h.env.calls[0].init.body)).toEqual({ character: 'Aldenmar', mode: 'inventory' });
    expect(h.env.calls[0].init.headers.Authorization).toBe('Bearer t0k');
    expect(h.env.calls[0].init.headers['X-Wolfpack-Mimic-Session']).toBe('sess-abcd1234');
    expect(h.env.calls[0].init.signal, 'a stuck server cannot hold the click forever').toBeTruthy();
    expect(r).toMatchObject({ ok: true, character: 'Aldenmar', mode: 'inventory', synced: true, reason: null, note: null, stops_log: false });
    expect(h._optinState.characterModes.aldenmar).toMatchObject({ mode: 'inventory', synced: true });
    expect(h.env.saves).toBe(1);
    // the upload gates read this cache: flags now, tell_relay untouched
    expect(h.stats.characterPrefs.aldenmar).toEqual({ ...flags(true, false, false), tell_relay: true });
    expect(h.cacheReset().body, 'the next /api/state is not a 400ms-old copy').toBeNull();
    expect(h.env.renders).toBe(1);
  });

  it('Hide completely sets all three flags in the cache and says the log stops being read', async () => {
    make({ fetchImpl: async () => ok({ ok: true, mode: 'hidden' }) });
    const r = await h.setCharacterMode('Brackwyn', 'hidden');
    expect(r).toMatchObject({ synced: true, stops_log: true });
    expect(h.stats.characterPrefs.brackwyn).toMatchObject(flags(true, true, true));
  });

  it('an older bot (404, or a 200 that is not { ok, mode }) leaves it on this PC, with the reason and a line to show', async () => {
    for (const reply of [() => ok({}, 404), () => ok('OK'), () => ok({ ok: true }), () => ok({ prefs: {} })]) {
      make({ fetchImpl: async () => reply() });
      const r = await h.setCharacterMode('Aldenmar', 'inventory');
      expect(r).toMatchObject({ ok: true, synced: false, reason: 'bot-old' });
      expect(r.note).toMatch(/^Saved on this PC\./);
      expect(h._optinState.characterModes.aldenmar).toMatchObject({ mode: 'inventory', synced: false });
    }
  });

  it('403 is a character that is not theirs (not linked yet), 401 a lapsed sign-in, anything else offline', async () => {
    for (const [reply, reason] of [[() => ok({}, 403), 'not-linked'], [() => ok({}, 401), 'signed-out'], [() => ok({}, 500), 'offline'], [() => { throw new Error('ECONNRESET'); }, 'offline']]) {
      make({ fetchImpl: async () => reply() });
      expect(await h.setCharacterMode('Aldenmar', 'show')).toMatchObject({ synced: false, reason });
    }
  });

  it('privacy ratchets one way: an un-hide the website never heard is NOT applied, a hide is', async () => {
    make({ fetchImpl: async () => ok({}, 404) });
    h.stats.characterPrefs = { aldenmar: { ...flags(true, true, true), tell_relay: false } };
    await h.setCharacterMode('Aldenmar', 'show');
    expect(h.stats.characterPrefs.aldenmar).toMatchObject(flags(true, true, true));      // still held back
    await h.setCharacterMode('Brackwyn', 'hidden');
    expect(h.stats.characterPrefs.brackwyn).toMatchObject(flags(true, true, true));      // applied at once
    await h.setCharacterMode('Corvale', 'inventory');
    expect(h.stats.characterPrefs.corvale, 'an unsynced inventory choice touches no gate').toBeUndefined();
  });

  it('local mode (no token) and a dry run make NO call, and say so', async () => {
    make({ token: null, fetchImpl: async () => ok({}) });
    expect(await h.setCharacterMode('Aldenmar', 'hidden')).toMatchObject({ ok: true, synced: false, reason: 'local', stops_log: true });
    expect(h.env.calls).toHaveLength(0);
    expect(h._optinState.characterModes.aldenmar).toMatchObject({ mode: 'hidden', synced: false });
    make({ dryRun: true, fetchImpl: async () => ok({}) });
    expect(await h.setCharacterMode('Aldenmar', 'show')).toMatchObject({ synced: false, reason: 'local' });
    expect(h.env.calls).toHaveLength(0);
  });

  it('a token with no Mimic sign-in cannot name the person: no call, reason signed-out', async () => {
    make({ session: '', fetchImpl: async () => ok({}) });
    expect(await h.setCharacterMode('Aldenmar', 'show')).toMatchObject({ synced: false, reason: 'signed-out' });
    expect(h.env.calls).toHaveLength(0);
  });

  it('refuses a name that is not plain letters and a mode it does not know, before anything is sent or saved', async () => {
    make({ fetchImpl: async () => ok({ ok: true, mode: 'show' }) });
    for (const [n, m] of [['Brack wyn', 'show'], ['../x', 'show'], ['', 'show'], ['Aldenmar', 'custom'], ['Aldenmar', 'HIDDEN'], ['Aldenmar', undefined], ['A'.repeat(25), 'show']]) {
      expect(await h.setCharacterMode(n, m)).toMatchObject({ ok: false });
    }
    expect(h.env.calls).toHaveLength(0);
    expect(h.env.saves).toBe(0);
  });

  it('says whether this PC is reading the log right now', async () => {
    make({ fetchImpl: async () => ok({ ok: true, mode: 'show' }) });
    h.stats.excludedLogs = [{ character: 'Brackwyn', logPath: 'x' }];
    expect((await h.setCharacterMode('brackwyn', 'show')).log_read).toBe(false);
    expect((await h.setCharacterMode('Aldenmar', 'show')).log_read).toBe(true);
  });
});

describe('GET /api/character-modes: the website\'s family merged with the logs on this PC', () => {
  const family = [
    { name: 'Aldenmar', hidden_from_lists: false, exclude_from_stats: false, exclude_inventory: false, mode: 'show' },
    { name: 'Brackwyn', hidden_from_lists: true, exclude_from_stats: false, exclude_inventory: false, mode: 'inventory' },
    { name: 'Corvale', hidden_from_lists: true, exclude_from_stats: true, exclude_inventory: true, mode: 'hidden' },
    { name: 'Rethlan', hidden_from_lists: false, exclude_from_stats: true, exclude_inventory: false, mode: 'custom' },
  ];
  const byName = (r) => Object.fromEntries(r.characters.map(c => [c.name, c]));

  it('asks ?mine=1 and returns the whole family, with the website\'s mode, the PC\'s logs, and the log gate', async () => {
    const h = agentHarness({ fetchImpl: async () => ok({ characters: family }) });
    h.stats.watchedLogs = [{ character: 'Aldenmar' }, { character: 'Zarrin' }];     // Zarrin: a log not linked to the guild yet
    h.stats.excludedLogs = [{ character: 'Corvale' }];
    const r = await h.characterModesPayload();
    expect(h.env.calls[0].url).toBe('https://bot.example/api/agent/character-prefs?mine=1');
    expect(h.env.calls[0].init.headers['X-Wolfpack-Mimic-Session']).toBe('sess-abcd1234');
    expect(r).toMatchObject({ ok: true, signed_in: true, local_only: false, synced: true, reason: null });
    const c = byName(r);
    expect(Object.keys(c).sort()).toEqual(['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Zarrin']);
    expect(c.Aldenmar).toMatchObject({ mode: 'show', src: 'site', linked: true, on_pc: true, log_read: true });
    expect(c.Brackwyn).toMatchObject({ mode: 'inventory', linked: true, on_pc: false, hidden_from_lists: true, exclude_from_stats: false });
    expect(c.Corvale).toMatchObject({ mode: 'hidden', linked: true, on_pc: true, log_read: false });
    expect(c.Rethlan, 'a mix set on the website arrives as it is').toMatchObject({ mode: 'custom', exclude_from_stats: true, exclude_inventory: false });
    expect(c.Zarrin).toMatchObject({ mode: 'show', src: 'default', linked: false, on_pc: true });
  });

  it('a character the website does not know takes its mode from this PC\'s saved choice, then its don\'t-transmit list', async () => {
    const h = agentHarness({ fetchImpl: async () => ok({ characters: [] }) });
    h.stats.watchedLogs = [{ character: 'Zarrin' }];
    h.stats.excludedLogs = [{ character: 'Nyssara' }];
    h._optinState.characterModes = { zarrin: { mode: 'inventory', at: 1, synced: false } };
    const c = byName(await h.characterModesPayload());
    expect(c.Zarrin).toMatchObject({ mode: 'inventory', src: 'local', pending: true, linked: false, hidden_from_lists: true });
    expect(c.Nyssara).toMatchObject({ mode: 'hidden', src: 'local', linked: false, log_read: false, exclude_from_stats: true });
  });

  it('a choice the website never took still wins over its answer', async () => {
    const h = agentHarness({ fetchImpl: async () => ok({ characters: family }) });
    h.stats.watchedLogs = [{ character: 'Aldenmar' }];
    h._optinState.characterModes = { aldenmar: { mode: 'hidden', at: 1, synced: false } };
    expect(byName(await h.characterModesPayload()).Aldenmar).toMatchObject({ mode: 'hidden', src: 'local', pending: true });
  });

  it('an older bot (no family list), local mode and a lapsed sign-in still answer with this PC\'s rows, and say why', async () => {
    let h = agentHarness({ fetchImpl: async () => ok({ prefs: {} }) });
    h.stats.watchedLogs = [{ character: 'Aldenmar' }];
    expect(await h.characterModesPayload()).toMatchObject({ ok: true, synced: false, reason: 'bot-old', characters: [{ name: 'Aldenmar', mode: 'show' }] });
    h = agentHarness({ token: null, fetchImpl: async () => ok({}) });
    h.stats.watchedLogs = [{ character: 'Aldenmar' }];
    expect(await h.characterModesPayload()).toMatchObject({ synced: false, reason: 'local', local_only: true });
    expect(h.env.calls, 'local mode asks nobody').toHaveLength(0);
    h = agentHarness({ fetchImpl: async () => ok({}, 401) });
    expect(await h.characterModesPayload()).toMatchObject({ synced: false, reason: 'signed-out' });
    h = agentHarness({ fetchImpl: async () => { throw new Error('down'); } });
    expect(await h.characterModesPayload()).toMatchObject({ ok: true, synced: false, reason: 'offline' });
  });

  it('keeps the website\'s answer for 30 seconds, and a choice drops it', async () => {
    const h = agentHarness({ fetchImpl: async () => ok({ characters: family }) });
    await h.characterModesPayload(); await h.characterModesPayload();
    expect(h.env.calls).toHaveLength(1);
    await h.setCharacterMode('Aldenmar', 'show');           // one POST ...
    await h.characterModesPayload();                         // ... then a fresh GET
    expect(h.env.calls.map(c => c.init.method || 'GET')).toEqual(['GET', 'POST', 'GET']);
  });

  it('drops a family row whose name is not plain letters', async () => {
    const h = agentHarness({ fetchImpl: async () => ok({ characters: [{ name: 'Aldenmar', mode: 'show' }, { name: '<b>x</b>', mode: 'show' }, null] }) });
    expect((await h.characterModesPayload()).characters.map(c => c.name)).toEqual(['Aldenmar']);
  });
});

describe('the two routes, over HTTP', () => {
  let server, port;
  const call = (method, p, body) => new Promise((res, rej) => {
    const data = body == null ? null : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, r => {
      let d = ''; r.on('data', c => { d += c; }); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: d ? JSON.parse(d) : null }));
    });
    req.on('error', rej); req.end(data || undefined);
  });
  beforeAll(async () => {
    const orig = http.createServer;
    http.createServer = function (...a) { server = orig.apply(this, a); return server; };
    try { agent.startWebDashboard(0); } finally { http.createServer = orig; }
    await new Promise(r => server.once('listening', r));
    port = server.address().port;
  });
  afterAll(() => new Promise(r => server.close(r)));
  beforeEach(() => { agent._setUploadOptsForTest({ botUrl: BOT, token: null, dryRun: false }); });
  afterEach(() => { agent._setUploadOptsForTest(null); });

  it('GET /api/character-modes answers 200 JSON, uncached, and in local mode asks nobody', async () => {
    const r = await call('GET', '/api/character-modes');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).toMatchObject({ ok: true, local_only: true, synced: false, reason: 'local' });
    expect(Array.isArray(r.body.characters)).toBe(true);
  });
  it('POST /api/character-mode: 400 for a bad name or mode (nothing is saved), 400 for bad JSON', async () => {
    expect((await call('POST', '/api/character-mode', { character: 'Brack wyn', mode: 'hidden' })).status).toBe(400);
    expect((await call('POST', '/api/character-mode', { character: 'Aldenmar', mode: 'sideways' })).body).toMatchObject({ ok: false, error: 'bad mode' });
    expect((await call('POST', '/api/character-mode', {})).status).toBe(400);
    const bad = await new Promise((res, rej) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/api/character-mode', method: 'POST', headers: { 'Content-Length': 5 } }, r => { r.resume(); r.on('end', () => res(r.statusCode)); });
      req.on('error', rej); req.end('{nope');
    });
    expect(bad).toBe(400);
  });
});

// ── 2. Hide completely stops the log being read ─────────────────────────────
// modeStopsLog (the decision) → Mimic's don't-transmit list → WOLFPACK_EXCLUDED_CHARS → the agent's REAL
// boot filter. The existing "Transmit?" mechanism, not a second one.
const mainBlock = sliceBlock(main, 'function excludedAfterMode(list, character, mode) {', '// ── end character modes');
function mimicHarness({ port = 7779, cfg = {}, reply } = {}) {
  const handlers = {}, sent = [], saved = [], logs = [];
  const state = { cfg: { excludedCharacters: [], ...cfg } };
  const fakeHttp = { request: (opts, cb) => {
    const req = { on() { return req; }, destroy() {}, end(body) {
      sent.push({ opts, body: body ? JSON.parse(body) : null });
      const res = { statusCode: 200, on(ev, fn) { if (ev === 'data') fn(JSON.stringify(reply ? reply(opts, body) : { ok: true, synced: true })); if (ev === 'end') fn(); } };
      cb(res);
    } };
    return req;
  } };
  const env = {
    ipcMain: { handle: (n, fn) => { handlers[n] = fn; } }, http: fakeHttp, agentPort: port,
    loadConfig: () => JSON.parse(JSON.stringify(state.cfg)), saveConfig: (c) => { state.cfg = c; saved.push(c); },
    appendAgentLog: (m) => logs.push(m),
  };
  // eslint-disable-next-line no-new-func
  const api = new Function(...Object.keys(env), mainBlock + '\nreturn { excludedAfterMode };')(...Object.values(env));
  return { handlers, sent, saved, logs, state, ...api };
}

describe('Mimic keeps the don\'t-transmit list in step with the choice', () => {
  it('Hide completely adds the name once, any case; every other mode takes it out; nobody else moves', () => {
    const { excludedAfterMode: ex } = mimicHarness();
    expect(ex([], 'Aldenmar', 'hidden')).toEqual(['Aldenmar']);
    expect(ex(['Brackwyn'], 'Aldenmar', 'hidden')).toEqual(['Brackwyn', 'Aldenmar']);
    expect(ex(['aldenmar', 'Brackwyn'], 'Aldenmar', 'hidden'), 'already there, left alone').toEqual(['aldenmar', 'Brackwyn']);
    expect(ex(['aldenmar', 'Brackwyn'], 'Aldenmar', 'show')).toEqual(['Brackwyn']);
    expect(ex(['aldenmar', 'Brackwyn'], 'ALDENMAR', 'inventory')).toEqual(['Brackwyn']);
    expect(ex(['Brackwyn'], 'Aldenmar', 'inventory'), 'not on the list: nothing to do').toEqual(['Brackwyn']);
    expect(ex(undefined, 'Aldenmar', 'show')).toEqual([]);
  });

  it('character-mode-set: asks the engine, changes the list, and says a restart is needed only when it changed', async () => {
    const h = mimicHarness({ reply: () => ({ ok: true, character: 'Aldenmar', mode: 'hidden', synced: true, stops_log: true }) });
    const r = await h.handlers['character-mode-set']({}, 'Aldenmar', 'hidden');
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].opts).toMatchObject({ host: '127.0.0.1', port: 7779, path: '/api/character-mode', method: 'POST' });
    expect(h.sent[0].body).toEqual({ character: 'Aldenmar', mode: 'hidden' });
    expect(h.state.cfg.excludedCharacters).toEqual(['Aldenmar']);
    expect(r).toMatchObject({ ok: true, synced: true, restart_needed: true });
    // the same choice again: the engine hears it, the list does not change, no restart
    const again = await h.handlers['character-mode-set']({}, 'Aldenmar', 'hidden');
    expect(again.restart_needed).toBe(false);
    expect(h.saved).toHaveLength(1);
    // taking it back puts the log back (and restarts to read it again)
    const back = await h.handlers['character-mode-set']({}, 'Aldenmar', 'inventory');
    expect(h.state.cfg.excludedCharacters).toEqual([]);
    expect(back.restart_needed).toBe(true);
  });

  it('Inventory only on a character whose log is read changes nothing about the log (no restart)', async () => {
    const h = mimicHarness();
    expect((await h.handlers['character-mode-set']({}, 'Brackwyn', 'inventory')).restart_needed).toBe(false);
    expect(h.saved).toHaveLength(0);
  });

  it('with the engine down: the log half still lands, the website half says it did not', async () => {
    const h = mimicHarness({ port: 0 });
    const r = await h.handlers['character-mode-set']({}, 'Aldenmar', 'hidden');
    expect(h.sent).toHaveLength(0);
    expect(r).toMatchObject({ ok: true, synced: false, reason: 'engine', restart_needed: true, stops_log: true });
    expect(r.note).toMatch(/engine is not running/);
    expect(h.state.cfg.excludedCharacters).toEqual(['Aldenmar']);
    const none = await h.handlers['character-mode-set']({}, 'Brackwyn', 'inventory');
    expect(none).toMatchObject({ ok: false, reason: 'engine' });
  });

  it('refuses a name or mode that is not on the list of allowed ones, before touching the engine or the list', async () => {
    const h = mimicHarness();
    for (const [n, m] of [['', 'hidden'], ['Brack wyn', 'hidden'], ['..\\x', 'hidden'], ['Aldenmar', 'custom'], ['Aldenmar', 'nope'], [42, 'show']]) {
      expect(await h.handlers['character-mode-set']({}, n, m)).toEqual({ ok: false, error: 'bad request' });
    }
    expect(h.sent).toHaveLength(0);
    expect(h.saved).toHaveLength(0);
  });

  it('character-modes-get relays the engine\'s answer, or says the engine is not up', async () => {
    const h = mimicHarness({ reply: () => ({ ok: true, synced: true, characters: [{ name: 'Aldenmar', mode: 'show' }] }) });
    expect(await h.handlers['character-modes-get']()).toMatchObject({ ok: true, characters: [{ name: 'Aldenmar' }] });
    expect(h.sent[0].opts).toMatchObject({ path: '/api/character-modes', method: 'GET' });
    expect(await mimicHarness({ port: 0 }).handlers['character-modes-get']()).toEqual({ ok: false, reason: 'engine', characters: [] });
  });
});

describe('Hide completely, end to end: the agent really stops reading the log', () => {
  // The agent's own boot lines, run for real. Mimic hands over the list as the env var (launchAgent: .join(',')).
  const bootBlock = sliceBlock(agentSrc, "const excludedCsv = process.env.WOLFPACK_EXCLUDED_CHARS || '';", '  args.logs = filtered;');
  function boot(env, logs) {
    const args = { logs: logs.slice() };
    const stats = { watchedLogs: [] };
    const quiet = { log() {}, warn() {} };
    // eslint-disable-next-line no-new-func
    new Function('process', 'args', 'stats', 'characterFromFilename', 'isBackupLogFile', 'console', bootBlock + '\nreturn 0;')(
      { env }, args, stats, agent.characterFromFilename, agent.isBackupLogFile, quiet);
    return { read: args.logs, stats };
  }
  // POSIX paths: the agent takes the file name with path.basename, which on the CI box does not split a backslash.
  const LOGS = ['/EQ/eqlog_Aldenmar_pq.proj.txt', '/EQ/eqlog_Brackwyn_pq.proj.txt', '/EQ/eqlog_Corvale_pq.proj.txt'];

  it('the chain: hidden → on the list → in the env → that log is not read, and the rest are', () => {
    const { excludedAfterMode: ex } = mimicHarness();
    expect(agentHarness({ fetchImpl: async () => ok({}) }).modeStopsLog('hidden')).toBe(true);
    const env = { WOLFPACK_EXCLUDED_CHARS: ex([], 'Brackwyn', 'hidden').join(',') };
    const { read, stats } = boot(env, LOGS);
    expect(read).toEqual([LOGS[0], LOGS[2]]);
    // it still knows the character, so the dashboard can offer the way back
    expect(stats.excludedLogs).toEqual([{ character: 'Brackwyn', logPath: LOGS[1] }]);
  });

  it('any other mode takes the name off the list, and the log is read again', () => {
    const { excludedAfterMode: ex } = mimicHarness();
    const list = ex(ex([], 'Brackwyn', 'hidden'), 'Brackwyn', 'inventory');
    const { read, stats } = boot({ WOLFPACK_EXCLUDED_CHARS: list.join(',') }, LOGS);
    expect(read).toEqual(LOGS);
    expect(stats.excludedLogs).toEqual([]);
  });

  it('matches in any case, and a copied-aside backup of an excluded character is not listed as a log', () => {
    const { read, stats } = boot({ WOLFPACK_EXCLUDED_CHARS: 'brackwyn' }, [...LOGS, '/EQ/eqlog_Brackwyn3_pq.proj.txt']);
    expect(read).toEqual([LOGS[0], LOGS[2]]);
    expect(stats.excludedLogs.map(l => l.character)).toEqual(['Brackwyn']);
  });
});

// ── 3. the setup walkthrough ────────────────────────────────────────────────
describe('the walkthrough\'s characters step', () => {
  const rows = sliceBlock(script, "var MODES = [['show'", '\n  // The engine reads the don\'t-send list when it starts');
  const bits = [
    sliceBlock(script, 'function esc(s) {', '\n'),
    sliceBlock(script, 'function size(n) {', '\n'),
    sliceBlock(script, 'function splitRecentChars(chars, main) {', '\n  }\n'),
  ].join('\n');

  // The real functions against a stub page. `el` records the HTML bChars writes and hands back the radios in it.
  function page_(over = {}) {
    const calls = { set: [], restart: 0, changed: 0, modes: 0 };
    const S = {
      chars: [], excluded: new Set(), main: null, signedIn: true, eqConfigured: true,
      modes: {}, modeBusy: {}, modesAt: Date.now(), modesBusyLoad: false, modesSynced: true, modesRetried: false, focusKey: null, ...over.S,
    };
    const M = {
      setCharacterMode: (n, m) => { calls.set.push([n, m]); return Promise.resolve(over.set ? over.set(n, m) : { ok: true, synced: true, restart_needed: false }); },
      characterModes: () => { calls.modes++; return Promise.resolve(over.answer || { ok: false }); },
      saveConfig: () => Promise.resolve(true),
    };
    const env = { S, M, calls, changed: () => { calls.changed++; }, restartSoon: () => { calls.restart++; }, $: () => null, setTimeout: () => 1, Date, JSON };
    // eslint-disable-next-line no-new-func
    const api = new Function(...Object.keys(env), bits + '\n' + rows + '\nreturn { modeFor, modesFromAnswer, modeNote, setMode, loadModes, bChars, MODES };')(...Object.values(env));
    return { ...env, ...api };
  }
  const CHARS = [
    { character: 'Aldenmar', log_size: 48e6, ago_days: 0 },
    { character: 'Brackwyn', log_size: 9e6, ago_days: 3 },
    { character: 'Corvale', log_size: 2e5, ago_days: 41 },
    { character: 'Rethlan', log_size: 1e3, ago_days: 400 },     // dormant and tiny: the kind that would be guessed "inventory"
  ];
  const ANSWER = { ok: true, synced: true, characters: [
    { name: 'Aldenmar', mode: 'show', src: 'site', on_pc: true, log_read: true },
    { name: 'Brackwyn', mode: 'inventory', src: 'site', on_pc: true, log_read: true },
    { name: 'Corvale', mode: 'hidden', src: 'site', on_pc: true, log_read: false },
    { name: 'Nyssara', mode: 'inventory', src: 'site', on_pc: false, log_read: true },
  ] };
  // character → { checked: mode, modes: [...] } read off the HTML
  const read = (html) => Object.fromEntries([...html.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)].filter(m => m[0].includes('data-main=')).map(m => {
    const name = (m[0].match(/data-main="(\w+)"/) || [])[1];
    const radios = [...m[0].matchAll(/data-mode-char="(\w+)" data-mode="(\w+)"( checked)?>/g)];
    return [name, { checked: radios.filter(r => r[3]).map(r => r[2]), all: radios.map(r => r[2]) }];
  }));
  const draw = (p) => { const el = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] }; p.bChars(el); return el.innerHTML; };

  it('offers exactly the three choices, in the guild lead\'s words', () => {
    const p = page_();
    expect(p.MODES).toEqual([['show', 'Main / alt'], ['inventory', 'Inventory only'], ['hidden', 'Hide completely']]);
  });

  it('starts each row on what wolfpack.quest already says (website state wins)', () => {
    const p = page_({ S: { chars: CHARS } });
    Object.assign(p.S.modes, p.modesFromAnswer(ANSWER.characters));
    const r = read(draw(p));
    expect(r.Aldenmar.checked).toEqual(['show']);
    expect(r.Brackwyn.checked).toEqual(['inventory']);
    expect(r.Corvale.checked).toEqual(['hidden']);
    for (const c of Object.values(r)) expect(c.all).toEqual(['show', 'inventory', 'hidden']);
  });

  it('the website beats this PC\'s own list when they disagree', () => {
    const p = page_({ S: { chars: CHARS, excluded: new Set(['aldenmar']) } });
    Object.assign(p.S.modes, p.modesFromAnswer(ANSWER.characters));
    expect(read(draw(p)).Aldenmar.checked).toEqual(['show']);
  });

  it('a character the website says nothing about starts on this PC\'s don\'t-send list, else Main / alt — never "Inventory only" by guess', () => {
    const p = page_({ S: { chars: CHARS, excluded: new Set(['corvale']) } });
    const r = read(draw(p));
    expect(r.Corvale.checked).toEqual(['hidden']);
    expect(r.Rethlan.checked, 'dormant, tiny log, 400 days: still Main / alt').toEqual(['show']);
    expect(r.Aldenmar.checked).toEqual(['show']);
  });

  it('a "default" row from the engine adds nothing, and one not on this PC is kept for later without a row', () => {
    const p = page_();
    const m = p.modesFromAnswer([{ name: 'Rethlan', mode: 'show', src: 'default', on_pc: true }, ...ANSWER.characters]);
    expect(m.rethlan).toBeUndefined();
    expect(m.nyssara).toMatchObject({ mode: 'inventory', logRead: null });
    expect(m.corvale).toMatchObject({ mode: 'hidden', logRead: false });
    expect(p.modesFromAnswer(null)).toEqual({});
  });

  it('writes the one-line explanation, and nothing about "Send" any more', () => {
    const html = draw(page_({ S: { chars: CHARS } }));
    expect(html).toContain('Inventory only</b>: kept for your account inventory, left out of every list and chart.');
    expect(html).toContain('Hide completely</b>: Mimic stops reading that log and the website hides it. Same switches as My Stats on wolfpack.quest.');
    expect(html).not.toMatch(/data-tx=|>Send</);
  });

  it('says so under a row only when there is something to say', () => {
    const p = page_();
    expect(p.modeNote(undefined)).toBe('');
    expect(p.modeNote({ mode: 'show', logRead: true })).toBe('');
    expect(p.modeNote({ mode: 'hidden', logRead: false })).toBe('');
    expect(p.modeNote({ mode: 'hidden', logRead: true })).toMatch(/Hidden on wolfpack\.quest, but Mimic still reads this log/);
    expect(p.modeNote({ mode: 'inventory', logRead: false })).toMatch(/Mimic is not reading this log/);
    expect(p.modeNote({ mode: 'custom', logRead: true })).toMatch(/Set up differently on wolfpack\.quest/);
    expect(p.modeNote({ mode: 'hidden', note: 'Saved on this PC. Sign in to sync it with wolfpack.quest.' })).toMatch(/^Saved on this PC\./);
  });

  it('a custom mix leaves every choice unselected', () => {
    const p = page_({ S: { chars: CHARS } });
    p.S.modes.aldenmar = { mode: 'custom', src: 'site', logRead: true, note: '' };
    expect(read(draw(p)).Aldenmar.checked).toEqual([]);
  });

  it('choosing sends it through the bridge, and Hide completely puts the name on the page\'s own don\'t-send set at once', async () => {
    const p = page_({ S: { chars: CHARS } });
    p.setMode('Brackwyn', 'hidden');
    expect(p.calls.set).toEqual([['Brackwyn', 'hidden']]);
    expect(p.S.excluded.has('brackwyn')).toBe(true);
    expect(p.S.modes.brackwyn).toMatchObject({ mode: 'hidden', pending: true });
    await tick();
    expect(p.S.modes.brackwyn).toMatchObject({ mode: 'hidden', src: 'site', pending: false, logRead: false, note: '' });
    p.setMode('Brackwyn', 'show');
    expect(p.S.excluded.has('brackwyn')).toBe(false);
  });

  it('restarts the engine only when main says the list changed', async () => {
    let p = page_({ set: () => ({ ok: true, synced: true, restart_needed: true }) });
    p.setMode('Brackwyn', 'hidden'); await tick();
    expect(p.calls.restart).toBe(1);
    p = page_({ set: () => ({ ok: true, synced: true, restart_needed: false }) });
    p.setMode('Brackwyn', 'inventory'); await tick();
    expect(p.calls.restart).toBe(0);
  });

  it('a choice that stayed on this PC shows the engine\'s own line under the row', async () => {
    const note = 'Saved on this PC. The guild server needs its update before this syncs.';
    const p = page_({ S: { chars: CHARS }, set: () => ({ ok: true, synced: false, reason: 'bot-old', note, restart_needed: false }) });
    p.setMode('Brackwyn', 'inventory'); await tick();
    expect(p.S.modes.brackwyn).toMatchObject({ mode: 'inventory', src: 'local', pending: true, note });
    expect(draw(p)).toContain(note);
  });

  it('a failed save says so and does not claim the choice', async () => {
    const p = page_({ S: { chars: CHARS }, set: () => ({ ok: false, error: 'bad request' }) });
    p.setMode('Brackwyn', 'inventory'); await tick();
    expect(p.S.modes.brackwyn.note).toMatch(/Could not save that/);
  });

  it('clicking the choice a row already shows still reaches the engine (a log hidden on the site that this PC still reads)', () => {
    const p = page_({ S: { chars: CHARS } });
    p.S.modes.corvale = { mode: 'hidden', src: 'site', logRead: true, note: '' };
    const radios = [];
    const el = { innerHTML: '', querySelector: () => null, querySelectorAll: (sel) => sel === '[data-mode]'
      ? [...el.innerHTML.matchAll(/data-mode-char="(\w+)" data-mode="(\w+)"/g)].map(m => { const r = { dataset: { modeChar: m[1], mode: m[2] }, addEventListener: (ev, fn) => radios.push({ ev, fn, ...r.dataset }) }; return r; })
      : [] };
    p.bChars(el);
    const already = radios.filter(r => r.modeChar === 'Corvale' && r.mode === 'hidden');
    expect(already).toHaveLength(1);
    expect(already[0].ev, 'click, not change: a checked radio fires no change').toBe('click');
    already[0].fn();
    expect(p.calls.set).toEqual([['Corvale', 'hidden']]);
  });

  it('asks the engine at most every 15 seconds, repaints only on a change, and keeps a choice in flight', async () => {
    const p = page_({ answer: ANSWER, S: { chars: CHARS, modesAt: 0 } });
    await p.loadModes();
    expect(p.calls.modes).toBe(1);
    expect(p.S.modes.brackwyn.mode).toBe('inventory');
    expect(p.S.excluded.has('corvale')).toBe(true);
    expect(p.calls.changed).toBe(1);
    await p.loadModes();                                  // inside the 15 seconds: no second ask
    expect(p.calls.modes).toBe(1);
    p.S.modesAt = 0; await p.loadModes();                 // an answer that changes nothing repaints nothing
    expect(p.calls.modes).toBe(2);
    expect(p.calls.changed).toBe(1);
    p.S.modeBusy.aldenmar = true; p.S.modes.aldenmar = { mode: 'hidden', src: 'local', pending: true };
    p.S.modesAt = 0; await p.loadModes();
    expect(p.S.modes.aldenmar.mode, 'an answer in flight does not undo what was just clicked').toBe('hidden');
  });

  it('an engine that is not up leaves everything as it was', async () => {
    const p = page_({ answer: { ok: false, reason: 'engine', characters: [] }, S: { chars: CHARS, modesAt: 0 } });
    await p.loadModes();
    expect(p.S.modes).toEqual({});
    expect(p.calls.changed).toBe(0);
  });

  it('the engine coming up, and signing in, both ask again', () => {
    const code = stripJs(script);
    expect(code).toMatch(/S\.agentReady = true;\s+S\.modesAt = 0;/);
    expect(code).toMatch(/if \(!S\.signedIn\) \{ S\.modesAt = 0; S\.modesRetried = false; \}/);
  });

  it('the bridge calls it makes are on window.mimic and name the two handlers main registers', () => {
    const bridge = sliceBlock(preload, "contextBridge.exposeInMainWorld('mimic', {", '\n});');
    expect(stripJs(bridge)).toMatch(/characterModes:\s+\(\)\s+=> ipcRenderer\.invoke\('character-modes-get'\)/);
    expect(stripJs(bridge)).toMatch(/setCharacterMode: \(character, mode\) => ipcRenderer\.invoke\('character-mode-set', String\(character \|\| ''\), String\(mode \|\| ''\)\)/);
    const m = stripJs(main);
    expect(m).toMatch(/ipcMain\.handle\('character-modes-get'/);
    expect(m).toMatch(/ipcMain\.handle\('character-mode-set'/);
  });
});

// The whole page, booted for real against a tiny stub DOM (the preview bridge answers, as in a browser preview).
// Nothing else in the suite boots welcome.html: this is what catches a typo in a path the slices above skip.
describe('the walkthrough boots and opens the characters step, in both layouts', () => {
  function boot(v) {
    const els = {}, clicks = {};
    const mk = (sel) => els[sel] || (els[sel] = { innerHTML: '', dataset: {}, style: {}, querySelector: mk, querySelectorAll: (s) => fromHtml(s), addEventListener() {}, setAttribute() {}, focus() {}, closest: () => null });
    function fromHtml(sel) {   // the elements carrying a data attribute, parsed out of what the page drew
      const m = sel.match(/^\[(data-[\w-]+)\]$/);
      if (!m) return [];
      const html = els['#app'] ? els['#app'].innerHTML : '';
      return [...html.matchAll(new RegExp(m[1] + '="([^"]*)"', 'g'))].map(r => {
        const tag = html.slice(html.lastIndexOf('<', r.index), html.indexOf('>', r.index) + 1);
        const dataset = {};
        for (const a of tag.matchAll(/data-([\w-]+)="([^"]*)"/g)) dataset[a[1].replace(/-(\w)/g, (_, c) => c.toUpperCase())] = a[2];
        return { dataset, addEventListener: (ev, fn) => { if (ev === 'click') clicks[m[1] + '=' + r[1]] = fn; } };
      });
    }
    const document = { body: { dataset: {} }, querySelector: mk, querySelectorAll: fromHtml, addEventListener() {} };
    const window = { scrollTo() {} };
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'location', 'fetch', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'navigator', script.slice(script.indexOf('<script>') + 8))(
      window, document, { search: v === 'b' ? '?v=b' : '?v=a' }, () => Promise.reject(new Error('no engine')), () => 1, () => {}, () => 1, () => {}, {});
    return { els, clicks };
  }
  it.each(['a', 'b'])('layout %s draws every character on the three choices, preselected from the preview\'s website state', async (v) => {
    const { els, clicks } = boot(v);
    await tick(); await tick(); await tick();
    clicks[v === 'a' ? 'data-go=chars' : 'data-ess=chars']();
    await tick();
    const body = (els['#body'] || els['#essBody']).innerHTML;
    const radios = [...body.matchAll(/data-mode-char="(\w+)" data-mode="(\w+)"( checked)?/g)].map(m => m[1] + ':' + m[2] + (m[3] ? '*' : ''));
    expect(radios).toEqual([
      'Aldenmar:show*', 'Aldenmar:inventory', 'Aldenmar:hidden',
      'Brackwyn:show', 'Brackwyn:inventory*', 'Brackwyn:hidden',
      'Corvale:show', 'Corvale:inventory', 'Corvale:hidden*',
    ]);
  });
});

// ── 4. the dashboard's Me card ──────────────────────────────────────────────
describe('the dashboard\'s per-character control (tray ↔ dashboard parity: the same choice after onboarding)', () => {
  const ctl = sliceBlock(dash, "var WP_MODES = [['show'", "}).catch(function () { wpModeSay('Could not reach the engine. Try again.', 'var(--red)'); });\n}\n");
  const MODES = [
    { name: 'Aldenmar', mode: 'show', src: 'site', pending: false, log_read: true },
    { name: 'Brackwyn', mode: 'inventory', src: 'site', pending: false, log_read: true },
    { name: 'Corvale', mode: 'hidden', src: 'local', pending: false, log_read: false },     // not read here: not in Watched characters
    { name: 'Rethlan', mode: 'hidden', src: 'site', pending: false, log_read: true },        // hidden on the site, still read here
    { name: 'Nyssara', mode: 'inventory', src: 'local', pending: true, log_read: true },     // saved on this PC only
    { name: 'Zarrin', mode: 'custom', src: 'site', pending: false, log_read: true },
  ];
  function build({ mimic, fetchImpl } = {}) {
    const calls = { refresh: 0, relaunch: 0, fetch: [] };
    const env = {
      esc: (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]),
      wpKeep: (k) => 'data-keep="' + k + '"',
      refresh: () => { calls.refresh++; },
      window: mimic ? { mimic: { ...mimic, relaunchAgent: () => { calls.relaunch++; } } } : {},
      fetch: (url, init) => { calls.fetch.push([url, JSON.parse(init.body)]); return Promise.resolve({ json: async () => fetchImpl() }); },
    };
    // eslint-disable-next-line no-new-func
    const api = new Function(...Object.keys(env), ctl + '\nreturn { WP_MODES, wpModeNote, wpModesHtml, wpSetCharacterMode, msg: () => _wpModeMsg };')(...Object.values(env));
    return { ...api, calls };
  }
  const buttons = (html, name) => [...html.matchAll(new RegExp('class="wp-mode( on)?( hide)?(?: on)?" data-char="' + name + '" data-mode="(\\w+)"', 'g'))];

  it('lists every character on this PC, the one it no longer reads included, each on the mode it shows', () => {
    const html = build().wpModesHtml(MODES);
    const on = (n) => [...html.matchAll(new RegExp('class="wp-mode[^"]*\\bon\\b[^"]*" data-char="' + n + '" data-mode="(\\w+)"', 'g'))].map(m => m[1]);
    expect(on('Aldenmar')).toEqual(['show']);
    expect(on('Brackwyn')).toEqual(['inventory']);
    expect(on('Corvale')).toEqual(['hidden']);
    expect(on('Zarrin'), 'a custom mix selects nothing').toEqual([]);
    for (const m of MODES) expect(buttons(html, m.name).map(b => b[3])).toEqual(['show', 'inventory', 'hidden']);
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('(6)');
  });

  it('is a <details> that keeps its open state (wpKeep), and byte-stable between polls', () => {
    const d = build();
    const a = d.wpModesHtml(MODES);
    expect(a).toMatch(/^<details data-keep="me-char-modes"/);
    expect(d.wpModesHtml(MODES)).toBe(a);
    expect(build().wpModesHtml(MODES)).toBe(a);
  });

  it('writes the same explanation as the walkthrough', () => {
    const html = build().wpModesHtml(MODES);
    expect(html).toContain('<b>Inventory only</b>: kept for your account inventory, left out of every list and chart.');
    expect(html).toContain('<b>Hide completely</b>: Mimic stops reading that log and the website hides it. Same switches as My Stats on wolfpack.quest.');
  });

  it('notes the three states that need one, and nothing else', () => {
    const d = build();
    expect(d.wpModeNote(MODES[0])).toBe('');
    expect(d.wpModeNote(MODES[2])).toBe('');
    expect(d.wpModeNote(MODES[1])).toBe('');
    expect(d.wpModeNote(MODES[3])).toBe('hidden on wolfpack.quest, log still read here');
    expect(d.wpModeNote(MODES[4])).toBe('saved on this PC only');
    expect(d.wpModeNote({ mode: 'show', log_read: false })).toBe('log not read on this PC');
    expect(d.wpModeNote(MODES[5])).toBe('set differently on wolfpack.quest');
  });

  it('escapes a name', () => {
    expect(build().wpModesHtml([{ name: '<b>x</b>', mode: 'show', log_read: true }])).not.toContain('<b>x</b>');
  });

  it('under Mimic the click goes through the bridge, and restarts the engine once when main says to', async () => {
    vi.useFakeTimers();
    try {
      const sets = [];
      const d = build({ mimic: { setCharacterMode: (n, m) => { sets.push([n, m]); return Promise.resolve({ ok: true, synced: true, restart_needed: true }); } } });
      d.wpSetCharacterMode('Aldenmar', 'hidden'); d.wpSetCharacterMode('Brackwyn', 'hidden');
      await vi.advanceTimersByTimeAsync(0);
      expect(sets).toEqual([['Aldenmar', 'hidden'], ['Brackwyn', 'hidden']]);
      expect(d.calls.fetch, 'not the plain-browser path').toHaveLength(0);
      expect(d.calls.relaunch).toBe(0);
      await vi.advanceTimersByTimeAsync(2600);
      expect(d.calls.relaunch, 'one restart after the clicking stops').toBe(1);
      expect(d.msg().text).toMatch(/Brackwyn: Hide completely\. Synced with wolfpack\.quest\. Mimic restarts its engine in a moment to stop reading that log\./);
      expect(d.calls.refresh).toBeGreaterThan(0);
    } finally { vi.useRealTimers(); }
  });

  it('in a plain browser it posts to the engine and says the log is still read', async () => {
    const d = build({ fetchImpl: () => ({ ok: true, synced: false, note: 'Saved on this PC. Sign in to sync it with wolfpack.quest.' }) });
    d.wpSetCharacterMode('Aldenmar', 'hidden');
    await tick(); await tick();
    expect(d.calls.fetch).toEqual([['/api/character-mode', { character: 'Aldenmar', mode: 'hidden' }]]);
    expect(d.msg().text).toContain('Saved on this PC. Sign in to sync it with wolfpack.quest.');
    expect(d.msg().text).toContain('list it in WOLFPACK_EXCLUDED_CHARS');
    expect(d.calls.relaunch).toBe(0);
  });

  it('a failure says so', async () => {
    const d = build({ mimic: { setCharacterMode: () => Promise.resolve({ ok: false }) } });
    d.wpSetCharacterMode('Aldenmar', 'show'); await tick();
    expect(d.msg().text).toMatch(/Could not save that for Aldenmar/);
    const e = build({ mimic: { setCharacterMode: () => Promise.reject(new Error('x')) } });
    e.wpSetCharacterMode('Aldenmar', 'show'); await tick(); await tick();
    expect(e.msg().text).toMatch(/Could not reach the engine/);
  });

  it('is wired into the Me card and a click on a choice', () => {
    const d = stripJs(dash);
    expect(d).toMatch(/const charModes = Array\.isArray\(s\.characterModes\) \? s\.characterModes : \[\];\s+if \(charModes\.length > 0\) h \+= wpModesHtml\(charModes\);/);
    expect(d).toMatch(/closest\('\.wp-mode'\)/);
    expect(d).toMatch(/wpSetCharacterMode\(b\.dataset\.char, b\.dataset\.mode\);/);
  });
});
