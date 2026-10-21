// test/ui-studio-current-draft.test.js — UI Studio shows the character's CURRENT UI files.
//
// The guild lead, 2026-10-15: "LOAD AND RESCALE in ui studio is not loading in my current
// configuration, only the ones that i saved" / "Update from current did not update from what my
// current actually is" / "selecting the character from the UI studio dropdown should just pull up the
// current configuration in the current format, no conversion target necessary."
//
// Runs the shipped code: uiLayouts.liveUiFileInfo against a temp folder of INVENTED ini files, the
// native-resolution helpers sliced out of ui-studio.html, and comment-stripped text assertions on the
// wiring (picking a character reads fresh and shows it unconverted; Update tells you the file time).
//
// Run: npx vitest run test/ui-studio-current-draft.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const layouts = require('../apps/mimic/uiLayouts.js');

const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'ui-studio.html'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'preload.js'), 'utf8');

const { _nativeResolution, _videoModeRes, _ageWords, _fileTimeText } = evalBlock(
  sliceBlock(html, '  function _nativeResolution(counts){', "_ageWords(ms, Date.now()) + ')';\n  }\n"),
  ['_nativeResolution', '_videoModeRes', '_ageWords', '_fileTimeText'],
);

describe('_videoModeRes — the game\'s own resolution from eqclient.ini', () => {
  it('reads [VideoMode] Width/Height, whatever the file name case', () => {
    const b = { 'eqclient.INI': '[Defaults]\r\nWidth=640\r\n[VideoMode]\r\nWidth=1920\r\nHeight=1080\r\nRefreshRate=60\r\n' };
    expect(_videoModeRes(b)).toEqual({ w: 1920, h: 1080 });
  });
  it('ignores Width/Height in other sections, and missing or non-positive values', () => {
    expect(_videoModeRes({ 'eqclient.ini': '[Defaults]\nWidth=1920\nHeight=1080\n' })).toBeNull();
    expect(_videoModeRes({ 'eqclient.ini': '[VideoMode]\nWidth=-1\nHeight=-1\n' })).toBeNull();
    expect(_videoModeRes({ 'UI_Aldenmar_pq.proj.ini': '[VideoMode]\nWidth=1920\nHeight=1080\n' })).toBeNull();
  });
});

describe('native load prefers the game resolution when the UI file has a block for it', () => {
  it('is wired before the most-windows fallback', () => {
    const s = stripJs(html);
    expect(s).toMatch(/var vm = _videoModeRes\(STATE\.bundle\);\s*var nat = \(vm && counts\[vm\.w \+ 'x' \+ vm\.h\]\) \? vm : _nativeResolution\(counts\);/);
  });
});

describe('liveUiFileInfo — when EQ last wrote the UI file', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uis-live-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const put = (name, ms) => {
    const fp = path.join(dir, name);
    fs.writeFileSync(fp, '[X]\r\n');
    fs.utimesSync(fp, ms / 1000, ms / 1000);
  };

  it('reports the newest mtime of this character\'s UI_ files only', () => {
    put('UI_Aldenmar_pq.proj.ini', 1_700_000_000_000);
    put('UI_Aldenmar_other.ini', 1_700_000_500_000);
    put('UI_Brackwyn_pq.proj.ini', 1_800_000_000_000);     // someone else
    put('Aldenmar_pq.proj.ini', 1_900_000_000_000);        // not a UI_ file
    put('UI_Aldenmar_pq.proj.ini.bak-1700000000', 1_950_000_000_000);   // a backup copy
    const r = layouts.liveUiFileInfo(dir, 'aldenmar');
    expect(r.files.map(f => f.name).sort()).toEqual(['UI_Aldenmar_other.ini', 'UI_Aldenmar_pq.proj.ini']);
    expect(r.newestMs).toBe(1_700_000_500_000);
  });

  it('is empty, not an error, for a missing folder or no UI file', () => {
    expect(layouts.liveUiFileInfo(path.join(dir, 'nope'), 'Aldenmar')).toEqual({ files: [], newestMs: null });
    expect(layouts.liveUiFileInfo(dir, 'Aldenmar')).toEqual({ files: [], newestMs: null });
    expect(layouts.liveUiFileInfo('', 'Aldenmar').newestMs).toBeNull();
  });

  it('follows the file: a rewrite moves the time (no cache)', () => {
    put('UI_Aldenmar_pq.proj.ini', 1_700_000_000_000);
    expect(layouts.liveUiFileInfo(dir, 'Aldenmar').newestMs).toBe(1_700_000_000_000);
    put('UI_Aldenmar_pq.proj.ini', 1_700_009_000_000);
    expect(layouts.liveUiFileInfo(dir, 'Aldenmar').newestMs).toBe(1_700_009_000_000);
  });
});

