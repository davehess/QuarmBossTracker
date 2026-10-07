// test/canvas-ring-pieces.test.js — the HUD ring "as pieces" is the ONE ring, every arc a piece (FB-64, Mimic 3.0 alpha).
//
// A member, 3.0.0-alpha.927, 2026-10-07 (FB-64): "Alpha HUD (ring) as is vs as pieces is sending a bunch of
// individual rings, rather than the one big ring." The chooser's "as pieces" chip on HUD (ring) laid out six
// separate 96×96 dials (me.hp, me.mana, target.hp, tick, swing, cast) in a 3×2 grid plus three text rows —
// nothing of the ring's geometry. Now each arc of me.html's circle is a Ring arc piece (mode 'seg') whose SVG
// is that arc's box IN THE RING'S SPACE (400×400, centre 200,200), and the canvas places the pieces at the
// ring's size "as is" has, centred as "as is" is: the same ring until a piece is moved.
//
// parts.js and canvas.html's own functions run for real (the other canvas tests' slicing); me.html is read
// for its arcD and for the numbers its renderHud draws each arc with, so the pieces cannot drift from the ring.
//
// Run: npx vitest run test/canvas-ring-pieces.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, evalBlock, stripJs, stripCss, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const mimic = (f) => path.join(ROOT, 'apps', 'mimic', f);
const canvas = readSource(mimic('canvas.html'));
const meHtml = readSource(mimic('me.html'));
const rules = sliceBlock(canvas, '  var GROUPS = [', '  // ── Panels ──');
const slice = (start, end = '\n  }\n') => sliceBlock(canvas, start, end);

let W, arcD;
beforeAll(() => {
  globalThis.window = globalThis;
  require(mimic('parts.js'));
  W = globalThis.WpParts;
  // The ring's own arc maker, straight from the HUD page.
  ({ arcD } = evalBlock(sliceBlock(meHtml, '  var CX = 200, CY = 200;', "f1(p1[0]) + ' ' + f1(p1[1]);\n  }\n"), ['arcD']));
});

const ringPreset = () => W.PRESETS.find(p => p.id === 'hud-ring');
const rowOf = (id) => ringPreset().parts.find(r => r[0] === id);
const arcOf = (id) => rowOf(id)[6].arc;
const sampleOf = (id, now = 1_000_000) => { const d = W.byId[id]; return typeof d.sample === 'function' ? d.sample(now) : d.sample; };
const draw = (id, view, opts = {}, now = 1_000_000) => W.render(W.byId[id], 'seg', view === undefined ? sampleOf(id, now) : view, now, { arc: arcOf(id), uid: 'q' + id.replace(/\W/g, ''), ...opts });
// Every "M x y A r r 0 f s x y" path in some drawn HTML, as { r, from: [x, y], to: [x, y], d }.
const arcsIn = (html) => [...html.matchAll(/ d="(M([-\d.]+) ([-\d.]+) A([-\d.]+) [-\d.]+ 0 [01] [01] ([-\d.]+) ([-\d.]+))"/g)]
  .map(m => ({ d: m[1], r: +m[4], from: [+m[2], +m[3]], to: [+m[5], +m[6]] }));
const viewBoxOf = (html) => html.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);

