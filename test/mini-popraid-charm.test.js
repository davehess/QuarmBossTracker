// test/mini-popraid-charm.test.js — the per-overlay half of mini mode for the
// PoP raids overlay (popraid.html) and the Charm tracker (charm.html).
//
// The guild lead, 2026-09-24: "Currently mini mode doesn't do anything" — the
// preload toggled body.wp-mini, but no overlay drew anything different. The
// renditions are the guild vote's picks (closed 2026-09-17, wolfpack.quest/
// mimic/mini): PoP A "Checklist rows", Charm A "Two rows".
//
// BEHAVIOUR, not text: each page's real inline <script> runs against a small
// fake DOM, and the tests drive it the way Mimic does — the tick loop, the
// slide renderer, the delegated click/hover handlers, the wp-mini-change event
// the preload fires. Names are invented.
//
// Run: npx vitest run test/mini-popraid-charm.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, stripJs, stripCss } from './_source-slice.js';

const MIMIC = path.join(ROOT, 'apps', 'mimic');
const charmHtml = readSource(path.join(MIMIC, 'charm.html'));
const popHtml = readSource(path.join(MIMIC, 'popraid.html'));

const NOW = Date.UTC(2026, 8, 24, 1, 0, 0);
const count = (s, sub) => s.split(sub).length - 1;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };

// ── harness ─────────────────────────────────────────────────────────────────
// The page's inline script (the <script> without a src) and its static markup.
const inlineScript = (html) => { const o = html.indexOf('<script>'); return html.slice(o + 8, html.indexOf('</script>', o)); };
const markupOf = (html) => html.slice(html.indexOf('<body>'), html.indexOf('<script'));

function fakeEl(id, all, { tag = 'div', classes = [], attrs = {}, parent = null } = {}) {
  const cls = new Set(classes);
  const on = {};
  const e = {
    id, tag, parent, attrs, style: {}, value: '', textContent: '', className: '', scrollHeight: 120, disabled: false,
    _html: '', _gen: 0,
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this._gen++; },
    classList: {
      add: (c) => { cls.add(c); }, remove: (c) => { cls.delete(c); }, contains: (c) => cls.has(c),
      toggle: (c, force) => { const want = force === undefined ? !cls.has(c) : !!force; if (want) cls.add(c); else cls.delete(c); return want; },
    },
    addEventListener(ev, fn) { (on[ev] ||= []).push(fn); },
    fire(ev, evt) { for (const fn of on[ev] || []) fn(evt || {}); },
    getAttribute(a) { return a in attrs ? attrs[a] : null; },
    setAttribute(a, v) { attrs[a] = String(v); },
    focus() {},
    // Enough of Element.closest for comma lists of `.class` and tag selectors.
    closest(sel) {
      const parts = sel.split(',').map(x => x.trim());
      for (let n = this; n; n = n.parent) {
        if (parts.some(p => (p[0] === '.' ? n.classList.contains(p.slice(1)) : n.tag === p))) return n;
      }
      return null;
    },
  };
  if (all) all.push(e);
  return e;
}

function fakeDom(staticIds) {
  const all = [];
  const byId = {};
  for (const id of staticIds) byId[id] = fakeEl(id, all);
  const dyn = new Map();
  const on = {};
  const document = {
    body: fakeEl('body', null, { tag: 'body' }),
    documentElement: { style: { setProperty() {} } },
    addEventListener(ev, fn) { (on[ev] ||= []).push(fn); },
    fire(ev, evt) { for (const fn of on[ev] || []) fn(evt); },
    getElementById(id) {
      if (byId[id]) return byId[id];
      // A node that exists only inside rendered HTML: found while its
      // container's CURRENT markup names it, and a new node each time that
      // markup is replaced — as innerHTML does.
      const owner = all.find(e => e._html.includes('id="' + id + '"'));
      if (!owner) return null;
      const c = dyn.get(id);
      if (c && c.owner === owner && c.gen === owner._gen) return c.el;
      const n = fakeEl(id, all);
      dyn.set(id, { owner, gen: owner._gen, el: n });
      return n;
    },
  };
  return { document, byId };
}

