// test/setup-walkthrough.test.js — the Mimic setup walkthrough (welcome.html, DECISIONS §93).
//
// The guild lead, 2026-09-29, reviewing another companion app's onboarding: "i like the
// clickthrough. Build out a version of this for mimic instead of the single setup view. It
// shouldn't look the same, and should show some of the optional setup pieces that we have for
// /me and the abilities that entails". Built as two layouts; the guild lead picked the trail (one step at a
// time, a rail of every step, Back / Skip / Next) on 2026-10-19 (DECISIONS §383) and the other was deleted.
// Opened from the tray and the dashboard's Setup card, on every build.
//
// Run: npx vitest run test/setup-walkthrough.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const MIMIC = path.join(ROOT, 'apps', 'mimic');
const page = readSource(path.join(MIMIC, 'welcome.html'));
const main = readSource(path.join(MIMIC, 'main.js'));
const preload = readSource(path.join(MIMIC, 'preload.js'));
const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const script = page.slice(page.indexOf('<script>'), page.lastIndexOf('</script>'));

const { gateOk, mainBackfillPaths } = evalBlock(
  sliceBlock(script, 'function gateOk(s) {', '}\n') + '\n'
  + sliceBlock(script, 'function mainBackfillPaths(optin, main, excluded) {', '\n  }\n'),
  ['gateOk', 'mainBackfillPaths']);

describe('the dashboard gate', () => {
  it('opens only with an account choice, a folder and the engine up — the classic page\'s rule', () => {
    const on = { signedIn: true, localOnly: false, eqConfigured: true, agentReady: true };
    expect(gateOk(on)).toBe(true);
    expect(gateOk({ ...on, signedIn: false, localOnly: true })).toBe(true);
    expect(gateOk({ ...on, signedIn: false })).toBe(false);
    expect(gateOk({ ...on, eqConfigured: false })).toBe(false);
    expect(gateOk({ ...on, agentReady: false })).toBe(false);
  });
});

describe('reading the main\'s old log at the finish', () => {
  const optin = { files: [
    { path: 'C:\\EQ\\Logs\\eqlog_Aldenmar_pq.proj.txt', character: 'Aldenmar' },
    { path: 'D:\\old\\eqlog_Aldenmar_pq.proj.txt', character: 'aldenmar', imported: true },
    { path: 'C:\\EQ\\Logs\\eqlog_Brackwyn_pq.proj.txt', character: 'Brackwyn' },
    { path: 'C:\\EQ\\Logs\\eqlog_Aldenmar_pq.proj.txt.1', character: 'Aldenmar', active: true },
  ] };
  it('takes every one of the main\'s files, any case, and nobody else\'s', () => {
    expect(mainBackfillPaths(optin, 'Aldenmar', new Set())).toEqual([
      'C:\\EQ\\Logs\\eqlog_Aldenmar_pq.proj.txt', 'D:\\old\\eqlog_Aldenmar_pq.proj.txt']);
  });
  it('skips a file already being read', () => {
    expect(mainBackfillPaths(optin, 'Aldenmar', new Set())).not.toContain('C:\\EQ\\Logs\\eqlog_Aldenmar_pq.proj.txt.1');
  });
  it('reads nothing for a main the player chose not to send, or with no main', () => {
    expect(mainBackfillPaths(optin, 'Aldenmar', new Set(['aldenmar']))).toEqual([]);
    expect(mainBackfillPaths(optin, null, new Set())).toEqual([]);
    expect(mainBackfillPaths(null, 'Aldenmar', new Set())).toEqual([]);
  });
});

describe('a don\'t-send change takes effect', () => {
  // The engine reads the don't-send list when it starts, so until it restarts an unticked
  // character's log is still being sent. The page restarts it once the ticking stops.
  const block = sliceBlock(script, 'var _restartT = null;', '\n  }\n');
  function run() {
    const S = { agentReady: true }, calls = { relaunch: 0, poll: 0 };
    let pending = null;
    const env = {
      S, changed: () => {}, pollEngine: () => { calls.poll++; },
      M: { relaunchAgent: () => { calls.relaunch++; return Promise.resolve(true); } },
      setTimeout: (fn) => { pending = fn; return 1; }, clearTimeout: () => { pending = null; },
    };
    // eslint-disable-next-line no-new-func
    const restartSoon = new Function(...Object.keys(env), block + '\nreturn restartSoon;')(...Object.values(env));
    return { S, calls, restartSoon, fire: () => { const f = pending; pending = null; if (f) f(); } };
  }
  it('restarts the engine once, after the last change', async () => {
    const h = run();
    h.restartSoon(); h.restartSoon(); h.restartSoon();
    expect(h.calls.relaunch).toBe(0);
    h.fire();
    await Promise.resolve(); await Promise.resolve();
    expect(h.calls.relaunch).toBe(1);
    expect(h.S.agentReady).toBe(false);
    expect(h.calls.poll).toBe(1);
  });
  it('a choice that changes the list schedules it, and Open the dashboard does not leave before it runs', () => {
    // The Send tick became the three-way choice (2026-10-06); main.js keeps the list in step and says so
    // through restart_needed, which test/character-modes.test.js drives for real.
    const code = stripJs(script);
    expect(code).toMatch(/if \(r\.restart_needed\) restartSoon\(\);/);
    const fin = stripJs(sliceBlock(script, 'function finish() {', '\n  }\n'));
    expect(fin).toMatch(/if \(_restartT\) \{[^}]*_finishWhenUp = true;/);
  });
});

