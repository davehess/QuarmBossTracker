// test/overlay-layout-restore.test.js — FB-101 (a member, Mimic 3.0.4, 2026-10-27): "The overlays do not save when the
// windows are set up to one's liking and then manually saved in the interface. Instead, when mimic exits, the
// overlays are in different positions. The trigger window, for one, does not retain its size when you resize it. It
// snaps back to a smaller size. When you try to Go XL, M, or other sizes, that doesnt work. It would be nice to be able
// to reload a save from the overlays window to bring back the last saved position, and to have overlays retain their
// size and settings consistently."
//
// What the source showed (apps/mimic/main.js):
//  1. 💾 Save current layout kept only WHICH overlays are on (_captureCharProfile); positions and sizes were never in it.
//  2. _resolveBounds threw a saved spot away whenever the screens differ from the ones of the last write, although every
//     setup's layout is remembered (cfg.overlayLayoutBySig). Mimic autostarting before a monitor is up is enough.
//  3. The height a window was dragged to (the "floor", what keeps the trigger window from shrinking to its content) was
//     also valid only on the setup it was set on.
//  4. Loading an overlay set grew or shrank every window by the ratio between the set's scale and the current one a
//     second time (applyAllOverlayOpacities → applyOverlayScale after the rects were already set), and carried no
//     floors and no grow-up choice.
//
// The REAL functions are cut out of main.js and run against fake windows, a fake screen and a fake config, so the test
// follows whatever names the shipped code uses. Every assertion was mutation-checked (see the notes at the end).
//
// Run: npx vitest run test/overlay-layout-restore.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const overlaySets = require(path.join(ROOT, 'apps', 'mimic', 'overlaySets.js'));
const MAIN = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const PRELOAD = readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js'));
const DASH = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));

const A = '0,0,1920x1080';
const B = '0,0,1920x1080|1920,0,1920x1080';
const C = '0,0,2560x1440';

// ── 2. a window being built takes the spot remembered for THESE screens ──────────────────────────────────────────────
const onScreenSrc = sliceBlock(MAIN, 'function _boundsOnScreen(b) {', '  } catch { return false; }\n}');
const resolveSrc = sliceBlock(MAIN, 'function _resolveBounds(boundsKey, sigKey, def, legacySigKey) {', '  return def;\n}');
function resolver(cfg, sig, workArea) {
  const wa = workArea || { x: 0, y: 0, width: 1920, height: 1080 };
  // eslint-disable-next-line no-new-func
  return new Function('loadConfig', '_screenSignature', 'screen',
    onScreenSrc + '\n' + resolveSrc + '\nreturn _resolveBounds;')(
    () => cfg, () => sig, { getAllDisplays: () => [{ workArea: wa }] });
}
const DEF = { x: 700, y: 200, width: 600, height: 200 };
const TRIG = { x: 100, y: 120, width: 420, height: 260 };

describe('a window being built (_resolveBounds)', () => {
  it('takes its saved spot when the screens are the ones it was saved on', () => {
    const cfg = { triggerBounds: TRIG, triggerBoundsSig: A };
    expect(resolver(cfg, A)('triggerBounds', 'triggerBoundsSig', DEF)).toEqual(TRIG);
  });

  it('FB-101: on other screens it takes the spot REMEMBERED for these screens, not the default', () => {
    // Saved last on setup B (two monitors); Mimic starts on setup A (one asleep), where the trigger window sat at TRIG.
    const cfg = {
      triggerBounds: { x: 2000, y: 50, width: 500, height: 300 }, triggerBoundsSig: B,
      overlayLayoutBySig: { [A]: { rects: { triggerBounds: TRIG } }, [B]: { rects: { triggerBounds: { x: 2000, y: 50, width: 500, height: 300 } } } },
    };
    expect(resolver(cfg, A)('triggerBounds', 'triggerBoundsSig', DEF)).toEqual(TRIG);
  });

  it('on screens it has never seen it still falls to the default (the screen-change question owns that case)', () => {
    const cfg = { triggerBounds: TRIG, triggerBoundsSig: A, overlayLayoutBySig: { [A]: { rects: { triggerBounds: TRIG } } } };
    expect(resolver(cfg, C)('triggerBounds', 'triggerBoundsSig', DEF)).toEqual(DEF);
  });

  it('a remembered spot that is off every screen is not used', () => {
    const cfg = { triggerBounds: TRIG, triggerBoundsSig: B, overlayLayoutBySig: { [A]: { rects: { triggerBounds: { x: 5000, y: 5000, width: 400, height: 200 } } } } };
    expect(resolver(cfg, A)('triggerBounds', 'triggerBoundsSig', DEF)).toEqual(DEF);
  });

  it('the memory is read per overlay: one that was never remembered gets the default', () => {
    const cfg = { overlayLayoutBySig: { [A]: { rects: { triggerBounds: TRIG } } } };
    expect(resolver(cfg, A)('charmBounds', 'charmBoundsSig', DEF)).toEqual(DEF);
  });
});

