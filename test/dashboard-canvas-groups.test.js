// test/dashboard-canvas-groups.test.js — the agent dashboard's "Canvas groups" block on the Overlays tab.
//
// Mimic 3.0 alpha gave every saved Canvas group a hotkey and a "↳ Canvas groups — show / hide" tray
// submenu (the guild lead, 2026-10-07: "we should be able to assign hotkeys to show or hide canvas
// groups as well"). The repo rule is that anything in the tray is also on the dashboard, driving the
// same internals — so the Overlays tab lists the groups, each with its key, a Change… and a
// Show / hide. A Mimic without the bridge (the beta line) shows NOTHING: no heading, no placeholder.
//
// Runs the REAL functions out of dashboard.html against a fake window.mimic, a fake document and fake
// elements, so a comment cannot satisfy any of it.
//
// Run: npx vitest run test/dashboard-canvas-groups.test.js

import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock } from './_source-slice.js';

const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));

const ROWS   = sliceBlock(dash, 'var WP_OVERLAY_ROWS = [', '\n];\n');
const BLURB  = sliceBlock(dash, 'var WP_OVERLAY_BLURB = {', '\n};\n');
const MINI   = sliceBlock(dash, 'var WP_MINI_KEY_OF = {', '};\n');
const ESC    = sliceBlock(dash, 'function esc(s) {', ' }\n');
const KEEP   = 'var _wpOpenDetails = {};\n' + sliceBlock(dash, 'function wpKeep(key, defaultOpen) {', '\n}\n');
const RENDER = sliceBlock(dash, 'function renderOverlays(s) {', '\n}\n');
const FMT    = sliceBlock(dash, 'function _wpFmtAccel(a) {', '}\n');
const USES   = sliceBlock(dash, 'var _WP_HOTKEY_USES = {', "return mods.sort().join('+') + '+' + key;\n}\n");
const CAP    = sliceBlock(dash, 'function _wpCaptureAccel(', "\n  document.addEventListener('keyup', onUp, true);\n  return true;\n}\n");
const MORPH  = sliceBlock(dash, 'function morphInto(el, html) {', '\n}\n');
const KEYS   = sliceBlock(dash, 'function _wpHotkeyUsesOf(cfg) {', "keys.join(', ');\n}\n");
const CG     = sliceBlock(dash, 'function _wpCanvasGroupsHTML(st, clashes) {', "Could not reach Mimic.', true); });\n}\n");
const CLICK  = sliceBlock(dash, "if (typeof window !== 'undefined' && !window.__wpOvDelegated) {", '\n}\n');
const PAINTER = sliceBlock(dash, 'function wpRefreshOverlayHotkeys() {', '\n}\n');

const GROUPS = [
  { id: 'g-tank', name: 'Tank <b>&"zone"' },
  { id: 'g-heal', name: 'Healers' },
  { id: 'g-gone', name: 'Pulls' },
];
const status = (over = {}) => ({
  canvasGroups: GROUPS,
  canvasGroupHotkeys: { 'g-tank': 'CommandOrControl+Alt+1', 'g-gone': 'CommandOrControl+Alt+3' },
  canvasGroupHotkeysBlocked: { 'g-gone': 'CommandOrControl+Alt+3' },
  ...over,
});
const BRIDGE = () => ({
  canvasGroupHotkey: vi.fn(async () => ({ ok: true, keys: {}, blocked: {} })),
  toggleCanvasGroup: vi.fn(async () => true),
});

// An element that counts how often its HTML is written (the byte-stability check).
function makeEl() {
  return { writes: 0, _h: '', textContent: '', get innerHTML() { return this._h; }, set innerHTML(v) { this._h = v; this.writes++; } };
}

