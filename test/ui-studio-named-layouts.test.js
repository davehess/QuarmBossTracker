// test/ui-studio-named-layouts.test.js — several NAMED UI layouts per character in UI Studio.
//
// The guild lead, 2026-10-14: "we should allow for multiple layouts for characters screens so we can
// have alternative modes, and be able to back up both. Name them as well."
//
// A layout is a saved copy of the character's UI_*.ini. These tests run the shipped code:
//   - apps/mimic/uiLayouts.js is required and pointed at a temp "EQ folder" of INVENTED ini files;
//   - the real _readUiBundle / _backupAndWriteFile / queue / switch / capture handlers are sliced out
//     of main.js and evaluated against fakes for Electron.
// No real ini is read or committed.
//
// Run: npx vitest run test/ui-studio-named-layouts.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, readSource, sliceBlock } from './_source-slice.js';

const require = createRequire(import.meta.url);
const layouts = require('../apps/mimic/uiLayouts.js');

const main = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));

// ── Real helpers from main.js, run against the real file system ─────────────
const bundleSrc = sliceBlock(main, 'const UI_STUDIO_GLOBAL', '  return files;\n}\n');
const { _readUiBundle } = new Function('fs', 'path', bundleSrc + '\nreturn { _readUiBundle };')(fs, path);
const { _backupAndWriteFile } = new Function('fs', 'path',
  sliceBlock(main, 'function _backupAndWriteFile(', '\n  return bakPath;\n}\n') + '\nreturn { _backupAndWriteFile };')(fs, path);

// ── Invented fixtures ───────────────────────────────────────────────────────
const CHAR = 'Aldenmar';
const UI_FILE = `UI_${CHAR}_pq.proj.ini`;
const RAID_FULL = '[ChatManager]\r\nNumWindows=4\r\n[ChatWindow1]\r\nXPos1920x1080=12\r\nYPos1920x1080=700\r\n';
const MINIMAL   = '[ChatManager]\r\nNumWindows=1\r\n[ChatWindow1]\r\nXPos1920x1080=0\r\nYPos1920x1080=1000\r\n';
const SOCIALS   = '[Socials]\r\nPage1Button1Name=Hail\r\n';

let eqDir, storeDir, store;
const ls = d => fs.readdirSync(d).sort();
const baks = (suffix) => ls(eqDir).filter(f => f.startsWith(UI_FILE + '.' + suffix + '-'));

function newStore(extra) {
  return layouts.createLayoutStore({
    dir: storeDir, readBundle: _readUiBundle, backupAndWrite: _backupAndWriteFile,
    ...extra,
  });
}
function setDisk(text) { fs.writeFileSync(path.join(eqDir, UI_FILE), text, 'utf8'); }
function disk() { return fs.readFileSync(path.join(eqDir, UI_FILE), 'utf8'); }

beforeEach(() => {
  eqDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-eq-'));
  storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-layouts-'));
  fs.writeFileSync(path.join(eqDir, `${CHAR}_pq.proj.ini`), SOCIALS, 'utf8');
  fs.writeFileSync(path.join(eqDir, 'eqclient.ini'), '[Defaults]\r\nWindowedMode=FALSE\r\n', 'utf8');
  setDisk(RAID_FULL);
  store = newStore();
});
afterEach(() => {
  fs.rmSync(eqDir, { recursive: true, force: true });
  fs.rmSync(storeDir, { recursive: true, force: true });
});

