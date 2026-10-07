// test/canvas-group-hotkeys.test.js — a hotkey that shows or hides a saved Canvas group (Mimic 3.0 alpha).
//
// The guild lead, 2026-10-07: "we should be able to assign hotkeys to show or hide canvas groups as well."
//
// "A Canvas group" is a SAVED group (★ Groups → My groups). The pieces placed from it, or saved as it, are
// marked in the layout (`named`: the live group they share → the saved group's id); main.js binds one global
// shortcut per saved group (cfg.canvasGroupHotkeys, keyed by that id), queues each press, and the Canvas
// reads the queue and flips `off` on the group's pieces. Everything here runs the REAL functions sliced from
// main.js and canvas.html against fakes (no Electron, no DOM).
//
// Run: npx vitest run test/canvas-group-hotkeys.test.js
import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const mimic = (f) => path.join(ROOT, 'apps', 'mimic', f);
const mainRaw = readSource(mimic('main.js'));
const main = stripJs(mainRaw);
const canvasRaw = readSource(mimic('canvas.html'));
const canvas = stripJs(canvasRaw);
const preload = stripJs(readSource(mimic('preload.js')));
const sets = require(mimic('overlaySets.js'));

afterEach(() => { vi.useRealTimers(); });

// ── main.js ────────────────────────────────────────────────────────────────────────────────────────
// The registration, the press and the tray items: one contiguous block, run with the pieces of main.js it
// leans on replaced by fakes. canvasWindow is read, never assigned, by this block.
const groupBlock = sliceBlock(mainRaw, 'let _registeredGroupAccels = {};', '// ⌨ Setting a key that is already in use');
const fmtAccelSrc = sliceBlock(mainRaw, 'function _fmtAccel(accel) {', "'Ctrl'); }");
// The Canvas's own catalog of overlays (key → the switch that shows its window), as shipped.
const catalogSrc = sliceBlock(mainRaw, 'const _DOCK_CATALOG = [', 'function _canvasSpec(key) { return _CANVAS_CATALOG.find(c => c.key === key) || null; }');
// The IPC handlers that carry it, registered into a table so the test can call them.
const ipcBlock = sliceBlock(mainRaw, "ipcMain.handle('canvas-state', (e) => {", "ipcMain.handle('canvas-group-toggle', (_e, id) => _toggleCanvasGroup(String(id)));");
const cmdBlock = sliceBlock(mainRaw, "  if (cmd.verb === 'group') {", '\n  }\n');

function world(over = {}) {
  const w = {
    cfg: Object.assign({ showCanvas: true, canvasGroups: [{ id: 's1', name: 'Raid HUD', parts: [] }, { id: 's2', name: 'Tank', parts: [] }] }, over.cfg || {}),
    layout: over.layout || null,             // what the Canvas last saved for this screen
    log: [], overlayToggles: [], saved: [], pings: [], handlers: {}, regCalls: 0, trayBuilds: 0, pushes: 0,
    held: new Map(),                         // accelerator → callback: what the OS gave us
    taken: new Set(over.taken || []),        // "another app" owns these
    canvasWindow: over.noWindow ? null : { isDestroyed: () => false, webContents: { send: (ch) => w.pings.push(ch) } },
    senderWindow: null,
  };
  w.gs = {
    register(a, cb) { if (a === 'bad accel') throw new Error('malformed'); if (w.taken.has(a) || w.held.has(a)) return false; w.held.set(a, cb); return true; },
    unregister(a) { w.held.delete(a); },
  };
  const loadConfig = () => JSON.parse(JSON.stringify(w.cfg));
  const saveConfig = (c) => { w.cfg = JSON.parse(JSON.stringify(c)); w.saved.push(w.cfg); };
  const mod = new Function('appendAgentLog', 'loadConfig', 'saveConfig', '_toggleOverlay', '_live', 'canvasWindow', 'registerHideAllHotkey',
    'buildTrayMenu', 'pushStatus', 'ipcMain', 'BrowserWindow', '_canvasStatePayload', '_canvasOverlayList',
    fmtAccelSrc + '\n' + catalogSrc + '\n' + groupBlock + '\n' + ipcBlock
    + '\nreturn { _registerCanvasGroupHotkeys, _toggleCanvasGroup, _drainCanvasGroupOps, _canvasGroupTrayItems, _canvasGroupList, _canvasGroupKeys,'
    + ' _overlayHotkeyPress, get blocked() { return _blockedGroupAccels; }, get bound() { return _registeredGroupAccels; } };')(
    (s) => w.log.push(s), loadConfig, saveConfig,
    // _toggleOverlay flips the overlay's own switch, as the real one does (the pet tracker is 'pet' here, 'pets' in the Canvas).
    (name) => {
      w.overlayToggles.push(name);
      const flag = name === 'canvas' ? 'showCanvas' : ({ hud: 'showHud', pet: 'showPets', mobinfo: 'showMobInfo', me: 'showMe', trigger: 'enableTriggerTts' })[name];
      w.cfg[flag] = !w.cfg[flag];
    },
    (win) => !!(win && !win.isDestroyed()), w.canvasWindow,
    () => { w.regCalls++; if (over.rebind !== false) mod._registerCanvasGroupHotkeys(w.gs, loadConfig()); },
    () => { w.trayBuilds++; }, () => { w.pushes++; },
    { handle: (ch, fn) => { w.handlers[ch] = fn; } },
    { fromWebContents: () => w.senderWindow },
    () => ({ res: '1920x1080', layout: w.layout, edit: false, displays: 1 }), () => [{ key: 'me' }]);
  w.mod = mod;
  return w;
}

describe('main.js: one global key per saved Canvas group', () => {
  it('binds each configured group, and a press toggles THAT group', () => {
    const w = world();
    w.mod._registerCanvasGroupHotkeys(w.gs, { canvasGroups: w.cfg.canvasGroups, canvasGroupHotkeys: { s1: 'CommandOrControl+Alt+1', s2: 'CommandOrControl+Alt+2' } });
    expect(Object.keys(w.mod.bound).sort()).toEqual(['s1', 's2']);
    w.held.get('CommandOrControl+Alt+2')();
    expect(w.mod._drainCanvasGroupOps()).toEqual([{ id: 's2', show: false }]);
    expect(w.mod._drainCanvasGroupOps()).toEqual([]);           // read once, then gone
  });

  it('no key unless one was set — nothing is bound by default', () => {
    const w = world();
    w.mod._registerCanvasGroupHotkeys(w.gs, w.cfg);
    expect(w.held.size).toBe(0);
  });

  it('a key for a group that no longer exists is dropped with a log line, and out of the saved config', () => {
    const w = world({ cfg: { canvasGroupHotkeys: { s1: 'Alt+1', gone: 'Alt+2' } } });
    w.mod._registerCanvasGroupHotkeys(w.gs, JSON.parse(JSON.stringify(w.cfg)));
    expect([...w.held.keys()]).toEqual(['Alt+1']);
    expect(w.log.join('')).toMatch(/dropped the Canvas group hotkey for "gone"/);
    expect(w.cfg.canvasGroupHotkeys).toEqual({ s1: 'Alt+1' });
    expect(w.saved).toHaveLength(1);
    // nothing dropped → nothing written
    const q = world({ cfg: { canvasGroupHotkeys: { s1: 'Alt+1' } } });
    q.mod._registerCanvasGroupHotkeys(q.gs, JSON.parse(JSON.stringify(q.cfg)));
    expect(q.saved).toHaveLength(0);
  });

  it('a key another program holds, a malformed one, or one Mimic already holds is reported, never silently dead', () => {
    const w = world({ taken: ['CommandOrControl+Alt+T'] });
    w.held.set('Alt+9', () => {});                              // e.g. an overlay's key, bound first
    w.mod._registerCanvasGroupHotkeys(w.gs, { canvasGroups: w.cfg.canvasGroups, canvasGroupHotkeys: { s1: 'CommandOrControl+Alt+T', s2: 'Alt+9' } });
    expect(w.mod.blocked).toEqual({ s1: 'CommandOrControl+Alt+T', s2: 'Alt+9' });
    expect(w.mod.bound).toEqual({});
    expect(w.log.join('')).toMatch(/Canvas group hotkey "CommandOrControl\+Alt\+T" for "Raid HUD"/);
    const bad = world();
    bad.mod._registerCanvasGroupHotkeys(bad.gs, { canvasGroups: bad.cfg.canvasGroups, canvasGroupHotkeys: { s1: 'bad accel' } });
    expect(bad.mod.blocked).toEqual({ s1: 'bad accel' });
  });

  it('changing a key lets go of the old one', () => {
    const w = world();
    w.mod._registerCanvasGroupHotkeys(w.gs, { canvasGroups: w.cfg.canvasGroups, canvasGroupHotkeys: { s1: 'Alt+1' } });
    w.mod._registerCanvasGroupHotkeys(w.gs, { canvasGroups: w.cfg.canvasGroups, canvasGroupHotkeys: { s1: 'Alt+8' } });
    expect([...w.held.keys()]).toEqual(['Alt+8']);
  });

  it('is registered with the other hotkeys, after the overlay keys, and saving one re-binds live', () => {
    const body = sliceBlock(main, 'function registerHideAllHotkey() {', '\n}\n');
    expect(body).toMatch(/_registerOverlayHotkeys\(globalShortcut, cfg\);[\s\S]*_registerCanvasGroupHotkeys\(globalShortcut, cfg\);/);
    expect(main.match(/const HOTKEY_KEYS = \[([^\]]*)\]/)[1]).toContain("'canvasGroupHotkeys'");
  });
});

