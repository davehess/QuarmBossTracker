// test/my-parses-tab.test.js — the dashboard's 📈 My parses tab (a member asked, 2026-10-06, "is there a page in
// mimic that'll graph out my parses over a variable time window"; the guild lead picked this tab plus a page
// on wolfpack.quest).
//
// Three pieces, each run for real:
//   1. the agent's /api/my-parses proxy — the param whitelist, the signed-out path that makes NO call, the
//      5-minute copy, and the route over HTTP (fetch is stubbed; nothing leaves the machine);
//   2. the dashboard's chart + table + tab, sliced out of dashboard.html and evaluated (the chart is a pure
//      function of the answer; the tab's asking logic runs against a stub fetch);
//   3. Mimic's side — the tray item, showDashboardTab, navigateToDashboard's hash, and the open-external
//      allow-list the links depend on (it must NOT be widened for this).
//
// Names in the fixtures are invented. Run: npx vitest run test/my-parses-tab.test.js
// (Not test/my-parses.test.js: that name is the bot route's test on main, and sync-beta would collide.)

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import http from 'node:http';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');
const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const MAIN = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const tick = () => new Promise(r => setTimeout(r, 0));

// ── 1. the agent proxy ──────────────────────────────────────────────────────
describe('the agent proxy: what it forwards', () => {
  it('lets a known window, scope and plain character name through', () => {
    expect(agent._myParsesParams('/api/my-parses?w=30d&scope=all&char=Brackwyn'))
      .toEqual({ w: '30d', scope: 'all', char: 'Brackwyn', fresh: false });
    for (const w of ['1d', '7d', '30d', '90d', 'exp', 'life']) expect(agent._myParsesParams('/x?w=' + w).w).toBe(w);
    expect(agent._myParsesParams('/x?w=EXP&scope=ALL').w, 'case does not matter').toBe('exp');
  });

  it('falls back to 1 week + Bosses for anything it does not recognise, and drops a character that is not a plain name', () => {
    expect(agent._myParsesParams('/api/my-parses')).toEqual({ w: '7d', scope: 'bosses', char: '', fresh: false });
    expect(agent._myParsesParams('/x?w=forever&scope=%3Cscript%3E')).toMatchObject({ w: '7d', scope: 'bosses' });
    for (const bad of ['Brack%20wyn', 'Brack%26w%3D1d', '..%2F..', 'a%27b', '%E2%98%83', 'Abcdefghijklmnopqrstuvwxyz1', '']) {
      expect(agent._myParsesParams('/x?char=' + bad).char, bad).toBe('');
    }
  });

  it('fresh is only ever the exact value 1', () => {
    expect(agent._myParsesParams('/x?fresh=1').fresh).toBe(true);
    for (const v of ['0', 'true', 'yes', '']) expect(agent._myParsesParams('/x?fresh=' + v).fresh, v).toBe(false);
  });

  it('survives a URL that does not parse', () => {
    expect(agent._myParsesParams(undefined)).toEqual({ w: '7d', scope: 'bosses', char: '', fresh: false });
    expect(agent._myParsesParams('http://[')).toMatchObject({ w: '7d' });
  });
});

describe('the agent proxy: asking the guild server', () => {
  const BOT = 'https://bot.example/api/agent/encounter';
  const T0 = 1_790_000_000_000;
  const ANSWER = { window: { key: '7d', label: 'Last 7 days', since: '2026-09-29T00:00:00Z' }, scope: 'bosses', total: 1, truncated: false,
    characters: [{ name: 'Brackwyn', class: 'Cleric', active: true }], fights: [{ t: '2026-10-04T01:17:00Z', eid: 'e1', name: 'Aten Ha Ra', boss: true, char: 'Brackwyn', dps: 189, rank: 2, usual: 168 }], nights: [] };
  let calls, reply;
  const P = (o) => ({ w: '7d', scope: 'bosses', char: '', fresh: false, ...o });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T0);
    agent._resetMyParsesForTest();
    calls = [];
    reply = () => ({ ok: true, status: 200, json: async () => ANSWER });
    vi.stubGlobal('fetch', vi.fn(async (url, init) => { calls.push({ url: String(url), init }); return reply(); }));
    agent._setUploadOptsForTest({ botUrl: BOT, token: 't0k', dryRun: false });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); agent._setUploadOptsForTest(null); });

  it('local mode — no token — answers signed_out and makes NO call', async () => {
    agent._setUploadOptsForTest({ botUrl: BOT, token: null, dryRun: false });
    expect(await agent.fetchMyParses(P())).toEqual({ error: 'signed_out' });
    expect(calls).toHaveLength(0);
  });

  it('before main() has run (no options at all), and in a dry run, the same: nothing is asked', async () => {
    agent._setUploadOptsForTest(null);
    expect(await agent.fetchMyParses(P())).toEqual({ error: 'signed_out' });
    agent._setUploadOptsForTest({ botUrl: BOT, token: 't0k', dryRun: true });
    expect(await agent.fetchMyParses(P())).toEqual({ error: 'signed_out' });
    expect(calls).toHaveLength(0);
  });

  it('asks the bot\'s /my-parses with the chosen window, scope and character, as the signed-in raider', async () => {
    const out = await agent.fetchMyParses(P({ w: '30d', scope: 'all', char: 'Brackwyn' }));
    expect(out).toEqual(ANSWER);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://bot.example/api/agent/my-parses?w=30d&scope=all&char=Brackwyn');
    expect(calls[0].init.headers.Authorization).toBe('Bearer t0k');
    expect(calls[0].init.signal, 'a stuck server cannot hold the tab forever').toBeTruthy();
  });

  it('sends no char for "All", and never forwards fresh', async () => {
    await agent.fetchMyParses(P());
    await agent.fetchMyParses(P({ w: '1d', fresh: true }));
    expect(calls.map(c => c.url)).toEqual([
      'https://bot.example/api/agent/my-parses?w=7d&scope=bosses',
      'https://bot.example/api/agent/my-parses?w=1d&scope=bosses',
    ]);
  });

  it('401 is signed_out; an old bot (404), a bad minute (500), garbage, and a dead network are all unavailable', async () => {
    reply = () => ({ ok: false, status: 401, json: async () => ({}) });
    expect(await agent.fetchMyParses(P())).toEqual({ error: 'signed_out' });
    reply = () => ({ ok: false, status: 404, json: async () => ({}) });
    expect(await agent.fetchMyParses(P())).toEqual({ error: 'unavailable' });
    reply = () => ({ ok: false, status: 500, json: async () => ({}) });
    expect(await agent.fetchMyParses(P())).toEqual({ error: 'unavailable' });
    reply = () => ({ ok: true, status: 200, json: async () => ({ hello: 'world' }) });
    expect(await agent.fetchMyParses(P())).toEqual({ error: 'unavailable' });
    reply = () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } });
    expect(await agent.fetchMyParses(P())).toEqual({ error: 'unavailable' });
    reply = () => { throw new Error('ECONNRESET'); };
    expect(await agent.fetchMyParses(P())).toEqual({ error: 'unavailable' });
  });

  it('a miss is never kept: signing in, or the server coming back, and the next ask goes through at once', async () => {
    const misses = [
      () => ({ ok: false, status: 401, json: async () => ({}) }),
      () => ({ ok: false, status: 500, json: async () => ({}) }),
      () => ({ ok: true, status: 200, json: async () => ({ hello: 'world' }) }),
      () => { throw new Error('ECONNRESET'); },
    ];
    for (const [i, miss] of misses.entries()) {
      reply = miss;
      const before = calls.length;
      expect(await agent.fetchMyParses(P())).toHaveProperty('error');
      reply = () => ({ ok: true, status: 200, json: async () => ANSWER });
      expect(await agent.fetchMyParses(P()), 'miss #' + i).toEqual(ANSWER);
      expect(calls.length - before, 'miss #' + i + ' was asked, then the good ask was asked').toBe(2);
      agent._resetMyParsesForTest();
    }
  });

  it('keeps a good answer for 5 minutes per (window, scope, character), then asks again', async () => {
    expect(agent.MY_PARSES_TTL_MS).toBe(5 * 60_000);
    await agent.fetchMyParses(P());
    vi.setSystemTime(T0 + 4 * 60_000 + 59_000);
    await agent.fetchMyParses(P());
    expect(calls, 'inside the 5 minutes: from the copy').toHaveLength(1);
    await agent.fetchMyParses(P({ char: 'Brackwyn' }));
    await agent.fetchMyParses(P({ w: '30d' }));
    await agent.fetchMyParses(P({ scope: 'all' }));
    expect(calls, 'each of those is its own key').toHaveLength(4);
    vi.setSystemTime(T0 + 5 * 60_000 + 1_000);
    await agent.fetchMyParses(P());
    expect(calls, 'past 5 minutes: asked again').toHaveLength(5);
  });

  it('the character in the key does not care about case', async () => {
    await agent.fetchMyParses(P({ char: 'Brackwyn' }));
    await agent.fetchMyParses(P({ char: 'brackwyn' }));
    expect(calls).toHaveLength(1);
  });

  it('two asks at the same moment share one request', async () => {
    const [a, b] = await Promise.all([agent.fetchMyParses(P()), agent.fetchMyParses(P())]);
    expect(calls).toHaveLength(1);
    expect(a).toEqual(b);
  });

  it('fresh (the ↻ button) skips the copy, but never closer together than 15 seconds', async () => {
    expect(agent.MY_PARSES_FRESH_MIN_MS).toBe(15_000);
    await agent.fetchMyParses(P());
    vi.setSystemTime(T0 + 10_000);
    await agent.fetchMyParses(P({ fresh: true }));
    expect(calls, 'a held-down ↻ is not a stream of requests').toHaveLength(1);
    vi.setSystemTime(T0 + 16_000);
    await agent.fetchMyParses(P({ fresh: true }));
    expect(calls).toHaveLength(2);
  });

  it('holds a bounded number of copies: the oldest is let go', async () => {
    const name = (i) => 'Aa' + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26));
    await agent.fetchMyParses(P({ char: 'Firstone' }));
    for (let i = 0; i < 60; i++) await agent.fetchMyParses(P({ char: name(i) }));
    const before = calls.length;
    await agent.fetchMyParses(P({ char: name(59) }));
    expect(calls.length, 'a recent one is still held').toBe(before);
    await agent.fetchMyParses(P({ char: 'Firstone' }));
    expect(calls.length, 'the first one was let go').toBe(before + 1);
  });
});

