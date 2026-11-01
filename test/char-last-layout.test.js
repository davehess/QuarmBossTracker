// test/char-last-layout.test.js — each character's LAST overlay layout: saved as the person changes things, back on
// screen when they swap to that character, with the Canvas remembered per character and nothing moved into it by itself.
//
// The guild lead, 2026-10-30, after raiders said overlay setup "has become a lot" and "I thought the overlay sets were
// going to simplify it": "save the state for each character as changes are made, make them a 'last overlay' that comes
// back up when you swap to that character. Make sure we remember if someone was using the canvas, and don't
// automatically move other overlays into canvas unless the user wants it."
//
// What is pinned (the real functions out of apps/mimic/main.js and the real apps/mimic/overlaySets.js, with the config
// held in memory and the windows stubbed; the snapshot is the real _captureOverlaySet and the load is the real
// _applyOverlaySet, so the round trip is genuine):
//   1. SAVE: a change that has held still for 2 s is written for the character being played, once, under their name
//      only; one still moving is not; nothing is written with no character (it is filed under the first one that turns up);
//      not while everything is hidden, while an overlay is in the person's hand, or while Mimic's own apply settles;
//   2. SWAP: the new character's last layout comes back; the one left keeps its last edit even inside the 2 s wait;
//      a character with no memory leaves the screen alone;
//   3. MULTI-BOX: while the character the screen belongs to is live (a Zeal sample in the last 60 s) nothing moves, an
//      agent that does not list its clients never counts as quiet, and the layout lands once the other client is quiet;
//      the first look after launch applies;
//   4. CANVAS: on/off and its panels are per character; a character who never used it does not inherit another's pieces;
//      class-set seeding cannot turn it on;
//   5. the files: kept apart from the named sets (no MAX_SETS cost, not in the list); forget; the field escape;
//   6. the legacy "Save layout for <character>" profile gives way once a last layout exists; the wiring is where it should be.
//
// Run: npx vitest run test/char-last-layout.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const overlaySets = require(path.join(ROOT, 'apps', 'mimic', 'overlaySets.js'));
const main = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const code = stripJs(main);

const SRC = [
  sliceBlock(main, 'const _HIDEALL_FLAGS = [', '\n];'),
  sliceBlock(main, 'const _SET_BOUNDS_KEYS = [', '\n];'),
  sliceBlock(main, 'const _SET_LOOK_KEYS = [', '];'),
  sliceBlock(main, 'function _captureOverlaySet() {', '\n}\n'),
  sliceBlock(main, 'function _noteCanvasChoice(cfg) {', '\n}\n'),
  sliceBlock(main, 'function _applyOverlaySet(set) {', '\n  return true;\n}'),
  sliceBlock(main, 'const _LAST_FILE = () =>', '// ── end of the last layout ──'),
].join('\n');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lastlayout-')); });

const T = 1_000_000;                                      // an arbitrary "now"
const live = (name, t) => ({ character: name, updatedAt: t });

function world({ active = null, initial = {} } = {}) {
  return new Function('overlaySets', 'path', 'dir', 'active', 'initial', `
    let disk = JSON.stringify(initial);
    let _activeCharName = active, _hideAllActive = false, _hideAllPrev = null, setupMode = false, _dragSession = null;
    let canvasWindow = null, liveRects = {}, agentOnly = false;
    const logs = [], applied = [];
    const app = { getPath: () => dir };
    const loadConfig = () => JSON.parse(disk);
    const saveConfig = (c) => { disk = JSON.stringify(c); };
    const appendAgentLog = (l) => logs.push(l);
    const _agentOnly = () => agentOnly;
    const _screenSignature = () => 'one';
    const _overlayRectsNow = () => liveRects;
    const _floorFor = () => 0;
    const _floorWith = () => null;
    const _eqMainWindow = () => null;
    const _setRectsHere = (set) => (set && set.rects) || {};
    const _overlayEntries = () => [];
    const _boundsKeyForEntry = () => null;
    const _applyScaleInPlace = () => {};
    const applyAllVisibility = () => {}, applyAllOverlayOpacities = () => {}, applyAllOverlayBackdrops = () => {};
    const pushStatus = () => {}, buildTrayMenu = () => {};
    ${SRC}
    const realApply = _applyOverlaySet;
    return {
      cfg: () => JSON.parse(disk),
      // the person: change the config the way a toggle, a drag end or a slider does
      user(fn) { const c = loadConfig(); fn(c); saveConfig(c); },
      who(n) { _activeCharName = n; },
      hideAll(on) { _hideAllActive = !!on; },
      setup(on) { setupMode = !!on; },
      drag(on) { _dragSession = on ? { win: {} } : null; },
      agentOnly(on) { agentOnly = !!on; },
      rects(r) { liveRects = r; },
      watch: (t) => _lastLayoutWatch(t),
      observe: (n, clients, t) => _lastLayoutObserve(n, clients, t),
      flush: (c) => _lastLayoutFlush(c),
      fp: () => _layoutFingerprint(loadConfig()),
      forget: (c) => _forgetLastLayout(c),
      has: (c) => _hasLastLayout(c),
      owner: () => _lastOwner,
      logs,
      store: () => overlaySets.loadLast(path.join(dir, 'overlay-last.json')),
    };
  `)(overlaySets, path, dir, active, initial);
}

