// test/ui-studio-pin-size.test.js — a resize in UI Studio must reach the ini.
//
// Abrahms, 2026-09-13, in Discord: "anyone know how to get these to stop
// defaulting to huge tooltips. I reset em to small each time." Hitya: "Mine
// shows similarly." The Zeal item windows (ZealItemDisplayN) had no
// Width/Height in their ini sections, and _buildSaveBundle wrote a size ONLY
// for sections that already carried one ("never fabricate a size") — so every
// resize of those windows was dropped on Save, while the same edit on a
// character whose ini had the keys stuck. That is the paladin-vs-ranger split
// Abrahms saw. A window the user resized (sizeEdited) now gets Width/Height;
// an untouched auto-size window still does not.
//
// Run: npx vitest run test/ui-studio-pin-size.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, evalBlock } from './_source-slice.js';

const src = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'ui-studio.html'), 'utf8');
// End anchor is the comment opening the NEXT function, never a line of the body.
const block = sliceBlock(src, '  function _buildSaveBundle(){', '\n  // Is this character currently logged in?');

const FILE = 'UI_Fischer_pq.proj.ini';
function save(windows) {
  const harness = `
    var STATE = { tgtW: 2560, tgtH: 1440, windows: ${JSON.stringify(windows)},
                  bundle: { '${FILE}__parsed': { sections: [] } } };
    function emitIni(parsed, edits) { return edits; }
  `;
  const { _buildSaveBundle } = evalBlock(harness + block, ['_buildSaveBundle']);
  return _buildSaveBundle().newBundle[FILE];
}
const win = (extra) => ({ file: FILE, section: 'ZealItemDisplay1', x: 697, y: 406, w: 100, h: 200, hasWH: false, ...extra });

describe('_buildSaveBundle and window sizes', () => {
  it('leaves an untouched auto-size window without Width/Height', () => {
    const e = save([win({})]).ZealItemDisplay1;
    expect(e.XPos2560x1440).toBe(697);
    expect(e.Width).toBeUndefined();
    expect(e.Height).toBeUndefined();
  });

  it('writes Width/Height for an auto-size window the user resized', () => {
    const e = save([win({ sizeEdited: true })]).ZealItemDisplay1;
    expect(e.Width).toBe(100);
    expect(e.Height).toBe(200);
  });

  it('still writes Width/Height for a window whose ini already had them', () => {
    const e = save([win({ hasWH: true, w: 300, h: 150 })]).ZealItemDisplay1;
    expect(e.Width).toBe(300);
    expect(e.Height).toBe(150);
  });
});
