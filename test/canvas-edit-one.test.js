// test/canvas-edit-one.test.js — edit ONE Canvas item in place (the guild lead, 2026-10-21): "need to be able to edit just
// the single canvas element, or go into selection mode without every one of them coming up to be able to ALLOW for resize on
// the spot".
//
// Arranging used to be the whole canvas at once: every item showed its tab, ◢ and edges and the window took the mouse.
// Now an item's always-on ✥ (click), or its ⚙ → "Edit this one", puts that item alone in the same state. Everything is the
// arrange mode's own code asking isEd(id) instead of _edit: startDrag, the edges, the ⚙ panel, the 🔒 refusal, the save.
//
// The drag/lock/save code below is the REAL canvas.html source cut out and run against fakes; the stylesheet and the render
// wiring are asserted on the source with comments stripped.
//
// What this cannot show: the window really losing keyboard focus when EverQuest is clicked (that ends the edit), and the click
// reaching EQ. That needs Windows.
//
// Run: npx vitest run test/canvas-edit-one.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const SRC = readSource(path.join(ROOT, 'apps', 'mimic', 'canvas.html'));

const IS_ED = sliceBlock(SRC, '  var _one = null;', 'function isEd(id) { return _edit || (_one != null && _one === id); }');
const EDIT_ONE = sliceBlock(SRC, '  function editOne(id) {', '    endOne();\n  }, true);');
const DRAG = sliceBlock(SRC, '  var SNAP = 8;', "window.addEventListener('blur', endDrag);");
const LOCK = sliceBlock(SRC, '  function dragBlocked(q, members, viaBox) {', 'return members.every(function (m) { return !!m.lock; });\n  }')
  + '\n' + sliceBlock(SRC, '  function isLocked(q) {', '}');

function fakeRoot() {
  return {
    offsetLeft: 100, offsetTop: 100, offsetWidth: 300, offsetHeight: 200, style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    contains(t) { return t === this || (t && t.inRoot === this); },
  };
}

