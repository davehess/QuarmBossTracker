// test/raid-fights-history.test.js — DPS HUD → History → "Raid" (the guild lead, 2026-11-01: "B, and merged after each fight ends").
//
// History gets a Mine / Raid switch. Mine is the ring this machine's own log filled, untouched. Raid is every fight the
// guild uploaded tonight, each once, read from the bot's GET /api/agent/raid-fights through the agent's own
// GET /api/raid-fights (the list) and GET /api/raid-fights/board (one fight's numbers: the /live-damage call History's
// "synced" already makes). Two tiers:
//   • the agent runs for real: the bot is asked at most every 30 s, an older bot (404) is left alone for ten minutes, a
//     failed read keeps the list we had, a board is kept 5 minutes (30 s when empty), and the local routes answer;
//   • the overlay's whole script runs against a small fake DOM: what it fetches and when, what the switch remembers, what
//     a row shows and what a click does. Names are invented (conventions, not people).
//
// Run: npx vitest run test/raid-fights-history.test.js

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import http from 'node:http';
import path from 'node:path';
import { readSource, ROOT, stripJs, stripCss } from './_source-slice.js';

const agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');
const html = readSource(path.join(ROOT, 'apps', 'mimic', 'overlay.html'));
const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

const BOT = 'https://bot.example/api/agent/encounter';
const T0 = 1_790_000_000_000;
const iso = (ms) => new Date(ms).toISOString();
const botFight = (id, name, endedAgoMs, durS, extra) => ({
  id, name, npc_id: 1000 + id.length, started_at: iso(T0 - endedAgoMs - durS * 1000), ended_at: iso(T0 - endedAgoMs),
  duration_s: durS, wipe: false, clients: 7, players: 20, top_dps: 410, ...extra,
});
const FIGHTS = [botFight('f2', 'Lord Vyemm', 6 * 60_000, 212), botFight('f1', 'Lord Nagafen', 70 * 60_000, 95, { clients: 1 })];
const json = (o, ok = true, status = 200) => ({ ok, status, json: async () => o });

// ── the agent ────────────────────────────────────────────────────────────────
describe('agent: the raid fights list', () => {
  let calls;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    agent._resetRaidFightsForTest();
    calls = [];
    agent._setUploadOptsForTest({ botUrl: BOT, token: 't0k', dryRun: false });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); agent._setUploadOptsForTest(null); });
  const bot = (impl) => vi.stubGlobal('fetch', vi.fn(async (url, init) => { calls.push({ url: String(url), init }); return impl(String(url)); }));

  it('asks the bot for the last 8 hours with the agent token, and hands back only the fields the overlay reads', async () => {
    bot(() => json({ fights: [{ ...FIGHTS[0], secret: 'x' }] }));
    const out = await agent._raidFightsList(T0);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://bot.example/api/agent/raid-fights?since=' + encodeURIComponent(iso(T0 - 8 * 3600_000)));
    expect(calls[0].init.headers.Authorization).toBe('Bearer t0k');
    expect(out.state).toBe('ok');
    expect(out.fights).toHaveLength(1);
    expect(out.fights[0]).toMatchObject({ id: 'f2', name: 'Lord Vyemm', duration_s: 212, clients: 7, wipe: false });
    expect(out.fights[0].secret).toBeUndefined();
  });

  it('the bot is asked at most every 30 seconds, however often the overlay polls', async () => {
    bot(() => json({ fights: FIGHTS }));
    await agent._raidFightsList(T0);
    await agent._raidFightsList(T0 + 1_000);
    await agent._raidFightsList(T0 + 29_000);
    expect(calls).toHaveLength(1);
    await agent._raidFightsList(T0 + 30_000);
    expect(calls).toHaveLength(2);
  });

  it('two polls at once share one request', async () => {
    bot(() => json({ fights: FIGHTS }));
    const [a, b] = await Promise.all([agent._raidFightsList(T0), agent._raidFightsList(T0)]);
    expect(calls).toHaveLength(1);
    expect(a.fights).toHaveLength(2);
    expect(b.fights).toHaveLength(2);
  });

  it('an older bot (404) is "old_bot" and is left alone for ten minutes, not asked on every poll', async () => {
    bot(() => json({}, false, 404));
    expect((await agent._raidFightsList(T0)).state).toBe('old_bot');
    await agent._raidFightsList(T0 + 60_000);
    await agent._raidFightsList(T0 + 9 * 60_000);
    expect(calls).toHaveLength(1);
    await agent._raidFightsList(T0 + 10 * 60_000);
    expect(calls).toHaveLength(2);
  });

  it('a failed read keeps the list it had and says "error"; the next try is in 30 s', async () => {
    let n = 0;
    bot(() => (n++ === 0 ? json({ fights: FIGHTS }) : json({}, false, 500)));
    await agent._raidFightsList(T0);
    const out = await agent._raidFightsList(T0 + 30_000);
    expect(out.state).toBe('error');
    expect(out.fights).toHaveLength(2);
    let m = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { m++; throw new Error('offline'); }));
    const out2 = await agent._raidFightsList(T0 + 60_000);
    expect([out2.state, out2.fights.length, m]).toEqual(['error', 2, 1]);
  });

  it('unsigned in, or a dry run: "offline", and the bot is not asked', async () => {
    bot(() => json({ fights: FIGHTS }));
    agent._setUploadOptsForTest({ botUrl: BOT, token: '', dryRun: false });
    expect(await agent._raidFightsList(T0)).toEqual({ state: 'offline', fights: [] });
    agent._setUploadOptsForTest({ botUrl: BOT, token: 't0k', dryRun: true });
    expect((await agent._raidFightsList(T0)).state).toBe('offline');
    expect(calls).toHaveLength(0);
  });

  it('drops rows with no id, name or start, and keeps at most 60', async () => {
    const many = Array.from({ length: 70 }, (_, i) => botFight('x' + i, 'Mob ' + i, i * 1000, 30));
    bot(() => json({ fights: [{ name: 'no id', started_at: iso(T0) }, ...many] }));
    const out = await agent._raidFightsList(T0);
    expect(out.fights).toHaveLength(60);
    expect(out.fights[0].id).toBe('x0');
  });
});

