// test/mimic-hover-arm-watch.test.js — the safety net under the overlay hover handshake.
//
// The guild lead, 2026-11-03: "often when i alt tab and open a different window and switch back to everquest,
// sometimes clicks (right and left) dont make it to the game until i hide all overlays". An overlay made clickable
// while the pointer is on one of its controls was only put back to click-through by its own page; a lost "left"
// report kept it catching clicks, and for the screen-sized Canvas that is the whole screen. Main now keeps its own
// list of armed windows (apps/mimic/main.js _hoverArmed / _watchHoverArms / _disarmAllHover).
//
// Run: npx vitest run test/mimic-hover-arm-watch.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const main = readSource(path.join(ROOT, 'apps/mimic/main.js'));
const staleSrc = sliceBlock(main, 'const HOVER_ARM_RENEW_MS', '\n// What the lock state says');
const stale = new Function(staleSrc.replace(/const _hoverArmed[^\n]*\n/, '').replace(/let _hoverArmWatch[^\n]*\n/, '')
  + '\nreturn _hoverArmStale;')();

const T = 1_000_000;
const rec = { at: T, x: 500, y: 300 };

describe('_hoverArmStale', () => {
  it('a normal overlay stays armed while the pointer is inside it, and drops when it is outside', () => {
    expect(stale(rec, T + 10_000, { x: 1, y: 1 }, false, true)).toBe(false);
    expect(stale(rec, T + 10, { x: 500, y: 300 }, false, false)).toBe(true);
  });
  it('a screen-covering overlay stays armed within the renew window, whatever the pointer does', () => {
    expect(stale(rec, T + 1000, { x: 900, y: 900 }, true, true)).toBe(false);
  });
  it('past the renew window it stays armed only while the pointer has not moved', () => {
    expect(stale(rec, T + 5000, { x: 500, y: 300 }, true, true)).toBe(false);
    expect(stale(rec, T + 5000, { x: 501, y: 300 }, true, true)).toBe(true);
    expect(stale(rec, T + 5000, null, true, true)).toBe(true);
  });
  it('no record means disarm', () => {
    expect(stale(null, T, { x: 0, y: 0 }, false, true)).toBe(true);
  });
});

describe('wiring', () => {
  const code = stripJs(main);
  it('arming records the window and starts the watch', () => {
    const h = code.slice(code.indexOf("ipcMain.handle('overlay-hover-interactive'"));
    const body = h.slice(0, h.indexOf('\n});'));
    expect(body).toMatch(/_hoverArmed\.set\(win,/);
    expect(body).toMatch(/_watchHoverArms\(\)/);
    expect(body).toMatch(/_disarmHover\(win\)/);
  });
  it('a change of the front app disarms every overlay', () => {
    const d = code.slice(code.indexOf('const _focusDeb = _makeFocusDebouncer('));
    expect(d.slice(0, d.indexOf('}, FOCUS_LOST_DEBOUNCE_MS)'))).toMatch(/_disarmAllHover\(\)/);
  });
  it('the restore keeps single-overlay setup interactive and the Canvas click-through', () => {
    const r = code.slice(code.indexOf('function _restoreClickThrough('));
    const body = r.slice(0, r.indexOf('\nfunction _disarmHover('));
    expect(body).toMatch(/_inSingleSetup\(win\)\) \{ win\.setIgnoreMouseEvents\(false\)/);
    expect(body).toMatch(/win === canvasWindow/);
  });
});