function world(panels) {
  const S = {
    panels: panels || [{ id: 'a', kind: 'overlay', x: 0.05, y: 0.09, w: 300, h: 200 }, { id: 'b', kind: 'overlay', x: 0.5, y: 0.5, w: 300, h: 200 }],
    renders: 0, saves: 0, writes: 0, closed: 0, opened: [], notes: [], hover: [], L: { doc: {}, win: {} }, els: {},
  };
  S.document = {
    addEventListener: (t, f) => { (S.L.doc[t] = S.L.doc[t] || []).push(f); },
    querySelector: () => ({ addEventListener() {} }),
    getElementById: () => ({ classList: { add() {}, remove() {} }, style: {} }),
  };
  S.window = { innerWidth: 1920, innerHeight: 1080, addEventListener: (t, f) => { (S.L.win[t] = S.L.win[t] || []).push(f); } };
  S.M = { overlayHoverInteractive: (v) => S.hover.push(v) };
  S.shield = { on: false, style: {}, classList: { add: () => { S.shield.on = true; }, remove: () => { S.shield.on = false; } } };
  S.menuEl = { contains: (t) => !!(t && t.inMenu) };
  S.panels.forEach(p => { S.els[p.id] = { root: fakeRoot(), mv: {} }; });
  const body = `
    var _edit = false, _sel = {}, _widen = {}, _fitAdd = {}, _saveT = null;
    var window = S.window, document = S.document, M = S.M, shield = S.shield, menuEl = S.menuEl, _els = S.els;
    function panelById(id) { return S.panels.filter(function (p) { return p.id === id; })[0] || null; }
    function closeMenu() { S.closed++; }
    function openMenu(id) { S.opened.push(id); }
    function render() { S.renders++; }
    function save() { S.saves++; _saveT = 1; }
    function doSave() { S.writes++; _saveT = null; }
    function note(m) { S.notes.push(m); }
    function place() {}
    function sizeFrame() {}
    function fitOn() { return false; }
    function pdefOf() { return null; }
    function selIds() { return []; }
    function screenList(W, H) { return [{ x: 0, y: 0, w: W, h: H }]; }
    ${sliceBlock(SRC, '  function growsUp(p) {', '\n')}
    ${sliceBlock(SRC, '  var TALL_GRAB = 120,', '\n')}
    ${sliceBlock(SRC, '  function yBounds(rTop, rH, h, up, free) {', '\n  }\n')}
    ${sliceBlock(SRC, '  function xBounds(rLeft, rW, w, free) {', '\n  }\n')}
    ${sliceBlock(SRC, '  function isFree(q) {', '\n')}
    ${sliceBlock(SRC, '  function sizeMax(p, cap, avail) {', '\n')}
    ${LOCK}
    ${IS_ED}
    ${DRAG}
    ${EDIT_ONE}
    return { editOne: editOne, endOne: endOne, isEd: isEd, startDrag: startDrag, one: function () { return _one; },
      setEdit: function (v) { _edit = v; }, saveT: function () { return _saveT; } };`;
  // eslint-disable-next-line no-new-func
  const api = new Function('S', body)(S);
  const fire = (bag, t, ev) => (bag[t] || []).forEach(f => f(ev));
  const mouse = (over) => Object.assign({ button: 0, clientX: 0, clientY: 0, shiftKey: false, ctrlKey: false, altKey: false,
    preventDefault() {}, stopPropagation() {}, target: { closest: () => null } }, over || {});
  return {
    S, api, mouse,
    move: (x, y) => fire(S.L.doc, 'mousemove', mouse({ clientX: x, clientY: y })),
    up: () => fire(S.L.doc, 'mouseup', mouse()),
    key: (k, tag) => fire(S.L.doc, 'keydown', { key: k, target: { tagName: tag || 'DIV' } }),
    down: (target) => fire(S.L.doc, 'mousedown', { target }),
    blur: () => fire(S.L.win, 'blur', {}),
  };
}

describe('entering edit on one item', () => {
  it('only that item is in the edit state; the others are not (they keep no chrome and take no mouse)', () => {
    const w = world();
    w.api.editOne('a');
    expect(w.api.one()).toBe('a');
    expect(w.api.isEd('a')).toBe(true);
    expect(w.api.isEd('b')).toBe(false);
    expect(w.S.renders).toBe(1);
  });
  it('a press on another item\'s body starts nothing (it is click-through; only its ✥ moves it)', () => {
    const w = world();
    w.api.editOne('a');
    w.api.startDrag(w.mouse(), 'b', 'size');
    expect(w.S.shield.on).toBe(false);
    w.api.startDrag(w.mouse(), 'a', 'size');
    expect(w.S.shield.on).toBe(true);
    w.up();
  });
  it('is refused while the whole canvas is being arranged (that mode already has everything up)', () => {
    const w = world();
    w.api.setEdit(true);
    w.api.editOne('a');
    expect(w.api.one()).toBeNull();
  });
  it('moving the edit to another item hands over: the first ends, the second begins', () => {
    const w = world();
    w.api.editOne('a');
    w.api.editOne('b');
    expect(w.api.one()).toBe('b');
    expect(w.api.isEd('a')).toBe(false);
  });
  it('an item not on the canvas cannot be edited', () => {
    const w = world();
    w.api.editOne('nope');
    expect(w.api.one()).toBeNull();
  });
});

