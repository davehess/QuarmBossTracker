// test/ui-studio-key-edits.test.js — UI Studio's Save changes only the keys the
// user changed, and never lays an old copy of a file over what EQ saved since.
//
// The guild lead, 2026-10-05: "A for UI Studio". Save used to rebuild WHOLE ini
// files from the copy read when Studio opened, for EVERY window (including the
// ~50 bag windows the stage hides), and wrote those texts — straight away, or
// later through the "apply after logout" queue, where it overwrote EQ's own
// on-camp save. Bag positions (and anything else EQ saved since Load) reverted.
// Now Save sends key edits [{ file, section, key, value }] for the windows the
// user changed, and main applies them to each file as it is on disk at write
// time. Two cases write every window instead (a cloud-backup restore, and a
// rescale to another resolution), and an old whole-text pending entry is
// dropped, never applied.
//
// Everything here runs the shipped code: iniKeyEdits.js is required, and the
// renderer / main.js functions are sliced out of their files and evaluated.
//
// Run: npx vitest run test/ui-studio-key-edits.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, readSource, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const { applyIniKeyEdits } = require('../apps/mimic/iniKeyEdits.js');

const studio = readSource(path.join(ROOT, 'apps', 'mimic', 'ui-studio.html'));
const main   = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));

// ── The key-level writer ────────────────────────────────────────────────────
describe('applyIniKeyEdits — change named keys, touch nothing else', () => {
  const apply = (text, edits) => applyIniKeyEdits(text, edits);
  const ed = (section, key, value) => ({ section, key, value });

  it('updates a key in place, keeping its spelling, spacing and trailing text', () => {
    const src = '[TargetWindow]\nXPos2560x1440 = 100  \nYPos2560x1440=200\n';
    const r = apply(src, [ed('TargetWindow', 'XPos2560x1440', 150)]);
    expect(r.changed).toBe(true);
    expect(r.text).toBe('[TargetWindow]\nXPos2560x1440 = 150  \nYPos2560x1440=200\n');
  });

  it('adds a missing key at the end of its section, before the next one', () => {
    const src = '[A]\nk1=1\nk2=2\n[B]\nz=9\n';
    const r = apply(src, [ed('A', 'XPos1920x1080', 40), ed('A', 'YPos1920x1080', 50)]);
    expect(r.text).toBe('[A]\nk1=1\nk2=2\nXPos1920x1080=40\nYPos1920x1080=50\n[B]\nz=9\n');
  });

  it('adds after the section\'s last non-blank line, so blank lines between sections stay put', () => {
    const src = '[A]\nk1=1\n\n[B]\nz=9\n';
    const r = apply(src, [ed('A', 'new', 1)]);
    expect(r.text).toBe('[A]\nk1=1\nnew=1\n\n[B]\nz=9\n');
  });

  it('adds into the last section when the file has no final newline', () => {
    const r = apply('[A]\nk1=1', [ed('A', 'k2', 2)]);
    expect(r.text).toBe('[A]\nk1=1\nk2=2');
  });

  it('creates a missing section at the end of the file', () => {
    const r = apply('[A]\nk1=1\n', [ed('RaidBars', 'Left', 12), ed('RaidBars', 'Top', 34)]);
    expect(r.text).toBe('[A]\nk1=1\n[RaidBars]\nLeft=12\nTop=34\n');
  });

  it('creates a section in an empty file', () => {
    expect(apply('', [ed('A', 'k', 1)]).text).toBe('[A]\r\nk=1\r\n');
  });

  it('leaves other sections, keys, comments and resolution blocks byte-for-byte alone', () => {
    const src = [
      '; EQ ui ini — hand notes here',
      '[TargetWindow]',
      'XPos1920x1080=10',
      'YPos1920x1080=20',
      'XPos2560x1440=100',
      'YPos2560x1440=200',
      'Width=300',
      '',
      '[Bag1]',
      'XPos2560x1440=500',
      'YPos2560x1440=600',
      '# trailing note',
      '',
    ].join('\n');
    const r = apply(src, [ed('TargetWindow', 'XPos2560x1440', 111)]);
    expect(r.text).toBe(src.replace('XPos2560x1440=100', 'XPos2560x1440=111'));
  });

  it('keeps CRLF on every line, including the lines it adds', () => {
    const src = '[A]\r\nk1=1\r\n[B]\r\nz=9\r\n';
    const r = apply(src, [ed('A', 'k1', 5), ed('A', 'k2', 6), ed('C', 'q', 7)]);
    expect(r.text).toBe('[A]\r\nk1=5\r\nk2=6\r\n[B]\r\nz=9\r\n[C]\r\nq=7\r\n');
    expect(r.text).not.toMatch(/(?<!\r)\n/);
  });

  it('keeps each line\'s own terminator in a file that mixes CRLF and LF', () => {
    const src = '[A]\r\nk1=1\nk2=2\r\n[B]\nz=9\n';
    const r = apply(src, [ed('A', 'k2', 3)]);
    expect(r.text).toBe('[A]\r\nk1=1\nk2=3\r\n[B]\nz=9\n');
  });

  it('keeps a byte-order mark', () => {
    const r = apply('﻿[A]\nk=1\n', [ed('A', 'k', 2)]);
    expect(r.text).toBe('﻿[A]\nk=2\n');
  });

  it('reports no change when every key already holds that value (so nothing is rewritten)', () => {
    const src = '[A]\nk = 1 \n';
    const r = apply(src, [ed('A', 'k', 1)]);
    expect(r.changed).toBe(false);
    expect(r.text).toBe(src);
  });

  it('matches section and key names without regard to case, like the profile API EQ reads with', () => {
    const r = apply('[targetwindow]\nxpos2560x1440=1\n', [ed('TargetWindow', 'XPos2560x1440', 2)]);
    expect(r.text).toBe('[targetwindow]\nxpos2560x1440=2\n');
  });

  it('uses the first block when a section name repeats', () => {
    const r = apply('[A]\nk=1\n[A]\nk=2\n', [ed('A', 'k', 9), ed('A', 'j', 8)]);
    expect(r.text).toBe('[A]\nk=9\nj=8\n[A]\nk=2\n');
  });

  it('deletes a key when the value is null, and ignores a delete for a key that is not there', () => {
    const r = apply('[A]\nk=1\nj=2\n', [ed('A', 'k', null), ed('A', 'gone', null)]);
    expect(r.text).toBe('[A]\nj=2\n');
    expect(apply('[A]\nj=2\n', [ed('A', 'gone', null)]).changed).toBe(false);
  });

  it('cannot be used to inject a line or a section', () => {
    const r = apply('[A]\nk=1\n', [ed('A', 'k', 'x\r\n[Evil]\r\nboom=1'), ed('A', 'bad key', 1), ed('A]\n[Evil', 'a', 1)]);
    expect(r.text).toBe('[A]\nk=x [Evil] boom=1\n');
  });
});