describe('every bridge call the page makes exists', () => {
  // A typo here is a button that silently does nothing in Mimic (the preview bridge would hide it).
  const bridge = sliceBlock(preload, "contextBridge.exposeInMainWorld('mimic', {", '\n});');
  const pageCode = stripJs(script.slice(0, script.indexOf('function _previewBridge')));
  const used = [...new Set([...pageCode.matchAll(/\bM\.([A-Za-z]+)\(/g)].map(m => m[1]))];
  it('finds the calls it should', () => {
    expect(used).toEqual(expect.arrayContaining(['mimicLinkStart', 'saveConfig', 'zealInstallUpdate', 'eqSetupForMe',
      'defenderAddExclusions', 'clockResync', 'welcomeOptin', 'markOnboarded', 'openDashboard', 'toggleCrashReports']));
  });
  it.each(used)('%s is on window.mimic', (name) => {
    expect(bridge).toMatch(new RegExp('\\n\\s+' + name + '\\s*:'));
  });
});

describe('main.js', () => {
  const src = sliceBlock(main, 'function openWelcome() {', '\n}));\n');
  function harness({ port = 7779 } = {}) {
    const handlers = {}, loads = [], sent = [];
    const mainWindow = { isDestroyed: () => false, loadFile: (f, o) => loads.push([f, o]), show() {}, focus() {} };
    const http = { request: (opts, cb) => {
      const req = { on() { return req; }, destroy() {}, end(body) {
        sent.push({ opts, body: JSON.parse(body) });
        const res = { statusCode: 200, on(ev, fn) { if (ev === 'data') fn('{"ok":true,"results":[{"path":"x","ok":true}]}'); if (ev === 'end') fn(); } };
        cb(res);
      } };
      return req;
    } };
    const env = { mainWindow, http, agentPort: port, appendAgentLog: () => {}, ipcMain: { handle: (n, fn) => { handlers[n] = fn; } } };
    // eslint-disable-next-line no-new-func
    new Function(...Object.keys(env), src)(...Object.values(env));
    return { handlers, loads, sent };
  }
  it('opens welcome.html, the one layout, and never takes a layout or a page from the caller', () => {
    const h = harness();
    h.handlers['open-welcome']({}, 'b');
    h.handlers['open-welcome']({}, '../../evil');
    expect(h.loads).toEqual([['welcome.html', undefined], ['welcome.html', undefined]]);   // no query: nothing to pick
  });
  it('relays only import and backfill to the agent, with the paths cleaned', async () => {
    const h = harness();
    expect(await h.handlers['welcome-optin']({}, 'ignore', ['a'])).toMatchObject({ ok: false });
    expect(await h.handlers['welcome-optin']({}, 'backfill', [])).toMatchObject({ ok: false });
    const many = Array.from({ length: 250 }, (_, i) => 'C:\\p' + i);
    const r = await h.handlers['welcome-optin']({}, 'backfill', [42, '', 'x'.repeat(2000), ...many]);
    expect(r).toEqual({ ok: true, results: [{ path: 'x', ok: true }] });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].opts).toMatchObject({ host: '127.0.0.1', port: 7779, path: '/api/optin', method: 'POST' });
    expect(h.sent[0].body.action).toBe('backfill');
    expect(h.sent[0].body.paths).toHaveLength(200);
    expect(h.sent[0].body.paths[0]).toBe('C:\\p0');
  });
  it('says so when the engine is not up', async () => {
    const h = harness({ port: 0 });
    expect(await h.handlers['welcome-optin']({}, 'import', ['C:\\old'])).toMatchObject({ ok: false });
    expect(h.sent).toHaveLength(0);
  });
});