describe('HUD (ring) as pieces — the rows in parts.js', () => {
  it('are the ring\'s arcs, not dials: every row is a Ring arc with its place on the circle', () => {
    const g = ringPreset();
    expect(g.ring).toBe(W.RING);
    expect(W.RING).toBe(400);
    expect(g.parts.map(r => r[0])).toEqual(['target.hp', 'target.tot', 'target.slow', 'me.hp', 'me.mana', 'me.end',
      'tick.server', 'tick.swing', 'me.cast', 'me.cooldowns']);
    for (const r of g.parts) {
      expect(r[1], r[0]).toBe('seg');
      expect(r[6].arc, r[0]).toMatchObject({ r: expect.any(Number), a0: expect.any(Number), a1: expect.any(Number) });
      // and the row's box is the arc's own box in the ring's space
      expect(r.slice(2, 6), r[0]).toEqual(W.segBox(r[6].arc));
    }
    // the old shape: six separate 96-square dials and three text rows
    expect(g.parts.some(r => r[1] === 'ring' || r[4] === 96 || r[1] === 'readout' || r[1] === 'chips')).toBe(false);
  });
  it('the six bars sit on ONE circle (radius 172); every other arc is concentric inside or just outside it', () => {
    for (const id of ['target.hp', 'me.hp', 'me.mana', 'tick.server', 'tick.swing', 'me.cast']) expect(arcOf(id).r, id).toBe(172);
    for (const r of ringPreset().parts) expect(r[6].arc.r, r[0]).toBeGreaterThan(140);
    for (const r of ringPreset().parts) expect(r[6].arc.r, r[0]).toBeLessThan(195);
  });
  it('every arc is where me.html\'s renderHud draws it (so the pieces cannot drift from the ring)', () => {
    const hud = stripJs(meHtml);
    expect(hud).toContain("h = '', R = 172;");
    const has = (s) => expect(hud, s).toContain(s);
    let a = arcOf('target.hp');  has(`gauge(R, ${a.a0}, ${a.a1}, d.t.hp == null`);  has('var nameR = R + 5;'); expect([a.r, a.lr]).toEqual([172, 177]);
    a = arcOf('me.hp');          has(`gauge(R, ${a.a0}, ${a.a1}, d.hp == null`);    has(`ringLabel('hhp', R + 10, ${a.a0}, ${a.a1}`); expect([a.r, a.lr]).toEqual([172, 182]);
    a = arcOf('me.mana');        has(`gauge(R, ${a.a0}, ${a.a1}, d.right.pct / 100, d.right.color, 6 * W, true)`); has(`ringLabel('hrt', R + 10, ${a.a0}, ${a.a1}`);
    expect([a.r, a.lr, a.rev]).toEqual([172, 182, true]);
    a = arcOf('me.end');         has(`gauge(R - 10, ${a.a0}, ${a.a1}, d.end / 100`); expect(a.r).toBe(162);
    a = arcOf('tick.server');    has(`[tk, 'htk', ${a.a0}, ${a.a1}, 'tick']`);       has('ringLabel(b[1], R + 15, b[2], b[3]'); expect([a.r, a.lr, a.below]).toEqual([172, 187, true]);
    a = arcOf('tick.swing');     has(`[sw, 'hsw', ${a.a0}, ${a.a1}, 'swing']`);      expect([a.r, a.lr, a.below]).toEqual([172, 187, true]);
    // the cast bar takes the swing bar's place (the game pauses the swing for a cast)
    expect(arcOf('me.cast')).toEqual(arcOf('tick.swing'));
    a = arcOf('me.cooldowns');   has('gauge(150, c0, c1'); has("ringLabel('hcd' + i, 165, c0, c1"); has('(80 - gap * (cds.length - 1))');
    expect([a.r, a.lr, a.a0, a.a1, a.below]).toEqual([150, 165, 140, 220, true]);
    // the default 'thin' line weight (6 / 4 / 2 × 0.55)
    has('HUD_WEIGHTS = { thin: 0.55');
    expect(arcOf('me.hp').w).toBeCloseTo(6 * 0.55, 6);
    expect(arcOf('tick.swing').w).toBeCloseTo(4 * 0.55, 6);
    expect(arcOf('me.end').w).toBeCloseTo(2 * 0.55, 6);
  });
});

