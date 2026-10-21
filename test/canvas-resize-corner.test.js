// test/canvas-resize-corner.test.js — "Resize corner" per Canvas piece (the guild lead, 2026-10-21: "NEED THE TOGGLE FOR
// OVERLAYS IN CANVAS TO HAVE THE RESIZE CORNER").
//
// A normal overlay has a ◢ usable in play; a Canvas piece sized only while arranging or in "Edit this one". The switch
// (⚙ → Position → "Resize corner: on/off", saved as `corner: true`, absent = off) keeps the piece's ◢ on it while
// PLAYING, on the same hover handshake as the always-on ✥ (data-wp-interact), and its drag is the SAME startDrag /
// mousemove / endDrag path as the arrange-mode corner (sizeMax / "Keep inside the screen", minimum sizes, save on release).
// A locked piece shows none (the lock freezes size as well as place); a cut piece (`sect`) has no ◢ at all.
//
// The sanitize rules and the real drag run sliced out of canvas.html against fakes; the stylesheet and build wiring are
// asserted on comment-stripped source. NOT shown: Windows really delivering the hover handshake to the click-through window.
//
// Run: npx vitest run test/canvas-resize-corner.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, stripCss, ROOT } from './_source-slice.js';

const canvas = readSource(path.join(ROOT, 'apps', 'mimic', 'canvas.html'));
const js = stripJs(canvas);
const slice = (start, end = '\n  }\n') => sliceBlock(canvas, start, end);

function rules() {
  const block = sliceBlock(canvas, '  var GROUPS = [', '  // ── Panels ──');
  return evalBlock('var window = {};\n' + block, ['sanitize', 'isCorner']);
}

describe('the flag: one saved `corner`, absent means off', () => {
  const r = rules();
  it('survives sanitize on every kind of item, only when exactly true', () => {
    const s = r.sanitize({ panels: [
      { id: 'q', kind: 'part', part: 'me.hp', mode: 'bar', x: 0.1, y: 0.1, w: 200, h: 30, corner: true },
      { id: 'o', kind: 'overlay', key: 'charm', x: 0.1, y: 0.1, w: 300, h: 200, corner: true },
      { id: 't', kind: 'timers', all: true, x: 0.5, y: 0.5, w: 300, h: 100, corner: true },
      { id: 'u', kind: 'timers', all: false, x: 0.5, y: 0.5, w: 300, h: 100, corner: 'yes' },
      { id: 'w', kind: 'timers', all: false, x: 0.5, y: 0.5, w: 300, h: 100 },
    ] });
    const by = Object.fromEntries(s.panels.map(p => [p.id, p]));
    expect(['q', 'o', 't'].map(k => by[k].corner)).toEqual([true, true, true]);
    expect('corner' in by.u).toBe(false);
    expect('corner' in by.w).toBe(false);
    expect(r.isCorner(by.o)).toBe(true);
    expect(r.isCorner(by.w)).toBe(false);
  });
  it('Take apart hands it to each piece', () => {
    expect(js).toMatch(/lock: p\.lock, free: p\.free, corner: p\.corner,/);
    expect(js).toMatch(/corner: o\.corner === true \? true : undefined/);
  });
  it('the ⚙ button flips it and stores nothing when off; a cut piece is not offered it', () => {
    expect(js).toMatch(/hasAttribute\('data-corner'\)\) \{ if \(isCorner\(p\)\) delete p\.corner; else p\.corner = true; \}/);
    expect(js).toMatch(/p\.kind === 'sect' \? '' : '<button class="btn' \+ \(isCorner\(p\)/);
    expect(js).toMatch(/'Resize corner: on' : 'Resize corner: off'/);
  });
});

describe('the grip: shown in play only when on, and on the hover handshake', () => {
  const css = stripCss(canvas);
  it('the stylesheet shows the ◢ for .rc, not while locked, never on a cut piece', () => {
    expect(css).toMatch(/\.panel\.rc:not\(\.plock\):not\(\.sect\) > \.grip\{display:block/);
    // and the base rule still hides it for a piece that has not asked
    expect(css).toMatch(/\.tab,\.grip\{display:none\}/);
  });
  it('render puts .rc on exactly the pieces whose switch is on', () => {
    expect(js).toMatch(/classList\.toggle\('rc', isCorner\(p\)\)/);
  });
  it('the grip is built with data-wp-interact (the ✥ pattern), and its press is the corner drag', () => {
    const build = sliceBlock(canvas, "    grip.className = 'grip';", "grip.title = 'Drag to size this panel';");
    expect(build).toMatch(/grip\.setAttribute\('data-wp-interact', ''\)/);
    expect(js).toMatch(/ev\.target === grip\) \{ startDrag\(ev, p\.id, 'size', false, '', true\); return; \}/);
  });
});

