// test/canvas-minimize.test.js — ▭ Minimize on every Canvas panel (the guild lead, 2026-10-28: "for canvas have a minimize tab
// if the window is wide enough, otherwise hover it either over or to the side of, dependent on other UI element position.
// Make sure you can always read a label of what the button is, even if you have to move it. You can always put a little
// matching colored line in between if you must.")
//
// Three things are pinned here:
//   1. placeMin, the pure rule that picks where the label goes: in the tab when the tab has room, else outside the panel
//      (right, left, above, below, in that order, the first that stays on the canvas and covers nothing), a 2px line
//      back to the panel, and the label itself never shortened.
//   2. A panel with no mini of its own collapses to a tab-high strip, saved with the layout; one with a mini drives the
//      overlay's own setting (the one its ⚙ menu row, its right-click menu and the dashboard change).
//   3. The floating control is on the hover handshake (a <button> with data-wp-interact, both on PANEL_CTL), because the
//      Canvas window is click-through always; and it is re-placed on events, not on a timer.
//
// What this cannot show: how it looks on a real screen over EverQuest. test/ has no browser; the screenshot in the
// change's report was rendered separately.
//
// Run: npx vitest run test/canvas-minimize.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const mimic = (f) => path.join(ROOT, 'apps', 'mimic', f);
const canvas = readSource(mimic('canvas.html'));
const c = stripJs(canvas);

const PURE = sliceBlock(canvas, '  var MIN_GAP = 8', '  // ── end ▭ Minimize placement');
const { placeMin, collapsedBox, topFromBox, sizeStart, minHot, minVisible, MIN_GRACE, MIN_H, MIN_GAP, MIN_LINE } = evalBlock(PURE + '\n', ['placeMin', 'collapsedBox', 'topFromBox', 'sizeStart', 'minHot', 'minVisible', 'MIN_GRACE', 'MIN_H', 'MIN_GAP', 'MIN_LINE']);

const CV = { w: 1920, h: 1080 };
const LB = { w: 92, h: 18 };   // "▭ Minimize" at 11px, measured by the page; the rule only ever sees the number
const ask = (panel, avoid = [], more = {}) => placeMin(Object.assign({ panel, label: LB, canvas: CV, avoid, tabRoom: 0, tabBox: null }, more));
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const hull = (r) => {
  if (!r.line) return r.box;
  const x = Math.min(r.box.x, r.line.x), y = Math.min(r.box.y, r.line.y);
  return { x, y, w: Math.max(r.box.x + r.box.w, r.line.x + r.line.w) - x, h: Math.max(r.box.y + r.box.h, r.line.y + r.line.h) - y };
};

describe('placeMin: in the tab when it has room', () => {
  it('a wide panel (arranging: its tab shows) keeps the label in the tab, with no box and no line', () => {
    const r = ask({ x: 400, y: 300, w: 420, h: 120 }, [], { tabRoom: 420 + 2 - 150 });
    expect(r).toEqual({ side: 'tab', box: null, line: null, boxed: false });
  });
  it('a wide panel (playing: no tab is drawn) hugs the label to its top edge, nothing between', () => {
    const p = { x: 400, y: 300, w: 420, h: 120 };
    const r = ask(p, [], { tabRoom: p.w, tabBox: { x: p.x, y: p.y - LB.h, w: LB.w, h: LB.h } });
    expect(r.side).toBe('tab');
    expect(r.box).toEqual({ x: 400, y: 282, w: 92, h: 18 });
    expect(r.line).toBeNull();
  });
  it('a wide panel whose top edge is taken (a neighbour above, or the canvas edge) moves out instead', () => {
    const p = { x: 400, y: 10, w: 420, h: 120 };
    const r = ask(p, [], { tabRoom: p.w, tabBox: { x: p.x, y: p.y - LB.h, w: LB.w, h: LB.h } });   // y = -8: off the canvas
    expect(r.side).toBe('right');
    const q = { x: 400, y: 300, w: 420, h: 120 };
    const above = { x: 380, y: 270, w: 200, h: 28 };
    expect(ask(q, [above], { tabRoom: q.w, tabBox: { x: q.x, y: q.y - LB.h, w: LB.w, h: LB.h } }).side).toBe('right');
  });
  it('a panel narrower than its label has no tab room, whatever else is true', () => {
    const r = ask({ x: 400, y: 300, w: 60, h: 120 }, [], { tabRoom: 60 - 20 });
    expect(r.side).toBe('right');
  });
});