describe('save, rename, delete', () => {
  it('saves the character\'s current UI file under a name, and only the UI file', () => {
    const r = store.save(CHAR, eqDir, 'Raid (full chat)');
    expect(r.ok).toBe(true);
    const lay = store.get(CHAR, r.layout.id);
    expect(lay.name).toBe('Raid (full chat)');
    expect(Object.keys(lay.files)).toEqual([UI_FILE]);          // not the socials, not eqclient.ini
    expect(lay.files[UI_FILE]).toBe(RAID_FULL);
  });

  it('keeps several layouts per character, each with its own text', () => {
    store.save(CHAR, eqDir, 'Raid (full chat)');
    setDisk(MINIMAL);
    store.save(CHAR, eqDir, 'Minimal chat + Mimic overlay');
    const l = store.list(CHAR, eqDir);
    expect(l.layouts.map(x => x.name)).toEqual(['Minimal chat + Mimic overlay', 'Raid (full chat)']);
    expect(l.layouts.filter(x => x.live).map(x => x.name)).toEqual(['Minimal chat + Mimic overlay']);
  });

  it('refuses a second layout with the same name (any case) and an empty name', () => {
    store.save(CHAR, eqDir, 'Raid');
    expect(store.save(CHAR, eqDir, 'raid')).toMatchObject({ ok: false, code: 'exists' });
    expect(store.save(CHAR, eqDir, '  ')).toMatchObject({ ok: false, code: 'name' });
    expect(store.list(CHAR, eqDir).layouts).toHaveLength(1);
  });

  it('renames in place, keeping the files, and refuses a clash', () => {
    const a = store.save(CHAR, eqDir, 'Raid');
    setDisk(MINIMAL);
    store.save(CHAR, eqDir, 'Quiet');
    expect(store.rename(CHAR, a.layout.id, 'Quiet')).toMatchObject({ ok: false, code: 'exists' });
    expect(store.rename(CHAR, a.layout.id, 'Raid night')).toMatchObject({ ok: true });
    const lay = store.get(CHAR, a.layout.id);
    expect(lay.name).toBe('Raid night');
    expect(lay.files[UI_FILE]).toBe(RAID_FULL);
  });

  it('deletes one layout and forgets it was live', () => {
    const a = store.save(CHAR, eqDir, 'Raid');
    expect(store.remove(CHAR, a.layout.id).ok).toBe(true);
    expect(store.get(CHAR, a.layout.id)).toBeNull();
    expect(store.list(CHAR, eqDir).layouts).toEqual([]);
    expect(store.remove(CHAR, a.layout.id)).toMatchObject({ ok: false, code: 'notfound' });
  });

  it('Update re-saves the picked layout from the current files, keeping its name', () => {
    const a = store.save(CHAR, eqDir, 'Raid');
    setDisk(RAID_FULL + '[Extra]\r\nk=1\r\n');
    expect(store.list(CHAR, eqDir).layouts[0]).toMatchObject({ live: true, modified: true });
    expect(store.save(CHAR, eqDir, undefined, { id: a.layout.id }).ok).toBe(true);
    expect(store.get(CHAR, a.layout.id).files[UI_FILE]).toContain('[Extra]');
    expect(store.list(CHAR, eqDir).layouts[0]).toMatchObject({ name: 'Raid', live: true, modified: false });
  });
});

describe('the cap', () => {
  it('holds at ten per character, but an update or another character still works', () => {
    for (let i = 1; i <= layouts.LAYOUT_CAP; i++) expect(store.save(CHAR, eqDir, 'Layout ' + i).ok).toBe(true);
    expect(store.save(CHAR, eqDir, 'One too many')).toMatchObject({ ok: false, code: 'cap' });
    expect(store.list(CHAR, eqDir).layouts).toHaveLength(10);
    const first = store.list(CHAR, eqDir).layouts.find(x => x.name === 'Layout 1');
    expect(store.save(CHAR, eqDir, undefined, { id: first.id }).ok).toBe(true);   // updating is not adding
    fs.writeFileSync(path.join(eqDir, 'UI_Brackwyn_pq.proj.ini'), MINIMAL, 'utf8');
    expect(store.save('Brackwyn', eqDir, 'Layout 1').ok).toBe(true);              // its own ten
  });
});

