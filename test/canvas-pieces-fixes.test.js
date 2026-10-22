// test/canvas-pieces-fixes.test.js — the Canvas "pieces" round of 2026-10-22: the HUD ring as pieces.
//
// Four reports from the guild lead, on the HUD ring brought in as pieces (a ring of Ring arcs):
//   1  "the whole group can't be converted ring arcs"             → Whole group offers Ring arc and lays the group out as a ring
//   2  "text under a vertical bar should be able to be rotated"   → Label turn (Upright / Rotated 90° / Rotated −90°)
//   3  "Bar or Ring Thin / Normal / Thick doesn't do anything"      → a Ring arc's stroke follows it, by a step the eye can see
//   4  "Neither does Left Centre Right (and make it Center)"        → a label's place along its arc, and the shapes that sit in the middle
// parts.js and canvas.html's own functions run for real (the other canvas tests' slicing).
//
// Run: npx vitest run test/canvas-pieces-fixes.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, stripCss, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const mimic = (f) => path.join(ROOT, 'apps', 'mimic', f);
const canvas = readSource(mimic('canvas.html'));
const partsSrc = readSource(mimic('parts.js'));

let W;
beforeAll(() => { globalThis.window = globalThis; require(mimic('parts.js')); W = globalThis.WpParts; });