describe('main.js: the press', () => {
  it('Canvas up: it asks the Canvas to flip the group, and does not touch the Canvas switch', () => {
    const w = world();
    expect(w.mod._toggleCanvasGroup('s1')).toBe(true);
    expect(w.overlayToggles).toEqual([]);
    expect(w.pings).toEqual(['canvas-group-ops']);              // a window that is up reads it now
    expect(w.mod._drainCanvasGroupOps()).toEqual([{ id: 's1', show: false }]);
  });

  it('Canvas switched off: the press turns it on and the group is SHOWN, not toggled', () => {
    const w = world({ cfg: { showCanvas: false }, noWindow: true });
    w.mod._toggleCanvasGroup('s1');
    expect(w.overlayToggles).toEqual(['canvas']);
    expect(w.cfg.showCanvas).toBe(true);
    expect(w.mod._drainCanvasGroupOps()).toEqual([{ id: 's1', show: true }]);   // waits for the new window's first canvas-state
    expect(w.pings).toEqual([]);                                // no window yet to ping
  });

  it('a hide-all in force is not lifted by a group key (an overlay key does not either)', () => {
    const t = stripJs(sliceBlock(mainRaw, 'function _toggleCanvasGroup(id) {', '\n}\n'));
    expect(t).not.toMatch(/hideOverlays|_hideAll|toggleHideAllOverlays/);
    expect(t).toContain("_toggleOverlay('canvas')");
  });

  it('a group that is not saved (deleted, mistyped) does nothing but say so', () => {
    const w = world({ cfg: { showCanvas: false } });
    expect(w.mod._toggleCanvasGroup('nope')).toBe(false);
    expect(w.overlayToggles).toEqual([]);                       // an unknown key never switches the Canvas on
    expect(w.mod._drainCanvasGroupOps()).toEqual([]);
    expect(w.log.join('')).toMatch(/Canvas group "nope": no such saved group/);
  });

  it('presses made with no window to read them wait, in order, and are bounded', () => {
    const w = world({ noWindow: true });
    for (let i = 0; i < 45; i++) w.mod._toggleCanvasGroup(i % 2 ? 's1' : 's2');
    const ops = w.mod._drainCanvasGroupOps();
    expect(ops).toHaveLength(40);
    expect(ops[39]).toEqual({ id: 's2', show: false });         // 45th press (i = 44) is the last kept
  });
});