describe('a Ring arc piece draws its arc as the ring does', () => {
  it('its box is the arc\'s box in the ring\'s space, whatever panel it sits in — and every point of the arc is inside it', () => {
    for (const r of ringPreset().parts) {
      const a = r[6].arc, [x, y, w, h] = W.segBox(a);
      expect(viewBoxOf(draw(r[0])), r[0]).toEqual([x, y, w, h]);
      // sample the bar's edges and the label's reach, densely: all inside the box ...
      const pts = [];
      for (let d = a.a0; d <= a.a1 + 1e-9; d += 0.5) {
        // (the label's reach: letters 0.8 em tall from its baseline, outward — or inward along the bottom, plus a descender)
        for (const rad of [a.r - a.w / 2, a.r + a.w / 2, a.lr - (a.below ? 0.8 : 0) * a.ls, a.lr + (a.below ? 0.25 : 0.8) * a.ls]) {
          const t = (d - 90) * Math.PI / 180; pts.push([200 + rad * Math.cos(t), 200 + rad * Math.sin(t)]);
        }
      }
      for (const [px, py] of pts) {
        expect(px, r[0]).toBeGreaterThanOrEqual(x); expect(px, r[0]).toBeLessThanOrEqual(x + w);
        expect(py, r[0]).toBeGreaterThanOrEqual(y); expect(py, r[0]).toBeLessThanOrEqual(y + h);
      }
      // ... and it is not bigger than that plus its small margin
      expect(Math.min(...pts.map(q => q[0])) - x, r[0]).toBeLessThan(5);
      expect(x + w - Math.max(...pts.map(q => q[0])), r[0]).toBeLessThan(5);
      expect(Math.min(...pts.map(q => q[1])) - y, r[0]).toBeLessThan(5);
      expect(y + h - Math.max(...pts.map(q => q[1])), r[0]).toBeLessThan(5);
    }
  });
  it('the bar\'s track and fill are me.html\'s own arcs (a gauge fills from a0; the right arc fills from a1 back)', () => {
    const hp = arcOf('me.hp');
    const paths = arcsIn(draw('me.hp', { pct: 84, text: '3,512 / 4,180', color: '#56d364' }));
    expect(paths[0].d).toBe(arcD(172, 236, 304));                          // track
    expect(paths[1].d).toBe(arcD(172, 236, 236 + (hp.a1 - hp.a0) * 0.84)); // fill
    expect(paths[2].d).toBe(arcD(182, 236, 304, false));                   // the label's path, outside the bar
    const mana = arcOf('me.mana'), mp = arcsIn(draw('me.mana', { pct: 25, color: '#58a6ff' }));
    expect(mp[0].d).toBe(arcD(172, 56, 124));
    expect(mp[1].d).toBe(arcD(172, 124 - (mana.a1 - mana.a0) * 0.25, 124));
    // the bottom bars read upright: their label path runs the other way round
    const tk = arcsIn(draw('tick.server', { endAt: 1_003_000, period: 6000, label: 'Tick', color: '#8b949e' }));
    expect(tk[2].d).toBe(arcD(187, 184, 228, true));
  });
  it('a full-circle check: every arc a piece draws is a circle about the ring\'s centre (200,200) of the radius it names', () => {
    for (const r of ringPreset().parts) {
      for (const p of arcsIn(draw(r[0]))) {
        for (const [px, py] of [p.from, p.to]) expect(Math.hypot(px - 200, py - 200), r[0]).toBeCloseTo(p.r, 0);
      }
    }
  });
  it('the cooldown arc is up to five segments about 6 o\'clock, the way the HUD cuts them', () => {
    const cd = arcsIn(draw('me.cooldowns'));   // the sample: MEND ready, FD cooling
    // me.html: seg = min(20, (80 - 2·(n-1)) / n); c1 starts at 180 + (seg·n + gap·(n-1)) / 2 and steps back by seg + 2
    expect(cd[0].d).toBe(arcD(150, 181, 201));   // MEND, ready: a solid segment
    expect(cd.find(p => p.d === arcD(150, 159, 179))).toBeTruthy();   // FD's track
    const html = draw('me.cooldowns');
    expect(html).toContain('MEND ✓');
    expect(html).toContain('FD 0:07');
    // more than five are cut at five, like the HUD's slice(0, 5)
    const seven = { items: Array.from({ length: 7 }, (_, i) => ({ name: 'Skill' + i, text: '0:0' + i, color: '#ffa657', frac: 0.5 })) };
    expect(draw('me.cooldowns', seven).match(/<textPath/g)).toHaveLength(5);
  });
  it('words only for a value (the target\'s target, its slow): a label along the ring and no bar', () => {
    const html = draw('target.slow');
    expect(html).toContain('slowed 75%');
    expect(html).not.toContain('stroke-width=');
    expect(arcsIn(html)).toHaveLength(1);   // just the path the words follow
  });
  it('label, thickness and colour are the piece\'s own options; nothing to show draws nothing', () => {
    expect(draw('me.hp', undefined, { nolabel: true })).not.toContain('<text');
    expect(draw('me.hp')).toContain('<text');
    const w = (o) => +draw('me.hp', undefined, o).match(/stroke-width="([\d.]+)"/)[1];
    expect(w({ thick: 'thin' })).toBeLessThan(w({}));
    expect(w({ thick: 'thick' })).toBeGreaterThan(w({}));
    expect(draw('me.hp', undefined, { color: '#a371f7' })).toContain('stroke="#a371f7"');
    expect(draw('tick.swing', null)).toBe('<div class="pt pt-none pt-seg"></div>');
  });
  it('two pieces never share a label path id (they are in one document), and the id is stable between paints', () => {
    const a = draw('tick.swing', undefined, { uid: 'qa1' }), b = draw('me.cast', undefined, { uid: 'qb2' });
    const ida = a.match(/<path id="([^"]+)"/)[1], idb = b.match(/<path id="([^"]+)"/)[1];
    expect(ida).not.toBe(idb);
    expect(draw('tick.swing', undefined, { uid: 'qa1' })).toBe(a);
  });
  it('a Ring arc is a way to draw any piece (kinds: gauge, countdown, value, list), with a default arc when it has none', () => {
    for (const k of ['gauge', 'countdown', 'value', 'list']) expect(W.MODES[k].map(m => m[0]), k).toContain('seg');
    for (const d of W.PARTS) {
      const s = typeof d.sample === 'function' ? d.sample(1_000_000) : d.sample;
      const html = W.render(d, 'seg', s, 1_000_000, { uid: 'x' + d.id });
      expect(html, d.id).toMatch(/^<div class="pt pt-seg"><svg viewBox="[-\d. ]+"/);
    }
    const [, , w, h] = W.segBox(null);
    expect(W.DEFAULT_SIZE.seg[0] / W.DEFAULT_SIZE.seg[1]).toBeCloseTo(w / h, 1);
  });
  it('an arc from a saved layout is cleaned: not an arc is null, numbers are clamped inside the ring', () => {
    expect(W.cleanArc(null)).toBeNull();
    expect(W.cleanArc('172')).toBeNull();
    expect(W.cleanArc({ r: 172 })).toBeNull();
    expect(W.cleanArc({ r: 'x', a0: 0, a1: 10 })).toBeNull();
    const c = W.cleanArc({ r: 9999, a0: -99999, a1: 99999, w: 500, ls: 0, lr: 5, evil: '<script>' });
    expect(c).toEqual({ r: 198, a0: -360, a1: 0, w: 24, ls: 4, lr: 20, rev: false, below: false });
    expect(W.cleanArc({ r: 100, a0: 50, a1: 10 }).a1).toBeGreaterThan(50);   // never backwards
    expect(W.cleanArc({ r: 100, a0: 0, a1: 90 })).toEqual({ r: 100, a0: 0, a1: 90, w: 3.3, ls: 11, lr: 110, rev: false, below: false });
  });
});

