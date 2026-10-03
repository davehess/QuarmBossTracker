// test/canvas-overlays.test.js — every overlay as a panel on the Timers canvas (Mimic 3.0 alpha).
//
// The guild lead, 2026-09-29: "i would like the next version of alpha to have all of the data elements
// from the current overlays. each current overlay's data elements can come in as they are today, no new
// modalities if that makes this less of a lift, but the end goal is to incorporate the different views".
// So each overlay's own page is a canvas panel the way the dock hosts it, and while it is there it has
// no window of its own.
//
// Run: npx vitest run test/canvas-overlays.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const canvas  = readSource(path.join(ROOT, 'apps', 'mimic', 'canvas.html'));
const main    = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const preload = readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js'));
const m = stripJs(main);
const c = stripJs(canvas);

function canvasRules() {
  const block = sliceBlock(canvas, '  var GROUPS = [', '  // ── Panels ──');
  return evalBlock('var window = {};\n' + block + '\nfunction __setOv(o){ _overlays = o; }', ['sanitize', 'ovSrc', '__setOv']);
}

describe('the canvas keeps overlay panels', () => {
  const r = canvasRules();
  it('once per overlay, clamped, beside the callouts and catch-all panels', () => {
    const s = r.sanitize({ panels: [
      { id: 'a', kind: 'overlay', key: 'charm', name: 'Charm', x: 0.2, y: 0.3, w: 300, h: 180, scale: 1.25 },
      { id: 'b', kind: 'overlay', key: 'charm', x: 0.5, y: 0.5, w: 300, h: 180 },
      { id: 'c', kind: 'overlay', key: 'hud', x: 9, y: -1, w: 10, h: 99999, scale: 9 },
      { id: 'd', kind: 'overlay', key: '../x', x: 0, y: 0, w: 300, h: 100 },
    ] });
    const ov = s.panels.filter(p => p.kind === 'overlay');
    expect(ov.map(p => [p.id, p.key])).toEqual([['a', 'charm'], ['c', 'hud']]);
    expect(ov[0].scale).toBe(1.25);
    expect(ov[1]).toMatchObject({ x: 1, y: 0, w: 80, h: 3000, scale: 2.5 });
    expect(s.panels.filter(p => p.kind === 'callouts')).toHaveLength(1);
    expect(s.panels.filter(p => p.kind === 'timers' && p.all)).toHaveLength(1);
  });
  it('loads the overlay\'s own page, marked as a canvas pane', () => {
    r.__setOv([{ key: 'charm', src: 'charm.html' }, { key: 'command', src: 'http://127.0.0.1:7779/overlay/command' }]);
    expect(r.ovSrc('charm')).toBe('charm.html?wpcanvas=1');
    expect(r.ovSrc('command')).toBe('http://127.0.0.1:7779/overlay/command?wpcanvas=1');
    expect(r.ovSrc('nope')).toBeNull();
  });
  it('a hidden overlay panel unloads its page; the page is scaled whole from outside', () => {
    // (A piece cut from an overlay, kind 'sect', loads the same page with its part named: canvas-sections.test.js.)
    // (An overlay panel also hands its page its look, p.style: the HUD's ring and box, canvas-real-presets.test.js.)
    expect(c).toMatch(/var want = p\.off \? 'about:blank' : \(\(p\.kind === 'sect' \? sectSrc\(p\) : ovSrc\(p\.key, p\.style\)\) \|\| 'about:blank'\);/);
    expect(c).toMatch(/e\.frame\.style\.width = Math\.round\(w \/ s\) \+ 'px';/);
    expect(c).toMatch(/e\.frame\.style\.transform = s === 1 \? '' : 'scale\(' \+ s \+ '\)';/);
  });
  it('＋ Overlay adds one, or brings in every overlay on screen at its spot, size and zoom', () => {
    expect(c).toMatch(/if \(t\.hasAttribute\('data-bringall'\)\) \{[\s\S]{0,160}if \(\(o\.showing \|\| o\.docked\) && addOverlay\(o, n\)\) n\+\+;/);
  });
  // Run for real: a window's spot, size and zoom carry over; a Dock pane (no window) comes in at 100%.
  it('each brought-in overlay keeps its window\'s spot, size and zoom; one without a window comes in whole', () => {
    const block = sliceBlock(canvas, '  var GROUPS = [', '  // ── Panels ──')
      + '\n' + sliceBlock(canvas, '  function addOverlay(o, n) {', '\n  }\n');
    const r2 = evalBlock('var window = {};\n' + block, ['addOverlay', '_layout']);
    const a = r2.addOverlay({ key: 'hud', label: 'DPS HUD', at: { x: 0.05, y: 0.55, w: 330, h: 230, zoom: 1.3 }, w: 320, h: 220 }, 0);
    expect(a).toMatchObject({ kind: 'overlay', key: 'hud', x: 0.05, y: 0.55, w: 330, h: 230, scale: 1.3 });
    const b = r2.addOverlay({ key: 'tank', label: 'Tank', at: null, w: 300, h: 280 }, 1);
    expect(b).toMatchObject({ key: 'tank', w: 300, h: 280, scale: 1 });
    expect(r2.addOverlay({ key: 'hud', label: 'again' }, 2)).toBeNull();
  });
});

describe('main: an overlay on the canvas has no window of its own', () => {
  const hosted = (cfg) => evalBlock(
    "var _CANVAS_CATALOG = [{ key: 'charm' }, { key: 'hud' }]; var canvasWindow = null; var screen = {};\n"
    + sliceBlock(main, 'function _canvasSpec(key)', '  return out;\n}'), ['_canvasHostedKeys'])._canvasHostedKeys(cfg);
  it('hosted = the overlay panels of the layout on screen, hidden ones included, only while the canvas is on', () => {
    const layout = { panels: [{ kind: 'overlay', key: 'charm', off: true }, { kind: 'overlay', key: 'hud' },
      { kind: 'overlay', key: 'nope' }, { kind: 'timers', key: 'charm' }] };
    expect(hosted({ showCanvas: true, canvasLastRes: '1920x1080', canvasLayouts: { '1920x1080': layout } })).toEqual(['charm', 'hud']);
    expect(hosted({ showCanvas: false, canvasLastRes: '1920x1080', canvasLayouts: { '1920x1080': layout } })).toEqual([]);
    expect(hosted({ showCanvas: true })).toEqual([]);
  });
  it('is checked before any force-show, so setup, unlock and blind never conjure a second copy', () => {
    const wanted = sliceBlock(m, 'function _overlayWanted(cfg, e) {', '\n}');
    const at = wanted.indexOf('if (_canvasHostedKeys(cfg).includes(e.key)) return false;');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(wanted.indexOf('if (_overlayForcedOn(cfg, e)) return true;'));
    expect(m).toMatch(/applyMeVisibility\(\);\s*_reapDisabledOverlays\(\);\s*\} else if \(!nowOn && _blindActive\)/);
    expect(m).toMatch(/applyMeVisibility\(\); applyOverlayInteractivity\(\);\s*try \{ _reapDisabledOverlays\(\); \}/);
  });
  it('the catalog is the dock\'s plus the HUD ring', () => {
    expect(m).toMatch(/const _CANVAS_CATALOG = _DOCK_CATALOG\.map\(c => Object\.assign\(\{\}, c\)\)\.concat\(\[\s*\{ key: 'me', label: 'HUD', file: 'me\.html', flag: 'showMe' \},/);
  });
  it('a newly hosted overlay switches its own flag on and leaves the Dock; a change re-applies visibility', () => {
    const save = sliceBlock(m, "ipcMain.handle('canvas-save', (e, layout) => {", '\n});');
    expect(save).toMatch(/const added = after\.filter\(k => !before\.includes\(k\)\);/);
    expect(save).toMatch(/if \(spec\) cfg\[spec\.flag\] = true;/);
    expect(save).toMatch(/cfg\.dockedOverlays = _dockedKeys\(cfg\)\.filter\(d => d !== k\);/);
    expect(save).toMatch(/if \(added\.length \|\| before\.some\(k => !after\.includes\(k\)\)\) \{\s*try \{ applyAllVisibility\(\); \}/);
  });
  it('a pane\'s own ✥ can never move the screen-sized canvas window', () => {
    const drag = sliceBlock(m, "ipcMain.handle('overlay-drag-start', (e) => {", '\n});');
    expect(drag).toMatch(/if \(win && win === canvasWindow\) return false;/);
  });
});

describe('preload: a canvas pane hands its corner controls to the canvas', () => {
  const p = stripJs(preload);
  it('knows it is on the canvas from ?wpcanvas=1, and only inside a frame', () => {
    const re = /[?&]wpcanvas=1(&|$)/;
    expect(p).toContain('const WP_IN_CANVAS = WP_IS_DOCKED && (() => {');
    expect(p).toContain(String(re).slice(1, -1));
    expect(re.test('?wpcanvas=1')).toBe(true);
    expect(re.test('?x=1&wpcanvas=1')).toBe(true);
    expect(re.test('?wpcanvas=10')).toBe(false);
  });
  it('hides the page\'s own ✥, ✕ and setup bar there', () => {
    expect(p).toContain("st.textContent = '#move-btn,#hide-btn,#drag-controls,#setupbar{display:none!important}';");
  });
});