// Everything the block needs, out of the real file. `capture` swaps the real key capture for a spy.
function load({ mimic, capture, uses = [] } = {}) {
  const els = { wpCanvasGroups: makeEl(), wpCgHint: makeEl() };
  const handlers = {}, timers = [], repainted = { n: 0 };
  const document = {
    getElementById: (id) => els[id] || null,
    addEventListener: (t, h) => { handlers[t] = h; },
    removeEventListener: (t) => { delete handlers[t]; },
  };
  const win = { mimic };
  if (mimic && !mimic.hotkeyCapture) mimic.hotkeyCapture = vi.fn((on) => Promise.resolve(on ? uses : true));
  let api;
  // The real wpRefreshOverlayHotkeys re-paints everything on the tab; here it re-paints this block.
  const wpRefreshOverlayHotkeys = () => {
    repainted.n++;
    return Promise.resolve(mimic && mimic.getStatus && mimic.getStatus()).then((st) => { if (st) api.wpPaintCanvasGroups(st, {}); });
  };
  const params = ['document', 'window', 'setTimeout', 'wpRefreshOverlayHotkeys', ...(capture ? ['_wpCaptureAccel'] : [])];
  const body = 'var _wpHotkeyCapturing = false;\nvar _wpGlobalKeys = {};\n'
    + ROWS + ESC + FMT + USES + MORPH + (capture ? '' : CAP) + KEYS + CG
    + '\nreturn { _wpCanvasGroupsHTML, wpPaintCanvasGroups, wpCanvasGroupChange, wpCanvasGroupToggle, _wpCgSay,'
    + ' _wpHotkeyUseLabel, _wpHotkeyUsesOf, _wpCanvasGroupUses, _wpKeyClashes, _wpKeycap, _wpClashSummary,'
    + ' get capturing() { return _wpHotkeyCapturing; } };';
  api = new Function(...params, body)(document, win, (fn, ms) => { timers.push([fn, ms]); }, wpRefreshOverlayHotkeys,
    ...(capture ? [capture] : []));
  return { api, els, handlers, timers, repainted, win, document };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const key = (over) => Object.assign({ type: 'keydown', key: '', code: '', ctrlKey: false, altKey: false, shiftKey: false, preventDefault() {}, stopPropagation() {} }, over);
// Ctrl+Alt+<digit>, as the capture reads it.
const ctrlAlt = (d) => key({ key: String(d), code: 'Digit' + d, ctrlKey: true, altKey: true });

// ── (a) Nothing to show → nothing shown ─────────────────────────────────────
describe('Canvas groups block: nothing renders when Mimic cannot do it', () => {
  it('a Mimic without the canvasGroupHotkey bridge (beta) renders nothing — even if status carried groups', () => {
    for (const mimic of [undefined, {}, { getStatus() {} }, { canvasGroupHotkey: 'not a function' }]) {
      const { api } = load({ mimic });
      expect(api._wpCanvasGroupsHTML(status(), {})).toBe('');
    }
  });

  it('a Mimic with the bridge but no saved groups renders nothing: no heading, no placeholder', () => {
    const { api } = load({ mimic: BRIDGE() });
    for (const st of [status({ canvasGroups: [] }), status({ canvasGroups: undefined }), status({ canvasGroups: 'x' }),
      status({ canvasGroups: [null, { name: 'no id' }, { id: '' }] }), {}, null, undefined]) {
      expect(api._wpCanvasGroupsHTML(st, {})).toBe('');
    }
  });

  it('painting nothing leaves the placeholder empty', () => {
    const { api, els } = load({ mimic: undefined });
    api.wpPaintCanvasGroups(status(), {});
    expect(els.wpCanvasGroups.innerHTML).toBe('');
    const withBridge = load({ mimic: BRIDGE() });
    withBridge.api.wpPaintCanvasGroups(status({ canvasGroups: [] }), {});
    expect(withBridge.els.wpCanvasGroups.innerHTML).toBe('');
  });

  it('the Overlays tab render carries only an EMPTY #wpCanvasGroups — no heading, no text — whatever Mimic reports', () => {
    let out = null;
    const render = new Function('window', 'setSectionHTML', 'wpRefreshOverlayToggles', 'wpRefreshOverlayHotkeys',
      'wpWireHideHotkey', 'wpWireExtPref', 'wpWireBqPref',
      ROWS + BLURB + MINI + ESC + KEEP + RENDER + '\nreturn renderOverlays;')(
      { mimic: { openDashboard() {}, ...BRIDGE() } }, (id, h) => { out = h; }, () => {}, () => {}, () => {}, () => {}, () => {});
    render({});
    expect(out.split('id="wpCanvasGroups"').length - 1).toBe(1);
    expect(out).toContain('<div id="wpCanvasGroups"></div>');
    expect(out).not.toMatch(/Canvas groups/i);
  });
});

// ── (b) The rows ────────────────────────────────────────────────────────────
describe('Canvas groups block: one row per group', () => {
  const { api } = load({ mimic: BRIDGE() });
  const html = api._wpCanvasGroupsHTML(status(), {});
  const cells = html.split('<span class="wp-kcell">').slice(1);

  it('one heading, one cell per group, in order, each with its own Change… and Show / hide', () => {
    expect(html.split('<span class="wp-lbl">Canvas groups</span>').length - 1).toBe(1);
    expect(cells).toHaveLength(3);
    GROUPS.forEach((g, i) => {
      expect(cells[i], g.id).toContain('<button type="button" class="wp-btn ghost wp-cg-key" data-gid="' + g.id + '">Change…</button>');
      expect(cells[i], g.id).toContain('<button type="button" class="wp-btn wp-cg-show" data-gid="' + g.id + '">Show / hide</button>');
    });
  });

  it('the name is escaped — and is not class="name", which the click delegation would open as a character', () => {
    expect(html).toContain('Tank &lt;b&gt;&amp;&quot;zone&quot;');
    expect(html).not.toContain('<b>&"zone"');
    expect(html).not.toContain('class="name"');
  });

  it('a group id with markup in it cannot break out of its attribute', () => {
    const x = api._wpCanvasGroupsHTML(status({ canvasGroups: [{ id: 'a"><img src=x>', name: 'x' }] }), {});
    expect(x).not.toContain('<img');
    expect(x).toContain('data-gid="a&quot;&gt;&lt;img src=x&gt;"');
  });

  it('a key is a keycap (the shared helper); none says "no hotkey"', () => {
    expect(cells[0]).toContain('<code class="wp-key" title="Press it anywhere to show or hide this group. Change… picks another.">Ctrl+Alt+1</code>');
    expect(cells[1]).toContain('<span class="dim">no hotkey</span>');
    expect(cells[1]).not.toContain('<code');
    expect(html.split('<code').length - 1).toBe(2);
  });

  it('a key another program holds is flagged, on that group only, in the overlay rows\' words', () => {
    const note = '⚠ another program already uses it';
    expect(html.split(note).length - 1).toBe(1);
    expect(cells[2]).toContain(note);
    expect(cells[2]).toContain('title="Another program already uses Ctrl+Alt+3, so it does nothing here — pick a different one."');
    expect(cells[0]).not.toContain('⚠');
  });

  it('a group key that clashes with another Mimic key is a red keycap naming the other control', () => {
    const cfg = { overlayHotkeys: { tank: 'Control+Alt+1' } };
    const st = status({ canvasGroupHotkeysBlocked: {} });
    const clashes = api._wpKeyClashes(api._wpHotkeyUsesOf(cfg).concat(api._wpCanvasGroupUses(st)), st);
    expect(Object.keys(clashes).sort()).toEqual(['canvasGroup:g-tank', 'overlay:tank']);
    const x = api._wpCanvasGroupsHTML(st, clashes);
    expect(x).toContain('<code class="wp-key clash" title="Ctrl+Alt+1 is also the Tank HUD overlay’s key — only one of them can work. Pick a different one.">');
    // …and the overlay's keycap names the group, by the name Mimic gave it.
    expect(api._wpKeycap(cfg.overlayHotkeys.tank, clashes['overlay:tank']).title).toMatch(/is also the “Tank <b>&"zone"” Canvas group’s key — only one/);
  });

  it('a key the OS refused counts as a clash and goes red', () => {
    const st = status();
    const clashes = api._wpKeyClashes(api._wpCanvasGroupUses(st), st);
    expect(clashes).toEqual({ 'canvasGroup:g-gone': { accel: 'CommandOrControl+Alt+3', taken: true } });
    expect(api._wpCanvasGroupsHTML(st, clashes)).toContain('<code class="wp-key clash"');
  });

  it('a Mimic without group status adds no group keys to the clash list', () => {
    expect(api._wpCanvasGroupUses({})).toEqual([]);
    expect(api._wpCanvasGroupUses(null)).toEqual([]);
    expect(api._wpHotkeyUsesOf({}).some((u) => u.id.indexOf('canvasGroup:') === 0)).toBe(false);
  });
});

// ── The tab's one key painter paints the block ──────────────────────────────
// wpRefreshOverlayHotkeys is what every key on the tab is painted by (and what every save calls); the
// block rides on it, so the real one runs here against a fake Mimic.
describe('Canvas groups block: painted by the tab\'s key painter, with the rest of the keys', () => {
  function runPainter(mimic, cfg) {
    const els = { wpCanvasGroups: makeEl(), wpOvClash: { textContent: '', style: {} } };
    const document = { getElementById: (id) => els[id] || null, querySelectorAll: () => [] };
    mimic.getConfig = async () => cfg;
    const api = new Function('document', 'window',
      'var _wpHotkeyCapturing = false;\nvar _wpGlobalKeys = {};\n'
      + ROWS + ESC + FMT + USES + MORPH + KEYS + CG + PAINTER + '\nreturn { wpRefreshOverlayHotkeys };')(document, { mimic });
    return { api, els };
  }

  it('lists the groups, and returns a promise a save can wait on', async () => {
    const mimic = BRIDGE();
    mimic.getStatus = async () => status();
    const { api, els } = runPainter(mimic, {});
    const done = api.wpRefreshOverlayHotkeys();
    expect(typeof done.then).toBe('function');
    await done;
    expect(els.wpCanvasGroups.innerHTML).toContain('Healers');
    expect(els.wpOvClash.textContent).toBe('1 clash: Ctrl+Alt+3');   // the key the OS refused counts, like any other
  });

  it('a group key that duplicates an overlay\'s key is a clash on both, and is counted once', async () => {
    const mimic = BRIDGE();
    mimic.getStatus = async () => status({ canvasGroupHotkeysBlocked: {} });
    const { api, els } = runPainter(mimic, { overlayHotkeys: { hud: 'CommandOrControl+Alt+1' } });
    await api.wpRefreshOverlayHotkeys();
    expect(els.wpCanvasGroups.innerHTML).toContain('<code class="wp-key clash" title="Ctrl+Alt+1 is also the DPS/Tank Meter overlay’s key');
    expect(els.wpOvClash.textContent).toBe('1 clash: Ctrl+Alt+1');
  });

  it('a Mimic without the bridge leaves the placeholder empty', async () => {
    const mimic = { getStatus: async () => ({ overlayHotkeysBlocked: {} }) };   // a beta Mimic's status: no group fields
    const { api, els } = runPainter(mimic, {});
    await api.wpRefreshOverlayHotkeys();
    expect(els.wpCanvasGroups.innerHTML).toBe('');
    expect(els.wpCanvasGroups.writes).toBe(1);   // painted (as empty), not left undefined
    expect(els.wpOvClash.textContent).toBe('no clashes');
  });
});

// ── Byte stability ──────────────────────────────────────────────────────────
describe('Canvas groups block: byte-stable across polls', () => {
  it('the same status is the same string, and a repaint of it writes nothing', () => {
    const { api, els } = load({ mimic: BRIDGE() });
    expect(api._wpCanvasGroupsHTML(status(), {})).toBe(api._wpCanvasGroupsHTML(status(), {}));
    api.wpPaintCanvasGroups(status(), {});
    api.wpPaintCanvasGroups(status(), {});
    api.wpPaintCanvasGroups(status(), {});
    expect(els.wpCanvasGroups.writes).toBe(1);
    api.wpPaintCanvasGroups(status({ canvasGroupHotkeys: {} , canvasGroupHotkeysBlocked: {} }), {});   // a real change does repaint
    expect(els.wpCanvasGroups.writes).toBe(2);
  });

  it('a capture in progress keeps the strip, and its prompt, as they are', async () => {
    const { api, els } = load({ mimic: BRIDGE() });
    api.wpPaintCanvasGroups(status(), {});
    api.wpCanvasGroupChange('g-heal');
    expect(api.capturing).toBe(true);
    api.wpPaintCanvasGroups(status({ canvasGroupHotkeys: {} }), {});
    expect(els.wpCanvasGroups.writes).toBe(1);
  });
});

// ── (c) Change… ─────────────────────────────────────────────────────────────
describe('Canvas groups block: Change… sets the group\'s key through the shared capture', () => {
  it('starts the capture with the group\'s own selfId, so it may keep its own key', () => {
    const capture = vi.fn(() => true);
    const { api } = load({ mimic: BRIDGE(), capture });
    api.wpCanvasGroupChange('g-tank');
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][3]).toBe('canvasGroup:g-tank');
    expect(typeof capture.mock.calls[0][0]).toBe('function');   // say
    expect(typeof capture.mock.calls[0][2]).toBe('function');   // Backspace clears
  });

  it('a captured key goes to canvasGroupHotkey(id, accel) and repaints; Backspace sends \'\'; Esc sends nothing', async () => {
    const mimic = BRIDGE();
    mimic.getStatus = vi.fn(async () => status());
    const capture = vi.fn(() => true);
    const { api, repainted, els } = load({ mimic, capture });
    els.wpCgHint.textContent = '';
    api.wpCanvasGroupChange('g-heal');
    const [, onAccel, onClear] = capture.mock.calls[0];
    onAccel('CommandOrControl+Alt+2');
    await flush();
    expect(mimic.canvasGroupHotkey).toHaveBeenLastCalledWith('g-heal', 'CommandOrControl+Alt+2');
    expect(repainted.n).toBe(1);
    expect(els.wpCgHint.textContent).toBe('Saved — press Ctrl+Alt+2 anywhere to show or hide the group.');
    onClear(true);
    await flush();
    expect(mimic.canvasGroupHotkey).toHaveBeenLastCalledWith('g-heal', '');
    expect(els.wpCgHint.textContent).toBe('Hotkey removed.');
    mimic.canvasGroupHotkey.mockClear();
    onClear(null);
    await flush();
    expect(mimic.canvasGroupHotkey).not.toHaveBeenCalled();
  });

  it('says so when the OS refuses the key, and when Mimic does not take it', async () => {
    const mimic = BRIDGE();
    mimic.getStatus = vi.fn(async () => status());
    const capture = vi.fn(() => true);
    const { api, els } = load({ mimic, capture });
    api.wpCanvasGroupChange('g-heal');
    const onAccel = capture.mock.calls[0][1];
    mimic.canvasGroupHotkey.mockResolvedValueOnce({ ok: true, keys: { 'g-heal': 'Alt+9' }, blocked: { 'g-heal': 'Alt+9' } });
    onAccel('Alt+9');
    await flush();
    expect(els.wpCgHint.textContent).toMatch(/^Another program already uses Alt\+9, so it does nothing here/);
    mimic.canvasGroupHotkey.mockResolvedValueOnce({ ok: false, error: 'no such group' });
    onAccel('Alt+8');
    await flush();
    expect(els.wpCgHint.textContent).toBe('Save failed — no such group.');
  });

  it('through the REAL capture: the group may re-take its own key but not another group\'s; a free key is saved', async () => {
    const mimic = BRIDGE();
    mimic.getStatus = vi.fn(async () => status());
    const uses = [
      { id: 'canvasGroup:g-tank', accel: 'CommandOrControl+Alt+1', label: 'the “Tank” Canvas group’s key' },
      { id: 'canvasGroup:g-heal', accel: 'CommandOrControl+Alt+2', label: 'the “Healers” Canvas group’s key' },
    ];
    const { api, handlers, els } = load({ mimic, uses });
    api.wpCanvasGroupChange('g-tank');
    await flush();
    handlers.keydown(ctrlAlt(2));
    expect(mimic.canvasGroupHotkey).not.toHaveBeenCalled();
    expect(els.wpCgHint.textContent).toBe('Ctrl+Alt+2 is already the “Healers” Canvas group’s key — press a different one (Esc cancels).');
    handlers.keydown(ctrlAlt(1));                       // its own key: allowed
    await flush();
    expect(mimic.canvasGroupHotkey).toHaveBeenLastCalledWith('g-tank', 'CommandOrControl+Alt+1');
    expect(api.capturing).toBe(false);
  });
});

