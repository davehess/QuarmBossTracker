// test/pop-quest-nav.test.js — the PoP overlay's Quests mode as drill-down blocks: era → plane → quest, ▲ to
// climb, ◀ ▶ inside the plane (Decision Desk "Drill-down blocks", 2026-10-19;
// docs/DESIGN-history-and-quest-nav.md §3).
//
// The guild lead, 2026-10-04: "Maybe we make the catalog for quests an era/continent/plane separation in an
// easy big block way up top. the left/right can go through a specific quest or zone's quests, and we can drill
// down from top to bottom or up with the up button."
//
// Three tiers: (1) the hand-set plane table and the sync that carries it into apps/mimic/pop-quests.js;
// (2) the page's pure navigation functions, run as they stand; (3) the page's real script on a fake DOM, driven
// the way Mimic drives it. The end-of-plane ▶ question was not answered: 'stop' is the default and the behaviour
// is one constant (QUEST_PLANE_END), so the tests below run all three.
//
// Run: npx vitest run test/pop-quest-nav.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, stripCss, ROOT } from './_source-slice.js';

const MIMIC = path.join(ROOT, 'apps', 'mimic');
const popHtml = readSource(path.join(MIMIC, 'popraid.html'));
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };
const REAL = (() => { const w = {}; vm.runInNewContext(fs.readFileSync(path.join(MIMIC, 'pop-quests.js'), 'utf8'), { window: w }); return w.POP_QUESTS; })();
const allQuests = REAL.levels.flatMap(lv => lv.sections.flatMap(s => s.quests));
const req = createRequire(import.meta.url);
const planes = req('../scripts/pop-quest-planes.js');
const sync = req('../scripts/sync-pop-quests.js');

// ── 1. the table and the sync ───────────────────────────────────────────────
describe('every step has a plane', () => {
  const planeList = REAL.eras.flatMap(e => e.planes);
  const planeKeys = new Set(planeList.map(p => p.key));

  it('the generated file carries the eras, and every step names a plane that one of them lists', () => {
    expect(REAL.eras.length).toBeGreaterThan(0);
    expect(allQuests.length).toBeGreaterThan(70);
    const untagged = allQuests.filter(q => !q.plane).map(q => q.key);
    expect(untagged, 'steps with no plane').toEqual([]);
    const unknown = allQuests.filter(q => !planeKeys.has(q.plane)).map(q => q.key + ' → ' + q.plane);
    expect(unknown).toEqual([]);
  });

  it('no plane is listed twice or empty, and each has a title to draw', () => {
    expect(planeList.length).toBe(planeKeys.size);
    for (const p of planeList) {
      expect(p.title, p.key).toBeTruthy();
      expect(allQuests.some(q => q.plane === p.key), p.key + ' has no step').toBe(true);
    }
  });

  it('the table has a line for every step the guide has, and no line for one it does not', () => {
    const keys = new Set(allQuests.map(q => q.key));
    expect(Object.keys(planes.PLANE_OF).filter(k => !keys.has(k))).toEqual([]);
    expect([...keys].filter(k => !planes.PLANE_OF[k])).toEqual([]);
    for (const q of allQuests) expect(q.plane, q.key).toBe(planes.PLANE_OF[q.key]);
  });

  it('the sync writes exactly what is in the file: each step\'s plane, and the eras with their planes in block order', async () => {
    const built = sync.build(await sync.loadGuide());
    expect(built.eras).toEqual(planes.ERAS.map(e => ({ key: e.key, title: e.title, planes: e.planes.map(p => ({ key: p.key, title: p.title })) })));
    expect(built.levels.flatMap(lv => lv.sections.flatMap(s => s.quests)).map(q => [q.key, q.plane])).toEqual(allQuests.map(q => [q.key, q.plane]));
    expect(built).toEqual(REAL);
  });

  it('the sync stops on a new step with no plane, on a plane no step uses, and on a table line for a step that is gone', async () => {
    const g = await sync.loadGuide();
    expect(() => sync.build(g)).not.toThrow();
    const item = { ...g.GUIDE_ITEMS[0], key: 'brand_new_step' };
    expect(() => sync.build({ ...g, GUIDE_ITEMS: [...g.GUIDE_ITEMS, item] })).toThrow(/brand_new_step has no plane/);
    planes.ERAS[0].planes.push({ key: 'ghost', title: 'A plane with nothing in it' });
    try { expect(() => sync.build(g)).toThrow(/planes no step is in: ghost/); }
    finally { planes.ERAS[0].planes.pop(); }
    planes.PLANE_OF.gone_step = planes.ERAS[0].planes[0].key;
    try { expect(() => sync.build(g)).toThrow(/no longer has: gone_step/); }
    finally { delete planes.PLANE_OF.gone_step; }
    planes.PLANE_OF.brand_new_step = 'nowhere';
    try { expect(() => sync.build({ ...g, GUIDE_ITEMS: [...g.GUIDE_ITEMS, item] })).toThrow(/unknown plane nowhere/); }
    finally { delete planes.PLANE_OF.brand_new_step; }
  });
});

