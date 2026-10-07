// test/buff-blocks.test.js — the #blockbuff picker's builders, its socials writer
// and its queue (agent: the "Buff blocks (#blockbuff picker)" section).
//
// Project Quarm's #blockbuff / #blockbuffif / #allowbuff commands let a player stop
// other players' buffs landing on them. Mimic keeps the player's named sets, builds
// the command text to copy, and can write the lines into EQ social macros in the
// character's ini. The guild lead's delivery rule: copy text, or a hotkey, and if
// the character is logged in, write the social at the NEXT log-out (EQ rewrites the
// ini from memory on camp, so a write under a live client is clobbered).
//
// What this pins, and why each one costs something when it breaks:
//  1. Command text. A wrong line shape is a block the server ignores, silently.
//     #allowbuff takes the same optional second id as #blockbuffif.
//  2. Five lines per social, short names. EQ socials hold five lines; a name that
//     is too long is cut by the client and two chunks of a set can then look alike.
//  3. A bad "only while" id must DROP the entry, never turn it into a plain block:
//     that would block a buff the player wanted to keep.
//  4. The free-slot finder never touches a social Mimic did not write for the set —
//     not an unnamed-by-us one, and not one the player edited after Mimic wrote it.
//  5. The queue: logged out → written now; logged in → queued; a newer request for
//     the same set replaces the queued one; the 30 s tick writes it after log-out
//     using the set as it is THEN.
//  6. The picker never drives the game client (Quarm rule 3).
//
// The real source is sliced out of the shipped agent and run — a comment cannot
// satisfy a function call. Run: npx vitest run test/buff-blocks.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const gateBlock = sliceBlock(src, 'function _charLooksLoggedIn(w, now) {', 'return { fname, fp };\n}');
const iniBlock = sliceBlock(src, 'function _applyIniKeyEditsToFile(fp, edits) {', 'return { changed: true };\n}');
const bbBlock = sliceBlock(src, '// ── Buff blocks (#blockbuff picker)', '// ── end buff blocks');

const EXPORTS = [
  '_charLooksLoggedIn', '_charIniPath', '_applyIniKeyEditsToFile',
  'BUFFBLOCK_CATALOG', 'BUFFBLOCK_STARTERS', 'BUFFBLOCK_FAMILIES', 'BUFFBLOCK_CAP',
  '_bbStarterEntries', '_bbCleanShort', '_bbDeriveShort', '_bbLine', '_bbLines', '_bbChunks',
  '_bbSocialName', '_bbSocialEdits', '_bbClearEdits', '_bbParseSocials', '_bbPickFree', '_bbPlanSocials',
  '_bbCleanEntries', '_bbCleanSet', '_bbUniqueShorts', '_bbSaveSets', '_bbSetState', '_bbMakeSocials',
  '_bbApplyPending', '_bbView', '_bbLoad', '_bbOnCount',
];

// One agent per test, with its own store directory, watched logs and Zeal state.
function makeAgent({ dir, zealState = {}, watched = [], spellNames = {} }) {
  globalThis.__bbHarness = {
    fs, path, dir, zealState, stats: { watchedLogs: watched },
    spellNameById: (id) => spellNames[id] || null,
  };
  const prelude = `const { fs, path, stats } = globalThis.__bbHarness;
    const __dirname = globalThis.__bbHarness.dir;
    const _zealState = globalThis.__bbHarness.zealState;
    const _spellNameById = globalThis.__bbHarness.spellNameById;
    const console = { log() {}, warn() {}, error() {} };\n`;
  try { return evalBlock(prelude + gateBlock + '\n' + iniBlock + '\n' + bbBlock, EXPORTS); }
  finally { delete globalThis.__bbHarness; }
}

const INI = [
  '[Defaults]',
  'Volume=5',
  '[Socials]',
  'Page1Button1Name=Heal',
  'Page1Button1Color=0',
  'Page1Button1Line1=/say hi',
  'Page1Button2Name=Pull',
  'Page1Button2Line1=/pet attack',
  'Page2Button1Name=Mine',
  'Page2Button1Color=5',
  'Page2Button1Line1=/rs hello',
  '[HotButtons]',
  'Page1Button1=E18',
  '',
].join('\r\n');

const TWENTY = [3374, 1757, 747, 1449, 1452, 2610, 2606, 1760, 3651, 3372, 1759, 2609, 1196, 3368, 2607, 2608, 1763, 1752, 1450, 3362]
  .map(spell => ({ spell }));

let dir, a, iniPath, logPath, watched;
const NOW = 1_800_000_000_000;

function writeIni(text) { fs.writeFileSync(iniPath, text); }
function readIni() { return fs.readFileSync(iniPath, 'utf8'); }
// The log's last write, `ago` ms before NOW (the 90 s logged-out gate reads it).
function touchLog(ago) { const t = new Date(NOW - ago); fs.utimesSync(logPath, t, t); }
function freshAgent(over = {}) { return makeAgent({ dir, watched, ...over }); }

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-test-'));
  fs.mkdirSync(path.join(dir, 'Logs'));
  logPath = path.join(dir, 'Logs', 'eqlog_Aldenmar_pq.proj.txt');
  iniPath = path.join(dir, 'Aldenmar_pq.proj.ini');
  fs.writeFileSync(logPath, '');
  writeIni(INI);
  touchLog(10 * 60_000);                     // logged out by default
  watched = [{ character: 'Aldenmar', logPath }];
  a = freshAgent();
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// A saved set the tests can write socials for.
function saveSet(agent, entries, name = 'Pulling — bard twist (L47+)', short = 'Twist') {
  expect(agent._bbSaveSets('Aldenmar', [{ id: 'twist', name, short, entries }]).ok).toBe(true);
  return agent._bbView('Aldenmar', NOW).sets[0];
}