// ── The canvas lays the pieces out as the ring ──────────────────────────────
describe('choosing HUD (ring) "as pieces" lays out the one ring', () => {
  const OVS = [{ key: 'me', label: 'HUD', src: 'me.html', w: 330, h: 300 }];
  function env(Wpx = 1920, Hpx = 1080) {
    return evalBlock('var window = { innerWidth: ' + Wpx + ', innerHeight: ' + Hpx + ', WpParts: WpParts }; var _fitAdd = {}; var _cascade = 0; var notes = [];\n'
      + 'var _groups = [], M = {}, _sel = {};\n'
      + 'function note(m) { notes.push(m); } function refresh() {} function save() {} function render() {}\n'
      + 'function savedById() { return null; } function sectPanel() { return null; }\n'
      + rules + '\n'
      + slice('  function addOverlay(o, n) {') + '\n' + slice('  function embedSize(o, style) {') + '\n' + slice('  function dropEmbed(g, X, Y, clicked) {') + '\n'
      + slice('  function newId(prefix) {', '.slice(0, 24); }') + '\n' + slice('  function addPart(pid, mode, X, Y, grp, o) {') + '\n'
      + slice('  function placeGroup(pieces, X, Y) {') + '\n' + slice('  function presetPiece(a) {') + '\n' + slice('  function ringPiece(a, k) {') + '\n'
      + slice('  function presetById(id)', 'return null; }') + '\n' + slice('  function dropThing(what, X, Y) {') + '\n'
      + slice('  function saveSelectionAsGroup(name) {')
      + '\nfunction __setOv(o) { _overlays = o; } function __sel(ids) { _sel = {}; ids.forEach(function (i) { _sel[i] = true; }); } function __groups() { return _groups; }',
    ['dropThing', 'addPart', 'placeGroup', '_layout', 'sanitize', 'saveSelectionAsGroup', '__setOv', '__sel', '__groups', 'notes']);
  }
  const parts = (r) => r._layout.panels.filter(p => p.kind === 'part');

  // The ring "as is" is a panel the size of the ring's square (half the screen's short side), centred on the
  // drop. For every piece: where does it put the ring's centre, at what scale, and do its arcs land on the circle?
  function check(r, Wpx, Hpx, cx, cy) {
    const S = Math.round(Math.min(Wpx, Hpx) * 0.5), k = S / 400, ps = parts(r);
    expect(ps).toHaveLength(10);
    expect(new Set(ps.map(p => p.grp)).size).toBe(1);   // one group: Ctrl-drag moves the ring, a plain drag pulls one arc out
    expect(ps[0].grp).toMatch(/^g/);
    let l = Infinity, t = Infinity, rt = -Infinity, b = -Infinity;
    for (const p of ps) {
      expect(p.mode, p.part).toBe('seg');
      const vb = W.segBox(p.arc), px = p.x * Wpx, py = p.y * Hpx;
      // one scale for every piece: the ring's
      expect(p.w / vb[2], p.part).toBeCloseTo(k, 2);
      expect(p.h / vb[3], p.part).toBeCloseTo(k, 2);
      // and each puts the ring's centre (200,200) on the one point
      expect(px + (200 - vb[0]) * p.w / vb[2], p.part).toBeCloseTo(cx, 0);
      expect(py + (200 - vb[1]) * p.h / vb[3], p.part).toBeCloseTo(cy, 0);
      // every arc it draws, on the screen: a circle about that centre of the radius × the ring's scale
      const html = W.render(W.byId[p.part], 'seg', typeof W.byId[p.part].sample === 'function' ? W.byId[p.part].sample(1) : W.byId[p.part].sample, 1, { arc: p.arc, uid: p.id });
      const arcs = arcsIn(html);
      expect(arcs.length, p.part).toBeGreaterThan(0);
      for (const a of arcs) for (const [ax, ay] of [a.from, a.to]) {
        const X = px + (ax - vb[0]) * p.w / vb[2], Y = py + (ay - vb[1]) * p.h / vb[3];
        // the same point "as is" draws: the ring's square, from its top-left, scaled
        expect(X, p.part).toBeCloseTo(cx - S / 2 + ax * k, 0);
        expect(Y, p.part).toBeCloseTo(cy - S / 2 + ay * k, 0);
        expect(Math.hypot(X - cx, Y - cy), p.part).toBeCloseTo(a.r * k, 0);
      }
      l = Math.min(l, px); t = Math.min(t, py); rt = Math.max(rt, px + p.w); b = Math.max(b, py + p.h);
    }
    // together they span the ring (the old dials spanned 296 px)
    expect(rt - l).toBeGreaterThan(0.9 * S);
    expect(b - t).toBeGreaterThan(0.85 * S);
    expect(l).toBeGreaterThan(cx - S / 2 - 1);
    expect(rt).toBeLessThan(cx + S / 2 + 1);
    return S;
  }

  it('dragged onto the screen: ten pieces on one circle, centred on the drop, at the size "as is" gives the ring', () => {
    const r = env(); r.__setOv(OVS);
    r.dropThing('preset:hud-ring:pieces', 1000, 600);
    expect(check(r, 1920, 1080, 1000, 600)).toBe(540);
  });
  it('clicked in (no drag): the middle of the screen, as the ring "as is" lands', () => {
    const r = env(); r.__setOv(OVS);
    r.dropThing('preset:hud-ring:pieces', null, null);
    check(r, 1920, 1080, 960, 540);
  });
  it('on a smaller screen the ring is smaller and the pieces follow it', () => {
    const r = env(1280, 720); r.__setOv(OVS);
    r.dropThing('preset:hud-ring:pieces', 700, 380);
    expect(check(r, 1280, 720, 700, 380)).toBe(360);
  });
  it('the ring "as is" is unchanged: one panel of the HUD page in its ring look, no pieces — at the same centre', () => {
    const r = env(); r.__setOv(OVS);
    r.dropThing('preset:hud-ring', 1000, 600);
    const ov = r._layout.panels.filter(p => p.kind === 'overlay');
    expect(parts(r)).toHaveLength(0);
    expect(ov).toHaveLength(1);
    expect(ov[0]).toMatchObject({ key: 'me', style: 'hud', name: 'HUD (ring)', w: 540, h: 540 });
    // the centre the pieces share is this panel's centre
    expect(ov[0].x * 1920 + ov[0].w / 2).toBeCloseTo(1000, 0);
    expect(ov[0].y * 1080 + ov[0].h / 2).toBeCloseTo(600, 0);
  });
  it('and when the HUD is not in the overlay list yet, "as is" falls back to the same pieces', () => {
    const r = env();   // no overlays loaded
    r.dropThing('preset:hud-ring', 1000, 600);
    expect(parts(r)).toHaveLength(10);
    check(r, 1920, 1080, 1000, 600);
  });
  it('another overlay "as pieces" is the stack it was: the rows as written, none of it moved or scaled', () => {
    const r = env(); r.__setOv(OVS);
    r.dropThing('preset:tank:pieces', 100, 200);
    const tank = W.PRESETS.find(g => g.id === 'tank'), ps = parts(r);
    expect(ps).toHaveLength(tank.parts.length);
    expect(ps[0]).toMatchObject({ part: 'tank.mt', mode: 'bar', x: 100 / 1920, y: 200 / 1080, arc: null });
    expect(ps[1].y * 1080).toBeCloseTo(200 + tank.parts[1][3], 3);
    expect(ps.every(p => p.arc === null)).toBe(true);
  });
  it('a saved layout keeps an arc, cleaned; a piece in another mode keeps none', () => {
    const r = env();
    const s = r.sanitize({ panels: [
      { id: 'a', kind: 'part', part: 'me.hp', mode: 'seg', x: 0.2, y: 0.2, w: 80, h: 200, arc: { r: 172, a0: 236, a1: 304, lr: 182 } },
      { id: 'b', kind: 'part', part: 'me.hp', mode: 'seg', x: 0.2, y: 0.2, w: 80, h: 200, arc: { r: 9999, a0: 'north', a1: 3 } },
      { id: 'c', kind: 'part', part: 'me.hp', mode: 'bar', x: 0.2, y: 0.2, w: 80, h: 20 },
    ] });
    const ps = s.panels.filter(p => p.kind === 'part');
    expect(ps[0].arc).toMatchObject({ r: 172, a0: 236, a1: 304, lr: 182 });
    expect(ps[1].arc).toBeNull();
    expect(ps[2].arc).toBeNull();
  });
  it('saved as a group, the ring comes back as the same ring (every arc kept)', () => {
    const r = env(); r.__setOv(OVS);
    r.dropThing('preset:hud-ring:pieces', 1000, 600);
    const first = parts(r);
    r.__sel(first.map(p => p.id));
    r.saveSelectionAsGroup('My ring');
    const g = r.__groups()[0];
    expect(g.parts).toHaveLength(10);
    expect(g.parts.map(q => q.arc)).toEqual(first.map(p => p.arc));
    r.placeGroup(g.parts, 300, 100);
    const second = parts(r).slice(10);
    expect(second.map(p => p.arc)).toEqual(first.map(p => p.arc));
    expect(second.map(p => [p.w, p.h])).toEqual(first.map(p => [p.w, p.h]));
  });
});

