// test/pop-overlay-quests.test.js — the Quests mode of the PoP raids overlay (popraid.html).
//
// The guild lead, 2026-10-03: "the pop overlay should include the quests and a mode for selecting them
// and all of the things to say or do for any of the pop quests or flags so we can reference them."
//
// BEHAVIOUR, not text. Two tiers:
//   1. the quest renderer block of popraid.html is run as it stands (evalBlock) over a two-step
//      invented sample: the /say chip, /sit first, the /map chip, the "no words recorded" fallback,
//      data-wp-interact on every chip;
//   2. the page's real inline script runs against a small fake DOM and is driven the way Mimic drives
//      it: the Slides / Quests toggle, prev/next, the picker, the copy click, mini mode.
// Names and phrases below are invented fixtures; the real guide's words are only ever read from the
// generated apps/mimic/pop-quests.js, and one test checks the renderer shows no phrase that is not in it.
//
// Run: npx vitest run test/pop-overlay-quests.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, stripCss, ROOT } from './_source-slice.js';

const MIMIC = path.join(ROOT, 'apps', 'mimic');
const popHtml = readSource(path.join(MIMIC, 'popraid.html'));
const count = (s, sub) => s.split(sub).length - 1;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };

// ── tier 1: the renderer block, run as it stands ────────────────────────────
const ESC_SRC = sliceBlock(popHtml, 'function esc(s){', '[c]); }); }');
const BLOCK = sliceBlock(popHtml, '// ── PoP quests — renderers', '// ── /PoP quests — renderers');
const R = evalBlock(ESC_SRC + '\n' + BLOCK,
  ['questHtml', 'questTags', 'questStops', 'questMiniHtml', 'qGroupLabel', 'qChip', '_qOpen', 'Q_NONE']);

const PLACE = 'Plane of Testing';
// Two steps: Aldenmar (answers only while you sit; two lines, the first needing /sit) and Brackwyn
// (one line, spelled with a parenthetical in the says). Corvale is a place with NO recorded words.
const SAMPLE = {
  key: 'sample_wake', title: 'Wake the warden', who: 'group', must: true,
  detail: 'Talk to the warden, then the keeper.',
  expect: 'A group, a minute.',
  says: [
    { to: 'Warden Aldenmar', text: 'open the gate', sit: true },
    { to: 'Warden Aldenmar', text: 'second word' },
    { to: 'Keeper Brackwyn (optional)', text: 'keys please' },
  ],
  where: [
    { npc: 'Warden Aldenmar', zone: PLACE, y: -12, x: 34, note: 'by the gate' },
    { npc: 'Keeper Brackwyn', zone: PLACE, y: 100, x: -200 },
    { npc: 'Clerk Corvale', zone: PLACE, y: 5, x: 6 },
  ],
};
// The text of one stop: from its name to the next stop, so assertions cannot leak across stops.
const stopOf = (html, npc) => {
  const at = html.indexOf('<span class="qwho">' + npc + '</span>');
  expect(at, 'stop ' + npc).toBeGreaterThan(-1);
  const next = html.indexOf('<div class="qstop">', at);
  return html.slice(at, next < 0 ? undefined : next);
};

