// Focus gate: "hide overlays and dampen hotkeys when EQ focus or Mimic focus is
// lost" (the guild lead, 2026-10-08). apps/mimic/main.js holds the logic; this
// file runs the REAL functions (sliced out of the source, no Electron) for the
// pure parts: classifying the foreground pid, the 600 ms debounce, the
// _eqGateOk truth table, and the gate-driven hotkey release / re-register.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs, evalBlock } from './_source-slice.js';

const mainRaw = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const main = stripJs(mainRaw);

// ── The pure focus functions (classify / pass / debouncer) ──────────────────
const pureBlock = sliceBlock(mainRaw, 'const FOCUS_LOST_DEBOUNCE_MS',
  'reset() { if (timer) { clearTimeout(timer); timer = null; } ok = true; },\n  };\n}\n');
const gateFn = sliceBlock(mainRaw, 'function _eqGateOk(cfg) {', '\n}\n');
const pure = evalBlock(pureBlock, ['_focusGateOn', '_focusClassify', '_focusPass', '_makeFocusDebouncer', 'FOCUS_LOST_DEBOUNCE_MS']);

describe('focus gate: classifying the foreground window', () => {
  const eq = new Set([100, 101]);
  const own = new Set([200, 201]);
  it('EverQuest in front counts as focused', () => {
    expect(pure._focusClassify(100, eq, own)).toBe(true);
    expect(pure._focusClassify(101, eq, own)).toBe(true);
  });
  it('a Mimic process in front counts as focused (dashboard, settings, unlocked overlays)', () => {
    expect(pure._focusClassify(200, eq, own)).toBe(true);
    expect(pure._focusClassify(201, eq, own)).toBe(true);
  });
  it('any other application in front is NOT focused', () => {
    expect(pure._focusClassify(4242, eq, own)).toBe(false);
  });
  it('fails OPEN when it cannot classify: no foreground window, junk, or no known EQ', () => {
    for (const bad of [0, -1, NaN, null, undefined, 'x']) expect(pure._focusClassify(bad, eq, own)).toBe(true);
    expect(pure._focusClassify(4242, new Set(), own)).toBe(true);
    expect(pure._focusClassify(4242, null, own)).toBe(true);
  });
});

describe('focus gate: debounce', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('lost focus flips only after 600 ms of continuous unfocused', () => {
    const flips = [];
    const d = pure._makeFocusDebouncer((ok) => flips.push(ok), pure.FOCUS_LOST_DEBOUNCE_MS);
    d.note(false);
    vi.advanceTimersByTime(599);
    expect(flips).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(flips).toEqual([false]);
  });
  it('an alt-tab flicker (back inside 600 ms) never flips', () => {
    const flips = [];
    const d = pure._makeFocusDebouncer((ok) => flips.push(ok), pure.FOCUS_LOST_DEBOUNCE_MS);
    d.note(false);
    vi.advanceTimersByTime(400);
    d.note(true);
    vi.advanceTimersByTime(5000);
    expect(flips).toEqual([]);
  });
  it('regained focus flips back immediately, and a repeat does nothing', () => {
    const flips = [];
    const d = pure._makeFocusDebouncer((ok) => flips.push(ok), pure.FOCUS_LOST_DEBOUNCE_MS);
    d.note(false); vi.advanceTimersByTime(600);
    d.note(true);
    expect(flips).toEqual([false, true]);
    d.note(true);
    expect(flips).toEqual([false, true]);
  });
  it('repeated unfocused reports do not push the deadline out', () => {
    const flips = [];
    const d = pure._makeFocusDebouncer((ok) => flips.push(ok), pure.FOCUS_LOST_DEBOUNCE_MS);
    d.note(false); vi.advanceTimersByTime(300);
    d.note(false); vi.advanceTimersByTime(300);
    expect(flips).toEqual([false]);
  });
  it('reset() drops a pending flip', () => {
    const flips = [];
    const d = pure._makeFocusDebouncer((ok) => flips.push(ok), pure.FOCUS_LOST_DEBOUNCE_MS);
    d.note(false); d.reset(); vi.advanceTimersByTime(5000);
    expect(flips).toEqual([]);
  });
});

