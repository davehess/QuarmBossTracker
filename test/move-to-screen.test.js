// test/move-to-screen.test.js — right-click → 🖥 Move to another screen.
//
// The guild lead, 2026-09-29: "rescue did not bring the extended target to the current monitor.
// perhaps we add it to the right click menu". Every overlay's right-click menu gets one row per
// other screen, named by where that screen sits from this one (EverQuest's marked when known);
// picking it moves the overlay to the same spot on that screen, kept whole on it, and saves it.
// The real _screenWhere / _otherScreensFor / wp-move-to-display handler run over fake screens.
//
// Run: npx vitest run test/move-to-screen.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const main = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const preload = readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js'));
const SRC = sliceBlock(main, 'function _projectRect(r, from, to) {', '\n}') + '\n'
  + sliceBlock(main, 'function _screenWhere(from, to) {', "\n});\n// State for the right-click chrome menu");

const d = (id, x, y, w, h) => ({ id, size: { width: w, height: h }, bounds: { x, y, width: w, height: h }, workArea: { x, y, width: w, height: h - 40 } });
const inside = (r, b) => r.x >= b.x && r.y >= b.y && r.x + r.width <= b.x + b.width && r.y + r.height <= b.y + b.height;

function harness(displays, { eqOn = null, rect = { x: 2020, y: 100, width: 320, height: 280 } } = {}) {
  const win = { b: { ...rect }, isDestroyed: () => false, getBounds() { return { ...this.b }; }, setBounds(nb) { this.b = { ...nb }; } };
  const handlers = {};
  const persisted = [];
  const byRect = (r) => displays.find(x => r.x + r.width / 2 >= x.bounds.x && r.x + r.width / 2 < x.bounds.x + x.bounds.width) || displays[0];
  const env = {
    screen: { getAllDisplays: () => displays, getDisplayMatching: byRect },
    _eqMainWindow: () => (eqOn ? { client: eqOn } : null),
    BrowserWindow: { fromWebContents: () => win },
    _overlayEntries: () => [['exttarget', win]],
    _boundsKeyForEntry: () => 'extTargetBounds',
    _persistBounds: (k) => persisted.push(k),
    appendAgentLog: () => {},
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
  };
  // eslint-disable-next-line no-new-func
  const api = new Function(...Object.keys(env), SRC + '\nreturn { _otherScreensFor, _screenWhere };')(...Object.values(env));
  return { api, win, persisted, move: (id) => handlers['wp-move-to-display']({ sender: {} }, id) };
}

const LEFT = d(1, 0, 0, 1920, 1080);
const RIGHT = d(2, 1920, 0, 2560, 1440);

describe('🖥 Move to another screen', () => {
  it('offers the other screen by where it sits, and marks EverQuest\'s', () => {
    const h = harness([LEFT, RIGHT], { eqOn: { x: 100, y: 100, width: 1600, height: 900 } });
    expect(h.api._otherScreensFor(h.win)).toEqual([{ id: 1, label: 'the screen on the left — EverQuest' }]);
  });

  it('with one screen there is nothing to offer', () => {
    const h = harness([LEFT], { rect: { x: 100, y: 100, width: 320, height: 280 } });
    expect(h.api._otherScreensFor(h.win)).toEqual([]);
  });

  it('two screens on the same side are told apart by size', () => {
    const h = harness([LEFT, RIGHT, d(3, 4480, 0, 1280, 1024)], { rect: { x: 100, y: 100, width: 320, height: 280 } });
    expect(h.api._otherScreensFor(h.win).map(s => s.label)).toEqual(['the screen on the right (2560×1440)', 'the screen on the right (1280×1024)']);
  });

  it('moves it to the same spot on the chosen screen, whole on it, and saves it', () => {
    const h = harness([LEFT, RIGHT], { rect: { x: 1920 + 2560 - 300, y: 1300, width: 320, height: 280 } });
    expect(h.move(1)).toBe(true);
    expect(inside(h.win.b, LEFT.workArea)).toBe(true);
    expect(h.persisted).toEqual(['extTargetBounds']);
  });

  it('refuses an unknown screen', () => {
    const h = harness([LEFT, RIGHT]);
    expect(h.move(99)).toBe(false);
    expect(h.persisted).toEqual([]);
  });

  it('the right-click menu builds its rows from that list and never for the Timers canvas', () => {
    const p = stripJs(preload);
    expect(p).toMatch(/\(st\.screens \|\| \[\]\)\.forEach\(function \(s\) \{\s*menu\.appendChild\(mkItem\('🖥 Move to ' \+ s\.label, '#1f3a57', \(\) => ipcRenderer\.invoke\('wp-move-to-display', s\.id\)\)\);/);
    expect(stripJs(main)).toContain("screens: key && key !== 'canvas' ? _otherScreensFor(win) : [],");
  });
});