describe('native resolution — what the file is actually saved at', () => {
  it('takes the block holding the most windows, not the dropdown default', () => {
    expect(_nativeResolution({ '2560x1440': 12, '1920x1080': 130 })).toEqual({ w: 1920, h: 1080 });
  });
  it('a tie goes to the larger screen', () => {
    expect(_nativeResolution({ '1920x1080': 50, '2560x1440': 50 })).toEqual({ w: 2560, h: 1440 });
  });
  it('is null when the file has no resolution block', () => {
    expect(_nativeResolution({})).toBeNull();
  });
});

describe('file time wording', () => {
  const now = Date.now();
  it('says how old the file is in plain words', () => {
    expect(_ageWords(now - 5_000, now)).toBe('just now');
    expect(_ageWords(now - 12 * 60_000, now)).toBe('12 min ago');
    expect(_ageWords(now - 3 * 3600_000, now)).toBe('3 h ago');
    expect(_ageWords(now - 5 * 86400_000, now)).toBe('5 days ago');
  });
  it('is empty when the time is unknown', () => {
    expect(_fileTimeText(null)).toBe('');
    expect(_fileTimeText(0)).toBe('');
    expect(_fileTimeText(Date.now() - 60_000)).toMatch(/\(1 min ago\)$/);
  });
});

describe('wiring', () => {
  const h = stripJs(html);
  const loadBody = () => sliceBlock(h, 'async function loadAndRescale(native){', '    STATE.fromCloud = false;');

  it('picking a character loads it natively; the Load + Rescale button stays the explicit step', () => {
    expect(h).toMatch(/getElementById\('charSelect'\)\.addEventListener\('change', function\(\)\{\s*if \(this\.value\) loadAndRescale\(true\)/);
    // The click passes no argument, so the click event can never read as "native".
    expect(h).toMatch(/getElementById\('loadBtn'\)\.addEventListener\('click', function\(\)\{ loadAndRescale\(\); \}\)/);
  });
  it('native load sets Target = Source and skips the target validation', () => {
    const body = loadBody();
    expect(body).toMatch(/STATE\.tgtW = nat\.w; STATE\.tgtH = nat\.h;/);
    expect(body).toMatch(/if \(!STATE\.nativeLoad\) \{[\s\S]*enter valid Source\/Target sizes/);
  });
  it('every load re-reads the files on disk (no reuse of STATE.bundle)', () => {
    const body = loadBody();
    expect(body).toMatch(/STATE\.bundle = await window\.mimic\.uiStudioReadBundle\(STATE\.character, STATE\.eqDir\)/);
    expect(body).not.toMatch(/if \(!STATE\.bundle\)/);
  });
  it('Update from current shows when the UI file was last written', () => {
    const body = sliceBlock(h, "_layEl('layoutUpdate').addEventListener", "_layEl('layoutRename')");
    expect(body).toMatch(/uiStudioLiveInfo\(who\.character, who\.eqDir\)/);
    expect(body).toMatch(/last written/);
  });
  it('the live-info call is wired renderer -> preload -> main', () => {
    expect(stripJs(preload)).toMatch(/uiStudioLiveInfo:\s+\(character, eqDir\) => ipcRenderer\.invoke\('ui-studio-live-info'/);
    expect(stripJs(main)).toMatch(/ipcMain\.handle\('ui-studio-live-info'[\s\S]*uiLayouts\.liveUiFileInfo\(/);
  });
});
