// test/canvas-parity.test.js — a Canvas frame has the controls an overlay's own window has (Mimic 3.0 Canvas).
//
// The guild lead, 2026-10-21: "Canvas frames need the resizing, basically all of the options that we have from
// the normal overlays need to be present for these." The report: Charm tracker as a Canvas frame, its "Best pets
// here" list cutting names to "a C…" because the frame was too narrow and could not be sized or adjusted the way
// the standalone Charm overlay can.
//
// What is held here (each one run for real, against fakes, so a comment cannot satisfy it):
//   • the XS … XL width presets are ONE table (overlaySizes.js) read by the window's menu handler in main.js and
//     by the Canvas's Width row, and the labels preload.js draws still say the same numbers;
//   • Width / Height by number, in 20 px steps and by preset, saved on the item (an overlay, a countdown panel, a
//     piece cut from a page — which sizes its PAGE width), refused while 🔒 locked, never for a data piece or the
//     HUD's ring; a height grows toward the edge the item grows from, and a height set by hand turns Fit height off;
//   • the right and bottom EDGES size one direction each, through the real startDrag → mousemove → endDrag;
//   • ↔ Fit width: the page is laid out wider until nothing it cuts short with "…" is cut short, never narrower,
//     and a box with a width of its own does not make it run away;
//   • Opacity per item (saved only below solid), ▭ Mini mode for a frame (the overlay's own setting, hosted), and
//     the page's OWN options (a setup-bar control marked data-wp-opt) reachable from ⚙;
//   • the ⚙ menu's clicks reach all of it (the real click handler), text size still works on a locked item.
//
// Run: npx vitest run test/canvas-parity.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, evalBlock, stripJs, stripCss, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const mimic = (f) => path.join(ROOT, 'apps', 'mimic', f);
const canvas = readSource(mimic('canvas.html'));
const main = readSource(mimic('main.js'));
const preload = readSource(mimic('preload.js'));
const c = stripJs(canvas);
const slice = (start, end = '\n  }\n') => sliceBlock(canvas, start, end);
const SIZES = require(mimic('overlaySizes.js'));

beforeAll(() => {
  globalThis.window = globalThis;
  globalThis.innerWidth = 1920; globalThis.innerHeight = 1080;
  require(mimic('parts.js'));
  require(mimic('sections.js'));
  globalThis.WpSizes = SIZES;
});

// ── the canvas's own helpers, sliced: the lock helpers through the new Size block ────────────────────────────
const NUM = 'function num(v, lo, hi, d) { v = Number(v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; }\n'
  + 'function pdefOf() { return null; }\n';
const SIZE_BLOCK = slice('  function isLocked(q)', '  // ── end Size ──') + '\n';
const NAMES = ['isLocked', 'setLock', 'growsUp', 'fitOn', 'sizable', 'widthOf', 'widthRange', 'setWidth', 'setHeight',
  'alphaOf', 'cleanAlpha', 'stepAlpha', 'cutShort'];
const H = () => evalBlock(NUM + SIZE_BLOCK, NAMES);

