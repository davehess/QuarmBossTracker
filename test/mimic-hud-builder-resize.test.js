// test/mimic-hud-builder-resize.test.js — the HUD ring's builder panel keeps a resize.
//
// FB-16 (a member, 2026-09-27, stable Mimic 2.7.1): "when resize 'HUD' window, it reverts to a bigger
// size after clicking the X". The builder panel grows the HUD's window by 300 px on one side and keeps
// the ring's bounds from the moment it OPENED; closing it put the window back to those, so a resize
// (or a move) made while the panel was open was undone. Closing now reads the live window, except on
// a launch that finds the panel left open (quit with it open), where the stored bounds are all there is.
//
// Runs the REAL ringBoundsOf / closeBuilder cut out of me.html against a fake window.
//
// Run: npx vitest run test/mimic-hud-builder-resize.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, ROOT } from './_source-slice.js';

const ME = readSource(path.join(ROOT, 'apps', 'mimic', 'me.html'));

describe('the HUD ring\'s builder panel puts back the size you left it at', () => {
  // The panel grows the window by 300 px on one side; the ring keeps the rest.
  const block = sliceBlock(ME, '  function ringBoundsOf(win, panelW, left){', '    hoverOff();\n  }');
  // Closes the panel on a fake window and returns every setBounds the page asked for.
  // inCanvas: the alpha's Canvas runs the same page as a panel (?wpcanvas=1); a panel gives the builder's
  // width back through canvasWiden and must never set window bounds (its window is the whole Canvas).
  function close({ win, left, atLoad = false, inCanvas = false, pre = { x: 500, y: 200, width: 300, height: 300 } }) {
    const { __run } = evalBlock(`
      const PANEL_W = 300, BUILD_KEY = 'k';
      const IN_CANVAS = ${inCanvas ? 'true' : 'false'};
      const calls = [];
      function canvasWiden(on) { calls.push({ canvasWiden: on }); }
      const store = { k: ${JSON.stringify(JSON.stringify(pre))} };
      const localStorage = { getItem(k) { return store[k] == null ? null : store[k]; }, removeItem(k) { delete store[k]; } };
      const cls = new Set(${left ? "['building', 'build-left']" : "['building']"});
      const document = {
        body: { classList: { contains: (c) => cls.has(c), remove(...a) { a.forEach(c => cls.delete(c)); } } },
        documentElement: { style: { removeProperty() {} } },
      };
      const window = { screenX: ${win.x}, screenY: ${win.y}, outerWidth: ${win.width}, outerHeight: ${win.height} };
      const builderEl = { hidden: false };
      function setBounds(b) { calls.push(b); }
      function hoverOff() {}
      ${block}
      function __run(atLoad) { closeBuilder(true, atLoad); return calls; }
    `, ['__run']);
    return __run(atLoad);
  }

  it('ringBoundsOf: the panel takes the right side, or the left side', () => {
    const { ringBoundsOf } = evalBlock(`${block}`, ['ringBoundsOf']);
    expect(ringBoundsOf({ x: 500, y: 200, width: 600, height: 300 }, 300, false)).toEqual({ x: 500, y: 200, width: 300, height: 300 });
    expect(ringBoundsOf({ x: 200, y: 200, width: 600, height: 300 }, 300, true)).toEqual({ x: 500, y: 200, width: 300, height: 300 });
  });

  it('a ring resized smaller with the panel open stays smaller after the panel closes', () => {
    // Opened at 300 x 300 (window 600 wide); the user drags it down to 500 x 220 → a 200 x 220 ring.
    const calls = close({ win: { x: 500, y: 200, width: 500, height: 220 }, left: false });
    expect(calls).toEqual([{ x: 500, y: 200, width: 200, height: 220 }]);
  });

  it('…also when the panel opened on the left', () => {
    const calls = close({ win: { x: 200, y: 200, width: 500, height: 220 }, left: true });
    expect(calls).toEqual([{ x: 500, y: 200, width: 200, height: 220 }]);
  });

  it('a window left as the panel made it closes back to the ring it opened from', () => {
    const calls = close({ win: { x: 500, y: 200, width: 600, height: 300 }, left: false });
    expect(calls).toEqual([{ x: 500, y: 200, width: 300, height: 300 }]);
  });

  it('quit with the panel open: the next launch has only the stored bounds, and uses them', () => {
    const calls = close({ win: { x: 0, y: 0, width: 600, height: 300 }, left: false, atLoad: true });
    expect(calls).toEqual([{ x: 500, y: 200, width: 300, height: 300 }]);
  });

  it('an unreadable window falls back to the stored bounds', () => {
    const calls = close({ win: { x: 0, y: 0, width: 350, height: 300 }, left: false });
    expect(calls).toEqual([{ x: 500, y: 200, width: 300, height: 300 }]);
  });

  it('a Canvas panel gives the builder width back and never resizes the window', () => {
    const calls = close({ win: { x: 500, y: 200, width: 500, height: 220 }, left: false, inCanvas: true });
    expect(calls).toEqual([{ canvasWiden: false }]);
  });
});