// The real drag, with the canvas NOT arranging (_edit false, nothing being edited): only the corner switch lets it in.
function makeWorld(spec) {
  const SCR = { w: 1000, h: 800 };
  const win = { innerWidth: SCR.w, innerHeight: SCR.h, addEventListener() {} };
  const p = Object.assign({ id: 'a', kind: 'overlay', x: 0.2, y: 0.2, w: 200, h: 100, scale: 1, grp: null }, spec);
  const el = { root: { offsetLeft: p.x * SCR.w, offsetTop: p.y * SCR.h, offsetWidth: p.w, offsetHeight: p.h,
    style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} } } };
  const els = { a: el }, saves = [], handlers = {};
  const gbox = { classList: { add() {}, remove() {} }, style: {} };
  const doc = { addEventListener: (t, f) => { handlers[t] = f; }, getElementById: () => gbox, querySelector: () => ({ addEventListener() {} }) };
  const block = slice('  function isLocked(q)', 'return members.every(function (m) { return !!m.lock; });\n  }\n')
    + '\n' + slice('  function growsUp(p) {', '\n') + '\n' + slice('  var TALL_GRAB = 120,', '\n') + '\n' + slice('  function yBounds(rTop, rH, h, up, free) {')
    + '\n' + slice('  function xBounds(rLeft, rW, w, free) {') + '\n' + slice('  function isFree(q) {', '\n') + '\n' + slice('  function isCorner(q) {', '\n')
    + '\n' + slice('  function sizeMax(p, cap, avail) {', '\n')
    + '\n' + slice('  var SNAP = 8;', "document.addEventListener('mouseup', endDrag);\n");
  const env = new Function('window', 'document', '_layout', '_els', '_sel', 'saves', 'screenList', 'M', 'shield',
    'var _widen = {}; var _fitAdd = {}; var _edit = false; var _one = null; function isEd(id) { return _edit || (_one != null && _one === id); }\n'
    + 'function panelById(id) { return _layout.panels.filter(function (q) { return q.id === id; })[0] || null; }\n'
    + 'function selIds() { return []; }\n'
    + 'function place() {} function sizeFrame() {} function closeMenu() {} function openMenu() {} function render() {}\n'
    + 'function note() {} function save() { saves.push(1); } function fitOn() { return false; } function pdefOf() { return null; }\n'
    + block + '\nreturn { startDrag: startDrag };'
  )(win, doc, { panels: [p] }, els, {}, saves, () => [{ x: 0, y: 0, w: SCR.w, h: SCR.h, sig: 's' }],
    { overlayHoverInteractive() {} }, { classList: { add() {}, remove() {} }, style: {} });
  // press the ◢ (the fifth argument of the real call), drag by (dx, dy), release
  function drag(dx, dy, play = true) {
    const sx = el.root.offsetLeft + el.root.offsetWidth - 4, sy = el.root.offsetTop + el.root.offsetHeight - 4;
    env.startDrag({ button: 0, preventDefault() {}, stopPropagation() {}, clientX: sx, clientY: sy, shiftKey: false, ctrlKey: false, altKey: false, target: null }, 'a', 'size', false, '', play);
    handlers.mousemove({ clientX: sx + dx, clientY: sy + dy, shiftKey: true });
    handlers.mouseup();
  }
  return { p, saves, drag };
}

describe('dragging the play-mode ◢ is the shared resize path', () => {
  it('sizes the piece live and saves on release when the switch is on', () => {
    const w = makeWorld({ corner: true });
    w.drag(60, 30);
    expect([w.p.w, w.p.h]).toEqual([260, 130]);
    expect(w.saves.length).toBe(1);
  });
  it('does nothing in play when the switch is off (the same press is refused)', () => {
    const w = makeWorld({});
    w.drag(60, 30);
    expect([w.p.w, w.p.h]).toEqual([200, 100]);
    expect(w.saves.length).toBe(0);
  });
  it('keeps the minimum size', () => {
    const w = makeWorld({ corner: true });
    w.drag(-500, -500);
    expect([w.p.w, w.p.h]).toEqual([80, 36]);   // an overlay: 80 x 36
  });
  it('respects sizeMax: kept inside the screen stops at the screen edge, "Keep inside: off" goes past it', () => {
    const kept = makeWorld({ corner: true });
    kept.drag(2000, 2000);
    expect([kept.p.w, kept.p.h]).toEqual([1000 - 200, 800 - 160]);   // screen minus the piece's left / top
    const free = makeWorld({ corner: true, free: true });
    free.drag(2000, 2000);
    expect([free.p.w, free.p.h]).toEqual([2200, 2100]);
  });
  it('a locked piece is not resized even with the switch on', () => {
    const w = makeWorld({ corner: true, lock: true });
    w.drag(60, 30);
    expect([w.p.w, w.p.h]).toEqual([200, 100]);
    expect(w.saves.length).toBe(0);
  });
});