describe('placeMin: outside the panel, right then left then above then below', () => {
  const P = { x: 700, y: 400, w: 60, h: 100 };
  it('takes the right side when it is free, with a 2px line from the panel to the label', () => {
    const r = ask(P);
    expect(r.side).toBe('right');
    expect(r.box).toEqual({ x: 700 + 60 + MIN_GAP, y: 418, w: 92, h: 18 });   // below the ✥/✕ that sit on the top corners
    expect(r.line.h).toBe(MIN_LINE);
    expect(r.line.x).toBe(P.x + P.w);                   // starts on the panel's edge
    expect(r.line.x + r.line.w).toBe(r.box.x);          // ends on the label
    expect(r.line.y).toBeGreaterThanOrEqual(r.box.y);
    expect(r.line.y + r.line.h).toBeLessThanOrEqual(r.box.y + r.box.h);
  });
  it('a neighbour on the right sends it to the left', () => {
    const r = ask(P, [{ x: 770, y: 390, w: 120, h: 220 }]);
    expect(r.side).toBe('left');
    expect(r.box.x).toBe(P.x - MIN_GAP - LB.w);
    expect(r.line.x + r.line.w).toBe(P.x);              // the line meets the panel's left edge
    expect(r.line.x).toBe(r.box.x + r.box.w);           // and the label's right edge
    expect(r.line.h).toBe(MIN_LINE);
  });
  it('at the right edge of the canvas it goes left; with the left taken as well, above', () => {
    const edge = { x: 1860, y: 400, w: 60, h: 100 };
    expect(ask(edge).side).toBe('left');
    const r = ask(edge, [{ x: 1700, y: 380, w: 150, h: 160 }]);
    expect(r.side).toBe('above');
    expect(r.box).toEqual({ x: 1920 - LB.w, y: 400 - MIN_GAP - LB.h, w: 92, h: 18 });   // slid along the edge to stay on the canvas
    expect(r.line.w).toBe(MIN_LINE);                    // a vertical line this time
    expect(r.line.y + r.line.h).toBe(edge.y);           // down to the panel's top edge
    expect(r.line.x).toBeGreaterThanOrEqual(edge.x);
    expect(r.line.x + r.line.w).toBeLessThanOrEqual(edge.x + edge.w);
  });
  it('boxed in on the right, left and above, it is below; boxed in on the right, left and below, it is above', () => {
    const right = { x: 770, y: 400, w: 120, h: 100 }, left = { x: 560, y: 400, w: 120, h: 100 };
    const above = { x: 690, y: 340, w: 200, h: 40 }, below = { x: 690, y: 520, w: 200, h: 40 };
    const a = ask(P, [right, left, above]);
    expect(a.side).toBe('below');
    expect(a.box.y).toBe(P.y + P.h + MIN_GAP);
    expect(a.boxed).toBe(false);
    const b = ask(P, [right, left, below]);
    expect(b.side).toBe('above');
    expect(b.box.y).toBe(P.y - MIN_GAP - LB.h);
  });
  it('the first free one wins even when a later one would also be free (above before below)', () => {
    const r = ask(P, [{ x: 770, y: 400, w: 120, h: 100 }, { x: 560, y: 400, w: 120, h: 100 }]);
    expect(r.side).toBe('above');
  });
  it('a panel\'s own ✥ on its left side is respected, so a short panel does not put the label on it', () => {
    const short = { x: 700, y: 400, w: 60, h: 20 };
    const mv = { x: 684, y: 400, w: 16, h: 16 };   // the always-on ✥, just outside the top-left corner
    const r = ask(short, [mv]);
    expect(r.side).toBe('right');                  // right is clear; left would sit on the ✥ at this height
    const rl = ask(short, [{ x: 760, y: 400, w: 200, h: 20 }, mv]);
    expect(rl.side).toBe('above');
  });
  it('a label that fits nowhere is still whole: the least-bad side, flagged boxed, never shrunk', () => {
    const wall = [{ x: 0, y: 0, w: 1920, h: 1080 }];
    const r = ask(P, wall);
    expect(r.boxed).toBe(true);
    expect(r.box.w).toBe(LB.w); expect(r.box.h).toBe(LB.h);
  });
});

