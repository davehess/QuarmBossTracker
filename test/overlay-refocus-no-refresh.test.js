// "When i click onto a different window and then back into EQ the Overlays all refresh" (the guild lead, 2026-10-14).
//
// Two things could look like that: (a) every overlay blinking as it is re-composited, or (b) the pages really starting
// over (reload, content reset, ⚙ panels closing). This file pins what the code can prove:
//
//  (b) is ruled out on the focus path. A lose-EQ / regain-EQ cycle drives the REAL watcher handler, debouncer, flip and
//      z-order code (sliced out of main.js) over stub windows whose every method - including webContents - is recorded.
//      The only things done to a window are the z-order calls; nothing is reloaded, re-navigated, resized, re-faded or
//      messaged, and with the hide option on the only extra is hide/show. The renderers do not rebuild on
//      visibilitychange / focus either (checked below: the Map re-polls, nothing else listens).
//  (a) is what is left, and it has one cause in the code: the overlays DROP behind other apps since agent 3.7.151, so a
//      browser in front of EverQuest covers them, Chromium's native-window occlusion tracker marks a covered window's
//      page hidden (frame thrown away, timers throttled) and uncovering repaints every one at once. main.js switches the
//      tracker off; the last block pins that.
//
// Mutation check: delete the appendSwitch('disable-features', 'CalculateNativeWinOcclusion') line in main.js and the
// occlusion test fails (checked); add `win.webContents.send('x')` to _applyOverlayZ and the "nothing else is done" and
// source tests fail (checked).
//
// Run: npx vitest run test/overlay-refocus-no-refresh.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';

const MAIN_RAW = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const MAIN = stripJs(MAIN_RAW);
const MIMIC_DIR = path.join(ROOT, 'apps', 'mimic');

const FOCUS_PURE = sliceBlock(MAIN_RAW, 'const FOCUS_LOST_DEBOUNCE_MS',
  'reset() { if (timer) { clearTimeout(timer); timer = null; } ok = true; },\n  };\n}\n');
const FLIP = sliceBlock(MAIN_RAW, 'const _focusDeb = _makeFocusDebouncer', 'FOCUS_LOST_DEBOUNCE_MS);\n');
const FOLLOW_PURE = sliceBlock(MAIN_RAW, 'function _overlaysFollowEqOn(cfg, platform) {', 'return !!focusOk;\n}\n');
const Z_APPLY = sliceBlock(MAIN_RAW, 'const _zApplied = new WeakMap();', '// Per-overlay "Stay on top".');
const SAMPLE = sliceBlock(MAIN_RAW, 'function _focusFgSample(prevPid, line) {',
  '_focusDeb.note(_focusClassify(_focusFgPid, _eqPids, _focusOwnPids()));\n}\n');
const HANDLER = sliceBlock(MAIN_RAW, "    let buf = '';\n    child.stdout.on('data'", "    child.stderr.on('data', () => {});");

// A stub overlay that records EVERY method call on it and on its webContents, whatever the name: a call nobody expected
// shows up in the log instead of throwing "not a function".
function mkWin(name) {
  const log = [];
  const rec = (prefix) => new Proxy({}, { get: (_t, m) => (...a) => { log.push([prefix + String(m), ...a]); } });
  const wc = rec('wc.');
  const win = new Proxy({ name, log, destroyed: false }, {
    get(t, m) {
      if (m in t) return t[m];
      if (m === 'isVisible') return () => true;
      if (m === 'isDestroyed') return () => false;
      if (m === 'webContents') return wc;
      return (...a) => { log.push([String(m), ...a]); };
    },
  });
  return win;
}

function rig({ hideGate = false } = {}) {
  const wins = [mkWin('hud'), mkWin('charm'), mkWin('map'), mkWin('chat')];
  const h = { cfg: { hideOverlaysWhenUnfocused: hideGate }, wins, visits: 0, statuses: 0 };
  const code = `
    ${FOCUS_PURE}
    const process = { platform: 'win32', pid: 999 };
    const app = { getAppMetrics: () => [] };
    let setupMode = false;
    const _eqPids = new Set([100]);
    let _eqGeom = { wins: [{ pid: 100, hwnd: 7770, minimized: false }] };
    const _live = (w) => !!w && !w.destroyed;
    const loadConfig = () => h.cfg;
    const _overlayEntries = () => h.wins.map(w => [w.name, w]);
    const _holdForMove = (w) => !!w && w.__wpDragging === true;   // the real one is tested in mimic-window-move.test.js
    const _inSingleSetup = () => false;
    const _eqWindowGeometry = () => Promise.resolve([]);
    // What applyAllVisibility does to a window under the hide option: show it when focused, hide it when not.
    const applyAllVisibility = () => { h.visits++; for (const w of h.wins) { if (_focusOk) w.showInactive(); else w.hide(); } };
    const pushStatus = () => { h.statuses++; };
    const _focusProc = {};
    ${FOLLOW_PURE}
    ${Z_APPLY}
    ${FLIP}
    ${SAMPLE}
    const child = { stdout: { on(_ev, f) { child.data = f; } }, stderr: { on() {} } };
    ${HANDLER}
    return { feed: (pid) => child.data(String(pid) + '\\n') };
  `;
  // eslint-disable-next-line no-new-func
  const api = new Function('h', code)(h);
  const calls = () => wins.flatMap(w => w.log);
  const clear = () => { for (const w of wins) w.log.length = 0; };
  return Object.assign(h, api, { calls, clear });
}