describe('the canvas paints and edits a Ring arc', () => {
  const c = stripJs(canvas);
  it('paintParts hands each piece its arc and its own id (so two never share a label path)', () => {
    const panels = [
      { id: 'q1', kind: 'part', part: 'me.hp', mode: 'seg', arc: arcOf('me.hp') },
      { id: 'q2', kind: 'part', part: 'me.mana', mode: 'seg', arc: arcOf('me.mana') },
      { id: 'q3', kind: 'part', part: 'me.hp', mode: 'bar', arc: null },
    ];
    const els = Object.fromEntries(panels.map(p => [p.id, { root: { classList: { toggle() {} } }, body: {} }]));
    const run = new Function('WpParts', 'panels', 'els',
      'var window = { WpParts: WpParts }; var _layout = { panels: panels }; var _els = els; var _edit = true;\n'
      + 'function partDef(p) { return WpParts.byId[p.part] || null; } function viewFor() { return null; }\n'
      + 'function sampleFor(d, now) { return typeof d.sample === "function" ? d.sample(now) : d.sample; }\n'
      + 'function setBody(e, html) { e.html = html; }\n'
      + slice('  function paintParts(onlySrc) {') + '\npaintParts();');
    run(W, panels, els);
    expect(els.q1.html).toContain('viewBox="' + W.segBox(arcOf('me.hp')).join(' ') + '"');
    expect(els.q1.html).toContain('<path id="sgq1"');
    expect(els.q2.html).toContain('<path id="sgq2"');
    expect(els.q3.html).toContain('class="pt pt-bar"');   // any other mode is drawn as it was
  });
  it('a Ring arc fills its panel to the edge (no padding or border), so the arcs of one ring line up', () => {
    expect(stripCss(canvas)).toContain('.panel.part.seg > .pbody,.panel.part.seg.back > .pbody{padding:0}');
    expect(stripCss(canvas)).toContain('.panel.part.seg.back > .pbody{border:0}');
    expect(c).toContain("e.root.classList.toggle('seg', p.mode === 'seg');");
  });
  it('switching a piece to Ring arc gives it a ring\'s shape and does not fit it to its text', () => {
    expect(c).toMatch(/nm === 'seg' \|\| p\.mode === 'seg';/);
    expect(c).toContain("seg: '◜'");
  });
});
