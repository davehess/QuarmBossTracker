// test/mimic-tooltip-hover.test.js — two overlay requests from the guild lead, 2026-10-13.
//
//  1. "Sometimes tooltips get stuck on the screen, we need that to fade after a few seconds (3 seconds to start)".
//     The tooltips are Chromium's native ones (title="…"); a click-through overlay never sees the mouse leave, so
//     they stick. preload.js empties the title TOOLTIP_HIDE_MS after the cursor settles on a titled element and
//     asks main ('tooltip-refresh') for one real mouse move at the same spot so Blink closes the tooltip.
//  2. "could we add mouse-over for showing opacity on an overlay?" — modelled on EverQuest's Window Transparency /
//     Fade Delay / Fade Duration / Fade-to Transparency: bright while the cursor is over the overlay, a hold, then a
//     fade down to the overlay's own opacity. main.js owns the state machine; preload.js pings and applies.
//
// All of it is the REAL shipped code cut out of main.js / preload.js and run against fakes (the pattern of
// mimic-height-floor.test.js). Text assertions strip comments first (test/_source-slice.js).
//
// Run: npx vitest run test/mimic-tooltip-hover.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const MAIN = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const PRELOAD = readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js'));
const SETTINGS = readSource(path.join(ROOT, 'apps', 'mimic', 'settings.html'));

// ── main.js: the mouse-over opacity state machine ───────────────────────────────────────────────────────────────
const hoverBlock = sliceBlock(MAIN, 'const _HOVER_FADE_STEP_MS',
  'function _hoverSettingsChanged() {\n  for (const [key, win] of _overlayEntries()) { _hoverStop(win); applyOverlayOpacity(win, key); }\n}');
const pingBlock = sliceBlock(MAIN, "ipcMain.on('overlay-hover-ping'", '\n});');
const cursorBlock = sliceBlock(MAIN, 'function _cursorInsideWindow(win) {', "ipcMain.handle('overlay-cursor-inside', (e) => _cursorInsideWindow(BrowserWindow.fromWebContents(e.sender)));");
const tipMainBlock = sliceBlock(MAIN, 'function _tooltipPoint(p, zoom) {', '\n});\n').replace(/\n$/, '');

function hoverWorld({ cfg = {}, setup = false, single = false } = {}) {
  const world = { cfg, setup, single, cursorInside: true, entries: [], applied: [] };
  const fn = new Function('world', 'ipcMain', 'BrowserWindow', 'screen',
    `const loadConfig = () => world.cfg;
     const _opacityMaps = (c) => ({ content: (k) => { const v = (c.overlayOpacity || {})[k]; return typeof v === 'number' ? v : 1; } });
     const _inSingleSetup = () => world.single;
     const _cursorInsideWindow = () => world.cursorInside;
     const _overlayEntries = () => world.entries;
     const applyOverlayOpacity = (w, k) => world.applied.push(k);
     let setupMode = world.setup;
     ${hoverBlock}
     ${pingBlock}
     return { _hoverSettings, _hoverFadeAlpha, _hoverEnter, _hoverLeave, _hoverReapply, _hoverStop, _hoverSettingsChanged, _wpHover };`);
  const handlers = {};
  const ipcMain = { on: (ch, fn2) => { handlers[ch] = fn2; } };
  const BrowserWindow = { fromWebContents: (wc) => wc.__win };
  const api = fn(world, ipcMain, BrowserWindow, null);
  return { world, api, handlers };
}
function fakeWin() {
  const sent = [];
  const win = {
    sent, destroyed: false, visible: true,
    isDestroyed() { return this.destroyed; },
    isVisible() { return this.visible; },
    webContents: { send: (ch, v) => sent.push([ch, v]) },
  };
  win.webContents.__win = win;
  return win;
}
const alphas = (win) => win.sent.filter(([c]) => c === 'wp-hover-alpha').map(([, v]) => v);