// Let a change settle and be written: the first look sees it, the next one after 2 s writes it.
function settle(w, t) { w.watch(t); return w.watch(t + 2100); }

describe('saved as the person changes things', () => {
  it('a change that has held still for 2 s is written for the character being played, and only theirs', () => {
    const w = world({ active: 'Aldenmar', initial: { showHud: false } });
    expect(w.watch(T)).toBe(false);                         // the first look is the baseline
    w.user(c => { c.showHud = true; });
    expect(w.watch(T + 500)).toBe(false);                   // seen, still settling
    expect(w.watch(T + 2400)).toBe(false);                  // 1.9 s
    expect(w.watch(T + 2600)).toBe(true);                   // 2.1 s since it was first seen
    const s = w.store();
    expect(Object.keys(s.chars)).toEqual(['aldenmar']);
    expect(s.chars.aldenmar.show.showHud).toBe(true);
    expect(w.watch(T + 9000)).toBe(false);                  // once: nothing new to say
  });
  it('a change that keeps moving is not written until it stops (a drag, a slider)', () => {
    const w = world({ active: 'Aldenmar' });
    w.watch(T);
    for (let i = 1; i <= 6; i++) { w.user(c => { c.hudBounds = { x: i * 10, y: 5, width: 300, height: 200 }; c.hudBoundsSig = 'one'; }); expect(w.watch(T + i * 1000)).toBe(false); }
    expect(w.store().chars.aldenmar).toBeUndefined();
    expect(w.watch(T + 8100)).toBe(true);
    expect(w.store().chars.aldenmar.rects.hudBounds.x).toBe(60);
  });
  it('every part of a layout counts as a change: visibility, position, look, floor, the Canvas and its panels', () => {
    const base = world({ active: 'Aldenmar' });
    const fp0 = base.fp();
    for (const edit of [
      c => { c.showMobInfo = true; },
      c => { c.mobInfoBounds = { x: 1, y: 2, width: 3, height: 4 }; },
      c => { c.mobInfoBoundsSig = 'two'; },
      c => { c.mobInfoBoundsFloor = { one: 90 }; },
      c => { c.overlayOpacity = { hud: 0.5 }; },
      c => { c.overlayScaleByKey = { hud: 1.2 }; },
      c => { c.showCanvas = true; },
      c => { c.canvasLayouts = { '1920x1080': { panels: [] } }; },
    ]) {
      const w = world({ active: 'Aldenmar' });
      w.user(edit);
      expect(w.fp()).not.toBe(fp0);
    }
  });
  it('the layout written is the real snapshot: positions, look and the Canvas ride in it', () => {
    const w = world({ active: 'Aldenmar' });
    w.watch(T);
    w.user(c => { c.showHud = true; c.showCanvas = true; c.canvasLayouts = { '1920x1080': { panels: [{ id: 'a', kind: 'overlay', key: 'hud' }] } };
      c.overlayOpacity = { hud: 0.6 }; c.hudBounds = { x: 40, y: 50, width: 300, height: 200 }; c.hudBoundsSig = 'one'; });
    settle(w, T + 1000);
    const s = w.store().chars.aldenmar;
    expect(s.show.showHud).toBe(true);
    expect(s.show.showCanvas).toBe(true);
    expect(s.canvas['1920x1080'].panels[0].key).toBe('hud');
    expect(s.look.overlayOpacity).toEqual({ hud: 0.6 });
    expect(s.rects.hudBounds).toEqual({ x: 40, y: 50, width: 300, height: 200 });
    expect(typeof s.fp).toBe('string');
  });
  it('with no character known nothing is written; the arrangement is filed under whoever turns up first', () => {
    const w = world({ active: null });
    w.watch(T);
    w.user(c => { c.showWho = true; });
    expect(settle(w, T + 1000)).toBe(false);
    expect(w.store().chars).toEqual({});
    w.who('Brackwyn');
    w.observe('Brackwyn', [live('Brackwyn', T + 9000)], T + 9000);   // it is theirs, and it is not replaced by an older memory
    expect(w.store().chars.brackwyn.show.showWho).toBe(true);
    expect(w.owner()).toBe('brackwyn');
  });
  it('not while everything is hidden, and unhiding writes nothing (it is the layout it was)', () => {
    const w = world({ active: 'Aldenmar', initial: { showHud: true, showCharm: true } });
    w.watch(T);
    w.hideAll(true);
    w.user(c => { c.showHud = false; c.showCharm = false; });
    expect(settle(w, T + 1000)).toBe(false);
    w.user(c => { c.showHud = true; c.showCharm = true; });
    w.hideAll(false);
    expect(settle(w, T + 20_000)).toBe(false);
    expect(w.store().chars).toEqual({});
  });
  it('not while an overlay is in the person\'s hand, then it is written', () => {
    const w = world({ active: 'Aldenmar' });
    w.watch(T);
    w.user(c => { c.hudBounds = { x: 1, y: 1, width: 300, height: 200 }; c.hudBoundsSig = 'one'; });
    w.drag(true);
    expect(settle(w, T + 1000)).toBe(false);
    w.drag(false);
    expect(w.watch(T + 9000)).toBe(true);
  });
  it('not for agent-only mode, and the field escape switches it all off', () => {
    const a = world({ active: 'Aldenmar' });
    a.watch(T); a.agentOnly(true); a.user(c => { c.showHud = true; });
    expect(settle(a, T + 1000)).toBe(false);
    const off = world({ active: 'Aldenmar', initial: { charLastLayoutOff: true } });
    off.watch(T); off.user(c => { c.showHud = true; });
    expect(settle(off, T + 1000)).toBe(false);
    expect(off.observe('Brackwyn', [live('Brackwyn', T)], T)).toBe(false);
    expect(off.store().chars).toEqual({});
  });
});

