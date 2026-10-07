// test/log-silent.test.js — "your log has gone silent".
//
// FB-51 (2026-10-05): one player's eqlog stopped being WRITTEN at a known minute
// (file mtime frozen, size unchanged) while they kept playing and Zeal kept
// reporting them in game. EverQuest itself had stopped logging (/log toggles it,
// or it is writing to another folder). The agent was healthy and had nothing to
// read — and nothing told anyone. The agent now knows both halves: Zeal's live
// state for the character, and when that log last produced a line.
//
// The decision is pure (`_logSilentCheck`); `_logSilentSweep` is the shipped
// loop body around it and owns the once-per-episode warning + the status the
// dashboard's /api/state carries (`logSilent`, no UI yet).
//
// Run: npx vitest run test/log-silent.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import agent from '../packages/wolfpack-logsync/index.js';
import { readSource, sliceBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const { _logSilentCheck, _logSilentSweep, _logSilentForTest } = agent;

const MIN = 60_000;
const NOW = 1_800_000_000_000;

describe('_logSilentCheck — the decision', () => {
  const base = { zealUpdatedAt: NOW - 5_000, logLastLineAt: NOW - 10 * MIN, now: NOW };

  it('in game and silent for 5+ minutes: warn', () => {
    expect(_logSilentCheck(base)).toBe(true);
  });

  it('not before 5 minutes, yes at exactly 5', () => {
    expect(_logSilentCheck({ ...base, logLastLineAt: NOW - (5 * MIN - 1) })).toBe(false);
    expect(_logSilentCheck({ ...base, logLastLineAt: NOW - 5 * MIN })).toBe(true);
    expect(_logSilentCheck({ ...base, logLastLineAt: NOW - 5 * MIN - 1 })).toBe(true);
  });

  it('never when Zeal is stale — the character is logged out, a quiet log is normal', () => {
    expect(_logSilentCheck({ ...base, zealUpdatedAt: NOW - 61_000 })).toBe(false);
    expect(_logSilentCheck({ ...base, zealUpdatedAt: NOW - 60_000 })).toBe(true);    // at the edge it still counts as fresh
    expect(_logSilentCheck({ ...base, zealUpdatedAt: NOW - 3 * 3600_000 })).toBe(false);
  });

  it('never when Zeal has not reported the character at all', () => {
    expect(_logSilentCheck({ ...base, zealUpdatedAt: 0 })).toBe(false);
    expect(_logSilentCheck({ ...base, zealUpdatedAt: undefined })).toBe(false);
  });

  it('never when the log has no known last line (nothing to compare)', () => {
    expect(_logSilentCheck({ ...base, logLastLineAt: 0 })).toBe(false);
    expect(_logSilentCheck({ ...base, logLastLineAt: null })).toBe(false);
  });

  it('clears the moment a line arrives', () => {
    expect(_logSilentCheck(base)).toBe(true);
    expect(_logSilentCheck({ ...base, logLastLineAt: NOW - 2_000 })).toBe(false);
  });

  it('thresholds are overridable', () => {
    expect(_logSilentCheck({ ...base, silentMs: 15 * MIN })).toBe(false);
    expect(_logSilentCheck({ ...base, zealFreshMs: 1_000 })).toBe(false);
  });
});

describe('_logSilentSweep — once per episode, with a status', () => {
  const FILE = path.join('C:', 'EQ', 'Logs', 'eqlog_Aldenmar_pq.proj.txt');
  let warn, log;
  const watch = (lastSeen, character = 'Aldenmar') => agent._setWatchedLogsForTest([{ character, logPath: FILE.replace('Aldenmar', character), lastSeen }]);
  const zeal = (updatedAt, key = 'Aldenmar') => agent._setZealStateForTest(key, { updatedAt });
  const warned = () => warn.mock.calls.map(c => c.join(' '));
  const logged = () => log.mock.calls.map(c => c.join(' '));

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    agent._setWatchedLogsForTest([]); agent._setZealStateForTest('Aldenmar', null); agent._setZealStateForTest('ALDENMAR', null);
    _logSilentSweep(NOW);                       // drop any episode a previous test left open
    warn.mockClear(); log.mockClear();
  });
  afterEach(() => {
    agent._setWatchedLogsForTest([]); agent._setZealStateForTest('Aldenmar', null); agent._setZealStateForTest('ALDENMAR', null);
    _logSilentSweep(NOW);
    vi.restoreAllMocks();
  });

  it('warns once, names the file and the character, and exposes the status', () => {
    watch(NOW - 6 * MIN); zeal(NOW - 3_000);
    _logSilentSweep(NOW);
    expect(warned()).toHaveLength(1);
    expect(warned()[0]).toMatch(/^\[log-silent\] eqlog_Aldenmar_pq\.proj\.txt has had no new lines for 6 min while Aldenmar is in game/);
    expect(warned()[0]).toMatch(/\/log toggles it/);
    expect(warned()[0]).toMatch(/another folder/);
    expect(_logSilentForTest()).toEqual({ character: 'Aldenmar', file: 'eqlog_Aldenmar_pq.proj.txt', silentSince: NOW - 6 * MIN });
  });

  it('does not repeat the warning while the episode lasts, and the status stays byte-stable', () => {
    watch(NOW - 6 * MIN); zeal(NOW - 3_000);
    _logSilentSweep(NOW);
    const first = JSON.stringify(_logSilentForTest());
    for (let i = 1; i <= 10; i++) { zeal(NOW + i * 30_000 - 3_000); _logSilentSweep(NOW + i * 30_000); }
    expect(warned()).toHaveLength(1);
    expect(JSON.stringify(_logSilentForTest())).toBe(first);   // silentSince is the last line's time, not "now"
  });

  it('clears, with a one-line note, when lines resume — and a later silence is a new episode', () => {
    watch(NOW - 6 * MIN); zeal(NOW - 3_000);
    _logSilentSweep(NOW);
    expect(_logSilentForTest()).not.toBe(null);

    watch(NOW + 20_000); zeal(NOW + 25_000);                    // a line arrives
    _logSilentSweep(NOW + 30_000);
    expect(_logSilentForTest()).toBe(null);
    expect(logged().filter(s => /\[log-silent\].*producing lines again/.test(s))).toHaveLength(1);

    const later = NOW + 20_000 + 7 * MIN;                       // goes quiet again
    zeal(later - 2_000);
    _logSilentSweep(later);
    expect(warned()).toHaveLength(2);
    expect(_logSilentForTest().silentSince).toBe(NOW + 20_000);
  });

  it('says nothing under 5 minutes', () => {
    watch(NOW - 4 * MIN); zeal(NOW - 3_000);
    _logSilentSweep(NOW);
    expect(warned()).toEqual([]);
    expect(_logSilentForTest()).toBe(null);
  });

  it('says nothing when Zeal is stale (the character logged out), however long the log has been quiet', () => {
    watch(NOW - 3 * 3600_000); zeal(NOW - 5 * MIN);
    _logSilentSweep(NOW);
    expect(warned()).toEqual([]);
    expect(_logSilentForTest()).toBe(null);
  });

  it('says nothing when Zeal has never reported the character', () => {
    watch(NOW - 30 * MIN);
    _logSilentSweep(NOW);
    expect(warned()).toEqual([]);
  });

  it('a character who logs out mid-episode clears it with its own note', () => {
    watch(NOW - 6 * MIN); zeal(NOW - 3_000);
    _logSilentSweep(NOW);
    expect(_logSilentForTest()).not.toBe(null);
    _logSilentSweep(NOW + 2 * MIN);                             // Zeal state has not refreshed for 2 minutes
    expect(_logSilentForTest()).toBe(null);
    expect(logged().some(s => /Aldenmar is no longer in game/.test(s))).toBe(true);
  });

  it("matches Zeal's character key whatever its case", () => {
    watch(NOW - 6 * MIN); zeal(NOW - 3_000, 'ALDENMAR');
    _logSilentSweep(NOW);
    expect(warned()).toHaveLength(1);
  });

  it('only the primary character is watched: another silent log does not warn', () => {
    agent._setWatchedLogsForTest([
      { character: 'Aldenmar', logPath: FILE, lastSeen: NOW - 1_000 },
      { character: 'Brackwyn', logPath: FILE.replace('Aldenmar', 'Brackwyn'), lastSeen: NOW - 30 * MIN },
    ]);
    zeal(NOW - 3_000); zeal(NOW - 3_000, 'Brackwyn');
    _logSilentSweep(NOW);
    expect(warned()).toEqual([]);
    agent._setZealStateForTest('Brackwyn', null);
  });
});

describe('wiring (text-level; the behaviour is above)', () => {
  const src = readSource(AGENT_INDEX);

  it('/api/state carries logSilent, straight from the status object', () => {
    const state = stripJs(sliceBlock(src, 'function _serializeForDashboard() {', '\n}\n'));
    expect(state).toMatch(/logSilent:\s+_logSilent,/);
  });

  it('watch mode sweeps on a timer that cannot keep the process alive', () => {
    const watchMode = stripJs(sliceBlock(src, '// Watch mode (default for live raids)', '// One-shot mode (--once)'));
    expect(watchMode).toMatch(/setInterval\(\(\) => \{ try \{ _logSilentSweep\(\); \}/);
    expect(watchMode).toMatch(/_silentTimer\.unref\(\)/);
  });
});
