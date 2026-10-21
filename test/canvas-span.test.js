// test/canvas-span.test.js — the Canvas over every screen: "Span all screens".
//
// The guild lead, 2026-10-19: "canvas should be able to span multiple screens, not just be on one" — and picked
// option A: ONE Canvas window over the union of all displays, behind a switch that is OFF by default and only
// available while every display shares one scaleFactor (otherwise it is greyed with a one-line reason; ⇆ Next
// screen stays). The layout keeps its key (the HOME display's WxH); a panel MAY carry `scr` (a display's
// signature) with x / y as fractions of THAT display, and none means home. A screen that is not here hides its
// panels without touching them; the screen-change question covers them; a layout FILE stays one screen.
//
// Pure rules run as the real code (canvas.html's screen block, main.js's span block over fake displays);
// the wiring is checked on comment-stripped source.
//
// Run: npx vitest run test/canvas-span.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const canvasRaw = readSource(path.join(ROOT, 'apps', 'mimic', 'canvas.html'));
const mainRaw = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const preloadRaw = readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js'));
const dashRaw = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const canvas = stripJs(canvasRaw), main = stripJs(mainRaw), preload = stripJs(preloadRaw), dash = stripJs(dashRaw);

// ── canvas.html: the screen block, as the real code ─────────────────────────────────────────────────────────
function rules() {
  const block = sliceBlock(canvasRaw, '  var GROUPS = [', '  // ── Panels ──');
  return evalBlock('var window = {};\n' + block + '\nfunction __scr(s) { _screens = s; } function __set(l) { _layout = l; }',
    ['window', 'sanitize', 'defaultLayout', 'screenList', 'screenAt', 'fitRect', 'toWindow', 'toDisk', 'screenSide', '__scr', '__set']);
}
const R = rules();
// Two 1920×1080 screens side by side in one 3840×1080 window; A is home.
const A = { sig: '0,0,1920x1080', x: 0, y: 0, w: 1920, h: 1080, home: true };
const B = { sig: '1920,0,1920x1080', x: 1920, y: 0, w: 1920, h: 1080, home: false };
const W2 = 3840, H2 = 1080;
const panel = (o) => Object.assign({ id: 'p1', kind: 'part', part: 'me.hp', x: 0.5, y: 0.5, w: 200, h: 40 }, o);
const clone = (o) => JSON.parse(JSON.stringify(o));

describe('one screen is the whole window, exactly (nothing changes for anyone who never turns it on)', () => {
  it('the list is one screen the size of the window, whatever main said it measured', () => {
    R.__scr(null);
    expect(R.screenList(1920, 1080)).toEqual([{ sig: '', x: 0, y: 0, w: 1920, h: 1080, home: true }]);
    R.__scr([{ sig: '0,0,1920x1081', x: 0, y: 0, w: 1920, h: 1081, home: true }]);
    expect(R.screenList(1920, 1080)).toEqual([{ sig: '0,0,1920x1081', x: 0, y: 0, w: 1920, h: 1080, home: true }]);
    R.__scr(null);
  });
  it('a layout survives load → save untouched, and no panel ever gains a `scr`', () => {
    const list = R.screenList(1920, 1080);
    const disk = { panels: [panel({ x: 0.31, y: 0.16 }), panel({ id: 'p2', x: 0.9, y: 0.02 })] };
    const mem = R.toWindow(clone(disk), list, 1920, 1080);
    expect(mem.panels.map(p => [p.x, p.y])).toEqual([[0.31, 0.16], [0.9, 0.02]]);
    expect(R.toDisk(mem, list, 1920, 1080).panels).toEqual(disk.panels);
  });
  it('a panel left on a screen that is not the home screen is hidden, not placed on this one', () => {
    const list = R.screenList(1920, 1080);
    const mem = R.toWindow({ panels: [panel({ scr: '1920,0,1920x1080', x: 0.4, y: 0.3 })] }, list, 1920, 1080);
    expect(mem.panels[0].gone).toBe(true);
  });
});

