// test/pop-flags-live-parity.test.js — Mimic reads `#popflags` from the member's log (the guild lead, 2026-10-26:
// "ideally users are able to have that text come through anytime they do it from mimic").
//
// Two readers of one command's output live in two places that cannot import each other: the website's paste reader
// (web/lib/popFlagsPaste.ts) and the agent's live reader (popFlagsOutputEvents in packages/wolfpack-logsync/index.js).
// This test runs BOTH on the same lines and asserts the same step set, so drift between the copies fails CI:
//   · the shared fixture test/fixtures/popflags-output.txt (built from the format strings of popflags.cpp at
//     EQMacEmu 11024c19, one whole #popflags + tiers 1-5 run, time NOT held);
//   · every stage line of every table (generated from the web reader's own exported tables);
//   · every access / bit / Maelin / Fire / overview line, one at a time.
// Then the agent's own rules: the gate is an exact-line table and lets nothing else through; what is uploaded is step
// keys, never the line; a "Complete" boss line waits for the time answer; the headers reset what they should.
// The agent block is read from the SHIPPED source and run (evalBlock-style), so a rename or a deletion fails loudly.
// Names are invented (Aldenmar, Brackwyn, Zarrin); the lines are the command's own words.
//
// Run: npx vitest run test/pop-flags-live-parity.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AGENT_INDEX, ROOT, readSource, sliceBlock, stripJs } from './_source-slice.js';
import { parsePopFlags, STAGE_TABLES, SECTIONS } from '../web/lib/popFlagsPaste.ts';

const agentSrc = readSource(AGENT_INDEX);
const tsBlock = sliceBlock(agentSrc, 'const TS_RX = ', '  return isNaN(d.getTime()) ? null : d;\n}');
const pfBlock = sliceBlock(agentSrc, 'const _PF_STAGES = [', '  return out;\n}');
// eslint-disable-next-line no-new-func
const A = new Function(tsBlock + '\n' + pfBlock + '\nreturn { popFlagsOutputEvents, _PF_LINES, _pfState, _pfNorm, _PF_MAXLEN };')();

const fixture = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'popflags-output.txt'), 'utf8');
const STAMP = (s = '01') => `[Mon Oct 26 21:10:${s} 2026] `;
let n = 0;
const who = () => `Aldenmar${++n}`;                       // a fresh character each time: the reader keeps state per character
const stagesOf = (events) => [...new Set(events.flatMap(e => e.stages))].sort();
function agentRun(lines, character = who()) {
  const events = [];
  for (const l of lines) events.push(...A.popFlagsOutputEvents(l, character));
  return events;
}
const webFlags = (text) => parsePopFlags(text).flags.slice().sort();

