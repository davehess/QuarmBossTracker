// test/mimic-menu-grow-loan.test.js — a shrunk overlay stays shrunk.
//
// A beta tester, 2026-10-07 (Mimic 2.7.10-beta.1): "ive resized these maybe 10 times but each time
// i do it they end up getting bigger than they were before i want them tiny and they are goliath"
// (Command Center and Target Info, several hundred px tall each). FB-16 (a member, 2026-09-27,
// stable 2.7.1): "when resize 'HUD' window, it reverts to a bigger size after clicking the X".
//
// The mechanism: the right-click menu draws INSIDE the overlay's window, so overlay-ensure-min-height
// stretches a short window to 420 px. Nothing then gave the height back unless the page happened to
// ask for a new one — and most pages only do when their HTML changes (the byte-stability guard), so an
// idle Command Center / Target Info / the HUD ring stayed 420 tall. The resize event saved that 420
// as the window's size, so it also came back 420 tall after ✕ and after a restart.
//
// Behaviour tests: the REAL handlers and persistence functions are cut out of main.js and run against
// a fake window (the pattern of mimic-fb-46-48.test.js). Text assertions strip comments first.
// The HUD builder panel's half of FB-16 is test/mimic-hud-builder-resize.test.js.
//
// Run: npx vitest run test/mimic-menu-grow-loan.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const MAIN = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const PRELOAD = readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js'));

const boundsBlock = sliceBlock(MAIN, 'const _boundsSaveTimers = {};', '  _writeBounds(key, win);\n}');
const menuBlock = sliceBlock(MAIN, "ipcMain.handle('overlay-ensure-min-height'",
  'height: s.height });\n    return true;\n  } catch { return false; }\n});');
const presetBlock = sliceBlock(MAIN, "ipcMain.handle('overlay-resize-preset'", '\n});');
const fitBlock = sliceBlock(MAIN, "ipcMain.handle('overlay-auto-height'", '\n});');
const reapBlock = sliceBlock(MAIN, 'function _reapDisabledOverlays() {', '\n}');

const KEY = 'commandBounds';

