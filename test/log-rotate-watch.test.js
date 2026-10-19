// test/log-rotate-watch.test.js — log archiving in normal (watch) use.
//
// FB-51 / DECISIONS §162, §383 (the guild lead, 2026-10-19: "wire it in"). `_logRotateSweep` had its
// timers only inside the --once branch, so Mimic's watch mode never archived while the dashboard said
// archiving was ON. Now the watch branch starts them, and because renaming a member's log is new there,
// every move is gated: over the cap, quiet >= 15 min, the agent read no line from it, Zeal does not have
// the character in game, a re-check right before the rename, a free archive name, nothing deleted.
//
// The sweep runs for real against an in-memory fs and a fake clock (no 500 MB files).
//
// Run: npx vitest run test/log-rotate-watch.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import agent from '../packages/wolfpack-logsync/index.js';
import { readSource, sliceBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const MB = 1024 * 1024;
const MIN = 60_000;
const NOW = new Date(2026, 9, 19, 21, 30, 15).getTime();   // local time, so the archive stamp is zone-independent
const DIR = path.join(path.sep, 'eq', 'Logs');
const LOG = path.join(DIR, 'eqlog_Aldenmar_pq.proj.txt');
const ARCHIVE = path.join(DIR, 'LogArchive');

// A tiny in-memory fs with the calls the sweep makes. `hooks.afterFirstStat` runs once the async stat has
// returned, so a test can have EverQuest write to the file between the first look and the re-check.
function fakeFs(files, hooks = {}) {
  const calls = [];
  const get = (p) => { const f = files.get(p); if (!f) throw Object.assign(new Error('ENOENT ' + p), { code: 'ENOENT' }); return f; };
  const snap = (f) => ({ size: f.size, mtimeMs: f.mtimeMs });
  return {
    calls,
    promises: {
      async stat(p) { calls.push(['stat', p]); const s = snap(get(p)); if (hooks.afterFirstStat) { const h = hooks.afterFirstStat; hooks.afterFirstStat = null; h(); } return s; },
    },
    statSync(p) { if (hooks.onRecheck) { const h = hooks.onRecheck; hooks.onRecheck = null; h(); } return snap(get(p)); },
    mkdirSync(p) { calls.push(['mkdir', p]); },
    existsSync(p) { return files.has(p); },
    renameSync(from, to) {
      calls.push(['rename', from, to]);
      if (hooks.renameThrows) throw Object.assign(new Error('busy'), { code: hooks.renameThrows });
      files.set(to, get(from)); files.delete(from);
    },
    writeFileSync(p, data, opts) {
      calls.push(['write', p]);
      if (opts && opts.flag === 'wx' && files.has(p)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      files.set(p, { size: 0, mtimeMs: NOW });
    },
    unlinkSync() { throw new Error('the sweep must never delete'); },
    rmSync() { throw new Error('the sweep must never delete'); },
  };
}
const renames = (f) => f.calls.filter((c) => c[0] === 'rename');

let files;
function setup(over = {}) {
  files = new Map([[LOG, { size: 600 * MB, mtimeMs: NOW - 30 * MIN, ...over }]]);
}
function watch(lastSeen = NOW - 30 * MIN) {
  agent._setWatchedLogsForTest([{ character: 'Aldenmar', logPath: LOG, lastSeen }]);
}
const sweep = (fs, extra = {}) => agent._logRotateSweep({ fs, now: () => NOW, enabled: true, thresholdMb: 500, idleMs: 15 * MIN, ...extra });

beforeEach(() => {
  agent._resetLogRotateForTest();
  agent._setAgentPrefsForTest({});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setup();
  watch();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  agent._setWatchedLogsForTest([]);
  for (const k of ['Aldenmar', 'aLDENMAR', 'Brackwyn']) agent._setZealStateForTest(k, null);
  agent._setAgentPrefsForTest(null);
  agent._resetLogRotateForTest();
});

describe('what moves', () => {
  it('moves a log over 500 MB that has been quiet 15+ min into LogArchive, leaves an empty file, records it', async () => {
    const fs = fakeFs(files);
    const moved = await sweep(fs);
    expect(moved).toHaveLength(1);
    const dest = path.join(ARCHIVE, 'eqlog_Aldenmar_pq.proj.2026-10-19-2130.txt');
    expect(renames(fs)).toEqual([['rename', LOG, dest]]);
    expect(files.get(dest).size).toBe(600 * MB);   // the content went with the file
    expect(files.get(LOG).size).toBe(0);           // a fresh empty file at the original path
    expect(agent._logRotationsForTest()[0]).toMatchObject({ file: 'eqlog_Aldenmar_pq.proj.txt', dest, mb: 600 });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[log-archive] eqlog_Aldenmar_pq.proj.txt (600MB)'));
  });

  it('leaves a log at or under the cap alone', async () => {
    setup({ size: 500 * MB });
    const fs = fakeFs(files);
    expect(await sweep(fs)).toEqual([]);
    expect(renames(fs)).toEqual([]);
  });

  it('boundary: quiet for exactly 15 minutes moves; 14 does not', async () => {
    setup({ mtimeMs: NOW - 15 * MIN });
    expect(await sweep(fakeFs(files))).toHaveLength(1);
    setup({ mtimeMs: NOW - 14 * MIN });
    watch(NOW - 14 * MIN);
    const fs = fakeFs(files);
    expect(await sweep(fs)).toEqual([]);
    expect(renames(fs)).toEqual([]);
  });
});

describe('never the log EverQuest is writing', () => {
  it('skips a log whose mtime is recent', async () => {
    setup({ mtimeMs: NOW - 2 * MIN });
    const fs = fakeFs(files);
    expect(await sweep(fs)).toEqual([]);
    expect(renames(fs)).toEqual([]);
  });

  it('skips when the agent itself read a line from the log inside the quiet window, whatever the mtime says', async () => {
    watch(NOW - 3 * MIN);
    const fs = fakeFs(files);
    expect(await sweep(fs)).toEqual([]);
    expect(renames(fs)).toEqual([]);
  });

  it('skips a quiet log while Zeal has that character in game (case-insensitive name)', async () => {
    agent._setZealStateForTest('aLDENMAR', { updatedAt: NOW - 20_000 });
    const fs = fakeFs(files);
    expect(await sweep(fs)).toEqual([]);
    expect(renames(fs)).toEqual([]);
  });

  it('moves it once Zeal has been silent for 5+ min (logged out)', async () => {
    agent._setZealStateForTest('Aldenmar', { updatedAt: NOW - 6 * MIN });
    expect(await sweep(fakeFs(files))).toHaveLength(1);
  });

  it('another character being in game does not block this one', async () => {
    agent._setZealStateForTest('Brackwyn', { updatedAt: NOW - 1_000 });
    expect(await sweep(fakeFs(files))).toHaveLength(1);
    agent._setZealStateForTest('Brackwyn', null);
  });

  it('re-checks right before the move: EverQuest wrote in the gap, so nothing moves', async () => {
    const hooks = { afterFirstStat: () => { files.get(LOG).mtimeMs = NOW - 1_000; files.get(LOG).size += 40; } };
    const fs = fakeFs(files, hooks);
    expect(await sweep(fs)).toEqual([]);
    expect(renames(fs)).toEqual([]);
    expect(files.get(LOG).size).toBe(600 * MB + 40);
  });

  it('re-check also catches the character logging in during the gap (Zeal speaks up, the file has not changed yet)', async () => {
    const hooks = { onRecheck: () => agent._setZealStateForTest('Aldenmar', { updatedAt: NOW - 1_000 }) };
    const fs = fakeFs(files, hooks);
    expect(await sweep(fs)).toEqual([]);
    expect(renames(fs)).toEqual([]);
  });

  it('re-check also catches growth with an unchanged mtime', async () => {
    const hooks = { afterFirstStat: () => { files.get(LOG).size += 1; } };
    const fs = fakeFs(files, hooks);
    expect(await sweep(fs)).toEqual([]);
    expect(renames(fs)).toEqual([]);
  });
});

describe('on / off', () => {
  it('does nothing when the dashboard switch is off (the real setting)', async () => {
    agent._setAgentPrefsForTest({ log_rotate_off: true });
    const fs = fakeFs(files);
    const moved = await agent._logRotateSweep({ fs, now: () => NOW, thresholdMb: 500, idleMs: 15 * MIN });   // enabled: from the pref
    expect(moved).toEqual([]);
    expect(renames(fs)).toEqual([]);
  });

  it('runs when the switch is on (the real setting)', async () => {
    agent._setAgentPrefsForTest({});
    const moved = await agent._logRotateSweep({ fs: fakeFs(files), now: () => NOW, thresholdMb: 500, idleMs: 15 * MIN });
    expect(moved).toHaveLength(1);
  });

  it('a cap of 0 (WP_LOG_ROTATE_MB=0) moves nothing', async () => {
    const fs = fakeFs(files);
    expect(await sweep(fs, { thresholdMb: 0 })).toEqual([]);
    expect(renames(fs)).toEqual([]);
  });
});

describe('a failed move is logged, kept, and retried next sweep', () => {
  it('EverQuest holding the file open (EBUSY): the log is untouched, one warning, and the next sweep moves it', async () => {
    const hooks = { renameThrows: 'EBUSY' };
    const fs = fakeFs(files, hooks);
    expect(await sweep(fs)).toEqual([]);
    expect(files.get(LOG).size).toBe(600 * MB);
    expect(agent._logRotationsForTest()).toEqual([]);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn.mock.calls[0][0]).toMatch(/in use by EverQuest.*trying again at the next sweep/);
    hooks.renameThrows = null;
    expect(await sweep(fs, { now: () => NOW + 10 * MIN })).toHaveLength(1);
  });

  it('a log that keeps failing warns at most once an hour, not every sweep', async () => {
    const fs = fakeFs(files, { renameThrows: 'EBUSY' });
    for (let i = 0; i < 6; i++) await sweep(fs, { now: () => NOW + i * 10 * MIN });
    expect(console.warn).toHaveBeenCalledTimes(1);
    await sweep(fs, { now: () => NOW + 61 * MIN });
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it('a missing log (stat fails) does not stop the other logs', async () => {
    const other = path.join(DIR, 'eqlog_Brackwyn_pq.proj.txt');
    files.set(other, { size: 700 * MB, mtimeMs: NOW - 40 * MIN });
    agent._setWatchedLogsForTest([
      { character: 'Gone', logPath: path.join(DIR, 'eqlog_Gone_pq.proj.txt'), lastSeen: NOW - 40 * MIN },
      { character: 'Brackwyn', logPath: other, lastSeen: NOW - 40 * MIN },
    ]);
    const moved = await sweep(fakeFs(files));
    expect(moved.map((m) => m.file)).toEqual(['eqlog_Brackwyn_pq.proj.txt']);
  });

  it('one sweep never overlaps another', async () => {
    const fs = fakeFs(files);
    const [a, b] = await Promise.all([sweep(fs), sweep(fs)]);
    expect(a.length + b.length).toBe(1);
    expect(renames(fs)).toHaveLength(1);
    expect(fs.calls.filter((c) => c[0] === 'stat')).toHaveLength(1);   // the second sweep never looked at the disk
  });
});

describe('nothing is ever deleted or overwritten', () => {
  it('a taken archive name falls back to the seconds stamp; the earlier archive is untouched', async () => {
    const minuteName = path.join(ARCHIVE, 'eqlog_Aldenmar_pq.proj.2026-10-19-2130.txt');
    files.set(minuteName, { size: 123, mtimeMs: NOW - 99 * MIN });
    const fs = fakeFs(files);
    const moved = await sweep(fs);
    expect(moved).toHaveLength(1);
    expect(files.get(minuteName).size).toBe(123);
    expect(moved[0].dest).toBe(path.join(ARCHIVE, 'eqlog_Aldenmar_pq.proj.2026-10-19-213015.txt'));
  });

  it('with both names taken it moves nothing and says so', async () => {
    files.set(path.join(ARCHIVE, 'eqlog_Aldenmar_pq.proj.2026-10-19-2130.txt'), { size: 1, mtimeMs: 0 });
    files.set(path.join(ARCHIVE, 'eqlog_Aldenmar_pq.proj.2026-10-19-213015.txt'), { size: 2, mtimeMs: 0 });
    const fs = fakeFs(files);
    expect(await sweep(fs)).toEqual([]);
    expect(renames(fs)).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('is taken'));
  });

  it('the fake fs would throw on any delete call, and a normal run makes none', async () => {
    await expect(sweep(fakeFs(files))).resolves.toHaveLength(1);
  });
});

describe('_logRotateSkipReason', () => {
  const base = { sizeBytes: 600 * MB, mtimeMs: NOW - 30 * MIN, nowMs: NOW, thresholdMb: 500, idleMs: 15 * MIN, lastLineAt: 0, zealUpdatedAt: 0 };
  it('names why', () => {
    expect(agent._logRotateSkipReason(base)).toBeNull();
    expect(agent._logRotateSkipReason({ ...base, sizeBytes: 10 * MB })).toBe('under_cap');
    expect(agent._logRotateSkipReason({ ...base, mtimeMs: NOW - MIN })).toBe('recent_write');
    expect(agent._logRotateSkipReason({ ...base, lastLineAt: NOW - MIN })).toBe('agent_read_line');
    expect(agent._logRotateSkipReason({ ...base, zealUpdatedAt: NOW - MIN })).toBe('in_game');
  });
});

describe('it actually runs in watch mode', () => {
  it('_logRotateStartTimers: first pass after 2 min, then every 10 min', async () => {
    vi.useFakeTimers();
    const sweepFn = vi.fn(async () => []);
    const t = agent._logRotateStartTimers(sweepFn);
    expect(sweepFn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(sweepFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(sweepFn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20 * MIN);
    expect(sweepFn).toHaveBeenCalledTimes(4);
    clearTimeout(t.first); clearInterval(t.every);
  });

  it('a sweep that rejects does not escape the timer', async () => {
    vi.useFakeTimers();
    const t = agent._logRotateStartTimers(async () => { throw new Error('boom'); });
    await expect(vi.advanceTimersByTimeAsync(3 * MIN)).resolves.not.toThrow();
    clearTimeout(t.first); clearInterval(t.every);
  });

  // The bug was a call that sat in the wrong branch. Pin the branch: the watch block (up to its
  // `return;`) starts the timers; comments are stripped so the header cannot answer for the code.
  it('the watch-mode branch of main() starts the timers, before it returns', () => {
    const src = readSource(AGENT_INDEX);
    const watchBlock = sliceBlock(src, "if (args.flags.watch || (!args.flags.once && !args.flags.since)) {", '    // Run forever; intervals keep us alive\n    return;');
    expect(stripJs(watchBlock)).toMatch(/_logRotateStartTimers\(\);/);
  });

  it('the --once branch still starts them (one definition of the cadence)', () => {
    const src = readSource(AGENT_INDEX);
    const onceBlock = sliceBlock(src, "if (args.flags.once) {", 'process.exit(0);');
    expect(stripJs(onceBlock)).toMatch(/_logRotateStartTimers\(\);/);
  });
});
