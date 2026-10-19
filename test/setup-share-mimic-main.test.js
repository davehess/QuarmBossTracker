// test/setup-share-mimic-main.test.js — the main-process half of "Share a whole setup" (the guild lead, 2026-10-19,
// DECISIONS §383), run WITHOUT Electron.
//
// main.js is one 14k-line file that needs Electron to load, so the whole "Share a WHOLE setup" section is sliced out of the
// real source (between its two comment anchors) and evaluated against stand-ins for everything outside it (the windows, the
// dialogs, the engine, the sets file, the screen). That is the shipped code running: edit it and these tests run the new
// behaviour; rename an anchor and the slice throws loudly. What it CANNOT prove is how Electron behaves — see the list in the
// last describe, which is what a Windows tester has to check.
//
// Run: npx vitest run test/setup-share-mimic-main.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const MIMIC = path.join(ROOT, 'apps', 'mimic');
const mainSrc = readSource(path.join(MIMIC, 'main.js'));
const START = '// ── Share a WHOLE setup: a file, or a six-character code';
const END = "// Tray: the sets by name (the active character's current one ticked), next,";
const section = sliceBlock(mainSrc, START, END);
const sectionCode = stripJs(section);

const setupBundle = require(path.join(MIMIC, 'setupBundle.js'));
const overlaySets = require(path.join(MIMIC, 'overlaySets.js'));
const portableLayout = require(path.join(MIMIC, 'portableLayout.js'));
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'portable-layout.json'), 'utf8'));

// ── The harness ─────────────────────────────────────────────────────────────
let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-setup-main-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function load(over = {}) {
  const log = [];                       // appendAgentLog lines
  const handlers = {};                  // ipcMain.handle
  const engineCalls = [];               // _agentCall
  const lsWrites = [];                  // what the hidden page was told to run
  const windows = [];                   // BrowserWindows created
  const dialogs = [];                   // showMessageBox / showSaveDialog / showOpenDialog
  const clip = [];
  const state = Object.assign({
    token: 'wpms_' + 'a'.repeat(64), base: 'https://bot.example.test', activeChar: 'Dunmore', cfg: {},
    engine: { ok: true, triggers: [], rules: {}, chars: ['Dunmore', 'Evelyn'] },
    applyReply: { ok: true, added: 0, updated: 0, backups: [] },
    restoreReply: { ok: true },
    ls: {},                              // what the overlays have in localStorage
    lsFail: false, msgResponses: [], saveTo: null, openFrom: null, box: [],
  }, over);
  const sets = path.join(tmp, 'overlay-sets.json');
  class FakeWin {
    constructor(opts) { this.opts = opts; this.destroyed = false; this.handlers = {}; this.webContents = { id: windows.length, executeJavaScript: async (js) => this._js(js), reload() { this.reloaded = true; } }; windows.push(this); }
    async loadFile(f) { this.file = f; }
    setMenu() {} show() {} focus() {} close() { this.destroyed = true; (this.handlers.closed || (() => {}))(); }
    destroy() { this.destroyed = true; } isDestroyed() { return this.destroyed; }
    on(ev, fn) { this.handlers[ev] = fn; }
    _js(js) {
      if (/localStorage.length/.test(js)) return JSON.stringify(state.ls);
      lsWrites.push(js);
      if (state.lsFail) return false;
      // run the real script against a fake localStorage
      const store = new Map(Object.entries(state.ls));
      const fake = { setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
      const ok = new Function('localStorage', 'return ' + js)(fake);
      if (ok) state.ls = Object.fromEntries(store);
      return ok;
    }
  }
  FakeWin.getFocusedWindow = () => null;
  const dialog = {
    showMessageBox: async (_w, o) => { dialogs.push({ kind: 'box', o }); const r = state.msgResponses.shift(); return { response: r === undefined ? 0 : r }; },
    showSaveDialog: async (_w, o) => { dialogs.push({ kind: 'save', o }); return state.saveTo ? { canceled: false, filePath: state.saveTo } : { canceled: true }; },
    showOpenDialog: async (_w, o) => { dialogs.push({ kind: 'open', o }); return state.openFrom ? { canceled: false, filePaths: [state.openFrom] } : { canceled: true }; },
  };
  const entries = [];
  const reqLib = (id) => (id === 'http' ? require('node:http') : id === 'https' ? require('node:https') : null);
  const fakeRequire = (id) => {
    if (id === './setupBundle') return setupBundle;
    if (id === 'electron') return { clipboard: { writeText: (t) => clip.push(t) } };
    const lib = reqLib(id);
    if (lib) return lib;
    throw new Error('unexpected require ' + id);
  };
  const deps = {
    require: fakeRequire, ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, BrowserWindow: FakeWin, dialog,
    app: { getPath: () => tmp }, path, fs, Buffer, URL,
    loadConfig: () => state.cfg, resolveUploadToken: () => state.token, _botBaseUrl: () => state.base,
    appendAgentLog: (s) => log.push(s),
    _wpPrefs: (n) => ({ name: n }), _live: (w) => !!(w && !w.isDestroyed()),
    _overlayEntries: () => entries,
    _agentCall: async (method, route, body) => { engineCalls.push({ method, route, body }); if (route === '/api/setup-share/triggers' && method === 'GET') return state.engine; if (route === '/api/setup-share/triggers/restore') return state.restoreReply; if (route === '/api/setup-share/triggers') return state.applyReply; return null; },
    get _activeCharName() { return state.activeChar; },
    portableLayout, overlaySets, _SETS_FILE: () => sets,
    _captureOverlaySet: () => ({ show: { showCanvas: false, showWho: true }, sig: 'S', rects: {}, look: {}, eq: null, canvas: state.canvas || null }),
    _layoutOfSet: (set) => (set && set.__layout ? { layout: set.__layout, screen: { width: 1920, height: 1080 }, eq: null, offScreen: 0 } : null),
    _canvasDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }), _eqMainWindow: () => null,
    _canvasSpec: (k) => ({ flag: 'show_' + k }),
    _overlaySetCommand: (cmd, who) => { cmdLog.push(cmd); if (cmd.verb === 'load') { const st = overlaySets.load(sets); overlaySets.use(st, cmd.name, who); overlaySets.save(sets, st); } return { ok: true }; },
    buildTrayMenu: () => {}, BASE: null,
  };
  const cmdLog = [];
  const names = ['_setupShareAuth', '_botSetupShare', '_withStorage', '_lsRead', '_lsWrite', '_reloadOverlayWindows', '_setupMyChars', '_collectSetup', '_collectSummary',
    '_exportSetupFile', '_getSetupCode', '_openSetupWindow', '_importSetupFile', '_enterSetupCode', '_setupState', '_applySetup', '_addSetupLayouts', '_undoSetup',
    '_setupFlowGet', '_setupFlowSet', '_setupWinGet'];
  const body = section + `
    const _setupFlowGet = () => _setupFlow, _setupFlowSet = (v) => { _setupFlow = v; }, _setupWinGet = () => _setupWin;
    return { ${names.join(', ')} };`;
  const argNames = Object.keys(deps).filter(k => k !== 'BASE');
  // eslint-disable-next-line no-new-func
  const api = new Function(...argNames, body)(...argNames.map(k => deps[k]));
  return { api, state, log, handlers, engineCalls, lsWrites, windows, dialogs, clip, cmdLog, sets, entries, deps };
}
const layoutOf = (title) => { const r = portableLayout.fromPortable(fixture.docs.screen1080, { width: 1920, height: 1080 }, null, { stamp: 't' }); expect(r.ok).toBe(true); return Object.assign(r.layout, { __t: title }); };
const writeSets = (file, defs) => {
  const st = overlaySets.empty();
  for (const [name, layout] of defs) overlaySets.put(st, name, Object.assign({ show: {}, sig: 'S', rects: {}, look: {}, eq: null, canvas: null }, { __layout: layout }), 'dunmore');
  overlaySets.save(file, st);
};