// ── 3. the dragged height is kept per screen setup ───────────────────────────────────────────────────────────────────
const floorSrc = sliceBlock(MAIN, 'const _FLOOR_OTHER_MAX = 5;', '  win.__wpFloor = next;\n}');
function floorEnv(initialCfg, sig) {
  const state = { cfg: JSON.parse(JSON.stringify(initialCfg || {})), sig };
  // eslint-disable-next-line no-new-func
  const api = new Function('loadConfig', 'saveConfig', '_screenSignature', '_boundsKeyForWindow',
    floorSrc + '\nreturn { _floorFor, _floorWith, _heightFloorFor, _setFloor };')(
    () => JSON.parse(JSON.stringify(state.cfg)), (c) => { state.cfg = JSON.parse(JSON.stringify(c)); }, () => state.sig, () => 'triggerBounds');
  return { api, state };
}

describe('the height a window was dragged to (the floor)', () => {
  it('a floor set on one setup is still there after another setup came and went', () => {
    const { api, state } = floorEnv({}, A);
    const win = {};
    api._setFloor(win, 'triggerBounds', 260);            // dragged tall on setup A
    state.sig = B;
    expect(api._heightFloorFor(win)).toBe(0);            // on B it does not apply (screens differ)
    api._setFloor(win, 'triggerBounds', 180);            // and a different height chosen on B
    expect(api._heightFloorFor(win)).toBe(180);
    state.sig = A;
    win.__wpFloor = undefined;                           // a fresh launch on A reads the config
    expect(api._heightFloorFor(win)).toBe(260);          // FB-101: A's height is back, not lost
  });

  it('keeps the old { h, sig } shape until a second setup is involved, and clearing drops all of it', () => {
    const { api, state } = floorEnv({}, A);
    const win = {};
    api._setFloor(win, 'triggerBounds', 150);
    expect(state.cfg.triggerBoundsFloor).toEqual({ h: 150, sig: A });
    state.sig = B;
    api._setFloor(win, 'triggerBounds', 90);
    expect(state.cfg.triggerBoundsFloor).toEqual({ h: 90, sig: B, by: { [A]: 150 } });
    api._setFloor(win, 'triggerBounds', 0);              // ↕ Fit height to content
    expect(state.cfg).not.toHaveProperty('triggerBoundsFloor');
    expect(api._heightFloorFor(win)).toBe(0);
  });

  it('remembers the latest few other setups, oldest out first', () => {
    const { api } = floorEnv({}, A);
    let f = null;
    for (let i = 0; i < 9; i++) f = api._floorWith(f, 'S' + i, 100 + i);
    expect(f.sig).toBe('S8');
    expect(Object.keys(f.by)).toEqual(['S3', 'S4', 'S5', 'S6', 'S7']);
    expect(api._floorFor(f, 'S3')).toBe(103);
    expect(api._floorFor(f, 'S0')).toBe(0);
  });

  it('reads a floor an older Mimic stored', () => {
    const { api } = floorEnv({}, A);
    expect(api._floorFor({ h: 120, sig: A }, A)).toBe(120);
    expect(api._floorFor({ h: 120, sig: A }, B)).toBe(0);
    expect(api._floorFor(null, A)).toBe(0);
  });
});