describe('sizing and moving in the edit state', () => {
  it('a ◢ drag resizes the one item and saves once, on release (not per pixel)', () => {
    const w = world();
    w.api.editOne('a');
    w.api.startDrag(w.mouse({ clientX: 400, clientY: 300 }), 'a', 'size');
    w.move(420, 310); w.move(450, 330); w.move(500, 360);
    expect(w.S.saves).toBe(0);
    w.up();
    expect(w.S.saves).toBe(1);
    expect(w.S.panels[0].w).toBe(400);                 // 300 + (500 - 400)
    expect(w.S.panels[0].h).toBe(260);                 // 200 + (360 - 300)
    expect(w.S.panels[1].w).toBe(300);                 // the other item is untouched
  });
  it('an edge drag sizes one direction only', () => {
    const w = world();
    w.api.editOne('a');
    w.api.startDrag(w.mouse({ clientX: 400, clientY: 300 }), 'a', 'size', false, 'x');
    w.move(450, 400);
    w.up();
    expect(w.S.panels[0].w).toBe(350);
    expect(w.S.panels[0].h).toBe(200);
  });
  it('ending the edit writes what is pending straight away: one write, and none left waiting', () => {
    const w = world();
    w.api.editOne('a');
    w.api.startDrag(w.mouse({ clientX: 0, clientY: 0 }), 'a', 'size');
    w.move(40, 0); w.up();
    expect(w.api.saveT()).not.toBeNull();              // the drag's own save is still waiting its 250 ms
    w.api.endOne();
    expect(w.S.writes).toBe(1);
    expect(w.api.saveT()).toBeNull();
  });
  it('a 🔒 locked item opens for editing but refuses to resize or move, and says why', () => {
    const w = world([{ id: 'a', kind: 'overlay', x: 0.05, y: 0.09, w: 300, h: 200, lock: true }]);
    w.api.editOne('a');
    expect(w.api.one()).toBe('a');
    w.api.startDrag(w.mouse({ clientX: 400, clientY: 300 }), 'a', 'size');
    w.move(500, 400); w.up();
    expect(w.S.panels[0].w).toBe(300);
    expect(w.S.panels[0].h).toBe(200);
    expect(w.S.saves).toBe(0);
    expect(w.S.notes.join(' ')).toMatch(/Locked in place/);
  });
  it('the item being edited moves and sizes alone, even when it belongs to a group', () => {
    const w = world([{ id: 'a', kind: 'part', x: 0.05, y: 0.09, w: 300, h: 200, grp: 'g' }, { id: 'b', kind: 'part', x: 0.5, y: 0.5, w: 300, h: 200, grp: 'g' }]);
    w.api.editOne('a');
    w.api.startDrag(w.mouse({ clientX: 400, clientY: 300 }), 'a', 'size');
    w.move(450, 300); w.up();
    expect(w.S.panels[0].w).toBe(350);
    expect(w.S.panels[1].w).toBe(300);
  });
});

describe('leaving the edit', () => {
  it('Esc ends it (not while typing in a field)', () => {
    const w = world();
    w.api.editOne('a');
    w.key('Escape', 'INPUT');
    expect(w.api.one()).toBe('a');
    w.key('Enter');
    expect(w.api.one()).toBe('a');
    w.key('Escape');
    expect(w.api.one()).toBeNull();
  });
  it('a press anywhere else on the page ends it; a press on its own chrome, the settings panel or a ✥ does not', () => {
    const w = world();
    w.api.editOne('a');
    w.down({ inRoot: w.S.els.a.root, closest: () => null });
    w.down({ inMenu: true, closest: () => null });
    w.down({ closest: (s) => (/mvbtn/.test(s) ? {} : null) });
    expect(w.api.one()).toBe('a');
    w.down({ closest: () => null });
    expect(w.api.one()).toBeNull();
  });
  it('the window losing focus (EverQuest was clicked, and took the click) ends it', () => {
    const w = world();
    w.api.editOne('a');
    w.blur();
    expect(w.api.one()).toBeNull();
    w.blur();                                          // nothing being edited: nothing to end, no second write
    expect(w.S.renders).toBe(2);
  });
  it('a click on the ✥ edits the item and opens its settings; a click on it again ends the edit', () => {
    const w = world();
    w.api.startDrag(w.mouse(), 'a', 'move', true);
    w.up();
    expect(w.api.one()).toBe('a');
    expect(w.S.opened).toEqual(['a']);
    w.api.startDrag(w.mouse(), 'a', 'move', true);
    w.up();
    expect(w.api.one()).toBeNull();
  });
  it('dragging the ✥ moves the item without starting an edit', () => {
    const w = world();
    w.api.startDrag(w.mouse({ clientX: 10, clientY: 10 }), 'a', 'move', true);
    w.move(60, 60); w.up();
    expect(w.api.one()).toBeNull();
    expect(w.S.panels[0].x).toBeGreaterThan(0.05);
  });
});

