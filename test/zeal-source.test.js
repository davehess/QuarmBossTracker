// test/zeal-source.test.js — Mimic can install Zeal from the guild's fork as well as the official
// release (the guild lead, 2026-10-01: "build the option into mimic to pull my zeal repo's build as
// an option").
//
// The fork's test-all branch builds on GitHub into one rolling prerelease (tag test-all-build), so
// the tag never changes; a build is named by its commit, "testall-<hash>", the label Zeal's own
// options window shows. Runs the real zealUpdater against a stubbed GitHub (no network) and checks
// the main.js / preload / Settings wiring as comment-stripped source.
//
// Run: npx vitest run test/zeal-source.test.js

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const GH = require.resolve('../apps/mimic/ghDownload.js');
const ZU = require.resolve('../apps/mimic/zealUpdater.js');

// One stored (uncompressed) entry per file: local headers, central directory, end record.
function makeZip(files) {
  const locals = [], centrals = []; let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const n = Buffer.from(name), d = Buffer.from(content);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22);
    lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt32LE(d.length, 20); ch.writeUInt32LE(d.length, 24);
    ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, n, d); centrals.push(ch, n);
    off += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8); eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const TEST_URL = 'https://api.github.com/repos/davehess/Zeal/releases/tags/test-all-build';
const OFFICIAL_URL = 'https://api.github.com/repos/CoastalRedwood/Zeal/releases/latest';
const ZIP_URL = 'https://github.com/davehess/Zeal/releases/download/test-all-build/zeal_test-all.zip';
let calls = [], testRelease, zu;

beforeAll(() => {
  const gh = require(GH);
  gh.httpsGet = async (url) => {
    calls.push(url);
    if (url === TEST_URL) return testRelease;
    if (url === OFFICIAL_URL) return { tag_name: 'v1.4.8', name: 'v1.4.8', assets: [{ name: 'zeal_v1.4.8_50dc9a4.zip', browser_download_url: 'https://example/official.zip' }] };
    if (url === ZIP_URL) return makeZip({ 'Zeal.asi': 'ASI-TEST', 'Zeal.pdb': 'PDB', 'uifiles/zeal/targetrings/WolfPack.tga': 'TGA', 'Zeal_README.md': '#' });
    throw new Error('unexpected url ' + url);
  };
  delete require.cache[ZU];
  zu = require(ZU);        // picks up the stubbed httpsGet
});
afterEach(() => { calls = []; });

const release = (over = {}) => ({
  tag_name: 'test-all-build', name: 'test-all (0a2e25d)', target_commitish: '0a2e25d05cf745192702a4cef877694e9b5aa083',
  assets: [{ name: 'zeal_test-all.zip', browser_download_url: ZIP_URL, id: 99, updated_at: '2026-10-01T12:30:00Z' }], ...over,
});

describe('where Zeal comes from', () => {
  it('official is CoastalRedwood\'s latest release, named by its tag', async () => {
    const r = await zu.checkLatest('official');
    expect(calls).toEqual([OFFICIAL_URL]);
    expect(r).toMatchObject({ source: 'official', tag: 'v1.4.8' });
  });

  it('no source, or an unknown one, means official', async () => {
    expect((await zu.checkLatest()).source).toBe('official');
    expect((await zu.checkLatest('nonsense')).source).toBe('official');
    expect(calls.every(u => u === OFFICIAL_URL)).toBe(true);
  });

  it('test is the fork\'s test-all build, named testall-<commit> from the release name', async () => {
    testRelease = release();
    const r = await zu.checkLatest('test');
    expect(calls).toEqual([TEST_URL]);
    expect(r).toMatchObject({ source: 'test', tag: 'testall-0a2e25d', assetUrl: ZIP_URL });
  });

  it('a new push is a new tag, so Mimic offers it', async () => {
    testRelease = release({ name: 'test-all (b7c91e2)' });
    expect((await zu.checkLatest('test')).tag).toBe('testall-b7c91e2');
  });

  it('without a hash in the name it falls back to the commit, then to the upload time', async () => {
    testRelease = release({ name: 'test-all' });
    expect((await zu.checkLatest('test')).tag).toBe('testall-0a2e25d');
    testRelease = release({ name: 'test-all', target_commitish: 'test-all' });
    expect((await zu.checkLatest('test')).tag).toBe('testall-2026-10-01T12:30:00Z');
  });

  it('a test release with no zip yet says so', async () => {
    testRelease = release({ assets: [] });
    await expect(zu.checkLatest('test')).rejects.toThrow(/test build has no \.zip/);
  });
});

describe('installing the test build', () => {
  let dir;
  afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  it('puts Zeal.asi and uifiles in the EQ folder and reports the testall tag', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-zeal-'));
    testRelease = release();
    const res = await zu.install(dir, { source: 'test' });
    expect(res.tag).toBe('testall-0a2e25d');
    expect(fs.readFileSync(path.join(dir, 'Zeal.asi'), 'utf8')).toBe('ASI-TEST');
    expect(fs.existsSync(path.join(dir, 'uifiles', 'zeal', 'targetrings', 'WolfPack.tga'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'Zeal.pdb'))).toBe(false);          // not Zeal.asi, not uifiles
  });
});

describe('the wiring', () => {
  const main = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')));
  const pre = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js')));
  const settings = readSource(path.join(ROOT, 'apps', 'mimic', 'settings.html'));

  it('main.js: the source is saved by its own IPC and used by check, install and the background check', () => {
    const setSrc = sliceBlock(main, "ipcMain.handle('zeal-set-source'", '\n});');
    expect(setSrc).toMatch(/cfg\.zealSource = zealUpdater\._zealSource\(source\)/);
    expect(setSrc).toMatch(/saveConfig\(cfg\)/);
    expect(sliceBlock(main, "ipcMain.handle('zeal-check-update'", '\n});')).toMatch(/checkLatest\(cfg\.zealSource\)/);
    expect(sliceBlock(main, "ipcMain.handle('zeal-install-update'", '\n});')).toMatch(/install\(eqDir, \{ source: cfg\.zealSource \}\)/);
    expect(sliceBlock(main, 'async function checkZealUpdate(', '\n}')).toMatch(/checkLatest\(cfg\.zealSource\)/);
    expect(sliceBlock(main, "ipcMain.handle('zeal-status'", '\n});')).toMatch(/source: zealUpdater\._zealSource\(cfg\.zealSource\)/);
  });

  it('preload exposes the switch', () => {
    expect(pre).toMatch(/zealSetSource:\s*\(s\)\s*=>\s*ipcRenderer\.invoke\('zeal-set-source', s\)/);
  });

  it('Settings: two choices that save at once and re-check', () => {
    expect(settings).toMatch(/<input type="radio" name="zealSource" value="official" id="zealSrcOfficial">/);
    expect(settings).toMatch(/<input type="radio" name="zealSource" value="test" id="zealSrcTest">/);
    const js = stripJs(sliceBlock(settings, "document.querySelectorAll('input[name=zealSource]')", 'checkBtn.addEventListener('));
    expect(js).toMatch(/window\.mimic\.zealSetSource\(r\.value\)/);
    expect(js).toMatch(/checkBtn\.click\(\)/);
  });
});
