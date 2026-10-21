// test/mimic-skin-sizes.test.js — the Map's outlines use the skin's real window sizes, and UI Studio can hand over the
// Zeal bar commands.
//
// The guild lead, 2026-10-20, from a screenshot of the Map in Full mode: the dashed outlines labelled "size guessed" sat at
// the right top-left corners but the Group, Actions and Target boxes were far too small. visibleUiRects gave every shown
// window without Width/Height a flat 200 x 100; those windows never carry a size in the ini, their size is the skin's
// design size in uifiles/<UISkin>/EQUI_*.xml, which UI Studio already read and the Map did not. Part 2: "make raidbars and
// assistbar moveable in UI or at least be able to generate out the command" - UI Studio shows /raidbars position and
// /assistbar position for the selected bar.
//
// Run: npx vitest run test/mimic-skin-sizes.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const { visibleUiRects, skinSizeFor } = require(path.join(ROOT, 'apps', 'mimic', 'uiClearRects.js'));

const mainSrc = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'main.js'), 'utf8');
const studioSrc = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'ui-studio.html'), 'utf8');

const INI = [
  '[TargetWindow]', 'Show=1', 'XPos1920x1080=700', 'YPos1920x1080=40',
  '[GroupWindow]', 'Show=1', 'XPos1920x1080=10', 'YPos1920x1080=300',
  '[ActionsWindow]', 'Show=1', 'XPos1920x1080=1400', 'YPos1920x1080=500',
  '[PlayerWindow]', 'Show=1', 'XPos1920x1080=24', 'YPos1920x1080=30', 'Width=260', 'Height=130',
  '[MysteryWindow]', 'Show=1', 'XPos1920x1080=900', 'YPos1920x1080=900',
].join('\n');
const SKIN = {
  TargetWindow: { w: 195, h: 66 },
  GroupWindow: { w: 177, h: 340 },
  ActionsWindow: { w: 322, h: 190 },
  PlayerWindow: { w: 999, h: 999 },
};
const byName = (r, n) => r.rects.find((x) => x.name === n);

describe('visibleUiRects with the skin sizes', () => {
  it('a shown window with no Width/Height takes the skin size, noted and not a guess', () => {
    const r = visibleUiRects(INI, { skinSizes: SKIN });
    expect(byName(r, 'TargetWindow')).toMatchObject({ w: 195, h: 66, guess: false, notes: ['size from skin'] });
    expect(byName(r, 'GroupWindow')).toMatchObject({ w: 177, h: 340, guess: false });
    expect(byName(r, 'ActionsWindow')).toMatchObject({ x: 1400, y: 500, w: 322, h: 190, guess: false });
    expect(byName(r, 'TargetWindow').text).toBe('TargetWindow (size from skin)');
  });

  it('without skin sizes it is the old 200 x 100 stand-in, guessed', () => {
    for (const opts of [undefined, {}, { skinSizes: {} }, { skinSizes: null }]) {
      const r = visibleUiRects(INI, opts);
      expect(byName(r, 'TargetWindow')).toMatchObject({ w: 200, h: 100, guess: true, notes: ['size guessed'] });
    }
  });

  it('a window the skin does not know stays a guess even when others have sizes', () => {
    const r = visibleUiRects(INI, { skinSizes: SKIN });
    expect(byName(r, 'MysteryWindow')).toMatchObject({ w: 200, h: 100, guess: true, notes: ['size guessed'] });
  });

  it('a window WITH Width/Height ignores the skin', () => {
    const r = visibleUiRects(INI, { skinSizes: SKIN });
    expect(byName(r, 'PlayerWindow')).toMatchObject({ w: 260, h: 130, guess: false, notes: [] });
  });

  it('a file saved for another resolution is still a guess, with a skin size or not', () => {
    const r = visibleUiRects(INI, { skinSizes: SKIN, client: { w: 2560, h: 1440 } });
    expect(byName(r, 'TargetWindow')).toMatchObject({ w: 195, h: 66, guess: true, notes: ['size from skin', 'saved for 1920x1080'] });
  });
});

