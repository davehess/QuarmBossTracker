// test/mimic-window-move.test.js — a window somebody is moving is not ours to place, and a crashed overlay comes back.
//
// The guild lead, 2026-10-22, two screen recordings (Windows, 2560x1440): the dashboard, dragged by its title bar,
// snapped to the screen's top-left several times a second, and the Dock, dragged by its ✥, flipped between a thin bar
// and a tall window with its right-click menu open. Findings, kept honest in main.js's _holdForMove comment:
//   - no code in Mimic calls SetWindowPos / MoveWindow / SetWindowPlacement (the only native user32 calls are
//     READS, and overlays restack through Electron's moveAbove / setAlwaysOnTop), so there is no native writer to
//     give SWP_NOMOVE to; the tripwire below makes sure a future one arrives with the flags;
//   - no code targets the dashboard's bounds either (test/mimic-dashboard-drag.test.js);
//   - the Dock's fit handler was the one bounds writer with no drag guard, and the menu's height loan wrote bounds
//     under a drag in progress. Both are held now, with one log line per move naming the writer.
// Behaviour tests run the real helpers; text assertions strip comments first.
//
// Run: npx vitest run test/mimic-window-move.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const MIMIC = path.join(ROOT, 'apps', 'mimic');
const MAIN = readSource(path.join(MIMIC, 'main.js'));
const CODE = stripJs(MAIN);
const PRELOAD = stripJs(readSource(path.join(MIMIC, 'preload.js')));

// The body of the handler / function that starts at `marker`, up to the next top-level declaration.
function bodyAt(code, marker) {
  const at = code.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  const rest = code.slice(at + marker.length);
  const next = rest.search(/\n(?:ipcMain\.|function |async function |const [A-Za-z_]+ = |let )/);
  return code.slice(at, at + marker.length + (next < 0 ? rest.length : next));
}

function loadMove() {
  const helpers = sliceBlock(MAIN, 'const NATIVE_MOVE_STALE_MS = 300;', 'return true;\n}\n// Map an overlay window');
  return evalBlock(`
    const logs = [];
    function appendAgentLog(l) { logs.push(l); }
    let mainWindow = null;
    const screen = { getDisplayMatching() { return { scaleFactor: 1 }; }, getAllDisplays() { return [{ scaleFactor: 1 }]; } };
    const _overlayEntries = () => Object.entries(globalThis.__moveWins);
    ${helpers}
    function setMain(w) { mainWindow = w; }
  `, ['_beingMoved', '_holdForMove', '_noteNativeMove', '_endNativeMove', '_nativeMoving', 'setMain', 'logs']);
}

describe('_beingMoved / _holdForMove', () => {
  it('a ✥ drag and an OS move both count; an idle window does not', () => {
    globalThis.__moveWins = {};
    const m = loadMove();
    expect(m._beingMoved({ __wpDragging: true })).toBe(true);
    expect(m._beingMoved({ __wpMoveAt: Date.now() })).toBe(true);
    expect(m._beingMoved({})).toBe(false);
    expect(m._beingMoved(null)).toBe(false);
    expect(m._holdForMove({}, 'fit')).toBe(false);
    expect(m.logs).toEqual([]);
  });

  it('the OS move clears 300 ms after the last step, with no moved event needed', () => {
    globalThis.__moveWins = {};
    const m = loadMove();
    const w = { __wpMoveAt: 5_000 };
    expect(m._beingMoved(w, 5_299)).toBe(true);
    expect(m._beingMoved(w, 5_300)).toBe(false);
  });

  it('logs ONCE per move, naming the writer and the window, and again after the move ends', () => {
    const dock = { __wpDragging: true };
    globalThis.__moveWins = { dock };
    const m = loadMove();
    expect(m._holdForMove(dock, 'dock fit')).toBe(true);
    expect(m._holdForMove(dock, 'menu height loan')).toBe(true);
    expect(m._holdForMove(dock, 'dock fit')).toBe(true);
    expect(m.logs).toEqual(['[window] dock fit held off while the dock overlay is being moved\n']);
    dock.__wpDragging = false; dock.__wpHeldLogged = false;       // _stopWindowDrag
    dock.__wpDragging = true;                                     // the next drag
    m._holdForMove(dock, 'fit');
    expect(m.logs).toHaveLength(2);
  });

  it('names the dashboard when the OS has it', () => {
    globalThis.__moveWins = {};
    const m = loadMove();
    const dash = { __wpMoveAt: Date.now() };
    m.setMain(dash);
    m._holdForMove(dash, 'fit');
    expect(m.logs[0]).toMatch(/held off while the dashboard is being moved/);
  });

  it('a fresh OS move and its end both re-arm the log', () => {
    globalThis.__moveWins = {};
    const m = loadMove();
    const w = { getBounds: () => ({ x: 0, y: 0, width: 1, height: 1 }) };
    m._noteNativeMove(w, { x: 1 });
    m._holdForMove(w, 'a');
    m._endNativeMove(w);
    m._noteNativeMove(w, { x: 2 });
    m._holdForMove(w, 'b');
    expect(m.logs.filter(l => /held off/.test(l))).toHaveLength(2);
  });
});

