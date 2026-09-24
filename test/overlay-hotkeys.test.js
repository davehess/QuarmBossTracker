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
    const keys = main.match(/const HOTKEY_KEYS = \[([^\]]*)\]/)[1];
    for (const k of ['overlayHotkeys', 'miniHotkey', 'miniHotkeyEnabled']) expect(keys, k).toContain("'" + k + "'");
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

// The dashboard's shared key capture, run against a fake document and a fake
// Mimic bridge that holds `uses` (what Mimic's own keys are).
const capBlock = sliceBlock(dash, 'var _WP_HOTKEY_USES = {', '\n  document.addEventListener(\'keyup\', onUp, true);\n  return true;\n}\n');
const rowsBlock = sliceBlock(dash, 'var WP_OVERLAY_ROWS = [', '\n];\n');
async function capture(ev, withClear, { uses = [], selfId } = {}) {
  const handlers = {};
  const document = { addEventListener: (t, h) => { handlers[t] = h; }, removeEventListener: (t) => { delete handlers[t]; } };
  const calls = [];
  const window = { mimic: { hotkeyCapture: (on) => { calls.push(on); return Promise.resolve(on ? uses : true); } } };
  const out = { said: [], accel: null, cleared: undefined, calls };
  // eslint-disable-next-line no-new-func
  const { _wpCaptureAccel } = new Function('document', 'window',
    'var _wpHotkeyCapturing = false;\nfunction _wpFmtAccel(a) { return String(a || "").replace(/CommandOrControl|CmdOrCtrl/gi, "Ctrl"); }\n'
    + rowsBlock + capBlock + '\nreturn { _wpCaptureAccel };')(document, window);
  _wpCaptureAccel((m) => out.said.push(m), (a) => { out.accel = a; }, withClear ? (c) => { out.cleared = c; } : undefined, selfId);
  await Promise.resolve(); await Promise.resolve();   // the uses list arrives
  for (const e of ev) {
    const h = handlers[e.type || 'keydown'];
    if (h) h(Object.assign({ preventDefault() {}, stopPropagation() {}, ctrlKey: false, altKey: false, shiftKey: false, code: '' }, e));
  }
  out.listening = !!handlers.keydown;
  return out;
}

