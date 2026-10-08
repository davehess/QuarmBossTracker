// test/optin-imported-logs.test.js — old logs from ANYWHERE on the drive reach
// the opt-in backfill list.
//
// The guild lead, 2026-09-13: "can we add in a command in mimic logsync to import more
// logs, or a drag to page to allow you to add that directory or file" — and
// for the first-run flow: "ask if there are log file backups anywhere else on
// the drive that they want to add in."
//
// The opt-in scan used to read ONE folder: the folder of the first watched
// log. A second EQ install never reached the list, and there was no way to
// point it at a backup folder or a single rotated file. Now every watched
// log's folder is read, plus the persisted imported paths (folders one level
// deep + a Logs child; files by EQ log name), each file listed once, imported
// ones flagged so the tab can say so. Runs the REAL functions against a temp
// directory tree — nothing here is a text assertion.
//
// Run: npx vitest run test/optin-imported-logs.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
// ⚠ End anchors are comments or the closing line of the LAST function in a
// block, never a line inside the code under test.
const helpers = sliceBlock(src, '// ── Imported log backups ─', '// ── end imported log backups ─');
const sorting = sliceBlock(src, 'function _optinSortFn() {', '  _optinState.ignored.sort(fn);\n}');
const scan    = sliceBlock(src, 'function _scanOptInFiles() {', '\n// Separate keypress handler for the opt-in view');

function build(env = {}) {
  const harness = `
    const _optinState = { files: [], ignored: [], cursor: 0, pane: 'active', scanned: false,
                          sortMode: 'date', progress: {}, ignoredPaths: new Set(), importedPaths: [] };
    const stats = { watchedLogs: [], requestedCharacters: [] };
    let saves = 0;
    function _saveOptInState() { saves++; }
    function _loadOptInState() { _mergeImportedFromEnv(); }
  `;
  const body = harness + helpers + '\n' + sorting + '\n' + scan +
    '\nreturn { _optinState, stats, _scanOptInFiles, _addImportedLogPath, _removeImportedLogPath, _importedLogFilesIn, _mergeImportedFromEnv, IMPORTED_LOG_NAME_RX, saves: () => saves };';
  return new Function('fs', 'path', 'process', body)(fs, path, { env });
}