describe('the section is found and has what the tray, Settings and the dashboard call', () => {
  it('slices the real source', () => {
    expect(section.length).toBeGreaterThan(8000);
    for (const fn of ['_exportSetupFile', '_getSetupCode', '_importSetupFile', '_enterSetupCode', '_applySetup', '_undoSetup', '_botSetupShare', '_lsRead', '_lsWrite']) {
      expect(sectionCode, fn).toMatch(new RegExp(`function ${fn}\\(`));
    }
  });
});

describe('_botSetupShare: the one place the sign-in is used', () => {
  let server, port, seen;
  beforeEach(async () => {
    seen = [];
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
        const rule = server.rule || (() => [200, { ok: true }]);
        const [status, json, headers] = rule(req);
        res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, headers || {}));
        res.end(typeof json === 'string' ? json : JSON.stringify(json));
      });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });
  afterEach(async () => { await new Promise(r => server.close(r)); });

  it('sends the Mimic session as the bearer to /api/agent/setup-share, and reads status, body and Retry-After', async () => {
    const h = load({ base: 'http://127.0.0.1:' + port });
    server.rule = () => [429, { error: 'rate_limited' }, { 'Retry-After': '90' }];
    const r = await h.api._botSetupShare('POST', '', { setup: { a: 1 } });
    expect(r).toMatchObject({ status: 429, retry: 90, body: { error: 'rate_limited' } });
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/agent/setup-share', auth: 'Bearer ' + h.state.token });
    expect(JSON.parse(seen[0].body)).toEqual({ setup: { a: 1 } });
    await h.api._botSetupShare('GET', '/ABC234');
    await h.api._botSetupShare('DELETE', '/ABC234');
    expect(seen.slice(1).map(s => [s.method, s.url])).toEqual([['GET', '/api/agent/setup-share/ABC234'], ['DELETE', '/api/agent/setup-share/ABC234']]);
  });

  it('with no sign-in it makes NO request at all', async () => {
    const h = load({ base: 'http://127.0.0.1:' + port, token: null });
    expect(await h.api._botSetupShare('GET', '/ABC234')).toEqual({ status: 0, signedOut: true });
    expect(seen).toEqual([]);
  });

  it('never rejects: an unreachable server, a reply that is not JSON, and an oversized reply are all answers', async () => {
    const dead = load({ base: 'http://127.0.0.1:1' });
    expect(await dead.api._botSetupShare('GET', '/ABC234')).toEqual({ status: 0 });
    const h = load({ base: 'http://127.0.0.1:' + port });
    server.rule = () => [502, 'bad gateway'];
    expect(await h.api._botSetupShare('GET', '/ABC234')).toMatchObject({ status: 502, body: null });
    server.rule = () => [200, 'x'.repeat(3 * 1024 * 1024)];
    expect((await h.api._botSetupShare('GET', '/ABC234')).status).toBe(0);
  });
});

