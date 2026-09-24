// Per-overlay hotkeys (the guild lead, 2026-09-24: "Each overlay should get its
// own hotkey config as well. so if i want to pull one up i can do it without
// much effort"). Mimic binds cfg.overlayHotkeys as global shortcuts that run
// the SAME toggle as the dashboard's ON/OFF button; the dashboard's Overlays
// table sets them with the key capture every hotkey on that page shares.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs, evalBlock } from './_source-slice.js';

const mainRaw = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const main = stripJs(mainRaw);
const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));

// The registration block, run against a fake globalShortcut.
const regBlock = sliceBlock(mainRaw, 'const _OVERLAY_HOTKEY_KEYS', '\n}\n');
function loadReg() {
  const toggled = [], log = [];
  // eslint-disable-next-line no-new-func
  const mod = new Function('_toggleOverlay', 'appendAgentLog', regBlock
    + '\nreturn { _registerOverlayHotkeys, _OVERLAY_HOTKEY_KEYS, get blocked(){ return _blockedOverlayAccels; }, get bound(){ return _registeredOverlayAccels; } };')(
    (k) => toggled.push(k), (s) => log.push(s));
  const held = new Map();                      // accelerator → callback
  const gs = {
    taken: new Set(['CommandOrControl+Alt+T']),   // "another app" owns this one
    register(a, cb) { if (a === 'bad accel') throw new Error('malformed'); if (this.taken.has(a) || held.has(a)) return false; held.set(a, cb); return true; },
    unregister(a) { held.delete(a); },
  };
  return { mod, gs, held, toggled, log };
}

describe('Mimic: one global hotkey per overlay', () => {
  it('binds each configured overlay, and a press runs that overlay\'s toggle', () => {
    const { mod, gs, held, toggled } = loadReg();
    mod._registerOverlayHotkeys(gs, { overlayHotkeys: { me: 'CommandOrControl+Alt+1', mobinfo: 'CommandOrControl+Alt+2' } });
    expect(Object.keys(mod.bound).sort()).toEqual(['me', 'mobinfo']);
    held.get('CommandOrControl+Alt+1')();
    expect(toggled).toEqual(['me']);
  });

  it('no hotkey unless one was set — nothing is bound by default', () => {
    const { mod, gs, held } = loadReg();
    mod._registerOverlayHotkeys(gs, {});
    expect(held.size).toBe(0);
  });

  it('a key another app holds (or a second overlay on the same key) is reported, not silently dead', () => {
    const { mod, gs, log } = loadReg();
    mod._registerOverlayHotkeys(gs, { overlayHotkeys: { tank: 'CommandOrControl+Alt+T', me: 'CommandOrControl+Alt+1', hud: 'CommandOrControl+Alt+1', who: 'bad accel' } });
    // hud comes first in the list, so it gets Alt+1 and the HUD ('me') is the one refused.
    expect(mod.blocked).toEqual({ tank: 'CommandOrControl+Alt+T', who: 'bad accel', me: 'CommandOrControl+Alt+1' });
    expect(Object.keys(mod.bound)).toEqual(['hud']);
    expect(log.join('')).toMatch(/tank overlay hotkey "CommandOrControl\+Alt\+T"/);
  });

  it('changing a key lets go of the old one', () => {
    const { mod, gs, held } = loadReg();
    mod._registerOverlayHotkeys(gs, { overlayHotkeys: { me: 'CommandOrControl+Alt+1' } });
    mod._registerOverlayHotkeys(gs, { overlayHotkeys: { me: 'CommandOrControl+Alt+9' } });
    expect([...held.keys()]).toEqual(['CommandOrControl+Alt+9']);
  });

  it('the hotkey and the dashboard button are ONE toggle path, and every hotkey key has a case in it', () => {
    expect(main).toContain("ipcMain.handle('toggle-overlay', (_e, name) => _toggleOverlay(name));");
    const toggle = sliceBlock(main, 'function _toggleOverlay(name) {', '\n}\n');
    for (const k of loadReg().mod._OVERLAY_HOTKEY_KEYS) expect(toggle, k).toContain("case '" + k + "':");
  });

  it('saving a hotkey re-binds live, and a refused one reaches the dashboard', () => {
    expect(main).toMatch(/const HOTKEY_KEYS = \[[^\]]*'overlayHotkeys'\]/);
    expect(main).toContain('_registerOverlayHotkeys(globalShortcut, cfg);');
    expect(main).toContain('overlayHotkeysBlocked: Object.assign({}, _blockedOverlayAccels),');
  });

  it('every row on the dashboard\'s Overlays table can take a hotkey', () => {
    const rows = [...dash.slice(dash.indexOf('var WP_OVERLAY_ROWS = ['), dash.indexOf('];', dash.indexOf('var WP_OVERLAY_ROWS = [')))
      .matchAll(/^\s+\['(\w+)',/gm)].map(m => m[1]).sort();
    expect(rows.length).toBeGreaterThan(10);
    expect([...loadReg().mod._OVERLAY_HOTKEY_KEYS].sort()).toEqual(rows);
  });
});

// The dashboard's shared key capture, run against a fake document.
const capBlock = sliceBlock(dash, 'function _wpCaptureAccel(say, onAccel, onClear) {', '\n}\n');
function capture(ev, withClear) {
  let handler = null;
  const document = { addEventListener: (_t, h) => { handler = h; }, removeEventListener: () => { handler = null; } };
  const out = { said: [], accel: null, cleared: undefined };
  // eslint-disable-next-line no-new-func
  const { _wpCaptureAccel } = new Function('document', 'var _wpHotkeyCapturing = false;\n' + capBlock + '\nreturn { _wpCaptureAccel };')(document);
  _wpCaptureAccel((m) => out.said.push(m), (a) => { out.accel = a; }, withClear ? (c) => { out.cleared = c; } : undefined);
  for (const e of ev) if (handler) handler(Object.assign({ preventDefault() {}, stopPropagation() {}, ctrlKey: false, altKey: false, shiftKey: false, code: '' }, e));
  out.listening = !!handler;
  return out;
}

describe('dashboard: the key capture every hotkey shares', () => {
  it('Ctrl+Alt+a letter or digit becomes an accelerator', () => {
    expect(capture([{ key: 'Control', ctrlKey: true }, { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true }]).accel).toBe('CommandOrControl+Alt+M');
    expect(capture([{ key: '3', code: 'Digit3', altKey: true }]).accel).toBe('Alt+3');
  });
  it('Shift with a digit keeps the digit (the key is "!" but the button is 1)', () => {
    expect(capture([{ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }]).accel).toBe('CommandOrControl+Shift+1');
  });
  it('a bare key is refused — it would eat normal typing — and the capture keeps listening', () => {
    const r = capture([{ key: 'm', code: 'KeyM' }]);
    expect(r.accel).toBeNull();
    expect(r.listening).toBe(true);
  });
  it('Backspace removes an overlay\'s key; Esc cancels without saving', () => {
    expect(capture([{ key: 'Backspace', code: 'Backspace' }], true).cleared).toBe(true);
    const esc = capture([{ key: 'Escape', code: 'Escape' }], true);
    expect(esc.cleared).toBeNull();
    expect(esc.accel).toBeNull();
  });
});
