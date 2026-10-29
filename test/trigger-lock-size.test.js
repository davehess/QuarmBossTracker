// test/trigger-lock-size.test.js — FB-110: lock the alerts window's size; split callouts and timers in one click.
//
// A raider (Mimic 3.0.5): the alerts / timers window keeps growing as countdowns and callouts appear and cannot be
// kept to a size; they asked to lock it, and/or to have callouts and countdowns in separate boxes of their own.
//
// 🔒 Lock size: cfg.triggerLockSize makes overlay-auto-height leave the trigger window's bounds alone (the grips and
// native edges set the size, the saved bounds keep it), and the page keeps the countdown rows to what fits, folding the
// rest into "+N more" (the stack is click-through, so an inner scroll bar could not be reached). Callouts win.
// 🧩 Split: the Timers canvas on, through the tray item's own internals; a first-time Canvas starts with Fit height off.
//
// The behaviour runs as the real code (main.js's handler and setters, triggers.html's row cap); the wiring is checked
// on comment-stripped source.
//
// Run: npx vitest run test/trigger-lock-size.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const mimic = (f) => readSource(path.join(ROOT, 'apps', 'mimic', f));
const mainRaw = mimic('main.js'), preloadRaw = mimic('preload.js'), trigRaw = mimic('triggers.html'), canvasRaw = mimic('canvas.html');
const dashRaw = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const main = stripJs(mainRaw), preload = stripJs(preloadRaw), trig = stripJs(trigRaw), canvas = stripJs(canvasRaw), dash = stripJs(dashRaw);