describe('focus gate: _eqGateOk truth table', () => {
  function gate({ platform = 'win32', eqRunning = true, setup = false, focusOk = true, cfg = {} }) {
    const code = `${pureBlock}\n${gateFn}\nlet _eqRunning = ${eqRunning}, setupMode = ${setup};\n_focusOk = ${focusOk};`
      + `\nconst process = { platform: ${JSON.stringify(platform)} };`;
    return evalBlock(code, ['_eqGateOk'])._eqGateOk(cfg);
  }
  const on = { hideOverlaysWhenUnfocused: true };

  it('option off: only the EQ-running gate matters, exactly as before', () => {
    expect(gate({ eqRunning: true, focusOk: false })).toBe(true);
    expect(gate({ eqRunning: false, focusOk: true })).toBe(false);
    expect(gate({ eqRunning: false, cfg: { hideOverlaysWhenEqDown: false } })).toBe(true);
  });
  it('option on, EQ up: follows focus', () => {
    expect(gate({ cfg: on, focusOk: true })).toBe(true);
    expect(gate({ cfg: on, focusOk: false })).toBe(false);
  });
  it('option on, EQ down: still closed (EQ-down behaviour unchanged), focus or not', () => {
    expect(gate({ cfg: on, eqRunning: false, focusOk: true })).toBe(false);
    expect(gate({ cfg: on, eqRunning: false, focusOk: false })).toBe(false);
  });
  it('EQ-down option off + focus option on: focus still gates', () => {
    const cfg = { hideOverlaysWhenEqDown: false, hideOverlaysWhenUnfocused: true };
    expect(gate({ cfg, eqRunning: false, focusOk: false })).toBe(false);
    expect(gate({ cfg, eqRunning: false, focusOk: true })).toBe(true);
  });
  it('non-Windows: the option does nothing', () => {
    expect(gate({ platform: 'linux', cfg: on, focusOk: false })).toBe(true);
    expect(gate({ platform: 'darwin', cfg: on, focusOk: false })).toBe(true);
  });
  it('setup mode and unlocked overlays bypass the focus part', () => {
    expect(gate({ cfg: on, focusOk: false, setup: true })).toBe(true);
    expect(gate({ cfg: { ...on, overlaysLocked: false }, focusOk: false })).toBe(true);
    expect(gate({ cfg: { ...on, overlaysLocked: true }, focusOk: false })).toBe(false);
  });
  it('only a literal true turns the option on', () => {
    for (const v of [undefined, false, 0, 'true', 1]) expect(gate({ cfg: { hideOverlaysWhenUnfocused: v }, focusOk: false })).toBe(true);
  });
});