describe('agent: one raid fight\'s board', () => {
  let calls;
  const START = iso(T0 - 300_000);
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    agent._resetRaidFightsForTest();
    calls = [];
    agent._setUploadOptsForTest({ botUrl: BOT, token: 't0k', dryRun: false });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); agent._setUploadOptsForTest(null); });
  const bot = (impl) => vi.stubGlobal('fetch', vi.fn(async (url, init) => { calls.push({ url: String(url), init }); return impl(String(url)); }));
  const BOARD = { boss: 'Lord Vyemm', players: [{ character: 'Aldenmar', dmg: 5000 }, { character: 'Brackwyn', dmg: 3000 }], uploaders: 7, total: 8000 };

  it('is the /live-damage call History already makes: this boss, this fight\'s start', async () => {
    bot(() => json(BOARD));
    const b = await agent._raidFightBoard('Lord Vyemm', START, T0);
    expect(calls[0].url).toBe('https://bot.example/api/agent/live-damage?boss=Lord%20Vyemm&fight_start=' + encodeURIComponent(START));
    expect(calls[0].init.headers.Authorization).toBe('Bearer t0k');
    expect(b).toMatchObject({ state: 'ok', boss: 'Lord Vyemm', uploaders: 7, total: 8000 });
    expect(b.players).toHaveLength(2);
  });

  it('a board with numbers is kept five minutes; one that came back empty is asked again after 30 s', async () => {
    bot(() => json(BOARD));
    await agent._raidFightBoard('Lord Vyemm', START, T0);
    await agent._raidFightBoard('lord vyemm', START, T0 + 4 * 60_000);
    expect(calls).toHaveLength(1);
    await agent._raidFightBoard('Lord Vyemm', START, T0 + 5 * 60_000);
    expect(calls).toHaveLength(2);
    calls.length = 0;
    bot(() => json({ boss: 'Nagafen', players: [], uploaders: 0, total: 0 }));
    const e = await agent._raidFightBoard('Lord Nagafen', START, T0);
    expect(e.players).toEqual([]);          // nothing invented
    await agent._raidFightBoard('Lord Nagafen', START, T0 + 29_000);
    expect(calls).toHaveLength(1);
    await agent._raidFightBoard('Lord Nagafen', START, T0 + 30_000);
    expect(calls).toHaveLength(2);
  });

  it('an older bot or a failed read is an empty board with its state, never a throw', async () => {
    bot(() => json({}, false, 404));
    expect(await agent._raidFightBoard('Lord Vyemm', START, T0)).toMatchObject({ state: 'old_bot', players: [] });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await agent._raidFightBoard('Lord Nagafen', START, T0)).toMatchObject({ state: 'error', players: [] });
  });

  it('a missing boss or a start that is not a time is refused without asking the bot', async () => {
    bot(() => json(BOARD));
    expect((await agent._raidFightBoard('', START, T0)).state).toBe('bad');
    expect((await agent._raidFightBoard('Lord Vyemm', 'soon', T0)).state).toBe('bad');
    expect((await agent._raidFightBoard('Lord Vyemm', null, T0)).state).toBe('bad');
    expect(calls).toHaveLength(0);
  });
});

