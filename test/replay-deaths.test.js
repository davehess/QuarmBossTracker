// test/replay-deaths.test.js — an agent ⏪ Replay drives the death timeline strip as a rehearsal.
//
// The guild lead, 2026-10-21: "i need a way to test these things before our raid nights". The strip's live ring drops
// lines older than 60 s and the page runs on Date.now(), so a replay of an old log showed nothing. Now the replay
// walk feeds a SEPARATE ring (replayDeaths), ships its own clock (replayClock), and triggers.html runs the strip on
// that clock while one is present.
//
// What runs here is the SHIPPED code, sliced out of the two files:
//   1  the agent: the death matcher + both rings + the replay worker, with only the log reader, the trigger gate and
//      the catalog lookups stubbed
//   2  the page: tlReplayNow / tlPickFeed (pure) and the wiring, comments stripped
// Names in the fixtures are invented; the pair mobs are the guild's own catalog names.
//
// Run: npx vitest run test/replay-deaths.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT, AGENT_INDEX } from './_source-slice.js';

const AGENT = readSource(AGENT_INDEX);
const TRIGGERS = readSource(path.join(ROOT, 'apps', 'mimic', 'triggers.html'));

// ── 1  the agent ─────────────────────────────────────────────────────────────────────────────────────────────
const deathBlock = sliceBlock(AGENT, 'const _DEATH_SLAIN_BY_RX', '\nfunction _cancelTimersOnMobDeath').replace(/\nfunction _cancelTimersOnMobDeath$/, '');
const replayBlock = sliceBlock(AGENT, 'const REPLAY_LINE_CAP', '// Transition a single backfill request');
const GAP_CAP_MS = 150;   // the real cap is 6000; shrunk so a "compressed lull" can be watched in a test
const shrunk = replayBlock.replace('const REPLAY_MAX_GAP_MS  = 6000;', 'const REPLAY_MAX_GAP_MS  = ' + GAP_CAP_MS + ';');
if (shrunk === replayBlock) throw new Error('REPLAY_MAX_GAP_MS declaration moved; update this test');

// A fresh agent slice per test. `logLines` is what the stubbed log reader hands the worker.
function build(logLines, { bosses = ['Glykus'], liveFight = false } = {}) {
  const pre = `
    const stats = { watchedLogs: [{ logPath: '/logs/eqlog_Brackwyn_pq.proj.txt', character: 'Brackwyn' }],
                    currentEncounterThreat: ${liveFight ? '{ flushedAt: 0, publishedAt: 0 }' : 'null'}, guildTriggers: [] };
    const LIVE_FIGHT_QUIET_MS = 1e12;
    const _personalTriggers = [];
    const _activeTimers = new Map();
    const scheduleRender = () => {};
    const parseEqTimestamp = (l) => { const m = /^\\[(.+?)\\]/.exec(l); return m ? new Date(m[1]) : null; };
    const triggerVisibleLine = (l) => l.includes('TRIGGERLINE');
    const npcSpeechLine = () => false;
    const readFromBytePos = async (p, pos, onLine, _x, shouldStop) => { for (const l of LOG) { if (shouldStop && shouldStop()) break; onLine(l); } };
    const _myFightZone = () => ({ id: 214, name: 'Plane of Tactics' });
    const _myFightIsBoss = (n) => ${JSON.stringify(bosses)}.includes(n);
  `;
  const post = `
    return { startReplay, stopReplay, _replayDeathsSnapshot, _replayClockForWeb, _replayMobDeaths, _recentMobDeaths,
             _noteRecentMobDeath, _recentDeathsSnapshot, state: () => _replayState, REPLAY_TAIL_MS, DEATH_PAIR_RULES };
  `;
  // eslint-disable-next-line no-new-func
  return new Function('LOG', pre + deathBlock + '\n' + shrunk + post)(logLines);
}

