// test/canvas-stays-off.test.js — the Timers canvas is never on unless the person turned it on (the guild lead,
// 2026-10-22, during a raid; a raider on stable by tell): "all the overlays are on the screen and I can't turn them
// off … what is a canvas? … clicked on shit in the blue box and everything would not go away", and the instruction
// "Canvas needs to not turn on by default".
//
// What is pinned:
//   1. a config saved before this pass gets the Canvas switched OFF once (and the places that would switch it back on
//      by themselves, a hide-all snapshot and per-character profiles, with it); after that a saved "on" stays on;
//   2. a fresh install is off and needs no such pass;
//   3. nothing but the person's own click turns it on: arranging asks first, the pipe command refuses, the overlays'
//      right-click menu only offers Arrange while it is on, and the only `showCanvas = true` writes left in main.js
//      are the three known ones;
//   4. Setup ALL / unlock never conjure it and never show a leftover hidden Canvas window;
//   5. there is a way out: Esc (every overlay, and the Canvas), a Done on every overlay's setup bar, the tray item.
//
// Run: npx vitest run test/canvas-stays-off.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const MIMIC = path.join(ROOT, 'apps', 'mimic');
const main = readSource(path.join(MIMIC, 'main.js'));
const preload = readSource(path.join(MIMIC, 'preload.js'));
const canvas = readSource(path.join(MIMIC, 'canvas.html'));

// ── 1 + 2: the real defaultConfig + loadConfig against a file the test controls ──────────────────────────
function world(initial) {
  const disk = { text: initial == null ? null : JSON.stringify(initial) };
  const logs = [];
  const fs = { readFileSync: () => { if (disk.text == null) throw new Error('ENOENT'); return disk.text; } };
  const load = new Function('fs', 'CONFIG_FILE', 'appendAgentLog',
    sliceBlock(main, 'function defaultConfig() {', '\n}\n') + '\n'
    + sliceBlock(main, 'function _readConfigRaw() {', '\n}\n') + '\n'
    + sliceBlock(main, 'function _chatMigrateBreakouts(raw) {', '\n}\n') + '\n'
    + sliceBlock(main, 'function loadConfig() {', '\n}\n') + '\nreturn loadConfig;')(fs, () => 'x', (l) => logs.push(l));
  // saveConfig writes the whole object, so a later load sees exactly what was saved.
  return { load, save: (cfg) => { disk.text = JSON.stringify(cfg); }, logs };
}

describe('a saved config gets the Canvas switched off once', () => {
  it('a 3.0.x config with the Canvas on: off on first load, and the reason goes in the log', () => {
    const w = world({ onboarded: true, showCanvas: true, showHud: true });
    const c = w.load();
    expect(c.showCanvas).toBe(false);
    expect(c.canvasDefaultOffApplied).toBe(true);
    expect(c.showHud).toBe(true);               // nothing else is touched
    expect(w.logs.join('')).toMatch(/\[canvas\].*switched off once/);
    w.load(); w.load();
    expect(w.logs.filter(l => /switched off once/.test(l))).toHaveLength(1);   // loadConfig runs hundreds of times before a save
  });
  it('the hide-all snapshot and the per-character profiles cannot switch it back on', () => {
    const c = world({
      onboarded: true, showCanvas: true, hideAllActive: true,
      hideAllPrev: { showHud: true, showCanvas: true },
      charProfiles: { aldenmar: { show: { showHud: true, showCanvas: true } }, brackwyn: { show: { showCanvas: true } }, odd: null },
    }).load();
    expect(c.hideAllPrev).toEqual({ showHud: true, showCanvas: false });
    expect(c.charProfiles.aldenmar.show).toEqual({ showHud: true, showCanvas: false });
    expect(c.charProfiles.brackwyn.show.showCanvas).toBe(false);
  });
  it('a config from before the Canvas existed, or with it off, stays off and is marked done', () => {
    expect(world({ onboarded: true }).load().showCanvas).toBe(false);
    const c = world({ onboarded: true, showCanvas: false }).load();
    expect(c.showCanvas).toBe(false);
    expect(c.canvasDefaultOffApplied).toBe(true);
  });
  it('once the person turns it on and the app saves, it stays on at the next start', () => {
    const w = world({ onboarded: true, showCanvas: true });
    const cfg = w.load();                        // the pass runs: off
    expect(cfg.showCanvas).toBe(false);
    cfg.showCanvas = true; w.save(cfg);          // the tray / Overlays / tour switch: toggle + saveConfig
    expect(w.load().showCanvas).toBe(true);
    expect(w.load().canvasDefaultOffApplied).toBe(true);
  });
  it('a config already carrying the flag keeps its Canvas, on or off', () => {
    expect(world({ onboarded: true, showCanvas: true, canvasDefaultOffApplied: true }).load().showCanvas).toBe(true);
    expect(world({ onboarded: true, showCanvas: false, canvasDefaultOffApplied: true }).load().showCanvas).toBe(false);
  });
  it('a fresh install is off, and the flag is already set so there is nothing to undo', () => {
    const c = world(null).load();
    expect(c.showCanvas).toBe(false);
    expect(c.canvasDefaultOffApplied).toBe(true);
  });
});