describe('localStorage: only the keys setupBundle marks readable, through a hidden page', () => {
  it('reads shared options and the HUD builder, and nothing private or unmarked', async () => {
    const h = load({ ls: { 'wp.damageTabMode': 'tank', 'wpHudParts:dunmore': '{"ring":1}', 'wp:bufferClass': 'Cleric', 'wpMeCardBounds': '{}', 'wpUnmarked': 'x', 'chchain_mute': '1' } });
    expect(await h.api._lsRead()).toEqual({ 'wp.damageTabMode': 'tank', 'wpHudParts:dunmore': '{"ring":1}', 'chchain_mute': '1' });
    expect(h.windows).toHaveLength(1);
    expect(h.windows[0].opts).toMatchObject({ show: false, skipTaskbar: true });
    expect(h.windows[0].file).toBe('storage.html');
    expect(h.windows[0].destroyed).toBe(true);                 // the page does not linger
  });

  it('writes only readable keys and short strings; null removes a key; the rest of the store is untouched', async () => {
    const h = load({ ls: { 'wp:bufferClass': 'Cleric', 'wp.deepsRows': '10' } });
    await h.api._lsWrite({ 'wp.deepsRows': '20', 'wpHudParts:evelyn': '{"ring":0}', 'wp:bufferClass': 'Wizard', 'wpMeCardBounds': '{"x":1}', 'somethingNew': 'x', 'wp.damageTabMode': 'x'.repeat(9000) });
    expect(h.state.ls).toEqual({ 'wp:bufferClass': 'Cleric', 'wp.deepsRows': '20', 'wpHudParts:evelyn': '{"ring":0}' });
    await h.api._lsWrite({ 'wpHudParts:evelyn': null });
    expect(h.state.ls).toEqual({ 'wp:bufferClass': 'Cleric', 'wp.deepsRows': '20' });
  });

  it('nothing to write opens no page; a script cannot be broken out of by a value', async () => {
    const h = load();
    expect(await h.api._lsWrite({ 'wpMeCardBounds': 'x' })).toBe(true);
    expect(h.windows).toHaveLength(0);
    await h.api._lsWrite({ 'wpHudParts:dunmore': '{"a":"  \\"});alert(1);(\\""}' });
    expect(h.state.ls['wpHudParts:dunmore']).toBe('{"a":"  \\"});alert(1);(\\""}');
  });

  it('reloads only the windows that read what changed (and the Canvas), never the trigger window', () => {
    const h = load();
    const mk = () => ({ isDestroyed: () => false, webContents: { reload() { this.reloaded = true; } } });
    const w = { hud: mk(), who: mk(), trigger: mk(), me: mk(), canvas: mk(), melody: mk() };
    for (const [k, v] of Object.entries(w)) h.entries.push([k, v]);
    h.api._reloadOverlayWindows(['wp.damageTabMode', 'wpHudParts:dunmore']);
    expect(Object.fromEntries(Object.entries(w).map(([k, v]) => [k, !!v.webContents.reloaded]))).toEqual({ hud: true, who: false, trigger: false, me: true, canvas: true, melody: false });
  });
});

describe('the characters on this PC: only what the engine reports, the active one first', () => {
  it('puts the active character first, adds it when the engine did not list it, and drops anything that is not a name', async () => {
    const a = load({ engine: { ok: true, chars: ['Evelyn', 'Dunmore'] }, activeChar: 'Dunmore' });
    expect(await a.api._setupMyChars()).toEqual(['Dunmore', 'Evelyn']);
    const b = load({ engine: { ok: true, chars: ['Evelyn'] }, activeChar: 'Dunmore' });
    expect(await b.api._setupMyChars()).toEqual(['Dunmore', 'Evelyn']);
    const c = load({ engine: { ok: true, chars: ['Evelyn', 'Bad Name!', '../x', '', 5, 'A'.repeat(30), 'Fen'] }, activeChar: null });
    expect(await c.api._setupMyChars()).toEqual(['Evelyn', 'Fen']);
    const d = load({ engine: null, activeChar: 'Dunmore' });
    expect(await d.api._setupMyChars()).toEqual(['Dunmore']);
  });
});