describe('main.js: an overlay\'s own key also shows / hides it on the Canvas', () => {
  // The guild lead, 2026-10-07: "if you're using an overlay as whole it should let you use that overlay's
  // same hide key combo." The key is the overlay's own (cfg.overlayHotkeys); nothing new is assigned.
  const asIs = (key, over = {}) => Object.assign({ id: 'o' + key + (over.style || ''), kind: 'overlay', key, style: '', off: false }, over);
  const layoutOf = (...panels) => ({ panels: [{ id: 'callouts', kind: 'callouts', off: false }, ...panels] });
  // What the Canvas does with a queued press, as far as main can see it: the saved layout follows.
  const canvasApplies = (w) => {
    for (const op of w.mod._drainCanvasGroupOps()) {
      if (op.overlay) for (const p of w.layout.panels) if (p.kind === 'overlay' && p.key === op.overlay) p.off = !op.show;
    }
  };

  it('the overlay is only on the Canvas: the key hides its panel, then shows it — and no window is opened for it', () => {
    const w = world({ layout: layoutOf(asIs('mobinfo')), cfg: { showMobInfo: true } });
    w.mod._overlayHotkeyPress('mobinfo');
    expect(w.overlayToggles).toEqual([]);                       // hosted: there is no window to toggle
    expect(w.pings).toEqual(['canvas-group-ops']);
    expect(w.mod._drainCanvasGroupOps()).toEqual([{ overlay: 'mobinfo', show: false }]);
    expect(w.cfg.showMobInfo).toBe(false);                      // the overlay's own switch follows the panel
    w.layout.panels[1].off = true;                              // the Canvas hid it and saved
    w.mod._overlayHotkeyPress('mobinfo');
    expect(w.mod._drainCanvasGroupOps()).toEqual([{ overlay: 'mobinfo', show: true }]);
    expect(w.cfg.showMobInfo).toBe(true);
    expect(w.overlayToggles).toEqual([]);
  });

  it('presses the Canvas has not read yet are counted: a second press undoes the first, and only the last state is kept', () => {
    const w = world({ layout: layoutOf(asIs('mobinfo')), cfg: { showMobInfo: true } });
    w.mod._overlayHotkeyPress('mobinfo');                       // hide
    w.mod._overlayHotkeyPress('mobinfo');                       // show again, before the Canvas looked
    expect(w.mod._drainCanvasGroupOps()).toEqual([{ overlay: 'mobinfo', show: true }]);
    expect(w.cfg.showMobInfo).toBe(true);
  });

  it('the overlay is a window AND a Canvas panel: one press moves both, and they stay in step', () => {
    // Canvas off: the window is what is seen; its panel waits, hidden or shown with it.
    const w = world({ layout: layoutOf(asIs('mobinfo')), cfg: { showCanvas: false, showMobInfo: true }, noWindow: true });
    w.mod._overlayHotkeyPress('mobinfo');
    expect(w.overlayToggles).toEqual(['mobinfo']);              // the window closes the way the dashboard's switch closes it
    expect(w.cfg.showMobInfo).toBe(false);
    expect(w.mod._drainCanvasGroupOps()).toEqual([{ overlay: 'mobinfo', show: false }]);   // the panel is hidden too, for when the Canvas is back
    const q = world({ layout: layoutOf(asIs('mobinfo')), cfg: { showCanvas: false, showMobInfo: true }, noWindow: true });
    q.mod._overlayHotkeyPress('mobinfo');
    q.mod._overlayHotkeyPress('mobinfo');
    expect(q.overlayToggles).toEqual(['mobinfo', 'mobinfo']);
    expect(q.cfg.showMobInfo).toBe(true);
    expect(q.mod._drainCanvasGroupOps()).toEqual([{ overlay: 'mobinfo', show: true }]);   // window shown ⇒ panel shown
  });

  it('a window and a panel that had drifted apart are brought together by the next press', () => {
    // Canvas on, panel shown, but the switch was off: the panel is what is seen, so the press hides it; the switch is already off.
    const a = world({ layout: layoutOf(asIs('mobinfo')), cfg: { showMobInfo: false } });
    a.mod._overlayHotkeyPress('mobinfo');
    expect(a.mod._drainCanvasGroupOps()).toEqual([{ overlay: 'mobinfo', show: false }]);
    expect(a.saved).toHaveLength(0);
    // panel hidden, switch off: the press shows the panel and the switch comes on with it
    const b = world({ layout: layoutOf(asIs('mobinfo', { off: true })), cfg: { showMobInfo: false } });
    b.mod._overlayHotkeyPress('mobinfo');
    expect(b.mod._drainCanvasGroupOps()).toEqual([{ overlay: 'mobinfo', show: true }]);
    expect(b.cfg.showMobInfo).toBe(true);
  });

  it('every look of the overlay moves together (the HUD is a ring and a box)', () => {
    const w = world({ layout: layoutOf(asIs('me', { style: 'hud' }), asIs('me', { style: 'a' }), asIs('mobinfo')), cfg: { showMe: true } });
    w.mod._overlayHotkeyPress('me');
    expect(w.mod._drainCanvasGroupOps()).toEqual([{ overlay: 'me', show: false }]);
    const c = world({ layout: layoutOf(asIs('me', { style: 'hud', off: true }), asIs('me', { style: 'a' })), cfg: { showMe: true } });
    c.mod._overlayHotkeyPress('me');                            // one look still shown ⇒ the overlay is shown ⇒ hide
    expect(c.mod._drainCanvasGroupOps()).toEqual([{ overlay: 'me', show: false }]);
  });

  it('the pet tracker is "pet" to the key and "pets" to the Canvas', () => {
    const w = world({ layout: layoutOf(asIs('pets')), cfg: { showPets: true } });
    w.mod._overlayHotkeyPress('pet');
    expect(w.mod._drainCanvasGroupOps()).toEqual([{ overlay: 'pets', show: false }]);
    expect(w.cfg.showPets).toBe(false);
    expect(w.overlayToggles).toEqual([]);
  });

  it('pieces taken apart from the overlay (or any piece) are NOT the overlay: its key is what it was', () => {
    const sect = { id: 's1', kind: 'sect', key: 'mobinfo', sect: 'hp', off: false };
    const part = { id: 'q1', kind: 'part', part: 'target.hp', grp: 'g1', off: false };
    const other = asIs('who');                                   // another overlay's panel does not count either
    const w = world({ layout: layoutOf(sect, part, other), cfg: { showMobInfo: true } });
    w.mod._overlayHotkeyPress('mobinfo');
    expect(w.overlayToggles).toEqual(['mobinfo']);              // the plain toggle, as before the Canvas existed
    expect(w.mod._drainCanvasGroupOps()).toEqual([]);           // nothing queued for the Canvas
    expect(w.pings).toEqual([]);
  });

  it('no Canvas panel, or an overlay with no Canvas page at all, is exactly the plain toggle', () => {
    for (const layout of [null, layoutOf()]) {
      const w = world({ layout });
      w.mod._overlayHotkeyPress('hud');
      expect(w.overlayToggles).toEqual(['hud']);
      expect(w.mod._drainCanvasGroupOps()).toEqual([]);
    }
    const t = world({ layout: layoutOf(asIs('trigger')) });     // the trigger overlay has no Canvas page: never an "as is" panel
    t.mod._overlayHotkeyPress('trigger');
    expect(t.overlayToggles).toEqual(['trigger']);
    expect(t.mod._drainCanvasGroupOps()).toEqual([]);
  });

  it('a press is kept in the layout like a group\'s: the Canvas applying it leaves the panel hidden for the next press to read', () => {
    const w = world({ layout: layoutOf(asIs('mobinfo')), cfg: { showMobInfo: true } });
    w.mod._overlayHotkeyPress('mobinfo');
    canvasApplies(w);
    expect(w.layout.panels[1].off).toBe(true);
    w.mod._overlayHotkeyPress('mobinfo');
    canvasApplies(w);
    expect(w.layout.panels[1].off).toBe(false);
  });

  it('the registered key reaches it, and it assigns and binds nothing of its own — the overlay keeps the one key it has', () => {
    const reg = stripJs(sliceBlock(mainRaw, 'function _registerOverlayHotkeys(globalShortcut, cfg) {', '\n}\n'));
    expect(reg).toContain('_overlayHotkeyPress(key);');
    expect(reg).not.toMatch(/_toggleOverlay\(/);
    const press = stripJs(sliceBlock(mainRaw, 'function _overlayHotkeyPress(key) {', '\n}\n'));
    expect(press).not.toMatch(/globalShortcut|overlayHotkeys|_mimicHotkeyUses/);
    // the dashboard's ON/OFF button is still the plain toggle
    expect(main).toContain("ipcMain.handle('toggle-overlay', (_e, name) => _toggleOverlay(name));");
  });
});

describe('main.js: the IPC the Canvas uses', () => {
  const canvasSender = (w) => { w.senderWindow = w.canvasWindow; return {}; };

  it('canvas-state hands the Canvas its queued presses once, with each group\'s key; nobody else drains them', () => {
    const w = world({ cfg: { canvasGroupHotkeys: { s1: 'Alt+1', gone: 'Alt+2' } } });
    w.mod._registerCanvasGroupHotkeys(w.gs, { canvasGroups: w.cfg.canvasGroups, canvasGroupHotkeys: { s1: 'Alt+1' } });
    w.mod._toggleCanvasGroup('s1');
    w.senderWindow = { other: true };
    expect(w.handlers['canvas-state']({}).groupOps).toEqual([]);
    const st = w.handlers['canvas-state'](canvasSender(w));
    expect(st.groupOps).toEqual([{ id: 's1', show: false }]);
    expect(st.groupKeys).toEqual({ s1: 'Alt+1' });              // a key for a missing group is not shown
    expect(st.groupKeysBlocked).toEqual({});
    expect(w.handlers['canvas-state'](canvasSender(w)).groupOps).toEqual([]);
    expect(st).toMatchObject({ res: '1920x1080', overlays: [{ key: 'me' }] });
  });

  it('canvas-group-hotkey sets and clears a key by the group\'s id, re-binds, and answers with every key', () => {
    const w = world({ cfg: { canvasGroupHotkeys: { s2: 'Alt+2' } } });
    const r = w.handlers['canvas-group-hotkey']({}, 's1', ' CommandOrControl+Alt+1 ');
    expect(r).toEqual({ ok: true, keys: { s1: 'CommandOrControl+Alt+1', s2: 'Alt+2' }, blocked: {} });
    expect(w.cfg.canvasGroupHotkeys).toEqual({ s1: 'CommandOrControl+Alt+1', s2: 'Alt+2' });
    expect(w.regCalls).toBe(1);
    expect(w.held.has('CommandOrControl+Alt+1')).toBe(true);
    expect(w.trayBuilds).toBe(1);                               // the tray lists the key
    const c = w.handlers['canvas-group-hotkey']({}, 's1', '');
    expect(c).toMatchObject({ ok: true, keys: { s2: 'Alt+2' } });
    expect(w.cfg.canvasGroupHotkeys).toEqual({ s2: 'Alt+2' });
    expect(w.held.has('CommandOrControl+Alt+1')).toBe(false);
  });

  it('…reports a key the OS refused, and refuses an id or a key that is not one', () => {
    const w = world({ taken: ['Alt+1'] });
    const r = w.handlers['canvas-group-hotkey']({}, 's1', 'Alt+1');
    expect(r.ok).toBe(true);
    expect(r.blocked).toEqual({ s1: 'Alt+1' });
    const before = JSON.stringify(w.cfg);
    expect(w.handlers['canvas-group-hotkey']({}, 'nope', 'Alt+3')).toMatchObject({ ok: false });
    expect(w.handlers['canvas-group-hotkey']({}, 's2', 'Alt + 3')).toMatchObject({ ok: false });
    expect(w.handlers['canvas-group-hotkey']({}, 's2', 'x'.repeat(41))).toMatchObject({ ok: false });
    expect(w.handlers['canvas-group-hotkey']({}, 's2', 'Alt+3\n')).toMatchObject({ ok: true });   // trimmed, then fine
    expect(JSON.stringify(w.cfg)).not.toBe(before);
    expect(w.cfg.canvasGroupHotkeys).toEqual({ s1: 'Alt+1', s2: 'Alt+3' });
  });

  it('saving the groups re-binds when keys exist (a deleted group\'s key goes) and refreshes the tray', () => {
    const w = world({ cfg: { canvasGroupHotkeys: { s1: 'Alt+1' } } });
    w.mod._registerCanvasGroupHotkeys(w.gs, w.cfg);
    w.senderWindow = w.canvasWindow;
    expect(w.handlers['canvas-groups-save']({}, [{ id: 's2', name: 'Tank', parts: [] }])).toBe(true);
    expect(w.regCalls).toBe(1);
    expect(w.held.size).toBe(0);                                // s1 is gone, so is its key
    expect(w.cfg.canvasGroupHotkeys).toEqual({});
    expect(w.log.join('')).toMatch(/dropped the Canvas group hotkey for "s1"/);
    expect(w.trayBuilds).toBe(1);
    // no keys at all → nothing to re-bind
    const q = world();
    q.senderWindow = q.canvasWindow;
    q.handlers['canvas-groups-save']({}, []);
    expect(q.regCalls).toBe(0);
    expect(q.trayBuilds).toBe(1);
  });

  it('canvas-group-toggle is the key\'s own press, for any UI that lists the groups', () => {
    const w = world();
    expect(w.handlers['canvas-group-toggle']({}, 's2')).toBe(true);
    expect(w.mod._drainCanvasGroupOps()).toEqual([{ id: 's2', show: false }]);
  });

  it('the Canvas reaches all of it through the preload', () => {
    expect(preload).toContain("canvasGroupHotkey: (id, accel) => ipcRenderer.invoke('canvas-group-hotkey', id, accel || ''),");
    expect(preload).toContain("toggleCanvasGroup: (id)     => ipcRenderer.invoke('canvas-group-toggle', id),");
    expect(preload).toContain("onCanvasGroupOps:  (cb)     => ipcRenderer.on('canvas-group-ops', () => cb()),");
  });
});

describe('main.js: one conflict check for every hotkey', () => {
  const uses = (cfg) => new Function(
    "const _DEFAULT_HIDE_HOTKEY = 'CommandOrControl+Shift+H', _DEFAULT_BACKDROP_HOTKEY = 'CommandOrControl+Shift+B', _DEFAULT_DAMAGE_HOTKEY = 'CommandOrControl+Shift+D', _DEFAULT_MINI_HOTKEY = 'CommandOrControl+Shift+M';\n"
    + mainRaw.match(/const _OVERLAY_HOTKEY_KEYS = \[[\s\S]*?\];/)[0] + '\n'
    + sliceBlock(mainRaw, 'function _mimicHotkeyUses(cfg) {', '\n}\n') + '\nreturn _mimicHotkeyUses;')()(cfg);

  it('the capture list carries each saved group\'s key, named by its group, beside the overlay and all-overlay keys', () => {
    const r = uses({ overlayHotkeys: { tank: 'Alt+T' }, canvasGroups: [{ id: 's1', name: 'Raid HUD' }, { id: 's2', name: 'Tank' }],
      canvasGroupHotkeys: { s1: ' Alt+1 ', s2: '', gone: 'Alt+3' } });
    expect(r.filter(u => /^(overlay|canvasGroup):/.test(u.id))).toEqual([
      { id: 'overlay:tank', accel: 'Alt+T' },
      { id: 'canvasGroup:s1', accel: 'Alt+1', label: 'the “Raid HUD” Canvas group’s key' },
    ]);
    expect(r.map(u => u.id)).toContain('hideAllHotkey');
  });
  it('no group, no entry', () => {
    expect(uses({}).some(u => /canvasGroup/.test(u.id))).toBe(false);
  });
});

describe('main.js: the tray lists the groups under the Canvas entry', () => {
  const s = (over) => Object.assign({ hideOverlays: false, canvasGroups: [{ id: 's1', name: 'Raid & HUD' }, { id: 's2', name: 'Tank' }, { id: 's3', name: 'Pet' }],
    canvasGroupHotkeys: { s1: 'CommandOrControl+Alt+1', s3: 'Alt+3' }, canvasGroupHotkeysBlocked: { s3: 'Alt+3' } }, over);

  it('one submenu, a line per group with its key (or "no hotkey", or that another app holds it), each driving the same toggle', () => {
    const w = world();
    const items = w.mod._canvasGroupTrayItems(s());
    expect(items).toHaveLength(1);
    expect(items[0].submenu.map(i => i.label)).toEqual([
      'Raid && HUD (Ctrl+Alt+1)', 'Tank (no hotkey)', 'Pet (⚠ Alt+3 blocked by another app)']);
    items[0].submenu[1].click();
    expect(w.mod._drainCanvasGroupOps()).toEqual([{ id: 's2', show: false }]);
  });
  it('nothing to list, no entry; and it greys out with everything else while overlays are hidden', () => {
    const w = world();
    expect(w.mod._canvasGroupTrayItems(s({ canvasGroups: [] }))).toEqual([]);
    expect(w.mod._canvasGroupTrayItems(s({ hideOverlays: true }))[0].enabled).toBe(false);
    expect(w.mod._canvasGroupTrayItems(s())[0].enabled).toBe(true);
  });
  it('sits right under the "Arrange the canvas" item, and the status carries what the list needs', () => {
    expect(main).toMatch(/_setCanvasArrange\(!_canvasArrange\);\s*\} \},\s*\.\.\._canvasGroupTrayItems\(s\),\s*\{ type: 'separator' \}/);
    expect(main).toContain('canvasGroups: _canvasGroupList(cfg),');
    expect(main).toContain('canvasGroupHotkeys: _canvasGroupKeys(cfg),');
    expect(main).toContain('canvasGroupHotkeysBlocked: Object.assign({}, _blockedGroupAccels),');
  });
});

