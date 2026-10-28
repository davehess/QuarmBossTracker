// test/canvas-tall-clamp.test.js — Canvas pieces: tall boxes reach the bottom, and "Keep inside the screen" can be off.
//
// The guild lead, 2026-10-21: "can't move the canvas command center down below the middle part of the screen"
// (a 1121 px box, ~120 px of content: the clamp kept its WHOLE configured box inside the canvas), then "if it's
// set to grow up, it still can't go further down on the screen. that bottom blocking should be toggleable".
//   - a TALL box (over half the screen) is held by a 120 px strip, grows down and grows up alike; the grows-up
//     one may also hang its empty head off the TOP, so a saved x / y can now be negative (POS_MIN);
//   - `free: true` ("Keep inside the screen: off") drops the edge clamp on both axes — only a 40 px strip stays;
//   - everything saved before reads exactly where it was.
// Runs the REAL sanitize / toWindow / toDisk / fitRect / yBounds / xBounds sliced out of canvas.html.
// Run: npx vitest run test/canvas-tall-clamp.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const canvas = readSource(path.join(ROOT, 'apps', 'mimic', 'canvas.html'));
const block = sliceBlock(canvas, '  var GROUPS = [', '  // ── Panels ──');
const R = evalBlock('var window = {};\nfunction pdefOf() { return null; }\n' + block + '\nfunction __scr(s) { _screens = s; }',
  ['sanitize', 'screenList', 'fitRect', 'yBounds', 'xBounds', 'toWindow', 'toDisk', 'sizeMax', 'widthRange', 'setWidth', 'setHeight']);

const one = [{ sig: '', x: 0, y: 0, w: 1920, h: 1080, home: true }];
const san = (panels) => { const l = R.sanitize({ panels }); return panels.map(q => l.panels.find(x => x.id === q.id)); };
const part = (o) => Object.assign({ id: 'p1', kind: 'part', part: 'me.hp', x: 0.5, y: 0.5, w: 200, h: 40 }, o);

describe('a tall configured box (1121 px) on a 1080 px screen, grows down', () => {
  it('its top can reach 900 px, the box itself is cut to the screen', () => {
    const f = R.fitRect(one, 100, 900, 320, 1121, false, false);
    expect(f.y).toBe(900);
    expect(f.h).toBe(1080);
  });
  it('the top cannot go past (screen - 120): the strip must remain; nor above the screen', () => {
    expect(R.fitRect(one, 100, 1075, 320, 1121, false, false).y).toBe(960);
    expect(R.fitRect(one, 100, -50, 320, 1121, false, false).y).toBe(0);
  });
  it('on the second of two screens the strip is that screen\'s', () => {
    const two = [{ sig: 'a', x: 0, y: 0, w: 1920, h: 1080, home: true }, { sig: 'b', x: 1920, y: 0, w: 1920, h: 1080 }];
    expect(R.fitRect(two, 2100, 1070, 320, 1121, false, false).y).toBe(960);
  });
});

describe('a tall box that grows UP reaches the bottom too, and its empty head may hang off the top', () => {
  it('its top can sit low (strip kept), and its bottom edge can be at the screen bottom', () => {
    expect(R.fitRect(one, 100, 900, 320, 1121, true, false).y).toBe(900);
    expect(R.fitRect(one, 100, 0, 320, 1121, true, false).y).toBe(0);   // bottom edge exactly at the screen bottom
  });
  it('the head may hang off the top until only 120 px of the box is left', () => {
    expect(R.fitRect(one, 100, -2000, 320, 1121, true, false).y).toBe(120 - 1080);
    expect(R.fitRect(one, 100, 5000, 320, 1121, true, false).y).toBe(960);
  });
});

describe('normal-sized boxes keep the whole-box clamp', () => {
  it('a 300 px box stops at screen - 300, up or down', () => {
    expect(R.fitRect(one, 100, 1000, 320, 300, false, false).y).toBe(780);
    expect(R.fitRect(one, 100, 1000, 320, 300, true, false).y).toBe(780);
    expect(R.yBounds(0, 1080, 300, true, false)).toEqual({ lo: 0, hi: 780 });
    expect(R.fitRect(one, 1900, 100, 320, 300, true, false).x).toBe(1600);
  });
  it('a box of exactly half the screen is still whole-clamped', () => {
    expect(R.yBounds(0, 1080, 540, false, false)).toEqual({ lo: 0, hi: 540 });
  });
});

describe('Keep inside the screen: OFF', () => {
  it('a normal piece can sit mostly off every edge; a 40 px strip stays on the screen', () => {
    expect(R.fitRect(one, 100, 2000, 320, 300, false, true).y).toBe(1040);                 // below: 40 px of its top left
    expect(R.fitRect(one, 100, -2000, 320, 300, false, true).y).toBe(40 - 300);            // above: 40 px of its bottom left
    expect(R.fitRect(one, 5000, 100, 320, 300, false, true).x).toBe(1920 - 40);            // right
    expect(R.fitRect(one, -5000, 100, 320, 300, false, true).x).toBe(40 - 320);            // left
  });
  it('it is not cut to the screen either', () => {
    const f = R.fitRect(one, 0, 0, 5000, 5000, false, true);
    expect([f.w, f.h]).toEqual([5000, 5000]);
  });
  it('off is stored only when chosen', () => {
    const out = san([part({ free: true }), part({ id: 'p2' }), part({ id: 'p3', free: 'yes' })]);
    expect(out.map(p => p.free)).toEqual([true, undefined, undefined]);
  });
});

