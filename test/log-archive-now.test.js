// test/log-archive-now.test.js — "Archive log & start fresh".
//
// FB-51 (the guild lead, 2026-10-05): a log that stops being written mid-session needs "a quick way
// to backup log and start fresh in the mimic client". `_archiveLogNow` is the on-demand twin of the
// size-based sweep: rename into LogArchive/, empty replacement at the original path, one entry on
// stats.logRotations (manual: true). The stamp carries seconds so two clicks in a minute differ.
//
// Run: npx vitest run test/log-archive-now.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import agent from '../packages/wolfpack-logsync/index.js';
import { readSource, stripJs, AGENT_INDEX } from './_source-slice.js';

const { _archiveLogNow, _rotateArchiveName } = agent;

const NOW = new Date(2026, 9, 5, 21, 30, 15).getTime();   // local time, so the stamp is zone-independent
let dir, logPath;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-archive-'));
  logPath = path.join(dir, 'eqlog_Aldenmar_pq.proj.txt');
  fs.writeFileSync(logPath, 'line one\nline two\n');
  agent._setWatchedLogsForTest([{ character: 'Aldenmar', logPath, lastSeen: NOW - 10 * 60_000 }]);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  agent._setWatchedLogsForTest([]);
  agent._setZealStateForTest('Aldenmar', null);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('_archiveLogNow', () => {
  it('moves the log into LogArchive, leaves an empty file, and records a manual rotation', () => {
    const r = _archiveLogNow('Aldenmar', NOW);
    expect(r.ok).toBe(true);
    expect(r.archived_name).toBe('eqlog_Aldenmar_pq.proj.2026-10-05-213015.txt');
    expect(r.dest).toBe(path.join(dir, 'LogArchive', r.archived_name));
    expect(fs.readFileSync(r.dest, 'utf8')).toBe('line one\nline two\n');
    expect(fs.existsSync(logPath)).toBe(true);
    expect(fs.readFileSync(logPath, 'utf8')).toBe('');
    const rec = agent._logRotationsForTest()[0];
    expect(rec).toMatchObject({ file: 'eqlog_Aldenmar_pq.proj.txt', dest: r.dest, manual: true });
    expect(rec.at).toBe(new Date(NOW).toISOString());
  });

  it('finds the character case-insensitively', () => {
    expect(_archiveLogNow('aLDENMAR', NOW).ok).toBe(true);
  });

  it('not_found for a character with no watched log (and an empty name)', () => {
    expect(_archiveLogNow('Brackwyn', NOW)).toEqual({ ok: false, reason: 'not_found' });
    expect(_archiveLogNow('', NOW)).toEqual({ ok: false, reason: 'not_found' });
    expect(fs.readFileSync(logPath, 'utf8')).toBe('line one\nline two\n');   // untouched
  });

  it('two archives in the same minute get distinct names and both keep their content', () => {
    const a = _archiveLogNow('Aldenmar', NOW);
    fs.writeFileSync(logPath, 'second session\n');
    const b = _archiveLogNow('Aldenmar', NOW + 5_000);
    expect(a.ok && b.ok).toBe(true);
    expect(a.archived_name).not.toBe(b.archived_name);
    expect(fs.readFileSync(a.dest, 'utf8')).toBe('line one\nline two\n');
    expect(fs.readFileSync(b.dest, 'utf8')).toBe('second session\n');
  });

  it('keeps only the newest 10 rotation records', () => {
    for (let i = 0; i < 12; i++) _archiveLogNow('Aldenmar', NOW + i * 1_000);
    expect(agent._logRotationsForTest()).toHaveLength(10);
  });

  it('reports in_use, and leaves the log alone, when the OS refuses the rename', () => {
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); });
    expect(_archiveLogNow('Aldenmar', NOW)).toEqual({ ok: false, reason: 'in_use' });
    vi.restoreAllMocks();
    expect(fs.readFileSync(logPath, 'utf8')).toBe('line one\nline two\n');
  });

  it('reports any other failure as error with a message', () => {
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw Object.assign(new Error('disk on fire'), { code: 'EIO' }); });
    const r = _archiveLogNow('Aldenmar', NOW);
    expect(r).toMatchObject({ ok: false, reason: 'error' });
    expect(r.message).toMatch(/disk on fire/);
  });

  it('clears the silence warning for that character', () => {
    agent._setZealStateForTest('Aldenmar', { updatedAt: NOW - 3_000 });
    agent._logSilentSweep(NOW);
    expect(agent._logSilentForTest()).not.toBe(null);
    _archiveLogNow('Aldenmar', NOW);
    expect(agent._logSilentForTest()).toBe(null);
  });
});

describe('_rotateArchiveName', () => {
  it('keeps the minute-resolution format by default; seconds are opt-in', () => {
    expect(_rotateArchiveName(logPath, NOW)).toBe('eqlog_Aldenmar_pq.proj.2026-10-05-2130.txt');
    expect(agent._rotateArchiveNameSeconds(logPath, NOW)).toBe('eqlog_Aldenmar_pq.proj.2026-10-05-213015.txt');
  });
});

describe('POST /api/log/archive', () => {
  it('is routed to _archiveLogNow with the posted character', () => {
    const src = stripJs(readSource(AGENT_INDEX));
    const at = src.indexOf("req.url === '/api/log/archive'");
    expect(at).toBeGreaterThan(-1);
    const route = src.slice(at, at + 600);
    expect(route).toMatch(/req\.method === 'POST'/);
    expect(route).toMatch(/_archiveLogNow\(character\)/);
  });
});
