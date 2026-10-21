// test/canvas-lock.test.js — 🔒 Lock in place, and Take apart keeping the panel's Background (Mimic 3.0 Canvas).
//
// The guild lead, 2026-10-20, picked option B for the Canvas background lock (DECISIONS §44, §360, §383):
//   a lock per item and per selection that stops HAND changes to place and size — the drag, the ◢ corner, the ✥,
//   a group's ◢ (its locked members stay put, the rest scale), and a bulk re-flow. One saved flag (`lock: true`).
//   Fit to content keeps working on a locked item; "Show as" keeps the box; Take apart passes the lock on.
// And the A gap: Take apart must carry the panel's Background onto every piece it makes (today they got none
// and fell back to the toolbar default, so text floated over the game).
//
// Everything below runs the REAL functions sliced out of canvas.html against fakes (no Electron, no DOM): the
// real startDrag / mousemove / endDrag run over a fake document, so a comment cannot satisfy any of it. The
// few text assertions read comment-stripped source and only pin wiring a harness cannot reach (the ⚙ and the
// selection bar's buttons).
//
// Run: npx vitest run test/canvas-lock.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, evalBlock, stripJs, stripCss, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const mimic = (f) => path.join(ROOT, 'apps', 'mimic', f);
const canvas = readSource(mimic('canvas.html'));
const c = stripJs(canvas);
const slice = (start, end = '\n  }\n') => sliceBlock(canvas, start, end);
const num = (v, lo, hi, d) => { v = Number(v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };

let W, S;
beforeAll(() => {
  globalThis.window = globalThis;
  require(mimic('parts.js'));
  require(mimic('sections.js'));
  W = globalThis.WpParts;
  S = globalThis.WpSections;
});

// The canvas's layout rules (sanitize + the lock helpers), run for real.
function rules() {
  const block = sliceBlock(canvas, '  var GROUPS = [', '  // ── Panels ──');
  return evalBlock('var window = {};\n' + block, ['sanitize', 'isLocked', 'setLock', 'lockState', 'dragBlocked']);
}

describe('the flag: one saved `lock`, absent means free', () => {
  const r = rules();
  it('is kept by every kind of item, only when it is exactly true', () => {
    const s = r.sanitize({ panels: [
      { id: 'q', kind: 'part', part: 'me.hp', mode: 'bar', x: 0.1, y: 0.1, w: 200, h: 30, lock: true },
      { id: 's', kind: 'sect', key: 'mobinfo', sect: 'hp', x: 0.1, y: 0.1, w: 200, h: 30, lock: true },
      { id: 'o', kind: 'overlay', key: 'charm', x: 0.1, y: 0.1, w: 300, h: 200, lock: true },
      { id: 't', kind: 'timers', all: true, x: 0.5, y: 0.5, w: 300, h: 100, lock: true },
      { id: 'u', kind: 'timers', all: false, x: 0.5, y: 0.5, w: 300, h: 100, lock: 'yes' },
      { id: 'v', kind: 'timers', all: false, x: 0.5, y: 0.5, w: 300, h: 100, lock: false },
      { id: 'w', kind: 'timers', all: false, x: 0.5, y: 0.5, w: 300, h: 100 },
    ] });
    const by = Object.fromEntries(s.panels.map(p => [p.id, p]));
    expect(['q', 's', 'o', 't'].map(k => by[k].lock)).toEqual([true, true, true, true]);
    for (const k of ['u', 'v', 'w']) expect('lock' in by[k]).toBe(false);
  });
  it('a layout saved before the lock existed reads unlocked, with nothing to migrate', () => {
    const s = r.sanitize({ panels: [{ id: 'old', kind: 'timers', all: true, x: 0.5, y: 0.5, w: 300, h: 100 }] });
    expect(s.panels.some(p => r.isLocked(p))).toBe(false);
  });
  it('setLock locks or frees a whole set, and an unlocked item stores nothing', () => {
    const ps = [{ id: 'a' }, { id: 'b', lock: true }, { id: 'c' }];
    expect(r.lockState(ps)).toBe('some');
    r.setLock(ps, true);
    expect(ps.map(p => p.lock)).toEqual([true, true, true]);
    expect(r.lockState(ps)).toBe('all');
    r.setLock(ps, false);
    expect(ps.some(p => 'lock' in p)).toBe(false);
    expect(r.lockState(ps)).toBe('none');
  });
});

describe('a drag that can change nothing', () => {
  const r = rules();
  const m = (id, lock) => ({ id, lock });
  it('is blocked when the one grabbed is locked, alone or in a set', () => {
    expect(r.dragBlocked({ lock: true }, null, false)).toBe(true);
    expect(r.dragBlocked({}, null, false)).toBe(false);
    expect(r.dragBlocked({ lock: true }, [m('a', true), m('b', false)], false)).toBe(true);
  });
  it('a set with a free member goes on; a set of all locked does not', () => {
    expect(r.dragBlocked({}, [m('a', false), m('b', true)], false)).toBe(false);
    expect(r.dragBlocked({}, [m('a', true), m('b', true)], false)).toBe(true);
  });
  it('the selection box\'s ◢ is nobody\'s handle: only an all-locked selection blocks it', () => {
    expect(r.dragBlocked({ lock: true }, [m('a', true), m('b', false)], true)).toBe(false);
    expect(r.dragBlocked({ lock: true }, [m('a', true), m('b', true)], true)).toBe(true);
  });
});

// ── The real startDrag → mousemove → endDrag, over a fake page ────────────────────────────────────────
// The sliced block reads `_sel` and `_edit` as free variables, so the world binds them by name.
function makeWorld(specs, opts = {}) {
  const SCR = { w: 1000, h: 800 };
  const win = { innerWidth: SCR.w, innerHeight: SCR.h, addEventListener() {} };
  const panels = specs.map(s => Object.assign({ kind: 'part', scale: 1, grp: null }, s));
  const els = {};
  const notes = [], saves = [], handlers = {};
  panels.forEach(p => {
    els[p.id] = { root: { offsetLeft: Math.round(p.x * SCR.w), offsetTop: Math.round(p.y * SCR.h), offsetWidth: p.w, offsetHeight: p.h,
      style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} } } };
  });
  const gbox = { classList: { add() {}, remove() {} }, style: {} };
  const doc = { addEventListener: (t, f) => { handlers[t] = f; }, getElementById: () => gbox, querySelector: () => ({ addEventListener() {} }) };
  const sel = Object.assign({}, opts.sel || {});
  const block = slice('  function isLocked(q)', 'return members.every(function (m) { return !!m.lock; });\n  }\n')
    + '\n' + slice('  function growsUp(p) {', '\n') + '\n' + slice('  var TALL_GRAB = 120,', '\n') + '\n' + slice('  function yBounds(rTop, rH, h, up, free) {')
    + '\n' + slice('  function xBounds(rLeft, rW, w, free) {') + '\n' + slice('  function isFree(q) {', '\n')
    + '\n' + slice('  var SNAP = 8;', "document.addEventListener('mouseup', endDrag);\n");
  const env = new Function('window', 'document', '_layout', '_els', '_sel', 'notes', 'saves', 'screenList', 'M', 'shield',
    'var _widen = {}; var _fitAdd = {}; var _edit = true; var _one = null; function isEd(id) { return _edit || (_one != null && _one === id); }\n'
    + 'function panelById(id) { return _layout.panels.filter(function (q) { return q.id === id; })[0] || null; }\n'
    + 'function selIds() { return Object.keys(_sel).filter(function (id) { return panelById(id); }); }\n'
    + 'function place() {} function sizeFrame() {} function closeMenu() {} function openMenu() {} function render() {}\n'
    + 'function note(m) { notes.push(m); } function save() { saves.push(1); } function fitOn() { return false; } function pdefOf() { return null; }\n'
    + block + '\nreturn { startDrag: startDrag, getSel: function () { return _sel; } };'
  )(win, doc, { panels }, els, sel, notes, saves, () => [{ x: 0, y: 0, w: SCR.w, h: SCR.h, sig: 's' }],
    { overlayHoverInteractive() {} }, { classList: { add() {}, remove() {} }, style: {} });
  // press on `id` (mode 'move' | 'size'), drag by (dx, dy), release. Shift on the move turns snapping off.
  function drag(id, mode, dx, dy, { alt = false, target = null, anyTime = false } = {}) {
    const pe = panels.find(p => p.id === id), el = els[id].root;
    const sx = el.offsetLeft + 5, sy = el.offsetTop + 5;
    env.startDrag({ button: 0, preventDefault() {}, stopPropagation() {}, clientX: sx, clientY: sy, shiftKey: false, ctrlKey: false, altKey: alt, target }, id, mode, anyTime);
    handlers.mousemove({ clientX: sx + dx, clientY: sy + dy, shiftKey: true });
    // what is on screen while the mouse is still down: a locked item must not follow it
    drag.mid = Object.fromEntries(Object.entries(els).map(([k, e]) => [k, { left: e.root.style.left, top: e.root.style.top, width: e.root.style.width, height: e.root.style.height }]));
    handlers.mouseup();
    return pe;
  }
  const spot = (id) => ({ x: Math.round(panels.find(p => p.id === id).x * SCR.w), y: Math.round(panels.find(p => p.id === id).y * SCR.h) });
  return { panels, els, notes, saves, sel, selected: () => Object.keys(env.getSel()), drag, spot, byId: (id) => panels.find(p => p.id === id) };
}