describe('Keep inside the screen also governs RESIZING', () => {
  const ov = (o) => Object.assign({ id: 'o1', kind: 'overlay', key: 'dps', x: 0.5, y: 0.5, w: 300, h: 200 }, o);
  it('ON: width and height are cut to the screen; OFF: only the saved caps (4000 / 3000) apply', () => {
    expect(R.widthRange(ov(), 1920)).toEqual([80, 1920]);
    expect(R.widthRange(ov({ free: true }), 1920)).toEqual([80, 4000]);
    expect(R.sizeMax(ov(), 3000, 1080)).toBe(1080);
    expect(R.sizeMax(ov({ free: true }), 3000, 1080)).toBe(3000);
  });
  it('the width stepper / presets: past the screen only when off, never under the minimum', () => {
    const on = ov(), off = ov({ free: true });
    R.setWidth(on, 9000, 1920); R.setWidth(off, 9000, 1920);
    expect([on.w, off.w]).toEqual([1920, 4000]);
    R.setWidth(off, 5, 1920);
    expect(off.w).toBe(80);
  });
  it('the height stepper: same, and a grows-up piece keeps its bottom edge, off the top when off', () => {
    const on = ov({ anchor: 'bottom', y: 0.1 }), off = ov({ anchor: 'bottom', y: 0.1, free: true });
    R.setHeight(on, 2500, 1080); R.setHeight(off, 2500, 1080);
    expect([on.h, off.h]).toEqual([1080, 2500]);
    expect(on.y).toBe(0);
    expect(off.y).toBeLessThan(0);
    R.setHeight(off, 1, 1080);
    expect(off.h).toBe(36);
  });
  it('the drags, fits and Take apart read the flag (source)', () => {
    const c = stripJs(canvas);
    expect(c).toMatch(/Math\.min\(sizeMax\(dp, 4000, W - d\.x0\)/);
    expect(c).toMatch(/Math\.min\(sizeMax\(dp, 3000, H - d\.y0\)/);
    expect(c).toMatch(/gfree \? 4000 : W - d\.box\.x/);
    expect(c).toMatch(/Math\.min\(sizeMax\(p, 3000, H - top\), need\)/);
    expect(c).toMatch(/pfree \? -Infinity : sr\.y/);
    expect(c).toMatch(/lock: p\.lock, free: p\.free, corner: p\.corner, back: p\.back/);
    expect(c).toMatch(/free: o\.free === true \? true : undefined/);
    expect(c).toMatch(/Resizing follows/);
  });
});

describe('saved positions', () => {
  it('a layout saved before this loads exactly where it was', () => {
    const out = san([part({ x: 0.31, y: 0.16 }), part({ id: 'p2', x: 1, y: 0 }), part({ id: 'p3', x: 7, y: -9 })]);
    expect(out.map(p => [p.x, p.y])).toEqual([[0.31, 0.16], [1, 0], [1, -4]]);
    const list = R.screenList(1920, 1080);
    const mem = R.toWindow(JSON.parse(JSON.stringify({ panels: out.slice(0, 2) })), list, 1920, 1080);
    expect(mem.panels.map(p => [p.x, p.y])).toEqual([[0.31, 0.16], [1, 0]]);
  });
  it('a negative y (a grows-up head hanging off the top) survives save and load', () => {
    const list = R.screenList(1920, 1080);
    const mem = { panels: [part({ x: 0.1, y: -0.5, w: 320, h: 1080 })] };
    const disk = R.toDisk(mem, list, 1920, 1080);
    expect(disk.panels[0].y).toBe(-0.5);
    expect(san(disk.panels)[0].y).toBe(-0.5);
  });
});

describe('the drag paths and the panel use it', () => {
  const c = stripJs(canvas);
  it('place, the single drag and the group drag all clamp through yBounds / xBounds with the flag', () => {
    expect(c).toMatch(/fitRect\(screenList\(W, H\)[^;]*, cb\.h, growsUp\(p\), isFree\(p\)\);/);
    expect(c).toMatch(/yb = yBounds\(0, H, d\.h0, [^;]*dfree\)/);
    expect(c).toMatch(/myb = yBounds\(0, H, r\.offsetHeight, [^;]*mfree\)/);
  });
  it('the edit panel has the toggle, in the Position section next to Lock in place', () => {
    expect(c).toMatch(/data-free/);
    expect(c).toMatch(/t\.hasAttribute\('data-free'\)\) \{ if \(isFree\(p\)\) delete p\.free; else p\.free = true; \}/);
  });
});