// ── 4. loading an overlay set: sizes, floors, grow-up, and the scale applied once ───────────────────────────────────
const scaleSrc = sliceBlock(MAIN, 'function _validScale(v) {', '  win.__wpScaleState = { z: target, bounds: null };\n}\n');
const applySrc = sliceBlock(MAIN, 'function _applyOverlaySet(set) {', '  return true;\n}');
const lookKeysSrc = sliceBlock(MAIN, 'const _SET_LOOK_KEYS = [', '];');

function fakeWin(bounds) {
  const w = {
    b: { ...bounds }, zoom: 1, destroyed: false, sent: [],
    getBounds() { return { ...this.b }; },
    setBounds(nb) { this.b = { ...nb }; },
    isDestroyed() { return this.destroyed; },
    webContents: { setZoomFactor(z) { w.zoom = z; }, getZoomFactor() { return w.zoom; }, send(ch, v) { w.sent.push([ch, v]); } },
  };
  return w;
}

function loadSetEnv({ cfg, windows }) {
  const state = { cfg: JSON.parse(JSON.stringify(cfg)), sig: A };
  const entries = Object.entries(windows);
  const bk = { trigger: 'triggerBounds', charm: 'charmBounds' };
  // eslint-disable-next-line no-new-func
  const fn = new Function('loadConfig', 'saveConfig', '_screenSignature', '_HIDEALL_FLAGS', '_setRectsHere', 'applyAllVisibility',
    '_overlayEntries', '_boundsKeyForEntry', 'pushStatus', 'buildTrayMenu', 'applyAllOverlayBackdrops', 'canvasWindow', 'screen',
    `let _hideAllActive = false, _hideAllPrev = null;
     ${floorSrc}
     ${lookKeysSrc}
     ${scaleSrc}
     function applyAllOverlayOpacities() { for (const [key, win] of _overlayEntries()) applyOverlayScale(win, key); }
     ${applySrc}
     return _applyOverlaySet;`)(
    () => JSON.parse(JSON.stringify(state.cfg)), (c) => { state.cfg = JSON.parse(JSON.stringify(c)); }, () => state.sig,
    ['showHud', 'showTriggerOverlay'], (set) => set.rects, () => {}, () => entries, (key) => bk[key] || null,
    () => {}, () => {}, () => {}, null,
    { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) });
  return { apply: fn, state };
}