// ── main.js: overlay-auto-height, the real handler, over a fake window ──────────────────────────────────────────
function autoHeightHarness({ locked, isTrigger = true }) {
  const cfg = { triggerLockSize: locked };
  const calls = [];
  const win = {
    isDestroyed: () => false,
    getBounds: () => ({ x: 100, y: 500, width: 600, height: 200 }),
    setBounds: (b) => calls.push(b),
    webContents: { getZoomFactor: () => 1 },
  };
  const src = sliceBlock(mainRaw, 'function _fitHeldWidth(win, readW) {', '\n}')
    + '\n' + sliceBlock(mainRaw, "ipcMain.handle('overlay-auto-height', (e, h) => {", '\n});');
  let handler = null;
  // eslint-disable-next-line no-new-func
  new Function('ipcMain', 'BrowserWindow', '_boundsKeyForWindow', 'loadConfig', '_holdForMove', '_heightFloorFor', '_setupChromeFor',
    'screen', '_overlayGrowsUp', '_overlayEntries', 'appendAgentLog', src)(
    { handle: (name, fn) => { if (name === 'overlay-auto-height') handler = fn; } },
    { fromWebContents: () => win },
    () => (isTrigger ? 'triggerBounds' : 'commandBounds'),
    () => cfg, () => false, () => 0, () => 0,
    { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    () => true, () => [], () => {});
  return { fit: (h) => handler({ sender: {} }, h), calls };
}

describe('🔒 locked: the alerts window keeps its size', () => {
  it('overlay-auto-height changes nothing while locked, however much content arrives or leaves', () => {
    const h = autoHeightHarness({ locked: true });
    expect(h.fit(600)).toBe(true);
    expect(h.fit(60)).toBe(true);
    expect(h.calls).toEqual([]);
  });
  it('unlocked, it fits as it always did (grows up from the bottom edge here)', () => {
    const h = autoHeightHarness({ locked: false });
    h.fit(400);
    expect(h.calls).toEqual([{ x: 100, y: 300, width: 600, height: 400 }]);
  });
  it('the lock is the alerts window\'s alone: another overlay still fits while the flag is set', () => {
    const h = autoHeightHarness({ locked: true, isTrigger: false });
    h.fit(400);
    expect(h.calls.length).toBe(1);
  });
});

// ── main.js: the setter ─────────────────────────────────────────────────────────────────────────────────────────
function setterHarness(initial) {
  let cfg = Object.assign({}, initial);
  const sent = [], floors = [];
  const triggerWindow = {
    isDestroyed: () => false,
    webContents: { send: (ch, ...a) => sent.push([ch, ...a]) },
  };
  const src = sliceBlock(mainRaw, 'function _setTriggerLockSize(on) {', '\n}');
  // eslint-disable-next-line no-new-func
  const fn = new Function('loadConfig', 'saveConfig', '_live', 'triggerWindow', '_boundsKeyForWindow', '_setFloor', 'currentStatus',
    'hideAllStatusForRenderer', 'pushStatus', src + '\nreturn _setTriggerLockSize;')(
    () => cfg, (c) => { cfg = c; }, (w) => !!w, triggerWindow, () => 'triggerBounds', (w, k, h) => floors.push([k, h]),
    () => ({ triggerLockSize: !!cfg.triggerLockSize }), () => ({}), () => {});
  return { set: fn, cfg: () => cfg, sent, floors, win: triggerWindow };
}

describe('the flag', () => {
  it('is saved in the config (so it survives a restart) and reaches the window and the dashboard in the status', () => {
    const h = setterHarness({});
    expect(h.set(true)).toBe(true);
    expect(h.cfg().triggerLockSize).toBe(true);
    expect(h.sent.at(-1)).toEqual(['status', { triggerLockSize: true }]);
    expect(main).toContain('triggerLockSize: !!cfg.triggerLockSize,');
  });
  it('unlocking returns to the content fit: the dragged height is forgotten and one exact refit is asked for', () => {
    const h = setterHarness({ triggerLockSize: true });
    expect(h.set(false)).toBe(false);
    expect(h.cfg().triggerLockSize).toBe(false);
    expect(h.floors).toEqual([['triggerBounds', 0]]);
    expect(h.win.__wpFitNowAt).toBeGreaterThan(0);
    expect(h.sent.map(s => s[0])).toEqual(['status', 'wp-refit']);
  });
  it('locking forgets nothing: the size it has now is the size', () => {
    const h = setterHarness({});
    h.set(true);
    expect(h.floors).toEqual([]);
    expect(h.sent.map(s => s[0])).toEqual(['status']);
  });
});

// ── triggers.html: callouts win; rows that do not fit fold into "+N more" ───────────────────────────────────────
describe('the countdown rows a locked window holds', () => {
  const lockedRowCap = new Function(sliceBlock(trigRaw, '  function lockedRowCap(', '\n  }') + '\nreturn lockedRowCap;')();
  it('more room, more rows; never more than 14', () => {
    expect(lockedRowCap(300, 48, 0, 24, 34)).toBeLessThan(lockedRowCap(600, 48, 0, 24, 34));
    expect(lockedRowCap(4000, 48, 0, 24, 34)).toBe(14);
  });
  it('a callout on screen takes room from the rows, never the other way', () => {
    const idle = lockedRowCap(400, 48, 0, 24, 34);
    const flashing = lockedRowCap(400, 140, 0, 24, 34);
    expect(flashing).toBeLessThan(idle);
    // the stack may take half of what the column leaves: 2 × stack + column + gutter still fits the window
    const rowsH = flashing * 24 + Math.max(0, flashing - 1) * 3;
    expect(2 * (rowsH + 8) + 140 + 24).toBeLessThanOrEqual(400);
  });
  it('a window too short for any row holds none (the "+N more" line still says how many)', () => {
    expect(lockedRowCap(90, 60, 0, 24, 34)).toBe(0);
  });
  it('splitVisible folds the rest into "+N more" and keeps loot bids, which are actionable', () => {
    const src = sliceBlock(trigRaw, '  function splitVisible(list){', '\n  }');
    const mk = (cap, locked) => new Function('PART', '_sizeLocked', 'lockedRowCapNow', '_partRowCap', 'MAX_TIMER_ROWS',
      src + '\nreturn splitVisible;')(null, locked, () => cap, () => 0, 6);
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: 'r' + i }));
    const loot = { id: 'bid', kind: 'loot' };
    const a = mk(4, true)(rows.concat(loot));
    expect(a.visible.map(t => t.id)).toEqual(['bid', 'r0', 'r1', 'r2']);   // 3 rows + the "+N more" line = the 4 that fit
    expect(a.hidden).toBe(7);
    const b = mk(0, true)(rows);
    expect(b.visible).toEqual([]);
    expect(b.hidden).toBe(10);
    const c = mk(4, true)(rows.slice(0, 4));
    expect(c.hidden).toBe(0);                                              // they all fit: no fold
    const open = mk(4, false)(rows);                                       // unlocked: today's fixed six
    expect(open.visible.length).toBe(6);
    expect(open.hidden).toBe(4);
  });
  it('the page hears the lock on the status it already listens to, and re-fits when the callouts change', () => {
    expect(trig).toContain('window.mimic.onStatus(applySizeLock);');
    expect(trig).toMatch(/var on = !!\(s && s\.triggerLockSize\);/);
    expect(trig).toMatch(/new ResizeObserver\(function\(\)\{ relockRows\(\); requestAutoHeight\(\); \}\)/);
  });
});

