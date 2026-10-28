// Top-right resize corner on grow-upward overlays (the guild lead, 2026-10-14: "when grow upwards is on, we should be
// able to drag the top right corner of overlays while not hitting the X button").
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, stripJs, sliceBlock, evalBlock, ROOT } from './_source-slice.js';

const MAIN_RAW = readSource(path.join(ROOT, 'apps/mimic/main.js'));
const PRELOAD_RAW = readSource(path.join(ROOT, 'apps/mimic/preload.js'));
const MAIN = stripJs(MAIN_RAW);
const PRELOAD = stripJs(PRELOAD_RAW);

const { _resizeUpBounds } = evalBlock(sliceBlock(MAIN_RAW, 'function _resizeUpBounds(', '\n}\n'), ['_resizeUpBounds']);
const WA = { x: 0, y: 0, width: 1920, height: 1040 };
const B0 = { x: 400, y: 600, width: 300, height: 200 };   // bottom edge at 800

describe('resize math for the top-right grip', () => {
  it('dragging up and right grows the window and the bottom edge does not move', () => {
    const nb = _resizeUpBounds(B0, 50, -120, WA, null);
    expect(nb).toEqual({ x: 400, y: 480, width: 350, height: 320 });
    expect(nb.y + nb.height).toBe(B0.y + B0.height);
  });
  it('keeps the bottom edge fixed for any drag, including past the screen top', () => {
    for (const [dx, dy] of [[0, 0], [-90, 40], [500, -9999], [-9999, 9999], [30, -700]]) {
      const nb = _resizeUpBounds(B0, dx, dy, WA, null);
      expect(nb.y + nb.height).toBe(800);
      expect(nb.x).toBe(400);
    }
  });
  it('stops at the top of the screen and the right edge of the screen', () => {
    const nb = _resizeUpBounds(B0, 9999, -9999, WA, null);
    expect(nb.y).toBe(WA.y);
    expect(nb.x + nb.width).toBe(WA.x + WA.width);
  });
  it('respects the 120x60 floor, and a larger minimum the window sets for itself', () => {
    const tiny = _resizeUpBounds(B0, -9999, 9999, WA, null);
    expect([tiny.width, tiny.height]).toEqual([120, 60]);
    expect(tiny.y + tiny.height).toBe(800);
    const wide = _resizeUpBounds(B0, -9999, 9999, WA, { width: 260, height: 150 });
    expect([wide.width, wide.height]).toEqual([260, 150]);
    expect(wide.y + wide.height).toBe(800);
  });
});

