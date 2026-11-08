// test/enrage-fast-line.test.js — "has become ENRAGED" straight off the Zeal pipe.
//
// The guild lead, 2026-11-07: "enrage calls have all been late lately". The line reached the trigger only when the log
// FILE caught up with it. Zeal prints it (colour 306, USERCOLOR_NPC_ENRAGE) the instant the client does, so Mimic forwards
// the server's two enrage lines to POST /api/zeal-fast-line and the agent runs them through the same trigger evaluation
// the log tail uses. The log tail's later copy of the same line is skipped for trigger evaluation (not for any other parser).
//
// The REAL agent is driven (require): zealFastLineTake for the pipe copy, _tailTriggerEval (what the tail calls per
// line) for the log copy. Mimic's real chatLineOf/enrageLineOf are run on pipe objects, and main.js's real
// _zealFastLineNote is sliced out and run with the network stubbed.
//
// Run: npx vitest run test/enrage-fast-line.test.js

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
let agent;
beforeAll(() => { agent = require('../packages/wolfpack-logsync/index.js'); });

const ME = 'Fenrisk';
const MOB = 'a gnoll warlord';
const START = `${MOB} has become ENRAGED.`;
const END = `${MOB} is no longer enraged.`;
// The log copy: the same sentence with the log's own timestamp.
const logLine = (text, t = Date.now()) => '[' + agent._eqStampForTest(new Date(t)) + '] ' + text;

// The guild's real "Enrage (Begin)" shape: broadcast scope, {s} capture.
const ENRAGE_BEGIN = {
  id: 'g-enrage', name: 'Enrage (Begin)', category: 'mechanic', default_scope: 'broadcast', tags: ['Raid'],
  pattern: '^(?:{s} has become) ENRAGED\\.$', use_regex: true, cooldown_seconds: 0,
  actions: [{ type: 'text_overlay', text: 'ENRAGED', tts: 'enraged', color: 'red', duration_ms: 3000 }],
};
const begins = () => agent._activeOverlays.filter(o => o.trigger === 'Enrage (Begin)');

let allowlistWas;
beforeEach(() => {
  vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
  vi.spyOn(fs, 'renameSync').mockImplementation(() => {});
  allowlistWas = agent._optinState.calloutAllowlist;
  agent._optinState.calloutAllowlist = false;
  agent._setWatchedLogsForTest([{ character: ME, logPath: 'eqlog_Fenrisk_pq.proj.txt' }]);
  agent._setPersonalTriggersForTest([]);
  agent._applyGuildTriggersResponse({ version: 'v' + Math.random(), triggers: [ENRAGE_BEGIN] });
  agent._activeOverlays.length = 0;
  agent._triggerLastFire.clear();
  agent._fastLines.clear();
  agent._enrageObserved.clear();
  agent._setZealStateForTest(ME, null);
});
afterEach(() => {
  agent._optinState.calloutAllowlist = allowlistWas;
  agent._setGuildTriggersForTest([]);
  agent._setZealStateForTest(ME, null);
  agent._fastLines.clear();
  agent._enrageObserved.clear();
  vi.restoreAllMocks();
});

