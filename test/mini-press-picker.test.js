// test/mini-press-picker.test.js — press an overlay's NAME to minimize it, every overlay folds, and the overlay picker
// (the guild lead, 2026-10-28).
//
// Held here, each one RUN against the real source rather than read off it, so a comment cannot satisfy it:
//   • every overlay page marks its name with exactly one data-wp-name (the dock and the Timers canvas have none);
//   • the press: down lights it, up on it without moving toggles mini, moving away or dragging cancels, a long press
//     opens the picker and the release after it does NOT toggle;
//   • the picker's order: this character's recent overlays first, catalog order after, A–Z on ▸ MORE;
//   • per-character state: mini flags put back when that character is active (global map when they have no entry),
//     the per-character map capped, and the one writer (_setOverlayMini) recording them;
//   • Minimize ALL (the hotkey) still reaches only the nine designed minis, never the fold-only overlays;
//   • a folded window keeps the height it will unfold to and is not stretched by the height floor.
//
// Run: npx vitest run test/mini-press-picker.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const mimicDir = path.join(ROOT, 'apps', 'mimic');
const main = readSource(path.join(mimicDir, 'main.js'));
const preload = readSource(path.join(mimicDir, 'preload.js'));
const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const m = stripJs(main);
const p = stripJs(preload);

// ── every overlay page names itself exactly once ─────────────────────────────────────────────────────────
const OVERLAY_PAGES = fs.readdirSync(mimicDir)
  .filter(f => f.endsWith('.html'))
  .filter(f => /id="move-btn"/.test(fs.readFileSync(path.join(mimicDir, f), 'utf8')))
  .filter(f => f !== 'dock.html');

describe('every overlay window has exactly one [data-wp-name]', () => {
  it('finds the eighteen overlay pages (a new overlay joins this list by having a ✥)', () => {
    expect(OVERLAY_PAGES.sort()).toEqual([
      'buffqueue.html', 'charm.html', 'chat.html', 'chchain.html', 'command.html', 'extarget.html', 'map.html', 'me.html',
      'melody.html', 'mobinfo.html', 'overlay.html', 'pets.html', 'popraid.html', 'tank.html', 'threatmeter.html',
      'triggers.html', 'who.html', 'zealhealth.html',
    ]);
  });
  it('one marker per page, on an element', () => {
    for (const f of OVERLAY_PAGES) {
      const html = fs.readFileSync(path.join(mimicDir, f), 'utf8');
      const hits = [...html.matchAll(/<[a-z][^>]*\sdata-wp-name(?=[\s>=])[^>]*>/g)];
      expect(hits.length, f).toBe(1);
    }
  });
  it('the dock and the screen-sized Timers canvas have none (they are not folded or pressed)', () => {
    for (const f of ['dock.html', 'canvas.html']) {
      expect(fs.readFileSync(path.join(mimicDir, f), 'utf8'), f).not.toMatch(/data-wp-name/);
    }
  });
  it('a page with no title row of its own (alerts, map) carries the shared chip, styled by the preload', () => {
    for (const f of ['triggers.html', 'map.html']) {
      expect(fs.readFileSync(path.join(mimicDir, f), 'utf8'), f).toMatch(/<div class="wp-name-chip[ "][^>]*\sdata-wp-name\b/);
    }
    expect(p).toContain('.wp-name-chip{position:fixed;top:6px;left:28px;');
  });
});

// ── the press ─────────────────────────────────────────────────────────────────────────────────────────────
function loadPress() {
  const { _wpMakeNamePress, WP_NAME_LONG_MS, WP_NAME_MOVE_PX } = evalBlock(
    sliceBlock(preload, 'const WP_NAME_MOVE_PX = 4;', 'const WP_NAME_LONG_MS = 500;') + '\n'
    + sliceBlock(preload, 'function _wpMakeNamePress(h) {', '\n}\n'),
    ['_wpMakeNamePress', 'WP_NAME_LONG_MS', 'WP_NAME_MOVE_PX']);
  const log = [];
  let now = 0; const timers = [];
  const h = {
    setTimer: (f, ms) => { const t = { f, at: now + ms, live: true }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.live = false; },
    pressed: (on) => log.push('pressed:' + on),
    toggle: () => log.push('toggle'),
    picker: () => log.push('picker'),
  };
  const advance = (ms) => { now += ms; for (const t of timers) if (t.live && t.at <= now) { t.live = false; t.f(); } };
  return { press: _wpMakeNamePress(h), log, advance, LONG: WP_NAME_LONG_MS, MOVE: WP_NAME_MOVE_PX };
}