// One fake main process around the real code. A window's setBounds fires the 'resize' event the
// real windows fire, which is what schedules the save.
// `skew`: what a tall height reads back as, off by this many px (Windows rounds DIP bounds on
// fractional display scaling).
function env({ growsUp = false, skew = 0, work = { x: 0, y: 0, width: 1920, height: 1080 } } = {}) {
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
    function _screenSignature() { return 'sig'; }
    let _displaySettleUntil = 0;
    function _rememberLayout() {}
    const _OVERLAY_MIN_W = 200;
    const _GROW_UP_DEFAULT_KEYS = new Set(['trigger']);
    const setupMode = false;
    const _singleSetupWins = new Set();
    function _overlayEntries() { return []; }
    function appendAgentLog() {}
    function _overlayGrowsUp() { return ${growsUp ? 'true' : 'false'}; }
    function mkWin(b) {
      const w = {
        b: { ...b }, dead: false,
        getBounds() { if (this.dead) throw new Error('Object has been destroyed'); return { ...this.b }; },
        setBounds(n) { this.b = { ...this.b, ...n }; if (n.height >= 400) this.b.height += ${skew}; _persistBounds('${KEY}', this); },
        isDestroyed() { return this.dead; },
        destroy() { this.dead = true; },
        webContents: { id: 1, getZoomFactor() { return 1; } },
      };
      w.webContents.win = w;
      return w;
    }
    ${boundsBlock}
    ${menuBlock}
    ${presetBlock}
    ${fitBlock}
    ${reapBlock}
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
  `, ['handlers', 'mkWin', 'getCfg', 'SAVES', '_persistBounds', '_flushBounds', '_settledBounds', 'reapOne']);
}
const ev = (win) => ({ sender: win.webContents });
const saved = (E) => E.getCfg()[KEY];

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T20:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('the menu\'s extra height is a loan, not the overlay\'s size', () => {
  // Command Center at rest: 330 x 150, nothing on it to report, so its HTML never changes and it
  // never asks for a new height.
  const START = { x: 400, y: 300, width: 330, height: 150 };

  it('opening the menu grows the window and does NOT save the grown height', () => {
    const E = env();
    const w = E.mkWin(START);
    E.handlers['overlay-ensure-min-height'](ev(w), 420);
    expect(w.b.height).toBe(420);
    vi.advanceTimersByTime(500);           // the debounced save fires with the window still tall
    expect(saved(E).height).toBe(150);     // the 420 is never the saved size
    expect(saved(E).width).toBe(330);
  });

  it('closing the menu gives the height back, with no help from the page', () => {
    const E = env();
    const w = E.mkWin(START);
    E.handlers['overlay-ensure-min-height'](ev(w), 420);
    E.handlers['overlay-menu-closed'](ev(w), false);
    expect(w.b).toEqual(START);
    vi.advanceTimersByTime(500);
    expect(saved(E)).toEqual(START);
  });

  it('picking XS keeps the 200 px width and the 150 px height — the overlay comes back tiny', () => {
    const E = env();
    const w = E.mkWin(START);
    E.handlers['overlay-ensure-min-height'](ev(w), 420);
    E.handlers['overlay-resize-preset'](ev(w), 'xs');
    E.handlers['overlay-menu-closed'](ev(w), false);
    expect(w.b).toEqual({ x: 400, y: 300, width: 200, height: 150 });
    vi.advanceTimersByTime(500);
    expect(saved(E)).toEqual({ x: 400, y: 300, width: 200, height: 150 });
  });

  it('ten rounds of "open the menu, pick XS" do not grow it', () => {
    const E = env();
    const w = E.mkWin(START);
    for (let i = 0; i < 10; i++) {
      E.handlers['overlay-ensure-min-height'](ev(w), 420);
      E.handlers['overlay-resize-preset'](ev(w), 'xs');
      E.handlers['overlay-menu-closed'](ev(w), false);
      vi.advanceTimersByTime(500);
    }
    expect(w.b.height).toBe(150);
    expect(saved(E).height).toBe(150);
  });

  it('a window already taller than the menu needs is left alone', () => {
    const E = env();
    const w = E.mkWin({ ...START, height: 500 });
    E.handlers['overlay-ensure-min-height'](ev(w), 420);
    E.handlers['overlay-menu-closed'](ev(w), false);
    expect(w.b.height).toBe(500);
  });

  it('an edge drag made while the menu is open is the size, and closing does not undo it', () => {
    const E = env();
    const w = E.mkWin(START);
    E.handlers['overlay-ensure-min-height'](ev(w), 420);
    w.setBounds({ height: 300 });          // the user drags the bottom edge
    vi.advanceTimersByTime(500);
    expect(saved(E).height).toBe(300);
    E.handlers['overlay-menu-closed'](ev(w), false);
    expect(w.b.height).toBe(300);
  });

  it('a Setup entry keeps the room the setup bar needs, but the loan is still never saved', () => {
    const E = env();
    const w = E.mkWin(START);
    E.handlers['overlay-ensure-min-height'](ev(w), 420);
    E.handlers['overlay-menu-closed'](ev(w), true);   // keepRoom
    expect(w.b.height).toBe(420);
    vi.advanceTimersByTime(500);
    expect(saved(E).height).toBe(150);
    w.setBounds({ height: 260 });                      // then the user sizes it in setup
    vi.advanceTimersByTime(500);
    expect(saved(E).height).toBe(260);
  });

  it('a grow-upward window grows up for the menu and comes back to where it was', () => {
    const E = env({ growsUp: true });
    const w = E.mkWin({ x: 400, y: 800, width: 330, height: 150 });
    E.handlers['overlay-ensure-min-height'](ev(w), 420);
    expect(w.b.y).toBe(530);                           // bottom edge stayed at 950
    expect(w.b.y + w.b.height).toBe(950);
    vi.advanceTimersByTime(500);
    expect(saved(E)).toEqual({ x: 400, y: 800, width: 330, height: 150 });
    E.handlers['overlay-menu-closed'](ev(w), false);
    expect(w.b).toEqual({ x: 400, y: 800, width: 330, height: 150 });
  });

  it('…and the page\'s own re-fit after that still anchors the bottom edge', () => {
    const E = env({ growsUp: true });
    const w = E.mkWin({ x: 400, y: 800, width: 330, height: 150 });
    E.handlers['overlay-ensure-min-height'](ev(w), 420);
    E.handlers['overlay-menu-closed'](ev(w), false);
    E.handlers['overlay-auto-height'](ev(w), 189);     // the replay a fitting page sends on close
    expect(w.b.height).toBe(189);
    expect(w.b.y + w.b.height).toBe(950);
  });

  it('a move to another screen picked from the menu is kept when the menu closes', () => {
    const E = env();
    const w = E.mkWin(START);
    E.handlers['overlay-ensure-min-height'](ev(w), 420);
    w.setBounds({ x: 2400, y: 100 });                  // wp-move-to-display
    E.handlers['overlay-menu-closed'](ev(w), false);
    expect(w.b).toEqual({ x: 2400, y: 100, width: 330, height: 150 });
  });

  it('a stale stash is not handed back: the next menu borrows from the size the window has now', () => {
    const E = env();
    const w = E.mkWin(START);
    E.handlers['overlay-ensure-min-height'](ev(w), 420);
    E.handlers['overlay-menu-closed'](ev(w), true);    // Setup: still tall
    w.setBounds({ height: 300 });                      // the user sizes it to 300
    E.handlers['overlay-ensure-min-height'](ev(w), 420);
    E.handlers['overlay-menu-closed'](ev(w), false);
    expect(w.b.height).toBe(300);                      // not the 150 from the first menu
  });

  it('a second right-click while the menu is up borrows once, and hands back the real height', () => {
    const E = env();
    const w = E.mkWin(START);
    E.handlers['overlay-ensure-min-height'](ev(w), 420);
    E.handlers['overlay-ensure-min-height'](ev(w), 420);
    E.handlers['overlay-menu-closed'](ev(w), false);
    expect(w.b.height).toBe(150);
  });

  it('a height the display reads back a pixel off is still recognised as the loan', () => {
    for (const skew of [-1, 1, 2]) {
      const E = env({ skew });
      const w = E.mkWin(START);
      E.handlers['overlay-ensure-min-height'](ev(w), 420);
      expect(w.b.height).toBe(420 + skew);
      vi.advanceTimersByTime(500);
      expect(saved(E).height, `skew ${skew}`).toBe(150);
      E.handlers['overlay-menu-closed'](ev(w), false);
      expect(w.b.height, `skew ${skew}`).toBe(150);
    }
  });

  it('…but a height well away from the loan is the user\'s own', () => {
    const E = env();
    const w = E.mkWin(START);
    E.handlers['overlay-ensure-min-height'](ev(w), 420);
    w.setBounds({ height: 417 });                      // 3 px off is a drag, not rounding
    E.handlers['overlay-menu-closed'](ev(w), false);
    expect(w.b.height).toBe(417);
    vi.advanceTimersByTime(500);
    expect(saved(E).height).toBe(417);
  });

  it('closing a menu that never grew anything changes nothing', () => {
    const E = env();
    const w = E.mkWin({ ...START, height: 500 });
    E.handlers['overlay-menu-closed'](ev(w), false);
    expect(w.b).toEqual({ ...START, height: 500 });
  });
});

describe('✕ saves the last resize instead of dropping it', () => {
  const START = { x: 400, y: 300, width: 330, height: 150 };

  it('without a flush, ✕ inside the 400 ms debounce loses the resize (what happened)', () => {
    const E = env();
    const w = E.mkWin(START);
    w.setBounds({ width: 200 });           // resized…
    vi.advanceTimersByTime(100);
    w.destroy();                           // …✕ frees the window…
    vi.advanceTimersByTime(500);           // …and the save reads a window that is gone
    expect(saved(E)).toBeUndefined();
  });

  it('_flushBounds writes it now and leaves no second save behind', () => {
    const E = env();
    const w = E.mkWin(START);
    w.setBounds({ width: 200 });
    E._flushBounds('commandBounds', w);
    expect(saved(E).width).toBe(200);
    const n = E.SAVES.n;
    vi.advanceTimersByTime(500);
    expect(E.SAVES.n).toBe(n);
  });

  it('_flushBounds with nothing pending writes nothing', () => {
    const E = env();
    const w = E.mkWin(START);
    E._flushBounds('commandBounds', w);
    expect(E.SAVES.n).toBe(0);
  });

  it('the reaper flushes before it destroys the window', () => {
    const E = env();
    const w = E.mkWin(START);
    w.setBounds({ width: 200, height: 120 });
    vi.advanceTimersByTime(100);
    E.reapOne(w);
    expect(w.dead).toBe(true);
    expect(saved(E)).toEqual({ x: 400, y: 300, width: 200, height: 120 });
  });
});

describe('the menu hands the height back through the page that opened it', () => {
  const pre = stripJs(PRELOAD);
  const cleanup = sliceBlock(pre, 'const cleanup = function() {', '\n  };');

  it('closing calls overlay-menu-closed before it replays a suppressed fit', () => {
    const closed = cleanup.indexOf("invoke('overlay-menu-closed'");
    const fit = cleanup.indexOf('_autoFitOverlay(_wpMenuSuppressedFit');
    const raw = cleanup.indexOf("invoke('overlay-auto-height'");
    expect(closed).toBeGreaterThan(-1);
    expect(fit).toBeGreaterThan(closed);
    expect(raw).toBeGreaterThan(closed);
  });

  it('only the two Setup entries keep the room', () => {
    const keeps = [...pre.matchAll(/_wpMenuKeepRoom = true; return ipcRenderer\.invoke\('([\w-]+)'/g)].map(m => m[1]);
    expect(keeps.sort()).toEqual(['set-setup-mode', 'set-setup-mode-this']);
    expect(cleanup).toMatch(/const keepRoom = _wpMenuKeepRoom; _wpMenuKeepRoom = false;/);
    expect(cleanup).toMatch(/invoke\('overlay-menu-closed', keepRoom\)/);
  });

  it('a menu opened over another one borrows the height again after the give-back', () => {
    const open = sliceBlock(pre, 'function _openOverlayMenu(state) {', '  _wpMenuOpen = true;');
    expect(open.indexOf('_wpMenuCleanupFn()')).toBeGreaterThan(-1);
    expect(open.indexOf("invoke('overlay-ensure-min-height', 420)")).toBeGreaterThan(open.indexOf('_wpMenuCleanupFn()'));
  });
});