describe('back on screen when you swap to that character', () => {
  // Aldenmar plays with the HUD, Brackwyn with the charm tracker; each leaves their layout behind.
  function twoCharacters() {
    const w = world({ active: 'Aldenmar' });
    w.watch(T);
    w.user(c => { c.showHud = true; });
    settle(w, T + 1000);                                    // Aldenmar's layout is written
    w.who('Brackwyn');                                       // Aldenmar camps; Brackwyn logs in a minute later
    w.observe('Brackwyn', [live('Brackwyn', T + 70_000)], T + 70_000);
    w.user(c => { c.showHud = false; c.showCharm = true; });
    settle(w, T + 80_000);                                   // Brackwyn's layout is written
    return w;
  }
  it('swapping back puts the other character\'s overlays on screen and takes yours off', () => {
    const w = twoCharacters();
    expect(w.cfg().showCharm).toBe(true);
    w.who('Aldenmar');
    expect(w.observe('Aldenmar', [live('Aldenmar', T + 200_000), live('Brackwyn', T + 100_000)], T + 200_000)).toBe(true);
    expect(w.cfg().showHud).toBe(true);
    expect(w.cfg().showCharm).toBe(false);
    expect(w.owner()).toBe('aldenmar');
    w.who('Brackwyn');
    expect(w.observe('Brackwyn', [live('Brackwyn', T + 400_000)], T + 400_000)).toBe(true);
    expect(w.cfg().showCharm).toBe(true);
    expect(w.cfg().showHud).toBe(false);
  });
  it('positions come back too, not just which overlays are on', () => {
    const w = world({ active: 'Aldenmar' });
    w.watch(T);
    w.user(c => { c.showHud = true; c.hudBounds = { x: 10, y: 20, width: 300, height: 200 }; c.hudBoundsSig = 'one'; });
    settle(w, T + 1000);
    w.who('Brackwyn'); w.observe('Brackwyn', [live('Brackwyn', T + 70_000)], T + 70_000);
    w.user(c => { c.hudBounds = { x: 900, y: 700, width: 300, height: 200 }; });
    settle(w, T + 80_000);
    w.who('Aldenmar');
    w.observe('Aldenmar', [live('Aldenmar', T + 200_000)], T + 200_000);
    expect(w.cfg().hudBounds).toEqual({ x: 10, y: 20, width: 300, height: 200 });
  });
  it('the character being left keeps an edit made inside the 2 s wait', () => {
    const w = world({ active: 'Aldenmar' });
    w.observe('Aldenmar', [live('Aldenmar', T)], T);           // the first look after launch: the screen is theirs
    w.watch(T);
    w.user(c => { c.showMelody = true; });
    w.watch(T + 500);                                        // seen, not yet written
    w.who('Brackwyn');
    w.observe('Brackwyn', [live('Brackwyn', T + 70_000)], T + 70_000);
    expect(w.store().chars.aldenmar.show.showMelody).toBe(true);
  });
  it('a character with no memory leaves the screen exactly as it is, and the first change starts their record', () => {
    const w = world({ active: 'Aldenmar', initial: { showHud: true } });
    w.watch(T);
    w.user(c => { c.showWho = true; });
    settle(w, T + 1000);
    const before = w.cfg();
    w.who('Corvale');
    expect(w.observe('Corvale', [live('Corvale', T + 70_000)], T + 70_000)).toBe(false);
    expect(w.cfg()).toEqual(before);
    expect(w.store().chars.corvale).toBeUndefined();
    w.user(c => { c.showWho = false; });
    settle(w, T + 80_000);
    expect(w.store().chars.corvale.show.showWho).toBe(false);
    expect(w.store().chars.aldenmar.show.showWho).toBe(true);   // theirs did not change
  });
  it('when the screen is already that character\'s, nothing is re-applied (no canvas reload, no window churn)', () => {
    const w = world({ active: 'Aldenmar' });
    w.observe('Aldenmar', [live('Aldenmar', T)], T);
    w.watch(T);
    w.user(c => { c.showHud = true; });
    settle(w, T + 1000);                                      // Aldenmar's layout is written, and it is what is on screen
    w.who('Corvale');                                         // a new character takes over the screen as it is…
    w.observe('Corvale', [live('Corvale', T + 70_000)], T + 70_000);
    w.who('Aldenmar');                                        // …and Aldenmar is back with nothing changed
    expect(w.observe('Aldenmar', [live('Aldenmar', T + 200_000)], T + 200_000)).toBe(false);
    expect(w.logs.filter(l => /last layout is back/.test(l))).toEqual([]);
    expect(w.owner()).toBe('aldenmar');
  });
});