describe('/pipe mimic group <name>', () => {
  it('is read as a verb with a name, and only with a name', () => {
    expect(sets.parsePipeCommand('mimic group Raid HUD')).toEqual({ verb: 'group', name: 'Raid HUD' });
    expect(sets.parsePipeCommand('Mimic GROUP  tank ')).toEqual({ verb: 'group', name: 'tank' });
    expect(sets.parsePipeCommand('mimic group')).toBeNull();
  });
  it('runs the same toggle as the key, by name (any case); an unknown name is said, not guessed', () => {
    const run = (cmd, groups) => {
      const out = { toggled: [], said: [] };
      const f = new Function('cmd', '_canvasGroupList', 'loadConfig', '_toggleCanvasGroup', '_setsSay', 'quiet',
        'return (function () {\n' + cmdBlock + '\nreturn null;\n})();');
      out.r = f(cmd, () => groups, () => ({}), (id) => out.toggled.push(id), (r) => { out.said.push(r.message); return r; }, true);
      return out;
    };
    const groups = [{ id: 's1', name: 'Raid HUD' }, { id: 's2', name: 'Tank' }];
    const a = run({ verb: 'group', name: 'raid hud' }, groups);
    expect(a.toggled).toEqual(['s1']);
    expect(a.r).toMatchObject({ ok: true, message: 'Canvas group: Raid HUD' });
    const b = run({ verb: 'group', name: 'nope' }, groups);
    expect(b.toggled).toEqual([]);
    expect(b.r).toMatchObject({ ok: false, message: 'No Canvas group called "nope"' });
  });
});

// ── canvas.html ────────────────────────────────────────────────────────────────────────────────────
const rules = sliceBlock(canvasRaw, '  var GROUPS = [', '  // ── Panels ──');
function sanitizeFn() {
  // eslint-disable-next-line no-new-func
  return new Function('var window = {};\n' + rules + '\nreturn { sanitize };')().sanitize;
}

