// The stand-in pointer over click-through overlays (apps/mimic/preload.js).
// The guild lead, 2026-10-12: "we should show a mouse when we mouseover the map window, otherwise we lose it behind
// in the EQ window. the same should apply with any of the overlays." EQ draws its own pointer inside its 3D scene,
// under every overlay window, so over a SOLID part of an overlay it is covered; over a see-through part it shows.
// Run: npx vitest run test/overlay-ghost-cursor.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, evalBlock, ROOT } from './_source-slice.js';

const PRELOAD = readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js'));

// canvas = the Canvas window: a #panels host whose <body> says data-wp-overlay.
function load(backdrop = false, canvas = false) {
  const src = sliceBlock(PRELOAD, 'function _wpAlpha(bg) {', '\n}') + '\n' + sliceBlock(PRELOAD, 'function _wpOverSolid(el) {', '\n}');
  const prelude = `const document = { documentElement: { nodeType: 1 },
      getElementById: (id) => (${canvas} && id === 'panels') ? {} : null,
      body: { hasAttribute: (a) => ${canvas} && a === 'data-wp-overlay', classList: { contains: (c) => c === 'wp-backdrop' && ${backdrop} } } };
    const getComputedStyle = (el) => ({ backgroundColor: el.bg || 'rgba(0, 0, 0, 0)' });\n`;
  return evalBlock(prelude + src, ['_wpAlpha', '_wpOverSolid']);
}
// A tiny element chain: child -> ... -> <html>.
function chain(...specs) {
  let parent = null;
  const html = { nodeType: 1, tagName: 'HTML' };
  for (let i = specs.length - 1; i >= 0; i--) {
    const el = Object.assign({ nodeType: 1, tagName: 'DIV', parentElement: parent || null }, specs[i]);
    parent = el;
  }
  // the outermost gets <html> as its parent, which stops the walk
  let top = parent; while (top.parentElement) top = top.parentElement; top.parentElement = html;
  return parent;
}