// ── 3: nothing but a click turns it on ───────────────────────────────────────────────────────────────────
describe('arranging never turns the Canvas on by itself', () => {
  function arrangeWorld({ canvasOn, answer = 0 }) {
    return evalBlock(`
      const cfg = { showCanvas: ${JSON.stringify(canvasOn)} };
      const saves = [], asked = [], logs = [];
      let _canvasArrange = false, canvasWindow = null, windows = 0;
      const loadConfig = () => cfg;
      const saveConfig = (c) => { saves.push(c.showCanvas); };
      const appendAgentLog = (l) => logs.push(l);
      const createCanvasWindow = () => { windows++; canvasWindow = {}; };
      const applyCanvasVisibility = () => {}, applyTriggerVisibility = () => {}, buildTrayMenu = () => {}, pushStatus = () => {};
      const dialog = { showMessageBox: async (o) => { asked.push(o); return { response: ${answer} }; } };
      ${sliceBlock(main, 'function _setCanvasArrange(on, consented) {', '\n}\n')}
      ${sliceBlock(main, 'async function _arrangeCanvasAsked(on) {', '\n}\n')}
      const state = () => ({ on: cfg.showCanvas, arrange: _canvasArrange, saves, asked, logs, windows });
    `, ['_setCanvasArrange', '_arrangeCanvasAsked', 'state']);
  }
  it('_setCanvasArrange with the Canvas off and no yes changes nothing and writes nothing', () => {
    const w = arrangeWorld({ canvasOn: false });
    expect(w._setCanvasArrange(true)).toBe(false);
    const s = w.state();
    expect(s.on).toBe(false); expect(s.arrange).toBe(false); expect(s.saves).toEqual([]); expect(s.windows).toBe(0);
  });
  it('asked, and the answer is Not now: still off, nothing saved; the default button is Not now', async () => {
    const w = arrangeWorld({ canvasOn: false, answer: 1 });
    expect(await w._arrangeCanvasAsked(true)).toBe(false);
    const s = w.state();
    expect(s.on).toBe(false); expect(s.saves).toEqual([]); expect(s.asked).toHaveLength(1);
    expect(s.asked[0].defaultId).toBe(1); expect(s.asked[0].cancelId).toBe(1);
    expect(s.asked[0].buttons[1]).toBe('Not now');
  });
  it('asked, and the answer is yes: now it is on and arranging', async () => {
    const w = arrangeWorld({ canvasOn: false, answer: 0 });
    expect(await w._arrangeCanvasAsked(true)).toBe(true);
    const s = w.state();
    expect(s.on).toBe(true); expect(s.arrange).toBe(true); expect(s.saves).toEqual([true]); expect(s.windows).toBe(1);
  });
  it('with the Canvas already on there is no question, and leaving arrange never asks', async () => {
    const w = arrangeWorld({ canvasOn: true });
    expect(await w._arrangeCanvasAsked(true)).toBe(true);
    expect(await w._arrangeCanvasAsked(false)).toBe(false);
    expect(w.state().asked).toEqual([]);
    const off = arrangeWorld({ canvasOn: false });
    expect(await off._arrangeCanvasAsked(false)).toBe(false);
    expect(off.state().asked).toEqual([]);
  });
  it('every click path goes through the question: the tray item, the Overlays page and the Canvas toolbar (canvas-edit)', () => {
    const m = stripJs(main);
    expect(m).toMatch(/ipcMain\.handle\('canvas-edit', \(_e, on\) => _arrangeCanvasAsked\(!!on\)\);/);
    expect(m).toMatch(/'  ↳ Arrange the canvas…'[\s\S]{0,160}_arrangeCanvasAsked\(!_canvasArrange\);/);
    // …and the only calls to the setter are its definition, the asked wrapper's own consented ones (second argument
    // true) and the pipe command, which refuses while the Canvas is off.
    const calls = [...m.matchAll(/_setCanvasArrange\([^)]*\)/g)].map(x => x[0]);
    expect(calls.filter(c => /, true\)$/.test(c))).toHaveLength(2);
    expect(calls.filter(c => !/, true\)$/.test(c) && !/consented/.test(c))).toEqual(['_setCanvasArrange(on)']);
  });
  it('/pipe mimic edit refuses while the Canvas is off', () => {
    const verb = stripJs(sliceBlock(main, "  if (cmd.verb === 'edit') {", '\n  }\n'));
    expect(verb).toMatch(/if \(on && !loadConfig\(\)\.showCanvas\) return _setsSay\(\{ ok: false,/);
    expect(verb.indexOf('showCanvas')).toBeLessThan(verb.indexOf('_setCanvasArrange(on)'));
  });
  it('the only `showCanvas = true` writes in main.js are the arrange-after-yes and the two set imports', () => {
    const writes = [...stripJs(main).matchAll(/showCanvas\s*=\s*true/g)].map(m => m.index);
    expect(writes).toHaveLength(3);
    const m = stripJs(main);
    const where = writes.map(i => m.slice(Math.max(0, i - 60), i + 20).replace(/\s+/g, ' '));
    expect(where.filter(w => /snap\.show\.showCanvas = true/.test(w))).toHaveLength(2);       // an imported layout the person approved
    expect(where.filter(w => /cfg\.showCanvas = true/.test(w))).toHaveLength(1);              // _setCanvasArrange, after a yes
  });
  it('the overlays\' right-click menu offers Arrange only while the Canvas is on', () => {
    expect(stripJs(main)).toMatch(/canvasOn: !!cfg\.showCanvas,/);
    const p = stripJs(preload);
    expect(p).toMatch(/if \(st\.canvasOn\) menu\.appendChild\(mkItem\('🧩 Arrange the canvas \(pieces\)'/);
    expect(p.indexOf('const st = state || {};')).toBeLessThan(p.indexOf("if (st.canvasOn) menu.appendChild"));
  });
});

// ── 4: Setup ALL / unlock never include the Canvas ───────────────────────────────────────────────────────
describe('Setup ALL and unlock never conjure the Canvas', () => {
  function wanted(cfg, extra = {}) {
    globalThis.__x = extra;
    const r = evalBlock(`
      const _agentOnly = () => false;
      const setupMode = !!globalThis.__x.setup, _canvasArrange = !!globalThis.__x.arrange;
      const _eqGateOk = () => true;
      const _overlayForcedOn = () => true;          // setup / unlock force every other overlay on
      const _canvasHostedKeys = () => [];
      ${sliceBlock(main, 'function _overlayWanted(cfg, e) {', '\n}\n')}
    `, ['_overlayWanted']);
    const out = { canvas: r._overlayWanted(cfg, { key: 'canvas', flag: 'showCanvas' }), hud: r._overlayWanted(cfg, { key: 'hud', flag: 'showHud' }) };
    delete globalThis.__x;
    return out;
  }
  it('Canvas off: setup, unlock and an arrange request build every other overlay and not the Canvas', () => {
    for (const extra of [{ setup: true }, { arrange: true }, {}]) {
      const r = wanted({ showCanvas: false, overlaysLocked: false, showHud: false }, extra);
      expect(r.canvas).toBe(false);
      expect(r.hud).toBe(true);
    }
  });
  it('Canvas on (the person\'s choice): setup shows it so its pieces can be placed', () => {
    expect(wanted({ showCanvas: true, overlaysLocked: true }, { setup: true }).canvas).toBe(true);
  });
  function setupAll({ canvasOn }) {
    return evalBlock(`
      const shown = [];
      let setupMode = false;
      const mk = (n) => ({ showInactive() { shown.push(n); } });
      const _overlayEntries = () => [['hud', mk('hud')], ['canvas', mk('canvas')], ['trigger', mk('trigger')]];
      const loadConfig = () => ({ showCanvas: ${JSON.stringify(canvasOn)} });
      const _materializeEnabledOverlays = () => {}, applyOverlayInteractivity = () => {}, applyOverlayVisibility = () => {},
        applyTriggerVisibility = () => {}, applyCharmVisibility = () => {}, applyPetsVisibility = () => {},
        applyMobInfoVisibility = () => {}, applyBuffQueueVisibility = () => {}, applyWhoVisibility = () => {},
        applyChatVisibility = () => {}, applyMelodyVisibility = () => {}, applyZealVisibility = () => {},
        applyCanvasVisibility = () => {}, applyAllOverlayOpacities = () => {}, _reapDisabledOverlays = () => {}, pushStatus = () => {};
      ${sliceBlock(main, 'function applySetupMode(on) {', '\n}\n')}
      applySetupMode(true);
    `, ['shown']).shown;
  }
  it('Setup ALL force-shows the live windows, but a leftover hidden Canvas window only while the Canvas is on', () => {
    expect(setupAll({ canvasOn: false })).toEqual(['hud', 'trigger']);
    expect(setupAll({ canvasOn: true })).toEqual(['hud', 'canvas', 'trigger']);
  });
});

// ── 5: the way out ──────────────────────────────────────────────────────────────────────────────────────
describe('setup has an obvious way out', () => {
  // The real keydown handler from the preload, with a fake ipcRenderer and document.
  function pre() {
    const listeners = {}, calls = [];
    const ipcRenderer = {
      on: (ch, fn) => { listeners[ch] = fn; },
      invoke: (ch, ...a) => { calls.push([ch, ...a]); return Promise.resolve(true); },
    };
    let onKey;
    const document = { addEventListener: (ev, fn) => { if (ev === 'keydown') onKey = fn; } };
    new Function('ipcRenderer', 'document',
      sliceBlock(preload, 'let _wpSetupOn = false, _wpSetupScope = null;', '}, false);'))(ipcRenderer, document);
    return {
      calls,
      setup: (p) => listeners['setup-mode']({}, p),
      key: (key, extra = {}) => onKey(Object.assign({ key, defaultPrevented: false, target: { tagName: 'DIV' } }, extra)),
    };
  }
  it('Esc during Setup ALL leaves it, once', () => {
    const p = pre();
    p.setup({ active: true, overlayKey: 'hud' });
    p.key('Escape'); p.key('Escape');
    expect(p.calls).toEqual([['set-setup-mode', false]]);
  });
  it('Esc during Setup THIS leaves through the same call Done uses', () => {
    const p = pre();
    p.setup({ active: true, overlayKey: 'hud', scope: 'this' });
    p.key('Escape');
    expect(p.calls).toEqual([['set-setup-mode-this', false]]);
  });
  it('Esc does nothing when setup is off, when another key is pressed, in a text field, or after a page used it', () => {
    const p = pre();
    p.key('Escape');                                              // never set up
    p.setup({ active: true });
    p.key('Enter');
    p.key('Escape', { target: { tagName: 'INPUT' } });
    p.key('Escape', { target: { tagName: 'DIV', isContentEditable: true } });
    p.key('Escape', { defaultPrevented: true });
    expect(p.calls).toEqual([]);
    p.setup({ active: false }); p.key('Escape');                  // main said setup ended
    expect(p.calls).toEqual([]);
  });
  it('the Canvas: Esc clears a selection first, then leaves arranging like ✓ Done (not while its settings panel is open)', () => {
    const h = stripJs(sliceBlock(canvas, '  // Delete removes the selected pieces; Esc clears the selection.', '  // ── Where is it?'));
    expect(h).toMatch(/if \(Object\.keys\(_sel\)\.length\) \{ _sel = \{\}; render\(\); \}\s*else if \(!menuEl\.classList\.contains\('show'\)\) finishArranging\(\);/);
    const done = stripJs(sliceBlock(canvas, '  function finishArranging() {', '\n  }'));
    expect(done).toMatch(/M\.canvasEdit\(false\)/);
    expect(done).toMatch(/M\.setSetupMode\(false\)/);
    expect(done).toMatch(/M\.setOverlaysLocked\(true\)/);
  });
  it('every overlay page has a Done on its setup bar that turns setup off, and the tray has Exit setup mode', () => {
    const pages = ['overlay', 'buffqueue', 'charm', 'chat', 'chchain', 'command', 'extarget', 'map', 'me', 'melody', 'mobinfo', 'pets',
      'popraid', 'tank', 'threatmeter', 'triggers', 'who', 'zealhealth', 'dock', 'canvas'];
    for (const f of pages) {
      const src = readSource(path.join(MIMIC, f + '.html'));
      expect(src, f + '.html: a Done button').toMatch(/doneBtn|exitSetupBtn/);
      expect(src, f + '.html: Done calls setSetupMode(false)').toMatch(/[sS]etSetupMode\(false\)/);
    }
    expect(stripJs(main)).toMatch(/'🛠 Exit setup mode'/);
  });
});