function boot(html, { win = {}, fetchImpl, pre = '', returns = [], bodyClasses = [] } = {}) {
  const ids = [...markupOf(html).matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const { document, byId } = fakeDom(ids);
  for (const c of bodyClasses) document.body.classList.add(c);
  const rec = { fits: [], heights: [], hover: [], opened: [] };
  const snap = () => ({ content: byId.content && byId.content.innerHTML, list: byId.list && byId.list.innerHTML });
  const wOn = {};
  const window = Object.assign({
    mimic: {
      autoFitOverlay: () => rec.fits.push(snap()),
      overlayAutoHeight: (h) => rec.heights.push(Object.assign({ h }, snap())),
      overlayHoverInteractive: (v) => rec.hover.push(v),
      openExternal: (u) => rec.opened.push(u),
    },
    addEventListener(ev, fn) { (wOn[ev] ||= []).push(fn); },
    fire(ev) { for (const fn of wOn[ev] || []) fn({ type: ev }); },
  }, win);
  const store = {};
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const run = new Function('window', 'document', 'fetch', 'localStorage', 'setInterval', 'setTimeout',
    pre + inlineScript(html) + '\nreturn { ' + returns.join(', ') + ' };');
  const api = run(window, document, fetchImpl, localStorage, () => 0, () => 0);
  // Flip mini the way preload's _wpApplyMini does: class first, then the event.
  const setMini = async (on) => { document.body.classList.toggle('wp-mini', on); window.fire('wp-mini-change'); await flush(); };
  return { api, window, document, byId, rec, setMini };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

// ── Charm — "Two rows" ──────────────────────────────────────────────────────
const pet = (o) => Object.assign({
  key: 'aldenmar:evoker', pet: 'a thought horror evoker', owner: 'Aldenmar', is_active: true,
  started_at: NOW - 42000, last_tick_at: NOW - 3000, duration_sec: 60, charm_class: 'bard',
  is_dire_charm: false, pet_hp_pct: 71,
}, o);
const hitting = (target, o) => Object.assign({ owner: 'aldenmar', pet: 'a thought horror evoker', target, hp_pct: 71 }, o);

async function bootCharm(state, { mini = false, spoken = null } = {}) {
  const h = boot(charmHtml, {
    fetchImpl: async () => ({ json: async () => state }),
    bodyClasses: mini ? ['wp-mini'] : [],
    returns: ['tick'],
    pre: 'var SpeechSynthesisUtterance = function (t) { this.text = t; };\n',
    win: spoken ? { speechSynthesis: { cancel() {}, speak(u) { spoken.push(u.text); } } } : {},
  });
  await flush();   // the page's own first tick()
  return h;
}

describe('charm mini — two rows per charm', () => {
  it('row one is the pet (HP bar, name → what it is hitting); row two is the purple timer with time left', async () => {
    const h = await bootCharm({ activeCharacter: 'Aldenmar', charmPets: [pet()], petHealth: [hitting('an elder thought horror')] }, { mini: true });
    const out = h.byId.list.innerHTML;
    expect(count(out, 'class="cm"')).toBe(1);
    expect(out).toContain('style="color:#56d364">71%</span>');
    expect(out).toContain('<i style="width:71%;background:#56d364">');
    expect(out).toContain('<b>a thought horror evoker</b> <span class="cm-arr">→</span> <span class="cm-tg">an elder thought horror</span>');
    // 60s charm, 42s up → 18s left, 30% of the bar, charm purple.
    expect(out).toContain('style="color:#a371f7">⏳ 0:18</span>');
    expect(out).toContain('<i style="width:30.0%;background:#a371f7">');
    expect(out).not.toContain('recharm');
  });

  it('drops the tick pips and the BROKE badge; a broken charm is an empty red bar that says recharm', async () => {
    const state = { activeCharacter: 'Aldenmar', charmPets: [pet(), pet({ key: 'aldenmar:gnoll', pet: 'a gnoll', is_active: false, broke_at: NOW - 5000 })] };
    const full = (await bootCharm(state)).byId.list.innerHTML;
    // Non-vacuous: full mode draws every one of these for the same data.
    for (const s of ['BROKE', 'class="tickbar"', 'next mob tick', 'remove-broken', 'class="dismiss"']) expect(full).toContain(s);

    const out = (await bootCharm(state, { mini: true })).byId.list.innerHTML;
    for (const s of ['BROKE', 'tickbar', 'next mob tick', 'remove-broken', 'dismiss', 'tick ']) expect(out).not.toContain(s);
    const broken = out.slice(out.indexOf('data-key="aldenmar:gnoll"'));
    expect(broken).toContain('style="color:#f85149">⏳ 0:00 recharm</span>');
    expect(broken).toContain('<i style="width:0.0%;background:#f85149">');
  });

  it('goes red and says recharm when the full overlay turns imminent (bard: 12s), not before', async () => {
    const at = async (upMs) => (await bootCharm({ activeCharacter: 'Aldenmar', charmPets: [pet({ started_at: NOW - upMs })] }, { mini: true })).byId.list.innerHTML;
    expect(await at(52000)).toContain('style="color:#f85149">⏳ 0:08 recharm</span>');
    // 11s: already red — the overlay flashes and speaks at 12s, so the bar
    // must agree with it (the mock's 10s would leave it purple here).
    expect(await at(49000)).toContain('style="color:#f85149">⏳ 0:11 recharm</span>');
    const calm = await at(47000);
    expect(calm).toContain('style="color:#a371f7">⏳ 0:13</span>');
    expect(calm).not.toContain('recharm');
  });

  it('a guessed duration keeps full mode\'s ~ and grey and never goes red', async () => {
    const out = (await bootCharm({ activeCharacter: 'Aldenmar', charmPets: [pet({ duration_sec: null, charm_class: null, started_at: NOW - 55000 })] }, { mini: true })).byId.list.innerHTML;
    expect(out).toContain('style="color:#8b94a3">⏳ ~0:05</span>');
    expect(out).not.toContain('recharm');
  });

  it('Dire Charm has no timer to drain: a full bar marked dire', async () => {
    const out = (await bootCharm({ activeCharacter: 'Aldenmar', charmPets: [pet({ is_dire_charm: true })] }, { mini: true })).byId.list.innerHTML;
    expect(out).toContain('style="color:#56d364">∞ dire</span>');
    expect(out).toContain('<i style="width:100.0%;background:#56d364">');
  });

  it('several charms → one two-row block each, in the order full mode lists them', async () => {
    const state = { activeCharacter: null, charmPets: [pet(), pet({ key: 'brackwyn:bear', pet: 'a brown bear', owner: 'Brackwyn', pet_hp_pct: 40 })] };
    const out = (await bootCharm(state, { mini: true })).byId.list.innerHTML;
    expect(count(out, 'class="cm"')).toBe(2);
    expect(count(out, 'class="cm-row"')).toBe(4);
    expect(out.indexOf('a thought horror evoker')).toBeLessThan(out.indexOf('a brown bear'));
    expect(out).toContain('style="color:#f0b429">40%</span>');   // the shared 50/25 steps
  });

  it('the target is only this charm\'s own, and only while it holds', async () => {
    const other = await bootCharm({ activeCharacter: 'Aldenmar', charmPets: [pet()], petHealth: [hitting('a gnoll', { pet: 'a summoned servant' })] }, { mini: true });
    expect(other.byId.list.innerHTML).not.toContain('cm-arr');
    const broke = await bootCharm({ activeCharacter: 'Aldenmar', charmPets: [pet({ is_active: false, broke_at: NOW - 2000 })], petHealth: [hitting('an elder thought horror')] }, { mini: true });
    expect(broke.byId.list.innerHTML).not.toContain('cm-arr');
  });

  it('no HP reading → "?" and no HP bar, rather than an empty bar that reads as a dead pet', async () => {
    const out = (await bootCharm({ activeCharacter: 'Aldenmar', charmPets: [pet({ pet_hp_pct: null })] }, { mini: true })).byId.list.innerHTML;
    expect(out).toContain('>?%</span>');
    expect(count(out, 'class="cm-bar')).toBe(1);   // the timer's only
  });

  it('mini still speaks the callouts — only the drawing changes', async () => {
    const spoken = [];
    await bootCharm({ activeCharacter: 'Aldenmar', charmPets: [pet({ started_at: NOW - 52000 })] }, { mini: true, spoken });
    expect(spoken).toContain('charm breaking');
  });

  it('flipping mini repaints in the other rendition and THEN re-measures, both ways', async () => {
    const h = await bootCharm({ activeCharacter: 'Aldenmar', charmPets: [pet()] });
    expect(h.byId.list.innerHTML).toContain('class="charm');
    await h.setMini(true);
    expect(h.byId.list.innerHTML).toContain('class="cm"');
    expect(h.rec.heights.at(-1).list).toContain('class="cm"');
    await h.setMini(false);
    expect(h.byId.list.innerHTML).not.toContain('class="cm"');
    expect(h.rec.heights.at(-1).list).toContain('class="charm');
  });

  it('re-measures on a flip even with no charm up (the title line still changes the height)', async () => {
    const h = await bootCharm({ activeCharacter: 'Aldenmar', charmPets: [] });
    const before = h.rec.heights.length;
    await h.setMini(true);
    expect(h.rec.heights.length).toBeGreaterThan(before);
  });

  it('the title line hides in mini, and the first card clears the fixed ✥/✕', () => {
    expect(stripJs(stripCss(markupOf(charmHtml)))).toContain('<div class="title wp-mini-hide">');
    expect(stripCss(charmHtml)).toContain('#list > .cm:first-child{padding-left:22px;padding-right:22px}');
  });
});

// ── PoP raids — "Checklist rows" ────────────────────────────────────────────
const DB = {
  imageBase: 'https://img.invalid/',
  quarmGlobalNotes: ['A divergence.'],
  sections: [
    { id: 'tac', title: 'Tier 3', guide: 'https://guide.invalid/tier3/', encounters: [
      { id: 'rz', name: 'Rallos Zek the Warlord (event, 4 phases)', zone: 'Plane of Tactics', npcName: 'Rallos Zek the Warlord',
        callouts: ['Corner tank; kite team on adds.'], stats: { hp: '~2M' }, abilities: [{ name: 'Rampage', note: 'hits everyone' }],
        tracker: [{ id: 'tank', label: 'Corner tank set' }, { id: 'kite', label: 'Kite team on adds' }, { id: 'hail', label: 'Projection hailed' }],
        guide: 'https://guide.invalid/rallos/', diagrams: ['map.png'] },
      { id: 'vz', name: 'Vallon Zek', zone: 'Plane of Tactics', tracker: [{ id: 'boss', label: 'Vallon down' }] },
    ] },
    { id: 'p2', title: 'PoTime — Phase 2', pending: true, note: 'Not captured yet.', guide: 'https://guide.invalid/p2/' },
  ],
};
const OBJ = { rev: 1, encounters: { rz: { tank: { c: true, by: 'Aldenmar' } } } };

async function bootPop({ mini = false } = {}) {
  const posts = [];
  const h = boot(popHtml, {
    win: { POP_RAIDS: JSON.parse(JSON.stringify(DB)) },
    fetchImpl: async (url, opts) => {
      if (opts && opts.method === 'POST') { posts.push({ url, body: JSON.parse(opts.body) }); return { status: 200, ok: true, json: async () => ({ ok: true }) }; }
      return { json: async () => OBJ };
    },
    bodyClasses: mini ? ['wp-mini'] : [],
    returns: ['_IA_SEL'],
  });
  await flush();
  h.posts = posts;
  h.content = () => h.byId.content.innerHTML;
  h.rows = () => h.document.getElementById('trackerBody').innerHTML;
  return h;
}
const hrefOf = (html, cls) => { const m = html.match(new RegExp('class="' + cls + '" data-url="([^"]+)"')); return m && m[1]; };

describe('PoP mini — the checklist rows and nothing else', () => {
  it('a title line and the shared objective rows — no slide, notes, loot, flag form or picker', async () => {
    const full = (await bootPop()).content();
    for (const s of ['enc-hdr', 'Callouts', 'Live drop table', 'id="flagForm"', 'Quarm divergences', 'class="dg"']) expect(full).toContain(s);

    const h = await bootPop({ mini: true });
    const c = h.content();
    for (const s of ['enc-hdr', 'Callouts', 'Live drop table', 'flagForm', 'Quarm divergences', 'class="dg"', 'id="panels"', '<select']) expect(c).not.toContain(s);
    expect(c).toContain('<span class="wp-mini-name">PoP · Rallos Zek the Warlord</span>');   // parenthetical dropped
    const rows = h.rows();
    expect(count(rows, 'class="obj')).toBe(3);
    expect(rows).toContain('<div class="obj done" data-obj="tank"');
    expect(rows).toContain('✓ Aldenmar');
  });

  it('↗ is the link the full slide hotlinks — the encounter guide, else the section guide', async () => {
    const h = await bootPop();
    expect(hrefOf(h.content(), 'lnk')).toBe('https://guide.invalid/rallos/');
    await h.setMini(true);
    expect(hrefOf(h.content(), 'lnk mini-go')).toBe('https://guide.invalid/rallos/');
    h.byId.nextBtn.fire('click');                       // Vallon Zek: no guide of its own
    expect(hrefOf(h.content(), 'lnk mini-go')).toBe('https://guide.invalid/tier3/');
    await h.setMini(false);
    expect(hrefOf(h.content(), 'lnk')).toBe('https://guide.invalid/tier3/');   // full's "Phase guide"
  });

  it('clicking a mini row checks it for the whole raid, through the same handler as full mode', async () => {
    const h = await bootPop({ mini: true });
    const rowCls = h.rows().match(/<div class="([^"]+)" data-obj="kite"/)[1];   // as rendered
    const row = fakeEl('', null, { classes: rowCls.split(' '), attrs: { 'data-obj': 'kite' } });
    const box = fakeEl('', null, { tag: 'span', classes: ['bx'], parent: row });
    h.byId.content.fire('click', { target: box });
    await flush();
    expect(h.posts.map(p => p.body)).toEqual([{ encounter_id: 'rz', objective_id: 'kite', checked: true }]);
    expect(h.rows()).toContain('<div class="obj done" data-obj="kite"');
    expect(h.content()).toContain('mini-ttl');                                     // still mini
  });

  it('↗ opens the guide, and both it and the rows get the hover-interact handshake', async () => {
    const h = await bootPop({ mini: true });
    const cls = h.content().match(/<span class="([^"]+)" data-url="([^"]+)"[^>]*>↗<\/span>/);
    const go = fakeEl('', null, { tag: 'span', classes: cls[1].split(' '), attrs: { 'data-url': cls[2] } });
    h.byId.content.fire('click', { target: go });
    expect(h.rec.opened).toEqual(['https://guide.invalid/rallos/']);
    h.document.fire('mouseover', { target: go });
    const rowCls = h.rows().match(/<div class="([^"]+)" data-obj=/)[1];
    h.document.fire('mouseover', { target: fakeEl('', null, { classes: rowCls.split(' ') }) });
    expect(h.rec.hover).toEqual([true, true]);
  });

  it('the encounter follows the full overlay, both ways', async () => {
    const h = await bootPop();
    h.byId.nextBtn.fire('click');
    await h.setMini(true);
    expect(h.content()).toContain('PoP · Vallon Zek</span>');
    expect(h.rows()).toContain('Vallon down');
    await h.setMini(false);
    expect(h.content()).toContain('<div class="nm">Vallon Zek</div>');
  });

  it('flipping mini redraws, THEN re-fits the window, both ways', async () => {
    const h = await bootPop();
    await h.setMini(true);
    expect(h.rec.fits.at(-1).content).toContain('mini-ttl');
    await h.setMini(false);
    expect(h.rec.fits.at(-1).content).toContain('enc-hdr');
  });

  it('a slide without a checklist says so, keeps its ↗, and still re-fits', async () => {
    const h = await bootPop();
    h.byId.nextBtn.fire('click'); h.byId.nextBtn.fire('click');   // → the pending Phase 2 card
    await h.setMini(true);
    expect(h.content()).toContain('PoP · PoTime — Phase 2</span>');
    expect(h.content()).toContain('no shared checklist on this slide');
    expect(hrefOf(h.content(), 'lnk mini-go')).toBe('https://guide.invalid/p2/');
    // No rows means renderTracker never fits — the mini branch's own fit must.
    expect(h.rec.fits.at(-1).content).toContain('no shared checklist on this slide');
  });

  it('the title bar (picker, ◀ ▶, 🖥, ⚑) hides in mini', () => {
    expect(stripJs(stripCss(markupOf(popHtml)))).toContain('<div class="title wp-mini-hide">');
  });
});
