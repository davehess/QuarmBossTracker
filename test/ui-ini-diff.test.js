// test/ui-ini-diff.test.js — UI Studio's "Changes since previous version" (the guild lead, 2026-11-11):
// "we should always retain previous and show diff to previous not including what we have changed in the UI studio and
// then list all of the changes not just the ones that we've made in the UI studio."
//
// Three layers, all running the shipped code: iniDiff.js (the key-by-key diff, redaction, who-changed-it labelling),
// localVersions.js (the kept copies, their source + write records) and main.js / ui-studio.html / preload.js wiring
// (comments stripped first: a comment can quote any of this).
//
// Run: npx vitest run test/ui-ini-diff.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, readSource, sliceBlock, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const d = require('../apps/mimic/iniDiff.js');
const lv = require('../apps/mimic/localVersions.js');

const find = (diff, file, section, key) => {
  const f = diff.files.find(x => x.file === file);
  const s = f && f.sections.find(x => x.section === section);
  return s && s.changes.find(x => x.key === key);
};

describe('diffBundles', () => {
  const prev = { 'UI_Aldenmar_pq.proj.ini': '[MainWindow]\r\nXPos=10\r\nYPos=20\r\n[Gone]\r\nA=1\r\n', 'zeal.ini': '[Zeal]\nFoo=1\n' };
  const cur = { 'UI_Aldenmar_pq.proj.ini': '[MainWindow]\r\nXPos=15\r\nWidth=300\r\n[New]\r\nB=2\r\n', 'eqclient.ini': '[Defaults]\nX=1\n' };
  const r = d.diffBundles(prev, cur);

  it('lists added, removed and changed keys with old and new values', () => {
    expect(find(r, 'UI_Aldenmar_pq.proj.ini', 'MainWindow', 'XPos')).toMatchObject({ kind: 'changed', old: '10', new: '15' });
    expect(find(r, 'UI_Aldenmar_pq.proj.ini', 'MainWindow', 'YPos')).toMatchObject({ kind: 'removed', old: '20', new: null });
    expect(find(r, 'UI_Aldenmar_pq.proj.ini', 'MainWindow', 'Width')).toMatchObject({ kind: 'added', old: null, new: '300' });
    expect(find(r, 'UI_Aldenmar_pq.proj.ini', 'Gone', 'A').kind).toBe('removed');
    expect(find(r, 'UI_Aldenmar_pq.proj.ini', 'New', 'B').kind).toBe('added');
  });
  it('reports files that appeared or went, with every key in them', () => {
    expect(r.files.find(f => f.file === 'eqclient.ini').status).toBe('added');
    expect(find(r, 'eqclient.ini', 'Defaults', 'X').kind).toBe('added');
    expect(r.files.find(f => f.file === 'zeal.ini').status).toBe('removed');
    expect(find(r, 'zeal.ini', 'Zeal', 'Foo').kind).toBe('removed');
    expect(r.total).toBe(7);
    expect(r.filesChanged).toBe(3);
  });
  it('ignores ordering, line endings, blank lines, case of names and whitespace around a value', () => {
    const a = { 'x.ini': '[A]\nOne=1\nTwo=2\n\n[B]\nThree=3\n' };
    const b = { 'X.INI': '[b]\r\nthree = 3  \r\n\r\n[a]\r\nTWO=2\r\nOne=1\r\n' };
    const out = d.diffBundles(a, b);
    expect(out.total).toBe(0);
    expect(out.files).toEqual([]);
  });
  it('still sees a real value change that is only a different number', () => {
    expect(d.diffBundles({ 'x.ini': '[A]\nK=1\n' }, { 'x.ini': '[A]\nK=10\n' }).total).toBe(1);
  });
  it('never shows a password or a chat channel auto-join, on either side', () => {
    const out = d.diffBundles(
      { 'eqclient.ini': '[Defaults]\nChannelAutoJoin0=hunt,s3cret\nLoginPassword=hunter2\nOk=1\n' },
      { 'eqclient.ini': '[Defaults]\nChannelAutoJoin0=hunt,n3w\nLoginPassword=hunter3\nOk=2\n' });
    expect(JSON.stringify(out)).not.toMatch(/s3cret|n3w|hunter/);
    expect(find(out, 'eqclient.ini', 'Defaults', 'ChannelAutoJoin0')).toMatchObject({ old: '(hidden)', new: '(hidden)', hidden: true });
    expect(find(out, 'eqclient.ini', 'Defaults', 'LoginPassword').hidden).toBe(true);
    expect(find(out, 'eqclient.ini', 'Defaults', 'Ok')).toMatchObject({ old: '1', new: '2' });
  });
  it('does not choke on a key called __proto__', () => {
    const out = d.diffBundles({ 'x.ini': '[A]\n__proto__=1\n' }, { 'x.ini': '[A]\n__proto__=2\n' });
    expect(out.total).toBe(1);
    expect(Object.keys(d.changedKeys({ 'x.ini': '[A]\n' }, { 'x.ini': '[A]\n__proto__=2\n' }))).toEqual(['x.ini']);
  });
});

