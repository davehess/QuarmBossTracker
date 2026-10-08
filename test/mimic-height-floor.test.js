// test/mimic-height-floor.test.js — a height you drag an overlay to is a floor.
//
// A beta tester, 2026-10-07 (Mimic 2.7.10-beta.1): "i want them tiny and they are goliath". The
// investigation the same day (test/mimic-menu-grow-loan.test.js is its first half) found that a
// fitting overlay sets its own height to its content in BOTH directions — overlay-auto-height — so
// a height the user dragged to never stuck: a drag below the content grew back at the next content
// change, a drag above it shrank back once the difference was 12 px. Sixteen overlays fit this way.
// The guild lead picked option A that day: "a dragged height becomes a floor; content only grows
// above it".
//
// What is under test, all of it the REAL shipped code cut out of main.js / preload.js and run
// against fake windows (the pattern of mimic-menu-grow-loan.test.js and overlay-lifecycle.test.js):
//   - the listener on 'browser-window-created' that hooks 'will-resize' on every window
//   - the gesture debounce and the floor it records (unscaled, minus the setup chrome)
//   - overlay-auto-height sizing to max(content, floor)
//   - overlay-fit-height ("↕ Fit height to content") clearing it
//   - the page being asked for one fresh fit ('wp-refit', preload.js) when it is set or cleared
// Text assertions strip comments first (test/_source-slice.js) and every assertion here was
// mutation-checked.
//
// Run: npx vitest run test/mimic-height-floor.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const MAIN = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const PRELOAD = readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js'));

// Persistence + the floor's own functions: the floor code sits between _persistBounds and
// _flushBounds, inside this slice.
const boundsBlock = sliceBlock(MAIN, 'const _boundsSaveTimers = {};', '  _writeBounds(key, win);\n}');
const menuBlock = sliceBlock(MAIN, "ipcMain.handle('overlay-ensure-min-height'",
  'height: s.height });\n    return true;\n  } catch { return false; }\n});');
const presetBlock = sliceBlock(MAIN, "ipcMain.handle('overlay-resize-preset'", '\n});');
const fitBlock = sliceBlock(MAIN, "ipcMain.handle('overlay-auto-height'", '\n});');
const fitHeightBlock = sliceBlock(MAIN, "ipcMain.handle('overlay-fit-height'", '\n});');
const setBoundsBlock = sliceBlock(MAIN, "ipcMain.handle('overlay-set-bounds'", '\n});');
const hookBlock = sliceBlock(MAIN, "app.on('browser-window-created'", '\n});');
const reapBlock = sliceBlock(MAIN, 'function _reapDisabledOverlays() {', '\n}');

const KEY = 'commandBounds';
const FLOOR_KEY = KEY + 'Floor';

