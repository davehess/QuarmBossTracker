// test/tour-opt-in.test.js — the Timers canvas is a choice, offered in the tour (the guild lead, 2026-10-21):
// "don't automatically open up canvas on new users. it should be a choice, include it in the tour, as well as
// many of the other components. let users rejoin the tour later".
//
// Four things are pinned:
//   1. a fresh install has the canvas OFF, and a saved config keeps whatever it stored (the real loadConfig);
//   2. the tour's switches go through the SAME call as the dashboard's Overlays tab (toggle-overlay), and the
//      canvas step is "Turn it on" / "Not now" that changes nothing by itself;
//   3. "Take the tour again" is in BOTH the tray and the dashboard and both call the same function, which opens
//      the tour without writing a setting;
//   4. finishing or skipping records that the tour was seen.
//
// Run: npx vitest run test/tour-opt-in.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const MIMIC = path.join(ROOT, 'apps', 'mimic');
const page = readSource(path.join(MIMIC, 'welcome.html'));
const main = readSource(path.join(MIMIC, 'main.js'));
const preload = readSource(path.join(MIMIC, 'preload.js'));
const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const script = page.slice(page.indexOf('<script>'), page.lastIndexOf('</script>'));

describe('a new install does not open the canvas; an existing one keeps its choice', () => {
  // The real defaultConfig + loadConfig, run against a file the test chooses.
  function load(rawOrNull) {
    return new Function('fs', 'CONFIG_FILE',
      sliceBlock(main, 'function defaultConfig() {', '\n}\n') + '\n'
      + sliceBlock(main, 'function _readConfigRaw() {', '\n}\n') + '\n'
      + sliceBlock(main, 'function _chatMigrateBreakouts(raw) {', '\n}\n') + '\n'
      + sliceBlock(main, 'function loadConfig() {', '\n}\n') + '\nreturn loadConfig();')(
      { readFileSync: () => { if (rawOrNull == null) throw new Error('ENOENT'); return JSON.stringify(rawOrNull); } }, () => 'x');
  }
  it('no config file at all: the canvas is off, and the tour has not been seen', () => {
    const c = load(null);
    expect(c.showCanvas).toBe(false);
    expect(c.tourSeen).toBe(false);
  });
  it('a config from before the canvas existed: still off', () => {
    expect(load({ showHud: true, onboarded: true }).showCanvas).toBe(false);
  });
  it('a saved config with the canvas on keeps it on, and one with it off keeps it off', () => {
    expect(load({ onboarded: true, showCanvas: true }).showCanvas).toBe(true);
    expect(load({ onboarded: true, showCanvas: false }).showCanvas).toBe(false);
  });
  it('nothing in the first-run paths turns it on: the class seed cannot name it, and first-boot arranging only packs', () => {
    const seed = stripJs(sliceBlock(main, 'const _CLASS_SET_FLAG_BY_KEY = {', '\n};'));
    expect(seed).not.toMatch(/canvas/i);
    const onboarded = stripJs(sliceBlock(main, "ipcMain.handle('mark-onboarded'", '\n});'));
    expect(onboarded).not.toMatch(/showCanvas/);
    // setup / unlock never conjure it either (the canvas rule in CLAUDE.md): its own switch decides.
    const wanted = stripJs(sliceBlock(main, 'function _overlayWanted(cfg, e) {', '\n}\n'));
    expect(wanted).toMatch(/if \(e\.key === 'canvas'\) \{\s*return !!cfg\.showCanvas &&/);
  });
});

// ── The page, booted for real against a stub DOM and a bridge this test chooses ──────────────────────────
const FLAG_OF_KEY = {};
{
  const groups = evalBlock(sliceBlock(script, 'var TOUR_GROUPS = {', '\n  };\n'), ['TOUR_GROUPS']).TOUR_GROUPS;
  for (const rows of Object.values(groups)) for (const r of rows) FLAG_OF_KEY[r[0]] = r[1];
  FLAG_OF_KEY.canvas = 'showCanvas';
}
const tick = () => new Promise(r => setTimeout(r, 0));
function boot({ cfg = {}, hash = '#tour' } = {}) {
  const els = {}, clicks = {}, calls = { toggle: [], save: [], opened: 0 };
  const live = Object.assign({ eqPaths: ['C:\\EQ'], connected: true }, cfg);
  // An element finds the [data-x] controls inside its own markup; the document finds them in the chrome and the
  // step body together (the page draws the body into #body, which is a child of #app in a real browser).
  const mk = (sel) => els[sel] || (els[sel] = { innerHTML: '', dataset: {}, style: {}, querySelector: mk, querySelectorAll(s) { return fromHtml(s, this.innerHTML); }, addEventListener() {}, setAttribute() {}, focus() {}, closest: () => null });
  const docHtml = () => (els['#app'] ? els['#app'].innerHTML : '') + (els['#body'] ? els['#body'].innerHTML : '');
  function fromHtml(sel, source) {
    const m = sel.match(/^\[(data-[\w-]+)\]$/);
    if (!m) return [];
    const html = source == null ? docHtml() : source;
    return [...html.matchAll(new RegExp(m[1] + '="([^"]*)"', 'g'))].map(r => {
      const tag = html.slice(html.lastIndexOf('<', r.index), html.indexOf('>', r.index) + 1);
      const dataset = {};
      for (const a of tag.matchAll(/data-([\w-]+)="([^"]*)"/g)) dataset[a[1].replace(/-(\w)/g, (_, c) => c.toUpperCase())] = a[2];
      return { dataset, addEventListener: (ev, fn) => { if (ev === 'click') clicks[m[1] + '=' + r[1]] = () => fn({ preventDefault() {}, stopPropagation() {} }); } };
    });
  }
  const answers = { getStatus: { localOnly: false, mimicSession: { display_name: 'Aldenmar' } }, findEqInstalls: { found: [] }, listEqCharacters: [{ character: 'Aldenmar', ago_days: 0 }], getAgentPort: 7779 };
  const bridge = {
    getConfig: () => Promise.resolve(JSON.parse(JSON.stringify(live))),
    // the same flip main.js _toggleOverlay makes: the flag for that key, inverted
    toggleOverlay: (key) => { calls.toggle.push(key); live[FLAG_OF_KEY[key]] = !live[FLAG_OF_KEY[key]]; return Promise.resolve({}); },
    saveConfig: (o) => { calls.save.push(o); Object.assign(live, o); return Promise.resolve(true); },
    openDashboard: () => { calls.opened++; return Promise.resolve(true); },
  };
  const mimic = new Proxy({}, { get: (_t, k) => (k === 'onStatus' ? () => {} : k in bridge ? bridge[k] : () => Promise.resolve(k in answers ? answers[k] : {})) });
  const document = { body: { dataset: {} }, querySelector: mk, querySelectorAll: (s) => fromHtml(s), addEventListener() {} };
  const window = { scrollTo() {}, mimic };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'location', 'fetch', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'navigator', script.slice(script.indexOf('<script>') + 8))(
    window, document, { search: '', hash }, () => Promise.reject(new Error('no engine')), () => 1, () => {}, () => 1, () => {}, {});
  // The whole page as drawn: chrome plus the step body.
  const app = () => docHtml();
  const nav = (name) => { const m = app().match(new RegExp('<button[^>]*data-nav="' + name + '"[^>]*>')); return m ? m[0] : null; };
  const flush = async () => { for (let i = 0; i < 8; i++) await tick(); };
  return { app, nav, clicks, calls, live, flush };
}