describe('placeMin: never shrinks the label, never covers anything, never leaves the canvas', () => {
  // A seeded scatter of panels, so this is a property over many layouts and not three hand-picked ones.
  let seed = 20261028;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  it('over 400 random layouts the answer is whole, clear and on the canvas (or flagged boxed)', () => {
    let tab = 0, out = 0, boxed = 0;
    for (let i = 0; i < 400; i++) {
      const panel = { x: Math.round(rnd() * 1800), y: Math.round(rnd() * 1000), w: 40 + Math.round(rnd() * 500), h: 16 + Math.round(rnd() * 200) };
      const others = [];
      for (let k = 0; k < 6; k++) others.push({ x: Math.round(rnd() * 1800), y: Math.round(rnd() * 1000), w: 40 + Math.round(rnd() * 300), h: 20 + Math.round(rnd() * 200) });
      const r = ask(panel, others, { tabRoom: panel.w - 130 });
      if (r.side === 'tab') { tab++; continue; }
      out++;
      expect(r.box.w).toBe(LB.w); expect(r.box.h).toBe(LB.h);
      if (r.boxed) { boxed++; continue; }
      const h = hull(r);
      expect(h.x).toBeGreaterThanOrEqual(0); expect(h.y).toBeGreaterThanOrEqual(0);
      expect(h.x + h.w).toBeLessThanOrEqual(CV.w); expect(h.y + h.h).toBeLessThanOrEqual(CV.h);
      for (const o of others) expect(hit(h, o)).toBe(false);
      expect(hit(h, panel)).toBe(false);   // the label sits outside the panel; only the line touches its edge
    }
    expect(tab).toBeGreaterThan(0); expect(out).toBeGreaterThan(0);   // both outcomes were exercised
    expect(boxed).toBeLessThan(out);                                   // and boxed-in is the rare answer, not the rule
  });
});