let root;
const mkdir = (...p) => { const d = path.join(root, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
const touch = (dir, name, bytes = 'x') => { const f = path.join(dir, name); fs.writeFileSync(f, bytes); return f; };
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-optin-')); });
afterEach(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });

describe('the opt-in scan reads every watched folder', () => {
  it('lists logs from a second EQ install, not just the first watched log\'s folder', () => {
    const a = mkdir('eqA'), b = mkdir('eqB');
    const hitya  = touch(a, 'eqlog_Hitya_pq.proj.txt');
    touch(a, 'eqlog_Rockin_pq.proj.txt.bak');
    const canopy = touch(b, 'eqlog_Canopy_pq.proj.txt');
    touch(b, 'eqlog_Utoh_pq.proj.txt');
    touch(b, 'dbg.txt');                                   // not a log
    const m = build();
    m.stats.watchedLogs.push({ logPath: hitya }, { logPath: canopy });
    m._scanOptInFiles();
    const names = m._optinState.files.map(f => f.character).sort();
    expect(names).toEqual(['Canopy', 'Hitya', 'Rockin', 'Utoh']);
    expect(m._optinState.files.find(f => f.character === 'Hitya').isWatched).toBe(true);
    expect(m._optinState.files.find(f => f.character === 'Utoh').isWatched).toBe(false);
    expect(m._optinState.files.every(f => f.imported === false)).toBe(true);
    expect(m._optinState.scanned).toBe(true);
  });

  it('with nothing to read it leaves scanned=false so the next request tries again', () => {
    const m = build();
    m._scanOptInFiles();
    expect(m._optinState.files).toHaveLength(0);
    expect(m._optinState.scanned).toBe(false);
  });
});

describe('importing a folder or a file', () => {
  it('a folder: its EQ-named logs and those in a Logs child, flagged imported', () => {
    const c = mkdir('backup');
    touch(c, 'eqlog_Malthur_pq.proj.txt.old');
    const logs = mkdir('backup', 'Logs');
    touch(logs, 'eqlog_Malthur_pq.proj.txt2');
    touch(logs, 'notes.txt');
    const m = build();
    const r = m._addImportedLogPath(c);
    expect(r).toMatchObject({ ok: true, kind: 'dir', files: 2 });
    expect(m.saves()).toBe(1);
    m._scanOptInFiles();
    const rows = m._optinState.files;
    expect(rows).toHaveLength(2);
    expect(rows.every(f => f.imported && f.character === 'Malthur' && !f.isWatched)).toBe(true);
    expect(rows.every(f => f.isAlt)).toBe(true);           // both carry a rotation suffix
  });

  it('a single file by its EQ name; anything else is refused with a reason', () => {
    const c = mkdir('loose');
    const ok = touch(c, 'eqlog_Fischer_pq.proj.txt');
    const junk = touch(c, 'combat-notes.txt');
    const m = build();
    expect(m._addImportedLogPath(ok)).toMatchObject({ ok: true, kind: 'file', files: 1 });
    expect(m._addImportedLogPath(junk).ok).toBe(false);
    expect(m._addImportedLogPath(junk).error).toMatch(/not an EverQuest log/);
    expect(m._addImportedLogPath(path.join(root, 'nope')).error).toBe('not found');
    expect(m._addImportedLogPath(mkdir('empty')).error).toMatch(/no eqlog_/);
    expect(m._addImportedLogPath('').ok).toBe(false);
    m._scanOptInFiles();
    expect(m._optinState.files.map(f => f.character)).toEqual(['Fischer']);
  });

  it('a file already listed from an EQ folder is listed once, as the EQ folder\'s', () => {
    const a = mkdir('eqA');
    const hitya = touch(a, 'eqlog_Hitya_pq.proj.txt');
    const m = build();
    m.stats.watchedLogs.push({ logPath: hitya });
    m._addImportedLogPath(a);                              // the same folder, imported by hand
    m._scanOptInFiles();
    expect(m._optinState.files).toHaveLength(1);
    expect(m._optinState.files[0]).toMatchObject({ character: 'Hitya', isWatched: true, imported: false });
  });

  it('the same path is not imported twice', () => {
    const c = mkdir('backup');
    touch(c, 'eqlog_Malthur_pq.proj.txt');
    const m = build();
    m._addImportedLogPath(c);
    m._addImportedLogPath(c.toUpperCase() === c ? c : c);   // exact
    m._addImportedLogPath(c.replace(/backup$/, 'BACKUP'));   // case-insensitive on Windows-style paths
    expect(m._optinState.importedPaths).toHaveLength(1);
  });

  it('removing an import drops its files from the list and keeps their progress', () => {
    const c = mkdir('backup');
    const f = touch(c, 'eqlog_Malthur_pq.proj.txt');
    const m = build();
    m._addImportedLogPath(c);
    m._optinState.progress[f] = { bytePos: 42, complete: false };
    m._scanOptInFiles();
    expect(m._optinState.files).toHaveLength(1);
    expect(m._removeImportedLogPath(c)).toBe(true);
    expect(m._removeImportedLogPath(c)).toBe(false);
    m._scanOptInFiles();
    expect(m._optinState.files).toHaveLength(0);
    expect(m._optinState.progress[f]).toMatchObject({ bytePos: 42 });
  });

  it('ignored paths still apply to imported files', () => {
    const c = mkdir('backup');
    const f = touch(c, 'eqlog_Malthur_pq.proj.txt');
    const m = build();
    m._addImportedLogPath(c);
    m._optinState.ignoredPaths.add(f);
    m._scanOptInFiles();
    expect(m._optinState.files).toHaveLength(0);
    expect(m._optinState.ignored.map(x => x.path)).toEqual([f]);
  });
});

describe('onboarding picks arrive through the environment, once', () => {
  it('merges WOLFPACK_IMPORTED_LOGS on the first load and never re-adds a removed path', () => {
    const c = mkdir('backup');
    touch(c, 'eqlog_Malthur_pq.proj.txt');
    const loose = touch(mkdir('loose'), 'eqlog_Fischer_pq.proj.txt');
    const m = build({ WOLFPACK_IMPORTED_LOGS: [c, loose, path.join(root, 'missing')].join(path.delimiter) });
    m._scanOptInFiles();                                   // _loadOptInState → _mergeImportedFromEnv
    expect(m._optinState.importedPaths.map(e => e.kind).sort()).toEqual(['dir', 'file']);
    expect(m._optinState.files.map(f => f.character).sort()).toEqual(['Fischer', 'Malthur']);
    m._removeImportedLogPath(c);
    m._scanOptInFiles();                                   // a second load must NOT bring it back
    expect(m._optinState.importedPaths.map(e => e.kind)).toEqual(['file']);
  });
});