describe('two clients open: the screen does not rearrange when you alt-tab', () => {
  function bothSaved() {
    const w = world({ active: 'Aldenmar' });
    w.watch(T);
    w.user(c => { c.showHud = true; });
    settle(w, T + 1000);
    w.who('Brackwyn'); w.observe('Brackwyn', [live('Brackwyn', T + 70_000)], T + 70_000);
    w.user(c => { c.showHud = false; c.showCharm = true; });
    settle(w, T + 80_000);
    w.who('Aldenmar'); w.observe('Aldenmar', [live('Aldenmar', T + 200_000)], T + 200_000);   // the screen is Aldenmar's
    return w;
  }
  it('both live: switching the active character moves nothing, however often you flip', () => {
    const w = bothSaved();
    const screen = w.cfg();
    for (let i = 0; i < 4; i++) {
      const t = T + 210_000 + i * 2000;
      const clients = [live('Aldenmar', t - 1000), live('Brackwyn', t)];
      w.who('Brackwyn'); expect(w.observe('Brackwyn', clients, t)).toBe(false);
      w.who('Aldenmar'); expect(w.observe('Aldenmar', clients, t + 1000)).toBe(false);
    }
    expect(w.cfg()).toEqual(screen);
    expect(w.owner()).toBe('aldenmar');
  });
  it('an edit made while playing the second client is that client\'s, and the screen becomes theirs', () => {
    const w = bothSaved();
    w.who('Brackwyn');
    const t = T + 300_000, both = [live('Aldenmar', t), live('Brackwyn', t)];
    expect(w.observe('Brackwyn', both, t)).toBe(false);
    w.watch(t);
    w.user(c => { c.showMelody = true; });
    settle(w, t + 1000);
    expect(w.store().chars.brackwyn.show.showMelody).toBe(true);
    expect(w.store().chars.aldenmar.show.showMelody).toBeFalsy();
    expect(w.owner()).toBe('brackwyn');
  });
  it('the other client\'s last sample 59 s ago still counts as live; at 60 s it has gone quiet', () => {
    const w = bothSaved();
    w.who('Brackwyn');
    const t = T + 300_000;
    expect(w.observe('Brackwyn', [live('Aldenmar', t - 59_000), live('Brackwyn', t)], t)).toBe(false);
    expect(w.observe('Brackwyn', [live('Aldenmar', t - 60_000), live('Brackwyn', t)], t)).toBe(true);
    expect(w.cfg().showCharm).toBe(true);
  });
  it('the layout lands on its own once the other client closes (looked at again every poll)', () => {
    const w = bothSaved();
    w.who('Brackwyn');
    const t = T + 300_000;
    expect(w.observe('Brackwyn', [live('Aldenmar', t), live('Brackwyn', t)], t)).toBe(false);
    expect(w.observe('Brackwyn', [live('Aldenmar', t), live('Brackwyn', t + 30_000)], t + 30_000)).toBe(false);
    expect(w.observe('Brackwyn', [live('Aldenmar', t), live('Brackwyn', t + 61_000)], t + 61_000)).toBe(true);
    expect(w.owner()).toBe('brackwyn');
  });
  it('an agent that does not list its clients is never treated as quiet; the first look after launch still applies', () => {
    const w = bothSaved();
    w.who('Brackwyn');
    expect(w.observe('Brackwyn', undefined, T + 900_000)).toBe(false);
    expect(w.observe('Brackwyn', null, T + 990_000)).toBe(false);
    // a fresh launch has no owner yet: the active character's memory is applied at once, other clients or not
    const f = world({ active: 'Aldenmar' });
    f.watch(T); f.user(c => { c.showHud = true; }); settle(f, T + 1000);
    const relaunch = world({ active: null, initial: { showHud: false } });          // same folder: a new Mimic, the layout file is on disk
    relaunch.watch(T + 5_000_000);
    relaunch.who('Aldenmar');
    expect(relaunch.observe('Aldenmar', [live('Aldenmar', T + 5_000_100), live('Brackwyn', T + 5_000_100)], T + 5_000_100)).toBe(true);
    expect(relaunch.cfg().showHud).toBe(true);
  });
  it('not while everything is hidden, in setup, or with an overlay in hand; it is asked again next poll', () => {
    for (const hold of [w => w.hideAll(true), w => w.setup(true), w => w.drag(true)]) {
      const w = bothSaved();
      w.who('Brackwyn');
      const t = T + 400_000;
      hold(w);
      expect(w.observe('Brackwyn', [live('Brackwyn', t)], t)).toBe(false);
      expect(w.cfg().showCharm).toBe(false);
      w.hideAll(false); w.setup(false); w.drag(false);
      expect(w.observe('Brackwyn', [live('Brackwyn', t + 1000)], t + 1000)).toBe(true);
      expect(w.cfg().showCharm).toBe(true);
    }
  });
});

