// test/canvas-tall-clamp.test.js — a Canvas piece with a tall configured box can be placed low on the screen.
//
// The guild lead, 2026-10-21: "can't move the canvas command center down below the middle part of the screen."
// The piece was configured 1121 px high (grows down, Fit height off) with ~120 px of content; the drag and the
// saved-position restore (place -> fitRect) kept its WHOLE box inside the canvas, so on a 1080 px screen its top
// could never go lower than (screen - height). A tall box is now held by a grab strip instead (yBounds).
//
// Runs the REAL fitRect / yBounds / screenAt sliced out of canvas.html. Run: npx vitest run test/canvas-tall-clamp.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const canvas = readSource(path.join(ROOT, 'apps', 'mimic', 'canvas.html'));
const slice = (start, end = '\n  }\n') => sliceBlock(canvas, start, end);
const { fitRect, yBounds } = evalBlock(
  slice('  function screenAt(list, cx, cy) {') + '\n' + slice('  var TALL_GRAB = 120;', '\n') + '\n' +
  slice('  function yBounds(rTop, rH, h, up) {') + '\n' + slice('  function fitRect(list, left, top, w, h, up) {'),
  ['fitRect', 'yBounds']);

const one = [{ sig: '', x: 0, y: 0, w: 1920, h: 1080, home: true }];

describe('a tall configured box (1121 px) on a 1080 px screen, grows down', () => {
  it('its top can reach 900 px — a grab strip stays on screen', () => {
    const f = fitRect(one, 100, 900, 320, 1121, false);
    expect(f.y).toBe(900);
    expect(f.h).toBe(1080);   // the box itself is still cut to the screen
  });
  it('the top still cannot go past (screen - 120): the strip must remain', () => {
    expect(fitRect(one, 100, 1075, 320, 1121, false).y).toBe(960);
  });
  it('and cannot go above the screen', () => {
    expect(fitRect(one, 100, -50, 320, 1121, false).y).toBe(0);
  });
  it('a saved position low on the screen is restored there, not pulled up', () => {
    expect(fitRect(one, 100, Math.round(0.85 * 1080), 320, 1121, false).y).toBe(918);
  });
  it('on the second of two screens the strip is that screen\'s', () => {
    const two = [{ sig: 'a', x: 0, y: 0, w: 1920, h: 1080, home: true }, { sig: 'b', x: 1920, y: 0, w: 1920, h: 1080 }];
    expect(fitRect(two, 2100, 1070, 320, 1121, false).y).toBe(960);
  });
});

describe('normal-sized boxes keep the whole-box clamp', () => {
  it('a 300 px box stops at screen - 300', () => {
    expect(fitRect(one, 100, 1000, 320, 300, false).y).toBe(780);
    expect(yBounds(0, 1080, 300, false)).toEqual({ lo: 0, hi: 780 });
  });
  it('a box of exactly half the screen is still whole-clamped', () => {
    expect(yBounds(0, 1080, 540, false)).toEqual({ lo: 0, hi: 540 });
  });
  it('a grows-up box keeps the whole-box clamp (its content sits at the bottom edge; y cannot go negative)', () => {
    expect(fitRect(one, 100, 900, 320, 1121, true).y).toBe(0);
    expect(yBounds(0, 1080, 300, true)).toEqual({ lo: 0, hi: 780 });
  });
});

describe('the drag paths use it', () => {
  const c = stripJs(canvas);
  it('place, the single drag and the group drag all clamp through yBounds', () => {
    expect(c).toMatch(/fitRect\(screenList\(W, H\)[^;]*, p\.h, growsUp\(p\)\);/);
    expect(c).toMatch(/yb = yBounds\(0, H, d\.h0,/);
    expect(c).toMatch(/myb = yBounds\(0, H, r\.offsetHeight,/);
  });
});