describe('the agent proxy: the route', () => {
  let server, port, calls;
  const get = (p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p }, r => {
    let d = ''; r.on('data', c => { d += c; }); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: JSON.parse(d) }));
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
    agent._resetMyParsesForTest();
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => ({ fights: [], nights: [], characters: [] }) }; }));
    agent._setUploadOptsForTest({ botUrl: 'https://bot.example/api/agent/encounter', token: 't0k', dryRun: false });
  });
  afterEach(() => { vi.unstubAllGlobals(); agent._setUploadOptsForTest(null); });

  it('GET /api/my-parses answers 200 JSON, uncached by the browser, with the whitelisted values forwarded', async () => {
    const r = await get('/api/my-parses?w=bogus&scope=all&char=Brackwyn&extra=1');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body.fights).toEqual([]);
    expect(calls).toEqual(['https://bot.example/api/agent/my-parses?w=7d&scope=all&char=Brackwyn']);
  });

  it('local mode over HTTP: 200 with signed_out, and the bot is never called', async () => {
    agent._setUploadOptsForTest({ botUrl: 'https://bot.example/api/agent/encounter', token: null, dryRun: false });
    const r = await get('/api/my-parses?w=7d&scope=bosses');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ error: 'signed_out' });
    expect(calls).toHaveLength(0);
  });

  it('a bot error is a 200 with unavailable (the dashboard reads the body without checking the status)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const r = await get('/api/my-parses');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ error: 'unavailable' });
  });
});

// ── 2. the dashboard: chart, table, tab ─────────────────────────────────────
const iso = (d, h, mi, mo = 10) => new Date(2026, mo - 1, d, h, mi).toISOString();           // the machine's own clock
const eid = (n) => 'a1b2c3d4-0000-4000-8000-0000000000' + String(n).padStart(2, '0');
const F = (n, over) => ({ t: iso(4, 21, 17), eid: eid(n), npc_id: 77, name: 'Aten Ha Ra', boss: true, char: 'Brackwyn', dps: 189, dmg: 189000, dur: 1000, rank: 2, usual: 168, ...over });
const FIGHTS = [
  F(1, { t: iso(1, 20, 5),  name: 'a Shissar acolyte', boss: false, dps: 90,  rank: 4, usual: null }),
  F(2, { t: iso(1, 21, 10), name: 'Lord Nagafen', dps: 160, rank: 3, usual: 180 }),
  F(3, { t: iso(1, 21, 40), name: 'Lady Vox', dps: 140, rank: 5, usual: 140 }),
  F(4, { t: iso(4, 20, 30), name: 'a Shissar acolyte', boss: false, dps: 480, rank: 1, usual: null }),
  F(5, {}),
  F(6, { t: iso(4, 22, 2), dps: 300, rank: 2, usual: 280 }),
];
const NIGHTS = [
  { night: '2026-10-01', fights: 3, bosses: 2, avg_dps: 125, best_dps: 160 },
  { night: '2026-10-04', fights: 3, bosses: 2, avg_dps: 312, best_dps: 480 },
];
const ANSWER = (over) => ({ window: { key: '7d', label: 'Last 7 days', since: iso(28, 12, 0, 9) }, scope: 'bosses', floor: '2026-07-14', total: FIGHTS.length, truncated: false,
  characters: [{ name: 'Brackwyn', class: 'Cleric', active: true }, { name: 'Corvale', class: 'Wizard', active: false }], fights: FIGHTS, nights: NIGHTS, ...over });
const AS_OF = new Date(2026, 9, 5, 12, 0).getTime();

