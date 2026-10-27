// test/map-full-mode.test.js — the Map's Full mode and its keep-clear areas.
//
// The guild lead, 2026-10-14: "give map a toggle full vs window mode, and have it avoid drawing over UI elements when
// see through maps are in position."
//
// Three halves, each run as shipped:
//  1. apps/mimic/uiClearRects.js — which EverQuest windows are open, and where, from a UI ini (resolution keys, Show).
//  2. apps/mimic/map.html's pure helpers (uiRectsToMap, inClearArea, ...) and a boot of its script against a stub page:
//     the holes are cut out of the canvas, the spawn-dot buttons under them go, the mode toggle asks main, an edit drag
//     saves a box as fractions of EverQuest's client area.
//  3. apps/mimic/main.js — _setMapMode / _fitMapFull over fake windows (the window-mode spot is saved before the window
//     grows, restored on the way out), and the places the Canvas is passed by now pass a Full-mode Map by too.
//
// Mutation-checked (by hand, 2026-10-14, all three failed as they should): take the clip to the window's edge out of
// uiRectsToMap and "clips to the window" fails; take the `_writeBounds('mapBounds'` flush out of _setMapMode and
// "Window -> Full saves the window-mode spot first" fails; make avoidEqOn ignore the mode and "follows the mode while
// unset" fails.
//
// Run: npx vitest run test/map-full-mode.test.js

import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const { visibleUiRects, zealAreas, applyPicks, cleanPicks, chooseResolution, parseSections } = require(path.join(ROOT, 'apps', 'mimic', 'uiClearRects.js'));
const MAP_HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));
const MAIN = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const PRELOAD = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js')));
const DASH = stripJs(readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html')));

const tick = () => new Promise(r => setImmediate(() => setImmediate(r)));

// ───────────────────────────── 1. the UI ini ─────────────────────────────

describe('visibleUiRects: the windows EverQuest has open, from a UI ini', () => {
  const INI = [
    '[Main]', 'Version=1',
    '[PlayerWindow]', 'INIVersion=1', 'Show=1', 'XPos1920x1080=24', 'YPos1920x1080=30', 'XPos2560x1440=40', 'YPos2560x1440=50', 'Width=260', 'Height=130',
    '[TargetWindow]', 'Show=1', 'XPos1920x1080=300', 'YPos1920x1080=30', 'XPos2560x1440=420', 'YPos2560x1440=40',
    '[BuffWindow]', 'Show=0', 'XPos1920x1080=10', 'YPos1920x1080=200', 'Width=100', 'Height=300',
    '[SpellBookWnd]', 'XPos1920x1080=500', 'YPos1920x1080=300', 'Width=400', 'Height=400',
    '[ChatWindow]', 'show=TRUE', 'xpos1920x1080=0', 'ypos1920x1080=800', 'width=500', 'height=280',
    '[LoginWnd]', 'Show=1', 'XPos1920x1080=0', 'YPos1920x1080=0', 'Width=1920', 'Height=1080',
  ].join('\r\n');

  it('keeps only windows with Show on, in the resolution block the file was last laid out for', () => {
    const r = visibleUiRects(INI, { skip: /^login/i });
    expect(r.res).toEqual({ w: 1920, h: 1080 });                       // most XPos keys: 1920x1080 (x5) over 2560x1440 (x2)
    expect(r.rects.map(x => x.name)).toEqual(['PlayerWindow', 'TargetWindow', 'ChatWindow']);   // Show=0, no Show, and the skipped login window are out
    expect(r.rects[0]).toMatchObject({ x: 24, y: 30, w: 260, h: 130, guess: false });          // the 1920x1080 keys, not the 2560x1440 ones
    expect(r.rects[2]).toMatchObject({ x: 0, y: 800, w: 500, h: 280 }); // key names and Show=TRUE are case-insensitive
  });
  it('gives a shown window with no size a stand-in and says it is a guess', () => {
    const t = visibleUiRects(INI).rects.find(x => x.name === 'TargetWindow');
    expect(t).toMatchObject({ x: 300, y: 30, w: 200, h: 100, guess: true });
  });
  it('falls back to a bare XPos/YPos (the older form) and Size.cx/cy, and drops what is not on the screen', () => {
    const r = visibleUiRects('[A]\nShow=1\nXPos=15\nYPos=25\nSize.cx=90\nSize.cy=40\n[B]\nShow=1\nXPos=-900\nYPos=5\nWidth=10\nHeight=10\n[C]\nShow=1\nXPos=5\nYPos=5\nWidth=0\nHeight=10');
    expect(r.res).toBeNull();
    expect(r.rects).toEqual([{ name: 'A', id: 'ui:a', text: 'A', notes: [], x: 15, y: 25, w: 90, h: 40, guess: false }]);
  });
  it('a missing or empty file is no windows, never an error', () => {
    expect(visibleUiRects('')).toEqual({ res: null, rects: [] });
    expect(visibleUiRects(null).rects).toEqual([]);
  });
});

// ───────────────────────────── 2. map.html ─────────────────────────────

const helpers = sliceBlock(MAP_HTML, '// ── pure helpers', '// ── end pure helpers ──');
// eslint-disable-next-line no-new-func
const H = new Function(helpers + '\nreturn { uiRectsToMap, inClearArea, fracRectsToMap, winRectToFrac, normRect, avoidEqOn, buildClearAreas, outlinesToStage, clearToStage, stageToWin, mapCfgDefaults, mergeMapCfg };')();

describe('uiRectsToMap: EverQuest client pixels -> the Map window', () => {
  const FULL = { x: 0, y: 0, width: 1920, height: 1080 };
  it('Full mode: the window is the client area, so the rectangle only scales by client / resolution', () => {
    const r = H.uiRectsToMap([{ x: 24, y: 30, w: 260, h: 130, name: 'PlayerWindow' }], FULL, FULL, { w: 1920, h: 1080 });
    expect(r).toMatchObject([{ x: 24, y: 30, w: 260, h: 130, name: 'PlayerWindow', guess: false, keep: true, i: 0 }]);
    const s = H.uiRectsToMap([{ x: 100, y: 100, w: 200, h: 100 }], FULL, FULL, { w: 960, h: 540 });   // the ini was laid out for half the client
    expect(s[0]).toMatchObject({ x: 200, y: 200, w: 400, h: 200 });
  });
  it('Window mode: EverQuest\'s client sits somewhere on screen and the Map elsewhere; the offset between them applies', () => {
    const eq = { x: 100, y: 50, width: 1920, height: 1080 }, win = { x: 1500, y: 200, width: 600, height: 400 };
    // an EQ window at (1450, 180) in client pixels is at screen (1550, 230), which is (50, 30) inside the Map
    const r = H.uiRectsToMap([{ x: 1450, y: 180, w: 100, h: 60 }], eq, win, { w: 1920, h: 1080 });
    expect(r[0]).toMatchObject({ x: 50, y: 30, w: 100, h: 60 });
  });
  it('clips to the window, drops what lies outside it, and remembers which input each came from', () => {
    const eq = { x: 0, y: 0, width: 1000, height: 1000 }, win = { x: 0, y: 0, width: 400, height: 300 };
    const r = H.uiRectsToMap([{ x: 350, y: 250, w: 200, h: 200 }, { x: 600, y: 10, w: 50, h: 50 }, { x: 10, y: 10, w: 20, h: 20 }], eq, win, { w: 1000, h: 1000 });
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ x: 350, y: 250, w: 50, h: 50, i: 0 });      // clipped at the window's right and bottom edges
    expect(r[1]).toMatchObject({ x: 10, y: 10, w: 20, h: 20, i: 2 });        // the second input was wholly outside: gone, but i still says 2
  });
  it('with no resolution it takes the rectangles as already in client pixels, and with nothing known it returns nothing', () => {
    expect(H.uiRectsToMap([{ x: 5, y: 5, w: 10, h: 10 }], { x: 0, y: 0, width: 800, height: 600 }, { x: 0, y: 0, width: 800, height: 600 }, null)[0]).toMatchObject({ x: 5, y: 5, w: 10, h: 10 });
    expect(H.uiRectsToMap([{ x: 5, y: 5, w: 10, h: 10 }], null, { x: 0, y: 0, width: 1, height: 1 })).toEqual([]);
    expect(H.uiRectsToMap(null, FULL, FULL)).toEqual([]);
  });
});

