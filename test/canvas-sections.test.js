// test/canvas-sections.test.js — overlays cut into pieces from their own page (Mimic 3.0 alpha).
//
// The guild lead, 2026-10-02: "every one of the overlays should be exactly reproduced within the canvas
// so the people can disassemble them and use any element of them in the way that they feel fits best on
// their screen … in its current implementation the overlays as they exist outside of the canvas are not
// reproducible inside of the canvas. that needs to be a priority before we can optimize anything else."
// The parity audit (DECISIONS §125) found 3 of 378 overlay elements reproduced exactly by parts.js
// pieces, and 18 of 19 by the one overlay the canvas already loads from its own page (the trigger
// overlay's ?part= panels). So a piece is now the overlay's own page, cropped to one section.
//
// Run: npx vitest run test/canvas-sections.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const canvas = readSource(path.join(ROOT, 'apps', 'mimic', 'canvas.html'));
const main = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const c = stripJs(canvas);
global.window = global.window || globalThis;
require('../apps/mimic/sections.js');
const S = globalThis.WpSections;

function canvasRules() {
  const block = sliceBlock(canvas, '  var GROUPS = [', '  // ── Panels ──');
  return evalBlock('var window = { WpSections: globalThis.WpSections };\n' + block + '\nfunction __setOv(o){ _overlays = o; }', ['sanitize', 'sectSrc', '__setOv']);
}

describe('the section map', () => {
  it('every overlay part has an id, a label and a selector; tab-only parts name their tab', () => {
    for (const [key, list] of Object.entries(S.byKey)) {
      const ids = new Set();
      for (const d of list) {
        expect(d.id, key).toMatch(/^[a-z][a-z0-9-]{0,23}$/);
        expect(ids.has(d.id), `${key}.${d.id} twice`).toBe(false);
        ids.add(d.id);
        expect(d.label.length).toBeGreaterThan(1);
        expect(d.sel.length).toBeGreaterThan(1);
      }
    }
    expect(S.find('mobinfo', 'loot').tab).toBe('loot');
    expect(S.find('mobinfo', 'nope')).toBe(null);
  });
  it('Target Info\'s parts all exist in the page (its marks, or its own classes)', () => {
    const page = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html')));
    for (const d of S.list('mobinfo')) {
      for (const one of d.sel.split(',').map((s) => s.trim())) {
        const mark = one.match(/data-wp-sect="([a-z-]+)"/);
        const cls = one.match(/\.([a-z]+)$/);
        const id = one.match(/^#([a-z]+)$/);
        if (mark) expect(page, d.id).toMatch(new RegExp(`data-wp-sect="${mark[1]}"|data-wp-sect="'\\+sect\\+'"`));
        else if (cls) expect(page, d.id).toMatch(new RegExp(`class="${cls[1]}["' ]`));
        else if (id) expect(page, d.id).toContain(`id="${id[1]}"`);
      }
    }
  });
  it('the page shows only its section: every other box keeps its place, invisible', () => {
    const css = S.isolateCss('.mob > .hpbar, .mob > .mana');
    expect(css).toContain('body *{visibility:hidden!important}');
    expect(css).toContain('.mob > .hpbar,.mob > .hpbar *,.mob > .mana,.mob > .mana *{visibility:visible!important}');
  });
  it('a piece is the union of its boxes; nothing with a size is nothing to show', () => {
    const box = (l, t, w, h) => ({ getBoundingClientRect: () => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h }) });
    const doc = (els) => ({ querySelectorAll: () => els });
    expect(S.unionRect(doc([box(10, 40, 200, 6), box(10, 48, 120, 14)]), 'x')).toEqual({ left: 10, top: 40, width: 200, height: 22 });
    expect(S.unionRect(doc([box(0, 0, 0, 0)]), 'x')).toBe(null);
    expect(S.unionRect(doc([]), 'x')).toBe(null);
    expect(S.unionRect({ querySelectorAll: () => { throw new Error('bad selector'); } }, 'x')).toBe(null);
    // A loose piece keeps a little of its card; never past the page's corner.
    expect(S.unionRect(doc([box(2, 40, 200, 6)]), 'x', 4)).toEqual({ left: 0, top: 36, width: 206, height: 14 });
  });
  it('the card behind a part is the first box around it with a background of its own', () => {
    const el = (bg, parent, radius) => ({ bg, parentElement: parent, radius });
    const body = el('rgb(0, 0, 0)', null);
    const card = el('rgba(13, 17, 23, 0.9)', body, '6px');
    const wrap = el('rgba(0, 0, 0, 0)', card);
    const hp = el('transparent', wrap);
    const doc = { body, documentElement: {}, querySelector: () => hp,
      defaultView: { getComputedStyle: (e) => ({ backgroundColor: e.bg, borderTopLeftRadius: e.radius || '0px' }) } };
    expect(S.backdrop(doc, 'x')).toEqual({ bg: 'rgba(13, 17, 23, 0.9)', radius: 6 });
    card.bg = 'rgba(0, 0, 0, 0)';
    expect(S.backdrop(doc, 'x')).toBe(null);
  });
});