describe('command text', () => {
  it('builds the four line shapes', () => {
    expect(a._bbLine('block', { spell: 3374 })).toBe('#blockbuff 3374');
    expect(a._bbLine('block', { spell: 3486, if: 3295 })).toBe('#blockbuffif 3486 3295');
    expect(a._bbLine('allow', { spell: 3374 })).toBe('#allowbuff 3374');
    expect(a._bbLine('allow', { spell: 3486, if: 3295 })).toBe('#allowbuff 3486 3295');
  });

  it('chunks lines five to a social', () => {
    const lines = Array.from({ length: 12 }, (_, i) => '#blockbuff ' + (i + 1));
    const chunks = a._bbChunks(lines);
    expect(chunks.map(c => c.length)).toEqual([5, 5, 2]);
    expect(chunks.flat()).toEqual(lines);
    expect(a._bbChunks([])).toEqual([]);
  });

  it('names socials "Blk <label> n/m" and keeps every name within 15 characters', () => {
    expect(a._bbSocialName('block', 'Twist', 0, 4)).toBe('Blk Twist 1/4');
    expect(a._bbSocialName('allow', 'Twist', 3, 4)).toBe('Alw Twist 4/4');
    expect(a._bbSocialName('block', 'Twist', 0, 1)).toBe('Blk Twist');
    // twenty chunks → "10/20": the label is shortened to fit, not the counter
    const long = a._bbSocialName('block', 'PullAll', 9, 20);
    expect(long).toBe('Blk PullA 10/20');
    for (const [kind, short, i, n] of [['block', 'PullAll', 0, 8], ['allow', 'DruidDS', 7, 8], ['block', "Sev'n.-", 0, 20]]) {
      expect(a._bbSocialName(kind, short, i, n).length).toBeLessThanOrEqual(15);
    }
  });

  it('writes Name, Color and Line1..Line5, with unused lines null so stale ones are deleted', () => {
    const edits = a._bbSocialEdits(3, 7, 'Blk Twist 4/4', ['#blockbuff 1', '#blockbuff 2'], true);
    const byKey = Object.fromEntries(edits.map(e => [e.key, e.value]));
    expect(byKey).toEqual({
      Page3Button7Name: 'Blk Twist 4/4', Page3Button7Color: '0',
      Page3Button7Line1: '#blockbuff 1', Page3Button7Line2: '#blockbuff 2',
      Page3Button7Line3: null, Page3Button7Line4: null, Page3Button7Line5: null,
    });
    expect(edits.every(e => e.section === 'Socials')).toBe(true);
    // a colour the player picked in game is not reset on a rewrite
    expect(a._bbSocialEdits(3, 7, 'x', ['y'], false).some(e => /Color$/.test(e.key))).toBe(false);
  });

  it('derives a short hotkey label from the set name and keeps labels unique', () => {
    expect(a._bbDeriveShort('Pulling — bard twist (L47+)')).toBe('Pulling');
    expect(a._bbDeriveShort('No bard run speed')).toBe('No bard');
    expect(a._bbDeriveShort('')).toBe('Set');
    expect(a._bbCleanShort('  A<b>c  d  ')).toBe('Abc d');
    const sets = [{ short: 'Pulling' }, { short: 'Pulling' }, { short: 'PULLING' }];
    a._bbUniqueShorts(sets);
    expect(sets.map(s => s.short)).toEqual(['Pulling', 'Pullin2', 'PULLIN3']);
  });
});

describe('what a set may hold', () => {
  it('drops an entry whose "only while" id is unusable instead of making it a plain block', () => {
    const out = a._bbCleanEntries([
      { spell: 3486, if: 'abc' },      // not a number
      { spell: 3486, if: 3486 },       // blocks itself
      { spell: 3486, if: -4 },
      { spell: 3198, if: 3448 },       // fine
      { spell: 3198, if: 3448 },       // duplicate
      { spell: 3374, if: '' },         // no condition at all: a plain block
      { spell: 0 }, { spell: 'x' }, null,
    ]);
    expect(out).toEqual([{ spell: 3198, if: 3448 }, { spell: 3374 }]);
  });

  it('ships starter sets whose ids are real catalog songs and whose labels fit a social', () => {
    const ids = new Set(a.BUFFBLOCK_CATALOG.map(c => c.id));
    const byKey = Object.fromEntries(a.BUFFBLOCK_STARTERS.map(s => [s.key, a._bbStarterEntries(s)]));
    expect(byKey['pull-twist']).toHaveLength(20);
    expect(byKey['pull-all']).toHaveLength(40);
    expect(byKey['no-run'].map(e => e.spell)).toEqual([717, 2605, 1750, 1330]);
    expect(byKey['druid-ds']).toEqual([{ spell: 3486, if: 3295 }, { spell: 3198, if: 3448 }]);
    for (const k of ['pull-twist', 'pull-all', 'no-run']) for (const e of byKey[k]) expect(ids.has(e.spell), `${k}: ${e.spell}`).toBe(true);
    for (const s of a.BUFFBLOCK_STARTERS) {
      expect(a._bbCleanShort(s.short)).toBe(s.short);
      expect(a._bbSocialName('block', s.short, 0, 8).length).toBeLessThanOrEqual(15);
    }
    expect(a.BUFFBLOCK_CATALOG.every(c => a.BUFFBLOCK_FAMILIES.some(f => f.key === c.family))).toBe(true);
  });

  it('counts distinct blocks across the sets that are ON, for the over-20 warning', () => {
    a._bbSaveSets('Aldenmar', [
      { id: 'one', name: 'One', entries: TWENTY },
      { id: 'two', name: 'Two', entries: [{ spell: 3374 }, { spell: 9999 }, { spell: 3486, if: 3295 }] },
    ]);
    expect(a._bbView('Aldenmar', NOW).onCount).toBe(0);
    a._bbSetState('Aldenmar', 'one', true, NOW);
    expect(a._bbView('Aldenmar', NOW).onCount).toBe(20);
    a._bbSetState('Aldenmar', 'two', true, NOW);
    expect(a._bbView('Aldenmar', NOW).onCount).toBe(22);   // 3374 shared, 9999 and the conditional are new
    expect(a._bbView('Aldenmar', NOW).cap).toBe(20);
  });
});