describe('collecting a setup from this PC', () => {
  const eng = (over) => ({ ok: true, chars: ['Dunmore', 'Evelyn'], triggers: [{ id: 'p_1', name: 'Rain', pattern: 'rain', actions: [{ type: 'text_overlay', text: 'x' }], characters: ['dunmore'] }],
    rules: { 'personal:p_1': { '*': 'off', dunmore: 'overlay' } }, ...over });

  it('puts the screen now, every saved set, the HUD, the options, triggers and rules into one bundle, with no names', async () => {
    const h = load({ engine: eng(), ls: { 'wp.damageTabMode': 'tank', 'wpHudParts:dunmore': '{"ring":1}' }, canvas: null });
    writeSets(h.sets, [['Raid', layoutOf('r')], ['Group', layoutOf('g')], ['No canvas', null]]);
    const r = await h.api._collectSetup({ title: 'Night', author: 'Aldenmar' });
    expect(r.ok, r.message).toBe(true);
    expect(r.setup.meta).toEqual({ title: 'Night', byline: 'Aldenmar', note: '' });
    expect(r.setup.layouts.map(l => l.name)).toEqual(['Group', 'Raid']);       // the saved sets by name; "No canvas" has nothing to export
    expect(r.setup.options).toEqual({ overlay: { tab: 'tank' } });
    expect(r.setup.hud).toEqual([{ slot: 'c1', parts: { ring: 1 } }]);
    expect(r.setup.triggers[0]).toMatchObject({ for: ['c1'] });
    expect(JSON.stringify(r.setup).toLowerCase()).not.toContain('dunmore');
    expect(h.engineCalls[0]).toMatchObject({ method: 'GET', route: '/api/setup-share/triggers' });
  });

  it('says so, in a sentence, when the engine is not running', async () => {
    const h = load({ engine: null });
    const r = await h.api._collectSetup({});
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/parser engine is not running/);
  });

  it('a hidden page that cannot be read does not stop the rest', async () => {
    const h = load({ engine: eng(), ls: {} });
    h.state.lsFail = true;
    h.deps = null;
    const r = await h.api._collectSetup({});
    expect(r.ok, r.message).toBe(true);
    expect(r.setup.triggers).toHaveLength(1);
  });
});