describe('quest renderer: what to say, where to go', () => {
  it('each recorded phrase is a copyable /say chip carrying the full command', () => {
    const html = R.questHtml(SAMPLE);
    expect(html).toContain('<span class="qcopy say" data-wp-interact data-copy="/say second word" title="Click to copy">/say second word</span>');
    expect(html).toContain('data-copy="/say open the gate"');
    expect(html).toContain('data-copy="/say keys please"');
    // One chip per phrase, and no other /say chip: the renderer adds no words of its own.
    expect(count(html, 'class="qcopy say"')).toBe(3);
  });

  it('a /sit chip comes first when the NPC only answers while you sit, and only then', () => {
    const ald = stopOf(R.questHtml(SAMPLE), 'Warden Aldenmar');
    const sit = ald.indexOf('data-copy="/sit"');
    expect(sit).toBeGreaterThan(-1);
    expect(sit).toBeLessThan(ald.indexOf('data-copy="/say open the gate"'));
    expect(ald).toContain('sit first');
    // The second line does not need it, and nothing else in the quest gets one.
    expect(count(R.questHtml(SAMPLE), 'data-copy="/sit"')).toBe(1);
    expect(ald.indexOf('data-copy="/sit"')).toBeLessThan(ald.indexOf('data-copy="/say second word"'));
  });

  it('every place is a copyable /map chip in Y X order, with its zone and note', () => {
    const ald = stopOf(R.questHtml(SAMPLE), 'Warden Aldenmar');
    expect(ald).toContain('<span class="qcopy map" data-wp-interact data-copy="/map -12 34" title="Click to copy">/map -12 34</span>');
    expect(ald).toContain('Plane of Testing · by the gate');
    expect(stopOf(R.questHtml(SAMPLE), 'Keeper Brackwyn')).toContain('data-copy="/map 100 -200"');
  });

  it('words addressed to "Name (optional)" land on the place for "Name"', () => {
    const brk = stopOf(R.questHtml(SAMPLE), 'Keeper Brackwyn');
    expect(brk).toContain('data-copy="/say keys please"');
    expect(brk).not.toContain(R.Q_NONE);
  });

  it('a place with no recorded words says so plainly and never gets a phrase', () => {
    const cor = stopOf(R.questHtml(SAMPLE), 'Clerk Corvale');
    expect(cor).toContain('<span class="qnone">hail them — no words recorded</span>');
    expect(cor).not.toContain('class="qcopy say"');
    expect(cor).toContain('data-copy="/map 5 6"');                 // it still says where
    expect(R.Q_NONE).toBe('hail them — no words recorded');
    // A quest whose only step is a place, and one with words but a hand-in recipient beside them.
    expect(R.questHtml({ key: 'k', title: 't', who: 'solo', where: [SAMPLE.where[2]] })).toContain(R.Q_NONE);
    expect(count(R.questHtml(SAMPLE), R.Q_NONE)).toBe(1);
  });

  it('nobody to talk to (a kill, a level, a command) means no place and no fallback line', () => {
    const html = R.questHtml({ key: 'k', title: 'Kill the thing', who: 'raid', detail: 'Then hail the projection.' });
    expect(html).toContain('Then hail the projection.');
    expect(html).not.toContain(R.Q_NONE);
    expect(html).not.toContain('qcopy');
    expect(R.questHtml({ key: 'k', title: 'Kill the thing', who: 'raid' })).toContain('Nothing more is recorded');
  });

  it('words for someone the guide gives no place keep their own name, no /map, and no false fallback elsewhere', () => {
    const q = {
      key: 'k', title: 't', who: 'raid',
      says: [{ to: 'The Stone (at the trial)', text: 'prove' }, { to: 'Mara Zarrin', text: 'hello there' }],
      where: [{ npc: 'Mara Zarrin', zone: PLACE, y: 1, x: 2 }, { npc: 'Rethlan', zone: PLACE, y: 3, x: 4 }],
    };
    const stops = R.questStops(q);
    expect(stops.map(s => [s.label, !!s.at, s.quiet])).toEqual([['Mara Zarrin', true, false], ['Rethlan', true, false], ['The Stone (at the trial)', false, false]]);
    const html = R.questHtml(q);
    expect(html).toContain('data-copy="/say prove"');
    expect(html).not.toContain(R.Q_NONE);   // Rethlan might be who "prove" is for: do not claim he has no words
  });

  it('every chip carries data-wp-interact, and the page arms the hover handshake for its class', () => {
    const html = R.questHtml(SAMPLE);
    const chips = html.match(/<span class="qcopy[^"]*"[^>]*>/g);
    expect(chips.length).toBe(count(html, 'class="qcopy'));
    for (const c of chips) expect(c, c).toContain(' data-wp-interact ');
    expect(R.qChip('say', 'x')).toContain('data-wp-interact');
    // A span is not on the preload's own list: the page's delegated list must name the classes too.
    const sel = stripJs(popHtml).match(/var _IA_SEL = '([^']+)'/)[1].split(',').map(s => s.trim());
    for (const cls of ['.qcopy', '.qnext']) expect(sel).toContain(cls);
  });

  it('escapes what it prints: a phrase with markup cannot break the chip or the copy payload', () => {
    const html = R.questHtml({ key: 'k', title: 't', who: 'solo', says: [{ to: 'A "B"', text: 'x" <i>&' }], where: [] });
    expect(html).toContain('data-copy="/say x&quot; &lt;i&gt;&amp;"');
    expect(html).not.toContain('<i>');
  });

  it('marks who it is for and whether it is a must; "verify at launch" carries the web guide\'s warning', () => {
    const t = R.questTags(SAMPLE);
    expect(t).toContain('qtag who-group">Group</span>');
    expect(t).toContain('★ must');
    expect(R.questTags({ who: 'raid' })).toContain('who-raid">Raid</span>');
    expect(R.questTags({ who: 'solo' })).toContain('Solo');
    expect(R.questTags({ who: 'solo' })).not.toContain('must');
    const chk = R.questTags({ who: 'raid', check: true });
    expect(chk).toContain('verify at launch');
    expect(chk).toContain('not yet confirmed on Quarm');
  });
});

