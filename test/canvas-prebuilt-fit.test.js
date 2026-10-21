// test/canvas-prebuilt-fit.test.js — the Canvas's prebuilt overlays: as pieces they keep the whole's footprint,
// come apart without breaking, and each has an "as whole" button (Mimic 3.0, beta).
//
// The guild lead, 2026-10-19, from screenshots:
//   - "TARGET INFO broken apart looks like it breaks when you click"
//   - "Command center is blank"
//   - "can't break the as-is hud box into pieces"
//   - "the as pieces version is HUGE by comparison. it should fit into the same setup. that applies for all of
//     these prebuilts."
//   - "The 'the overlay it...' isn't working for me. needs a 'As Whole' button instead"
//   - "when pieces isn't on the screen its confusing why this line is there" (the green hover line from the
//     top-left corner of the screen)
//
// Run: npx vitest run test/canvas-prebuilt-fit.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const mimic = (f) => path.join(ROOT, 'apps', 'mimic', f);
const canvas = readSource(mimic('canvas.html'));
const main = readSource(mimic('main.js'));
const meHtml = readSource(mimic('me.html'));
const mobHtml = readSource(mimic('mobinfo.html'));
const c = stripJs(canvas);
const m = stripJs(main);

let W, S;
beforeAll(() => {
  globalThis.window = globalThis;
  require(mimic('parts.js'));
  require(mimic('sections.js'));
  W = globalThis.WpParts;
  S = globalThis.WpSections;
});

// The size the whole overlay is dropped at, from main's catalog (what dropEmbed gives it).
function catalogSizes() { return evalBlock(sliceBlock(main, 'const _CANVAS_SIZES = {', '};') + '\n', ['_CANVAS_SIZES'])._CANVAS_SIZES; }