// One fake main process around the real code. The fake window behaves like Electron's where it
// matters here: setBounds fires 'resize' (which schedules the bounds save) and NEVER 'will-resize';
// a manual drag (userResize) fires 'will-resize' with the proposed bounds first, then resizes.
// `content` is what the page behind the window would report if asked again. Main's 'wp-refit' goes
// into `sent`; the page answers it on its next turn (pageTurn) the way a fitting page does, with
// overlay-auto-height. A page that never fits has content null and ignores the message. The turn is
// separate from the send because it IS separate: the renderer handles the message after whatever
// the menu's cleanup had already queued ahead of it.
function env({ growsUp = false, work = { x: 0, y: 0, width: 1920, height: 1080 } } = {}) {
  return evalBlock(`
    const handlers = {};
    const ipcMain = { handle(n, f) { handlers[n] = f; } };
    const BrowserWindow = { fromWebContents(wc) { return wc.win; } };
    const screen = { getDisplayMatching() { return { workArea: ${JSON.stringify(work)} }; } };
    let CFG = {};
    const SAVES = { n: 0 };
    function loadConfig() { return JSON.parse(JSON.stringify(CFG)); }
    function saveConfig(c) { CFG = JSON.parse(JSON.stringify(c)); SAVES.n++; }
    function getCfg() { return CFG; }
    let SIG = 'sig';
    function _screenSignature() { return SIG; }
    function setSig(s) { SIG = s; }
    let _displaySettleUntil = 0;
    function _rememberLayout() {}
    const _OVERLAY_MIN_W = 200;
    const _GROW_UP_DEFAULT_KEYS = new Set(['trigger']);
    let setupMode = false;
    function setSetup(v) { setupMode = !!v; }
    const _singleSetupWins = new Set();
    function _overlayEntries() { return []; }
    function appendAgentLog() {}
    function _overlayGrowsUp() { return ${growsUp ? 'true' : 'false'}; }
    function _boundsKeyForWindow(win) { return win.notAnOverlay ? null : '${KEY}'; }
    const appListeners = {};
    const app = { on(ev, f) { appListeners[ev] = f; } };
    function _forgetClosedOverlay() {}
    ${boundsBlock}
    ${menuBlock}
    ${presetBlock}
    ${fitBlock}
    ${fitHeightBlock}
    ${setBoundsBlock}
    ${hookBlock}
    ${reapBlock}
    function mkWin(b, opts) {
      const o = opts || {};
      const w = {
        b: { ...b }, dead: false, zoom: o.zoom || 1, sent: [], handled: 0, content: null, listeners: {},
        notAnOverlay: !!o.notAnOverlay,
        getBounds() { if (this.dead) throw new Error('Object has been destroyed'); return { ...this.b }; },
        setBounds(n) { this.b = { ...this.b, ...n }; _persistBounds('${KEY}', this); },
        isDestroyed() { return this.dead; },
        destroy() { this.dead = true; },
        on(ev, f) { (this.listeners[ev] = this.listeners[ev] || []).push(f); },
        once(ev, f) { this.on(ev, f); },
        emit(ev, ...a) { for (const f of (this.listeners[ev] || [])) f(...a); },
        // A hand drag of an edge or corner: Electron says what the bounds WILL be, then resizes.
        userResize(n) {
          this.emit('will-resize', {}, { ...this.b, ...n });
          this.b = { ...this.b, ...n };
          _persistBounds('${KEY}', this);
        },
        // The page's next turn: it answers every refit it has been asked for.
        pageTurn() {
          while (this.handled < this.sent.length) {
            const ch = this.sent[this.handled++];
            if (ch === 'wp-refit' && this.content != null) handlers['overlay-auto-height']({ sender: this.webContents }, this.content);
          }
        },
        webContents: { id: 1, getZoomFactor() { return w.zoom; }, send(ch) { w.sent.push(ch); } },
      };
      w.webContents.win = w;
      // The real listener hooks the window the moment it is constructed.
      appListeners['browser-window-created']({}, w);
      return w;
    }
    const _OVERLAY_WINDOWS = [];
    let _reapWin = null;
    function _overlayWanted() { return false; }
    function _inSingleSetup() { return false; }
    function _boundsKeyForEntry() { return '${KEY}'; }
    function reapOne(win) {
      _OVERLAY_WINDOWS.length = 0;
      _OVERLAY_WINDOWS.push({ key: 'command', flag: 'showCommand', get: () => (_reapWin ? _reapWin : null), drop: () => { _reapWin = null; } });
      _reapWin = win;
      _reapDisabledOverlays();
    }
  `, ['handlers', 'mkWin', 'getCfg', 'SAVES', 'setSig', 'setSetup', '_singleSetupWins', 'appListeners', 'reapOne']);
}
const ev = (win) => ({ sender: win.webContents });
const floorOf = (E) => E.getCfg()[FLOOR_KEY];
const refits = (w) => w.sent.filter(c => c === 'wp-refit').length;
// The page reports a new content height (a tick that changed its HTML).
function content(E, w, h) { w.content = h; return E.handlers['overlay-auto-height'](ev(w), h); }
// A fitting overlay at rest: the window exists, the page has reported its content height and the
// window has followed it. (Only a window whose page has fitted can have a floor.)
function fitted(E, b, c, opts) { const w = E.mkWin(b, opts); content(E, w, c); return w; }
// A manual drag to height `h`, then the quiet after it that ends the gesture, then the page's answer.
function drag(w, h) { w.userResize({ height: h }); vi.advanceTimersByTime(500); w.pageTurn(); }
// Pick "↕ Fit height to content": the click's IPC, then the page's reply.
function pickFitHeight(E, w) { const r = E.handlers['overlay-fit-height'](ev(w)); w.pageTurn(); return r; }

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T20:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