describe('the chart', () => {
  const pure = sliceBlock(dash, 'var WP_MP_WINDOWS =', '\nfunction wpMpRepaint').replace(/\nfunction wpMpRepaint$/, '\n');
  const mk = new Function('esc', 'localStorage', pure + '\nreturn { _wpMp, wpMpChart, wpMpTable, wpMpHtml, _wpMpNightMs, _wpMpNice, _wpMpWhen, _wpMpVsUsual, WP_MP_WINDOWS, WP_MP_SCOPES };');
  const M = mk(esc, undefined);
  const chart = (d = ANSWER()) => M.wpMpChart(d, AS_OF);
  const count = (s, re) => (s.match(re) || []).length;

  it('draws one dot per fight, boss and other in their own colours, and one point per raid night', () => {
    const svg = chart();
    expect(svg.startsWith('<svg viewBox="0 0 640 230"')).toBe(true);
    expect(svg).toContain('style="width:100%;height:auto');
    expect(count(svg, /<circle[^>]*fill="#4493e8"/g), 'boss fights').toBe(4);
    expect(count(svg, /<circle[^>]*fill="#4a5568"/g), 'other fights').toBe(2);
    expect(count(svg, /<circle[^>]*fill="#a371f7"/g), 'one per raid night').toBe(2);
    expect(svg.lastIndexOf('fill="#4a5568"'), 'boss dots are drawn on top of the others').toBeLessThan(svg.indexOf('fill="#4493e8"'));
  });

  it('the raid-night average is a line through the nights, and its newest point is bigger and carries its value', () => {
    const svg = chart();
    expect(svg).toMatch(/<path d="M[\d. ]+L[\d. ]+" fill="none" stroke="#a371f7"/);
    expect(count(svg, /<circle[^>]*r="4"/g), 'only the newest is emphasised').toBe(1);
    expect(svg).toMatch(/<circle[^>]*r="4"[^>]*fill="#a371f7"|<circle[^>]*fill="#a371f7"[^>]*r="4"/);
    expect(svg).toContain('>avg 312</text>');
    // one night is a point with no line to draw
    const one = chart(ANSWER({ nights: [NIGHTS[1]] }));
    expect(one).not.toMatch(/<path/);
    expect(one).toContain('>avg 312</text>');
  });

  it('a raid night\'s hover carries the night\'s own date, whatever the viewer\'s clock says (10 pm Eastern can be tomorrow elsewhere)', () => {
    expect(chart()).toContain('<title>Raid night Oct 4 · 3 fights · avg 312 dps · best 480 dps</title>');
    expect(chart()).toContain('<title>Raid night Oct 1 · 3 fights · avg 125 dps · best 160 dps</title>');
  });

  it('never uses the death/critical red', () => {
    expect(chart().toLowerCase()).not.toContain('#f85149');
    const all = M.wpMpHtml.toString() + M.wpMpChart.toString() + M.wpMpTable.toString();
    expect(all.toLowerCase()).not.toContain('f85149');
    expect(all).not.toContain('var(--red)');
  });

  it('every fight dot sits inside the plot box, later fights further right, higher DPS higher up', () => {
    const svg = chart();
    const dots = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="[\d.]+" fill="(#4493e8|#4a5568)"><title>([^<]*)<\/title>/g)]
      .map(m => ({ x: +m[1], y: +m[2], tip: m[4] }));
    expect(dots).toHaveLength(6);
    for (const d of dots) { expect(d.x).toBeGreaterThanOrEqual(60); expect(d.x).toBeLessThanOrEqual(626); expect(d.y).toBeGreaterThanOrEqual(16); expect(d.y).toBeLessThanOrEqual(190); }
    const at = (name, dps) => dots.find(d => d.tip.startsWith(name + ' · ' + dps + ' dps'));
    expect(at('Aten Ha Ra', 300).x).toBeGreaterThan(at('Aten Ha Ra', 189).x);
    expect(at('Aten Ha Ra', 189).x).toBeGreaterThan(at('Lord Nagafen', 160).x);
    expect(at('a Shissar acolyte', 480).y).toBeLessThan(at('Aten Ha Ra', 189).y);
  });

  it('each dot says what it is on hover: name, DPS and when, on the viewer\'s clock', () => {
    expect(chart()).toContain('<title>Aten Ha Ra · 189 dps · Sun 9:17 pm</title>');
    expect(chart()).toContain('<title>Lord Nagafen · 160 dps · Thu 9:10 pm</title>');
  });

  it('adds the date to the hover once the window is wider than a week; names the character only when there is more than one', () => {
    const wide = ANSWER({ window: { key: '30d', label: 'Last 30 days', since: iso(5, 12, 0, 9) } });
    expect(chart(wide)).toContain('<title>Aten Ha Ra · 189 dps · Sun Oct 4 9:17 pm</title>');
    const two = ANSWER({ fights: FIGHTS.map((f, i) => (i === 4 ? { ...f, char: 'Corvale' } : f)) });
    expect(chart(two)).toContain('Aten Ha Ra · Corvale · 189 dps');
    expect(chart(two)).toContain('Aten Ha Ra · Brackwyn · 300 dps');
    expect(chart()).not.toContain('Brackwyn ·');                       // one character in the data: no name on the hover
  });

  it('the axis is 0, half and a round top with the unit on the top label (480 tops out at 500)', () => {
    const svg = chart();
    expect(count(svg, /<line /g)).toBe(3);
    expect(svg).toContain('>0</text>');
    expect(svg).toContain('>250</text>');
    expect(svg).toContain('>500 dps</text>');
    expect(svg.match(/dps<\/text>/g)).toHaveLength(1);
    expect(M._wpMpNice(189)).toBe(200);
    expect(M._wpMpNice(1010)).toBe(1500);
    expect(M._wpMpNice(0)).toBe(100);
  });

  it('keeps every label inside the viewBox, even with a huge number and a night at the right edge', () => {
    const big = ANSWER({ fights: FIGHTS.map(f => ({ ...f, dps: f.dps * 40 })), nights: NIGHTS.map(n => ({ ...n, avg_dps: n.avg_dps * 40 })) });
    for (const d of [ANSWER(), big, ANSWER({ nights: [NIGHTS[0]] })]) {
      const svg = chart(d);
      const [, W, H] = svg.match(/viewBox="0 0 (\d+) (\d+)"/).map(Number);
      const labels = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"(?: text-anchor="(\w+)")?[^>]*>([^<]*)<\/text>/g)];
      expect(labels.length).toBeGreaterThan(5);
      for (const [, x, y, anchor, text] of labels) {
        const w = text.length * 6.6;
        const left = anchor === 'end' ? +x - w : anchor === 'middle' ? +x - w / 2 : +x;
        const right = anchor === 'end' ? +x : anchor === 'middle' ? +x + w / 2 : +x + w;
        expect(left, text).toBeGreaterThanOrEqual(0);
        expect(right, text).toBeLessThanOrEqual(W);
        expect(+y, text).toBeGreaterThan(0);
        expect(+y, text).toBeLessThan(H);
      }
    }
  });

  it('a window with nothing in it draws nothing, and one lone fight still gets a readable axis', () => {
    expect(chart(ANSWER({ fights: [], nights: [] }))).toBe('');
    const lone = chart(ANSWER({ fights: [FIGHTS[4]], nights: [], window: { since: null } }));
    expect(lone).toContain('<circle');
    expect(lone).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('is byte-stable: the same answer draws the same picture, however many times and whenever asked', () => {
    const a = chart();
    expect(chart(JSON.parse(JSON.stringify(ANSWER())))).toBe(a);
    expect(M.wpMpChart(ANSWER(), AS_OF)).toBe(a);
    expect(a).not.toMatch(/NaN|undefined|null/);
  });

  it('puts a raid night at 10 pm Eastern, summer or winter, and says nothing for a bad date', () => {
    expect(M._wpMpNightMs('2026-10-04')).toBe(Date.UTC(2026, 9, 5, 2, 0, 0));       // EDT, UTC-4
    expect(M._wpMpNightMs('2026-12-06')).toBe(Date.UTC(2026, 11, 7, 3, 0, 0));      // EST, UTC-5
    expect(M._wpMpNightMs('2026-03-08')).toBe(Date.UTC(2026, 2, 9, 2, 0, 0));       // the day DST began: 22:00 is already EDT
    expect(Number.isNaN(M._wpMpNightMs('tonight'))).toBe(true);
    expect(Number.isNaN(M._wpMpNightMs(undefined))).toBe(true);
  });
});