describe('the free-slot finder', () => {
  it('reads the taken slots out of [Socials] by key presence', () => {
    const m = a._bbParseSocials(INI);
    expect([...m.keys()].sort()).toEqual(['1|1', '1|2', '2|1']);
    expect(m.get('2|1')).toEqual({ name: 'Mine', color: '5', lines: ['/rs hello'] });
  });

  it('keeps one set together on the first page with room, skipping taken slots', () => {
    const set = saveSet(a, TWENTY);
    const plan = a._bbPlanSocials(INI, { ...set }, 'both', []);
    expect(plan.error).toBeUndefined();
    // 20 entries = 4 block + 4 allow socials; page 1 has 10 free (3..12)
    expect(plan.slots.map(s => `${s.kind}:${s.page}/${s.button}`)).toEqual([
      'block:1/3', 'block:1/4', 'block:1/5', 'block:1/6', 'allow:1/7', 'allow:1/8', 'allow:1/9', 'allow:1/10',
    ]);
    expect(plan.slots.map(s => s.name)).toEqual([
      'Blk Twist 1/4', 'Blk Twist 2/4', 'Blk Twist 3/4', 'Blk Twist 4/4',
      'Alw Twist 1/4', 'Alw Twist 2/4', 'Alw Twist 3/4', 'Alw Twist 4/4',
    ]);
  });

  it('spreads across pages only when no single page has room', () => {
    // pages 1..10 each keep exactly 4 free buttons (buttons 1..8 taken)
    const rows = ['[Socials]'];
    for (let p = 1; p <= 10; p++) for (let b = 1; b <= 8; b++) rows.push(`Page${p}Button${b}Name=x`);
    const plan = a._bbPlanSocials(rows.join('\n'), { ...saveSet(a, TWENTY) }, 'both', []);
    expect(plan.slots.map(s => `${s.page}/${s.button}`)).toEqual(['1/9', '1/10', '1/11', '1/12', '2/9', '2/10', '2/11', '2/12']);
  });

  it('says so, and writes nothing, when the slots run out', () => {
    const rows = ['[Socials]'];
    for (let p = 1; p <= 10; p++) for (let b = 1; b <= 12; b++) if (!(p === 10 && b > 10)) rows.push(`Page${p}Button${b}Name=x`);
    const plan = a._bbPlanSocials(rows.join('\n'), { ...saveSet(a, TWENTY) }, 'both', []);
    expect(plan.error).toMatch(/No free social slots/);
    expect(plan.edits).toBeUndefined();
  });

  it('never gives out a slot another of the character\'s sets owns, even one missing from the ini', () => {
    const plan = a._bbPlanSocials(INI, { ...saveSet(a, [{ spell: 3374 }]) }, 'block', ['1|3', '1|4']);
    expect(plan.slots).toEqual([{ kind: 'block', page: 1, button: 5, name: 'Blk Twist' }]);
  });

  it('writes socials without touching any social Mimic did not write', () => {
    const set = saveSet(a, TWENTY);
    const r = a._bbMakeSocials('Aldenmar', set.id, 'both', NOW);
    expect(r.applied).toBe(true);
    const after = readIni();
    // every pre-existing line survives byte for byte, CRLF kept
    for (const line of INI.split('\r\n').filter(Boolean)) expect(after.split('\r\n')).toContain(line);
    expect(after).not.toMatch(/(?<!\r)\n/);
    const m = a._bbParseSocials(after);
    expect(m.get('1|3')).toEqual({ name: 'Blk Twist 1/4', color: '0', lines: ['#blockbuff 3374', '#blockbuff 1757', '#blockbuff 747', '#blockbuff 1449', '#blockbuff 1452'] });
    expect(m.get('1|7').name).toBe('Alw Twist 1/4');
    expect(m.get('1|7').lines[0]).toBe('#allowbuff 3374');
    // and the first foreign slot is still exactly what the player had
    expect(m.get('1|1')).toEqual({ name: 'Heal', color: '0', lines: ['/say hi'] });
  });

  it('reuses its own slots on a rewrite and clears the ones a smaller set no longer needs', () => {
    const set = saveSet(a, TWENTY);
    a._bbMakeSocials('Aldenmar', set.id, 'both', NOW);
    const first = a._bbParseSocials(readIni());
    // grow by one entry: still 4 chunks of 5? 21 entries = 5 chunks, so one NEW slot per kind
    a._bbSaveSets('Aldenmar', [{ id: set.id, name: set.name, short: 'Twist', entries: [...TWENTY, { spell: 745 }] }]);
    const grown = a._bbMakeSocials('Aldenmar', set.id, 'both', NOW + 1);
    expect(grown.slots.filter(s => s.kind === 'block').map(s => `${s.page}/${s.button}`)).toEqual(['1/3', '1/4', '1/5', '1/6', '1/11']);
    expect(grown.slots.filter(s => s.kind === 'allow').map(s => `${s.page}/${s.button}`)).toEqual(['1/7', '1/8', '1/9', '1/10', '1/12']);
    // shrink to 4 entries: one chunk per kind, the other buttons are emptied
    a._bbSaveSets('Aldenmar', [{ id: set.id, name: set.name, short: 'Twist', entries: TWENTY.slice(0, 4) }]);
    const shrunk = a._bbMakeSocials('Aldenmar', set.id, 'both', NOW + 2);
    expect(shrunk.slots.map(s => `${s.kind}:${s.page}/${s.button}:${s.name}`)).toEqual(['block:1/3:Blk Twist', 'allow:1/7:Alw Twist']);
    const after = a._bbParseSocials(readIni());
    expect([...after.keys()].sort()).toEqual(['1|1', '1|2', '1|3', '1|7', '2|1']);
    expect(first.get('1|4')).toBeDefined();           // it existed before the shrink
    expect(after.get('1|3').lines).toEqual(['#blockbuff 3374', '#blockbuff 1757', '#blockbuff 747', '#blockbuff 1449']);
  });

  it('treats a social the player edited after Mimic wrote it as theirs', () => {
    const set = saveSet(a, TWENTY);
    a._bbMakeSocials('Aldenmar', set.id, 'both', NOW);
    // the player renames the social on Page 1 button 3 and gives it their own line
    writeIni(readIni().replace('Page1Button3Name=Blk Twist 1/4', 'Page1Button3Name=My Macro').replace('Page1Button3Line1=#blockbuff 3374', 'Page1Button3Line1=/say mine'));
    const again = a._bbMakeSocials('Aldenmar', set.id, 'both', NOW + 1);
    expect(again.applied).toBe(true);
    const after = a._bbParseSocials(readIni());
    expect(after.get('1|3')).toEqual({ name: 'My Macro', color: '0', lines: ['/say mine', '#blockbuff 1757', '#blockbuff 747', '#blockbuff 1449', '#blockbuff 1452'] });
    expect(again.slots.find(s => s.name === 'Blk Twist 1/4')).toBeDefined();
    expect(again.slots.find(s => s.name === 'Blk Twist 1/4')).not.toMatchObject({ page: 1, button: 3 });
  });
});