// ── Renderer: which windows Save sends ─────────────────────────────────────
const parseIniSrc = sliceBlock(studio, '  function parseIni(text){', '\n    return { lines: lines, sections: sections };\n  }');
const readPosSrc  = sliceBlock(studio, '  function _readPos(props, suffix){', '\n    return { x: x, y: y, used: used };\n  }');
const zealEditsSrc = sliceBlock(studio, '  function _zealBarEdits(w){', '\n    return e;\n  }');
const SAVE_END = '\n  // Is this character currently logged in?';
const saveSrc = sliceBlock(studio, '  function _writeAllReason(tgtSuffix){', SAVE_END);

function studioApi(blockText = saveSrc) {
  const harness = 'var STATE = { windows: [], fromCloud: false, srcSuffix: "2560x1440", srcW: 2560, srcH: 1440, tgtW: 2560, tgtH: 1440 };\n';
  return evalBlock(harness + parseIniSrc + '\n' + readPosSrc + '\n' + zealEditsSrc + '\n' + blockText,
    ['STATE', 'parseIni', '_readPos', '_buildSaveEdits']);
}
// The part of _renderLoadedBundle that matters here: one window per section
// with a position, remembering what Load saw (orig*) and which block it came from.
function loadWindows(api, file, text, suffix) {
  const out = [];
  for (const s of api.parseIni(text).sections) {
    const pos = api._readPos(s.props, suffix);
    if (pos.x == null || pos.y == null) continue;
    const hasWH = s.props.Width != null && s.props.Height != null;
    const w = hasWH ? parseInt(s.props.Width, 10) : 200, h = hasWH ? parseInt(s.props.Height, 10) : 100;
    const x = parseInt(pos.x, 10), y = parseInt(pos.y, 10);
    out.push({ file, section: s.name, hasWH, srcSuffix: pos.used, x, y, w, h, origX: x, origY: y, origW: w, origH: h });
  }
  return out;
}
const byKey = (edits, section) => Object.fromEntries(edits.filter(e => e.section === section).map(e => [e.key, e.value]));
const sectionsOf = (edits) => [...new Set(edits.map(e => e.section))];

