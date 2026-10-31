// test/canvas-per-character.test.js — whether a character wanted the Timers canvas is remembered with their layout.
//
// The guild lead, 2026-10-30: "overlay sets aren't remembering if a character wanted to use canvas or not."
// Both saves already carried the flag (a character's layout: _CHAR_PROFILE_FLAGS; an overlay set: _HIDEALL_FLAGS), so
// the loss was elsewhere: a character's saved layout is a snapshot, and it is written back over the live setting at
// every launch and every character change. One saved while the Canvas was off (the 3.0.3 pass writes every profile
// off, once) turned a Canvas the person had since switched on back OFF; one saved while it was on brought back a Canvas
// they had since closed. _noteCanvasChoice makes the person's own on/off click update the active character's saved
// layout too.
//
// What is pinned (all against the real functions in apps/mimic/main.js, stubbed config in memory):
//   1. both saves list the Canvas flag; a layout without it leaves the Canvas as it is (an old save);
//   2. the round trip: save with it off, switch it on, change character and back, it is still on — and the reverse;
//   3. only an existing layout of the ACTIVE character is touched, and only its Canvas flag;
//   4. loading an overlay set puts the Canvas on or off as the set says, leaves it alone when the set has no
//      answer, and the answer lands in the character's layout;
//   5. every place that writes the person's Canvas choice calls it (text check, comments stripped).
//
// Run: npx vitest run test/canvas-per-character.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, sliceArrayLiteral, stripJs, ROOT } from './_source-slice.js';

const main = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const code = stripJs(main);

// ── a config that lives in memory the way config.json lives on disk ─────────────────────────────────────────
function world({ active = 'Aldenmar', initial = {} } = {}) {
  const src = [
    sliceBlock(main, 'const _CHAR_PROFILE_FLAGS = [', '\n];'),
    sliceBlock(main, 'function _captureCharProfile(charLower) {', '\n}\n'),
    sliceBlock(main, 'function _noteCanvasChoice(cfg) {', '\n}\n'),
    sliceBlock(main, 'function _applyCharProfile(charLower) {', '\n}\n'),
    sliceBlock(main, 'function _applyOverlaySet(set) {', '\n  return true;\n}'),
  ].join('\n');
  const w = new Function('active', 'initial', `
    let disk = JSON.stringify(initial);
    let _activeCharName = active, _hideAllActive = false, _hideAllPrev = null, canvasWindow = null;
    const loadConfig = () => JSON.parse(disk);
    const saveConfig = (c) => { disk = JSON.stringify(c); };
    const _saveLayoutSnapshot = () => true;
    const _CHAR_PROFILE_WINDOWS = [];
    const _HIDEALL_FLAGS = ['showHud', 'showCanvas', 'showMap'];
    const _SET_LOOK_KEYS = [];
    const _setRectsHere = () => ({});
    const _screenSignature = () => 'one';
    const _floorWith = () => null;
    const _overlayEntries = () => [];
    const _boundsKeyForEntry = () => null;
    const _applyScaleInPlace = () => {};
    const applyAllVisibility = () => {}, applyAllOverlayOpacities = () => {}, applyAllOverlayBackdrops = () => {};
    const pushStatus = () => {}, buildTrayMenu = () => {}, appendAgentLog = () => {};
    ${src}
    return {
      cfg: () => JSON.parse(disk),
      // the person's own switch: what _toggleOverlay('canvas'), the Canvas's ✕ and an accepted arrange all do
      choose(on) { const c = loadConfig(); c.showCanvas = !!on; _noteCanvasChoice(c); saveConfig(c); },
      who(n) { _activeCharName = n; },
      save: (k) => _captureCharProfile(k),
      apply: (k) => _applyCharProfile(k),
      note: (c) => _noteCanvasChoice(c),
      loadSet: (s) => _applyOverlaySet(s),
    };
  `)(active, initial);
  return w;
}

describe('both saves carry the Canvas flag', () => {
  it('a character\'s layout lists showCanvas, and so does what an overlay set holds', () => {
    expect(sliceArrayLiteral(main, 'const _CHAR_PROFILE_FLAGS = [')).toContain('showCanvas');
    expect(sliceArrayLiteral(main, 'const _HIDEALL_FLAGS = [')).toContain('showCanvas');
  });
  it('a saved layout records the Canvas as on or off', () => {
    const on = world({ initial: { showCanvas: true, showHud: true } });
    on.save('aldenmar');
    expect(on.cfg().charProfiles.aldenmar.show.showCanvas).toBe(true);
    const off = world({ initial: { showCanvas: false, showHud: true } });
    off.save('aldenmar');
    expect(off.cfg().charProfiles.aldenmar.show.showCanvas).toBe(false);
  });
  it('a layout saved before the Canvas existed says nothing, and applying it leaves the Canvas as it is', () => {
    const w = world({ initial: { showCanvas: true, showHud: false, charProfiles: { aldenmar: { show: { showHud: true } } } } });
    expect(w.apply('aldenmar')).toBe(true);
    expect(w.cfg().showHud).toBe(true);
    expect(w.cfg().showCanvas).toBe(true);
  });
});