describe('the real drag: a locked item does not move or size', () => {
  const one = (extra) => makeWorld([Object.assign({ id: 'a', x: 0.2, y: 0.2, w: 200, h: 40 }, extra)]);
  it('a free item moves with the mouse (the baseline the lock is measured against)', () => {
    const w = one();
    w.drag('a', 'move', 50, 30);
    expect(w.spot('a')).toEqual({ x: 250, y: 190 });
    expect(w.drag.mid.a.left).toBe('250px');   // and the harness does see the item follow the mouse
  });
  it('a locked item does not move, nothing is saved, and a "locked" note says why', () => {
    const w = one({ lock: true });
    w.drag('a', 'move', 50, 30);
    expect(w.spot('a')).toEqual({ x: 200, y: 160 });
    expect(w.saves.length).toBe(0);
    expect(w.notes.length).toBe(1);
    expect(w.notes[0]).toMatch(/locked/i);
    // nor does it follow the mouse while the button is down
    expect(w.drag.mid.a.left).toBeUndefined();
    expect(w.drag.mid.a.top).toBeUndefined();
  });
  it('the always-on ✥ moves a free item while playing, and is held on a locked one', () => {
    const free = one(); free.drag('a', 'move', 80, 80, { anyTime: true });
    expect(free.spot('a')).toEqual({ x: 280, y: 240 });
    const w = one({ lock: true });
    w.drag('a', 'move', 80, 80, { anyTime: true });
    expect(w.spot('a')).toEqual({ x: 200, y: 160 });
    expect(w.notes[0]).toMatch(/locked/i);
  });
  it('the ◢ corner does not size a locked item, and sizes a free one', () => {
    const free = one(); free.drag('a', 'size', 60, 20);
    expect([free.byId('a').w, free.byId('a').h]).toEqual([260, 60]);
    const locked = one({ lock: true }); locked.drag('a', 'size', 60, 20);
    expect([locked.byId('a').w, locked.byId('a').h]).toEqual([200, 40]);
    expect(locked.notes[0]).toMatch(/locked/i);
    expect(locked.drag.mid.a.width).toBeUndefined();
    expect(free.drag.mid.a.width).toBe('260px');
  });
  it('a plain click on a locked item still selects it (so its ⚙ and the selection bar can free it), with no note', () => {
    const w = one({ lock: true });
    w.drag('a', 'move', 0, 0);
    expect(w.selected()).toEqual(['a']);
    expect(w.notes.length).toBe(0);
  });
  it('Alt-drag does not pull a locked item out of its group', () => {
    const w = makeWorld([{ id: 'a', x: 0.2, y: 0.2, w: 200, h: 40, grp: 'g', lock: true }, { id: 'b', x: 0.2, y: 0.3, w: 200, h: 40, grp: 'g' }]);
    w.drag('a', 'move', 50, 50, { alt: true });
    expect(w.byId('a').grp).toBe('g');
    expect(w.spot('a')).toEqual({ x: 200, y: 160 });
  });
});