describe('loading an overlay set (_applyOverlaySet)', () => {
  const SET_RECT = { x: 50, y: 60, width: 450, height: 300 };   // the size AT the set's scale, 1.5

  it('FB-101: the windows come out the size the set had them, whatever the scale is now', () => {
    const win = fakeWin({ x: 10, y: 10, width: 300, height: 200 });
    const { apply } = loadSetEnv({ cfg: { overlayScale: 1.0, overlayScaleGlide: false }, windows: { trigger: win } });
    // Make the window's scale state the way a window that has been showing for a while has it (first application done).
    win.__wpScaleState = { z: 1.0, bounds: null };
    apply({ show: {}, rects: { triggerBounds: SET_RECT }, look: { overlayScaleByKey: { trigger: 1.5 } }, floors: {} });
    expect(win.b).toEqual(SET_RECT);                     // not 675x450: the ratio is not applied a second time
    expect(win.zoom).toBe(1.5);                          // and the content is at the set's scale
    expect(win.__wpScaleState).toEqual({ z: 1.5, bounds: null });
  });

  it('a set made at a smaller scale than now does not shrink the windows a second time either', () => {
    const win = fakeWin({ x: 10, y: 10, width: 600, height: 400 });
    const { apply } = loadSetEnv({ cfg: { overlayScale: 1.5, overlayScaleGlide: false }, windows: { trigger: win } });
    win.__wpScaleState = { z: 1.5, bounds: null };
    apply({ show: {}, rects: { triggerBounds: { x: 0, y: 0, width: 300, height: 200 } }, look: { overlayScaleByKey: { trigger: 1.0 } }, floors: {} });
    expect(win.b).toEqual({ x: 0, y: 0, width: 300, height: 200 });
    expect(win.zoom).toBe(1.0);
  });

  it('an overlay the set has no spot for still follows the scale (the old way)', () => {
    const win = fakeWin({ x: 10, y: 10, width: 200, height: 100 });
    const { apply } = loadSetEnv({ cfg: { overlayScale: 1.0, overlayScaleGlide: false }, windows: { charm: win } });
    win.__wpScaleState = { z: 1.0, bounds: null };
    apply({ show: {}, rects: {}, look: { overlayScaleByKey: { charm: 2.0 } }, floors: {} });
    expect(win.zoom).toBe(2.0);
    expect(win.b.width).toBe(400);
  });

  it('the set\'s heights become the floors, and a window drops its cached one', () => {
    const win = fakeWin({ x: 10, y: 10, width: 300, height: 200 });
    win.__wpFloor = { h: 999, sig: A };
    const { apply, state } = loadSetEnv({
      cfg: { triggerBoundsFloor: { h: 80, sig: A }, charmBoundsFloor: { h: 70, sig: A } },
      windows: { trigger: win },
    });
    apply({ show: {}, rects: { triggerBounds: SET_RECT, charmBounds: { x: 1, y: 1, width: 250, height: 100 } }, look: {}, floors: { triggerBounds: 260 } });
    expect(state.cfg.triggerBoundsFloor).toEqual({ h: 260, sig: A });
    expect(state.cfg).not.toHaveProperty('charmBoundsFloor');   // the set said this one had none
    expect(win.__wpFloor).toBeUndefined();
  });

  it('a set saved before floors were kept leaves the floors alone', () => {
    const win = fakeWin({ x: 10, y: 10, width: 300, height: 200 });
    const { apply, state } = loadSetEnv({ cfg: { triggerBoundsFloor: { h: 80, sig: A } }, windows: { trigger: win } });
    apply({ show: {}, rects: { triggerBounds: SET_RECT }, look: {} });
    expect(state.cfg.triggerBoundsFloor).toEqual({ h: 80, sig: A });
  });

  it('which edge a fitting overlay grows from is part of a set', () => {
    expect(lookKeysSrc).toContain("'overlayGrowUp'");
    const win = fakeWin({ x: 0, y: 0, width: 300, height: 200 });
    const { apply, state } = loadSetEnv({ cfg: {}, windows: { trigger: win } });
    apply({ show: {}, rects: {}, look: { overlayGrowUp: { trigger: false } } });
    expect(state.cfg.overlayGrowUp).toEqual({ trigger: false });
  });
});

// ── 1. 💾 Save current layout keeps where things are; ↩ Restore saved layout brings it back ──────────────────────────
const savedSrc = sliceBlock(MAIN, "const _SAVED_LAYOUT_SET = 'Saved layout';", "  return _setsSay({ ok: true, message: 'Restored your saved layout' }, quiet);\n}");
const captureProfileSrc = sliceBlock(MAIN, 'function _captureCharProfile(charLower) {', '  _saveLayoutSnapshot();\n  return charLower;\n}');