const START = { x: 400, y: 300, width: 330, height: 300 };

describe('with no floor the fit is exactly what it was', () => {
  // The fit as it stood before the floor, written out once as the oracle.
  function oldFit({ start, content: c, z, setup, maxH = 1060 }) {
    let wanted = Math.max(50, Math.round(c));
    if (z !== 1) wanted = Math.round(wanted * z);
    wanted += setup ? 104 : 0;
    const target = Math.min(maxH, wanted);
    const delta = target - start;
    if (Math.abs(delta) < 4) return start;
    if (delta < 0 && delta > -12) return start;
    return target;
  }

  it('gives the same height as before for every content, start, zoom and setup state', () => {
    let n = 0;
    for (const start of [100, 150, 220, 300, 500])
      for (const c of [20, 60, 90, 146, 150, 214, 220, 223, 300, 1300])
        for (const z of [1, 1.5, 0.75])
          for (const setup of [false, true]) {
            const E = env();
            E.setSetup(setup);
            const w = E.mkWin({ ...START, height: start }, { zoom: z });
            E.handlers['overlay-auto-height'](ev(w), c);
            expect(w.b.height, `start ${start} content ${c} zoom ${z} setup ${setup}`).toBe(oldFit({ start, content: c, z, setup }));
            n++;
          }
    expect(n).toBe(5 * 10 * 3 * 2);
  });

  it('writes no floor: fits, the menu loan, a preset and a scale glide only ever move the window', () => {
    const E = env();
    const w = fitted(E, START, 220);
    E.handlers['overlay-ensure-min-height'](ev(w), 420);
    E.handlers['overlay-resize-preset'](ev(w), 'xs');
    E.handlers['overlay-menu-closed'](ev(w), false);
    w.setBounds({ height: 180 });   // anything else that calls setBounds: scale glide, move-to-screen…
    vi.advanceTimersByTime(500);
    expect(floorOf(E)).toBeUndefined();
    expect(w.sent).toEqual([]);
  });
});

describe('a dragged height becomes a floor', () => {
  it('drag 300 -> 150 with content 220: content wins above the floor, then the window stops at 150, not 90', () => {
    const E = env();
    const w = fitted(E, START, 220);            // fitted to its content: 220 tall
    drag(w, 300);                               // pulled taller: floor 300
    expect(floorOf(E).h).toBe(300);
    expect(w.b.height).toBe(300);
    drag(w, 150);                               // …then dragged 300 -> 150, below the content
    expect(floorOf(E).h).toBe(150);
    expect(refits(w)).toBe(2);                  // the page was asked to fit after each drag, once
    expect(w.b.height).toBe(220);               // 150 is below its content, so content wins
    content(E, w, 90);                          // content shrinks
    expect(w.b.height).toBe(150);               // back to the floor, never below
    content(E, w, 400);
    expect(w.b.height).toBe(400);               // above the floor, content grows it
    content(E, w, 120);
    expect(w.b.height).toBe(150);
  });

  it('a drag taller than the content holds: without a floor it shrank back', () => {
    const E = env();
    const w = fitted(E, START, 220);
    drag(w, 300);
    expect(floorOf(E).h).toBe(300);
    expect(w.b.height).toBe(300);
    content(E, w, 100);
    expect(w.b.height).toBe(300);
    content(E, w, 350);
    expect(w.b.height).toBe(350);
    content(E, w, 100);
    expect(w.b.height).toBe(300);
  });

  it('the floor is recorded when the drag has been quiet for 400 ms, not on every step', () => {
    const E = env();
    const w = fitted(E, START, 100);
    for (const h of [280, 250, 200, 170]) { w.userResize({ height: h }); vi.advanceTimersByTime(60); }
    expect(floorOf(E)).toBeUndefined();         // still dragging
    expect(refits(w)).toBe(0);
    vi.advanceTimersByTime(400);
    expect(floorOf(E).h).toBe(170);             // the last step is the height
    expect(refits(w)).toBe(1);
  });

  it('a width-only drag is not a height choice', () => {
    const E = env();
    const w = fitted(E, START, 100);
    w.userResize({ width: 450 });
    vi.advanceTimersByTime(500);
    expect(floorOf(E)).toBeUndefined();
    expect(refits(w)).toBe(0);
    w.userResize({ width: 460, height: 101 });   // a pixel of height wobble on a sideways drag
    vi.advanceTimersByTime(500);
    expect(floorOf(E)).toBeUndefined();
  });

  it('a corner drag that moves the height too is one', () => {
    const E = env();
    const w = fitted(E, START, 100);
    w.userResize({ width: 450, height: 200 });
    vi.advanceTimersByTime(500);
    expect(floorOf(E).h).toBe(200);
  });

  it('never records less than the 50 px a fit would ask for anyway', () => {
    const E = env();
    const w = fitted(E, START, 100);
    drag(w, 30);
    expect(floorOf(E).h).toBe(50);
  });

  it('is kept beside the saved bounds and survives the window being rebuilt', () => {
    const E = env();
    const w = fitted(E, START, 100);
    drag(w, 150);
    expect(E.getCfg()[KEY]).toBeTruthy();                       // the bounds the floor sits beside
    expect(floorOf(E)).toEqual({ h: 150, sig: 'sig' });
    w.destroy();
    const w2 = E.mkWin({ ...START, height: 150 });              // next launch, or ✕ then re-enable
    content(E, w2, 90);
    expect(w2.b.height).toBe(150);
  });

  it('applies only on the screen setup it was set on, like the saved bounds', () => {
    const E = env();
    const w = fitted(E, START, 100);
    drag(w, 150);
    content(E, w, 90);
    expect(w.b.height).toBe(150);
    E.setSig('other-monitors');
    content(E, w, 91);
    expect(w.b.height).toBe(91);                // another screen setup: the floor is not in force
    E.setSig('sig');
    content(E, w, 92);
    expect(w.b.height).toBe(150);               // back on the first one: it is
  });
});

