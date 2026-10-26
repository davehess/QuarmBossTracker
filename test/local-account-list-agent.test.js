// test/local-account-list-agent.test.js — the agent's side of the local inventory page's account list.
//
// The guild lead (2026-10-26): the local page guessed 23 game accounts for someone who owns 6; the website knows
// the real list. The agent asks the bot for the signed-in person's OWN placements and serves them to the page,
// with an opt-out ("allow people to not include if they don't want to"). SOURCE-SLICE tier: the shipped
// functions are cut out of packages/wolfpack-logsync/index.js and run. What can go wrong without anyone noticing:
//   * the opt-out only hides the list in the UI while the request still goes out (or goes out ONCE before the
//     saved OFF is read from disk);
//   * a signed-out, local-mode or old-bot agent errors the whole page instead of failing open to guessing;
//   * the page reload hammers the bot (no cache), or a failed refresh throws away the last good list;
//   * the log-edge reader pulls a multi-gigabyte log into memory, or reports a time from the wrong end;
//   * the local inventory response loses the per-character log times the one-off and stale rules need.
// Run: npx vitest run test/local-account-list-agent.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const tsBlock = sliceBlock(src, 'const TS_RX = ', 'return isNaN(d.getTime()) ? null : d;\n}');
const rxLine = sliceBlock(src, 'const INVENTORY_FILENAME_RX =', '/i;');
const parseBlock = sliceBlock(src, 'function parseInventoryFileForUpload(', 'return rows;\n}');
const placementsBlock = sliceBlock(src, 'const ACCOUNT_PLACEMENTS_TTL_MS', "} catch { _placementsFailAt = now; return keep('offline'); }\n}");
const localBlock = sliceBlock(src, 'function _localInventorySnapshot(',
  "return res.end(JSON.stringify({ ok: true, use_account_list: _optinState.useAccountList !== false }));\n}");

const PRELUDE = `
  const _optinState = ctx.optin;
  const _uploadOpts = ctx.uploadOpts;
  let _mimicSessionToken = ctx.token;
  const _characterModesWhyNot = () => ctx.why;
  const _characterPrefsHeaders = () => ({ Authorization: 'Bearer test-token', 'X-Wolfpack-Mimic-Session': 'test-session' });
  const _scanOptInFiles = () => { ctx.scans++; if (ctx.savedOff) _optinState.useAccountList = false; _optinState.scanned = true; };
  const _saveOptInState = () => { ctx.saves++; };
  const scheduleRender = () => {};
  const _readBody = async () => ctx.body;
  const _localInventoryDirs = () => ctx.dirs;
`;
function make(over = {}) {
  const ctx = {
    optin: { useAccountList: true, scanned: true }, uploadOpts: { botUrl: 'http://bot.test/api/agent/encounter', token: 'x' },
    token: 'wpms_0123456789abcdef', why: null, scans: 0, saves: 0, savedOff: false, body: '', dirs: [],
    calls: [], fetch: null, ...over,
  };
  ctx.fetch = over.fetch || (async (url, opts) => { ctx.calls.push({ url, opts }); return reply(200, { ok: true, placements: PLACEMENTS }); });
  // eslint-disable-next-line no-new-func
  const api = new Function('ctx', 'fs', 'path', 'fetch',
    PRELUDE + rxLine + '\n' + tsBlock + '\n' + parseBlock + '\n' + placementsBlock + '\n' + localBlock
    + '\nreturn { fetchAccountPlacements, _cleanPlacements, _logEdgeTimes, _logEdgeTimesFromText, _localLogActivity, _localInventorySnapshot, _handleLocalInventory, _handleLocalAccountList };')(ctx, fs, path, (u, o) => ctx.fetch(u, o));
  return { ctx, api };
}
const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const PLACEMENTS = [
  { character: 'Aldenmar', accountId: 'acct-1', slot: 1, label: 'Bank alts' },
  { character: 'Brackwyn', accountId: 'acct-1', slot: 1, label: null },
];
function fakeRes() {
  const r = { code: 0, headers: {}, body: '', writeHead(c, h) { r.code = c; r.headers = h || {}; }, end(b) { r.body = b || ''; } };
  return r;
}