describe('Export to a file', () => {
  const engine = { ok: true, chars: ['Dunmore'], triggers: [{ id: 'p_1', name: 'Rain', pattern: 'rain', actions: [{ type: 'text_overlay', text: 'x' }] }], rules: {} };

  it('asks first (with what goes in and what never does), then saves, and writes only what build produced', async () => {
    const file = path.join(tmp, 'mine.mimic-setup.json');
    const h = load({ engine, saveTo: file, msgResponses: [0] });
    const r = await h.api._exportSetupFile({ title: 'Raid night' });
    expect(r.ok, r.message).toBe(true);
    const box = h.dialogs.find(d => d.kind === 'box').o;
    expect(box.message).toMatch(/Raid night/);
    expect(box.detail).toMatch(/1 personal trigger/);
    expect(box.detail).toMatch(/Never included: your sign-in, tokens, EverQuest and log paths, bids/);
    expect(h.dialogs.map(d => d.kind)).toEqual(['box', 'save']);
    const written = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(written).toMatchObject({ format: 'mimic-setup', version: 1, meta: { title: 'Raid night' } });
    expect(setupBundle.parseText(fs.readFileSync(file, 'utf8')).ok).toBe(true);
    expect(fs.readdirSync(tmp).filter(f => f.endsWith('.tmp'))).toEqual([]);
  });

  it('cancelling at either dialog writes nothing', async () => {
    const a = load({ engine, msgResponses: [1] });
    expect(await a.api._exportSetupFile({})).toMatchObject({ ok: false, canceled: true });
    const b = load({ engine, msgResponses: [0], saveTo: null });
    expect(await b.api._exportSetupFile({})).toMatchObject({ ok: false, canceled: true });
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it('works signed out and offline: a file needs no token and makes no request', async () => {
    const file = path.join(tmp, 'a.json');
    const h = load({ engine, token: null, base: 'http://127.0.0.1:1', saveTo: file, msgResponses: [0] });
    expect((await h.api._exportSetupFile({})).ok).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('one window at a time', async () => {
    const h = load({ engine, saveTo: path.join(tmp, 'a.json'), msgResponses: [0] });
    const first = h.api._exportSetupFile({});
    expect((await h.api._exportSetupFile({})).message).toMatch(/already open/);
    await first;
  });
});

describe('Get a code', () => {
  let server, port, seen;
  beforeEach(async () => {
    seen = [];
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => { seen.push({ method: req.method, url: req.url, body }); const [s, j, hd] = (server.rule || (() => [200, { ok: true }]))(req); res.writeHead(s, Object.assign({ 'Content-Type': 'application/json' }, hd || {})); res.end(JSON.stringify(j)); });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });
  afterEach(async () => { await new Promise(r => server.close(r)); });
  const engine = { ok: true, chars: ['Dunmore'], triggers: [{ id: 'p_1', name: 'Rain', pattern: 'rain', actions: [{ type: 'text_overlay', text: 'x' }] }], rules: {} };

  it('signed out: refused BEFORE anything is read or asked, with the way forward', async () => {
    const h = load({ engine, token: null });
    const r = await h.api._getSetupCode({});
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Sign in to Mimic first.*a file works without signing in/);
    expect(h.engineCalls).toEqual([]);
    expect(h.dialogs).toEqual([]);
  });

  it('asks first, posts the same bundle a file would hold, shows the code, and copies it on request', async () => {
    const h = load({ engine, base: 'http://127.0.0.1:' + port, msgResponses: [0, 0] });
    server.rule = () => [201, { ok: true, code: 'ABC234', expires_at: '2026-10-21T12:00:00.000Z', ttl_hours: 24 }];
    const r = await h.api._getSetupCode({ title: 'Raid night' });
    expect(r).toMatchObject({ ok: true, told: true, code: 'ABC234' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/agent/setup-share' });
    expect(setupBundle.validate(JSON.parse(seen[0].body).setup).ok).toBe(true);
    expect(h.dialogs[0].o.detail).toMatch(/24 hours/);
    expect(h.dialogs[1].o.message).toBe('Your code is ABC-234');
    expect(h.clip).toEqual(['ABC234']);
    expect(h.log.join('')).not.toMatch(/ABC234|wpms_/);                       // the code and the token are not logged
  });

  it('cancelling the question posts nothing', async () => {
    const h = load({ engine, base: 'http://127.0.0.1:' + port, msgResponses: [1] });
    expect(await h.api._getSetupCode({})).toMatchObject({ ok: false, canceled: true });
    expect(seen).toEqual([]);
  });

  it('"End this code now" deletes it on the server', async () => {
    const h = load({ engine, base: 'http://127.0.0.1:' + port, msgResponses: [0, 2] });
    server.rule = (req) => (req.method === 'POST' ? [201, { ok: true, code: 'ABC234', expires_at: 'x' }] : [200, { ok: true }]);
    const r = await h.api._getSetupCode({});
    expect(r).toMatchObject({ ok: true, message: 'That code no longer works.' });
    expect(seen.map(s => [s.method, s.url])).toEqual([['POST', '/api/agent/setup-share'], ['DELETE', '/api/agent/setup-share/ABC234']]);
  });

  it.each([[429, 'a lot of codes'], [401, 'sign-in has ended'], [503, 'busy'], [400, 'private']])('a %i from the bot is one plain sentence', async (status, frag) => {
    const h = load({ engine, base: 'http://127.0.0.1:' + port, msgResponses: [0] });
    server.rule = () => [status, status === 400 ? { error: 'not_shareable', message: 'a path is private' } : { error: 'x' }, { 'Retry-After': '600' }];
    const r = await h.api._getSetupCode({});
    expect(r.ok).toBe(false);
    expect(r.message).toContain(frag);
    expect(r.message).not.toMatch(/wpms_|Bearer/);
  });
});

describe('Import: from a file, or from a code, into the preview window', () => {
  const good = () => setupBundle.build({ meta: { title: 'Their night' }, layouts: [{ name: 'Raid', active: true, doc: fixture.docs.screen1080 }],
    hud: { aldenmar: { ring: 1 } }, options: { who: { zekOnly: true } },
    triggers: [{ id: 'p_1', name: 'Rain', pattern: 'rain', actions: [{ type: 'text_overlay', text: 'x' }], characters: ['aldenmar'] }, { id: 'p_2', name: 'Mez', pattern: 'mez', actions: [{ type: 'text_overlay', text: 'm' }] }],
    rules: { 'personal:p_1': { '*': 'off' } }, ownChars: ['Aldenmar'] }).setup;

  it('a file: parsed and checked, then the window opens at the preview with the model', async () => {
    const f = path.join(tmp, 'their.json');
    fs.writeFileSync(f, JSON.stringify(good()));
    const h = load({ openFrom: f });
    const r = await h.api._importSetupFile();
    expect(r).toMatchObject({ ok: true, told: true });
    expect(h.windows).toHaveLength(1);
    expect(h.windows[0].file).toBe('setup-share.html');
    expect(h.windows[0].opts.skipTaskbar).toBe(true);
    const st = h.api._setupState();
    expect(st.stage).toBe('preview');
    expect(st.model.title).toBe('Their night');
    expect(st.model.mine).toEqual(['Dunmore', 'Evelyn']);
    expect(st.model.assign).toEqual({ c1: ['Dunmore'] });
  });

  it('a bad file is a sentence, and no window opens', async () => {
    const f = path.join(tmp, 'bad.json');
    fs.writeFileSync(f, JSON.stringify({ format: 'mimic-layout' }));
    const h = load({ openFrom: f });
    const r = await h.api._importSetupFile();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not a Mimic setup/);
    expect(h.windows).toEqual([]);
    const big = path.join(tmp, 'big.json');
    fs.writeFileSync(big, 'x'.repeat(setupBundle.MAX_BYTES + 1));
    const h2 = load({ openFrom: big });
    expect((await h2.api._importSetupFile()).message).toMatch(/too big/);
    expect(await load({ openFrom: null }).api._importSetupFile()).toMatchObject({ canceled: true });
  });

  it('works signed out: a file needs no sign-in (the code box does)', async () => {
    const f = path.join(tmp, 'their.json');
    fs.writeFileSync(f, JSON.stringify(good()));
    const h = load({ openFrom: f, token: null });
    expect((await h.api._importSetupFile()).ok).toBe(true);
    const e = load({ token: null });
    expect((await e.api._enterSetupCode()).message).toMatch(/Sign in to Mimic first/);
    expect(e.windows).toEqual([]);
  });

  it('a code: the window opens at the code box; a lookup validates the bot\'s answer again before it is shown', async () => {
    const h = load();
    expect(await h.api._enterSetupCode()).toMatchObject({ ok: true, told: true });
    expect(h.api._setupState().stage).toBe('code');
    const win = h.windows[0];
    const ev = { sender: win.webContents };
    // a bad code never reaches the bot
    expect((await h.handlers['setup-share-lookup'](ev, 'ABC10')).message).toMatch(/six letters and numbers/);
    // someone else's window may not drive it
    expect((await h.handlers['setup-share-lookup']({ sender: {} }, 'ABC234')).ok).toBe(false);
    expect((await h.handlers['setup-share-apply']({ sender: {} }, {}, {})).ok).toBe(false);
  });
});

describe('Enter a code: the answer is checked again before it is shown', () => {
  let server, port, seen, rule;
  beforeEach(async () => {
    seen = []; rule = () => [404, { error: 'not_found' }];
    server = http.createServer((req, res) => { seen.push({ method: req.method, url: req.url, auth: req.headers.authorization }); const [st, j, hd] = rule(req); res.writeHead(st, Object.assign({ 'Content-Type': 'application/json' }, hd || {})); res.end(JSON.stringify(j)); });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });
  afterEach(async () => { await new Promise(r => server.close(r)); });
  const theirs = () => setupBundle.build({ meta: { title: 'Their night' }, hud: { aldenmar: { ring: 1 } }, options: { who: { zekOnly: true } },
    triggers: [{ id: 'p_1', name: 'Rain', pattern: 'rain', actions: [{ type: 'text_overlay', text: 'x' }] }], ownChars: ['Aldenmar'] }).setup;
  const open = async (h) => { await h.api._enterSetupCode(); return { sender: h.windows[0].webContents }; };

  it('a good code: GET with the bearer, the setup validated, the window moves to the preview', async () => {
    const h = load({ base: 'http://127.0.0.1:' + port });
    rule = () => [200, { ok: true, code: 'ABC234', expires_at: 'x', setup: theirs() }];
    const ev = await open(h);
    const r = await h.handlers['setup-share-lookup'](ev, 'abc-234');
    expect(r.ok).toBe(true);
    expect(r.state.stage).toBe('preview');
    expect(r.state.model.title).toBe('Their night');
    expect(r.state.model.mine).toEqual(['Dunmore', 'Evelyn']);
    expect(seen).toEqual([{ method: 'GET', url: '/api/agent/setup-share/ABC234', auth: 'Bearer ' + h.state.token }]);
  });

  it('a setup with a sign-in in it, even from the bot, is refused with a sentence and never shown', async () => {
    const h = load({ base: 'http://127.0.0.1:' + port });
    const bad = theirs();
    bad.options = { overlay: { apiKey: 'x' } };
    rule = () => [200, { ok: true, code: 'ABC234', expires_at: 'x', setup: bad }];
    const ev = await open(h);
    const r = await h.handlers['setup-share-lookup'](ev, 'ABC234');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/private/);
    expect(h.api._setupState().stage).toBe('code');
  });

  it('an unknown or expired code, a wrong-shaped code and a busy server each say so; the wrong shape never reaches the bot', async () => {
    const h = load({ base: 'http://127.0.0.1:' + port });
    const ev = await open(h);
    expect((await h.handlers['setup-share-lookup'](ev, 'ZZZZZZ')).message).toBe('That code is not valid, or it has expired.');
    expect((await h.handlers['setup-share-lookup'](ev, 'ZZZ')).message).toMatch(/six letters and numbers/);
    rule = () => [429, { error: 'rate_limited' }, { 'Retry-After': '120' }];
    expect((await h.handlers['setup-share-lookup'](ev, 'ZZZZZZ')).message).toMatch(/Too many tries.*2 minutes/);
    expect(seen).toHaveLength(2);
  });

  it('a window that is not the import window gets nothing, and the bot is not asked', async () => {
    const h = load({ base: 'http://127.0.0.1:' + port });
    await open(h);
    for (const [ch, args] of [['setup-share-lookup', ['ABC234']], ['setup-share-apply', [{}, {}]], ['setup-share-undo', []]]) {
      const r = await h.handlers[ch]({ sender: {} }, ...args);
      expect(r.ok, ch).toBe(false);
      expect(r.message, ch).toBe('Close this window and open it again.');
    }
    expect(await h.handlers['setup-share-state']({ sender: {} })).toEqual({ stage: 'code', model: null, result: null });
    expect(seen).toEqual([]);
  });
});

describe('Applying an import', () => {
  const setup = () => setupBundle.build({ meta: { title: 'Their night' },
    layouts: [{ name: 'Raid', active: true, doc: fixture.docs.screen1080 }, { name: 'Group', active: false, doc: fixture.docs.eq1440 }],
    hud: { aldenmar: { ring: 1 } }, options: { who: { zekOnly: true }, overlay: { tab: 'tank' } },
    triggers: [{ id: 'p_1', name: 'Rain', pattern: 'rain', actions: [{ type: 'text_overlay', text: 'x' }], characters: ['aldenmar'] }, { id: 'p_2', name: 'Mez', pattern: 'mez', actions: [{ type: 'text_overlay', text: 'm' }] }],
    rules: { 'personal:p_1': { '*': 'off', aldenmar: 'overlay' }, 'guild:7': { '*': 'off' } }, ownChars: ['Aldenmar'] }).setup;
  const ALL = { layouts: ['0', '1'], options: ['who', 'overlay'], hud: ['c1'], triggers: ['0', '1'], rules: true };
  const flow = (h) => h.api._setupFlowSet({ stage: 'preview', setup: setup(), source: 'file', mine: ['Dunmore', 'Evelyn'], result: null, undo: null });

  it('triggers go to the engine (merged, backed up), the HUD and options to localStorage, the layouts to new sets', async () => {
    const h = load({ ls: { 'wp.damageTabMode': 'dps', 'wp:bufferClass': 'Cleric' }, applyReply: { ok: true, added: 2, updated: 0, discord_off: 0, rules_changed: 3, backups: ['personal_triggers.json.bak-2026-10-19T12-00-00-000Z'] } });
    writeSets(h.sets, [['Mine', layoutOf('m')]]);
    flow(h);
    const r = await h.api._applySetup(ALL, { c1: ['Dunmore'] });
    expect(r.ok, r.message).toBe(true);
    expect(r.canUndo).toBe(true);
    const post = h.engineCalls.find(c => c.method === 'POST' && c.route === '/api/setup-share/triggers');
    expect(post.body.triggers.map(t => [t.name, t.characters])).toEqual([['Rain', ['dunmore']], ['Mez', undefined]]);
    expect(post.body.rules).toEqual({ 'personal:p_1': { '*': 'off', dunmore: 'overlay' }, 'guild:7': { '*': 'off' } });
    expect(h.state.ls['wpHudParts:dunmore']).toBe('{"ring":1}');
    expect(h.state.ls['wp:who:zekOnly']).toBe('1');
    expect(h.state.ls['wp.damageTabMode']).toBe('tank');
    expect(h.state.ls['wp:bufferClass']).toBe('Cleric');            // what is not part of the setup is not touched
    const store = overlaySets.load(h.sets);
    expect(Object.values(store.sets).map(s => s.name).sort()).toEqual(['Before Their night', 'Group', 'Mine', 'Raid']);
    expect(h.cmdLog.at(-1)).toEqual({ verb: 'load', name: 'Raid' });  // the sender's own is the one on screen
    expect(r.lines.join(' ')).toMatch(/2 triggers: 2 new/);
    expect(h.api._setupState().stage).toBe('done');
  });

  it('a new set never lands on one you have (a name that is taken counts up), and the cap is asked for', async () => {
    const h = load({});
    writeSets(h.sets, [['Raid', layoutOf('m')]]);
    flow(h);
    await h.api._applySetup({ layouts: ['0'] }, {});
    expect(Object.values(overlaySets.load(h.sets).sets).map(s => s.name).sort()).toEqual(['Before Their night', 'Raid', 'Raid 2']);
    const full = load({});
    writeSets(full.sets, Array.from({ length: 39 }, (_, i) => ['S' + i, layoutOf('x')]));
    flow(full);
    const r = await full.api._applySetup({ layouts: ['0', '1'] }, {});
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Delete a few first/);
    expect(Object.keys(overlaySets.load(full.sets).sets)).toHaveLength(39);
  });

  it('the sender\'s own layout is the one put on screen, wherever it is in the list', async () => {
    const h = load({});
    flow(h);
    const f = h.api._setupFlowGet();
    f.setup.layouts.reverse();                                 // Group first, Raid (the one on their screen) second
    await h.api._applySetup({ layouts: ['0', '1'] }, {});
    expect(h.cmdLog.at(-1)).toEqual({ verb: 'load', name: 'Raid' });
    fs.rmSync(h.sets, { force: true }); fs.rmSync(h.sets + '.bak', { force: true });
    const g = load({});
    flow(g);
    g.api._setupFlowGet().setup.layouts.forEach(l => { l.active = false; });
    await g.api._applySetup({ layouts: ['0', '1'] }, {});
    expect(g.cmdLog.at(-1)).toEqual({ verb: 'load', name: 'Raid' });   // none marked: the first
  });

  it('a Before copy of your layouts is saved first, under a free name', async () => {
    const h = load({});
    writeSets(h.sets, [['Before Their night', layoutOf('m')]]);
    flow(h);
    const r = await h.api._applySetup({ layouts: ['0'] }, {});
    expect(r.ok).toBe(true);
    const names = Object.values(overlaySets.load(h.sets).sets).map(s => s.name).sort();
    expect(names).toEqual(['Before Their night', 'Before Their night 2', 'Raid']);
    expect(r.lines.join(' ')).toContain('"Before Their night 2"');
  });

  it('only what is ticked: nothing ticked changes nothing', async () => {
    const h = load({ ls: {} });
    writeSets(h.sets, [['Mine', layoutOf('m')]]);
    flow(h);
    const before = fs.readFileSync(h.sets, 'utf8');
    const r = await h.api._applySetup({}, {});
    expect(r).toMatchObject({ ok: true, canUndo: false });
    expect(r.message).toMatch(/Nothing was ticked/);
    expect(h.engineCalls.filter(c => c.method === 'POST')).toEqual([]);
    expect(h.windows).toEqual([]);
    expect(fs.readFileSync(h.sets, 'utf8')).toBe(before);
  });

  it('per-character parts with no character picked are skipped and said so', async () => {
    const h = load({ ls: {} });
    flow(h);
    const r = await h.api._applySetup({ hud: ['c1'], triggers: ['0', '1'] }, {});
    expect(r.lines.some(l => /Skipped the HUD for Character 1/.test(l))).toBe(true);
    expect(r.lines.some(l => /Skipped trigger "Rain"/.test(l))).toBe(true);
    expect(h.state.ls).toEqual({});
    expect(h.engineCalls.find(c => c.method === 'POST').body.triggers.map(t => t.name)).toEqual(['Mez']);
  });

  it('the page cannot choose which character a part lands on: only names the engine reported', async () => {
    const h = load({ ls: {} });
    flow(h);
    await h.api._applySetup({ hud: ['c1'] }, { c1: ['Mallory', '../x'] });
    expect(h.state.ls).toEqual({});
  });

  it('a failed trigger step stops the rest (the HUD and layouts are NOT half-applied), and says why', async () => {
    const h = load({ ls: {}, applyReply: { ok: false, error: 'could not back up your files first: disk full' } });
    writeSets(h.sets, [['Mine', layoutOf('m')]]);
    flow(h);
    const before = fs.readFileSync(h.sets, 'utf8');
    const r = await h.api._applySetup(ALL, { c1: ['Dunmore'] });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/triggers could not be added: could not back up/);
    expect(r.canUndo).toBe(false);
    expect(h.state.ls).toEqual({});
    expect(fs.readFileSync(h.sets, 'utf8')).toBe(before);
  });

  it('a failed localStorage write stops before the layouts, and Undo still covers the triggers', async () => {
    const h = load({ ls: {}, lsFail: true, applyReply: { ok: true, added: 2, backups: ['personal_triggers.json.bak-2026-10-19T12-00-00-000Z'] } });
    writeSets(h.sets, [['Mine', layoutOf('m')]]);
    flow(h);
    const r = await h.api._applySetup(ALL, { c1: ['Dunmore'] });
    expect(r.ok).toBe(false);
    expect(r.canUndo).toBe(true);
    expect(Object.values(overlaySets.load(h.sets).sets).map(s => s.name)).toEqual(['Mine']);
  });

  it('Undo puts everything back: layouts, the options and HUD, the triggers', async () => {
    const bak = ['personal_triggers.json.bak-2026-10-19T12-00-00-000Z', 'trigger_rules.json.bak-2026-10-19T12-00-00-000Z'];
    const h = load({ ls: { 'wp.damageTabMode': 'dps' }, applyReply: { ok: true, added: 2, backups: bak } });
    writeSets(h.sets, [['Mine', layoutOf('m')]]);
    flow(h);
    await h.api._applySetup(ALL, { c1: ['Dunmore'] });
    expect(h.state.ls['wpHudParts:dunmore']).toBeTruthy();
    const u = await h.api._undoSetup();
    expect(u).toMatchObject({ ok: true, canUndo: false, message: 'Undone.' });
    expect(h.state.ls).toEqual({ 'wp.damageTabMode': 'dps' });                       // the old value back, the new keys gone
    expect(Object.values(overlaySets.load(h.sets).sets).map(s => s.name)).toEqual(['Mine']);
    expect(h.engineCalls.at(-1)).toEqual({ method: 'POST', route: '/api/setup-share/triggers/restore', body: { backups: bak } });
    expect((await h.api._undoSetup()).ok).toBe(false);                                // and only once
  });

  it('the window handlers drive the same functions and answer only the import window', async () => {
    const h = load({ ls: {}, applyReply: { ok: true, added: 1, backups: [] } });
    await h.api._enterSetupCode();
    const ev = { sender: h.windows[0].webContents };
    h.api._setupFlowSet(Object.assign(h.api._setupFlowGet(), { stage: 'preview', setup: setup(), mine: ['Dunmore'] }));
    const r = await h.handlers['setup-share-apply'](ev, { triggers: ['1'], hud: 'not a list', rules: 'yes', layouts: [5, null] }, { c1: ['Dunmore'], evil: ['x'], c99999: ['y'] });
    expect(r.ok).toBe(true);
    expect(r.state.stage).toBe('done');
    expect(h.engineCalls.find(c => c.method === 'POST').body.triggers.map(t => t.name)).toEqual(['Mez']);
    expect(h.engineCalls.find(c => c.method === 'POST').body.rules).toEqual({});     // rules: 'yes' is not true
    expect((await h.handlers['setup-share-undo'](ev)).state.stage).toBe('done');
    await h.handlers['setup-share-close'](ev);
    expect(h.windows[0].destroyed).toBe(true);
    expect(h.api._setupFlowGet()).toBeNull();                                          // closing forgets the setup
  });
});