describe('scale and setup mode do not bake themselves into the floor', () => {
  it('zoom 1.5: the floor is stored unscaled and applied scaled', () => {
    const E = env();
    const w = fitted(E, { ...START, height: 400 }, 100, { zoom: 1.5 });   // 150 painted
    drag(w, 300);                                // painted px
    expect(floorOf(E).h).toBe(200);              // CSS px
    content(E, w, 100);
    expect(w.b.height).toBe(300);                // 200 x 1.5
    content(E, w, 260);
    expect(w.b.height).toBe(390);                // content above the floor, scaled as ever
  });

  it('a scale change re-derives the window from the same stored floor', () => {
    const E = env();
    const w = fitted(E, { ...START, height: 400 }, 100, { zoom: 1.5 });
    drag(w, 300);
    w.zoom = 2;                                  // the size slider moves; main glides the bounds
    w.setBounds({ height: 400 });
    vi.advanceTimersByTime(500);
    expect(floorOf(E).h).toBe(200);              // untouched by the glide
    content(E, w, 100);
    expect(w.b.height).toBe(400);
    w.zoom = 1;
    content(E, w, 101);
    expect(w.b.height).toBe(200);
  });

  it('a fractional floor still lands on the height that was dragged', () => {
    const E = env();
    const w = fitted(E, { ...START, height: 400 }, 40, { zoom: 1.5 });
    drag(w, 226);
    expect(floorOf(E).h).toBe(150.67);
    content(E, w, 40);
    expect(w.b.height).toBe(226);
  });

  it('setup mode: the 104 px of setup chrome is not part of the floor', () => {
    const E = env();
    E.setSetup(true);
    const w = fitted(E, { ...START, height: 400 }, 100);       // 100 + 104 of chrome
    expect(w.b.height).toBe(204);
    drag(w, 354);                                // dragged while setting up: 250 + 104 of chrome
    expect(floorOf(E).h).toBe(250);
    content(E, w, 100);
    expect(w.b.height).toBe(354);                // the chrome is added again on top
    E.setSetup(false);                           // leave setup
    content(E, w, 101);
    expect(w.b.height).toBe(250);
    expect(floorOf(E).h).toBe(250);
  });

  it('"Setup THIS overlay" counts as setting up too', () => {
    const E = env();
    const w = E.mkWin({ ...START, height: 400 });
    E._singleSetupWins.add(w.webContents.id);
    content(E, w, 100);
    drag(w, 354);
    expect(floorOf(E).h).toBe(250);
  });

  it('zoom and setup together: (painted - chrome) / zoom', () => {
    const E = env();
    E.setSetup(true);
    const w = fitted(E, { ...START, height: 500 }, 60, { zoom: 2 });
    drag(w, 404);
    expect(floorOf(E).h).toBe(150);
    content(E, w, 60);
    expect(w.b.height).toBe(404);                // 150 x 2 + 104
  });
});