describe('fetchAccountPlacements', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T12:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('asks the bot for /account-placements with the session headers and returns the list', async () => {
    const { ctx, api } = make();
    const out = await api.fetchAccountPlacements();
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0].url).toBe('http://bot.test/api/agent/account-placements');
    expect(ctx.calls[0].opts.headers['X-Wolfpack-Mimic-Session']).toBe('test-session');
    expect(out).toEqual({ placements: PLACEMENTS, source: 'site' });
  });

  it('OPT-OUT: with the switch off no request is made at all', async () => {
    const { ctx, api } = make({ optin: { useAccountList: false, scanned: true } });
    expect(await api.fetchAccountPlacements()).toEqual({ placements: [], source: 'off' });
    expect(ctx.calls).toHaveLength(0);
  });
  it('OPT-OUT holds before anything has read the saved file: the saved OFF is loaded first', async () => {
    const { ctx, api } = make({ optin: { useAccountList: true, scanned: false }, savedOff: true });
    expect((await api.fetchAccountPlacements()).source).toBe('off');
    expect(ctx.scans).toBe(1);
    expect(ctx.calls).toHaveLength(0);
  });
  it('local mode and signed-out make no request and say why', async () => {
    for (const why of ['local', 'signed-out']) {
      const { ctx, api } = make({ why });
      expect(await api.fetchAccountPlacements()).toEqual({ placements: [], source: 'none', reason: why });
      expect(ctx.calls).toHaveLength(0);
    }
  });
  it('fails open: an old bot (404), an error, a bad body and a network failure all give no placements, never a throw', async () => {
    const cases = [
      [async () => reply(404, {}), 'bot-old'],
      [async () => reply(500, {}), 'offline'],
      [async () => reply(200, { ok: true }), 'bot-old'],
      [async () => { throw new Error('ECONNRESET'); }, 'offline'],
    ];
    for (const [fetch, reason] of cases) {
      const { api } = make({ fetch });
      expect(await api.fetchAccountPlacements()).toEqual({ placements: [], source: 'none', reason });
    }
  });
  it('a refused token (401/403) clears the list: it belonged to a sign-in that is gone', async () => {
    let status = 200;
    const { ctx, api } = make({ fetch: async () => reply(status, { ok: true, placements: PLACEMENTS }) });
    await api.fetchAccountPlacements();
    vi.setSystemTime(Date.now() + 16 * 60_000);
    status = 403;
    expect(await api.fetchAccountPlacements()).toEqual({ placements: [], source: 'none', reason: 'signed-out' });
    void ctx;
  });

  it('caches for 15 minutes; the Reload button asks again only after 30 seconds', async () => {
    const { ctx, api } = make();
    await api.fetchAccountPlacements();
    await api.fetchAccountPlacements();
    expect(ctx.calls).toHaveLength(1);
    vi.setSystemTime(Date.now() + 10_000);
    await api.fetchAccountPlacements({ fresh: true });
    expect(ctx.calls).toHaveLength(1);                           // 10 s: too soon, even for a reload
    vi.setSystemTime(Date.now() + 25_000);
    await api.fetchAccountPlacements({ fresh: true });
    expect(ctx.calls).toHaveLength(2);                           // 35 s: allowed
    vi.setSystemTime(Date.now() + 14 * 60_000);
    await api.fetchAccountPlacements();
    expect(ctx.calls).toHaveLength(2);                           // still inside 15 min of the last fetch
    vi.setSystemTime(Date.now() + 2 * 60_000);
    await api.fetchAccountPlacements();
    expect(ctx.calls).toHaveLength(3);
  });
  it('a failed refresh keeps the last good list, and is not retried for two minutes', async () => {
    let fail = false;
    const { ctx, api } = make({ fetch: async (url, opts) => { ctx.calls.push({ url, opts }); return fail ? reply(500, {}) : reply(200, { ok: true, placements: PLACEMENTS }); } });
    await api.fetchAccountPlacements();
    vi.setSystemTime(Date.now() + 16 * 60_000);
    fail = true;
    const out = await api.fetchAccountPlacements();
    expect(out).toEqual({ placements: PLACEMENTS, source: 'site', reason: 'offline' });
    expect(ctx.calls).toHaveLength(2);
    await api.fetchAccountPlacements();
    expect(ctx.calls).toHaveLength(2);                           // inside the retry hold
    vi.setSystemTime(Date.now() + 3 * 60_000);
    await api.fetchAccountPlacements();
    expect(ctx.calls).toHaveLength(3);
  });
  it('whatever the bot sends is cleaned: only well-formed rows, bounded strings', () => {
    const { api } = make();
    expect(api._cleanPlacements([
      { character: 'Aldenmar', accountId: 'a', slot: 2, label: '  Mules  ', extra: 'dropped' },
      { character: 5, accountId: 'a' }, null, { character: 'Brackwyn' }, { character: 'Corvale', accountId: 'b', slot: 'x', label: ' ' },
    ])).toEqual([
      { character: 'Aldenmar', accountId: 'a', slot: 2, label: 'Mules' },
      { character: 'Corvale', accountId: 'b', slot: null, label: null },
    ]);
    expect(api._cleanPlacements('nope')).toEqual([]);
  });
});