describe('who changed it', () => {
  const before = { 'u.ini': '[W]\nXPos=1\nYPos=2\nZ=3\n' };
  const afterUi = { 'u.ini': '[W]\nXPos=100\nYPos=2\nZ=3\n' };           // UI Studio moved XPos
  const rec = { source: 'ui-studio', at: 1, keys: d.changedKeys(before, afterUi) };

  it('changedKeys records which keys a write changed, as hashes and never values', () => {
    expect(Object.keys(rec.keys['u.ini'].w)).toEqual(['xpos']);
    expect(JSON.stringify(rec)).not.toMatch(/"100"/);
    expect(d.countKeys(rec.keys)).toBe(1);
  });
  it('labels a key Mimic wrote UI Studio, and the rest as the game', () => {
    const game = { 'u.ini': '[W]\nXPos=100\nYPos=50\nZ=3\n' };         // the game then moved YPos
    const out = d.diffBundles(before, game, { origin: d.makeOrigin([rec], true) });
    expect(find(out, 'u.ini', 'W', 'XPos').origin).toBe('ui-studio');
    expect(find(out, 'u.ini', 'W', 'YPos').origin).toBe('game');
    expect(out.byOrigin).toEqual({ 'ui-studio': 1, game: 1 });
  });
  it('a key UI Studio wrote and the game then changed again is the game\'s', () => {
    const game = { 'u.ini': '[W]\nXPos=777\nYPos=2\nZ=3\n' };
    expect(find(d.diffBundles(before, game, { origin: d.makeOrigin([rec], true) }), 'u.ini', 'W', 'XPos').origin).toBe('game');
  });
  it('the newest record that covers a key decides (a restore after a save)', () => {
    const restoreRec = { source: 'restore', at: 2, keys: d.changedKeys(afterUi, { 'u.ini': '[W]\nXPos=5\nYPos=2\nZ=3\n' }) };
    const out = d.diffBundles(before, { 'u.ini': '[W]\nXPos=5\nYPos=2\nZ=3\n' }, { origin: d.makeOrigin([rec, restoreRec], true) });
    expect(find(out, 'u.ini', 'W', 'XPos').origin).toBe('restore');
  });
  it('without a full set of records an unclaimed change is unknown, not the game\'s', () => {
    const out = d.diffBundles(before, { 'u.ini': '[W]\nXPos=1\nYPos=50\nZ=3\n' }, { origin: d.makeOrigin([], false) });
    expect(find(out, 'u.ini', 'W', 'YPos').origin).toBe('unknown');
  });
  it('a password changed by Mimic is labelled but its value stays out of the record', () => {
    const k = d.changedKeys({ 'e.ini': '[D]\nLoginPassword=aaaa\n' }, { 'e.ini': '[D]\nLoginPassword=bbbb\n' });
    expect(JSON.stringify(k)).not.toMatch(/aaaa|bbbb/);
  });
});