describe('the table under the chart', () => {
  const pure = sliceBlock(dash, 'var WP_MP_WINDOWS =', '\nfunction wpMpRepaint').replace(/\nfunction wpMpRepaint$/, '\n');
  const M = new Function('esc', 'localStorage', pure + '\nreturn { wpMpTable, _wpMpVsUsual };')(esc, undefined);
  const many = Array.from({ length: 15 }, (_, i) => F(i + 1, { t: iso(1 + Math.floor(i / 5), 20, 10 + i), name: 'Mob ' + (i + 1), dps: 100 + i }));
  const rows = (html) => html.split('<tbody>')[1].split('</tr>').filter(r => r.includes('<td'));

  it('lists the newest twelve fights, newest first', () => {
    const r = rows(M.wpMpTable({ fights: many }));
    expect(r).toHaveLength(12);
    expect(r[0]).toContain('Mob 15');
    expect(r[11]).toContain('Mob 4');
  });

  it('shows the Character column only when more than one character is in the data', () => {
    expect(M.wpMpTable({ fights: many })).not.toContain('<th>Character</th>');
    const two = many.map((f, i) => (i === 0 ? { ...f, char: 'Corvale' } : f));       // the OLDEST row: still counts
    const html = M.wpMpTable({ fights: two });
    expect(html).toContain('<th>Character</th>');
    expect(rows(html)[0]).toContain('<td>Brackwyn</td>');
  });

  it('writes vs usual as +12% / −8% with a real minus, and — when there is nothing to compare with', () => {
    expect(M._wpMpVsUsual(189, 168)).toContain('+13%');
    expect(M._wpMpVsUsual(160, 180)).toContain('−11%');
    expect(M._wpMpVsUsual(140, 140)).toContain('0%');
    expect(M._wpMpVsUsual(189, null)).toContain('—');
    expect(M._wpMpVsUsual(189, 0)).toContain('—');
    expect(M._wpMpVsUsual(112, 100)).toContain('+12%');
    expect(M._wpMpVsUsual(92, 100)).toContain('−8%');
    expect(M._wpMpVsUsual(112, 100)).toContain('var(--green)');
    expect(M._wpMpVsUsual(92, 100)).toContain('var(--orange)');
  });

  it('shows DPS, rank as #n, and — for a missing rank', () => {
    const html = M.wpMpTable({ fights: [F(1, { dps: 188.6, rank: 3 }), F(2, { rank: null })] });
    const r = rows(html);
    expect(r[1]).toContain('>189</td>');
    expect(r[1]).toContain('>#3</td>');
    expect(r[0]).toMatch(/<span class="dim">—<\/span><\/td>\s*$/);
  });

  it('the fight name opens its card on wolfpack.quest through the shell, and only a real id becomes a link', () => {
    const html = M.wpMpTable({ fights: [F(5, {}), F(6, { eid: 'not an id"><script>' }), F(7, { eid: null })] });
    expect(html).toContain('<a href="https://wolfpack.quest/parses/' + eid(5) + '" target="_blank" rel="noreferrer" onclick="return wpMpLink(this)"');
    expect(count2(html, /<a /g), 'only the first has a usable id').toBe(1);
    expect(html).not.toContain('<script>');
  });

  it('keeps clear of the name-click delegation and the details rule', () => {
    const html = M.wpMpTable({ fights: many });
    expect(html).not.toContain('class="name"');
    expect(html).not.toContain('<details');
  });
});
const count2 = (s, re) => (s.match(re) || []).length;

describe('the tab\'s states, captions and links', () => {
  const pure = sliceBlock(dash, 'var WP_MP_WINDOWS =', '\nfunction wpMpRepaint').replace(/\nfunction wpMpRepaint$/, '\n');
  const fresh = () => new Function('esc', 'localStorage', pure + '\nreturn { _wpMp, wpMpHtml };')(esc, undefined);
  const html = (patch) => { const t = fresh(); Object.assign(t._wpMp, { state: 'ok', asOf: AS_OF, data: ANSWER(), chars: ANSWER().characters }, patch); return t.wpMpHtml(); };
  const allowed = new Function(sliceBlock(MAIN, 'const ALLOW = /', '/i;') + '\nreturn ALLOW;')();

  it('says Loading… before the first answer, and that is all it says', () => {
    const h = fresh().wpMpHtml();
    expect(h).toContain('Loading…');
    expect(h).not.toContain('<svg');
    expect(h).not.toContain('Numbers start');
  });

  it('says to sign in when the agent has no sign-in, and that the server could not be reached when it could not', () => {
    expect(html({ state: 'signed_out', data: null })).toContain('Sign in to Mimic to see your parses.');
    expect(html({ state: 'unavailable', data: null })).toContain("Couldn't reach the guild server. Try again in a minute.");
    expect(html({ state: 'signed_out', data: null })).not.toContain('<svg');
  });

  it('empty Bosses points at Everything, empty Everything says so plainly', () => {
    expect(html({ data: ANSWER({ fights: [], nights: [] }) }))
      .toContain("No boss fights in this window. Most Planes of Power bosses aren't on the boss list yet, so try Everything.");
    const all = html({ scope: 'all', data: ANSWER({ fights: [], nights: [], scope: 'all' }) });
    expect(all).toContain('No parses in this window yet.');
    expect(all).not.toContain('No boss fights');
    expect(all).not.toContain('<svg');
  });

  it('draws the chart, the legend and the table for an answer, with the 14 July caption', () => {
    const h = html();
    expect(h).toContain('<svg');
    expect(h).toContain('<table');
    expect(h).toContain('boss fight');
    expect(h).toContain('Last 7 days');
    expect(h).toContain('Numbers start 14 July 2026, when parse merging was fixed.');
    expect(h).not.toContain('Showing the newest');
    expect(h).not.toMatch(/NaN|undefined|null/);
  });

  it('says how many of the fights it is showing when the answer was cut', () => {
    const cut = ANSWER({ truncated: true, total: 523, fights: Array.from({ length: 400 }, (_, i) => F(i % 90, { t: iso(1 + (i % 4), 20, i % 60) })) });
    expect(html({ data: cut })).toContain('Showing the newest 400 of 523 fights.');
  });

  it('offers five windows, two scopes, All and each character; the chosen ones are the lit chips', () => {
    const h = html({ w: '30d', scope: 'all', char: 'corvale' });
    for (const label of ['1 day', '1 week', '30 days', '90 days', 'This expansion', 'Bosses', 'Everything', 'All', 'Brackwyn', 'Corvale']) expect(h).toContain('>' + label + '</button>');
    const lit = [...h.matchAll(/class="wp-btn pri" data-k="(\w+)" data-v="([^"]*)"/g)].map(m => m[1] + '=' + m[2]);
    expect(lit).toEqual(['w=30d', 'scope=all', 'char=Corvale']);
    expect(html({ char: '' })).toMatch(/class="wp-btn pri" data-k="char" data-v=""/);
  });

  it('the Open-on-wolfpack.quest button carries the window, scope and character, and the shell lets it through', () => {
    const href = (h) => h.match(/<a class="wp-btn ghost" href="([^"]+)"/)[1].replace(/&amp;/g, '&');
    expect(href(html())).toBe('https://wolfpack.quest/me/parses?w=7d&scope=bosses');
    expect(href(html({ w: 'exp', scope: 'all', char: 'Brackwyn' }))).toBe('https://wolfpack.quest/me/parses?w=exp&scope=all&char=Brackwyn');
    expect(allowed.test(href(html()))).toBe(true);
    expect(allowed.test('https://wolfpack.quest/parses/' + eid(5))).toBe(true);
    expect(allowed.test('https://evil.example/parses/' + eid(5))).toBe(false);
    expect(allowed.test('http://wolfpack.quest/parses/x'), 'https only').toBe(false);
  });

  it('is byte-stable and holds no clock: the same state paints the same HTML', () => {
    expect(html()).toBe(html());
    expect(html()).not.toMatch(/ago\b/);
  });

  it('does not carry a details element the wpKeep rule would have to cover', () => {
    expect(html()).not.toContain('<details');
  });
});