// ── 🧩 the split: the tray's Canvas internals ───────────────────────────────────────────────────────────────────
function splitHarness(cfg0) {
  const cfg = Object.assign({}, cfg0);
  const log = [];
  const src = sliceBlock(mainRaw, 'function _splitCalloutsAndTimers() {', '\n}');
  // eslint-disable-next-line no-new-func
  const fn = new Function('loadConfig', 'saveConfig', '_canvasLayoutNow', '_toggleOverlay', 'buildTrayMenu', src + '\nreturn _splitCalloutsAndTimers;')(
    () => cfg, () => log.push('save'), () => ({ layout: cfg.saved || null }), (n) => { log.push('toggle:' + n); cfg.showCanvas = true; }, () => log.push('tray'));
  return { split: fn, cfg, log };
}

describe('🧩 split callouts and timers into their own boxes', () => {
  it('turns the Canvas on through the same call as the tray item, then rebuilds the tray', () => {
    const h = splitHarness({});
    expect(h.split()).toEqual({ ok: true, already: false });
    expect(h.log).toEqual(['save', 'toggle:canvas', 'tray']);
    const tray = sliceBlock(main, "{ label: 'Canvas (callouts, timers, pieces and any overlay, placed anywhere)'", '},');
    expect(tray).toMatch(/_toggleOverlay\('canvas'\);\s*buildTrayMenu\(\);/);
  });
  it('a first-time Canvas starts with Fit height off; a layout of the person\'s own is left as it was', () => {
    const fresh = splitHarness({});
    fresh.split();
    expect(fresh.cfg.canvasSplitFitOff).toBe(true);
    const kept = splitHarness({ saved: { panels: [] } });
    kept.split();
    expect(kept.cfg.canvasSplitFitOff).toBeUndefined();
  });
  it('already on: nothing is switched (the menus say "Open the Canvas to arrange")', () => {
    const h = splitHarness({ showCanvas: true });
    expect(h.split()).toEqual({ ok: true, already: true });
    expect(h.log).toEqual([]);
    expect(preload).toMatch(/st\.canvasOn\s*\? mkItem\('🧩 Open the Canvas to arrange'[^]*?'canvas-edit', true\)[^]*?: mkItem\('🧩 Split callouts and timers into their own boxes'[^]*?'canvas-split'\)/);
    expect(dash).toContain("st.showCanvas ? '🧩 Open the Canvas to arrange'");
  });
  it('the Canvas reads the one-shot on a fresh layout only, and main clears it when the layout is saved', () => {
    expect(main).toContain('splitFitOff: !!cfg.canvasSplitFitOff,');
    expect(canvas).toMatch(/if \(st\.splitFitOff && _layout && _layout\.panels\) _layout\.panels\.forEach\(function \(p\) \{ if \(fitKind\(p, pdefOf\(p\)\)\) p\.fit = false; \}\);\s*save\(\);/);
    expect(sliceBlock(main, "ipcMain.handle('canvas-save'", '\n});')).toContain('delete cfg.canvasSplitFitOff;');
  });
});

// ── parity: the right-click rows ↔ the dashboard's twins, one setter each ───────────────────────────────────────
describe('parity: right-click menu ↔ dashboard', () => {
  it('the alerts window\'s menu has both rows, beside ⇅ Timers start at, on the trigger window only', () => {
    expect(preload).toMatch(/if \(st\.key === 'trigger'\) \{\s*menu\.appendChild\(mkItem\('⇅ Timers start at: '[^]*?'🔒 Lock size: '[^]*?'wp-trigger-lock-size'[^]*?'canvas-split'/);
    expect(main).toContain("ipcMain.handle('wp-trigger-lock-size', (_e, on) => _setTriggerLockSize(");
    expect(main).toContain("ipcMain.handle('canvas-split', () => _splitCalloutsAndTimers());");
  });
  it('the Overlays tab has both buttons, painted from status, driving the same two setters', () => {
    expect(dash).toContain('data-act="triggerLock" id="wpOvTrigLockBtn"');
    expect(dash).toContain('data-act="canvasSplit" id="wpOvSplitBtn"');
    expect(dash).toContain("typeof st.triggerLockSize === 'boolean'");
    expect(dash).toContain("window.mimic.triggerLockSize(!act.classList.contains('on'))");
    expect(dash).toContain('window.mimic.canvasSplit()');
    expect(preload).toContain("triggerLockSize:   (on)     => ipcRenderer.invoke('wp-trigger-lock-size', !!on)");
    expect(preload).toContain("canvasSplit:       ()       => ipcRenderer.invoke('canvas-split')");
  });
});
