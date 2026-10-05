// test/upload-queue-empty.test.js — an empty queue file is an empty queue.
//
// FB-51 (2026-10-05): an empty upload queue persists as an empty file (the writer
// streams zero entries into the temp file and renames it into place). The loader
// then fell through to JSON.parse(''), threw "Unexpected end of JSON input", and
// moved the file aside as `.corrupt-*` with a warning on EVERY boot.
//
// Drives the real _loadQueueFromDisk, sliced out of the agent, over real files.
//
// Run: npx vitest run test/upload-queue-empty.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const block = sliceBlock(readSource(AGENT_INDEX), 'function _loadQueueFromDisk() {', '\n}\n');

let dir, QUEUE_FILE, warn, log;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-queue-'));
  QUEUE_FILE = path.join(dir, 'logsync.queue.json');
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

// The loader's own text, with just the module-level names it reads supplied.
function load() {
  // eslint-disable-next-line no-new-func
  const run = new Function('fs', 'path', 'QUEUE_FILE', 'QUEUE_HARD_READ_LIMIT', 'QUEUE_MAX_BYTES', '_enforceQueueByteCap', '_entryBytes',
    'let _uploadQueue = [];\n' + block + '\n_loadQueueFromDisk();\nreturn _uploadQueue;');
  return run(fs, path, QUEUE_FILE, 512 * 1024 * 1024, 128 * 1024 * 1024, () => {}, (e) => JSON.stringify(e).length);
}
const asides = () => fs.readdirSync(dir).filter(f => f.includes('.corrupt-'));
const warned = () => warn.mock.calls.map(c => c.join(' ')).join('\n');

describe('an empty queue file', () => {
  it('is an empty queue: no warning, nothing moved aside, file left in place', () => {
    fs.writeFileSync(QUEUE_FILE, '');
    expect(load()).toEqual([]);
    expect(warned()).toBe('');
    expect(asides()).toEqual([]);
    expect(fs.existsSync(QUEUE_FILE)).toBe(true);
  });

  it('a whitespace-only file is the same', () => {
    fs.writeFileSync(QUEUE_FILE, '  \r\n\n \t\n');
    expect(load()).toEqual([]);
    expect(warned()).toBe('');
    expect(asides()).toEqual([]);
  });
});

describe('the loader still does its job', () => {
  it('loads NDJSON entries', () => {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify({ kind: 'chat', id: 1 }) + '\n' + JSON.stringify({ kind: 'tells', id: 2 }) + '\n');
    expect(load().map(e => e.id)).toEqual([1, 2]);
    expect(warned()).toBe('');
  });

  it('loads the legacy single-object form', () => {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify({ pending: [{ kind: 'chat', id: 7 }] }, null, 2));
    expect(load().map(e => e.id)).toEqual([7]);
    expect(asides()).toEqual([]);
  });

  it('still moves genuinely corrupt content aside, with the warning', () => {
    fs.writeFileSync(QUEUE_FILE, '{"pending": [ {"kind": "ch');
    expect(load()).toEqual([]);
    expect(asides()).toHaveLength(1);
    expect(warned()).toMatch(/queue file unreadable/);
    expect(fs.existsSync(QUEUE_FILE)).toBe(false);
  });
});