describe('two screens: where a panel is, in the file and in the window', () => {
  it('no `scr` is the home screen; `scr` is a fraction of THAT screen', () => {
    const mem = R.toWindow({ panels: [panel({ id: 'home', x: 0.5 }), panel({ id: 'far', scr: B.sig, x: 0.5 })] }, [A, B], W2, H2);
    expect(mem.panels[0].x).toBeCloseTo(0.25, 6);        // half way across A is a quarter of the window
    expect(mem.panels[1].x).toBeCloseTo(0.75, 6);        // half way across B is three quarters
    expect(mem.panels[1].scr).toBeUndefined();           // held as a window fraction; the screen is implied by where it is
  });
  it('a drop is given the screen that holds the panel\'s middle, and the fraction is of that screen', () => {
    const L = { panels: [panel({ id: 'a', x: 1700 / W2, w: 200 }), panel({ id: 'b', x: 2000 / W2, w: 200 })] };
    const disk = R.toDisk(L, [A, B], W2, H2);
    expect(disk.panels[0].scr).toBeUndefined();          // middle at 1800: still on A
    expect(disk.panels[0].x).toBeCloseTo(1700 / 1920, 6);
    expect(disk.panels[1].scr).toBe(B.sig);              // middle at 2100: B
    expect(disk.panels[1].x).toBeCloseTo(80 / 1920, 6);
  });
  it('a panel dropped in a dead zone goes to the nearest screen, clamped', () => {
    // A is shorter than B and sits at the top: below A, left of B, is nothing.
    const A2 = { sig: '0,0,1920x1080', x: 0, y: 0, w: 1920, h: 1080, home: true };
    const B2 = { sig: '1920,0,2560x1440', x: 1920, y: 0, w: 2560, h: 1440, home: false };
    const L = { panels: [panel({ id: 'z', x: 100 / 4480, y: 1300 / 1440, w: 200, h: 40 })] };   // under A: no screen there
    const d = R.toDisk(L, [A2, B2], 4480, 1440).panels[0];
    expect(d.scr).toBeUndefined();                       // nearest is A
    expect(d.y).toBe(1);                                 // clamped to A's bottom edge
    expect(d.x).toBeCloseTo(100 / 1920, 6);
  });
  it('a panel is kept whole on the screen holding its middle, never spread over the gap', () => {
    const f = R.fitRect([A, B], 1900, 100, 200, 40);     // middle at 2000 → B; its left edge is on A
    expect(f.r).toBe(B);
    expect(f.x).toBe(1920);
    expect(R.fitRect([A, B], 1700, 100, 200, 40).x).toBe(1700);   // wholly on A: untouched
    expect(R.fitRect([A, B], 3800, 100, 200, 40).x).toBe(3640);   // off B's right edge: pulled back in
  });
  it('a panel bigger than its screen is cut to it', () => {
    const f = R.fitRect([A, B], 0, 0, 5000, 5000);
    expect([f.w, f.h]).toEqual([1920, 1080]);
  });
  it('a panel dragged across the join and back round-trips to the same place', () => {
    const disk = { panels: [panel({ scr: B.sig, x: 0.37, y: 0.61 })] };
    const back = R.toDisk(R.toWindow(clone(disk), [A, B], W2, H2), [A, B], W2, H2);
    expect(back.panels[0].scr).toBe(B.sig);
    expect(back.panels[0].x).toBeCloseTo(0.37, 6);
    expect(back.panels[0].y).toBeCloseTo(0.61, 6);
  });
});

