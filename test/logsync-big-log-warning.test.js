// test/logsync-big-log-warning.test.js — the Logsync tab warns about an
// oversized LIVE log, and the Setup checklist leads with "EverQuest is not
// running" instead of three wrong fixes.
//
// Both from the guild lead, 2026-09-22. The first came from a member whose
// eqlog_<name>_pq.proj.txt had reached 1.33 GB, unbroken since November 2024 —
// found by accident. The size was already in the table; a number is not a
// warning, and nothing said which numbers are a problem.
//
// ⚠ These RUN the real functions. `check:dashboard` only proves the script
// parses, and a ReferenceError parses — which is how the renderSetupChecks
// crash rode a stable graduation to the whole fleet. Text assertions would
// also be answered by this file's own comments.
//
// Run: npx vitest run test/logsync-big-log-warning.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, evalBlock } from './_source-slice.js';

const DASH = path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html');
const dashSrc = readSource(DASH);

const MB = 1048576;
const { _wpBigLogs, WP_LOG_WARN_BYTES, WP_LOG_BIG_BYTES } = evalBlock(
  sliceBlock(dashSrc, 'var WP_LOG_WARN_BYTES', '(b.sizeBytes || 0) - (a.sizeBytes || 0));\n}'),
  ['_wpBigLogs', 'WP_LOG_WARN_BYTES', 'WP_LOG_BIG_BYTES'],
);

const live = (mb, extra = {}) => ({ path: 'C:\\EQ\\eqlog_A_pq.proj.txt', isWatched: true, sizeBytes: mb * MB, ...extra });

describe('which logs the Logsync tab warns about', () => {
  it('flags a live log at or past the warn threshold', () => {
    expect(_wpBigLogs([live(1400)]).length).toBe(1);
    expect(_wpBigLogs([live(WP_LOG_WARN_BYTES / MB)]).length).toBe(1);
  });

  it('says nothing about an ordinary log', () => {
    expect(_wpBigLogs([live(40), live(300)])).toEqual([]);
  });

  // The whole point of the warning is to get the history into an archive, so
  // warning about the archive afterwards would train people to dismiss it.
  it('never flags an IMPORTED archive, however big', () => {
    expect(_wpBigLogs([live(4000, { imported: true, isWatched: false })])).toEqual([]);
    expect(_wpBigLogs([live(4000, { imported: true, isWatched: true })])).toEqual([]);
  });

  it('ignores files that are not being tailed', () => {
    expect(_wpBigLogs([live(4000, { isWatched: false })])).toEqual([]);
  });

  it('puts the worst offender first, so the card can pick its severity', () => {
    const out = _wpBigLogs([live(600), live(2000), live(900)]);
    expect(out.map(f => f.sizeBytes / MB)).toEqual([2000, 900, 600]);
  });

  it('survives junk without throwing', () => {
    expect(_wpBigLogs(null)).toEqual([]);
    expect(_wpBigLogs([null, undefined, {}])).toEqual([]);
  });

  // Mutation guard: a threshold this file asserts against must be a real one.
  it('has a warn threshold below the big threshold, both under 2 GB', () => {
    expect(WP_LOG_WARN_BYTES).toBeLessThan(WP_LOG_BIG_BYTES);
    expect(WP_LOG_BIG_BYTES).toBeLessThanOrEqual(2048 * MB);
  });
});

// ── the checklist leads with the real problem ───────────────────────────────
const rowsOf = (s) => evalBlock(
  sliceBlock(dashSrc, 'function _setupCheckRows(s) {', '\n  return rows;\n}'),
  ['_setupCheckRows'],
)._setupCheckRows(s);
const rowFor = (s, label) => rowsOf(s).find(r => r.label === label);
const detail = (r) => String(r && (r.info || (r.ok ? r.good : r.bad)));

const CLOSED  = { watchedLogs: [], zealClients: [], eqFolder: {} };
const PLAYING = { watchedLogs: [{ lastSeen: Date.now() - 5000 }], zealClients: [], eqFolder: {} };

describe('"EverQuest running" leads the checklist when the game is shut', () => {
  it('appears FIRST, so it is read before the rows it explains', () => {
    expect(rowsOf(CLOSED)[0].label).toBe('EverQuest running');
  });

  it('is neutral, not a red failure — opening the dashboard first is normal', () => {
    expect(rowsOf(CLOSED)[0].neutral).toBe(true);
  });

  it('is absent while a character is logged in', () => {
    expect(rowsOf(PLAYING).some(r => r.label === 'EverQuest running')).toBe(false);
  });

  it('counts a live Zeal client as proof the game is running', () => {
    const s = { watchedLogs: [], zealClients: [{ live: true }], eqFolder: {} };
    expect(rowsOf(s).some(r => r.label === 'EverQuest running')).toBe(false);
  });

  // The actual bug: one shut client produced two different unnecessary fixes.
  it('stops the logging row telling you to type /log on', () => {
    const s = { ...CLOSED, watchedLogs: [{ lastSeen: Date.now() - 3600e3 }] };
    expect(detail(rowFor(s, 'In-game logging ON'))).not.toMatch(/\/log on/i);
  });

  it('stops the Zeal row sending you to compatibility settings', () => {
    const s = { ...CLOSED, eqFolder: { zealInstalled: true } };
    expect(detail(rowFor(s, 'Zeal connected'))).not.toMatch(/compatibility mode/i);
  });

  // ⚠ But "Zeal is absent, install it" is actionable AND wants EQ closed, so
  // suppressing it would send someone to start the game and shut it again.
  it('still offers the Zeal install when Zeal is genuinely absent', () => {
    const s = { ...CLOSED, eqFolder: { zealInstalled: false } };
    expect(detail(rowFor(s, 'Zeal connected'))).toMatch(/install Zeal/i);
  });

  it('still asks about compatibility mode while the game IS running', () => {
    const s = { ...PLAYING, eqFolder: { zealInstalled: true } };
    expect(detail(rowFor(s, 'Zeal connected'))).toMatch(/compatibility mode/i);
  });
});
