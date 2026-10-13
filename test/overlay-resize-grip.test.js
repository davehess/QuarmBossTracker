// ◢ resize corner on every overlay window (the guild lead, 2026-10-13: "Map needs a resize drag corner at the bottom
// right, as do all of the windows, to resize without having to setup").
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, stripJs, ROOT } from './_source-slice.js';

const PRELOAD = stripJs(readSource(path.join(ROOT, 'apps/mimic/preload.js')));
const MAIN = stripJs(readSource(path.join(ROOT, 'apps/mimic/main.js')));

describe('overlay resize corner', () => {
  it('the preload adds the grip to every ✥ overlay window, not a docked pane or the HUD, armed for click-through', () => {
    expect(PRELOAD).toMatch(/if \(WP_IS_DOCKED \|\| !document\.getElementById\('move-btn'\) \|\| _wpDockKey\(\) === 'me'\) return;/);
    expect(PRELOAD).toMatch(/g\.id = 'wp-grip';\s*g\.setAttribute\('data-wp-interact', ''\);/);
    expect(PRELOAD).toMatch(/ipcRenderer\.invoke\('overlay-resize-start'\);/);
    expect(PRELOAD).toMatch(/ipcRenderer\.invoke\('overlay-drag-end'\);/);
    expect(PRELOAD).toMatch(/:not\(#setupbar\):not\(#wp-grip\)/);   // the opacity fade leaves it solid
  });
  it('main sizes from the top-left inside the screen, records a height floor, and ends with the drag session', () => {
    expect(MAIN).toMatch(/ipcMain\.handle\('overlay-resize-start'/);
    const fn = MAIN.slice(MAIN.indexOf('function _startWindowResize('), MAIN.indexOf('function _uiStudioFilesFor('));
    expect(fn).toMatch(/x: b0\.x, y: b0\.y,/);
    expect(fn).toMatch(/Math\.min\(wa\.x \+ wa\.width - b0\.x,/);
    expect(fn).toMatch(/_noteUserResize\(s\.win, nb\);/);
    expect(fn).toMatch(/_startWindowDrag\(win\);/);
  });
});