describe('localVersions: source, write records, keep 10', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wp-lvd-'));
  const F = (v) => ({ 'UI_Aldenmar_pq.proj.ini': '[W]\nXPos=' + v + '\n' });

  it('keeps ten and the metadata file never shows up as a character file', () => {
    expect(lv.KEEP_VERSIONS).toBe(10);
    const root = tmp();
    for (let i = 0; i < 12; i++) lv.saveVersion(root, 'Aldenmar', F(i), new Date(2026, 10, 11, 5, i, 0), undefined, { source: 'game' });
    const list = lv.listVersions(root, 'Aldenmar');
    expect(list).toHaveLength(10);
    expect(list[0]).toMatchObject({ file_count: 1, source: 'game' });
    expect(Object.keys(lv.readVersion(root, 'Aldenmar', list[0].id))).toEqual(['UI_Aldenmar_pq.proj.ini']);
  });
  it('a version from before records existed lists with source null and has no meta', () => {
    const root = tmp();
    const dir = path.join(root, 'aldenmar', '20261101-120000');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'UI_Aldenmar_pq.proj.ini'), 'x');
    expect(lv.listVersions(root, 'Aldenmar')[0]).toMatchObject({ source: null, file_count: 1 });
    expect(lv.readMeta(root, 'Aldenmar', 'local-20261101-120000')).toBeNull();
  });
  it('snapshot says when nothing changed, and a write is noted on that same version', () => {
    const root = tmp();
    const a = lv.snapshot(root, 'Aldenmar', F(1), new Date(2026, 10, 11, 5, 0, 0), undefined, { source: 'ui-studio' });
    expect(a.created).toBe(true);
    const b = lv.snapshot(root, 'Aldenmar', F(1), new Date(2026, 10, 11, 5, 5, 0), undefined, { source: 'restore' });
    expect(b).toEqual({ id: a.id, created: false });
    expect(lv.noteWrites(root, 'Aldenmar', a.id, { source: 'ui-studio', at: 1, keys: { x: 1 } })).toBe(true);
    expect(lv.noteWrites(root, 'Aldenmar', a.id, { source: 'layout', at: 2, keys: {} })).toBe(true);
    const m = lv.readMeta(root, 'Aldenmar', a.id);
    expect(m.source).toBe('ui-studio');
    expect(m.writes.map(w => w.source)).toEqual(['ui-studio', 'layout']);
  });
  it('rejects a source that is not a short word and a character that is not letters', () => {
    const root = tmp();
    const r = lv.snapshot(root, 'Aldenmar', F(1), undefined, undefined, { source: '../../x' });
    expect(lv.readMeta(root, 'Aldenmar', r.id).source).toBeNull();
    expect(lv.noteWrites(root, '../x', r.id, { source: 'ui-studio' })).toBe(false);
  });
  it('end to end: a UI Studio write, then the game, then the diff against the first version', () => {
    const root = tmp();
    const start = { 'u.ini': '[W]\nXPos=1\nYPos=2\n' };
    const uiAfter = { 'u.ini': '[W]\nXPos=9\nYPos=2\n' };
    const snap = lv.snapshot(root, 'Aldenmar', start, new Date(2026, 10, 11, 5, 0, 0), undefined, { source: 'ui-studio' });
    lv.noteWrites(root, 'Aldenmar', snap.id, { source: 'ui-studio', at: 1, keys: d.changedKeys(start, uiAfter) });
    const nowFiles = { 'u.ini': '[W]\nXPos=9\nYPos=77\n' };               // the game moved YPos while playing
    const list = lv.listVersions(root, 'Aldenmar');
    const records = []; let complete = true;
    for (let i = list.findIndex(v => v.id === snap.id); i >= 0; i--) {
      const m = lv.readMeta(root, 'Aldenmar', list[i].id);
      if (!m) { complete = false; continue; }
      records.push(...m.writes);
    }
    expect(complete).toBe(true);
    const out = d.diffBundles(lv.readVersion(root, 'Aldenmar', snap.id), nowFiles, { origin: d.makeOrigin(records, complete) });
    expect(find(out, 'u.ini', 'W', 'XPos').origin).toBe('ui-studio');
    expect(find(out, 'u.ini', 'W', 'YPos').origin).toBe('game');
  });
});

