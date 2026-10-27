// test/pop-overlay-flags.test.js — the Flags mode of the PoP raids overlay (apps/mimic/popraid.html).
//
// The guild lead, 2026-10-27, "A then B" for the per-character PoP flags checklist in Mimic; A is a Flags mode, the third
// segment next to Slides and Quests, for the character being played, with links that jump into the Quests steps. "Build
// in this sort of logic and put the flags checklist per character into motion … as a main addition to the pop overlay …
// with deep linking to steps in the rest of that overlay."
//
// BEHAVIOUR, not text. Two tiers, as test/pop-overlay-quests.test.js does for Quests:
//   1. the Flags renderer block of popraid.html, run as it stands, over the payload the bot's `pop` stream produces for an
//      invented partway character (test/fixtures/pop-status-brackwyn.json, written by utils/popStatus.js on `main`: both
//      branches carry the same file, so the shape cannot drift on one side alone) and the REAL generated pop-quests.js;
//   2. the page's real script on a fake DOM (test/_pop-overlay-harness.js): the mode, the 3 s poll and its change gate, the
//      jumps into Quests and back, the ring on the step, Capture now, the states with no flags to draw.
//
// Run: npx vitest run test/pop-overlay-flags.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { sliceBlock, evalBlock, stripJs, stripCss, ROOT } from './_source-slice.js';
import { popHtml, REAL, bootPop, target, markupOf } from './_pop-overlay-harness.js';

const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'pop-status-brackwyn.json'), 'utf8'));
const BRACKWYN = FX.characters.brackwyn;
// What the local agent's GET /api/pop-status hands the overlay for the character being played.
const body = (over = {}) => ({ active: 'Brackwyn', character: 'Brackwyn', characters: ['Aldenmar', 'Brackwyn'], age_ms: 120000, state: 'ok', status: BRACKWYN, ...over });

const quests = REAL.levels.flatMap(lv => lv.sections.flatMap(s => s.quests));
const Q = Object.fromEntries(quests.map(q => [q.key, q]));
const A = REAL.anchors;

// ── tier 1: the renderer block, run as it stands ────────────────────────────
const ESC_SRC = sliceBlock(popHtml, 'function esc(s){', '[c]); }); }');
const QUEST_BLOCK = sliceBlock(popHtml, '// ── PoP quests — renderers', '// ── /PoP quests — renderers');
const FLAGS_BLOCK = sliceBlock(popHtml, '// ── PoP flags — renderers', '// ── /PoP flags — renderers');
const R = evalBlock(ESC_SRC + '\n' + QUEST_BLOCK + '\n' + FLAGS_BLOCK,
  ['flagsHtml', 'flagsMiniHtml', 'flagsPickHtml', 'flagsBackHtml', 'fQuestKey', 'fPlaneKey', 'fAgo']);
const html = R.flagsHtml(body(), { A, Q, ageText: 'read 2m ago', cap: null });
const count = (s, sub) => s.split(sub).length - 1;
// The text of one panel: from its heading to the next panel.
const panel = (h, cls) => { const at = h.indexOf('class="panel ' + cls + '"'); expect(at, cls).toBeGreaterThan(-1); const next = h.indexOf('<div class="panel', at + 10); return h.slice(at, next < 0 ? undefined : next); };