describe('the real drag: in a group, locked members stay and the rest go on', () => {
  const group = () => makeWorld([
    { id: 'a', x: 0.1, y: 0.1, w: 200, h: 40, grp: 'g' },
    { id: 'b', x: 0.1, y: 0.2, w: 200, h: 40, grp: 'g', lock: true },
    { id: 'c', x: 0.1, y: 0.3, w: 200, h: 40, grp: 'g' },
  ]);
  it('moving the group by a free piece leaves the locked one where it is', () => {
    const w = group();
    w.drag('a', 'move', 100, 20);
    expect(w.spot('a')).toEqual({ x: 200, y: 100 });
    expect(w.spot('c')).toEqual({ x: 200, y: 260 });
    expect(w.spot('b')).toEqual({ x: 100, y: 160 });
    expect(w.drag.mid.b.left).toBeUndefined();   // it did not slide while the others did
    expect(w.drag.mid.a.left).toBe('200px');
  });
  it('grabbing the locked piece moves nothing in the group', () => {
    const w = group();
    w.drag('b', 'move', 100, 20);
    expect([w.spot('a'), w.spot('b'), w.spot('c')]).toEqual([{ x: 100, y: 80 }, { x: 100, y: 160 }, { x: 100, y: 240 }]);
    expect(w.notes[0]).toMatch(/locked/i);
  });
  it('a locked piece does not hold the others back at the screen edge', () => {
    const w = makeWorld([
      { id: 'a', x: 0.1, y: 0.1, w: 200, h: 40, grp: 'g' },
      { id: 'b', x: 0, y: 0.2, w: 200, h: 40, grp: 'g', lock: true },
    ]);
    w.drag('a', 'move', -60, 0);   // b is at the left edge: if it counted, nothing could go left
    expect(w.spot('a').x).toBe(40);
    expect(w.spot('b').x).toBe(0);
  });
  it('sizing the group by a free piece\'s ◢: the locked one keeps its place, size and text; the rest scale', () => {
    const w = group();
    w.byId('b').scale = 1.2;
    w.byId('b').x = 0.1234; w.byId('b').y = 0.2345;   // not a whole pixel: re-deriving it from the screen would drift
    w.drag('a', 'size', 0, 100);     // box 100..300 × 80..320 (h 240): +100 tall => ×(340/240)
    const b = w.byId('b');
    expect([b.x, b.y, b.w, b.h, b.scale]).toEqual([0.1234, 0.2345, 200, 40, 1.2]);
    expect(w.byId('c').h).toBeGreaterThan(40);
    expect(w.byId('a').h).toBeGreaterThan(40);
  });
  it('the selection box\'s ◢ works when only some are locked, and does nothing when all are', () => {
    const w = group();
    w.sel.a = w.sel.b = w.sel.c = true;
    w.drag('b', 'size', 0, 100, { target: { closest: (s) => (s === '.ggrip' ? {} : null) } });
    expect(w.byId('b').h).toBe(40);
    expect(w.byId('c').h).toBeGreaterThan(40);
    const all = makeWorld([{ id: 'a', x: 0.1, y: 0.1, w: 200, h: 40, grp: 'g', lock: true }, { id: 'b', x: 0.1, y: 0.2, w: 200, h: 40, grp: 'g', lock: true }]);
    all.sel.a = all.sel.b = true;
    all.drag('a', 'size', 0, 100, { target: { closest: () => ({}) } });
    expect([all.byId('a').h, all.byId('b').h]).toEqual([40, 40]);
  });
});