// Log lines, stamped the way the real log is. Oct 20 is "old": the live ring's 60 s gate would drop all of them.
const ts = (h, m, s) => `[${new Date(2026, 9, 20, h, m, s).toString().slice(0, 24).replace(/^(\w+) (\w+) (\d+) (\d+) (.+)$/, '$1 $2 $3 $5 $4')}]`;
const at = (h, m, s) => new Date(2026, 9, 20, h, m, s).getTime();
const LOG = [
  `${ts(21, 0, 0)} You slash a tactics guard for 12 points of damage. TRIGGERLINE`,
  `${ts(21, 2, 0)} Decorin Berik has been slain by Aldenmar!`,
  `${ts(21, 2, 1)} a tactics guard has been slain by Aldenmar!`,          // not a boss, not a pair mob
  `${ts(21, 5, 12)} Decorin Grunhork has been slain by Aldenmar!`,
  `${ts(21, 6, 0)} Glykus has been slain by Aldenmar!`,
  `${ts(21, 7, 0)} Aldenmar died.`,                                       // a player: never a boss
];
const WINDOW = { logPath: '/logs/eqlog_Brackwyn_pq.proj.txt', fromMs: at(20, 59, 0), toMs: at(21, 10, 0), pace: 'fast' };

describe('a replay feeds the SEPARATE replay ring, with the lines\' own timestamps', () => {
  it('records the pair mobs and a catalog boss at their log times; ignores trash and players', async () => {
    const a = build(LOG);
    expect(a.startReplay(WINDOW).ok).toBe(true);
    await a.state()._done;
    expect(a._replayMobDeaths.map((e) => [e.name, e.atMs])).toEqual([
      ['Decorin Berik', at(21, 2, 0)], ['Decorin Grunhork', at(21, 5, 12)], ['Glykus', at(21, 6, 0)],
    ]);
    const snap = a._replayDeathsSnapshot();
    expect(snap.map((e) => e.name)).toEqual(['Decorin Berik', 'Decorin Grunhork', 'Glykus']);
    expect(snap.every((e) => e.replay === true && e.boss === true)).toBe(true);
  });

  it('never touches the live ring, and a live line still lands in the live ring only', async () => {
    const a = build(LOG);
    const liveAt = Date.now() - 5000;
    a._recentMobDeaths.push({ name: 'Tagrin', zone: null, atMs: liveAt, boss: true });
    a.startReplay(WINDOW);
    await a.state()._done;
    expect(a._recentMobDeaths).toEqual([{ name: 'Tagrin', zone: null, atMs: liveAt, boss: true }]);
    expect(a._recentDeathsSnapshot().map((e) => e.name)).toEqual(['Tagrin']);
    // and the reverse: a live line goes to the live ring, not the replay one
    const before = a._replayMobDeaths.length;
    const live = `[${new Date().toString().slice(0, 24)}] Glykus has been slain by Aldenmar!`;
    expect(a._noteRecentMobDeath(live, 'Brackwyn')).toMatchObject({ name: 'Glykus' });
    expect(a._replayMobDeaths).toHaveLength(before);
  });

  it('starting a replay clears the previous rehearsal at once, before any line plays', () => {
    const a = build(LOG);
    a._replayMobDeaths.push({ name: 'Stale', zone: null, atMs: 1, boss: true });
    expect(a.startReplay(WINDOW).ok).toBe(true);
    expect(a._replayMobDeaths).toEqual([]);   // synchronous: the worker has not run a line yet
  });

  it('a refused start (live fight, unknown log, bad range) leaves the ring alone', () => {
    const a = build(LOG, { liveFight: true });
    a._replayMobDeaths.push({ name: 'Keep', zone: null, atMs: 1, boss: true });
    expect(a.startReplay(WINDOW).ok).toBe(false);
    const b = build(LOG);
    b._replayMobDeaths.push({ name: 'Keep', zone: null, atMs: 1, boss: true });
    expect(b.startReplay({ ...WINDOW, logPath: '/nope' }).ok).toBe(false);
    expect(b.startReplay({ ...WINDOW, toMs: WINDOW.fromMs }).ok).toBe(false);
    expect(a._replayMobDeaths).toHaveLength(1);
    expect(b._replayMobDeaths).toHaveLength(1);
  });

  it('a death line that no trigger can see is not evaluated as a trigger line, but still counts toward the ring', async () => {
    const a = build(LOG);
    a.startReplay(WINDOW);
    await a.state()._done;
    expect(a.state().total).toBe(4);   // the trigger-visible line + three death lines kept for the strip
  });
});

