// test/zeal-bars-and-screens.test.js — Zeal's raid/assist bars in UI Studio, where EQ's window is,
// and what happens when the screens change.
//
// The guild lead, 2026-09-29:
//   "we need to account for /raidbars and /assistbar in uistudio as well, as parts of zeal."
//   "add B, and if the desktop orientation changes or the monitor setup changes, prompt the user to
//    bring the overlays back to the screen where EQ is. if I kick the power out of my monitor it moves
//    everything to a different screen and I have to rearrange it."
// The reading, writing and planning run as real code; the wiring is checked on comment-stripped source.
//
// Run: npx vitest run test/zeal-bars-and-screens.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const studio = readSource(path.join(ROOT, 'apps', 'mimic', 'ui-studio.html'));
const main   = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));

function studioZeal() {
  const parse = sliceBlock(studio, '  function parseIni(text){', '\n    return { lines: lines, sections: sections };\n  }');
  const bars  = sliceBlock(studio, '  function _zealBarWindows(parsed, srcW, srcH, fxX, fxY){', '\n    return e;\n  }');
  return evalBlock(parse + '\n' + bars, ['parseIni', '_zealBarWindows', '_zealBarEdits']);
}

describe('UI Studio shows Zeal\'s raid bars and assist bar as Zeal windows', () => {
  const z = studioZeal();
  const ini = (s) => z.parseIni(s);

  it('raid bars with no box run to the screen edge; a move writes only Left/Top', () => {
    const [w] = z._zealBarWindows(ini('[RaidBars]\nEnabled=TRUE\nLeft=40\nTop=100\nRight=0\nBottom=0\n'), 1920, 1080, 1, 1);
    expect(w).toMatchObject({ section: 'RaidBars', zealBar: 'raidbars', kind: 'zeal', x: 40, y: 100, w: 1880, h: 980 });
    expect(w.label).toBe('🐺 Raid bars (/raidbars)');
    w.x = 60; w.y = 120;
    expect(z._zealBarEdits(w)).toEqual({ Left: 60, Top: 120 });   // still "to the edge"
    w.w = 300; w.h = 400; w.sizeEdited = true;
    expect(z._zealBarEdits(w)).toEqual({ Left: 60, Top: 120, Right: 360, Bottom: 520 });
  });

  it('a raid-bar box keeps its size when moved (Right/Bottom follow)', () => {
    const [w] = z._zealBarWindows(ini('[RaidBars]\nEnabled=TRUE\nLeft=10\nTop=20\nRight=310\nBottom=420\n'), 1920, 1080, 1, 1);
    expect([w.w, w.h]).toEqual([300, 400]);
    w.x = 100;
    expect(z._zealBarEdits(w)).toEqual({ Left: 100, Top: 20, Right: 400, Bottom: 420 });
  });

  it('the assist bar moves but its size is its text', () => {
    const [w] = z._zealBarWindows(ini('[AssistBar]\nEnabled=FALSE\nLeft=5\nTop=30\nFontSize=20\n'), 1920, 1080, 1, 1);
    expect(w).toMatchObject({ zealBar: 'assistbar', fixedSize: true, w: 220, h: 44 });
    expect(w.label).toBe('🐺 Assist bar (/assistbar) · off');
    w.x = 50; w.sizeEdited = true;
    expect(z._zealBarEdits(w)).toEqual({ Left: 50, Top: 30 });
  });

  it('positions remap to the target resolution; sizes stay pixels', () => {
    const [w] = z._zealBarWindows(ini('[AssistBar]\nLeft=100\nTop=200\nFontSize=16\n'), 2560, 1440, 0.75, 0.75);
    expect([w.x, w.y, w.w]).toEqual([75, 150, 176]);
  });

  it('no section, no window', () => {
    expect(z._zealBarWindows(ini('[Zeal]\nPipeDelay=100\n'), 1920, 1080, 1, 1)).toEqual([]);
  });

  it('is wired: loaded from zeal.ini, saved through _zealBarEdits, no grip on a fixed size, in the Zeal filter', () => {
    const code = stripJs(studio);
    expect(code).toMatch(/if \(\/\^zeal\\\.ini\$\/i\.test\(fname\)\) \{\s*_zealBarWindows\(parsed, STATE\.srcW, STATE\.srcH, fxX, fxY\)/);
    expect(code).toMatch(/if \(w\.zealBar\) \{ edits\[w\.file\]\[w\.section\] = _zealBarEdits\(w\); continue; \}/);
    expect(code).toContain("(STATE.selected === i && !w.fixedSize ? '<div class=\"grip se\" data-grip=\"se\"></div>' : '')");
    expect(code).toContain("test:function(n){ return /^zeal|^raidbars$|^assistbar$/i.test(n); }");
  });
});

describe('auto-arrange keeps clear of the Zeal bars that are switched on', () => {
  const { _zealBarRects } = evalBlock(sliceBlock(main, 'function _zealBarRects(text, resW, resH) {', '\n  return out;\n}'), ['_zealBarRects']);
  it('reads both bars, only when Enabled=TRUE', () => {
    const on = _zealBarRects('[RaidBars]\nEnabled=TRUE\nLeft=40\nTop=100\n[AssistBar]\nEnabled=TRUE\nLeft=5\nTop=30\nFontSize=16\n', 1920, 1080);
    expect(on).toEqual([
      { name: 'Zeal RaidBars', x: 40, y: 100, w: 1880, h: 980 },
      { name: 'Zeal AssistBar', x: 5, y: 30, w: 176, h: 36 },
    ]);
    expect(_zealBarRects('[RaidBars]\nEnabled=FALSE\nLeft=40\n', 1920, 1080)).toEqual([]);
  });
  it('is read beside the UI ini the arrange already uses', () => {
    const fn = stripJs(sliceBlock(main, 'function _parseUiWindowRects() {', '\nfunction _zealBarRects('));
    expect(fn).toMatch(/path\.join\(path\.dirname\(file\), 'zeal\.ini'\)/);
    expect(fn).toMatch(/_zealBarRects\(fs\.readFileSync\(zini, 'utf8'\)/);
  });
});

describe('B: where EverQuest\'s window is', () => {
  const { _parseEqGeom } = evalBlock(sliceBlock(main, 'function _parseEqGeom(text) {', '\n  return out;\n}'), ['_parseEqGeom']);
  it('reads each eqgame window, client area and minimized flag; ignores anything else', () => {
    const out = _parseEqGeom('noise\r\nEQWIN|4242|0|0|1936|1119|8|31|1920|1080|0\nEQWIN|77|-32000|-32000|-31840|-31972|-32000|-32000|0|0|1\nEQWIN|bad|x\n');
    expect(out).toEqual([
      { pid: 4242, window: { x: 0, y: 0, width: 1936, height: 1119 }, client: { x: 8, y: 31, width: 1920, height: 1080 }, minimized: false },
      { pid: 77, window: { x: -32000, y: -32000, width: 160, height: 28 }, client: { x: -32000, y: -32000, width: 0, height: 0 }, minimized: true },
    ]);
  });
  it('asks Windows in physical pixels (DPI-aware) and turns them into window coordinates', () => {
    const code = stripJs(main);
    expect(code).toContain("'[void][WpEqWin]::SetProcessDPIAware()',");
    expect(code).toMatch(/screen\.screenToDipRect\(null, r\)/);
    expect(code).toMatch(/if \(process\.platform !== 'win32'\) return Promise\.resolve\(\[\]\);/);
  });
  it('is used where overlays get placed: the home screen, the UI projection, the canvas, auto-arrange', () => {
    const code = stripJs(main);
    expect(sliceBlock(code, 'function _overlayHomeDisplay() {', '\n}')).toMatch(/screen\.getDisplayMatching\(eq\.client\)/);
    expect(code).toMatch(/const db = eqWin \? eqWin\.client : _overlayHomeDisplay\(\)\.bounds;/);
    expect(sliceBlock(code, 'function _canvasDisplay() {', '\n}')).toMatch(/_eqMainWindow\(10 \* 60 \* 1000\)/);
    expect(code).toMatch(/ipcMain\.handle\('auto-arrange-overlays', async \(\) => \{\s*try \{ await _eqWindowGeometry\(\); \}/);
  });
});

describe('the screens changed: remember per setup, then ask', () => {
  const plan = evalBlock(sliceBlock(main, 'function _parseSigDisplays(sig) {',
    "return Object.keys(moves).length ? { kind: 'bring', moves } : { kind: 'none', moves: {} };\n}"),
    ['_parseSigDisplays', '_projectRect', '_displayChangePlan']);
  const MAIN = { x: 0, y: 0, width: 1920, height: 1080 };
  const SIDE = { x: 1920, y: 0, width: 1920, height: 1080 };
  const BOTH = '0,0,1920x1080|1920,0,1920x1080';
  const ONE  = '0,0,1920x1080';
  const target = { bounds: MAIN, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  const hud = { x: 1920 + 960, y: 540, width: 300, height: 200 };     // on the side screen
  const trig = { x: 700, y: 200, width: 600, height: 200 };           // on EQ's screen

  it('reads a screen signature back into screens', () => {
    expect(plan._parseSigDisplays(BOTH)).toEqual([MAIN, SIDE]);
  });

  it('a monitor goes away: its overlays come to EQ\'s screen at the same spot; the rest stay', () => {
    const memory = { [BOTH]: { rects: { hudBounds: hud, triggerBounds: trig } } };
    const p = plan._displayChangePlan({ prevSig: BOTH, curSig: ONE, memory,
      currentRects: { hudBounds: { x: 100, y: 100, width: 300, height: 200 }, triggerBounds: trig },   // Windows already shoved the HUD
      curDisplays: [{ bounds: MAIN }], target });
    expect(p.kind).toBe('bring');
    expect(Object.keys(p.moves)).toEqual(['hudBounds']);
    expect(p.moves.hudBounds).toEqual({ x: 960, y: 520, width: 300, height: 200 });   // half-way across, same as before
  });

  it('the monitor comes back: every overlay goes back where it was', () => {
    const memory = { [BOTH]: { rects: { hudBounds: hud, triggerBounds: trig } } };
    const p = plan._displayChangePlan({ prevSig: ONE, curSig: BOTH, memory,
      currentRects: { hudBounds: { x: 960, y: 520, width: 300, height: 200 }, triggerBounds: trig },
      curDisplays: [{ bounds: MAIN }, { bounds: SIDE }], target });
    expect(p).toEqual({ kind: 'restore', moves: { hudBounds: hud } });
  });

  it('a rotation changes the screen\'s shape: its overlays are placed on the new shape', () => {
    const ROT = '0,0,1080x1920';
    const p = plan._displayChangePlan({ prevSig: ONE, curSig: ROT, memory: { [ONE]: { rects: { triggerBounds: trig } } },
      currentRects: { triggerBounds: trig }, curDisplays: [{ bounds: { x: 0, y: 0, width: 1080, height: 1920 } }],
      target: { bounds: { x: 0, y: 0, width: 1080, height: 1920 }, workArea: { x: 0, y: 0, width: 1080, height: 1880 } } });
    expect(p.kind).toBe('bring');
    expect(p.moves.triggerBounds).toEqual({ x: 394, y: 348, width: 600, height: 200 });
  });

  it('nothing to do when every overlay sits on an unchanged screen, or the remembered layout already holds', () => {
    const memory = { [BOTH]: { rects: { triggerBounds: trig } } };
    expect(plan._displayChangePlan({ prevSig: ONE, curSig: BOTH, memory, currentRects: { triggerBounds: trig },
      curDisplays: [{ bounds: MAIN }, { bounds: SIDE }], target }).kind).toBe('none');
    expect(plan._displayChangePlan({ prevSig: BOTH, curSig: '0,0,1920x1080|1920,0,2560x1440', memory: {},
      currentRects: { triggerBounds: trig }, curDisplays: [{ bounds: MAIN }], target }).kind).toBe('none');
  });

  it('never moves anything by itself: display events ask; positions written while settling are not remembered', () => {
    const code = stripJs(main);
    expect(code).toContain("screen.on('display-removed',          _onDisplaysChanged);");
    expect(code).toContain("screen.on('display-metrics-changed',  _onDisplaysChanged);");
    expect(code).not.toMatch(/screen\.on\('display-(removed|metrics-changed)',\s*_rescueOverlays\)/);
    expect(code).toMatch(/if \(Date\.now\(\) >= _displaySettleUntil\) _rememberLayout\(cfg, cfg\[key \+ 'Sig'\], key, b\);/);
    const ask = sliceBlock(code, 'async function _askAboutDisplays() {', '\n}');
    expect(ask).toMatch(/await dialog\.showMessageBox\(/);
    expect(ask).toMatch(/if \(choice === 0\) \{/);
    expect(ask).toMatch(/_rescueOffscreenOverlays\(\);/);
  });
});
