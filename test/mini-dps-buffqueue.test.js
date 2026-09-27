// Mini mode, the per-overlay half, for the DPS HUD and the Buff queue.
//
// The guild lead, 2026-09-24: "Currently mini mode doesn't do anything." The
// shared half (preload's body.wp-mini toggle + the wp-mini-change event) was
// built; no overlay had a rendition to switch to. These two are the guild
// vote's picks (closed 2026-09-17, wolfpack.quest/mimic/mini):
//   • DPS HUD, option B "Me and my neighbours" — the player above me, me, the
//     player below, from whichever tab was last picked.
//   • Buff queue, option B "Two-column ledger" — ✨ buff categories left,
//     🩸 cure categories right, a count of characters on each chip, and a
//     click expands who needs it and which group they are in.
//
// Two tiers: the render functions sliced out of the page and run on fixtures,
// and each page's WHOLE script run against a small fake DOM, so the wiring
// (the mini swap, the repaint on a flip, the fit after the render, the chip
// click and its hover handshake) is exercised, not just read.
//
// Run: npx vitest run test/mini-dps-buffqueue.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, evalBlock, stripJs, stripCss } from './_source-slice.js';

const dpsHtml  = readSource(path.join(ROOT, 'apps', 'mimic', 'overlay.html'));
const buffHtml = readSource(path.join(ROOT, 'apps', 'mimic', 'buffqueue.html'));

const scriptOf = (html) => html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
const cssOf    = (html) => stripCss(html.slice(html.indexOf('<style>'), html.indexOf('</style>')));
const markupOf = (html) => html.slice(html.indexOf('<body>'), html.indexOf('<script>')).replace(/<!--[\s\S]*?-->/g, '');
const lineOf   = (src, start) => src.slice(src.indexOf(start), src.indexOf('\n', src.indexOf(start)));
// Up to, not including, the declaration that follows — an end anchor inside
// the code under test would turn a mutation into "suite failed to load".
const upTo = (src, start, next) => { const b = sliceBlock(src, start, next); return b.slice(0, b.length - next.length); };