describe('the agent: pipe copy first, log copy later', () => {
  it('the pipe copy fires Enrage (Begin) at once', () => {
    const r = agent.zealFastLineTake({ character: ME, text: START, at: Date.now() });
    expect(r).toEqual({ ok: true, fired: true });
    expect(begins()).toHaveLength(1);
  });
  it('the log copy within 6 s does not fire it again', () => {
    agent.zealFastLineTake({ character: ME, text: START });
    agent._tailTriggerEval(logLine(START), Date.now(), ME);
    expect(begins()).toHaveLength(1);
  });
  it('...but a log copy after the 6 s window is a new line and fires', () => {
    const t0 = Date.now();
    agent.zealFastLineTake({ character: ME, text: START }, t0 - 7000);
    agent._tailTriggerEval(logLine(START), Date.now(), ME);
    expect(begins()).toHaveLength(2);   // the pipe copy's own fire, then the log line's: the window had closed
  });
  it('a different mob\'s line fires', () => {
    agent.zealFastLineTake({ character: ME, text: START });
    agent._tailTriggerEval(logLine('a goblin shaman has become ENRAGED.'), Date.now(), ME);
    expect(begins()).toHaveLength(2);
  });
  it('the same text on another character\'s log is that character\'s own line and fires', () => {
    agent.zealFastLineTake({ character: ME, text: START });
    agent._tailTriggerEval(logLine(START), Date.now(), 'Brackwyn');
    expect(begins()).toHaveLength(2);
  });
  it('one pipe copy cancels one log copy: two same-name mobs enraging are two lines of each', () => {
    agent.zealFastLineTake({ character: ME, text: START });
    agent.zealFastLineTake({ character: ME, text: START });
    agent._tailTriggerEval(logLine(START), Date.now(), ME);
    agent._tailTriggerEval(logLine(START), Date.now(), ME);
    expect(begins()).toHaveLength(2);   // two pipe fires (no cooldown set), both log copies skipped
    agent._tailTriggerEval(logLine(START), Date.now(), ME);
    expect(begins()).toHaveLength(3);   // a third log line has no pipe copy left to match
  });
  it('a log line with no pipe copy still fires (no Mimic, or the pipe is off)', () => {
    agent._tailTriggerEval(logLine(START), Date.now(), ME);
    expect(begins()).toHaveLength(1);
  });
  it('the pipe copy sets the enrage state the HUD reads, and the end line clears it', () => {
    agent._mobInfoByNameForTest().set(agent._mobInfoCacheKey(MOB, 12), { at: Date.now(), mob: { name: MOB, specials: ['Enrage'] } });
    const st = { target_name: MOB, target_hp_pct: 40, zone: 12, updatedAt: Date.now() };
    agent.zealFastLineTake({ character: ME, text: START });
    const t = agent._meTargetExtras(st, ME, Date.now());
    expect(t.enraged).toBe(true);
    agent.zealFastLineTake({ character: ME, text: END });
    const e = agent._meTargetExtras(st, ME, Date.now());
    expect(e.enraged).toBe(false);
    expect(e.enrage_ended).toBe(true);
  });
});

describe('only the two server lines go through', () => {
  it.each([
    'Bob tells the guild, \'a gnoll warlord has become ENRAGED.\'',
    'a gnoll warlord goes on a RAMPAGE!',
    'You have become ENRAGED.x',
    'has become ENRAGED.',
    '',
  ])('rejects %j', (text) => {
    expect(agent.zealFastLineTake({ character: ME, text })).toEqual({ ok: false, fired: false });
    expect(begins()).toHaveLength(0);
    expect(agent._fastLines.size).toBe(0);
  });
  it('rejects a missing or oversized character', () => {
    expect(agent.zealFastLineTake({ text: START }).ok).toBe(false);
    expect(agent.zealFastLineTake({ character: 'x'.repeat(41), text: START }).ok).toBe(false);
  });
});