describe('the logged-out gate and the queue', () => {
  it('writes at once when the character is logged out', () => {
    const set = saveSet(a, TWENTY.slice(0, 5));
    const r = a._bbMakeSocials('Aldenmar', set.id, 'both', NOW);
    expect(r).toMatchObject({ ok: true, applied: true, changed: true });
    expect(r.slots).toHaveLength(2);
    expect(readIni()).toContain('Page1Button3Name=Blk Twist');
    expect(a._bbView('Aldenmar', NOW).pending).toEqual([]);
  });

  it('queues, and leaves the ini alone, while the log is fresh', () => {
    touchLog(30_000);
    const set = saveSet(a, TWENTY.slice(0, 5));
    const r = a._bbMakeSocials('Aldenmar', set.id, 'both', NOW);
    expect(r).toMatchObject({ ok: true, queued: true });
    expect(readIni()).toBe(INI);
    expect(a._bbView('Aldenmar', NOW).pending).toEqual([{ setId: 'twist', kind: 'both', queuedAt: NOW }]);
  });

  it('queues while a Zeal sample is under two minutes old, even with a quiet log', () => {
    const zealState = { aldenmar: { updatedAt: NOW - 60_000 } };
    const z = freshAgent({ zealState });
    const set = saveSet(z, TWENTY.slice(0, 5));
    expect(z._bbMakeSocials('Aldenmar', set.id, 'both', NOW).queued).toBe(true);
    zealState.aldenmar.updatedAt = NOW - 121_000;
    expect(z._bbMakeSocials('Aldenmar', set.id, 'both', NOW).applied).toBe(true);
  });

  it('draws the gate at 90 s of log silence and 120 s of Zeal silence', () => {
    const w = watched[0];
    touchLog(89_000); expect(a._charLooksLoggedIn(w, NOW)).toBe(true);
    touchLog(91_000); expect(a._charLooksLoggedIn(w, NOW)).toBe(false);
    const z = freshAgent({ zealState: { Aldenmar: { updatedAt: NOW - 119_000 } } });
    expect(z._charLooksLoggedIn(w, NOW)).toBe(true);
    expect(freshAgent({ zealState: { Aldenmar: { updatedAt: NOW - 121_000 } } })._charLooksLoggedIn(w, NOW)).toBe(false);
  });

  it('keeps ONE queued write per set: a newer request replaces the older', () => {
    touchLog(30_000);
    const set = saveSet(a, TWENTY.slice(0, 5));
    a._bbMakeSocials('Aldenmar', set.id, 'block', NOW);
    a._bbMakeSocials('Aldenmar', set.id, 'both', NOW + 5_000);
    expect(a._bbView('Aldenmar', NOW).pending).toEqual([{ setId: 'twist', kind: 'both', queuedAt: NOW + 5_000 }]);
  });

  it('writes the queue on the tick after log-out, using the set as it is then', () => {
    touchLog(30_000);
    const set = saveSet(a, TWENTY.slice(0, 5));
    a._bbMakeSocials('Aldenmar', set.id, 'both', NOW);
    expect(a._bbApplyPending(NOW + 1_000)).toEqual([]);         // still logged in
    expect(readIni()).toBe(INI);
    // edited while it waited: the write must carry the NEW entries
    a._bbSaveSets('Aldenmar', [{ id: set.id, name: set.name, short: 'Twist', entries: [{ spell: 745 }] }]);
    touchLog(5 * 60_000);                                       // camped
    const done = a._bbApplyPending(NOW + 5 * 60_000);
    expect(done).toHaveLength(1);
    expect(readIni()).toContain('Page1Button3Line1=#blockbuff 745');
    expect(readIni()).not.toContain('#blockbuff 3374');
    expect(a._bbView('Aldenmar', NOW).pending).toEqual([]);
    // and it is not written twice
    expect(a._bbApplyPending(NOW + 6 * 60_000)).toEqual([]);
  });

  it('forgets a queued write whose set was deleted', () => {
    touchLog(30_000);
    const set = saveSet(a, TWENTY.slice(0, 5));
    a._bbMakeSocials('Aldenmar', set.id, 'both', NOW);
    a._bbSaveSets('Aldenmar', []);
    expect(a._bbView('Aldenmar', NOW).pending).toEqual([]);
    touchLog(5 * 60_000);
    expect(a._bbApplyPending(NOW + 5 * 60_000)).toEqual([]);
    expect(readIni()).toBe(INI);
  });

  it('keeps a write it cannot do queued, with the reason, and retries', () => {
    const rows = ['[Socials]'];
    for (let p = 1; p <= 10; p++) for (let b = 1; b <= 12; b++) rows.push(`Page${p}Button${b}Name=x`);
    writeIni(rows.join('\n'));
    touchLog(30_000);
    const set = saveSet(a, TWENTY.slice(0, 5));
    a._bbMakeSocials('Aldenmar', set.id, 'both', NOW);
    touchLog(5 * 60_000);
    expect(a._bbApplyPending(NOW + 5 * 60_000)).toEqual([]);
    const p = a._bbView('Aldenmar', NOW).pending[0];
    expect(p.error).toMatch(/No free social slots/);
    // the player frees a page; the next tick succeeds
    writeIni('[Socials]\nPage1Button1Name=x\n');
    expect(a._bbApplyPending(NOW + 6 * 60_000)).toHaveLength(1);
    expect(a._bbView('Aldenmar', NOW).pending).toEqual([]);
  });

  it('explains instead of guessing when the character is not watched or the ini is missing', () => {
    const set = saveSet(a, TWENTY.slice(0, 5));
    const unwatched = freshAgent({ watched: [] })._bbMakeSocials('Aldenmar', set.id, 'both', NOW);
    expect(unwatched.ok).toBe(false);
    expect(unwatched.error).toMatch(/not watching/);
    fs.rmSync(iniPath);
    const r = a._bbMakeSocials('Aldenmar', set.id, 'both', NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ini not found: Aldenmar_pq\.proj\.ini/);
    expect(a._bbMakeSocials('Aldenmar', 'nope', 'both', NOW)).toMatchObject({ ok: false, error: 'unknown set' });
  });
});