const UI = 'UI_Aldenmar_pq.proj.ini';
const LOADED = [
  '[TargetWindow]', 'XPos2560x1440=100', 'YPos2560x1440=200', 'Width=300', 'Height=80',
  '[Bag1]', 'XPos2560x1440=500', 'YPos2560x1440=500',
  '[Bag2]', 'XPos2560x1440=520', 'YPos2560x1440=520', 'Width=210', 'Height=190',
  '[ZealItemDisplay1]', 'XPos2560x1440=700', 'YPos2560x1440=400',
  '',
].join('\r\n');

describe('_buildSaveEdits — only what the user changed', () => {
  it('sends nothing when no window was touched', () => {
    const api = studioApi();
    api.STATE.windows = loadWindows(api, UI, LOADED, '2560x1440');
    expect(api._buildSaveEdits().edits).toEqual([]);
  });

  it('sends a moved window\'s position keys for the target block, and no size', () => {
    const api = studioApi();
    api.STATE.windows = loadWindows(api, UI, LOADED, '2560x1440');
    api.STATE.windows[0].x = 150;
    const b = api._buildSaveEdits();
    expect(sectionsOf(b.edits)).toEqual(['TargetWindow']);
    expect(byKey(b.edits, 'TargetWindow')).toEqual({ XPos2560x1440: 150, YPos2560x1440: 200 });
    expect(b.edits.every(e => e.file === UI)).toBe(true);
    expect(b.files).toEqual([UI]);
    expect(b.all).toBe('');
  });

  it('sends the size of a window whose ini carried one when it was resized', () => {
    const api = studioApi();
    api.STATE.windows = loadWindows(api, UI, LOADED, '2560x1440');
    api.STATE.windows[2].w = 250; api.STATE.windows[2].sizeEdited = true;   // Bag2 has Width/Height
    expect(byKey(api._buildSaveEdits().edits, 'Bag2')).toEqual({
      XPos2560x1440: 520, YPos2560x1440: 520, Width: 250, Height: 190 });
  });

  it('sends Zeal bars only when they changed, through _zealBarEdits', () => {
    const api = studioApi();
    const bar = { file: 'zeal.ini', section: 'RaidBars', zealBar: 'raidbars', toEdgeR: true, toEdgeB: true,
      x: 40, y: 100, w: 1880, h: 980, origX: 40, origY: 100, origW: 1880, origH: 980 };
    api.STATE.windows = [bar];
    expect(api._buildSaveEdits().edits).toEqual([]);
    bar.x = 60;
    expect(api._buildSaveEdits().edits).toEqual([
      { file: 'zeal.ini', section: 'RaidBars', key: 'Left', value: 60 },
      { file: 'zeal.ini', section: 'RaidBars', key: 'Top', value: 100 }]);
  });
});

describe('Guard 1 — when every window is written', () => {
  it('a layout loaded from a cloud backup writes every window, even untouched ones', () => {
    const api = studioApi();
    api.STATE.windows = loadWindows(api, UI, LOADED, '2560x1440');
    api.STATE.fromCloud = true;
    const b = api._buildSaveEdits();
    expect(b.all).toBe('cloud');
    expect(sectionsOf(b.edits)).toEqual(['TargetWindow', 'Bag1', 'Bag2', 'ZealItemDisplay1']);
    expect(byKey(b.edits, 'Bag1')).toEqual({ XPos2560x1440: 500, YPos2560x1440: 500 });   // no size invented
    expect(byKey(b.edits, 'Bag2')).toMatchObject({ Width: 210, Height: 190 });             // ini sizes carried as before
  });

  it('rescaling to another resolution writes every window into the TARGET block', () => {
    const api = studioApi();
    api.STATE.windows = loadWindows(api, UI, LOADED, '2560x1440').map(w => ({ ...w,
      x: Math.round(w.x * 0.75), y: Math.round(w.y * 0.75), origX: Math.round(w.x * 0.75), origY: Math.round(w.y * 0.75) }));
    Object.assign(api.STATE, { tgtW: 1920, tgtH: 1080 });   // srcSuffix stays 2560x1440
    const b = api._buildSaveEdits();
    expect(b.all).toBe('rescale');
    expect(sectionsOf(b.edits)).toEqual(['TargetWindow', 'Bag1', 'Bag2', 'ZealItemDisplay1']);
    expect(byKey(b.edits, 'TargetWindow')).toMatchObject({ XPos1920x1080: 75, YPos1920x1080: 150 });
  });

  it('the same resolution on both sides is NOT a reason to write everything', () => {
    const api = studioApi();
    api.STATE.windows = loadWindows(api, UI, LOADED, '2560x1440');
    expect(api._buildSaveEdits().all).toBe('');
  });
});

