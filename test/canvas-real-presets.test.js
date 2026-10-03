// test/canvas-real-presets.test.js — a preset that is an overlay IS the overlay (Mimic 3.0 alpha).
//
// The guild lead, 2026-10-03: "on alpha the canvas versions of existing overlays don't match the real
// overlays. they have many of the elements but they are so spread out. … the margins around the actual data
// is too large. the HUD overlay's circle mode is unconstructive (or meant to be) but the canvas version is a
// bunch of small dials. we need the ability to craft the circular HUD, but we also should have the default
// HUD circle view in canvas. when I look at an overlay outside of the canvas or choose it as a preset within
// the canvas they should be extremely close to being identical."
//
// So: a Groups-tab preset that is an overlay puts that overlay's own page on the canvas (one code path);
// the pages drop the margins they kept for the ✥/✕ the canvas now owns; a new panel is fitted to its page;
// the HUD ring is me.html in its ring look, and its ⚙ builder widens the panel instead of the window.
//
// Run: npx vitest run test/canvas-real-presets.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, evalBlock, stripJs, stripCss, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const mimic = (f) => path.join(ROOT, 'apps', 'mimic', f);
const canvas = readSource(mimic('canvas.html'));
const meHtml = readSource(mimic('me.html'));
const main = readSource(mimic('main.js'));
const c = stripJs(canvas);

let W;
beforeAll(() => {
  globalThis.window = globalThis;
  require(mimic('parts.js'));
  W = globalThis.WpParts;
});

// The canvas's own rules (sanitize, ovSrc, num, panelById …), the way the other canvas tests slice them.
const rules = sliceBlock(canvas, '  var GROUPS = [', '  // ── Panels ──');
const slice = (start, end = '\n  }\n') => sliceBlock(canvas, start, end);

describe('presets that are overlays', () => {
  const EMBEDS = { 'hud-ring': 'me', 'hud-box': 'me', tank: 'tank', command: 'command', target: 'mobinfo', charm: 'charm', pets: 'pets',
    dps: 'hud', threat: 'threat', tick: 'zeal', exttarget: 'exttarget', buffq: 'buffQueue', who: 'who', melody: 'melody', chchain: 'chchain' };
  it('each names the overlay it is, and keeps its pieces (tests and "as pieces" use them)', () => {
    for (const [id, key] of Object.entries(EMBEDS)) {
      const g = W.PRESETS.find(p => p.id === id);
      expect(g, id).toBeTruthy();
      expect(g.embed, id).toBe(key);
      expect(g.parts.length, id).toBeGreaterThan(0);
    }
  });
  it('and every embed is an overlay main can host on the canvas', () => {
    const dock = sliceBlock(main, 'const _DOCK_CATALOG = [', '\n];');
    const keys = new Set([...dock.matchAll(/key: '([A-Za-z]+)'/g)].map(m => m[1]));
    keys.add('me');   // _CANVAS_CATALOG adds the HUD to the dock's list
    for (const g of W.PRESETS) if (g.embed) expect(keys.has(g.embed), g.id + ' → ' + g.embed).toBe(true);
  });
  it('a preset with no overlay of its own stays pieces', () => {
    for (const id of ['group', 'timers', 'target-tabs']) expect(W.PRESETS.find(p => p.id === id).embed, id).toBeUndefined();
  });
  it('the HUD is the ring first, the box second — the same page in two looks', () => {
    const ids = W.PRESETS.map(p => p.id);
    expect(ids.indexOf('hud-ring')).toBeLessThan(ids.indexOf('hud-box'));
    expect(W.PRESETS.find(p => p.id === 'hud-ring')).toMatchObject({ name: 'HUD (ring)', embed: 'me', style: 'hud' });
    expect(W.PRESETS.find(p => p.id === 'hud-box')).toMatchObject({ name: 'HUD (box)', embed: 'me', style: 'a' });
    // Only the HUD has two looks.
    expect(W.PRESETS.filter(p => p.style).map(p => p.id)).toEqual(['hud-ring', 'hud-box']);
  });
});