describe('the store', () => {
  it('keeps state server-side: a save carries names and entries, never on/changedAt/socials', () => {
    const set = saveSet(a, TWENTY.slice(0, 5));
    a._bbSetState('Aldenmar', set.id, true, NOW);
    a._bbMakeSocials('Aldenmar', set.id, 'both', NOW);
    const forged = [{ id: set.id, name: 'Renamed', entries: TWENTY.slice(0, 5), on: false, changedAt: 1, socials: { slots: [{ kind: 'block', page: 9, button: 9, name: 'x' }] } }];
    a._bbSaveSets('Aldenmar', forged);
    const s = a._bbView('Aldenmar', NOW).sets[0];
    expect(s).toMatchObject({ name: 'Renamed', on: true, changedAt: NOW });
    expect(s.socials.slots.every(o => o.page === 1)).toBe(true);
    // a brand-new set starts with no state and no socials even if the client claims some
    a._bbSaveSets('Aldenmar', [...forged, { id: 'fresh', name: 'Fresh', entries: [], on: true, socials: forged[0].socials }]);
    const fresh = a._bbView('Aldenmar', NOW).sets.find(x => x.id === 'fresh');
    expect(fresh.on).toBeNull();
    expect(fresh.socials).toBeNull();
  });

  it('flags socials as stale once the set changes after they were written', () => {
    const set = saveSet(a, TWENTY.slice(0, 5));
    a._bbMakeSocials('Aldenmar', set.id, 'both', NOW);
    expect(a._bbView('Aldenmar', NOW).sets[0].stale).toBe(false);
    a._bbSaveSets('Aldenmar', [{ id: set.id, name: set.name, short: 'Twist', entries: TWENTY.slice(0, 6) }]);
    expect(a._bbView('Aldenmar', NOW).sets[0].stale).toBe(true);
  });

  it('refuses a character it does not know, a non-list, and duplicate ids or labels', () => {
    expect(a._bbSaveSets('Nobody', []).ok).toBe(false);
    expect(a._bbSaveSets('Aldenmar', 'x').ok).toBe(false);
    a._bbSaveSets('Aldenmar', [
      { id: 'same', name: 'Pulling one', entries: [{ spell: 1 }] },
      { id: 'same', name: 'Pulling two', entries: [{ spell: 2 }] },
    ]);
    const sets = a._bbView('Aldenmar', NOW).sets;
    expect(new Set(sets.map(s => s.id)).size).toBe(2);
    expect(new Set(sets.map(s => s.short.toLowerCase())).size).toBe(2);
  });

  it('survives a restart: written atomically, read back whole, hand edits cleaned', () => {
    const set = saveSet(a, TWENTY);
    a._bbSetState('Aldenmar', set.id, true, NOW);
    a._bbMakeSocials('Aldenmar', set.id, 'both', NOW);
    expect(fs.readdirSync(dir).filter(f => f.includes('.tmp'))).toEqual([]);
    const reread = freshAgent()._bbView('Aldenmar', NOW).sets[0];
    expect(reread).toMatchObject({ id: set.id, on: true, changedAt: NOW });
    expect(reread.socials.slots).toHaveLength(8);
    // a mangled file starts clean instead of crashing the dashboard
    fs.writeFileSync(path.join(dir, 'logsync.buffblocks.json'), '{not json');
    expect(freshAgent()._bbView('Aldenmar', NOW).sets).toEqual([]);
  });

  it('lists the watched characters with whether each looks logged in, and resolves names for added spells', () => {
    touchLog(30_000);
    const b = freshAgent({ spellNames: { 4242: 'Some Looked-Up Spell' } });
    b._bbSaveSets('Aldenmar', [{ id: 'x', name: 'X', entries: [{ spell: 4242 }, { spell: 3486, if: 3295 }, { spell: 3374 }] }]);
    const v = b._bbView('aldenmar', NOW);
    expect(v.characters).toEqual([{ character: 'Aldenmar', watched: true, loggedIn: true, sets: 1, pending: 0 }]);
    expect(v.names).toEqual({ 4242: 'Some Looked-Up Spell', 3486: 'Maelstrom of Ro', 3295: 'Legacy of Bracken', 3374: 'Warsong of Zek' });
    expect(v.sets[0].lines.block).toEqual(['#blockbuff 4242', '#blockbuffif 3486 3295', '#blockbuff 3374']);
    expect(v.sets[0].lines.allow).toEqual(['#allowbuff 4242', '#allowbuff 3486 3295', '#allowbuff 3374']);
  });
});