describe('a panel with no mini of its own collapses to its tab', () => {
  it('collapsedBox: tab-high, top-anchored panels keep their top edge, bottom-anchored ones their bottom edge', () => {
    const p = { h: 240 };
    expect(collapsedBox(p, 300, false, false)).toEqual({ y: 300, h: 240 });
    expect(collapsedBox(p, 300, false, true)).toEqual({ y: 300, h: MIN_H });
    expect(collapsedBox(p, 300, true, true)).toEqual({ y: 300 + 240 - MIN_H, h: MIN_H });
    expect(MIN_H).toBeLessThanOrEqual(20);
  });
  function rig(miniOfKey) {
    const block = [
      sliceBlock(canvas, '  function hasMini(p) {', '\n'),
      sliceBlock(canvas, '  function isMin(p) {', '\n'),
      sliceBlock(canvas, '  function setMin(p) {', '\n  }\n'),
    ].join('\n');
    return evalBlock('var _layout = { panels: [] }; var miniOf = ' + miniOfKey + ';\n' + block, ['hasMini', 'isMin', 'setMin', '_layout']);
  }
  it('isMin: a plain panel is minimized by its flag; an overlay that has a mini is never collapsed (its mini is the minimize)', () => {
    const r = rig('function (k) { return k === \'charm\' ? { on: false } : null; }');
    expect(r.isMin({ kind: 'timers', min: true })).toBe(true);
    expect(r.isMin({ kind: 'timers' })).toBe(false);
    expect(r.isMin({ kind: 'part', min: 'yes' })).toBe(false);
    expect(r.isMin({ kind: 'overlay', key: 'charm', min: true })).toBe(false);
    expect(r.isMin({ kind: 'overlay', key: 'tick', min: true })).toBe(true);   // an overlay with no mini collapses like any other
  });
  it('setMin flips the panel, and a group together; a mini-capable one is left to its own setting', () => {
    const r = rig('function (k) { return k === \'charm\' ? { on: false } : null; }');
    const a = { id: 'a', kind: 'part', grp: 'g1' }, b = { id: 'b', kind: 'part', grp: 'g1' }, z = { id: 'z', kind: 'part', grp: 'g2' };
    r._layout.panels = [a, b, z];
    r.setMin(a);
    expect([a.min, b.min, z.min]).toEqual([true, true, undefined]);
    r.setMin(b);
    expect([a.min, b.min, z.min]).toEqual([undefined, undefined, undefined]);
    expect('min' in a).toBe(false);   // absent is "not minimized", as a lock is
    const ov = { id: 'o', kind: 'overlay', key: 'charm' };
    r._layout.panels = [ov];
    r.setMin(ov);
    expect(ov.min).toBeUndefined();   // hasMini: the overlay's own setting is what Restore/Minimize drives (toggleMin)
  });
  it('place() holds only the strip, and the page behind it keeps its layout', () => {
    const place = sliceBlock(canvas, '  function place(e, p) {', '\n  }\n');
    const s = stripJs(place);
    expect(s).toMatch(/collapsedBox\(p, Math\.round\(p\.y \* H\), growsUp\(p\), isMin\(p\)\)/);
    expect(s).toMatch(/fitRect\(screenList\(W, H\)[^;]*, cb\.y, p\.w \+ \(wd \? wd\.add : 0\), cb\.h, growsUp\(p\), isFree\(p\)\)/);
    expect(s).toMatch(/sizeFrame\(e, p, w, isMin\(p\) \? p\.h : h\)/);
  });
  it('render marks the strip, fitStep leaves its height alone, and the hide rules keep the page running', () => {
    expect(c).toMatch(/e\.root\.classList\.toggle\('collapsed', isMin\(p\)\)/);
    expect(c).toMatch(/if \(!e \|\| p\.off \|\| isMin\(p\) \|\|/);
    const css = canvas.slice(canvas.indexOf('.panel.collapsed{'), canvas.indexOf('.panel.collapsed.mvtail'));
    expect(css).toMatch(/\.panel\.collapsed > iframe,\.panel\.collapsed > \.pbody\{visibility:hidden\}/);   // not display:none: a pinned callout lives in that page
    expect(css).not.toMatch(/display:none[^!]/);
  });
});

describe('it is saved with the layout', () => {
  const block = sliceBlock(canvas, '  var GROUPS = [', '  // ── Panels ──');
  const { sanitize } = evalBlock('var window = {};\n' + block, ['sanitize']);
  beforeAll(() => {
    globalThis.window = globalThis;
    require(mimic('parts.js'));
    require(mimic('sections.js'));
  });
  it('min is kept only when it is exactly true, for every kind; absent reads as not minimized', () => {
    const s = sanitize({ panels: [
      { id: 'q', kind: 'part', part: 'me.hp', mode: 'bar', x: 0.1, y: 0.1, w: 200, h: 30, min: true },
      { id: 's', kind: 'sect', key: 'mobinfo', sect: 'hp', x: 0.1, y: 0.1, w: 200, h: 30, min: true },
      { id: 'o', kind: 'overlay', key: 'charm', x: 0.1, y: 0.1, w: 300, h: 200, min: true },
      { id: 't', kind: 'timers', all: true, x: 0.5, y: 0.5, w: 300, h: 100, min: true },
      { id: 'u', kind: 'timers', all: false, x: 0.5, y: 0.5, w: 300, h: 100, min: 'yes' },
      { id: 'w', kind: 'timers', all: false, x: 0.5, y: 0.5, w: 300, h: 100 },
    ] });
    const by = Object.fromEntries(s.panels.map(p => [p.id, p]));
    expect(['q', 's', 'o', 't'].map(k => by[k].min)).toEqual([true, true, true, true]);
    for (const k of ['u', 'w']) expect('min' in by[k]).toBe(false);
  });
});

describe('the control is on the hover handshake and drives the same state as the ⚙ menu', () => {
  it('the floating control is a <button> with data-wp-interact, and PANEL_CTL arms both', () => {
    expect(c).toMatch(/var chip = document\.createElement\('button'\);/);
    expect(c).toMatch(/chip\.setAttribute\('data-wp-interact', ''\);/);
    const ctl = /var PANEL_CTL = '([^']+)'/.exec(c)[1].split(',').map(s => s.trim());
    expect(ctl).toContain('button');
    expect(ctl).toContain('[data-wp-interact]');
    expect(c).toMatch(/<span class="ctl minb" role="button" data-wp-interact><\/span>/);   // the in-tab one, too
  });
  it('the floating control lives in its own layer, above the panels and below the toolbar and menu', () => {
    expect(canvas).toMatch(/<div id="mins"><\/div>/);
    const z = (re) => Number(re.exec(canvas)[1]);
    expect(z(/#mins\{[^}]*z-index:(\d+)/)).toBeGreaterThan(z(/\.panel\.one\{z-index:(\d+)/));
    expect(z(/#mins\{[^}]*z-index:(\d+)/)).toBeLessThan(z(/#shield\{[^}]*z-index:(\d+)/));
    expect(z(/#mins\{[^}]*z-index:(\d+)/)).toBeLessThan(z(/#bar\{[^}]*z-index:(\d+)/));
  });
  it('the label says what it does in words, and Restore when it is already minimized', () => {
    expect(c).toMatch(/function minLabel\(p\) \{ return minOn\(p\) \? '▭ Restore' : '▭ Minimize'; \}/);
    expect(c).not.toMatch(/\.minchip[^}]*text-overflow/);   // never ellipsised
    expect(canvas).toMatch(/\.minchip\{[^}]*white-space:nowrap/);
  });
  it('an overlay with a mini drives the overlay\'s own setting through the same helper as the ⚙ row', () => {
    const toggle = stripJs(sliceBlock(canvas, '  function toggleMin(id) {', '\n  }\n'));
    expect(toggle).toMatch(/if \(hasMini\(p\)\) \{\s*var done = flipMini\(p, false\);/);
    const click = stripJs(sliceBlock(canvas, "  menuEl.addEventListener('click', function (ev) {", '\n  });\n'));
    expect(click).toMatch(/var done = flipMini\(p, t\.hasAttribute\('data-minipin'\)\);/);
    expect(click).toMatch(/else if \(t\.hasAttribute\('data-min'\)\) \{ setMin\(p\); \}/);
    expect(c).toMatch(/data-minipin title=/);   // the ⚙ rows are still there
    expect(c).toMatch(/data-mini title=/);
  });
  it('it is re-placed on events (a panel changing, a render, a drag ending), never on a timer or per frame', () => {
    const sched = stripJs(sliceBlock(canvas, '  function scheduleMins() {', '\n'));
    expect(sched).toMatch(/if \(!_minsRaf\) _minsRaf = requestAnimationFrame\(placeMins\);/);
    const body = stripJs(sliceBlock(canvas, '  function placeMins() {', '\n  }\n'));
    expect(body).not.toMatch(/requestAnimationFrame|setInterval|setTimeout|scheduleMins/);   // it does not re-arm itself
    expect(body).toMatch(/if \(_drag\) return;/);                                            // held while a panel is being dragged
    expect(c).not.toMatch(/setInterval\(placeMins/);
    // only a panel's own box or class changing wakes it, not the insides of its page
    expect(c).toMatch(/new MutationObserver\(function \(ms\) \{\s*for \(var i = 0; i < ms\.length; i\+\+\) if \(ms\[i\]\.target\.parentNode === panelsEl\) \{ scheduleMins\(\); return; \}/);
    expect(c).toMatch(/attributeFilter: \['class', 'style'\]/);
    // render() asks for a placement; the canvas resize goes through refresh() -> render()
    const render = stripJs(sliceBlock(canvas, '  function render() {', '\n  }\n'));
    expect(render).toMatch(/placeGbox\(\);\s*scheduleMins\(\);/);
  });
  it('the placement reads the canvas once and writes once: labels and the line only, never a panel', () => {
    const body = stripJs(sliceBlock(canvas, '  function placeMins() {', '\n  }\n'));
    expect(body).not.toMatch(/\be\.root\.style\./);   // a panel's own box is the layout's; this only moves the labels
    expect(body).toMatch(/placeMin\(\{/);
    expect(body).toMatch(/e\.line\.style\.display = 'block'/);
  });
});

describe('playing: a label shows only under the pointer (the guild lead\'s clutter call: nothing pointing at nothing mid-raid)', () => {
  const play = { edit: false, collapsed: false, empty: false, hovered: false };
  it('minVisible: hidden by default while playing, shown while hovered, and always while arranging', () => {
    expect(minVisible(play)).toBe(false);
    expect(minVisible({ ...play, hovered: true })).toBe(true);
    expect(minVisible({ ...play, edit: true })).toBe(true);
  });
  it('a minimized panel\'s ▭ Restore is always visible, hovered or not', () => {
    expect(minVisible({ ...play, collapsed: true })).toBe(true);
    expect(minVisible({ ...play, collapsed: true, hovered: false, empty: false })).toBe(true);
  });
  it('a panel with nothing showing gets no label while playing, even under the pointer; arranging still shows it', () => {
    expect(minVisible({ ...play, empty: true, hovered: true })).toBe(false);
    expect(minVisible({ ...play, empty: true })).toBe(false);
    expect(minVisible({ ...play, empty: true, edit: true })).toBe(true);
  });
  it('minHot: the panel, its ✥ and the label with its line all keep it up; elsewhere nothing does', () => {
    const zones = [{ id: 'a', rects: [{ x: 100, y: 100, w: 200, h: 50 }, { x: 84, y: 100, w: 16, h: 16 }, { x: 300, y: 118, w: 100, h: 18 }] },
      { id: 'b', rects: [{ x: 600, y: 100, w: 50, h: 50 }] }];
    expect(minHot(zones, 150, 120)).toBe('a');   // on the panel
    expect(minHot(zones, 90, 105)).toBe('a');    // on its ✥
    expect(minHot(zones, 350, 125)).toBe('a');   // on the label, and the line on the way to it is inside that rect
    expect(minHot(zones, 620, 120)).toBe('b');
    expect(minHot(zones, 500, 500)).toBeNull();
    expect(minHot([], 1, 1)).toBeNull();
  });
  it('the grace is long enough to cross the gap and short enough to clear the screen', () => {
    expect(MIN_GRACE).toBeGreaterThanOrEqual(300);
    expect(MIN_GRACE).toBeLessThanOrEqual(600);
  });
  it('it is wired: unseen labels are hidden by CSS, shown by .hot, driven by pointer events and one grace timer', () => {
    expect(canvas).toMatch(/\.minchip:not\(\.hot\),\.minline:not\(\.hot\)\{visibility:hidden\}/);
    expect(c).toMatch(/e\.chip\.classList\.toggle\('hot', on\); e\.line\.classList\.toggle\('hot', on\);/);
    expect(c).toMatch(/document\.addEventListener\('mousemove', function \(ev\) \{ hoverMins\(ev\.clientX, ev\.clientY\); \}, true\);/);
    expect(c).toMatch(/hoverMins\(p \? p\.x : -1, p \? p\.y : -1\);/);   // main's cursor reports too
    const hover = stripJs(sliceBlock(canvas, '  function hoverMins(x, y) {', '\n  }\n'));
    expect(hover).toMatch(/setTimeout\(function \(\) \{ _hoverT = 0; _hoverId = null; paintMins\(\); \}, MIN_GRACE\)/);
    expect(hover).not.toMatch(/getBoundingClientRect|offsetWidth|requestAnimationFrame|setInterval/);   // a move reads no layout
    const paint = stripJs(sliceBlock(canvas, '  function paintMins() {', '\n  }\n'));
    expect(paint).toMatch(/collapsed: minOn\(p\)/);
    expect(paint).toMatch(/empty: e\.root\.classList\.contains\('fitempty'\)/);
  });
  it('placement does not depend on whether the label is showing (same rule, hidden or not), and an empty panel is not placed while playing', () => {
    const body = stripJs(sliceBlock(canvas, '  function placeMins() {', '\n  }\n'));
    expect(body).toMatch(/\(editing \|\| _one === p\.id \|\| minOn\(p\) \|\| !c\.contains\('fitempty'\)\)/);
    expect(body).not.toMatch(/_hoverId/);
    expect(body).toMatch(/_minZones\.push\(/);
  });
});

// ── a minimized strip is still movable and resizable (the guild lead, 2026-10-28: "minimized overlays need to be draggable
// and resizable still") ──────────────────────────────────────────────────────────────────────────────────────────────
// Measured on the real page in Chromium first: with the strip's overflow:hidden the ✥ (just outside its left edge) was not
// what a click at its position hit, a ✥ drag moved nothing, and the ◢ was display:none. What is held here:
//   • nothing clips the ✥, the tab or the dismiss ✕ of a strip; the ◢ stays (width cursor), the full-box edges do not;
//   • a ✥ drag of a BOTTOM-anchored strip saves the panel's top, not the strip's (topFromBox, the inverse of collapsedBox);
//   • a size press on a strip works in width alone, from the height the page behind it keeps.
describe('a minimized strip can be moved and sized', () => {
  const css = stripCss(canvas);
  function stripCss(src) { return src.replace(/\/\*[\s\S]*?\*\//g, ''); }
  const rule = (sel) => { const at = css.indexOf(sel + '{'); return at < 0 ? null : css.slice(at, css.indexOf('}', at)); };
  it('the strip does not clip what hangs outside it, and the name clips itself', () => {
    expect(rule('.panel.collapsed')).not.toBeNull();
    expect(rule('.panel.collapsed')).not.toMatch(/overflow/);
    expect(rule('.panel.collapsed::after')).toMatch(/overflow:hidden;text-overflow:ellipsis/);
  });
  it('the ◢ is no longer hidden on a strip (the edges, drawn for a full box, still are)', () => {
    expect(css).toMatch(/\.panel\.collapsed > \.edge\{display:none!important\}/);
    expect(css).not.toMatch(/\.panel\.collapsed > \.grip[^{]*\{[^}]*display:none/);
    expect(css).toMatch(/\.panel\.collapsed:not\(\.plock\) > \.grip\{cursor:ew-resize!important\}/);   // a locked one keeps not-allowed
  });
  it('topFromBox undoes collapsedBox for every anchor, height and position', () => {
    for (const up of [false, true]) for (const h of [18, 60, 240, 700]) for (const top of [-90, 0, 300, 812]) {
      const p = { h };
      const box = collapsedBox(p, top, up, true);
      expect(topFromBox(p, box.y, up, true)).toBe(top);
    }
  });
  it('an unminimized panel saves exactly where it was dropped, and a top-anchored strip does too', () => {
    expect(topFromBox({ h: 240 }, 410, true, false)).toBe(410);
    expect(topFromBox({ h: 240 }, 410, false, true)).toBe(410);
    expect(topFromBox({ h: 240 }, 410, false, false)).toBe(410);
  });
  it('a bottom-anchored strip dragged 60px down saves a top 60px lower (it used to save the strip\'s top and jump p.h - 18 on the next draw)', () => {
    const p = { h: 200 }, top = 280;
    const strip = collapsedBox(p, top, true, true);                       // y = 462
    const dropped = strip.y + 60;
    const saved = topFromBox(p, dropped, true, true);
    expect(saved).toBe(top + 60);
    expect(collapsedBox(p, saved, true, true).y).toBe(dropped);           // redrawn where it was dropped
  });
  it('sizeStart: a size press on a strip is width-only from the page\'s height; everything else starts from the box as drawn', () => {
    expect(sizeStart({ h: 200 }, true, 'size', '', 18)).toEqual({ axis: 'x', h0: 200 });
    expect(sizeStart({ h: 200 }, true, 'size', 'y', 18)).toEqual({ axis: 'x', h0: 200 });
    expect(sizeStart({ h: 200 }, true, 'move', '', 18)).toEqual({ axis: '', h0: 18 });
    expect(sizeStart({ h: 200 }, false, 'size', '', 150)).toEqual({ axis: '', h0: 150 });
    expect(sizeStart({ h: 200 }, false, 'size', 'y', 150)).toEqual({ axis: 'y', h0: 150 });
    expect(sizeStart(null, false, 'size', undefined, 150)).toEqual({ axis: '', h0: 150 });
  });
  it('the drag path uses them: the press, the strip\'s own height kept while sizing, and both saves', () => {
    expect(c).toMatch(/ss = sizeStart\(dq, !!dq && isMin\(dq\), mode, axis, e\.root\.offsetHeight\)/);
    expect(c).toMatch(/if \(!\(dp && isMin\(dp\)\)\) e\.root\.style\.height = h \+ 'px';/);
    expect(c).toMatch(/q\.y = topFromBox\(q, m\.y, growsUp\(q\), isMin\(q\)\) \/ window\.innerHeight/);
    expect(c).toMatch(/p\.y = topFromBox\(p, d\.y, growsUp\(p\), isMin\(p\)\) \/ window\.innerHeight/);
    // a group SIZE leaves a strip as it is (its box is the page's); a group MOVE carries it
    expect(c).toMatch(/lock: isLocked\(q\) \|\| kStrip/);
  });
});