describe('inClearArea', () => {
  const areas = [{ x: 10, y: 10, w: 20, h: 20 }, { x: 100, y: 100, w: 5, h: 5 }];
  it('is in on the left and top edges and out on the right and bottom, and false for none', () => {
    expect(H.inClearArea(10, 10, areas)).toBe(true);
    expect(H.inClearArea(29.9, 29.9, areas)).toBe(true);
    expect(H.inClearArea(30, 20, areas)).toBe(false);
    expect(H.inClearArea(20, 30, areas)).toBe(false);
    expect(H.inClearArea(102, 102, areas)).toBe(true);
    expect(H.inClearArea(50, 50, areas)).toBe(false);
    expect(H.inClearArea(1, 1, [])).toBe(false);
    expect(H.inClearArea(1, 1, null)).toBe(false);
  });
});

describe('the raider\'s boxes are fractions of EverQuest\'s client area', () => {
  const ref = { x: 100, y: 50, width: 1920, height: 1080 };
  it('a box dragged on the Map round-trips through the fractions to the same spot', () => {
    const win = { x: 400, y: 300, width: 800, height: 500 };
    const box = { x: 120, y: 80, w: 200, h: 100 };               // in the Map window
    const f = H.winRectToFrac(box, ref, win);
    expect(f.x).toBeCloseTo((400 + 120 - 100) / 1920); expect(f.w).toBeCloseTo(200 / 1920);
    const back = H.fracRectsToMap([f], ref, win)[0];
    expect([back.x, back.y, back.w, back.h].map(Math.round)).toEqual([120, 80, 200, 100]);
  });
  it('the same fractions land on the same part of EverQuest when the client is a different size', () => {
    const win = { x: 0, y: 0, width: 2560, height: 1440 };
    const f = { x: 0.5, y: 0.25, w: 0.1, h: 0.2 };
    expect(H.fracRectsToMap([f], { x: 0, y: 0, width: 2560, height: 1440 }, win)[0]).toMatchObject({ x: 1280, y: 360, w: 256, h: 288 });
    expect(H.fracRectsToMap([f], { x: 0, y: 0, width: 1280, height: 720 }, { x: 0, y: 0, width: 1280, height: 720 })[0]).toMatchObject({ x: 640, y: 180, w: 128, h: 144 });
  });
  it('normRect orders two corners; the page-px <-> window conversion is its own inverse', () => {
    expect(H.normRect(50, 40, 10, 90)).toEqual({ x: 10, y: 40, w: 40, h: 50 });
    const a = { x: 100, y: 60, w: 30, h: 20 };
    const px = H.clearToStage([a], 0.8, 12, 26)[0];
    expect(H.stageToWin(px, 0.8, 12, 26)).toEqual(a);
  });
});

describe('Avoid EQ windows: on in Full, off in Window, until the raider decides', () => {
  it('follows the mode while unset, and the tick follows the raider once set', () => {
    expect(H.avoidEqOn({ avoidEq: null }, 'full')).toBe(true);
    expect(H.avoidEqOn({ avoidEq: null }, 'window')).toBe(false);
    expect(H.avoidEqOn({ avoidEq: false }, 'full')).toBe(false);
    expect(H.avoidEqOn({ avoidEq: true }, 'window')).toBe(true);
  });
  it('is part of the saved settings: kept when it is a boolean, dropped otherwise', () => {
    expect(H.mapCfgDefaults().avoidEq).toBeNull();
    expect(H.mergeMapCfg({ avoidEq: false }).avoidEq).toBe(false);
    expect(H.mergeMapCfg({ avoidEq: 'yes' }).avoidEq).toBeNull();
  });
  it('buildClearAreas gives the EQ windows only when asked, and the raider\'s boxes always', () => {
    const win = { x: 0, y: 0, width: 1920, height: 1080 };
    const clear = { ui: { rects: [{ x: 10, y: 10, w: 100, h: 50 }], res: { w: 1920, h: 1080 } }, ref: win, boxes: [{ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }] };
    expect(H.buildClearAreas(clear, true, win)).toMatchObject({ ui: [{ x: 10, y: 10, w: 100, h: 50 }], user: [{ x: 960, y: 540, w: 192, h: 108 }] });
    const off = H.buildClearAreas(clear, false, win);
    expect(off.ui).toEqual([]); expect(off.user).toHaveLength(1);
    expect(off.off).toHaveLength(1);                             // Avoid off: the window is still found, and drawn over
    expect(H.buildClearAreas(null, true, win)).toEqual({ ui: [], off: [], user: [] });
    expect(H.buildClearAreas(clear, true, null)).toEqual({ ui: [], off: [], user: [] });
  });
});