describe('mouse-over opacity — settings and fade math', () => {
  const { api } = hoverWorld();
  it('defaults to on at 100%, 5 s delay, 2 s fade; 0 / null turn it off; junk is clamped', () => {
    expect(api._hoverSettings({})).toMatchObject({ on: true, alpha: 1, delayMs: 5000, durMs: 2000 });
    expect(api._hoverSettings({ hoverOpacity: 0 }).on).toBe(false);
    expect(api._hoverSettings({ hoverOpacity: null }).on).toBe(false);
    expect(api._hoverSettings({ hoverOpacity: 0.1 }).on).toBe(false);
    expect(api._hoverSettings({ hoverOpacity: 0.8 })).toMatchObject({ on: true, alpha: 0.8 });
    expect(api._hoverSettings({ hoverFadeDelay: 999, hoverFadeDur: -3 })).toMatchObject({ delayMs: 60000, durMs: 0 });
    expect(api._hoverSettings({ hoverFadeDelay: 1.5, hoverFadeDur: 0.5 })).toMatchObject({ delayMs: 1500, durMs: 500 });
  });
  it('fades linearly from the mouse-over opacity to the overlay own opacity and lands exactly on it', () => {
    expect(api._hoverFadeAlpha(1, 0.4, 0, 2000)).toBe(1);
    expect(api._hoverFadeAlpha(1, 0.4, 1000, 2000)).toBeCloseTo(0.7, 10);
    expect(api._hoverFadeAlpha(1, 0.4, 2000, 2000)).toBe(0.4);
    expect(api._hoverFadeAlpha(1, 0.4, 9999, 2000)).toBe(0.4);
    expect(api._hoverFadeAlpha(1, 0.4, 10, 0)).toBe(0.4);   // a 0 s fade is a cut
  });
});

