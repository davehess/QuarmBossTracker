// "lately i've been seeing a flicker for the overlays when i switch between applications" (the guild lead, 2026-10-14).
//
// Since 2026-10-13 (agent 3.7.151) the overlays follow EverQuest's z-order: while another app is in front they drop to the
// normal level, and they go back on top the moment EQ or Mimic is. That rides ONE focus watcher whose "regained" verdict
// is instant (only "lost" is debounced). The watcher prints 0 when GetForegroundWindow() is NULL, which Windows returns
// for a moment while one window loses activation and the next has not taken it - exactly while you switch between two
// other apps. A 0 used to count as "focused": every overlay was raised over the app being switched to, and the real pid a
// moment later dropped them again. With the hide option on, the same pair hid, showed and hid every window.
//
// These tests run the REAL watcher handler, debouncer, flip and z-order code (sliced out of main.js) over stub windows and
// count what is done to them. Mutation check: make _focusFgSample return `Number(line)` unconditionally (the old
// behaviour) and the two "no foreground window" tests fail (checked); the baseline and the real-return tests stay
// green, so they pin the behaviour that must NOT change.
//
// Run: npx vitest run test/overlay-focus-flicker.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock } from './_source-slice.js';

const MAIN_RAW = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));

const FOCUS_PURE = sliceBlock(MAIN_RAW, 'const FOCUS_LOST_DEBOUNCE_MS',
  'reset() { if (timer) { clearTimeout(timer); timer = null; } ok = true; },\n  };\n}\n');
const FLIP = sliceBlock(MAIN_RAW, 'const _focusDeb = _makeFocusDebouncer', 'FOCUS_LOST_DEBOUNCE_MS);\n');
const FOLLOW_PURE = sliceBlock(MAIN_RAW, 'function _overlaysFollowEqOn(cfg, platform) {', 'return !!focusOk;\n}\n');
const Z_APPLY = sliceBlock(MAIN_RAW, 'const _zApplied = new WeakMap();', '// Per-overlay "Stay on top".');
const SAMPLE = sliceBlock(MAIN_RAW, 'function _focusFgSample(prevPid, line) {',
  '_focusDeb.note(_focusClassify(_focusFgPid, _eqPids, _focusOwnPids()));\n}\n');
const HANDLER = sliceBlock(MAIN_RAW, "    let buf = '';\n    child.stdout.on('data'", "    child.stderr.on('data', () => {});");

function mkWin(name) {
  return { name, log: [], destroyed: false,
    isVisible() { return true; },
    setAlwaysOnTop(...a) { this.log.push(['aot', ...a]); },
    moveAbove(id) { this.log.push(['above', id]); },
    showInactive() { this.log.push(['show']); },
    hide() { this.log.push(['hide']); } };
}

// The shipped watcher pipeline over stub windows. `feed('4242')` is the watcher printing a foreground pid.
function rig({ hideGate = false } = {}) {
  const wins = [mkWin('hud'), mkWin('charm'), mkWin('map')];
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
    // The hide option's pass: show or hide each window by the gate, as applyAllVisibility does for the real ones.
    const applyAllVisibility = () => { h.visits++; for (const w of h.wins) { if (_focusOk) w.showInactive(); else w.hide(); } };
    const pushStatus = () => { h.statuses++; };
    const _focusProc = {};
    ${FOLLOW_PURE}
    ${Z_APPLY}
    ${FLIP}
    ${SAMPLE}
    const child = { stdout: { on(_ev, f) { child.data = f; } }, stderr: { on() {} } };
    ${HANDLER}
    return { feed: (pid) => child.data(String(pid) + '\\n'), ok: () => _focusOk };
  `;
  // eslint-disable-next-line no-new-func
  const api = new Function('h', code)(h);
  const calls = () => wins.flatMap(w => w.log);
  const clear = () => { for (const w of wins) w.log.length = 0; };
  return Object.assign(h, api, { calls, clear });
}

describe('switching between applications does not bounce the overlays', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('baseline: EQ -> browser drops them once; browser -> a second foreign app touches nothing', () => {
    const r = rig();
    r.feed(100); vi.advanceTimersByTime(1000);
    expect(r.calls()).toEqual([]);                       // EQ in front, created on top: nothing to do
    r.feed(4242); vi.advanceTimersByTime(700);
    expect(r.calls().length).toBe(6);                    // 3 overlays x (drop + tuck above EQ), once
    r.clear();
    r.feed(5151); vi.advanceTimersByTime(5000);
    expect(r.calls()).toEqual([]);
  });

  it('a "no foreground window" sample between two other apps is no news: no raise, no second drop', () => {
    const r = rig();
    r.feed(100); r.feed(4242); vi.advanceTimersByTime(700); r.clear();
    r.feed(0);                                           // GetForegroundWindow() is NULL while the browser loses activation
    vi.advanceTimersByTime(50);
    expect(r.calls()).toEqual([]);                       // was: raised over the app being switched to
    r.feed(5151); vi.advanceTimersByTime(5000);
    expect(r.calls()).toEqual([]);                       // was: dropped a second time 600 ms later
    expect(r.ok()).toBe(false);
  });

  it('the same sample with the hide option on does not hide / show / hide every window', () => {
    const r = rig({ hideGate: true });
    r.feed(100); r.feed(4242); vi.advanceTimersByTime(700);
    expect(r.visits).toBe(1);                            // the one real hide
    r.clear();
    r.feed(0); vi.advanceTimersByTime(50); r.feed(5151); vi.advanceTimersByTime(5000);
    expect(r.visits).toBe(1);
    expect(r.calls().filter(c => c[0] === 'show')).toEqual([]);
    expect(r.statuses).toBe(1);                          // and no extra status push (the tray rebuild) per flip
  });

  it('a real return to EverQuest still raises them at once, and a real NULL after it changes nothing', () => {
    const r = rig();
    r.feed(100); r.feed(4242); vi.advanceTimersByTime(700); r.clear();
    r.feed(0); r.feed(100);
    expect(r.calls()).toEqual([['aot', true, 'screen-saver'], ['aot', true, 'screen-saver'], ['aot', true, 'screen-saver']]);
    expect(r.ok()).toBe(true);
    r.clear(); r.feed(0); vi.advanceTimersByTime(5000);
    expect(r.calls()).toEqual([]);
  });

  it('a 0 before any real pid is still "cannot tell", which stays focused (the gate fails open)', () => {
    const r = rig();
    r.feed(0); vi.advanceTimersByTime(5000);
    expect(r.ok()).toBe(true);
    expect(r.calls()).toEqual([]);
  });
});
