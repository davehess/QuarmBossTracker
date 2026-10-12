// The stand-in pointer over click-through overlays (apps/mimic/preload.js).
// The guild lead, 2026-10-12: "we should show a mouse when we mouseover the map window, otherwise we lose it behind
// in the EQ window. the same should apply with any of the overlays." EQ draws its own pointer inside its 3D scene,
// under every overlay window, so over a SOLID part of an overlay it is covered; over a see-through part it shows.
// Run: npx vitest run test/overlay-ghost-cursor.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, evalBlock, ROOT } from './_source-slice.js';

const PRELOAD = readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js'));

function load(backdrop = false) {
  const src = sliceBlock(PRELOAD, 'function _wpAlpha(bg) {', '\n}') + '\n' + sliceBlock(PRELOAD, 'function _wpOverSolid(el) {', '\n}');
  const prelude = `const document = { documentElement: { nodeType: 1 }, body: { classList: { contains: (c) => c === 'wp-backdrop' && ${backdrop} } } };
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
  it('solid: a canvas (the Map), an image, or anything sitting on a background at least 35% opaque', () => {
    expect(H._wpOverSolid(chain({ tagName: 'CANVAS' }))).toBe(true);
    expect(H._wpOverSolid(chain({ tagName: 'IMG' }))).toBe(true);
    expect(H._wpOverSolid(chain({ tagName: 'SPAN' }, { bg: 'rgba(14, 17, 22, 0.6)' }))).toBe(true);   // a panel's text
  });
  it('see-through: floating text on a transparent window gets no stand-in (EQ\'s pointer shows there)', () => {
    expect(H._wpOverSolid(chain({ tagName: 'SPAN' }, { bg: 'rgba(0, 0, 0, 0.2)' }, {}))).toBe(false);
  });
  it('the solid backdrop setting makes the whole window solid', () => {
    expect(load(true)._wpOverSolid(chain({ tagName: 'SPAN' }))).toBe(true);
  });
  it('is drawn only while locked, never over an armed control, and hidden when the pointer leaves', () => {
    const js = stripJs(PRELOAD);
    expect(js).toMatch(/if \(!_wpLocked \|\| _wpHoverArmed \|\| !_wpOverSolid\(ev\.target\)\) \{ _wpGhostHide\(\); return; \}/);
    expect(js).toMatch(/ipcRenderer\.on\('overlay-locked', function \(_e, locked\) \{ _wpLocked = !!locked;/);
    expect(js).toMatch(/if \(!ev\.relatedTarget\) _wpGhostHide\(\);/);
    expect(js).toMatch(/pointer-events:none/);
    expect(js).toMatch(/document\.documentElement\.appendChild\(_wpGhost\)/);   // outside <body>: themes never recolour it
  });
});