describe('the tour: every row is a real overlay, switched through the dashboard\'s own call', () => {
  const groups = evalBlock(sliceBlock(script, 'var TOUR_GROUPS = {', '\n  };\n'), ['TOUR_GROUPS']).TOUR_GROUPS;
  const toggle = stripJs(sliceBlock(main, 'function _toggleOverlay(name) {', '\n}\n'));
  it.each(Object.values(groups).flat().map(r => [r[0], r[1]]))('%s flips %s in the shared toggle', (key, flag) => {
    expect(toggle).toMatch(new RegExp("case '" + key + "':\\s*(?:\\n\\s*//[^\\n]*)*\\s*cfg\\." + flag + ' = !cfg\\.' + flag));
  });
  it('the tour covers the main components, a step each by purpose', () => {
    const keys = Object.values(groups).flat().map(r => r[0]);
    expect(keys).toEqual(expect.arrayContaining(['hud', 'trigger', 'mobinfo', 'threat', 'me', 'zeal', 'charm', 'pet', 'melody',
      'buffQueue', 'who', 'chchain', 'exttarget', 'tank', 'command', 'popraid', 'map', 'maptimers']));
    expect(new Set(keys).size).toBe(keys.length);   // no overlay offered twice
  });
  it('a switch never writes the flag itself: no saveConfig of a show flag from the page', () => {
    expect(stripJs(script)).not.toMatch(/saveConfig\(\{\s*show/);
    expect(stripJs(sliceBlock(script, 'function setOverlay(key, flag, want) {', '\n  }\n'))).toMatch(/M\.toggleOverlay\(key\)/);
  });

  it('opened as "Take the tour again" it starts on In the fight and shows what is on now', async () => {
    const t = boot({ cfg: { onboarded: true, showHud: true, showMobInfo: false } }); await t.flush();
    expect(t.app()).toContain('<h1>🪟 In the fight</h1>');
    const row = (key) => t.app().slice(t.app().indexOf('data-tour="' + key + '"') - 260, t.app().indexOf('data-tour="' + key + '"') + 80);
    expect(row('hud')).toContain('>on<');
    expect(row('hud')).toContain('Turn it off');
    expect(row('mobinfo')).toContain('>off<');
    expect(t.calls.toggle).toEqual([]);          // looking changes nothing
    expect(t.calls.save).toEqual([]);
  });
  it('Turn it on / Turn it off call the shared toggle once each, and the row follows', async () => {
    const t = boot({ cfg: { onboarded: true, showHud: false } }); await t.flush();
    t.clicks['data-tour=hud'](); await t.flush();
    expect(t.calls.toggle).toEqual(['hud']);
    expect(t.live.showHud).toBe(true);
    t.clicks['data-tour=hud'](); await t.flush();
    expect(t.calls.toggle).toEqual(['hud', 'hud']);
    expect(t.live.showHud).toBe(false);
  });
  it('a page that is out of date cannot flip an overlay the wrong way: it asks for "on" and finds it already on', async () => {
    const t = boot({ cfg: { onboarded: true, showHud: false } }); await t.flush();
    t.live.showHud = true;                        // turned on from the tray while the tour was open
    // the page still shows it off and offers "Turn it on"; the click must not toggle it back off
    t.clicks['data-tour=hud'](); await t.flush();
    expect(t.calls.toggle).toEqual([]);           // it was asked to be on, and it was: nothing flips
    expect(t.live.showHud).toBe(true);
  });
  it('the tour has Skip on every step and a Skip the tour that jumps past them all', async () => {
    const t = boot({ cfg: { onboarded: true } }); await t.flush();
    expect(t.nav('skip')).not.toBeNull();
    expect(t.nav('skiptour')).not.toBeNull();
    expect(t.nav('next')).not.toContain(' disabled');
  });
});

describe('the Canvas step: a choice, with Turn it on and Not now', () => {
  async function toCanvas(cfg) {
    const t = boot({ cfg: { onboarded: true, ...cfg } }); await t.flush();
    t.clicks['data-go=tourcanvas'](); await t.flush();
    return t;
  }
  it('says what it is in plain words and starts off on a new install', async () => {
    const t = await toCanvas({});
    expect(t.app()).toContain('<h1>🧱 The Canvas</h1>');
    expect(t.app()).toContain('Most people start without it');
    expect(t.app()).toContain('data-tc="on"');
    expect(t.app()).toContain('data-tc="skip"');
    expect(t.app()).toContain('Not now');
  });
  it('Not now changes nothing and moves on', async () => {
    const t = await toCanvas({});
    t.clicks['data-tc=skip'](); await t.flush();
    expect(t.calls.toggle).toEqual([]);
    expect(t.live.showCanvas).toBeUndefined();
    expect(t.app()).toContain('Your /me page');
  });
  it('Turn it on uses the shared toggle for the canvas', async () => {
    const t = await toCanvas({});
    t.clicks['data-tc=on'](); await t.flush();
    expect(t.calls.toggle).toEqual(['canvas']);
    expect(t.live.showCanvas).toBe(true);
    expect(t.app()).toContain('data-tc="keep"');   // now it offers Turn it off / Keep it on
    expect(t.app()).toContain('data-tc="off"');
  });
  it('a canvas already on shows as on, and re-running the tour leaves it on', async () => {
    const t = await toCanvas({ showCanvas: true });
    expect(t.app()).toContain('data-tc="keep"');
    t.clicks['data-tc=keep'](); await t.flush();
    expect(t.calls.toggle).toEqual([]);
    expect(t.live.showCanvas).toBe(true);
  });
});

describe('the tour is recorded as seen when it is skipped or finished', () => {
  it('Skip the tour saves tourSeen and jumps past the tour steps', async () => {
    const t = boot({ cfg: { onboarded: true } }); await t.flush();
    t.clicks['data-nav=skiptour'](); await t.flush();
    expect(t.calls.save).toContainEqual({ tourSeen: true });
    expect(t.app()).toContain('Your /me page');
    expect(t.calls.toggle).toEqual([]);            // skipping switches nothing
  });
  it('finishing does too, ahead of marking the setup done', () => {
    const fin = stripJs(sliceBlock(script, 'function finish() {', '\n  }\n'));
    expect(fin).toMatch(/markTourSeen\(\);\s*\n\s*if \(!S\.main/);
    const S = { cfg: {} }, saved = [];
    const { markTourSeen } = new Function('S', 'M', sliceBlock(script, 'function markTourSeen() {', '\n  }\n') + '\nreturn { markTourSeen };')(
      S, { saveConfig: (o) => { saved.push(o); return Promise.resolve(true); } });
    markTourSeen();
    expect(saved).toEqual([{ tourSeen: true }]);
    expect(S.cfg.tourSeen).toBe(true);
  });
  it('a re-run from "Take the tour again" does not offer to read the main\'s old log a second time', async () => {
    const src = stripJs(script);
    expect(src).toMatch(/if \(TOUR_ONLY\) \{ cur = 'overlays'; S\.backfill = false; \}/);
  });
});

describe('Take the tour again: tray and dashboard, one function', () => {
  const src = sliceBlock(main, 'function openTour() {', "ipcMain.handle('open-tour', () => openTour());");
  function harness() {
    const loads = [];
    const mainWindow = { isDestroyed: () => false, loadFile: (f, o) => loads.push([f, o]), show() {}, focus() {} };
    const handlers = {};
    // eslint-disable-next-line no-new-func
    new Function('mainWindow', 'ipcMain', src)(mainWindow, { handle: (n, fn) => { handlers[n] = fn; } });
    return { loads, handlers };
  }
  it('opens welcome.html at #tour, and takes nothing from the caller', () => {
    const h = harness();
    h.handlers['open-tour']({}, '../../evil');
    expect(h.loads).toEqual([['welcome.html', { hash: 'tour' }]]);
  });
  it('writes no setting: restarting the tour cannot reset an overlay choice', () => {
    expect(stripJs(src)).not.toMatch(/saveConfig|loadConfig|cfg\./);
  });
  it('the tray has the item, in Help, calling openTour', () => {
    expect(stripJs(main)).toContain("{ label: '🧭 Take the tour again', click: () => openTour() },");
  });
  it('the dashboard has the button, calling the same bridge call', () => {
    const d = stripJs(dash);
    expect(d).toMatch(/class="wp-tour" style=/);
    expect(d).toMatch(/window\.mimic\.openTour\(\)/);
    expect(d).toContain("if (!(window.mimic && window.mimic.openTour)) return;");
  });
  it('preload sends it through open-tour', () => {
    expect(stripJs(preload)).toMatch(/openTour:\s+\(\)\s+=> ipcRenderer\.invoke\('open-tour'\)/);
  });
  it('the page reads #tour to start on the first overlay step', async () => {
    const t = boot({ cfg: { onboarded: true }, hash: '' }); await t.flush();
    expect(t.app()).toContain('Wolf Pack account');       // opened the usual way: not the tour
    const u = boot({ cfg: { onboarded: true }, hash: '#tour' }); await u.flush();
    expect(u.app()).toContain('<h1>🪟 In the fight</h1>');
  });
});