describe('the two readers agree', () => {
  it('on the shared fixture: one whole #popflags run', () => {
    const lines = fixture.split('\n').filter(Boolean);
    const web = webFlags(fixture);
    const agent = stagesOf(agentRun(lines));
    expect(web.length).toBeGreaterThan(20);
    expect(agent).toEqual(web);
  });
  it('on the fixture without timestamps too (the agent stamps a line with no time itself)', () => {
    const bare = fixture.split('\n').filter(Boolean).map(l => l.replace(/^\[[^\]]*\]\s*/, ''));
    expect(stagesOf(agentRun(bare))).toEqual(webFlags(fixture));
  });
  it('on every stage line of every table, one at a time', () => {
    for (const t of STAGE_TABLES) {
      t.texts.forEach((text) => {
        const line = `${t.label}: ${text}`;
        expect(stagesOf(agentRun([STAMP() + line])), line).toEqual(webFlags(line));
        expect(webFlags(line).length, line).toBeGreaterThan(0);
      });
    }
    for (const label of ['Askr and Karana progression', 'Agnarr and Karana progression']) {
      const line = `${label}: Complete; combined into Zebuxoruk lore`;
      expect(stagesOf(agentRun([STAMP() + line])), line).toEqual(webFlags(line));
    }
  });
  it('on every access, bit, Maelin, Fire and time line, one at a time', () => {
    const lines = [
      'Crypt of Decay access: Unlocked', 'Lower Crypt access: Unlocked', 'Factory door access: Unlocked',
      'Air, Earth, and Water access: Unlocked', 'Plane of Fire access: Unlocked', 'Plane of Earth B access: Unlocked',
      'Plane of Time access: Unlocked',
      'Rydda`Dar trial: Complete', 'Village trial: Complete', 'Nomad trial: Complete',
      'Xuzl: Complete', 'Arlyxir: Complete', 'Dresolik: Complete', 'Rizlona: Complete', 'Jiva: Complete',
      'Cipher information: Received', 'Zebuxoruk lore: Received', 'Combined Zek information: Received', 'Final elemental information: Received',
      'Plane of Fire progression: Unlocked',
      'Tier 4: Complete', 'Tier 5 - Plane of Time: Complete',
      'Tier complete: The powers of Air, Earth, Fire, and Water have been joined. The way into the Plane of Time now stands open.',
      'Tier complete: The Plane of Time recognizes your soul. Beyond its shifting portals, the gods await.',
    ];
    for (const line of lines) {
      expect(stagesOf(agentRun([STAMP() + line])), line).toEqual(webFlags(line));
      expect(webFlags(line).length, line).toBeGreaterThan(0);
    }
  });
  it('on lines that prove nothing: both give nothing', () => {
    for (const line of ['Plane of Time access: Locked', 'Crypt of Decay access: Locked', 'Seventh Hammer access: Unlocked', 'Xuzl: Incomplete',
      'Cipher information: Missing', 'Fuirstel progression: Not started', 'Thelin progression: Progress recorded', 'Grummus flag: Missing',
      'Grummus flag: Pending memory', 'Tier 1: Complete', 'Tier 4: Not started', 'Halls of Honor trials: None completed']) {
      expect(stagesOf(agentRun([STAMP() + line])), line).toEqual([]);
      expect(webFlags(line), line).toEqual([]);
    }
  });
  it('on the boss "Complete" lines and the Miak preflag: read only when time is known NOT held (either order of paste)', () => {
    const bosses = ['Grummus flag', 'Terris Thule flag', 'Manaetic Behemoth flag', 'Aerin`Dar flag', 'Bertoxxulous flag', 'Keeper of Sorrows flag',
      'Saryrn cipher half', 'Mithaniel Marr cipher half', 'Mithaniel Marr book', 'Agnarr / Karana flag', 'Vallon Zek flag', 'Tallon Zek flag',
      'Rallos Zek flag', 'Solusek Ro flag', 'Miak the Searedsoul preflag'];
    for (const b of bosses) {
      const line = `${b}: Complete`;
      const locked = 'Plane of Time access: Locked';
      const web = webFlags(`${locked}\n${line}`);
      expect(web.length, b).toBe(1);
      expect(stagesOf(agentRun([STAMP() + locked, STAMP() + line])), b).toEqual(web);       // time first
      expect(stagesOf(agentRun([STAMP() + line, STAMP() + locked])), b).toEqual(web);       // time after
      // no word on time: neither reader writes it
      expect(webFlags(line), b).toEqual([]);
      expect(stagesOf(agentRun([STAMP() + line])), b).toEqual([]);
      // time held: only time_1
      expect(stagesOf(agentRun([STAMP() + line, STAMP() + 'Plane of Time access: Unlocked'])), b).toEqual(['time_1']);
      expect(webFlags(`${line}\nPlane of Time access: Unlocked`), b).toEqual(['time_1']);
    }
  });
  it('the parity lines are not vacuous: the fixture really exercises every section the command has', () => {
    expect(parsePopFlags(fixture).sections).toEqual(SECTIONS.map(s => s.title));
  });
});