describe('choosing a preset', () => {
  // dropThing, run for real with the helpers around it stubbed. at: where it is dropped; null = a click.
  function drop(what, { have = true, at = [120, 340] } = {}) {
    const calls = [];
    const block = 'var window = { innerWidth: 1000, innerHeight: 1000 }; var _cascade = 0; var MAX_PANELS = 150; var _layout = { panels: [] };\n'
      + 'function num(v, lo, hi, d) { v = Number(v); return (isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d); }\n'
      + 'function ovEntry(k) { return have ? { key: k } : null; }\n'
      + 'function presetPiece(a) { return a; } function savedById() { return null; }\n'
      + 'function addPart() { calls.push(["part"]); } function placeGroup(ps) { calls.push(["pieces", ps.length]); }\n'
      + 'function dropEmbed(g, X, Y, clicked) { calls.push(["embed", g.embed, g.style || "", X, Y, clicked]); }\n'
      + 'function addOverlay() { return null; } function sectPanel() { return null; } function refresh() {} function save() {} function render() {}\n'
      + slice('  function presetById(id)', 'return null; }') + '\n'
      + slice('  function dropThing(what, X, Y) {') + '\ndropThing(' + JSON.stringify(what) + ', ' + (at ? at[0] + ', ' + at[1] : 'null, null') + ');';
    new Function('WpParts', 'calls', 'have', block)(W, calls, have);
    return calls;
  }
  it('a preset that is an overlay puts the overlay on the screen, not its pieces', () => {
    expect(drop('preset:tank')).toEqual([['embed', 'tank', '', 120, 340, false]]);
    expect(drop('preset:hud-ring')).toEqual([['embed', 'me', 'hud', 120, 340, false]]);
    expect(drop('preset:hud-box')).toEqual([['embed', 'me', 'a', 120, 340, false]]);
  });
  it('a click (no drag) is told apart from a drop, so the ring can land in the middle of the screen', () => {
    const [[, , , , , clicked]] = drop('preset:hud-ring', { at: null });
    expect(clicked).toBe(true);
  });
  it('"as pieces" — or an overlay main has not listed yet — lays out the old stack of pieces', () => {
    const tank = W.PRESETS.find(p => p.id === 'tank');
    expect(drop('preset:tank:pieces')).toEqual([['pieces', tank.parts.length]]);
    expect(drop('preset:tank', { have: false })).toEqual([['pieces', tank.parts.length]]);
    // A preset with no overlay behind it is only ever pieces.
    expect(drop('preset:group')).toEqual([['pieces', W.PRESETS.find(p => p.id === 'group').parts.length]]);
  });
  it('the Groups tab shows the real overlays, each with an "as pieces" chip, and the rest as pieces', () => {
    expect(c).toMatch(/var real = !!\(g\.embed && ovEntry\(g\.embed\)\);/);
    expect(c).toContain("data-drag=\"preset:' + g.id + ':pieces\"");
    expect(c).toContain("(real ? '▣ ' : '▦ ')");
    expect(c).toMatch(/else if \(g\) placeGroup\(g\.parts\.map\(presetPiece\), X, Y\);/);
  });
  it('"Whole overlays" lists only the overlays with no preset, so the HUD is not offered a second, half-size way', () => {
    expect(c).toMatch(/WpParts\.PRESETS\.forEach\(function \(g\) \{ if \(g\.embed\) preset\[g\.embed\] = true; \}\);\s*var whole = _overlays\.filter\(function \(o\) \{ return !on\[o\.key\] && !preset\[o\.key\]; \}\);/);
  });
});