describe('a screen that is not here: hidden, never moved, never deleted', () => {
  it('the panel is marked gone, keeps its place, and is written back exactly as it was', () => {
    const disk = { panels: [panel({ id: 'far', scr: B.sig, x: 0.37, y: 0.61 })] };
    const mem = R.toWindow(clone(disk), [A], 1920, 1080);     // B unplugged (or span off)
    expect(mem.panels[0].gone).toBe(true);
    expect([mem.panels[0].x, mem.panels[0].y, mem.panels[0].scr]).toEqual([0.37, 0.61, B.sig]);
    const saved = R.toDisk(mem, [A], 1920, 1080);
    expect(saved.panels).toEqual(disk.panels);                 // no `gone`, same x / y / scr
  });
  it('the screen comes back: the panel is where it was left', () => {
    const disk = { panels: [panel({ id: 'far', scr: B.sig, x: 0.37, y: 0.61 })] };
    const kept = R.toDisk(R.toWindow(clone(disk), [A], 1920, 1080), [A], 1920, 1080);
    const again = R.toWindow(kept, [A, B], W2, H2);
    expect(again.panels[0].gone).toBeUndefined();
    expect(again.panels[0].x).toBeCloseTo((1920 + 0.37 * 1920) / W2, 6);
  });
  it('the callouts panel and the catch-all timers panel are never left without a screen: they come to home', () => {
    const mem = R.toWindow({ panels: [
      panel({ id: 'callouts', kind: 'callouts', scr: B.sig, x: 0.5 }),
      panel({ id: 'timers', kind: 'timers', all: true, scr: B.sig, x: 0.5 }),
      panel({ id: 'charm', kind: 'timers', all: false, scr: B.sig, x: 0.5 })] }, [A], 1920, 1080);
    expect(mem.panels.map(p => !!p.gone)).toEqual([false, false, true]);
    expect(mem.panels[0].x).toBe(0.5);
  });
  it('a countdown is never routed to a panel that is not showing', () => {
    const L = R.defaultLayout();
    L.panels.push({ id: 'far', kind: 'timers', all: false, groups: ['lull'], names: [], name: 'Far', gone: true });
    R.__set(L);
    expect(R.window.wpCanvasRoute({ id: 'x', effect: 'Wake of Tranquility', group: 'lull' })).toBe('timers');
    delete L.panels[L.panels.length - 1].gone;
    expect(R.window.wpCanvasRoute({ id: 'x', effect: 'Wake of Tranquility', group: 'lull' })).toBe('far');
  });
  it('the ⋮ row menu does not offer it as a place to move a timer to', () => {
    expect(sliceBlock(canvas, '  function moveTargets(info) {', '\n  }\n')).toContain("if (q.kind !== 'timers' || q.id === _rowPanel || q.gone) return;");
  });
  it('render makes no element for it (so no page runs), and the layout still holds it', () => {
    const render = sliceBlock(canvas, '  function render() {', '\n  }\n');
    expect(render).toMatch(/_layout\.panels\.forEach\(function \(p\) \{\s*if \(p\.gone\) return;[^\n]*\n\s*keep\[p\.id\] = true;/);
  });
});

describe('the layout file keeps `scr` (and refuses junk)', () => {
  const san = (p) => R.sanitize({ panels: [Object.assign({ id: 'q1', kind: 'part', part: 'me.hp' }, p)] }).panels.find(q => q.id === 'q1');
  it('every kind of panel keeps a screen signature', () => {
    expect(san({ scr: '1920,0,1920x1080' }).scr).toBe('1920,0,1920x1080');
    expect(san({ scr: '-1920,-200,2560x1440' }).scr).toBe('-1920,-200,2560x1440');
    expect(R.sanitize({ panels: [{ id: 't', kind: 'timers', all: false, scr: '1920,0,1920x1080' }] }).panels.find(q => q.id === 't').scr).toBe('1920,0,1920x1080');
    expect(R.sanitize({ panels: [{ id: 'o', kind: 'overlay', key: 'charm', scr: '1920,0,1920x1080' }] }).panels.find(q => q.id === 'o').scr).toBe('1920,0,1920x1080');
  });
  it('no `scr` stays no `scr`; a malformed one is dropped, so the panel is home', () => {
    expect('scr' in san({})).toBe(false);
    for (const bad of ['<script>', '1,2,3', 5, null, '1920,0,1920x1080;x', '']) expect('scr' in san({ scr: bad })).toBe(false);
  });
});

describe('words for a place: which screen', () => {
  const where = (list, b) => new Function('window', 'num', 'screenList', 'screenAt', 'screenSide', sliceBlock(canvasRaw, '  function whereText(b) {', '\n  }\n') + '\nreturn whereText;')(
    { innerWidth: list.reduce((m, s) => Math.max(m, s.x + s.w), 0), innerHeight: list.reduce((m, s) => Math.max(m, s.y + s.h), 0) }, null, () => list, R.screenAt, R.screenSide)(b);
  it('with one screen it says what it always said', () => {
    expect(where([Object.assign({}, A, { home: true })], { x: 850, y: 500, w: 200, h: 50 })).toBe('in the middle of the screen');
    expect(where([A], { x: 1700, y: 20, w: 200, h: 50 })).toBe('top right');
  });
  it('with several it names the screen', () => {
    expect(where([A, B], { x: 2900, y: 500, w: 200, h: 50 })).toBe('in the middle of the right screen');
    expect(where([A, B], { x: 20, y: 500, w: 200, h: 50 })).toBe('at the left of the left screen');
    expect(where([A, B], { x: 2900, y: 20, w: 200, h: 50 })).toBe('at the top of the right screen');
  });
  it('three across, and stacked', () => {
    const C = { sig: 'c', x: 3840, y: 0, w: 1920, h: 1080 };
    expect(R.screenSide([A, B, C], B)).toBe('middle');
    expect(R.screenSide([A, B, C], C)).toBe('right');
    const top = { sig: 't', x: 0, y: 0, w: 1920, h: 1080 }, bottom = { sig: 'u', x: 0, y: 1080, w: 1920, h: 1080 };
    expect(R.screenSide([top, bottom], bottom)).toBe('bottom');
    expect(R.screenSide([A], A)).toBe('');
  });
});

describe('place() and the snap lines follow the screens', () => {
  const placeAt = (list, p) => {
    const style = {};
    new Function('_widen', 'sizeFrame', 'e', 'p', 'window', 'num', sliceBlock(canvasRaw, '  var _screens = null, _conv', '  // ── Routing: which panel shows a countdown') + '\n'
      + sliceBlock(canvasRaw, '  function growsUp(p) {', '\n') + '\n' + sliceBlock(canvasRaw, '  function isFree(q) {', '\n') + '\n'
      + 'function __s(l) { _screens = l; } __s(' + JSON.stringify(list.length > 1 ? list : null) + ');\n'
      + sliceBlock(canvasRaw, '  function place(e, p) {', '\n  }\n') + '\nplace(e, p);')({}, () => {}, { root: { style, classList: { toggle() {} } } }, p,
      { innerWidth: 3840, innerHeight: 1080 }, null);
    return [style.left, style.top];
  };
  it('a panel on the second screen is drawn there, whole', () => {
    expect(placeAt([A, B], { id: 'a', x: 2400 / 3840, y: 0.5, w: 200, h: 40 })).toEqual(['2400px', '540px']);
    expect(placeAt([A, B], { id: 'a', x: 1900 / 3840, y: 0.5, w: 200, h: 40 })[0]).toBe('1920px');   // middle is on B: not left half on A
  });
  it('with one screen it is clamped to the window as before', () => {
    expect(placeAt([A], { id: 'a', x: 0.99, y: 0.5, w: 200, h: 40 })).toEqual(['3640px', '540px']);
  });
  it('snapping offers every screen\'s edges and middle, not just the window\'s', () => {
    const snap = sliceBlock(canvasRaw, '  function snapMove(id, x, y, w, h, skip) {', '\n  }\n');
    expect(stripJs(snap)).toMatch(/screenList\(W, H\)\.forEach\(function \(r\) \{\s*xs\.push\(r\.x, Math\.round\(r\.x \+ r\.w \/ 2 - w \/ 2\), r\.x \+ r\.w - w\);/);
  });
  it('fitting a height keeps an item on its own screen', () => {
    const box = new Function(sliceBlock(canvasRaw, '  function fitBox(y, h, need, up, H, min, lo, hi) {', '\n  }\n') + '\nreturn fitBox;')();
    // A shorter second screen: 1080 tall inside a 1440 window. Growing down from y=900 stops at 1080, not 1440.
    expect(box(900 / 1440, 100, 500, false, 1440, 36, 0, 1080).h).toBe(180);
    // Growing up from a screen that starts at 360 stops at 360.
    expect(box(500 / 1440, 100, 900, true, 1440, 36, 360, 1440).y).toBe(360 / 1440);
    // ...and never above it, even when the minimum height would push it there.
    expect(box(370 / 1440, 20, 5, true, 1440, 36, 360, 1440)).toEqual({ y: 360 / 1440, h: 36 });
    // The old five-argument call is unchanged.
    expect(box(0.6, 100, 250, true, 1000, 36)).toEqual({ y: 0.45, h: 250 });
  });
});

describe('the Canvas reads the layout again when what its fractions mean changes, and saves before it does', () => {
  const rig = ({ saving }) => {
    const calls = [];
    const env = new Function('M', 'calls', 'window', 'num', 'sanitize', 'refresh', 'doSave', 'initialSaveT', 'initialRes',
      'var _res = initialRes, _saveT = initialSaveT;\n'
      + sliceBlock(canvasRaw, '  var _screens = null, _conv', '  // ── Routing: which panel shows a countdown') + '\n'
      + sliceBlock(canvasRaw, '  function stateKey(st) {', '    return disk ? toWindow(disk, _conv.list, W, H) : null;\n  }\n')
      + '\nreturn { stateKey: stateKey, adoptLayout: adoptLayout, conv: function () { return _conv; }, saveT: function () { return _saveT; } };')(
      {}, calls, { innerWidth: W2, innerHeight: H2 }, null, (l) => (l && Array.isArray(l.panels) ? l : null),
      () => calls.push('refresh'), () => calls.push('doSave'), saving ? 1 : null, 'x');
    return { env, calls };
  };
  const st = (o) => Object.assign({ res: '1920x1080', rev: 0, screens: [A, B], layout: { panels: [panel({ scr: B.sig, x: 0.5 })] } }, o);
  it('a new set of screens, a bigger window, a layout main rewrote: each is a new key', () => {
    const { env } = rig({});
    const k = env.stateKey(st({}));
    expect(env.stateKey(st({}))).toBe(k);
    expect(env.stateKey(st({ screens: [A] }))).not.toBe(k);
    expect(env.stateKey(st({ rev: 1 }))).not.toBe(k);
    expect(env.stateKey(st({ res: '2560x1440' }))).not.toBe(k);
  });
  it('the panels come in as window fractions, on the screens main described', () => {
    const { env } = rig({});
    const layout = env.adoptLayout(st({}));
    expect(layout.panels[0].x).toBeCloseTo(0.75, 6);
    expect(env.conv()).toMatchObject({ W: W2, H: H2 });
  });
  it('edits not yet written are written FIRST, and the state is asked for again (it would be stale)', () => {
    const { env, calls } = rig({ saving: true });
    expect(env.adoptLayout(st({}))).toBe(false);
    expect(calls).toEqual(['doSave', 'refresh']);
  });
  it('nothing saved for this state: null, and the panels in hand stay', () => {
    const { env } = rig({});
    expect(env.adoptLayout(st({ layout: null }))).toBeNull();
  });
  it('a save is written for the screens the panels were read with (not whatever the window is by then)', () => {
    const seen = [];
    const doSave = new Function('M', 'toDisk', 'screenList', 'window', '_layout', '_conv',
      'var _saveT = 5;\n' + sliceBlock(canvasRaw, '  function doSave() {', '\n  }\n') + '\ndoSave(); return _saveT;')(
      { canvasSave: (l) => seen.push(l) }, (l, list, W, H) => ({ l, list, W, H }), () => 'fallback', { innerWidth: 1, innerHeight: 1 },
      { panels: [] }, { list: [A, B], W: W2, H: H2 });
    expect(doSave).toBeNull();
    expect(seen[0]).toMatchObject({ list: [A, B], W: W2, H: H2 });
  });
});

// ── main.js: the window, the screens, the switch ────────────────────────────────────────────────────────────
const SPAN_SRC = sliceBlock(mainRaw, 'function _canvasDisplay() {', '\n}\n') + '\n'
  + sliceBlock(mainRaw, 'let _canvasLayoutRev = 0;', "canvasWindow.webContents.send('canvas-group-ops'); } catch { /* mid-close */ }\n  return n;\n}") + '\n'
  + sliceBlock(mainRaw, 'function _fitCanvasToDisplay() {', '\n}\n') + '\n'
  + sliceBlock(mainRaw, 'function _canvasStatePayload() {', '\n}\n') + '\n'
  + sliceBlock(mainRaw, 'function _parseSigDisplays(sig) {', "return Object.keys(moves).length ? { kind: 'bring', moves, withEq, side, sideOntoEq } : { kind: 'none', moves: {} };\n}") + '\n'
  + sliceBlock(mainRaw, 'function _displayPlanText(plan, eqKnown) {', '\n}\n') + '\n'
  + sliceBlock(mainRaw, 'function _layoutOfSet(set) {', '\n}\n');

const disp = (id, x, y, w, h, scale = 1) => ({ id, bounds: { x, y, width: w, height: h }, size: { width: w, height: h }, workArea: { x, y, width: w, height: h - 40 }, scaleFactor: scale });
const DA = disp(1, 0, 0, 1920, 1080);
const DB = disp(2, 1920, 0, 2560, 1440);

function world({ displays = [DA, DB], cfg = {}, win = null } = {}) {
  const state = { cfg: JSON.parse(JSON.stringify(cfg)), sent: [], trays: 0, pushes: 0 };
  const overlap = (r, d) => Math.max(0, Math.min(r.x + r.width, d.bounds.x + d.bounds.width) - Math.max(r.x, d.bounds.x))
    * Math.max(0, Math.min(r.y + r.height, d.bounds.y + d.bounds.height) - Math.max(r.y, d.bounds.y));
  const screen = {
    getAllDisplays: () => displays, getPrimaryDisplay: () => displays[0],
    getDisplayMatching: (r) => displays.slice().sort((a, b) => overlap(r, b) - overlap(r, a))[0],
  };
  const canvasWindow = win === false ? null : {
    b: win || { x: 0, y: 0, width: 1920, height: 1080 },
    isDestroyed: () => false, getBounds() { return Object.assign({}, this.b); }, setBounds(nb) { this.b = Object.assign({}, nb); },
    webContents: { send: (ch) => state.sent.push(ch) },
  };
  const env = {
    screen, canvasWindow, _canvasArrange: false,
    loadConfig: () => JSON.parse(JSON.stringify(state.cfg)),
    saveConfig: (c) => { state.cfg = JSON.parse(JSON.stringify(c)); },
    _eqMainWindow: () => null, buildTrayMenu: () => { state.trays++; }, pushStatus: () => { state.pushes++; },
    _screenSignature: () => '',
  };
  const names = Object.keys(env);
  // eslint-disable-next-line no-new-func
  const api = new Function(...names, SPAN_SRC + '\nreturn { _canvasSpanWhy, _canvasUnionBounds, _canvasBounds, _canvasScreens, _canvasScreenSig, _canvasHomeDisplay, _canvasSetSpan, _canvasStatePayload, _canvasLayoutNow,'
    + ' _canvasAwayRects, _applyCanvasMoves, _displayChangePlan, _displayPlanText, _layoutOfSet, _fitCanvasToDisplay, _canvasSpanOn, rev: () => _canvasLayoutRev };')(...names.map(k => env[k]));
  return { api, state, win: canvasWindow };
}

describe('main: when the switch can be on', () => {
  it('needs two screens and one scaling, and says why not in a line', () => {
    const w = world();
    expect(w.api._canvasSpanWhy([DA])).toMatch(/one screen/i);
    expect(w.api._canvasSpanWhy([DA, DB])).toBeNull();
    const why = w.api._canvasSpanWhy([DA, disp(2, 1920, 0, 2560, 1440, 1.5)]);
    expect(why).toMatch(/different display scaling/);
    expect(why).not.toMatch(/\n/);
  });
  it('is OFF by default, and a saved "on" does nothing while the screens do not allow it', () => {
    expect(world().api._canvasSpanOn()).toBe(false);
    expect(world({ cfg: { canvasSpan: true } }).api._canvasSpanOn()).toBe(true);
    expect(world({ cfg: { canvasSpan: true }, displays: [DA, disp(2, 1920, 0, 2560, 1440, 1.25)] }).api._canvasSpanOn()).toBe(false);
    expect(world({ cfg: { canvasSpan: true }, displays: [DA] }).api._canvasSpanOn()).toBe(false);
  });
});

describe('main: the window', () => {
  it('the union of every screen, including one to the left or above the primary', () => {
    const w = world();
    expect(w.api._canvasUnionBounds([DA, DB])).toEqual({ x: 0, y: 0, width: 4480, height: 1440 });
    expect(w.api._canvasUnionBounds([disp(1, 0, 0, 1920, 1080), disp(2, -1920, -200, 1920, 1080)])).toEqual({ x: -1920, y: -200, width: 3840, height: 1280 });
  });
  it('covers the home screen unless spanning', () => {
    expect(world({ cfg: { canvasDisplayId: 2 } }).api._canvasBounds()).toEqual(DB.bounds);
    expect(world({ cfg: { canvasDisplayId: 2, canvasSpan: true } }).api._canvasBounds()).toEqual({ x: 0, y: 0, width: 4480, height: 1440 });
    // refused scaling: the home screen, the saved switch notwithstanding
    const mixed = world({ cfg: { canvasDisplayId: 1, canvasSpan: true }, displays: [DA, disp(2, 1920, 0, 2560, 1440, 2)] });
    expect(mixed.api._canvasBounds()).toEqual(DA.bounds);
  });
  it('the screens it describes are relative to the window\'s corner, home marked', () => {
    const w = world({ cfg: { canvasDisplayId: 2, canvasSpan: true } });
    const home = w.api._canvasHomeDisplay();
    expect(w.api._canvasScreens([DA, DB], home, true)).toEqual([
      { sig: '0,0,1920x1080', x: 0, y: 0, w: 1920, h: 1080, home: false, scale: 1 },
      { sig: '1920,0,2560x1440', x: 1920, y: 0, w: 2560, h: 1440, home: true, scale: 1 }]);
    const left = disp(3, -1920, 0, 1920, 1080);
    expect(w.api._canvasScreens([left, DA], DA, true).map(s => [s.x, s.home])).toEqual([[0, false], [1920, true]]);
    expect(w.api._canvasScreens([DA, DB], DB, false)).toEqual([{ sig: '1920,0,2560x1440', x: 0, y: 0, w: 2560, h: 1440, home: true, scale: 1 }]);
  });
  it('the layout is keyed by the HOME screen, not by whichever screen a spanning window mostly covers', () => {
    // The window is the union: most of it is on the 2560×1440 screen, but home is the 1920×1080 one.
    const w = world({ cfg: { canvasDisplayId: 1, canvasSpan: true, canvasLayouts: { '1920x1080': { panels: [{ id: 'h' }] }, '2560x1440': { panels: [{ id: 'other' }] } } },
      win: { x: 0, y: 0, width: 4480, height: 1440 } });
    const st = w.api._canvasStatePayload();
    expect(st.res).toBe('1920x1080');
    expect(st.layout.panels[0].id).toBe('h');
    expect(st.span).toBe(true);
    expect(st.screens.map(s => s.home)).toEqual([true, false]);
    expect(st.spanWhy).toBe('');
  });
  it('not spanning, the payload is what it was: the one screen, and the switch\'s reason when it cannot be on', () => {
    const w = world({ displays: [DA, disp(2, 1920, 0, 2560, 1440, 1.5)], cfg: { canvasDisplayId: 1 } });
    const st = w.api._canvasStatePayload();
    expect(st.screens).toHaveLength(1);
    expect(st.span).toBe(false);
    expect(st.displays).toBe(2);
    expect(st.spanWhy).toMatch(/scaling/);
  });
});

describe('main: turning it on and off', () => {
  it('on: the window covers every screen, home is pinned to where it was, the Canvas is told to look again', () => {
    const w = world({ win: { x: 1920, y: 0, width: 2560, height: 1440 } });
    const r = w.api._canvasSetSpan(true);
    expect(r).toEqual({ ok: true, span: true, why: '' });
    expect(w.state.cfg.canvasSpan).toBe(true);
    expect(w.state.cfg.canvasDisplayId).toBe(2);                       // it was on the second screen: that is home now
    expect(w.win.b).toEqual({ x: 0, y: 0, width: 4480, height: 1440 });
    expect(w.state.sent).toContain('canvas-group-ops');
    expect(w.api.rev()).toBe(1);
    expect(w.state.trays).toBe(1);
  });
  it('off: back to the home screen alone', () => {
    const w = world({ cfg: { canvasSpan: true, canvasDisplayId: 2 }, win: { x: 0, y: 0, width: 4480, height: 1440 } });
    expect(w.api._canvasSetSpan(false).ok).toBe(true);
    expect(w.state.cfg.canvasSpan).toBe(false);
    expect(w.win.b).toEqual(DB.bounds);
  });
  it('mixed scaling: refused with the reason, nothing changes', () => {
    const w = world({ displays: [DA, disp(2, 1920, 0, 2560, 1440, 1.5)] });
    const r = w.api._canvasSetSpan(true);
    expect(r.ok).toBe(false);
    expect(r.why).toMatch(/scaling/);
    expect(w.state.cfg.canvasSpan).toBeUndefined();
    expect(w.win.b).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(w.state.sent).toEqual([]);
  });
  it('a monitor unplugged while spanning: the window shrinks to home, the switch stays on for when it is back', () => {
    const w = world({ cfg: { canvasSpan: true, canvasDisplayId: 1 }, win: { x: 0, y: 0, width: 4480, height: 1440 } });
    expect(w.api._canvasBounds()).toEqual({ x: 0, y: 0, width: 4480, height: 1440 });
    const one = world({ displays: [DA], cfg: { canvasSpan: true, canvasDisplayId: 1 }, win: { x: 0, y: 0, width: 4480, height: 1440 } });
    one.api._fitCanvasToDisplay();
    expect(one.win.b).toEqual(DA.bounds);
    expect(one.state.cfg.canvasSpan).toBe(true);
  });
});

describe('main: a layout FILE stays one screen', () => {
  const home = DA, sigB = '1920,0,2560x1440';
  const set = (panels) => ({ canvas: { '1920x1080': { panels } } });
  it('pieces on another screen are left out and counted; home pieces and those with no `scr` stay', () => {
    const w = world({ cfg: { canvasDisplayId: 1 } });
    const r = w.api._layoutOfSet(set([{ id: 'a' }, { id: 'b', scr: home ? '0,0,1920x1080' : '' }, { id: 'c', scr: sigB }, { id: 'd', scr: sigB }]));
    expect(r.layout.panels.map(p => p.id)).toEqual(['a', 'b']);
    expect(r.offScreen).toBe(2);
  });
  it('a layout with nothing on other screens is handed over untouched', () => {
    const w = world({ cfg: { canvasDisplayId: 1 } });
    const s = set([{ id: 'a' }]);
    const r = w.api._layoutOfSet(s);
    expect(r.layout).toBe(s.canvas['1920x1080']);
    expect(r.offScreen).toBe(0);
  });
  it('the export says how many it left out', () => {
    expect(main).toContain("const left = src.offScreen ? ` (${src.offScreen} piece${src.offScreen === 1 ? '' : 's'} on your other screens left out: a file fits one screen)` : '';");
    expect(main).toContain('message: `Exported "${made.doc.meta.title}" to ${path.basename(file)}${left}`');
  });
});

describe('main: the screens changed — the Canvas panels on the one that went away', () => {
  const BOTH = '0,0,1920x1080|1920,0,2560x1440', ONE = '0,0,1920x1080';
  const sigB = '1920,0,2560x1440';
  const layout = (panels) => ({ canvasLayouts: { '1920x1080': { panels } }, canvasDisplayId: 1 });
  it('lists only panels whose screen was in the old setup and is not in this one', () => {
    const w = world({ displays: [DA], cfg: layout([
      { id: 'home', x: 0.1, y: 0.1, w: 200, h: 40 },
      { id: 'gone', scr: sigB, x: 0.5, y: 0.25, w: 300, h: 100 },
      { id: 'stale', scr: '9999,0,800x600', x: 0.5, y: 0.5, w: 100, h: 100 }]) });   // never part of this setup
    const rects = w.api._canvasAwayRects(w.state.cfg, BOTH);
    expect(Object.keys(rects)).toEqual(['canvas:gone']);
    expect(rects['canvas:gone']).toEqual({ x: 1920 + 1280, y: 360, width: 300, height: 100 });
    // the screen is still here: nothing is away
    const still = world({ displays: [DA, DB], cfg: layout([{ id: 'far', scr: sigB, x: 0.5, y: 0.25, w: 300, h: 100 }]) });
    expect(still.api._canvasAwayRects(still.state.cfg, BOTH)).toEqual({});
  });
  it('the plan carries them with the windows, to the same side the rules give a window', () => {
    const w = world({ displays: [DA] });
    const target = { bounds: DA.bounds, workArea: DA.workArea };
    const p = w.api._displayChangePlan({ prevSig: BOTH, curSig: ONE, memory: {},
      currentRects: { 'canvas:gone': { x: 3200, y: 360, width: 300, height: 100 } },
      curDisplays: [{ bounds: DA.bounds, workArea: DA.workArea }], target });
    expect(p.kind).toBe('bring');
    expect(Object.keys(p.moves)).toEqual(['canvas:gone']);
    const m = p.moves['canvas:gone'];
    expect(m.x).toBeGreaterThanOrEqual(0); expect(m.x + m.width).toBeLessThanOrEqual(1920);
    expect(m.width).toBe(300);
    expect([p.withEq, p.side]).toEqual([0, 0]);                       // not counted as overlay windows
  });
  it('the question names them apart from the windows', () => {
    const w = world({ displays: [DA] });
    const only = w.api._displayPlanText({ kind: 'bring', moves: { 'canvas:a': {}, 'canvas:b': {} }, withEq: 0, side: 0, sideOntoEq: 0 }, true);
    expect(only.detail).toContain('2 Canvas panels that sat on the screen that went away');
    expect(only.detail).not.toMatch(/overlay/);
    const mixed = w.api._displayPlanText({ kind: 'bring', moves: { hudBounds: {}, 'canvas:a': {} }, withEq: 1, side: 0, sideOntoEq: 0 }, true);
    expect(mixed.detail).toContain('1 overlay that sat with EverQuest onto the screen EverQuest is on, and 1 Canvas panel that sat on the screen that went away');
    expect(only.buttons).toEqual(['Move them', 'Leave them']);
  });
  it('"Move them": the panel lands on the screen the plan chose, as a fraction of it; "scr" only when it is not home', () => {
    // three screens down to two: the third's panel moves to the second screen, which is not home
    const w = world({ displays: [DA, DB], cfg: Object.assign(layout([{ id: 'p', scr: '4480,0,1920x1080', x: 0.5, y: 0.5, w: 300, h: 100 }]), { canvasSpan: true }) });
    const n = w.api._applyCanvasMoves({ 'canvas:p': { x: 1920 + 640, y: 720, width: 300, height: 100 } });
    expect(n).toBe(1);
    const p = w.state.cfg.canvasLayouts['1920x1080'].panels[0];
    expect(p.scr).toBe(sigB);
    expect(p.x).toBeCloseTo(0.25, 6);
    expect(p.y).toBeCloseTo(0.5, 6);
    expect(w.api.rev()).toBe(1);
    expect(w.state.sent).toContain('canvas-group-ops');
  });
  it('"Move them" with span off puts it on the home screen at the same relative spot (the only screen shown)', () => {
    const w = world({ displays: [DA, DB], cfg: layout([{ id: 'p', scr: '4480,0,1920x1080', x: 0.5, y: 0.5, w: 300, h: 100 }]) });
    w.api._applyCanvasMoves({ 'canvas:p': { x: 1920 + 640, y: 720, width: 300, height: 100 } });
    const p = w.state.cfg.canvasLayouts['1920x1080'].panels[0];
    expect('scr' in p).toBe(false);
    expect(p.x).toBeCloseTo(0.25, 6);
  });
  it('"Leave them": nothing is rewritten — they stay hidden (canvas.html) and come back with the screen', () => {
    const ask = sliceBlock(main, '  if (choice === 0) {', '  } else {');
    expect(ask).toMatch(/_applyCanvasMoves\(plan\.moves\);\s*_fitCanvasToDisplay\(\);/);
    const w = world({ displays: [DA], cfg: layout([{ id: 'p', scr: sigB, x: 0.5, y: 0.25, w: 300, h: 100 }]) });
    expect(w.api._applyCanvasMoves({})).toBe(0);
    expect(w.state.cfg.canvasLayouts['1920x1080'].panels[0].scr).toBe(sigB);
  });
  it('the ask builds its rects from the layout\'s away panels', () => {
    expect(main).toContain('currentRects: Object.assign(_overlayRectsNow(), _canvasAwayRects(cfg, prevSig)),');
  });
});

// ── the wiring ─────────────────────────────────────────────────────────────────────────────────────────────
describe('wiring: the switch is on the tray, the dashboard and the Canvas, over one IPC', () => {
  it('one IPC, in the preload under one name', () => {
    expect(main).toContain("ipcMain.handle('canvas-span', (_e, on) => _canvasSetSpan(!!on));");
    expect(preload).toContain("canvasSpan:        (on)     => ipcRenderer.invoke('canvas-span', !!on),");
  });
  it('status carries the switch and the reason (blank = it can be on)', () => {
    expect(main).toContain('canvasSpan: !!cfg.canvasSpan,');
    expect(main).toMatch(/canvasSpanWhy: \(\(\) => \{ try \{ return _canvasSpanWhy\(screen\.getAllDisplays\(\)\) \|\| ''; \} catch \{ return ''; \} \}\)\(\),/);
  });
  it('tray: a checkbox under the Canvas entry, greyed with the reason when it cannot be on', () => {
    const item = sliceBlock(main, "{ label: s.canvasSpanWhy ? '  ↳ Span all screens — '", '        _canvasSetSpan(mi.checked);\n      } },');
    expect(item).toContain("type: 'checkbox', checked: !!s.canvasSpan");
    expect(item).toContain('enabled: !s.hideOverlays && (!s.canvasSpanWhy || !!s.canvasSpan)');
  });
  it('dashboard (Overlays tab): the same switch, painted from status, calling the same IPC; hidden on an older Mimic', () => {
    expect(dash).toContain('data-act="canvasSpan" id="wpOvSpanBtn"');
    expect(dash).toMatch(/spBtn\.style\.display = spKnown \? '' : 'none';/);
    expect(dash).toMatch(/if \(a === 'canvasSpan' && window\.mimic\.canvasSpan\) \{\s*window\.mimic\.canvasSpan\(!act\.classList\.contains\('on'\)\)/);
  });
  it('the Canvas\'s own toolbar: the switch, greyed with the reason; ⇆ Next screen only while not spanning', () => {
    const paint = sliceBlock(canvas, '  function paintSpan(st) {', '\n  }\n');
    expect(paint).toContain("screenBtn.style.display = (st.displays > 1 && !st.span) ? '' : 'none';");
    expect(paint).toContain('spanBtn.disabled = !st.span && !!st.spanWhy;');
    expect(canvasRaw).toContain('<button class="btn" id="screenBtn"');
  });
  it('Next screen does nothing while spanning (the window already covers them all)', () => {
    expect(sliceBlock(main, "ipcMain.handle('canvas-next-display', () => {", '\n});')).toContain('if (all.length < 2 || _canvasSpanOn()) return _canvasStatePayload();');
  });
  it('the window is created and refitted over _canvasBounds(), and "bring in what is on screen" measures the same window', () => {
    expect(sliceBlock(main, 'function createCanvasWindow() {', 'canvasWindow = new BrowserWindow({')).toContain('const d = { bounds: _canvasBounds() };');
    expect(sliceBlock(main, 'function _fitCanvasToDisplay() {', '\n}')).toContain('canvasWindow.setBounds(_canvasBounds());');
    expect(sliceBlock(main, 'function _canvasOverlayList() {', 'const docked')).toContain('canvasWindow.getBounds()');
  });
  it('the hosted-overlay lookup keys on the home screen too', () => {
    expect(sliceBlock(main, 'function _canvasHostedKeys(cfg) {', '\n}')).toContain('_canvasHomeDisplay().bounds');
  });
});