describe('the gate is an exact-line table', () => {
  const ok = (line) => A.popFlagsOutputEvents(STAMP() + line, who()).length;
  it('lets a real command line through', () => {
    expect(ok("Mavuin's case: Mavuin's case is complete")).toBe(1);
    expect(ok('Crypt of Decay access: Unlocked')).toBe(1);
  });
  it('lets nothing else through: not a prefix, not a keyword, not a quoted copy, not another channel', () => {
    const no = [
      "Mavuin's case: Mavuin's case is complete!", "Mavuin's case: Mavuin's case is complete, friend", "Mavuin's case:  Mavuin's case is complete extra",
      "Aldenmar says, 'Mavuin's case: Mavuin's case is complete'", "Brackwyn tells you, 'Mavuin's case: Mavuin's case is complete'",
      "You tell your guild, 'Mavuin's case: Mavuin's case is complete'", "Zarrin tells the guild, 'Crypt of Decay access: Unlocked'",
      "Brackwyn tells the raid, 'Tier 4: Complete'", "You say to your group, 'Crypt of Decay access: Unlocked'",
      'Brackwyn auctions, \'Xuzl: Complete\'', "mavuin's case: mavuin's case is complete tonight", 'Crypt of Decay access: Unlocked (maybe)',
      'Corvale access: Unlocked', 'Tier 4: Done', 'Pending memory: Thelin\'s hedge maze', '--- Plane of Justice ---', '=== Tier 4 Progression ===',
      'Details: #popflags 1, 2, 3, 4, or 5 (tier1-tier5 also work).', 'You have gained experience!', 'Your faction standing with X got better: lots',
      '', '   ', ': ', '=== ===',
    ];
    for (const l of no) expect(ok(l), l).toBe(0);
    for (const l of no) expect(A.popFlagsOutputEvents(l, who()).length, l).toBe(0);
  });
  it('the table is the command\'s finite set of lines, with no catch-all', () => {
    expect(A._PF_LINES.size).toBeGreaterThan(70);
    expect(A._PF_LINES.size).toBeLessThan(200);
    for (const key of A._PF_LINES.keys()) {
      expect(key.length, key).toBeLessThanOrEqual(A._PF_MAXLEN);
      expect(key, key).not.toMatch(/\bsays?,|\btells?\b|\byou (?:say|tell)\b|\bauctions?\b|\bshouts?\b/);
    }
  });
  it('punctuation the log keeps differently still matches: a curly quote, a backtick, case and spacing', () => {
    expect(ok('MAVUIN’S CASE:   Mavuin’s case is complete')).toBe(1);
    expect(ok("AERIN'DAR PROGRESSION: Halls of Honor access unlocked")).toBe(1);
  });
  it('a line with no timestamp, and a long garbage line, cost nothing and give nothing', () => {
    expect(A.popFlagsOutputEvents("Mavuin's case: Mavuin's case is complete", who()).length).toBe(1);
    expect(A.popFlagsOutputEvents(STAMP() + 'x'.repeat(5000) + ': y', who()).length).toBe(0);
    expect(A.popFlagsOutputEvents(STAMP() + 'Crypt of Decay access: Unlocked', '').length).toBe(0);
    expect(A.popFlagsOutputEvents(null, 'Aldenmar').length).toBe(0);
  });
});

describe('what leaves the machine: step keys, never the line', () => {
  it('an event is an empty-text recital tagged popflags, with the keys, the line\'s own time and the character', () => {
    const c = who();
    const [ev] = A.popFlagsOutputEvents(STAMP('07') + 'Fuirstel progression: Elder Fuirstel aided; defeat Bertoxxulous', c);
    expect(ev).toEqual({ character: c, zone: null, boss: null, ts: new Date('Mon Oct 26 21:10:07 2026').toISOString(),
      kind: 'recital', source: 'popflags', text: null, stages: ['fuirstel_3'] });
    expect(JSON.stringify(ev)).not.toMatch(/Fuirstel progression|Bertoxxulous|aided/);
  });
  it('the whole fixture uploads only keys from a closed list, and none of its words', () => {
    const events = agentRun(fixture.split('\n').filter(Boolean));
    const json = JSON.stringify(events);
    for (const k of stagesOf(events)) expect(k).toMatch(/^[a-z]+(?:_[a-z]+)*_\d+$|^hohtrials_111$/);
    for (const w of ['Brackwyn', 'ring', 'progression', 'Unlocked', 'Complete', 'tells']) expect(json, w).not.toContain(w);
  });
  it('an older bot skips it: it resolves to nothing as a recital (the bot\'s own resolver)', async () => {
    const { createRequire } = await import('node:module');
    const S = createRequire(import.meta.url)(path.join(ROOT, 'utils', 'popFlagStages.js'));
    const [ev] = A.popFlagsOutputEvents(STAMP() + "Mavuin's case: Mavuin's case is complete", who());
    expect(S.resolveStage(ev, '')).toBeNull();
  });
});