// ── the width table ─────────────────────────────────────────────────────────────────────────────────────
describe('the XS … XL presets are one table', () => {
  it('has the five widths the right-click menu has always had', () => {
    expect(SIZES.PRESETS.map(p => [p[0], p[2]])).toEqual([['xs', 200], ['sm', 260], ['md', 320], ['lg', 420], ['xl', 500]]);
    expect(SIZES.MIN_W).toBe(200);
  });
  it('widthOf reads a key in any case and answers 0 for a key that is not one', () => {
    expect(SIZES.widthOf('md')).toBe(320);
    expect(SIZES.widthOf('XL')).toBe(500);
    expect(SIZES.widthOf('huge')).toBe(0);
    expect(SIZES.widthOf(undefined)).toBe(0);
  });
  it('the window\'s overlay-resize-preset handler (real handler, fake window) gives each preset its width, keeps the height and the top-left, and refuses an unknown key', () => {
    globalThis.__sizesForTest = SIZES;
    const block = sliceBlock(main, "ipcMain.handle('overlay-resize-preset'", '\n});');
    const { run } = evalBlock(`
      const handlers = {};
      const ipcMain = { handle(n, f) { handlers[n] = f; } };
      const overlaySizes = globalThis.__sizesForTest;
      const win = { b: { x: 10, y: 20, width: 999, height: 333 }, isDestroyed() { return false; },
        getBounds() { return { ...this.b }; }, setBounds(n) { this.b = { ...n }; } };
      const BrowserWindow = { fromWebContents() { return win; } };
      ${block}
      function run(k) { const ok = handlers['overlay-resize-preset']({ sender: {} }, k); return { ok, b: { ...win.b } }; }
    `, ['run']);
    delete globalThis.__sizesForTest;
    for (const [k, w] of [['xs', 200], ['sm', 260], ['md', 320], ['lg', 420], ['xl', 500]]) {
      expect(run(k)).toEqual({ ok: true, b: { x: 10, y: 20, width: w, height: 333 } });
    }
    expect(run('nope').ok).toBe(false);
  });
  it('main.js uses it for the overlay minimum too, and the labels preload.js draws still say the same numbers', () => {
    expect(stripJs(main)).toMatch(/const _OVERLAY_MIN_W = overlaySizes\.MIN_W;/);
    const labels = [...preload.matchAll(/\['(xs|sm|md|lg|xl)','([A-Z]+) · (\d+)px/g)].map(m => [m[1], m[2], Number(m[3])]);
    expect(labels).toEqual(SIZES.PRESETS.map(p => [p[0], p[1], p[2]]));
  });
  it('the Canvas loads the table before its own script', () => {
    expect(canvas.indexOf('<script src="overlaySizes.js"></script>')).toBeGreaterThan(0);
    expect(canvas.indexOf('<script src="overlaySizes.js"></script>')).toBeLessThan(canvas.indexOf('var M = window.mimic'));
  });
});

// ── Width and Height by number ──────────────────────────────────────────────────────────────────────────────
describe('Width: a preset, a step, saved on the item', () => {
  const h = H();
  const charm = () => ({ id: 'a', kind: 'overlay', key: 'charm', x: 0.2, y: 0.2, w: 300, h: 180, scale: 1 });
  it('an overlay frame takes the preset as its box width (what the window does) and keeps its height', () => {
    const p = charm();
    expect(h.setWidth(p, SIZES.widthOf('lg'), 1920)).toBe(true);
    expect([p.w, p.h]).toEqual([420, 180]);
  });
  it('a countdown panel and a callouts panel take it too', () => {
    const t = { id: 't', kind: 'timers', x: 0.5, y: 0.5, w: 340, h: 200 };
    expect(h.setWidth(t, 500, 1920)).toBe(true);
    expect(t.w).toBe(500);
    const k = { id: 'k', kind: 'callouts', x: 0.3, y: 0.2, w: 720, h: 160 };
    h.setWidth(k, 260, 1920);
    expect(k.w).toBe(260);
  });
  it('a piece cut from a page sizes its PAGE width (its box follows the section), not its box', () => {
    const s = { id: 's', kind: 'sect', key: 'mobinfo', sect: 'hp', x: 0.1, y: 0.1, w: 200, h: 30, pw: 340, ph: 400 };
    expect(h.widthOf(s)).toBe(340);
    h.setWidth(s, 500, 1920);
    expect([s.pw, s.w]).toEqual([500, 200]);
  });
  it('stays inside what a hand drag allowed each kind: an overlay no narrower than 80, never wider than the screen', () => {
    const p = charm();
    h.setWidth(p, 10, 1000); expect(p.w).toBe(80);
    h.setWidth(p, 99999, 1000); expect(p.w).toBe(1000);
    const t = { id: 't', kind: 'timers', w: 340, h: 100 };
    h.setWidth(t, 10, 1920); expect(t.w).toBe(120);
    const s = { id: 's', kind: 'sect', pw: 340, w: 1, h: 1 };
    h.setWidth(s, 10, 1920); expect(s.pw).toBe(160);
    h.setWidth(s, 99999, 1920); expect(s.pw).toBe(2400);
  });
  it('a garbage width changes nothing', () => {
    const p = charm();
    h.setWidth(p, 'wide', 1920); expect(p.w).toBe(300);
  });
  it('a data piece is drawn, not framed, and the HUD\'s ring is a circle: neither takes a width', () => {
    const part = { id: 'q', kind: 'part', part: 'me.hp', w: 200, h: 30 };
    const ring = { id: 'r', kind: 'overlay', key: 'me', style: 'hud', w: 300, h: 300 };
    const box = { id: 'b', kind: 'overlay', key: 'me', style: 'a', w: 300, h: 200 };
    expect(h.setWidth(part, 420, 1920)).toBe(false);
    expect(h.setWidth(ring, 420, 1920)).toBe(false);
    expect([part.w, ring.w]).toEqual([200, 300]);
    expect(h.setWidth(box, 420, 1920)).toBe(true);
    expect(box.w).toBe(420);
  });
  it('🔒 a locked item refuses it (a hand change to size), and unlocking brings it back', () => {
    const p = Object.assign(charm(), { lock: true });
    expect(h.setWidth(p, 420, 1920)).toBe(false);
    expect(p.w).toBe(300);
    h.setLock([p], false);
    expect(h.setWidth(p, 420, 1920)).toBe(true);
    expect(p.w).toBe(420);
  });
});

describe('Height: by number, toward the edge the item grows from, and by hand it stops following its content', () => {
  const h = H();
  const H_SCREEN = 800;
  it('growing down keeps the top edge', () => {
    const p = { id: 'a', kind: 'overlay', key: 'charm', x: 0.2, y: 0.25, w: 300, h: 200 };   // top 200
    h.setHeight(p, 260, H_SCREEN);
    expect([p.h, p.y * H_SCREEN]).toEqual([260, 200]);
  });
  it('growing up keeps the bottom edge', () => {
    const p = { id: 'a', kind: 'overlay', key: 'charm', x: 0.2, y: 0.5, w: 300, h: 200, anchor: 'bottom' };   // top 400, bottom 600
    h.setHeight(p, 260, H_SCREEN);
    expect(p.h).toBe(260);
    expect(Math.round(p.y * H_SCREEN) + p.h).toBe(600);
  });
  it('a countdown panel grows up unless told otherwise, as it always has', () => {
    const p = { id: 't', kind: 'timers', x: 0.5, y: 0.5, w: 340, h: 200 };   // bottom 600
    h.setHeight(p, 300, H_SCREEN);
    expect(Math.round(p.y * H_SCREEN) + p.h).toBe(600);
  });
  it('a height set by hand turns Fit height off (the ◢ rule); the same height leaves it on', () => {
    const p = { id: 'a', kind: 'overlay', key: 'charm', x: 0.2, y: 0.2, w: 300, h: 200 };
    h.setHeight(p, 200, H_SCREEN);
    expect(p.fit).toBeUndefined();
    h.setHeight(p, 240, H_SCREEN);
    expect(p.fit).toBe(false);
  });
  it('is held to the screen and the same floor as the ◢', () => {
    const p = { id: 'a', kind: 'overlay', key: 'charm', x: 0.2, y: 0.2, w: 300, h: 200 };
    h.setHeight(p, 5, H_SCREEN); expect(p.h).toBe(36);
    h.setHeight(p, 99999, H_SCREEN); expect(p.h).toBe(800);
  });
  it('🔒 locked refuses it; a cut piece (its height is its section\'s) and a piece never take it', () => {
    const l = { id: 'a', kind: 'overlay', key: 'charm', x: 0.2, y: 0.2, w: 300, h: 200, lock: true };
    expect(h.setHeight(l, 300, H_SCREEN)).toBe(false);
    expect(l.h).toBe(200);
    expect(h.setHeight({ id: 's', kind: 'sect', h: 30, y: 0.1 }, 100, H_SCREEN)).toBe(false);
    expect(h.setHeight({ id: 'q', kind: 'part', h: 30, y: 0.1 }, 100, H_SCREEN)).toBe(false);
  });
});

// ── Opacity ─────────────────────────────────────────────────────────────────────────────────────────────
describe('Opacity: each item\'s own, stored only below solid', () => {
  const h = H();
  it('steps down 10% at a time to a floor of 15%, and back up to solid, which stores nothing', () => {
    const p = { id: 'a' };
    expect(h.alphaOf(p)).toBe(1);
    h.stepAlpha(p, -1); expect(p.alpha).toBe(0.9);
    for (let i = 0; i < 12; i++) h.stepAlpha(p, -1);
    expect(p.alpha).toBe(0.15);
    for (let i = 0; i < 12; i++) h.stepAlpha(p, 1);
    expect('alpha' in p).toBe(false);
    expect(h.alphaOf(p)).toBe(1);
  });
  it('cleanAlpha keeps a value in 15%..99% and drops everything else', () => {
    expect(h.cleanAlpha(0.5)).toBe(0.5);
    expect(h.cleanAlpha(0.15)).toBe(0.15);
    for (const v of [1, 0.1, 0, -1, 2, 'x', undefined, null]) expect(h.cleanAlpha(v)).toBeUndefined();
  });
  it('a saved layout keeps it for every kind and drops a bad one (the real sanitize)', () => {
    const block = sliceBlock(canvas, '  var GROUPS = [', '  // ── Panels ──');
    const { sanitize } = evalBlock('var window = {};\n' + block, ['sanitize']);
    const s = sanitize({ panels: [
      { id: 'o', kind: 'overlay', key: 'charm', x: 0.1, y: 0.1, w: 300, h: 200, alpha: 0.6 },
      { id: 's', kind: 'sect', key: 'mobinfo', sect: 'hp', x: 0.1, y: 0.1, w: 200, h: 30, alpha: 0.4 },
      { id: 'q', kind: 'part', part: 'me.hp', mode: 'bar', x: 0.1, y: 0.1, w: 200, h: 30, alpha: 0.3 },
      { id: 't', kind: 'timers', all: true, x: 0.5, y: 0.5, w: 300, h: 100, alpha: 0.8 },
      { id: 'u', kind: 'timers', all: false, x: 0.5, y: 0.5, w: 300, h: 100, alpha: 0.01 },
      { id: 'v', kind: 'timers', all: false, x: 0.5, y: 0.5, w: 300, h: 100, alpha: 1 },
      { id: 'w', kind: 'timers', all: false, x: 0.5, y: 0.5, w: 300, h: 100 },
    ] });
    const by = Object.fromEntries(s.panels.map(p => [p.id, p]));
    expect(['o', 's', 'q', 't'].map(k => by[k].alpha)).toEqual([0.6, 0.4, 0.3, 0.8]);
    for (const k of ['u', 'v', 'w']) expect('alpha' in by[k]).toBe(false);
  });
  it('the panel carries it as --pa, and the CSS fades what it shows and its plate but not the ✥ ◢ or tab', () => {
    expect(c).toMatch(/e\.root\.style\.setProperty\('--pa', String\(alphaOf\(p\)\)\);/);
    const css = stripCss(canvas);
    expect(css).toMatch(/\.panel > iframe,\.panel > \.pbody\{opacity:var\(--pa,1\)\}/);
    expect(c).toMatch(/e\.root\.classList\.toggle\('pfade', alphaOf\(p\) < 1\);/);
    expect(css).toMatch(/\.panel\.pfade\.back:not\(\.part\)\{background:rgb\(8 10 14 \/ calc\(max\(var\(--bg-alpha,0\.92\), 0\.92\) \* var\(--pa,1\)\)\)/);
    expect(css).not.toMatch(/\.panel\{[^}]*opacity:var\(--pa/);
  });
});

// ── ↔ Fit width ─────────────────────────────────────────────────────────────────────────────────────────
// A fake page: elements whose text is `text` px wide and whose box is the frame's width minus `other` (the
// rest of their row), or `fixed` (a box with a width of its own). text-overflow:ellipsis unless ell === false.
function fakePage(items, frameWidth) {
  const frame = { style: { width: frameWidth + 'px' } };
  const els = items.map(it => ({
    get scrollWidth() { return it.text; },
    get clientWidth() { return it.fixed != null ? it.fixed : Math.max(0, parseInt(frame.style.width, 10) - it.other); },
    ell: it.ell !== false,
  }));
  const win = { getComputedStyle: (el) => ({ textOverflow: el.ell ? 'ellipsis' : 'clip' }) };
  frame.contentDocument = { body: {}, querySelectorAll: () => els };
  frame.contentWindow = win;
  return { frame, win, doc: frame.contentDocument };
}

describe('cutShort: how much a page\'s "…" boxes still lack', () => {
  const h = H();
  it('is the widest shortfall among the boxes cut with an ellipsis', () => {
    // 260 of text in 180 of room lacks 80; 300 in 240 lacks 60; 90 in 180 lacks nothing
    const pg = fakePage([{ text: 260, other: 120 }, { text: 90, other: 120 }, { text: 300, other: 60 }], 300);
    expect(h.cutShort(pg.doc, pg.win)).toBe(80);
  });
  it('ignores a box that overflows without an ellipsis (a scroll box is not a cut name)', () => {
    const pg = fakePage([{ text: 500, other: 0, ell: false }], 300);
    expect(h.cutShort(pg.doc, pg.win)).toBe(0);
  });
  it('is 0 for a page that fits', () => {
    const pg = fakePage([{ text: 100, other: 120 }], 300);
    expect(h.cutShort(pg.doc, pg.win)).toBe(0);
  });
});

describe('↔ Fit width: wider until nothing is cut short, never narrower', () => {
  const fnBlock = slice('  function fitWidth(p, e, W) {');
  const make = (p, items, frameWidth) => {
    const pg = fakePage(items, frameWidth);
    const placed = [];
    const env = evalBlock(NUM + SIZE_BLOCK + 'var _fitAdd = { a: true };\n'
      + 'var placed = globalThis.__placed; function place(e, q) { placed.push([q.kind, q.w]); }\n' + fnBlock, ['fitWidth', '_fitAdd']);
    return { pg, placed, env };
  };
  const run = (p, items, frameWidth, W = 1920) => {
    globalThis.__placed = [];
    const m = make(p, items, frameWidth);
    // a countdown or callouts panel's page fills its box, so its root and its frame are one width
    const e = { frame: m.pg.frame, root: { style: (p.kind === 'timers' || p.kind === 'callouts') ? m.pg.frame.style : { width: '' } } };
    const ok = m.env.fitWidth(p, e, W);
    const out = { ok, frame: m.pg.frame.style.width, placed: globalThis.__placed.slice(), fitAdd: m.env._fitAdd };
    delete globalThis.__placed;
    return out;
  };
  it('Charm\'s "Best pets here": the frame grows by what the name lacked, and the name is whole', () => {
    const p = { id: 'a', kind: 'overlay', key: 'charm', x: 0.2, y: 0.2, w: 300, h: 180, scale: 1 };
    const r = run(p, [{ text: 260, other: 120 }], 300);   // 180 of room, 260 of name: lacks 80
    expect(r.ok).toBe(true);
    expect(p.w).toBe(382);          // 300 + 80 + a couple of px
    expect(r.placed.length).toBe(1);   // the real sizes put back before the new width is drawn
    expect(r.fitAdd.a).toBeUndefined();   // the first-add fit is over
  });
  it('an overlay is scaled as a whole: the page lays out at width ÷ scale, the shortfall is in page px', () => {
    const p = { id: 'a', kind: 'overlay', key: 'charm', x: 0.2, y: 0.2, w: 450, h: 180, scale: 1.5 };   // page width 300
    run(p, [{ text: 260, other: 120 }], 300);
    expect(p.w).toBe(Math.ceil(382 * 1.5));
  });
  it('a piece cut from a page widens its page width; a countdown panel its box', () => {
    const s = { id: 's', kind: 'sect', key: 'mobinfo', sect: 'name', x: 0.1, y: 0.1, w: 200, h: 30, pw: 300, ph: 400 };
    run(s, [{ text: 260, other: 120 }], 300);
    expect([s.pw, s.w]).toEqual([382, 200]);
    const t = { id: 't', kind: 'timers', x: 0.5, y: 0.5, w: 300, h: 100 };
    run(t, [{ text: 260, other: 120 }], 300);
    expect(t.w).toBe(382);
  });
  it('several cut boxes: it keeps widening until the last is whole', () => {
    const p = { id: 'a', kind: 'overlay', key: 'charm', x: 0.2, y: 0.2, w: 300, h: 180, scale: 1 };
    run(p, [{ text: 260, other: 120 }, { text: 330, other: 80 }], 300);
    // after 80 more: the first is whole (262 >= 260), the second lacks 330-262+... widened again
    const pg = fakePage([{ text: 260, other: 120 }, { text: 330, other: 80 }], p.w);
    expect(evalBlock(NUM + SIZE_BLOCK, ['cutShort']).cutShort(pg.doc, pg.win)).toBe(0);
  });
  it('only widens: a page that already shows everything keeps the width the raider chose', () => {
    const p = { id: 'a', kind: 'overlay', key: 'charm', x: 0.2, y: 0.2, w: 500, h: 180, scale: 1 };
    const r = run(p, [{ text: 100, other: 120 }], 500);
    expect(r.ok).toBe(true);
    expect(p.w).toBe(500);
  });
  it('...and not even by a pixel of rounding: 221 at 110% is 221 after, though 221 ÷ 1.1 × 1.1 is 221.00000000000003', () => {
    const p = { id: 'a', kind: 'overlay', key: 'charm', x: 0.2, y: 0.2, w: 221, h: 180, scale: 1.1 };
    run(p, [{ text: 100, other: 20 }], 201);
    expect(p.w).toBe(221);
  });
  it('a box with a width of its own (wider page does not help) is not chased: the width goes back', () => {
    const p = { id: 'a', kind: 'overlay', key: 'charm', x: 0.2, y: 0.2, w: 300, h: 180, scale: 1 };
    run(p, [{ text: 160, fixed: 100 }], 300);
    expect(p.w).toBe(300);
  });
  it('is held to the widest the item may be', () => {
    const p = { id: 'a', kind: 'overlay', key: 'charm', x: 0.2, y: 0.2, w: 300, h: 180, scale: 1 };
    run(p, [{ text: 5000, other: 120 }], 300, 700);
    expect(p.w).toBeLessThanOrEqual(700);
  });
  it('🔒 a locked item, a data piece and the ring are left alone', () => {
    const l = { id: 'a', kind: 'overlay', key: 'charm', x: 0.2, y: 0.2, w: 300, h: 180, scale: 1, lock: true };
    expect(run(l, [{ text: 260, other: 120 }], 300).ok).toBe(false);
    expect(l.w).toBe(300);
    const part = { id: 'q', kind: 'part', w: 200, h: 30 };
    expect(run(part, [{ text: 260, other: 120 }], 300).ok).toBe(false);
  });
  it('a page that has not loaded yet is not an error', () => {
    globalThis.__placed = [];
    const m = make({}, [], 300);
    const p = { id: 'a', kind: 'overlay', key: 'charm', x: 0.2, y: 0.2, w: 300, h: 180, scale: 1 };
    expect(m.env.fitWidth(p, { frame: { contentDocument: null, contentWindow: null }, root: { style: {} } }, 1920)).toBe(false);
    expect(m.env.fitWidth(p, { frame: null, root: { style: {} } }, 1920)).toBe(false);
    delete globalThis.__placed;
  });
});

// ── The edges, through the real drag ────────────────────────────────────────────────────────────────────
function makeWorld(specs) {
  const SCR = { w: 1000, h: 800 };
  const win = { innerWidth: SCR.w, innerHeight: SCR.h, addEventListener() {} };
  const panels = specs.map(s => Object.assign({ kind: 'overlay', key: 'charm', scale: 1, grp: null }, s));
  const els = {}, notes = [], saves = [], handlers = {}, frames = [];
  panels.forEach(p => {
    els[p.id] = { root: { offsetLeft: Math.round(p.x * SCR.w), offsetTop: Math.round(p.y * SCR.h), offsetWidth: p.w, offsetHeight: p.h,
      style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} } } };
  });
  const gbox = { classList: { add() {}, remove() {} }, style: {} };
  const doc = { addEventListener: (t, f) => { handlers[t] = f; }, getElementById: () => gbox, querySelector: () => ({ addEventListener() {} }) };
  const shield = { classList: { add() {}, remove() {} }, style: {} };
  const block = NUM + SIZE_BLOCK + '\n' + slice('  var SNAP = 8;', "document.addEventListener('mouseup', endDrag);\n");
  const env = new Function('window', 'document', '_layout', '_els', '_sel', 'notes', 'saves', 'frames', 'screenList', 'M', 'shield',
    'var _widen = {}; var _fitAdd = {}; var _edit = true; var _one = null; function isEd(id) { return _edit || (_one != null && _one === id); }\n'
    + 'function panelById(id) { return _layout.panels.filter(function (q) { return q.id === id; })[0] || null; }\n'
    + 'function selIds() { return Object.keys(_sel).filter(function (id) { return panelById(id); }); }\n'
    + 'function place() {} function sizeFrame(e, q, w, h) { frames.push([q.id, w, h]); } function closeMenu() {} function openMenu() {} function render() {}\n'
    + 'function note(m) { notes.push(m); } function save() { saves.push(1); }\n'
    + block + '\nreturn { startDrag: startDrag };'
  )(win, doc, { panels }, els, {}, notes, saves, frames, () => [{ x: 0, y: 0, w: SCR.w, h: SCR.h, sig: 's' }],
    { overlayHoverInteractive() {} }, shield);
  function drag(id, mode, dx, dy, axis) {
    const el = els[id].root, sx = el.offsetLeft + 5, sy = el.offsetTop + 5;
    env.startDrag({ button: 0, preventDefault() {}, stopPropagation() {}, clientX: sx, clientY: sy, shiftKey: false, ctrlKey: false, altKey: false, target: null }, id, mode, false, axis);
    handlers.mousemove({ clientX: sx + dx, clientY: sy + dy, shiftKey: true });
    drag.mid = Object.fromEntries(Object.entries(els).map(([k, e]) => [k, { width: e.root.style.width, height: e.root.style.height }]));
    drag.cursor = shield.style.cursor;
    handlers.mouseup();
  }
  return { panels, els, notes, saves, frames, drag, byId: (id) => panels.find(p => p.id === id) };
}

describe('the right and bottom edges size one direction, the ◢ both', () => {
  const one = (extra) => makeWorld([Object.assign({ id: 'a', x: 0.2, y: 0.2, w: 300, h: 180 }, extra)]);
  it('the ◢ corner sizes both (the baseline)', () => {
    const w = one(); w.drag('a', 'size', 60, 40);
    expect([w.byId('a').w, w.byId('a').h]).toEqual([360, 220]);
    expect(w.drag.cursor).toBe('nwse-resize');
  });
  it('the right edge sets the width and leaves the height, and the frame is re-laid-out at the new width', () => {
    const w = one(); w.drag('a', 'size', 60, 40, 'x');
    expect([w.byId('a').w, w.byId('a').h]).toEqual([360, 180]);
    expect(w.drag.mid.a).toEqual({ width: '360px', height: '180px' });
    expect(w.frames[w.frames.length - 1]).toEqual(['a', 360, 180]);
    expect(w.drag.cursor).toBe('ew-resize');
    expect(w.saves.length).toBeGreaterThan(0);
  });
  it('the bottom edge sets the height and leaves the width', () => {
    const w = one(); w.drag('a', 'size', 60, 40, 'y');
    expect([w.byId('a').w, w.byId('a').h]).toEqual([300, 220]);
    expect(w.drag.cursor).toBe('ns-resize');
  });
  it('dragging the height by hand turns Fit height off and says so; dragging only the width does not', () => {
    const tall = one(); tall.drag('a', 'size', 0, 60, 'y');
    expect(tall.byId('a').fit).toBe(false);
    expect(tall.notes.join(' ')).toMatch(/Fit height is off/);
    const wide = one(); wide.drag('a', 'size', 90, 0, 'x');
    expect(wide.byId('a').fit).toBeUndefined();
    expect(wide.notes.length).toBe(0);
  });
  it('stops at the floor of its kind and at the screen\'s edge', () => {
    const w = one(); w.drag('a', 'size', -500, 0, 'x');
    expect(w.byId('a').w).toBe(80);
    const v = one(); v.drag('a', 'size', 5000, 0, 'x');
    expect(v.byId('a').w).toBe(1000 - 200);
  });
  it('🔒 a locked item\'s edges do nothing, as its ◢ does nothing', () => {
    const w = one({ lock: true }); w.drag('a', 'size', 60, 40, 'x');
    expect([w.byId('a').w, w.byId('a').h]).toEqual([300, 180]);
    expect(w.drag.mid.a.width).toBeUndefined();
    expect(w.notes[0]).toMatch(/locked/i);
  });
  it('are wired: a mousedown on the edge starts that drag, and the CSS shows them only while arranging, on frames', () => {
    expect(c).toMatch(/if \(ev\.target === er\) \{ startDrag\(ev, p\.id, 'size', false, 'x'\); return; \}/);
    expect(c).toMatch(/if \(ev\.target === eb\) \{ startDrag\(ev, p\.id, 'size', false, 'y'\); return; \}/);
    expect(c).toMatch(/er\.setAttribute\('data-wp-interact', ''\)/);
    const css = stripCss(canvas);
    expect(css).toMatch(/\.edge\{display:none\}/);
    expect(css).toMatch(/:is\(body\.edit \.panel, \.panel\.one\):not\(\.part\):not\(\.sect\) > \.edge\{display:block;/);
    expect(css).toMatch(/:is\(body\.edit, \.panel\.one\) \.edge\.er\{[^}]*cursor:ew-resize\}/);
    expect(css).toMatch(/:is\(body\.edit, \.panel\.one\) \.edge\.eb\{[^}]*cursor:ns-resize\}/);
  });
});

// ── ▭ Mini mode on a frame ──────────────────────────────────────────────────────────────────────────────
describe('Mini mode: the overlay\'s own setting, shown on its frame', () => {
  class CL { constructor() { this.s = new Set(); } add(x) { this.s.add(x); } remove(x) { this.s.delete(x); }
    contains(x) { return this.s.has(x); } toggle(x, on) { if (on === undefined ? !this.s.has(x) : on) this.s.add(x); else this.s.delete(x); } }
  function frameOf() {
    const events = [];
    class Ev { constructor(t) { this.t = t; } }
    const win = { Event: Ev, dispatchEvent(e) { events.push(e.t); return true; } };
    return { events, e: { frame: { contentWindow: win } }, doc: { body: { classList: new CL() } } };
  }
  const mk = (overlays) => evalBlock('var _overlays = ' + JSON.stringify(overlays) + ';\n'
    + 'function ovEntry(key) { for (var i = 0; i < _overlays.length; i++) if (_overlays[i].key === key) return _overlays[i]; return null; }\n'
    + slice('  function miniOf(key)', '|| null; }') + '\n' + slice('  function applyMini(e, p, doc) {', '\n  }\n')
    , ['_overlays', 'miniOf', 'applyMini']);
  it('a mini overlay\'s frame gets the page\'s body class and the two events the window gets', () => {
    const { miniOf, applyMini } = mk([{ key: 'charm', mini: { on: true, pin: false } }]);
    const f = frameOf();
    applyMini(f.e, { key: 'charm' }, f.doc);
    expect(f.doc.body.classList.contains('wp-mini')).toBe(true);
    expect(f.events).toEqual(['wp-mini-change', 'resize']);
    expect(miniOf('charm')).toEqual({ on: true, pin: false });
  });
  it('only on a change: a repaint with the same state tells the page nothing', () => {
    const { applyMini } = mk([{ key: 'charm', mini: { on: true, pin: false } }]);
    const f = frameOf();
    applyMini(f.e, { key: 'charm' }, f.doc); applyMini(f.e, { key: 'charm' }, f.doc);
    expect(f.events.length).toBe(2);
  });
  it('turning it off takes the class away again', () => {
    const { applyMini, _overlays } = mk([{ key: 'charm', mini: { on: true, pin: false } }]);
    const f = frameOf();
    applyMini(f.e, { key: 'charm' }, f.doc);
    _overlays[0].mini.on = false;
    applyMini(f.e, { key: 'charm' }, f.doc);
    expect(f.doc.body.classList.contains('wp-mini')).toBe(false);
  });
  it('an overlay with no mini rendition has no row and is never made mini', () => {
    const { miniOf, applyMini } = mk([{ key: 'melody', mini: null }]);
    const f = frameOf();
    applyMini(f.e, { key: 'melody' }, f.doc);
    expect(miniOf('melody')).toBeNull();
    expect(f.doc.body.classList.contains('wp-mini')).toBe(false);
    expect(f.events.length).toBe(0);
  });
  it('main tells the Canvas about each overlay\'s mini state, and pings it when the setting changes', () => {
    const list = sliceBlock(main, 'function _canvasOverlayList() {', '\n}');
    const { out } = evalBlock(`
      const _MINI_KEYS = ['charm'];
      const _CANVAS_CATALOG = [{ key: 'charm', label: 'Charm', file: 'charm.html' }, { key: 'melody', label: 'Casting', file: 'melody.html' }];
      const _CANVAS_SIZES = {};
      const _OVERLAY_WINDOWS = [];
      let canvasWindow = null;
      const screen = { getPrimaryDisplay() { return { bounds: { x: 0, y: 0, width: 1920, height: 1080 } }; } };
      function loadConfig() { return { overlayMini: { charm: true }, overlayMiniPinned: { charm: true } }; }
      function _canvasBounds() { return { x: 0, y: 0, width: 1920, height: 1080 }; }
      function _dockedKeys() { return []; }
      function _miniSetting(cfg, k) { return !!(cfg.overlayMini || {})[k]; }
      function _miniPinSetting(cfg, k) { return !!(cfg.overlayMiniPinned || {})[k]; }
      ${list}
      const out = _canvasOverlayList().map(o => [o.key, o.mini]);
    `, ['out']);
    expect(out).toEqual([['charm', { on: true, pin: true }], ['melody', null]]);
  });
  it('flipping it (the one writer every surface uses), or minimizing all, pings the Canvas', () => {
    const w = evalBlock(`
      const sent = []; let canvasWindow = { isDestroyed() { return false; }, webContents: { send: (ch) => sent.push(ch) } };
      function _live(x) { return !!(x && !x.isDestroyed()); }
      const _MINI_KEYS = ['charm'];
      const _FOLD_KEYS = [];
      function _miniCapable(k) { return _MINI_KEYS.includes(k) || _FOLD_KEYS.includes(k); }
      let _activeCharName = null;
      function _charStateKey() { return null; } function _charStateNote() {}
      let CFG = {}; function loadConfig() { return JSON.parse(JSON.stringify(CFG)); } function saveConfig(x) { CFG = x; }
      let _miniAllActive = false, _miniAllPrev = null;
      function _overlayEntries() { return []; } function pushStatus() {}
      function _miniSetting(cfg, k) { return !!((cfg || {}).overlayMini || {})[k]; }
      function _sendOverlayMini() {}
      ${sliceBlock(main, 'function _pingCanvasMini() {', '\n}')}
      ${sliceBlock(main, 'function applyOverlayMini(win, key, cfg) {', '\n}')}
      ${sliceBlock(main, 'function applyAllOverlayMini() {', '\n}')}
      ${sliceBlock(main, 'function _setOverlayMini(key, next) {', '\n}')}
    `, ['sent', '_setOverlayMini', 'applyAllOverlayMini']);
    expect(w._setOverlayMini('charm', true)).toBe(true);
    expect(w.sent).toEqual(['canvas-mini']);
    w.applyAllOverlayMini();
    expect(w.sent).toEqual(['canvas-mini', 'canvas-mini']);
  });
  it('the preload hands the Canvas the ping, and the canvas reads state again on it', () => {
    expect(stripJs(preload)).toMatch(/onCanvasMini:\s+\(cb\)\s+=> ipcRenderer\.on\('canvas-mini', \(\) => cb\(\)\),/);
    expect(c).toMatch(/if \(M\.onCanvasMini\) M\.onCanvasMini\(refresh\);/);
  });
});

// ── The page's own options ──────────────────────────────────────────────────────────────────────────────
// Tokenise a page's setup bar: every control, and whether it sits inside a data-wp-opt span.
function barControls(html) {
  const start = html.indexOf('<div id="setupbar"');
  if (start < 0) return null;
  const end = html.indexOf('</div>', start);
  const bar = html.slice(start, end);
  const out = [];
  let optDepth = 0, spanDepth = 0;
  for (const m of bar.matchAll(/<(\/?)(span|input|button|select|textarea)\b([^>]*)>/g)) {
    const [, close, tag, attrs] = m;
    if (tag === 'span') {
      if (close) { if (optDepth && --spanDepth === 0) optDepth = 0; else if (optDepth) { /* nested */ } }
      else if (optDepth) { spanDepth++; }
      else if (/\bdata-wp-opt\b/.test(attrs)) { optDepth = 1; spanDepth = 1; }
      continue;
    }
    if (close) continue;
    out.push({ tag, id: (/\bid="([^"]+)"/.exec(attrs) || [])[1] || '', inOpt: optDepth > 0 });
  }
  return out;
}

describe('the page\'s own options are reachable on the Canvas', () => {
  // The pages the Canvas can host: the dock's overlays and the HUD (main.js _CANVAS_CATALOG).
  const pages = [...sliceBlock(main, 'const _DOCK_CATALOG = [', '\n];').matchAll(/file: '([a-z]+\.html)'/g)].map(m => m[1]).concat(['me.html']);
  it('knows which pages those are', () => {
    expect(pages.length).toBeGreaterThanOrEqual(15);
    expect(pages).toContain('charm.html');
    for (const f of pages) expect(fs.existsSync(mimic(f))).toBe(true);
  });
  it('Charm\'s "recharm warn at" is marked as the page\'s own option', () => {
    const ctl = barControls(readSource(mimic('charm.html')));
    const warn = ctl.find(x => x.id === 'warnAt');
    expect(warn).toBeTruthy();
    expect(warn.inOpt).toBe(true);
  });
  it('every control in an overlay\'s setup bar is the opacity slider, Done, or marked data-wp-opt (so none is lost to the Canvas)', () => {
    const lost = [];
    for (const f of pages) {
      const ctl = barControls(readSource(mimic(f)));
      if (!ctl) continue;
      for (const x of ctl) {
        if (x.inOpt) continue;
        if (x.id === 'opacitySlider' || x.id === 'exitSetupBtn') continue;
        lost.push(f + ' #' + (x.id || x.tag));
      }
    }
    expect(lost).toEqual([]);
  });
  it('the preload keeps the bar hidden on the canvas, and shows ONLY the marked controls when ⚙ turns Page options on', () => {
    const p = stripJs(preload);
    expect(p).toMatch(/#move-btn,#hide-btn,#drag-controls,#setupbar\{display:none!important\}/);
    expect(p).toMatch(/body\.wp-in-canvas\.wp-opts #setupbar\{display:flex!important;position:static;margin:0;flex-wrap:wrap\}/);
    expect(p).toMatch(/body\.wp-in-canvas\.wp-opts #setupbar > :not\(\[data-wp-opt\]\)\{display:none!important\}/);
  });
});

// ── The ⚙ menu: the markup, and the real click handler ──────────────────────────────────────────────────
describe('⚙ → Width: the markup', () => {
  const build = () => evalBlock(NUM + SIZE_BLOCK + 'var LOCK_TIP = "Locked";\n'
    + slice('  function widthMenuHtml(p) {', '\n  }\n'), ['widthMenuHtml']).widthMenuHtml;
  it('offers the five presets of the right-click menu, −/+ in steps, ↔ Fit width, and marks the one that is the width now', () => {
    const html = build()({ kind: 'overlay', key: 'charm', w: 420, h: 180 });
    for (const [k, l] of [['xs', 'XS'], ['sm', 'S'], ['md', 'M'], ['lg', 'L'], ['xl', 'XL']]) expect(html).toContain('data-wpre="' + k + '"');
    expect(html).toMatch(/class="btn on" data-wpre="lg"/);
    expect(html).not.toMatch(/class="btn on" data-wpre="md"/);
    expect(html).toContain('data-wd="-20"');
    expect(html).toContain('data-wd="20"');
    expect(html).toContain('data-fitw');
    expect(html).toContain('420 px');
    expect(html).not.toMatch(/disabled/);
  });
  it('a cut piece calls it the page width and shows its page width', () => {
    const html = build()({ kind: 'sect', key: 'mobinfo', sect: 'hp', w: 200, h: 30, pw: 340 });
    expect(html).toContain('>Page width<');
    expect(html).toContain('340 px');
  });
  it('🔒 locked, every size button is disabled and says why', () => {
    const html = build()({ kind: 'overlay', key: 'charm', w: 300, h: 180, lock: true });
    const buttons = html.match(/<button[^>]*>/g);
    expect(buttons.length).toBe(8);   // 5 presets, −, +, ↔
    for (const b of buttons) { expect(b).toContain(' disabled'); expect(b).toContain('Locked'); }
  });
  it('is only built for a frame that can be sized, and the menu has the rest of the rows', () => {
    expect(c).toMatch(/if \(sizable\(p\)\) h \+= widthMenuHtml\(p\);/);
    expect(c).toMatch(/data-al="-1"/);
    expect(c).toMatch(/data-mini title=/);
    expect(c).toMatch(/data-minipin title=/);
    expect(c).toMatch(/data-popt title=/);
    expect(c).toMatch(/data-ht="-20"/);
  });
});

describe('⚙: the real click handler reaches every control', () => {
  const handlerSrc = slice("  menuEl.addEventListener('click', function (ev) {", '\n  });\n');
  function setup(panel, mini) {
    const w = (() => {
      globalThis.__t_log = { saves: 0, renders: 0, opened: 0, notes: [], mini: [], fitw: [] };
      const root = { classList: { s: new Set(), add(x) { this.s.add(x); }, remove(x) { this.s.delete(x); }, contains(x) { return this.s.has(x); },
        toggle(x, on) { if (on === undefined ? !this.s.has(x) : on) this.s.add(x); else this.s.delete(x); } } };
      const body = { classList: { s: new Set(), contains(x) { return this.s.has(x); }, toggle(x, on) { if (on) this.s.add(x); else this.s.delete(x); } } };
      globalThis.__t_els = { [panel.id]: { root, frame: { contentDocument: { body } } } };
      globalThis.__t_panel = panel;
      globalThis.__t_sizes = SIZES;
      globalThis.__t_mini = mini || null;
      globalThis.__t_M = {
        setOverlayMini: (k, on) => { globalThis.__t_log.mini.push(['mini', k, on]); return Promise.resolve(on); },
        setOverlayMiniPin: (k, on) => { globalThis.__t_log.mini.push(['pin', k, on]); return Promise.resolve(on); },
      };
      const env = evalBlock(NUM + SIZE_BLOCK + slice('  function scaleRange(p) {', '\n  }\n') + `
        var LOCK_TIP = 'Locked in place';
        var PICKER = {}, ROWMENU = {}, _menuFor = ${JSON.stringify(panel.id)}, _menuAnchor = null;
        var _fitStop = { ${panel.id}: true }, _fitCreep = { ${panel.id}: 3 }, _fitAdd = {};
        var log = globalThis.__t_log, _els = globalThis.__t_els, M = globalThis.__t_M, P = globalThis.__t_panel;
        function panelById(id) { return id === P.id ? P : null; }
        function save() { log.saves++; } function render() { log.renders++; }
        function openMenu() { log.opened++; } function closeMenu() {}
        function note(m) { log.notes.push(m); }
        function miniOf() { return globalThis.__t_mini; }
        function setMin() {}
        ${slice('  function flipMini(p, pin) {', '\n  }\n')}
        function refresh() { return Promise.resolve(); }
        function fitWidth(p, e, W) { log.fitw.push([p.id, W]); return !isLocked(p); }
        var WpSizes = globalThis.__t_sizes;
        var handler;
        var menuEl = { addEventListener: function (t, f) { if (t === 'click') handler = f; } };
        ${handlerSrc}
        function click(attrs) {
          var t = { hasAttribute: function (n) { return n in attrs; }, getAttribute: function (n) { return attrs[n]; }, closest: function () { return null; }, id: '' };
          handler({ target: t });
        }
        function stops() { return { stop: _fitStop[P.id], creep: _fitCreep[P.id] }; }
      `, ['click', 'stops']);
      return { env, root, body };
    })();
    return Object.assign(w, { log: globalThis.__t_log, panel });
  }
  const charm = (extra) => Object.assign({ id: 'a', kind: 'overlay', key: 'charm', x: 0.2, y: 0.2, w: 300, h: 180, scale: 1 }, extra);
  it('a preset sets the width, saves, repaints, re-opens the menu and lets a stopped fit try again', () => {
    const w = setup(charm());
    w.env.click({ 'data-wpre': 'lg' });
    expect(w.panel.w).toBe(420);
    expect([w.log.saves, w.log.renders, w.log.opened]).toEqual([1, 1, 1]);
    expect(w.env.stops()).toEqual({ stop: undefined, creep: undefined });
  });
  it('the − / + steps move the width by 20, the height by 20 (toward its edge), and a cut piece\'s page width', () => {
    const w = setup(charm());
    w.env.click({ 'data-wd': '20' }); expect(w.panel.w).toBe(320);
    w.env.click({ 'data-wd': '-20' }); w.env.click({ 'data-wd': '-20' }); expect(w.panel.w).toBe(280);
    w.env.click({ 'data-ht': '20' }); expect(w.panel.h).toBe(200);
    expect(w.panel.fit).toBe(false);
    const s = setup({ id: 'a', kind: 'sect', key: 'mobinfo', sect: 'hp', x: 0.1, y: 0.1, w: 200, h: 30, pw: 340, ph: 400, scale: 1 });
    s.env.click({ 'data-wd': '20' });
    expect(s.panel.pw).toBe(360);
  });
  it('↔ Fit width runs for the item on the screen\'s width', () => {
    const w = setup(charm());
    w.env.click({ 'data-fitw': '' });
    expect(w.log.fitw).toEqual([['a', globalThis.innerWidth]]);
  });
  it('🔒 locked: every size control is refused with a "locked" note, text size still works', () => {
    const w = setup(charm({ lock: true }));
    for (const a of [{ 'data-wpre': 'xl' }, { 'data-wd': '20' }, { 'data-ht': '20' }, { 'data-fitw': '' }]) w.env.click(a);
    expect([w.panel.w, w.panel.h]).toEqual([300, 180]);
    expect(w.log.notes.length).toBe(4);
    expect(w.log.notes[0]).toMatch(/Locked/);
    w.env.click({ 'data-sc': '1' });
    expect(w.panel.scale).toBe(1.1);
    w.env.click({ 'data-al': '-1' });
    expect(w.panel.alpha).toBe(0.9);
  });
  it('the opacity buttons step the item\'s own opacity', () => {
    const w = setup(charm());
    w.env.click({ 'data-al': '-1' }); w.env.click({ 'data-al': '-1' });
    expect(w.panel.alpha).toBe(0.8);
    w.env.click({ 'data-al': '1' }); w.env.click({ 'data-al': '1' });
    expect('alpha' in w.panel).toBe(false);
  });
  it('Mini mode and its pin go through the overlay\'s own setters (the ones its menu and the dashboard use)', async () => {
    const w = setup(charm(), { on: false, pin: true });
    w.env.click({ 'data-mini': '' });
    w.env.click({ 'data-minipin': '' });
    expect(w.log.mini).toEqual([['mini', 'charm', true], ['pin', 'charm', false]]);
    await new Promise(r => setTimeout(r, 0));
    expect(w.log.opened).toBe(2);   // the menu is drawn again once the new state is read
  });
  it('Page options flips the page\'s own options on and off, in its body and on its panel', () => {
    const w = setup(charm());
    w.env.click({ 'data-popt': '' });
    expect(w.body.classList.contains('wp-opts')).toBe(true);
    expect(w.root.classList.contains('opts')).toBe(true);
    w.env.click({ 'data-popt': '' });
    expect(w.body.classList.contains('wp-opts')).toBe(false);
    expect(w.root.classList.contains('opts')).toBe(false);
  });
});

describe('what the Canvas cannot take, and what stands in for it', () => {
  it('nothing in the Canvas calls the per-window controls that would act on the screen-sized window', () => {
    // Stay on top, Move to display, Setup THIS/ALL and Auto-arrange act on a WINDOW; the Canvas is one window, so it
    // has its own Arrange, Next screen / Span all screens and per-item Opacity instead (the parity table).
    for (const ipc of ['wp-stay-on-top-toggle', 'wp-move-to-display', 'set-setup-mode-this', 'auto-arrange-overlays']) expect(c).not.toContain(ipc);
  });
});