describe('the overlay panel a preset adds', () => {
  const env = () => evalBlock('var window = { innerWidth: 1920, innerHeight: 1080 }; var _fitAdd = {}; var notes = [];\n'
    + 'function note(m) { notes.push(m); } function refresh() {}\n' + rules + '\n'
    + slice('  function addOverlay(o, n) {') + '\n' + slice('  function embedSize(o, style) {') + '\n' + slice('  function dropEmbed(g, X, Y, clicked) {')
    + '\nfunction __setOv(o) { _overlays = o; }', ['dropEmbed', '_layout', '_fitAdd', 'notes', '__setOv', 'sanitize', 'ovSrc', 'addOverlay']);
  const OVS = [{ key: 'me', label: 'HUD', src: 'me.html', w: 330, h: 300 },
    { key: 'tank', label: 'Tank', src: 'tank.html', w: 300, h: 280, showing: true, at: { x: 0.1, y: 0.1, w: 999, h: 999, zoom: 2 } }];
  const preset = (id) => W.PRESETS.find(p => p.id === id);

  it('the ring is the HUD\'s own square — half the screen\'s short side — clicked in at the centre', () => {
    const r = env(); r.__setOv(OVS);
    r.dropEmbed(preset('hud-ring'), null, null, true);
    const p = r._layout.panels.find(q => q.key === 'me');
    expect(p).toMatchObject({ kind: 'overlay', key: 'me', style: 'hud', name: 'HUD (ring)', w: 540, h: 540 });
    expect(p.x).toBeCloseTo((960 - 270) / 1920, 6);
    expect(p.y).toBeCloseTo((540 - 270) / 1080, 6);
    expect(r._fitAdd[p.id]).toBe(true);   // and fitted once its page has loaded
  });
  it('dragged, the ring is centred on the drop; any other overlay\'s top-left is, at the overlay\'s own default size', () => {
    const r = env(); r.__setOv(OVS);
    r.dropEmbed(preset('hud-ring'), 1000, 600, false);
    r.dropEmbed(preset('tank'), 500, 200, false);
    const ring = r._layout.panels.find(q => q.key === 'me'), tank = r._layout.panels.find(q => q.key === 'tank');
    expect(ring.x).toBeCloseTo((1000 - 270) / 1920, 6);
    expect(ring.y).toBeCloseTo((600 - 270) / 1080, 6);
    // not where (or how big) the tank's window happens to be right now
    expect(tank).toMatchObject({ kind: 'overlay', name: 'Tank', w: 300, h: 280, scale: 1, style: '' });
    expect(tank.x).toBeCloseTo(500 / 1920, 6);
    expect(tank.y).toBeCloseTo(200 / 1080, 6);
  });
  it('the ring and the box can both be here; the same look twice, or any other overlay twice, cannot', () => {
    const r = env(); r.__setOv(OVS);
    r.dropEmbed(preset('hud-ring'), null, null, true);
    r.dropEmbed(preset('hud-box'), 100, 100, false);
    expect(r._layout.panels.filter(q => q.key === 'me').map(q => q.style).sort()).toEqual(['a', 'hud']);
    r.dropEmbed(preset('hud-ring'), 400, 400, false);
    r.dropEmbed(preset('tank'), 0, 0, false);
    r.dropEmbed(preset('tank'), 0, 0, false);
    expect(r._layout.panels.filter(q => q.key === 'me')).toHaveLength(2);
    expect(r._layout.panels.filter(q => q.key === 'tank')).toHaveLength(1);
    expect(r.notes).toEqual(['HUD (ring) is already on the canvas', 'Tank is already on the canvas']);
  });
  it('a saved layout keeps both looks of the HUD and one of everything else; only the HUD has a look', () => {
    const r = env();
    const s = r.sanitize({ panels: [
      { id: 'a', kind: 'overlay', key: 'me', style: 'hud', x: 0.4, y: 0.3, w: 540, h: 540 },
      { id: 'b', kind: 'overlay', key: 'me', style: 'a', x: 0.1, y: 0.1, w: 300, h: 200 },
      { id: 'c', kind: 'overlay', key: 'me', style: 'hud', x: 0.2, y: 0.2, w: 300, h: 200 },
      { id: 'd', kind: 'overlay', key: 'me', style: '<script>', x: 0.2, y: 0.2, w: 300, h: 200 },
      { id: 'e', kind: 'overlay', key: 'charm', style: 'hud', x: 0.2, y: 0.2, w: 300, h: 200 },
      { id: 'f', kind: 'overlay', key: 'charm', x: 0.2, y: 0.2, w: 300, h: 200 },
    ] });
    const ov = s.panels.filter(p => p.kind === 'overlay');
    expect(ov.map(p => [p.id, p.key, p.style])).toEqual([['a', 'me', 'hud'], ['b', 'me', 'a'], ['d', 'me', ''], ['e', 'charm', '']]);
  });
  it('the page is loaded in its look: ?wpstyle= after the canvas mark, and only where there is one', () => {
    const r = env(); r.__setOv(OVS.concat([{ key: 'charm', src: 'charm.html' }]));
    expect(r.ovSrc('me', 'hud')).toBe('me.html?wpcanvas=1&wpstyle=hud');
    expect(r.ovSrc('me', 'a')).toBe('me.html?wpcanvas=1&wpstyle=a');
    expect(r.ovSrc('me')).toBe('me.html?wpcanvas=1');
    expect(r.ovSrc('charm', '')).toBe('charm.html?wpcanvas=1');
    expect(/[?&]wpcanvas=1(&|$)/.test(r.ovSrc('me', 'hud'))).toBe(true);   // the preload still knows it is on the canvas
  });
});