describe('the layout Mimic applies is not mistaken for an edit', () => {
  it('the windows echoing their new bounds after an apply write nothing; a real edit afterwards does', () => {
    const w = world({ active: 'Aldenmar' });
    w.watch(T);
    w.user(c => { c.showHud = true; c.hudBounds = { x: 10, y: 20, width: 300, height: 200 }; c.hudBoundsSig = 'one'; });
    settle(w, T + 1000);
    w.who('Brackwyn'); w.observe('Brackwyn', [live('Brackwyn', T + 70_000)], T + 70_000);
    w.user(c => { c.showHud = false; });
    settle(w, T + 80_000);
    const stored = JSON.stringify(w.store());
    w.who('Aldenmar');
    const t = T + 200_000;
    expect(w.observe('Aldenmar', [live('Aldenmar', t)], t)).toBe(true);
    // the setBounds echoes land as config writes inside the hold
    w.user(c => { c.hudBounds = { x: 11, y: 21, width: 300, height: 200 }; });
    expect(w.watch(t + 400)).toBe(false);
    expect(w.watch(t + 2900)).toBe(false);
    expect(w.watch(t + 6000)).toBe(false);
    expect(JSON.stringify(w.store().chars.brackwyn)).toBe(JSON.stringify(JSON.parse(stored).chars.brackwyn));
    w.user(c => { c.showMelody = true; });
    expect(settle(w, t + 7000)).toBe(true);
  });
});