describe('every writer that can fire mid-move asks first', () => {
  const asks = (body, who) => expect(body).toMatch(new RegExp(`_holdForMove\\([^)]*'${who}'\\)`));

  it('the Dock fit (the one handler that had no guard)', () => {
    const b = bodyAt(CODE, "ipcMain.handle('dock-auto-height'");
    asks(b, 'dock fit');
    expect(b.indexOf('_holdForMove')).toBeLessThan(b.indexOf('setBounds'));
  });
  it('the overlay fit holds for an OS move as well as a ✥ drag, and asks for a refit after', () => {
    const b = bodyAt(CODE, "ipcMain.handle('overlay-auto-height'");
    expect(b).toMatch(/if \(_holdForMove\(win, 'fit'\)\) \{ win\.__wpFitPending = true; return true; \}/);
    expect(b.indexOf('_holdForMove')).toBeLessThan(b.indexOf('setBounds'));
  });
  it("the menu's height loan and its give-back", () => {
    asks(bodyAt(CODE, "ipcMain.handle('overlay-ensure-min-height'"), 'menu height loan');
    asks(bodyAt(CODE, "ipcMain.handle('overlay-menu-closed'"), 'menu height give-back');
  });
  it('a page that places its own window', () => {
    asks(bodyAt(CODE, "ipcMain.handle('overlay-set-bounds'"), 'page-set bounds');
  });
  it('the z-order pass leaves a window in hand alone and leaves the change owed', () => {
    const b = bodyAt(CODE, 'function _applyOverlayZ(');
    asks(b, 'z-order pass');
    expect(b.indexOf('_holdForMove')).toBeLessThan(b.indexOf('_zApplied.set'));
    // ...and the drag's end calls back in so the owed change lands
    expect(bodyAt(CODE, 'function _stopWindowDrag(')).toMatch(/_applyOverlayZ\(w\)/);
  });
  it('the display-change rescue and the screen-change move', () => {
    asks(bodyAt(CODE, 'function _rescueOffscreenOverlays('), 'off-screen rescue');
    expect(CODE).toMatch(/!_holdForMove\(win, 'screen-change move'\)/);
  });
  it('a drag start and end re-arm the once-per-move log', () => {
    expect(bodyAt(CODE, 'function _startWindowDrag(')).toMatch(/__wpHeldLogged = false/);
    expect(bodyAt(CODE, 'function _stopWindowDrag(')).toMatch(/__wpHeldLogged = false/);
  });
});

describe('the ✥ right-click menu', () => {
  it('does not open while the left button is still down (a drag in progress)', () => {
    const at = PRELOAD.indexOf("moveBtn.addEventListener('contextmenu'");
    expect(at).toBeGreaterThan(-1);
    const h = PRELOAD.slice(at, PRELOAD.indexOf('overlay-ensure-min-height', at));
    expect(h).toMatch(/if \(ev\.buttons & 1\) return;/);
  });
});