// ── The hotkey side, run against the REAL registerHideAllHotkey ─────────────
describe('focus gate: hotkeys', () => {
  const overlayBlock = sliceBlock(mainRaw, 'const _OVERLAY_HOTKEY_KEYS', '\n}\n');
  const regFn = sliceBlock(mainRaw, 'function registerHideAllHotkey() {', '\n}\n');
  const quietFn = sliceBlock(mainRaw, 'function _quietHotkeyRegister() {', '\n}\n');
  const syncFn = sliceBlock(mainRaw, 'function _syncFocusHotkeys() {', '\n}\n');
  const suspendFn = sliceBlock(mainRaw, 'function _setHotkeysSuspended(on) {', '\n}\n');

  function world(cfg) {
    const held = new Map();
    const gs = {
      taken: new Set(['CommandOrControl+Shift+B']),          // the backdrop key belongs to another app
      register(a, cb) { if (this.taken.has(a) || held.has(a)) return false; held.set(a, cb); return true; },
      unregister(a) { held.delete(a); },
      unregisterAll() { held.clear(); },
    };
    const log = [];
    globalThis.__fg = { gs, log, cfg };
    const code = `
      const require = () => ({ globalShortcut: globalThis.__fg.gs });
      const loadConfig = () => globalThis.__fg.cfg;
      const appendAgentLog = (s) => globalThis.__fg.log.push(s);
      const _toggleOverlay = () => {};
      let _hideAllActive = false, _hideAllPrev = null, _registeredHideAccel = null, _registeredBackdropAccel = null,
          _registeredDamageAccel = null, _registeredMiniAccel = null, _miniAllActive = false, _miniAllPrev = null;
      const _DEFAULT_BACKDROP_HOTKEY = 'CommandOrControl+Shift+B', _DEFAULT_MINI_HOTKEY = 'CommandOrControl+Shift+M',
            _DEFAULT_DAMAGE_HOTKEY = 'CommandOrControl+Shift+D';
      const _hideAllAccelerator = () => 'CommandOrControl+Shift+H';
      const _damageAlertAccelerator = () => _DEFAULT_DAMAGE_HOTKEY;
      const toggleHideAllOverlays = () => {}, toggleAllBackdrops = () => {}, toggleDamageAlert = () => {}, toggleMinimizeAllOverlays = () => {};
      let setupMode = false, _hotkeysSuspended = false, _hotkeysResumeTimer = null,
          _hotkeysGatedOff = false, _blockedHotkeys = {};
      ${pureBlock}
      ${overlayBlock}
      ${regFn}
      ${quietFn}
      ${syncFn}
      ${suspendFn}
      const process = { platform: 'win32' };
      const __api = {
        reg: registerHideAllHotkey, sync: _syncFocusHotkeys, suspend: _setHotkeysSuspended,
        setFocus(v) { _focusOk = v; }, setSetup(v) { setupMode = v; },
        get blocked() { return _blockedHotkeys; }, get gatedOff() { return _hotkeysGatedOff; },
      };`;
    return { api: evalBlock(code, ['__api']).__api, held, gs, log };
  }
  const base = () => ({ hideOverlaysWhenUnfocused: true, overlayHotkeys: { me: 'CommandOrControl+Alt+1' } });
  const keys = (held) => [...held.keys()].sort();

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); delete globalThis.__fg; });

  it('losing focus releases every global key; regaining it puts them back', () => {
    const w = world(base());
    w.api.reg();
    const before = keys(w.held);
    expect(before.length).toBeGreaterThanOrEqual(4);          // hide-all, damage, mini, the overlay key
    w.api.setFocus(false); w.api.sync();
    expect(w.held.size).toBe(0);
    expect(w.api.gatedOff).toBe(true);
    w.api.setFocus(true); w.api.sync();
    expect(keys(w.held)).toEqual(before);
    expect(w.api.gatedOff).toBe(false);
  });

  it('a gate-driven re-register does not log failures or rewrite the blocked-key state', () => {
    const w = world(base());
    w.api.reg();                                              // a normal pass: backdrop is refused, logged, remembered
    expect(w.api.blocked).toEqual({ backdropHotkey: 'CommandOrControl+Shift+B' });
    const logged = w.log.length;
    expect(logged).toBeGreaterThan(0);
    const blockedObj = w.api.blocked;
    // another app grabs every other key while we are unfocused
    for (const k of ['CommandOrControl+Shift+H', 'CommandOrControl+Shift+D', 'CommandOrControl+Shift+M', 'CommandOrControl+Alt+1']) w.gs.taken.add(k);
    w.api.setFocus(false); w.api.sync();
    w.api.setFocus(true); w.api.sync();
    expect(w.log.length).toBe(logged);                        // nothing new logged
    expect(w.api.blocked).toBe(blockedObj);                   // same object, untouched
    expect(w.api.blocked).toEqual({ backdropHotkey: 'CommandOrControl+Shift+B' });
  });

  it('a user-initiated register after the gate lifts logs and records blocked keys again', () => {
    const w = world(base());
    w.api.setFocus(false); w.api.sync(); w.api.setFocus(true); w.api.sync();
    const n = w.log.length;
    w.api.reg();
    expect(w.log.length).toBeGreaterThan(n);
    expect(w.api.blocked).toEqual({ backdropHotkey: 'CommandOrControl+Shift+B' });
  });

  it('while the gate holds keys off, registerHideAllHotkey registers nothing (the capture auto-resume respects it)', () => {
    const w = world(base());
    w.api.reg();
    w.api.setFocus(false); w.api.sync();
    w.api.suspend(true);                                      // dashboard starts capturing a key
    vi.advanceTimersByTime(30_000);                           // the capture's own 30 s auto-resume fires
    expect(w.held.size).toBe(0);
    w.api.reg();                                              // even an explicit register stays off
    expect(w.held.size).toBe(0);
    w.api.setFocus(true); w.api.sync();                       // focus returns: keys are back
    expect(w.held.size).toBeGreaterThanOrEqual(4);
  });

  it('focus returning DURING a capture leaves the keys to the capture\'s own resume', () => {
    const w = world(base());
    w.api.reg();
    w.api.setFocus(false); w.api.sync();
    w.api.suspend(true);
    w.api.setFocus(true); w.api.sync();
    expect(w.held.size).toBe(0);                              // suspended: not registered under the capture
    vi.advanceTimersByTime(30_000);
    expect(w.held.size).toBeGreaterThanOrEqual(4);
  });

  it('unlocked overlays and setup mode keep the hotkeys registered', () => {
    const cfg = base();
    const w = world(cfg);
    w.api.reg();
    const before = keys(w.held);
    w.api.setFocus(false);
    cfg.overlaysLocked = false; w.api.sync();
    expect(keys(w.held)).toEqual(before);
    cfg.overlaysLocked = true; w.api.sync();                  // locked again: released
    expect(w.held.size).toBe(0);
    w.api.setSetup(true); w.api.sync();                       // setup mode: back
    expect(keys(w.held)).toEqual(before);
  });

  it('turning the option off while unfocused gives the keys back', () => {
    const cfg = base();
    const w = world(cfg);
    w.api.reg();
    w.api.setFocus(false); w.api.sync();
    expect(w.held.size).toBe(0);
    cfg.hideOverlaysWhenUnfocused = false; w.api.sync();
    expect(w.held.size).toBeGreaterThanOrEqual(4);
  });

  it('sync is idempotent', () => {
    const w = world(base());
    w.api.reg();
    w.api.setFocus(false);
    w.api.sync(); w.api.sync();
    expect(w.held.size).toBe(0);
    w.api.setFocus(true);
    w.api.sync(); w.api.sync();
    expect(w.held.size).toBeGreaterThanOrEqual(4);
  });
});