// ── Main: the write itself, against files on disk ──────────────────────────
// _backupAndWriteFile … _applyDeferredEntry are one contiguous run of main.js.
const MAIN_BLOCK = sliceBlock(main, 'function _backupAndWriteFile(targetPath, contents, backupTag) {', 'let _uiDeferTickBusy = false;');
function mainApi(userData) {
  const logs = [];
  globalThis.__uiStudioKeyEdits = { fs, path, applyIniKeyEdits, userData, logs, live: new Map() };
  const pre = [
    'const { fs, path, applyIniKeyEdits, userData, logs } = globalThis.__uiStudioKeyEdits;',
    'const app = { getPath: () => userData };',
    'const Notification = { isSupported: () => false };',
    'const _zealLiveByChar = globalThis.__uiStudioKeyEdits.live;',
    'const console = { log: (m) => logs.push("console: " + m) };',
    'function appendAgentLog(l) { logs.push(String(l)); }',
  ].join('\n') + '\n';
  const post = '\nfunction getDeferred() { return _uiDeferred; }\nfunction setDeferred(v) { _uiDeferred = v; }\n';
  const api = evalBlock(pre + MAIN_BLOCK + post,
    ['_applyUiKeyEdits', '_loadUiDeferred', '_applyDeferredEntry', '_uiDeferFile', 'getDeferred', 'setDeferred']);
  return { ...api, logs };
}

let tmp, eqDir, userData;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-studio-key-edits-'));
  eqDir = path.join(tmp, 'eq'); userData = path.join(tmp, 'userdata');
  fs.mkdirSync(eqDir); fs.mkdirSync(userData);
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const read = (name) => fs.readFileSync(path.join(eqDir, name), 'utf8');
const backups = (name, tag) => fs.readdirSync(eqDir).filter(f => f.startsWith(name + '.' + tag + '-'));

// What EQ wrote after Studio loaded: the player moved Bag1 in game and camped.
const EQ_SAVED = LOADED.replace('XPos2560x1440=500', 'XPos2560x1440=777');

function studioSave(mutate, text = LOADED, suffix = '2560x1440') {
  const api = studioApi();
  api.STATE.windows = loadWindows(api, UI, text, suffix);
  mutate(api);
  return api._buildSaveEdits();
}