describe('skinSizeFor matches the way UI Studio does, ignoring case', () => {
  const xs = { TargetWindow: { w: 1, h: 2 }, BankWnd: { w: 3, h: 4 }, HotButtonWnd: { w: 5, h: 6 }, ChatWindow: { w: 7, h: 8 }, GroupWindow: { w: 9, h: 10 } };
  it('exact, then + Window, then + Wnd', () => {
    expect(skinSizeFor(xs, 'targetwindow')).toEqual({ w: 1, h: 2 });
    expect(skinSizeFor(xs, 'Target')).toEqual({ w: 1, h: 2 });
    expect(skinSizeFor(xs, 'Bank')).toEqual({ w: 3, h: 4 });
  });
  it('a trailing number falls back to the base name', () => {
    expect(skinSizeFor(xs, 'HotButtonWnd_2')).toEqual({ w: 5, h: 6 });
    expect(skinSizeFor(xs, 'GroupWindow1')).toEqual({ w: 9, h: 10 });
  });
  it('chat windows and unknown names get nothing', () => {
    expect(skinSizeFor(xs, 'ChatWindow')).toBeNull();
    expect(skinSizeFor(xs, 'MainChat')).toBeNull();
    expect(skinSizeFor(xs, 'Nope')).toBeNull();
    expect(skinSizeFor(null, 'TargetWindow')).toBeNull();
  });
  it('a zero or missing size is not a size', () => {
    expect(skinSizeFor({ TargetWindow: { w: 0, h: 66 } }, 'TargetWindow')).toBeNull();
  });
});