// ── the character chips: mains and real alts first, the rest behind "+N more" ───────────────────────────────
// The guild lead, 2026-10-06, looking at ~50 chips: "my expectation on this list is mains and real alts". The bot
// sends {name, class, active, hidden, fights, recent} per character; an older bot sends only the first three.
describe('the character chips: who is shown, who is tucked away', () => {
  const pure = sliceBlock(dash, 'var WP_MP_WINDOWS =', '\nfunction wpMpRepaint').replace(/\nfunction wpMpRepaint$/, '\n');
  const mk = () => new Function('esc', 'localStorage', pure + '\nreturn { _wpMp, wpMpSplitChars, wpMpHtml, WP_MP_HIDDEN_TIP };')(esc, undefined);
  const T = mk();
  const split = (chars, sel) => { const r = T.wpMpSplitChars(chars, sel); return { shown: r.shown.map(c => c.name), folded: r.folded.map(c => c.name) }; };
  const CH = (name, over) => ({ name, class: 'Cleric', active: false, hidden: false, fights: 4, recent: 8, ...over });

  describe('wpMpSplitChars', () => {
    it('a hidden character is folded, even one that fought', () => {
      expect(split([CH('Aldenmar'), CH('Brackwyn', { hidden: true, fights: 30, recent: 30 })])).toEqual({ shown: ['Aldenmar'], folded: ['Brackwyn'] });
    });

    it('a character with no fights in the window and none in 30 days is folded; either count keeps it shown', () => {
      const r = split([
        CH('Aldenmar', { fights: 0, recent: 0 }),
        CH('Brackwyn', { fights: 0, recent: 3 }),          // quiet this window, fought this month
        CH('Corvale', { fights: 2, recent: 0 }),           // cannot happen (the window is inside 30 days at most) but still shown
        CH('Rethlan', { fights: 6, recent: 6 }),
      ]);
      expect(r.folded).toEqual(['Aldenmar']);
      expect(r.shown.sort()).toEqual(['Brackwyn', 'Corvale', 'Rethlan']);
    });

    it('an older bot (no hidden, no counts) folds nothing: a missing hidden is false and missing counts mean show it', () => {
      const old = [{ name: 'Aldenmar', class: 'Cleric', active: true }, { name: 'Brackwyn', class: 'Wizard', active: false }, { name: 'Corvale', active: false }];
      expect(split(old)).toEqual({ shown: ['Aldenmar', 'Brackwyn', 'Corvale'], folded: [] });
      // half an answer is still "unknown": only a character with BOTH counts at zero is quiet
      expect(split([CH('Aldenmar', { fights: 0, recent: undefined }), CH('Brackwyn', { fights: undefined, recent: 0 }), CH('Corvale', { fights: null, recent: null })]).folded).toEqual([]);
      // and a missing hidden next to counts is not hidden
      expect(split([{ name: 'Aldenmar', fights: 3, recent: 3 }])).toEqual({ shown: ['Aldenmar'], folded: [] });
    });

    it('sorts by fights (most first), then active, then name; an old bot\'s own order (active, then name) survives', () => {
      const r = split([
        CH('Zarrin', { fights: 2 }), CH('brackwyn', { fights: 9 }), CH('Corvale', { fights: 9, active: true }),
        CH('Aldenmar', { fights: 2 }), CH('Nyssara', { fights: 2, active: true }), CH('Rethlan', { fights: 9 }),
      ]);
      expect(r.shown).toEqual(['Corvale', 'brackwyn', 'Rethlan', 'Nyssara', 'Aldenmar', 'Zarrin']);
      const old = [{ name: 'Nyssara', active: true }, { name: 'Zarrin', active: true }, { name: 'Aldenmar', active: false }, { name: 'Brackwyn', active: false }];
      expect(split(old).shown).toEqual(['Nyssara', 'Zarrin', 'Aldenmar', 'Brackwyn']);
    });

    it('the folded list is the quiet ones first, the hidden ones last, each sorted the same way', () => {
      const r = split([
        CH('Aldenmar', { hidden: true, fights: 50, recent: 50 }), CH('Brackwyn', { fights: 0, recent: 0, active: true }),
        CH('Corvale', { hidden: true, fights: 0, recent: 0, active: true }), CH('Zarrin', { fights: 0, recent: 0 }), CH('Rethlan'),
      ]);
      expect(r.shown).toEqual(['Rethlan']);
      expect(r.folded).toEqual(['Brackwyn', 'Zarrin', 'Aldenmar', 'Corvale']);
    });

    it('the selected character always lands in shown, whatever its flags and however its case', () => {
      const chars = [CH('Aldenmar'), CH('Brackwyn', { hidden: true }), CH('Corvale', { fights: 0, recent: 0 })];
      expect(split(chars, 'brackwyn')).toEqual({ shown: ['Aldenmar', 'Brackwyn'], folded: ['Corvale'] });
      expect(split(chars, 'CORVALE')).toEqual({ shown: ['Aldenmar', 'Corvale'], folded: ['Brackwyn'] });
      expect(split(chars, 'Nobody')).toEqual({ shown: ['Aldenmar'], folded: ['Corvale', 'Brackwyn'] });      // the hidden one last
      expect(split(chars, '')).toEqual({ shown: ['Aldenmar'], folded: ['Corvale', 'Brackwyn'] });
    });

    it('hands back the very objects it was given, once each, and survives junk', () => {
      const a = CH('Aldenmar'), b = CH('Brackwyn', { hidden: true });
      const r = T.wpMpSplitChars([a, b], '');
      expect(r.shown[0]).toBe(a);
      expect(r.folded[0]).toBe(b);
      expect(T.wpMpSplitChars(null, 'x')).toEqual({ shown: [], folded: [] });
      expect(T.wpMpSplitChars(undefined)).toEqual({ shown: [], folded: [] });
      expect(split([null, {}, { name: '' }, CH('Aldenmar')])).toEqual({ shown: ['Aldenmar'], folded: [] });
      // hidden is only ever the boolean true: a stray truthy value does not hide a character
      expect(split([CH('Aldenmar', { hidden: 'false' }), CH('Brackwyn', { hidden: 1 })]).folded).toEqual([]);
    });
  });

  describe('the chip row', () => {
    const html = (chars, patch) => { const t = mk(); Object.assign(t._wpMp, { state: 'ok', asOf: AS_OF, data: ANSWER(), chars }, patch); return t.wpMpHtml(); };
    const chipRe = /<button type="button" class="wp-btn( pri)?" data-k="char" data-v="([^"]*)" onclick="wpMpSet\(this\)"([^>]*)>([^<]*)<\/button>/g;
    const chips = (h) => [...h.matchAll(chipRe)].map(m => ({ v: m[2], on: !!m[1], attrs: m[3], label: m[4], at: m.index }));
    const toggle = (h) => { const m = /<button type="button" class="wp-btn ghost" onclick="wpMpMore\(\)"[^>]*>([^<]*)<\/button>/.exec(h); return m && { label: m[1], at: m.index }; };
    // two raiders' worth of real characters, and a pile of mules and traders behind them
    const family = [CH('Aldenmar', { active: true, fights: 14, recent: 40 }), CH('Brackwyn', { fights: 6, recent: 20 }), CH('Corvale', { fights: 0, recent: 4 })];
    const pile = [
      ...Array.from({ length: 30 }, (_, i) => CH('Quill' + String.fromCharCode(97 + (i % 26)) + (i >= 26 ? 'z' : ''), { fights: 0, recent: 0 })),
      ...Array.from({ length: 17 }, (_, i) => CH('Bank' + String.fromCharCode(97 + i), { hidden: true, fights: 0, recent: 0 })),   // sort BEFORE Quill*: hidden-last must be the rule, not the alphabet
    ];
    const all = [...pile, ...family];                                              // 3 + 47 = 50

    it('50 characters draw All, the three that matter and "+47 more" as the last chip; the pile is not in the HTML', () => {
      const h = html(all);
      expect(chips(h).map(c => c.v)).toEqual(['', 'Aldenmar', 'Brackwyn', 'Corvale']);
      expect(toggle(h).label).toBe('+47 more');
      expect(toggle(h).at, 'the toggle comes after the shown chips').toBeGreaterThan(chips(h)[3].at);
      expect(h).not.toContain('Quill');
      expect(h).not.toContain('Bank');
      expect(h).not.toContain('fewer');
    });

    it('"+N more" counts the folded ones, so it drops by one when a folded character is the selected one', () => {
      expect(toggle(html(all, { char: 'Quillb' })).label).toBe('+46 more');
      const h = html(all, { char: 'Quillb' });
      expect(chips(h).map(c => c.v), 'the selected one is on the row without opening it').toEqual(['', 'Aldenmar', 'Brackwyn', 'Corvale', 'Quillb']);
      expect(chips(h).filter(c => c.on).map(c => c.v), 'and lit').toEqual(['Quillb']);
    });

    it('opened ("fewer"): the tucked-away ones follow the shown ones, the quiet ones before the hidden ones; hidden ones are dimmed and say why', () => {
      const h = html(all, { showAll: true });
      const c = chips(h);
      expect(c).toHaveLength(1 + 50);
      expect(toggle(h).label).toBe('fewer');
      expect(h).not.toMatch(/\+\d+ more/);
      expect(c.slice(0, 4).map(x => x.v)).toEqual(['', 'Aldenmar', 'Brackwyn', 'Corvale']);
      expect(toggle(h).at).toBeGreaterThan(c[3].at);
      expect(toggle(h).at, 'the folded chips come after the toggle, so it keeps its place').toBeLessThan(c[4].at);
      const folded = c.slice(4);
      expect(folded.filter(x => x.v.startsWith('Quill'))).toHaveLength(30);
      expect(folded.findIndex(x => x.v.startsWith('Bank')), 'hidden ones last').toBe(30);
      for (const x of folded) {
        const hid = x.v.startsWith('Bank');
        expect(x.attrs.includes('opacity:.55'), x.v).toBe(hid);
        expect(x.attrs.includes('title="' + T.WP_MP_HIDDEN_TIP + '"'), x.v).toBe(hid);
      }
      expect(T.WP_MP_HIDDEN_TIP).toBe('Hidden on wolfpack.quest/me (Hide from lists)');
      expect(c.slice(0, 4).every(x => !x.attrs.includes('opacity'))).toBe(true);
    });

    it('a hidden character that is the selected one is lit, not dimmed', () => {
      const h = html([...family, CH('Trader', { hidden: true })], { char: 'trader', showAll: true });
      const t = chips(h).find(x => x.v === 'Trader');
      expect(t.on).toBe(true);
      expect(t.attrs).not.toContain('opacity');
    });

    it('the row waits for a second chip: one lone character with nothing folded shows no Character row at all', () => {
      expect(html([family[0]])).not.toContain('Character');
      expect(html([])).not.toContain('Character');
      expect(html([family[0]])).not.toContain('data-k="char"');
      // but one shown plus anything folded is a real choice
      const h = html([family[0], CH('Quilla', { fights: 0, recent: 0 })]);
      expect(chips(h).map(c => c.v)).toEqual(['', 'Aldenmar']);
      expect(toggle(h).label).toBe('+1 more');
      // and nothing shown at all (every character quiet or hidden) still offers All and the toggle
      const none = html(pile);
      expect(chips(none).map(c => c.v)).toEqual(['']);
      expect(toggle(none).label).toBe('+47 more');
    });

    it('an older bot (no hidden, no counts): every character is a chip, no toggle, no note', () => {
      const old = [{ name: 'Aldenmar', class: 'Cleric', active: true }, { name: 'Brackwyn', class: 'Wizard', active: false }];
      const h = html(old);
      expect(chips(h).map(c => c.v)).toEqual(['', 'Aldenmar', 'Brackwyn']);
      expect(toggle(h)).toBeNull();
      expect(h).not.toContain('tucked away');
      expect(chips(h)[1].attrs).toContain('title="Cleric"');
    });

    it('a short line says what is tucked away, links wolfpack.quest/me through the shell, and only shows when something is', () => {
      const note = 'Characters with no fights in 30 days, and ones you hid on ';
      const h = html(all);
      expect(h).toContain(note);
      expect(h).toContain(', are tucked away.');
      const a = /<a href="(https:\/\/wolfpack\.quest\/me)" target="_blank" rel="noreferrer" onclick="return wpMpLink\(this\)"[^>]*>wolfpack\.quest\/me<\/a>/.exec(h);
      expect(a, 'the same link pattern as the tab\'s other links').not.toBeNull();
      const allowed = new Function(sliceBlock(MAIN, 'const ALLOW = /', '/i;') + '\nreturn ALLOW;')();
      expect(allowed.test(a[1])).toBe(true);
      expect(h.indexOf(note), 'under the controls').toBeGreaterThan(h.indexOf('Open on wolfpack.quest'));
      expect(html(all, { showAll: true })).toContain(note);                       // still true while opened
      expect(html(family)).not.toContain('tucked away');
      expect(html(family)).not.toContain('wolfpack.quest/me"');
      expect(html(all, { state: 'unavailable', data: null })).toContain('tucked away');   // the note and the row travel together
    });

    it('keeps the section byte-stable and clear of the name-click and details rules', () => {
      for (const patch of [{}, { showAll: true }, { char: 'Quillb' }]) {
        const h = html(all, patch);
        expect(h).toBe(html(JSON.parse(JSON.stringify(all)), patch));
        expect(h).not.toContain('class="name"');
        expect(h).not.toContain('<details');
        expect(h).not.toMatch(/ago\b|NaN|undefined|null/);
      }
    });

    it('character names are escaped', () => {
      const h = html([CH('Aldenmar'), CH('Brackwyn'), CH('x"><script>', { hidden: true })], { showAll: true });
      expect(h).not.toContain('<script>');
    });
  });
});