describe('Flags renderer: a partway character', () => {
  it('heads with the character, the steps done of all, and how old the read is', () => {
    expect(html).toContain('<span class="fname" title="Brackwyn">Brackwyn</span>');
    expect(html).toContain('<span class="fprog">' + BRACKWYN.steps.done + '/' + BRACKWYN.steps.total + ' steps</span>');
    expect(html).toContain('<span class="fage" id="flagsAge">read 2m ago</span>');
    expect(html).toMatch(/<i style="width:\d+%"><\/i>/);
  });

  it('NEXT: the guide\'s own step, who to talk to, the exact phrase and /map as copy chips, and the step as a link', () => {
    const next = panel(html, 'fnext');
    const q = Q.disease_ward;
    expect(next).toContain('Disease to Decay');
    expect(next).toContain('★ must');
    expect(next).toContain(q.title.replace(/&/g, '&amp;'));
    expect(next).toContain('data-copy="/say what ward"');
    expect(next).toContain('data-copy="/map ' + q.where[0].y + ' ' + q.where[0].x + '"');
    expect(next).toContain('data-go="step:disease_ward|what ward"');
    expect(next).toContain('then 5 more on this line');
  });

  it('PENDING MEMORIES: Grummus and Rallos, each with what to do first, linked, and the Seer', () => {
    const p = panel(html, 'fpend');
    expect(p).toContain('Kill Grummus, hail the Planar Projection');
    expect(p).toContain('Kill Rallos Zek, hail the Planar Projection');
    expect(count(p, 'kill logged, memory not unlocked')).toBe(2);
    // Grummus waits on the hail before the kill (the ward); Rallos on Maelin's reading of the Zek notes.
    expect(p).toContain('data-go="step:disease_ward|what ward"');
    expect(p).toContain('data-go="step:zeks_maelin|information"');
    // The Seer line is the guide's: sit, then her words; the link lands on her step and rings that row.
    expect(count(p, 'data-copy="/say unlock my memories"')).toBe(2);
    expect(count(p, 'data-copy="/sit"')).toBe(2);
    expect(count(p, 'data-go="step:start_flag_fixers|unlock my memories"')).toBe(2);
  });

  it('Rallos is BLOCKED BY the cipher, which needs the missing Saryrn half: both as links; Grummus, which waits on nothing, says no such thing', () => {
    const p = panel(html, 'fpend');
    const rallos = p.slice(p.indexOf('Kill Rallos Zek'));
    const grummus = p.slice(p.indexOf('Kill Grummus'), p.indexOf('Kill Rallos Zek'));
    expect(count(rallos, 'Blocked by')).toBe(1);
    expect(rallos).toMatch(/Blocked by<\/span> <button type="button" class="fgo" data-go="step:maelin_cipher\|Hail"[^>]*>Cipher of the Divine Language →<\/button> <span class="qk">which needs<\/span> <button type="button" class="fgo" data-go="step:flag_saryrn"[^>]*>Kill Saryrn →<\/button>/);
    expect(grummus).not.toContain('Blocked by');
  });

  it('a pending memory whose step is held says "Ready" and goes to the Seer', () => {
    const ready = { ...BRACKWYN, pending: [{ key: 'cl_grummus', state: 'ready', gives: 'fuirstel_2', label: 'Kill Grummus, hail the Planar Projection', step: 'fuirstel_2', text: '' }] };
    const h = R.flagsHtml(body({ status: ready }), { A, Q });
    expect(h).toContain('Ready: sit at the Seer and say');
    expect(h).not.toContain('Do first');
    expect(h).toContain('data-go="step:start_flag_fixers|unlock my memories"');
  });

  it('FLAGS BY TIER: done / part / not started, each a jump to its plane, a shut plane marked', () => {
    const t = panel(html, 'ftiers');
    const chip = (label) => { const m = t.match(new RegExp('<button type="button" class="([^"]*)" data-go="([^"]*)" title="([^"]*)">' + label + '</button>')); expect(m, label).not.toBeNull(); return { cls: m[1], go: m[2], title: m[3] }; };
    expect(chip('✓ Justice')).toMatchObject({ go: 'plane:justice' });
    expect(chip('✓ Justice').cls).toContain('st-done');
    const inn = chip('◐ Innovation 2/3');
    expect(inn.cls).toContain('st-part');
    expect(inn.go).toBe('plane:innovation');
    const decay = chip('✗ Decay');
    expect(decay.cls).toContain('st-none');
    expect(decay.cls).toContain('lock');
    expect(decay.go).toBe('plane:decay');                       // the lower Crypt shares the plane
    expect(decay.title).toMatch(/shut: needs/);
    expect(chip('✗ Bertoxx').go).toBe('plane:decay');
    expect(chip('✓ T. Thule').go).toBe('plane:tthule');
    expect(chip('◐ Tactics 2/4').go).toBe('plane:tactics');
    for (const t of [1, 2, 3, 4, 5]) expect(t, 'tier ' + t).toBeGreaterThan(0);
    expect(count(t, 'class="ftn">T')).toBe(5);
    // The tier chips are buttons (the preload arms every button), never a bare clickable span.
    expect(t).not.toMatch(/<span class="fgo[^"]*" data-go/);
  });

  it('DOORS AND KEYS: what is still shut, with the guide\'s words and a link; one that is open is not listed', () => {
    const d = panel(html, 'fdoors');
    expect(d).toContain('Kill Xanamech: Nitram opens the door');
    expect(d).toContain('The door to Meldrath');
    expect(d).toContain('data-go="step:innovation_door_key|');
    const open = { ...BRACKWYN, doors: BRACKWYN.doors.map(x => ({ ...x, held: x.step === 'poi_door_1' })) };
    expect(R.flagsHtml(body({ status: open }), { A, Q })).not.toContain('Nitram opens the door');
    expect(R.flagsHtml(body({ status: { ...BRACKWYN, doors: BRACKWYN.doors.map(x => ({ ...x, held: true })) } }), { A, Q })).not.toContain('fdoors');
  });

  it('the other lines: what else is open, and the folded rest with what each waits on', () => {
    // Brackwyn has one line open (Next); the Zek reading is NOT offered anywhere as doable: Tactics waits on the cipher.
    expect(html).not.toContain('▷ Also open');
    expect(panel(html, 'fnext')).not.toContain('zeks_maelin');
    expect(html).toMatch(/<summary data-wp-interact>The other lines · \d+<\/summary>/);
    expect(html).toMatch(/Tactics<\/span> <span class="qk">waiting · 3\/6<\/span> <span class="qk">needs<\/span> <button[^>]*data-go="step:maelin_cipher\|Hail"/);
    // A second open line is "Also open", with its step as a link.
    const open = { ...BRACKWYN, next: BRACKWYN.next.map(l => (l.line === 'justice'
      ? { ...l, state: 'next', steps: [{ key: 'justice_mavuin_hail', title: 'Hail Mavuin', who: 'solo', must: true, zone: null, verify: false }] } : l)) };
    const h = R.flagsHtml(body({ status: open }), { A, Q });
    expect(h).toContain('▷ Also open');
    expect(h).toMatch(/<span class="qwho">Justice<\/span> <span>Hail Mavuin<\/span> <button[^>]*data-go="step:justice_mavuin_hail\|/);
  });

  it('Capture now: a button, with what it reads, disabled while one runs', () => {
    expect(html).toContain('<button type="button" class="fcap" id="flagsCapture">📥 Capture now</button>');
    expect(html).toContain("reads Brackwyn's last 14 days of log · same scan as the dashboard");
    expect(R.flagsHtml(body(), { A, Q, cap: { busy: true, note: 'reading…' } })).toContain('id="flagsCapture" disabled');
  });

  it('every phrase it shows is one the guide says (nothing is made up), and every clickable thing takes the hover handshake', () => {
    const said = new Set(); const add = (s) => said.add('/say ' + s.text);
    for (const q of quests) { (q.says || []).forEach(add); (q.seq || []).forEach(a => { if (a.kind === 'say') add(a); }); }
    for (const m of html.matchAll(/data-copy="(\/say [^"]*)"/g)) expect(said.has(m[1].replace(/&#39;/g, "'")), m[1]).toBe(true);
    // Chips are spans: each one carries data-wp-interact. Every other clickable is a <button>.
    for (const m of html.matchAll(/<span class="qcopy[^>]*>/g)) expect(m[0], m[0]).toContain('data-wp-interact');
    expect(html).not.toMatch(/onclick=/);
    expect(html).not.toMatch(/<(div|span)[^>]*data-go/);
    for (const m of html.matchAll(/<button[^>]*>/g)) expect(m[0]).toContain('type="button"');
  });
});

describe('Flags renderer: the states with no flags to draw', () => {
  const draw = (b) => R.flagsHtml(b, { A, Q });
  it('an older bot: "Flags need the newer bot", and no Capture button', () => {
    const h = draw(body({ state: 'old_bot', status: null }));
    expect(h).toContain('Flags need the newer bot');
    expect(h).not.toContain('flagsCapture');
  });
  it('not linked to the guild, no character, the bot unable to read, a character that is not yours, the agent silent', () => {
    expect(draw(body({ state: 'offline', status: null }))).toContain('Link it in Settings');
    expect(draw(body({ state: 'no_character', status: null, character: '' }))).toContain('Log in to a character');
    expect(draw(body({ state: 'error', status: null }))).toContain('could not read the flags');
    expect(draw(body({ state: 'unlinked', status: null }))).toContain('Brackwyn is not linked to your Discord');
    expect(draw(null)).toContain('agent is not answering');
    expect(draw(body({ state: 'loading', status: null }))).toContain('Reading your flags');
  });
  it('a character\'s name is escaped, wherever it lands', () => {
    const h = draw(body({ state: 'unlinked', status: null, character: '<b>x</b>' }));
    expect(h).not.toContain('<b>x</b>');
  });
  it('the picker follows the played character or fixes one, and keeps a fixed one the list lost', () => {
    const p = R.flagsPickHtml(body(), '');
    expect(p).toContain('<option value="">Playing now · Brackwyn</option>');
    expect(p).toContain('<option value="Aldenmar">Aldenmar</option>');
    expect(R.flagsPickHtml(body(), 'Aldenmar')).toContain('<option value="Aldenmar" selected>');
    expect(R.flagsPickHtml(body(), 'Zarrin')).toContain('<option value="Zarrin" selected>Zarrin</option>');
  });
  it('mini: the character, its progress, and the next step as one tap', () => {
    const m = R.flagsMiniHtml(body(), { A, Q });
    expect(m).toContain('Flags · Brackwyn · ' + BRACKWYN.steps.done + '/' + BRACKWYN.steps.total);
    expect(m).toContain('class="qnext fgo-mini" data-wp-interact data-go="step:disease_ward"');
    expect(R.flagsMiniHtml(body({ state: 'old_bot', status: null }), { A, Q })).toContain('Flags need the newer bot');
  });
  it('ages read in words', () => {
    expect(R.fAgo(5000)).toBe('read just now');
    expect(R.fAgo(120000)).toBe('read 2m ago');
    expect(R.fAgo(7300000)).toBe('read 2h ago');
    expect(R.fAgo(null)).toBe('');
  });
  it('links resolve any key the engine uses, and nothing else', () => {
    expect(R.fQuestKey(A, Q, 'disease_ward')).toBe('disease_ward');      // a guide step is itself
    expect(R.fQuestKey(A, Q, 'fuirstel_1')).toBe('disease_ward');        // a server step
    expect(R.fQuestKey(A, Q, 'cl_rallos')).toBe('flag_rallos');          // a pending memory
    expect(R.fQuestKey(A, Q, 'cipher_1')).toBe('maelin_cipher');         // a catalog flag
    expect(R.fQuestKey(A, Q, 'stone_loot')).toBe('');                    // no step does it: no link
    expect(R.fQuestKey(A, Q, '')).toBe('');
    expect(R.fPlaneKey(A, 'codb')).toBe('decay');
    expect(R.fPlaneKey(A, 'nope')).toBe('');
  });
  it('"← My flags" says where it came from, and is empty when nothing was jumped to', () => {
    expect(R.flagsBackHtml({ from: 'Pending memories', character: 'Brackwyn' })).toBe(
      '<div class="fback"><button type="button" class="fgo" data-go="flags" title="Back to your flags">← My flags</button><span>came from Pending memories · Brackwyn</span></div>');
    expect(R.flagsBackHtml(null)).toBe('');
  });
});

// ── tier 2: the page's real script on a fake DOM ────────────────────────────
const boot = (o = {}) => bootPop({ status: body(), ...o });
const inFlags = async (o = {}) => { const h = boot({ store: { 'wp:pop:mode': 'flags' }, ...o }); await h.flush(); return h; };
const title = (h) => (h.content().match(/<div class="nm">([^<]+)<\/div>/) || [])[1];

describe('Flags mode on the page', () => {
  it('is the third segment, after Slides and Quests', () => {
    expect(stripJs(stripCss(markupOf(popHtml)))).toMatch(/id="modeSlides"[\s\S]*id="modeQuests"[\s\S]*id="modeFlags"/);
  });

  it('opens on the character being played and draws its flags from the agent', async () => {
    const h = await inFlags();
    expect(h.byId.modeFlags.classList.contains('on')).toBe(true);
    expect(h.byId.modeSlides.classList.contains('on')).toBe(false);
    expect(h.body.classList.contains('flags')).toBe(true);
    expect(h.content()).toContain('<span class="fname" title="Brackwyn">Brackwyn</span>');
    expect(h.byId.encPick.innerHTML).toContain('Playing now · Brackwyn');
    expect(h.rec.fetches.some(u => /\/api\/pop-status$/.test(u))).toBe(true);
  });

  it('the Flags button switches to it, remembers the mode, and Slides switches back', async () => {
    const h = boot();
    await h.flush();
    h.byId.modeFlags.fire('click');
    await h.flush();
    expect(h.store['wp:pop:mode']).toBe('flags');
    expect(h.content()).toContain('class="fname"');
    h.byId.modeSlides.fire('click');
    expect(h.store['wp:pop:mode']).toBe('slides');
    expect(h.body.classList.contains('flags')).toBe(false);
    expect(h.content()).toContain('<div class="nm">Rallos Zek</div>');
  });

  it('asks the local agent every 3 seconds, and never the bot', async () => {
    const h = await inFlags();
    expect(h.rec.fetches.every(u => u.startsWith('http://127.0.0.1:'))).toBe(true);
    expect(stripJs(popHtml.slice(popHtml.indexOf('<script>')))).toMatch(/setInterval\(pollFlags, 3000\)/);
  });

  it('redraws only when the answer changed: a new age is its own span, so the card keeps its scroll and its folds', async () => {
    let age = 120000;
    const h = await inFlags({ status: () => body({ age_ms: age }) });
    let writes = 0; const inner = Object.getOwnPropertyDescriptor(h.byId.content, 'innerHTML');
    Object.defineProperty(h.byId.content, 'innerHTML', { get: inner.get, set(v) { writes++; inner.set.call(this, v); }, configurable: true });
    age = 180000;
    await h.api.pollFlags();
    expect(writes).toBe(0);
    // The age span is updated in place.
    expect(h.byId.flagsAge && h.byId.flagsAge.textContent).toBe('read 3m ago');
    // A real change (a flag landed) does redraw.
    const more = { ...BRACKWYN, steps: { ...BRACKWYN.steps, done: BRACKWYN.steps.done + 1 } };
    const h2 = await inFlags({ status: () => body({ status: more }) });
    expect(h2.content()).toContain((BRACKWYN.steps.done + 1) + '/' + BRACKWYN.steps.total + ' steps');
  });

  it('a jump into the Quests: the step\'s own card, "← My flags" above it, and the row that says the phrase rung', async () => {
    const h = await inFlags();
    h.click(h.goButton('step:disease_ward|what ward'));
    expect(h.body.classList.contains('quests')).toBe(true);
    expect(h.body.classList.contains('flags')).toBe(false);
    expect(h.store['wp:pop:mode']).toBe('quests');
    expect(title(h)).toBe(Q.disease_ward.title);
    expect(h.content()).toContain('class="enc-hdr" data-step="disease_ward"');
    expect(h.content()).toContain('data-go="flags"');
    expect(h.content()).toContain('came from Flags · Brackwyn');
    expect(h.byId.encPick.value).toBe('disease_ward');
    // The ring: the row whose chip says "what ward", not the header.
    expect(h.rec.rings).toEqual([{ label: 'row:/say what ward', add: 'ringed' }]);
  });

  it('a step with no row for the phrase rings the card\'s header instead', async () => {
    const h = await inFlags();
    h.click(h.goButton('step:flag_grummus'));
    expect(h.content()).toContain('data-step="flag_grummus"');
    expect(h.rec.rings).toEqual([{ label: 'step:flag_grummus', add: 'ringed' }]);
  });

  it('names where the jump started: Next, Pending memories, Flags by tier, Doors and keys', async () => {
    const h = await inFlags();
    const panelEl = (cls) => target('div', { classes: ['panel', cls] });
    const btn = (go, cls) => target('button', { classes: ['fgo'], attrs: { 'data-go': go }, parent: panelEl(cls) });
    h.click(btn('step:disease_ward', 'fpend'));
    expect(h.content()).toContain('came from Pending memories · Brackwyn');
    h.click(h.goButton('flags'));
    h.click(btn('plane:decay', 'ftiers'));
    expect(h.content()).toContain('came from Flags by tier · Brackwyn');
    h.click(h.goButton('flags'));
    h.click(btn('step:innovation_door_key', 'fdoors'));
    expect(h.content()).toContain('came from Doors and keys');
    h.click(h.goButton('flags'));
    h.click(btn('step:disease_ward', 'fnext'));
    expect(h.content()).toContain('came from Next');
  });

  it('"← My flags" goes back to the flags and is gone once there', async () => {
    const h = await inFlags();
    h.click(h.goButton('step:disease_ward|what ward'));
    h.click(h.goButton('flags'));
    expect(h.body.classList.contains('flags')).toBe(true);
    expect(h.content()).toContain('class="fname"');
    expect(h.content()).not.toContain('data-go="flags"');
    expect(h.store['wp:pop:mode']).toBe('flags');
  });

  it('a tier chip opens that plane\'s step list, with the way back; a step in it opens normally', async () => {
    const h = await inFlags();
    h.click(h.goButton('plane:decay'));
    expect(h.content()).toContain('Crypt of Decay');
    const keys = quests.filter(q => q.plane === 'decay').map(q => q.key);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(h.content()).toContain('data-step="' + k + '"');
    expect(h.content()).toContain('data-go="flags"');
    h.click(target('button', { classes: ['qblock'], attrs: { 'data-nav': 'quest', 'data-key': keys[0] } }));
    expect(title(h)).toBe(Q[keys[0]].title);
  });

  it('a key it does not know does nothing', async () => {
    const h = await inFlags();
    h.click(target('button', { classes: ['fgo'], attrs: { 'data-go': 'step:no_such_step' } }));
    h.click(target('button', { classes: ['fgo'], attrs: { 'data-go': 'plane:no_such_plane' } }));
    h.click(target('button', { classes: ['fgo'], attrs: { 'data-go': 'bogus' } }));
    expect(h.body.classList.contains('flags')).toBe(true);
    expect(h.content()).toContain('class="fname"');
  });

  it('leaving for Slides after a jump drops the way-back chip: it belongs to the jump, not to the mode', async () => {
    const h = await inFlags();
    h.click(h.goButton('step:disease_ward|what ward'));
    expect(h.content()).toContain('data-go="flags"');
    h.byId.modeSlides.fire('click');
    h.byId.modeQuests.fire('click');
    expect(h.content()).not.toContain('data-go="flags"');
  });

  it('the shared-setup bundle accepts "flags" as the PoP overlay\'s mode, and the fixed character stays private', async () => {
    const sb = (await import('node:module')).createRequire(import.meta.url)(path.join(ROOT, 'apps', 'mimic', 'setupBundle.js'));
    const row = sb.SHARED.find(r => r[0] === 'wp:pop:mode');
    expect(row[3].parse('flags')).not.toBeNull();
    expect(row[3].parse('nonsense')).toBeNull();
    expect(sb.classifyKey('wp:pop:flagchar')).toBe('private');
  });

  it('the picker fixes a character: asks the agent for that one and remembers it', async () => {
    const asked = [];
    const h = await inFlags({ status: (u) => { asked.push(u); return body({ character: /Aldenmar/.test(u) ? 'Aldenmar' : 'Brackwyn' }); } });
    h.byId.encPick.value = 'Aldenmar'; h.byId.encPick.fire('change');
    await h.flush();
    expect(asked.some(u => u.endsWith('/api/pop-status?character=Aldenmar'))).toBe(true);
    expect(h.store['wp:pop:flagchar']).toBe('Aldenmar');
    // …and "Playing now" goes back to following whoever is played.
    h.byId.encPick.value = ''; h.byId.encPick.fire('change');
    await h.flush();
    expect(h.store['wp:pop:flagchar']).toBe('');
  });

  it('an older bot, an agent that is not answering: a plain line, not an empty card', async () => {
    const old = await inFlags({ status: body({ state: 'old_bot', status: null }) });
    expect(old.content()).toContain('Flags need the newer bot');
    const off = await inFlags({ status: null });
    expect(off.content()).toContain('agent is not answering');
  });

  it('Capture now starts the dashboard\'s own scan for THIS character, and says so', async () => {
    const h = await inFlags();
    h.click(target('button', { attrs: {}, id: 'flagsCapture' }));
    await h.flush();
    expect(h.rec.posts).toEqual([{ url: expect.stringMatching(/\/api\/local\/pop-rescan$/), body: { character: 'Brackwyn', days: 14 } }]);
    expect(h.byId.flagsCapNote.textContent).toContain('reading Brackwyn');
    // A second click while one runs sends nothing.
    h.click(target('button', { attrs: {}, id: 'flagsCapture' }));
    await h.flush();
    expect(h.rec.posts.length).toBe(1);
  });

  it('Capture now says what the agent says when it cannot (a scan already running)', async () => {
    const h = await inFlags({ rescan: { start: { status: 409, body: { error: 'a rescan is already running' } } } });
    h.click(target('button', { attrs: {}, id: 'flagsCapture' }));
    await h.flush();
    expect(h.byId.flagsCapNote.textContent).toBe('a rescan is already running');
    expect(h.byId.flagsCapture.disabled).toBe(false);
  });

  it('mini keeps the next step one tap from its card', async () => {
    const h = await inFlags({ mini: true });
    expect(h.content()).toContain('Flags · Brackwyn');
    h.click(target('div', { classes: ['qnext', 'fgo-mini'], attrs: { 'data-go': 'step:disease_ward' } }));
    expect(h.body.classList.contains('quests')).toBe(true);
    expect(h.content()).toContain('Disease, before Grummus');
  });

  it('Slides and Quests are untouched: Slides still polls the shared objectives, Flags and Quests do not', async () => {
    const s = boot();
    await s.flush();
    expect(s.rec.fetches.some(u => u.includes('/api/pop-objectives'))).toBe(true);
    const f = await inFlags();
    expect(f.rec.fetches.some(u => u.includes('/api/pop-objectives'))).toBe(false);
  });
});

describe('the Flags mode meets the overlay checklist (CLAUDE.md: overlay feature-parity, tray ↔ dashboard parity)', () => {
  const code = stripJs(popHtml);
  it('hides the buttons that do not apply, and keeps the 30px right gutter', () => {
    expect(code).toMatch(/body\.flags #upBtn, body\.flags #prevBtn, body\.flags #nextBtn, body\.flags #flagBtn\{display:none\}/);
    expect(code).toMatch(/\.navbtns\{margin-left:auto;margin-right:30px/);
  });
  it('arms the window for every clickable: buttons by tag, spans and divs by data-wp-interact', () => {
    expect(code).toMatch(/var _IA_SEL = 'button, select, input, textarea, a, \.obj, \.lnk, \.dg, summary, \.qcopy, \.qnext'/);
  });
  it('is a mode of the existing overlay, so it adds no tray item: nothing to mirror on the dashboard', () => {
    const main = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'main.js'), 'utf8');
    expect(main).not.toMatch(/showPopFlags|popflagsWindow/i);
  });
  it('has no animation (the ring is an outline for two seconds)', () => {
    // (comments stripped: the block's own comment says "No animation" and would answer for the code)
    const flagsCss = stripCss(popHtml.slice(popHtml.indexOf('/* Flags mode'), popHtml.indexOf('/* A step\'s parts')));
    expect(flagsCss.length).toBeGreaterThan(500);
    expect(flagsCss).not.toMatch(/animation|transition|@keyframes/);
  });
});