describe('scaleGroup: a locked member comes back exactly as it went in', () => {
  const { groupBox, scaleGroup } = evalBlock(slice('  function groupBox(ms) {') + '\n' + slice('  function scaleGroup(ms, box, w, h, keep, minW, minH) {'), ['groupBox', 'scaleGroup']);
  it('the rest scale around it', () => {
    const ms = [
      { id: 'a', x0: 100, y0: 100, w0: 200, h0: 20, sc0: 1 },
      { id: 'b', x0: 100, y0: 124, w0: 200, h0: 40, sc0: 1.37, lock: true },
      { id: 'c', x0: 100, y0: 168, w0: 300, h0: 32, sc0: 1.2 },
    ];
    const out = scaleGroup(ms, groupBox(ms), 300, 200, false);
    expect(out[1]).toEqual({ id: 'b', x: 100, y: 124, w: 200, h: 40, scale: 1.37 });
    expect(out[0].h).toBe(40);
    expect(out[2].h).toBe(64);
  });
});

describe('a bulk change keeps a locked piece\'s box and place', () => {
  const src = slice('  function bulkPatch(kind, v) {', '  var BULK_THICK');
  const env = () => new Function('WpParts', 'window', 'num', 'function partDef(p) { return WpParts.byId[p.part]; }\n' + src + '\nreturn { bulkPatch, bulkSet };')(
    W, { innerWidth: 1000, innerHeight: 800 }, num);
  const mk = (id, y, extra) => Object.assign({ id, kind: 'part', part: 'me.hp', mode: 'bar', x: 0.1, y: y / 800, w: 220, h: 34, grp: 'g1' }, extra);
  it('Upright bar: the locked one changes shape inside the box it has; the rest stand up in a row without it', () => {
    const { bulkSet, bulkPatch } = env();
    const ps = [mk('a', 100), mk('b', 140, { lock: true }), mk('c', 180)];
    expect(bulkSet(ps, bulkPatch('mode', 'vbar'))).toEqual({ changed: 3, skipped: 0 });
    expect(ps.map(p => p.mode)).toEqual(['vbar', 'vbar', 'vbar']);
    const b = ps[1];
    expect([b.w, b.h, Math.round(b.x * 1000), Math.round(b.y * 800)]).toEqual([220, 34, 100, 140]);
    expect([ps[0].w, ps[0].h, ps[2].w, ps[2].h]).toEqual([40, 120, 40, 120]);
    // the two free ones are a row, 6px apart, from THEIR top-left; the locked one is not in it
    expect(ps.filter(p => !p.lock).map(p => Math.round(p.x * 1000))).toEqual([100, 146]);
    expect(ps.filter(p => !p.lock).map(p => Math.round(p.y * 800))).toEqual([100, 100]);
  });
  it('thickness, backing and alignment still reach a locked piece (they are not place or size)', () => {
    const { bulkSet, bulkPatch } = env();
    const ps = [mk('a', 100), mk('b', 140, { lock: true })];
    bulkSet(ps, bulkPatch('thick', 'thick')); bulkSet(ps, bulkPatch('back', '1'));
    expect(ps.map(p => [p.thick, p.back])).toEqual([['thick', true], ['thick', true]]);
  });
});

