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
  ['questHtml', 'questTags', 'questStops', 'questMiniHtml', 'qGroupLabel', 'qChip', '_qOpen', 'Q_NONE', 'seqRows', 'qSeqHtml']);

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
    expect(html).toContain('<summary data-wp-interact>Hand-ins, in order · 2</summary>');
    expect(html).toContain('<summary data-wp-interact>Optional: the story, from Second Corvale · 2</summary>');
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

// ── the ordered seq (the guild lead, 2026-10-03: "the hand in items should be in order with the text we say
// to them"): one numbered list in place of "Talk to" + "Turn in", the old rendering where there is no seq ──
describe('quest renderer: a step’s ordered seq', () => {
  const SRC = 'x/y.lua';
  const SEQ_QUEST = {
    key: 'sample_seq', title: 'Open the vault', who: 'group', detail: 'Talk to the warden, then hand in the key.',
    // The pieces the seq replaces: none of these may be drawn once the step has one.
    says: [{ to: 'Warden Aldenmar', text: 'old words' }],
    turnIn: [{ to: { npc: 'Keeper Brackwyn', zone: PLACE, y: 100, x: -200 }, give: 'old give', get: 'old get' }],
    where: [{ npc: 'Warden Aldenmar', zone: PLACE, y: -12, x: 34, note: 'by the gate' }, { npc: 'Keeper Brackwyn', zone: PLACE, y: 100, x: -200 }],
    seq: [
      { kind: 'note', text: 'Bring a key.', src: SRC },
      { kind: 'hail', to: 'Warden Aldenmar', src: SRC },
      { kind: 'say', to: 'Warden Aldenmar', text: 'open the gate', sit: true, src: SRC },
      { kind: 'say', to: 'Warden Aldenmar', text: 'continue', times: 2, until: 'he has nothing new', src: SRC },
      { kind: 'get', items: ['Gate Token'], text: 'the second one gives it', src: SRC },
      { kind: 'note', text: 'He forgets you if you zone.', src: SRC },
      { kind: 'give', to: 'Keeper Brackwyn', items: ['Gate Token', 'Gate Token', 'Rusty Key'], src: SRC },
      { kind: 'get', items: ['Vault Key'], text: '100 experience', src: SRC },
      { kind: 'kill', to: 'The Vault Beast', src: SRC },
      { kind: 'hail', to: 'A Planar Projection', text: 'only with the kill credit', src: SRC },
      { kind: 'get', text: 'a character flag', src: SRC },
      { kind: 'zone', to: 'the vault door', text: 'Click it: that click flags you.', src: SRC },
    ],
  };
  const html = R.questHtml(SEQ_QUEST);
  const at = (s) => { const i = html.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };

  it('draws one numbered list, in the order of the acts: hail, say, say ×2, give, kill, hail, zone', () => {
    const marks = ['/say Hail', 'data-copy="/sit"', 'data-copy="/say open the gate"', 'data-copy="/say continue"',
      'Gate Token ×2, Rusty Key', 'Vault Key', 'The Vault Beast', 'A Planar Projection', 'the vault door'];
    const where = marks.map(at);
    expect(where).toEqual([...where].sort((a, b) => a - b));
    // Seven rows; a get and a note are not rows.
    expect([...html.matchAll(/<span class="qn">(\d+)\.<\/span>/g)].map(m => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(html).toContain('<ol class="qseq">');
    expect(html).toContain('🧭 In order <span class="ct">7</span>');
  });

  it('a phrase said more than once shows ×N, and a repeat shows its "until"', () => {
    const row = html.slice(at('data-copy="/say continue"'), at('data-copy="/say continue"') + 400);
    expect(row).toContain('×2');
    expect(row).toContain('repeat until he has nothing new');
    expect(count(html, '×')).toBeGreaterThanOrEqual(2);       // "continue ×2" and "Gate Token ×2"
    expect(html).toContain('Gate Token ×2, Rusty Key');       // the same item twice in a hand-in reads Name ×2
  });

  it('a get rides on the row before it ("→ get …"); a note hangs under its row; a note before any row leads the list', () => {
    expect(html).toContain('<span class="qk">get</span> Gate Token <span class="qk">(the second one gives it)</span>');
    expect(html).toContain('<span class="qk">get</span> Vault Key <span class="qk">(100 experience)</span>');
    expect(count(html, '<span class="qx">→</span> <span class="qk">get</span>')).toBe(3);
    expect(at('Bring a key.')).toBeLessThan(at('<ol class="qseq">'));
    const forgets = at('He forgets you if you zone.');
    expect(forgets).toBeGreaterThan(at('data-copy="/say continue"'));
    expect(forgets).toBeLessThan(at('<span class="qk">Give</span>'));
    expect(html).toContain('<div class="qnote">He forgets you if you zone.</div>');
  });

  it('/sit comes first for a line that needs it, a hail is the guide’s own "/say Hail", the zone-in is gold', () => {
    const sit = at('data-copy="/sit"');
    expect(sit).toBeLessThan(at('data-copy="/say open the gate"'));
    expect(html).toContain('sit first');
    expect(html).toContain('<span class="qk">Hail</span> <span class="qwho">Warden Aldenmar</span> ');
    expect(html).toContain('data-copy="/say Hail"');
    expect(html).toContain('<li class="qs zone"><span class="qn">7.</span>');
    expect(html).toContain('<span class="qx">Zone in:</span> <span class="qwho">the vault door</span><div class="qnote">Click it: that click flags you.</div>');
    expect(html).toContain('<span class="qk">Hail</span> <span class="qwho">A Planar Projection</span> <span class="qk">(only with the kill credit)</span>');
  });

  it('the old pieces are not drawn again: no says, no Talk to, no Turn in; the places stay, with their /map chips', () => {
    expect(html).not.toContain('old words');
    expect(html).not.toContain('old give');
    expect(html).not.toContain('🗣 Talk to');
    expect(html).not.toContain('📦 Turn in');
    expect(html).toContain('📍 Where <span class="ct">2</span>');
    expect(html).toContain('data-copy="/map -12 34"');
    expect(html).toContain('data-copy="/map 100 -200"');
    expect(html).toContain('Plane of Testing · by the gate');
    expect(html).toContain('Talk to the warden, then hand in the key.');   // the step's own detail still leads
  });

  it('every chip in it carries data-wp-interact (the page arms the hover handshake for the class)', () => {
    const chips = html.match(/<span class="qcopy[^"]*"[^>]*>/g);
    expect(chips.length).toBe(count(html, 'class="qcopy'));
    expect(chips.length).toBeGreaterThanOrEqual(6);                 // hail ×2, sit, say ×2, map ×2
    for (const c of chips) expect(c, c).toContain(' data-wp-interact ');
  });

  it('escapes what it prints, items and notes included', () => {
    const q = { key: 'k', title: 't', who: 'solo', seq: [
      { kind: 'note', text: 'a <b> note', src: SRC },
      { kind: 'give', to: 'A "B"', items: ['x & <y>'], src: SRC },
      { kind: 'say', to: 'C', text: 'x" <i>&', src: SRC },
    ] };
    const h = R.questHtml(q);
    expect(h).toContain('a &lt;b&gt; note');
    expect(h).toContain('x &amp; &lt;y&gt;');
    expect(h).toContain('data-copy="/say x&quot; &lt;i&gt;&amp;"');
    expect(h).not.toMatch(/<(b|i|y)>/);
  });

  it('a step with no seq is drawn exactly as before: Talk to, Turn in, and each phrase once', () => {
    const old = R.questHtml({ ...SEQ_QUEST, seq: undefined });
    expect(old).toContain('🗣 Talk to');
    expect(old).toContain('📦 Turn in');
    expect(old).toContain('data-copy="/say old words"');
    expect(old).not.toContain('qseq');
    expect(R.questHtml({ ...SEQ_QUEST, seq: [] })).toContain('🗣 Talk to');   // an empty seq is no seq
  });

  it('a chain with a seq keeps its start and its story and leaves out the folded hand-ins the seq already lists', () => {
    const chain = {
      first: { text: 'Start with the first.', at: { npc: 'First Nyssara', zone: PLACE, y: 1, x: 2 }, say: ['begin'] },
      talk: [{ at: { npc: 'Second Corvale', zone: PLACE, y: 5, x: 6 }, say: ['tell me'] }],
      handins: [{ at: { npc: 'First Nyssara', zone: PLACE, y: 1, x: 2 }, give: 'Thing A', get: 'Thing B' }],
    };
    const q = { key: 'c', title: 'c', who: 'solo', chain, seq: [{ kind: 'give', to: 'First Nyssara', items: ['Thing A'], src: SRC }, { kind: 'get', items: ['Thing B'], src: SRC }] };
    const h = R.questHtml(q);
    expect(h).toContain('Start here');
    expect(h).toContain('Optional: the story');
    expect(h).not.toContain('Hand-ins, in order');
    expect(h).toContain('<span class="qk">Give</span> <span class="qwho">First Nyssara</span><span class="qk">:</span> Thing A');
    expect(R.questHtml({ ...q, seq: undefined })).toContain('Hand-ins, in order');
  });

  it('seqRows is the same rule as the website’s, row for row, on every step of the real guide', async () => {
    const { seqRows: web } = await import('../web/lib/popGuide.ts');
    const w = {};
    vm.runInNewContext(fs.readFileSync(path.join(MIMIC, 'pop-quests.js'), 'utf8'), { window: w });
    const shape = (s) => ({ lead: s.lead.map(a => a.text), rows: s.rows.map(r => [r.n, r.act.kind, r.gets.length, r.notes.length]) });
    let n = 0;
    for (const q of w.POP_QUESTS.levels.flatMap(lv => lv.sections.flatMap(s => s.quests))) {
      if (!q.seq) continue;
      expect(shape(R.seqRows(q.seq)), q.key).toEqual(shape(web(q.seq)));
      n++;
    }
    expect(n).toBe(65);
  });
});

// ── a step's parts and its short "what to do" (the guild lead, 2026-10-04, on "Win a Justice trial and loot
// its Mark": "The Justice Trials each could use their own subsection … The What to do is wordy.") ──
describe('quest renderer: a step’s parts, one fold each', () => {
  const SRC = 'x/y.lua';
  const part = (key, title, y, x) => ({
    key, title,
    where: [{ npc: 'The Stone', zone: PLACE, y, x, note: 'Trial of ' + key }],
    seq: [
      { kind: 'say', to: 'The Stone (' + key + ')', text: 'prove', src: SRC },
      { kind: 'say', to: 'The Stone (' + key + ')', text: 'ready for ' + key, src: SRC },
      { kind: 'kill', to: 'Warden ' + key, src: SRC },
      { kind: 'get', items: ['Mark of ' + key], src: SRC },
    ],
  });
  const PARTED = {
    key: 'sample_parts', title: 'Win a trial', who: 'raid',
    detail: 'Any one of the trials.',
    seq: [{ kind: 'say', to: 'The Stone', text: 'prove', src: SRC }, { kind: 'kill', to: 'the trial’s boss', src: SRC }],
    parts: [part('alpha', 'Trial of Alpha → Mark of Alpha', 11, 22), part('beta', 'Trial of Beta → Mark of Beta', 33, 44), part('gamma', 'Trial of Gamma → Mark of Gamma', 55, 66)],
    back: [{ npc: 'Mara Zarrin', zone: PLACE, y: 9, x: 10 }],
  };
  const html = R.questHtml(PARTED);
  const at = (s) => { const i = html.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };

  it('draws one folded <details> per part, keyed per step and part, under the step’s In order', () => {
    const keys = [...html.matchAll(/<details class="sub panel" data-dk="([^"]+)"( open)?>/g)];
    expect(keys.map(m => m[1])).toEqual(['sample_parts|part|alpha', 'sample_parts|part|beta', 'sample_parts|part|gamma']);
    expect(keys.every(m => !m[2])).toBe(true);                                  // all folded
    expect(at('<summary data-wp-interact>Trial of Alpha → Mark of Alpha</summary>')).toBeGreaterThan(at('🧭 In order'));
    expect(at('Then go back to')).toBeGreaterThan(at('Trial of Gamma → Mark of Gamma'));
    expect(html).toContain('📑 Parts <span class="ct">3</span>');
  });

  it('each fold has its own copy chips: its /map first, then its /say lines, in its own order', () => {
    const fold = (k) => { const s = html.indexOf('data-dk="sample_parts|part|' + k + '"'); return html.slice(s, html.indexOf('</details>', s)); };
    const b = fold('beta');
    expect(b).toContain('data-copy="/map 33 44"');
    expect(b).toContain('Plane of Testing · Trial of beta');
    expect(b.indexOf('data-copy="/map 33 44"')).toBeLessThan(b.indexOf('data-copy="/say prove"'));
    expect(b.indexOf('data-copy="/say prove"')).toBeLessThan(b.indexOf('data-copy="/say ready for beta"'));
    expect(b.indexOf('data-copy="/say ready for beta"')).toBeLessThan(b.indexOf('Warden beta'));
    expect(b).toContain('<span class="qk">get</span> Mark of beta');
    expect(b).toContain('<ol class="qseq">');
    // …and nothing of another part leaks in.
    for (const other of ['alpha', 'gamma']) expect(b).not.toContain(other);
    // Three folds, three /map chips for them (plus the step's own go-back chip).
    expect(count(html, 'data-copy="/map ')).toBe(4);
  });

  it('a fold comes back open when its key is in the JS map, not because of the DOM', () => {
    R._qOpen['sample_parts|part|gamma'] = true;
    try {
      const h = R.questHtml(PARTED);
      expect(h).toMatch(/<details class="sub panel" data-dk="sample_parts\|part\|gamma" open>/);
      expect(h).toMatch(/<details class="sub panel" data-dk="sample_parts\|part\|alpha">/);
    } finally { delete R._qOpen['sample_parts|part|gamma']; }
  });

  it('a step with no parts is drawn with no Parts panel at all', () => {
    const h = R.questHtml({ ...PARTED, parts: undefined });
    expect(h).not.toContain('qparts');
    expect(h).not.toContain('Parts');
    expect(R.questHtml({ ...PARTED, parts: [] })).not.toContain('qparts');
  });

  it('parts show even on a step with no seq (under its Talk to), and a part without places is just its list', () => {
    const noSeq = R.questHtml({ key: 'k', title: 't', who: 'solo', says: [{ to: 'A', text: 'hi' }], parts: [{ key: 'p', title: 'Only part', seq: PARTED.parts[0].seq }] });
    expect(noSeq).toContain('<summary data-wp-interact>Only part</summary>');
    expect(noSeq.indexOf('Talk to')).toBeLessThan(noSeq.indexOf('Only part'));
    expect(noSeq).not.toContain('data-copy="/map');
  });

  it('escapes a part’s title and words', () => {
    const h = R.questHtml({ key: 'k', title: 't', who: 'solo', parts: [{ key: 'p', title: 'A <b> "x"', seq: [{ kind: 'say', to: 'C', text: 'x" <i>&', src: SRC }] }] });
    expect(h).toContain('A &lt;b&gt; &quot;x&quot;');
    expect(h).toContain('data-copy="/say x&quot; &lt;i&gt;&amp;"');
    expect(h).not.toMatch(/<(b|i)>/);
  });
});

describe('quest renderer: the short "what to do", and the full text folded under More', () => {
  const BRIEF = { key: 'sample_brief', title: 'Wake it', who: 'solo', brief: 'Wake the warden. Mind the keeper.',
    detail: 'A very long explanation of the warden and the keeper, with every caveat.', expect: 'Solo, a minute.' };

  it('shows the brief first and folds detail + Expect under a closed "More" below it', () => {
    const h = R.questHtml(BRIEF);
    expect(h).toContain('<div class="panel"><div class="ph">📝 What to do</div><div class="callout">Wake the warden. Mind the keeper.</div></div>');
    expect(h).toContain('<details class="sub panel" data-dk="sample_brief|more">');
    expect(h).toContain('<summary data-wp-interact>More</summary>');
    const more = h.slice(h.indexOf('data-dk="sample_brief|more"'), h.indexOf('</details>'));
    expect(more).toContain('<div class="callout">A very long explanation of the warden and the keeper, with every caveat.</div>');
    expect(more).toContain('<div class="callout"><b>Expect</b> Solo, a minute.</div>');
    // The full text is ONLY in the fold: the What to do panel carries the brief and nothing else.
    const what = h.slice(h.indexOf('📝 What to do'), h.indexOf('data-dk="sample_brief|more"'));
    expect(what).not.toContain('very long explanation');
    expect(what).not.toContain('Expect');
    expect(h.indexOf('📝 What to do')).toBeLessThan(h.indexOf('<summary data-wp-interact>More'));
  });

  it('More comes back open from the JS map, and a brief with nothing to fold has no More', () => {
    R._qOpen['sample_brief|more'] = true;
    try { expect(R.questHtml(BRIEF)).toContain('data-dk="sample_brief|more" open>'); } finally { delete R._qOpen['sample_brief|more']; }
    const bare = R.questHtml({ key: 'k', title: 't', who: 'solo', brief: 'Just this.' });
    expect(bare).toContain('<div class="callout">Just this.</div>');
    expect(bare).not.toContain('More');
    expect(bare).not.toContain('<details');
    // Expect alone is folded too: nothing is ever dropped.
    expect(R.questHtml({ key: 'k', title: 't', who: 'solo', brief: 'Short.', expect: 'A raid.' })).toContain('<b>Expect</b> A raid.');
  });

  it('a step without a brief is drawn exactly as it always was: one What to do panel, no More', () => {
    const h = R.questHtml({ key: 'k', title: 't', who: 'solo', detail: 'The detail.', expect: 'The expect.' });
    expect(h).toBe('<div class="panel"><div class="ph">📝 What to do</div><div class="callout">The detail.</div><div class="callout"><b>Expect</b> The expect.</div></div>');
    expect(R.questHtml({ key: 'k', title: 't', who: 'solo', detail: 'Only detail.' }))
      .toBe('<div class="panel"><div class="ph">📝 What to do</div><div class="callout">Only detail.</div></div>');
    expect(h).not.toContain('More');
  });

  it('escapes the brief', () => {
    const h = R.questHtml({ key: 'k', title: 't', who: 'solo', brief: 'a <b> & "c"' });
    expect(h).toContain('a &lt;b&gt; &amp; &quot;c&quot;');
    expect(h).not.toContain('<b>');
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
      // A step with a seq is drawn from it (its says, and "Hail" for a hail act); one without, from says[].
      const words = q.seq
        ? [...q.seq.filter(a => a.kind === 'say').map(a => a.text), ...(q.seq.some(a => a.kind === 'hail') ? ['Hail'] : [])]
        : (q.says || []).map(s => s.text);
      // A step's parts (the Justice trials) are drawn from their own seqs, under the step's.
      const partWords = (q.parts || []).flatMap(p => p.seq.filter(a => a.kind === 'say').map(a => a.text));
      const recorded = new Set([
        ...words,
        ...partWords,
        ...(q.chain ? [...(q.chain.first.say || []), ...q.chain.talk.flatMap(s => s.say || [])] : []),
      ]);
      const shown = [...html.matchAll(/data-copy="\/say ([^"]*)"/g)].map(m => unesc(m[1]));
      for (const t of shown) expect(recorded.has(t), q.key + ': "' + t + '" is not in the guide').toBe(true);
      for (const t of recorded) expect(shown.includes(t), q.key + ': missing "' + t + '"').toBe(true);
      for (const t of words) { said++; expect(html, q.key).toContain('data-copy="/say ' + esc(t) + '"'); }
      for (const l of q.where || []) expect(html, q.key).toContain('data-copy="/map ' + l.y + ' ' + l.x + '"');
      expect(html, q.key).not.toMatch(/undefined|null|\[\[/);
    }
    expect(said).toBeGreaterThan(40);
  });

  // The Justice trials (the guild lead, 2026-10-04): six folds, each its own words and its own Tribunal.
  it('Win a Justice trial: the brief on top, six folded trials each with its own words, /map and Mark', () => {
    const q = all.find(x => x.key === 'flag_trial_justice');
    const h = R.questHtml(q);
    const words = ['Lashing', 'Execution', 'Stoning', 'Torture', 'Hanging', 'Flame'];
    expect(q.parts.length).toBe(6);
    const folds = [...h.matchAll(/data-dk="flag_trial_justice\|part\|([a-z]+)"( open)?>/g)];
    expect(folds.map(m => m[1])).toEqual(words.map(w => w.toLowerCase()));
    expect(folds.every(m => !m[2])).toBe(true);
    q.parts.forEach((p, n) => {
      const s = h.indexOf('data-dk="flag_trial_justice|part|' + folds[n][1] + '"');
      const fold = h.slice(s, h.indexOf('</details>', s));
      expect(fold, p.title).toContain('data-copy="/say ready to begin the Trial of ' + words[n] + '"');
      expect(fold, p.title).toContain('data-copy="/say prove"');
      expect(fold, p.title).toContain('data-copy="/say prepared"');
      expect(fold, p.title).toContain('data-copy="/map ' + p.where[0].y + ' ' + p.where[0].x + '"');
      expect(fold, p.title).toContain(esc(p.seq[3].to));                                   // the boss
      expect(fold, p.title).toContain(esc(p.seq[4].items[0]));                             // the Mark
      for (const w of words.filter((_, k) => k !== n)) expect(fold, p.title + ' leaks ' + w).not.toContain('Trial of ' + w);
    });
    // The brief leads, the full detail is folded under More, and the parts sit under the order.
    expect(h).toContain('<div class="callout">' + q.brief + '</div>');
    expect(h.indexOf('<summary data-wp-interact>More')).toBeGreaterThan(h.indexOf(q.brief));
    expect(h.indexOf('🧭 In order')).toBeLessThan(h.indexOf('📑 Parts'));
  });

  it('every step with a brief shows it first, and still carries its full detail and expect, folded under More', () => {
    const withBrief = all.filter(q => q.brief);
    expect(withBrief.length).toBe(23);
    for (const q of withBrief) {
      const h = R.questHtml(q);
      const more = h.indexOf('data-dk="' + q.key + '|more"');
      expect(more, q.key).toBeGreaterThan(-1);
      expect(h.indexOf('<div class="callout">' + esc(q.brief) + '</div>'), q.key).toBeGreaterThan(-1);
      expect(h.indexOf(esc(q.brief)), q.key).toBeLessThan(more);
      // The long text is whole, and only after the fold opens.
      expect(h.indexOf(esc(q.detail)), q.key).toBeGreaterThan(more);
      if (q.expect) expect(h.indexOf(esc(q.expect)), q.key).toBeGreaterThan(more);
      expect(h, q.key).not.toMatch(/undefined|null|\[\[/);
    }
    // A step with no brief keeps its single What to do panel.
    const plain = all.find(q => !q.brief && q.detail);
    expect(R.questHtml(plain)).toContain('<div class="callout">' + esc(plain.detail) + '</div>');
    expect(R.questHtml(plain)).not.toContain('|more"');
  });

  it('gives every sit-first line its /sit chip', () => {
    const lines = (q) => (q.seq ? q.seq.filter(a => a.kind === 'say') : (q.says || []));
    const sitters = all.filter(q => lines(q).some(s => s.sit));
    expect(sitters.length).toBeGreaterThan(0);
    for (const q of sitters) expect(count(R.questHtml(q), 'data-copy="/sit"'), q.key).toBe(lines(q).filter(s => s.sit).length);
  });

  it('draws the seq of every step that has one: every act’s words, items, ×N and zone-in text, in act order', () => {
    const withSeq = all.filter(q => q.seq);
    expect(withSeq.length).toBe(65);
    for (const q of withSeq) {
      const html = R.questHtml(q);
      expect(html, q.key).toContain('<ol class="qseq">');
      expect(html, q.key).not.toContain('🗣 Talk to');
      expect(html, q.key).not.toContain('📦 Turn in');
      let from = html.indexOf('🧭 In order');   // a lead note sits above the <ol>
      expect(from, q.key).toBeGreaterThan(-1);
      for (const a of q.seq) {
        const mark = a.kind === 'say' ? 'data-copy="/say ' + esc(a.text) + '"'
          : a.kind === 'hail' ? '<span class="qwho">' + esc(a.to) + '</span>'
          : a.kind === 'note' || a.kind === 'wait' ? esc(a.text)
          : a.kind === 'get' ? (a.items && a.items[0] ? esc(a.items[0]) : esc(a.text))
          : '<span class="qwho">' + esc(a.to) + '</span>';
        const i = html.indexOf(mark, from);
        expect(i, q.key + ' ' + a.kind + ' ' + mark).toBeGreaterThan(-1);
        // A note can hang under a row and a get rides on one: neither moves the cursor past the next act.
        if (a.kind !== 'note' && a.kind !== 'get') from = i;
        if (a.kind === 'say' && a.times > 1) expect(html.slice(i, i + 500), q.key).toContain('×' + a.times);
        if (a.kind === 'say' && a.until) expect(html.slice(i, i + 500), q.key).toContain('repeat until ' + esc(a.until));
        if (a.kind === 'zone') expect(html, q.key).toContain(esc(a.text));
      }
      expect(html, q.key).not.toMatch(/undefined|null|\[\[/);
    }
  });

  // The Bastion flag is the shrine click's, its own step (the guild lead, 2026-10-03: "the flagging for bastion
  // of thunder REQUIRES you to enter the zone from plane of storms after doing the turnin").
  it('Askr: "continue" ×2 is on its own row, the list ends saying the meld is not the Bastion flag, and the shrine is its own gold row', () => {
    const q = all.find(x => x.key === 'flag_askr');
    const html = R.questHtml(q);
    const i = html.indexOf('data-copy="/say continue"');
    expect(html.slice(i, i + 300)).toContain('×2');
    expect(html).not.toContain('<li class="qs zone">');
    expect(html.lastIndexOf('not your Bastion of Thunder flag yet')).toBeGreaterThan(html.indexOf('data-copy="/say bastion of thunder"'));
    const shrine = R.questHtml(all.find(x => x.key === 'storms_zone_bot'));
    expect(shrine).toContain('<li class="qs zone">');
    expect(shrine).toContain('sets your Bastion flag and sends you in');
  });

  it('tells a place with no words from one with words, for every step in the guide', () => {
    let quiet = 0;
    for (const q of all) {
      const stops = R.questStops(q);
      const html = R.questHtml(q);
      // A step with a seq draws no "Talk to" stops, so no stop can say "no words recorded".
      const n = q.seq ? 0 : stops.filter(s => s.quiet).length;
      quiet += n;
      // A chain's start and story stops have their own fallback, counted separately.
      const inChain = q.chain ? (q.chain.first.say && q.chain.first.say.length ? 0 : 1) + q.chain.talk.filter(s => !(s.say && s.say.length)).length : 0;
      expect(count(html, R.Q_NONE), q.key).toBe(n + inChain);
      for (const s of stops) if (s.quiet) expect(s.says, q.key).toEqual([]);
    }
    // Every step that had a place and no words now has a seq, which draws no "Talk to" stop. A new one that
    // falls back to "no words recorded" should get a seq (test/pop-guide-seq.test.js says which steps need
    // one); the invented-sample test above is what keeps the fallback itself honest.
    expect(quiet).toBe(0);
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
    setAttribute(a, v) { attrs[a] = String(v); },
    removeAttribute(a) { delete attrs[a]; },
    hasAttribute(a) { return a in attrs; },
    scrollTop: 0,
    focus() {},
    // Enough of Element.closest for comma lists of `.class`, `#id` and tag selectors.
    closest(sel) {
      const parts = sel.split(',').map(x => x.trim());
      const hit = (n, p) => (p[0] === '.' ? n.classList.contains(p.slice(1)) : p[0] === '#' ? n.id === p.slice(1) : n.tag === p);
      for (let n = this; n; n = n.parent) if (parts.some(p => hit(n, p))) return n;
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
  const rec = { fetches: [], copied: [], hover: [], timers: [], fits: [], heights: [] };
  // The window-sizing calls: autoFitOverlay measures the element it is given (here, a size that follows
  // the card's markup, so a tall step and a short one measure differently); overlayAutoHeight is the raw
  // height fixed mode sends.
  Object.defineProperty(byId.wrap, 'scrollHeight', { get: () => 200 + byId.content.innerHTML.length });
  const wOn = {};
  const window = {
    mimic: { autoFitOverlay: (el) => rec.fits.push(el.scrollHeight), overlayAutoHeight: (h) => rec.heights.push(h),
      overlayHoverInteractive: (v) => rec.hover.push(v), openExternal() {} },
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
    const h = bootPop({ store: { 'wp:pop:height': 'fit' } });
    h.byId.modeQuests.fire('click');
    h.dom.fire('mouseover', { target: h.chip('qcopy say', '/say open the gate') });
    h.dom.fire('mouseover', { target: fakeEl('', { classes: ['qnext'] }) });
    expect(h.rec.hover).toEqual([true, true]);
    // Leaving a chip for plain text lets EverQuest have the mouse back (fit height: the card is not a
    // scroller, so only its controls take the mouse; fixed height is tested below).
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

// ── the card itself (the guild lead, 2026-10-04: "Needs a text size slider, and it jumps around when
// resizing, and also doesn't like to always show the mouse over it") ────────────────────────────────
// BEHAVIOUR on the fake DOM. The fake wrap's scrollHeight follows the card's markup, so a fit-mode window
// measures a different height for different steps while a fixed one must not.
describe('the card: a fixed height that scrolls (the default), or fit to the content', () => {
  const FIT = { 'wp:pop:height': 'fit' };
  const quests = (h) => { h.byId.modeQuests.fire('click'); };

  it('is fixed by default: body.fixed, and ◀ ▶ send the SAME height for a tall step and a short one, with no fit', async () => {
    const h = bootPop();
    quests(h);
    await flush();
    expect(h.body.classList.contains('fixed')).toBe(true);
    h.rec.heights.length = 0; h.rec.fits.length = 0;
    h.byId.nextBtn.fire('click'); h.byId.nextBtn.fire('click'); h.byId.prevBtn.fire('click');   // A (long), B, C (empty), back to B
    expect(h.rec.heights.length).toBeGreaterThanOrEqual(3);
    expect([...new Set(h.rec.heights)]).toEqual([480]);
    expect(h.rec.fits).toEqual([]);
  });

  it('the same walk in fit mode DOES change the measured height (so the test above can tell the two apart)', async () => {
    const h = bootPop({ store: { ...FIT } });
    quests(h);
    await flush();
    expect(h.body.classList.contains('fixed')).toBe(false);
    h.rec.fits.length = 0; h.rec.heights.length = 0;
    h.byId.nextBtn.fire('click'); h.byId.nextBtn.fire('click');
    expect(new Set(h.rec.fits).size).toBeGreaterThan(1);
    expect(h.rec.heights).toEqual([]);
  });

  it('remembers the height in wp:pop:height: a saved one is used, a tiny one falls back, a huge one is capped, "fit" is fit', async () => {
    const sent = async (v) => { const h = bootPop({ store: v == null ? {} : { 'wp:pop:height': v } }); await flush(); return h.rec.heights.at(-1); };
    expect(await sent('620')).toBe(620);
    expect(await sent('50')).toBe(480);
    expect(await sent('banana')).toBe(480);
    expect(await sent('999999')).toBe(2000);
    expect(await sent(null)).toBe(480);
    const fit = bootPop({ store: { ...FIT } });
    await flush();
    expect(fit.rec.heights).toEqual([]);
    expect(fit.rec.fits.length).toBeGreaterThan(0);
  });

  it('the grip sets the height by dragging (clamped), remembers it on release, and keeps the mouse while dragging', async () => {
    const h = bootPop();
    await flush();
    const g = h.byId.grip;
    g.fire('pointerdown', { button: 0, screenY: 100, pointerId: 1, preventDefault() {} });
    expect(g.classList.contains('drag')).toBe(true);
    g.fire('pointermove', { screenY: 160 });
    expect(h.rec.heights.at(-1)).toBe(540);
    h.dom.fire('mouseout', { target: g, relatedTarget: null });          // mid-drag: the window must not let go
    expect(h.rec.hover).toEqual([true]);
    g.fire('pointermove', { screenY: -5000 });
    expect(h.rec.heights.at(-1)).toBe(140);
    g.fire('pointermove', { screenY: 999999 });
    expect(h.rec.heights.at(-1)).toBe(2000);
    g.fire('pointermove', { screenY: 160 });
    g.fire('pointerup', { pointerId: 1, clientX: 0, clientY: 0 });
    expect(h.store['wp:pop:height']).toBe('540');
    expect(g.classList.contains('drag')).toBe(false);
    expect(h.rec.hover.at(-1)).toBe(false);                               // released away from the card
    // A move with no pointer down does nothing.
    const n = h.rec.heights.length;
    g.fire('pointermove', { screenY: 300 });
    expect(h.rec.heights.length).toBe(n);
    // …and the next boot starts at the remembered height.
    const again = bootPop({ store: h.store });
    await flush();
    expect(again.rec.heights.at(-1)).toBe(540);
  });

  it('double-clicking the grip goes back to fit-to-content, remembers that, and the next drag starts from the content', async () => {
    const h = bootPop();
    await flush();
    const g = h.byId.grip;
    g.fire('dblclick', {});
    expect(h.store['wp:pop:height']).toBe('fit');
    expect(h.body.classList.contains('fixed')).toBe(false);
    expect(h.byId.content.hasAttribute('data-wp-interact')).toBe(false);
    const fitsBefore = h.rec.fits.length;
    h.byId.nextBtn.fire('click');
    expect(h.rec.fits.length).toBeGreaterThan(fitsBefore);                // fit mode measures again
    // Dragging from fit starts at the content's own height and goes fixed again.
    const start = h.byId.wrap.scrollHeight + 8;
    g.fire('pointerdown', { button: 0, screenY: 0, pointerId: 1, preventDefault() {} });
    g.fire('pointermove', { screenY: 10 });
    expect(h.rec.heights.at(-1)).toBe(start + 10);
    expect(h.body.classList.contains('fixed')).toBe(true);
    g.fire('pointerup', { pointerId: 1, clientX: 0, clientY: 0 });
    expect(h.store['wp:pop:height']).toBe(String(start + 10));
    // Only the primary button drags.
    const n = h.rec.heights.length;
    g.fire('pointerdown', { button: 2, screenY: 0, pointerId: 1, preventDefault() {} });
    g.fire('pointermove', { screenY: 50 });
    expect(h.rec.heights.length).toBe(n);
  });

  it('opening or closing a fold re-fits in fit mode (the card changed height); in fixed height the window stays put', async () => {
    const det = () => { const d = fakeEl('', { tag: 'details', attrs: { 'data-dk': 'k|more' } }); d.open = true; return d; };
    const fit = bootPop({ store: { ...FIT } });
    quests(fit);
    await flush();
    fit.rec.fits.length = 0;
    fit.byId.content.fire('toggle', { target: det() });
    expect(fit.rec.fits.length).toBe(1);
    const fixed = bootPop();
    quests(fixed);
    await flush();
    fixed.rec.fits.length = 0; fixed.rec.heights.length = 0;
    fixed.byId.content.fire('toggle', { target: det() });
    expect(fixed.rec.fits).toEqual([]);
    expect(fixed.rec.heights).toEqual([]);
  });

  it('each step, mode flip or mini flip starts the card back at the top, but a fold or a text-size change does not', async () => {
    const h = bootPop();
    quests(h);
    await flush();
    h.byId.content.scrollTop = 250;
    h.byId.content.fire('toggle', { target: fakeEl('', { tag: 'details', attrs: { 'data-dk': 'k' } }) });
    h.byId.fsSlider.value = '110'; h.byId.fsSlider.fire('input');
    expect(h.byId.content.scrollTop).toBe(250);
    h.byId.nextBtn.fire('click');
    expect(h.byId.content.scrollTop).toBe(0);
    h.byId.content.scrollTop = 99; h.byId.modeSlides.fire('click');
    expect(h.byId.content.scrollTop).toBe(0);
  });

  it('mini is always fit and never fixed, whatever full was set to, and full comes back to its height', async () => {
    const h = bootPop();
    await flush();
    await h.setMini(true);
    expect(h.body.classList.contains('fixed')).toBe(false);
    expect(h.byId.content.hasAttribute('data-wp-interact')).toBe(false);
    h.rec.fits.length = 0; h.rec.heights.length = 0;
    h.byId.content.fire('toggle', { target: fakeEl('', { tag: 'details', attrs: { 'data-dk': 'k' } }) });
    expect(h.rec.fits.length).toBe(1);
    await h.setMini(false);
    expect(h.body.classList.contains('fixed')).toBe(true);
    expect(h.rec.heights.at(-1)).toBe(480);
    // The mini page itself boots straight into fit.
    const m = bootPop({ mini: true });
    await flush();
    expect(m.rec.heights).toEqual([]);
    expect(m.rec.fits.length).toBeGreaterThan(0);
  });
});

describe('the card: the mouse', () => {
  const inContent = (h, classes = []) => fakeEl('', { tag: 'span', classes, parent: h.byId.content });

  it('in fixed height the whole card takes the mouse, so the pointer shows over the text and the wheel scrolls it', async () => {
    const h = bootPop();
    h.byId.modeQuests.fire('click');
    await flush();
    expect(h.byId.content.hasAttribute('data-wp-interact')).toBe(true);   // the preload arms on it, whatever the cursor hopped from
    const text = inContent(h, ['callout']);
    h.dom.fire('mouseover', { target: text });
    expect(h.rec.hover).toEqual([true]);
    // From a control onto the card's own text: still the card, so the wheel is not switched off under it.
    h.dom.fire('mouseout', { target: h.chip('qcopy say', '/say open the gate'), relatedTarget: text });
    expect(h.rec.hover).toEqual([true]);
    // Off the card entirely, or out of the window: EverQuest gets the mouse back.
    h.dom.fire('mouseout', { target: text, relatedTarget: fakeEl('', { classes: ['title'] }) });
    expect(h.rec.hover).toEqual([true, false]);
    h.dom.fire('mouseout', { target: text, relatedTarget: null });
    expect(h.rec.hover).toEqual([true, false, false]);
  });

  it('in fit height the card is not a scroller: its text stays click-through and only its controls take the mouse', async () => {
    const h = bootPop({ store: { 'wp:pop:height': 'fit' } });
    h.byId.modeQuests.fire('click');
    await flush();
    expect(h.byId.content.hasAttribute('data-wp-interact')).toBe(false);
    h.dom.fire('mouseover', { target: inContent(h, ['callout']) });
    expect(h.rec.hover).toEqual([]);
    h.dom.fire('mouseover', { target: h.chip('qcopy say', '/say open the gate') });
    expect(h.rec.hover).toEqual([true]);
  });

  it('the grip and the Aa strip take the mouse in either height', async () => {
    for (const store of [{}, { 'wp:pop:height': 'fit' }]) {
      const h = bootPop({ store });
      await flush();
      h.dom.fire('mouseover', { target: h.byId.grip });
      h.dom.fire('mouseover', { target: fakeEl('', { tag: 'span', parent: h.byId.fspanel }) });
      expect(h.rec.hover, JSON.stringify(store)).toEqual([true, true]);
    }
  });

  it('the grip and the Aa strip carry data-wp-interact for the preload, which arms on that attribute', () => {
    const markup = stripJs(stripCss(markupOf(popHtml)));
    expect(markup).toMatch(/<div id="grip" data-wp-interact /);
    expect(markup).toMatch(/<div id="fspanel" class="wp-mini-hide" data-wp-interact>/);
    expect(markup).toMatch(/<button id="fsBtn"/);
  });
});

describe('the card: the CSS it rests on (comments stripped)', () => {
  const css = stripCss(popHtml);

  it('fixed height makes #wrap a column and #content the scroller; the grip hides in mini; the Aa strip opens', () => {
    expect(css).toMatch(/body\.fixed #wrap\{[^}]*height:100vh[^}]*flex-direction:column/);
    expect(css).toMatch(/body\.fixed #content\{[^}]*flex:1 1 auto[^}]*min-height:0[^}]*overflow-y:auto/);
    expect(css).toMatch(/body\.wp-mini #grip\{display:none\}/);
    expect(css).toMatch(/#fspanel\{display:none/);
    expect(css).toMatch(/#fspanel\.open\{display:flex\}/);
    expect(css).toMatch(/#grip\{[^}]*cursor:ns-resize/);
  });

  it('nothing in the CSS zooms #wrap (the element the auto-fit measures)', () => {
    expect(css).not.toMatch(/#wrap[^{]*\{[^}]*zoom/);
    expect(stripJs(inlineScript(popHtml))).not.toMatch(/getElementById\('wrap'\)\.style\.zoom/);
  });
});

describe('the card: text size', () => {
  const zoomOf = (h) => h.byId.content.style.zoom;
  const slide = (h, v) => { h.byId.fsSlider.value = String(v); h.byId.fsSlider.fire('input'); };

  it('an Aa button opens a slider strip (and closes it again)', async () => {
    const h = bootPop();
    await flush();
    expect(h.byId.fspanel.classList.contains('open')).toBe(false);
    h.byId.fsBtn.fire('click');
    expect(h.byId.fspanel.classList.contains('open')).toBe(true);
    expect(h.byId.fsBtn.classList.contains('on')).toBe(true);
    h.byId.fsBtn.fire('click');
    expect(h.byId.fspanel.classList.contains('open')).toBe(false);
    const m = stripJs(stripCss(markupOf(popHtml))).match(/<input id="fsSlider" type="range" min="(\d+)" max="(\d+)" step="(\d+)" value="(\d+)"/);
    expect(m.slice(1)).toEqual(['80', '160', '10', '100']);
  });

  it('applies the zoom to the CONTENT node only (never the wrap the auto-fit measures), shows it, and remembers it', async () => {
    const h = bootPop();
    await flush();
    expect(zoomOf(h)).toBe('');                                            // 100% is no zoom at all
    slide(h, 120);
    expect(zoomOf(h)).toBe('1.2');
    expect(h.byId.wrap.style.zoom).toBeUndefined();
    expect(h.body.style.zoom).toBeUndefined();
    expect(h.byId.fsVal.textContent).toBe('120%');
    expect(h.store['wp:pop:fs']).toBe('120');
    slide(h, 100);
    expect(zoomOf(h)).toBe('');
    expect(h.store['wp:pop:fs']).toBe('100');
  });

  it('snaps to steps of 10 within 80–160 and ignores nonsense', async () => {
    const h = bootPop();
    await flush();
    slide(h, 999); expect(zoomOf(h)).toBe('1.6');
    slide(h, 5);   expect(zoomOf(h)).toBe('0.8');
    slide(h, 123); expect(zoomOf(h)).toBe('1.2');
    slide(h, 'abc'); expect(zoomOf(h)).toBe('');
    expect(h.store['wp:pop:fs']).toBe('100');
  });

  it('comes back at the remembered size on the next boot, with the slider showing it; a bad saved value is 100%', async () => {
    const h = bootPop({ store: { 'wp:pop:fs': '130' } });
    await flush();
    expect(zoomOf(h)).toBe('1.3');
    expect(h.byId.fsSlider.value).toBe('130');
    expect(h.byId.fsVal.textContent).toBe('130%');
    for (const bad of ['300', '10', 'x', '']) {
      const b = bootPop({ store: { 'wp:pop:fs': bad } });
      await flush();
      expect(zoomOf(b), bad).toBe('');
    }
  });

  it('re-fits when the size changes (a zoomed card is a different height); fixed height just keeps its own', async () => {
    const fit = bootPop({ store: { 'wp:pop:height': 'fit' } });
    await flush();
    fit.rec.fits.length = 0;
    slide(fit, 140);
    expect(fit.rec.fits.length).toBe(1);
    const fixed = bootPop();
    await flush();
    fixed.rec.fits.length = 0; fixed.rec.heights.length = 0;
    slide(fixed, 140);
    expect(fixed.rec.fits).toEqual([]);
    expect(fixed.rec.heights).toEqual([480]);
  });

  it('mini keeps its own density: no zoom there, and the size is back when full is', async () => {
    const h = bootPop({ store: { 'wp:pop:fs': '150' } });
    await flush();
    expect(zoomOf(h)).toBe('1.5');
    await h.setMini(true);
    expect(zoomOf(h)).toBe('');
    await h.setMini(false);
    expect(zoomOf(h)).toBe('1.5');
  });

  it('a build whose storage throws still runs at 100% and the default height, and the controls still work', async () => {
    // The page wraps every read and write (private window, blocked site data): prove a throwing store is survived.
    const ids = [...markupOf(popHtml).matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    const byId = Object.fromEntries(ids.map(id => [id, fakeEl(id)]));
    const body = fakeEl('body', { tag: 'body' });
    const dom = { body, documentElement: { style: { setProperty() {} } }, addEventListener() {}, getElementById: (id) => byId[id] || null };
    const heights = [];
    const window = { mimic: { autoFitOverlay() {}, overlayAutoHeight: (x) => heights.push(x), overlayHoverInteractive() {} }, POP_RAIDS: RAIDS, POP_QUESTS: QDATA, addEventListener() {}, fire() {} };
    const boom = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    const run = new Function('window', 'document', 'fetch', 'localStorage', 'setInterval', 'setTimeout', 'navigator',
      inlineScript(popHtml) + '\nreturn {};');
    run(window, dom, async () => ({ json: async () => ({ rev: 1, encounters: {} }) }), boom, () => 0, () => 0, {});
    await flush();
    expect(byId.content.style.zoom).toBe('');
    expect(heights.at(-1)).toBe(480);
    byId.fsSlider.value = '140'; byId.fsSlider.fire('input');          // a write that throws must not break the slider
    expect(byId.content.style.zoom).toBe('1.4');
    byId.grip.fire('dblclick', {});                                      // …nor the grip
    expect(body.classList.contains('fixed')).toBe(false);
  });
});

describe('the card: a step’s parts and brief through the real page', () => {
  const REAL = (() => { const w = {}; vm.runInNewContext(fs.readFileSync(path.join(MIMIC, 'pop-quests.js'), 'utf8'), { window: w }); return w.POP_QUESTS; })();
  const boot = () => bootPop({ quests: REAL, store: { 'wp:pop:mode': 'quests', 'wp:pop:quest': 'flag_trial_justice' } });

  it('opens on the Justice trial step with six folded trials, and the open state survives a repaint', async () => {
    const h = boot();
    await flush();
    expect(h.content()).toContain('<div class="nm">Win a Justice trial and loot its Mark</div>');
    expect(count(h.content(), 'data-dk="flag_trial_justice|part|')).toBe(6);
    expect(h.content()).not.toMatch(/data-dk="flag_trial_justice\|[a-z|]+" open>/);
    const det = fakeEl('', { tag: 'details', attrs: { 'data-dk': 'flag_trial_justice|part|stoning' } }); det.open = true;
    h.byId.content.fire('toggle', { target: det });
    h.byId.modeSlides.fire('click'); h.byId.modeQuests.fire('click');       // a full repaint, through Slides and back
    expect(h.content()).toMatch(/data-dk="flag_trial_justice\|part\|stoning" open>/);
    expect(h.content()).not.toMatch(/data-dk="flag_trial_justice\|part\|lashing" open>/);
  });

  it('the part’s chips copy exactly their commands', async () => {
    const h = boot();
    await flush();
    h.byId.content.fire('click', { target: h.chip('qcopy say', '/say ready to begin the Trial of Torture') });
    h.byId.content.fire('click', { target: h.chip('qcopy map', '/map 713 521') });
    expect(h.rec.copied).toEqual(['/say ready to begin the Trial of Torture', '/map 713 521']);
  });
});
