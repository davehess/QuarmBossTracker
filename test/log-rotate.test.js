// test/log-rotate.test.js — the log-rotation decision + archive naming.
//
// Feedback (Ashieron, 2026-08-07, wolfpack.quest): "Keep track of logfile size
// and cull the file when it gets too big, or keep it at a maximum size and
// file old logs to another location." We archive, never cull — old logs feed
// --since backfill and historical chat. These tests pin the decision gates:
// the feature must never touch a file that is under the cap, actively being
// written, or disabled by WP_LOG_ROTATE_MB=0.
//
// Run: npx vitest run test/log-rotate.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const block =
  sliceBlock(src, 'function _shouldRotateLog(sizeBytes, mtimeMs, nowMs, thresholdMb, idleMs) {', '\n}') +
  sliceBlock(src, 'function _rotateArchiveName(logPath, nowMs) {', '\n}');

// eslint-disable-next-line no-new-func
const H = new Function(
  "const path = { basename: (p) => String(p).split(/[\\\\/]/).pop() };\n"
  + block + '\nreturn { _shouldRotateLog, _rotateArchiveName };',
)();

const MB = 1024 * 1024;
const NOW = 1_800_000_000_000;
const IDLE = 15 * 60_000;

describe('_shouldRotateLog', () => {
  it('rotates an oversized, idle file', () => {
    expect(H._shouldRotateLog(800 * MB, NOW - 30 * 60_000, NOW, 750, IDLE)).toBe(true);
  });

  it('never touches a file under the cap', () => {
    expect(H._shouldRotateLog(700 * MB, NOW - 30 * 60_000, NOW, 750, IDLE)).toBe(false);
  });

  it('never touches a file being written (mtime inside the idle window)', () => {
    expect(H._shouldRotateLog(2000 * MB, NOW - 60_000, NOW, 750, IDLE)).toBe(false);
  });

  it('threshold 0 disables the feature entirely', () => {
    expect(H._shouldRotateLog(9000 * MB, NOW - 24 * 3600_000, NOW, 0, IDLE)).toBe(false);
  });

  it('boundary: exactly at the cap is under it; exactly idle rotates', () => {
    expect(H._shouldRotateLog(750 * MB, NOW - 30 * 60_000, NOW, 750, IDLE)).toBe(false);
    expect(H._shouldRotateLog(751 * MB, NOW - IDLE, NOW, 750, IDLE)).toBe(true);
  });
});

describe('_rotateArchiveName', () => {
  it('stamps the original basename with a sortable date', () => {
    const name = H._rotateArchiveName('C:\\\\EQ\\\\Logs\\\\eqlog_Canopy_pq.proj.txt', NOW);
    expect(name).toMatch(/^eqlog_Canopy_pq\.proj\.\d{4}-\d{2}-\d{2}-\d{4}\.txt$/);
  });
});