describe('the person\'s own choice follows them into the character\'s layout', () => {
  it('saved with the Canvas off, switched on later: a character change (or a relaunch) no longer turns it off', () => {
    const w = world({ initial: { showCanvas: false, showHud: true } });
    w.save('aldenmar');
    w.choose(true);
    expect(w.cfg().charProfiles.aldenmar.show.showCanvas).toBe(true);
    w.apply('aldenmar');
    expect(w.cfg().showCanvas).toBe(true);
  });
  it('saved with the Canvas on, closed later: the layout does not bring it back', () => {
    const w = world({ initial: { showCanvas: true, showHud: true } });
    w.save('aldenmar');
    w.choose(false);
    w.apply('aldenmar');
    expect(w.cfg().showCanvas).toBe(false);
  });
  it('two characters keep their own answers: one wants the Canvas, the other does not', () => {
    const w = world({ initial: { showCanvas: false } });
    w.save('aldenmar'); w.who('Brackwyn'); w.save('brackwyn');
    w.who('Aldenmar'); w.choose(true);                         // Aldenmar turns it on
    w.who('Brackwyn'); w.apply('brackwyn');                    // switch to Brackwyn: off, as saved
    expect(w.cfg().showCanvas).toBe(false);
    w.who('Aldenmar'); w.apply('aldenmar');                    // and back: Aldenmar's answer stuck
    expect(w.cfg().showCanvas).toBe(true);
    expect(w.cfg().charProfiles.brackwyn.show.showCanvas).toBe(false);
  });
  it('touches only the Canvas flag of an existing layout of the active character', () => {
    const w = world({ initial: { showCanvas: false, charProfiles: { aldenmar: { show: { showHud: true, showCanvas: false }, savedAt: 5 } } } });
    w.choose(true);
    expect(w.cfg().charProfiles.aldenmar).toEqual({ show: { showHud: true, showCanvas: true }, savedAt: 5 });
    // another character's layout is never written
    const o = world({ active: 'Brackwyn', initial: { charProfiles: { aldenmar: { show: { showCanvas: false } } } } });
    o.choose(true);
    expect(o.cfg().charProfiles.aldenmar.show.showCanvas).toBe(false);
  });
  it('no layout saved yet, or no active character: nothing is created', () => {
    const none = world({ initial: {} });
    none.choose(true);
    expect(none.cfg().charProfiles).toBeUndefined();
    const quiet = world({ active: null, initial: { charProfiles: { aldenmar: { show: { showCanvas: false } } } } });
    quiet.choose(true);
    expect(quiet.cfg().charProfiles.aldenmar.show.showCanvas).toBe(false);
  });
  it('reports whether it changed anything, and survives odd data', () => {
    const w = world({});
    expect(w.note({ showCanvas: true, charProfiles: { aldenmar: { show: { showCanvas: true } } } })).toBe(false);
    expect(w.note({ showCanvas: true, charProfiles: { aldenmar: { show: { showCanvas: false } } } })).toBe(true);
    for (const bad of [null, {}, { charProfiles: null }, { charProfiles: { aldenmar: null } }, { charProfiles: { aldenmar: { show: 'x' } } }]) {
      expect(() => w.note(bad)).not.toThrow();
      expect(w.note(bad)).toBe(false);
    }
  });
});

describe('an overlay set and the Canvas', () => {
  it('a set saved with the Canvas on puts it on; saved off puts it off', () => {
    const w = world({ initial: { showCanvas: false, showHud: false } });
    w.loadSet({ show: { showCanvas: true, showHud: true } });
    expect(w.cfg().showCanvas).toBe(true);
    w.loadSet({ show: { showCanvas: false, showHud: true } });
    expect(w.cfg().showCanvas).toBe(false);
  });
  it('an old set with no answer about the Canvas leaves it exactly as it is', () => {
    for (const was of [true, false]) {
      const w = world({ initial: { showCanvas: was, showHud: false } });
      w.loadSet({ show: { showHud: true } });
      expect(w.cfg().showCanvas).toBe(was);
      expect(w.cfg().showHud).toBe(true);
    }
    const bare = world({ initial: { showCanvas: true } });
    bare.loadSet({});
    expect(bare.cfg().showCanvas).toBe(true);
  });
  it('the answer a set gives lands in the character\'s layout, so a relaunch keeps it', () => {
    const w = world({ initial: { showCanvas: false, charProfiles: { aldenmar: { show: { showHud: true, showCanvas: false } } } } });
    w.loadSet({ show: { showCanvas: true } });
    expect(w.cfg().charProfiles.aldenmar.show.showCanvas).toBe(true);
    w.apply('aldenmar');
    expect(w.cfg().showCanvas).toBe(true);
  });
});

describe('every place the person switches the Canvas records it', () => {
  it('the tray / dashboard / hotkey toggle, the Canvas\'s own ✕, an accepted arrange and a loaded set', () => {
    const toggle = sliceBlock(code, "case 'canvas':", 'applyTriggerVisibility();');
    expect(toggle).toMatch(/cfg\.showCanvas = !cfg\.showCanvas;\s*_noteCanvasChoice\(cfg\);\s*saveConfig\(cfg\);/);
    const x = sliceBlock(code, '} else if (win === canvasWindow) {', 'applyTriggerVisibility();');
    expect(x).toMatch(/cfg\.showCanvas = false;[^\n]*_noteCanvasChoice\(cfg\);\s*saveConfig\(cfg\);/);
    const arrange = sliceBlock(code, 'function _setCanvasArrange(on, consented) {', '\n}\n');
    expect(arrange).toMatch(/cfg\.showCanvas = true;\s*_noteCanvasChoice\(cfg\);\s*saveConfig\(cfg\);/);
    const set = sliceBlock(code, 'function _applyOverlaySet(set) {', '\n  return true;\n}');
    expect(set.indexOf('_noteCanvasChoice(cfg);')).toBeGreaterThan(set.indexOf('cfg[f] = set.show[f]'));
    expect(set.indexOf('_noteCanvasChoice(cfg);')).toBeLessThan(set.indexOf('saveConfig(cfg);'));
  });
  it('the hide-all and the load-time pass are NOT the person\'s choice and do not write a layout', () => {
    const hide = sliceBlock(code, 'function toggleHideAllOverlays() {', '\n}\n');
    expect(hide).not.toMatch(/_noteCanvasChoice/);
  });
});