describe('mouse-over opacity — the state machine (real code, fake timers)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('brightens on enter, holds for the fade delay after leaving, fades, then sits at the normal opacity', () => {
    const { world, api } = hoverWorld({ cfg: { overlayOpacity: { who: 0.4 } } });
    const win = fakeWin();
    api._hoverEnter(win, 'who');
    expect(alphas(win)).toEqual([1]);
    world.cursorInside = false;
    vi.advanceTimersByTime(100);                       // the poll notices the cursor left
    win.sent.length = 0;
    vi.advanceTimersByTime(4900);                      // …and nothing moves during the 5 s hold
    expect(alphas(win)).toEqual([]);
    vi.advanceTimersByTime(1000);                      // 1 s into the 2 s fade: about halfway
    const mid = alphas(win);
    expect(mid.length).toBeGreaterThan(10);            // smooth steps, not one jump
    expect(mid[mid.length - 1]).toBeGreaterThan(0.4);
    expect(mid[mid.length - 1]).toBeLessThan(1);
    for (let i = 1; i < mid.length; i++) expect(mid[i]).toBeLessThanOrEqual(mid[i - 1]);
    vi.advanceTimersByTime(1500);
    expect(alphas(win).pop()).toBe(0.4);
    expect(api._wpHover.get(win)).toBeUndefined();     // timers cleared, nothing left running
    expect(vi.getTimerCount()).toBe(0);
  });

  it('coming back during the hold jumps to full and cancels the fade', () => {
    const { world, api } = hoverWorld({ cfg: { overlayOpacity: { who: 0.4 } } });
    const win = fakeWin();
    api._hoverEnter(win, 'who');
    world.cursorInside = false; vi.advanceTimersByTime(3000);
    win.sent.length = 0;
    world.cursorInside = true;
    api._hoverEnter(win, 'who');
    expect(alphas(win)).toEqual([1]);
    vi.advanceTimersByTime(20000);
    expect(alphas(win)).toEqual([1]);                  // the old fade never ran
  });

  it('coming back during the fade jumps to full and stops the steps', () => {
    const { world, api } = hoverWorld({ cfg: { overlayOpacity: { who: 0.4 } } });
    const win = fakeWin();
    api._hoverEnter(win, 'who');
    world.cursorInside = false; vi.advanceTimersByTime(6000);   // 0.9 s into the fade
    expect(alphas(win).pop()).toBeLessThan(1);
    world.cursorInside = true;
    api._hoverEnter(win, 'who');
    expect(alphas(win).pop()).toBe(1);
    const n = win.sent.length;
    vi.advanceTimersByTime(20000);
    expect(win.sent.length).toBe(n);
  });

  it('never dims: a mouse-over opacity at or below the overlay own opacity does nothing', () => {
    const w1 = fakeWin(), w2 = fakeWin();
    hoverWorld({ cfg: { overlayOpacity: { who: 1 } } }).api._hoverEnter(w1, 'who');            // 100% over 100%
    hoverWorld({ cfg: { hoverOpacity: 0.5, overlayOpacity: { who: 0.8 } } }).api._hoverEnter(w2, 'who');
    expect(w1.sent).toEqual([]);
    expect(w2.sent).toEqual([]);
  });

  it('does nothing when switched off, in setup mode, on the Canvas, or for a destroyed window', () => {
    const base = { overlayOpacity: { who: 0.4, canvas: 0.4 } };
    const a = fakeWin(), b = fakeWin(), c = fakeWin(), d = fakeWin(), e = fakeWin();
    hoverWorld({ cfg: { ...base, hoverOpacity: 0 } }).api._hoverEnter(a, 'who');
    hoverWorld({ cfg: base, setup: true }).api._hoverEnter(b, 'who');
    hoverWorld({ cfg: base, single: true }).api._hoverEnter(e, 'who');
    hoverWorld({ cfg: base }).api._hoverEnter(c, 'canvas');
    d.destroyed = true; hoverWorld({ cfg: base }).api._hoverEnter(d, 'who');
    for (const w of [a, b, c, d, e]) expect(w.sent).toEqual([]);
  });

  it('changing the overlay own opacity mid-fade cancels the fade (no heading for the old value)', () => {
    const { world, api } = hoverWorld({ cfg: { overlayOpacity: { who: 0.4 } } });
    const win = fakeWin();
    api._hoverEnter(win, 'who');
    world.cursorInside = false; vi.advanceTimersByTime(6000);
    const n = win.sent.length;
    world.cfg = { overlayOpacity: { who: 0.2 } };
    api._hoverReapply(win, 'who');                     // what applyOverlayOpacity calls after sending the new value
    vi.advanceTimersByTime(20000);
    expect(win.sent.length).toBe(n);
    expect(api._wpHover.get(win)).toBeUndefined();
  });

  it('changing the normal opacity while the cursor is still over the overlay keeps it bright', () => {
    const { world, api } = hoverWorld({ cfg: { overlayOpacity: { who: 0.4 } } });
    const win = fakeWin();
    api._hoverEnter(win, 'who');
    win.sent.length = 0;
    world.cfg = { overlayOpacity: { who: 0.6 } };
    api._hoverReapply(win, 'who');
    expect(alphas(win)).toEqual([1]);
    expect(api._wpHover.get(win).phase).toBe('inside');
  });

  it('a window destroyed mid-fade ends the timers without throwing', () => {
    const { world, api } = hoverWorld({ cfg: { overlayOpacity: { who: 0.4 } } });
    const win = fakeWin();
    api._hoverEnter(win, 'who');
    world.cursorInside = false; vi.advanceTimersByTime(6000);
    win.destroyed = true;
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('hide-all in the middle of a fade lands on the normal opacity at once and stops', () => {
    const { world, api } = hoverWorld({ cfg: { overlayOpacity: { who: 0.4 } } });
    const win = fakeWin();
    api._hoverEnter(win, 'who');
    world.cursorInside = false; vi.advanceTimersByTime(6000);
    win.visible = false;
    vi.advanceTimersByTime(100);
    expect(alphas(win).pop()).toBe(0.4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a repeat ping from a cursor that never left changes nothing', () => {
    const { api } = hoverWorld({ cfg: { overlayOpacity: { who: 0.4 } } });
    const win = fakeWin();
    api._hoverEnter(win, 'who'); api._hoverEnter(win, 'who'); api._hoverEnter(win, 'who');
    expect(alphas(win)).toEqual([1]);
    expect(vi.getTimerCount()).toBe(1);   // one poll, not three
  });

  it('a hidden overlay (hide-all) is never animated or shown: it snaps to its own opacity', () => {
    const { world, api } = hoverWorld({ cfg: { overlayOpacity: { who: 0.4 } } });
    const win = fakeWin();
    api._hoverEnter(win, 'who');
    world.cursorInside = false; vi.advanceTimersByTime(100);
    win.visible = false;                               // hide-all while it holds
    win.sent.length = 0;
    vi.advanceTimersByTime(5200);
    expect(alphas(win)).toEqual([0.4]);                // one snap, no fade steps
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a settings change drops every hover in flight and re-applies each overlay opacity', () => {
    const { world, api } = hoverWorld({ cfg: { overlayOpacity: { who: 0.4 } } });
    const win = fakeWin();
    world.entries = [['who', win]];
    api._hoverEnter(win, 'who');
    api._hoverSettingsChanged();
    expect(api._wpHover.get(win)).toBeUndefined();
    expect(world.applied).toEqual(['who']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the ping handler resolves the sender window to its overlay key and ignores non-overlays and the Canvas', () => {
    const { world, api, handlers } = hoverWorld({ cfg: { overlayOpacity: { who: 0.4, canvas: 0.4 } } });
    const who = fakeWin(), cv = fakeWin(), other = fakeWin();
    world.entries = [['who', who], ['canvas', cv]];
    handlers['overlay-hover-ping']({ sender: other.webContents });
    handlers['overlay-hover-ping']({ sender: cv.webContents });
    expect(other.sent).toEqual([]);
    expect(cv.sent).toEqual([]);
    handlers['overlay-hover-ping']({ sender: who.webContents });
    expect(alphas(who)).toEqual([1]);
    api._hoverStop(who);
  });

  it('applyOverlayOpacity hands every opacity change to the hover logic', () => {
    const body = stripJs(sliceBlock(MAIN, 'function applyOverlayOpacity(win, key) {', '\n}\nfunction applyAllOverlayOpacities'));
    expect(body).toMatch(/_hoverReapply\(win, key\)/);
  });

  it('the cursor test is shared with the stand-in pointer (reuse, not a second copy)', () => {
    const src = stripJs(MAIN);
    expect(src).toMatch(/ipcMain\.handle\('overlay-cursor-inside', \(e\) => _cursorInsideWindow\(/);
    expect(src).toMatch(/_cursorInsideWindow\(win\)\) _hoverLeave\(win\)/);
    // and it still answers false for a hidden or destroyed window
    const { _cursorInsideWindow } = new Function('screen', 'ipcMain', 'BrowserWindow', `${cursorBlock}\nreturn { _cursorInsideWindow };`)(
      { getCursorScreenPoint: () => ({ x: 10, y: 10 }) }, { handle() {} }, {});
    const w = { isDestroyed: () => false, isVisible: () => true, getBounds: () => ({ x: 0, y: 0, width: 20, height: 20 }) };
    expect(_cursorInsideWindow(w)).toBe(true);
    expect(_cursorInsideWindow({ ...w, isVisible: () => false })).toBe(false);
    expect(_cursorInsideWindow({ ...w, getBounds: () => ({ x: 50, y: 0, width: 20, height: 20 }) })).toBe(false);
  });

  it('save-config re-applies when any of the three settings is saved', () => {
    const src = stripJs(MAIN);
    expect(src).toMatch(/\['hoverOpacity', 'hoverFadeDelay', 'hoverFadeDur'\]\.some\(.*\)\) \{\s*try \{ _hoverSettingsChanged\(\); \}/);
  });
});

// ── main.js: tooltip-refresh ─────────────────────────────────────────────────────────────────────────────────────
describe('tooltip-refresh (main)', () => {
  function world() {
    const handlers = {};
    const state = { entries: [] };
    const mk = new Function('ipcMain', 'BrowserWindow', '_overlayEntries', `${tipMainBlock}\nreturn { _tooltipPoint };`);
    const api = mk({ on: (ch, f) => { handlers[ch] = f; } }, { fromWebContents: (wc) => wc.__win }, () => state.entries);
    return { handlers, state, api };
  }
  function fakeWc({ zoom = 1, destroyed = false } = {}) {
    const wc = { sendInputEvent: vi.fn(), isDestroyed: () => destroyed, getZoomFactor: () => zoom };
    wc.__win = { wc };
    return wc;
  }
  it('sends one real mouseMove at the same spot, scaled by the overlay zoom', () => {
    const { handlers, state } = world();
    const wc = fakeWc({ zoom: 1.5 });
    state.entries = [['who', wc.__win]];
    handlers['tooltip-refresh']({ sender: wc }, { x: 100.4, y: 40 });
    expect(wc.sendInputEvent).toHaveBeenCalledTimes(1);
    expect(wc.sendInputEvent).toHaveBeenCalledWith({ type: 'mouseMove', x: 151, y: 60 });
  });
  it('guards a destroyed sender, bad numbers and windows that are not overlays', () => {
    const { handlers, state, api } = world();
    const dead = fakeWc({ destroyed: true }), live = fakeWc(), notOverlay = fakeWc();
    state.entries = [['who', live.__win], ['who2', dead.__win]];
    handlers['tooltip-refresh']({ sender: dead }, { x: 1, y: 1 });
    for (const p of [null, {}, { x: 'a', y: 1 }, { x: NaN, y: 1 }, { x: 1, y: Infinity }]) handlers['tooltip-refresh']({ sender: live }, p);
    handlers['tooltip-refresh']({ sender: notOverlay }, { x: 1, y: 1 });
    expect(dead.sendInputEvent).not.toHaveBeenCalled();
    expect(live.sendInputEvent).not.toHaveBeenCalled();
    expect(notOverlay.sendInputEvent).not.toHaveBeenCalled();
    expect(api._tooltipPoint({ x: 3, y: 4 }, 0)).toEqual({ x: 3, y: 4 });   // a broken zoom falls back to 1
    expect(() => handlers['tooltip-refresh']({ sender: { isDestroyed() { throw new Error('gone'); } } }, { x: 1, y: 1 })).not.toThrow();
  });
});

// ── preload.js: stuck-tooltip fade ───────────────────────────────────────────────────────────────────────────────
const tipBlock = sliceBlock(PRELOAD, 'const TOOLTIP_HIDE_MS = 3000;', '\n\nlet _wpLastAssert = 0;');

function fakeEl(attrs = {}, parent = null) {
  const el = {
    nodeType: 1, parentElement: parent, isConnected: true, attrs: { ...attrs },
    hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n); },
    getAttribute(n) { return this.hasAttribute(n) ? this.attrs[n] : null; },
    setAttribute(n, v) { this.attrs[n] = String(v); },
    removeAttribute(n) { delete this.attrs[n]; },
    contains(o) { for (let x = o; x; x = x.parentElement) if (x === this) return true; return false; },
  };
  return el;
}
function preloadWorld({ overlayDoc = true } = {}) {
  const listeners = {};
  const document = { addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); } };
  const sent = [];
  const ipcRenderer = { send: (ch, p) => sent.push([ch, p]) };
  const win = {};
  win.top = win; win.parent = win;
  const api = new Function('document', 'ipcRenderer', 'window', '_wpOverlayDoc',
    `${tipBlock}\nreturn { TOOLTIP_HIDE_MS };`)(document, ipcRenderer, win, () => overlayDoc);
  const fire = (t, ev) => (listeners[t] || []).forEach((f) => f(ev));
  const move = (x, y) => { const ev = { clientX: x, clientY: y, stopImmediatePropagation: vi.fn() }; fire('mousemove', ev); return ev; };
  return { api, fire, move, sent, listeners };
}