// ── the page: stylesheet and render wiring ──────────────────────────────────────────────────────────────────────────
const CODE = stripJs(SRC).replace(/\/\*[\s\S]*?\*\//g, '');
describe('the canvas page wires it', () => {
  it('every arranging rule (outline, iframe shield, tab, ◢, edges, 🔒 look, sample) also answers to .panel.one', () => {
    const rules = CODE.match(/[^{}]+\{[^{}]*\}/g) || [];
    const sel = (re) => rules.filter(r => re.test(r.split('{')[0]));
    expect(sel(/> iframe/).some(r => /\.panel\.one/.test(r) && /pointer-events:none/.test(r))).toBe(true);
    expect(sel(/\.tab\b/).some(r => /\.panel\.one/.test(r) && /display:flex/.test(r))).toBe(true);
    expect(sel(/\.grip/).some(r => /\.panel\.one/.test(r) && /display:block/.test(r))).toBe(true);
    expect(sel(/\.edge\.er/).some(r => /\.panel\.one/.test(r))).toBe(true);
    expect(sel(/\.edge\.eb/).some(r => /\.panel\.one/.test(r))).toBe(true);
    expect(sel(/> \.edge/).some(r => /\.panel\.one/.test(r))).toBe(true);
    expect(sel(/\.plock \.grip/).some(r => /\.panel\.one/.test(r))).toBe(true);
    expect(sel(/\.panel\.one \.tab \.done/).length).toBeGreaterThan(0);
  });
  it('no arranging rule is left that only body.edit can switch on', () => {
    const rules = (CODE.match(/[^{}]+\{[^{}]*\}/g) || []).map(r => r.split('{')[0].trim());
    const only = rules.filter(s => /^body\.edit\s/.test(s) && /\.(panel|tab|grip|edge|whb)\b/.test(s)
      && !/\.(part:hover|part \.tab|sel\b|hl\b|loc\b|part\.sample)/.test(s));
    expect(only).toEqual([]);
  });
  it('render marks only the edited item (.one) and arms only items in the edit state (data-wp-interact)', () => {
    expect(CODE).toMatch(/e\.root\.classList\.toggle\('one', _one === p\.id\)/);
    expect(CODE).toMatch(/if \(isEd\(p\.id\)\) e\.root\.setAttribute\('data-wp-interact', ''\)/);
  });
  it('the whole-canvas arrange mode clears the one; Done and the settings panel have their entries', () => {
    expect(CODE).toMatch(/if \(e\) _one = null;/);
    expect(CODE).toMatch(/data-one="1"[^>]*>✎ Edit this one/);
    expect(CODE).toMatch(/data-one="0"[^>]*>✓ Done with this one/);
    expect(CODE).toMatch(/tab\.querySelector\('\.done'\)\.addEventListener\('click'/);
    expect(CODE).toMatch(/if \(t\.hasAttribute\('data-one'\)\)/);
  });
  it('the arranging paths ask isEd(id), not the whole-canvas flag', () => {
    expect(CODE).toMatch(/if \(\(!isEd\(id\) && !anyTime && !\(playCorner && isCorner\(panelById\(id\)\)\)\)/);
    expect(CODE).toMatch(/isEd\(p\.id\) \|\| ev\.target === mv/);
    expect(CODE).toMatch(/sampleOn\(p, isEd\(p\.id\), _isTesting/);
    expect(CODE).toMatch(/ruled && !isEd\(p\.id\)/);
  });
});