// A stub page for the script (as test/spawn-map.test.js does), with a canvas that records what is cleared and filled.
async function boot({ mimic, store = {}, innerWidth } = {}) {
  const script = MAP_HTML.slice(MAP_HTML.indexOf('<script>') + 8, MAP_HTML.lastIndexOf('</script>'));
  const all = {};
  const canvas = { clears: [], fills: [], seq: [] };
  const mkEl = (tag) => {
    const e = { tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {}, hidden: false, textContent: '', title: '',
      clientWidth: 600, clientHeight: 400, offsetWidth: 50, offsetHeight: 20,
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      appendChild(ch) { this.children.push(ch); return ch; }, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, getAttribute(k) { return this.attrs[k] ?? null; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 400 }; }, closest() { return null; },
      getContext() {
        return new Proxy({}, {
          get: (_t, k) => {
            if (k === 'measureText') return () => ({ width: 5 });
            return (...a) => {
              canvas.seq.push([k, ...a]);
              if (k === 'clearRect') canvas.clears.push(a);
              if (k === 'fillRect') canvas.fills.push(a);
            };
          },
          set: () => true,
        });
      },
    };
    Object.defineProperty(e, 'className', { get() { return this._cn || ''; }, set(v) { this._cn = v; } });
    // assigning '' empties an element, as a real one does
    Object.defineProperty(e, 'innerHTML', { get() { return this._ih || ''; }, set(v) { this._ih = v; if (v === '') this.children.length = 0; } });
    return e;
  };
  const doc = {
    getElementById(id) { return all[id] || (all[id] = mkEl('#' + id)); },
    createElement: mkEl, addEventListener(t, f) { (doc.listeners[t] = doc.listeners[t] || []).push(f); }, listeners: {}, hidden: false,
    body: mkEl('body'), documentElement: { style: { setProperty() {} } },
  };
  const T0 = Date.UTC(2026, 9, 14, 20, 0, 0);
  const payload = {
    zone: 'thedeep', long_name: 'The Deep', version: 'thedeep@v', status: 'ok', now: T0, local_only: false,
    points: [{ id: 1, x: -100, y: -100, z: 0, respawn_s: 600, variance_s: 60, npcs: [] }, { id: 2, x: -400, y: -300, z: 0, respawn_s: 600, variance_s: 60, npcs: [] }],
    map: { bands: [0], segs: [[0, 0, 100, 0, 0]], bounds: { minX: 0, maxX: 100, minY: 0, maxY: 200 } },
    self: { x: 90, y: 190, z: 0, heading: 64, name: 'Aldenmar' }, group: [], raid: [], target: null, seen: [], unassigned: [], timers: [],
  };
  const win = { addEventListener() {}, devicePixelRatio: 1, innerWidth, mimic };
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  // eslint-disable-next-line no-new-func
  const S = new Function('window', 'document', 'location', 'fetch', 'localStorage', 'ResizeObserver', 'setInterval', 'clearInterval',
    script + '\nreturn S;')(win, doc, { search: '' }, () => Promise.resolve({ json: () => Promise.resolve(payload) }), ls, undefined, () => 1, () => {});
  await tick();
  return { S, all, doc, canvas, store };
}
// The window.mimic bridge: main's answer to mapClearAreas, with every call and callback captured.
function bridge({ mode = 'window', areas } = {}) {
  const m = {
    calls: [], boxesSaved: [],
    getMapMode: () => Promise.resolve(mode),
    setMapMode: vi.fn((x) => Promise.resolve(x)),
    onMapMode: (cb) => { m.pushMode = cb; }, onMapGeom: (cb) => { m.pushGeom = cb; },
    mapClearAreas: vi.fn((o) => { m.calls.push(o); return Promise.resolve(areas); }),
    mapClearBoxesSet: vi.fn((c, b) => { m.boxesSaved.push([c, JSON.parse(JSON.stringify(b))]); return Promise.resolve(b); }),
  };
  return m;
}
const click = (el) => (el.listeners.click || []).forEach(f => f.call(el));
// What main reports: a 600x400 Map window laid exactly over a 600x400 client, with the player window at (20, 30) and the raider's own box.
const AREAS = {
  mode: 'full', eq: true, ref: { x: 0, y: 0, width: 600, height: 400 }, win: { x: 0, y: 0, width: 600, height: 400 },
  ui: { rects: [{ name: 'PlayerWindow', x: 20, y: 30, w: 100, h: 60, guess: false }], res: { w: 600, h: 400 } },
  boxes: [{ x: 0.5, y: 0.5, w: 0.25, h: 0.25 }], char: 'aldenmar',
};