// ── 2. the pure navigation block, run as it stands ──────────────────────────
const ESC_SRC = sliceBlock(popHtml, 'function esc(s){', '[c]); }); }');
const BLOCK = sliceBlock(popHtml, '// ── PoP quests — renderers', '// ── /PoP quests — renderers');
const N = evalBlock(ESC_SRC + '\n' + BLOCK,
  ['qBuildIndex', 'qStepIdx', 'qPlaneOf', 'qBlockHtml', 'qErasHtml', 'qPlanesHtml', 'qListHtml', 'qCrumb', 'questMiniHtml', 'QUEST_PLANE_END']);

// Four invented steps in two eras: a, b in plane p1; c in p2 (era one); d in p3 (era two).
const FIX = {
  eras: [
    { key: 'e1', title: 'Era One', planes: [{ key: 'p1', title: 'Plane One' }, { key: 'p2', title: 'Plane Two' }] },
    { key: 'e2', title: 'Era Two', planes: [{ key: 'p3', title: 'Plane Three' }] },
  ],
  levels: [
    { key: 'l1', title: 'Level One', sub: '', color: '#aa0000', sections: [{ key: 's1', title: 'S1', quests: [
      { key: 'qa', title: 'Quest A', plane: 'p1', who: 'solo' },
      { key: 'qc', title: 'Quest C', plane: 'p2', who: 'group', must: true },
      { key: 'qb', title: 'Quest B', plane: 'p1', who: 'raid' },
    ] }] },
    { key: 'l2', title: 'Level Two', sub: '', color: '#00aa00', sections: [{ key: 's2', title: 'S2', quests: [
      { key: 'qd', title: 'Quest D', plane: 'p3', who: 'solo' },
    ] }] },
  ],
};
const flat = (db) => db.levels.flatMap(lv => lv.sections.flatMap(sec => sec.quests.map(q => ({ q, level: lv, sec }))));

describe('the plane index', () => {
  const quests = flat(FIX);
  const idx = N.qBuildIndex(FIX, quests);

  it('planes in the file\'s order, each holding its steps in guide order (a plane need not be contiguous)', () => {
    expect(idx.order).toEqual(['p1', 'p2', 'p3']);
    expect(idx.planes.p1.idxs).toEqual([0, 2]);    // qa, qb: qc sits between them in the guide
    expect(idx.planes.p2.idxs).toEqual([1]);
    expect(idx.planes.p3.idxs).toEqual([3]);
    expect(idx.planes.p1.color).toBe('#aa0000');
    expect(idx.eras.map(e => [e.key, e.planes])).toEqual([['e1', ['p1', 'p2']], ['e2', ['p3']]]);
  });

  it('every step is in exactly one plane, on the real guide too', () => {
    const real = flat(REAL);
    const ri = N.qBuildIndex(REAL, real);
    const seen = ri.order.flatMap(k => ri.planes[k].idxs).sort((a, b) => a - b);
    expect(seen).toEqual(real.map((_, i) => i));
    expect(ri.order).toEqual(REAL.eras.flatMap(e => e.planes.map(p => p.key)));
  });

  it('a step whose plane the file does not know goes in an "Other steps" block rather than out of reach', () => {
    const old = flat({ levels: FIX.levels.map(lv => ({ ...lv, sections: lv.sections.map(s => ({ ...s, quests: s.quests.map(({ plane, ...q }) => q) })) })) });
    const oi = N.qBuildIndex({ levels: [] }, old);
    expect(oi.eras.map(e => e.title)).toEqual(['Other steps']);
    expect(oi.planes[''].idxs).toEqual([0, 1, 2, 3]);
  });
});