describe('asking: only when opened, on a change, or on ↻', () => {
  const full = sliceBlock(dash, 'var WP_MP_WINDOWS =', '\nfunction renderTriggers(s) {').replace(/\nfunction renderTriggers\(s\) \{$/, '\n');
  const build = new Function('esc', 'localStorage', 'setSectionHTML', 'fetch', 'window',
    full + '\nreturn { _wpMp, wpMpFetch, wpMpSet, wpMpRefresh, wpMpOpenTab, wpMpLink, wpMpHtml, wpMpMore };');
  const el = (k, v) => ({ getAttribute: (a) => ({ 'data-k': k, 'data-v': v })[a] ?? null });

  function harness(saved, win = {}) {
    const store = saved ? { 'wp:myParses': JSON.stringify(saved) } : {};
    const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
    const calls = [], painted = [];
    const fetchFn = (url) => new Promise((resolve, reject) => {
      calls.push({ url, ok: (j) => resolve({ ok: true, json: async () => j }), status: (s) => resolve({ ok: false, status: s, json: async () => ({}) }), boom: reject });
    });
    const t = build(esc, ls, (id, h) => { painted.push([id, h]); return true; }, fetchFn, win);
    return { ...t, calls, painted, store, last: () => painted[painted.length - 1][1] };
  }

  it('opening the tab asks once, shows Loading… while it waits, and paints the answer when it lands', async () => {
    const h = harness();
    h.wpMpOpenTab();
    expect(h.calls.map(c => c.url)).toEqual(['/api/my-parses?w=7d&scope=bosses']);
    expect(h.painted[0][0]).toBe('myparses');
    expect(h.last()).toContain('Loading…');
    h.calls[0].ok(ANSWER());
    await tick();
    expect(h.last()).toContain('<svg');
    expect(h.calls).toHaveLength(1);
  });

  it('remembers the last choice and asks with it next time', () => {
    const h = harness({ w: '90d', scope: 'all', char: 'Brackwyn' });
    h.wpMpOpenTab();
    expect(h.calls[0].url).toBe('/api/my-parses?w=90d&scope=all&char=Brackwyn');
    const junk = harness({ w: 'forever', scope: 'x', char: '<b>' });
    junk.wpMpOpenTab();
    expect(junk.calls[0].url).toBe('/api/my-parses?w=7d&scope=bosses');
  });

  it('a chip click asks again with the new choice and saves it; clicking the lit chip asks nothing', () => {
    const h = harness();
    h.wpMpSet(el('w', '30d'));
    h.wpMpSet(el('scope', 'all'));
    h.wpMpSet(el('char', 'Corvale'));
    expect(h.calls.map(c => c.url)).toEqual([
      '/api/my-parses?w=30d&scope=bosses',
      '/api/my-parses?w=30d&scope=all',
      '/api/my-parses?w=30d&scope=all&char=Corvale',
    ]);
    expect(JSON.parse(h.store['wp:myParses'])).toEqual({ w: '30d', scope: 'all', char: 'Corvale' });
    h.wpMpSet(el('w', '30d')); h.wpMpSet(el('scope', 'all')); h.wpMpSet(el('char', 'Corvale'));
    expect(h.calls).toHaveLength(3);
  });

  it('refuses a window or scope that is not on the lists', () => {
    const h = harness();
    h.wpMpSet(el('w', 'life')); h.wpMpSet(el('w', '')); h.wpMpSet(el('scope', 'everything')); h.wpMpSet(el('nonsense', 'x')); h.wpMpSet(null);
    expect(h.calls).toHaveLength(0);
  });

  it('an answer that lands after a newer ask is dropped, whichever order they arrive in', async () => {
    const h = harness();
    h.wpMpOpenTab();                                   // ask 0: 1 week
    h.wpMpSet(el('w', '90d'));                         // ask 1: 90 days
    h.calls[1].ok(ANSWER({ window: { key: '90d', label: 'Last 90 days', since: iso(1, 0, 0, 7) } }));
    await tick();
    h.calls[0].ok(ANSWER({ window: { key: '7d', label: 'Stale week', since: iso(28, 0, 0, 9) } }));
    await tick();
    // what is painted, and what the tab holds for its next repaint
    expect(h.last()).toContain('Last 90 days');
    expect(h.wpMpHtml()).toContain('Last 90 days');
    expect(h.wpMpHtml()).not.toContain('Stale week');
  });

  it('signed out, a failed status and a dead network each say so, and none of them leaves it on Loading…', async () => {
    const h = harness();
    h.wpMpOpenTab(); h.calls[0].ok({ error: 'signed_out' }); await tick();
    expect(h.last()).toContain('Sign in to Mimic to see your parses.');
    h.wpMpOpenTab(); h.calls[1].status(500); await tick();
    expect(h.last()).toContain("Couldn't reach the guild server.");
    h.wpMpOpenTab(); h.calls[2].boom(new Error('agent restarting')); await tick();
    expect(h.last()).toContain("Couldn't reach the guild server.");
    h.wpMpOpenTab(); h.calls[3].ok({ error: 'unavailable' }); await tick();
    expect(h.last()).toContain("Couldn't reach the guild server.");
    h.wpMpOpenTab(); h.calls[4].ok({ hello: 'old agent' }); await tick();
    expect(h.last()).toContain("Couldn't reach the guild server.");
  });

  it('↻ asks with fresh=1, and does nothing while an ask is still out', async () => {
    const h = harness();
    h.wpMpOpenTab();
    h.wpMpRefresh();
    expect(h.calls, 'still loading').toHaveLength(1);
    h.calls[0].ok(ANSWER()); await tick();
    h.wpMpRefresh();
    expect(h.calls[1].url).toBe('/api/my-parses?w=7d&scope=bosses&fresh=1');
  });

  it('a remembered character the guild no longer lists goes back to All, and asks once more', async () => {
    const h = harness({ w: '7d', scope: 'bosses', char: 'Zarrin' });
    h.wpMpOpenTab();
    expect(h.calls[0].url).toContain('char=Zarrin');
    h.calls[0].ok(ANSWER()); await tick();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].url).toBe('/api/my-parses?w=7d&scope=bosses');
    expect(h._wpMp.char).toBe('');
    expect(JSON.parse(h.store['wp:myParses']).char).toBe('');
    h.calls[1].ok(ANSWER()); await tick();
    expect(h.calls, 'and then it stops: a listed character does not loop').toHaveLength(2);
  });

  it('a character the guild lists stays selected', async () => {
    const h = harness({ w: '7d', scope: 'bosses', char: 'brackwyn' });
    h.wpMpOpenTab(); h.calls[0].ok(ANSWER()); await tick();
    expect(h.calls).toHaveLength(1);
    expect(h._wpMp.char).toBe('brackwyn');
  });

  it('"+N more" / "fewer" only repaint: no ask, nothing saved, and the choice is not lost by an answer landing', async () => {
    const chars = [
      { name: 'Aldenmar', class: 'Cleric', active: true, hidden: false, fights: 9, recent: 9 },
      { name: 'Brackwyn', class: 'Wizard', active: false, hidden: false, fights: 3, recent: 3 },
      { name: 'Quilla', class: 'Rogue', active: false, hidden: true, fights: 0, recent: 0 },
    ];
    const h = harness();
    h.wpMpOpenTab(); h.calls[0].ok(ANSWER({ characters: chars })); await tick();
    expect(h.last()).toContain('+1 more');
    expect(h.last()).not.toContain('Quilla');
    const painted = h.painted.length;
    h.wpMpMore();
    expect(h.painted.length, 'one repaint').toBe(painted + 1);
    expect(h.last()).toContain('>fewer</button>');
    expect(h.last()).toContain('data-v="Quilla"');
    expect(h.calls, 'nothing was asked').toHaveLength(1);
    expect(h.store['wp:myParses'], 'and nothing saved').toBeUndefined();
    h.wpMpRefresh(); h.calls[1].ok(ANSWER({ characters: chars })); await tick();
    expect(h.last(), 'a new answer keeps it open').toContain('>fewer</button>');
    h.wpMpMore();
    expect(h.last()).toContain('+1 more');
    expect(h.last()).not.toContain('Quilla');
  });

  it('a remembered character that is hidden is still listed, so it stays selected and on the row', async () => {
    const chars = [
      { name: 'Aldenmar', active: true, hidden: false, fights: 9, recent: 9 },
      { name: 'Brackwyn', active: false, hidden: true, fights: 2, recent: 2 },
    ];
    const h = harness({ w: '7d', scope: 'bosses', char: 'Brackwyn' });
    h.wpMpOpenTab(); h.calls[0].ok(ANSWER({ characters: chars })); await tick();
    expect(h.calls, 'no reset to All').toHaveLength(1);
    expect(h._wpMp.char).toBe('Brackwyn');
    expect(h.last()).toMatch(/class="wp-btn pri" data-k="char" data-v="Brackwyn"/);
  });

  it('opens wolfpack.quest links through the shell when there is one, and lets a plain browser follow the link', () => {
    const opened = [];
    const inMimic = harness(null, { mimic: { openExternal: (u) => { opened.push(u); return Promise.resolve(true); } } });
    expect(inMimic.wpMpLink({ getAttribute: () => 'https://wolfpack.quest/parses/' + eid(5) })).toBe(false);
    expect(opened).toEqual(['https://wolfpack.quest/parses/' + eid(5)]);
    const browser = harness(null, {});
    expect(browser.wpMpLink({ getAttribute: () => 'https://wolfpack.quest/parses/x' })).toBe(true);
  });

  it('has no timer of its own: no poll, no render-loop entry', () => {
    const code = stripJs(full);
    expect(code).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
    const loop = sliceBlock(dash, 'var _sections = [', ']];');
    expect(loop).not.toMatch(/wpMp|myparses/i);
    // the one fetch of the agent route is the one inside wpMpFetch
    expect(stripJs(dash).match(/\/api\/my-parses/g)).toHaveLength(1);
  });
});