describe('Save current layout / Restore saved layout', () => {
  let dir, file;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-layout-')); file = path.join(dir, 'overlay-sets.json'); });
  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

  function env(snapshot) {
    const applied = [];
    const said = [];
    // eslint-disable-next-line no-new-func
    const api = new Function('overlaySets', '_SETS_FILE', '_captureOverlaySet', '_applyOverlaySet', '_setsSay', 'appendAgentLog', 'loadConfig', 'saveConfig', '_CHAR_PROFILE_FLAGS',
      savedSrc + '\n' + captureProfileSrc + '\nreturn { _saveLayoutSnapshot, _restoreSavedLayout, _captureCharProfile };')(
      overlaySets, () => file, () => snapshot(), (s) => { applied.push(s); return true; },
      (r, quiet) => { said.push([r, quiet]); return r; }, () => {},
      () => ({}), () => {}, ['showHud']);
    return { api, applied, said };
  }

  it('restoring before anything was saved says so and moves nothing', () => {
    const { api, applied } = env(() => ({}));
    const r = api._restoreSavedLayout(false);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/No saved layout yet/);
    expect(applied).toEqual([]);
  });

  it('saving writes the whole snapshot as the set "Saved layout", and restoring applies exactly that', () => {
    let n = 0;
    const { api, applied } = env(() => ({ show: { showHud: true }, sig: A, rects: { triggerBounds: TRIG }, look: {}, floors: { triggerBounds: 260 }, n: ++n }));
    expect(api._saveLayoutSnapshot()).toBe(true);
    const store = overlaySets.load(file);
    expect(Object.values(store.sets).map(s => s.name)).toEqual(['Saved layout']);
    expect(api._restoreSavedLayout(true)).toEqual({ ok: true, message: 'Restored your saved layout' });
    expect(applied).toHaveLength(1);
    expect(applied[0].rects).toEqual({ triggerBounds: TRIG });
    expect(applied[0].floors).toEqual({ triggerBounds: 260 });
    // Saving again replaces it: the LAST save is what comes back.
    api._saveLayoutSnapshot();
    api._restoreSavedLayout(true);
    expect(applied[1].n).toBe(2);
    expect(Object.keys(overlaySets.load(file).sets)).toEqual(['saved layout']);
  });

  it('is nobody\'s current set, so it does not join a character\'s ⏭ cycle', () => {
    const { api } = env(() => ({ show: {}, sig: A, rects: {}, look: {}, floors: {} }));
    overlaySets.save(file, (() => { const s = overlaySets.empty(); overlaySets.put(s, 'Raid', { show: {} }, 'Aldenmar'); return s; })());
    api._saveLayoutSnapshot();
    const store = overlaySets.load(file);
    expect(store.chars.aldenmar).toEqual({ list: ['raid'], current: 'raid' });
    expect(Object.keys(store.sets).sort()).toEqual(['raid', 'saved layout']);
  });

  it('the dashboard and tray save (_captureCharProfile) writes the positions too', () => {
    let called = 0;
    // The profile write needs loadConfig/saveConfig; the snapshot call is what is asserted, through the real file.
    const state = { cfg: {} };
    // eslint-disable-next-line no-new-func
    const api = new Function('overlaySets', '_SETS_FILE', '_captureOverlaySet', '_applyOverlaySet', '_setsSay', 'appendAgentLog', 'loadConfig', 'saveConfig', '_CHAR_PROFILE_FLAGS',
      savedSrc + '\n' + captureProfileSrc + '\nreturn _captureCharProfile;')(
      overlaySets, () => file, () => { called++; return { show: {}, sig: A, rects: { triggerBounds: TRIG }, look: {}, floors: {} }; }, () => true, (r) => r, () => {},
      () => state.cfg, (c) => { state.cfg = c; }, ['showHud']);
    expect(api('aldenmar')).toBe('aldenmar');
    expect(state.cfg.charProfiles.aldenmar.show).toEqual({ showHud: false });
    expect(called).toBe(1);
    expect(overlaySets.load(file).sets['saved layout'].rects).toEqual({ triggerBounds: TRIG });
    expect(api(null)).toBeNull();                        // no character: nothing written, the button is off anyway
    expect(called).toBe(1);
  });

  it('a character change still applies only the visibility profile, never the positions', () => {
    const applyProfile = stripJs(sliceBlock(MAIN, 'function _applyCharProfile(charLower) {', '  return true;\n}'));
    expect(applyProfile).not.toMatch(/_restoreSavedLayout|_applyOverlaySet|setBounds/);
    const onChar = stripJs(sliceBlock(MAIN, 'function _onActiveCharacter(name) {', '\n}\n'));
    expect(onChar).not.toMatch(/_restoreSavedLayout|_applyOverlaySet/);
  });
});