describe('canvas.html: which pieces are which saved group', () => {
  it('a layout keeps the marks for live groups that still have pieces, and nothing else', () => {
    const s = sanitizeFn()({ panels: [
      { id: 'a', kind: 'part', part: 'me.hp', mode: 'ring', x: 0.1, y: 0.2, w: 96, h: 96, grp: 'g1' },
      { id: 'b', kind: 'part', part: 'me.mana', mode: 'ring', x: 0.1, y: 0.3, w: 96, h: 96, grp: 'g1' },
      { id: 'c', kind: 'part', part: 'me.hp', mode: 'bar', x: 0.5, y: 0.5, w: 96, h: 20, grp: 'g2' },
    ], named: { g1: 's1', g2: 7, g3: 's3', g4: '' } });
    expect(s.named).toEqual({ g1: 's1' });          // g2 not a string, g3/g4 have no pieces here or no id
  });
  it('a layout with none has no `named` at all (the saved shape is unchanged)', () => {
    const f = sanitizeFn();
    expect(f({ panels: [{ id: 'a', kind: 'part', part: 'me.hp', mode: 'ring', x: 0, y: 0, w: 96, h: 96, grp: 'g1' }] }).named).toBeUndefined();
    expect(f({ panels: [], named: { g1: 's1' } }).named).toBeUndefined();
    expect('named' in f({ panels: [], named: 'nope' })).toBe(false);
  });
  it('saving a selection as a group marks its pieces as that saved group; placing one does the same', () => {
    const W = { innerWidth: 1000, innerHeight: 1000 };
    const mk = () => {
      const saves = [];
      const env = new Function('window', 'M', 'save', 'render', 'savedById', 'presetById', 'embedSize', 'dropEmbed', 'ovEntry', 'addOverlay', 'refresh', 'sectPanel', 'WpParts',
        'var MAX_PANELS = 150, _cascade = 0, _fitAdd = {}, _layout = { panels: [] }, _groups = [], _sel = {};\n'
        + 'function num(v, lo, hi, d) { v = Number(v); return (isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d); }\n'
        + sliceBlock(canvasRaw, '  function newId(prefix)', '  function dropThing(what, X, Y) {').replace(/  function dropThing\(what, X, Y\) \{$/, '')
        + sliceBlock(canvasRaw, '  function dropThing(what, X, Y) {', '\n  }\n')
        + '\n' + sliceBlock(canvasRaw, '  function saveSelectionAsGroup(name) {', '\n  }\n')
        + '\nreturn { dropThing, saveSelectionAsGroup, _layout, get groups() { return _groups; }, sel(ids) { _sel = {}; ids.forEach(function (i) { _sel[i] = true; }); } };');
      globalThis.window = globalThis;
      require(mimic('parts.js'));
      const WpParts = globalThis.WpParts;
      let r;
      r = env(W, { canvasGroupsSave() {} }, () => saves.push(1), () => {}, (id) => r.groups.find(g => g.id === id) || null, () => null, () => [100, 100], () => {}, () => null, () => null, () => {}, () => null, WpParts);
      return r;
    };
    const r = mk();
    // two pieces on the screen, selected, saved
    r._layout.panels.push({ id: 'p1', kind: 'part', part: 'me.hp', mode: 'bar', x: 0.1, y: 0.1, w: 200, h: 30, scale: 1, grp: null },
      { id: 'p2', kind: 'part', part: 'me.mana', mode: 'bar', x: 0.1, y: 0.2, w: 200, h: 30, scale: 1, grp: null });
    r.sel(['p1', 'p2']);
    r.saveSelectionAsGroup('Raid HUD');
    const saved = r.groups[0];
    expect(saved.name).toBe('Raid HUD');
    const live = r._layout.panels[0].grp;
    expect(live).toMatch(/^g/);
    expect(r._layout.named).toEqual({ [live]: saved.id });
    // dropping the saved group again: a second live group, marked as the same saved group
    r.dropThing('group:' + saved.id, 600, 600);
    const dropped = r._layout.panels.filter(p => p.id !== 'p1' && p.id !== 'p2');
    expect(dropped).toHaveLength(2);
    const live2 = dropped[0].grp;
    expect(live2).not.toBe(live);
    expect(r._layout.named).toEqual({ [live]: saved.id, [live2]: saved.id });
    // a preset (not a saved group) is not marked
    r.dropThing('preset:nonesuch', 10, 10);
    expect(Object.keys(r._layout.named)).toHaveLength(2);
  });
});

// The show / hide itself, on the real functions.
const toggleBlock = sliceBlock(canvasRaw, '  var _gkeys = {}, _gblocked = {};', "  // The key capture, the dashboard's");
function groupEnv(panels, named, groups = [{ id: 's1', name: 'Raid HUD' }, { id: 's2', name: 'Tank' }]) {
  const calls = { save: 0, render: 0, notes: [] };
  const layout = { panels, named };
  const f = new Function('_layout', 'save', 'render', 'note', 'savedById',
    toggleBlock + '\nreturn { groupPanels, groupHiddenText, toggleSavedGroup, applyGroupOps, forgetSavedGroup, namedGroup, setOverlayPanels, get gkeys() { return _gkeys; }, seed(k, b) { _gkeys = k; _gblocked = b; } };');
  const r = f(layout, () => { calls.save++; }, () => { calls.render++; }, (m, ms) => { calls.notes.push([m, ms]); }, (id) => groups.find(g => g.id === id) || null);
  return Object.assign(r, { layout, calls });
}
const piece = (id, grp, off = false, x = 0.2, y = 0.2) => ({ id, kind: 'part', part: 'me.hp', mode: 'bar', grp, off, x, y, w: 100, h: 20 });

describe('canvas.html: hiding and showing a saved group', () => {
  it('a press hides every piece of the group, keeps where they are, and saves it; the next press shows them', () => {
    const e = groupEnv([piece('a', 'g1', false, 0.1, 0.2), piece('b', 'g1', false, 0.3, 0.4), piece('z', 'g9'), piece('y', null)], { g1: 's1', g9: 's2' });
    expect(e.toggleSavedGroup('s1')).toBe('hidden');
    expect(e.layout.panels.map(p => [p.id, p.off])).toEqual([['a', true], ['b', true], ['z', false], ['y', false]]);
    expect(e.layout.panels.slice(0, 2).map(p => [p.x, p.y])).toEqual([[0.1, 0.2], [0.3, 0.4]]);   // the layout is kept
    expect(e.calls.save).toBe(1);
    expect(e.calls.render).toBe(1);
    expect(e.toggleSavedGroup('s1')).toBe('shown');
    expect(e.layout.panels.map(p => p.off)).toEqual([false, false, false, false]);
  });
  it('a mixed group (one piece hidden by hand) hides on the first press, then shows all', () => {
    const e = groupEnv([piece('a', 'g1', true), piece('b', 'g1', false)], { g1: 's1' });
    expect(e.toggleSavedGroup('s1')).toBe('hidden');
    expect(e.layout.panels.map(p => p.off)).toEqual([true, true]);
    expect(e.toggleSavedGroup('s1')).toBe('shown');
  });
  it('"show" (the press that switched the Canvas on) shows a hidden group and keeps a shown one shown', () => {
    const e = groupEnv([piece('a', 'g1', true), piece('b', 'g1', true)], { g1: 's1' });
    expect(e.toggleSavedGroup('s1', 'show')).toBe('shown');
    expect(e.toggleSavedGroup('s1', 'show')).toBe('shown');
    expect(e.layout.panels.map(p => p.off)).toEqual([false, false]);
  });
  it('the same saved group placed twice is one key: both copies flip together', () => {
    const e = groupEnv([piece('a', 'g1'), piece('b', 'g2'), piece('c', 'g3')], { g1: 's1', g2: 's1', g3: 's2' });
    e.toggleSavedGroup('s1');
    expect(e.layout.panels.map(p => p.off)).toEqual([true, true, false]);
  });
  it('a group with no pieces on this screen is left alone and says so — by name', () => {
    const e = groupEnv([piece('a', 'g1')], { g1: 's1' });
    expect(e.toggleSavedGroup('s2')).toBeNull();
    expect(e.calls.save).toBe(0);
    e.applyGroupOps([{ id: 's2', show: false }]);
    expect(e.calls.notes).toHaveLength(1);
    expect(e.calls.notes[0][0]).toMatch(/^“Tank” is not on this screen’s canvas/);
  });
  it('queued presses apply oldest first: two presses cancel out, and "show" wins over a hidden group', () => {
    const e = groupEnv([piece('a', 'g1')], { g1: 's1' });
    e.applyGroupOps([{ id: 's1', show: false }, { id: 's1', show: false }]);
    expect(e.layout.panels[0].off).toBe(false);
    e.applyGroupOps([{ id: 's1', show: false }]);
    expect(e.layout.panels[0].off).toBe(true);
    e.applyGroupOps([{ id: 's1', show: true }]);
    expect(e.layout.panels[0].off).toBe(false);
    e.applyGroupOps([null, { id: 7 }, 'x']);                    // junk from outside is ignored
    expect(e.calls.notes).toEqual([]);
  });
  it('the chooser says "hidden" beside a group whose pieces are all hidden', () => {
    const e = groupEnv([piece('a', 'g1', true), piece('b', 'g1', true)], { g1: 's1' });
    expect(e.groupHiddenText('s1')).toBe(' · hidden');
    e.layout.panels[1].off = false;
    expect(e.groupHiddenText('s1')).toBe('');
    expect(e.groupHiddenText('s2')).toBe('');
  });
  it('deleting a saved group unmarks its pieces (they stay, locked together) and forgets its key', () => {
    const e = groupEnv([piece('a', 'g1'), piece('b', 'g2')], { g1: 's1', g2: 's2' });
    e.seed({ s1: 'Alt+1', s2: 'Alt+2' }, { s1: 'Alt+1' });
    e.forgetSavedGroup('s1');
    expect(e.layout.named).toEqual({ g2: 's2' });
    expect(e.layout.panels.map(p => p.grp)).toEqual(['g1', 'g2']);
    expect(e.gkeys).toEqual({ s2: 'Alt+2' });
    expect(e.calls.save).toBe(1);
  });
  it('a hidden piece is not drawn and not a click target: it is the panel hide that already exists', () => {
    expect(canvas).toMatch(/e\.root\.classList\.toggle\('off', !!p\.off\);/);
    expect(stripCssLines(canvasRaw)).toMatch(/\.panel\.off\{visibility:hidden\}/);
  });
});
function stripCssLines(s) { return s.replace(/\/\*[\s\S]*?\*\//g, ''); }

describe('canvas.html: an overlay\'s own key hides and shows its "as is" panels, and only those', () => {
  const ov = (id, key, off = false, style = '') => ({ id, kind: 'overlay', key, style, off, x: 0.3, y: 0.3, w: 320, h: 240 });
  const sect = (id, key, off = false, grp = null) => ({ id, kind: 'sect', key, sect: 'hp', grp, off, x: 0.5, y: 0.5, w: 100, h: 20 });
  const mk = () => groupEnv([
    ov('me-hud', 'me', false, 'hud'), ov('me-box', 'me', false, 'a'), ov('who', 'who'),
    sect('s1', 'me', false, 'g7'), piece('q1', 'g1'), piece('q2', null),
    { id: 'callouts', kind: 'callouts', off: false }], { g1: 's1' });
  const offs = (e) => Object.fromEntries(e.layout.panels.map(p => [p.id, p.off]));

  it('a press of the overlay\'s key hides every look of it and nothing else — pieces taken apart, other pieces, other overlays stay', () => {
    const e = mk();
    e.applyGroupOps([{ overlay: 'me', show: false }]);
    expect(offs(e)).toEqual({ 'me-hud': true, 'me-box': true, who: false, s1: false, q1: false, q2: false, callouts: false });
    expect(e.layout.panels.slice(0, 2).map(p => [p.x, p.y, p.w, p.h])).toEqual([[0.3, 0.3, 320, 240], [0.3, 0.3, 320, 240]]);   // where it sits is kept
    expect(e.calls.save).toBe(1);                               // and the choice is saved with the layout
    expect(e.calls.render).toBe(1);
    e.applyGroupOps([{ overlay: 'me', show: true }]);
    expect(offs(e)).toEqual({ 'me-hud': false, 'me-box': false, who: false, s1: false, q1: false, q2: false, callouts: false });
  });
  it('it is an explicit state, not a flip: the same press twice leaves it as it was', () => {
    const e = mk();
    e.applyGroupOps([{ overlay: 'me', show: false }, { overlay: 'me', show: false }]);
    expect(offs(e)['me-hud']).toBe(true);
  });
  it('an overlay with no panel here is left alone, with no note and no save', () => {
    const e = mk();
    e.applyGroupOps([{ overlay: 'charm', show: false }]);
    expect(e.calls.notes).toEqual([]);
    expect(e.calls.save).toBe(0);
    expect(e.setOverlayPanels('charm', true)).toBe(false);
  });
  it('group presses and overlay presses share the queue, in order, and a group of taken-apart pieces keeps to its own key', () => {
    const e = mk();
    e.applyGroupOps([{ overlay: 'me', show: false }, { id: 's1', show: false }]);
    expect(offs(e)).toEqual({ 'me-hud': true, 'me-box': true, who: false, s1: false, q1: true, q2: false, callouts: false });
  });
  it('the Canvas applies it from loadState (the press that arrived while it was closed) and from the ping', () => {
    expect(canvas).toMatch(/if \(op && typeof op\.overlay === 'string'\) \{ setOverlayPanels\(op\.overlay, !!op\.show\); return; \}/);
  });
});

describe('canvas.html: the key capture (the dashboard\'s, for the Canvas)', () => {
  const capBlock = sliceBlock(canvasRaw, '  var KEY_USES = {', '    return true;\n  }\n');
  async function capture(ev, { withClear = true, uses = [], selfId = 'canvasGroup:s1', overlays = [] } = {}) {
    const handlers = {};
    const document = { addEventListener: (t, h) => { handlers[t] = h; }, removeEventListener: (t) => { delete handlers[t]; } };
    const calls = [];
    const M = { hotkeyCapture: (on) => { calls.push(on); return Promise.resolve(on ? uses : true); } };
    const out = { said: [], accel: null, cleared: undefined, calls, focus: 0 };
    const ovEntry = (k) => overlays.find(o => o.key === k) || null;
    // eslint-disable-next-line no-new-func
    const { captureAccel } = new Function('document', 'window', 'M', 'ovEntry', 'var _capBusy = false;\n' + capBlock + '\nreturn { captureAccel };')(
      document, { focus: () => { out.focus++; } }, M, ovEntry);
    out.started = captureAccel((m, fade) => out.said.push([m, !!fade]), (a) => { out.accel = a; }, withClear ? (c) => { out.cleared = c; } : undefined, selfId);
    await Promise.resolve(); await Promise.resolve();            // the list of Mimic's keys arrives
    for (const e of ev) {
      const h = handlers[e.type || 'keydown'];
      if (h) h(Object.assign({ preventDefault() {}, stopPropagation() {}, ctrlKey: false, altKey: false, shiftKey: false, code: '' }, e));
    }
    out.listening = !!handlers.keydown;
    out.handlers = handlers;
    return out;
  }
  const last = (r) => r.said[r.said.length - 1][0];

  it('Ctrl+Alt+a letter or digit becomes an accelerator; Shift with a digit keeps the digit', async () => {
    expect((await capture([{ key: 'Control', ctrlKey: true }, { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true }])).accel).toBe('CommandOrControl+Alt+M');
    expect((await capture([{ key: '3', code: 'Digit3', altKey: true }])).accel).toBe('Alt+3');
    expect((await capture([{ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }])).accel).toBe('CommandOrControl+Shift+1');
    expect((await capture([{ key: 'F5', code: 'F5', altKey: true }])).accel).toBe('Alt+F5');
  });
  it('a bare key is refused (it would eat normal typing) and the capture keeps listening', async () => {
    const r = await capture([{ key: 'm', code: 'KeyM' }]);
    expect(r.accel).toBeNull();
    expect(r.listening).toBe(true);
    expect(last(r)).toMatch(/^Add Ctrl, Alt or Shift/);
  });
  it('Backspace removes the key; Esc cancels without saving', async () => {
    expect((await capture([{ key: 'Backspace', code: 'Backspace' }])).cleared).toBe(true);
    const esc = await capture([{ key: 'Escape', code: 'Escape' }]);
    expect(esc.cleared).toBeNull();
    expect(esc.accel).toBeNull();
    expect(last(esc)).toBe('Cancelled.');
  });
  it('a key Mimic already uses is named — the all-overlay keys, an overlay\'s, and another group\'s — and the capture keeps listening', async () => {
    const USES = [{ id: 'hideAllHotkey', accel: 'CommandOrControl+Shift+H' }, { id: 'overlay:tank', accel: 'Alt+Shift+T' },
      { id: 'canvasGroup:s2', accel: 'Alt+2', label: 'the “Tank” Canvas group’s key' }, { id: 'canvasGroup:s1', accel: 'Alt+1', label: 'x' }];
    const opts = { uses: USES, overlays: [{ key: 'tank', label: 'Tank HUD' }] };
    const h = await capture([{ key: 'H', code: 'KeyH', ctrlKey: true, shiftKey: true }], opts);
    expect(h.accel).toBeNull();
    expect(last(h)).toMatch(/^Ctrl\+Shift\+H is already the Show \/ hide ALL key/);
    expect(h.listening).toBe(true);
    expect(last(await capture([{ key: 'T', code: 'KeyT', altKey: true, shiftKey: true }], opts))).toMatch(/is already the Tank HUD overlay’s key/);
    expect(last(await capture([{ key: '2', code: 'Digit2', altKey: true }], opts))).toMatch(/is already the “Tank” Canvas group’s key/);
  });
  it('…but the group being set may keep its own key', async () => {
    const r = await capture([{ key: '1', code: 'Digit1', altKey: true }], { uses: [{ id: 'canvasGroup:s1', accel: 'Alt+1' }] });
    expect(r.accel).toBe('Alt+1');
  });
  it('modifiers down and up with no key between — another program holds it — is said, not silent', async () => {
    const r = await capture([
      { key: 'Control', ctrlKey: true }, { key: 'Shift', ctrlKey: true, shiftKey: true },
      { type: 'keyup', key: 'Shift', ctrlKey: true }, { type: 'keyup', key: 'Control' },
    ]);
    expect(last(r)).toMatch(/another program is already using that combination/);
    expect(r.listening).toBe(true);
  });
  it('Mimic lets go of its keys while it listens, and takes them back when it ends', async () => {
    const r = await capture([{ key: 'k', code: 'KeyK', ctrlKey: true }]);
    expect(r.calls).toEqual([true, false]);
    expect(r.focus).toBe(1);
  });
  it('only one capture at a time', async () => {
    const handlers = {};
    const document = { addEventListener: (t, h) => { handlers[t] = h; }, removeEventListener: () => {} };
    const { captureAccel } = new Function('document', 'window', 'M', 'ovEntry', 'var _capBusy = false;\n' + capBlock + '\nreturn { captureAccel };')(
      document, { focus() {} }, {}, () => null);
    expect(captureAccel(() => {}, () => {})).toBe(true);
    expect(captureAccel(() => {}, () => {})).toBe(false);
  });
  it('a capture nobody finishes lets go on its own after 20 seconds, so it cannot hold the keys for good', async () => {
    vi.useFakeTimers();
    const r = await capture([], {});
    expect(r.listening).toBe(true);
    vi.advanceTimersByTime(19_000);
    expect(r.calls).toEqual([true]);
    vi.advanceTimersByTime(1_500);
    expect(r.calls).toEqual([true, false]);
    expect(r.cleared).toBeNull();
    expect(Object.keys(r.handlers)).toEqual([]);
    expect(last(r)).toMatch(/^No key came through/);
  });
  it('the Delete / Backspace that removes selected pieces stands down while a group\'s key is being captured', () => {
    expect(canvas).toMatch(/document\.addEventListener\('keydown', function \(ev\) \{\s*if \(!_edit \|\| _capKey \|\|/);
  });
});

describe('canvas.html: setting, changing and clearing a group\'s key', () => {
  const uiBlock = sliceBlock(canvasRaw, '  function keyText(id) {', '  function repaintKeys() {').replace(/  function repaintKeys\(\) \{$/, '');
  const flowBlock = sliceBlock(canvasRaw, '  function repaintKeys() {', "}).catch(function () { repaintKeys(); note('Could not save that key.', 4000); });\n  }\n");
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fmt = (a) => String(a || '').replace(/CommandOrControl|CmdOrCtrl/gi, 'Ctrl');

  function ui(groupPanels = () => [{ off: false }]) {
    const f = new Function('esc', 'fmtAccel', 'groupPanels',
      'var _capKey = null, _gkeys = {}, _gblocked = {};\n' + uiBlock + '\nreturn { keyText, keyTitle, groupKeyChip, groupMenuHtml, set(c, k, b) { _capKey = c; _gkeys = k; _gblocked = b; } };');
    return f(esc, fmt, groupPanels);
  }
  const G = { id: 's1', name: 'Raid <HUD>' };

  it('the chooser row: a dashed "Hotkey…" chip with none; the key in blue with a "clear" beside it once set', () => {
    const u = ui();
    expect(u.groupKeyChip(G)).toBe('<span class="pc-k" data-keygrp="s1" title="' + esc(u.keyTitle('s1')) + '">⌨ Hotkey…</span>');
    u.set(null, { s1: 'CommandOrControl+Alt+1' }, {});
    const h = u.groupKeyChip(G);
    expect(h).toContain('class="pc-k set" data-keygrp="s1"');
    expect(h).toContain('⌨ Ctrl+Alt+1');
    expect(h).toContain('data-clrgrp="s1"');
  });
  it('…red when another program holds the key; amber and no clear while it listens', () => {
    const u = ui();
    u.set(null, { s1: 'Alt+1' }, { s1: 'Alt+1' });
    expect(u.groupKeyChip(G)).toContain('class="pc-k clash"');
    expect(u.keyTitle('s1')).toMatch(/^Another program already uses Alt\+1/);
    u.set('s1', { s1: 'Alt+1' }, {});
    const h = u.groupKeyChip(G);
    expect(h).toContain('class="pc-k on"');
    expect(h).toContain('press keys…');
    expect(h).not.toContain('data-clrgrp');
  });
  it('the ⚙ of a piece in a saved group: Hide / Show the group, Hotkey…, and Clear hotkey only when there is one', () => {
    const u = ui();
    let h = u.groupMenuHtml(G);
    expect(h).toContain('Saved group “Raid &lt;HUD&gt;” · 1 here');
    expect(h).toContain('data-gtoggle="s1"');
    expect(h).toContain('✕ Hide the group');
    expect(h).toContain('data-gkey="s1"');
    expect(h).toContain('⌨ Hotkey…');
    expect(h).not.toContain('Clear hotkey');
    u.set(null, { s1: 'Alt+1' }, {});
    h = u.groupMenuHtml(G);
    expect(h).toContain('data-gclear="s1"');
    expect(h).toContain('Clear hotkey');
    expect(h).toContain('⌨ Alt+1');
    const hidden = ui(() => [{ off: true }, { off: true }]);
    expect(hidden.groupMenuHtml(G)).toContain('👁 Show the group');
  });

  function flow({ ok = true, blocked = {}, keys = null } = {}) {
    const rec = { notes: [], renders: 0, opens: 0, saved: [], cap: null };
    const f = new Function('renderChooser', 'openMenu', 'panelById', 'menuEl', 'PICKER', 'M', 'note', 'captureAccel', 'savedById', 'fmtAccel', '_els',
      'var _capKey = null, _gkeys = {}, _gblocked = {}, _menuFor = "p1", _menuAnchor = {};\n' + flowBlock
      + '\nreturn { captureGroupKey, setGroupKey, get capKey() { return _capKey; }, get gkeys() { return _gkeys; }, get gblocked() { return _gblocked; } };');
    const r = f(() => { rec.renders++; }, () => { rec.opens++; }, () => ({}), { classList: { contains: () => true } }, '__picker',
      { canvasGroupHotkey: (id, accel) => { rec.saved.push([id, accel]); return Promise.resolve(ok ? { ok: true, keys: keys || (accel ? { [id]: accel } : {}), blocked } : { ok: false }); } },
      (m, ms) => rec.notes.push([m, ms]),
      (say, onAccel, onClear, selfId) => { rec.cap = { say, onAccel, onClear, selfId }; return !rec.refuse; },
      (id) => (id === 's1' ? G : null), fmt, {});
    return Object.assign(r, { rec });
  }
  const flush = () => new Promise((res) => setTimeout(res, 0));

  it('Hotkey… listens as that group, shows "press keys…" and says what to press', () => {
    const t = flow();
    t.captureGroupKey('s1');
    expect(t.rec.cap.selfId).toBe('canvasGroup:s1');
    expect(t.capKey).toBe('s1');
    expect(t.rec.renders).toBe(1);
    expect(t.rec.opens).toBe(1);                       // the open ⚙ repaints too
    expect(t.rec.notes[0][0]).toMatch(/^Press the keys for “Raid <HUD>” now \(Ctrl, Alt or Shift \+ a key\)\. Backspace removes it, Esc cancels\./);
    t.captureGroupKey('s1');                           // already listening: ignored
    expect(t.rec.saved).toEqual([]);
  });
  it('a captured key is saved by the group\'s id and confirmed', async () => {
    const t = flow();
    t.captureGroupKey('s1');
    t.rec.cap.onAccel('CommandOrControl+Alt+1');
    await flush();
    expect(t.rec.saved).toEqual([['s1', 'CommandOrControl+Alt+1']]);
    expect(t.capKey).toBeNull();
    expect(t.gkeys).toEqual({ s1: 'CommandOrControl+Alt+1' });
    expect(t.rec.notes.pop()[0]).toBe('Saved — press Ctrl+Alt+1 anywhere to show or hide “Raid <HUD>”.');
  });
  it('a key another program holds is saved but SAID not to work', async () => {
    const t = flow({ blocked: { s1: 'Alt+1' } });
    t.captureGroupKey('s1');
    t.rec.cap.onAccel('Alt+1');
    await flush();
    expect(t.gblocked).toEqual({ s1: 'Alt+1' });
    expect(t.rec.notes.pop()[0]).toMatch(/^Another program already uses Alt\+1, so it does nothing here/);
  });
  it('Backspace while listening, and the "Clear hotkey" button, both take the key off', async () => {
    const t = flow();
    t.captureGroupKey('s1');
    t.rec.cap.onClear(true);
    await flush();
    expect(t.rec.saved).toEqual([['s1', '']]);
    expect(t.rec.notes.pop()[0]).toBe('Hotkey removed from “Raid <HUD>”.');
    t.setGroupKey('s1', '');
    await flush();
    expect(t.rec.saved).toEqual([['s1', ''], ['s1', '']]);
  });
  it('Esc leaves the key as it was, and repaints out of the listening state', () => {
    const t = flow();
    t.captureGroupKey('s1');
    t.rec.cap.onClear(null);
    expect(t.rec.saved).toEqual([]);
    expect(t.capKey).toBeNull();
    expect(t.rec.renders).toBe(2);
  });
  it('a refused save is said, not silent', async () => {
    const t = flow({ ok: false });
    t.setGroupKey('s1', 'Alt+1');
    await flush();
    expect(t.rec.notes.pop()[0]).toBe('Could not save that key.');
  });
  it('a group that is gone cannot start a capture', () => {
    const t = flow();
    t.captureGroupKey('s9');
    expect(t.rec.cap).toBeNull();
  });
});

describe('canvas.html: the wiring', () => {
  it('the ⚙ menu: Hide / Show the group, Hotkey…, Clear hotkey — for a piece of any kind that belongs to a saved group', () => {
    expect(canvas).toMatch(/var ng = p\.grp \? namedGroup\(p\.grp\) : null;\s*if \(ng\) h \+= groupMenuHtml\(ng\);\s*h \+= '<div class="row">'\s*\+ '<button class="btn" data-hide>'/);
    expect(canvas).toMatch(/else if \(t\.hasAttribute\('data-gtoggle'\)\) \{ toggleSavedGroup\(t\.getAttribute\('data-gtoggle'\), 'toggle'\); \}/);
    expect(canvas).toMatch(/else if \(t\.hasAttribute\('data-gkey'\)\) \{ captureGroupKey\(t\.getAttribute\('data-gkey'\)\); return; \}/);
    expect(canvas).toMatch(/else if \(t\.hasAttribute\('data-gclear'\)\) \{ setGroupKey\(t\.getAttribute\('data-gclear'\), ''\); return; \}/);
  });
  it('the chooser: each saved group\'s row carries the chip; a click on it sets, on "clear" removes — and neither starts a drag', () => {
    expect(canvas).toMatch(/\+ g\.parts\.length \+ ' pieces' \+ groupHiddenText\(g\.id\) \+ '<\/span>'\s*\+ groupKeyChip\(g\)\s*\+ '<span class="x" data-delgrp="'/);
    expect(canvas).toMatch(/if \(kg\) \{ captureGroupKey\(kg\.getAttribute\('data-keygrp'\)\); return; \}\s*if \(cg\) \{ setGroupKey\(cg\.getAttribute\('data-clrgrp'\), ''\); return; \}/);
    expect(canvas).toContain("ev.target.closest('[data-delgrp],[data-keygrp],[data-clrgrp]')");
  });
  it('deleting a saved group forgets its marks and its key', () => {
    expect(canvas).toMatch(/_groups = _groups\.filter\(function \(g\) \{ return g\.id !== id; \}\);[^\n]*\n[^\n]*canvasGroupsSave\(_groups\)[^\n]*\n\s*forgetSavedGroup\(id\);/);
  });
  it('what main sends is applied after the layout is: keys for the chips, then the queued presses', () => {
    const body = sliceBlock(canvasRaw, '  function loadState(st) {', '\n  }\n');
    const run = (st, layoutRes = '1920x1080') => {
      const calls = [];
      const f = new Function('M', 'screenBtn', 'render', 'setEdit', 'applyGroupOps', 'save', 'sanitize',
        'var _overlays = [], _res = ' + JSON.stringify(layoutRes) + ', _layout = {}, _arrange = false, _gkeys = {}, _gblocked = {};\n' + body
        + '\nreturn { loadState, get gkeys() { return _gkeys; }, get gblocked() { return _gblocked; } };');
      const r = f({}, { style: {} }, () => calls.push('render'), () => calls.push('setEdit'), (ops) => calls.push(['ops', ops]), () => {}, (l) => l);
      r.loadState(st);
      return { r, calls };
    };
    const a = run({ res: '1920x1080', layout: { panels: [] }, edit: false, displays: 1, groupKeys: { s1: 'Alt+1' }, groupKeysBlocked: { s1: 'Alt+1' }, groupOps: [{ id: 's1', show: true }] });
    expect(a.r.gkeys).toEqual({ s1: 'Alt+1' });
    expect(a.r.gblocked).toEqual({ s1: 'Alt+1' });
    expect(a.calls).toEqual(['render', 'setEdit', ['ops', [{ id: 's1', show: true }]]]);
    // nothing queued, or a reply without the fields (canvas-next-display): nothing applied, keys kept
    const b = run({ res: '1920x1080', layout: { panels: [] }, edit: false, displays: 1, groupOps: [] });
    expect(b.calls).toEqual(['render', 'setEdit']);
    const c = run({ res: '1920x1080', layout: { panels: [] }, edit: false, displays: 1 });
    expect(c.r.gkeys).toEqual({});
    expect(c.calls).toEqual(['render', 'setEdit']);
  });
  it('a member who locked a set together is told that saving it as a group is how it gets a hotkey', () => {
    expect(canvas).toContain('title="Keep this set in the chooser\\\'s Groups tab, to drop again anywhere — and give it a hotkey that shows or hides it">💾 Save as a group</button>');
  });
  it('a press made while the Canvas is up is read at once', () => {
    expect(canvas).toContain('try { if (M.onCanvasGroupOps) M.onCanvasGroupOps(refresh); } catch (e) {}');
  });
});