describe('agent: the local routes', () => {
  let server, port;
  const get = (p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p }, r => {
    let d = ''; r.on('data', c => { d += c; }); r.on('end', () => res({ status: r.statusCode, body: JSON.parse(d) }));
  }).on('error', rej));
  beforeAll(async () => {
    const orig = http.createServer;
    http.createServer = function (...a) { server = orig.apply(this, a); return server; };
    try { agent.startWebDashboard(0); } finally { http.createServer = orig; }
    await new Promise(r => server.once('listening', r));
    port = server.address().port;
  });
  afterAll(() => new Promise(r => server.close(r)));
  beforeEach(() => {
    agent._resetRaidFightsForTest();
    agent._setUploadOptsForTest({ botUrl: BOT, token: 't0k', dryRun: false });
    // The agent's own server is on real http: only the bot's address is faked.
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url) => (String(url).startsWith('https://bot.example')
      ? (String(url).includes('/raid-fights') ? json({ fights: FIGHTS }) : json({ boss: 'Lord Vyemm', players: [{ character: 'Aldenmar', dmg: 9 }], uploaders: 3, total: 9 }))
      : real(url))));
  });
  afterEach(() => { vi.unstubAllGlobals(); agent._setUploadOptsForTest(null); });

  it('GET /api/raid-fights is {state, fights}', async () => {
    const { status, body } = await get('/api/raid-fights');
    expect(status).toBe(200);
    expect(body.state).toBe('ok');
    expect(body.fights.map(f => f.name)).toEqual(['Lord Vyemm', 'Lord Nagafen']);
  });

  it('GET /api/raid-fights/board?boss=&fight_start= is that fight\'s numbers', async () => {
    const { status, body } = await get('/api/raid-fights/board?boss=Lord%20Vyemm&fight_start=' + encodeURIComponent(iso(T0)));
    expect(status).toBe(200);
    expect(body).toMatchObject({ state: 'ok', boss: 'Lord Vyemm', uploaders: 3 });
    expect(body.players).toEqual([{ character: 'Aldenmar', dmg: 9 }]);
    expect((await get('/api/raid-fights/board?boss=Lord%20Vyemm')).body.state).toBe('bad');
  });
});