describe('the tab is wired into the dashboard', () => {
  const code = stripJs(dash);

  it('has a button on the rail and a pane to show, right after Fights', () => {
    expect(dash).toMatch(/<button data-tab="fights">[^<]*<\/button>\s*(?:<!--[\s\S]*?-->\s*)?<button data-tab="myparses">📈 My parses<\/button>/);
    expect(dash).toContain('<div id="myparses" class="section"></div>');
  });

  it('the rail click asks for the parses', () => {
    expect(code).toMatch(/if \(b\.dataset\.tab === 'myparses'\) wpMpOpenTab\(\);/);
  });

  it('#myparses opens the tab on load and on change, then drops the hash so the next one is a change', () => {
    const iife = sliceBlock(dash, "(function () {\n  function go() {\n    if ((location.hash || '').toLowerCase() !== '#myparses') return;", "  window.addEventListener('hashchange', go);\n})();");
    const run = (hash) => {
      const clicks = [], replaced = [], listeners = {};
      const location = { hash, pathname: '/', search: '?x=1' };
      const document = { querySelector: (sel) => (sel === '.nav button[data-tab="myparses"]' ? { click: () => clicks.push(sel) } : null) };
      const history = { replaceState: (...a) => { replaced.push(a); location.hash = ''; } };
      const window = { addEventListener: (ev, fn) => { listeners[ev] = fn; } };
      new Function('location', 'document', 'history', 'window', iife)(location, document, history, window);
      return { clicks, replaced, listeners, location };
    };
    const onLoad = run('#myparses');
    expect(onLoad.clicks).toHaveLength(1);
    expect(onLoad.replaced).toEqual([[null, '', '/?x=1']]);
    const later = run('');
    expect(later.clicks).toHaveLength(0);
    later.location.hash = '#MyParses'; later.listeners.hashchange();
    expect(later.clicks, 'a hash change from the tray').toHaveLength(1);
    const other = run('#feedback');
    expect(other.clicks, 'other hashes are other features\'').toHaveLength(0);
    expect(other.replaced).toHaveLength(0);
  });
});