// ── Show / hide ─────────────────────────────────────────────────────────────
describe('Canvas groups block: Show / hide is Mimic\'s own press', () => {
  it('calls toggleCanvasGroup(id) and says what happened', async () => {
    const mimic = BRIDGE();
    const { api, els } = load({ mimic });
    api.wpCanvasGroupToggle('g-heal');
    await flush();
    expect(mimic.toggleCanvasGroup).toHaveBeenCalledWith('g-heal');
    expect(els.wpCgHint.textContent).toBe('Done — shown or hidden on the Canvas.');
    mimic.toggleCanvasGroup.mockResolvedValueOnce(false);
    api.wpCanvasGroupToggle('g-gone');
    await flush();
    expect(els.wpCgHint.textContent).toBe('That group no longer exists.');
  });

  it('does nothing on a Mimic without the bridge', () => {
    const { api } = load({ mimic: {} });
    expect(() => { api.wpCanvasGroupToggle('x'); api.wpCanvasGroupChange('x'); }).not.toThrow();
  });
});

// ── The click wiring ────────────────────────────────────────────────────────
describe('Canvas groups block: the delegated click reaches the right button', () => {
  function click(matches) {
    // The page's one delegated click listener, registered on a fake document.
    const calls = [];
    const listeners = [];
    const fakeDoc = { addEventListener: (t, h) => { if (t === 'click') listeners.push(h); } };
    const win = { __wpOvDelegated: false };
    new Function('document', 'window', 'wpToggleOverlay', 'wpDockOverlay', 'wpCaptureOverlayHotkey', 'wpRefreshOverlayToggles',
      'wpCanvasGroupChange', 'wpCanvasGroupToggle', CLICK)(
      fakeDoc, win, () => {}, () => {}, () => {}, () => {}, (id) => calls.push(['change', id]), (id) => calls.push(['toggle', id]));
    const target = { closest: (sel) => (sel === matches ? { getAttribute: () => 'g-tank' } : null) };
    listeners[0]({ target });
    return calls;
  }
  it('.wp-cg-key → Change…, .wp-cg-show → Show / hide, and the classes are the ones the block emits', () => {
    expect(click('.wp-cg-key')).toEqual([['change', 'g-tank']]);
    expect(click('.wp-cg-show')).toEqual([['toggle', 'g-tank']]);
    expect(click('.nothing')).toEqual([]);
    const html = load({ mimic: BRIDGE() }).api._wpCanvasGroupsHTML(status(), {});
    expect(html).toContain('class="wp-btn ghost wp-cg-key"');
    expect(html).toContain('class="wp-btn wp-cg-show"');
  });
});

