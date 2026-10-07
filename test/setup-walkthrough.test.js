// test/setup-walkthrough.test.js — the Mimic setup walkthrough (welcome.html, DECISIONS §93).
//
// The guild lead, 2026-09-29, reviewing another companion app's onboarding: "i like the
// clickthrough. Build out a version of this for mimic instead of the single setup view. It
// shouldn't look the same, and should show some of the optional setup pieces that we have for
// /me and the abilities that entails". Two layouts (?v=a trail, ?v=b essentials + unlocks) over
// one step registry, opened from the tray and the dashboard's Setup card.
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
  const src = sliceBlock(main, 'function openWelcome(v) {', '\n}));\n');
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
  it('opens welcome.html as layout a or b, never anything else', () => {
    const h = harness();
    h.handlers['open-welcome']({}, 'b');
    h.handlers['open-welcome']({}, '../../evil');
    expect(h.loads).toEqual([['welcome.html', { query: { v: 'b' } }], ['welcome.html', { query: { v: 'a' } }]]);
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
  it('the tray has both layouts', () => {
    const tray = stripJs(main);
    expect(tray).toMatch(/label: '✨ Setup walkthrough', submenu: \[/);
    expect(tray).toMatch(/click: \(\) => openWelcome\('a'\)/);
    expect(tray).toMatch(/click: \(\) => openWelcome\('b'\)/);
  });
  it('the dashboard Setup card has both, driving the same bridge call', () => {
    const d = stripJs(dash);
    expect(d).toMatch(/class="wp-welcome" data-v="a"/);
    expect(d).toMatch(/class="wp-welcome" data-v="b"/);
    expect(d).toMatch(/window\.mimic\.openWelcome\(wBtn\.dataset\.v\)/);
  });
  // Two layouts still waiting on the guild lead's pick must not reach the stable fleet, and a stable
  // cut is the beta byte for byte, so both entry points show only on a prerelease build (2026-09-30).
  it('both entry points show on beta and alpha builds only', () => {
    expect(stripJs(main)).toContain("...(/-/.test(String(app.getVersion() || '')) ? [{ label: '✨ Setup walkthrough', submenu: [");
    expect(stripJs(dash)).toContain("if (!(window.mimic && window.mimic.openWelcome) || !{{WP:JSON.stringify(/-/.test(String(process.env.WOLFPACK_APP_VERSION || '')))}}) return;");
  });
  it('preload sends the layouts through open-welcome and the relay through welcome-optin', () => {
    const p = stripJs(preload);
    expect(p).toMatch(/openWelcome:\s+\(v\)\s+=> ipcRenderer\.invoke\('open-welcome', v === 'b' \? 'b' : 'a'\)/);
    expect(p).toMatch(/welcomeOptin:\s+\(action, paths\) => ipcRenderer\.invoke\('welcome-optin', action, paths\)/);
  });
});

describe('the page', () => {
  it('has both layouts and every step', () => {
    const code = stripJs(script);
    expect(code).toMatch(/function renderA\(\)/);
    expect(code).toMatch(/function renderB\(\)/);
    for (const id of ['account', 'folder', 'chars', 'zeal', 'eq', 'overlays', 'me', 'history']) {
      expect(code).toMatch(new RegExp("\\{ id: '" + id + "',"));
    }
  });
  it('the three essentials are the three the gate needs', () => {
    const ess = [...stripJs(script).matchAll(/\{ id: '(\w+)',[^\n]*ess: true/g)].map(m => m[1]);
    expect(ess).toEqual(['account', 'folder', 'chars']);
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