describe('only a hand-drag on a fitting overlay records a floor', () => {
  it('the menu loan and its give-back leave a floor alone', () => {
    const E = env();
    const w = fitted(E, START, 100);
    drag(w, 150);
    content(E, w, 90);
    const before = JSON.stringify(floorOf(E));
    const asks = refits(w);
    E.handlers['overlay-ensure-min-height'](ev(w), 420);
    expect(w.b.height).toBe(420);
    vi.advanceTimersByTime(500);
    E.handlers['overlay-resize-preset'](ev(w), 'xs');
    E.handlers['overlay-menu-closed'](ev(w), false);
    vi.advanceTimersByTime(500);
    expect(w.b.height).toBe(150);
    expect(JSON.stringify(floorOf(E))).toBe(before);
    expect(refits(w)).toBe(asks);
    expect(E.getCfg()[KEY].height).toBe(150);    // and the bounds saved are the floor-sized ones
  });

  it('size presets change the width only, so they leave the floor where it is', () => {
    const E = env();
    const w = fitted(E, START, 100);
    drag(w, 150);
    content(E, w, 90);
    E.handlers['overlay-resize-preset'](ev(w), 'xl');
    expect(w.b).toEqual({ x: 400, y: 300, width: 500, height: 150 });
    expect(floorOf(E).h).toBe(150);
  });

  it('a drag made while the menu has the window on loan is the height chosen', () => {
    const E = env();
    const w = fitted(E, START, 100);
    E.handlers['overlay-ensure-min-height'](ev(w), 420);
    drag(w, 260);                                // the user pulls the bottom edge up from 420
    expect(floorOf(E).h).toBe(260);
  });

  it('…but a sideways drag during the loan is not, even though the window is 420 tall', () => {
    const E = env();
    const w = fitted(E, START, 100);
    E.handlers['overlay-ensure-min-height'](ev(w), 420);
    w.userResize({ width: 500 });
    vi.advanceTimersByTime(500);
    expect(floorOf(E)).toBeUndefined();
  });

  it('a page that sizes its own window (the Me HUD ring) records none, and a card fit afterwards is not inflated', () => {
    const E = env();
    const w = fitted(E, { x: 400, y: 300, width: 330, height: 220 }, 200);   // card style fits…
    E.handlers['overlay-set-bounds'](ev(w), { width: 700, height: 700, center: true });   // …then HUD style sizes the window
    drag(w, 800);                                                    // the user resizes the ring
    expect(floorOf(E)).toBeUndefined();
    E.handlers['overlay-set-bounds'](ev(w), { width: 330, height: 320, center: true });  // back to the card
    content(E, w, 200);
    expect(w.b.height).toBe(200);                                    // not 800
    drag(w, 260);                                                    // fitting again: a drag counts
    expect(floorOf(E).h).toBe(260);
  });

  it('a window whose page has never asked for a fit records none', () => {
    const E = env();
    const w = E.mkWin(START);
    drag(w, 150);
    expect(floorOf(E)).toBeUndefined();
  });

  it('a window that is not an overlay (dashboard, Settings) is ignored', () => {
    const E = env();
    const w = fitted(E, START, 100, { notAnOverlay: true });
    drag(w, 150);
    expect(Object.keys(E.getCfg()).filter(k => /Floor$/.test(k))).toEqual([]);
    expect(w.sent).toEqual([]);
  });

  it('the one listener on browser-window-created hooks will-resize once per window', () => {
    const E = env();
    const w = E.mkWin(START);
    expect(w.listeners['will-resize']).toHaveLength(1);
    expect(w.listeners['closed']).toHaveLength(1);
  });
});