describe('learning the real enrage % from the start line', () => {
  const target = (hp) => agent._setZealStateForTest(ME, { target_name: MOB, target_hp_pct: hp, zone: 12, updatedAt: Date.now() });
  it('the pipe copy records the HP at that moment and says so in the journal', () => {
    target(9);
    const before = agent._triggerJournal.length;
    agent.zealFastLineTake({ character: ME, text: START });
    expect(agent._enrageObserved.get(MOB)).toEqual([9]);
    const j = agent._triggerJournal.slice(before).find(e => e.trigger === 'Enrage (observed)');
    expect(j.reason).toBe('a gnoll warlord enraged at 9% (seen 1)');
  });
  it('the log copy of a line the pipe already sent does not record a second observation', () => {
    target(9);
    agent.zealFastLineTake({ character: ME, text: START });
    agent._tailTriggerEval(logLine(START), Date.now(), ME);
    expect(agent._enrageObserved.get(MOB)).toEqual([9]);
  });
  it('a log line with no pipe copy records it when it is fresh, not when it is an old line', () => {
    target(10);
    agent._tailTriggerEval(logLine(START, Date.now() - 60_000), Date.now() - 60_000, ME);
    expect(agent._enrageObserved.size).toBe(0);
    agent._tailTriggerEval(logLine(START), Date.now(), ME);
    expect(agent._enrageObserved.get(MOB)).toEqual([10]);
  });
  it('an end line records nothing', () => {
    target(9);
    agent.zealFastLineTake({ character: ME, text: END });
    expect(agent._enrageObserved.size).toBe(0);
  });
});

describe('Mimic forwards only the two enrage lines', () => {
  const zealPipe = require('../apps/mimic/zealPipe.js');
  const mainSrc = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
  const pipeMsg = (text, k = 306, character = ME) => ({ type: 0, character, data: JSON.stringify({ type: k, text }) });

  function mimicMain({ agentPort = 7777 } = {}) {
    const posts = [];
    const http = { request(opts, cb) { const rec = { opts, body: '' }; posts.push(rec); return { on() {}, write(b) { rec.body += b; }, end() {}, destroy() {} }; } };
    const fn = sliceBlock(mainSrc, 'function _zealFastLineNote(obj) {', '\n}');
    // eslint-disable-next-line no-new-func
    const note = new Function('http', 'agentPort', 'enrageLineOf', fn + '\nreturn _zealFastLineNote;')(http, agentPort, zealPipe.enrageLineOf);
    return { note, posts };
  }

  it('both enrage lines are posted to /api/zeal-fast-line with the character', () => {
    const { note, posts } = mimicMain();
    note(pipeMsg(START)); note(pipeMsg(END));
    expect(posts).toHaveLength(2);
    expect(posts[0].opts).toMatchObject({ host: '127.0.0.1', port: 7777, path: '/api/zeal-fast-line', method: 'POST' });
    expect(JSON.parse(posts[0].body)).toMatchObject({ character: ME, text: START });
    expect(JSON.parse(posts[1].body).text).toBe(END);
  });
  it('matches on the text whatever the colour', () => {
    const { note, posts } = mimicMain();
    note(pipeMsg(START, 273));
    expect(posts).toHaveLength(1);
  });
  it.each([
    ['chat quoting the words', 'Bob tells the guild, \'a gnoll warlord has become ENRAGED.\''],
    ['a rampage', 'a gnoll warlord goes on a RAMPAGE!'],
    ['a flurry', 'a gnoll warlord executes a FLURRY of attacks on Bob!'],
    ['a hit', 'a gnoll warlord hits Bob for 120 points of damage.'],
    ['a tell', 'Bob tells you, \'hello\''],
  ])('does not post %s', (_n, text) => {
    const { note, posts } = mimicMain();
    note(pipeMsg(text));
    expect(posts).toHaveLength(0);
  });
  it('does not post a non-chat pipe object, or anything before the agent is up', () => {
    const { note, posts } = mimicMain();
    note({ type: 2, character: ME, data: '{}' });
    note({ type: 0, data: JSON.stringify({ type: 306, text: START }) });   // no character
    expect(posts).toHaveLength(0);
    const down = mimicMain({ agentPort: 0 });
    down.note(pipeMsg(START));
    expect(down.posts).toHaveLength(0);
  });
  it('is not behind the Chat overlay gate, and is wired into the pipe handler', () => {
    const fn = stripJs(sliceBlock(mainSrc, 'function _zealFastLineNote(obj) {', '\n}'));
    expect(fn).not.toMatch(/chatWindow/);
    expect(stripJs(mainSrc)).toMatch(/_zealFastLineNote\(obj\)/);
  });
});