describe('"Show as" on a locked piece keeps the box', () => {
  const run = (p, nm) => {
    const block = 'function partDef(p) { return WpParts.byId[p.part]; }\n' + slice('  function isLocked(q)', '\n')
      + slice('  function pdefOf(p)', '\n') + slice('  function boxForMode(p, nm) {') + '\nreturn boxForMode;';
    return new Function('WpParts', block)(W)(p, nm);
  };
  const piece = (extra) => Object.assign({ kind: 'part', part: 'me.hp', mode: 'bar', w: 250, h: 30 }, extra);
  it('a free piece takes the shape\'s height and keeps its width; a ring wants a square', () => {
    const rows = run(piece(), 'ring');
    expect(rows.w).toBe(W.DEFAULT_SIZE.ring[0]);
    expect(rows.h).toBe(W.DEFAULT_SIZE.ring[1]);
    const thin = run(piece(), 'thin');
    expect(thin).toEqual({ w: 250, h: W.DEFAULT_SIZE.thin[1] });
  });
  it('a locked piece gets no new box at all', () => {
    expect(run(piece({ lock: true }), 'ring')).toBeNull();
    expect(run(piece({ lock: true }), 'thin')).toBeNull();
  });
  it('and the one-time fit that follows a new shape is skipped for it', () => {
    expect(c).toMatch(/var fit = nm !== p\.mode && !ringy && !isLocked\(p\);/);
  });
});

