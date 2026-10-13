// Two requests from the guild lead, 2026-10-13, both Mimic overlays.
//
// 1. The Map's respawn-timers list popped out: "Right clicking on the timers clickout should allow you to pop it out and
//    drag it around" (earlier the same night: "Same with timers, detachable and moveable across the screen and locked
//    into place"). The pop-out is map.html?part=timers - the Map's own page with only the list showing - in a window of
//    its own (key 'maptimers', cfg.showMapTimers). The Map hides its own list while it is out; the pop-out's ✕ puts it back.
// 2. Overlays should not cover other apps: "Other apps should be able to draw over the overlays automatically, unless
//    specifically set to stay on top." While neither EverQuest nor a Mimic window is the foreground application the
//    overlays drop to the normal level (tucked just above EverQuest's window) and come back on top with EQ; a per-overlay
//    "Stay on top" and a global cfg.overlaysFollowEq kill-switch opt out.
//
// map.html's script runs against a stub page (the way test/spawn-map.test.js does); main.js's pure parts are sliced out of
// the source and run as shipped, with the Electron windows faked. Text assertions strip comments first (CLAUDE.md,
// "comments satisfy text assertions"). Mutation-checked: see the note beside each group.
//
// Run: npx vitest run test/map-timers-popout-and-z-order.test.js

import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs, stripCss } from './_source-slice.js';

const MAP_HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));
const MAIN_RAW = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const MAIN = stripJs(MAIN_RAW);
const PRELOAD = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js')));
const SETTINGS = readSource(path.join(ROOT, 'apps', 'mimic', 'settings.html'));
const DASH = stripJs(readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html')));

const tick = () => new Promise(r => setImmediate(() => setImmediate(r)));
const T0 = Date.UTC(2026, 9, 13, 20, 0, 0);

// ───────────────────────────── 1. the pop-out (map.html) ─────────────────────────────

// Boots the page's script against a stub page, as test/spawn-map.test.js does. `search` is location.search; `drawn()` counts
// canvas clears (renderMap's first act), so "the pop-out draws no map" is a number, not a hope.
async function boot({ search = '', mimic, store = {} } = {}) {
  const script = MAP_HTML.slice(MAP_HTML.indexOf('<script>') + 8, MAP_HTML.lastIndexOf('</script>'));
  const all = {};
  let drawn = 0;
  const mkEl = (tag) => {
    const e = { tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {}, hidden: false, textContent: '', innerHTML: '', title: '',
      clientWidth: 600, clientHeight: 400, offsetWidth: 50, offsetHeight: 20,
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      appendChild(ch) { this.children.push(ch); return ch; }, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, getAttribute(k) { return this.attrs[k] ?? null; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 400 }; }, closest() { return null; },
      getContext() { return new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 5 }) : k === 'clearRect' ? () => { drawn++; } : () => {}), set: () => true }); },
    };
    Object.defineProperty(e, 'className', { get() { return this._cn || ''; }, set(v) { this._cn = v; } });
    return e;
  };
  const doc = {
    getElementById(id) { return all[id] || (all[id] = mkEl('#' + id)); },
    createElement: mkEl, addEventListener() {}, hidden: false,
    body: mkEl('body'), documentElement: { style: { setProperty() {} } },
  };
  const payload = {
    zone: 'thedeep', long_name: 'The Deep', version: 'thedeep@v', status: 'ok', now: T0, local_only: false,
    points: [{ id: 1, x: 100, y: 200, z: 0, respawn_s: 600, variance_s: 60, npcs: [] }],
    map: { bands: [0], segs: [[0, 0, 100, 0, 0]], bounds: { minX: 0, maxX: 100, minY: 0, maxY: 200 } },
    self: { x: 90, y: 190, z: 0, heading: 64, name: 'Aldenmar' }, group: [], raid: [], target: null, seen: [], unassigned: [],
    timers: [{ point_id: 1, name: 'a decaying skeleton', died_at: T0, earliest: T0 + 540000, latest: T0 + 660000, source: 'seen', state: 'wait' }],
  };
  const win = { addEventListener() {}, devicePixelRatio: 1, outerWidth: 1000, outerHeight: 500, mimic };
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  // eslint-disable-next-line no-new-func
  const S = new Function('window', 'document', 'location', 'fetch', 'localStorage', 'ResizeObserver', 'setInterval', 'clearInterval',
    script + '\nreturn S;')(win, doc, { search }, () => Promise.resolve({ json: () => Promise.resolve(payload) }), ls, undefined, () => 1, () => {});
  await tick();
  return { S, all, doc, drawn: () => drawn, store };
}
// The window.mimic bridge the Map needs for the pop-out, with the callbacks it registers captured.
function bridge({ popped = false } = {}) {
  const m = {
    mapTimersPop: vi.fn(), mapCentreOn: vi.fn(), overlaySetBounds: vi.fn(),
    getMapTimersPopped: () => Promise.resolve(popped),
    onMapTimersPopped: (cb) => { m.setPopped = cb; }, onMapCentre: (cb) => { m.centre = cb; },
  };
  return m;
}
const click = (el) => (el.listeners.click || []).forEach(f => f.call(el));
const trows = (all) => all.lists.children.filter(c => /trow/.test(c.className));

