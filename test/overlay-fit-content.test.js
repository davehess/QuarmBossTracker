// test/overlay-fit-content.test.js — overlays fit their height to their content, up or down; Canvas items grow
// up and set their own background (Mimic beta).
//
// The guild lead, 2026-10-19: "we should always fit vertically to content with overlays, whether growing up
// or down. Canvas should be able to grow up as well. Canvas items should be able to individually set
// background, or avoid the all-toggle."
//
// What is under test, the shipped code cut out of main.js / preload.js / canvas.html and run against fakes:
//   1  the one shared fit (main.js overlay-auto-height): grow down holds the top edge, grow up holds the
//      bottom edge, never taller than the work area, the width held, and NOT while the user is dragging
//      (held, then the page is asked once when the drag ends)
//   2  the preload content watcher: a page that has fit once keeps fitting when its content changes, through
//      the same fit, and stops itself if its element only ever creeps
//   3  the Canvas: every item that has a content height fits it and says which edge stays put
//   4  the Canvas: Background is each item's own; the whole-Canvas switch is only a default; a layout saved
//      before is stamped once so nothing changes on screen
// Text assertions strip comments first (test/_source-slice.js); every assertion here was mutation-checked.
//
// Run: npx vitest run test/overlay-fit-content.test.js

import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, stripCss, ROOT } from './_source-slice.js';

const MAIN = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const PRELOAD = readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js'));
const CANVAS = readSource(path.join(ROOT, 'apps', 'mimic', 'canvas.html'));
const TRIGGERS = readSource(path.join(ROOT, 'apps', 'mimic', 'triggers.html'));
const m = stripJs(MAIN), p = stripJs(PRELOAD), c = stripJs(CANVAS), t = stripJs(TRIGGERS);

// ── 1  main.js: the one fit ────────────────────────────────────────────────────────────────────────────────
const fitBlock = sliceBlock(MAIN, 'function _fitHeldWidth(win, readW) {', '\n}') + '\n'
  + sliceBlock(MAIN, "ipcMain.handle('overlay-auto-height'", '\n});');
const stopBlock = sliceBlock(MAIN, 'function _stopWindowDrag() {', '\n}\n');

function mainEnv({ growsUp = false, work = { x: 0, y: 0, width: 1920, height: 1080 }, floor = 0 } = {}) {
  return evalBlock(`
    const handlers = {};
    const ipcMain = { handle(n, f) { handlers[n] = f; } };
    const BrowserWindow = { fromWebContents(wc) { return wc.win; } };
    const displays = [];
    const screen = { getDisplayMatching() { displays.push(1); return { workArea: ${JSON.stringify(work)} }; } };
    const _heightFloorFor = () => ${floor};
    const _setupChromeFor = () => 0;
    const _overlayGrowsUp = () => ${growsUp};
    const _overlayEntries = () => [];
    const _holdForMove = (w) => !!(w && w.__wpDragging);   // the real one is tested in mimic-window-move.test.js
    const _GROW_UP_DEFAULT_KEYS = new Set();
    const appendAgentLog = () => {};
    ${fitBlock}
    function win(b) {
      const w = { b: Object.assign({}, b), sets: [], destroyed: false,
        getBounds() { return Object.assign({}, this.b); },
        setBounds(n) { this.sets.push(n); this.b = Object.assign({}, n); },
        isDestroyed() { return this.destroyed; },
        webContents: { getZoomFactor() { return 1; } } };
      w.webContents.win = w;
      return w;
    }
    const fit = (w, h) => handlers['overlay-auto-height']({ sender: w.webContents }, h);
  `, ['win', 'fit', 'displays']);
}