describe('Fit to content', () => {
  // fitEmbed over a fake frame; the panel and what the page would say.
  function fit(panel, page, grow) {
    const placed = [];
    const wrap = page.wrap || null;
    const e = { frame: { contentWindow: { wpFitSize: page.hook }, contentDocument: { body: {}, getElementById: (id) => (id === 'wrap' ? wrap : null), querySelector: () => page.hud || null } } };
    const env = evalBlock('var window = { innerWidth: 1920, innerHeight: 1080 }; var _menuFor = null; var _widen = {}; var _els = {}; var saved = 0; var placed = [];\n'
      + rules + '\nfunction place(e, p) { placed.push([p.w, p.h]); } function save() { saved++; } function placeGbox() {} function placeMenu() {}\n'
      + slice('  function embedWant(e) {') + '\n' + slice('  function fitEmbed(id, grow) {') + '\nfunction __set(p, e) { _layout.panels = [p]; _els[p.id] = e; }',
    ['fitEmbed', '_layout', '__set', 'placed']);
    env.__set(Object.assign({ id: 'o1', kind: 'overlay', key: 'tank', x: 0.4, y: 0.2, scale: 1 }, panel), e);
    const ok = env.fitEmbed('o1', grow);
    return { ok, p: env._layout.panels[0], placed: env.placed };
  }
  const wrap = (o) => Object.assign({ scrollWidth: 300, clientWidth: 300, offsetTop: 0, scrollHeight: 120 }, o);

  it('the height of the page\'s content, exactly (the menu\'s ↕ Fit to content)', () => {
    const r = fit({ w: 300, h: 240 }, { wrap: wrap() }, false);
    expect(r.ok).toBe(true);
    expect([r.p.w, r.p.h]).toEqual([300, 120]);
    expect(r.placed).toEqual([[300, 120]]);
  });
  it('as wide as the content only where the content is wider than the panel — a page\'s width is the raider\'s call', () => {
    expect(fit({ w: 300, h: 240 }, { wrap: wrap({ scrollWidth: 360 }) }, false).p.w).toBe(360);
    expect(fit({ w: 400, h: 240 }, { wrap: wrap() }, false).p.w).toBe(400);
  });
  it('in the panel\'s own pixels when it is scaled up, and never taller than the screen', () => {
    expect(fit({ w: 300, h: 240, scale: 1.5 }, { wrap: wrap() }, false).p.h).toBe(180);
    expect(fit({ w: 300, h: 240 }, { wrap: wrap({ scrollHeight: 9000 }) }, false).p.h).toBe(1080);
  });
  it('a page with a .hud card and no #wrap is measured on the card (the DPS meter)', () => {
    expect(fit({ w: 300, h: 240 }, { hud: wrap({ scrollHeight: 150 }) }, false).p.h).toBe(150);
  });
  it('just added, a page with nothing to show yet only grows the panel — it never shrinks it to a sliver', () => {
    expect(fit({ w: 300, h: 240 }, { wrap: wrap({ scrollHeight: 40 }) }, true).p.h).toBe(240);
    expect(fit({ w: 300, h: 240 }, { wrap: wrap({ scrollHeight: 400 }) }, true).p.h).toBe(400);
  });
  it('a page that has a shape of its own says so (the ring), exactly, and the ring keeps its middle', () => {
    const r = fit({ x: 0.4, w: 343, h: 343 }, { hook: () => [549, 343], wrap: wrap({ scrollHeight: 10 }) }, true);
    expect([r.p.w, r.p.h]).toEqual([549, 343]);
    expect(r.p.x).toBeCloseTo((0.4 * 1920 - (549 - 343) / 2) / 1920, 6);
  });
  it('a page that is not there yet, or cannot be read, leaves the panel as it is', () => {
    const none = fit({ w: 300, h: 240 }, {}, false);
    expect(none.ok).toBe(false);
    expect([none.p.w, none.p.h]).toEqual([300, 240]);
    expect(fit({ w: 300, h: 240 }, { hook: () => { throw new Error('mid-load'); } }, false).ok).toBe(false);
  });
  it('is on the panel\'s settings, and runs on its own after a preset is added (three looks as the data comes in)', () => {
    expect(c).toContain('data-fitc title="Make the panel as big as what the page shows right now">↕ Fit to content');
    expect(c).toMatch(/else if \(t\.hasAttribute\('data-fitc'\)\) \{ delete _fitAdd\[p\.id\]; setTimeout\(function \(\) \{ fitEmbed\(p\.id, false\); \}, 0\); \}/);
    expect(c).toContain('[700, 2000, 4500].forEach(function (ms, i, all) {');
    expect(c).toMatch(/if \(_fitAdd\[p\.id\] === true\) \{ _fitAdd\[p\.id\] = 'run'; scheduleFit\(p\.id\); \}/);
    // sizing it by hand ends the automatic fit
    expect(c).toMatch(/p\.w = Math\.round\(d\.w\); p\.h = Math\.round\(d\.h\); delete _fitAdd\[p\.id\]; save\(\);/);
  });
});