describe('the small state, and what resets it', () => {
  it('a Complete line waits for the time answer and goes out with ITS OWN time when "not held" arrives', () => {
    const events = agentRun([STAMP('01') + 'Grummus flag: Complete', STAMP('05') + 'Plane of Time access: Locked']);
    expect(events).toHaveLength(1);
    expect(events[0].stages).toEqual(['fuirstel_2']);
    expect(events[0].ts).toBe(new Date('Mon Oct 26 21:10:01 2026').toISOString());
  });
  it('time held drops the waiting lines: they are explained by time_1', () => {
    expect(stagesOf(agentRun([STAMP('01') + 'Grummus flag: Complete', STAMP('02') + 'Tier 4: Complete']))).toEqual(['time_1']);
  });
  it('the overview header starts a new run: an old "not held" does not carry into it', () => {
    const c = who();
    const first = agentRun([STAMP('01') + 'Plane of Time access: Locked', STAMP('02') + 'Grummus flag: Complete'], c);
    expect(stagesOf(first)).toEqual(['fuirstel_2']);
    const second = agentRun([STAMP('10') + '=== Planes of Power Progression ===', STAMP('11') + 'Terris Thule flag: Complete'], c);
    expect(second).toEqual([]);   // time unknown again, so it waits
    const third = agentRun([STAMP('12') + 'Tier 5 - Plane of Time: Not started'], c);
    expect(stagesOf(third)).toEqual(['thelin_3']);
  });
  it('a tier command does NOT reset it: Tier 2 after the overview still knows time is not held', () => {
    const c = who();
    const out = agentRun([STAMP('01') + '=== Planes of Power Progression ===', STAMP('02') + 'Tier 4: In progress',
      STAMP('10') + '=== Tier 2 Progression ===', STAMP('11') + 'Keeper of Sorrows flag: Complete'], c);
    expect(stagesOf(out)).toEqual(['tylis_2']);
  });
  it('a time answer older than six hours is no answer', () => {
    const c = who();
    const old = '[Mon Oct 26 10:00:00 2026] ';
    const late = '[Mon Oct 26 17:00:01 2026] ';
    const out = agentRun([old + 'Plane of Time access: Locked', late + 'Grummus flag: Complete'], c);
    expect(out).toEqual([]);
  });
  it('all three trial lines also prove hohtrials_111, once; the Tier 3 header clears the count', () => {
    const c = who();
    const three = agentRun([STAMP() + '=== Tier 3 Progression ===', STAMP() + 'Rydda`Dar trial: Complete', STAMP() + 'Village trial: Complete', STAMP() + 'Nomad trial: Complete'], c);
    expect(stagesOf(three)).toEqual(['hoh_trial_1', 'hoh_trial_2', 'hoh_trial_3', 'hohtrials_111']);
    const d = who();
    const two = agentRun([STAMP() + 'Rydda`Dar trial: Complete', STAMP() + 'Village trial: Complete', STAMP() + '=== Tier 3 Progression ===', STAMP() + 'Nomad trial: Complete'], d);
    expect(stagesOf(two)).not.toContain('hohtrials_111');
  });
  it('running the command twice in a night is one set of rows, a day later is another', () => {
    const c = who();
    const line = "Mavuin's case: Mavuin's case is complete";
    expect(agentRun([STAMP('01') + line, STAMP('59') + line], c)).toHaveLength(1);
    expect(agentRun(['[Mon Oct 26 21:30:00 2026] ' + line], c)).toHaveLength(0);       // still within six hours of the last send
    expect(agentRun(['[Tue Oct 27 21:30:00 2026] ' + line], c)).toHaveLength(1);       // a day later
  });
  it('one character\'s state is not another\'s', () => {
    const a = who(); const b = who();
    agentRun([STAMP() + 'Plane of Time access: Locked'], a);
    expect(agentRun([STAMP() + 'Grummus flag: Complete'], b)).toEqual([]);
    expect(agentRun([STAMP() + 'Grummus flag: Complete'], a)).toHaveLength(1);
  });
  it('the state map is bounded', () => {
    for (let i = 0; i < 80; i++) A.popFlagsOutputEvents(STAMP() + 'Crypt of Decay access: Unlocked', `Brackwyn${i}x${n}`);
    expect(A._pfState.size).toBeLessThanOrEqual(40);
  });
});

describe('the wiring (stripped source): every path that reads a log runs it', () => {
  const src = stripJs(agentSrc);
  it('the live tail, the --since backfill and the opt-in backfill call it after parsePopFlagLine', () => {
    const calls = src.match(/popFlagsOutputEvents\(line, [a-z]\.character\)/g) || [];
    expect(calls.length).toBe(3);
    expect(src).toMatch(/if \(!_sourceExcluded\) \{ for \(const pfOut of popFlagsOutputEvents\(line, b\.character\)\) popFlagBuffer\.push\(pfOut\); \}/);
  });
  it('PRIVACY.md lists it as a thing that leaves the machine, with its exact-line gate', () => {
    const doc = fs.readFileSync(path.join(ROOT, 'docs', 'PRIVACY.md'), 'utf8');
    expect(doc).toMatch(/#popflags/);
    expect(doc).toMatch(/\*\*exactly\*\* one of those lines/);
    expect(doc).toMatch(/not the line: it is the flag step/);
  });
});