describe('dashboard: the key capture every hotkey shares', () => {
  it('Ctrl+Alt+a letter or digit becomes an accelerator', async () => {
    expect((await capture([{ key: 'Control', ctrlKey: true }, { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true }])).accel).toBe('CommandOrControl+Alt+M');
    expect((await capture([{ key: '3', code: 'Digit3', altKey: true }])).accel).toBe('Alt+3');
  });
  it('Shift with a digit keeps the digit (the key is "!" but the button is 1)', async () => {
    expect((await capture([{ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }])).accel).toBe('CommandOrControl+Shift+1');
  });
  it('a bare key is refused — it would eat normal typing — and the capture keeps listening', async () => {
    const r = await capture([{ key: 'm', code: 'KeyM' }]);
    expect(r.accel).toBeNull();
    expect(r.listening).toBe(true);
  });
  it('Backspace removes an overlay\'s key; Esc cancels without saving', async () => {
    expect((await capture([{ key: 'Backspace', code: 'Backspace' }], true)).cleared).toBe(true);
    const esc = await capture([{ key: 'Escape', code: 'Escape' }], true);
    expect(esc.cleared).toBeNull();
    expect(esc.accel).toBeNull();
  });

  // The guild lead, 2026-09-24: "When setting hotkeys it should tell you when
  // you're trying to use one that's currently in use rather than doing nothing."
  const USES = [{ id: 'hideAllHotkey', accel: 'CommandOrControl+Shift+H' }, { id: 'overlay:tank', accel: 'Alt+Shift+T' }];
  it('a key Mimic already uses is named — and the capture keeps listening for another', async () => {
    const r = await capture([{ key: 'H', code: 'KeyH', ctrlKey: true, shiftKey: true }], false, { uses: USES, selfId: 'overlay:me' });
    expect(r.accel).toBeNull();
    expect(r.said.pop()).toMatch(/^Ctrl\+Shift\+H is already the Show \/ hide ALL key/);
    expect(r.listening).toBe(true);
    // written another way round, still the same key; and an overlay's key is named by its row
    const t = await capture([{ key: 'T', code: 'KeyT', altKey: true, shiftKey: true }], false, { uses: USES, selfId: 'overlay:me' });
    expect(t.said.pop()).toMatch(/is already the Tank HUD overlay’s key/);
  });
  it('…but the control being set may keep its own key', async () => {
    const r = await capture([{ key: 'H', code: 'KeyH', ctrlKey: true, shiftKey: true }], false, { uses: USES, selfId: 'hideAllHotkey' });
    expect(r.accel).toBe('CommandOrControl+Shift+H');
  });
  it('modifiers down and up with no key between — another program holds it — is said, not silent', async () => {
    const r = await capture([
      { key: 'Control', ctrlKey: true }, { key: 'Shift', ctrlKey: true, shiftKey: true },
      { type: 'keyup', key: 'Shift', ctrlKey: true }, { type: 'keyup', key: 'Control' },
    ]);
    expect(r.said.pop()).toMatch(/another program is already using that combination/);
    expect(r.listening).toBe(true);
    const ok = await capture([{ key: 'Control', ctrlKey: true }, { key: 'k', code: 'KeyK', ctrlKey: true }]);
    expect(ok.said.join(' ')).not.toMatch(/another program/);
  });
  it('Mimic lets go of its keys while the capture runs, and takes them back when it ends', async () => {
    const r = await capture([{ key: 'k', code: 'KeyK', ctrlKey: true }]);
    expect(r.calls).toEqual([true, false]);
  });
});

describe('Mimic: letting go of its keys while the dashboard captures', () => {
  it('the capture IPC suspends every key and returns what Mimic holds; a resume re-registers; it resumes on its own too', () => {
    const block = sliceBlock(mainRaw, 'function _setHotkeysSuspended(on) {', '\n}\n');
    expect(block).toContain('unregisterAll()');
    expect(block).toMatch(/setTimeout\(\(\) => _setHotkeysSuspended\(false\), 30_000\)/);
    expect(block).toContain('registerHideAllHotkey();');
    expect(stripJs(sliceBlock(mainRaw, 'function registerHideAllHotkey() {', '\n  try {'))).toContain('if (_hotkeysSuspended) return;');
  });
  it('what Mimic holds: the four all-overlay keys (defaults, unless switched off) and every overlay key', () => {
    const uses = new Function(
      "const _DEFAULT_HIDE_HOTKEY = 'CommandOrControl+Shift+H', _DEFAULT_BACKDROP_HOTKEY = 'CommandOrControl+Shift+B', _DEFAULT_DAMAGE_HOTKEY = 'CommandOrControl+Shift+D', _DEFAULT_MINI_HOTKEY = 'CommandOrControl+Shift+M';\n"
      + mainRaw.match(/const _OVERLAY_HOTKEY_KEYS = \[[\s\S]*?\];/)[0] + '\n'
      + sliceBlock(mainRaw, 'function _mimicHotkeyUses(cfg) {', '\n}\n') + '\nreturn _mimicHotkeyUses;')();
    expect(uses({ backdropHotkeyEnabled: false, miniHotkey: 'Alt+M', overlayHotkeys: { tank: 'Alt+T' } })).toEqual([
      { id: 'hideAllHotkey', accel: 'CommandOrControl+Shift+H' },
      { id: 'damageAlertHotkey', accel: 'CommandOrControl+Shift+D' },
      { id: 'miniHotkey', accel: 'Alt+M' },
      { id: 'overlay:tank', accel: 'Alt+T' },
    ]);
  });
});
