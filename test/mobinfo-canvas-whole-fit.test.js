// test/mobinfo-canvas-whole-fit.test.js — Target Info "as whole" on the Canvas grows to show its buffs (FB-93).
//
// FB-93 (a member, Mimic 3.0.0-beta.21): "Target info as-is mode in canvas is missing buffs." The buffs
// list is the last block of the Stats tab. A standalone window grows to its content (overlayAutoHeight),
// but a pane on the Canvas is docked, where that call does nothing, so the panel stayed at its 200px
// default and everything past the bottom edge was cut off (measured headless: buffs section ending at
// 220px in a 200px frame with 7 buffs). The page now asks the Canvas to grow the panel to its content.
//
// Run: npx vitest run test/mobinfo-canvas-whole-fit.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, ROOT } from './_source-slice.js';

const mimic = (f) => path.join(ROOT, 'apps', 'mimic', f);
const mobinfo = readSource(mimic('mobinfo.html'));
const canvas = readSource(mimic('canvas.html'));

// The page's real _fitHeight, run against a fake window.
function fit({ search, inFrame = true, wpCanvasFit = true, autoHeight = true }) {
  const calls = { fit: [], height: [] };
  const win = { mimic: autoHeight ? { overlayAutoHeight: (h) => calls.height.push(h) } : null };
  win.parent = inFrame ? { wpCanvasFit: wpCanvasFit ? (w, g) => { calls.fit.push([w === win, g]); } : undefined } : win;
  const document = { getElementById: () => ({ scrollHeight: 300 }), body: { scrollHeight: 1 } };
  new Function('window', 'document', '_wpQs',
    sliceBlock(mobinfo, '  function _fitHeight(){', '\n  }\n') + '\n_fitHeight();')(win, document, new URLSearchParams(search));
  return calls;
}

describe('Target Info as a whole panel on the Canvas', () => {
  it('asks the Canvas to grow the panel to the content, grow only', () => {
    expect(fit({ search: '?wpcanvas=1' }).fit).toEqual([[true, true]]);
  });
  it('a standalone window is sized by its own auto-height and asks the Canvas for nothing', () => {
    const c = fit({ search: '', inFrame: false });
    expect(c.fit).toEqual([]);
    expect(c.height).toEqual([312]);
  });
  it('a piece cut from the page (?wpsect=) is not the whole page and leaves the panel alone', () => {
    expect(fit({ search: '?wpcanvas=1&wpsect=buffs' }).fit).toEqual([]);
  });
  it('a Canvas without the hook (an older build) is not an error', () => {
    expect(() => fit({ search: '?wpcanvas=1', wpCanvasFit: false })).not.toThrow();
  });
  it('the Canvas passes the grow flag on to its fit, and the HUD\'s one-argument call is still an exact fit', () => {
    const seen = [];
    const wpCanvasFit = new Function('panelOfWin', 'fitEmbed', 'var window = {};\n'
      + sliceBlock(canvas, '  window.wpCanvasFit = function', ';\n') + '\nreturn window.wpCanvasFit;')(() => 'p1', (id, grow) => { seen.push([id, grow]); return true; });
    wpCanvasFit({});
    wpCanvasFit({}, true);
    expect(seen).toEqual([['p1', false], ['p1', true]]);
  });
});
