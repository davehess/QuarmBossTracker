// Buff queue overlay — raid groups (the guild lead, 2026-10-04: "we should be grouping people for
// buffs on wolfpack.quest/buffs — treat that like the buff queue as well").
//
// Mimic's apps/mimic/buffqueue.html gets a By buff | By group switch. By group is one block per raid
// group built from the bot's `groups` field on /api/agent/raid-buff-queue (which the agent passes
// through untouched); By buff keeps its buckets and clusters the people inside an open bucket by group.
// An older bot sends no `groups`, so everything must fall back to the queue rows alone.
//
// Behaviour, not text: the page's WHOLE script runs against a small fake DOM (the same approach as
// test/mini-dps-buffqueue.test.js), so the switch, its persistence, the "+N more" toggle and the
// polling are exercised through the page's own handlers. Names are invented fixtures.
//
// Run: npx vitest run test/buffqueue-groups.test.js

import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, evalBlock, stripJs, stripCss } from './_source-slice.js';

const html = readSource(path.join(ROOT, 'apps', 'mimic', 'buffqueue.html'));
const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
const css = stripCss(html.slice(html.indexOf('<style>'), html.indexOf('</style>')));
const markup = html.slice(html.indexOf('<body>'), html.indexOf('<script>')).replace(/<!--[\s\S]*?-->/g, '');