describe('stuck tooltips fade (preload)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('3 s after the cursor settles on a titled element the title is stashed and main refreshes the tooltip at the same spot', () => {
    const w = preloadWorld();
    expect(w.api.TOOLTIP_HIDE_MS).toBe(3000);
    const btn = fakeEl({ title: 'Drag from this icon to move the overlay' });
    w.move(12, 34);
    w.fire('mouseover', { target: btn });
    vi.advanceTimersByTime(2999);
    expect(btn.attrs.title).toBe('Drag from this icon to move the overlay');
    expect(w.sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(btn.hasAttribute('title')).toBe(false);
    expect(btn.attrs['data-wp-title']).toBe('Drag from this icon to move the overlay');
    expect(w.sent).toEqual([['tooltip-refresh', { x: 12, y: 34 }]]);
  });

  it('moving on the element restarts the countdown (it is 3 s after the cursor SETTLES)', () => {
    const w = preloadWorld();
    const btn = fakeEl({ title: 'tip' });
    w.fire('mouseover', { target: btn });
    vi.advanceTimersByTime(2500);
    w.move(5, 5);
    vi.advanceTimersByTime(2500);
    expect(btn.attrs.title).toBe('tip');
    vi.advanceTimersByTime(500);
    expect(btn.hasAttribute('title')).toBe(false);
    expect(w.sent.length).toBe(1);
  });

  it('the title comes back when the cursor moves to another element, and again for a straight exit off the window', () => {
    const w = preloadWorld();
    const a = fakeEl({ title: 'A' }), b = fakeEl({});
    w.fire('mouseover', { target: a });
    vi.advanceTimersByTime(3000);
    w.fire('mouseover', { target: b });
    expect(a.attrs).toEqual({ title: 'A' });
    w.fire('mouseover', { target: a });
    vi.advanceTimersByTime(3000);
    expect(a.hasAttribute('title')).toBe(false);
    w.fire('mouseout', { relatedTarget: null });
    expect(a.attrs).toEqual({ title: 'A' });
  });

  it('leaving before the 3 s cancels the countdown and loses nothing', () => {
    const w = preloadWorld();
    const a = fakeEl({ title: 'A' });
    w.fire('mouseover', { target: a });
    vi.advanceTimersByTime(1000);
    w.fire('mouseout', { relatedTarget: null });
    vi.advanceTimersByTime(10000);
    expect(a.attrs).toEqual({ title: 'A' });
    expect(w.sent).toEqual([]);
  });

  it('a title the page sets while ours is stashed wins; nothing is overwritten and the stash is dropped', () => {
    const w = preloadWorld();
    const a = fakeEl({ title: 'old' });
    w.fire('mouseover', { target: a });
    vi.advanceTimersByTime(3000);
    a.setAttribute('title', 'new from the page');
    w.fire('mouseout', { relatedTarget: null });
    expect(a.attrs).toEqual({ title: 'new from the page' });
  });

  it('children of the stashed element do not give the title back while the cursor is still inside it', () => {
    const w = preloadWorld();
    const a = fakeEl({ title: 'A' }), child = fakeEl({}, a);
    w.fire('mouseover', { target: a });
    vi.advanceTimersByTime(3000);
    w.fire('mouseover', { target: child });
    expect(a.hasAttribute('title')).toBe(false);
    expect(w.sent.length).toBe(1);
  });

  it('the nearest title is the one that counts: a titled parent, an untitled child, and an empty title shadow', () => {
    const w = preloadWorld();
    const parent = fakeEl({ title: 'P' }), child = fakeEl({}, parent), blank = fakeEl({ title: '' }, parent);
    w.fire('mouseover', { target: child });
    vi.advanceTimersByTime(3000);
    expect(parent.hasAttribute('title')).toBe(false);
    const w2 = preloadWorld();
    w2.fire('mouseover', { target: blank });
    vi.advanceTimersByTime(5000);
    expect(w2.sent).toEqual([]);
  });

  it('our own refresh move is swallowed (it must not arm the window, brighten it or draw the pointer) but a real move is not', () => {
    const w = preloadWorld();
    const a = fakeEl({ title: 'A' });
    w.move(7, 9);
    w.fire('mouseover', { target: a });
    vi.advanceTimersByTime(3000);
    const real = w.move(8, 9);
    expect(real.stopImmediatePropagation).not.toHaveBeenCalled();
    // fire again to arm the synth marker at the new spot
    const b = fakeEl({ title: 'B' });
    w.fire('mouseover', { target: b });
    vi.advanceTimersByTime(3000);
    const synth = w.move(8, 9);
    expect(synth.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    const again = w.move(8, 9);                        // only ONE move is eaten
    expect(again.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it('never dispatches a synthetic mouseleave (the document fake has no dispatchEvent to take one)', () => {
    expect(stripJs(tipBlock)).not.toMatch(/dispatchEvent|new MouseEvent|mouseleave/);
  });

  it('does nothing in a window that is not an overlay (Settings keeps its tooltips)', () => {
    const w = preloadWorld({ overlayDoc: false });
    const a = fakeEl({ title: 'A' });
    w.fire('mouseover', { target: a });
    vi.advanceTimersByTime(10000);
    expect(a.attrs).toEqual({ title: 'A' });
    expect(w.sent).toEqual([]);
  });
});

// ── preload.js: mouse-over opacity ───────────────────────────────────────────────────────────────────────────────
const pingPre = sliceBlock(PRELOAD, 'let _wpHoverPingAt = 0;', "setProperty('--wp-content-alpha', String(a)); } catch (e) {}\n});");
function hoverPre({ overlayDoc = true, canvas = false } = {}) {
  const listeners = {}, ipcOn = {}, sent = [], props = {};
  const document = {
    addEventListener: (t, f) => { listeners[t] = f; },
    getElementById: (id) => (canvas && id === 'panels' ? {} : null),
    body: { hasAttribute: (n) => canvas && n === 'data-wp-overlay' },
    documentElement: { style: { setProperty: (k, v) => { props[k] = v; } } },
  };
  new Function('document', 'ipcRenderer', '_wpOverlayDoc', pingPre)(
    document, { send: (ch) => sent.push(ch), on: (ch, f) => { ipcOn[ch] = f; } }, () => overlayDoc);
  return { listeners, ipcOn, sent, props };
}
describe('mouse-over opacity (preload)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it('pings main from forwarded mouse moves, at most every 200 ms', () => {
    const h = hoverPre();
    h.listeners.mousemove(); h.listeners.mousemove(); h.listeners.mousemove();
    expect(h.sent).toEqual(['overlay-hover-ping']);
    vi.advanceTimersByTime(250);
    h.listeners.mousemove();
    expect(h.sent.length).toBe(2);
  });
  it('stays quiet in a non-overlay window and in the Canvas', () => {
    const a = hoverPre({ overlayDoc: false }), b = hoverPre({ canvas: true });
    a.listeners.mousemove(); b.listeners.mousemove();
    expect(a.sent).toEqual([]);
    expect(b.sent).toEqual([]);
  });
  it('wp-hover-alpha moves the same --wp-content-alpha variable as the normal opacity; junk becomes full', () => {
    const h = hoverPre();
    h.ipcOn['wp-hover-alpha']({}, 0.55);
    expect(h.props['--wp-content-alpha']).toBe('0.55');
    h.ipcOn['wp-hover-alpha']({}, 'x');
    expect(h.props['--wp-content-alpha']).toBe('1');
    h.ipcOn['wp-hover-alpha']({}, 0.05);
    expect(h.props['--wp-content-alpha']).toBe('1');
  });
  it('the tooltip listeners are registered before the hover-handshake / ping listeners so the refresh move is swallowed first', () => {
    const src = stripJs(PRELOAD);
    expect(src.indexOf('_wpTipSynth')).toBeLessThan(src.indexOf('_wpHoverArmed = true'));
    expect(src.indexOf('const TOOLTIP_HIDE_MS')).toBeLessThan(src.indexOf('let _wpHoverPingAt'));
    expect(src.indexOf('const TOOLTIP_HIDE_MS')).toBeLessThan(src.indexOf('let _wpGhostAt'));
  });
});