describe('the replay clock and the tail', () => {
  it('after a finished walk the strip stays readable for ~2 min, from the window end at 1x, then it is gone', async () => {
    const a = build(LOG);
    a.startReplay(WINDOW);
    await a.state()._done;
    expect(a.REPLAY_TAIL_MS).toBe(120000);
    const c = a._replayClockForWeb();
    expect(c).toMatchObject({ rate: 1, untilMs: null, tail: true, pace: 'fast' });
    expect(c.nowMs).toBeGreaterThanOrEqual(WINDOW.toMs);
    expect(c.nowMs).toBeLessThan(WINDOW.toMs + 2000);
    expect(a._replayDeathsSnapshot()).toHaveLength(3);
    a.state().tailUntil = Date.now() - 1;   // the tail has run out
    expect(a._replayClockForWeb()).toBeNull();
    expect(a._replayDeathsSnapshot()).toBeNull();
    expect(a._replayMobDeaths).toEqual([]);  // and the ring was dropped with it
  });

  it('a stop keeps the same tail, continuing from the last line played', async () => {
    const a = build(LOG);
    a.startReplay({ ...WINDOW, pace: 'real' });
    a.stopReplay();
    await a.state()._done;
    const c = a._replayClockForWeb();
    expect(c).toMatchObject({ rate: 1, tail: true });
    expect(c.nowMs).toBeLessThan(WINDOW.toMs);   // not the window end: it stopped early
  });

  it('while no replay has run there is no clock and no replay ring in the payload', () => {
    const a = build(LOG);
    expect(a._replayClockForWeb()).toBeNull();
    expect(a._replayDeathsSnapshot()).toBeNull();
  });

  it('real pace: the clock crosses a short gap at 1x and a compressed lull faster, bounded by untilMs', async () => {
    // Build a 60 s lull between two boss deaths: the 150 ms test cap compresses it ~400x.
    const log = [
      `${ts(21, 2, 0)} Decorin Berik has been slain by Aldenmar!`,
      `${ts(21, 3, 0)} Decorin Grunhork has been slain by Aldenmar!`,
    ];
    const a = build(log);
    a.startReplay({ ...WINDOW, pace: 'real' });
    await new Promise((r) => setTimeout(r, GAP_CAP_MS / 2));
    const mid = a._replayClockForWeb();
    expect(mid.tail).toBe(false);
    expect(mid.untilMs).toBe(at(21, 3, 0));
    expect(mid.nowMs).toBeGreaterThan(at(21, 2, 0));
    expect(mid.nowMs).toBeLessThan(at(21, 3, 0));
    expect(mid.rate).toBeCloseTo(60000 / GAP_CAP_MS, 0);   // the lull is shown ~400x, not at wall speed
    await a.state()._done;
    expect(a._replayMobDeaths.map((e) => e.name)).toEqual(['Decorin Berik', 'Decorin Grunhork']);
  });

  it('fast pace holds the clock still on the last line played (rate 0) while the walk runs', async () => {
    const a = build(LOG);
    const p = a.startReplay(WINDOW);
    expect(p.ok).toBe(true);
    const c0 = a._replayClockForWeb();     // before the first line plays
    expect(c0).toMatchObject({ rate: 0, tail: false, nowMs: WINDOW.fromMs, untilMs: WINDOW.fromMs });
    await a.state()._done;
  });
});