// ── 3. Mimic: the tray item and how it reaches the tab ──────────────────────
describe('Mimic: the tray item and showDashboardTab', () => {
  const code = stripJs(MAIN);

  it('the tray has 📈 My parses, up with the dashboard and the website', () => {
    expect(code).toMatch(/\{ label: '📈 My parses', click: \(\) => showDashboardTab\('myparses'\) \},/);
    const at = (s) => code.indexOf(s);
    expect(at("{ label: 'Show dashboard'")).toBeLessThan(at("label: '📈 My parses'"));
    expect(at("label: '📈 My parses'")).toBeLessThan(at("{ label: 'Open wolfpack.quest ↗'"));
  });

  const showSrc = sliceBlock(MAIN, 'function showDashboardTab(tab) {', '\n}\n');
  function show({ url, destroyed = false, minimized = false, win = true } = {}) {
    const log = [];
    const mainWindow = win ? {
      isDestroyed: () => destroyed, isMinimized: () => minimized,
      restore: () => log.push('restore'), show: () => log.push('show'), focus: () => log.push('focus'),
      webContents: { loadURL: (u) => { log.push('loadURL ' + u); return Promise.resolve(); } },
    } : null;
    const nav = (reason, hash) => log.push('navigate ' + reason + ' ' + hash);
    const fn = new Function('mainWindow', '_curWindowUrl', 'navigateToDashboard', 'agentPort', 'appendAgentLog', showSrc + '\nreturn showDashboardTab;')(
      mainWindow, () => url, nav, 7779, () => {});
    return { run: fn, log };
  }

  it('a window already on the dashboard gets the bare hash (a same-page jump), and is brought forward', () => {
    const t = show({ url: 'http://127.0.0.1:7779/' });
    t.run('myparses');
    expect(t.log).toEqual(['show', 'focus', 'loadURL http://127.0.0.1:7779/#myparses']);
  });

  it('a window still on loading, welcome or settings goes through the normal dashboard navigation, hash and all', () => {
    const t = show({ url: 'file:///C:/Mimic/loading.html' });
    t.run('myparses');
    expect(t.log).toEqual(['show', 'focus', 'navigate tray-myparses #myparses']);
  });

  it('restores a minimized window first, does nothing without one, and cleans the tab name', () => {
    const m = show({ url: 'http://127.0.0.1:7779/', minimized: true });
    m.run('myparses');
    expect(m.log.slice(0, 3)).toEqual(['restore', 'show', 'focus']);
    for (const t of [show({ win: false }), show({ destroyed: true })]) { t.run('myparses'); expect(t.log).toEqual([]); }
    const dirty = show({ url: 'http://127.0.0.1:7779/' });
    dirty.run('my parses/../x');
    expect(dirty.log[dirty.log.length - 1]).toBe('loadURL http://127.0.0.1:7779/#myparsesx');
  });

  it('navigateToDashboard puts the hash on the address it loads, and still loads the bare dashboard without one', async () => {
    const src = sliceBlock(MAIN, 'function navigateToDashboard(reason, hash) {', '\n}\n');
    const loaded = [];
    const mainWindow = { isDestroyed: () => false, webContents: { session: { clearCache: async () => {} }, loadURL: async (u) => { loaded.push(u); } } };
    const make = new Function('mainWindow', 'agentPort', 'appendAgentLog', '_curWindowUrl', 'let _dashNavSeq = 0;\n' + src + '\nreturn navigateToDashboard;');
    const nav = make(mainWindow, 7779, () => {}, () => 'x');
    nav('agent-restart');
    nav('tray-myparses', '#myparses');
    await tick(); await tick();
    expect(loaded).toEqual(['http://127.0.0.1:7779/', 'http://127.0.0.1:7779/#myparses']);
  });

  it('the open-external allow-list was not widened for this: the same hosts as before', () => {
    const re = sliceBlock(MAIN, 'const ALLOW = /', '/i;');
    for (const host of ['wolfpack\\.quest', 'github\\.com\\/davehess\\/QuarmBossTracker', '(www\\.)?eqprogression\\.com\\/', '(www\\.)?pqdi\\.cc\\/', '(www\\.)?youtube\\.com\\/watch', 'youtu\\.be\\/']) {
      expect(re).toContain(host);
    }
    expect(re.match(/\|/g)).toHaveLength(5);                  // five separators between the six hosts — none added
  });
});