describe('the canvas keeps pieces cut from a page', () => {
  const r = canvasRules();
  it('several from one overlay, each clamped; bad keys and ids are dropped', () => {
    const s = r.sanitize({ panels: [
      { id: 'a', kind: 'sect', key: 'mobinfo', sect: 'hp', x: 0.2, y: 0.3, w: 200, h: 8, pw: 340, ph: 400 },
      { id: 'b', kind: 'sect', key: 'mobinfo', sect: 'loot', x: 0.5, y: 0.5, pw: 99999, scale: 9 },
      { id: 'c', kind: 'sect', key: '../x', sect: 'hp' },
      { id: 'd', kind: 'sect', key: 'mobinfo', sect: 'HP<script>' },
    ] });
    const sect = s.panels.filter((p) => p.kind === 'sect');
    expect(sect.map((p) => [p.id, p.sect])).toEqual([['a', 'hp'], ['b', 'loot']]);
    expect(sect[1]).toMatchObject({ pw: 2400, scale: 2.5 });
  });
  it('loads its overlay\'s own page, told which part it is, and the tab where the part lives on one', () => {
    r.__setOv([{ key: 'mobinfo', src: 'mobinfo.html' }]);
    expect(r.sectSrc({ key: 'mobinfo', sect: 'hp' })).toBe('mobinfo.html?wpcanvas=1&wpsect=hp');
    expect(r.sectSrc({ key: 'mobinfo', sect: 'loot' })).toBe('mobinfo.html?wpcanvas=1&wpsect=loot&wptab=loot');
    expect(r.sectSrc({ key: 'gone', sect: 'hp' })).toBe(null);
  });
  it('follows its section: the page at the window\'s size, moved under the panel and clipped to the part', () => {
    expect(c).toMatch(/var s = p\.scale \|\| 1, r = WpSections\.unionRect\(doc, d\.sel, p\.grp \? 0 : SECT_PAD\);/);
    expect(c).toMatch(/var bd = r \? WpSections\.backdrop\(doc, d\.sel\) : null;/);
    expect(c).toMatch(/e\.frame\.style\.left = Math\.round\(-r\.left \* s\) \+ 'px';/);
    expect(c).toMatch(/e\.frame\.style\.clipPath = 'inset\('/);
    expect(c).toMatch(/e\.root\.classList\.toggle\('nodata', !r\);/);
    expect(c).toMatch(/setInterval\(cropSections, 250\);/);
  });
  it('one voice per overlay: the whole overlay if it is here, else its first piece', () => {
    const block = sliceBlock(canvas, '  function isVoice(p) {', '\n  }\n');
    const t = (panels) => evalBlock('var _layout = { panels: ' + JSON.stringify(panels) + ' };\n' + block, ['isVoice', '_layout']);
    let v = t([{ id: 'a', kind: 'sect', key: 'charm' }, { id: 'b', kind: 'sect', key: 'charm' }]);
    expect(v.isVoice(v._layout.panels[0])).toBe(true);
    expect(v.isVoice(v._layout.panels[1])).toBe(false);
    v = t([{ id: 'w', kind: 'overlay', key: 'charm' }, { id: 'a', kind: 'sect', key: 'charm' }]);
    expect(v.isVoice(v._layout.panels[1])).toBe(false);
    v = t([{ id: 'a', kind: 'sect', key: 'charm', off: true }, { id: 'b', kind: 'sect', key: 'charm' }]);
    expect(v.isVoice(v._layout.panels[1])).toBe(true);
    expect(c).toMatch(/if \(w && w\.speechSynthesis && !isVoice\(p\)\) \{ try \{ w\.speechSynthesis\.speak = function \(\) \{\}; \}/);
  });
  it('✂ Take it apart swaps the whole overlay for its parts, each where it was, moving together', () => {
    expect(c).toMatch(/made\.push\(sectPanel\(p\.key, d\.id, num\(\(x0 \+ r\.left \* s\) \/ W, 0, 1, 0\.3\), num\(\(y0 \+ r\.top \* s\) \/ H, 0, 1, 0\.3\),/);
    expect(c).toMatch(/pw: Math\.round\(p\.w \/ s\), ph: Math\.round\(p\.h \/ s\), scale: s, grp: grp/);
    expect(c).toMatch(/_layout\.panels = _layout\.panels\.filter\(function \(q\) \{ return q\.id !== p\.id; \}\);/);
  });
  it('the chooser lists every overlay\'s parts, and a dropped one is placed', () => {
    expect(c).toMatch(/data-tab="cuts"/);
    expect(c).toMatch(/data-drag="sect:' \+ o\.key \+ ':' \+ d\.id \+ '"/);
    expect(c).toMatch(/_layout\.panels\.push\(sectPanel\(bits\[1\], bits\[2\], num\(X \/ W, 0, 1, 0\.3\), num\(Y \/ H, 0, 1, 0\.3\)\)\);/);
  });
});

describe('main: a piece cut from an overlay keeps the overlay off its own window', () => {
  it('hosted keys count the cut pieces as well as whole overlays', () => {
    expect(stripJs(main)).toMatch(/if \(p && \(p\.kind === 'overlay' \|\| p\.kind === 'sect'\) && _canvasSpec\(p\.key\) && !out\.includes\(p\.key\)\) out\.push\(p\.key\);/);
  });
});