describe('wiring in the agent (comments stripped)', () => {
  const a = stripJs(AGENT);
  it('both API bodies carry replayDeaths + replayClock beside the live ring', () => {
    expect((a.match(/replayDeaths:\s+_replayDeathsSnapshot\(\)/g) || []).length).toBe(2);   // /api/timers + the state object
    expect((a.match(/replayClock:\s+_replayClockForWeb\(\)/g) || []).length).toBe(2);
    expect((a.match(/recentDeaths:\s+_recentDeathsSnapshot\(\)/g) || []).length).toBe(2);  // the live ring is still shipped as before
  });
  it('the live tail hook still feeds only the live ring', () => {
    expect(a).toMatch(/_noteRecentMobDeath\(line, b\.character\)/);
    const hook = sliceBlock(a, 'function _noteRecentMobDeath(line, character) {', '\n}');
    expect(hook).toMatch(/_ringAddMobDeath\(_recentMobDeaths,/);
    expect(hook).not.toMatch(/_replayMobDeaths/);
    expect(hook).toMatch(/Date\.now\(\) - atMs > 60000/);   // the live gate is untouched
  });
  it('the replay start clears the ring and the live-fight refusal is kept', () => {
    const start = sliceBlock(a, 'function startReplay(opts) {', '\n}');
    expect(start).toMatch(/_replayMobDeaths\.length = 0/);
    expect(start).toMatch(/_liveFightActive\(\)/);
  });
});

// ── 2  the page ──────────────────────────────────────────────────────────────────────────────────────────────
const pageBlock = sliceBlock(TRIGGERS, '// ── death timeline: pure state ──', '// ── /death timeline: pure state ──');
const { tlReplayNow, tlPickFeed, deathPairStates } = evalBlock(pageBlock, ['tlReplayNow', 'tlPickFeed', 'deathPairStates']);
const RULES = [{ names: ['Decorin Berik', 'Decorin Grunhork'], windowSec: 360, label: 'Decorins' }];

describe('triggers.html runs the strip on the replay clock', () => {
  const R0 = at(21, 2, 0);
  it('tlReplayNow: wall time with no replay; else the clock advanced at its rate since the poll, never past untilMs', () => {
    expect(tlReplayNow(null, 5000)).toBe(5000);
    const rp = { nowMs: R0, rate: 1, untilMs: null, recv: 10000 };
    expect(tlReplayNow(rp, 10000)).toBe(R0);
    expect(tlReplayNow(rp, 13000)).toBe(R0 + 3000);
    const lull = { nowMs: R0, rate: 400, untilMs: R0 + 60000, recv: 10000 };
    expect(tlReplayNow(lull, 10100)).toBe(R0 + 40000);
    expect(tlReplayNow(lull, 10500)).toBe(R0 + 60000);        // clamped: no overshoot between polls
    expect(tlReplayNow({ nowMs: R0, rate: 0, untilMs: R0, recv: 1 }, 99999)).toBe(R0);   // fast pace holds still
  });
  it('tlPickFeed: the replay ring + clock when both come, else the live ring; a bad clock is ignored', () => {
    const live = [{ name: 'Tagrin', atMs: 1 }], rd = [{ name: 'Decorin Berik', atMs: R0, replay: true }];
    const f = tlPickFeed(live, rd, { nowMs: R0, rate: 1, untilMs: null }, 777);
    expect(f.deaths).toBe(rd);
    expect(f.replay).toEqual({ nowMs: R0, rate: 1, untilMs: null, recv: 777 });
    expect(tlPickFeed(live, null, null, 777)).toEqual({ deaths: live, replay: null });
    expect(tlPickFeed(live, rd, null, 777).deaths).toBe(live);                 // ring without a clock: not a rehearsal
    expect(tlPickFeed(live, rd, { nowMs: 'x' }, 777).replay).toBeNull();
    expect(tlPickFeed(undefined, undefined, undefined, 1)).toEqual({ deaths: [], replay: null });   // an old agent
  });
  it('an old-log death opens its pair window against replay time, and the same death against wall time is long missed', () => {
    const ds = [{ name: 'Decorin Berik', atMs: R0 }];
    const rp = { nowMs: R0 + 168000, rate: 1, untilMs: null, recv: 1000 };
    const st = deathPairStates(ds, RULES, tlReplayNow(rp, 1000));
    expect(st[0]).toMatchObject({ kind: 'open', dueName: 'Decorin Grunhork', deadlineMs: R0 + 360000 });
    expect(deathPairStates(ds, RULES, Date.now())).toEqual([]);                // wall time: a week past the 2-min result tail
  });
  it('wiring: the strip\'s now, the rehearsal tag and the wall-clock timer rows (comments stripped)', () => {
    const t = stripJs(TRIGGERS);
    expect(t).toMatch(/function tlNow\(\)\{ return tlReplayNow\(_tlReplay, Date\.now\(\)\); \}/);
    const upd = sliceBlock(t, 'function tlineUpdate(){', 'var shown = ds.slice(-5);');
    expect(upd).toMatch(/var now = tlNow\(\)/);
    expect(upd).not.toMatch(/var now = Date\.now\(\)/);
    expect(t).toMatch(/⏪ rehearsal/);
    expect((t.match(/TL_REHEARSAL_TAG/g) || []).length).toBeGreaterThanOrEqual(3);   // defined, expanded, collapsed
    expect(t).toMatch(/n\.hasAttribute\('data-w'\) \? Date\.now\(\) : now/);
    expect(t).toMatch(/\(rehearsal \? 'R' : ''\)/);                            // the layout signature changes when a replay starts or ends
  });
});
