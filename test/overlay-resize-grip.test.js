// ◢ resize corner on every overlay window (the guild lead, 2026-10-13: "Map needs a resize drag corner at the bottom
// right, as do all of the windows, to resize without having to setup").
//
// And on a FOLDED one (the guild lead, 2026-10-28: "minimized overlays need to be draggable and resizable still"). The rule
// held here: a folded window (▭ Fold: one title row tall) sizes in WIDTH alone, its height stays the row's, and its ◢ is a
// strip along the bottom edge that ends where the ✕ begins. A designed mini (both axes) keeps the plain corner.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, stripJs, sliceBlock, evalBlock, ROOT } from './_source-slice.js';

const PRELOAD_RAW = readSource(path.join(ROOT, 'apps/mimic/preload.js'));
const MAIN_RAW = readSource(path.join(ROOT, 'apps/mimic/main.js'));
const PRELOAD = stripJs(PRELOAD_RAW);
const MAIN = stripJs(MAIN_RAW);

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

// ── the sizing rule, RUN ──────────────────────────────────────────────────────────────────────────────────────────
const { _resizeBounds } = evalBlock(sliceBlock(MAIN_RAW, 'function _resizeBounds(', '\n}\n'), ['_resizeBounds']);
const WA = { x: 0, y: 0, width: 1920, height: 1040 };
const B0 = { x: 400, y: 600, width: 300, height: 200 };

describe('the ◢ drag, unfolded and folded', () => {
  it('an unfolded window sizes both ways from its top-left, as it always did', () => {
    expect(_resizeBounds(B0, 50, 70, WA, false)).toEqual({ x: 400, y: 600, width: 350, height: 270 });
    expect(_resizeBounds(B0, -9999, -9999, WA, false)).toEqual({ x: 400, y: 600, width: 120, height: 60 });   // the 120x60 floor
    const far = _resizeBounds(B0, 9999, 9999, WA, false);
    expect([far.x + far.width, far.y + far.height]).toEqual([1920, 1040]);                                     // inside the work area
  });
  it('a folded window follows the cursor in width and keeps its row height for ANY vertical travel', () => {
    const row = { x: 400, y: 900, width: 300, height: 32 };
    for (const dy of [-500, -40, 0, 8, 200, 9999]) {
      const nb = _resizeBounds(row, 80, dy, WA, true);
      expect(nb.height).toBe(32);             // not stretched to the 60px floor on the first step
      expect(nb.width).toBe(380);
      expect([nb.x, nb.y]).toEqual([400, 900]);
    }
  });
  it('a folded window still stops at 120 wide and at the right edge of the screen', () => {
    const row = { x: 1500, y: 900, width: 300, height: 32 };
    expect(_resizeBounds(row, -9999, 0, WA, true).width).toBe(120);
    expect(_resizeBounds(row, 9999, 0, WA, true).width).toBe(1920 - 1500);
  });
  it('the grip session asks the window whether it is folded, every step', () => {
    const fn = sliceBlock(MAIN, 'function _startWindowResize(', '\n}\n');
    expect(fn).toMatch(/_resizeBounds\(b0, cur\.x - c0\.x, cur\.y - c0\.y, wa, !!s\.win\.__wpFolded\)/);
  });
});

// ── the grip's place in a folded window ───────────────────────────────────────────────────────────────────────────
// Measured on the real pages in Chromium (the ◢ sat on the ✕'s lower-right corner: a press there started a resize, not a
// hide). Here: the numbers that keep it off, for every overlay page. A folded window is at least 32px tall (preload's
// _wpFoldSync), the ✕ is `top` + its size from the top, and the strip is GRIP_H from the bottom.
describe('a folded window\'s grip strip clears the ✕ and the ✥', () => {
  const css = PRELOAD.slice(PRELOAD.indexOf('const _WP_MINI_CSS'), PRELOAD.indexOf('function _wpApplyMini('));
  const rule = css.match(/body\.wp-fold #wp-grip\{width:(\d+)px;height:(\d+)px;cursor:ew-resize;/);
  it('is a width-resize strip, shaped for it', () => {
    expect(rule).not.toBeNull();
    expect(css).toMatch(/body\.wp-fold #wp-grip-top\{cursor:ew-resize\}/);
  });
  it('the fold keeps the corner controls and every grip (they are the whole window)', () => {
    const keep = PRELOAD.match(/const _WP_FOLD_KEEP = ([^;]*);/)[1];
    for (const id of ['#move-btn', '#hide-btn', '#wp-grip', '#wp-grip-top']) expect(keep).toContain(id);
  });
  it('they are not left at the 12% fade a designed mini has (a folded window has no data to read behind them)', () => {
    expect(css).toMatch(/body\.wp-fold #move-btn,body\.wp-fold #hide-btn,body\.wp-fold #wp-grip,body\.wp-fold #wp-grip-top\{opacity:0\.6\}/);
    // and it comes AFTER the mini fade, same specificity, so it is the one that wins; hover (more specific) still goes to 1
    expect(css.indexOf('body.wp-fold #move-btn')).toBeGreaterThan(css.indexOf('body.wp-mini #move-btn'));
    expect(css.indexOf('body.wp-mini:hover #move-btn')).toBeGreaterThan(-1);
  });
  it('on every overlay page the strip (bottom 8px of a 32px window) and the ✕ / ✥ boxes never overlap', () => {
    const GRIP_W = +rule[1], GRIP_H = +rule[2], W = 400, H = 32;
    const grip = { l: W - GRIP_W, r: W, t: H - GRIP_H, b: H };
    const dir = path.join(ROOT, 'apps/mimic');
    const pages = fs.readdirSync(dir).filter((f) => f.endsWith('.html'))
      .filter((f) => /id="move-btn"/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
      .filter((f) => !['dock.html', 'me.html'].includes(f));   // the dock is one window of panes; the HUD ring sizes its own window, so neither has a ◢
    expect(pages.length).toBeGreaterThanOrEqual(16);
    for (const f of pages) {
      const html = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const [id, side] of [['hide-btn', 'right'], ['move-btn', 'left']]) {
        // every plain rule whose selector list names the control (not :hover, not body.setup), declarations merged in order
        let r = '';
        for (const m of html.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
          if (m[1].split(',').some((s) => s.trim() === '#' + id)) r += m[2] + ';';
        }
        const size = +r.match(/width:(\d+)px/)[1], top = +r.match(/top:(\d+)px/)[1];
        const off = +r.match(new RegExp('(?:^|[;\\s])' + side + ':(\\d+)px'))[1];
        const box = side === 'right' ? { l: W - off - size, r: W - off, t: top, b: top + size } : { l: off, r: off + size, t: top, b: top + size };
        expect(grip.l < box.r && box.l < grip.r && grip.t < box.b && box.t < grip.b, f + ' ' + id).toBe(false);
      }
    }
  });
});