describe('stand-in pointer: where EQ\'s own pointer is hidden', () => {
  const H = load();
  it('reads background alpha (transparent, rgba, rgb)', () => {
    expect(H._wpAlpha('rgba(0, 0, 0, 0)')).toBe(0);
    expect(H._wpAlpha('rgba(14, 17, 22, 0.85)')).toBeCloseTo(0.85);
    expect(H._wpAlpha('rgb(13, 17, 23)')).toBe(1);
    expect(H._wpAlpha('transparent')).toBe(0);
  });
  it('solid: anything sitting on a background at least 35% opaque (the Map\'s panel, a panel\'s text)', () => {
    expect(H._wpOverSolid(chain({ tagName: 'CANVAS' }, { bg: 'rgba(19, 26, 38, 0.9)' }))).toBe(true);   // the Map
    expect(H._wpOverSolid(chain({ tagName: 'SPAN' }, { bg: 'rgba(14, 17, 22, 0.6)' }))).toBe(true);
  });
  it('a bare canvas or picture is NOT solid: the HUD ring is a window-sized canvas over open game (the left-behind arrow, 2026-10-12)', () => {
    expect(H._wpOverSolid(chain({ tagName: 'CANVAS' }))).toBe(false);
    expect(H._wpOverSolid(chain({ tagName: 'IMG' }))).toBe(false);
  });
  it('see-through: floating text on a transparent window gets no stand-in (EQ\'s pointer shows there)', () => {
    expect(H._wpOverSolid(chain({ tagName: 'SPAN' }, { bg: 'rgba(0, 0, 0, 0.2)' }, {}))).toBe(false);
  });
  it('the solid backdrop setting makes the whole window solid', () => {
    expect(load(true)._wpOverSolid(chain({ tagName: 'SPAN' }))).toBe(true);
  });
  it('is drawn only while locked, never over an armed control, and hidden when the pointer leaves', () => {
    const js = stripJs(PRELOAD);
    expect(js).toMatch(/if \(!_wpPointerOn \|\| _wpPointerNever \|\| !_wpLocked \|\| _wpHoverArmed \|\| !_wpOverSolid\(ev\.target\)\) \{ _wpGhostHide\(\); return; \}/);
    expect(js).toMatch(/ipcRenderer\.on\('overlay-locked', function \(_e, locked\) \{ _wpLocked = !!locked;/);
    expect(js).toMatch(/if \(!ev\.relatedTarget\) _wpGhostHide\(\);/);
    expect(js).toMatch(/pointer-events:none/);
    expect(js).toMatch(/document\.documentElement\.appendChild\(_wpGhost\)/);   // outside <body>: themes never recolour it
  });
  // The guild lead, 2026-10-13: "make mouse over configurable, and remove it from the HUD. for Canvas it should only
  // show over the elements".
  it('Canvas: only over a panel, never the open screen between panels (backdrop on or off)', () => {
    const panel = (extra) => chain(Object.assign({ tagName: 'SPAN', closest: () => ({}) }, extra || {}));
    const open = (extra) => chain(Object.assign({ tagName: 'DIV', closest: () => null }, extra || {}));
    const C = load(false, true), CB = load(true, true);
    expect(C._wpOverSolid(open({ bg: 'rgba(0, 0, 0, 0.9)' }))).toBe(false);
    expect(CB._wpOverSolid(open())).toBe(false);                 // the backdrop plates the panels, not the screen
    expect(CB._wpOverSolid(panel())).toBe(true);
    expect(C._wpOverSolid(panel({ bg: 'rgba(8, 10, 14, 0.9)' }))).toBe(true);
    expect(stripJs(PRELOAD)).toMatch(/el\.closest\('#panels > \.panel'\)/);
  });
  it('never on the HUD; one switch for every overlay, pulled at load and pushed live to every frame', () => {
    const js = stripJs(PRELOAD);
    expect(js).toMatch(/const _wpPointerNever = _wpDockKey\(\) === 'me';/);
    expect(js).toMatch(/ipcRenderer\.on\('wp-pointer', function \(_e, on\) \{ _wpPointerOn = on !== false; if \(!_wpPointerOn\) _wpGhostHide\(\); \}\);/);
    expect(js).toMatch(/if \(s && s\.pointer === false\) _wpPointerOn = false;/);
    const main = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')));
    expect(main).toMatch(/pointer: cfg\.standInPointer !== false,/);
    expect(main).toMatch(/for \(const f of frames\) \{ try \{ f\.send\('wp-pointer', on\); \}/);   // the Canvas's panel frames too
    expect(main).toMatch(/if \(incoming && Object\.prototype\.hasOwnProperty\.call\(incoming, 'standInPointer'\)\) _broadcastPointer\(merged\);/);
    expect(main).toMatch(/label: 'Show a mouse pointer over overlays', type: 'checkbox', checked: loadConfig\(\)\.standInPointer !== false/);   // tray
    const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
    expect(dash).toMatch(/<input id="wpStandInPointer" type="checkbox" checked/);                  // dashboard parity
    expect(dash).toMatch(/window\.mimic\.saveConfig\(\{ standInPointer: !!sipEl\.checked \}\)/);
  });
  it('once the mousemoves stop, it asks main whether the mouse is still over the window and hides when not', () => {
    const js = stripJs(PRELOAD);
    expect(js).toMatch(/ipcRenderer\.invoke\('overlay-cursor-inside'\)\.then\(function \(inside\) \{ if \(!inside\) _wpGhostHide\(\); \}, _wpGhostHide\);/);
    expect(js).toMatch(/_wpGhostWatch\(\);\n\}, \{ capture: true, passive: true \}\);/);
    const main = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')));
    // The cursor test is one shared helper (mouse-over opacity polls with it too); the handler only asks it.
    expect(main).toContain("ipcMain.handle('overlay-cursor-inside', (e) => _cursorInsideWindow(BrowserWindow.fromWebContents(e.sender)));");
    const h = sliceBlock(main, 'function _cursorInsideWindow(win) {', '\n}\n');
    expect(h).toMatch(/screen\.getCursorScreenPoint\(\), b = win\.getBounds\(\);/);
    expect(h).toMatch(/p\.x >= b\.x && p\.x < b\.x \+ b\.width && p\.y >= b\.y && p\.y < b\.y \+ b\.height/);
  });
});