describe('◀ ▶ inside the plane', () => {
  const quests = flat(FIX);
  const idx = N.qBuildIndex(FIX, quests);
  const step = (i, dir, rule) => N.qStepIdx(quests, idx, i, dir, rule);

  it('the default is "stop" and it is one constant', () => {
    expect(N.QUEST_PLANE_END).toBe('stop');
    expect(stripJs(popHtml).match(/QUEST_PLANE_END/g).length).toBeGreaterThan(3);
    expect(stripJs(popHtml).match(/var QUEST_PLANE_END = '/g).length).toBe(1);
  });

  it('inside a plane ▶ and ◀ skip the other planes\' steps between', () => {
    expect(step(0, 1, 'stop')).toBe(2);    // A → B, over C
    expect(step(2, -1, 'stop')).toBe(0);
  });

  it('stop: the plane\'s last step has no ▶ and its first no ◀', () => {
    expect(step(2, 1, 'stop')).toBe(-1);
    expect(step(0, -1, 'stop')).toBe(-1);
    expect(step(1, 1, 'stop')).toBe(-1);   // a plane of one step goes nowhere
  });

  it('wrap: the ends go round to the other end of the same plane; a plane of one step stays put', () => {
    expect(step(2, 1, 'wrap')).toBe(0);
    expect(step(0, -1, 'wrap')).toBe(2);
    expect(step(1, 1, 'wrap')).toBe(-1);
  });

  it('hop: the ends go on into the next plane in block order, and stop at the last and the first plane', () => {
    expect(step(2, 1, 'hop')).toBe(1);     // p1's last → p2's first
    expect(step(1, 1, 'hop')).toBe(3);     // p2 → p3, into the next era
    expect(step(3, 1, 'hop')).toBe(-1);
    expect(step(1, -1, 'hop')).toBe(2);    // back lands on the previous plane's LAST step
    expect(step(0, -1, 'hop')).toBe(-1);
  });

  it('a step the index does not know goes nowhere', () => {
    expect(step(99, 1, 'stop')).toBe(-1);
  });
});

describe('the block screens', () => {
  const quests = flat(FIX);
  const idx = N.qBuildIndex(FIX, quests);

  it('eras: one big block each, with how many planes and steps it holds, the one you are in marked', () => {
    const h = N.qErasHtml(idx, 'e1');
    expect(h).toContain('<button type="button" class="qblock era cur" data-nav="era" data-key="e1">');
    expect(h).toContain('2 planes · 3 steps');
    expect(h).toContain('<button type="button" class="qblock era" data-nav="era" data-key="e2">');
    expect(h).toContain('1 plane · 1 step<');
  });

  it('planes: the era\'s planes in block order, coloured by their level, the current one marked, under a crumb', () => {
    const h = N.qPlanesHtml(idx, 'e1', 'p2');
    expect(h.indexOf('data-key="p1"')).toBeLessThan(h.indexOf('data-key="p2"'));
    expect(h).not.toContain('data-key="p3"');
    expect(h).toContain('data-key="p1" style="border-left-color:#aa0000"');
    expect(h).toMatch(/class="qblock cur" data-nav="plane" data-key="p2"/);
    expect(h).toContain('<div class="crumb">Era One</div>');
  });

  it('steps: a plane\'s steps numbered in order, with who they are for, the open one marked', () => {
    const h = N.qListHtml(idx, quests, 'p1', 2);
    expect(h.indexOf('1. Quest A')).toBeLessThan(h.indexOf('2. Quest B'));
    expect(h).not.toContain('Quest C');
    expect(h).toMatch(/class="qblock qq cur" data-nav="quest" data-key="qb"/);
    expect(h).toContain('<span class="qbs">Solo</span>');
    expect(h).toContain('<div class="crumb">Era One › Plane One</div>');
    expect(N.qListHtml(idx, quests, 'p2', 1)).toContain('<span class="qbs">Group · ★ must</span>');
  });

  it('a single era is not named in the crumb', () => {
    const one = N.qBuildIndex({ eras: [FIX.eras[0]], levels: FIX.levels.map(lv => ({ ...lv, sections: lv.sections.map(s => ({ ...s, quests: s.quests.filter(q => q.plane !== 'p3') })) })) }, flat(FIX).filter(e => e.q.plane !== 'p3'));
    expect(N.qCrumb(one, 'e1', 'p1')).toBe('<div class="crumb">Plane One</div>');
  });

  it('every block is a <button>, which the preload arms on a locked overlay, and a name cannot break out of it', () => {
    const h = N.qBlockHtml('plane', 'k"><img>', '<img src=x>', '<b>', '#fff"><script>', false, '');
    expect(h.startsWith('<button type="button" class="qblock"')).toBe(true);
    expect(h).not.toContain('<img');
    expect(h).not.toContain('<script');
    expect(h).not.toContain('<b>');
  });

  it('mini: the next row is the next step in the plane, and says so at the end of it', () => {
    expect(N.questMiniHtml(quests, 0, 2)).toContain('next · Quest B');
    const end = N.questMiniHtml(quests, 2, -1);
    expect(end).not.toContain('qnext');
    expect(end).toContain('last step in this plane');
  });
});

// ── 3. the page, on a fake DOM ──────────────────────────────────────────────
const inlineScript = (html) => { const o = html.indexOf('<script>'); return html.slice(o + 8, html.indexOf('</script>', o)); };
const markupOf = (html) => html.slice(html.indexOf('<body>'), html.indexOf('<script'));
function fakeEl(id, { tag = 'div', classes = [], attrs = {}, parent = null } = {}) {
  const cls = new Set(classes), on = {};
  return {
    id, tag, parent, attrs, style: {}, value: '', textContent: '', _html: '', title: '', disabled: false, scrollTop: 0,
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    classList: {
      add: (c) => { cls.add(c); }, remove: (c) => { cls.delete(c); }, contains: (c) => cls.has(c),
      toggle: (c, force) => { const want = force === undefined ? !cls.has(c) : !!force; if (want) cls.add(c); else cls.delete(c); return want; },
    },
    addEventListener(ev, fn) { (on[ev] ||= []).push(fn); },
    fire(ev, evt) { for (const fn of on[ev] || []) fn(evt || {}); },
    getAttribute(a) { return a in attrs ? attrs[a] : null; }, setAttribute(a, v) { attrs[a] = String(v); },
    removeAttribute(a) { delete attrs[a]; }, hasAttribute(a) { return a in attrs; }, focus() {},
    closest(sel) {
      const parts = sel.split(',').map(x => x.trim());
      const hit = (n, p) => (p[0] === '.' ? n.classList.contains(p.slice(1)) : p[0] === '#' ? n.id === p.slice(1) : n.tag === p);
      for (let n = this; n; n = n.parent) if (parts.some(p => hit(n, p))) return n;
      return null;
    },
  };
}
const RAIDS = { imageBase: 'https://img.invalid/', quarmGlobalNotes: [], sections: [{ id: 'tac', title: 'Tier 3', encounters: [{ id: 'rz', name: 'Rallos Zek', zone: 'Plane of Testing' }] }] };
function bootPop({ quests = FIX, store = {}, mini = false, script = (s) => s } = {}) {
  const ids = [...markupOf(popHtml).matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const byId = Object.fromEntries(ids.map(id => [id, fakeEl(id)]));
  const body = fakeEl('body', { tag: 'body' });
  if (mini) body.classList.add('wp-mini');
  const dom = { on: {}, body, documentElement: { style: { setProperty() {} } },
    addEventListener(ev, fn) { (dom.on[ev] ||= []).push(fn); }, fire(ev, evt) { for (const fn of dom.on[ev] || []) fn(evt); },
    getElementById: (id) => byId[id] || null };
  const wOn = {};
  const window = {
    mimic: { autoFitOverlay() {}, overlayAutoHeight() {}, overlayHoverInteractive() {}, openExternal() {} },
    POP_RAIDS: RAIDS, POP_QUESTS: quests,
    addEventListener(ev, fn) { (wOn[ev] ||= []).push(fn); }, fire(ev) { for (const fn of wOn[ev] || []) fn({ type: ev }); },
  };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const run = new Function('window', 'document', 'fetch', 'localStorage', 'setInterval', 'setTimeout', 'navigator',
    script(inlineScript(popHtml)) + '\nreturn {};');
  run(window, dom, async () => ({ json: async () => ({ rev: 1, encounters: {} }) }), localStorage, () => 0, () => 0, {});
  const setMini = async (on) => { body.classList.toggle('wp-mini', on); window.fire('wp-mini-change'); await flush(); };
  // A block as the page drew it: same data-nav and data-key, as a clickable element would have.
  const block = (nav, key) => {
    expect(byId.content.innerHTML, 'block ' + nav + ' ' + key).toContain('data-nav="' + nav + '" data-key="' + key + '"');
    return fakeEl('', { tag: 'button', classes: ['qblock'], attrs: { 'data-nav': nav, 'data-key': key } });
  };
  const click = (el) => byId.content.fire('click', { target: el });
  const title = () => (byId.content.innerHTML.match(/<div class="nm">([^<]+)<\/div>/) || [])[1];
  const pos = () => (byId.content.innerHTML.match(/<span class="pos">([^<]+)<\/span>/) || [])[1];
  return { byId, body, store, setMini, block, click, title, pos, content: () => byId.content.innerHTML, up: () => byId.upBtn.fire('click'), prev: () => byId.prevBtn.fire('click'), next: () => byId.nextBtn.fire('click') };
}
const openQuests = (opts) => { const h = bootPop(opts); h.byId.modeQuests.fire('click'); return h; };

describe('Quests mode: the step, and ◀ ▶ inside its plane', () => {
  it('opens on the step as it always did, now numbered inside its plane under a crumb', () => {
    const h = openQuests();
    expect(h.title()).toBe('Quest A');
    expect(h.pos()).toBe('1/2');
    expect(h.content()).toContain('<div class="crumb">Era One › Plane One</div>');
    expect(h.content()).toContain('S1');
  });

  it('▶ skips the other planes\' steps and then stops: disabled, with a tooltip that says so', () => {
    const h = openQuests();
    h.next();
    expect(h.title()).toBe('Quest B');
    expect(h.pos()).toBe('2/2');
    expect(h.byId.nextBtn.disabled).toBe(true);
    expect(h.byId.nextBtn.title).toBe('That was the last step in Plane One (▲ for the planes)');
    h.next();
    expect(h.title()).toBe('Quest B');                  // a click on a disabled ▶ goes nowhere
    h.prev();
    expect(h.title()).toBe('Quest A');
    expect(h.byId.prevBtn.disabled).toBe(true);
    expect(h.byId.prevBtn.title).toBe('This is the first step in Plane One (▲ for the planes)');
    expect(h.byId.nextBtn.disabled).toBe(false);
    expect(h.byId.nextBtn.title).toBe('Next step in Plane One');
  });

  it('the end-of-plane rule is the constant: wrap goes round, hop goes on, and neither disables the button', () => {
    const swap = (rule) => (s) => { expect(s).toContain("var QUEST_PLANE_END = 'stop';"); return s.replace("var QUEST_PLANE_END = 'stop';", "var QUEST_PLANE_END = '" + rule + "';"); };
    const wrap = openQuests({ script: swap('wrap') });
    wrap.next(); wrap.next();
    expect(wrap.title()).toBe('Quest A');
    expect(wrap.byId.nextBtn.disabled).toBe(false);
    const hop = openQuests({ script: swap('hop') });
    hop.next(); hop.next();
    expect(hop.title()).toBe('Quest C');
    expect(hop.content()).toContain('Plane Two');
    hop.next();
    expect(hop.title()).toBe('Quest D');
    hop.next();
    expect(hop.byId.nextBtn.disabled).toBe(true);        // the last plane there is
  });

  it('the picker still jumps to any step, on its card, whatever screen was showing', () => {
    const h = openQuests();
    h.up();
    expect(h.content()).toContain('class="qgrid"');
    h.byId.encPick.value = 'qc'; h.byId.encPick.fire('change');
    expect(h.title()).toBe('Quest C');
    expect(h.pos()).toBe('1/1');
    expect(h.byId.nextBtn.disabled).toBe(true);
    expect(h.byId.prevBtn.disabled).toBe(true);
  });
});

describe('Quests mode: ▲ and the blocks', () => {
  it('▲ from a step shows its plane\'s steps; a block opens that step', () => {
    const h = openQuests();
    h.next();                                            // Quest B
    h.up();
    expect(h.content()).toContain('<div class="crumb">Era One › Plane One</div>');
    expect(h.content()).toMatch(/class="qblock qq cur" data-nav="quest" data-key="qb"/);
    expect(h.content()).not.toContain('Quest C');
    h.click(h.block('quest', 'qa'));
    expect(h.title()).toBe('Quest A');
  });

  it('▲ again shows the era\'s planes; a block lists that plane\'s steps; the steps open from there', () => {
    const h = openQuests();
    h.up(); h.up();
    expect(h.content()).toContain('data-nav="plane" data-key="p1"');
    expect(h.content()).toContain('data-nav="plane" data-key="p2"');
    expect(h.content()).not.toContain('data-key="p3"');          // another era's plane
    h.click(h.block('plane', 'p2'));
    expect(h.content()).toContain('1. Quest C');
    expect(h.content()).not.toContain('Quest A');
    h.click(h.block('quest', 'qc'));
    expect(h.title()).toBe('Quest C');
  });

  it('with two eras ▲ goes on to the eras, an era opens its planes, and ▲ stops there', () => {
    const h = openQuests();
    h.up(); h.up();
    expect(h.byId.upBtn.disabled).toBe(false);
    h.up();
    expect(h.content()).toContain('data-nav="era" data-key="e1"');
    expect(h.content()).toContain('data-nav="era" data-key="e2"');
    expect(h.byId.upBtn.disabled).toBe(true);
    h.up();                                                      // a click on a disabled ▲ goes nowhere
    expect(h.content()).toContain('data-nav="era" data-key="e2"');
    h.click(h.block('era', 'e2'));
    expect(h.content()).toContain('data-nav="plane" data-key="p3"');
    expect(h.content()).not.toContain('data-key="p1"');
    h.click(h.block('plane', 'p3'));
    h.click(h.block('quest', 'qd'));
    expect(h.title()).toBe('Quest D');
    expect(h.content()).toContain('<div class="crumb">Era Two › Plane Three</div>');
  });

  it('with ONE era the eras screen is skipped: ▲ stops at the planes', () => {
    const one = { ...FIX, eras: [FIX.eras[0]], levels: FIX.levels.map(lv => ({ ...lv, sections: lv.sections.map(s => ({ ...s, quests: s.quests.filter(q => q.plane !== 'p3') })) })) };
    const h = openQuests({ quests: one });
    h.up(); h.up();
    expect(h.content()).toContain('data-nav="plane"');
    expect(h.byId.upBtn.disabled).toBe(true);
    expect(h.content()).not.toContain('<div class="crumb">');    // no era to name
    h.up();                                                      // a click on the greyed ▲ does not open a one-block eras screen
    expect(h.content()).toContain('data-nav="plane"');
    expect(h.content()).not.toContain('data-nav="era"');
  });

  it('◀ ▶ are greyed on a block screen, with the reason', () => {
    const h = openQuests();
    h.up();
    expect(h.byId.prevBtn.disabled).toBe(true);
    expect(h.byId.nextBtn.disabled).toBe(true);
    expect(h.byId.nextBtn.title).toBe('Open a step to use ◀ ▶');
    h.next();
    expect(h.content()).toContain('class="qgrid"');
    expect(h.content()).toMatch(/class="qblock qq cur" data-nav="quest" data-key="qa"/);   // a click on a greyed ▶ moved nothing
    h.prev();
    expect(h.content()).toMatch(/class="qblock qq cur" data-nav="quest" data-key="qa"/);
  });

  it('opening Quests (or coming back to it) lands on the step, not on a block screen', () => {
    const h = openQuests();
    h.up(); h.up();
    h.byId.modeSlides.fire('click'); h.byId.modeQuests.fire('click');
    expect(h.title()).toBe('Quest A');
  });

  it('the tooltip names where ▲ goes, and Slides gets its own buttons back (▲ is hidden there by CSS)', () => {
    const h = openQuests();
    expect(h.byId.upBtn.title).toBe('Up: the steps of Plane One');
    h.up();
    expect(h.byId.upBtn.title).toBe('Up: the planes');
    h.byId.modeSlides.fire('click');
    expect(h.byId.prevBtn.disabled).toBe(false);
    expect(h.byId.nextBtn.disabled).toBe(false);
    expect(h.byId.prevBtn.title).toBe('Previous encounter');
    expect(h.byId.nextBtn.title).toBe('Next encounter');
    expect(stripCss(popHtml)).toMatch(/body:not\(\.quests\) #upBtn\{display:none\}/);
  });

  it('mini always shows the step, whatever screen the full overlay was on, and walks on inside the plane', async () => {
    const h = openQuests();
    h.up();
    await h.setMini(true);
    expect(h.content()).toContain('PoP · Quest A</span>');
    expect(h.content()).toContain('next · Quest B');             // not Quest C, which is another plane's
    h.click(fakeEl('', { classes: ['qnext'] }));
    expect(h.content()).toContain('PoP · Quest B</span>');
    expect(h.content()).toContain('last step in this plane');
    h.click(fakeEl('', { classes: ['qnext'] }));
    expect(h.content()).toContain('PoP · Quest B</span>');
    await h.setMini(false);
    expect(h.title()).toBe('Quest B');                           // back to the step, not to the block screen it left
  });
});

describe('Quests mode on the real guide', () => {
  const boot = (key) => openQuests({ quests: REAL, store: { 'wp:pop:mode': 'quests', 'wp:pop:quest': key } });
  const justice = allQuests.filter(q => q.plane === 'justice').map(q => q.title);

  it('Justice is five steps: the trial step is the second, ▶ walks to the last and stops there', async () => {
    const h = boot('flag_trial_justice');
    await flush();
    expect(justice.length).toBe(5);
    expect(h.title()).toBe(justice[1]);
    expect(h.pos()).toBe('2/5');
    expect(h.content()).toContain('<div class="crumb">Plane of Justice</div>');
    h.next(); h.next(); h.next();
    expect(h.title()).toBe(justice[4]);
    expect(h.byId.nextBtn.disabled).toBe(true);
    h.next();
    expect(h.title()).toBe(justice[4]);
  });

  it('from the middle of a plane ▲ greys both arrows (they only work on a step)', async () => {
    const h = boot('flag_trial_justice');
    await flush();
    expect([h.byId.prevBtn.disabled, h.byId.nextBtn.disabled]).toEqual([false, false]);
    h.up();
    expect([h.byId.prevBtn.disabled, h.byId.nextBtn.disabled]).toEqual([true, true]);
    h.click(h.block('quest', 'flag_trial_justice'));
    expect([h.byId.prevBtn.disabled, h.byId.nextBtn.disabled]).toEqual([false, false]);
  });

  it('▲ ▲ shows every plane as a block, in the order the table lists them', async () => {
    const h = boot('flag_trial_justice');
    await flush();
    h.up(); h.up();
    const keys = [...h.content().matchAll(/data-nav="plane" data-key="([^"]+)"/g)].map(m => m[1]);
    expect(keys).toEqual(REAL.eras[0].planes.map(p => p.key));
    expect(h.content()).toMatch(/class="qblock cur" data-nav="plane" data-key="justice"/);
    h.click(h.block('plane', 'time'));
    expect(h.content()).toContain('Plane of Time');
    h.click(h.block('quest', 'flag_quarm'));
    expect(h.title()).toBe(allQuests.find(q => q.key === 'flag_quarm').title);
    expect(h.byId.nextBtn.disabled).toBe(true);
  });

  it('every step is reachable by blocks alone: its plane\'s block lists it', async () => {
    const h = boot('start_flag_fixers');
    await flush();
    for (const q of allQuests) {
      for (let n = 0; n < 3 && !h.content().includes('data-nav="plane"'); n++) h.up();   // step → its plane's steps → the planes
      h.click(h.block('plane', q.plane));
      h.click(h.block('quest', q.key));
      expect(h.title(), q.key).toBe(q.title);
    }
  });
});