describe('native stacking calls', () => {
  // main.js reads window rectangles through PowerShell + user32 and restacks overlays through Electron (moveAbove,
  // setAlwaysOnTop). Nothing calls SetWindowPos. If something ever does, a restack that leaves SWP_NOMOVE (0x0002)
  // off sends the window to (0,0) - the dashboard recordings' symptom - so any call must carry NOMOVE and NOSIZE.
  const files = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (f.name === 'node_modules' || f.name === 'vendor' || f.name === 'build') continue;
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p); else if (/\.(js|html|ps1)$/.test(f.name)) files.push(p);
    }
  })(MIMIC);

  it('any SetWindowPos / MoveWindow / SetWindowPlacement call keeps NOMOVE|NOSIZE|NOACTIVATE', () => {
    for (const f of files) {
      const code = stripJs(readSource(f));
      for (const m of code.matchAll(/\b(SetWindowPos|MoveWindow|SetWindowPlacement)\b[^;\n]*(?:\n[^;\n]*){0,3}/g)) {
        if (/DllImport|static extern/.test(m[0])) continue;   // a declaration is not a call
        expect(m[0], path.relative(ROOT, f)).toMatch(/SWP_NOMOVE|0x0*2\b/);
        expect(m[0], path.relative(ROOT, f)).toMatch(/SWP_NOSIZE|0x0*1\b/);
        expect(m[0], path.relative(ROOT, f)).toMatch(/SWP_NOACTIVATE|0x0*10\b/);
      }
    }
  });

  it('the restack goes through moveAbove with a handle read from EverQuest, never a bounds write', () => {
    const b = bodyAt(CODE, 'function _tuckAboveEq(');
    expect(b).toMatch(/win\.moveAbove\(/);
    expect(b).not.toMatch(/setBounds|setPosition/);
  });
});

describe('a crashed overlay renderer', () => {
  function loadLimiter() {
    const block = sliceBlock(MAIN, 'const OVERLAY_CRASH_MAX = 3;', 'return { ok: true, stamps: keep };\n}');
    return evalBlock(block, ['_crashRebuildAllowed', 'OVERLAY_CRASH_MAX', 'OVERLAY_CRASH_WINDOW_MS']);
  }

  it('is rebuilt up to three times in five minutes, then left down', () => {
    const { _crashRebuildAllowed, OVERLAY_CRASH_WINDOW_MS } = loadLimiter();
    expect(OVERLAY_CRASH_WINDOW_MS).toBe(5 * 60 * 1000);
    let st = [];
    const t0 = 1_000_000;
    for (const dt of [0, 10_000, 20_000]) {
      const r = _crashRebuildAllowed(st, t0 + dt);
      expect(r.ok).toBe(true);
      st = r.stamps;
    }
    const fourth = _crashRebuildAllowed(st, t0 + 30_000);
    expect(fourth.ok).toBe(false);
    expect(fourth.stamps).toHaveLength(3);                       // a refused crash is not recorded: the window slides
  });

  it('forgets a crash after five minutes, so an occasional one is always rebuilt', () => {
    const { _crashRebuildAllowed } = loadLimiter();
    const st = [0, 10_000, 20_000];
    const r = _crashRebuildAllowed(st, 5 * 60 * 1000 + 1);
    expect(r.ok).toBe(true);
    expect(r.stamps).toEqual([10_000, 20_000, 5 * 60 * 1000 + 1]);
  });

  it('is wired to every window, drops the entry before destroying it, and rebuilds through the normal pass', () => {
    expect(CODE).toMatch(/win\.webContents\.on\('render-process-gone', \(_ev, details\) => \{ try \{ _overlayRendererGone\(win, details && details\.reason\)/);
    const b = bodyAt(CODE, 'function _overlayRendererGone(');
    expect(b).toMatch(/renderer gone \(\$\{reason\}\)/);
    expect(b.indexOf('e.drop()')).toBeGreaterThan(-1);
    expect(b.indexOf('e.drop()')).toBeLessThan(b.indexOf('win.destroy()'));
    expect(b).toMatch(/applyAllVisibility\(\)/);
    expect(b).toMatch(/clean-exit/);
    expect(b).toMatch(/_crashRebuildAllowed\(/);
  });

  it('the dashboard keeps its own handler (it is not an overlay entry)', () => {
    expect(CODE).toMatch(/wc\.on\('render-process-gone'/);
  });
});