describe('wiring: every Mimic write over a character\'s files keeps the previous version first', () => {
  const main = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')));
  const preload = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js')));
  const studio = readSource(path.join(ROOT, 'apps', 'mimic', 'ui-studio.html'));
  const code = stripJs(studio);

  it('the key-edit save, the deferred save and the pages writer', () => {
    expect(sliceBlock(main, "ipcMain.handle('ui-studio-write-edits'", "ipcMain.handle('ui-studio-write-bundle'"))
      .toMatch(/_uiVersioned\(d, who, 'ui-studio', \(\) => _applyUiKeyEdits\(/);
    expect(sliceBlock(main, 'function _applyDeferredEntry(entry) {', '\n}\n'))
      .toMatch(/_uiVersioned\(entry\.eqDir, entry\.character, 'ui-studio', \(\) => _applyUiKeyEdits\(/);
    const pages = sliceBlock(main, "ipcMain.handle('ui-studio-write-pages'", "ipcMain.handle('ui-studio-inspect-socials'");
    expect(pages.indexOf("_uiVersionBefore(d,")).toBeGreaterThan(-1);
    expect(pages.indexOf('_uiVersionBefore(d,')).toBeLessThan(pages.indexOf('fs.writeFileSync(fp, next)'));
    expect(pages.indexOf('_uiVersionAfter(ver)')).toBeGreaterThan(pages.indexOf('fs.writeFileSync(fp, next)'));
  });
  it('write-bundle, layout switches (now and after logout), restores of every kind', () => {
    const wb = sliceBlock(main, "ipcMain.handle('ui-studio-write-bundle'", "ipcMain.handle('open-ui-studio'");
    expect(wb.indexOf('_uiVersionBefore(')).toBeLessThan(wb.indexOf('_backupAndWriteFile('));
    expect(wb).toMatch(/_uiVersionAfter\(ver\)/);
    expect(sliceBlock(main, 'function _applyDeferredLayout(entry) {', '\n}\n')).toMatch(/_uiVersioned\(entry\.eqDir, entry\.character, 'layout'/);
    expect(sliceBlock(main, "ipcMain.handle('ui-studio-layout-switch'", "ipcMain.handle('ui-studio-layout-cancel-switch'")).toMatch(/_uiVersioned\(a\.d, a\.c, 'layout'/);
    const wr = sliceBlock(main, 'function _uiWriteRestore(entry, backupTag) {', '\n}\n');
    expect(wr.indexOf("_uiVersionBefore(entry.eqDir, entry.character, 'restore')")).toBeGreaterThan(-1);
    expect(wr.indexOf('_uiVersionBefore(')).toBeLessThan(wr.indexOf('_backupAndWriteFile('));
    expect(wr).toMatch(/_uiVersionAfter\(ver\)/);
    const cloud = sliceBlock(main, "ipcMain.handle('ui-studio-restore'", '\n});\n');
    expect(cloud.indexOf("_uiVersionBefore(eqDir, character, 'restore')")).toBeGreaterThan(-1);
    expect(cloud.indexOf('_uiVersionBefore(')).toBeLessThan(cloud.indexOf('_backupAndWriteFile('));
    expect(cloud).toMatch(/_uiVersionAfter\(ver\)/);
  });
  it('after a camp the files as the game left them are kept, labelled game', () => {
    const a = sliceBlock(main, 'async function _uiAutoBackup(character) {', '\n}\n');
    expect(a).toMatch(/localVersions\.saveVersion\([\s\S]*?\{ source: 'game' \}\)/);
  });
  it('the save sends the character so a shared-file-only save is still kept', () => {
    expect(code).toContain("{ character: STATE.character, backupTag: deferred ? 'eq' : null }");
  });
  it('the Changes panel talks to two IPCs that read from disk and localVersions, bridged by the preload', () => {
    expect(preload).toContain("ipcRenderer.invoke('ui-studio-versions'");
    expect(preload).toContain("ipcRenderer.invoke('ui-studio-diff'");
    const v = sliceBlock(main, "ipcMain.handle('ui-studio-diff'", '\n});\n');
    expect(v).toMatch(/iniDiff\.diffBundles\(prev, _readUiBundle\(d, c\)/);
    expect(v).toMatch(/localVersions\.readMeta\(/);
    expect(v).toMatch(/isLocalId\(id\)/);
    expect(code).toContain('window.mimic.uiStudioDiff(STATE.character, STATE.eqDir, id)');
    expect(code).toContain('window.mimic.uiStudioVersions(STATE.character, STATE.eqDir)');
    expect(studio).toContain('id="chHideMine"');
  });
  it('the panel script parses and uses theme tokens, not hex', () => {
    const panel = sliceBlock(studio, '<div id="chModal"', '</div>\n  </div>\n').replace(/<!--[\s\S]*?-->/g, '');
    expect(panel).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const scripts = [...studio.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-new-func
    for (const s of scripts) expect(() => new Function(s)).not.toThrow();
  });
});