describe('the pop-out: map.html?part=timers is the Map\'s own page with only the list showing', () => {
  // Mutation check: delete `if (PART_TIMERS) return;` from renderMap and "draws no map" fails; delete the
  // `PART_TIMERS ? null : prepMap(...)` guard and "keeps no walls" fails.
  it('shows the same timer rows the Map does, through the same renderSide, and draws no map', async () => {
    const pop = await boot({ search: '?part=timers', mimic: bridge() });
    expect(pop.doc.body.classList.contains('part-timers')).toBe(true);
    expect(trows(pop.all)).toHaveLength(1);
    expect(trows(pop.all)[0].children[0].textContent).toBe('a decaying skeleton');
    expect(pop.all.zone.textContent).toBe('The Deep');
    expect(pop.drawn()).toBe(0);
    const map = await boot({ mimic: bridge() });
    expect(map.doc.body.classList.contains('part-timers')).toBe(false);
    expect(trows(map.all)).toHaveLength(1);
    expect(map.drawn()).toBeGreaterThan(0);
  });
  it('keeps no walls (it never draws them), so the zone payload costs it no wall prep', async () => {
    const pop = await boot({ search: '?part=timers', mimic: bridge() });
    expect(pop.S.prep).toBeNull();
    expect(pop.S.points).toHaveLength(1);   // the points are kept: the rows' click needs them
    const map = await boot({ mimic: bridge() });
    expect(map.S.prep).not.toBeNull();
  });
  it('a click on a row asks the Map to centre on that spawn point (it has no map of its own)', async () => {
    const m = bridge();
    const pop = await boot({ search: '?part=timers', mimic: m });
    click(trows(pop.all)[0]);
    expect(m.mapCentreOn).toHaveBeenCalledWith(1);
    // …whereas in the Map the same click centres its own view, and never calls out
    const m2 = bridge();
    const map = await boot({ mimic: m2 });
    click(trows(map.all)[0]);
    expect(m2.mapCentreOn).not.toHaveBeenCalled();
    expect(map.S.follow).toBe(false);
  });
  it('ignores the "popped" message: the pop-out is never itself popped', async () => {
    const m = bridge();
    const pop = await boot({ search: '?part=timers', mimic: m });
    m.setPopped(true);
    expect(pop.all.wrap.classList.contains('popped')).toBe(false);
    expect(m.overlaySetBounds).not.toHaveBeenCalled();
  });
  it('its stylesheet shows only the list: no map pane, no settings, and the list fills the window', () => {
    const css = stripCss(MAP_HTML);
    expect(css).toMatch(/body\.part-timers #mapPane, body\.part-timers #cfg\{display:none !important\}/);
    expect(css).toMatch(/body\.part-timers #side\{display:flex !important;flex:1 1 auto\}/);
  });
});

describe('the Map side: right-click Timers pops the list out, and it hides its own while it is out', () => {
  it('a message that the list is out hides it, relabels the button and (Widen window) gives the list\'s width back', async () => {
    const m = bridge();
    const map = await boot({ mimic: m });
    expect(map.all.wrap.classList.contains('popped')).toBe(false);
    m.setPopped(true);
    expect(map.all.wrap.classList.contains('popped')).toBe(true);
    expect(map.all.sideBtn.textContent).toBe('Timers ⧉');
    expect(m.overlaySetBounds).toHaveBeenLastCalledWith({ width: 1000 - 216, height: 500 });
    m.setPopped(false);
    expect(map.all.wrap.classList.contains('popped')).toBe(false);
    expect(map.all.sideBtn.textContent).toBe('Timers ▸');
    expect(m.overlaySetBounds).toHaveBeenLastCalledWith({ width: 1000 + 216, height: 500 });
  });
  it('the first pull at load sets the state WITHOUT resizing (the window was saved without the list)', async () => {
    const m = bridge({ popped: true });
    const map = await boot({ mimic: m });
    expect(map.all.wrap.classList.contains('popped')).toBe(true);
    expect(m.overlaySetBounds).not.toHaveBeenCalled();
  });
  it('right-click on the Timers button pops it out (and back); a plain click while it is out puts it back', async () => {
    const m = bridge();
    const map = await boot({ mimic: m });
    const ev = { preventDefault: vi.fn() };
    (map.all.sideBtn.listeners.contextmenu || []).forEach(f => f(ev));
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(m.mapTimersPop).toHaveBeenLastCalledWith(true);
    m.setPopped(true);
    const before = map.S.sideOpen;
    click(map.all.sideBtn);
    expect(m.mapTimersPop).toHaveBeenLastCalledWith(false);
    expect(map.S.sideOpen).toBe(before);                       // the slide state is untouched by the pop
    (map.all.sideBtn.listeners.contextmenu || []).forEach(f => f({ preventDefault() {} }));
    expect(m.mapTimersPop).toHaveBeenLastCalledWith(false);   // right-click while out is the same way back
  });
  it('a centre request from the pop-out moves the Map\'s view to that spawn point', async () => {
    const m = bridge();
    const map = await boot({ mimic: m });
    m.centre(1);
    expect(map.S.follow).toBe(false);
    expect(map.S.view.cx).toBe(-100);   // north-up frame: screen = -server
    expect(map.S.view.cy).toBe(-200);
    m.centre(999);                       // an id the Map does not know: nothing happens
    expect(map.S.view.cx).toBe(-100);
  });
});

describe('the pop-out as an overlay: the whole feature-parity checklist is wired', () => {
  // Mutation check: remove any one of these from main.js / the dashboard and its line fails.
  it('1. ✕ hides it and flips ITS flag (cfg.showMapTimers), which puts the list back in the Map', () => {
    const hide = sliceBlock(MAIN, "ipcMain.handle('hide-overlay'", 'return true;');
    expect(hide).toMatch(/win === mapTimersWindow\) \{\s*cfg\.showMapTimers = false; saveConfig\(cfg\);\s*try \{ mapTimersWindow\.hide\(\); \} catch \{\}/);
    expect(MAIN).toMatch(/function _syncMapTimersPopped\(force\)[\s\S]*mapWindow\.webContents\.send\('map-timers-popped', on\)/);
    expect(sliceBlock(MAIN, 'function pushStatus() {', '\n}\n')).toMatch(/_syncMapTimersPopped\(\)/);
  });
  it('2. ✥ move + right-click menu: it is a map.html overlay with the shared chrome, and its bounds persist', () => {
    expect(MAP_HTML).toMatch(/id="move-btn"/);
    expect(MAP_HTML).toMatch(/attachOverlayMenu\(moveBtn\)/);
    expect(sliceBlock(MAIN, 'function _boundsKeyForWindow(win) {', '\n}\n')).toMatch(/win === mapTimersWindow\) return 'mapTimersBounds'/);
    const create = sliceBlock(MAIN, 'function createMapTimersOverlay() {', '\nfunction applyMapTimersVisibility');
    expect(create).toMatch(/_persistBounds\('mapTimersBounds', mapTimersWindow\)/);
    expect(create).toMatch(/loadFile\('map\.html', \{ query: \{ part: 'timers' \} \}\)/);
    expect(create).toMatch(/skipTaskbar: true/);
    expect(create).toMatch(/webPreferences: _wpPrefs\('MapTimers'\)/);
  });
  it('3. hover-interact handshake: its rows and list carry data-wp-interact', () => {
    expect(MAP_HTML).toMatch(/id="lists" data-wp-interact/);
    expect(MAP_HTML).toMatch(/r\.setAttribute\('data-wp-interact', ''\)/);
    expect(MAP_HTML).toMatch(/mouseenter', function\(\)\{ try \{ window\.mimic\.overlayHoverInteractive\(true\)/);
  });
  it('4. dashboard row + status flag + toggle-overlay IPC case + hotkey slot', () => {
    expect(DASH).toMatch(/\['maptimers', 'Map timers \[beta\]'/);
    expect(DASH).toMatch(/maptimers: !!st\.showMapTimers/);
    expect(DASH).toMatch(/maptimers: 'showMapTimers'/);
    expect(DASH).toMatch(/maptimers: 'The Map\\'s respawn timers in a window of their own\.'/);
    expect(MAIN).toMatch(/showMapTimers: !!cfg\.showMapTimers/);
    expect(sliceBlock(MAIN, 'function _toggleOverlay(name) {', '\n}\n')).toMatch(/case 'maptimers':\s*cfg\.showMapTimers = !cfg\.showMapTimers; saveConfig\(cfg\);\s*if \(cfg\.showMapTimers && !mapTimersWindow\) createMapTimersOverlay\(\); else applyMapTimersVisibility\(\);/);
    expect(sliceBlock(MAIN, 'const _OVERLAY_HOTKEY_KEYS = [', '];')).toContain("'maptimers'");
  });
  it('4b. tray parity: the same switch is in the tray, and it drives the same writer as the Map\'s right-click', () => {
    expect(MAIN).toMatch(/Map timers list as its own window \[beta\]'[\s\S]*?_setMapTimersPopped\(mi\.checked\)/);
    expect(MAIN).toMatch(/ipcMain\.handle\('map-timers-pop', \(_e, on\) => _setMapTimersPopped\(!!on\)\)/);
  });
  it('5. apply*Visibility: unlocked override, hide-all, the EQ gate', () => {
    const apply = sliceBlock(MAIN, 'function applyMapTimersVisibility() {', '\n}\n');
    expect(apply).toMatch(/const unlocked  = setupMode \|\| cfg\.overlaysLocked === false;/);
    expect(apply).toMatch(/unlocked \|\| \(cfg\.showMapTimers && !cfg\.hideOverlays && _eqGateOk\(cfg\)\)/);
    expect(apply).toMatch(/if \(!_live\(mapTimersWindow\)\) return;/);
    expect(sliceBlock(MAIN, 'function applyAllVisibility() {', '\n}\n')).toMatch(/applyMapTimersVisibility\(\);/);
  });
  it('6. _HIDEALL_FLAGS, _overlayEntries(), the lifecycle table, the save-config creator, the opacity key', () => {
    expect(sliceBlock(MAIN, 'const _HIDEALL_FLAGS = [', '];')).toContain("'showMapTimers'");
    expect(sliceBlock(MAIN, 'function _overlayEntries() {', '\n}\n')).toMatch(/out\.push\(\['maptimers', mapTimersWindow\]\)/);
    expect(MAIN).toMatch(/\{ key: 'maptimers', flag: 'showMapTimers',\s+get: \(\) => mapTimersWindow, create: createMapTimersOverlay,\s+drop: \(\) => \{ mapTimersWindow = null; \} \}/);
    expect(MAIN).toMatch(/if \(merged\.showMapTimers\s+&& !mapTimersWindow\) createMapTimersOverlay\(\);/);
    expect(sliceBlock(MAIN, 'const _ALL_OVERLAY_KEYS = [', '];')).toContain("'maptimers'");
  });
  it('the three bridge channels have both ends', () => {
    for (const ch of ['map-timers-pop', 'map-timers-popped', 'map-centre']) {
      expect(PRELOAD, ch).toContain(`'${ch}'`);
      expect(MAIN, ch).toMatch(new RegExp(`ipc(Main)\\.(handle|on)\\('${ch}'`));
    }
  });
});

// ───────────────────────────── 2. overlays follow EverQuest's z-order ─────────────────────────────

const FOCUS_PURE = sliceBlock(MAIN_RAW, 'const FOCUS_LOST_DEBOUNCE_MS',
  'reset() { if (timer) { clearTimeout(timer); timer = null; } ok = true; },\n  };\n}\n');
const FOLLOW_PURE = sliceBlock(MAIN_RAW, 'function _overlaysFollowEqOn(cfg, platform) {', 'return !!focusOk;\n}\n');
const Z_APPLY = sliceBlock(MAIN_RAW, 'const _zApplied = new WeakMap();', "// Per-overlay \"Stay on top\".");

// A fake overlay window that records what was done to it.
function mkWin(name, { visible = true } = {}) {
  const w = { name, visible, destroyed: false, log: [],
    isVisible() { return this.visible; },
    setAlwaysOnTop(...a) { this.log.push(['aot', ...a]); },
    moveAbove(id) { this.log.push(['above', id]); } };
  return w;
}
// The shipped z-order code over fake windows. `h` carries the world; the returned functions run the real source.
function world({ platform = 'win32', cfg = {}, setup = false, single = [], eqPids = [100], geom = [{ pid: 100, hwnd: 7770, minimized: false }], wins } = {}) {
  const h = { platform, cfg, setup, single, eqPids: new Set(eqPids), geom, wins, calls: [] };
  const code = `
    ${FOCUS_PURE}
    ${FOLLOW_PURE}
    const process = { platform: h.platform };
    let setupMode = h.setup;
    const _eqPids = h.eqPids;
    let _eqGeom = { wins: h.geom };
    const _live = (w) => !!w && !w.destroyed;
    const loadConfig = () => h.cfg;
    const _overlayEntries = () => h.wins;
    const _inSingleSetup = (w) => h.single.includes(w.name);
    const _eqWindowGeometry = () => { h.calls.push('geometry'); return Promise.resolve([]); };
    ${Z_APPLY}
    const __setFocus = (v) => { _focusOk = v; };
    return { _overlayWantsTop, _overlaysFollowEqOn, _focusWatcherWanted, _applyOverlayZ, _eqHwndNow, __setFocus };
  `;
  // eslint-disable-next-line no-new-func
  const api = new Function('h', code)(h);
  return Object.assign(h, api);
}

describe('z-order: who should be on top', () => {
  // Mutation check: flip the `inSetup` line, the stayOnTop line or the kill-switch line in _overlayWantsTop and its row fails.
  const want = (cfg, o = {}) => {
    const w = world({ cfg });
    return w._overlayWantsTop(cfg, 'hud', o.platform || 'win32', !!o.setup, o.focusOk !== undefined ? o.focusOk : false);
  };
  it('EverQuest / Mimic in front: on top. Anything else in front: not', () => {
    expect(want({}, { focusOk: true })).toBe(true);
    expect(want({}, { focusOk: false })).toBe(false);
  });
  it('Stay on top keeps one overlay up whatever is in front; others still drop', () => {
    expect(want({ stayOnTop: { hud: true } })).toBe(true);
    expect(want({ stayOnTop: { charm: true } })).toBe(false);
    expect(want({ stayOnTop: { hud: false } })).toBe(false);
  });
  it('an overlay being placed (setup mode, unlocked, Setup THIS) stays on top', () => {
    expect(want({}, { setup: true })).toBe(true);
  });
  it('the global kill-switch (overlaysFollowEq: false) is today\'s behaviour: always on top', () => {
    expect(want({ overlaysFollowEq: false })).toBe(true);
  });
  it('other platforms keep today\'s behaviour: always on top', () => {
    expect(want({}, { platform: 'linux' })).toBe(true);
    expect(want({}, { platform: 'darwin' })).toBe(true);
  });
  it('default is ON for a config that never mentioned it, and the watcher is wanted for either feature', () => {
    const w = world({});
    expect(w._overlaysFollowEqOn({}, 'win32')).toBe(true);
    expect(w._overlaysFollowEqOn({ overlaysFollowEq: false }, 'win32')).toBe(false);
    expect(w._focusWatcherWanted({ overlaysFollowEq: false }, 'win32')).toBe(false);
    expect(w._focusWatcherWanted({ overlaysFollowEq: false, hideOverlaysWhenUnfocused: true }, 'win32')).toBe(true);
    expect(w._focusWatcherWanted({}, 'win32')).toBe(true);
    expect(w._focusWatcherWanted({}, 'linux')).toBe(false);
  });
  it('and the HIDING gate is untouched by it: following EQ alone never hides an overlay', () => {
    // _focusPass is still keyed on hideOverlaysWhenUnfocused alone
    const { _focusPass } = new Function(FOCUS_PURE + '\nreturn { _focusPass };')();
    expect(_focusPass({}, 'win32', false, false)).toBe(true);
    expect(_focusPass({ hideOverlaysWhenUnfocused: true }, 'win32', false, false)).toBe(false);
  });
});

describe('z-order: applying it to the windows', () => {
  // Mutation check: drop the isVisible() guard and "never touches a hidden overlay" fails; drop the moveAbove and
  // "tucks it above EverQuest" fails; make `have` default to false and "idempotent" fails.
  it('focus lost: a visible overlay drops to the normal level and is tucked directly above EverQuest\'s window', () => {
    const a = mkWin('hud'), b = mkWin('charm');
    const w = world({ wins: [['hud', a], ['charm', b]] });
    w.__setFocus(false);
    w._applyOverlayZ();
    expect(a.log).toEqual([['aot', false], ['above', 'window:7770:0']]);
    expect(b.log).toEqual([['aot', false], ['above', 'window:7770:0']]);
  });
  it('focus back: raised to the level main.js already uses', () => {
    const a = mkWin('hud');
    const w = world({ wins: [['hud', a]] });
    w.__setFocus(false); w._applyOverlayZ();
    a.log.length = 0;
    w.__setFocus(true); w._applyOverlayZ();
    expect(a.log).toEqual([['aot', true, 'screen-saver']]);
    expect(Z_APPLY).toMatch(/setAlwaysOnTop\(true, 'screen-saver'\)/);
  });
  it('is idempotent: a second pass with nothing changed touches nothing', () => {
    const a = mkWin('hud');
    const w = world({ wins: [['hud', a]] });
    w._applyOverlayZ();                   // focus is OK from the start: it was created on top, nothing to do
    expect(a.log).toEqual([]);
    w.__setFocus(false); w._applyOverlayZ(); a.log.length = 0;
    w._applyOverlayZ(); w._applyOverlayZ();
    expect(a.log).toEqual([]);
  });
  it('never touches a hidden overlay, and catches it when it is shown (its \'show\' event calls the same pass)', () => {
    const a = mkWin('hud', { visible: false });
    const w = world({ wins: [['hud', a]] });
    w.__setFocus(false); w._applyOverlayZ();
    expect(a.log).toEqual([]);
    a.visible = true;
    w._applyOverlayZ(a);                  // what the 'show' listener runs
    expect(a.log[0]).toEqual(['aot', false]);
    expect(MAIN).toMatch(/win\.on\('show', \(\) => \{ try \{ _applyOverlayZ\(win\); \}/);
  });
  it('a destroyed window is skipped, not driven', () => {
    const a = mkWin('hud'); a.destroyed = true;
    const w = world({ wins: [['hud', a]] });
    w.__setFocus(false); w._applyOverlayZ();
    expect(a.log).toEqual([]);
  });
  it('stay-on-top overlays, setup mode, unlocked overlays and "Setup THIS" windows are never dropped', () => {
    const keep = mkWin('hud'), drop = mkWin('charm');
    const w = world({ cfg: { stayOnTop: { hud: true } }, wins: [['hud', keep], ['charm', drop]] });
    w.__setFocus(false); w._applyOverlayZ();
    expect(keep.log).toEqual([]);
    expect(drop.log[0]).toEqual(['aot', false]);
    for (const extra of [{ setup: true }, { cfg: { overlaysLocked: false } }, { single: ['charm'] }]) {
      const c = mkWin('charm');
      const w2 = world(Object.assign({ wins: [['charm', c]] }, extra));
      w2.__setFocus(false); w2._applyOverlayZ();
      expect(c.log, JSON.stringify(extra)).toEqual([]);
    }
  });
  it('setting up an overlay raises one that had dropped; finishing lets it follow EverQuest again', () => {
    const c = mkWin('charm');
    const w = world({ wins: [['charm', c]] });
    w.__setFocus(false); w._applyOverlayZ(); c.log.length = 0;
    w.single.push('charm'); w._applyOverlayZ(c);
    expect(c.log).toEqual([['aot', true, 'screen-saver']]);
    c.log.length = 0; w.single.length = 0; w._applyOverlayZ(c);
    expect(c.log[0]).toEqual(['aot', false]);
  });
  it('turning the kill-switch on raises everything that had dropped', () => {
    const a = mkWin('hud');
    const w = world({ wins: [['hud', a]] });
    w.__setFocus(false); w._applyOverlayZ(); a.log.length = 0;
    w.cfg.overlaysFollowEq = false; w._applyOverlayZ();
    expect(a.log).toEqual([['aot', true, 'screen-saver']]);
  });
  it('not Windows: nothing is ever touched', () => {
    const a = mkWin('hud');
    const w = world({ platform: 'linux', wins: [['hud', a]] });
    w.__setFocus(false); w._applyOverlayZ();
    expect(a.log).toEqual([]);
  });
  it('EverQuest\'s window handle not read yet: drops anyway, asks for it once, and does not guess', () => {
    const a = mkWin('hud');
    const w = world({ geom: [], wins: [['hud', a]] });
    w.__setFocus(false); w._applyOverlayZ();
    expect(a.log).toEqual([['aot', false]]);
    expect(w.calls).toEqual(['geometry']);
  });
  it('a minimized EverQuest, or one that is not ours, is not a place to tuck under', () => {
    const w1 = world({ geom: [{ pid: 100, hwnd: 7770, minimized: true }], wins: [] });
    expect(w1._eqHwndNow()).toBeNull();
    const w2 = world({ geom: [{ pid: 999, hwnd: 55, minimized: false }], wins: [] });
    expect(w2._eqHwndNow()).toBeNull();
    const w3 = world({ geom: [{ pid: 100, hwnd: 7770, minimized: false }], eqPids: [], wins: [] });
    expect(w3._eqHwndNow()).toBe(7770);   // EQ pids unknown: take what the geometry read says
  });
  it('a window that cannot be moved above (handle gone) does not break the pass', () => {
    const a = mkWin('hud'); a.moveAbove = () => { throw new Error('bad window'); };
    const b = mkWin('charm');
    const w = world({ wins: [['hud', a], ['charm', b]] });
    w.__setFocus(false);
    expect(() => w._applyOverlayZ()).not.toThrow();
    expect(b.log[0]).toEqual(['aot', false]);
  });
});

describe('z-order: it rides the one focus watcher and every switch lands on the same internals', () => {
  it('the watcher runs for either feature (startup and the option-changed path), and stops only when neither is on', () => {
    expect(MAIN).toMatch(/on = _focusWatcherWanted\(loadConfig\(\), process\.platform\)/);
    expect(MAIN).toMatch(/if \(_focusWatcherWanted\(loadConfig\(\), process\.platform\)\) _startFocusWatcher\(\);/);
    expect(MAIN).not.toMatch(/if \(_focusGateOn\(loadConfig\(\), process\.platform\)\) _startFocusWatcher/);
  });
  it('the 600 ms debounced focus flip applies the z-order too (so alt-tab flicker never bounces the overlays)', () => {
    const flip = sliceBlock(MAIN, 'const _focusDeb = _makeFocusDebouncer(', 'FOCUS_LOST_DEBOUNCE_MS);');
    expect(flip).toMatch(/_applyOverlayZ\(\)/);
    // …and a whole visibility pass + tray rebuild only when the HIDING gate is on, not on every alt-tab
    expect(flip).toMatch(/if \(hides\) \{\s*try \{ applyAllVisibility\(\); \}/);
    expect(flip).toMatch(/\} else \{[\s\S]*?_applyOverlayZ\(\);/);
  });
  it('the watcher reads EverQuest\'s window handle as it starts, so the first drop can be tucked at once', () => {
    expect(sliceBlock(MAIN, 'function _startFocusWatcher() {', '\nfunction _stopFocusWatcher')).toMatch(/_overlaysFollowEqOn\(loadConfig\(\), process\.platform\)\) _eqWindowGeometry\(60 \* 1000\)/);
  });
  it('every state change that can move an overlay in or out of "being placed" re-applies it', () => {
    expect(sliceBlock(MAIN, 'function applyOverlayInteractivity() {', '\n}\n')).toMatch(/_applyOverlayZ\(\)/);
    expect(sliceBlock(MAIN, 'function applyAllVisibility() {', '\n}\n')).toMatch(/_applyOverlayZ\(\)/);
    expect(sliceBlock(MAIN, 'function _exitSingleSetup(win) {', '\n}\n')).toMatch(/_applyOverlayZ\(win\)/);
    expect(sliceBlock(MAIN, "ipcMain.handle('set-setup-mode-this'", 'return true;\n  } catch { return false; }')).toMatch(/_applyOverlayZ\(win\)/);
  });
  it('save-config re-evaluates the watcher and z-order when overlaysFollowEq or stayOnTop arrive', () => {
    const save = sliceBlock(MAIN, "ipcMain.handle('save-config'", '_onFocusGateOptionChanged();');
    expect(save).toMatch(/'overlaysFollowEq'/);
    expect(save).toMatch(/'stayOnTop'/);
    expect(sliceBlock(MAIN, 'function _onFocusGateOptionChanged() {', '\n}\n')).toMatch(/_applyOverlayZ\(\)/);
  });
  it('defaults: follow EverQuest ON, no overlay pinned', () => {
    expect(MAIN).toMatch(/overlaysFollowEq: true,\s*stayOnTop: \{\},/);
  });
  it('Stay on top has ONE writer; the right-click menu and the dashboard row both reach it', () => {
    const w = sliceBlock(MAIN, 'function _setStayOnTop(key, on) {', '\n}\n');
    expect(w).toMatch(/Object\.assign\(\{\}, cfg\.stayOnTop\)/);   // a copy, never the shared default
    expect(w).toMatch(/_applyOverlayZ\(\)/);
    expect(MAIN).toMatch(/ipcMain\.handle\('wp-stay-on-top-toggle'[\s\S]*?return _setStayOnTop\(key, !cur\);/);
    expect(MAIN).toMatch(/ipcMain\.handle\('wp-stay-on-top-set', \(_e, key, on\) => _setStayOnTop\(String\(key \|\| ''\), !!on\)\);/);
    expect(PRELOAD).toMatch(/setOverlayStayOnTop: \(key, on\) => ipcRenderer\.invoke\('wp-stay-on-top-set', key, !!on\)/);
    expect(PRELOAD).toMatch(/if \(st\.zFollows\) \{\s*menu\.appendChild\(mkItem\('🔝 Stay on top: ' \+ \(st\.stayOnTop \? 'ON' : 'off'\)[\s\S]*?'wp-stay-on-top-toggle'/);
  });
  it('the menu state and the status say whether it is live, so no switch is ever offered that does nothing', () => {
    expect(MAIN).toMatch(/zFollows: _overlaysFollowEqOn\(cfg, process\.platform\)/);
    expect(MAIN).toMatch(/zOrderFollows: _overlaysFollowEqOn\(cfg, process\.platform\)/);
    expect(DASH).toMatch(/tps\[ti\]\.hidden = !topLive;/);
  });
  it('the dashboard row key for the pet tracker is Mimic\'s (pets), not its own', () => {
    expect(DASH).toMatch(/data-ov="' \+ \(key === 'pet' \? 'pets' : key\) \+ '" hidden>🔝<\/button>/);
  });
  it('the global switch is in Settings (all four places), the tray and the dashboard - one setting, three doors', () => {
    expect((SETTINGS.match(/overlaysFollowEq/g) || []).length).toBeGreaterThanOrEqual(5);
    expect(SETTINGS).toMatch(/<input id="overlaysFollowEq" type="checkbox" \/>/);
    expect(MAIN).toMatch(/Other apps can draw over overlays when EverQuest isn\\'t focused'[\s\S]*?cfg\.overlaysFollowEq = !!mi\.checked; saveConfig\(cfg\);\s*_onFocusGateOptionChanged\(\);/);
    expect(DASH).toMatch(/saveConfig\(\{ overlaysFollowEq: !!fEq\.checked \}\)/);
  });
});

describe('EverQuest\'s window handle rides the geometry read', () => {
  const { _parseEqGeom } = new Function(sliceBlock(MAIN_RAW, 'function _parseEqGeom(text) {', '\n  return out;\n}') + '\nreturn { _parseEqGeom };')();
  it('reads the handle when the line has one, and parses an older line exactly as before', () => {
    const [a, b] = _parseEqGeom('EQWIN|4242|0|0|1936|1119|8|31|1920|1080|0|1313144\nEQWIN|77|0|0|10|10|0|0|10|10|1\n');
    expect(a.hwnd).toBe(1313144);
    expect('hwnd' in b).toBe(false);
  });
  it('the PowerShell prints it', () => {
    expect(MAIN).toContain('|$($h.ToInt64())"');
  });
});