// ── the overlay ──────────────────────────────────────────────────────────────
function fakeEl(id) {
  const L = {}, on = new Set();
  return {
    id, innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, clientWidth: 300,
    classList: { add: (c) => on.add(c), remove: (c) => on.delete(c), contains: (c) => on.has(c), toggle: (c, v) => { const x = v === undefined ? !on.has(c) : !!v; if (x) on.add(c); else on.delete(c); return x; } },
    addEventListener(t, f) { (L[t] || (L[t] = [])).push(f); },
    fire(t, e) { (L[t] || []).forEach((f) => f(e || {})); },
  };
}
// `agentSays` maps a URL to a response; every URL asked is recorded.
function runPage({ stored = {}, mini = false, list = { state: 'ok', fights: FIGHTS }, board = () => ({ players: [], uploaders: 0, total: 0 }) } = {}) {
  const els = new Map();
  const el = (id) => { if (!els.has(id)) els.set(id, fakeEl(id)); return els.get(id); };
  const body = fakeEl('body-tag');
  if (mini) body.classList.add('wp-mini');
  const urls = [];
  const document = { body, getElementById: el, querySelector: (s) => el('q:' + s), addEventListener() {}, createElement: () => fakeEl('x') };
  const window = { addEventListener() {}, mimic: { autoFitOverlay() {}, overlayHoverInteractive() {} } };
  const localStorage = { getItem: (k) => (k in stored ? stored[k] : null), setItem: (k, v) => { stored[k] = v; } };
  const state = { activeCharacter: 'Corvale', currentEncounterThreat: null };
  const fetch = async (u) => {
    urls.push(u);
    if (/\/api\/raid-fights\/board/.test(u)) return json(board(u));
    if (/\/api\/raid-fights/.test(u)) return json(list);
    if (/\/api\/fight-history/.test(u)) return json({ rev: 'r.1', fights: [] });
    return json(state);
  };
  const api = new Function('window', 'document', 'localStorage', 'fetch', 'setInterval', 'navigator',
    script + '\n;return { tick: tick };')(window, document, localStorage, fetch, () => 0, {});
  const raidUrls = () => urls.filter((u) => /raid-fights/.test(u));
  // A click on whatever `sel` the handler asks closest() for, carrying these attributes.
  const clickList = (cls, attrs) => {
    const node = { getAttribute: (a) => (a in attrs ? attrs[a] : null) };
    el('histList').fire('click', { target: { closest: (sel) => (sel === cls ? node : null) } });
  };
  return { api, el, body, urls, raidUrls, stored, clickList };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const HISTORY = { 'wp.damageTabMode': 'history' };
const BOARD = (u) => ({ boss: 'x', players: [{ character: 'Aldenmar', dmg: 6000 }, { character: 'Brackwyn', dmg: 2000 }], uploaders: 7, total: 8000, _u: u });
afterEach(() => { vi.useRealTimers(); });
const fakeNow = () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T0); };