describe('✕ inside the 400 ms keeps the floor', () => {
  it('the reaper commits a drag it caught mid-debounce, without asking a window that is going away', () => {
    const E = env();
    const w = fitted(E, START, 100);
    w.userResize({ height: 180 });
    vi.advanceTimersByTime(100);
    E.reapOne(w);
    expect(w.dead).toBe(true);
    expect(floorOf(E).h).toBe(180);
    expect(refits(w)).toBe(0);
    const saves = E.SAVES.n;
    vi.advanceTimersByTime(1000);                // the timer that was pending finds nothing to do
    expect(E.SAVES.n).toBe(saves);
  });

  it('with no drag pending the reaper writes no floor', () => {
    const E = env();
    const w = fitted(E, START, 100);
    E.reapOne(w);
    expect(floorOf(E)).toBeUndefined();
  });
});

describe('↕ Fit height to content', () => {
  it('deletes the floor and the overlay fits to its content again', () => {
    const E = env();
    const w = fitted(E, START, 100);
    drag(w, 300);
    expect(floorOf(E).h).toBe(300);
    expect(w.b.height).toBe(300);
    const asks = refits(w);
    expect(pickFitHeight(E, w)).toBe(true);
    expect(floorOf(E)).toBeUndefined();
    expect(refits(w)).toBe(asks + 1);            // the page is asked for a fresh fit…
    expect(w.b.height).toBe(100);                // …and answers it
    content(E, w, 60);
    expect(w.b.height).toBe(60);                 // no floor holds it up any more
  });

  it('fits exactly even when the window is under 12 px off, once', () => {
    const E = env();
    const w = fitted(E, START, 296);
    drag(w, 303);                                // floor 303, content 296: 7 px of room
    expect(floorOf(E).h).toBe(303);
    E.handlers['overlay-auto-height'](ev(w), 296);
    expect(w.b.height).toBe(303);                // an ordinary fit leaves a 7 px shrink alone…
    pickFitHeight(E, w);
    expect(w.b.height).toBe(296);                // …↕ Fit height does not
    content(E, w, 288);
    expect(w.b.height).toBe(296);                // and the 12 px hysteresis is back for the next fit
  });

  it('works through the menu: the loan is handed back first, then the page fits', () => {
    const E = env();
    const w = fitted(E, START, 220);
    drag(w, 280);
    expect(w.b.height).toBe(280);
    E.handlers['overlay-ensure-min-height'](ev(w), 420);        // right-click ✥
    E.handlers['overlay-fit-height'](ev(w));                    // pick the item (its click handler)…
    E.handlers['overlay-menu-closed'](ev(w), false);            // …and the menu's cleanup, queued right behind it
    expect(w.b.height).toBe(280);                               // the loan is back; the page has not answered yet
    w.pageTurn();
    expect(floorOf(E)).toBeUndefined();
    expect(w.b.height).toBe(220);
  });

  it('the next drag sets a new floor', () => {
    const E = env();
    const w = fitted(E, START, 100);
    drag(w, 300);
    pickFitHeight(E, w);
    drag(w, 180);
    expect(floorOf(E).h).toBe(180);
    content(E, w, 90);
    expect(w.b.height).toBe(180);
  });

  it('a drag still settling when it is picked does not bring the floor back', () => {
    const E = env();
    const w = fitted(E, START, 100);
    w.userResize({ height: 250 });
    pickFitHeight(E, w);
    vi.advanceTimersByTime(1000);
    expect(floorOf(E)).toBeUndefined();
  });

  it('is a no-op on a window that is not an overlay', () => {
    const E = env();
    const w = E.mkWin(START, { notAnOverlay: true });
    expect(E.handlers['overlay-fit-height'](ev(w))).toBe(false);
    expect(w.sent).toEqual([]);
  });
});

