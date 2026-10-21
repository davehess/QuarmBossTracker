// test/pqc-import.test.js — importing a PQ Companion trigger pack into the agent's personal triggers.
//
// A raider switching from (or running beside) PQ Companion keeps their triggers: its Export writes plain
// JSON { pack_name, description, triggers:[…] }. The shipped parser maps each trigger onto the personal
// shape the GINA / EQLogParser imports already produce — pattern, spoken + shown text, countdown, warnings
// before it ends, end-early text — and lists what a personal trigger has no place for, so the import
// result can say so instead of dropping it in silence.
//
// The fixture is invented (test/fixtures/pqc-pack.json); only the SHAPE comes from PQ Companion.
//
//   · detection: by what the text is, not the file name — a PQ pack, a GINA XML and an EQLogParser .tgf
//     tree each reach their own parser through the one entry point the endpoint uses
//   · patterns are kept raw and compile through the shared compiler: the ^ anchor, (?P<name>) groups and
//     {C} all work against a real timestamped log line
//   · timers: length, end-early line, warnings (spoken or shown), key capture, capture-timed, loop
//   · everything with no home is reported per trigger; another player's character list is never carried
//   · a malformed or foreign file is refused without throwing
//
// The shipped agent runs for real (require); the endpoint wiring is checked against its source.
//
// Run: npx vitest run test/pqc-import.test.js

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const FIXTURE = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'pqc-pack.json'), 'utf8');
const TS = '[Tue Aug 04 21:14:33 2026] ';

let agent, tmp, parsed;
const byName = (n) => parsed.find(t => t.name === n);

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-pqc-'));
  process.env.WOLFPACK_SOUNDS_USER_DIR = path.join(tmp, 'sounds');
  agent = require_('../packages/wolfpack-logsync/index.js');
  parsed = agent._parsePqCompanionPack(FIXTURE);
});
afterAll(() => {
  delete process.env.WOLFPACK_SOUNDS_USER_DIR;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
});

describe('_parsePqCompanionPack — a plain alert', () => {
  it('carries the pattern raw, the shown text and the spoken text', () => {
    const t = byName('Brackwyn Falls');
    expect(t.pattern).toBe('^{C} has fallen to the ground\\.$');
    expect(t).toMatchObject({ display_text: 'FALLEN', tts_text: 'You fell', use_regex: true, timer_duration_sec: 0, cooldown_seconds: 0 });
    expect(t.not_carried).toBeUndefined();
  });

  it('the stored pattern fires on a real timestamped line (anchor, {C})', () => {
    const t = byName('Brackwyn Falls');
    const c = agent.compileTriggerPattern(t.pattern, { characters: ['Brackwyn'] });
    expect(c.regex.test(TS + 'Brackwyn has fallen to the ground.')).toBe(true);
    expect(c.regex.test(TS + 'Someone else has fallen to the ground.')).toBe(false);
  });

  it('never carries the exporter\'s character list', () => {
    for (const t of parsed) expect(t).not.toHaveProperty('characters');
  });
});