describe('Fit to content keeps working on a locked item', () => {
  const { fitOn } = evalBlock(slice('  function fitKind(p, def) {') + '\n' + slice('  function fitOn(p, def) {', '\n'), ['fitOn']);
  it('a locked timers panel, overlay and list piece still follow their content; Fit off is what freezes the height', () => {
    expect(fitOn({ kind: 'timers', lock: true }, null)).toBe(true);
    expect(fitOn({ kind: 'overlay', key: 'charm', lock: true }, null)).toBe(true);
    expect(fitOn({ kind: 'part', mode: 'rows', lock: true }, { kind: 'list' })).toBe(true);
    expect(fitOn({ kind: 'timers', lock: true, fit: false }, null)).toBe(false);
  });
  it('none of the fit code reads the lock', () => {
    for (const start of ['  function fitBox(', '  function fitPiece(id) {', '  function fitEmbed(id, grow) {']) {
      expect(stripJs(slice(start))).not.toMatch(/lock/i);
    }
  });
});

describe('Take apart passes the lock on to every piece, and the panel\'s Background', () => {
  function world(p0) {
    const rects = { '#wrap > .title': [8, 4, 322, 42], '[data-wp-sect="name"]': [10, 56, 305, 19], '.mob > .zone': [10, 77, 305, 10],
      '[data-wp-sect="stats"]': [10, 88, 305, 10], '.mob > .hpbar': [10, 100, 305, 8], '.mob > .res': [10, 112, 305, 31], '.mob > .spec': [10, 150, 305, 17] };
    const store = { wpTargetTab: 'stats' };
    globalThis.sessionStorage = { getItem: (k) => (k in store ? store[k] : null) };
    const els = {};
    const mkDoc = () => ({ body: {}, getElementById: () => ({}), querySelector: () => null,
      querySelectorAll: (sel) => (rects[sel] ? [{ getBoundingClientRect: () => ({ left: rects[sel][0], top: rects[sel][1], width: rects[sel][2], height: rects[sel][3], right: rects[sel][0] + rects[sel][2], bottom: rects[sel][1] + rects[sel][3] }) }] : []) });
    const block = 'var window = { innerWidth: 1920, innerHeight: 1080, WpSections: S }; var WpSections = S; var MAX_PANELS = 150; var SECT_PAD = 4;\n'
      + 'var _layout = { panels: [] }; var _els = els; var __n = 0; function newId(p) { return p + (++__n); }\n'
      + 'function num(v, lo, hi, d) { v = Number(v); return (isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d); }\n'
      + 'function ovEntry(k) { return { label: k, w: 340, h: 400 }; }\n'
      + slice('  function sectPanel(key, sect, x, y, o) {') + slice('  function takeApart(p) {')
      + '\nreturn { takeApart, _layout, _els };';
    const env = new Function('S', 'els', block)(S, els);
    const whole = Object.assign({ id: 'o1', kind: 'overlay', key: 'mobinfo', style: '', x: 0, y: 0, w: 340, h: 420, scale: 1 }, p0);
    env._layout.panels.push(whole);
    els.o1 = { root: { offsetLeft: 400, offsetTop: 300 }, frame: { contentDocument: mkDoc() } };
    return { env, whole };
  }
  it('every piece of a locked panel is locked, tab parts included', () => {
    const w = world({ lock: true });
    expect(w.env.takeApart(w.whole)).toBeGreaterThan(5);
    const ps = w.env._layout.panels.filter(q => q.kind === 'sect');
    expect(ps.some(q => q.follow)).toBe(true);
    expect(ps.every(q => q.lock === true)).toBe(true);
  });
  it('a free panel makes free pieces', () => {
    const w = world({});
    w.env.takeApart(w.whole);
    const ps = w.env._layout.panels.filter(q => q.kind === 'sect');
    expect(ps.length).toBeGreaterThan(5);
    expect(ps.some(q => q.lock)).toBe(false);
  });

  // The A gap: pieces got no `back`, fell back to the toolbar default, and the text floated over the game.
  it('a panel with its Background ON makes every piece with it ON, tab parts included', () => {
    const w = world({ back: true });
    w.env.takeApart(w.whole);
    const ps = w.env._layout.panels.filter(q => q.kind === 'sect');
    expect(ps.length).toBeGreaterThan(5);
    expect(ps.some(q => q.follow)).toBe(true);
    expect(ps.every(q => q.back === true)).toBe(true);
  });
  it('a panel with its Background explicitly OFF keeps every piece OFF (not "follow the default")', () => {
    const w = world({ back: false });
    w.env.takeApart(w.whole);
    const ps = w.env._layout.panels.filter(q => q.kind === 'sect');
    expect(ps.every(q => q.back === false)).toBe(true);
  });
  it('a panel that follows the Canvas default makes pieces that follow it too', () => {
    const w = world({});
    w.env.takeApart(w.whole);
    const ps = w.env._layout.panels.filter(q => q.kind === 'sect');
    expect(ps.some(q => typeof q.back === 'boolean')).toBe(false);
  });
  it('the Background and the lock survive a save and a reload of the pieces', () => {
    const w = world({ back: true, lock: true });
    w.env.takeApart(w.whole);
    const disk = JSON.parse(JSON.stringify({ panels: w.env._layout.panels }));
    const back = rules().sanitize(disk).panels.filter(q => q.kind === 'sect');
    expect(back.length).toBeGreaterThan(5);
    expect(back.every(q => q.back === true && q.lock === true)).toBe(true);
  });
});