// ── tray ↔ dashboard parity: one button on each, one function behind both ─────────────────────────────────────────────
describe('Restore saved layout is on the tray and on the Overlays tab, driving the same function', () => {
  const main = stripJs(MAIN);
  const preload = stripJs(PRELOAD);
  const dash = stripJs(DASH);

  it('the tray item calls _restoreSavedLayout', () => {
    const tray = sliceBlock(main, 'function _charProfileTrayItems() {', '\n  return items;\n}');
    expect(tray).toMatch(/label: '↩ Restore saved layout', click: \(\) => \{ _restoreSavedLayout\(false\); \}/);
  });

  it('the tray item works with no active character (positions are the screen\'s, not the character\'s)', () => {
    const tray = sliceBlock(main, 'function _charProfileTrayItems() {', '\n  return items;\n}');
    const item = tray.slice(tray.indexOf("label: '↩ Restore saved layout'"), tray.indexOf("label: '↩ Restore saved layout'") + 120);
    expect(item).not.toMatch(/enabled:/);
  });

  it('the dashboard button reaches main through the bridge: layoutRestore → layout-restore → _restoreSavedLayout', () => {
    expect(dash).toMatch(/closest\('\.wp-layout-restore'\)[\s\S]{0,700}?window\.mimic\.layoutRestore\(\)/);
    expect(preload).toMatch(/layoutRestore:\s+\(\)\s+=> ipcRenderer\.invoke\('layout-restore'\)/);
    expect(main).toMatch(/ipcMain\.handle\('layout-restore', \(\) => \{\s*try \{ return _restoreSavedLayout\(true\); \}/);
  });

  it('the Overlays tab draws the button beside the save, with the answer it keeps for a repaint', () => {
    const tiles = stripJs(sliceBlock(DASH, 'function _wpOvLaysHtml(st, cfg, flagOf) {', '\n  return h;\n}\n'));
    expect(tiles).toMatch(/id="wpLayoutRestore"/);
    expect(tiles).toMatch(/var lr = _wpLrLook\(\);/);
  });

  it('the button says what happened, then goes back', () => {
    let now = 5_000_000;
    // eslint-disable-next-line no-new-func
    const api = new Function('Date', sliceBlock(DASH, 'var _WP_CP_FLASH_MS = 2500;', ';\n') + '\n'
      + sliceBlock(DASH, 'var _wpLrFlash = null;', "  return { text: '↩ Restore saved layout', color: '#79c0ff' };\n}")
      + '\nreturn { look: _wpLrLook, set: function(f){ _wpLrFlash = f; } };')({ now: () => now });
    expect(api.look()).toEqual({ text: '↩ Restore saved layout', color: '#79c0ff' });
    api.set({ ok: true, msg: '', at: now });
    expect(api.look().text).toBe('✓ Restored');
    api.set({ ok: false, msg: 'No saved layout yet. Press Save current layout first.', at: now });
    expect(api.look()).toEqual({ text: '✗ No saved layout yet. Press Save current layout first.', color: '#f85149' });
    now += 2600;
    expect(api.look().text).toBe('↩ Restore saved layout');
  });
});

// Mutation checks run when this was written (each made one assertion above go red, then was put back):
//  - _resolveBounds: drop the overlayLayoutBySig fallback                              → "takes the spot REMEMBERED"
//  - _floorWith: stop carrying prev.sig into `by`                                       → "still there after another setup came and went"
//  - _applyOverlaySet: remove the _applyScaleInPlace call                               → "the windows come out the size the set had them" (675x450)
//  - _applyOverlaySet: remove the floors block / the __wpFloor reset                    → "the set's heights become the floors"
//  - _captureCharProfile: remove _saveLayoutSnapshot()                                  → "writes the positions too"
//  - _charProfileTrayItems: remove the restore item                                     → the tray assertion