describe('the grip is there only while grow-up is on, and clear of the ✕', () => {
  it('is created on grow-up on, removed on off, and driven by the push and the load-time pull', () => {
    const fn = PRELOAD.slice(PRELOAD.indexOf('function _wpApplyGrowUp('), PRELOAD.indexOf("ipcRenderer.on('wp-growup'"));
    expect(fn).toMatch(/if \(!on\) \{ if \(g\) g\.remove\(\); return; \}/);
    expect(fn).toMatch(/g\.id = 'wp-grip-top';\s*g\.setAttribute\('data-wp-interact', ''\);/);
    expect(fn).toMatch(/ipcRenderer\.invoke\('overlay-resize-up-start'\);/);
    expect(fn).toMatch(/ipcRenderer\.invoke\('overlay-drag-end'\);/);
    expect(fn).toMatch(/cursor:nesw-resize/);
    // same eligibility as the bottom-right grip: not a docked pane, needs the ✥, not the HUD
    expect(fn).toMatch(/if \(WP_IS_DOCKED \|\| !document\.getElementById\('move-btn'\) \|\| _wpDockKey\(\) === 'me'\) return;/);
    expect(PRELOAD).toMatch(/ipcRenderer\.on\('wp-growup', function \(_e, on\) \{ _wpApplyGrowUp\(on\); \}\);/);
    expect(PRELOAD).toMatch(/if \(s && s\.growUp\) _wpApplyGrowUp\(true\);/);
    expect(PRELOAD).toMatch(/:not\(#wp-grip\):not\(#wp-grip-top\)/);   // the opacity fade leaves it solid
  });
  it('main pushes the state when ⬆ Grow upward (or the trigger overlay timer order) flips it', () => {
    expect(MAIN).toMatch(/win\.webContents\.send\('wp-growup', !!map\[key\]\);/);
    expect(MAIN).toMatch(/triggerWindow\.webContents\.send\('wp-growup', !cfg\.triggerTimersTopDown\);/);
    expect(MAIN).toMatch(/ipcMain\.handle\('overlay-resize-up-start'/);
  });
  it('the grip box and the ✕ box never overlap, and the ✕ only moves while grow-up is on', () => {
    const { _WP_GROWUP_GRIP, _WP_GROWUP_HIDE_RIGHT } =
      evalBlock(sliceBlock(PRELOAD_RAW, 'const _WP_GROWUP_GRIP', '_WP_GROWUP_GRIP + 2;'), ['_WP_GROWUP_GRIP', '_WP_GROWUP_HIDE_RIGHT']);
    for (const f of ['overlay.html', 'buffqueue.html', 'triggers.html', 'melody.html', 'extarget.html']) {
      const css = readSource(path.join(ROOT, 'apps/mimic', f));
      const rule = css.match(/#(?:move-btn,#)?hide-btn\{[^}]*\}/g).find((r) => /width:\d+px/.test(r));
      const size = +rule.match(/width:(\d+)px/)[1];
      const top = +rule.match(/top:(\d+)px/)[1];
      const W = 400;                                           // any window width: only the offsets from the right edge matter
      const grip = { l: W - _WP_GROWUP_GRIP, r: W, t: 0, b: _WP_GROWUP_GRIP };
      const x = { l: W - _WP_GROWUP_HIDE_RIGHT - size, r: W - _WP_GROWUP_HIDE_RIGHT, t: top, b: top + size };
      const overlap = grip.l < x.r && x.l < grip.r && grip.t < x.b && x.t < grip.b;
      expect(overlap, f).toBe(false);
      // and the untouched ✕ (right:6px) really WOULD sit under the grip, which is why it steps aside
      const plain = { l: W - 6 - size, r: W - 6, t: top, b: top + size };
      expect(grip.l < plain.r && plain.l < grip.r && grip.t < plain.b && plain.t < grip.b, f).toBe(true);
    }
    expect(PRELOAD).toMatch(/body\.wp-growup #hide-btn\{right:' \+ _WP_GROWUP_HIDE_RIGHT \+ 'px !important\}/);
    expect(PRELOAD).not.toMatch(/\n\s*document\.body\.classList\.add\('wp-growup'\)/);   // only _wpApplyGrowUp toggles it
  });
});

// ▭ A folded window (one title row tall) keeps its row height and both its edges while the ◥ grip sizes it in width
// (the guild lead, 2026-10-28: "minimized overlays need to be draggable and resizable still"). The 60px floor would
// otherwise stretch it on the first step, and the bottom-anchored arithmetic would raise its top.
describe('the top-right grip on a folded window', () => {
  const ROW = { x: 400, y: 900, width: 300, height: 32 };   // bottom edge at 932
  it('sizes in width alone: height and top stay, whatever the vertical travel', () => {
    for (const dy of [-700, -40, 0, 25, 9999]) {
      const nb = _resizeUpBounds(ROW, 70, dy, WA, null, true);
      expect(nb).toEqual({ x: 400, y: 900, width: 370, height: 32 });
    }
  });
  it('keeps the width floor (120, or the window\'s own minimum) and the screen edge', () => {
    expect(_resizeUpBounds(ROW, -9999, 0, WA, null, true).width).toBe(120);
    expect(_resizeUpBounds(ROW, -9999, 0, WA, { width: 260, height: 24 }, true).width).toBe(260);
    expect(_resizeUpBounds(ROW, 9999, 0, WA, null, true).width).toBe(1920 - 400);
  });
  it('an unfolded window is unchanged by the new argument', () => {
    expect(_resizeUpBounds(B0, 50, -120, WA, null, false)).toEqual({ x: 400, y: 480, width: 350, height: 320 });
    expect(_resizeUpBounds(B0, 50, -120, WA, null)).toEqual({ x: 400, y: 480, width: 350, height: 320 });
  });
  it('the session passes the window\'s folded flag', () => {
    expect(MAIN).toMatch(/_resizeUpBounds\(b0, cur\.x - c0\.x, cur\.y - c0\.y, wa, \{ width: mw, height: mh \}, !!s\.win\.__wpFolded\)/);
  });
});