describe('_parsePqCompanionPack — timers', () => {
  it('maps length, end-early line, key capture, bar and pinning', () => {
    const t = byName('Rethlan Slowed');
    expect(t).toMatchObject({
      timer_duration_sec: 90,
      end_early_pattern: '^Your slow spell has worn off of (?P<target>.+)\\.$',
      end_use_regex: true,
      timer_key_capture: 'target',
      display_threshold_sec: 30,
      bar_color: '#22c55e',
      pinned: true,
    });
  });

  it('keeps (?P<name>) groups working and {target} when the pattern defines one', () => {
    const t = byName('Rethlan Slowed');
    expect(t.display_text).toBe('{target} is slowed');
    const m = agent.compileTriggerPattern(t.pattern).regex.exec(TS + 'A moss snake slows down.');
    expect(m.groups.target).toBe('A moss snake');
  });

  it('turns "fading soon" alerts into warnings — spoken or only shown — naming the trigger for {spell}', () => {
    const t = byName('Rethlan Slowed');
    expect(t.timer_warnings).toEqual([
      { seconds: 60, text: 'Rethlan Slowed fading soon', tts: true },
      { seconds: 10, text: 'Slow is nearly up', tts: false },
    ]);
  });

  it('says a sound-only warning was left behind', () => {
    expect(byName('Rethlan Slowed').not_carried).toEqual(['1 sound-only warning before the timer ends']);
  });

  it('a timer whose length is read from the log line, repeating, disabled', () => {
    const t = byName('Nyssara Wave Spawn');
    expect(t).toMatchObject({
      enabled: false, timer_duration_sec: 49, timer_duration_capture: 'mins',
      timer_loop: true, timer_loop_max: 6,
      timer_warnings: [{ seconds: 5, text: 'Wave in five', tts: true }],
    });
    expect(t.not_carried).toEqual(['the reuse-cooldown timer']);
  });

  it('reports stacked timers and a target label that cannot come along; no loop', () => {
    const t = byName('Rethlan Stacked Respawn');
    expect(t.timer_duration_sec).toBe(600);
    expect(t.timer_loop).toBeUndefined();
    expect(t.not_carried).toEqual(['a separate timer row for every match', 'the timer\'s target label (name the capture "target" to get one)']);
  });
});

describe('_parsePqCompanionPack — actions, extra patterns, excludes', () => {
  const t = () => byName('Zarrin Tells');

  it('joins the enabled extra patterns into one alternation and drops the disabled one', () => {
    expect(t().pattern).toBe("^\\w+ tells you, '(?P<msg>.+)'$|^\\w+ says out of character, '(?P<msg>.+)'$");
    const c = agent.compileTriggerPattern(t().pattern);
    expect(c.regex.test(TS + "Aldenmar tells you, 'hello there'")).toBe(true);
    expect(c.regex.test(TS + "Aldenmar says out of character, 'hello there'")).toBe(true);
    expect(c.regex.test(TS + 'never used')).toBe(false);
  });

  it('the current-target token becomes ours when the pattern has no target group', () => {
    expect(t().display_text).toBe('Tell: {msg} about {mytarget}');
  });

  it('keeps one shown and one spoken line, a sound, the lockout and the excludes', () => {
    expect(t()).toMatchObject({
      tts_text: 'Incoming tell',
      sound_file: 'C:\\Sounds\\ding.wav', plays_sound: true,
      cooldown_seconds: 2,
      exclude_patterns: ["tells you, 'That'll be", "Master\\.'$"],
    });
  });

  it('lists everything it could not carry', () => {
    expect(t().not_carried).toEqual([
      'a different timer length on an extra pattern',
      '1 more on-screen or spoken line (one of each is kept)',
      'the copy-to-clipboard action',
      'the Discord post action',
      'repeat counting',
    ]);
  });
});

describe('_parsePqCompanionPack — triggers with nothing to match on', () => {
  it('a Zeal pipe trigger and a pattern-less trigger come back with no pattern and a reason', () => {
    expect(byName('Corvale Low Health')).toMatchObject({ pattern: '' });
    expect(byName('Corvale Low Health').not_carried[0]).toMatch(/Zeal/);
    expect(byName('Zarrin Empty')).toMatchObject({ pattern: '' });
    expect(byName('Zarrin Empty').not_carried[0]).toMatch(/no log pattern/);
  });
});