// ── settings.html ────────────────────────────────────────────────────────────────────────────────────────────────
describe('Settings controls', () => {
  const html = stripJs(SETTINGS);
  it('has the three EQ-style controls, labelled the way EverQuest labels them', () => {
    expect(html).toMatch(/<label for="hoverOpacity">Mouse-over opacity<\/label>/);
    expect(html).toMatch(/<label for="hoverFadeDelay">Fade delay \(seconds\)<\/label>/);
    expect(html).toMatch(/<label for="hoverFadeDur"[^>]*>Fade duration \(seconds\)<\/label>/);
  });
  it('saves each live through save-config under the cfg names main reads, not through the Save payload', () => {
    expect(html).toMatch(/saveConfig\(\{ hoverOpacity: pct < 15 \? 0 : pct \/ 100 \}\)/);
    expect(html).toMatch(/\['hoverFadeDelay', 60, 5\], \['hoverFadeDur', 30, 2\]/);
    expect(html).toMatch(/saveConfig\(\{ \[id\]: val \}\)/);
    const sig = sliceBlock(html, 'function _settingsSig(){', '\n  }');
    expect(sig).not.toMatch(/hover/i);
  });
  it('reads the saved values back on load (default 100% / 5 s / 2 s)', () => {
    expect(html).toMatch(/c\.hoverOpacity === undefined \? 1 : 0/);
    expect(html).toMatch(/c\.hoverFadeDelay : 5/);
    expect(html).toMatch(/c\.hoverFadeDur : 2/);
  });
});
