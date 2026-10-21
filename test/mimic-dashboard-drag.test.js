// test/mimic-dashboard-drag.test.js — the dashboard window is dragged by the OS; nothing may write its position back.
//
// The guild lead, 2026-10-21 (Windows): "when dragging the electron mimic dashboard it will jump back and forth as
// i'm dragging it". The dashboard (mainWindow) is the one framed window: Windows moves it from the title bar in a
// modal loop, and Electron reports each step as 'will-move' and the end as 'moved'. Code that writes bounds to a
// window while that loop runs fights it - each write lands a step behind the cursor.
//
// Nothing in main.js targets mainWindow's bounds on purpose, but the 60 fps overlay drag resolves its window from the
// IPC sender, so it asks _nativeMoving first. The 'will-move' / 'moved' listeners on the dashboard only observe.
// Behaviour tests run the real helpers; text assertions strip comments first.
//
// Run: npx vitest run test/mimic-dashboard-drag.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const MAIN = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const CODE = stripJs(MAIN);

const helpers = sliceBlock(MAIN, 'const NATIVE_MOVE_STALE_MS = 1500;', 'steps${where}\\n`);\n}');

function load() {
  const fns = evalBlock(`
    const logs = [];
    function appendAgentLog(l) { logs.push(l); }
    const screen = {
      getDisplayMatching() { return { scaleFactor: 1.25 }; },
      getAllDisplays() { return [{ scaleFactor: 1.25 }, { scaleFactor: 1 }]; },
    };
    ${helpers}
  `, ['_nativeMoving', '_moveReversals', '_noteNativeMove', '_endNativeMove', 'logs']);
  return fns;
}

describe('native move mark', () => {
  it('is set by each will-move step and clears on moved', () => {
    const { _nativeMoving, _noteNativeMove, _endNativeMove } = load();
    const win = { getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }) };
    expect(_nativeMoving(win)).toBe(false);
    _noteNativeMove(win, { x: 10, y: 10 });
    expect(_nativeMoving(win)).toBe(true);
    _endNativeMove(win);
    expect(_nativeMoving(win)).toBe(false);
  });

  it('goes stale when moved never arrives, so a lost event cannot freeze the bounds writers', () => {
    const { _nativeMoving } = load();
    const win = { __wpMoveAt: 1_000 };
    expect(_nativeMoving(win, 1_000 + 1499)).toBe(true);
    expect(_nativeMoving(win, 1_000 + 1500)).toBe(false);
  });

  it('a window that was never moved by the OS (every overlay) is never marked', () => {
    const { _nativeMoving } = load();
    expect(_nativeMoving({})).toBe(false);
    expect(_nativeMoving(null)).toBe(false);
  });
});

describe('jitter evidence', () => {
  it('counts direction changes and ignores 2 px rounding', () => {
    const { _moveReversals } = load();
    expect(_moveReversals([0, 40, 90, 150, 220])).toBe(0);                 // one hand, one way
    expect(_moveReversals([0, 40, 90, 60, 100, 70, 120])).toBe(4);         // back and forth
    expect(_moveReversals([0, 1, 0, 2, 1, 2])).toBe(0);                    // rounding only
  });

  it('logs a back-and-forth drag with the scaling it ran under, and stays quiet for a clean one', () => {
    const a = load();
    const jittery = { getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }), getMinimumSize: () => [800, 600] };
    [0, 60, 20, 80, 30, 90, 40, 100, 50, 110].forEach(x => a._noteNativeMove(jittery, { x }));
    a._endNativeMove(jittery);
    expect(a.logs).toHaveLength(1);
    expect(a.logs[0]).toMatch(/drag jitter: 8 direction changes over 10 steps/);
    expect(a.logs[0]).toMatch(/min=800x600 scale=1\.25 displays=1\.25\/1/);

    const b = load();
    const clean = { getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }) };
    [0, 50, 120, 200, 310, 400].forEach(x => b._noteNativeMove(clean, { x }));
    b._endNativeMove(clean);
    expect(b.logs).toEqual([]);
  });
});

describe('nothing writes the dashboard position during a move', () => {
  it('the will-move / moved listeners on the dashboard only observe', () => {
    const at = CODE.indexOf("mainWindow.on('will-move'");
    expect(at).toBeGreaterThan(-1);
    const listeners = CODE.slice(at, CODE.indexOf("mainWindow.on('moved'", at) + 200);
    expect(listeners).not.toMatch(/setBounds|setPosition|setSize|center\(|_persistBounds|_resolveBounds/);
    expect(listeners).toMatch(/_noteNativeMove\(mainWindow/);
    expect(listeners).toMatch(/_endNativeMove\(mainWindow/);
  });

  it('no code path sets bounds on mainWindow itself', () => {
    expect(CODE).not.toMatch(/mainWindow\.(setBounds|setPosition|setSize|setContentSize|setContentBounds|center)\(/);
  });

  it('the 16 ms drag writer takes its window from the sender, so it asks _nativeMoving first', () => {
    const drag = CODE.slice(CODE.indexOf('function _startWindowDrag('));
    expect(drag.slice(0, 160)).toMatch(/_nativeMoving\(win\)/);
  });

  it('the resize grips go through _startWindowDrag, so they are covered too', () => {
    for (const fn of ['_startWindowResize(win)', '_startWindowResizeUp(win)']) {
      const body = CODE.slice(CODE.indexOf(`function ${fn}`));
      expect(body.slice(0, 200), fn).toMatch(/_startWindowDrag\(win\);\s*\n\s*if \(!_dragSession\) return;/);
    }
  });
});