describe('the Map page in Window and Full mode', () => {
  it('Window mode with nothing reported is the map as it was: no holes, no background taken from the pane', async () => {
    const g = await boot({ mimic: bridge({ areas: null }) });
    expect(g.S.mode).toBe('window');
    expect(g.doc.body.classList.contains('full')).toBe(false);
    expect(g.all.mapPane.classList.contains('holes')).toBe(false);
    expect(g.canvas.fills).toEqual([]);                       // the canvas paints no background
    expect(g.canvas.clears.length).toBeGreaterThan(0);
    expect(g.canvas.clears.every(c => c[0] === 0 && c[1] === 0 && c[2] === g.S.w && c[3] === g.S.h)).toBe(true);
    expect(g.all.modeBtn.textContent).toBe('▣ Full');
  });
  it('Full mode: the EverQuest windows and the raider\'s boxes are cut out of the picture, and the pane background moves onto the canvas', async () => {
    const m = bridge({ mode: 'full', areas: AREAS });
    const g = await boot({ mimic: m });
    expect(g.S.mode).toBe('full');
    expect(g.doc.body.classList.contains('full')).toBe(true);
    expect(g.all.modeBtn.textContent).toBe('▢ Window');
    expect(m.calls.length).toBeGreaterThan(0);
    expect(m.calls).toContainEqual({ fresh: false, char: 'Aldenmar' });   // the character the payload names; a cheap read, not a fresh one
    expect(g.S.clearPx).toEqual([{ x: 20, y: 30, w: 100, h: 60 }, { x: 300, y: 200, w: 150, h: 100 }]);
    expect(g.all.mapPane.classList.contains('holes')).toBe(true);
    const cuts = g.canvas.clears.filter(c => !(c[0] === 0 && c[1] === 0 && c[2] === g.S.w));
    expect(cuts).toContainEqual([20, 30, 100, 60]);
    expect(cuts).toContainEqual([300, 200, 150, 100]);
    expect(g.canvas.fills.length).toBeGreaterThan(0);          // the background, painted behind everything then cut
    // the cuts come last, after every stroke and fill: nothing is drawn over a hole
    expect(g.canvas.seq.slice(-2)).toEqual([['clearRect', 20, 30, 100, 60], ['clearRect', 300, 200, 150, 100]]);
    expect(g.canvas.seq.some(s => s[0] === 'stroke' || s[0] === 'fill')).toBe(true);
  });
  it('turning Avoid EQ windows off leaves only the raider\'s own boxes; unset again follows the mode', async () => {
    const g = await boot({ mimic: bridge({ mode: 'full', areas: AREAS }) });
    expect(g.all.cfgAvoid.checked).toBe(true);
    g.all.cfgAvoid.checked = false; g.all.cfgAvoid.listeners.change.forEach(f => f());
    expect(g.S.cfg.avoidEq).toBe(false);
    expect(g.S.clearPx).toEqual([{ x: 300, y: 200, w: 150, h: 100 }]);
    expect(JSON.parse(g.store['wp-map-cfg']).avoidEq).toBe(false);
  });
  it('the spawn-dot buttons under a clear area are not made (no click, no hover card)', async () => {
    // point 1 is at screen (100, 100) with the view centred on it; point 2 elsewhere. A hole over the middle takes point 1's button.
    const g = await boot({ mimic: bridge({ mode: 'full', areas: Object.assign({}, AREAS, { ui: { rects: [{ name: 'W', x: 0, y: 0, w: 600, h: 400 }], res: { w: 600, h: 400 } }, boxes: [] }) }) });
    expect(g.S.clearPx).toEqual([{ x: 0, y: 0, w: 600, h: 400 }]);
    expect(g.all.hits.children.every(h => h.hidden)).toBe(true);
    const free = await boot({ mimic: bridge({ mode: 'full', areas: Object.assign({}, AREAS, { ui: null, boxes: [] }) }) });
    expect(free.all.hits.children.some(h => !h.hidden)).toBe(true);
  });
  it('the Full / Window button asks main (the tray, dashboard and this page share one setter) and follows its answer', async () => {
    const m = bridge({ mode: 'window', areas: null });
    const g = await boot({ mimic: m });
    click(g.all.modeBtn);
    expect(m.setMapMode).toHaveBeenCalledWith('full');
    await tick();
    expect(g.S.mode).toBe('full');
    expect(g.doc.body.classList.contains('full')).toBe(true);
    click(g.all.fullWinBtn);
    expect(m.setMapMode).toHaveBeenLastCalledWith('window');
    await tick();
    expect(g.S.mode).toBe('window');
    g.all.cfgMode.value = 'full'; g.all.cfgMode.listeners.change.forEach(f => f());
    expect(m.setMapMode).toHaveBeenLastCalledWith('full');
    await tick();
    expect(g.S.mode).toBe('full');
    m.pushMode('window');                                       // main flipped it from the tray: the page follows
    await tick();
    expect(g.S.mode).toBe('window');
  });
  it('a plain browser (no window.mimic) still flips the mode locally', async () => {
    const g = await boot({});
    click(g.all.modeBtn);
    expect(g.S.mode).toBe('full');
  });
  it('the window moving re-places the areas on the new spot', async () => {
    const m = bridge({ mode: 'window', areas: Object.assign({}, AREAS, { win: { x: 0, y: 0, width: 600, height: 400 }, boxes: [] }) });
    const g = await boot({ mimic: m });
    g.S.cfg.avoidEq = true;
    m.pushGeom({ x: 10, y: 5, width: 600, height: 400 });       // the Map was dragged 10 right and 5 down: EverQuest's window is 10 left, 5 up of it
    expect(g.S.clearPx).toEqual([{ x: 10, y: 25, w: 100, h: 60 }]);   // 20 - 10, 30 - 5; it still fits inside the window
  });
  it('under an overlay zoom the areas follow the page px (innerWidth / window width), not the screen units', async () => {
    const g = await boot({ mimic: bridge({ mode: 'full', areas: Object.assign({}, AREAS, { boxes: [] }) }), innerWidth: 300 });   // zoom 2: 600 DIP -> 300 CSS px
    expect(g.S.clearPx).toEqual([{ x: 10, y: 15, w: 50, h: 30 }]);
  });
  it('Edit clear areas: a drag saves a box as fractions of EverQuest\'s client; ✕ removes it; Clear all empties; nothing is saved from a click', async () => {
    const m = bridge({ mode: 'full', areas: Object.assign({}, AREAS, { ui: null, boxes: [] }) });
    const g = await boot({ mimic: m });
    click(g.all.clearEditBtn);
    expect(g.S.clear.edit).toBe(true);
    expect(g.all.clearEdit.hidden).toBe(false);
    expect(g.all.clearEditBtn.textContent).toBe('Done editing');
    const drag = (x0, y0, x1, y1) => {
      g.all.clearEdit.listeners.mousedown.forEach(f => f({ button: 0, clientX: x0, clientY: y0, target: { closest: () => null }, preventDefault() {} }));
      g.doc.listeners.mousemove.forEach(f => f({ buttons: 1, clientX: x1, clientY: y1 }));
      g.doc.listeners.mouseup.forEach(f => f());
    };
    drag(60, 40, 180, 100);                                      // 120 x 60 on a 600 x 400 client
    expect(m.boxesSaved).toHaveLength(1);
    expect(m.boxesSaved[0][0]).toBe('aldenmar');
    expect(m.boxesSaved[0][1][0]).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.15 });
    expect(g.S.clearPx).toEqual([{ x: 60, y: 40, w: 120, h: 60 }]);
    drag(300, 300, 303, 302);                                    // a click: no box
    expect(m.boxesSaved).toHaveLength(1);
    drag(500, 20, 400, 120);                                     // dragged up-left of where it started: still a box
    expect(m.boxesSaved).toHaveLength(2);
    expect(g.S.clear.boxes).toHaveLength(2);
    click(g.all.clearAll);
    expect(m.boxesSaved[2][1]).toEqual([]);
    expect(g.S.clearPx).toEqual([]);
    click(g.all.clearDone);
    expect(g.S.clear.edit).toBe(false);
    expect(g.all.clearEdit.hidden).toBe(true);
  });
  it('the boxes are drawn dashed only while editing, and a box edit never lands while main re-reads under the raider\'s hand', async () => {
    const m = bridge({ mode: 'full', areas: AREAS });
    const g = await boot({ mimic: m });
    expect(g.all.clearBoxes.children).toHaveLength(0);          // not editing: no outlines
    click(g.all.clearEditBtn);
    expect(g.all.clearBoxes.children.map(c => c.className)).toEqual(['cbox user']);   // the game windows are outlined on the canvas, named
    const before = g.S.clear.boxes.length;
    await m.mapClearAreas({}).then(() => {});
    expect(g.S.clear.boxes).toHaveLength(before);
  });
  it('is switched off in the timers pop-out and the markup carries the controls', () => {
    const js = stripJs(MAP_HTML);
    expect(js).toMatch(/function refreshClear\(fresh\) \{\s*if \(PART_TIMERS \|\|/);
    expect(js).toMatch(/function rebuildClear\(noRender\) \{\s*if \(PART_TIMERS\) return;/);
    expect(MAP_HTML).toMatch(/<button class="tb" id="modeBtn" type="button"/);
    expect(MAP_HTML).toMatch(/<select id="cfgMode">/);
    expect(MAP_HTML).toMatch(/<input type="checkbox" id="cfgAvoid">/);
    expect(MAP_HTML).toMatch(/camp or zone/);                   // the note: EverQuest saves window positions then
    expect(sliceBlock(MAP_HTML, '<div id="fullCtl">', '</div>')).toMatch(/id="fullWinBtn"[\s\S]*id="fullCfgBtn"/);
    expect(stripJs(MAP_HTML)).toMatch(/\(_unlocked && S\.mode !== 'full'\)/);   // Full is click-through: unlocking does not wall off the game
    expect(stripJs(MAP_HTML)).toMatch(/S\.sideMode === 'grow' && S\.mode !== 'full'/);   // the timers column never widens a screen-sized window
  });
});

// ───────────────────────────── 3. main.js ─────────────────────────────

describe('main.js: Full mode is a screen-sized, click-through cover like the Canvas', () => {
  const js = stripJs(MAIN);
  it('the Canvas\'s exemptions now cover a Full-mode Map too: rescue, auto-arrange, screen change, move-to-screen, hover brighten', () => {
    const { _coversScreen } = new Function('let _mapFull = false; function _set(v){ _mapFull = v; }\n'
      + sliceBlock(MAIN, 'function _coversScreen(key) {', '\n') + '\nreturn { _coversScreen, _set };')();
    expect(_coversScreen('canvas')).toBe(true);
    expect(_coversScreen('map')).toBe(false);                    // Window mode: an ordinary overlay
    expect(_coversScreen('hud')).toBe(false);
    const f = new Function('let _mapFull = true;\n' + sliceBlock(MAIN, 'function _coversScreen(key) {', '\n') + '\nreturn _coversScreen;')();
    expect(f('map')).toBe(true);
    for (const needle of [
      /function _boundsKeyForEntry\(key, win\) \{\s*if \(_coversScreen\(key\)\) return null;/,
      /if \(_coversScreen\(key\) \|\| !win \|\| win\.isDestroyed\(\)\) continue;/,                       // _rescueOffscreenOverlays
      /if \(_coversScreen\(key\)\) continue;\s*try \{\s*present\.add\(key\);/,                           // 🧲 Rescue
      /if \(_coversScreen\(k\)\) return false; try \{ return w\.isVisible\(\);/,                         // auto-arrange
      /if \(!win \|\| win\.isDestroyed\(\) \|\| _coversScreen\(key\)\) return;\s*const st0/,             // hover brighten
      /if \(!key \|\| _coversScreen\(key\)\) return false;\s*const to = screen/,                         // move to another screen
      /screens: key && !_coversScreen\(key\) \? _otherScreensFor\(win\) : \[\]/,
    ]) expect(js).toMatch(needle);
  });
  it('click-through always: unlocking and the hover handshake leave a Full-mode Map click-through, as the Canvas', () => {
    expect(js).toMatch(/if \(_coversScreen\(key\)\) \{\s*win\.setIgnoreMouseEvents\(true, \{ forward: true \}\);\s*\} else if \(locked\)|if \(_coversScreen\(key\)\) \{[\s\S]{0,200}?win\.setIgnoreMouseEvents\(true, \{ forward: true \}\);/);
    expect(js).toMatch(/if \(win === canvasWindow \|\| \(win === mapWindow && _mapFull\)\) \{ win\.setIgnoreMouseEvents\(true, \{ forward: true \}\); return true; \}/);
  });
  it('setup / unlock do not conjure a Full-mode Map that is switched off, and the EQ gate still applies', () => {
    expect(js).toMatch(/if \(e\.key === 'map' && _mapFull\) \{\s*return !!cfg\.showMap && \(setupMode \|\| cfg\.overlaysLocked === false \|\| \(!cfg\.hideOverlays && _eqGateOk\(cfg\)\)\);/);
    expect(js).toMatch(/const shouldShow = _mapFull\s*\? !!cfg\.showMap && \(unlocked \|\| \(!cfg\.hideOverlays && _eqGateOk\(cfg\)\)\)/);
  });
  it('only Window mode saves the Map\'s bounds (the cover must never overwrite the window\'s own spot)', () => {
    expect(js).toMatch(/mapWindow\.on\('moved',\s+\(\) => \{ if \(!_mapFull\) _persistBounds\('mapBounds', mapWindow\); _mapGeomPush\(\); \}\);/);
    expect(js).toMatch(/mapWindow\.on\('resize', \(\) => \{ if \(!_mapFull\) _persistBounds\('mapBounds', mapWindow\); _mapGeomPush\(\); \}\);/);
  });
  it('a screen change re-covers EverQuest\'s client area without a question (it is a cover, not a placed window)', () => {
    expect(sliceBlock(js, 'async function _askAboutDisplays() {', 'const eqWin = _eqMainWindow();')).toMatch(/await _eqWindowGeometry\(0\);[\s\S]*await _fitMapFull\(false\);/);
    expect(js).not.toMatch(/display-added',\s+_fitMapFull/);       // no new display listener that moves windows unasked (§80)
  });
  it('the tray, the dashboard and the Map all drive one setter, and the status carries the mode', () => {
    expect(js).toMatch(/label: ' {2}↳ Map: full screen over EverQuest \[beta\]', type: 'checkbox', checked: s\.mapMode === 'full'[\s\S]{0,120}?_setMapMode\(mi\.checked \? 'full' : 'window'\)/);
    expect(js).toMatch(/ipcMain\.handle\('map-mode-set', \(_e, mode\) => _setMapMode\(mode === 'full' \? 'full' : 'window'\)\)/);
    expect(js).toMatch(/mapMode: cfg\.mapMode === 'full' \? 'full' : 'window'/);
    expect(DASH).toMatch(/data-act="mapMode" id="wpOvMapModeBtn"/);
    expect(DASH).toMatch(/window\.mimic\.setMapMode\(st && st\.mapMode === 'full' \? 'window' : 'full'\)/);
    for (const name of ['getMapMode', 'setMapMode', 'onMapMode', 'onMapGeom', 'mapClearAreas', 'mapClearBoxesSet']) expect(PRELOAD).toContain(name + ':');
  });
});

describe('_setMapMode / _fitMapFull over fake windows', () => {
  function rig({ eq = { client: { x: 100, y: 60, width: 1920, height: 1080 } }, cfg = {}, display = { x: 0, y: 0, width: 2560, height: 1440 } } = {}) {
    const store = { cfg: { ...cfg }, writes: [], sent: [], boundsSet: [], resizable: [] };
    const win = {
      b: { x: 60, y: 120, width: 760, height: 480 }, destroyed: false,
      isDestroyed() { return this.destroyed; }, getBounds() { return { ...this.b }; },
      setBounds(nb) { this.b = { ...nb }; store.boundsSet.push({ ...nb }); }, setResizable(v) { store.resizable.push(v); },
      webContents: { send: (ch, v) => store.sent.push([ch, v]) },
    };
    const env = {
      screen: { getDisplayMatching: () => ({ bounds: display }), getPrimaryDisplay: () => ({ bounds: display }) },
      _live: (w) => !!(w && !w.isDestroyed()),
      _eqMainWindow: () => eq, _eqWindowGeometry: vi.fn(async () => []),
      _OVERLAY_MIN_W: 200, _boundsSaveTimers: { mapBounds: 123 },
      _writeBounds: vi.fn((k) => store.writes.push(k)),
      loadConfig: () => store.cfg, saveConfig: (c) => { store.cfg = c; },
      _resolveBounds: vi.fn(() => ({ x: 60, y: 120, width: 760, height: 480 })),
      applyOverlayInteractivity: vi.fn(), applyMapVisibility: vi.fn(), pushStatus: vi.fn(), buildTrayMenu: vi.fn(),
    };
    const block = sliceBlock(MAIN, 'function _mapFullRect(base) {', "  return _mapFull ? 'full' : 'window';\n}\n");
    // eslint-disable-next-line no-new-func
    const api = new Function(...Object.keys(env), 'let _mapFull = false; let mapWindow = null;\n' + block
      + '\nreturn { _setMapMode, _fitMapFull, _mapFullRect, set win(w) { mapWindow = w; }, get full() { return _mapFull; }, set full(v) { _mapFull = v; } };')(...Object.values(env));
    api.win = win;
    return { api, win, store, env };
  }
  it('Window -> Full saves the window-mode spot first, covers EverQuest\'s client area, locks resizing and tells the page', async () => {
    const { api, win, store, env } = rig();
    const r = await api._setMapMode('full');
    expect(r).toBe('full');
    expect(store.writes).toEqual(['mapBounds']);                  // saved BEFORE the window grew
    expect(env._boundsSaveTimers.mapBounds).toBeNull();           // a pending save of the old spot cannot land late over the cover
    expect(store.cfg.mapMode).toBe('full');
    expect(win.b).toEqual({ x: 100, y: 60, width: 1920, height: 1080 });
    expect(store.resizable).toContain(false);
    expect(env._eqWindowGeometry).toHaveBeenCalledWith(0);        // a fresh read when the mode changes
    expect(env.applyOverlayInteractivity).toHaveBeenCalled();
    expect(store.sent).toContainEqual(['map-mode', 'full']);
    expect(store.sent.some(s => s[0] === 'map-geom')).toBe(true);
    expect(api.full).toBe(true);
  });
  it('Full -> Window puts the window back where it was and does not save the cover\'s bounds', async () => {
    const { api, win, store, env } = rig({ cfg: { mapMode: 'full' } });
    api.full = true;
    win.b = { x: 100, y: 60, width: 1920, height: 1080 };
    expect(await api._setMapMode('window')).toBe('window');
    expect(win.b).toEqual({ x: 60, y: 120, width: 760, height: 480 });
    expect(store.writes).toEqual([]);
    expect(store.cfg.mapMode).toBe('window');
    expect(env._resolveBounds).toHaveBeenCalledWith('mapBounds', 'mapBoundsSig', expect.any(Object));
    expect(store.sent).toContainEqual(['map-mode', 'window']);
  });
  it('asking for the mode it is already in changes nothing', async () => {
    const { api, store } = rig();
    expect(await api._setMapMode('window')).toBe('window');
    expect(store.writes).toEqual([]); expect(store.boundsSet).toEqual([]);
  });
  it('with no answer about EverQuest the cover is the screen the Map is on', async () => {
    const { api, win } = rig({ eq: null });
    await api._setMapMode('full');
    expect(win.b).toEqual({ x: 0, y: 0, width: 2560, height: 1440 });
  });
  it('_fitMapFull does nothing in Window mode or once the window is gone', async () => {
    const { api, win, store } = rig();
    await api._fitMapFull(true);
    expect(store.boundsSet).toEqual([]);
    api.full = true; win.destroyed = true;
    await api._fitMapFull(false);
    expect(store.boundsSet).toEqual([]);
  });
});

describe('the keep-clear boxes main keeps', () => {
  const block = sliceBlock(MAIN, 'function _mapBoxKey(char) {', '  return out;\n}\n');
  const { _mapBoxKey, _mapCleanBoxes } = new Function(block + '\nreturn { _mapBoxKey, _mapCleanBoxes };')();
  it('keys a character by its letters, lower-cased, and never by nothing', () => {
    expect(_mapBoxKey('Aldenmar')).toBe('aldenmar');
    expect(_mapBoxKey('')).toBe('_');
    expect(_mapBoxKey(null)).toBe('_');
  });
  it('keeps sane fractions (rounded), drops junk, and caps the list', () => {
    const ok = { x: 0.123456789, y: 0.5, w: 0.2, h: 0.1 };
    expect(_mapCleanBoxes([ok, { x: 'a', y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 0, h: 0.1 }, { x: 9, y: 0, w: 0.1, h: 0.1 }, null, { x: 0, y: 0, w: 5, h: 1 }]))
      .toEqual([{ x: 0.12346, y: 0.5, w: 0.2, h: 0.1 }]);
    expect(_mapCleanBoxes('nope')).toEqual([]);
    expect(_mapCleanBoxes(Array.from({ length: 100 }, () => ok))).toHaveLength(40);
  });
  it('are stored per screen setup and per character, and the answer reads that same place', () => {
    const js = stripJs(MAIN);
    expect(js).toMatch(/store\[sig\]\[key\] = clean/);
    expect(js).toMatch(/store\[_screenSignature\(\)\]\[_mapBoxKey\(char\)\]/);
  });
  it('reads the UI ini of the active character first and the newest one otherwise; the file is only read, never written', () => {
    const js = stripJs(MAIN);
    expect(js).toMatch(/const file = \(char && _newestUiIniFile\(char\)\) \|\| _newestUiIniFile\(\);/);
    expect(sliceBlock(js, 'function _mapClearUiRects(char) {', 'function _mapBoxKey(char) {')).not.toMatch(/writeFile|_backupAndWriteFile/);
    expect(js).toMatch(/const only = char && \/\^\[A-Za-z\]\+\$\/\.test\(String\(char\)\)/);
  });
});

// ───────────────────────────── 4. see what is kept clear, and choose ─────────────────────────────
//
// The guild lead, 2026-10-14, two screenshots of big dark rectangles cut out of the Map, one over nothing visible: "What UI
// element is this looking to avoid? It cuts out a lot of it. We should be able to see what's hidden and what is not."
// Invented ini fixtures only (the section names are EverQuest's own, the numbers are made up).
//
// Mutation-checked (by hand, 2026-10-14): make applyPicks default every area to keep (`!r.guess` -> `true`) and "a guessed area
// is off until the raider ticks it" fails; make buildClearAreas push every area to `ui` and "an unticked window is drawn over"
// fails; make chooseResolution ignore the client and "reads the block that matches" fails.

describe('every area is named as the UI file names it, and a guess says so', () => {
  const INI = [
    '[PlayerWindow]', 'Show=1', 'XPos1920x1080=24', 'YPos1920x1080=30', 'Width=260', 'Height=130',
    '[TargetWindow]', 'Show=1', 'XPos1920x1080=300', 'YPos1920x1080=30',
    '[ChatWindow 2]', 'Show=1', 'XPos1920x1080=0', 'YPos1920x1080=800', 'Width=500', 'Height=280',
    '[BuffWindow]', 'Show=0', 'XPos1920x1080=10', 'YPos1920x1080=200', 'Width=100', 'Height=300',
  ].join('\n');
  it('the label is the section name; a window with no size reads "(size guessed)"; the id is the lower-cased name', () => {
    const r = visibleUiRects(INI).rects;
    expect(r.map(x => x.name)).toEqual(['PlayerWindow', 'TargetWindow', 'ChatWindow 2']);
    expect(r.map(x => x.text)).toEqual(['PlayerWindow', 'TargetWindow (size guessed)', 'ChatWindow 2']);
    expect(r.map(x => x.id)).toEqual(['ui:playerwindow', 'ui:targetwindow', 'ui:chatwindow 2']);
    expect(r.map(x => x.guess)).toEqual([false, true, false]);
  });
  it('Zeal\'s raid bars that run to the screen edge are a guess; a bounded box and the assist bar are not', () => {
    const res = { w: 1920, h: 1080 };
    const z = zealAreas([
      { name: 'Zeal RaidBars', x: 5, y: 5, w: 1915, h: 1075 },
      { name: 'Zeal AssistBar', x: 5, y: 30, w: 176, h: 36 },
    ], res);
    expect(z.map(a => a.text)).toEqual(['Zeal RaidBars (runs to the screen edge)', 'Zeal AssistBar']);
    expect(z.map(a => a.guess)).toEqual([true, false]);
    expect(zealAreas([{ name: 'Zeal RaidBars', x: 10, y: 20, w: 300, h: 400 }], res)[0].guess).toBe(false);
    expect(zealAreas(null, res)).toEqual([]);
  });
  it('the outline names a raider\'s own box "Your area N", from its place in the saved list', () => {
    const win = { x: 0, y: 0, width: 1000, height: 1000 };
    const clear = { ui: { rects: [{ name: 'PlayerWindow', id: 'ui:playerwindow', text: 'PlayerWindow', x: 0, y: 0, w: 10, h: 10, keep: true }], res: { w: 1000, h: 1000 } },
      ref: win, boxes: [{ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }] };
    const out = H.outlinesToStage(H.buildClearAreas(clear, true, win), 1, 0, 0);
    expect(out.map(o => [o.kind, o.text])).toEqual([['ui', 'PlayerWindow'], ['user', 'Your area 1'], ['user', 'Your area 2']]);
  });
});

describe('a guess is not cut out until the raider says so, and the choice is theirs', () => {
  const rects = visibleUiRects('[A]\nShow=1\nXPos1920x1080=1\nYPos1920x1080=1\nWidth=50\nHeight=50\n[B]\nShow=1\nXPos1920x1080=100\nYPos1920x1080=1\n').rects;
  it('a guessed area is off until the raider ticks it; a known one is on until they untick it', () => {
    expect(applyPicks(rects, {}).map(r => [r.id, r.keep])).toEqual([['ui:a', true], ['ui:b', false]]);
    expect(applyPicks(rects, { 'ui:b': true, 'ui:a': false }).map(r => [r.id, r.keep])).toEqual([['ui:a', false], ['ui:b', true]]);
    expect(applyPicks(rects, null).map(r => r.keep)).toEqual([true, false]);
  });
  it('picks are saved as booleans for ui:/zeal: ids only, and survive a JSON round trip', () => {
    const picks = { 'ui:targetwindow': true, 'ui:playerwindow': false, 'zeal:zeal raidbars': false, 'junk': true, 'ui:x': 'yes' };
    const clean = cleanPicks(picks);
    expect(clean).toEqual({ 'ui:targetwindow': true, 'ui:playerwindow': false, 'zeal:zeal raidbars': false });
    expect(cleanPicks(JSON.parse(JSON.stringify(clean)))).toEqual(clean);
    expect(cleanPicks('nope')).toEqual({});
    const big = {}; for (let i = 0; i < 200; i++) big['ui:w' + i] = true;
    expect(Object.keys(cleanPicks(big))).toHaveLength(80);
  });
  it('an unticked window is drawn over: it leaves the cut-out set, but stays found so it can be listed and outlined', () => {
    const win = { x: 0, y: 0, width: 600, height: 400 };
    const mk = (keep) => ({ ui: { rects: [{ name: 'W', id: 'ui:w', text: 'W', x: 10, y: 10, w: 50, h: 50, keep }], res: { w: 600, h: 400 } }, ref: win, boxes: [] });
    const on = H.buildClearAreas(mk(true), true, win), off = H.buildClearAreas(mk(false), true, win);
    expect(on.ui).toHaveLength(1); expect(on.off).toHaveLength(0);
    expect(off.ui).toHaveLength(0); expect(off.off).toHaveLength(1);
    expect(H.buildClearAreas(mk(true), false, win).ui).toHaveLength(0);       // Avoid EQ windows off: none of them
  });
  it('does not guess at a minimised or collapsed key: none is confirmed in any UI file seen, so a window stays as stored', () => {
    const r = visibleUiRects('[W]\nShow=1\nXPos1920x1080=1\nYPos1920x1080=1\nWidth=50\nHeight=50\nMinimized=1\n').rects;
    expect(r).toHaveLength(1);
  });
});

describe('the resolution block read is the one EverQuest is running at', () => {
  const sec = (res, n) => ['[W' + res + ']', 'Show=1', ...Array.from({ length: n }, (_, i) => 'XPos' + res + '=' + i)];
  const INI = [...sec('2560x1440', 5), ...sec('1920x1080', 2), '[Real]', 'Show=1', 'XPos1920x1080=10', 'YPos1920x1080=10', 'XPos2560x1440=99', 'YPos2560x1440=99', 'Width=40', 'Height=40'].join('\n');
  it('reads the block that matches the client, even when another has more windows', () => {
    const none = visibleUiRects(INI);
    expect(none.res).toEqual({ w: 2560, h: 1440 });                                  // no client known: the dominant block, as before
    expect(none.rects.find(r => r.name === 'Real')).toMatchObject({ x: 99, y: 99 });
    const at = visibleUiRects(INI, { client: { w: 1920, h: 1080 } });
    expect(at.res).toEqual({ w: 1920, h: 1080, match: true });
    expect(at.rects.find(r => r.name === 'Real')).toMatchObject({ x: 10, y: 10, guess: false });
  });
  it('a block within 3% counts as the same size (a window frame a few pixels off)', () => {
    expect(visibleUiRects(INI, { client: { w: 1936, h: 1090 } }).res).toMatchObject({ w: 1920, h: 1080, match: true });
  });
  it('when no block is near the client, the dominant one is read, every area is a guess, and the note says what it was saved for', () => {
    const r = visibleUiRects(INI, { client: { w: 1280, h: 720 } });
    expect(r.res).toEqual({ w: 2560, h: 1440, match: false });
    const real = r.rects.find(x => x.name === 'Real');
    expect(real).toMatchObject({ guess: true, text: 'Real (saved for 2560x1440)' });
    expect(applyPicks(r.rects, {}).every(x => x.keep === false)).toBe(true);        // unticked until the raider decides
  });
  it('a file with no resolution blocks is left as it was', () => {
    expect(chooseResolution(parseSections('[A]\nShow=1\nXPos=5\nYPos=5\n'), { w: 1920, h: 1080 })).toBeNull();
  });
});

describe('main keeps the picks per character and per screen setup', () => {
  // The real handler and readers, over an in-memory config.
  const make = () => {
    const state = { cfg: {}, sig: 'setup-a', handlers: {} };
    const body = sliceBlock(MAIN, 'function _mapBoxKey(char) {', '  return out;\n}\n')
      + sliceBlock(MAIN, 'function _mapClearPicks(char) {', '\n}\n')
      + sliceBlock(MAIN, "ipcMain.handle('map-clear-pick-set'", '\n});');
    // eslint-disable-next-line no-new-func
    const run = new Function('loadConfig', 'saveConfig', '_screenSignature', '_activeCharName', 'cleanPicks', '_mapClearUiRects', 'ipcMain',
      body + '\nreturn { _mapClearPicks };');
    const out = run(() => JSON.parse(JSON.stringify(state.cfg)), (c) => { state.cfg = JSON.parse(JSON.stringify(c)); }, () => state.sig, 'Aldenmar',
      cleanPicks, (c) => ({ asked: c }), { handle: (n, f) => { state.handlers[n] = f; } });
    return { state, picks: out._mapClearPicks, set: (...a) => state.handlers['map-clear-pick-set']({}, ...a) };
  };
  it('a pick round-trips, is kept apart per character and per screen setup, and null puts it back to the default', () => {
    const m = make();
    expect(m.picks('Aldenmar')).toEqual({});
    expect(m.set('Aldenmar', 'ui:playerwindow', false)).toEqual({ asked: 'Aldenmar' });   // answers with the windows as they now stand
    m.set('Aldenmar', 'ui:targetwindow', true);
    expect(m.picks('Aldenmar')).toEqual({ 'ui:playerwindow': false, 'ui:targetwindow': true });
    expect(m.picks('Brackwyn')).toEqual({});                                                 // another character
    m.state.sig = 'setup-b';
    expect(m.picks('Aldenmar')).toEqual({});                                                 // another screen setup
    m.state.sig = 'setup-a';
    m.set('Aldenmar', 'ui:playerwindow', null);
    expect(m.picks('Aldenmar')).toEqual({ 'ui:targetwindow': true });
    m.set('Aldenmar', null, null);                                                           // Defaults
    expect(m.picks('Aldenmar')).toEqual({});
    expect(m.state.cfg.mapClearPicks).toEqual({});                                           // nothing left over to carry
  });
  it('junk ids are not stored', () => {
    const m = make();
    m.set('Aldenmar', 'not an id', true);
    m.set('Aldenmar', 'ui:ok', 'maybe');
    expect(m.picks('Aldenmar')).toEqual({});
  });
  it('the windows main reports carry the picks applied', () => {
    const js = stripJs(MAIN);
    expect(js).toMatch(/rects: applyPicks\(rects, picks\)/);
    expect(js).toMatch(/rects = rects\.concat\(zealAreas\(_zealBarRects\(/);
    expect(PRELOAD).toMatch(/mapClearPickSet:\s+\(char, id, keep\) => ipcRenderer\.invoke\('map-clear-pick-set', char, id, keep\)/);
  });
});

describe('the Map page: outlines, the list in ⚙, and the pick', () => {
  const win600 = { x: 0, y: 0, width: 600, height: 400 };
  const AREAS2 = {
    mode: 'full', eq: true, ref: win600, win: win600, boxes: [{ x: 0.5, y: 0.5, w: 0.25, h: 0.25 }], char: 'aldenmar',
    ui: {
      res: { w: 600, h: 400 }, client: { w: 600, h: 400 },
      rects: [
        { name: 'PlayerWindow', id: 'ui:playerwindow', text: 'PlayerWindow', notes: [], x: 20, y: 30, w: 100, h: 60, guess: false, keep: true },
        { name: 'TargetWindow', id: 'ui:targetwindow', text: 'TargetWindow (size guessed)', notes: ['size guessed'], x: 200, y: 30, w: 200, h: 100, guess: true, keep: false },
      ],
    },
  };
  const withPicks = (areas) => {
    const m = bridge({ mode: 'full', areas: JSON.parse(JSON.stringify(areas)) });   // the page marks the rects it is handed: one copy per test
    m.picked = [];
    m.mapClearPickSet = vi.fn((c, id, keep) => { m.picked.push([c, id, keep]); return Promise.resolve(null); });
    return m;
  };
  // (the compass's N / E / S / W are canvas text too, on every frame: they are not what these tests are about)
  const texts = (g) => g.canvas.seq.filter(s => s[0] === 'fillText').map(s => s[1]).filter(t => !/^[NESW]$/.test(t));
  const rows = (g) => g.all.clearList.children;

  it('an ignored window is not cut out, and a guessed one starts that way; the kept window and your box are', async () => {
    const g = await boot({ mimic: withPicks(AREAS2) });
    expect(g.S.clearPx).toEqual([{ x: 20, y: 30, w: 100, h: 60 }, { x: 300, y: 200, w: 150, h: 100 }]);
    expect(g.S.clearWin.off.map(a => a.id)).toEqual(['ui:targetwindow']);
  });
  it('the list has a row per window found, named as the file names it, ticked as kept; a guess says "size unknown"', async () => {
    const g = await boot({ mimic: withPicks(AREAS2) });
    expect(rows(g)).toHaveLength(2);
    expect(rows(g).map(r => r.children[1].textContent)).toEqual(['PlayerWindow', 'TargetWindow']);
    expect(rows(g).map(r => r.children[0].checked)).toEqual([true, false]);
    expect(rows(g)[1].children[1].children[0].textContent).toBe(' · size unknown');
    expect(g.all.clearListHead.textContent).toBe('Game windows: 1 of 2 kept clear');
    expect(rows(g).every(r => r.attrs['data-wp-interact'] === '')).toBe(true);        // the hover handshake: Full mode is click-through
  });
  it('ticking a row cuts that window out at once, tells main, and unticking gives the picture back', async () => {
    const m = withPicks(AREAS2);
    const g = await boot({ mimic: m });
    const cb = rows(g)[1].children[0];
    cb.checked = true; cb.listeners.change.forEach(f => f());
    expect(m.picked).toEqual([['aldenmar', 'ui:targetwindow', true]]);
    expect(g.S.clearPx).toContainEqual({ x: 200, y: 30, w: 200, h: 100 });
    expect(g.all.clearListHead.textContent).toBe('Game windows: 2 of 2 kept clear');
    const first = rows(g)[0].children[0];
    first.checked = false; first.listeners.change.forEach(f => f());
    expect(m.picked[1]).toEqual(['aldenmar', 'ui:playerwindow', false]);
    expect(g.S.clearPx.some(a => a.x === 20)).toBe(false);                             // the player window is drawn over now
    expect(g.S.clearPx).toHaveLength(2);
  });
  it('Defaults sends one reset and puts the guesses back off', async () => {
    const m = withPicks(AREAS2);
    const g = await boot({ mimic: m });
    const cb = rows(g)[1].children[0]; cb.checked = true; cb.listeners.change.forEach(f => f());
    click(g.all.clearListReset);
    expect(m.picked[m.picked.length - 1]).toEqual(['aldenmar', null, null]);
    expect(rows(g).map(r => r.children[0].checked)).toEqual([true, false]);
  });
  it('rows are not rebuilt by a pick (the mouse stays on its row), only when the windows themselves change', async () => {
    const g = await boot({ mimic: withPicks(AREAS2) });
    const before = rows(g)[0];
    const cb = rows(g)[0].children[0]; cb.checked = false; cb.listeners.change.forEach(f => f());
    expect(rows(g)[0]).toBe(before);
  });
  it('outlines name each area and show only while ⚙ is open, a box is edited, or Outline clear areas is on', async () => {
    const g = await boot({ mimic: withPicks(AREAS2) });
    expect(texts(g)).toEqual([]);                                                        // nothing over the game by default
    click(g.all.cfgBtn);
    expect(texts(g)).toEqual(expect.arrayContaining(['PlayerWindow', 'TargetWindow (size guessed) · drawn over', 'Your area 1']));
    expect(g.canvas.seq.filter(s => s[0] === 'strokeRect').length).toBeGreaterThanOrEqual(3);   // one outline per area, per paint
    click(g.all.cfgClose);
    const n = g.canvas.seq.length;
    g.all.cfgShowClear.checked = true; g.all.cfgShowClear.listeners.change.forEach(f => f());
    expect(JSON.parse(g.store['wp-map-cfg']).showClear).toBe(true);
    expect(g.canvas.seq.slice(n).filter(s => s[0] === 'fillText').map(s => s[1])).toContain('PlayerWindow');
  });
  it('hovering a row draws that area heavy and last, and leaving takes it back', async () => {
    const g = await boot({ mimic: withPicks(AREAS2) });
    click(g.all.cfgBtn);
    const row = rows(g)[1];
    const n = g.canvas.seq.length;
    row.listeners.mouseenter.forEach(f => f());
    expect(g.S.clear.hot).toBe('ui:targetwindow');
    const drawn = g.canvas.seq.slice(n).filter(s => s[0] === 'fillText').map(s => s[1]);
    expect(drawn[drawn.length - 1]).toBe('TargetWindow (size guessed) · drawn over');   // last = on top
    row.listeners.mouseleave.forEach(f => f());
    expect(g.S.clear.hot).toBeNull();
  });
  it('a resolution mismatch is said in words, with both sizes, and is not shown when it matches', async () => {
    const mis = JSON.parse(JSON.stringify(AREAS2)); mis.ui.res = { w: 2560, h: 1440, match: false }; mis.ui.client = { w: 1920, h: 1080 };
    const g = await boot({ mimic: withPicks(mis) });
    expect(g.all.clearRes.hidden).toBe(false);
    expect(g.all.clearRes.textContent).toMatch(/1920x1080.*2560x1440/);
    const ok = await boot({ mimic: withPicks(AREAS2) });
    expect(ok.all.clearRes.hidden).toBe(true);
  });
  it('showClear is a saved setting: kept when true, off otherwise', () => {
    expect(H.mapCfgDefaults().showClear).toBe(false);
    expect(H.mergeMapCfg({ showClear: true }).showClear).toBe(true);
    expect(H.mergeMapCfg({ showClear: 'yes' }).showClear).toBe(false);
  });
});