describe('overlay: the Mine / Raid switch', () => {
  it('Mine is the default and is exactly today\'s list: the ring is read, the raid routes are not, and the switch is the first row', async () => {
    fakeNow();
    const p = runPage({ stored: { ...HISTORY } });
    await flush();
    expect(p.raidUrls()).toEqual([]);
    expect(p.urls.some((u) => /fight-history/.test(u))).toBe(true);
    const list = p.el('histList').innerHTML;
    expect(list.startsWith('<li class="histsw">')).toBe(true);
    expect(list).toContain('class="tab hsw on" data-src="mine"');
    expect(list).not.toContain('class="tab hsw on" data-src="raid"');
  });

  it('Raid is read only while History is on screen: not on DPS or Tank, not on a mini', async () => {
    fakeNow();
    for (const mode of ['dps', 'tank', 'trend']) {
      const p = runPage({ stored: { 'wp.damageTabMode': mode, 'wp.histSource': 'raid' } });
      await flush();
      expect(p.raidUrls(), mode).toEqual([]);
    }
    const m = runPage({ stored: { ...HISTORY, 'wp.histSource': 'raid' }, mini: true });
    await flush();
    expect(m.raidUrls()).toEqual([]);
  });

  it('with Raid kept from last time it lists the guild\'s fights: name, "m:ss · Nm ago", "N clients"', async () => {
    fakeNow();
    const p = runPage({ stored: { ...HISTORY, 'wp.histSource': 'raid' }, board: BOARD });
    await flush();
    const list = p.el('histList').innerHTML;
    expect(list).toContain('class="tab hsw on" data-src="raid"');
    expect(list).toContain('data-rid="f2"');
    expect(list).toContain('>Lord Vyemm<');
    expect(list).toContain('3:32 · 6m ago');
    expect(list).toContain('7 clients');
    expect(list).toContain('1:35 · 1h ago');
    expect(list).toContain('1 client<');           // singular
    expect(list).not.toContain('class="hitem on" data-rid="f1"');
    expect(list).toContain('class="hitem on" data-rid="f2"');   // the newest is on screen until another is picked
  });

  it('shows the picked fight\'s board from the guild\'s merged numbers, with the client count in the title', async () => {
    fakeNow();
    const p = runPage({ stored: { ...HISTORY, 'wp.histSource': 'raid' }, board: BOARD });
    await flush();
    const asked = p.raidUrls().find((u) => /board/.test(u));
    expect(asked).toBe('http://127.0.0.1:7779/api/raid-fights/board?boss=Lord%20Vyemm&fight_start=' + encodeURIComponent(FIGHTS[0].started_at));
    const deeps = p.el('deeps').innerHTML;
    expect(deeps).toContain('Aldenmar');
    expect(deeps).toContain('Brackwyn');
    expect(deeps).not.toContain('class="obs">0<');           // no "what this machine saw" on a fight it may not have been in
    expect(p.el('boss-name').textContent).toBe('Lord Vyemm · 7 clients');
  });

  it('clicking another Raid row shows that fight and asks for its board', async () => {
    fakeNow();
    const p = runPage({ stored: { ...HISTORY, 'wp.histSource': 'raid' }, board: BOARD });
    await flush();
    p.clickList('.hitem', { 'data-rid': 'f1' });
    await flush();
    expect(p.raidUrls().some((u) => /board\?boss=Lord%20Nagafen&fight_start=/.test(u))).toBe(true);
    expect(p.el('histList').innerHTML).toContain('class="hitem on" data-rid="f1"');
    expect(p.el('boss-name').textContent).toContain('Lord Nagafen');
  });

  it('a board with no numbers says so, and invents nothing', async () => {
    fakeNow();
    const p = runPage({ stored: { ...HISTORY, 'wp.histSource': 'raid' } });
    await flush();
    expect(p.el('empty').textContent).toBe('no numbers for this fight yet');
    expect(p.el('deeps').innerHTML).toBe('');
  });

  it('an older bot is a quiet line, not an error', async () => {
    fakeNow();
    const p = runPage({ stored: { ...HISTORY, 'wp.histSource': 'raid' }, list: { state: 'old_bot', fights: [] } });
    await flush();
    expect(p.el('empty').textContent).toBe('Raid list needs the newer bot');
    expect(p.el('conn').className).toBe('conn ok');
    expect(p.el('histList').innerHTML).toContain('data-src="mine"');         // the way back is still there
  });

  it('the switch remembers its choice and flips the list; Mine goes back to the ring', async () => {
    fakeNow();
    const p = runPage({ stored: { ...HISTORY }, board: BOARD });
    await flush();
    expect(p.raidUrls()).toEqual([]);
    p.clickList('.hsw', { 'data-src': 'raid' });
    await flush();
    expect(p.stored['wp.histSource']).toBe('raid');
    expect(p.raidUrls().length).toBeGreaterThan(0);
    expect(p.el('histList').innerHTML).toContain('data-rid="f2"');
    const before = p.urls.filter((u) => /fight-history/.test(u)).length;
    p.clickList('.hsw', { 'data-src': 'mine' });
    await flush();
    expect(p.stored['wp.histSource']).toBe('mine');
    expect(p.urls.filter((u) => /fight-history/.test(u)).length).toBeGreaterThan(before);
    expect(p.el('histList').innerHTML).not.toContain('data-rid=');
  });

  it('a mob name cannot break out of a Raid row', async () => {
    fakeNow();
    const p = runPage({ stored: { ...HISTORY, 'wp.histSource': 'raid' }, list: { state: 'ok', fights: [botFight('f9', '<img src=x>', 60_000, 30)] } });
    await flush();
    expect(p.el('histList').innerHTML).not.toContain('<img');
  });
});

describe('overlay: the switch meets the checklist', () => {
  const js = stripJs(html);
  const css = stripCss(html.slice(html.indexOf('<style>'), html.indexOf('</style>')));
  it('the switch rows are real <button>s inside the list whose mouseenter/leave arms the locked window', () => {
    expect(js).toContain('<button type="button" class="tab hsw');
    expect(js).toContain('[tabDpsBtn, tabTankBtn, tabHistBtn, histListEl].forEach');
    expect(css).toMatch(/\.histlist > li\.histsw\{display:flex/);
  });
  it('Raid is read in one place of the tick, and its routes are asked only from there', () => {
    expect(js).toMatch(/var _raidShown = TAB_MODE === 'history' && HIST_SRC === 'raid' && !document\.body\.classList\.contains\('wp-mini'\);/);
    expect(js).toMatch(/if \(_raidShown\) \{\s*RAIDLIST = await _raidFights\(\);/);
    expect(js.match(/_raidFights\(\)/g)).toHaveLength(2);                      // the definition and that one call
    expect(js.match(/\/api\/raid-fights/g)).toHaveLength(2);                   // the list and the board
  });
});