describe('reachable from the tray and the dashboard (tray ↔ dashboard parity)', () => {
  it('the tray has one Setup walkthrough item, not a layout submenu', () => {
    const tray = stripJs(main);
    expect(tray).toContain("{ label: '✨ Setup walkthrough', click: () => openWelcome() },");
    expect(tray).not.toMatch(/openWelcome\('[ab]'\)/);
  });
  it('the dashboard Setup card has one button, driving the same bridge call', () => {
    const d = stripJs(dash);
    expect(d).toMatch(/class="wp-welcome" style=/);
    expect(d).not.toMatch(/class="wp-welcome" data-v=/);
    expect(d).toMatch(/window\.mimic\.openWelcome\(\)/);
  });
  // The two layouts were beta-only so the stable fleet never saw an unpicked pick (2026-09-30, §111). The pick
  // is made (2026-10-19, §383): both entry points show on every build, stable included.
  it('both entry points show on stable builds too: no prerelease-only hold is left', () => {
    expect(stripJs(main)).not.toMatch(/app\.getVersion\(\) \|\| ''\)\) \? \[\{ label: '✨ Setup walkthrough'/);
    expect(stripJs(dash)).toContain("if (!(window.mimic && window.mimic.openWelcome)) return;");
    expect(stripJs(dash)).not.toContain('WOLFPACK_APP_VERSION || \'\'))}}) return;');
  });
  it('preload sends the walkthrough through open-welcome and the relay through welcome-optin', () => {
    const p = stripJs(preload);
    expect(p).toMatch(/openWelcome:\s+\(\)\s+=> ipcRenderer\.invoke\('open-welcome'\)/);
    expect(p).toMatch(/welcomeOptin:\s+\(action, paths\) => ipcRenderer\.invoke\('welcome-optin', action, paths\)/);
  });
});