describe('the Canvas belongs to the character who chose it', () => {
  const layoutWithHud = { '1920x1080': { panels: [{ id: 'oHud', kind: 'overlay', key: 'hud', x: 0.3, y: 0.3, w: 320, h: 240 }] } };
  function canvasUserAndNot() {
    const w = world({ active: 'Aldenmar' });
    w.watch(T);
    w.user(c => { c.showCanvas = true; c.showHud = true; c.canvasLayouts = layoutWithHud; });
    settle(w, T + 1000);                                     // Aldenmar uses the Canvas, with the HUD on it
    w.who('Brackwyn');
    w.observe('Brackwyn', [live('Brackwyn', T + 70_000)], T + 70_000);
    w.user(c => { c.showCanvas = false; c.showHud = true; c.showCharm = true; c.canvasLayouts = {}; });   // Brackwyn does not
    settle(w, T + 80_000);
    return w;
  }
  it('a character who used it gets it back, panels and all; one who did not stays without it', () => {
    const w = canvasUserAndNot();
    w.who('Aldenmar');
    w.observe('Aldenmar', [live('Aldenmar', T + 200_000)], T + 200_000);
    expect(w.cfg().showCanvas).toBe(true);
    expect(w.cfg().canvasLayouts).toEqual(layoutWithHud);
    w.who('Brackwyn');
    w.observe('Brackwyn', [live('Brackwyn', T + 400_000)], T + 400_000);
    expect(w.cfg().showCanvas).toBe(false);
  });
  it('a character without the Canvas does not inherit another\'s pieces: switching it on later starts from its own', () => {
    const w = world({ active: 'Aldenmar' });
    w.watch(T);
    w.user(c => { c.showCanvas = true; c.canvasLayouts = layoutWithHud; });
    settle(w, T + 1000);
    // Brackwyn has a layout from before the Canvas existed: no Canvas, no panels in it
    const store = overlaySets.loadLast(path.join(dir, 'overlay-last.json'));
    overlaySets.putLast(store, 'Brackwyn', { show: { showHud: true, showCanvas: false }, canvas: null, rects: {}, sig: 'one' });
    overlaySets.save(path.join(dir, 'overlay-last.json'), store);
    w.who('Brackwyn');
    expect(w.observe('Brackwyn', [live('Brackwyn', T + 70_000)], T + 70_000)).toBe(true);
    expect(w.cfg().showCanvas).toBe(false);
    expect(w.cfg().canvasLayouts).toEqual({});               // the HUD panel would otherwise take Brackwyn's HUD window away
  });
  it('turning it on or off is part of the next write, so a relaunch and a swap both keep the answer', () => {
    const w = world({ active: 'Aldenmar', initial: { showCanvas: false } });
    w.watch(T);
    w.user(c => { c.showCanvas = true; });
    settle(w, T + 1000);
    expect(w.store().chars.aldenmar.show.showCanvas).toBe(true);
    w.user(c => { c.showCanvas = false; });
    settle(w, T + 10_000);
    expect(w.store().chars.aldenmar.show.showCanvas).toBe(false);
  });
  it('a swap to a character with no memory does not turn the Canvas on', () => {
    const w = world({ active: 'Aldenmar', initial: { showCanvas: false, showHud: true } });
    w.watch(T);
    w.user(c => { c.showMobInfo = true; });
    settle(w, T + 1000);
    w.who('Corvale');
    w.observe('Corvale', [live('Corvale', T + 70_000)], T + 70_000);
    expect(w.cfg().showCanvas).toBe(false);
  });
  it('class-set seeding cannot switch the Canvas on, even if a crafted set names it', () => {
    const flagMap = new Function(sliceBlock(main, 'const _CLASS_SET_FLAG_BY_KEY = {', '\n};') + '\nreturn _CLASS_SET_FLAG_BY_KEY;')();
    expect(Object.values(flagMap)).not.toContain('showCanvas');
    let disk = JSON.stringify({});
    const run = new Function('flagMap', 'loadConfig', 'saveConfig', `
      const _HIDEALL_FLAGS = ['showHud', 'showCanvas'];
      const _CLASS_SET_FLAG_BY_KEY = flagMap, _CLASS_SET_WINDOWS = [];
      let _hideAllActive = false, setupMode = false, _activeCharName = 'Aldenmar';
      const applyAllVisibility = () => {}, pushStatus = () => {}, buildTrayMenu = () => {}, appendAgentLog = () => {}, setTimeout = () => {};
      ${sliceBlock(main, 'function _maybeSeedClassSet(s) {', '\n}\n')}
      return _maybeSeedClassSet;
    `)(flagMap, () => JSON.parse(disk), (c) => { disk = JSON.stringify(c); });
    run({ classOverlaySets: { warrior: ['hud', 'canvas', 'showCanvas'] }, activeCharacterClass: 'Warrior' });
    const c = JSON.parse(disk);
    expect(c.showHud).toBe(true);
    expect(c.showCanvas).toBeUndefined();
  });
});