// preload.js is where the page answers 'wp-refit'. Its real functions, against a fake ipcRenderer.
describe('the page fits once when main asks (preload.js)', () => {
  const pre = stripJs(PRELOAD);
  const vars = sliceBlock(PRELOAD, 'let _wpMenuOpen = false;', 'function _menuFitPaused() {\n  return _wpMenuOpen && (Date.now() - _wpMenuOpenAt) < MENU_FIT_PAUSE_MS;\n}');
  const raw = sliceBlock(PRELOAD, 'function _overlayAutoHeightRaw(h) {', '\n}');
  const auto = sliceBlock(PRELOAD, 'function _autoFitOverlay(wrapEl) {', '\n}');
  const listener = sliceBlock(PRELOAD, "ipcRenderer.on('wp-refit', function () {", '\n});');

  function page({ docked = false } = {}) {
    return evalBlock(`
      const calls = [];
      const on = {};
      const ipcRenderer = { invoke(ch, ...a) { calls.push([ch, ...a]); return Promise.resolve(true); }, on(ch, f) { on[ch] = f; } };
      const WP_IS_DOCKED = ${docked};
      const DOM = { wrap: { scrollHeight: 100 }, other: { scrollHeight: 50 }, body: { scrollHeight: 999 } };
      const document = { getElementById: (id) => (id === 'wrap' ? DOM.wrap : null), body: DOM.body };
      ${vars}
      ${raw}
      ${auto}
      ${listener}
      function setMenu(v) { _wpMenuOpen = v; _wpMenuOpenAt = Date.now(); }
      function refit() { on['wp-refit'](); }
    `, ['calls', 'on', 'DOM', '_overlayAutoHeightRaw', '_autoFitOverlay', 'setMenu', 'refit']);
  }

  it('an idle page that reports a raw height (Command Center, pets, melody) is asked to report it again', () => {
    const P = page();
    P._overlayAutoHeightRaw(220);
    P.calls.length = 0;
    P.refit();
    expect(P.calls).toEqual([['overlay-auto-height', 220]]);
  });

  it('a page that fits an element (Extended Target, threat, buff queue) is measured fresh', () => {
    const P = page();
    P._autoFitOverlay(P.DOM.wrap);
    expect(P.calls).toEqual([['overlay-auto-height', 112]]);
    P.calls.length = 0;
    P.DOM.wrap.scrollHeight = 140;
    P.refit();
    expect(P.calls).toEqual([['overlay-auto-height', 152]]);
  });

  it('replays whichever of the two the page used last', () => {
    const P = page();
    P._autoFitOverlay(P.DOM.wrap);
    P._overlayAutoHeightRaw(333);
    P.calls.length = 0;
    P.refit();
    expect(P.calls).toEqual([['overlay-auto-height', 333]]);
    P._autoFitOverlay(P.DOM.wrap);
    P.calls.length = 0;
    P.refit();
    expect(P.calls).toEqual([['overlay-auto-height', 112]]);
  });

  it('a page that has not fitted anything has nothing to replay', () => {
    const P = page();
    P.refit();
    expect(P.calls).toEqual([]);
  });

  it('a raw height the open menu held back is the one replayed', () => {
    const P = page();
    P._overlayAutoHeightRaw(200);
    P.setMenu(true);
    P._overlayAutoHeightRaw(240);                // held while the menu is open
    expect(P.calls).toEqual([['overlay-auto-height', 200]]);
    P.setMenu(false);
    P.refit();
    expect(P.calls[P.calls.length - 1]).toEqual(['overlay-auto-height', 240]);
  });

  it('a docked pane never asks to resize the dock', () => {
    const P = page({ docked: true });
    P._overlayAutoHeightRaw(220);
    P._autoFitOverlay(P.DOM.wrap);
    P.refit();
    expect(P.calls).toEqual([]);
  });

  it('the right-click menu carries the item, and it asks main to clear the floor', () => {
    expect(pre).toMatch(/mkItem\('↕ Fit height to content', '#[0-9a-f]{6}',\s*\(\) => ipcRenderer\.invoke\('overlay-fit-height'\)\)/);
  });

  it('the item sits before the size presets (the menu scrolls from the bottom on small windows)', () => {
    const item = pre.indexOf("'↕ Fit height to content'");
    const presets = pre.indexOf("['xs','XS");
    expect(item).toBeGreaterThan(-1);
    expect(presets).toBeGreaterThan(item);
  });
});
