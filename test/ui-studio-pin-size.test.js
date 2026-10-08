// test/ui-studio-pin-size.test.js — a resize in UI Studio must reach the ini.
//
// A member, 2026-09-13, in Discord: "anyone know how to get these to stop
// defaulting to huge tooltips. I reset em to small each time." Hitya: "Mine
// shows similarly." The Zeal item windows (ZealItemDisplayN) had no
// Width/Height in their ini sections, and Save wrote a size ONLY
// for sections that already carried one ("never fabricate a size") — so every
// resize of those windows was dropped on Save, while the same edit on a
// character whose ini had the keys stuck. That is the paladin-vs-ranger split
// A member saw. A window the user resized (sizeEdited) now gets Width/Height;
// an untouched auto-size window still does not.
// 2026-10-05: Save now sends key edits for the windows the user changed
// (_buildSaveEdits; see ui-studio-key-edits.test.js), so this reads the edit
// list. A window that was only MOVED keeps the size EQ has; the size rule below
// still decides whether a size is written at all.
//
// Run: npx vitest run test/ui-studio-pin-size.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, evalBlock } from './_source-slice.js';

const src = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'ui-studio.html'), 'utf8');
// End anchor is the comment opening the NEXT function, never a line of the body.
const block = sliceBlock(src, '  function _writeAllReason(tgtSuffix){', '\n  // Is this character currently logged in?');

const FILE = 'UI_Fischer_pq.proj.ini';
// state: STATE overrides (fromCloud makes Save write every window).
function save(windows, state = {}) {
  const harness = `
    var STATE = Object.assign({ tgtW: 2560, tgtH: 1440, srcSuffix: '2560x1440', fromCloud: false },
                              ${JSON.stringify(state)}, { windows: ${JSON.stringify(windows)} });
  `;
  const { _buildSaveEdits } = evalBlock(harness + block, ['_buildSaveEdits']);
  const kv = {};
  for (const e of _buildSaveEdits().edits) (kv[e.section] = kv[e.section] || {})[e.key] = e.value;
  return kv;
}
// A window the user MOVED (x differs from what Load saw); size untouched.
const win = (extra) => ({ file: FILE, section: 'ZealItemDisplay1', x: 697, y: 406, w: 100, h: 200,
  origX: 600, origY: 406, origW: 100, origH: 200, hasWH: false, ...extra });

describe('Save (_buildSaveEdits) and window sizes', () => {
  it('leaves a moved auto-size window without Width/Height', () => {
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

  it('writes Width/Height for a window whose ini already had them when it was resized', () => {
    const e = save([win({ hasWH: true, w: 300, h: 150, origW: 280, origH: 150, sizeEdited: true })]).ZealItemDisplay1;
    expect(e.Width).toBe(300);
    expect(e.Height).toBe(150);
  });

  it('leaves the size alone on a window that was only moved, even when the ini had one', () => {
    const e = save([win({ hasWH: true, w: 300, h: 150, origW: 300, origH: 150 })]).ZealItemDisplay1;
    expect(e.XPos2560x1440).toBe(697);
    expect(e.Width).toBeUndefined();
  });

  it('when every window is written (cloud restore), a window whose ini had a size keeps writing it', () => {
    const e = save([win({ hasWH: true, w: 300, h: 150, origX: 697, origW: 300, origH: 150 })], { fromCloud: true }).ZealItemDisplay1;
    expect(e.Width).toBe(300);
    expect(e.Height).toBe(150);
  });
});