describe('an overlay panel is the page, with nothing of the canvas\'s own around it', () => {
  const css = stripCss(canvas);
  it('no plate, border or padding by default; the dashed outline is arranging\'s alone', () => {
    expect(css).toContain('.panel.ov{background:transparent;border:0;padding:0}');
    // No rule for the panel that holds an overlay paints anything but nothing behind it.
    const ruleFor = [...css.matchAll(/([^{}]*\.panel\.ov[^{}]*)\{([^}]*)\}/g)].map(m => [m[1].trim(), m[2]]);
    expect(ruleFor.length).toBeGreaterThan(1);
    for (const [sel, body] of ruleFor) {
      const bg = (body.match(/(?:^|;)\s*background(?:-color)?:\s*([^;]+)/) || [])[1];
      if (bg) expect(bg.trim(), sel).toBe('transparent');
      expect(body, sel).not.toMatch(/(?:^|;)\s*border:\s*1px/);
    }
    // the plate that exists is the piece's, and a hand-set Background on a piece
    expect(css).toMatch(/\.panel\.part\.back > \.pbody\{background:rgba\(13,17,23,var\(--bg-alpha,0\.72\)\);border:1px solid #30363d/);
    expect(css).toContain('body.edit .panel{outline:1px dashed');
  });
  it('click-through is untouched: arranging blocks the page, only an open builder gets the mouse back', () => {
    expect(css).toContain('body.edit .panel > iframe{pointer-events:none}');
    expect(css).toContain('body.edit .panel.building > iframe{pointer-events:auto}');
    expect(c).toMatch(/if \(_edit\) e\.root\.setAttribute\('data-wp-interact', ''\); else e\.root\.removeAttribute\('data-wp-interact'\);/);
  });
  it('the always-on ✥ is still on every panel, a preset\'s included', () => {
    expect(c).toMatch(/mv\.className = 'mvbtn';\s*mv\.textContent = '✥';\s*mv\.setAttribute\('data-wp-interact', ''\);/);
  });
  it('and every page drops the margin it kept for the ✥/✕ the canvas now owns', () => {
    const read = (f) => stripCss(readSource(mimic(f)));
    // [page, rules it adds under body.wp-in-canvas]
    const PAGES = [
      ['overlay.html', ['body.wp-in-canvas .hud{margin:0;padding:4px 6px}', 'body.wp-in-canvas .tabs{margin-right:0}']],
      ['tank.html', ['body.wp-in-canvas #wrap{padding:2px 3px}']],
      ['chchain.html', ['body.wp-in-canvas #wrap{padding:2px 3px}', 'body.wp-in-canvas .head{padding-left:0}']],
      ['threatmeter.html', ['body.wp-in-canvas #wrap{padding:2px 3px}', 'body.wp-in-canvas .head{padding-left:0;padding-right:0}']],
      ['extarget.html', ['body.wp-in-canvas #wrap{padding:2px 3px}', 'body.wp-in-canvas .head{padding-left:0;padding-right:0}']],
      ['zealhealth.html', ['body.wp-in-canvas #wrap{padding:2px 3px}', 'body.wp-in-canvas .title{padding-left:0;padding-right:0}']],
      ['charm.html', ['body.wp-in-canvas #wrap{padding:2px 3px}', 'body.wp-in-canvas #list > .cm:first-child{padding-left:5px;padding-right:5px}']],
      ['who.html', ['body.wp-in-canvas #wrap{padding:2px 3px}', 'body.wp-in-canvas .title{padding-right:0}']],
      ['pets.html', ['body.wp-in-canvas #wrap{padding:2px 3px}']],
      ['popraid.html', ['body.wp-in-canvas #wrap{padding:2px 3px}', 'body.wp-in-canvas .navbtns{margin-right:0}']],
      ['buffqueue.html', ['body.wp-in-canvas #wrap{padding:2px 3px}', 'body.wp-in-canvas .clsPick{margin-right:0}', 'body.wp-in-canvas #lag-btn{margin-right:0 !important}']],
      ['mobinfo.html', ['body.wp-in-canvas #wrap{padding:2px 3px}', 'body.wp-in-canvas .tabs{margin-right:0}', 'body.wp-in-canvas .loot{padding-top:0}', 'body.wp-in-canvas .spec{padding-top:0 !important}']],
      ['melody.html', ['body.wp-in-canvas #wrap{margin:0;padding:4px 6px}', 'body.wp-in-canvas.dirge-on #wrap{padding-bottom:24px}', 'body.wp-in-canvas .dsw{margin-right:0}']],
      ['me.html', ['body.wp-in-canvas #wrap{padding:2px 3px}', 'body.wp-in-canvas.hud #wrap{padding:0}', 'body.wp-in-canvas .card{padding:0}', 'body.wp-in-canvas .title{padding-left:0;padding-right:0}']],
    ];
    for (const [f, add] of PAGES) {
      const page = read(f);
      for (const r of add) expect(page, f + ' ' + r).toContain(r);
      // …tighter than what the window had
      const base = page.match(/#wrap\{padding:(\d+)px (\d+)px/);
      if (base && add.some(r => /#wrap\{padding:2px 3px\}/.test(r))) { expect(+base[1]).toBeGreaterThan(2); expect(+base[2]).toBeGreaterThan(3); }
    }
  });
  it('and nothing here changes how the preload hides the page\'s own ✥/✕', () => {
    expect(stripJs(readSource(mimic('preload.js')))).toContain("st.textContent = '#move-btn,#hide-btn,#drag-controls,#setupbar{display:none!important}';");
  });
});

describe('me.html honours ?wpstyle — the ring and the box are one page twice', () => {
  const pin = (search, before = {}) => {
    const classes = new Set();
    const env = new Function('window', 'document', 'style', '_firstRun',
      sliceBlock(meHtml, '  var _pinStyle = null;', "document.body.classList.add('pinstyle'); }") + '\nreturn { style, _firstRun, _pinStyle };')(
      { location: { search } }, { body: { classList: { add: (k) => classes.add(k) } } }, before.style || 'hud', before.firstRun != null ? before.firstRun : true);
    return Object.assign(env, { classes });
  };
  it('?wpstyle=hud and =a pin the look, ignoring a saved pick, and mark the page pinned', () => {
    expect(pin('?wpcanvas=1&wpstyle=hud', { style: 'a' })).toMatchObject({ style: 'hud', _pinStyle: 'hud' });
    expect(pin('?wpcanvas=1&wpstyle=a', { style: 'hud' })).toMatchObject({ style: 'a', _pinStyle: 'a' });
    expect(pin('?wpstyle=a').classes.has('pinstyle')).toBe(true);
  });
  it('a pinned page is never a first run, so it never writes the HUD window\'s saved pick', () => {
    expect(pin('?wpstyle=hud', { firstRun: true })._firstRun).toBe(false);
    const body = stripJs(meHtml);
    // the two places that write the pick are the picker (shut for a pinned page) and the first-run block
    expect(body).toContain('if (!b || _pinStyle) return;');
    expect(body).toMatch(/if \(_firstRun && isHud\(style\)\) \{/);
    expect(body.match(/localStorage\.setItem\(STYLE_KEY/g)).toHaveLength(2);
  });
  it('anything else — no param, a junk one — leaves the page on its own pick', () => {
    for (const s of ['', '?wpcanvas=1', '?wpstyle=b', '?wpstyle=HUD', '?wpstyle=']) {
      const r = pin(s, { style: 'a', firstRun: true });
      expect(r, s).toMatchObject({ style: 'a', _pinStyle: null, _firstRun: true });
      expect(r.classes.size, s).toBe(0);
    }
  });
  it('the pinned ring has only its ⚙ (no Box | HUD); the pinned box has no picker at all', () => {
    const css = stripCss(meHtml);
    expect(css).toContain('body.pinstyle #picker button[data-v]{display:none}');
    expect(css).toContain('body.pinstyle:not(.hud) #picker{display:none}');
    expect(css).toContain('body.hud.pinstyle{--pk-w:26px}');
    // …and the HUD's own window is as it was: its row is still 88px, with all three buttons
    expect(css).toContain('body.hud{--ring-x:0px;--pk-w:88px}');
  });
  it('knows it is a panel from ?wpcanvas=1, and only inside a frame', () => {
    // framed: window.parent is some other window; a top-level page is its own parent.
    const win = (search, framed) => { const w = { location: { search } }; w.parent = framed ? {} : w; return w; };
    const inCanvas = (w) => new Function('window', sliceBlock(meHtml, '  var IN_CANVAS = false;', 'catch (e) {}\n') + '\nreturn IN_CANVAS;')(w);
    expect(inCanvas(win('?wpcanvas=1', true))).toBe(true);
    expect(inCanvas(win('?wpcanvas=1&wpstyle=hud', true))).toBe(true);
    expect(inCanvas(win('?wpcanvas=1', false))).toBe(false);
    expect(inCanvas(win('?wpcanvas=10', true))).toBe(false);
    expect(inCanvas(win('', true))).toBe(false);
  });
  it('a panel that is the ring cannot speak: the page has no voice', () => {
    expect(stripJs(meHtml)).not.toMatch(/speechSynthesis|\.speak\(/);
  });
});

describe('the HUD builder, docked: it widens the panel, never the window', () => {
  const rig = (inCanvas, widenAnswer = 'right') => {
    const log = { setBounds: [], widen: [], stored: [], props: {}, classes: new Set() };
    const builderEl = { hidden: true };
    const win = { screenX: 100, screenY: 50, outerWidth: 400, outerHeight: 400,
      parent: { wpCanvasWiden: (w, px, on) => { log.widen.push([px, on]); return on ? widenAnswer : true; } } };
    const doc = { documentElement: { clientWidth: 343, clientHeight: 343, style: { setProperty: (k, v) => { log.props[k] = v; }, removeProperty: (k) => { delete log.props[k]; } } },
      body: { classList: { add: (...cs) => cs.forEach(k => log.classes.add(k)), remove: (...cs) => cs.forEach(k => log.classes.delete(k)),
        toggle: (k, on) => { if (on) log.classes.add(k); else log.classes.delete(k); } } } };
    const ls = { setItem: (k, v) => log.stored.push(['set', k, v]), getItem: () => null, removeItem: (k) => log.stored.push(['rm', k]) };
    const fns = new Function('IN_CANVAS', 'window', 'document', 'screen', 'localStorage', 'builderEl', 'renderBuilder', 'setBounds', 'hoverOff',
      'var PANEL_W = 300, BUILD_KEY = "wpHudPreBuild";\n' + sliceBlock(meHtml, '  function canvasWiden(on){', '    hoverOff();\n  }\n') + '\nreturn { openBuilder, closeBuilder };')(
      inCanvas, win, doc, { availLeft: 0, availWidth: 1920, availHeight: 1080 }, ls, builderEl, () => { log.rendered = true; }, (b) => log.setBounds.push(b), () => {});
    return Object.assign(fns, { log, builderEl });
  };
  it('open: the canvas is asked for the builder\'s width; the ring keeps the width it had; no window is resized or remembered', () => {
    const r = rig(true);
    r.openBuilder();
    expect(r.log.widen).toEqual([[300, true]]);
    expect(r.log.setBounds).toEqual([]);
    expect(r.log.stored).toEqual([]);                    // wpHudPreBuild is the HUD window's size, not a panel's
    expect(r.log.props).toEqual({ '--ring-w': '343px', '--ring-h': '343px' });
    expect([...r.log.classes].sort()).toEqual(['building']);
    expect(r.builderEl.hidden).toBe(false);
    expect(r.log.rendered).toBe(true);
  });
  it('open toward the left when the canvas says that is where it grew', () => {
    const r = rig(true, 'left');
    r.openBuilder();
    expect([...r.log.classes].sort()).toEqual(['build-left', 'building']);
  });
  it('close: the canvas is told to give the width back; still nothing about a window', () => {
    const r = rig(true);
    r.openBuilder();
    r.closeBuilder();
    expect(r.log.widen).toEqual([[300, true], [300, false]]);
    expect(r.log.setBounds).toEqual([]);
    expect(r.log.stored).toEqual([]);
    expect(r.log.props).toEqual({});
    expect(r.log.classes.size).toBe(0);
    expect(r.builderEl.hidden).toBe(true);
  });
  it('a page nobody can widen opens nothing (no canvas to ask, nothing to open beside the ring)', () => {
    const r = rig(true, false);
    r.openBuilder();
    expect(r.builderEl.hidden).toBe(true);
    expect(r.log.classes.size).toBe(0);
  });
  it('the HUD\'s own window is as it was: it grows the WINDOW and remembers the size it had', () => {
    const r = rig(false);
    r.openBuilder();
    expect(r.log.widen).toEqual([]);
    expect(r.log.setBounds).toEqual([{ x: 100, y: 50, width: 700, height: 400 }]);
    expect(r.log.stored).toEqual([['set', 'wpHudPreBuild', JSON.stringify({ x: 100, y: 50, width: 400, height: 400 })]]);
  });
  it('the numbers moving outside the ring ask the canvas to fit the panel again, and keep the ring\'s width', () => {
    const calls = { fit: 0, bounds: 0, props: {} };
    const run = (building) => {
      calls.fit = 0; calls.bounds = 0; calls.props = {};
      new Function('IN_CANVAS', 'isHud', 'style', 'window', 'document', 'builderEl', 'PANEL_W', 'LANE_EXT', 'setBounds',
        sliceBlock(meHtml, '  function reshapeForHits(was, now){', '\n  }\n') + '\nreshapeForHits("inside", "outside");')(
        true, () => true, 'hud', { parent: { wpCanvasFit: () => { calls.fit++; } } },
        { documentElement: { clientWidth: 643, style: { setProperty: (k, v) => { calls.props[k] = v; } } } }, { hidden: !building }, 300, 120, () => { calls.bounds++; });
    };
    run(false);
    expect(calls).toEqual({ fit: 1, bounds: 0, props: {} });
    run(true);
    expect(calls).toEqual({ fit: 1, bounds: 0, props: { '--ring-w': '343px' } });   // the panel is 300 wider than the ring while it is open
  });
  it('the page says how big its ring wants to be: a square at the height it has, wider for numbers outside it', () => {
    const ask = (style, side, factor) => new Function('isHud', 'style', 'document', 'hudWidthFactor', 'window',
      sliceBlock(meHtml, '  window.wpFitSize = function(){', '\n  };\n') + '\nreturn window.wpFitSize();')(
      (v) => v === 'hud', style, { documentElement: { clientHeight: side } }, () => factor, {});
    expect(ask('hud', 343, 1)).toEqual([343, 343]);
    expect(ask('hud', 343, 1.6)).toEqual([549, 343]);
    expect(ask('a', 343, 1)).toBeNull();                 // the box is measured by the canvas like any page
    expect(ask('hud', 0, 1)).toBeNull();
  });
  it('the canvas widens toward the side with room, by the builder\'s width times the panel\'s scale — and undoes it', () => {
    const rigW = (panel, geom) => {
      const classes = new Set(), frameWin = {}, placed = [];
      const e = { frame: { contentWindow: frameWin }, root: { offsetLeft: geom.x, offsetWidth: geom.w, classList: { add: (k) => classes.add(k), remove: (k) => classes.delete(k) } } };
      const p = Object.assign({ id: 'o1', kind: 'overlay', key: 'me', style: 'hud', scale: 1 }, panel);
      const env = new Function('placed', 'e', 'panel',
        'var window = { innerWidth: 1920, innerHeight: 1080 }; var _widen = {}; var _els = {};\n' + rules
        + '\nfunction place(e, p) { placed.push(_widen[p.id] ? Object.assign({}, _widen[p.id]) : null); } function placeGbox() {}\n'
        + slice('  function panelOfWin(win) {') + '\n' + sliceBlock(canvas, '  window.wpCanvasWiden = function (win, px, on) {', '\n  };\n')
        + '\n_layout.panels = [panel]; _els[panel.id] = e;\nreturn { widen: window.wpCanvasWiden, _widen: _widen };')(placed, e, p);
      return { widen: (px, on, win) => env.widen(win || frameWin, px, on), _widen: env._widen, classes, placed };
    };
    const room = rigW({}, { x: 100, w: 343 });
    expect(room.widen(300, true)).toBe('right');
    expect(room._widen.o1).toEqual({ add: 300, left: false });
    expect(room.classes.has('building')).toBe(true);
    expect(room.placed).toEqual([{ add: 300, left: false }]);   // and the panel was placed again, wider
    expect(room.widen(300, false)).toBe(true);
    expect(room._widen.o1).toBeUndefined();
    expect(room.classes.has('building')).toBe(false);
    expect(room.placed[1]).toBeNull();                          // placed again, back at its own size
    expect(rigW({}, { x: 1500, w: 343 }).widen(300, true)).toBe('left');
    const big = rigW({ scale: 2 }, { x: 100, w: 686 });
    big.widen(300, true);
    expect(big._widen.o1.add).toBe(600);
    // only an overlay panel's page can ask, and only a page that is in a panel
    expect(rigW({ kind: 'part' }, { x: 100, w: 343 }).widen(300, true)).toBe(false);
    expect(rigW({}, { x: 100, w: 343 }).widen(300, true, {})).toBe(false);
  });
  it('a panel with its builder open is placed wider (to the left: its left edge moves, the ring does not)', () => {
    const run = (wd, p) => {
      const style = {};
      new Function('_widen', 'sizeFrame', 'e', 'p', 'window',
        sliceBlock(canvas, '  function place(e, p) {', '\n  }\n') + '\nplace(e, p);')(wd ? { o1: wd } : {}, () => {},
        { root: { style, classList: { toggle() {} } } }, p, { innerWidth: 1920, innerHeight: 1080 });
      return [style.left, style.width];
    };
    const p = { id: 'o1', x: 0.5, y: 0.2, w: 343, h: 343 };
    expect(run(null, p)).toEqual(['960px', '343px']);
    expect(run({ add: 300, left: false }, p)).toEqual(['960px', '643px']);
    expect(run({ add: 300, left: true }, p)).toEqual(['660px', '643px']);
  });
  it('moving or sizing a panel closes its builder first; a page that loads again comes back closed; the menu opens it', () => {
    const start = c.indexOf('function startDrag(ev, id, mode, anyTime) {');
    const body = c.slice(start, c.indexOf('\n  }\n', start));
    expect(body.indexOf('e.frame.contentWindow.wpCloseBuilder()')).toBeGreaterThan(0);
    expect(body.indexOf('e.frame.contentWindow.wpCloseBuilder()')).toBeLessThan(body.indexOf('_drag = {'));
    expect(c).toMatch(/if \(_widen\[p\.id\]\) \{ delete _widen\[p\.id\]; root\.classList\.remove\('building'\); place\(e, q\); \}/);
    expect(c).toContain('data-build title="Choose which parts the ring shows');
    expect(c).toMatch(/if \(bw && bw\.wpToggleBuilder\) bw\.wpToggleBuilder\(\);/);
    expect(c).toContain("(p.key === 'me' && p.style !== 'a')");
    // the page side of both
    const page = stripJs(meHtml);
    expect(page).toContain('window.wpToggleBuilder = function(){ if (isHud(style)) { if (builderEl.hidden) openBuilder(); else closeBuilder(); } };');
    expect(page).toContain('window.wpCloseBuilder = function(){ if (!builderEl.hidden) closeBuilder(); };');
  });
});