// ── A fake DOM just big enough for these two pages ──────────────────────────
function fakeClassList(init) {
  const s = new Set(init || []);
  return {
    add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c),
    toggle: (c, on) => { const v = on === undefined ? !s.has(c) : !!on; if (v) s.add(c); else s.delete(c); return v; },
  };
}
function fakeEl(id) {
  const L = {};
  return {
    id, innerHTML: '', textContent: '', className: '', value: '', style: {}, dataset: {},
    options: [{ textContent: '' }], classList: fakeClassList(),
    addEventListener(t, f) { (L[t] || (L[t] = [])).push(f); },
    fire(t, e) { (L[t] || []).forEach((f) => f(e)); },
  };
}
// Runs the page's real <script>. `snap` names the element whose HTML the fit
// call should see — recorded AT the fit, so "fit after render" is checkable.
function runPage(html, { state, mini = false, stored = {}, snap }) {
  const els = new Map();
  const el = (id) => { if (!els.has(id)) els.set(id, fakeEl(id)); return els.get(id); };
  const body = fakeEl('body-tag');
  if (mini) body.classList.add('wp-mini');
  const winL = {};
  const fits = [], hovers = [];
  const document = {
    body, getElementById: el, querySelector: (s) => el('q:' + s),
    addEventListener() {}, createElement: () => fakeEl('x'),
  };
  const window = {
    addEventListener(t, f) { (winL[t] || (winL[t] = [])).push(f); },
    fire(t) { (winL[t] || []).forEach((f) => f({})); },
    mimic: {
      autoFitOverlay: () => fits.push(el(snap).innerHTML),
      overlayHoverInteractive: (on) => hovers.push(on),
    },
  };
  const localStorage = { getItem: (k) => (k in stored ? stored[k] : null), setItem() {} };
  const fetch = async () => ({ json: async () => state.current });
  const api = new Function('window', 'document', 'localStorage', 'fetch', 'setInterval', 'navigator',
    scriptOf(html) + '\n;return { tick: tick };')(window, document, localStorage, fetch, () => 0, {});
  return { api, el, body, window, fits, hovers };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

// ═══ DPS HUD ════════════════════════════════════════════════════════════════
const dps = evalBlock(
  lineOf(dpsHtml, '  function fmt(n){') + '\n' + lineOf(dpsHtml, '  function esc(s){') + '\n'
  + upTo(dpsHtml, '  function miniWindow(allRows, me) {', '\n  // Visible-row count'),
  ['miniWindow', 'miniRowsHtml'],
);
// [name, value, tookMax, petOwner, rank, extra, petCharm] — rank set as tick() does.
const board = (names) => names.map((n, i) => [n, (names.length - i) * 1000, 0, null, i + 1, false, false]);
const SEVEN = ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Tovrin'];
const namesOf = (rows) => rows.map((r) => r[0]);

describe('DPS mini: me and my neighbours', () => {
  it('me in the middle: the one I am chasing, me, the one chasing me', () => {
    expect(namesOf(dps.miniWindow(board(SEVEN), 'Rethlan'))).toEqual(['Corvale', 'Rethlan', 'Nyssara']);
  });
  it('me on top: me and the two below', () => {
    expect(namesOf(dps.miniWindow(board(SEVEN), 'Aldenmar'))).toEqual(['Aldenmar', 'Brackwyn', 'Corvale']);
  });
  it('me last: the two above and me', () => {
    expect(namesOf(dps.miniWindow(board(SEVEN), 'Tovrin'))).toEqual(['Nyssara', 'Zarrin', 'Tovrin']);
  });
  it('me second from the bottom is still centred', () => {
    expect(namesOf(dps.miniWindow(board(SEVEN), 'Zarrin'))).toEqual(['Nyssara', 'Zarrin', 'Tovrin']);
  });
  it('no row of mine (no damage dealt or taken) — or no character known: the top three', () => {
    expect(namesOf(dps.miniWindow(board(SEVEN), 'Someoneelse'))).toEqual(['Aldenmar', 'Brackwyn', 'Corvale']);
    expect(namesOf(dps.miniWindow(board(SEVEN), null))).toEqual(['Aldenmar', 'Brackwyn', 'Corvale']);
  });
  it('a board shorter than three shows all of it; the name match ignores case', () => {
    expect(namesOf(dps.miniWindow(board(['Aldenmar', 'Brackwyn']), 'brackwyn'))).toEqual(['Aldenmar', 'Brackwyn']);
    expect(namesOf(dps.miniWindow(board(SEVEN), 'nYSSARA'))).toEqual(['Rethlan', 'Nyssara', 'Zarrin']);
    expect(dps.miniWindow([], 'Aldenmar')).toEqual([]);
  });

  it('a row is rank, name, total, @rate and a share-of-raid bar; only my row is highlighted', () => {
    const rows = dps.miniWindow(board(SEVEN), 'Rethlan');          // 5000 / 4000 / 3000
    const h = dps.miniRowsHtml(rows, 'Rethlan', 28000, 100, false);
    const lis = h.split('</li>').filter(Boolean);
    expect(lis).toHaveLength(3);
    expect(lis[0]).toMatch(/^<li class="mrow">/);
    expect(lis[1]).toMatch(/^<li class="mrow me">/);
    expect(lis[2]).toMatch(/^<li class="mrow">/);
    expect(lis[1]).toContain('<span class="r">#4</span>');
    expect(lis[1]).toContain('>Rethlan</span>');
    expect(lis[1]).toContain('<span class="d">4.00K</span> <span class="dps">@40</span>');
    expect(lis[1]).toContain('<i style="width:14.3%"></i>');       // 4000 of 28000
    expect(lis[1]).toContain('class="mbar wp-mini-bar"');
    expect(lis[1]).toContain('class="n wp-mini-name"');
    expect(lis[1]).toContain('class="v wp-mini-num"');
    expect(h).not.toContain(' tk');
  });
  it('the Tank tab marks its rows (the tab strip is hidden, so the bar says which tab)', () => {
    const h = dps.miniRowsHtml(board(['Aldenmar']), null, 1000, 0, true);
    expect(h).toContain('<li class="mrow tk">');
    expect(h).toContain('@0<');                                  // no elapsed time yet → no rate
    expect(cssOf(dpsHtml)).toContain('li.mrow.tk .mbar i{background:#f85149}');
  });
  it('a name cannot break out of its row', () => {
    const h = dps.miniRowsHtml([['<img src=x>', 10, 0, null, 1]], null, 10, 1, false);
    expect(h).not.toContain('<img');
  });
});

describe('DPS mini: the page', () => {
  const T0 = 1_790_000_000_000;
  const fight = (field) => ({
    character: 'Rethlan',
    currentEncounterThreat: {
      bossName: 'a training dummy', startedAt: new Date(T0).toISOString(), flushedAt: T0 + 100000,
      perPlayer: Object.fromEntries(SEVEN.map((n, i) => [n, { [field]: (7 - i) * 1000 }])),
    },
  });

  it('mini renders my three rows into the board, and the fit runs AFTER that render', async () => {
    const p = runPage(dpsHtml, { state: { current: fight('dmg') }, mini: true, snap: 'deeps' });
    await flush();
    const h = p.el('deeps').innerHTML;
    expect(h.match(/<li class="mrow[^"]*">/g)).toEqual(['<li class="mrow">', '<li class="mrow me">', '<li class="mrow">']);
    expect(h).toContain('>Corvale<');
    expect(h).toContain('>Nyssara<');
    expect(h).not.toContain('class="total"');                     // no footer in mini
    expect(p.fits[p.fits.length - 1]).toBe(h);
  });

  it('flipping mini repaints at once and refits; flipping back gives the full board unchanged', async () => {
    const p = runPage(dpsHtml, { state: { current: fight('dmg') }, snap: 'deeps' });
    await flush();
    const full = p.el('deeps').innerHTML;
    expect(full).not.toContain('mrow');
    expect(full).toContain('<li class="total">');
    expect(full).toContain('<li class="me">');

    p.body.classList.add('wp-mini');
    p.window.fire('wp-mini-change');
    await flush();
    const mini = p.el('deeps').innerHTML;
    expect(mini).toContain('<li class="mrow me">');
    expect(p.fits[p.fits.length - 1]).toBe(mini);

    p.body.classList.remove('wp-mini');
    p.window.fire('wp-mini-change');
    await flush();
    expect(p.el('deeps').innerHTML).toBe(full);
    expect(p.fits[p.fits.length - 1]).toBe(full);
  });

  it('follows the last-picked tab: on Tank the rows are damage taken', async () => {
    const p = runPage(dpsHtml, { state: { current: fight('took') }, mini: true, stored: { 'wp.damageTabMode': 'tank' }, snap: 'deeps' });
    await flush();
    const h = p.el('deeps').innerHTML;
    expect(h.match(/<li class="mrow[^"]*">/g)).toEqual(['<li class="mrow tk">', '<li class="mrow me tk">', '<li class="mrow tk">']);
  });

  it('the tab strip, the row counter, the column header and History\'s fight list hide in mini', () => {
    const m = markupOf(dpsHtml);
    // The row counter and History share one column since 2026-09-25; the
    // column hides, and the counter inside it.
    expect(m).toMatch(/<span class="ctlstack wp-mini-hide">\s*<span class="rowcfg">/);
    expect(m).toContain('<span class="tabs wp-mini-hide">');
    expect(m).toContain('<div id="colhdr" class="colhdr wp-mini-hide"');
    const css = cssOf(dpsHtml);
    // Same specificity as the History rules, so it must come AFTER them.
    expect(css.indexOf('body.wp-mini .histlist{display:none}')).toBeGreaterThan(css.indexOf('body.hist .histlist{display:block;'));
    expect(css.indexOf('body.wp-mini .histwrap{display:block}')).toBeGreaterThan(css.indexOf('body.hist .histwrap{display:grid;'));
  });
});

// ═══ BUFF QUEUE ═════════════════════════════════════════════════════════════
const loadBuff = () => evalBlock(
  lineOf(buffHtml, '  function esc(s){') + '\n'
  + upTo(buffHtml, '  var _dismissed = new Set();', '\n  function renderRow(r, kind){') + '\n'
  + upTo(buffHtml, '  var _miniOpen = null;', '\n  function _autoFit(){')
  + '\nfunction __open(){ return _miniOpen; }',
  ['miniLedger', 'buildMiniHtml', 'miniToggle', '_dismissed', '_dkey', '__open'],
);
const payload = () => ({
  buff_queue: [
    { name: 'Aldenmar', group: 1, class: 'Warrior', tier: 'red',    missing: ['HP A', 'Haste'] },
    { name: 'Brackwyn', group: 3, class: 'Rogue',   tier: 'orange', missing: ['Haste'] },
    { name: 'Corvale',  group: 2, class: 'Cleric',  tier: 'yellow', missing: [] },
  ],
  // Deliberately NOT in cure priority order: poison is met first.
  debuff_queue: [
    { name: 'Rethlan', group: 4, class: 'Monk',   curses: [{ name: 'Venom Bolt', cure: 'poison' }, { name: 'Venom Spit', cure: 'poison' }] },
    { name: 'Nyssara', group: 5, class: 'Wizard', curses: [{ name: 'Hex of Ruin', cure: 'curse' }, { name: 'Odd Affliction' }] },
    { name: 'Zarrin',  group: 6, class: 'Bard',   curses: [{ name: 'Rot Cloud', cure: 'disease' }, { name: 'Venom Bolt', cure: 'poison' }] },
  ],
});
const cats = (list) => list.map((c) => [c.label, c.who.map((r) => r.name)]);
const chips = (h) => [...h.matchAll(/<button type="button" class="(mchip[^"]*)" data-mcat="([^"]*)"><span class="wp-mini-name">([^<]*)<\/span> <b class="wp-mini-num">(\d+)<\/b><\/button>/g)]
  .map((m) => ({ cls: m[1], key: m[2], label: m[3], n: Number(m[4]) }));

describe('Buff queue mini: the ledger', () => {
  it('buff categories keep the queue\'s own order; no `missing` is Other; counts are characters', () => {
    const L = loadBuff().miniLedger(payload());
    expect(cats(L.buffs)).toEqual([
      ['HP A', ['Aldenmar']], ['Haste', ['Aldenmar', 'Brackwyn']], ['Other', ['Corvale']],
    ]);
  });
  it('cures sort by the bot\'s priority, curse → blind → poison → disease, then Other — whatever order they arrive in', () => {
    const L = loadBuff().miniLedger(payload());
    expect(cats(L.cures)).toEqual([
      ['Curse', ['Nyssara']], ['Poison', ['Rethlan', 'Zarrin']], ['Disease', ['Zarrin']], ['Other', ['Nyssara']],
    ]);
  });
  it('two afflictions of one family on one raider count once', () => {
    const p = payload();
    p.debuff_queue = [p.debuff_queue[0]];                        // Rethlan: two poisons
    expect(cats(loadBuff().miniLedger(p).cures)).toEqual([['Poison', ['Rethlan']]]);
  });
  it('a chip dismissed with ✓ cured (#67) drops out of its count', () => {
    const b = loadBuff();
    b._dismissed.add(b._dkey('Zarrin', 'Rot Cloud'));
    expect(cats(b.miniLedger(payload()).cures).map((c) => c[0])).toEqual(['Curse', 'Poison', 'Other']);
  });
  it('the dashboard\'s section filters apply in mini too', () => {
    const p = payload(); p.sections = { debuffs: false };
    const L = loadBuff().miniLedger(p);
    expect(L.cures).toEqual([]);
    expect(L.buffs).toHaveLength(3);
    p.sections = { buffs: false };
    expect(loadBuff().miniLedger(p).buffs).toEqual([]);
  });

  it('buffs are the left column and cures the right, one "<Category> <count>" chip each', () => {
    const h = loadBuff().buildMiniHtml(payload());
    expect(h.indexOf('<div class="mcol mb"><div class="mlab">✨ buff</div>')).toBeGreaterThan(-1);
    expect(h.indexOf('<div class="mcol mc"><div class="mlab">🩸 cure</div>')).toBeGreaterThan(h.indexOf('class="mcol mb"'));
    const c = chips(h);
    expect(c.map((x) => [x.label, x.n])).toEqual([
      ['HP A', 1], ['Haste', 2], ['Other', 1],
      ['Curse', 1], ['Poison', 2], ['Disease', 1], ['Other', 1],
    ]);
    expect(c.slice(0, 3).every((x) => x.cls === 'mchip')).toBe(true);
    expect(c.slice(3).every((x) => x.cls === 'mchip cure')).toBe(true);
    expect(h).not.toContain('class="mexp"');                     // nothing open yet
  });
  it('an empty side keeps its column, so a category never changes sides', () => {
    const p = payload(); p.debuff_queue = [];
    const h = loadBuff().buildMiniHtml(p);
    expect(h).toContain('<div class="mcol mc"><div class="mlab">🩸 cure</div><span class="mnone">—</span></div>');
  });
  it('nothing to show is the empty string, so the page\'s own empty state takes over', () => {
    expect(loadBuff().buildMiniHtml({ buff_queue: [], debuff_queue: [] })).toBe('');
    expect(loadBuff().buildMiniHtml(null)).toBe('');
  });

  it('a click opens who needs it and their group; one open at a time; clicking again closes', () => {
    const b = loadBuff();
    b.miniToggle('b:Haste');
    let h = b.buildMiniHtml(payload());
    expect(chips(h).filter((x) => x.cls.includes(' on')).map((x) => x.key)).toEqual(['b:Haste']);
    expect(h).toContain('<div class="mexp"><span>Aldenmar <span class="grp">G1</span></span><span>Brackwyn <span class="grp">G3</span></span></div>');

    b.miniToggle('c:poison');
    h = b.buildMiniHtml(payload());
    expect(chips(h).filter((x) => x.cls.includes(' on')).map((x) => x.key)).toEqual(['c:poison']);
    expect(h).toContain('<div class="mexp"><span>Rethlan <span class="grp">G4</span></span><span>Zarrin <span class="grp">G6</span></span></div>');

    b.miniToggle('c:poison');
    expect(b.__open()).toBe(null);
    expect(b.buildMiniHtml(payload())).not.toContain('class="mexp"');
  });
  it('the buff and cure "Other" are different categories', () => {
    const b = loadBuff();
    b.miniToggle('c:other');
    const h = b.buildMiniHtml(payload());
    expect(h).toContain('<div class="mexp"><span>Nyssara <span class="grp">G5</span></span></div>');
  });
  it('the open category survives a repaint with new data', () => {
    const b = loadBuff();
    b.miniToggle('b:Haste');
    const p = payload();
    p.buff_queue.push({ name: 'Tovrin', group: 2, missing: ['Haste'] });
    const h = b.buildMiniHtml(p);
    expect(h).toContain('<span>Tovrin <span class="grp">G2</span></span>');
    expect(chips(h).find((x) => x.key === 'b:Haste')).toMatchObject({ cls: 'mchip on', n: 3 });
  });
  it('names and categories cannot break out of the markup', () => {
    const b = loadBuff();
    b.miniToggle('b:<b>');
    const h = b.buildMiniHtml({ buff_queue: [{ name: '<img src=x>', group: 1, missing: ['<b>'] }] });
    expect(h).not.toContain('<img');
    expect(h).toContain('&lt;img src=x&gt;');
    expect(h).toContain('<span class="wp-mini-name">&lt;b&gt;</span>');
  });
});

describe('Buff queue mini: the page', () => {
  it('mini renders the ledger; a flip repaints from the last payload and refits after it', async () => {
    const p = runPage(buffHtml, { state: { current: payload() }, snap: 'body' });
    await flush();
    const full = p.el('body').innerHTML;
    expect(full).toContain('class="sec debuffs"');
    expect(full).not.toContain('mledger');

    p.body.classList.add('wp-mini');
    p.window.fire('wp-mini-change');
    const mini = p.el('body').innerHTML;                          // synchronous: no poll needed
    expect(mini.startsWith('<div class="mledger">')).toBe(true);
    expect(p.fits[p.fits.length - 1]).toBe(mini);

    p.body.classList.remove('wp-mini');
    p.window.fire('wp-mini-change');
    expect(p.el('body').innerHTML).toBe(full);
  });

  it('an empty queue still refits on a flip — only the hidden title changed height', async () => {
    const p = runPage(buffHtml, { state: { current: { buff_queue: [], debuff_queue: [] } }, snap: 'body' });
    await flush();
    const before = p.fits.length;
    p.body.classList.add('wp-mini');
    p.window.fire('wp-mini-change');
    expect(p.fits.length).toBe(before + 1);
  });

  it('a chip click through the page\'s own handler opens it, and it stays open across polls', async () => {
    const p = runPage(buffHtml, { state: { current: payload() }, mini: true, snap: 'body' });
    await flush();
    const chip = { getAttribute: (a) => (a === 'data-mcat' ? 'c:poison' : null) };
    const click = { target: { closest: (s) => (s === '.mchip' ? chip : null) }, preventDefault() {}, stopPropagation() {} };
    p.el('body').fire('click', click);
    expect(p.el('body').innerHTML).toContain('<div class="mexp"><span>Rethlan');
    await p.api.tick(); await flush();
    expect(p.el('body').innerHTML).toContain('<div class="mexp"><span>Rethlan');
    p.el('body').fire('click', click);
    expect(p.el('body').innerHTML).not.toContain('class="mexp"');
  });

  it('chips are clickable on a locked overlay: the hover handshake is delegated and ignores moves inside a chip', async () => {
    const p = runPage(buffHtml, { state: { current: payload() }, mini: true, snap: 'body' });
    await flush();
    const inner = {};
    const chip = { contains: (n) => n === inner || n === chip };
    const onChip = { closest: (s) => (s === '.mchip' ? chip : null) };
    const offChip = { closest: () => null };
    p.el('body').fire('mouseover', { target: onChip, relatedTarget: offChip });
    p.el('body').fire('mouseout',  { target: onChip, relatedTarget: inner });   // onto its own count
    p.el('body').fire('mouseover', { target: offChip, relatedTarget: onChip }); // not a chip
    p.el('body').fire('mouseout',  { target: onChip, relatedTarget: offChip });
    expect(p.hovers).toEqual([true, false]);
  });

  it('the title row (class picker, lag?) hides in mini', () => {
    expect(markupOf(buffHtml)).toContain('<div class="title wp-mini-hide">');
  });
});

describe('both pages still parse', () => {
  it.each([['overlay.html', dpsHtml], ['buffqueue.html', buffHtml]])('%s', (_n, html) => {
    expect(() => new Function(scriptOf(html))).not.toThrow();
    expect(stripJs(scriptOf(html))).toContain("window.addEventListener('wp-mini-change'");
  });
});