describe('the log edges', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-logedge-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
  const line = (t, msg = 'You say, \'hi\'') => `[${t}] ${msg}`;

  it('first time from the head, last time from the tail', () => {
    const { api } = make();
    const t = api._logEdgeTimesFromText(
      [line('Mon Oct 05 20:00:00 2026', 'Welcome to EverQuest!'), line('Mon Oct 05 20:01:00 2026')].join('\n'),
      ['cut mid li', line('Mon Oct 05 20:30:00 2026'), line('Mon Oct 05 20:45:10 2026'), 'a line with no time'].join('\n'));
    expect(t.first.getTime()).toBe(new Date('Mon Oct 05 20:00:00 2026').getTime());
    expect(t.last.getTime()).toBe(new Date('Mon Oct 05 20:45:10 2026').getTime());
    expect(api._logEdgeTimesFromText('', '')).toEqual({ first: null, last: null });
  });
  it('reads only the two ends of a big file', () => {
    const { api } = make();
    const f = path.join(tmp, 'eqlog_Zarrin_pq.proj.txt');
    const filler = Array.from({ length: 6000 }, (_, i) => line('Tue Oct 06 10:00:00 2026', 'filler ' + i)).join('\n');
    fs.writeFileSync(f, [line('Mon Oct 05 20:00:00 2026', 'Welcome'), filler, line('Wed Oct 07 23:59:59 2026', 'last')].join('\n') + '\n');
    expect(fs.statSync(f).size).toBeGreaterThan(200 * 1024);
    const e = api._logEdgeTimes(f);
    expect(e.first.getTime()).toBe(new Date('Mon Oct 05 20:00:00 2026').getTime());
    expect(e.last.getTime()).toBe(new Date('Wed Oct 07 23:59:59 2026').getTime());
    expect(api._logEdgeTimes(path.join(tmp, 'missing.txt'))).toBeNull();
    fs.writeFileSync(path.join(tmp, 'empty.txt'), '');
    expect(api._logEdgeTimes(path.join(tmp, 'empty.txt'))).toMatchObject({ first: null, last: null });
  });
  it('_localLogActivity joins a character\'s live logs across folders and ignores backups and other files', () => {
    const { api } = make();
    const a = path.join(tmp, 'a'), b = path.join(tmp, 'b');
    fs.mkdirSync(a); fs.mkdirSync(b);
    fs.writeFileSync(path.join(a, 'eqlog_Zarrin_pq.proj.txt'), line('Mon Oct 05 20:00:00 2026') + '\n' + line('Mon Oct 05 21:00:00 2026') + '\n');
    fs.writeFileSync(path.join(b, 'eqlog_Zarrin_pq.proj.txt'), line('Tue Oct 06 08:00:00 2026') + '\n' + line('Tue Oct 06 09:00:00 2026') + '\n');
    fs.writeFileSync(path.join(a, 'eqlog_Zarrin_pq.proj.txt.bak'), line('Mon Jan 01 00:00:00 2024') + '\n');
    fs.writeFileSync(path.join(a, 'notes.txt'), line('Mon Jan 01 00:00:00 2024') + '\n');
    const of = api._localLogActivity([a, b, path.join(tmp, 'nope')]);
    expect(of('zarrin').first.getTime()).toBe(new Date('Mon Oct 05 20:00:00 2026').getTime());
    expect(of('zarrin').last.getTime()).toBe(new Date('Tue Oct 06 09:00:00 2026').getTime());
    expect(of('aldenmar')).toBeNull();
  });
});