describe('pressing a window\'s name', () => {
  it('the thresholds are the asked-for ones: ~4 px, ~500 ms', () => {
    const { LONG, MOVE } = loadPress();
    expect([MOVE, LONG]).toEqual([4, 500]);
  });
  it('down lights the name; letting go on it without moving toggles mini and lights it no more', () => {
    const { press, log, advance } = loadPress();
    press.down(100, 20);
    advance(120);
    expect(press.up()).toBe(true);
    expect(log).toEqual(['pressed:true', 'pressed:false', 'toggle']);
    advance(1000);                                   // the long-press timer died with the release
    expect(log).not.toContain('picker');
  });
  it('a wobble of up to 4 px still counts as a press; past 4 px it is a drag and cancels', () => {
    const a = loadPress();
    a.press.down(100, 20); a.press.move(103, 20);
    expect(a.press.up()).toBe(true);
    const b = loadPress();
    b.press.down(100, 20); b.press.move(106, 20);    // 6 px: cancelled, highlight off
    expect(b.log).toEqual(['pressed:true', 'pressed:false']);
    expect(b.press.up()).toBe(false);
    expect(b.log).not.toContain('toggle');
    b.advance(1000);
    expect(b.log).not.toContain('picker');
  });
  it('moving away (cancel) toggles nothing and unlights the name', () => {
    const { press, log, advance } = loadPress();
    press.down(10, 10); press.cancel();
    advance(1000);
    expect(log).toEqual(['pressed:true', 'pressed:false']);
  });
  it('held 500 ms without moving, the picker opens and the release after it does NOT toggle', () => {
    const { press, log, advance } = loadPress();
    press.down(10, 10);
    advance(499);
    expect(log).toEqual(['pressed:true']);
    advance(1);
    expect(log).toEqual(['pressed:true', 'pressed:false', 'picker']);
    expect(press.up()).toBe(false);
    expect(log).not.toContain('toggle');
  });
  it('a long press that has drifted past 4 px before 500 ms never opens the picker', () => {
    const { press, log, advance } = loadPress();
    press.down(10, 10); advance(300); press.move(30, 10); advance(1000);
    expect(log).not.toContain('picker');
  });
  it('is wired to the same wp-mini-toggle the right-click row uses, and right-click opens the picker', () => {
    expect(p).toMatch(/toggle: function \(\) \{ ipcRenderer\.invoke\('wp-mini-toggle'\)/);
    expect(p).toMatch(/addEventListener\('contextmenu', function \(ev\) \{\s*if \(!target\(ev\)\) return;\s*ev\.preventDefault\(\);\s*cancel\(\);\s*_wpOpenPicker\(\);/);
    expect(p).toContain("ipcRenderer.invoke('toggle-overlay', o.toggle)");   // picker rows: the dashboard's and hotkeys' path
  });
  it('the ✥ stays the move handle: nothing in the press moves a window', () => {
    const body = sliceBlock(p, 'function _wpMakeNamePress(h) {', '\n}\n');
    expect(body).not.toMatch(/overlay-drag|startWindowDrag|setBounds/);
  });
});

// ── the picker's order ──────────────────────────────────────────────────────────────────────────────────
function loadPicker() {
  return evalBlock(
    sliceBlock(main, 'const _PICKER_STANDARD = [', '\n];') + '\n'
    + sliceBlock(main, 'const _PICKER_MORE = [', '\n];') + '\n'
    + sliceBlock(main, 'function _pickerOrder(items, used, alpha) {', '\n}\n'),
    ['_PICKER_STANDARD', '_PICKER_MORE', '_pickerOrder']);
}
describe('the overlay picker', () => {
  const { _PICKER_STANDARD: STD, _PICKER_MORE: MORE, _pickerOrder } = loadPicker();
  const keys = (l) => l.map(c => c.key);

  it('STANDARD is the nine the guild lead named; ▸ MORE is every other overlay window', () => {
    expect(keys(STD)).toEqual(['hud', 'tank', 'mobinfo', 'buffQueue', 'chchain', 'charm', 'pets', 'trigger', 'map']);
    expect(keys(MORE).sort()).toEqual(['chat', 'command', 'dock', 'exttarget', 'maptimers', 'me', 'melody', 'popraid', 'threat', 'who', 'zeal']);
    const all = keys(STD).concat(keys(MORE));
    expect(new Set(all).size).toBe(all.length);
  });
  it('a row\'s toggle name is what main\'s _toggleOverlay takes (the pet tracker is "pet" there)', () => {
    const toggles = [...STD, ...MORE].map(c => c.toggle);
    const handled = [...sliceBlock(m, 'function _toggleOverlay(name) {', '\n}\n').matchAll(/case '(\w+)':/g)].map(x => x[1]);
    for (const t of toggles) expect(handled, t).toContain(t);
    expect(STD.find(c => c.key === 'pets').toggle).toBe('pet');
  });
  it('with no history it is catalog order', () => {
    expect(keys(_pickerOrder(STD, {}, false))).toEqual(keys(STD));
    expect(keys(_pickerOrder(MORE, undefined, false))).toEqual(keys(MORE));
  });
  it('what this character showed before comes first, most recent first; the rest keep catalog order', () => {
    const used = { map: 500, charm: 900, hud: 100 };
    expect(keys(_pickerOrder(STD, used, false))).toEqual(['charm', 'map', 'hud', 'tank', 'mobinfo', 'buffQueue', 'chchain', 'pets', 'trigger']);
    expect(keys(_pickerOrder(MORE, { zeal: 7, who: 9 }, false)).slice(0, 3)).toEqual(['who', 'zeal', MORE[0].key]);
  });
  it('a stamp of 0 or garbage is "never used"', () => {
    expect(keys(_pickerOrder(STD, { map: 0, charm: 'x', tank: null }, false))).toEqual(keys(STD));
  });
  it('A–Z sorts ▸ MORE by name, ignoring the slash on "/who", whatever was used', () => {
    const order = _pickerOrder(MORE, { dock: 99999 }, true);
    expect(order.map(c => c.label)).toEqual(['Chat', 'Command Center', 'Dock', 'Extended Target', 'HUD', 'Map timers', 'Melody', 'PoP raids', 'Threat meter', 'Tick', '/who']);
  });
  it('the main-side IPC orders STANDARD by recency only and MORE by the persisted A–Z switch', () => {
    const h = sliceBlock(m, "ipcMain.handle('wp-overlay-picker', () => {", '\n});');
    expect(h).toContain('_pickerOrder(_PICKER_STANDARD, used, false)');
    expect(h).toContain('_pickerOrder(_PICKER_MORE, used, alpha)');
    expect(h).toContain('cfg.pickerMoreAlpha');
    expect(m).toMatch(/ipcMain\.handle\('wp-picker-alpha-toggle'[\s\S]*?cfg\.pickerMoreAlpha = !cfg\.pickerMoreAlpha;\s*saveConfig\(cfg\);/);
  });
});

// ── ▸ MORE and ▸ CANVAS are collapsed sections that remember ────────────────────────────────────────────
describe('the picker\'s sections', () => {
  const { _pickerOpenOf } = evalBlock(sliceBlock(main, 'function _pickerOpenOf(cfg) {', '\n}\n'), ['_pickerOpenOf']);
  it('MORE and CANVAS start collapsed; only a stored true opens one', () => {
    expect(_pickerOpenOf({})).toEqual({ more: false, canvas: false });
    expect(_pickerOpenOf(undefined)).toEqual({ more: false, canvas: false });
    expect(_pickerOpenOf({ pickerOpen: { more: true } })).toEqual({ more: true, canvas: false });
    expect(_pickerOpenOf({ pickerOpen: { more: 'yes', canvas: 1 } })).toEqual({ more: false, canvas: false });
  });
  it('the picker data carries the open state, and wp-picker-open-set keeps it in the config (and only for those two sections)', () => {
    expect(sliceBlock(m, "ipcMain.handle('wp-overlay-picker', () => {", '\n});')).toContain('open: _pickerOpenOf(cfg),');
    const set = sliceBlock(m, "ipcMain.handle('wp-picker-open-set'", '\n});');
    expect(set).toContain("if (name !== 'more' && name !== 'canvas') return null;");
    expect(set).toContain('cfg.pickerOpen = Object.assign(_pickerOpenOf(cfg), { [name]: !!on });');
    expect(set).toContain('saveConfig(cfg);');
  });
  it('the headings fold them in place (▸ closed, ▾ open), start from the remembered state, and A–Z shows only while MORE is open', () => {
    const b = sliceBlock(p, 'function _buildOverlayPicker(onClose, data) {', '\n}\n');
    expect(b).toContain("label.textContent = (on ? '▾ ' : '▸ ') + title;");
    expect(b).toContain("let isOpen = open[name] === true;");
    expect(b).toContain("if (extra) extra.style.display = on ? '' : 'none';");
    expect(b).toContain("ipcRenderer.invoke('wp-picker-open-set', name, isOpen)");
    expect(b).toContain("const more = section('more', 'More', az);");
    expect(b).toContain("const canvas = section('canvas', 'Canvas');");
    expect(b).toContain("ev.stopPropagation();");                       // A–Z re-sorts; it must not fold the section it sits in
    // the Overlays rows are not a section: always there
    expect(b.indexOf("(d.standard || []).forEach")).toBeLessThan(b.indexOf("section('more'"));
  });
});

// ── the stand-in name chip never covers content ─────────────────────────────────────────────────────────
describe('the stand-in name chip (designed minis hide their title row)', () => {
  const { _wpFreeSpot } = evalBlock(sliceBlock(preload, 'function _wpFreeSpot(obs, W, H, w, h) {', '\n}\n'), ['_wpFreeSpot']);
  const hits = (s, w, h, o) => s.x < o.right && s.x + w > o.left && s.y < o.bottom && s.y + h > o.top;
  it('is invisible and takes no clicks until the pointer is over the window', () => {
    expect(p).toContain('.wp-name-proxy{opacity:0 !important;pointer-events:none}');
    expect(p).toContain('body.wp-mini:hover .wp-name-proxy{opacity:1 !important;pointer-events:auto}');
  });
  it('takes the top-most, left-most strip between the ✥ and ✕ gutters that is clear', () => {
    expect(_wpFreeSpot([], 320, 100, 46, 18)).toEqual({ x: 28, y: 6 });
  });
  it('slides past a row of text — into the gap in the middle of it', () => {
    const rows = [{ left: 6, top: 6, right: 60, bottom: 18 }, { left: 250, top: 6, right: 314, bottom: 18 }];
    const s = _wpFreeSpot(rows, 320, 100, 46, 18);
    expect(s.y).toBe(6);
    expect(s.x).toBeGreaterThanOrEqual(62);
    expect(s.x + 46).toBeLessThanOrEqual(248);
  });
  it('goes down to a clear strip when the top rows are full, and never overlaps any obstacle it was given', () => {
    const rows = [{ left: 4, top: 4, right: 316, bottom: 16 }, { left: 4, top: 17, right: 316, bottom: 30 }];
    const s = _wpFreeSpot(rows, 320, 100, 46, 18);
    expect(s).not.toBeNull();
    expect(s.y).toBeGreaterThanOrEqual(30);
    for (const o of rows) expect(hits(s, 46, 18, o)).toBe(false);
  });
  it('is not drawn at all (null) when there is no clear strip', () => {
    const full = []; for (let y = 0; y < 100; y += 10) full.push({ left: 0, top: y, right: 320, bottom: y + 10 });
    expect(_wpFreeSpot(full, 320, 100, 46, 18)).toBeNull();
    expect(p).toContain(".wp-name-proxy[data-nospot]{display:none !important}");
    expect(p).toContain("chip.setAttribute('data-nospot', '')");
  });
  it('finds its spot again while the pointer moves over the window (the mini\'s rows change)', () => {
    expect(p).toMatch(/placeTimer = setTimeout\(function \(\) \{ placeTimer = null; _wpPlaceNameChip\(\); \}, 150\)/);
  });
});

// ── per-character state ─────────────────────────────────────────────────────────────────────────────────
function loadChar() {
  return evalBlock(
    sliceBlock(main, 'const _MINI_KEYS = [', '\n') + '\n'
    + sliceBlock(main, 'const _FOLD_KEYS = [', '\n') + '\n'
    + sliceBlock(main, 'function _miniCapable(key) {', '\n') + '\n'
    + sliceBlock(main, 'const _CHAR_STATE_CAP = 40;', '\n  return changed;\n}'),
    ['_charStateKey', '_charStateNote', '_charMiniRestore', '_CHAR_STATE_CAP', '_MINI_KEYS', '_FOLD_KEYS', '_miniCapable']);
}
describe('per-character overlay state', () => {
  const C = loadChar();
  it('keys on the lower-cased letters-only name, like the per-character layout saves', () => {
    expect(C._charStateKey('Aldenmar')).toBe('aldenmar');
    expect(C._charStateKey('Brackwyn2')).toBeNull();
    expect(C._charStateKey('')).toBeNull();
    expect(C._charStateKey(null)).toBeNull();
  });
  it('a character\'s mini flags come back when they become active; keys they never set keep the global value', () => {
    const cfg = { overlayMini: { hud: true, who: false, tank: true }, overlayCharState: { corvale: { mini: { who: true, hud: false } } } };
    expect(C._charMiniRestore(cfg, 'corvale')).toBe(true);
    expect(cfg.overlayMini).toEqual({ hud: false, who: true, tank: true });
  });
  it('with no entry for them the global map stands, untouched', () => {
    const cfg = { overlayMini: { hud: true }, overlayCharState: { corvale: { mini: { who: true } } } };
    expect(C._charMiniRestore(cfg, 'brackwyn')).toBe(false);
    expect(C._charMiniRestore(cfg, null)).toBe(false);
    expect(cfg.overlayMini).toEqual({ hud: true });
  });
  it('only overlays that can minimize are restored (a stale or odd key is ignored)', () => {
    const cfg = { overlayMini: {}, overlayCharState: { corvale: { mini: { dock: true, canvas: true, 'chat:7': true, map: true } } } };
    C._charMiniRestore(cfg, 'corvale');
    expect(cfg.overlayMini).toEqual({ map: true });
  });
  it('records mini and last-shown per character, and caps the map at 40 characters, oldest dropped', () => {
    const cfg = {};
    for (let i = 0; i < 45; i++) C._charStateNote(cfg, 'toon' + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26)), 'used', 'map', 1000 + i, 1000 + i);
    const names = Object.keys(cfg.overlayCharState);
    expect(C._CHAR_STATE_CAP).toBe(40);
    expect(names).toHaveLength(40);
    expect(names).not.toContain('toonaa');             // the oldest five went
    expect(names).toContain('toonsb');                 // the newest stayed
    C._charStateNote(cfg, 'toonsb', 'mini', 'who', true, 5000);
    expect(cfg.overlayCharState.toonsb).toMatchObject({ mini: { who: true }, used: { map: 1044 }, at: 5000 });
  });
  it('refuses a field it does not own and a missing character', () => {
    const cfg = {};
    C._charStateNote(cfg, null, 'mini', 'who', true, 1);
    C._charStateNote(cfg, 'corvale', 'other', 'who', true, 1);
    expect(cfg).toEqual({});
  });
  it('the one writer (_setOverlayMini) records the flip against the active character', () => {
    const w = evalBlock(`
      ${sliceBlock(main, 'const _MINI_KEYS = [', '\n')}
      ${sliceBlock(main, 'const _FOLD_KEYS = [', '\n')}
      ${sliceBlock(main, 'function _miniCapable(key) {', '\n')}
      ${sliceBlock(main, 'const _CHAR_STATE_CAP = 40;', '\n  return changed;\n}')}
      let _activeCharName = 'Aldenmar';
      let CFG = {}; function loadConfig() { return JSON.parse(JSON.stringify(CFG)); } function saveConfig(x) { CFG = x; }
      let _miniAllActive = false, _miniAllPrev = null;
      function _overlayEntries() { return []; } function pushStatus() {} function _pingCanvasMini() {}
      function applyOverlayMini() {}
      function _miniSetting(cfg, k) { return !!((cfg || {}).overlayMini || {})[k]; }
      ${sliceBlock(main, 'function _setOverlayMini(key, next) {', '\n}')}
      const cfgNow = () => CFG; const setChar = (n) => { _activeCharName = n; };
    `, ['_setOverlayMini', 'cfgNow', 'setChar']);
    expect(w._setOverlayMini('who', true)).toBe(true);
    expect(w.cfgNow().overlayMini).toEqual({ who: true });
    expect(w.cfgNow().overlayCharState.aldenmar.mini).toEqual({ who: true });
    w.setChar(null);                                    // nobody known yet: the global flag still flips, nothing per-character
    w._setOverlayMini('map', true);
    expect(Object.keys(w.cfgNow().overlayCharState)).toEqual(['aldenmar']);
    expect(w.cfgNow().overlayMini).toEqual({ who: true, map: true });
  });
  it('is applied on the character change (same gate as the layout profile) and a shown overlay counts as used', () => {
    expect(sliceBlock(m, 'function _onActiveCharacter(name) {', '\n}\n')).toContain('_applyCharOverlayState(_charStateKey(cl))');
    expect(sliceBlock(m, "app.on('browser-window-created'", '\n});')).toContain('_noteOverlayShown(win)');
  });
});

// ── Minimize ALL still covers only the nine ─────────────────────────────────────────────────────────────
describe('the minimize-all hotkey', () => {
  it('_MINI_KEYS is still the nine designed minis, and the fold-only overlays are not among them', () => {
    const { _MINI_KEYS, _FOLD_KEYS } = loadChar();
    expect(_MINI_KEYS.slice().sort()).toEqual(['buffQueue', 'charm', 'chchain', 'exttarget', 'hud', 'mobinfo', 'pets', 'popraid', 'tank']);
    expect(_FOLD_KEYS.slice().sort()).toEqual(['chat', 'command', 'map', 'maptimers', 'me', 'melody', 'threat', 'trigger', 'who', 'zeal']);
    expect(_FOLD_KEYS.filter(k => _MINI_KEYS.includes(k))).toEqual([]);
    expect(_FOLD_KEYS).not.toContain('canvas');
    expect(_FOLD_KEYS).not.toContain('dock');
  });
  it('pressing it folds the nine and leaves the alerts window, and every other fold-only one, alone — twice', () => {
    const w = evalBlock(`
      ${sliceBlock(main, 'const _MINI_KEYS = [', '\n')}
      ${sliceBlock(main, 'const _FOLD_KEYS = [', '\n')}
      let CFG = { overlayMini: { trigger: false, who: true } }; function loadConfig() { return JSON.parse(JSON.stringify(CFG)); } function saveConfig(x) { CFG = x; }
      let _miniAllActive = false, _miniAllPrev = null;
      function _miniPinSetting() { return false; } function applyAllOverlayMini() {} function pushStatus() {}
      ${sliceBlock(main, 'function toggleMinimizeAllOverlays() {', '\n}\n')}
      const cfgNow = () => CFG;
    `, ['toggleMinimizeAllOverlays', 'cfgNow', '_MINI_KEYS']);
    w.toggleMinimizeAllOverlays();
    const on = w.cfgNow().overlayMini;
    for (const k of w._MINI_KEYS) expect(on[k], k).toBe(true);
    expect(on.trigger).toBe(false);
    expect(on.who).toBe(true);                          // its own choice, neither read nor written by the hotkey
    expect(Object.keys(on).sort()).toEqual([...w._MINI_KEYS, 'trigger', 'who'].sort());
    w.toggleMinimizeAllOverlays();
    expect(w.cfgNow().overlayMini.trigger).toBe(false);
    expect(w.cfgNow().overlayMini.who).toBe(true);
    for (const k of w._MINI_KEYS) expect(w.cfgNow().overlayMini[k], k).toBe(false);
  });
  it('the 📌 and its IPC stay the nine\'s alone', () => {
    expect(m).toMatch(/ipcMain\.handle\('wp-mini-pin-set', \(_e, name, on\) => \{\s*if \(!_MINI_KEYS\.includes\(name\)\) return null;/);
    expect(m).toMatch(/ipcMain\.handle\('wp-mini-pin-toggle'[\s\S]*?if \(!key \|\| !_MINI_KEYS\.includes\(key\)\) return false;/);
    expect(p).toMatch(/if \(st\.miniDesigned\) \{\s*menu\.appendChild\(mkItem\('📌/);
  });
});

// ── everything can minimize: the same path ──────────────────────────────────────────────────────────────
describe('every overlay folds through the one mini path', () => {
  it('the toggle, the state pull and the dashboard setter all accept a fold overlay; a fold overlay is "mini-capable" in the right-click menu', () => {
    expect(m).toMatch(/ipcMain\.handle\('wp-mini-toggle'[\s\S]*?if \(!_miniCapable\(key\)\) return false;\s*return _setOverlayMini\(/);
    expect(m).toMatch(/ipcMain\.handle\('wp-mini-set', \(_e, name, on\) => \{\s*if \(!_miniCapable\(name\)\) return null;/);
    expect(m).toContain('miniCapable: _miniCapable(key),');
    expect(m).toContain('miniCapable: _MINI_KEYS.concat(_FOLD_KEYS),');
  });
  it('the dashboard gives each fold overlay a working Mini switch, and no 📌', () => {
    const fold = new Function(dash.match(/var WP_FOLD_KEY_OF = (\{[\s\S]*?\});/)[0] + '\nreturn WP_FOLD_KEY_OF;')();
    const { _FOLD_KEYS } = loadChar();
    expect(Object.values(fold).sort()).toEqual(_FOLD_KEYS.slice().sort());
    const rows = [...dash.slice(dash.indexOf('var WP_OVERLAY_ROWS = ['), dash.indexOf('];', dash.indexOf('var WP_OVERLAY_ROWS = [')))
      .matchAll(/^\s+\['(\w+)',/gm)].map(x => x[1]);
    for (const k of Object.keys(fold)) expect(rows, k).toContain(k);
    expect(stripJs(dash)).toContain('var miniKey = WP_MINI_KEY_OF[key] || WP_FOLD_KEY_OF[key];');
  });
  it('every fold overlay\'s page marks a name to fold to (alerts and map via the chip)', () => {
    const page = { trigger: 'triggers', zeal: 'zealhealth', threat: 'threatmeter', maptimers: 'map' };
    const { _FOLD_KEYS } = loadChar();
    for (const k of _FOLD_KEYS) {
      const f = (page[k] || k) + '.html';
      expect(OVERLAY_PAGES, k).toContain(f);
    }
  });
  it('a folded window remembers the height it unfolds to, ignores the height floor, and gives the height back', () => {
    const { _foldWindow } = evalBlock(sliceBlock(main, 'function _foldWindow(win, on) {', '\n}\n'), ['_foldWindow']);
    let b = { x: 5, y: 5, width: 300, height: 400 }; let min = [200, 120];
    const win = {
      isDestroyed: () => false, getBounds: () => ({ ...b }), setBounds: (n) => { b = { ...n }; },
      getMinimumSize: () => min.slice(), setMinimumSize: (w, h) => { min = [w, h]; },
    };
    _foldWindow(win, true);
    expect(win.__wpFolded).toBe(true);
    expect(win.__wpFoldPrev).toEqual({ h: 400, minH: 120 });
    expect(min).toEqual([200, 24]);
    b.height = 30;                                      // the page fitted it to its row
    _foldWindow(win, true);                             // a repeat push (load pull + wp-mini push) changes nothing
    expect(win.__wpFoldPrev.h).toBe(400);
    _foldWindow(win, false);
    expect(win.__wpFolded).toBe(false);
    expect(b.height).toBe(400);
    expect(min).toEqual([200, 120]);
    _foldWindow(win, false);                            // nothing to undo
    expect(b.height).toBe(400);
    // …and the saved bounds of a window that is folded right now are the height it will unfold to
    expect(sliceBlock(m, 'function _applyBounds(cfg, key, win) {', '\n}\n')).toContain('if (win.__wpFolded && win.__wpFoldPrev) b.height = win.__wpFoldPrev.h;');
    expect(sliceBlock(m, "ipcMain.handle('overlay-auto-height'", '\n});')).toContain('if (!win.__wpFolded) wanted = Math.round(Math.max(wanted, _heightFloorFor(win)));');
  });
  it('the preload folds by hiding everything outside the title row but the corner controls, and asks for the row\'s height', () => {
    expect(p).toContain("'#move-btn,#hide-btn,#clear-btn,#drag-controls,#setupbar,#wpResizeMenu,");
    const fold = sliceBlock(p, 'function _wpFoldSync(fold) {', '\n}\n');
    expect(fold).toContain("s.classList.add('wp-fold-hide')");
    expect(fold).toContain('_overlayAutoHeightRaw(Math.max(32, Math.ceil(row.getBoundingClientRect().bottom) + 6))');
    expect(p).toContain('body.wp-fold .wp-fold-hide{display:none !important}');
    // main tells the page whether to fold or use the page's own designed mini
    expect(m).toContain("win.webContents.send('wp-mini', { key, mini: !!on, fold });");
  });
});