describe('the web path still shares the same gate', () => {
  it('reads the gate and the ini lookup from the shared functions', () => {
    const web = stripJs(sliceBlock(src, 'function _maybeApplyWebEdit(row, watched, opts) {', '\n}\n// Apply a ui-pending-edits response'));
    expect(web).toContain('_charLooksLoggedIn(w, now)');
    expect(web).toContain('_charIniPath(w, row.target_file)');
    expect(web).toMatch(/Socials\|HotButtons/);          // the section allowlist stayed with the web path
  });

  it('finds the ini beside the log, one level up from a Logs folder, ignoring case', () => {
    fs.renameSync(iniPath, path.join(dir, 'ALDENMAR_PQ.PROJ.INI'));
    const r = a._charIniPath(watched[0], null);
    expect(path.basename(r.fp)).toBe('ALDENMAR_PQ.PROJ.INI');
    fs.rmSync(path.join(dir, 'ALDENMAR_PQ.PROJ.INI'));
    expect(a._charIniPath(watched[0], null)).toEqual({ fname: 'Aldenmar_pq.proj.ini', fp: null });
    expect(a._charIniPath(watched[0], 'Other_pq.proj.ini').fname).toBe('Other_pq.proj.ini');
    expect(a._charIniPath(watched[0], '../evil').fname).toBe('Aldenmar_pq.proj.ini');
  });
});

// ── the dashboard tab, run for real ─────────────────────────────────────────
// The tab's script is sliced out of dashboard.html and run against a stub DOM,
// with the agent's real view/actions behind the stub fetch. check:dashboard only
// proves the script PARSES; a ReferenceError in a click handler parses fine.
const dashHtml = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const tabScript = sliceBlock(dashHtml, '(function(){\n  var sec = document.getElementById("buffblocks");', 'setInterval(poll, 5000);\n})();');

function makeTab(agent, extra = {}) {
  const listeners = {};
  const registry = new Map();
  const clipboard = [];
  let navClick = null;
  let bodyHtml = '';
  let bodyWrites = 0;
  const mkEl = (id, onSet) => {
    const e = { id, textContent: '', value: '', _html: '' };
    Object.defineProperty(e, 'innerHTML', { get() { return this._html; }, set(v) { this._html = v; if (onSet) onSet(v); } });
    return e;
  };
  // Re-rendering the body replaces its placeholders, so the stubs are dropped with it.
  const body = mkEl('wpBbBody', (v) => { bodyHtml = v; bodyWrites++; registry.clear(); });
  body.contains = () => true;
  const sec = {
    classList: { contains: () => true }, appendChild() {}, contains: () => true, querySelectorAll: () => [],
    addEventListener(t, fn) { listeners[t] = fn; },
  };
  const document = {
    hidden: false, activeElement: null,
    createElement: () => ({ id: '', className: '', innerHTML: '' }),
    querySelector: () => ({ addEventListener(t, fn) { navClick = fn; } }),
    getElementById(id) {
      if (id === 'buffblocks') return sec;
      if (id === 'wpBbBody') return body;
      if (!bodyHtml.includes('id="' + id + '"')) return null;
      if (!registry.has(id)) registry.set(id, mkEl(id));
      return registry.get(id);
    },
  };
  const fetchStub = async (url, opt = {}) => {
    let out;
    if (String(url).startsWith('/api/spell-names.json')) out = { 4242: 'Some Looked-Up Spell' };
    else if ((opt.method || 'GET') === 'GET') out = agent._bbView(new URL(url, 'http://x').searchParams.get('character'), NOW);
    else {
      const b = JSON.parse(opt.body);
      const route = String(url).split('/').pop();
      const r = route === 'sets' ? agent._bbSaveSets(b.character, b.sets)
        : route === 'state' ? agent._bbSetState(b.character, b.setId, !!b.on, NOW)
          : agent._bbMakeSocials(b.character, b.setId, b.kind, NOW);
      out = { ...r, view: agent._bbView(b.character, NOW) };
    }
    return { ok: true, json: async () => JSON.parse(JSON.stringify(out)) };
  };
  const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const morphInto = (el, h) => { if (!el) return false; if (el._wpLastHtml === h) return false; el._wpLastHtml = h; el.innerHTML = h; return true; };
  const wpKeep = (key) => 'data-keep="' + esc(key) + '"';
  const keepStore = {};
  const nav = { clipboard: { writeText: async (t) => { clipboard.push(t); } } };
  new Function('document', 'fetch', 'navigator', 'confirm', 'setInterval', 'setTimeout', 'esc', 'fmtAgo', 'morphInto', 'wpKeep', '_wpOpenDetails', tabScript)(
    document, fetchStub, nav, extra.confirm || (() => true), () => 0, (fn) => fn(), esc, (ms) => Math.round((NOW - ms) / 1000) + 's ago', morphInto, wpKeep, keepStore);
  const node = (attrs, extraProps = {}) => ({ tagName: 'BUTTON', disabled: false, getAttribute: (n) => (n in attrs ? attrs[n] : null), closest() { return this; }, ...extraProps });
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
  return {
    clipboard, keepStore,
    get html() { return bodyHtml; },
    get writes() { return bodyWrites; },
    ph: (id) => (registry.get(id) ? registry.get(id).innerHTML : ''),
    async open() { navClick(); await settle(); },
    async click(attrs) { listeners.click({ target: node(attrs) }); await settle(); },
    async change(attrs, props = {}) { listeners.change({ target: node(attrs, { tagName: 'INPUT', ...props }) }); await settle(); },
    async type(attrs, value) { listeners.input({ target: node(attrs, { tagName: 'INPUT', value }) }); await settle(); },
    focus(el) { document.activeElement = el; },
    async blur() { document.activeElement = null; listeners.focusout({}); await settle(); },
    listeners,
    settle,
    node,
  };
}