describe('the page', () => {
  it('has the trail and every step, and no other layout', () => {
    const code = stripJs(script);
    expect(code).toMatch(/function renderTrail\(\)/);
    expect(code).not.toMatch(/function renderB\(|function renderA\(|data-ess|location\.search/);
    expect(stripJs(page)).not.toMatch(/\.b-shell|\.ess\b/);
    for (const id of ['account', 'folder', 'chars', 'zeal', 'eq', 'overlays', 'me', 'history']) {
      expect(code).toMatch(new RegExp("\\{ id: '" + id + "',"));
    }
  });
  it('the needed steps are the three the gate needs, in order', () => {
    const req = [...stripJs(script).matchAll(/\{ id: '(\w+)',[^\n]*kind: 'req'/g)].map(m => m[1]);
    expect(req).toEqual(['account', 'folder', 'chars']);
  });
  it('the classic first-run page points at the one walkthrough, with no layout in the link', () => {
    const classic = readSource(path.join(MIMIC, 'loading.html'));
    expect(classic).toContain('href="welcome.html"');
    expect(classic).not.toMatch(/welcome\.html\?v=/);
  });
});

// The trail, booted for real against a stub DOM (as test/character-modes.test.js does for the characters step) with a
// bridge whose answers this test chooses. The nav buttons are read out of what the page drew.
describe('the trail: one step at a time, Back / Skip / Next, the needed steps hold Next', () => {
  const tick = () => new Promise(r => setTimeout(r, 0));
  function boot({ cfg = {}, status = { localOnly: true }, chars = [], search = '' } = {}) {
    const els = {}, clicks = {};
    const mk = (sel) => els[sel] || (els[sel] = { innerHTML: '', dataset: {}, style: {}, querySelector: mk, querySelectorAll: (s) => fromHtml(s), addEventListener() {}, setAttribute() {}, focus() {}, closest: () => null });
    function fromHtml(sel) {
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
    const answers = { getConfig: cfg, getStatus: status, findEqInstalls: { found: [] }, listEqCharacters: chars, getAgentPort: 7779 };
    const mimic = new Proxy({}, { get: (_t, k) => (k === 'onStatus' ? () => {} : () => Promise.resolve(k in answers ? answers[k] : {})) });
    const document = { body: { dataset: {} }, querySelector: mk, querySelectorAll: fromHtml, addEventListener() {} };
    const window = { scrollTo() {}, mimic };
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'location', 'fetch', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'navigator', script.slice(script.indexOf('<script>') + 8))(
      window, document, { search }, () => Promise.reject(new Error('no engine')), () => 1, () => {}, () => 1, () => {}, {});
    const app = () => els['#app'].innerHTML;
    // a nav button's whole tag, or null when the page did not draw it
    const nav = (name) => { const m = app().match(new RegExp('<button[^>]*data-nav="' + name + '"[^>]*>')); return m ? m[0] : null; };
    return { app, nav, clicks, flush: async () => { for (let i = 0; i < 6; i++) await tick(); } };
  }
  const SIGNED_IN = { cfg: { connected: true, eqPaths: ['C:\\EQ'] }, status: { localOnly: false, mimicSession: { display_name: 'Aldenmar' } }, chars: [{ character: 'Aldenmar', ago_days: 0 }] };

  it('starts on Welcome: Back is disabled, Next is free, and every step is on the rail', async () => {
    const t = boot(); await t.flush();
    expect(t.app()).toContain('<h1>🐺 Welcome</h1>');
    expect(t.nav('back')).toContain(' disabled');
    expect(t.nav('next')).not.toContain(' disabled');
    expect(t.nav('skip')).toBeNull();
    const rail = [...t.app().matchAll(/data-go="(\w+)"/g)].map(m => m[1]);
    expect(rail).toEqual(['welcome', 'account', 'folder', 'chars', 'voice', 'names', 'zeal', 'eq', 'mode', 'screen', 'overlays', 'me', 'history', 'done']);
  });

  it('a needed step holds Next until it is done, and offers no Skip', async () => {
    const t = boot(); await t.flush();       // signed out, no folder: account is not done
    t.clicks['data-go=account'](); await t.flush();
    expect(t.app()).toContain('Wolf Pack account');
    expect(t.nav('next')).toContain(' disabled');
    expect(t.nav('skip')).toBeNull();
    t.clicks['data-go=folder'](); await t.flush();
    expect(t.nav('next')).toContain(' disabled');
    expect(t.nav('skip')).toBeNull();
  });

  it('the same needed step lets Next through once it is done', async () => {
    const t = boot(SIGNED_IN); await t.flush();
    t.clicks['data-go=account'](); await t.flush();
    expect(t.nav('next')).not.toContain(' disabled');
    t.clicks['data-go=folder'](); await t.flush();
    expect(t.nav('next')).not.toContain(' disabled');
  });

  it('an optional step has Skip, and Skip and Next both move one step on, Back one step back', async () => {
    const t = boot(); await t.flush();
    t.clicks['data-go=voice'](); await t.flush();
    expect(t.app()).toContain('Your voice');
    expect(t.nav('skip')).not.toBeNull();
    expect(t.nav('next')).not.toContain(' disabled');
    t.clicks['data-nav=skip'](); await t.flush();
    expect(t.app()).toContain('Say your name');
    t.clicks['data-nav=back'](); await t.flush();
    expect(t.app()).toContain('Your voice');
    t.clicks['data-nav=next'](); await t.flush();
    expect(t.app()).toContain('Say your name');
  });

  it('the last page opens the dashboard only when the gate is met', async () => {
    const out = boot(); await out.flush();
    out.clicks['data-go=done'](); await out.flush();
    expect(out.nav('finish')).toContain(' disabled');
    expect(out.nav('skip')).toBeNull();
    const inn = boot(SIGNED_IN); await inn.flush();
    inn.clicks['data-go=done'](); await inn.flush();
    // (the engine never answers in this stub, so the gate stays shut on "engine starting" — the button is still the finish one)
    expect(inn.nav('finish')).not.toBeNull();
  });

  it('a person who finished before lands on the first step, not Welcome', async () => {
    const t = boot({ ...SIGNED_IN, cfg: { ...SIGNED_IN.cfg, onboarded: true } }); await t.flush();
    expect(t.app()).toContain('<h1>🔑 Wolf Pack account</h1>');
  });

  it('there is only the trail: an old ?v=b link, or none, draws the same page', async () => {
    for (const search of ['', '?v=a', '?v=b']) {
      const t = boot({ search }); await t.flush();
      expect(t.app()).toContain('class="rail"');
      expect(t.app()).toContain('class="a-nav"');
      expect(t.app()).not.toMatch(/b-shell|data-ess|data-card/);
    }
  });
});

// The guild lead, 2026-09-29: "just show things that have been touched in the last 3 months and
// then a collapsed section with more".
describe('the characters step', () => {
  const { splitRecentChars } = evalBlock(
    sliceBlock(script, 'function splitRecentChars(chars, main) {', '\n  }\n'), ['splitRecentChars']);
  const c = (character, ago_days) => ({ character, ago_days });
  it('shows the last 3 months and the main; the rest go to "more"', () => {
    const s = splitRecentChars([c('Aldenmar', 119), c('Brackwyn', 3), c('Corvale', 90), c('Rethlan', 91), c('Nyssara', null)], 'aldenmar');
    expect(s.recent.map(x => x.character)).toEqual(['Aldenmar', 'Brackwyn', 'Corvale']);
    expect(s.older.map(x => x.character)).toEqual(['Rethlan', 'Nyssara']);
  });
  it('shows everything when nothing is recent', () => {
    const s = splitRecentChars([c('Rethlan', 200), c('Zarrin', 400)], null);
    expect(s.recent.length).toBe(2);
    expect(s.older.length).toBe(0);
  });
  it('the "more" section is collapsed and keeps its open state across repaints', () => {
    expect(script).toMatch(/<details id="wCharsMore"' \+ \(S\.charsMore \? ' open' : ''\)/);
    expect(script).toMatch(/more\.addEventListener\('toggle', function \(\) \{ S\.charsMore = more\.open; \}\)/);
  });
});