// ── A fake DOM just big enough for the page ─────────────────────────────────
function fakeClassList() {
  const s = new Set();
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
// `state.current` answers /api/buff-queue, `agent` answers /api/state. `stored` is the localStorage
// the page sees AND writes, so a second runPage with the same object is "the next launch".
function runPage({ state, agent = {}, stored = {}, mini = false }) {
  const els = new Map();
  const el = (id) => { if (!els.has(id)) els.set(id, fakeEl(id)); return els.get(id); };
  const body = fakeEl('body-tag');
  if (mini) body.classList.add('wp-mini');
  const winL = {};
  const fits = [], hovers = [], sets = [], fetched = [];
  const document = { body, getElementById: el, querySelector: (s) => el('q:' + s), addEventListener() {}, createElement: () => fakeEl('x') };
  const window = {
    addEventListener(t, f) { (winL[t] || (winL[t] = [])).push(f); },
    fire(t) { (winL[t] || []).forEach((f) => f({})); },
    mimic: { autoFitOverlay: () => fits.push(el('body').innerHTML), overlayHoverInteractive: (on) => hovers.push(on) },
  };
  const localStorage = {
    getItem: (k) => (k in stored ? stored[k] : null),
    setItem: (k, v) => { stored[k] = v; sets.push([k, v]); },
  };
  const fetch = async (url) => { fetched.push(url); return { json: async () => (/\/api\/state/.test(url) ? agent : state.current) }; };
  const api = new Function('window', 'document', 'localStorage', 'fetch', 'setInterval', 'navigator',
    script + '\n;return { tick, buildHtml, buildMiniHtml, _groupsFor, _topGroup, _grpNum };')(window, document, localStorage, fetch, () => 0, {});
  return { api, el, body, window, fits, hovers, sets, fetched, stored };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const bodyOf = (p) => p.el('body').innerHTML;
// A click that the page's delegated handler on #body resolves to `target` for the selector it asks.
const clickOn = (p, matches, attrs) => p.el('body').fire('click', {
  target: { closest: (s) => (matches.some((m) => s.includes(m)) ? { getAttribute: (a) => attrs[a] } : null) },
  preventDefault() {}, stopPropagation() {},
});

// ── Fixtures: a raid of three groups plus one person with none ──────────────
// Scrambled on purpose (ungrouped first, then 3, then 1): the overlay must do its own ordering.
const spell = "Vallon's Quickening";
const payload = () => ({
  buff_queue: [
    { name: 'Aldenmar', group: 3,    class: 'Warrior', tier: 'red',    missing: ['Haste', 'HP B'] },
    { name: 'Brackwyn', group: 3,    class: 'Rogue',   tier: 'orange', missing: ['Haste'] },
    { name: 'Zarrin',   group: 3,    class: 'Bard',    tier: 'yellow', missing: ['Haste'] },
    { name: 'Nyssara',  group: 3,    class: 'Wizard',  tier: 'yellow', missing: ['Haste'] },
    { name: 'Rethlan',  group: 1,    class: 'Monk',    tier: 'yellow', missing: ['Haste'] },
    { name: 'Tovrin',   group: null, class: 'Cleric',  tier: 'yellow', missing: ['Haste'] },
  ],
  debuff_queue: [],
  groups: [
    { group: null, members: [{ name: 'Tovrin', class: 'Cleric', missing: ['Haste'], inferred: false }],
      lines: [{ key: 'haste', label: 'Haste', missing: ['Tovrin'], casters: [] }] },
    { group: 3, members: [
        { name: 'Aldenmar', class: 'Warrior',   missing: ['Haste', 'HP B'], inferred: false },
        { name: 'Brackwyn', class: 'Rogue',     missing: ['Haste'],         inferred: false },
        { name: 'Corvale',  class: 'Enchanter', missing: [],                inferred: false },
        { name: 'Zarrin',   class: 'Bard',      missing: ['Haste'],         inferred: false },
        { name: 'Nyssara',  class: 'Wizard',    missing: ['Haste'],         inferred: true },
      ],
      lines: [
        { key: 'haste', label: 'Haste', missing: ['Aldenmar', 'Brackwyn', 'Zarrin', 'Nyssara'],
          casters: [{ name: 'Corvale', class: 'Enchanter', spell }] },
        { key: 'hp:B', label: 'HP B', missing: ['Aldenmar'], casters: [] },
      ] },
    { group: 1, members: [{ name: 'Rethlan', class: 'Monk', missing: ['Haste'], inferred: false }],
      lines: [{ key: 'haste', label: 'Haste', missing: ['Rethlan'], casters: [] }] },
  ],
});
const noGroups = () => { const p = payload(); delete p.groups; return p; };

// ── Readers for the markup ──────────────────────────────────────────────────
const decode = (s) => s.replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const plain = (s) => decode(s.replace(/<\/span>/g, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const glines = (h) => [...h.matchAll(/<div class="gline">(.*?)<\/div>/g)].map((m) => plain(m[1]));
const blocksOf = (h) => h.split('<div class="gblk">').slice(1).map((b) => ({
  hdr: plain(/<div class="ghdr">(.*?)<\/div>/.exec(b)[1]),
  lines: glines(b),
  names: [...b.matchAll(/<span class="nm">([^<]*)<\/span>/g)].map((m) => m[1]),
  more: (/<div class="gmore"[^>]*>([^<]*)<\/div>/.exec(b) || [])[1] || null,
}));
const chips = (h) => [...h.matchAll(/data-mcat="([^"]*)"><span class="wp-mini-name">([^<]*)<\/span> <b class="wp-mini-num">(\d+)<\/b>(?: <span class="wp-mini-num mtop">([^<]*)<\/span>)?<\/button>/g)]
  .map((m) => ({ key: m[1], label: m[2], n: Number(m[3]), top: m[4] || null }));
const OPEN_HASTE = { 'wp:bq:collapsed': JSON.stringify({ Haste: false, 'HP B': false }) };

describe('the view switch', () => {
  it('starts on By buff — the overlay as it always was — and the group blocks are absent', async () => {
    const p = runPage({ state: { current: payload() } });
    await flush();
    expect(p.el('viewBuff').classList.contains('on')).toBe(true);
    expect(p.el('viewGroup').classList.contains('on')).toBe(false);
    expect(bodyOf(p)).toContain('class="cathdr"');
    expect(bodyOf(p)).not.toContain('class="gblk"');
  });

  it('clicking By group repaints at once, marks the button, and remembers it in wp:bq:view', async () => {
    const stored = {};
    const p = runPage({ state: { current: payload() }, stored });
    await flush();
    p.el('viewGroup').fire('click', {});
    expect(bodyOf(p)).toContain('class="gblk"');
    expect(bodyOf(p)).not.toContain('class="cathdr"');
    expect(p.el('viewGroup').classList.contains('on')).toBe(true);
    expect(p.el('viewBuff').classList.contains('on')).toBe(false);
    expect(p.sets).toContainEqual(['wp:bq:view', 'group']);
    p.el('viewBuff').fire('click', {});
    expect(bodyOf(p)).toContain('class="cathdr"');
    expect(stored['wp:bq:view']).toBe('buff');
  });

  it('the next launch comes up in the remembered view; an unreadable value means By buff', async () => {
    const stored = {};
    const a = runPage({ state: { current: payload() }, stored });
    await flush();
    a.el('viewGroup').fire('click', {});
    const b = runPage({ state: { current: payload() }, stored });
    await flush();
    expect(bodyOf(b)).toContain('class="gblk"');
    expect(b.el('viewGroup').classList.contains('on')).toBe(true);
    const c = runPage({ state: { current: payload() }, stored: { 'wp:bq:view': 'sideways' } });
    await flush();
    expect(bodyOf(c)).toContain('class="cathdr"');
  });

  it('the buttons arm the hover handshake, so a locked overlay takes the click; a row of their own, clear of the ✕ gutter', async () => {
    const p = runPage({ state: { current: payload() } });
    await flush();
    p.el('viewGroup').fire('mouseenter', {});
    p.el('viewGroup').fire('mouseleave', {});
    p.el('viewBuff').fire('mouseenter', {});
    expect(p.hovers).toEqual([true, false, true]);
    expect(markup).toContain('<div class="vsw wp-mini-hide">');      // hides in mini
    expect(markup).toContain('>By buff</button>');
    expect(markup).toContain('>By group</button>');
    expect(css).toContain('.vsw{display:flex;gap:3px;margin:0 30px 4px 0}');
  });

  it('mini ignores the switch: it always draws the ledger', async () => {
    const p = runPage({ state: { current: payload() }, stored: { 'wp:bq:view': 'group' }, mini: true });
    await flush();
    expect(bodyOf(p).startsWith('<div class="mledger">')).toBe(true);
    expect(bodyOf(p)).not.toContain('gblk');
  });
});

describe('By group', () => {
  const group = () => { const p = runPage({ state: { current: payload() }, stored: { 'wp:bq:view': 'group' } }); return p; };

  it('one block per group from payload.groups: by number, the ungrouped last, whatever order the bot sent', async () => {
    const p = group();
    await flush();
    const b = blocksOf(bodyOf(p));
    expect(b.map((x) => x.hdr)).toEqual(['G1 1', 'G3 5', 'ungrouped 1']);   // head count: all of G3, not just who is missing
  });

  it('a line per missing buff line, with the caster from the payload; "no <class> in G3" when nobody in the group can cast it', async () => {
    const p = group();
    await flush();
    const b = blocksOf(bodyOf(p));
    expect(b[1].lines).toEqual([
      "Haste ×4 → Corvale: Vallon's Quickening",
      'HP B ×1 → no cleric in G3',
    ]);
    expect(b[0].lines).toEqual(['Haste ×1 → no enchanter in G1']);
  });

  it('uses the bot\'s own line `classes` for the no-caster note when sent (bot 3.1.195+), the local map otherwise', async () => {
    const P = payload();
    for (const g of P.groups) for (const ln of g.lines || []) if (ln.key === 'haste') ln.classes = ['enchanter', 'shaman'];
    const p = runPage({ state: { current: P }, stored: { 'wp:bq:view': 'group' } });
    await flush();
    expect(blocksOf(bodyOf(p))[0].lines).toEqual(['Haste ×1 → no enchanter/shaman in G1']);
  });

  it('puts the bot\'s `self_group` first and asks /api/state nothing when the bot names it', async () => {
    const P = payload(); P.self_group = 1;
    const p = runPage({ state: { current: P }, stored: { 'wp:bq:view': 'group' } });
    await flush(); await p.api.tick(); await flush();
    expect(blocksOf(bodyOf(p)).map((x) => x.hdr)[0]).toMatch(/^G1 /);
    expect(p.api._groupsFor(P, 'zarrin').mine).toBe(1);   // the bot's word beats a name match
    expect(p.fetched.filter((u) => /\/api\/state/.test(u))).toHaveLength(0);
  });

  it('the ungrouped block makes no claim about casters: there is no group to cast into', async () => {
    const p = group();
    await flush();
    expect(blocksOf(bodyOf(p))[2].lines).toEqual(['Haste ×1']);
  });

  it('people with a gap, worst first; the first three, the rest behind "+N more" that opens and persists', async () => {
    const stored = { 'wp:bq:view': 'group' };
    const p = runPage({ state: { current: payload() }, stored });
    await flush();
    let g3 = blocksOf(bodyOf(p))[1];
    expect(g3.names).toEqual(['Aldenmar', 'Brackwyn', 'Zarrin']);          // red, orange, yellow; Corvale has no gap
    expect(g3.more).toBe('▸ +1 more');
    expect(bodyOf(p)).toContain('class="gmore" data-wp-interact data-cat="grp:3"');

    clickOn(p, ['.gmore'], { 'data-cat': 'grp:3' });
    g3 = blocksOf(bodyOf(p))[1];
    expect(g3.names).toEqual(['Aldenmar', 'Brackwyn', 'Zarrin', 'Nyssara']);
    expect(g3.more).toBe('▾ fewer');
    expect(JSON.parse(stored['wp:bq:collapsed'])).toEqual({ 'grp:3': false });

    clickOn(p, ['.gmore'], { 'data-cat': 'grp:3' });
    expect(blocksOf(bodyOf(p))[1].names).toHaveLength(3);                // and back
  });

  it('a block of three or fewer has no toggle', async () => {
    const p = group();
    await flush();
    const b = blocksOf(bodyOf(p));
    expect(b[0].more).toBe(null);
    expect(b[2].more).toBe(null);
  });

  it('a row keeps its severity tier from the queue, and 🔍 for someone whose buffs are inferred', async () => {
    const p = runPage({ state: { current: payload() }, stored: { 'wp:bq:view': 'group', 'wp:bq:collapsed': JSON.stringify({ 'grp:3': false }) } });
    await flush();
    const h = bodyOf(p);
    expect(h).toMatch(/<div class="row r"><span class="nm">Aldenmar<\/span>/);
    expect(h).toMatch(/<div class="row o"><span class="nm">Brackwyn<\/span>/);
    expect(h).toMatch(/<div class="row y inferred"><span class="nm">Nyssara<\/span>/);
    expect(h).toContain('<span class="miss">Haste · HP B</span>');
  });

  it('my group first once /api/state says who I am; nothing else about the blocks changes', async () => {
    const p = runPage({ state: { current: payload() }, agent: { activeCharacter: 'Rethlan' }, stored: { 'wp:bq:view': 'group' } });
    await flush();
    const b = blocksOf(bodyOf(p));
    expect(b.map((x) => x.hdr)).toEqual(['G1 1 you', 'G3 5', 'ungrouped 1']);   // already first by number: marked
    const q = runPage({ state: { current: payload() }, agent: { activeCharacter: 'Zarrin' }, stored: { 'wp:bq:view': 'group' } });
    await flush();
    expect(blocksOf(bodyOf(q)).map((x) => x.hdr)).toEqual(['G3 5 you', 'G1 1', 'ungrouped 1']);
  });

  it('a character who is nowhere in the groups, or no character at all, leaves numeric order and no "you"', async () => {
    for (const agent of [{ activeCharacter: 'Someoneelse' }, {}]) {
      const p = runPage({ state: { current: payload() }, agent, stored: { 'wp:bq:view': 'group' } });
      await flush();
      expect(blocksOf(bodyOf(p)).map((x) => x.hdr)).toEqual(['G1 1', 'G3 5', 'ungrouped 1']);
    }
  });

  it('the header counts the people shown, and says whose caster the line names', async () => {
    const p = group();
    await flush();
    expect(bodyOf(p)).toContain('<span class="ct">6</span>');
    expect(bodyOf(p)).toContain('by group · caster = someone in that group');
  });

  it('a group with nothing missing is not drawn', () => {
    const P = payload();
    P.groups.push({ group: 7, members: [{ name: 'Corvale', class: 'Enchanter', missing: [], inferred: false }], lines: [] });
    const { api } = runPage({ state: { current: P }, stored: { 'wp:bq:view': 'group' } });
    expect(api._groupsFor(P, '').blocks.map((b) => b.group)).toEqual([1, 3, null]);
  });

  it('ungrouped means null, 0, negative, past 12 or not a number — all one block', () => {
    const { api } = runPage({ state: { current: payload() } });
    expect([null, undefined, '', 0, -1, 13, 2.5, 'x', NaN].map(api._grpNum)).toEqual(Array(9).fill(null));
    expect([1, 12, '4'].map(api._grpNum)).toEqual([1, 12, 4]);
    const P = { buff_queue: [], groups: [
      { group: 0,  members: [{ name: 'Rethlan', missing: ['Haste'] }], lines: [{ key: 'haste', label: 'Haste', missing: ['Rethlan'], casters: [] }] },
    ] };
    expect(api._groupsFor(P, '').blocks[0].group).toBe(null);
  });

  it('names, lines and spells cannot break out of the markup', async () => {
    const P = payload();
    P.groups[1].lines[0].casters = [{ name: '<u onmouseover=x>', class: 'Enchanter', spell: '<b>x</b>' }];
    P.groups[1].lines[1].label = '<i>';
    const p = runPage({ state: { current: P }, stored: { 'wp:bq:view': 'group' } });
    await flush();
    expect(bodyOf(p)).not.toMatch(/<u |<b>x|<i>/);
    expect(bodyOf(p)).toContain('&lt;u onmouseover=x&gt;');
  });

  it('two casters name the first two and count the rest', () => {
    const P = payload();
    const c = (n) => ({ name: n, class: 'Enchanter', spell });
    P.groups[1].lines[0].casters = [c('Corvale'), c('Brackwyn'), c('Zarrin')];
    const { api } = runPage({ state: { current: P }, stored: { 'wp:bq:view': 'group' } });
    expect(blocksOf(api.buildHtml(P))[1].lines[0]).toBe("Haste ×4 → Corvale: Vallon's Quickening · Brackwyn: Vallon's Quickening +1");
  });
});

describe('By group without `groups` (an older bot)', () => {
  const view = (P) => { const p = runPage({ state: { current: P }, stored: { 'wp:bq:view': 'group' } }); return p; };

  it('derives the blocks from the queue rows: same order rules, a line per buff, and no word about casters', async () => {
    const p = view(noGroups());
    await flush();
    const b = blocksOf(bodyOf(p));
    expect(b.map((x) => x.hdr)).toEqual(['G1 1', 'G3 4', 'ungrouped 1']);   // head count = who is in the queue
    expect(b[1].lines).toEqual(['Haste ×4', 'HP B ×1']);
    expect(bodyOf(p)).not.toMatch(/gcast|gno|→/);
    expect(b[1].names).toEqual(['Aldenmar', 'Brackwyn', 'Zarrin']);
    expect(b[1].more).toBe('▸ +1 more');
  });

  it('a row with no gap named is Other, as in the By-buff buckets; group 0 and 13 are ungrouped', () => {
    const P = { buff_queue: [
      { name: 'Aldenmar', group: 0,  class: 'Warrior', tier: 'yellow', missing: [] },
      { name: 'Brackwyn', group: 13, class: 'Rogue',   tier: 'yellow', missing: ['Haste'] },
    ], debuff_queue: [] };
    const { api } = view(P);
    const G = api._groupsFor(P, '');
    expect(G.derived).toBe(true);
    expect(G.blocks).toHaveLength(1);
    expect(G.blocks[0]).toMatchObject({ group: null, size: 2 });
    expect(G.blocks[0].lines.map((l) => [l.label, l.missing])).toEqual([['Other', ['Aldenmar']], ['Haste', ['Brackwyn']]]);
  });

  it('groups that is empty, or not a list, is the same as absent', () => {
    for (const groups of [[], null, 'nope', {}]) {
      const P = noGroups(); P.groups = groups;
      const { api } = view(P);
      expect(api._groupsFor(P, '').derived).toBe(true);
      expect(() => api.buildHtml(P)).not.toThrow();
    }
  });

  it('my group first from the rows alone, when I am in the queue', () => {
    const P = noGroups();
    const { api } = view(P);
    expect(api._groupsFor(P, 'zarrin').blocks.map((b) => b.group)).toEqual([3, 1, null]);
    expect(api._groupsFor(P, 'zarrin').mine).toBe(3);
  });

  it('asks /api/state nothing: there is no group to put first, so nothing to learn', async () => {
    const p = view(noGroups());
    await flush(); await p.api.tick(); await flush();
    expect(p.fetched.filter((u) => /\/api\/state/.test(u))).toHaveLength(0);
  });
});

describe('By buff', () => {
  it('collapsed buckets are exactly as they were: header, count, the first names — no clusters', async () => {
    const p = runPage({ state: { current: payload() } });
    await flush();
    const h = bodyOf(p);
    expect(h.match(/<div class="cathdr"/g)).toHaveLength(2);                 // Haste, HP B
    expect(h).toContain('>Aldenmar, Brackwyn, Zarrin +3</span>');
    expect(h).not.toContain('class="gline"');
    expect(h).not.toContain('class="row ');
  });

  it('an open bucket clusters its people by group, with the caster appended where the payload names one', async () => {
    const p = runPage({ state: { current: payload() }, stored: { ...OPEN_HASTE } });
    await flush();
    const h = bodyOf(p);
    expect(glines(h)).toEqual([
      'G1 ×1', "G3 ×4 → Corvale: Vallon's Quickening", 'ungrouped ×1',     // Haste
      'G3 ×1',                                                              // HP B: Aldenmar alone
    ]);
    // Each cluster is followed by its own people, in queue order, and rows keep their detail.
    const haste = h.slice(h.indexOf('data-cat="Haste"'), h.indexOf('data-cat="HP B"'));
    const order = [...haste.matchAll(/class="gline"|<span class="nm">([^<]*)<\/span>/g)].map((m) => m[1] || '|');
    expect(order).toEqual(['|', 'Rethlan', '|', 'Aldenmar', 'Brackwyn', 'Zarrin', 'Nyssara', '|', 'Tovrin']);
  });

  it('there is no "no <class> in G3" here: By buff only says who CAN cast', async () => {
    const p = runPage({ state: { current: payload() }, stored: { ...OPEN_HASTE } });
    await flush();
    expect(bodyOf(p)).not.toContain('class="gno"');
  });

  it('my group first among the clusters once I am known', async () => {
    const p = runPage({ state: { current: payload() }, agent: { activeCharacter: 'Zarrin' }, stored: { ...OPEN_HASTE } });
    await flush();
    expect(glines(bodyOf(p)).slice(0, 3)).toEqual(["G3 ×4 → Corvale: Vallon's Quickening", 'G1 ×1', 'ungrouped ×1']);
  });

  it('without `groups` the clusters are still there, minus the casters', async () => {
    const p = runPage({ state: { current: noGroups() }, stored: { ...OPEN_HASTE } });
    await flush();
    expect(glines(bodyOf(p))).toEqual(['G1 ×1', 'G3 ×4', 'ungrouped ×1', 'G3 ×1']);
  });

  it('a bucket where nobody has a group (a party, no raid roster) is the plain list, as before', async () => {
    const P = { buff_queue: [
      { name: 'Aldenmar', group: null, class: 'Warrior', tier: 'red',    missing: ['Haste'] },
      { name: 'Brackwyn', group: null, class: 'Rogue',   tier: 'orange', missing: ['Haste'] },
    ], debuff_queue: [], group_mode: true };
    const p = runPage({ state: { current: P }, stored: { ...OPEN_HASTE } });
    await flush();
    expect(bodyOf(p)).not.toContain('class="gline"');
    expect(bodyOf(p).match(/<div class="row /g)).toHaveLength(2);
  });

  it('the bucket still opens and closes on its header and stays in wp:bq:collapsed', async () => {
    const stored = {};
    const p = runPage({ state: { current: payload() }, stored });
    await flush();
    clickOn(p, ['.cathdr'], { 'data-cat': 'Haste' });
    expect(JSON.parse(stored['wp:bq:collapsed'])).toEqual({ Haste: false });
    expect(glines(bodyOf(p))).toContain("G3 ×4 → Corvale: Vallon's Quickening");
    clickOn(p, ['.cathdr'], { 'data-cat': 'Haste' });
    expect(JSON.parse(stored['wp:bq:collapsed'])).toEqual({ Haste: true });
    expect(glines(bodyOf(p))).toEqual([]);
  });

  it('the section filter that turns buffs off turns both views off', async () => {
    const P = payload(); P.sections = { buffs: false };
    for (const view of ['buff', 'group']) {
      const p = runPage({ state: { current: P }, stored: { 'wp:bq:view': view } });
      await flush();
      expect(bodyOf(p)).toBe('');
    }
  });
});

describe('who I am', () => {
  it('is learned from /api/state once the bot sends groups, and not asked again within the throttle', async () => {
    const p = runPage({ state: { current: payload() }, agent: { activeCharacter: 'Zarrin' } });
    await flush(); await p.api.tick(); await p.api.tick(); await flush();
    expect(p.fetched.filter((u) => /\/api\/state/.test(u))).toHaveLength(1);
    expect(p.fetched.filter((u) => /\/api\/buff-queue/.test(u)).length).toBeGreaterThanOrEqual(3);
  });
});

describe('byte-stable rendering', () => {
  it('the same payload renders the same bytes, in both views, from separate builds', () => {
    const a = runPage({ state: { current: payload() } });
    const b = runPage({ state: { current: payload() } });
    for (const view of ['group', 'buff']) {
      a.el(view === 'group' ? 'viewGroup' : 'viewBuff').fire('click', {});
      b.el(view === 'group' ? 'viewGroup' : 'viewBuff').fire('click', {});
      expect(a.api.buildHtml(payload())).toBe(b.api.buildHtml(payload()));
      expect(a.api.buildHtml(payload())).toBe(a.api.buildHtml(payload()));
    }
  });

  it('a poll that changed nothing does not rewrite the section or refit the window', async () => {
    for (const view of ['group', 'buff']) {
      const p = runPage({ state: { current: payload() }, agent: { activeCharacter: 'Zarrin' }, stored: { 'wp:bq:view': view, ...OPEN_HASTE } });
      await flush();
      const before = p.fits.length, html0 = bodyOf(p);
      await p.api.tick(); await flush(); await p.api.tick(); await flush();
      expect(bodyOf(p)).toBe(html0);
      expect(p.fits.length).toBe(before);
    }
  });

  // Nothing in the new markup may depend on the time. (A row with a cast in flight counts down by
  // design, so these payloads carry none.)
  it('a minute later, the same payload is the same bytes', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (const view of ['group', 'buff']) {
        const p = runPage({ state: { current: payload() }, stored: { 'wp:bq:view': view, ...OPEN_HASTE } });
        vi.setSystemTime(new Date('2026-10-04T20:00:00Z'));
        const a = p.api.buildHtml(payload());
        vi.setSystemTime(new Date('2026-10-04T20:01:07Z'));
        expect(p.api.buildHtml(payload())).toBe(a);
        expect(a.length).toBeGreaterThan(200);
      }
    } finally { vi.useRealTimers(); }
  });

  it('a different payload renders different bytes (the guard is not just always-equal)', () => {
    const p = runPage({ state: { current: payload() }, stored: { 'wp:bq:view': 'group' } });
    const P2 = payload(); P2.groups[1].lines[0].casters = [];
    expect(p.api.buildHtml(P2)).not.toBe(p.api.buildHtml(payload()));
  });
});

describe('mini: the top group per line', () => {
  it('the busiest group rides each buff chip, "Haste 6 · G3×4"; cures have none', () => {
    const P = payload();
    P.debuff_queue = [{ name: 'Rethlan', group: 1, class: 'Monk', curses: [{ name: 'Venom Bolt', cure: 'poison' }] }];
    const { api } = runPage({ state: { current: P }, mini: true });
    const c = chips(api.buildMiniHtml(P));
    expect(c).toEqual([
      { key: 'b:Haste', label: 'Haste', n: 6, top: '· G3×4' },
      { key: 'b:HP B',  label: 'HP B',  n: 1, top: '· G3×1' },
      { key: 'c:poison', label: 'Poison', n: 1, top: null },
    ]);
  });

  it('a tie goes to the lower group; ungrouped people never count; no grouped rows, no token', () => {
    const { api } = runPage({ state: { current: payload() }, mini: true });
    expect(api._topGroup([{ group: 5 }, { group: 2 }, { group: 5 }, { group: 2 }, { group: null }, { group: null }, { group: null }])).toEqual({ group: 2, n: 2 });
    expect(api._topGroup([{ group: null }, { group: 0 }])).toBe(null);
    const P = { buff_queue: [{ name: 'Tovrin', group: null, missing: ['Haste'] }], debuff_queue: [] };
    expect(chips(api.buildMiniHtml(P))).toEqual([{ key: 'b:Haste', label: 'Haste', n: 1, top: null }]);
  });

  it('the token cannot make the chip wider than its column: the name shrinks first, the count and token never do', () => {
    const { api } = runPage({ state: { current: payload() }, mini: true });
    const h = api.buildMiniHtml(payload());
    expect(h).toContain('<span class="wp-mini-name">Haste</span> <b class="wp-mini-num">6</b> <span class="wp-mini-num mtop">· G3×4</span>');
    // The shared mini rules (preload.js) that make `wp-mini-name` the part that gives way.
    const preload = readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js'));
    expect(preload).toContain('body.wp-mini .wp-mini-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}');
    expect(preload).toContain('body.wp-mini .wp-mini-num{flex:0 0 auto;');
  });
});

describe('overlay rules for the new markup', () => {
  it('the "+N more" toggle is a <div>, so it asks for the hover handshake the preload looks for', async () => {
    const preload = readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js'));
    const { _wpIsInteractive } = evalBlock(
      'const document = { body: null };\n' + sliceBlock(preload, 'function _wpIsInteractive(el) {', '\n}'),
      ['_wpIsInteractive'],
    );
    const asEl = (tag) => {
      const name = /^<(\w+)/.exec(tag)[1];
      const attrs = new Set([...tag.matchAll(/\s([\w-]+)(?==|\s|>)/g)].map((m) => m[1]));
      return { nodeType: 1, parentElement: null, matches: (sel) => sel.split(',').map((s) => s.trim())
        .some((s) => s === name || (/^\[([\w-]+)\]$/.test(s) && attrs.has(s.slice(1, -1)))) };
    };
    const p = runPage({ state: { current: payload() }, stored: { 'wp:bq:view': 'group' } });
    await flush();
    const tags = bodyOf(p).match(/<div class="gmore"[^>]*>/g) || [];
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) expect(_wpIsInteractive(asEl(t))).toBe(true);
    expect(_wpIsInteractive(asEl('<div class="gline">'))).toBe(false);       // the test can say no
  });

  it('no <details>, no animation or transition, in anything the groups work added', () => {
    const emitted = stripJs(script);
    expect(emitted).not.toMatch(/<details/);
    const rules = css.match(/\.(vsw|vbtn|gblk|ghdr|gline|gmore|mchip \.mtop)[^{]*\{[^}]*\}/g) || [];
    expect(rules.length).toBeGreaterThanOrEqual(10);
    for (const r of rules) expect(r).not.toMatch(/animation|transition|@keyframes/);
    expect(css).not.toMatch(/@keyframes/);
  });

  it('the page script still parses', () => {
    expect(() => new Function(script)).not.toThrow();
  });
});