describe('EQ -> another app -> back into EQ: what is done to the overlays', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('default settings: the only calls are the z-order ones, and no page is touched', () => {
    const r = rig();
    r.feed(100); vi.advanceTimersByTime(1000);
    r.feed(4242); vi.advanceTimersByTime(700);           // click onto a browser: dropped after the 600 ms debounce
    expect(r.calls().map(c => c[0])).toEqual(Array(4).fill(['setAlwaysOnTop', 'moveAbove']).flat());
    r.clear();
    r.feed(100);                                         // click back into EverQuest
    // nothing else, on any window or its webContents: no reload / loadURL / loadFile / send / setBounds / setOpacity /
    // setIgnoreMouseEvents / show / hide / moveTop - the log records every call whatever its name
    expect(r.calls()).toEqual(Array(4).fill(['setAlwaysOnTop', true, 'screen-saver']));
    expect(r.statuses).toBe(0);                          // and no status push (tray rebuild) per flip
    expect(r.visits).toBe(0);                            // nor a whole visibility pass
  });

  it('a second round trip does exactly the same again (nothing accumulates, nothing is skipped)', () => {
    const r = rig();
    r.feed(100); r.feed(4242); vi.advanceTimersByTime(700); r.feed(100); r.clear();
    r.feed(4242); vi.advanceTimersByTime(700);
    expect(r.calls().length).toBe(8);
    r.clear(); r.feed(100);
    expect(r.calls().length).toBe(4);
  });

  it('a click away and back inside the debounce (600 ms) touches nothing at all', () => {
    const r = rig();
    r.feed(100); r.feed(4242); vi.advanceTimersByTime(300); r.feed(100); vi.advanceTimersByTime(5000);
    expect(r.calls()).toEqual([]);
  });

  it('with the hide option on: hide on the way out, show on the way back, one status push each, nothing else', () => {
    const r = rig({ hideGate: true });
    r.feed(100); r.feed(4242); vi.advanceTimersByTime(700);
    expect(r.calls().map(c => c[0])).toEqual(['hide', 'hide', 'hide', 'hide']);
    r.clear(); r.feed(100);
    expect(r.calls().map(c => c[0])).toEqual(['showInactive', 'showInactive', 'showInactive', 'showInactive']);
    expect(r.visits).toBe(2);
    expect(r.statuses).toBe(2);
  });
});

describe('the flip and z-order code (as shipped) cannot refresh a page', () => {
  const CODE = stripJs(FLIP + Z_APPLY + SAMPLE + HANDLER);
  it('none of them names a reload, a navigation, a resize, a fade or a message to a renderer', () => {
    for (const bad of ['reload', 'loadURL', 'loadFile', 'webContents', '.send(', 'setBounds', 'setOpacity', 'setIgnoreMouseEvents',
                       'moveTop', 'showInactive', '.show(', 'invalidate', 'focus(']) {
      expect(CODE, bad).not.toContain(bad);
    }
  });
  it('and the focus path never reaches a broadcast: the status push goes to the dashboard and Settings windows only', () => {
    const body = sliceBlock(MAIN, 'function pushStatus() {', 'function tooltipFor(s) {');
    const sends = body.match(/(\w+)\.webContents\.send\(/g) || [];
    expect(sends.sort()).toEqual(['mainWindow.webContents.send(', 'settingsWindow.webContents.send(']);
  });
});

describe('the overlay pages keep their state when they become visible or focused', () => {
  const pages = fs.readdirSync(MIMIC_DIR).filter(f => f.endsWith('.html') && !['settings.html', 'ui-studio.html', 'welcome.html', 'loading.html', 'resources.html'].includes(f));
  it('no overlay page reloads itself, and only the Map listens for visibility (to poll, not to rebuild)', () => {
    const listeners = [];
    for (const f of pages) {
      const src = stripJs(fs.readFileSync(path.join(MIMIC_DIR, f), 'utf8'));
      expect(src, f).not.toMatch(/location\.reload|location\.href\s*=|history\.go/);
      expect(src, f).not.toMatch(/addEventListener\(['"](focus|pageshow)['"]|\.onfocus\s*=|\.onpageshow\s*=/);
      if (/visibilitychange/.test(src)) listeners.push(f);
    }
    expect(listeners).toEqual(['map.html']);
    const map = stripJs(fs.readFileSync(path.join(MIMIC_DIR, 'map.html'), 'utf8'));
    expect(map).toMatch(/visibilitychange', function \(\) \{ if \(!document\.hidden\) \{ poll\(\); kickAnim\(\); \} \}\)/);
  });
});

describe('a covered overlay is not treated as hidden by Chromium (the blink on uncovering)', () => {
  it('the native-window occlusion tracker is switched off, before the app is ready, as the only disable-features switch', () => {
    const switches = MAIN.match(/appendSwitch\('disable-features'[^)]*\)/g) || [];
    expect(switches).toEqual(["appendSwitch('disable-features', 'CalculateNativeWinOcclusion')"]);
    expect(MAIN.indexOf("appendSwitch('disable-features'")).toBeLessThan(MAIN.indexOf('app.whenReady()'));
  });
});