describe('quest renderer: hand-ins, notes, chains', () => {
  it('turn-ins read "give … → get …" at a place with a /map chip; expect and go-back ride along', () => {
    const html = R.questHtml({
      key: 'k', title: 't', who: 'raid', expect: 'Stay in the zone.',
      turnIn: [{ to: { npc: 'Askr Test', zone: PLACE, y: 7, x: 8 }, give: 'a bag of testing', get: 'a flag', note: 'twice' }],
      back: [{ npc: 'Mara Zarrin', zone: PLACE, y: 9, x: 10 }],
    });
    expect(html).toContain('<b>Expect</b> Stay in the zone.');
    expect(html).toContain('<span class="qk">give</span> <span>a bag of testing</span> <span class="qk">→ get</span> <span>a flag</span>');
    expect(html).toContain('data-copy="/map 7 8"');
    expect(html).toContain('twice');
    expect(html).toContain('Then go back to');
    expect(html).toContain('data-copy="/map 9 10"');
  });

  const CHAIN = {
    key: 'sample_chain', title: 'A chain', who: 'solo',
    chain: {
      first: { text: 'Start with the first.', at: { npc: 'First Nyssara', zone: PLACE, y: 1, x: 2 }, say: ['begin'], fetch: { npc: 'A Test Book', zone: PLACE, y: 3, x: 4 } },
      talk: [{ at: { npc: 'Second Corvale', zone: PLACE, y: 5, x: 6 }, say: ['tell me'], note: 'He is ill.' }, { at: { npc: 'Third', zone: PLACE, y: 7, x: 8 } }],
      handins: [{ at: { npc: 'First Nyssara', zone: PLACE, y: 1, x: 2 }, give: 'Thing A', get: 'Thing B' }, { at: { npc: 'Second Corvale', zone: PLACE, y: 5, x: 6 }, give: 'Thing B', get: 'Thing C' }],
    },
  };

  it('a chain starts with where to go, what to say and what to fetch; hand-ins and story are folded away', () => {
    const html = R.questHtml(CHAIN);
    expect(html).toContain('Start here');
    expect(html).toContain('data-copy="/say begin"');
    expect(html).toContain('fetch from');
    expect(html).toContain('data-copy="/map 3 4"');
    expect(html).toContain('<summary>Hand-ins, in order · 2</summary>');
    expect(html).toContain('<summary>Optional: the story, from Second Corvale · 2</summary>');
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toContain('<span class="qk">give</span> <span>Thing A</span> <span class="qk">→ get</span> <span>Thing B</span>');
    expect(html).toContain('He is ill.');
    // The story step with no recorded words says so, rather than showing a phrase.
    expect(html).toContain(R.Q_NONE);
  });

  it('a <details> comes back open when its key is in the JS map, not because of the DOM', () => {
    R._qOpen['sample_chain|handins'] = true;
    try {
      const html = R.questHtml(CHAIN);
      expect(html).toMatch(/<details class="sub panel" data-dk="sample_chain\|handins" open>/);
      expect(html).toMatch(/<details class="sub panel" data-dk="sample_chain\|story">/);
    } finally { delete R._qOpen['sample_chain|handins']; }
  });
});