describe('the files: apart from the named sets, forgettable', () => {
  it('lives in a file of its own, so the 40-set cap and the sets list never see it', () => {
    expect(code).toMatch(/const _LAST_FILE = \(\) => path\.join\(app\.getPath\('userData'\), 'overlay-last\.json'\);/);
    expect(code).toMatch(/const _SETS_FILE = \(\) => path\.join\(app\.getPath\('userData'\), 'overlay-sets\.json'\);/);
    const w = world({ active: 'Aldenmar' });
    w.watch(T); w.user(c => { c.showHud = true; }); settle(w, T + 1000);
    expect(fs.existsSync(path.join(dir, 'overlay-last.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'overlay-sets.json'))).toBe(false);
    expect(overlaySets.list(overlaySets.load(path.join(dir, 'overlay-sets.json')))).toEqual([]);
  });
  it('the store: one entry per character, letters only, the oldest leaves past the cap, junk on disk is ignored', () => {
    const s = overlaySets.emptyLast();
    const snap = { show: { showHud: true } };
    expect(overlaySets.putLast(s, 'Aldenmar', snap, 5).ok).toBe(true);
    expect(overlaySets.putLast(s, 'Not A Name', snap).ok).toBe(false);
    expect(overlaySets.putLast(s, null, snap).ok).toBe(false);
    expect(overlaySets.putLast(s, 'Brackwyn', { rects: {} }).ok).toBe(false);          // nothing to keep
    expect(overlaySets.lastFor(s, 'ALDENMAR').savedAt).toBe(5);
    expect(overlaySets.putLast(s, 'aldenmar', { show: { showHud: false } }, 9).ok).toBe(true);
    expect(Object.keys(s.chars)).toEqual(['aldenmar']);
    for (let i = 0; i < overlaySets.LAST_MAX + 5; i++) overlaySets.putLast(s, 'Char' + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26)), snap, 100 + i);
    expect(Object.keys(s.chars).length).toBe(overlaySets.LAST_MAX);
    expect(overlaySets.lastFor(s, 'aldenmar')).toBeNull();                               // the oldest went
    expect(overlaySets.removeLast(s, 'Chaaa')).toBe(false);
    const bad = overlaySets.normalizeLast({ chars: { aldenmar: { show: { a: 1 } }, 'Bad Name': { show: {} }, brackwyn: 'x', corvale: {} } });
    expect(Object.keys(bad.chars)).toEqual(['aldenmar']);
    expect(overlaySets.loadLast(path.join(dir, 'missing.json'))).toEqual(overlaySets.emptyLast());
  });
  it('forgetting removes the memory; the screen is not touched and the next change starts it again', () => {
    const w = world({ active: 'Aldenmar' });
    w.watch(T); w.user(c => { c.showHud = true; }); settle(w, T + 1000);
    expect(w.has('aldenmar')).toBe(true);
    expect(w.forget('aldenmar')).toBe(true);
    expect(w.has('aldenmar')).toBe(false);
    expect(w.forget('aldenmar')).toBe(false);
    expect(w.cfg().showHud).toBe(true);
    w.user(c => { c.showHud = false; });
    settle(w, T + 20_000);
    expect(w.store().chars.aldenmar.show.showHud).toBe(false);
  });
  it('the last 2 s of an edit are kept when Mimic quits (flush), and nothing is written when nothing changed', () => {
    const w = world({ active: 'Aldenmar' });
    w.watch(T);
    expect(w.flush('aldenmar')).toBe(false);
    w.user(c => { c.showZeal = true; });
    expect(w.flush('aldenmar')).toBe(true);
    expect(w.store().chars.aldenmar.show.showZeal).toBe(true);
    expect(w.flush('aldenmar')).toBe(false);
    expect(w.flush(null)).toBe(false);
  });
});

describe('the older "Save layout for <character>" gives way, and the wiring is where it should be', () => {
  function legacy({ hasLast }) {
    const calls = { applied: [], builds: 0 };
    const api = new Function('calls', 'hasLast', `
      let _activeCharName = null, _lastProfileChar = null;
      const loadConfig = () => ({ charProfilesEnabled: true });
      const _applyCharProfile = (cl) => { calls.applied.push(cl); return false; };
      const _hasLastLayout = () => hasLast;
      const _applyCharOverlayState = () => {}, _charStateKey = (c) => c, buildTrayMenu = () => { calls.builds++; };
      ${sliceBlock(main, 'function _onActiveCharacter(name) {', '\n}')}
      return _onActiveCharacter;
    `)(calls, hasLast);
    return { on: api, calls };
  }
  it('a character with a last layout is not also given the visibility-only profile; one without still is', () => {
    const a = legacy({ hasLast: true });
    a.on('Aldenmar');
    expect(a.calls.applied).toEqual([]);
    const b = legacy({ hasLast: false });
    b.on('Aldenmar');
    expect(b.calls.applied).toEqual(['aldenmar']);
  });
  it('the state poll hands the active character and the agent\'s clients to the swap, after the profile step', () => {
    const poll = sliceBlock(code, 'try { _onActiveCharacter(s && s.activeCharacter); } catch {}', 'try { _maybeSeedClassSet(s); } catch {}');
    expect(poll).toMatch(/_lastLayoutObserve\(s && s\.activeCharacter, s && s\.zealClients\)/);
  });
  it('the watcher runs once a second, and shutdown flushes the character being played', () => {
    expect(code).toMatch(/setInterval\(\(\) => \{ try \{ _lastLayoutWatch\(\); \} catch \(e\) \{ void e; \} \}, 1000\);/);
    const shut = sliceBlock(code, 'function _gracefulShutdown(reason, cfgPatch) {', '_stopEqPolling();');
    expect(shut.indexOf('_flushAllBounds(cfgPatch)')).toBeLessThan(shut.indexOf('_lastLayoutFlush(_lastWho())'));
  });
  it('forgetting a character\'s layout, from the tray or the dashboard, forgets the automatic one too', () => {
    expect(sliceBlock(code, "ipcMain.handle('char-profile-forget'", '\n});')).toMatch(/_forgetLastLayout\(key\)/);
    expect(sliceBlock(code, 'function _charProfileTrayItems() {', '\n}\n')).toMatch(/_forgetLastLayout\(charLc\)/);
  });
  it('a swap applies through _applyOverlaySet (so a layout from another screen setup keeps its side) with the Canvas slot replaced', () => {
    const sw = sliceBlock(code, 'function _switchLastLayout(cl, now) {', '\n}\n');
    expect(sw).toMatch(/_applyOverlaySet\(Object\.assign\(\{\}, snap, \{ canvas: snap\.canvas \|\| \{\} \}\)\);/);
    expect(code).not.toMatch(/_lastLayout\w*\([^)]*\)[^;\n]*showCanvas\s*=\s*true/);
  });
});
