// test/fit-height-holds-width.test.js — "fit height to content" changes height only; the width it writes is held.
//
// The guild lead, 2026-10-09: a member's Target Info and Extended Target, on a smaller second monitor, changed width
// after turning on fit height. overlay-auto-height wrote getBounds().width back on every content change, and on a
// screen with a different Windows scaling % that read-back can be off by a pixel, so the width crept fit by fit.
//
// Run: npx vitest run test/fit-height-holds-width.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const main = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const { _fitHeldWidth } = evalBlock(sliceBlock(main, 'function _fitHeldWidth(win, readW) {', '\n}'), ['_fitHeldWidth']);

describe('fit height holds the width', () => {
  it('a read-back off by a pixel or three keeps the held width, so it cannot creep', () => {
    const win = {};
    expect(_fitHeldWidth(win, 320)).toBe(320);        // first fit: holds what the window is
    let w = 320;
    for (let i = 0; i < 50; i++) {                    // fifty fits, each read back one px narrower than written
      w = _fitHeldWidth(win, w - 1);
      expect(w).toBe(320);
    }
    expect(_fitHeldWidth(win, 323)).toBe(320);
    expect(_fitHeldWidth(win, 317)).toBe(320);
  });
  it('a real resize (the user dragging, or a size preset) is taken and held from then on', () => {
    const win = {};
    _fitHeldWidth(win, 320);
    expect(_fitHeldWidth(win, 420)).toBe(420);
    expect(_fitHeldWidth(win, 419)).toBe(420);
    expect(_fitHeldWidth(win, 260)).toBe(260);
  });
  it('overlay-auto-height writes the held width, not getBounds().width', () => {
    const block = stripJs(sliceBlock(main, "ipcMain.handle('overlay-auto-height'", '\n});'));
    expect(block).toMatch(/win\.setBounds\(\{ x: bounds\.x, y, width: _fitHeldWidth\(win, bounds\.width\), height: target \}\)/);
    expect(block).not.toMatch(/width: bounds\.width/);
  });
});