describe('the Buff blocks tab, run against the real agent view', () => {
  let tab, setId;
  const sets = () => a._bbView('Aldenmar', NOW).sets;
  async function withTwist() {
    await tab.open();
    await tab.click({ 'data-bb': 'starter', 'data-key': 'pull-twist' });
    setId = sets()[0].id;
  }
  beforeEach(() => { tab = makeTab(a); });

  it('opens on an empty character with the starter sets, the hint and the caveat', async () => {
    await tab.open();
    expect(tab.html).toContain('No sets for Aldenmar yet');
    for (const st of a.BUFFBLOCK_STARTERS) expect(tab.html).toContain('data-key="' + st.key + '"');
    expect(tab.html).toContain('#blockbuff</code> to see what the server has on you');
    expect(tab.html).toMatch(/hate list of that mob before the block applies/);
    expect(tab.html).toContain('Mimic never types into the game');
  });

  // The guild lead, 2026-10-05: a starter set's Name "does not let me edit". Opening "✏ Edit this set"
  // changes the markup (wpKeep writes `open`), so the next poll rewrote the body under the Name field,
  // which has no id to restore: focus and the rest of the typing were lost.
  it('never repaints under the Name field while it is being typed in; repaints once focus leaves', async () => {
    await withTwist();
    const before = tab.writes;
    tab.focus({ id: '', tagName: 'INPUT', type: 'text' });            // the Name input has no id
    await tab.click({ 'data-bb': 'starter', 'data-key': 'druid-ds' }); // a save answers and would repaint
    expect(sets()).toHaveLength(2);                                    // the save itself went through
    expect(tab.writes).toBe(before);                                   // ...but the body was not rewritten
    await tab.blur();
    expect(tab.writes).toBe(before + 1);
    expect(tab.html).toContain('Druid');
  });

  it('a rename followed at once by another set button keeps the new name', async () => {
    await withTwist();
    // no await between them: the click lands before the rename's answer, as a real click after typing does
    tab.listeners.change({ target: tab.node({ 'data-bb': 'rename', 'data-set': setId }, { tagName: 'INPUT', value: 'My pull set' }) });
    tab.listeners.click({ target: tab.node({ 'data-bb': 'newset' }) });
    await tab.settle();
    expect(sets().map(s => s.name)).toEqual(['My pull set', 'New set']);
  });

  it('adds a starter as a COPY and shows its songs as chips, conditional ones with their "only while"', async () => {
    await withTwist();
    expect(sets()).toHaveLength(1);
    expect(tab.html).toContain('Warsong of Zek <span class="dim">#3374</span>');
    await tab.click({ 'data-bb': 'starter', 'data-key': 'druid-ds' });
    expect(tab.html).toContain('only while Legacy of Bracken <span class="dim">#3295</span>');
    expect(sets()).toHaveLength(2);
  });

  it('steps through the lines one paste at a time, and records On/Off only when asked', async () => {
    await withTwist();
    await tab.click({ 'data-bb': 'lines', 'data-kind': 'block', 'data-set': setId });
    const panel = () => tab.ph('wpBbLines_' + setId);
    expect(panel().match(/<code>#blockbuff \d+<\/code>/g)).toHaveLength(20);
    expect(panel()).toContain('Copy next (1/20)');
    await tab.click({ 'data-bb': 'copynext', 'data-set': setId });
    await tab.click({ 'data-bb': 'copynext', 'data-set': setId });
    expect(tab.clipboard).toEqual(['#blockbuff 3374', '#blockbuff 1757']);
    expect(panel()).toContain('Copy next (3/20)');
    await tab.click({ 'data-bb': 'copyrow', 'data-set': setId, 'data-i': '5' });
    expect(tab.clipboard.at(-1)).toBe('#blockbuff 2610');
    expect(sets()[0].on).toBeNull();                       // copying alone proves nothing
    await tab.click({ 'data-bb': 'ran', 'data-kind': 'block', 'data-set': setId });
    expect(sets()[0].on).toBe(true);
    expect(tab.html).toContain('<span class="wp-st on">ON</span>');
    expect(panel()).toBe('');                              // the panel closed
    await tab.click({ 'data-bb': 'lines', 'data-kind': 'allow', 'data-set': setId });
    expect(panel()).toContain('<code>#allowbuff 3374</code>');
    await tab.click({ 'data-bb': 'ran', 'data-kind': 'allow', 'data-set': setId });
    expect(sets()[0].on).toBe(false);
  });

  it('writes socials and says where, or says it is waiting for log-out', async () => {
    await withTwist();
    await tab.click({ 'data-bb': 'socials', 'data-set': setId });
    expect(tab.ph('wpBbSoc_' + setId)).toContain('Written to Page 1 buttons 3–6 (block), 7–10 (allow). Drag them onto a hotbar.');
    expect(readIni()).toContain('Page1Button3Name=Blk Twist 1/4');
    // log in, change the set, ask again: queued, ini untouched, and the pending list says so
    touchLog(30_000);
    const before = readIni();
    await tab.click({ 'data-bb': 'rmchip', 'data-set': setId, 'data-i': '0' });
    await tab.click({ 'data-bb': 'socials', 'data-set': setId });
    expect(tab.ph('wpBbSoc_' + setId)).toContain('Waiting for you to log out; written then.');
    expect(tab.ph('wpBbPending')).toContain('Pulling — bard twist (L47+)');
    expect(readIni()).toBe(before);
  });

  it('ticks a whole bard family on and off without touching "only while" entries', async () => {
    await tab.open();
    await tab.click({ 'data-bb': 'starter', 'data-key': 'druid-ds' });
    setId = sets()[0].id;
    await tab.change({ 'data-bb': 'fam', 'data-set': setId, 'data-fam': 'stats' }, { checked: true });
    expect(sets()[0].entries.map(e => e.spell)).toEqual([3486, 3198, 745, 1765]);
    await tab.change({ 'data-bb': 'fam', 'data-set': setId, 'data-fam': 'stats' }, { checked: false });
    expect(sets()[0].entries).toEqual([{ spell: 3486, if: 3295 }, { spell: 3198, if: 3448 }]);
  });

  it('adds a spell found by name, by id, and with an "only while"', async () => {
    await tab.open();
    await tab.click({ 'data-bb': 'starter', 'data-key': 'druid-ds' });
    setId = sets()[0].id;
    const q = { 'data-bb': 'q', 'data-set': setId }, c = { 'data-bb': 'cond', 'data-set': setId };
    await tab.type(q, 'cassin');
    expect(tab.ph('wpBbRes_' + setId)).toContain("Cassindra's Elegy");
    await tab.click({ 'data-bb': 'addres', 'data-set': setId, 'data-spell': '745', 'data-cond': '' });
    await tab.type(q, '1765');
    await tab.type(c, 'Legacy of Bracken');
    expect(tab.ph('wpBbRes_' + setId)).toContain('only while Legacy of Bracken');
    await tab.click({ 'data-bb': 'addres', 'data-set': setId, 'data-spell': '1765', 'data-cond': '3295' });
    await tab.type(q, '4242');
    await tab.type(c, '');
    expect(tab.ph('wpBbRes_' + setId)).toContain('#4242');
    await tab.type(c, 'no such spell');
    expect(tab.ph('wpBbRes_' + setId)).toContain('No spell found for "only while no such spell"');
    expect(sets()[0].entries.slice(2)).toEqual([{ spell: 745 }, { spell: 1765, if: 3295 }]);
  });

  it('asks before deleting a set', async () => {
    let answer = false;
    tab = makeTab(a, { confirm: () => answer });
    await withTwist();
    await tab.click({ 'data-bb': 'delset', 'data-set': setId });
    expect(sets()).toHaveLength(1);
    answer = true;
    await tab.click({ 'data-bb': 'delset', 'data-set': setId });
    expect(sets()).toHaveLength(0);
  });

  it('repaints the sets only when they change; what moves on its own lives in placeholders', async () => {
    await withTwist();
    const w = tab.writes;
    await tab.open();                                      // a poll with nothing new
    expect(tab.writes).toBe(w);
    touchLog(30_000);                                      // the character logs in, a write is queued
    a._bbMakeSocials('Aldenmar', setId, 'both', NOW);
    await tab.open();
    expect(tab.writes).toBe(w);
    expect(tab.ph('wpBbPending')).toContain('Waiting for you to log out');
    expect(tab.ph('wpBbLive')).toContain('looks logged in');
    touchLog(10 * 60_000);                                 // camped; the tick writes it
    a._bbApplyPending(NOW);
    await tab.open();
    expect(tab.writes).toBe(w);
    expect(tab.ph('wpBbPending')).toBe('');
    expect(tab.ph('wpBbLive')).toContain('looks logged out');
    expect(tab.ph('wpBbSoc_' + setId)).toContain('Written');
    expect(tab.html).not.toMatch(/\d+[smhd] ago/);          // no clock text in the stable markup
  });

  it('follows the dashboard rules: every <details> is kept, no name class on a non-name cell', async () => {
    await withTwist();
    const details = tab.html.match(/<details[^>]*>/g) || [];
    expect(details.length).toBeGreaterThan(1);
    for (const d of details) expect(d).toContain('data-keep="bb|');
    expect(tab.html).toContain('data-keep="bb|edit|aldenmar|' + setId + '"');
    expect(tab.html).not.toMatch(/class="[^"]*\bname\b[^"]*"/);
  });
});

describe('Quarm rule 3: the picker never drives the game client', () => {
  it('has no process spawning, key sending or input injection in the section or its routes', () => {
    const code = stripJs(bbBlock) + stripJs(sliceBlock(src, "if (req.method === 'GET' && req.url && (req.url === '/api/buffblocks'", "return res.end(JSON.stringify({ ...bbOut, view: _bbView(bbChar, bbNow) }));"));
    for (const bad of [/child_process/, /\bspawn\w*\s*\(/, /\bexec\w*\s*\(/, /SendKeys|SendInput|keybd_event|xdotool|robotjs|AutoHotkey/i, /user32/i]) {
      expect(code, String(bad)).not.toMatch(bad);
    }
  });

  it('the tab script only copies to the clipboard and talks to the agent', () => {
    // (document.execCommand("copy") is the clipboard fallback, so exec is not on this list)
    const code = stripJs(tabScript);
    for (const bad of [/child_process/, /\bspawn\w*\s*\(/, /SendKeys|SendInput|keybd_event|xdotool|robotjs|AutoHotkey/i, /window\.mimic/, /dispatchEvent|KeyboardEvent/]) {
      expect(code, String(bad)).not.toMatch(bad);
    }
    const urls = [...code.matchAll(/["'](\/api\/[^"'?]*)/g)].map(m => m[1]);
    expect(new Set(urls)).toEqual(new Set(['/api/buffblocks', '/api/spell-names.json', '/api/buffblocks/state', '/api/buffblocks/socials', '/api/buffblocks/sets']));
  });

  it('is wired into the dashboard as a tab with a section', () => {
    const html = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
    expect(html).toContain('<button data-tab="buffblocks">');
    expect(html).toContain('<div id="buffblocks" class="section"></div>');
  });
});