const NOW = 1_000_000;
const preset = () => W.PRESETS.find(p => p.id === 'hud-ring');
const arcOf = (id) => preset().parts.find(r => r[0] === id)[6].arc;
const sample = (id) => { const d = W.byId[id]; return typeof d.sample === 'function' ? d.sample(NOW) : d.sample; };
const seg = (id, opts = {}) => W.render(W.byId[id], 'seg', sample(id), NOW, { arc: arcOf(id), uid: 'q' + id.replace(/\W/g, ''), ...opts });
// The stroke widths the bar of a Ring arc is drawn with (track + fill), as numbers.
const strokes = (html) => [...html.matchAll(/stroke-width="([\d.]+)"/g)].map(m => +m[1]);
const vbox = (html) => html.match(/viewBox="([^"]+)"/)[1];
const textPath = (html) => html.match(/<path id="[^"]+" d="([^"]+)" fill="none" stroke="none"\/><text font-size="([\d.]+)"><textPath href="#[^"]+" startOffset="([^"]+)" text-anchor="([^"]+)"/);

// ── 3: thickness ────────────────────────────────────────────────────────────────────────────────────────
describe('Thin / Normal / Thick reach a Ring arc (report 3)', () => {
  it('the bar\'s stroke is thinner at Thin and thicker at Thick, by a step a hairline arc can show', () => {
    for (const id of ['target.hp', 'me.mana', 'me.end', 'tick.swing']) {   // (me.end is a 1.1-unit hairline)
      const w = (t) => Math.max(...strokes(seg(id, { thick: t })));
      const base = arcOf(id).w;
      expect(w(''), id).toBe(base);
      expect(w('thin'), id).toBeLessThan(base);
      expect(w('thick') - base, id).toBeGreaterThanOrEqual(3);   // the 1-unit arcs used to gain 0.8 of a 400-unit ring
    }
  });
  it('segWidth: thin is half (never under half a unit), thick doubles or adds 3.5, normal is the arc\'s own', () => {
    expect([W.segWidth(1, 'thin'), W.segWidth(3.3, 'thin'), W.segWidth(0.6, 'thin')]).toEqual([0.5, 1.65, 0.5]);
    expect([W.segWidth(1, 'thick'), W.segWidth(3.3, 'thick'), W.segWidth(10, 'thick')]).toEqual([4.5, 6.8, 20]);
    expect([W.segWidth(3.3, ''), W.segWidth(3.3, undefined)]).toEqual([3.3, 3.3]);
  });
  it('a cooldown list (several segments) thickens too, and a thicker bar never rescales the piece', () => {
    const cd = (t) => seg('me.cooldowns', { thick: t });
    expect(Math.max(...strokes(cd('thick')))).toBeGreaterThan(Math.max(...strokes(cd(''))));
    expect(vbox(cd('thick'))).toBe(vbox(cd(''))); expect(vbox(cd('thin'))).toBe(vbox(cd('')));
  });
  it('the other shapes still thicken in CSS (bar height, ring stroke, upright bar width)', () => {
    const css = stripCss(W.CSS);
    expect(css).toContain('.pt.tk-thick .pt-track{height:calc(14px * var(--ps,1))}');
    expect(css).toContain('.pt.tk-thick .pt-rt,.pt.tk-thick .pt-rf{stroke-width:15}');
    expect(css).toContain('.pt.tk-thick .pt-vt{width:calc(22px * var(--ps,1))}');
    expect(W.render(W.byId['me.hp'], 'bar', sample('me.hp'), NOW, { thick: 'thick' })).toContain('class="pt tk-thick pt-bar"');
  });
});

// ── 4: alignment ────────────────────────────────────────────────────────────────────────────────────────
describe('Left / Center / Right reach these pieces (report 4)', () => {
  it('the button says Center, and Left is a value of its own (the saved c and r are unchanged)', () => {
    expect(W.ALIGN).toEqual([['l', 'Left'], ['c', 'Center'], ['r', 'Right']]);
    expect(stripJs(partsSrc)).not.toContain('Centre');
    expect(readSource(mimic('canvas.html'))).not.toMatch(/>Centre</);
  });
  it('alignOf: the shapes that sit in the middle read as Center until told otherwise; the rest as Left', () => {
    for (const m of ['seg', 'vbar', 'badge', 'ring', 'arc']) expect([m, W.alignOf(m, '')]).toEqual([m, 'c']);
    for (const m of ['bar', 'thin', 'readout', 'big', 'rows', 'chips']) expect([m, W.alignOf(m, '')]).toEqual([m, 'l']);
    expect(['l', 'c', 'r'].map(a => W.alignOf('seg', a))).toEqual(['l', 'c', 'r']);
    expect(W.alignOf('bar', 'junk')).toBe('l');
  });
  it('a Ring arc label sits at the start, middle or end of its arc; unset is the middle, as the ring is drawn', () => {
    const at = (align) => textPath(seg('me.hp', { align }));
    expect(at('l').slice(3)).toEqual(['1%', 'start']);
    expect(at('c').slice(3)).toEqual(['50%', 'middle']);
    expect(at('r').slice(3)).toEqual(['99%', 'end']);
    expect(at('').slice(1, 5)).toEqual(at('c').slice(1, 5));   // a ring brought in before Left was a value looks the same
    expect(seg('me.hp', { align: '' })).toBe(seg('me.hp', { align: 'c' }).replace(' al-c', ''));   // (only the class differs)
    expect(seg('me.hp', { align: 'l' })).not.toBe(seg('me.hp', {}));
    // cooldowns: every segment's label moves
    const cd = (align) => [...seg('me.cooldowns', { align }).matchAll(/startOffset="([^"]+)"/g)].map(m => m[1]);
    expect(cd('l')).toEqual(Array(cd('l').length).fill('1%')); expect(cd('l').length).toBeGreaterThan(1);
    expect(cd('r')).toEqual(Array(cd('r').length).fill('99%'));
  });
  it('the shapes drawn as HTML take a class for it, and the dials move inside their box', () => {
    const view = sample('me.hp');
    const r = (mode, align) => W.render(W.byId['me.hp'], mode, view, NOW, { align });
    expect(r('bar', 'c')).toContain('class="pt al-c pt-bar"');
    expect(r('bar', 'r')).toContain('class="pt al-r pt-bar"');
    expect(r('bar', 'l')).toContain('class="pt al-l pt-bar"');
    expect(r('bar', '')).toContain('class="pt pt-bar"');
    expect(r('vbar', 'r')).toContain('al-r');
    expect(r('ring', 'l')).toContain('preserveAspectRatio="xMinYMid meet"');
    expect(r('ring', 'r')).toContain('preserveAspectRatio="xMaxYMid meet"');
    expect(r('ring', '')).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(r('arc', 'r')).toContain('preserveAspectRatio="xMaxYMid meet"');
    const css = stripCss(W.CSS);
    expect(css).toContain('.pt-vbar.al-l{align-items:flex-start}.pt-vbar.al-r{align-items:flex-end}');
    expect(css).toContain('.pt-badge.al-l{justify-content:flex-start}.pt-badge.al-r{justify-content:flex-end}');
  });
});

// ── 2: label turn ───────────────────────────────────────────────────────────────────────────────────────
describe('Label turn (report 2)', () => {
  it('an upright bar carries the turn as a class; a bar of any other shape ignores it', () => {
    const v = (mode, rot) => W.render(W.byId['me.hp'], mode, sample('me.hp'), NOW, { rot });
    expect(v('vbar', 'cw')).toContain('class="pt rot-cw pt-vbar"');
    expect(v('vbar', 'ccw')).toContain('class="pt rot-ccw pt-vbar"');
    expect(v('vbar', '')).toContain('class="pt pt-vbar"');
    expect(v('vbar', 'sideways')).toContain('class="pt pt-vbar"');
    expect(v('bar', 'cw')).toContain('class="pt pt-bar"');
  });
  it('the CSS turns the label beside the bar: down on its right, up on its left, the value staying over the bar', () => {
    const css = stripCss(W.CSS);
    expect(css).toContain('.pt-vbar.rot-cw .pt-l{grid-area:1/2/3/3}');
    expect(css).toContain('.pt-vbar.rot-ccw .pt-l{grid-area:1/1/3/2;transform:rotate(180deg)}');
    expect(css).toMatch(/\.pt-vbar\.rot-cw \.pt-l,\.pt-vbar\.rot-ccw \.pt-l\{writing-mode:vertical-rl;/);
    // the grid must stretch its items: the upright bar centres its flex column, and a centred grid item collapses
    // the track to its 2px border (seen in a real browser: the bar disappeared)
    expect(css).toMatch(/\.pt-vbar\.rot-cw,\.pt-vbar\.rot-ccw\{display:grid;[^}]*align-items:stretch;/);
  });
  it('turnable: only an upright bar or a Ring arc has a label to turn; cleanRot keeps cw / ccw and nothing else', () => {
    expect(['vbar', 'seg', 'bar', 'ring', 'readout'].map(W.turnable)).toEqual([true, true, false, false, false]);
    expect(['cw', 'ccw', '', 'x', null, 90].map(W.cleanRot)).toEqual(['cw', 'ccw', '', '', '', '']);
    expect(W.ROT.map(r => r[1])).toEqual(['Upright', 'Rotated 90°', 'Rotated −90°']);
  });
  it('a Ring arc label reads the other way round the circle, on the same side of its bar', () => {
    const d = (id, rot) => textPath(seg(id, { rot }));
    // me.hp's label is written clockwise (sweep 1); Rotated −90° reverses it (sweep 0)
    expect(d('me.hp', '')[1]).toMatch(/ 0 0 1 /);
    expect(d('me.hp', 'cw')[1]).toBe(d('me.hp', '')[1]);
    expect(d('me.hp', 'ccw')[1]).toMatch(/ 0 [01] 0 /);
    expect(d('me.hp', 'ccw')[1]).not.toBe(d('me.hp', '')[1]);
    // the swing arc is drawn counter-clockwise along the bottom; Rotated 90° makes it clockwise
    expect(d('tick.swing', '')[1]).toMatch(/ 0 [01] 0 /);
    expect(d('tick.swing', 'cw')[1]).toMatch(/ 0 [01] 1 /);
    // the baseline moves by the text's own height, so the words do not land on the bar
    const r = (p) => +p.match(/A([\d.]+) /)[1];
    expect(r(d('me.hp', 'ccw')[1])).toBeGreaterThan(r(d('me.hp', '')[1]));
    expect(r(d('tick.swing', 'cw')[1])).toBeLessThan(r(d('tick.swing', '')[1]));
    expect(W.segTurn({ below: false, lr: 182 }, 10, 'ccw')).toEqual({ ccw: true, lr: 189.2 });
    expect(W.segTurn({ below: true, lr: 187 }, 10, 'cw')).toEqual({ ccw: false, lr: 179.8 });
    expect(W.segTurn({ below: true, lr: 187 }, 10, '')).toEqual({ ccw: true, lr: 187 });
  });
});

// ── the canvas: saving, the menu and the Whole group row ───────────────────────────────────────────────
describe('the canvas keeps and offers the new settings', () => {
  const c = stripJs(canvas);
  it('a layout keeps a piece\'s turn and Left, and drops anything else', () => {
    const r = new Function('var window = { WpParts: globalThis.WpParts };\n' + sliceBlock(canvas, '  var GROUPS = [', '  // ── Panels ──') + '\nreturn { sanitize };')();
    const s = r.sanitize({ panels: [
      { id: 'a', kind: 'part', part: 'me.hp', mode: 'vbar', x: 0, y: 0, w: 40, h: 120, rot: 'ccw', align: 'l' },
      { id: 'b', kind: 'part', part: 'me.hp', mode: 'vbar', x: 0, y: 0, w: 40, h: 120, rot: 'up', align: 'z' }] });
    const [a, b] = s.panels.filter(p => p.kind === 'part');
    expect([a.rot, a.align]).toEqual(['ccw', 'l']);
    expect([b.rot, b.align]).toEqual(['', '']);
  });
  it('the menu draws the turn row for an upright bar or Ring arc only, and marks the alignment that is in force', () => {
    expect(c).toContain("if (WpParts.turnable(p.mode)) {");
    expect(c).toContain("data-rot=\"' + r[0] + '\"");
    expect(c).toContain("var palign = WpParts.alignOf(p.mode, p.align);");
    expect(c).toContain("(palign === a[0] ? ' on' : '')");
    expect(c).toContain("p.rot = WpParts.cleanRot(t.getAttribute('data-rot'));");
  });
  it('a saved group and the render call carry the turn', () => {
    expect(c).toContain("align: p.align || '', rot: p.rot || ''");
    expect(c).toContain('align: p.align, rot: p.rot, arc: p.arc, uid: p.id');
  });
  it('the Whole group row offers Left / Center / Right and (with a turnable piece in it) the label turn', () => {
    const src = sliceBlock(canvas, '  function bulkMenuHtml(ps) {', '\n  }\n');
    const html = new Function('WpParts', 'esc', 'BULK_THICK', 'bulkModes', 'return (' + src.replace(/^\s*function bulkMenuHtml/, 'function') + ')')(
      W, (s) => String(s), [['thin', 'Thin'], ['normal', 'Normal'], ['thick', 'Thick']], () => [['seg', 'Ring arc']]);
    const row = (modes) => html(modes.map(m => ({ mode: m })));
    const bars = row(['bar', 'bar']), ups = row(['vbar', 'bar']);
    expect(bars).toContain('data-bulk="mode" data-v="seg">Ring arc');
    for (const v of ['l', 'c', 'r']) expect(bars).toContain('data-bulk="align" data-v="' + v + '"');
    expect(bars).not.toContain('data-bulk="rot"');
    for (const v of ['', 'cw', 'ccw']) expect(ups).toContain('data-bulk="rot" data-v="' + v + '"');
  });
});

// ── 1: the whole group as Ring arcs ───────────────────────────────────────────────────────────────────────
describe('Whole group → Ring arc lays the group out as a ring (report 1)', () => {
  const src = sliceBlock(canvas, '  function bulkPatch(kind, v) {', '  var BULK_THICK');
  const SCREEN = { innerWidth: 1600, innerHeight: 1000 };
  const num = (v, lo, hi, d) => { v = Number(v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  const env = () => new Function('WpParts', 'window', 'num', 'function partDef(p) { return WpParts.byId[p.part]; }\n' + src + '\nreturn { bulkPatch, bulkModes, bulkSet };')(W, SCREEN, num);
  // The HUD ring's pieces as the canvas drops them: the ring's space scaled to half the short side, centred.
  const ringPieces = () => {
    const g = preset(), S = 500, k = S / g.ring, left = 800 - S / 2, top = 500 - S / 2;
    return g.parts.map((a, i) => ({ id: 'r' + i, kind: 'part', part: a[0], mode: 'seg', grp: 'g1', arc: W.cleanArc(a[6].arc),
      x: (left + a[2] * k) / SCREEN.innerWidth, y: (top + a[3] * k) / SCREEN.innerHeight, w: a[4] * k, h: a[5] * k }));
  };
  const barPieces = (n) => Array.from({ length: n }, (_, i) => ({ id: 'b' + i, kind: 'part', part: ['me.hp', 'me.mana', 'me.end', 'target.hp', 'tick.server'][i % 5], mode: 'bar', grp: 'g1',
    arc: null, x: 0.1, y: (100 + i * 40) / SCREEN.innerHeight, w: 220, h: 34 }));
  const px = (p) => [p.x * SCREEN.innerWidth, p.y * SCREEN.innerHeight, p.w, p.h];

  it('Ring arc is on offer for the group', () => {
    const { bulkModes } = env();
    expect(bulkModes(barPieces(3)).map(m => m[0])).toContain('seg');
  });
  it('the HUD ring, taken to bars and back to Ring arc, gets its arcs back in the ring\'s own layout', () => {
    const { bulkSet, bulkPatch } = env(), ps = ringPieces(), want = ps.map(px), arcs = ps.map(p => JSON.stringify(p.arc));
    bulkSet(ps, bulkPatch('mode', 'bar'));       // (the words-only arcs and the cooldowns have no Bar and stay arcs)
    const res = bulkSet(ps, bulkPatch('mode', 'seg'));
    expect(res).toEqual({ changed: ps.length, skipped: 0 });
    expect(ps.every(p => p.mode === 'seg')).toBe(true);
    expect(ps.map(p => JSON.stringify(p.arc))).toEqual(arcs);                    // every piece kept its arc
    const got = ps.map(px);
    // sizes are the ring's at the HUD's own size, to a tenth of a pixel
    got.forEach((g, i) => { expect(Math.abs(g[2] - want[i][2]), ps[i].part).toBeLessThan(0.11); expect(Math.abs(g[3] - want[i][3]), ps[i].part).toBeLessThan(0.11); });
    // and the pieces sit where they sit relative to each other: one ring
    got.forEach((g, i) => { expect(Math.abs((g[0] - got[0][0]) - (want[i][0] - want[0][0])), ps[i].part).toBeLessThan(0.11); expect(Math.abs((g[1] - got[0][1]) - (want[i][1] - want[0][1])), ps[i].part).toBeLessThan(0.11); });
  });
  it('a group already drawn as the ring keeps the ring\'s size when told Ring arc again', () => {
    const { bulkSet, bulkPatch } = env(), ps = ringPieces();
    ps.forEach(p => { p.x *= 1; });
    const before = ps.map(px);
    bulkSet(ps, bulkPatch('mode', 'seg'));
    ps.map(px).forEach((g, i) => before[i].forEach((n, j) => expect(Math.abs(g[j] - n), ps[i].part + j).toBeLessThan(0.2)));
  });
  it('pieces with no arc of their own share the circle: distinct arcs, one radius, round the whole way', () => {
    const { bulkSet, bulkPatch } = env(), ps = barPieces(5);
    expect(bulkSet(ps, bulkPatch('mode', 'seg'))).toEqual({ changed: 5, skipped: 0 });
    expect(ps.every(p => p.mode === 'seg' && p.arc)).toBe(true);
    const arcs = ps.map(p => p.arc).sort((a, b) => a.a0 - b.a0);
    expect(new Set(arcs.map(a => a.r)).size).toBe(1);
    arcs.forEach((a, i) => { if (i) expect(a.a0).toBeGreaterThan(arcs[i - 1].a1); });
    expect(arcs[0].a0).toBeLessThan(5); expect(arcs[4].a1).toBeGreaterThan(355);
    // each box is its arc's, on the screen, and the group is centred where it was
    ps.forEach(p => { const b = W.segBox(p.arc); expect(p.w / p.h).toBeCloseTo(b[2] / b[3], 1); });
    const x0 = Math.min(...ps.map(p => p.x * 1600)), x1 = Math.max(...ps.map(p => p.x * 1600 + p.w));
    expect(Math.abs((x0 + x1) / 2 - (0.1 * 1600 + 220 / 2))).toBeLessThan(60);
  });
  it('ringArcs: n equal sectors from 12 o\'clock, a gap between, the bottom half read the other way round', () => {
    const four = W.ringArcs(4);
    expect(four.map(a => [a.a0, a.a1])).toEqual([[2, 88], [92, 178], [182, 268], [272, 358]]);
    expect(four.map(a => !!a.below)).toEqual([false, true, true, false]);
    expect(W.ringArcs(1)).toHaveLength(1);
    expect(W.ringArcs(0)).toHaveLength(1);
    expect(W.ringArcs(500)).toHaveLength(60);
    expect(W.ringArcs(3).map(a => a.r)).toEqual([172, 172, 172]);
  });
  it('a locked piece takes its arc but keeps its box', () => {
    const { bulkSet, bulkPatch } = env(), ps = barPieces(3);
    ps[1].lock = true;
    const before = px(ps[1]);
    bulkSet(ps, bulkPatch('mode', 'seg'));
    expect(ps[1].mode).toBe('seg'); expect(ps[1].arc).toBeTruthy();
    expect(px(ps[1])).toEqual(before);
    expect(px(ps[0])).not.toEqual([160, 100, 220, 34]);
  });
  it('coming back from Ring arc to a bar gives the piece a bar\'s width, not the arc\'s sliver', () => {
    const { bulkSet, bulkPatch } = env(), ps = ringPieces();
    bulkSet(ps, bulkPatch('mode', 'bar'));
    const bars = ps.filter(p => p.mode === 'bar');
    expect(bars.map(p => p.part)).toEqual(expect.arrayContaining(['target.hp', 'me.hp', 'me.mana']));
    expect(bars.every(p => p.w >= 220)).toBe(true);
  });
  it('Left, Center, Right and the label turn reach every piece in the group (the turn only where there is a label to turn)', () => {
    const { bulkSet, bulkPatch } = env();
    const ps = [{ id: 'a', kind: 'part', part: 'me.hp', mode: 'vbar', x: 0, y: 0, w: 40, h: 120 }, { id: 'b', kind: 'part', part: 'me.mana', mode: 'bar', x: 0, y: 0, w: 220, h: 34 }];
    bulkSet(ps, bulkPatch('align', 'left')); expect(ps.map(p => p.align)).toEqual(['l', 'l']);
    bulkSet(ps, bulkPatch('align', 'c')); expect(ps.map(p => p.align)).toEqual(['c', 'c']);
    bulkSet(ps, bulkPatch('align', 'r')); expect(ps.map(p => p.align)).toEqual(['r', 'r']);
    bulkSet(ps, bulkPatch('rot', 'ccw')); expect(ps.map(p => p.rot)).toEqual(['ccw', undefined]);
    bulkSet(ps, bulkPatch('rot', 'nonsense')); expect(ps[0].rot).toBe('');
  });
});

describe('a layout written for a file never carries Left (the file format does not know it)', () => {
  it('main.js turns a Left into the plain default before the portable export reads the layout', () => {
    const main = stripJs(readSource(mimic('main.js')));
    expect(main).toContain("const noLeft = kept.map(p => (p && p.align === 'l') ? Object.assign({}, p, { align: '' }) : p);");
    expect(main).toContain('{ panels: noLeft }');
  });
});