// ── Wiring (text, comments stripped) ────────────────────────────────────────
describe('focus gate: wiring', () => {
  it('every visibility pass re-syncs the hotkeys; unlock/setup does too', () => {
    expect(sliceBlock(main, 'function applyAllVisibility() {', '\n}\n')).toContain('_syncFocusHotkeys()');
    expect(sliceBlock(main, 'function applyOverlayInteractivity() {', '  _materializeEnabledOverlays();')).toContain('_syncFocusHotkeys()');
  });
  it('the option is off by default and only the config key turns it on', () => {
    expect(main).toMatch(/hideOverlaysWhenUnfocused: false,/);
  });
  it('tray, Settings save and the dashboard all land in the same internals', () => {
    expect(sliceBlock(main, "{ label: 'Hide overlays + hotkeys when EverQuest/Mimic isn", '} },')).toContain('_onFocusGateOptionChanged()');
    expect(sliceBlock(main, "ipcMain.handle('save-config'", 'return true;\n});')).toMatch(/hasOwnProperty\.call\(incoming, 'hideOverlaysWhenUnfocused'\)[\s\S]*?_onFocusGateOptionChanged\(\)/);
    const settings = readSource(path.join(ROOT, 'apps', 'mimic', 'settings.html'));
    expect((settings.match(/hideOverlaysWhenUnfocused/g) || []).length).toBeGreaterThanOrEqual(6);
    const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
    expect(dash).toMatch(/saveConfig\(\{ hideOverlaysWhenUnfocused:/);
  });
  it('the watcher child is killed on quit', () => {
    expect(sliceBlock(main, "app.on('before-quit'", '\n});')).toContain('_stopFocusWatcher()');
  });
  it('status exposes the gate to the dashboard', () => {
    expect(main).toMatch(/focusGateOn: _focusGateOn\(cfg, process\.platform\)/);
    expect(main).toMatch(/focusOk: !!_focusOk/);
  });
});