describe('the name is a label, never a path', () => {
  it('strips path characters, control characters and length', () => {
    expect(layouts.cleanLayoutName('..\\..\\Windows/System32:evil*?"<>|')).not.toMatch(/[\\/:*?"<>|]/);
    expect(layouts.cleanLayoutName('a\u0000b\nc\td')).toBe('a b c d');
    expect(layouts.cleanLayoutName('x'.repeat(200))).toHaveLength(layouts.NAME_MAX);
    expect(layouts.cleanLayoutName('///')).toBe('');
    expect(layouts.cleanLayoutName('  Raid   (full   chat) ')).toBe('Raid (full chat)');
  });

  it('a hostile name changes nothing about where files go', () => {
    const r = store.save(CHAR, eqDir, '../../../Windows\\evil.ini');
    expect(r.ok).toBe(true);
    expect(ls(storeDir)).toEqual(['layouts-aldenmar.json']);        // the store file is named by the character alone
    setDisk(MINIMAL);
    expect(store.switchTo(CHAR, eqDir, r.layout.id, { eqRunning: false }).ok).toBe(true);
    expect(ls(eqDir).filter(f => !/\.bak-\d+$/.test(f))).toEqual(['Aldenmar_pq.proj.ini', UI_FILE, 'eqclient.ini']);
    expect(fs.readdirSync(path.dirname(eqDir)).includes('evil.ini')).toBe(false);
  });

  it('an ini name inside a stored layout is written only if it is a bare UI_<file>.ini', () => {
    const id = store.save(CHAR, eqDir, 'Raid').layout.id;
    const fp = path.join(storeDir, 'layouts-aldenmar.json');
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    data.layouts[0].files = {
      '../evil.ini': 'x', [`${CHAR}_pq.proj.ini`]: 'socials overwrite', 'eqclient.ini': 'x',
      'UI_Aldenmar_pq.proj.ini': MINIMAL, 'sub/UI_Aldenmar_x.ini': 'x',
    };
    fs.writeFileSync(fp, JSON.stringify(data));
    const r = store.apply(CHAR, eqDir, id, null);
    expect(r.written).toEqual([UI_FILE]);
    expect(fs.readFileSync(path.join(eqDir, `${CHAR}_pq.proj.ini`), 'utf8')).toBe(SOCIALS);
    expect(fs.existsSync(path.join(path.dirname(eqDir), 'evil.ini'))).toBe(false);
  });

  it('a character name that is not letters is refused', () => {
    expect(store.save('../x', eqDir, 'Raid')).toMatchObject({ ok: false, code: 'character' });
    expect(store.list('a/b', eqDir).ok).toBe(false);
  });
});

describe('switching', () => {
  it('logged out: writes the layout, keeps a .bak of what it replaced, leaves other files alone', () => {
    const raid = store.save(CHAR, eqDir, 'Raid (full chat)').layout.id;
    setDisk(MINIMAL);
    store.save(CHAR, eqDir, 'Minimal');
    const r = store.switchTo(CHAR, eqDir, raid, { eqRunning: false });
    expect(r).toMatchObject({ ok: true, applied: true, written: [UI_FILE] });
    expect(disk()).toBe(RAID_FULL);
    const bak = baks('bak');
    expect(bak).toHaveLength(1);
    expect(fs.readFileSync(path.join(eqDir, bak[0]), 'utf8')).toBe(MINIMAL);
    expect(fs.readFileSync(path.join(eqDir, `${CHAR}_pq.proj.ini`), 'utf8')).toBe(SOCIALS);
    expect(store.list(CHAR, eqDir).layouts.find(x => x.live).name).toBe('Raid (full chat)');
  });

  it('EQ running: writes nothing and hands the switch to the queue', () => {
    const raid = store.save(CHAR, eqDir, 'Raid').layout.id;
    setDisk(MINIMAL);
    store.save(CHAR, eqDir, 'Quiet');                          // the disk is "Quiet" now
    const queued = [];
    const r = store.switchTo(CHAR, eqDir, raid, { eqRunning: true, queue: e => queued.push(e) });
    expect(r).toMatchObject({ ok: true, queued: true, name: 'Raid' });
    expect(disk()).toBe(MINIMAL);                              // untouched
    expect(ls(eqDir).some(f => f.includes('.bak'))).toBe(false);
    expect(queued).toEqual([{ kind: 'layout', character: CHAR, eqDir, layoutId: raid, layoutName: 'Raid' }]);
    expect(store.list(CHAR, eqDir).layouts.find(x => x.id === raid).live).toBe(false);   // not live until it lands
  });

  it('a layout that was deleted cannot be switched to', () => {
    const id = store.save(CHAR, eqDir, 'Raid').layout.id;
    store.remove(CHAR, id);
    expect(store.switchTo(CHAR, eqDir, id, { eqRunning: false })).toMatchObject({ ok: false, code: 'notfound' });
  });
});

// The real main.js handler: decides "running or not", queues, persists the queue.
function mainHarness({ zealActive = false, eqUp = false } = {}) {
  const block = sliceBlock(main, 'function _queueUiLayoutSwitch(entry) {',
    "ipcMain.handle('ui-studio-layout-cancel-switch'");
  const handlers = {};
  const saved = [];
  const env = new Function('ipcMain', '_uiCharActiveInZeal', '_isEqRunning', '_uiLayoutStore', '_saveUiDeferred',
    'let _uiDeferred = [];\n' + block.replace("ipcMain.handle('ui-studio-layout-cancel-switch'", '') +
    '\nreturn { get deferred() { return _uiDeferred; } };')(
    { handle: (name, fn) => { handlers[name] = fn; } },
    () => zealActive, async () => eqUp, () => store, () => saved.push(1));
  return { handlers, env, saved };
}

describe('the Switch handler in main.js', () => {
  it('character in game (Zeal pipe): queues, writes nothing', async () => {
    const raid = store.save(CHAR, eqDir, 'Raid').layout.id;
    setDisk(MINIMAL);
    const h = mainHarness({ zealActive: true });
    const r = await h.handlers['ui-studio-layout-switch'](null, { character: CHAR, eqDir, id: raid });
    expect(r).toMatchObject({ ok: true, queued: true });
    expect(disk()).toBe(MINIMAL);
    expect(h.env.deferred).toHaveLength(1);
    expect(h.env.deferred[0]).toMatchObject({ kind: 'layout', character: CHAR, layoutId: raid, sawActive: true });
    expect(h.saved.length).toBe(1);                              // the queue was persisted
    const list = await h.handlers['ui-studio-layout-list'](null, CHAR, eqDir);
    expect(list.layouts.find(x => x.id === raid).pending).toBe(true);
  });

  it('EverQuest running on another character still waits; a second switch replaces the first', async () => {
    const a = store.save(CHAR, eqDir, 'Raid').layout.id;
    setDisk(MINIMAL);
    const b = store.save(CHAR, eqDir, 'Quiet').layout.id;
    const h = mainHarness({ eqUp: true });
    await h.handlers['ui-studio-layout-switch'](null, { character: CHAR, eqDir, id: a });
    await h.handlers['ui-studio-layout-switch'](null, { character: CHAR, eqDir, id: b });
    expect(h.env.deferred.map(e => e.layoutId)).toEqual([b]);
    expect(disk()).toBe(MINIMAL);
  });

  it('nothing running: applies now with a .bak', async () => {
    const raid = store.save(CHAR, eqDir, 'Raid').layout.id;
    setDisk(MINIMAL);
    const h = mainHarness();
    const r = await h.handlers['ui-studio-layout-switch'](null, { character: CHAR, eqDir, id: raid });
    expect(r).toMatchObject({ ok: true, applied: true });
    expect(disk()).toBe(RAID_FULL);
    expect(baks('bak')).toHaveLength(1);
    expect(h.env.deferred).toEqual([]);
  });

  it('deleting a layout drops its queued switch', async () => {
    const raid = store.save(CHAR, eqDir, 'Raid').layout.id;
    const h = mainHarness({ zealActive: true });
    await h.handlers['ui-studio-layout-switch'](null, { character: CHAR, eqDir, id: raid });
    await h.handlers['ui-studio-layout-delete'](null, { character: CHAR, id: raid });
    expect(h.env.deferred).toEqual([]);
  });
});

describe('after logout', () => {
  it('the queued switch is applied by the deferred watcher, replacing EQ\'s own copy as .bak-eq', () => {
    const raid = store.save(CHAR, eqDir, 'Raid').layout.id;
    setDisk(MINIMAL);                                          // EQ\'s own last save on camp
    const log = [];
    const { _applyDeferredLayout } = new Function('_uiLayoutStore', 'appendAgentLog', 'Notification',
      sliceBlock(main, 'function _applyDeferredLayout(entry) {', '\n}\n') + '\nreturn { _applyDeferredLayout };')(
      () => store, m => log.push(m), { isSupported: () => false });
    expect(_applyDeferredLayout({ kind: 'layout', character: CHAR, eqDir, layoutId: raid })).toBe(true);
    expect(disk()).toBe(RAID_FULL);
    const bak = baks('bak-eq');
    expect(bak).toHaveLength(1);
    expect(fs.readFileSync(path.join(eqDir, bak[0]), 'utf8')).toBe(MINIMAL);
    expect(store.list(CHAR, eqDir).layouts[0].live).toBe(true);
  });

  it('a queued switch whose layout is gone applies nothing', () => {
    const log = [];
    const { _applyDeferredLayout } = new Function('_uiLayoutStore', 'appendAgentLog', 'Notification',
      sliceBlock(main, 'function _applyDeferredLayout(entry) {', '\n}\n') + '\nreturn { _applyDeferredLayout };')(
      () => store, m => log.push(m), { isSupported: () => false });
    setDisk(MINIMAL);
    expect(_applyDeferredLayout({ kind: 'layout', character: CHAR, eqDir, layoutId: 'abcdef12' })).toBe(false);
    expect(disk()).toBe(MINIMAL);
    expect(log.join('')).toMatch(/not applied/);
  });

  it('Mimic restarting keeps a queued switch but still drops an old whole-file entry', () => {
    const qf = path.join(storeDir, 'pending.json');
    fs.writeFileSync(qf, JSON.stringify([
      { kind: 'layout', character: CHAR, eqDir, layoutId: 'abcdef12', layoutName: 'Raid' },
      { character: CHAR, eqDir, bundle: { [UI_FILE]: 'stale whole file' } },
      { character: CHAR, eqDir, edits: [{ file: UI_FILE, section: 'A', key: 'k', value: 1 }] },
    ]));
    const env = new Function('fs', '_uiDeferFile', '_saveUiDeferred', 'appendAgentLog',
      'let _uiDeferred = [];\n' + sliceBlock(main, 'function _loadUiDeferred() {', '\n}\n') +
      '\n_loadUiDeferred();\nreturn _uiDeferred;')(fs, () => qf, () => {}, () => {});
    expect(env.map(e => e.kind || 'edits')).toEqual(['layout', 'edits']);
  });
});

describe('each named layout is backed up with its name', () => {
  function captureHarness(posted) {
    const handlers = {};
    new Function('ipcMain', 'loadConfig', 'resolveUploadToken', '_uiLayoutStore', 'uiLayouts', '_readUiBundle',
      'screen', '_httpsJson', '_botBaseUrl', 'app', 'require',
      sliceBlock(main, "ipcMain.handle('ui-studio-capture', async (_e, params) => {", '\n});\n'))(
      { handle: (n, fn) => { handlers[n] = fn; } }, () => ({}), () => 'tok', () => store, layouts, _readUiBundle,
      { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
      async (url, opts) => { posted.push({ url, body: opts.body }); return { id: 'snap1' }; },
      () => 'https://bot.example', { getVersion: () => '0.0.0' }, require);
    return handlers['ui-studio-capture'];
  }

  it('posts the layout\'s own saved files with "Layout: <name>" as the label', async () => {
    const id = store.save(CHAR, eqDir, 'Raid (full chat)').layout.id;
    setDisk(MINIMAL);                                          // the disk has moved on since
    const posted = [];
    const r = await captureHarness(posted)(null, { character: CHAR, eqDir, layoutId: id });
    expect(r).toMatchObject({ ok: true, file_count: 1 });
    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe('https://bot.example/api/agent/ui_layout');
    expect(posted[0].body.label).toBe('Layout: Raid (full chat)');
    expect(posted[0].body.files).toEqual({ [UI_FILE]: RAID_FULL });   // saved copy, UI file only
    expect(layouts.nameFromCloudLabel(posted[0].body.label)).toBe('Raid (full chat)');
  });

  it('without a layout the backup is exactly what it was: the whole bundle, the caller\'s label', async () => {
    const posted = [];
    await captureHarness(posted)(null, { character: CHAR, eqDir, label: 'UI Studio · today' });
    expect(posted[0].body.label).toBe('UI Studio · today');
    expect(Object.keys(posted[0].body.files).sort()).toEqual([`${CHAR}_pq.proj.ini`, UI_FILE, 'eqclient.ini'].sort());
  });

  it('a layout that no longer exists uploads nothing', async () => {
    const posted = [];
    const r = await captureHarness(posted)(null, { character: CHAR, eqDir, layoutId: 'abcdef12' });
    expect(r.ok).toBe(false);
    expect(posted).toEqual([]);
  });

  it('a layout restored from a backup is stored but not marked live', () => {
    const r = store.importFiles(CHAR, 'Minimal chat + Mimic overlay', { [UI_FILE]: MINIMAL, 'eqclient.ini': 'x', [`${CHAR}_pq.proj.ini`]: SOCIALS });
    expect(r.ok).toBe(true);
    expect(Object.keys(store.get(CHAR, r.layout.id).files)).toEqual([UI_FILE]);
    expect(store.list(CHAR, eqDir).layouts[0].live).toBe(false);
    expect(store.importFiles(CHAR, 'Minimal chat + Mimic overlay', { [UI_FILE]: MINIMAL })).toMatchObject({ ok: false, code: 'exists' });
    expect(store.importFiles(CHAR, 'Minimal chat + Mimic overlay', { [UI_FILE]: MINIMAL }, { replace: true }).ok).toBe(true);
  });
});