describe('as pieces keeps the whole overlay\'s footprint (every prebuilt)', () => {
  const sizes = catalogSizes();
  const embeds = () => W.PRESETS.filter(g => g.embed && !g.ring);
  it('every prebuilt overlay has a size in main\'s catalog to be measured against', () => {
    expect(embeds().length).toBeGreaterThanOrEqual(12);
    for (const g of embeds()) expect(sizes[g.embed], g.id).toBeTruthy();
  });
  it('the rows\' box is exactly the whole\'s box, for the size the whole drops at and for a taller one with content', () => {
    for (const g of embeds()) {
      const [w0, h0] = sizes[g.embed];
      for (const box of [{ w: w0, h: h0 }, { w: w0, h: h0 + 150 }, { w: w0 + 40, h: h0 }]) {
        const fit = W.fitRows(g.parts, box);
        const [bw, bh] = W.rowsBox(fit.rows);
        expect(Math.abs(bw - box.w), `${g.id} width in ${JSON.stringify(box)}`).toBeLessThanOrEqual(1);
        expect(Math.abs(bh - box.h), `${g.id} height in ${JSON.stringify(box)}`).toBeLessThanOrEqual(1);
        // every piece inside it
        for (const r of fit.rows) {
          expect(r[2], g.id + ' ' + r[0]).toBeGreaterThanOrEqual(-0.1);
          expect(r[3], g.id + ' ' + r[0]).toBeGreaterThanOrEqual(-0.1);
          expect(r[2] + r[4], g.id + ' ' + r[0]).toBeLessThanOrEqual(box.w + 1);
          expect(r[3] + r[5], g.id + ' ' + r[0]).toBeLessThanOrEqual(box.h + 1);
        }
        expect(fit.scale).toBeGreaterThanOrEqual(0.6);
        expect(fit.scale).toBeLessThanOrEqual(1.3);
      }
    }
  });
  it('and the whole\'s default size is not squeezed below the floor for any prebuilt (the footprint is not widened)', () => {
    for (const g of embeds()) {
      const [w0, h0] = sizes[g.embed], [bw, bh] = W.rowsBox(g.parts);
      expect(w0 / bw, g.id + ' width').toBeGreaterThanOrEqual(0.55);
      expect(h0 / bh, g.id + ' height').toBeGreaterThanOrEqual(0.55);
    }
  });
  it('a box that would squeeze the rows past the floor keeps the floor, not unreadable text', () => {
    const g = W.PRESETS.find(p => p.id === 'tank');
    const [bw, bh] = W.rowsBox(g.parts), fit = W.fitRows(g.parts, { w: bw, h: 20 });
    expect(W.rowsBox(fit.rows)[1]).toBeCloseTo(bh * 0.55, 0);
    expect(fit.scale).toBe(0.6);
  });
  it('the HUD Box is not "huge" any more: its pieces stand where the Box\'s own blocks are, 12 rows in about 300 px', () => {
    const g = W.PRESETS.find(p => p.id === 'hud-box');
    expect(g.parts.length).toBe(12);
    const [bw, bh] = W.rowsBox(g.parts);
    expect(bw).toBe(300);
    expect(bh).toBeLessThan(330);          // it was a stack of default-sized pieces about 600 px tall
    expect(g.parts.every(r => r[2] + r[4] <= 300)).toBe(true);
  });
  it('the ring is laid out in the ring\'s own square (its arcs are placed in the whole\'s space, not stacked)', () => {
    const g = W.PRESETS.find(p => p.id === 'hud-ring');
    for (const r of g.parts) {
      expect(r[2]).toBeGreaterThanOrEqual(-5); expect(r[3]).toBeGreaterThanOrEqual(-5);
      expect(r[2] + r[4]).toBeLessThanOrEqual(W.RING + 5); expect(r[3] + r[5]).toBeLessThanOrEqual(W.RING + 5);
    }
  });
  it('dropping "as pieces" fits the rows to the whole\'s box and gives every piece the fitted text size', () => {
    const block = 'var window = { innerWidth: 1000, innerHeight: 1000 }; var _cascade = 0; var MAX_PANELS = 150; var _layout = { panels: [] };\n'
      + 'function num(v, lo, hi, d) { v = Number(v); return (isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d); }\n'
      + 'function ovEntry(k) { return { key: k }; } function savedById() { return null; }\n'
      + 'function placeGroup(ps) { placed.push(ps); return "g1"; } function markPreset(grp) { return grp; }\n'
      + 'function wholeBox() { return { w: 330, h: 332 }; } function wholePanel() { return null; } function watchPieceFit() { watched.push(1); }\n'
      + 'function dropEmbed() {} function addOverlay() { return null; } function sectPanel() { return null; } function refresh() {} function save() {} function render() {}\n'
      + 'function presetPiece(a) { return { part: a[0], dx: a[2], dy: a[3], w: a[4], h: a[5] }; }\n'
      + sliceBlock(canvas, '  function presetById(id)', 'return null; }') + '\n'
      + sliceBlock(canvas, '  function dropThing(what, X, Y) {', '\n  }\n') + '\ndropThing("preset:hud-box:pieces", 100, 100);';
    const placed = [], watched = [];
    new Function('WpParts', 'placed', 'watched', block)(W, placed, watched);
    expect(placed).toHaveLength(1);
    const pcs = placed[0];
    const x1 = Math.max(...pcs.map(q => q.dx + q.w)), y1 = Math.max(...pcs.map(q => q.dy + q.h));
    expect(Math.abs(x1 - 330)).toBeLessThanOrEqual(1);
    expect(Math.abs(y1 - 332)).toBeLessThanOrEqual(1);
    expect(pcs.every(q => q.scale >= 0.6 && q.scale <= 1.3)).toBe(true);
    expect(watched).toHaveLength(1);     // and the page is asked how tall it really is
  });
  it('a piece group refits to the real page only while it is untouched', () => {
    const block = 'var window = { innerWidth: 1000, innerHeight: 1000 };\n'
      + 'function num(v, lo, hi, d) { v = Number(v); return (isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d); }\n'
      + 'var _layout = { panels: [] }; function panelById(id) { return _layout.panels.filter(q => q.id === id)[0] || null; }\n'
      + 'function wholeBox() { return { w: 330, h: 300 }; } function save() {} function render() {}\n'
      + 'var probe = null; function probeWhole(g, done) { probe = done; }\n'
      + sliceBlock(canvas, '  var _pfit = {};', '\n  }\n') + '\nreturn_ = { watchPieceFit, _layout, get probe() { return probe; } };';
    const mk = () => {
      const env = new Function('WpParts', block.replace('return_ =', 'return') .replace(/\n$/, ''))(W);
      return env;
    };
    const g = W.PRESETS.find(p => p.id === 'hud-box');
    const env = mk();
    const fit = W.fitRows(g.parts, { w: 330, h: 300 });
    env._layout.panels.push(...fit.rows.map((r, i) => ({ id: 'p' + i, grp: 'g1', x: (100 + r[2]) / 1000, y: (100 + r[3]) / 1000, w: r[4], h: r[5], scale: fit.scale })));
    env.watchPieceFit('g1', g, 100, 100);
    env.probe({ w: 0, h: 480 });
    const ys = env._layout.panels.map(q => (q.y * 1000 + 0) + q.h);
    expect(Math.round(Math.max(...ys) - 100)).toBeGreaterThanOrEqual(478);   // refit to the page's 480
    expect(Math.round(Math.max(...ys) - 100)).toBeLessThanOrEqual(482);
    // A piece the raider moved: left alone.
    const env2 = mk();
    env2._layout.panels.push(...fit.rows.map((r, i) => ({ id: 'p' + i, grp: 'g1', x: (100 + r[2]) / 1000, y: (100 + r[3]) / 1000, w: r[4], h: r[5], scale: fit.scale })));
    env2.watchPieceFit('g1', g, 100, 100);
    env2._layout.panels[3].x += 0.05;
    const before = JSON.stringify(env2._layout.panels);
    env2.probe({ w: 0, h: 480 });
    expect(JSON.stringify(env2._layout.panels)).toBe(before);
  });
  it('the whole\'s page is read off screen, silently, and the probe is removed (text)', () => {
    expect(c).toMatch(/fr\.style\.cssText = 'position:fixed;left:-30000px;top:0;border:0;visibility:hidden;pointer-events:none;/);
    expect(c).toMatch(/w\.speechSynthesis\.speak = function \(\) \{\};/);
    expect(c).toMatch(/fr\.parentNode\.removeChild\(fr\)/);
  });
});

describe('✂ Take it apart keeps the whole\'s geometry, and the tabs\' parts', () => {
  // The canvas's own functions, run against a fake page whose parts have the boxes given.
  function world(rects, { scale = 1, style = '', key = 'mobinfo', tab = 'stats', x0 = 400, y0 = 300 } = {}) {
    const store = { wpTargetTab: tab };
    globalThis.sessionStorage = { getItem: (k) => (k in store ? store[k] : null) };
    const els = {};
    const mkDoc = () => ({ body: {}, getElementById: () => ({}), querySelector: () => null,
      querySelectorAll: (sel) => (rects[sel] ? [{ getBoundingClientRect: () => ({ left: rects[sel][0], top: rects[sel][1], width: rects[sel][2], height: rects[sel][3], right: rects[sel][0] + rects[sel][2], bottom: rects[sel][1] + rects[sel][3] }) }] : []) });
    const block = 'var window = { innerWidth: 1920, innerHeight: 1080, WpSections: S }; var WpSections = S; var MAX_PANELS = 150; var SECT_PAD = 4;\n'
      + 'var _layout = { panels: [] }; var _els = els; var __n = 0; function newId(p) { return p + (++__n); }\n'
      + 'function num(v, lo, hi, d) { v = Number(v); return (isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d); }\n'
      + 'function ovEntry(k) { return { label: k, w: 340, h: 400 }; } function place(e, p) { placed.push(p.id); } function placeGbox() {} function isolateFrame() {}\n'
      + sliceBlock(canvas, '  function sectPanel(key, sect, x, y, o) {', '\n  }\n')
      + sliceBlock(canvas, '  function takeApart(p) {', '\n  }\n')
      + sliceBlock(canvas, '  function cropSections() {', '\n  }\n')
      + sliceBlock(canvas, '  function tabRef(p) {', '\n  }\n')
      + '\nreturn { takeApart, cropSections, _layout, _els, tabRef };';
    const placed = [];
    const env = new Function('S', 'els', 'placed', block)(S, els, placed);
    const whole = { id: 'o1', kind: 'overlay', key, style, x: 0, y: 0, w: 340, h: 420, scale };
    env._layout.panels.push(whole);
    const mkEl = (left, top) => ({ root: { offsetLeft: left, offsetTop: top, style: {}, classList: { toggle() {} } }, frame: { contentDocument: mkDoc(), style: {} } });
    els.o1 = mkEl(x0, y0);
    els.o1.frame.contentDocument = mkDoc();
    return { env, whole, placed, els, mkEl, mkDoc, rects };
  }
  const MOB = (extra) => Object.assign({
    '#wrap > .title': [8, 4, 322, 42], '[data-wp-sect="name"]': [10, 56, 305, 19], '.mob > .zone': [10, 77, 305, 10],
    '[data-wp-sect="stats"]': [10, 88, 305, 10], '.mob > .hpbar': [10, 100, 305, 8], '.mob > .res': [10, 112, 305, 31], '.mob > .spec': [10, 150, 305, 17] }, extra || {});

  it('the pieces\' boxes are the page\'s boxes at the whole\'s place and scale (union within 1 px)', () => {
    for (const scale of [1, 1.5]) {
      const w = world(MOB(), { scale });
      const n = w.env.takeApart(w.whole);
      expect(n).toBeGreaterThan(0);
      const ps = w.env._layout.panels.filter(q => q.kind === 'sect' && !q.follow);
      const want = (sel) => w.rects[sel];
      const px = (q) => Math.round(q.x * 1920), py = (q) => Math.round(q.y * 1080);
      const sect = S.find('mobinfo', 'hp');
      const hp = ps.find(q => q.sect === 'hp');
      expect(Math.abs(px(hp) - (400 + want(sect.sel)[0] * scale))).toBeLessThanOrEqual(1);
      expect(Math.abs(py(hp) - (300 + want(sect.sel)[1] * scale))).toBeLessThanOrEqual(1);
      expect(Math.abs(hp.w - want(sect.sel)[2] * scale)).toBeLessThanOrEqual(1);
      expect(Math.abs(hp.h - want(sect.sel)[3] * scale)).toBeLessThanOrEqual(1);
      const x0 = Math.min(...ps.map(px)), x1 = Math.max(...ps.map(q => px(q) + q.w));
      const y0 = Math.min(...ps.map(py)), y1 = Math.max(...ps.map(q => py(q) + q.h));
      const rs = ps.map(q => want(S.find('mobinfo', q.sect).sel));
      expect(Math.abs(x0 - (400 + Math.min(...rs.map(r => r[0])) * scale))).toBeLessThanOrEqual(1);
      expect(Math.abs(x1 - (400 + Math.max(...rs.map(r => r[0] + r[2])) * scale))).toBeLessThanOrEqual(1);
      expect(Math.abs(y0 - (300 + Math.min(...rs.map(r => r[1])) * scale))).toBeLessThanOrEqual(1);
      expect(Math.abs(y1 - (300 + Math.max(...rs.map(r => r[1] + r[3])) * scale))).toBeLessThanOrEqual(1);
      expect(ps.every(q => q.scale === scale)).toBe(true);
    }
  });
  it('Loot, Spells and F/Q/V are made too while the Stats tab shows, as parts that follow the tab', () => {
    const w = world(MOB());
    w.env.takeApart(w.whole);
    const sects = w.env._layout.panels.filter(q => q.kind === 'sect');
    const tabbed = sects.filter(q => q.follow).map(q => q.sect).sort();
    expect(tabbed).toEqual(['fqv', 'loot', 'spells']);
    // none of them sits on top of the group's ✥: they wait on the first part until their page says where they are
    const lead = sects[0];
    for (const q of sects.filter(q => q.follow)) { expect(q.x).toBe(lead.x); expect(q.y).toBe(lead.y); expect(q.grp).toBe(lead.grp); }
    // and a piece that is not a tab's does not follow
    expect(sects.filter(q => !q.follow).length).toBe(7);
  });
  it('a part that follows a tab shows while that tab is picked, hangs from the title, and is hidden otherwise', () => {
    const lootSel = S.find('mobinfo', 'loot').sel, titleSel = S.find('mobinfo', 'title').sel;
    const w = world(MOB());
    w.env.takeApart(w.whole);
    const q = w.env._layout.panels.find(p => p.sect === 'loot'), t = w.env._layout.panels.find(p => p.sect === 'title');
    // The title's piece (its own page: title at 8,4) is on the screen at 393,296; the loot page has its block at 10,150.
    const tel = w.mkEl(393, 296); tel.frame.contentDocument = w.mkDoc(); w.els[t.id] = tel;
    // the title page's rects come from MOB; the loot piece's own page has the loot block
    w.rects[lootSel] = [10, 150, 305, 90];
    w.els[q.id] = w.mkEl(393, 296);
    const classes = [];
    w.els[q.id].root.classList = { toggle: (k, on) => classes.push([k, !!on]) };
    // The loot page (pinned to its tab) has the loot block; every other page here shares the one fake rects table.
    globalThis.sessionStorage = { getItem: () => 'stats' };
    w.env.cropSections();
    expect(classes.filter(x => x[0] === 'nodata').pop()).toEqual(['nodata', true]);
    globalThis.sessionStorage = { getItem: () => 'loot' };
    w.env.cropSections();
    expect(classes.filter(x => x[0] === 'nodata').pop()).toEqual(['nodata', false]);
    // Where it sits: the title's piece is at 393,296 for a page box at 8,4, so the page's origin is 385,292 and the
    // loot block at page 10,150 is at 395,442.
    expect(Math.round(q.x * 1920)).toBe(395);
    expect(Math.round(q.y * 1080)).toBe(442);
    // Pulled out of the group, it has nothing to hang from and shows on its own.
    q.grp = null;
    globalThis.sessionStorage = { getItem: () => 'stats' };
    w.env.cropSections();
    expect(classes.filter(x => x[0] === 'nodata').pop()).toEqual(['nodata', false]);
    expect(titleSel).toBe('#wrap > .title');
  });
  it('a page\'s tab is read from where the page keeps it, the first tab when it says nothing', () => {
    globalThis.sessionStorage = { getItem: () => null };
    expect(S.tabNow('mobinfo')).toBe('stats');
    globalThis.sessionStorage = { getItem: (k) => (k === 'wpTargetTab' ? 'spells' : null) };
    expect(S.tabNow('mobinfo')).toBe('spells');
    expect(S.anchorOf('mobinfo')).toBe('title');
    expect(S.tabNow('charm')).toBe('');
    expect(mobHtml).toContain("window.sessionStorage.setItem('wpTargetTab', t)");
  });
  it('the title\'s ⚡ mana switch reaches the other pieces of the page (it is kept in localStorage)', () => {
    const mob = stripJs(mobHtml);
    expect(mob).toMatch(/if \(ev\.key === 'wpTargetMana'\) \{\s*_manaView = ev\.newValue !== 'off';/);
    expect(mob).toMatch(/window\.localStorage\.setItem\('wpTargetMana', _manaView \? 'on' : 'off'\)/);
  });
});

describe('the HUD Box comes apart', () => {
  it('has parts for the Box only: the ring is one SVG and offers none', () => {
    expect(S.list('me', 'a').map(d => d.id)).toEqual(['title', 'hp', 'mana', 'end', 'xp', 'aa', 'meta', 'cast', 'target', 'mine', 'focus', 'damage', 'group', 'gems']);
    expect(S.list('me', 'hud')).toEqual([]);
    expect(S.list('me', '')).toEqual([]);
    expect(S.list('mobinfo', '').length).toBeGreaterThan(10);   // a page with one look is not asked for it
    expect(S.styleOf('me')).toBe('a');
    expect(S.styleOf('mobinfo')).toBe('');
  });
  it('every part is a block me.html marks (renderA), or its own title', () => {
    const me = stripJs(meHtml);
    for (const d of S.list('me', 'a')) {
      if (d.id === 'title') { expect(me).toContain('<div class="title">'); continue; }
      expect(me, d.id).toContain("sectOf('" + d.id + "'");
      expect(d.sel).toBe('[data-wp-sect="' + d.id + '"]');
    }
  });
  it('the Take it apart button is offered for the Box (with its look) and not for the ring', () => {
    expect(c).toMatch(/WpSections\.list\(p\.key, p\.style \|\| ''\)\.length/);
    expect(c).toMatch(/WpSections\.list\(p\.key, p\.style \|\| ''\) : \[\]/);
  });
  it('a piece cut from the Box loads the Box (its look rides with it), and the layout keeps that look', () => {
    const block = sliceBlock(canvas, '  var GROUPS = [', '  // ── Panels ──');
    const r = evalBlock('var window = { WpSections: globalThis.WpSections };\n' + block + '\nfunction __setOv(o){ _overlays = o; }', ['sanitize', 'sectSrc', '__setOv']);
    r.__setOv([{ key: 'me', src: 'me.html' }]);
    expect(r.sectSrc({ key: 'me', sect: 'hp', style: 'a' })).toBe('me.html?wpcanvas=1&wpstyle=a&wpsect=hp');
    const s = r.sanitize({ panels: [{ id: 'a', kind: 'sect', key: 'me', sect: 'hp', style: 'a', x: 0, y: 0, w: 300, h: 15 },
      { id: 'b', kind: 'sect', key: 'me', sect: 'hp', style: 'evil', x: 0, y: 0, w: 300, h: 15 },
      { id: 'c', kind: 'sect', key: 'mobinfo', sect: 'loot', follow: 1, x: 0, y: 0, w: 300, h: 15 }] });
    const sect = s.panels.filter(p => p.kind === 'sect');
    expect(sect.map(p => [p.id, p.style, p.follow])).toEqual([['a', 'a', false], ['b', '', false], ['c', '', true]]);
  });
});

describe('Command Center on the Canvas', () => {
  it('loads the bundled page, never the agent-served copy of another origin', () => {
    const block = 'var _CANVAS_CATALOG = [{ key: "command", label: "Command Center", file: "command.html", flag: "showCommand", agentPath: "/overlay/command" }, { key: "charm", label: "Charm", file: "charm.html" }];\n'
      + 'var _CANVAS_SIZES = {}; var agentPort = 7779; var screen = { getPrimaryDisplay() { return { bounds: { x: 0, y: 0, width: 1920, height: 1080 } }; } };\n'
      + 'var canvasWindow = null; function _canvasDisplay() { return { bounds: { x: 0, y: 0, width: 1920, height: 1080 } }; } function loadConfig() { return {}; }\n'
      + 'function _dockedKeys() { return []; } var _OVERLAY_WINDOWS = [];\n'
      + 'var _MINI_KEYS = []; function _miniSetting() { return false; } function _miniPinSetting() { return false; }\n'
      + sliceBlock(main, 'function _canvasOverlayList() {', '\n}\n') + '\nreturn { _canvasOverlayList };';
    const list = new Function(block)()._canvasOverlayList();
    expect(list.find(o => o.key === 'command').src).toBe('command.html');
    expect(list.find(o => o.key === 'charm').src).toBe('charm.html');
    expect(m).not.toMatch(/src: \(c\.agentPath && agentPort\) \? `http:\/\/127\.0\.0\.1:\$\{agentPort\}\$\{c\.agentPath\}` : c\.file,\s*showing/);
  });
  it('the Dock still serves the agent copy (hot-swap), the Canvas is the one that differs', () => {
    expect(m).toMatch(/const srcFor = \(c\) => \(c\.agentPath && agentPort\)/);
  });
});

describe('the Groups tab: "as whole" and "as pieces" are two chips of one kind', () => {
  it('each overlay row has both chips, draggable, and the dim "the overlay itself" label is gone', () => {
    expect(c).toContain('data-drag="preset:\' + g.id + \':whole"');
    expect(c).toContain('data-drag="preset:\' + g.id + \':pieces"');
    expect(c).toMatch(/>as whole<\/span>/);
    expect(c).toMatch(/>as pieces<\/span>/);
    expect(c).not.toContain("'the overlay itself'");
  });
  it('a drag or click on "as whole" places the overlay itself, "as pieces" its pieces', () => {
    const W2 = W;
    const drop = (what) => {
      const calls = [];
      const block = 'var window = { innerWidth: 1000, innerHeight: 1000 }; var _cascade = 0; var MAX_PANELS = 150; var _layout = { panels: [] };\n'
        + 'function num(v, lo, hi, d) { v = Number(v); return (isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d); }\n'
        + 'function ovEntry(k) { return { key: k }; } function presetPiece(a) { return a; } function savedById() { return null; }\n'
        + 'function addPart() {} function placeGroup(ps) { calls.push(["pieces"]); } function markPreset(g) { return g; }\n'
        + 'function wholeBox() { return { w: 300, h: 300 }; } function wholePanel() { return null; } function watchPieceFit() {}\n'
        + 'function dropEmbed(g) { calls.push(["whole", g.id]); } function addOverlay() { return null; } function sectPanel() { return null; } function refresh() {} function save() {} function render() {}\n'
        + sliceBlock(canvas, '  function presetById(id)', 'return null; }') + '\n'
        + sliceBlock(canvas, '  function dropThing(what, X, Y) {', '\n  }\n') + '\ndropThing(' + JSON.stringify(what) + ', 10, 10);';
      new Function('WpParts', 'calls', block)(W2, calls);
      return calls;
    };
    expect(drop('preset:hud-box:whole')).toEqual([['whole', 'hud-box']]);
    expect(drop('preset:hud-box:pieces')).toEqual([['pieces']]);
    expect(drop('preset:hud-box')).toEqual([['whole', 'hud-box']]);
  });
  it('a click on a chip while that overlay is already on the screen shows where it is (a second whole is refused)', () => {
    expect(c).toMatch(/if \(g && g\.embed && bits\[2\] !== 'pieces' && ovEntry\(g\.embed\)\) dropEmbed\(g, X, Y, clicked\);/);
    expect(c).toMatch(/if \(!pd\.moved && clickLocates\(pd\.what/);
  });
});

describe('the locate line starts where the Pieces chooser is, or is not drawn', () => {
  const fn = () => evalBlock(
    'function clampTo(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }\n' + sliceBlock(canvas, '  function linkStart(ar, lr, cr) {', '\n  }\n'), ['linkStart']).linkStart;
  const R = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h });
  it('chooser closed: every rect is 0,0 — no line (it ran from the corner of the screen)', () => {
    expect(fn()(R(0, 0, 0, 0), R(0, 0, 0, 0), R(0, 0, 0, 0))).toBeNull();
  });
  it('a hidden chooser whose list still has a row\'s rect: no line either (the chooser is the start)', () => {
    expect(fn()(R(1400, 300, 300, 20), R(1400, 200, 340, 500), R(0, 0, 0, 0))).toBeNull();
    expect(fn()(R(0, 0, 0, 0), R(1400, 200, 340, 500), R(1380, 130, 360, 640))).toBeNull();
  });
  it('a row scrolled out of the list\'s window: no line', () => {
    const lr = R(1400, 200, 340, 500), cr = R(1380, 130, 360, 640);
    expect(fn()(R(1400, 100, 300, 20), lr, cr)).toBeNull();    // above
    expect(fn()(R(1400, 720, 300, 20), lr, cr)).toBeNull();    // below
  });
  it('a row in view: the line leaves the chooser at the row\'s height', () => {
    const lr = R(1400, 200, 340, 500), cr = R(1380, 130, 360, 640);
    expect(fn()(R(1400, 300, 300, 20), lr, cr)).toEqual({ y: 310 });
    expect(fn()(R(1400, 196, 300, 20), lr, cr).y).toBe(206);   // half in view: kept inside the window
  });
  it('is hidden when the chooser closes, and when the list scrolls', () => {
    expect(c).toMatch(/if \(!st\.open && locEl && locEl\.classList\.contains\('on'\)\) endLink\(\);/);
    expect(c).toMatch(/chList\.addEventListener\('scroll', endLink\);/);
    expect(c).toMatch(/var st0 = linkStart\(ar, lr, cr\);\s*if \(!st0\) return;/);
  });
});