// ── (d) Clash labels ────────────────────────────────────────────────────────
describe('hotkey clash labels: a use that names itself wins', () => {
  const { api } = load({ mimic: BRIDGE() });

  it('_wpHotkeyUseLabel prefers the use\'s own label, and falls back as before without one', () => {
    expect(api._wpHotkeyUseLabel('canvasGroup:g1', { id: 'canvasGroup:g1', label: 'the “Healers” Canvas group’s key' })).toBe('the “Healers” Canvas group’s key');
    expect(api._wpHotkeyUseLabel('canvasGroup:g1', { id: 'canvasGroup:g1', accel: 'Alt+1' })).toBe('another Mimic key');
    expect(api._wpHotkeyUseLabel('canvasGroup:g1')).toBe('another Mimic key');
    expect(api._wpHotkeyUseLabel('overlay:tank', { label: '' })).toBe('the Tank HUD overlay’s key');
    expect(api._wpHotkeyUseLabel('hideAllHotkey', { id: 'hideAllHotkey' })).toBe('the Show / hide ALL key');
    // Array.prototype.map hands the INDEX second; a number is not a use.
    expect(['overlay:tank'].map(api._wpHotkeyUseLabel)).toEqual(['the Tank HUD overlay’s key']);
  });

  it('the capture says the group by name when Mimic\'s list labels it, and "another Mimic key" when not', async () => {
    const withLabel = [{ id: 'canvasGroup:g-heal', accel: 'CommandOrControl+Alt+2', label: 'the “Healers” Canvas group’s key' }];
    const a = load({ mimic: BRIDGE(), uses: withLabel });
    a.api.wpCanvasGroupChange('g-tank');
    await flush();
    a.handlers.keydown(ctrlAlt(2));
    expect(a.els.wpCgHint.textContent).toMatch(/^Ctrl\+Alt\+2 is already the “Healers” Canvas group’s key — press a different one/);

    const bare = [{ id: 'canvasGroup:g-heal', accel: 'CommandOrControl+Alt+2' }];
    const b = load({ mimic: BRIDGE(), uses: bare });
    b.api.wpCanvasGroupChange('g-tank');
    await flush();
    b.handlers.keydown(ctrlAlt(2));
    expect(b.els.wpCgHint.textContent).toMatch(/^Ctrl\+Alt\+2 is already another Mimic key — press/);
  });
});