describe('the local responses', () => {
  let tmp, eq;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-localacct-'));
    eq = path.join(tmp, 'EQ');
    fs.mkdirSync(eq);
    fs.writeFileSync(path.join(eq, 'Aldenmar-Inventory.txt'), ['Location\tName\tID\tCount\tSlots', 'Primary\tRustfang Cleaver\t51001\t1\t0'].join('\r\n'));
    fs.writeFileSync(path.join(eq, 'eqlog_Aldenmar_pq.proj.txt'), '[Mon Oct 05 20:00:00 2026] Welcome\n[Mon Oct 05 20:30:00 2026] bye\n');
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('the snapshot carries each character\'s log times (null when there is no log)', () => {
    const { api } = make();
    fs.writeFileSync(path.join(eq, 'Brackwyn-Inventory.txt'), ['Location\tName\tID\tCount\tSlots', 'Head\tDented Helm\t51002\t1\t0'].join('\r\n'));
    const s = api._localInventorySnapshot([eq], api._localLogActivity([eq]));
    const ald = s.characters.find(c => c.name === 'Aldenmar'), bra = s.characters.find(c => c.name === 'Brackwyn');
    expect(ald.log_first_at).toBe(new Date('Mon Oct 05 20:00:00 2026').toISOString());
    expect(ald.log_last_at).toBe(new Date('Mon Oct 05 20:30:00 2026').toISOString());
    expect(bra).toMatchObject({ log_first_at: null, log_last_at: null });
    // and without the optional argument (the older call shape) nothing breaks
    expect(api._localInventorySnapshot([eq]).characters[0].log_last_at).toBeNull();
  });
  it('GET /api/local/inventory adds the placements, their source and the switch', async () => {
    const { api } = make({ dirs: [eq] });
    const res = fakeRes();
    await api._handleLocalInventory({ method: 'GET', url: '/api/local/inventory' }, res);
    const j = JSON.parse(res.body);
    expect(res.code).toBe(200);
    expect(j).toMatchObject({ placements: PLACEMENTS, placements_source: 'site', placements_reason: null, use_account_list: true });
    expect(j.rows.length).toBe(1);
  });
  it('with the switch off the page still gets its rows, and no placements', async () => {
    const { ctx, api } = make({ dirs: [eq], optin: { useAccountList: false, scanned: true } });
    const res = fakeRes();
    await api._handleLocalInventory({ method: 'GET', url: '/api/local/inventory' }, res);
    expect(JSON.parse(res.body)).toMatchObject({ placements: [], placements_source: 'off', use_account_list: false });
    expect(ctx.calls).toHaveLength(0);
  });
  it('?refresh=1 is passed through as a fresh ask', async () => {
    const { ctx, api } = make({ dirs: [eq] });
    await api._handleLocalInventory({ method: 'GET', url: '/api/local/inventory' }, fakeRes());
    await api._handleLocalInventory({ method: 'GET', url: '/api/local/inventory?refresh=1' }, fakeRes());
    expect(ctx.calls).toHaveLength(1);            // inside the 30 s floor, so still one request
  });
  it('POST /api/local/account-list flips the switch and persists it; anything but a boolean is refused', async () => {
    const { ctx, api } = make({ body: JSON.stringify({ use: false }) });
    let res = fakeRes();
    await api._handleLocalAccountList({ method: 'POST', url: '/api/local/account-list' }, res);
    expect(JSON.parse(res.body)).toEqual({ ok: true, use_account_list: false });
    expect(ctx.optin.useAccountList).toBe(false);
    expect(ctx.saves).toBe(1);
    for (const bad of ['{"use":"no"}', '{"use":0}', '{}', 'not json']) {
      ctx.body = bad; res = fakeRes();
      await api._handleLocalAccountList({ method: 'POST', url: '/api/local/account-list' }, res);
      expect(res.code).toBe(400);
    }
    expect(ctx.optin.useAccountList).toBe(false);
    expect(ctx.saves).toBe(1);
    res = fakeRes();
    await api._handleLocalAccountList({ method: 'PUT', url: '/api/local/account-list' }, res);
    expect(res.code).toBe(405);
  });
  it('turning it OFF drops the cached list, so a later ON asks again rather than serving old data', async () => {
    const { ctx, api } = make({ body: JSON.stringify({ use: false }) });
    await api.fetchAccountPlacements();
    expect(ctx.calls).toHaveLength(1);
    await api._handleLocalAccountList({ method: 'POST' }, fakeRes());
    ctx.body = JSON.stringify({ use: true });
    await api._handleLocalAccountList({ method: 'POST' }, fakeRes());
    await api.fetchAccountPlacements();
    expect(ctx.calls).toHaveLength(2);
  });
});

describe('wiring', () => {
  const code = stripJs(src);
  it('the new local route sits behind the one local-request guard', () => {
    const guard = code.indexOf('if (_localGuardBlock(req, res)) return;');
    const at = code.indexOf('return _handleLocalAccountList(req, res);');
    expect(guard).toBeGreaterThan(0);
    expect(at).toBeGreaterThan(guard);
  });
  it('the switch is saved and loaded with the other opt-ins, default ON', () => {
    expect(code).toMatch(/_optinState\.useAccountList\s*=\s*\(raw\.useAccountList !== false\)/);
    expect(code).toMatch(/useAccountList:\s+_optinState\.useAccountList !== false,/);
    expect(code).toMatch(/useAccountList: true,/);
  });
  it('the dashboard card exists, with its switch wired to the same route', () => {
    const dash = stripJs(fs.readFileSync(path.join(path.dirname(AGENT_INDEX), 'dashboard.html'), 'utf8'));
    expect(dash).toMatch(/id="wpUseAccountList"/);
    expect(dash).toMatch(/fetch\('\/api\/local\/account-list', \{ method: 'POST'/);
  });
});