describe('a saved group puts its pieces down with their Background', () => {
  const mk = (id, y, back) => ({ id, kind: 'part', part: 'me.hp', mode: 'bar', x: 0.1, y: y / 800, w: 220, h: 34, scale: 1, back });
  it('on, off and "follow the default" each come back as they were saved', () => {
    const lay = { panels: [] };
    const e = new Function('WpParts', 'window', 'num', '_layout',
      'var MAX_PANELS = 150; var __n = 0; function newId(p) { return p + (++__n); }\n'
      + slice('  function groupPartsOf(ps) {') + slice('  function addPart(pid, mode, X, Y, grp, o) {') + slice('  function placeGroup(pieces, X, Y) {')
      + '\nreturn { groupPartsOf, placeGroup };')(W, { innerWidth: 1000, innerHeight: 800 }, num, lay);
    const saved = e.groupPartsOf([mk('a', 100, true), mk('b', 140, false), mk('c', 180, undefined)]);
    e.placeGroup(JSON.parse(JSON.stringify(saved)), 300, 300);
    expect(lay.panels.map(p => p.back)).toEqual([true, false, undefined]);
  });
});

describe('the buttons: ⚙ for one item, the selection bar for all selected', () => {
  it('⚙ has a Position row with the lock for every kind of item, and the click flips it', () => {
    expect(c).toMatch(/h \+= '<div class="sec">Position<\/div><div class="row">'/);
    expect(c).toMatch(/data-lock title=/);
    expect(c).toMatch(/else if \(t\.hasAttribute\('data-lock'\)\) \{ setLock\(\[p\], !isLocked\(p\)\); \}/);
  });
  it('the selection bar offers Lock position, or Unlock position once everything selected is locked', () => {
    expect(c).toMatch(/lockState\(ids\.map\(panelById\)\) === 'all'/);
    expect(c).toMatch(/else if \(a === 'lockpos'\) \{ var lps = ids\.map\(panelById\); setLock\(lps, lockState\(lps\) !== 'all'\); save\(\); render\(\); \}/);
  });
  it('a locked item wears a 🔒 badge on its arranging tab, and its ◢ looks off', () => {
    expect(c).toMatch(/e\.root\.classList\.toggle\('plock', isLocked\(p\)\);/);
    const css = stripCss(canvas);
    expect(css).toMatch(/:is\(body\.edit \.panel, \.panel\.one\)\.plock \.tab \.lkb\{display:inline\}/);
    expect(css).toMatch(/\.tab \.lkb\{display:none\}/);
    expect(css).toMatch(/:is\(body\.edit \.panel, \.panel\.one\)\.plock \.grip\{opacity:0\.35;cursor:not-allowed\}/);
    expect(canvas).toContain('<span class="lkb"');
  });
});
