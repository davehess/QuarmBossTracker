// UI Studio restore writes only the settings files UI Studio backs up (plain .ini names).
// A snapshot comes back from the server, so the restore handler checks every name with
// apps/mimic/uiRestoreGuard.js before it writes (and the editor/layout paths get the same filter).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { ROOT, stripJs, sliceBlock } from './_source-slice.js';

const require = createRequire(import.meta.url);
const { restorableName, filterRestorable, MAX_NAME_LENGTH } = require('../apps/mimic/uiRestoreGuard.js');
const main = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'main.js'), 'utf8');

describe('restorableName — the file names UI Studio itself backs up', () => {
  it.each([
    'eqclient.ini', 'zeal.ini', 'UI_Aldenmar_pq.proj.ini', 'Aldenmar_pq.proj.ini',
    'Sock_Aldenmar_pq.proj.ini', 'Socials_Aldenmar_pq.proj.ini', 'Aldenmar_spellsets.ini',
    'Aldenmar_pq.proj_spellsets.ini', 'UI_Aldenmar_pq.proj.INI',
  ])('allows %s', (n) => expect(restorableName(n)).toBe(true));

  it.each([
    ['dll', 'evil.dll'], ['exe', 'eqgame.exe'], ['bat', 'run.bat'], ['cmd', 'x.cmd'], ['ps1', 'x.ps1'],
    ['no extension', 'eqclient'], ['ini as a middle part', 'x.ini.exe'], ['ini with trailing dot', 'x.ini.'],
    ['trailing space', 'x.ini '], ['bak', 'UI_A_pq.proj.ini.bak-1'],
    ['forward slash', 'sub/UI_A.ini'], ['backslash', 'sub\\UI_A.ini'],
    ['parent dir', '../UI_A.ini'], ['parent dir backslash', '..\\UI_A.ini'], ['dots inside', 'a..b.ini'],
    ['drive letter', 'C:UI_A.ini'], ['drive path', 'C:\\x.ini'], ['stream', 'UI_A.ini:evil.exe'],
    ['leading dot', '.hidden.ini'], ['bare extension', '.ini'], ['empty', ''],
    ['device name', 'con.ini'], ['device name caps', 'NUL.INI'], ['com port', 'com1.ini'],
    ['NUL byte', 'a\0.ini'], ['newline', 'a\n.ini'],
    ['overlong', 'a'.repeat(MAX_NAME_LENGTH) + '.ini'],
  ])('rejects %s', (_label, n) => expect(restorableName(n)).toBe(false));

  it('rejects non-strings', () => {
    for (const v of [null, undefined, 5, {}, [], ['a.ini']]) expect(restorableName(v)).toBe(false);
  });

  it('allows a name exactly at the length cap', () => {
    expect(restorableName('a'.repeat(MAX_NAME_LENGTH - 4) + '.ini')).toBe(true);
  });
});

describe('filterRestorable', () => {
  it('keeps .ini text and reports the rest by name', () => {
    const r = filterRestorable({ 'eqclient.ini': 'a', 'x.dll': 'MZ', '../y.ini': 'b', 'z.ini': 5 });
    expect(r.files).toEqual({ 'eqclient.ini': 'a' });
    expect(r.skipped.sort()).toEqual(['../y.ini', 'x.dll', 'z.ini']);
  });
  it('treats a missing or non-object map as empty', () => {
    expect(filterRestorable(null)).toEqual({ files: {}, skipped: [] });
    expect(filterRestorable('x')).toEqual({ files: {}, skipped: [] });
  });
});

describe('the restore paths use the guard', () => {
  const restore = stripJs(sliceBlock(main, "ipcMain.handle('ui-studio-restore'", '// Browse-for-folder.'));
  const getSnap = stripJs(sliceBlock(main, "ipcMain.handle('ui-studio-get-snapshot'", '// Restore: download a snapshot'));
  const writeBundle = stripJs(sliceBlock(main, "ipcMain.handle('ui-studio-write-bundle'", "ipcMain.handle('open-ui-studio'"));
  const writePages = stripJs(sliceBlock(main, "ipcMain.handle('ui-studio-write-pages'", "ipcMain.handle('ui-studio-inspect-socials'"));

  it('ui-studio-restore checks each name before it writes, and reports what it skipped', () => {
    const check = restore.indexOf('restorableName(name)');
    const write = restore.indexOf('_backupAndWriteFile(');
    expect(check).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(check);
    expect(restore).toMatch(/skipped\.push\(/);
    expect(restore).toMatch(/skipped_count:/);
    expect(restore).toMatch(/not UI settings/);
    // the old basename-only filter is gone
    expect(restore).not.toMatch(/path\.basename\(name\)/);
  });
  it('the snapshot handed to the editor and layout import is filtered', () => {
    expect(getSnap).toMatch(/filterRestorable\(snap\.files\)/);
    expect(getSnap).toMatch(/files: kept\.files/);
    expect(getSnap).not.toMatch(/files: snap\.files/);
  });
  it('write-bundle and write-pages use the same check', () => {
    expect(writeBundle).toMatch(/if \(!restorableName\(name\)\) continue;/);
    expect(writePages).toMatch(/restorableName\(String\(e\.file\)\)/);
  });
  it('main.js requires the guard', () => {
    expect(stripJs(main)).toMatch(/require\('\.\/uiRestoreGuard'\)/);
  });
});