describe('quest renderer: picker labels and mini', () => {
  it('groups like the web guide: level — section where a level holds several, else the section\'s own title', () => {
    expect(R.qGroupLabel({ title: 'Before the planes', sections: [{}, {}] }, { title: 'Start here' })).toBe('Before the planes — Start here');
    expect(R.qGroupLabel({ title: 'Tier One', sections: [{}] }, { title: 'Tier one: the four open planes' })).toBe('Tier one: the four open planes');
  });

  it('mini is the selected step\'s title and the title of the step after it', () => {
    const list = [{ q: { title: 'First step' } }, { q: { title: 'Second step' } }, { q: { title: 'Last step' } }];
    const mid = R.questMiniHtml(list, 1);
    expect(mid).toContain('<span class="wp-mini-name">PoP · Second step</span>');
    expect(mid).toContain('<div class="qnext" data-wp-interact');
    expect(mid).toContain('next · Last step');
    const last = R.questMiniHtml(list, 2);
    expect(last).toContain('PoP · Last step');
    expect(last).not.toContain('qnext');
    expect(last).toContain('last step in the guide');
  });
});

// ── the real generated data through the renderer ────────────────────────────
describe('the generated guide through the renderer', () => {
  const w = {};
  vm.runInNewContext(fs.readFileSync(path.join(MIMIC, 'pop-quests.js'), 'utf8'), { window: w });
  const all = w.POP_QUESTS.levels.flatMap(lv => lv.sections.flatMap(s => s.quests));
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  it('shows every recorded phrase and place, and not one phrase that is not recorded', () => {
    let said = 0;
    for (const q of all) {
      const html = R.questHtml(q);
      const recorded = new Set([
        ...(q.says || []).map(s => s.text),
        ...(q.chain ? [...(q.chain.first.say || []), ...q.chain.talk.flatMap(s => s.say || [])] : []),
      ]);
      const shown = [...html.matchAll(/data-copy="\/say ([^"]*)"/g)].map(m => unesc(m[1]));
      for (const t of shown) expect(recorded.has(t), q.key + ': "' + t + '" is not in the guide').toBe(true);
      for (const t of recorded) expect(shown.includes(t), q.key + ': missing "' + t + '"').toBe(true);
      for (const s of q.says || []) { said++; expect(html, q.key).toContain('data-copy="/say ' + esc(s.text) + '"'); }
      for (const l of q.where || []) expect(html, q.key).toContain('data-copy="/map ' + l.y + ' ' + l.x + '"');
      expect(html, q.key).not.toMatch(/undefined|null|\[\[/);
    }
    expect(said).toBeGreaterThan(40);
  });

  it('gives every sit-first line its /sit chip', () => {
    const sitters = all.filter(q => (q.says || []).some(s => s.sit));
    expect(sitters.length).toBeGreaterThan(0);
    for (const q of sitters) expect(count(R.questHtml(q), 'data-copy="/sit"'), q.key).toBe(q.says.filter(s => s.sit).length);
  });

  it('tells a place with no words from one with words, for every step in the guide', () => {
    let quiet = 0;
    for (const q of all) {
      const stops = R.questStops(q);
      const html = R.questHtml(q);
      const n = stops.filter(s => s.quiet).length;
      quiet += n;
      // A chain's start and story stops have their own fallback, counted separately.
      const inChain = q.chain ? (q.chain.first.say && q.chain.first.say.length ? 0 : 1) + q.chain.talk.filter(s => !(s.say && s.say.length)).length : 0;
      expect(count(html, R.Q_NONE), q.key).toBe(n + inChain);
      for (const s of stops) if (s.quiet) expect(s.says, q.key).toEqual([]);
    }
    expect(quiet).toBeGreaterThan(0);
  });
});

// ── tier 2: the page's real script on a fake DOM ────────────────────────────
const inlineScript = (html) => { const o = html.indexOf('<script>'); return html.slice(o + 8, html.indexOf('</script>', o)); };
const markupOf = (html) => html.slice(html.indexOf('<body>'), html.indexOf('<script'));

function fakeEl(id, { tag = 'div', classes = [], attrs = {}, parent = null, text = '' } = {}) {
  const cls = new Set(classes);
  const on = {};
  return {
    id, tag, parent, attrs, style: {}, value: '', textContent: text, _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    classList: {
      add: (c) => { cls.add(c); }, remove: (c) => { cls.delete(c); }, contains: (c) => cls.has(c),
      toggle: (c, force) => { const want = force === undefined ? !cls.has(c) : !!force; if (want) cls.add(c); else cls.delete(c); return want; },
    },
    addEventListener(ev, fn) { (on[ev] ||= []).push(fn); },
    fire(ev, evt) { for (const fn of on[ev] || []) fn(evt || {}); },
    getAttribute(a) { return a in attrs ? attrs[a] : null; },
    focus() {},
    closest(sel) {
      const parts = sel.split(',').map(x => x.trim());
      for (let n = this; n; n = n.parent) if (parts.some(p => (p[0] === '.' ? n.classList.contains(p.slice(1)) : n.tag === p))) return n;
      return null;
    },
  };
}

// Two invented quests in two levels, so the picker has groups to show and next/prev have somewhere to go.
const QDATA = {
  levels: [
    { key: 'one', title: 'Level One', sub: 'x', color: '#fff', sections: [
      { key: 's1', title: 'Section A', blurb: 'Read this first.', quests: [
        { key: 'qa', title: 'Quest A', who: 'solo', says: [{ to: 'Warden Aldenmar', text: 'open the gate', sit: true }], where: [{ npc: 'Warden Aldenmar', zone: PLACE, y: -12, x: 34 }] },
      ] },
      { key: 's2', title: 'Section B', quests: [{ key: 'qb', title: 'Quest B', who: 'raid', must: true, detail: 'Kill it.' }] },
    ] },
    { key: 'two', title: 'Level Two', sub: 'y', color: '#fff', sections: [
      { key: 's3', title: 'The only section', quests: [{ key: 'qc', title: 'Quest C', who: 'group' }] },
    ] },
  ],
};
const RAIDS = {
  imageBase: 'https://img.invalid/', quarmGlobalNotes: [],
  sections: [{ id: 'tac', title: 'Tier 3', encounters: [{ id: 'rz', name: 'Rallos Zek', zone: PLACE, tracker: [{ id: 'tank', label: 'Corner tank set' }] }] }],
};

function bootPop({ quests = QDATA, store = {}, mini = false } = {}) {
  const ids = [...markupOf(popHtml).matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const byId = Object.fromEntries(ids.map(id => [id, fakeEl(id)]));
  const body = fakeEl('body', { tag: 'body' });
  if (mini) body.classList.add('wp-mini');
  const dom = { on: {}, body, documentElement: { style: { setProperty() {} } },
    addEventListener(ev, fn) { (dom.on[ev] ||= []).push(fn); },
    fire(ev, evt) { for (const fn of dom.on[ev] || []) fn(evt); },
    getElementById: (id) => byId[id] || null };
  const rec = { fetches: [], copied: [], hover: [], timers: [] };
  const wOn = {};
  const window = {
    mimic: { autoFitOverlay: () => {}, overlayHoverInteractive: (v) => rec.hover.push(v), openExternal() {} },
    POP_RAIDS: RAIDS, POP_QUESTS: quests,
    addEventListener(ev, fn) { (wOn[ev] ||= []).push(fn); }, fire(ev) { for (const fn of wOn[ev] || []) fn({ type: ev }); },
  };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const navigator = { clipboard: { writeText: (t) => { rec.copied.push(t); return Promise.resolve(); } } };
  const fetchImpl = async (url) => { rec.fetches.push(url); return { json: async () => ({ rev: 1, encounters: {} }) }; };
  const run = new Function('window', 'document', 'fetch', 'localStorage', 'setInterval', 'setTimeout', 'navigator',
    inlineScript(popHtml) + '\nreturn { _IA_SEL, pollObjectives };');
  const api = run(window, dom, fetchImpl, localStorage, () => 0, (fn, ms) => { rec.timers.push({ fn, ms }); return 0; }, navigator);
  const setMini = async (on) => { body.classList.toggle('wp-mini', on); window.fire('wp-mini-change'); await flush(); };
  // A chip as the page rendered it: same classes, same data-copy, as a clickable element would have.
  const chip = (cls, copy) => {
    const m = byId.content.innerHTML.match(new RegExp('<span class="(' + cls + '[^"]*)"[^>]*data-copy="' + copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>'));
    expect(m, 'chip ' + copy).not.toBeNull();
    return fakeEl('', { tag: 'span', classes: m[1].split(' '), attrs: { 'data-copy': copy }, text: copy });
  };
  return { api, dom, byId, body, window, rec, store, setMini, chip, content: () => byId.content.innerHTML };
}

describe('Quests mode on the page', () => {
  it('starts in Slides, exactly as before, with the toggle in the title bar', async () => {
    const h = bootPop();
    await flush();
    expect(h.content()).toContain('<div class="nm">Rallos Zek</div>');
    expect(h.byId.modeSlides.classList.contains('on')).toBe(true);
    expect(h.byId.modeQuests.classList.contains('on')).toBe(false);
    expect(h.byId.encPick.innerHTML).toContain('<optgroup label="Tier 3">');
    expect(stripJs(stripCss(markupOf(popHtml)))).toMatch(/<div class="title wp-mini-hide">[\s\S]*id="modeSlides"[\s\S]*id="modeQuests"/);
  });

  it('Quests button switches to the quest list, persists the mode, and Slides button switches back', async () => {
    const h = bootPop();
    h.byId.modeQuests.fire('click');
    expect(h.store['wp:pop:mode']).toBe('quests');
    expect(h.byId.modeQuests.classList.contains('on')).toBe(true);
    expect(h.body.classList.contains('quests')).toBe(true);
    expect(h.content()).toContain('<div class="nm">Quest A</div>');
    expect(h.content()).toContain('1/3');
    expect(h.content()).toContain('Level One — Section A');
    expect(h.content()).toContain('data-copy="/say open the gate"');
    h.byId.modeSlides.fire('click');
    expect(h.store['wp:pop:mode']).toBe('slides');
    expect(h.body.classList.contains('quests')).toBe(false);
    expect(h.content()).toContain('<div class="nm">Rallos Zek</div>');
    expect(h.byId.encPick.innerHTML).toContain('Tier 3');
  });

  it('the picker lists the quests grouped as the web guide groups them', async () => {
    const h = bootPop();
    h.byId.modeQuests.fire('click');
    const p = h.byId.encPick.innerHTML;
    expect(p).toContain('<optgroup label="Level One — Section A"><option value="qa">Quest A</option></optgroup>');
    expect(p).toContain('<optgroup label="Level One — Section B"><option value="qb">Quest B</option></optgroup>');
    expect(p).toContain('<optgroup label="The only section"><option value="qc">Quest C</option></optgroup>');
    expect(h.byId.encPick.value).toBe('qa');
    h.byId.encPick.value = 'qc'; h.byId.encPick.fire('change');
    expect(h.content()).toContain('<div class="nm">Quest C</div>');
  });

  it('prev / next walk the quests in guide order and wrap', async () => {
    const h = bootPop();
    h.byId.modeQuests.fire('click');
    const title = () => h.content().match(/<div class="nm">([^<]+)<\/div>/)[1];
    h.byId.nextBtn.fire('click'); expect(title()).toBe('Quest B');
    h.byId.nextBtn.fire('click'); expect(title()).toBe('Quest C');
    h.byId.nextBtn.fire('click'); expect(title()).toBe('Quest A');
    h.byId.prevBtn.fire('click'); expect(title()).toBe('Quest C');
    // …and Slides still walks encounters, untouched.
    h.byId.modeSlides.fire('click');
    expect(h.content()).toContain('<div class="nm">Rallos Zek</div>');
  });

  it('remembers the mode and the selected quest across a restart', async () => {
    const store = {};
    const first = bootPop({ store });
    first.byId.modeQuests.fire('click');
    first.byId.nextBtn.fire('click');
    expect(store['wp:pop:quest']).toBe('qb');
    const again = bootPop({ store });
    await flush();
    expect(again.content()).toContain('<div class="nm">Quest B</div>');
    expect(again.byId.modeQuests.classList.contains('on')).toBe(true);
    expect(again.byId.encPick.value).toBe('qb');
  });

  it('clicking a chip copies exactly its command, shows ✓ copied, then puts its own text back', async () => {
    const h = bootPop();
    h.byId.modeQuests.fire('click');
    const say = h.chip('qcopy say', '/say open the gate');
    h.byId.content.fire('click', { target: say });
    h.byId.content.fire('click', { target: h.chip('qcopy sit', '/sit') });
    h.byId.content.fire('click', { target: h.chip('qcopy map', '/map -12 34') });
    expect(h.rec.copied).toEqual(['/say open the gate', '/sit', '/map -12 34']);
    expect(say.textContent).toBe('✓ copied');
    expect(say.classList.contains('ok')).toBe(true);
    const restore = h.rec.timers.find(t => t.ms === 1200);
    restore.fn();
    expect(say.textContent).toBe('/say open the gate');
    expect(say.classList.contains('ok')).toBe(false);
  });

  it('the chips and the mini next row get the hover handshake through the page\'s delegated list', async () => {
    const h = bootPop();
    h.byId.modeQuests.fire('click');
    h.dom.fire('mouseover', { target: h.chip('qcopy say', '/say open the gate') });
    h.dom.fire('mouseover', { target: fakeEl('', { classes: ['qnext'] }) });
    expect(h.rec.hover).toEqual([true, true]);
    // Leaving a chip for plain text lets EverQuest have the mouse back.
    h.dom.fire('mouseout', { target: h.chip('qcopy say', '/say open the gate'), relatedTarget: fakeEl('', { classes: ['callout'] }) });
    expect(h.rec.hover).toEqual([true, true, false]);
  });

  it('mini shows the selected quest and the next step\'s title, and clicking the next row walks on', async () => {
    const h = bootPop();
    h.byId.modeQuests.fire('click');
    await h.setMini(true);
    expect(h.content()).toContain('PoP · Quest A</span>');
    expect(h.content()).toContain('next · Quest B');
    expect(h.content()).not.toContain('enc-hdr');
    const next = fakeEl('', { classes: ['qnext'] });
    h.byId.content.fire('click', { target: next });
    expect(h.content()).toContain('PoP · Quest B</span>');
    expect(h.content()).toContain('next · Quest C');
    await h.setMini(false);
    expect(h.content()).toContain('<div class="nm">Quest B</div>');
  });

  it('keeps <details> open across a repaint through its own map, fed by the toggle event', async () => {
    const q = { levels: [{ key: 'l', title: 'L', sub: '', color: '#fff', sections: [{ key: 's', title: 'S', quests: [{
      key: 'ch', title: 'Chain', who: 'solo',
      chain: { first: { text: 't', at: { npc: 'N', zone: PLACE, y: 1, x: 2 }, say: ['go'] }, talk: [], handins: [{ at: { npc: 'N', zone: PLACE, y: 1, x: 2 }, give: 'a', get: 'b' }] },
    }] }] }] };
    const h = bootPop({ quests: q });
    h.byId.modeQuests.fire('click');
    expect(h.content()).not.toMatch(/<details[^>]* open/);
    // The browser fires `toggle` on the <details> (capture phase on the container).
    const det = fakeEl('', { tag: 'details', attrs: { 'data-dk': 'ch|handins' } }); det.open = true;
    h.byId.content.fire('toggle', { target: det });
    h.byId.modeSlides.fire('click'); h.byId.modeQuests.fire('click');   // a full repaint, through Slides and back
    expect(h.content()).toMatch(/<details class="sub panel" data-dk="ch\|handins" open>/);
  });

  it('does not poll the shared checklist in Quests mode, and still does in Slides', async () => {
    const h = bootPop();
    await flush();
    expect(h.rec.fetches.some(u => u.includes('pop-objectives'))).toBe(true);
    h.byId.modeQuests.fire('click');
    await flush();
    h.rec.fetches.length = 0;
    await h.api.pollObjectives();
    expect(h.rec.fetches).toEqual([]);
  });

  it('a build with no quest data stays in Slides and hides the toggle', async () => {
    const h = bootPop({ quests: null, store: { 'wp:pop:mode': 'quests' } });
    await flush();
    expect(h.byId.modeSeg.style.display).toBe('none');
    expect(h.content()).toContain('<div class="nm">Rallos Zek</div>');
    h.byId.modeQuests.fire('click');
    expect(h.content()).toContain('<div class="nm">Rallos Zek</div>');
  });
});