describe('_parsePqCompanionPack — refuses what is not a pack, without throwing', () => {
  it('returns null for text that is not a PQ Companion pack', () => {
    const P = agent._parsePqCompanionPack;
    expect(P('')).toBeNull();
    expect(P('not json at all')).toBeNull();
    expect(P('{"pack_name": "half a file", "triggers": [')).toBeNull();
    expect(P('{"pack_name": "no list"}')).toBeNull();
    expect(P('{"triggers": [], "other": 1}')).toBeNull();
    expect(P('[{"Name":"tgf","pack_name":"x"}]')).toBeNull();
  });

  it('skips junk entries inside a real pack', () => {
    expect(agent._parsePqCompanionPack('{"pack_name":"x","triggers":[null,5,"s",{},{"name":"   "}]}')).toEqual([]);
  });

  it('reads a pack with a byte-order mark', () => {
    expect(agent._parsePqCompanionPack('\uFEFF' + FIXTURE)).toHaveLength(parsed.length);
  });
});

describe('_parseTriggerImport — the one entry point finds the format', () => {
  it('a PQ Companion pack', () => {
    expect(agent._parseTriggerImport(FIXTURE)).toEqual(parsed);
  });

  it('GINA XML still goes to the GINA reader', () => {
    const xml = '<SharedTriggers><Triggers><Trigger><Name>Tash</Name><TriggerText>^You tash</TriggerText>' +
      '<EnableRegex>True</EnableRegex><TimerType>Timer</TimerType><TimerDuration>450</TimerDuration></Trigger></Triggers></SharedTriggers>';
    const [t] = agent._parseTriggerImport(xml);
    expect(t).toMatchObject({ name: 'Tash', timer_duration_sec: 450 });
  });

  it('an EQLogParser .tgf tree still goes to the .tgf reader', () => {
    const tgf = JSON.stringify([{ Name: 'folder', Nodes: [{ Name: 'Mez', TriggerData: { Pattern: 'x mesmerized', TextToSpeak: 'mez' } }] }]);
    expect(agent._parseTriggerImport(tgf)).toMatchObject([{ name: 'Mez', pattern: 'x mesmerized', tts_text: 'mez' }]);
  });

  it('a malformed or foreign file gives an empty list, not an exception', () => {
    expect(agent._parseTriggerImport('{"pack_name": "half a file", "triggers": [')).toEqual([]);
    expect(agent._parseTriggerImport('{"something": "else"}')).toEqual([]);
    expect(agent._parseTriggerImport('just some words')).toEqual([]);
  });
});

describe('the import endpoint', () => {
  const src = readSource(AGENT_INDEX);
  const endpoint = stripJs(sliceBlock(src, "if (req.url === '/api/personal-triggers/import'", '// Live regex tester'));

  it('every field the parser sets beyond the shared shape is one the endpoint copies onto the row', () => {
    const shared = new Set(['name', 'pattern', 'use_regex', 'display_text', 'tts_text', 'cooldown_seconds', 'timer_duration_sec',
      'end_early_pattern', 'end_use_regex', 'sound_file', 'plays_sound', 'enabled', 'not_carried']);
    const copied = new Set(agent._PQC_ROW_FIELDS);
    const seen = new Set();
    for (const t of parsed) for (const k of Object.keys(t)) seen.add(k);
    for (const k of seen) expect(shared.has(k) || copied.has(k), k).toBe(true);
    for (const k of copied) expect(seen.has(k), k + ' is exercised by the fixture').toBe(true);
  });

  it('uses the one entry point, copies those fields, and reports what was not carried', () => {
    expect(endpoint).toMatch(/_parseTriggerImport\(raw\)/);
    expect(endpoint).toMatch(/for \(const k of _PQC_ROW_FIELDS\) if \(t\[k\] !== undefined\) row\[k\] = t\[k\]/);
    expect(endpoint).toMatch(/if \(t\.enabled === false\) row\.enabled = false/);
    expect(endpoint).toMatch(/not_carried: notCarried/);
  });

  it('refuses a file with no triggers in it', () => {
    expect(endpoint).toMatch(/if \(!parsed\.length\) \{\s*res\.writeHead\(400\)/);
  });

  it('a timer read from the log line is not thrown away as "nothing to do"', () => {
    expect(endpoint).toMatch(/!row\.timer_duration_capture\) \{ noteNotCarried\(t\); skipped\+\+; continue; \}/);
  });
});