describe('the motivating scenario — EQ moved a bag window after Studio loaded', () => {
  it('Save moves the Target window and keeps the bag where EQ put it', () => {
    fs.writeFileSync(path.join(eqDir, UI), EQ_SAVED);             // disk now: Bag1 at 777
    const built = studioSave((api) => { api.STATE.windows[0].x = 150; });   // user moved Target only
    const main_ = mainApi(userData);
    const r = main_._applyUiKeyEdits(eqDir, built.edits, null);
    expect(r.written).toEqual([UI]);
    const after = read(UI);
    expect(after).toBe(EQ_SAVED.replace('XPos2560x1440=100', 'XPos2560x1440=150'));
    expect(after).toContain('[Bag1]\r\nXPos2560x1440=777');       // EQ's position survived
    expect(after).not.toMatch(/(?<!\r)\n/);                        // CRLF untouched
    // The backup holds EQ's file as it was just before the write.
    const bak = backups(UI, 'bak');
    expect(bak).toHaveLength(1);
    expect(fs.readFileSync(path.join(eqDir, bak[0]), 'utf8')).toBe(EQ_SAVED);
  });

  it('with the changed-only gate removed, the same Save puts the bag back (the test can fail)', () => {
    // Mutation: write every window, as the old Save did. If this ever stops
    // reverting the bag, the assertion above has gone vacuous.
    const gate = 'if (!all && !_windowChanged(w)) continue;';
    expect(saveSrc).toContain(gate);
    const mutated = studioApi(saveSrc.replace(gate, ''));
    mutated.STATE.windows = loadWindows(mutated, UI, LOADED, '2560x1440');
    mutated.STATE.windows[0].x = 150;
    fs.writeFileSync(path.join(eqDir, UI), EQ_SAVED);
    mainApi(userData)._applyUiKeyEdits(eqDir, mutated._buildSaveEdits().edits, null);
    expect(read(UI)).toContain('[Bag1]\r\nXPos2560x1440=500');     // reverted — what the bug did
  });

  it('a Save with nothing changed writes no file and makes no backup', () => {
    fs.writeFileSync(path.join(eqDir, UI), EQ_SAVED);
    const built = studioSave(() => {});
    expect(built.edits).toEqual([]);
    const r = mainApi(userData)._applyUiKeyEdits(eqDir, [{ file: UI, section: 'TargetWindow', key: 'XPos2560x1440', value: 100 }], null);
    expect(r).toEqual({ written: [], unchanged: [UI], missing: [] });
    expect(backups(UI, 'bak')).toHaveLength(0);
    expect(read(UI)).toBe(EQ_SAVED);
  });

  it('refuses names that leave the EQ folder, and reports a file that is gone instead of creating it', () => {
    const m = mainApi(userData);
    const r = m._applyUiKeyEdits(eqDir, [
      { file: '../escape.ini', section: 'A', key: 'k', value: 1 },
      { file: 'sub\\x.ini', section: 'A', key: 'k', value: 1 },
      { file: 'notes.txt', section: 'A', key: 'k', value: 1 },
      { file: UI, section: 'A', key: 'k', value: 1 },
    ], null);
    expect(r).toEqual({ written: [], unchanged: [], missing: [UI] });
    expect(fs.readdirSync(eqDir)).toEqual([]);
    expect(fs.existsSync(path.join(tmp, 'escape.ini'))).toBe(false);
  });

  it('a cloud-restored layout places every window: the backup\'s positions win, as key edits', () => {
    fs.writeFileSync(path.join(eqDir, UI), EQ_SAVED);              // this machine: Bag1 at 777
    const built = studioSave((api) => { api.STATE.fromCloud = true; });   // backup says Bag1 at 500
    mainApi(userData)._applyUiKeyEdits(eqDir, built.edits, null);
    expect(read(UI)).toBe(LOADED);
  });

  // A cloud backup loaded into the editor is a deliberate restore, often onto a PC where the files do
  // not exist yet, so Save keeps writing WHOLE files from the backup there — and only while logged out.
  it('Save sends a cloud-backup layout down the whole-file restore path, never the key edits or the logout queue', () => {
    const code = stripJs(studio);
    const save = sliceBlock(code, "document.getElementById('saveBtn').addEventListener('click', async function(){", "_writeEdits(built, { deferred: false })");
    expect(save.indexOf('if (STATE.fromCloud)')).toBeGreaterThan(0);
    expect(save.indexOf('if (STATE.fromCloud)')).toBeLessThan(save.indexOf('_queueDefer(built)'));
    const restore = sliceBlock(code, 'async function _saveCloudRestore(built){', "document.getElementById('saveBtn')");
    expect(restore).toMatch(/if \(await _isCharActiveInZeal\(STATE\.character\.toLowerCase\(\)\)\) \{[\s\S]*?return;/);
    expect(restore).toContain('emitIni(parsed, per[fname])');
    expect(restore).toContain('window.mimic.uiStudioWriteBundle(STATE.eqDir, texts, null)');
    expect(restore).not.toContain('uiStudioDeferSave');
  });

  it('a rescale keeps the original resolution block and adds the target block to every window', () => {
    fs.writeFileSync(path.join(eqDir, UI), EQ_SAVED);
    const built = studioSave((api) => { Object.assign(api.STATE, { tgtW: 1920, tgtH: 1080 }); });
    mainApi(userData)._applyUiKeyEdits(eqDir, built.edits, null);
    const after = read(UI);
    expect(after).toContain('XPos2560x1440=777');                  // EQ's block untouched
    for (const sec of ['TargetWindow', 'Bag1', 'Bag2', 'ZealItemDisplay1']) {
      expect(after).toMatch(new RegExp('\\[' + sec + '\\]\\r\\n(?:[^\\[]*?\\r\\n)?XPos1920x1080='));
    }
  });
});

// ── Deferred save: key edits, and old whole-text entries are dropped ────────
describe('deferred save (apply after logout)', () => {
  const entry = (extra) => ({ character: 'Aldenmar', eqDir: '', tgtSuffix: '2560x1440', queuedAt: 1, sawActive: true, ...extra });

  it('applies the queued key edits to the file as EQ just wrote it, tagging the backup bak-eq', () => {
    fs.writeFileSync(path.join(eqDir, UI), EQ_SAVED);
    const m = mainApi(userData);
    const ok = m._applyDeferredEntry(entry({ eqDir, edits: [{ file: UI, section: 'TargetWindow', key: 'XPos2560x1440', value: 150 }] }));
    expect(ok).toBe(true);
    expect(read(UI)).toBe(EQ_SAVED.replace('XPos2560x1440=100', 'XPos2560x1440=150'));
    expect(backups(UI, 'bak-eq')).toHaveLength(1);
    expect(m.logs.join('')).toContain('[ui-studio] applied deferred save for Aldenmar (1 file(s)) after logout');
  });

  it('Guard 2: an old whole-text entry is dropped on load, saved away, and never applied', () => {
    const stale = '[TargetWindow]\r\nXPos2560x1440=1\r\n[Bag1]\r\nXPos2560x1440=500\r\n';
    fs.writeFileSync(path.join(eqDir, UI), EQ_SAVED);
    const oldEntry = entry({ eqDir, bundle: { [UI]: stale } });
    const newEntry = entry({ character: 'Brackwyn', eqDir, edits: [{ file: UI, section: 'Bag1', key: 'XPos2560x1440', value: 1 }] });
    fs.writeFileSync(path.join(userData, 'ui-studio-pending.json'), JSON.stringify([oldEntry, newEntry]));
    const m = mainApi(userData);
    m._loadUiDeferred();
    expect(m.getDeferred().map(e => e.character)).toEqual(['Brackwyn']);
    expect(m.logs.join('\n')).toMatch(/dropped 1 pending deferred save\(s\) in the old whole-file format/);
    expect(JSON.parse(fs.readFileSync(path.join(userData, 'ui-studio-pending.json'), 'utf8')).map(e => e.character)).toEqual(['Brackwyn']);
    expect(read(UI)).toBe(EQ_SAVED);                               // nothing was written
  });

  it('Guard 2, second line: an old entry that got past load is refused at apply time', () => {
    fs.writeFileSync(path.join(eqDir, UI), EQ_SAVED);
    const m = mainApi(userData);
    expect(m._applyDeferredEntry(entry({ eqDir, bundle: { [UI]: 'stale' } }))).toBe(false);
    expect(read(UI)).toBe(EQ_SAVED);
    expect(backups(UI, 'bak-eq')).toHaveLength(0);
  });
});

// ── Wiring (comments stripped — a comment can quote any of this) ───────────
describe('wiring', () => {
  const strip = stripJs;
  it('Save and the deferred queue send edits, not file texts', () => {
    const code = strip(studio);
    expect(code).toContain('window.mimic.uiStudioWriteEdits(STATE.eqDir, built.edits');
    expect(code).toContain('edits: built.edits, tgtSuffix: built.tgtSuffix');
    expect(code).not.toMatch(/bundle: newBundle/);
    const saveHandler = sliceBlock(code, "document.getElementById('saveBtn')", "document.getElementById('deferCancel')");
    expect(saveHandler).not.toMatch(/uiStudioWriteBundle|newBundle/);
  });
  it('main exposes the write, queues edits, and the preload bridges it', () => {
    const code = strip(main);
    expect(code).toContain("ipcMain.handle('ui-studio-write-edits'");
    const defer = sliceBlock(code, "ipcMain.handle('ui-studio-defer-save'", "ipcMain.handle('ui-studio-pending-list'");
    expect(defer).toMatch(/_cleanUiKeyEdits\(params\?\.edits\)/);
    expect(defer).not.toMatch(/\bbundle\b/);
    expect(strip(readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js'))))
      .toContain("ipcRenderer.invoke('ui-studio-write-edits'");
  });
  it('the Hotbar Pages writer shares the same walk', () => {
    const pages = sliceBlock(strip(main), "ipcMain.handle('ui-studio-write-pages'", "ipcMain.handle('ui-studio-inspect-socials'");
    expect(pages).toContain('applyIniKeyEdits(orig, eds)');
  });
});