describe('overlay-auto-height: one fit, up or down', () => {
  it('growing DOWN keeps the top edge: y stays, the height follows the content', () => {
    const E = mainEnv({ growsUp: false });
    const w = E.win({ x: 300, y: 400, width: 320, height: 150 });
    E.fit(w, 260);
    expect(w.sets).toEqual([{ x: 300, y: 400, width: 320, height: 260 }]);
  });
  it('growing UP keeps the bottom edge: the height follows the content and y moves up by the growth', () => {
    const E = mainEnv({ growsUp: true });
    const w = E.win({ x: 300, y: 600, width: 320, height: 150 });
    E.fit(w, 260);
    expect(w.sets).toEqual([{ x: 300, y: 490, width: 320, height: 260 }]);
    expect(w.b.y + w.b.height).toBe(750);                  // the bottom edge is where it was
    E.fit(w, 100);                                          // and shrinking holds it too: y comes back down
    expect(w.b.y + w.b.height).toBe(750);
    expect(w.b.height).toBe(100);
  });
  it('fits both ways: a shrink of a real size is taken, jitter is not', () => {
    const E = mainEnv();
    const w = E.win({ x: 0, y: 0, width: 320, height: 300 });
    E.fit(w, 302);                                          // 2 px: jitter
    E.fit(w, 290);                                          // 10 px shrink under 12: held (a card collapsing for one tick)
    expect(w.sets.length).toBe(0);
    E.fit(w, 200);
    expect(w.b.height).toBe(200);
  });
  it('is never taller than the display\'s work area, and never below 50', () => {
    const E = mainEnv({ work: { x: 0, y: 40, width: 1920, height: 1000 } });
    const w = E.win({ x: 0, y: 100, width: 320, height: 150 });
    E.fit(w, 5000);
    expect(w.b.height).toBe(980);                           // work area height - 20
    E.fit(w, 1);
    expect(w.b.height).toBe(50);
  });
  it('growing up stops at the top of the work area and never leaves the screen it is on', () => {
    const E = mainEnv({ growsUp: true, work: { x: 1920, y: 30, width: 1920, height: 1050 } });
    const w = E.win({ x: 2000, y: 100, width: 320, height: 150 });
    E.fit(w, 600);
    expect(w.b.y).toBe(30);                                 // clamped at the work area's top
    expect(w.b.x).toBe(2000);                               // x is never touched: it stays on its screen
    expect(E.displays.length).toBeGreaterThan(0);           // sized against the display it is on
  });
  it('holds the width: a read-back a pixel off never creeps, so the fit cannot fight a width the user set', () => {
    const E = mainEnv();
    const w = E.win({ x: 0, y: 0, width: 320, height: 150 });
    E.fit(w, 260);
    w.b.width = 321;                                        // Windows rounding on a scaled display
    E.fit(w, 400);
    expect(w.sets[1].width).toBe(320);
  });
  it('does NOT run while the user is dragging: held, and the drag-end asks the page for one fit', () => {
    const E = mainEnv();
    const w = E.win({ x: 0, y: 0, width: 320, height: 150 });
    w.__wpDragging = true;
    E.fit(w, 400);
    E.fit(w, 450);
    expect(w.sets.length).toBe(0);
    expect(w.__wpFitPending).toBe(true);
    // _stopWindowDrag: clears the flag and sends wp-refit once (the page re-measures; no stale height replayed)
    const sent = [];
    const S = evalBlock(`
      let _dragSession = null;
      const _persistBounds = () => {}; const _chatDragEnd = () => {};
      ${stopBlock}
      function stopWith(w) { _dragSession = { win: w, interval: 0, persistKey: 'k', restoreFocusable: false, chat: null }; _stopWindowDrag(); }
    `, ['stopWith']);
    w.webContents.send = (...a) => sent.push(a);
    S.stopWith(w);
    expect(w.__wpDragging).toBe(false);
    expect(w.__wpFitPending).toBe(false);
    expect(sent).toEqual([['wp-refit']]);
    E.fit(w, 400);                                          // fits again once the drag is over
    expect(w.b.height).toBe(400);
  });
  it('a drag with no fit held back sends nothing at its end', () => {
    const sent = [];
    const S = evalBlock(`
      let _dragSession = null;
      const _persistBounds = () => {}; const _chatDragEnd = () => {};
      ${stopBlock}
      function stopWith(w) { _dragSession = { win: w, interval: 0, persistKey: 'k', restoreFocusable: false, chat: null }; _stopWindowDrag(); }
    `, ['stopWith']);
    S.stopWith({ __wpDragging: true, isDestroyed: () => false, webContents: { send: (...a) => sent.push(a) } });
    expect(sent).toEqual([]);
  });
  it('every drag path sets the flag (the ✥ drag, and the ◢ and ◥ grips that ride the same session)', () => {
    expect(m).toMatch(/win\.__wpDragging = true;\s*_dragSession\.interval = setInterval/);
    expect(m).toMatch(/function _startWindowResize\(win\) \{[\s\S]{0,200}_startWindowDrag\(win\);/);
    expect(m).toMatch(/function _startWindowResizeUp\(win\) \{[\s\S]{0,200}_startWindowDrag\(win\);/);
  });
});

// ── 2  preload.js: the content watcher ──────────────────────────────────────────────────────────────────────
const watchBlock = sliceBlock(PRELOAD, 'const WP_FIT_WATCH_MS = 150;', '\n}\n');

function watcher({ docked = false } = {}) {
  return evalBlock(`
    const WP_IS_DOCKED = ${docked};
    const fits = [];
    function _autoFitOverlay(el) { fits.push(el.scrollHeight); }
    const observers = [];
    class ResizeObserver { constructor(cb) { this.cb = cb; this.live = true; observers.push(this); } observe() {} disconnect() { this.live = false; } }
    class MutationObserver { constructor(cb) { this.cb = cb; this.live = true; observers.push(this); } observe() {} disconnect() { this.live = false; } }
    ${watchBlock}
    function el(h) { return { scrollHeight: h, isConnected: true }; }
    function poke() { observers.forEach(o => o.live && o.cb()); }
  `, ['_wpWatchFitContent', 'fits', 'observers', 'el', 'poke']);
}

describe('the content watcher (preload.js)', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('a watched element that changes size is fit again through the same fit, once per burst', () => {
    vi.useFakeTimers();
    const W = watcher(), e = W.el(100);
    W._wpWatchFitContent(e);
    e.scrollHeight = 180;
    W.poke(); W.poke(); W.poke();                           // a burst of resize + mutation callbacks
    vi.advanceTimersByTime(200);
    expect(W.fits).toEqual([180]);
    e.scrollHeight = 90;                                    // and shrinking is fit too
    W.poke();
    vi.advanceTimersByTime(200);
    expect(W.fits).toEqual([180, 90]);
  });
  it('an unchanged height asks for nothing', () => {
    vi.useFakeTimers();
    const W = watcher(), e = W.el(100);
    W._wpWatchFitContent(e);
    e.scrollHeight = 150; W.poke(); vi.advanceTimersByTime(200);
    W.poke(); vi.advanceTimersByTime(200);
    expect(W.fits.length).toBe(1);
  });
  it('watches an element once, however many times the page hands it over', () => {
    const W = watcher(), e = W.el(100);
    W._wpWatchFitContent(e); W._wpWatchFitContent(e); W._wpWatchFitContent(e);
    expect(W.observers.length).toBe(2);                     // one ResizeObserver and one MutationObserver
  });
  it('does nothing in the dock, where the grid owns the window height', () => {
    const W = watcher({ docked: true });
    W._wpWatchFitContent(W.el(100));
    expect(W.observers.length).toBe(0);
  });
  it('an element that only ever creeps by the buffer is a feedback loop: the watch ends itself', () => {
    vi.useFakeTimers();
    const W = watcher(), e = W.el(100);
    W._wpWatchFitContent(e);
    for (let i = 1; i <= 12; i++) { e.scrollHeight += 12; W.poke(); vi.advanceTimersByTime(200); }
    expect(W.fits.length).toBe(6);                          // the first fit, then five creeping steps; the sixth ends it
    expect(W.observers.every(o => o.live === false)).toBe(true);
    const n = W.fits.length;
    e.scrollHeight += 400; W.poke(); vi.advanceTimersByTime(200);
    expect(W.fits.length).toBe(n);
  });
  it('is wired: the first element a page fits is watched, in its own try so a watch failure never blocks the fit', () => {
    expect(p).toMatch(/if \(wrapEl\) \{ _wpLastFitEl = wrapEl; try \{ _wpWatchFitContent\(wrapEl\); \} catch \(e\) \{ void e; \} \}/);
    // observed: size of the element, and structure inside it (not attributes: a countdown bar's style moves every frame)
    expect(p).toMatch(/new ResizeObserver\(kick\)/);
    expect(p).toMatch(/mo\.observe\(el, \{ childList: true, subtree: true \}\)/);
  });
});

// ── 3 + 4  canvas.html ──────────────────────────────────────────────────────────────────────────────────────
const pure = sliceBlock(CANVAS, '  function cleanBack(v)', '  // ── end Background and height ──');
const P = evalBlock(pure, ['cleanBack', 'backOf', 'migrateBack', 'growsUp', 'fitKind', 'fitOn', 'fitBox']);

describe('Canvas: which edge stays put (grows up / grows down)', () => {
  it('a timers or callouts panel has always hung off its bottom edge: no anchor = grows up; "top" = grows down', () => {
    for (const kind of ['timers', 'callouts']) {
      expect(P.growsUp({ kind })).toBe(true);
      expect(P.growsUp({ kind, anchor: 'bottom' })).toBe(true);
      expect(P.growsUp({ kind, anchor: 'top' })).toBe(false);
    }
  });
  it('every other kind has always grown down: no anchor = grows down; only "bottom" grows up (no migration)', () => {
    for (const kind of ['overlay', 'sect', 'part']) {
      expect(P.growsUp({ kind })).toBe(false);
      expect(P.growsUp({ kind, anchor: 'top' })).toBe(false);
      expect(P.growsUp({ kind, anchor: 'bottom' })).toBe(true);
    }
  });
  it('the box: grows up keeps the bottom edge, grows down keeps the top edge, neither leaves the screen', () => {
    const H = 1000;
    // a panel whose top is 600 and height 100 (bottom 700) wants 250
    expect(P.fitBox(0.6, 100, 250, true, H, 36)).toEqual({ y: 0.45, h: 250 });
    expect(P.fitBox(0.6, 100, 250, false, H, 36)).toEqual({ y: 0.6, h: 250 });
    // and shrinks the same way
    expect(P.fitBox(0.45, 250, 60, true, H, 36)).toEqual({ y: 0.64, h: 60 });
    // the room it has: up to the screen's top, down to the screen's bottom
    expect(P.fitBox(0.1, 100, 900, true, H, 36).h).toBe(200);
    expect(P.fitBox(0.1, 100, 900, true, H, 36).y).toBe(0);
    expect(P.fitBox(0.9, 100, 900, false, H, 36).h).toBe(100);
    // never below its floor, and an empty item keeps the floor
    expect(P.fitBox(0.5, 100, 0, true, H, 36)).toEqual({ y: (600 - 36) / H, h: 36 });
    expect(P.fitBox(0.5, 100, 5, false, H, 16).h).toBe(16);
  });
});

describe('Canvas: which items follow their content', () => {
  const list = { kind: 'list' }, gauge = { kind: 'gauge' };
  it('timers, callouts, a whole overlay page and a page cut from one; a list piece as rows, chips or columns', () => {
    expect(P.fitKind({ kind: 'timers' })).toBe(true);
    expect(P.fitKind({ kind: 'callouts' })).toBe(true);
    expect(P.fitKind({ kind: 'overlay', key: 'mobinfo' })).toBe(true);
    expect(P.fitKind({ kind: 'overlay', key: 'me', style: 'a' })).toBe(true);
    expect(P.fitKind({ kind: 'sect' })).toBe(true);
    for (const mode of ['', 'rows', 'chips', 'columns']) expect(P.fitKind({ kind: 'part', mode }, list), mode).toBe(true);
  });
  it('not the HUD\'s ring, not a one-line list, not a Ring arc, not a gauge or a number', () => {
    expect(P.fitKind({ kind: 'overlay', key: 'me', style: 'hud' })).toBe(false);
    expect(P.fitKind({ kind: 'overlay', key: 'me', style: '' })).toBe(false);
    for (const mode of ['inline', 'seg']) expect(P.fitKind({ kind: 'part', mode }, list), mode).toBe(false);
    expect(P.fitKind({ kind: 'part', mode: 'bar' }, gauge)).toBe(false);
    expect(P.fitKind({ kind: 'part', mode: 'rows' }, null)).toBe(false);
  });
  it('fit is on unless the item was sized by hand (fit:false); a cut-out page always follows its page', () => {
    expect(P.fitOn({ kind: 'timers' })).toBe(true);
    expect(P.fitOn({ kind: 'timers', fit: false })).toBe(false);
    expect(P.fitOn({ kind: 'overlay', key: 'tank', fit: false })).toBe(false);
    expect(P.fitOn({ kind: 'part', mode: 'rows', fit: false }, { kind: 'list' })).toBe(false);
    expect(P.fitOn({ kind: 'sect', fit: false })).toBe(false);   // it has no switch: it is the section's box
    expect(P.fitOn({ kind: 'part', mode: 'bar' }, { kind: 'gauge' })).toBe(false);
  });
});

describe('Canvas: Background is each item\'s own', () => {
  it('an item\'s own setting wins over the Canvas default, either way; one that never chose follows the default', () => {
    expect(P.backOf({ back: true }, false)).toBe(true);
    expect(P.backOf({ back: false }, true)).toBe(false);
    expect(P.backOf({}, true)).toBe(true);
    expect(P.backOf({}, false)).toBe(false);
    expect(P.backOf({ back: undefined }, true)).toBe(true);
    expect(P.cleanBack(true)).toBe(true);
    expect(P.cleanBack(false)).toBe(false);
    expect(P.cleanBack('yes')).toBeUndefined();
    expect(P.cleanBack(undefined)).toBeUndefined();
  });
  it('a layout saved before: ONE stamp of the whole-Canvas value onto every item, so nothing changes on screen', () => {
    // switch was ON: every item was plated, whatever its own (old) piece flag said
    const on = { panels: [{ kind: 'timers' }, { kind: 'part', back: false }, { kind: 'part', back: true }, { kind: 'overlay' }] };
    expect(P.migrateBack(on, true)).toBe(true);
    expect(on.panels.map(q => q.back)).toEqual([true, true, true, true]);
    expect(on.backV).toBe(1);
    // switch was OFF: nothing was plated but the pieces that asked; the rest become an explicit "no"
    const off = { panels: [{ kind: 'timers' }, { kind: 'part', back: false }, { kind: 'part', back: true }] };
    expect(P.migrateBack(off, false)).toBe(true);
    expect(off.panels.map(q => q.back)).toEqual([false, false, true]);
  });
  it('and only once: a stamped layout is left alone, and the default then never reaches an item that has chosen', () => {
    const l = { backV: 1, panels: [{ kind: 'timers', back: false }, { kind: 'part' }] };
    expect(P.migrateBack(l, true)).toBe(false);
    expect(l.panels.map(q => q.back)).toEqual([false, undefined]);
    expect(P.migrateBack(null, true)).toBe(false);
    expect(P.migrateBack({ panels: 'x' }, true)).toBe(false);
  });
});

describe('Canvas: sanitize keeps what an item chose, and adds nothing to what it did not', () => {
  // sanitize, run for real (the block timers-canvas.test.js runs for routing)
  const san = new Function('window', sliceBlock(CANVAS, '  var GROUPS = [', '  // ── Panels ──') + '\nreturn sanitize;')({});
  const one = (o) => san({ panels: [Object.assign({ id: 'a', x: 0.2, y: 0.3, w: 200, h: 100, scale: 1 }, o)] }).panels.find(q => q.id === 'a');
  it('back is stored only when it is a real choice', () => {
    expect(one({ kind: 'timers', back: true }).back).toBe(true);
    expect(one({ kind: 'timers', back: false }).back).toBe(false);
    expect('back' in one({ kind: 'timers' })).toBe(false);
    expect('back' in one({ kind: 'timers', back: 'yes' })).toBe(false);
    expect(one({ kind: 'overlay', key: 'tank', back: true }).back).toBe(true);
    expect(one({ kind: 'part', part: 'me.hp', back: true }).back).toBe(true);
    expect('back' in one({ kind: 'part', part: 'me.hp' })).toBe(false);
  });
  it('anchor: timers and callouts as before (anything but "top" is bottom); the rest keep only "bottom"', () => {
    expect(one({ kind: 'timers' }).anchor).toBe('bottom');
    expect(one({ kind: 'timers', anchor: 'top' }).anchor).toBe('top');
    expect(one({ kind: 'overlay', key: 'tank', anchor: 'bottom' }).anchor).toBe('bottom');
    expect('anchor' in one({ kind: 'overlay', key: 'tank' })).toBe(false);
    expect('anchor' in one({ kind: 'overlay', key: 'tank', anchor: 'top' })).toBe(false);
    expect(one({ kind: 'part', part: 'me.hp', anchor: 'bottom' }).anchor).toBe('bottom');
    expect(one({ kind: 'sect', key: 'mobinfo', sect: 'loot', anchor: 'bottom' }).anchor).toBe('bottom');
  });
  it('fit: only "off" is stored (on is the absence), and the migration mark survives a round trip', () => {
    expect(one({ kind: 'timers', fit: false }).fit).toBe(false);
    expect('fit' in one({ kind: 'timers', fit: true })).toBe(false);
    expect('fit' in one({ kind: 'timers' })).toBe(false);
    expect(san({ panels: [], backV: 1 }).backV).toBe(1);
    expect('backV' in san({ panels: [] })).toBe(false);
  });
});

// ── the live fit: fitStep, run against fake panels ──────────────────────────────────────────────────────────
const fitCode = sliceBlock(CANVAS, '  var FIT_POLL_MS = 300', '  setInterval(fitStep, FIT_POLL_MS);');
// fitStep keeps an item on the screen it is on (Span all screens); with one screen that is the whole window.
const screensCode = sliceBlock(CANVAS, '  var _screens = null, _conv', '  // ── Routing: which panel shows a countdown');

function canvasEnv(panels, { H = 1000 } = {}) {
  const E = new Function(`
    var window = { innerHeight: ${H}, innerWidth: 1920 };
    ${pure}
    function num(v, lo, hi, d) { v = Number(v); return (isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d); }
    ${screensCode}
    var _layout = { panels: [] }, _els = {}, _widen = {}, _fitAdd = {}, _fitEmpty = {}, _drag = null, _menuFor = null, PICKER = '__picker';
    var saves = 0, placed = [], intervals = [];
    function setInterval(f, ms) { intervals.push([f, ms]); }
    function setTimeout(f, ms) { f(); }
    function panelById(id) { return _layout.panels.filter(function (q) { return q.id === id; })[0] || null; }
    function pdefOf(q) { return q.def || null; }
    function place(e, q) { placed.push([q.id, q.y, q.h]); }
    function placeGbox() {} function placeMenu() {}
    function save() { saves++; }
    function embedWant() { return null; }
    function isMin() { return false; }   // ▭ Minimize: fitStep leaves a collapsed strip alone
    ${fitCode}
    return { window: window, layout: _layout, els: _els, set: function (k, v) { eval(k + ' = v'); }, fitStep: fitStep, saves: function () { return saves; }, placed: placed,
      empty: _fitEmpty, intervals: intervals, widen: _widen, fitAdd: _fitAdd };
  `)();
  E.layout.panels.push(...panels);
  return E;
}
const timersEl = (rows, h) => ({ root: { classList: { toggle() {}, remove() {} } },
  frame: { contentDocument: { body: {}, getElementById: (id) => (id === 'timers' ? { children: { length: rows }, offsetHeight: h } : null) } } });

describe('Canvas: the live fit (fitStep)', () => {
  it('a timers panel grows UP with its rows: bottom edge fixed, top moves up, and it is saved (lazily)', () => {
    const q = { id: 't', kind: 'timers', x: 0.5, y: 0.5, w: 340, h: 100, scale: 1 };       // top 500, bottom 600
    const E = canvasEnv([q]);
    E.els.t = timersEl(4, 118);                                                             // 4 rows: 118 + 8 = 126 px
    E.fitStep();
    expect(q.h).toBe(126);
    expect(Math.round(q.y * 1000) + q.h).toBe(600);                                         // the bottom edge did not move
    expect(E.placed.length).toBe(1);
    expect(E.saves()).toBe(1);                                                              // the 2 s timer is stubbed to fire at once
  });
  it('anchored "top" it grows DOWN: the top edge is fixed', () => {
    const q = { id: 't', kind: 'timers', anchor: 'top', x: 0.5, y: 0.5, w: 340, h: 100, scale: 1 };
    const E = canvasEnv([q]);
    E.els.t = timersEl(4, 118);
    E.fitStep();
    expect(q.h).toBe(126);
    expect(q.y).toBe(0.5);
  });
  it('shrinks with its content, to nothing when empty (floor 36), and says it is empty so a plate steps aside', () => {
    const q = { id: 't', kind: 'timers', x: 0.5, y: 0.5, w: 340, h: 226, scale: 1 };
    const E = canvasEnv([q]);
    E.els.t = timersEl(0, 0);
    E.fitStep();
    expect(q.h).toBe(36);
    expect(Math.round(q.y * 1000) + q.h).toBe(726);
    expect(E.empty.t).toBe(true);
    E.els.t = timersEl(1, 22);                                                              // a row lands: no longer empty
    E.fitStep();
    expect(E.empty.t).toBeUndefined();
    expect(q.h).toBe(36);                                                                   // 22 + 8 = 30 < floor
  });
  it('the text size scales the content it makes room for', () => {
    const q = { id: 't', kind: 'timers', scale: 1.5, x: 0.5, y: 0.5, w: 340, h: 200 };
    const E = canvasEnv([q]);
    E.els.t = timersEl(2, 60);
    E.fitStep();
    expect(q.h).toBe(98);                                                                   // 60 * 1.5 + 8
  });
  it('an item sized by hand (fit:false), a hidden one, one being dragged and one with its builder open are left alone', () => {
    const hand = { id: 'a', kind: 'timers', fit: false, x: 0.1, y: 0.1, w: 300, h: 100 };
    const off = { id: 'b', kind: 'timers', off: true, x: 0.1, y: 0.4, w: 300, h: 100 };
    const wide = { id: 'c', kind: 'timers', x: 0.1, y: 0.6, w: 300, h: 100 };
    const E = canvasEnv([hand, off, wide]);
    for (const id of ['a', 'b', 'c']) E.els[id] = timersEl(5, 150);
    E.widen.c = { add: 100 };
    E.fitStep();
    expect([hand.h, off.h, wide.h]).toEqual([100, 100, 100]);
    delete E.widen.c;                                                                       // builder closed: it fits...
    E.set('_drag', { id: 'x' });
    E.fitStep();
    expect(wide.h).toBe(100);                                                               // ...but nothing moves under a drag
    E.set('_drag', null);
    E.fitStep();
    expect(wide.h).toBe(158);                                                               // 150 + 8, once the drag is over
  });
  it('a change under 3 px is not a change (no flicker, no save)', () => {
    const q = { id: 't', kind: 'timers', x: 0.5, y: 0.5, w: 340, h: 126, scale: 1 };
    const E = canvasEnv([q]);
    E.els.t = timersEl(4, 119);
    E.fitStep();
    expect(E.placed.length).toBe(0);
    expect(E.saves()).toBe(0);
  });
  it('an overlay page that tracks its own frame creeps instead of fitting: six steps and it is left alone', () => {
    const q = { id: 'o', kind: 'overlay', key: 'tank', x: 0.3, y: 0.3, w: 300, h: 200, scale: 1 };
    const E = canvasEnv([q]);
    E.els.o = timersEl(1, 1);
    let want = 212;
    E.set('embedWant', function () { return { w: 0, h: want, exact: false }; });
    for (let i = 0; i < 12; i++) { E.fitStep(); want = q.h + 12; }
    expect(q.h).toBeLessThan(200 + 12 * 6);                                                 // it stopped creeping
    const stopped = q.h;
    E.fitStep();
    expect(q.h).toBe(stopped);
  });
  it('the HUD\'s ring is never fit, whatever its page reports', () => {
    const q = { id: 'r', kind: 'overlay', key: 'me', style: 'hud', x: 0.3, y: 0.3, w: 300, h: 300, scale: 1 };
    const E = canvasEnv([q]);
    E.els.r = timersEl(1, 1);
    E.set('embedWant', () => ({ w: 0, h: 80, exact: false }));
    E.fitStep();
    expect(q.h).toBe(300);
  });
  it('polls on a timer; a fitted countdown panel asks for rows by content, a hand-sized one by its box', () => {
    const E = canvasEnv([]);
    expect(E.intervals.map(i => i[1])).toEqual([300]);
    expect(c).toMatch(/setInterval\(fitStep, FIT_POLL_MS\);/);
    const cap = new Function('panelById', 'fitOn', '_fitStop', 'FIT_ROWS', sliceBlock(CANVAS, '  window.wpCanvasRowCap = function (id) {', '\n  };') + '\nreturn window.wpCanvasRowCap;');
    const win = {};
    const mk = (panel, stop) => new Function('window', 'panelById', 'fitOn', '_fitStop', 'FIT_ROWS',
      sliceBlock(CANVAS, '  window.wpCanvasRowCap = function (id) {', '\n  };') + '\nreturn window.wpCanvasRowCap;')(win, () => panel, P.fitOn, stop || {}, 14);
    expect(mk({ kind: 'timers' })('t')).toBe(14);
    expect(mk({ kind: 'timers', fit: false })('t')).toBe(0);
    expect(mk({ kind: 'timers' }, { t: true })('t')).toBe(0);
    expect(mk({ kind: 'callouts' })('t')).toBe(0);
    expect(mk(null)('t')).toBe(0);
    void cap;
  });
});

describe('Canvas: the wiring', () => {
  it('triggers.html asks the Canvas for the row cap first, so a fitted panel is not capped by its own height', () => {
    expect(t).toMatch(/window\.parent && window\.parent\.wpCanvasRowCap[\s\S]{0,120}fc\(PANEL\)[\s\S]{0,80}if \(fitRows > 0\) return fitRows;/);
  });
  it('the ⚙ menu: every item that fits offers fit and grows up / grows down; the old timers-only Stack row is the general one', () => {
    expect(c).toMatch(/if \(fitKind\(p, pdef\)\) \{[\s\S]{0,400}data-fitlive[\s\S]{0,700}data-anchor="bottom"[\s\S]{0,300}data-anchor="top"/);
    expect(c).not.toMatch(/if \(p\.kind === 'timers'\) \{\s*h \+= '<div class="sec">Stack/);
    expect(c).toMatch(/else if \(t\.hasAttribute\('data-anchor'\)\) \{ p\.anchor = t\.getAttribute\('data-anchor'\) === 'top' \? 'top' : 'bottom'; \}/);
    expect(c).toMatch(/else if \(t\.hasAttribute\('data-fitlive'\)\) \{[\s\S]{0,200}if \(fitOn\(p, pdefOf\(p\)\)\) p\.fit = false; else delete p\.fit;/);
  });
  it('a height dragged by hand turns the fit off for that item (and says so); a width alone does not', () => {
    expect(c).toMatch(/if \(Math\.abs\(Math\.round\(d\.h\) - p\.h\) > 2 && fitOn\(p, pdefOf\(p\)\)\) \{ p\.fit = false; note\(/);
    expect(c).toMatch(/Math\.abs\(m\.h - m\.h0\) > 2 && fitOn\(q, pdefOf\(q\)\)\) q\.fit = false;/);
  });
  it('a piece cut from a page that grows up keeps its bottom edge when the section\'s height changes', () => {
    expect(c).toMatch(/if \(!ref && !p\.grp && p\.anchor === 'bottom' && Math\.abs\(h - p\.h\) > 1\) p\.y = num\(\(p\.y \* window\.innerHeight \+ p\.h - h\) \/ window\.innerHeight/);
  });
  it('the whole-Canvas switch is out of the per-item menu; the toolbar has it as the DEFAULT, and the hotkey flips the same flag', () => {
    expect(c).not.toMatch(/\(whole Canvas\)/);
    expect(c).not.toMatch(/data-bg\b/);
    expect(c).toMatch(/id="bgBtn"/);
    expect(c).toMatch(/Default background: /);
    expect(c).toMatch(/function canvasDefaultBack\(\) \{ return document\.body\.classList\.contains\('wp-backdrop'\); \}/);
    expect(c).toMatch(/new MutationObserver\(paintBgBtn\)\.observe\(document\.body, \{ attributes: true, attributeFilter: \['class'\] \}\)/);
  });
  it('every kind is drawn with its own plate: render() asks backOf for all of them, not just pieces', () => {
    expect(c).toMatch(/\n\s*e\.root\.classList\.toggle\('back', backOf\(p, canvasDefaultBack\(\)\)\);/);
    expect(c).not.toMatch(/classList\.toggle\('back', !!p\.back\)/);
    const css = stripCss(CANVAS);
    expect(css).toMatch(/\.panel\.back:not\(\.part\)\{background:rgb\(8 10 14 \/ max\(var\(--bg-alpha,0\.92\), 0\.92\)\);border-radius:6px\}/);
    expect(css).toMatch(/\.panel\.back\.fitempty:not\(\.part\)\{background:transparent\}/);
  });
  it('the Backing choice reaches a whole selection of any kind (a panel and a piece together)', () => {
    expect(c).toMatch(/q\.kind === 'part' \|\| bkind === 'back'/);
    expect(c).toMatch(/q\.grp === p\.grp && \(q\.kind === 'part' \|\| gkind === 'back'\)/);
    expect(c).toMatch(/bulkBackSelect\(\)\)/);
    // run for real: a mixed set takes the Background, and only the Background
    const bulk = new Function('window', 'partDef', 'WpParts', 'num',
      sliceBlock(CANVAS, '  function bulkSet(ps, patch) {', '  var BULK_THICK') + '\nreturn bulkSet;');
    const bulkSet = bulk({ innerWidth: 1000, innerHeight: 1000 }, () => null, {}, (v) => v);
    const set = [{ kind: 'timers' }, { kind: 'overlay' }, { kind: 'sect' }];
    expect(bulkSet(set, { back: true }).changed).toBe(3);
    expect(set.map(q => q.back)).toEqual([true, true, true]);
    expect(bulkSet(set, { thick: 'thick' }).changed).toBe(0);      // a thickness is a piece's
    expect(set.every(q => q.thick === undefined)).toBe(true);
    expect(bulkSet(set, { back: false, thick: 'thick' }).changed).toBe(0);   // nor does a thickness ride along
    expect(set.every(q => q.thick === undefined && q.back === true)).toBe(true);
  });
  it('main tells the Canvas the default (once, for the stamp), and the preload no longer plates every panel off one class', () => {
    expect(m).toMatch(/,\s*backdrop: !!\(\(cfg\.overlayBackdrop && typeof cfg\.overlayBackdrop === 'object'\) \? cfg\.overlayBackdrop : \{\}\)\.canvas/);
    expect(c).toMatch(/if \(migrateBack\(_layout, !!st\.backdrop\)\) save\(\);/);
    expect(p).not.toMatch(/#panels > \.panel:not\(\.off\)\{background/);
    expect(p).toMatch(/contains\('wp-backdrop'\) && !document\.getElementById\('screenBtn'\)\) return true;/);
  });
});