// ── the shared scan (main.js) ───────────────────────────────────────────────
const scanBlock = sliceBlock(mainSrc, 'const _skinSizesCache = new Map();', "\nipcMain.handle('ui-studio-scan-window-defaults'");
const scanFn = () => new Function('fs', 'path', scanBlock.replace(/\nipcMain\.handle\([^]*$/, '') + '\nreturn _scanSkinWindowSizes;')(fs, path);

const xmlFor = (items) => '<XML>' + items.map(([n, cx, cy]) => `<Screen item="${n}"><Size><CX>${cx}</CX><CY>${cy}</CY></Size></Screen>`).join('') + '</XML>';

describe('the shared skin scan', () => {
  it('reads the skin, falls back to default only on request, and the skin wins', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'skin-'));
    try {
      fs.mkdirSync(path.join(d, 'uifiles', 'mine'), { recursive: true });
      fs.mkdirSync(path.join(d, 'uifiles', 'default'), { recursive: true });
      fs.writeFileSync(path.join(d, 'eqclient.ini'), '[Defaults]\nUISkin=mine\n');
      fs.writeFileSync(path.join(d, 'uifiles', 'mine', 'EQUI_TargetWindow.xml'), xmlFor([['TargetWindow', 300, 80]]));
      fs.writeFileSync(path.join(d, 'uifiles', 'default', 'EQUI_TargetWindow.xml'), xmlFor([['TargetWindow', 195, 66]]));
      fs.writeFileSync(path.join(d, 'uifiles', 'default', 'EQUI_GroupWindow.xml'), xmlFor([['GroupWindow', 177, 340]]));
      const scan = scanFn();
      const own = scan(d, { fresh: true });
      expect(own.skin).toBe('mine');
      expect(own.sizes).toEqual({ TargetWindow: { cx: 300, cy: 80, file: 'EQUI_TargetWindow.xml' } });
      const both = scan(d, { withDefault: true });
      expect(both.sizes.TargetWindow).toMatchObject({ cx: 300, cy: 80 });
      expect(both.sizes.GroupWindow).toMatchObject({ cx: 177, cy: 340 });
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });

  it('is cached until an XML file changes, and an unknown folder is not ok', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'skin-'));
    try {
      fs.mkdirSync(path.join(d, 'uifiles', 'default'), { recursive: true });
      const f = path.join(d, 'uifiles', 'default', 'EQUI_A.xml');
      fs.writeFileSync(f, xmlFor([['AWindow', 10, 20]]));
      const scan = scanFn();
      const first = scan(d, { withDefault: true });
      expect(scan(d, { withDefault: true })).toBe(first);                       // same object: not re-read
      expect(scan(d, { fresh: true })).not.toBe(first);                         // the other cache slot
      expect(scan(d, { withDefault: true, fresh: true })).toBe(first);          // checked again, nothing changed: not re-read
      fs.writeFileSync(path.join(d, 'uifiles', 'default', 'EQUI_B.xml'), xmlFor([['BWindow', 30, 40]]));
      const later = scan(d, { withDefault: true, fresh: true });                // changed folder: re-read
      expect(later).not.toBe(first);
      expect(later.sizes.BWindow).toMatchObject({ cx: 30, cy: 40 });
      expect(scan(path.join(d, 'nope')).ok).toBe(false);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });

  it('UI Studio\'s handler and the Map both call that one function', () => {
    const code = stripJs(mainSrc);
    expect(code).toMatch(/ipcMain\.handle\('ui-studio-scan-window-defaults', \(_e, eqDir\) => _scanSkinWindowSizes\(eqDir/);
    const map = stripJs(sliceBlock(mainSrc, 'function _mapClearUiRects(char) {', '\n// The raider\'s keep / ignore picks'));
    expect(map).toMatch(/_scanSkinWindowSizes\(path\.dirname\(file\), \{ withDefault: true \}\)/);
    expect(map).toMatch(/visibleUiRects\([^\n]*skinSizes/);
    // no second copy of the XML reader
    expect(code.match(/<\(Screen\|Window\)/g) || []).toHaveLength(1);
  });
});

// ── the Zeal bar commands (ui-studio.html) ──────────────────────────────────
const cmdBlock = sliceBlock(studioSrc, '  function _zealBarEdits(w){', '\n  // Copy text to the clipboard');
const { _zealBarCommand } = evalBlock(cmdBlock.replace(/\n  \/\/ Copy text to the clipboard$/, ''), ['_zealBarCommand']);

const raid = (o) => Object.assign({ zealBar: 'raidbars', x: 5, y: 5, w: 100, h: 100, toEdgeR: true, toEdgeB: true, sizeEdited: false }, o);
const assist = (o) => Object.assign({ zealBar: 'assistbar', x: 5, y: 30, w: 176, h: 36, fixedSize: true }, o);

describe('the Zeal bar command UI Studio shows', () => {
  it('assist bar: two numbers', () => {
    expect(_zealBarCommand(assist({ x: 120, y: 45 }))).toBe('/assistbar position 120 45');
  });
  it('raid bars still running to both edges: two numbers', () => {
    expect(_zealBarCommand(raid({ x: 1500, y: 80 }))).toBe('/raidbars position 1500 80');
  });
  it('raid bars with a real box: four numbers, right and bottom from the box', () => {
    expect(_zealBarCommand(raid({ x: 1500, y: 80, w: 300, h: 400, toEdgeR: false, toEdgeB: false }))).toBe('/raidbars position 1500 80 1800 480');
    expect(_zealBarCommand(raid({ x: 10, y: 20, w: 300, h: 400, sizeEdited: true }))).toBe('/raidbars position 10 20 310 420');
  });
  it('0 for an edge that still runs to the screen edge', () => {
    expect(_zealBarCommand(raid({ x: 10, y: 20, w: 300, h: 400, toEdgeR: false, toEdgeB: true }))).toBe('/raidbars position 10 20 310 0');
    expect(_zealBarCommand(raid({ x: 10, y: 20, w: 300, h: 400, toEdgeR: true, toEdgeB: false }))).toBe('/raidbars position 10 20 0 420');
  });
  it('never a command Zeal would refuse: no negatives, no right/bottom before left/top', () => {
    expect(_zealBarCommand(raid({ x: -30, y: -4 }))).toBe('/raidbars position 0 0');
    expect(_zealBarCommand(assist({ x: -5, y: 12 }))).toBe('/assistbar position 0 12');
    const c = _zealBarCommand(raid({ x: 200, y: 100, w: -50, h: 0, toEdgeR: false, toEdgeB: false }));
    const [, , , , R, B] = c.split(' ').map(Number);
    expect(R).toBeGreaterThanOrEqual(200); expect(B).toBeGreaterThanOrEqual(100);
    expect(_zealBarCommand(raid({ x: NaN, y: undefined }))).toBe('/raidbars position 0 0');
  });
  it('anything that is not a Zeal bar has no command', () => {
    expect(_zealBarCommand({ x: 1, y: 2, w: 3, h: 4 })).toBe('');
    expect(_zealBarCommand(null)).toBe('');
  });
  it('the side panel shows it with a Copy button and the explanation line', () => {
    const code = stripJs(studioSrc);
    expect(code).toMatch(/var zcmd = _zealBarCommand\(w\);/);
    expect(code).toMatch(/id="zealCmdCopy"/);
    expect(code).toContain('Paste this in EverQuest chat: Zeal moves it now and remembers it. Saving here instead takes effect next time EverQuest starts.');
  });
});
