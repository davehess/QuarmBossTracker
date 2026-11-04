// EverQuest file creation dates (the "only starts after I change my time zone" fix; the guild lead, 2026-11-03).
// The module takes its file system and PowerShell as arguments, so everything here runs on a fake.
// Run: npx vitest run test/eq-file-dates.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const E = require('../apps/mimic/eqFileDates.js');
const ROOT = path.resolve(__dirname, '..');

const GOOD = Date.UTC(2024, 5, 1);
const root = path.resolve('/eq');
const j = (...p) => path.join(root, ...p);

// A fake tree: { 'dir/file': birthtimeMs | 'link' | 'dir' } → the slice of fs.promises the module uses.
function fakeFs(files, { missingExe = false } = {}) {
  const tree = { ...files };
  if (!missingExe) tree['eqgame.exe'] = GOOD;
  const written = {};
  const entries = (dir) => {
    const rel = path.relative(root, dir);
    const seen = new Map();
    for (const k of Object.keys(tree)) {
      const parts = k.split('/');
      const parent = parts.slice(0, -1).join('/');
      if (parent === rel.split(path.sep).join('/')) seen.set(parts[parts.length - 1], tree[k]);
      else if (rel === '' ? parts.length > 1 : k.startsWith(rel.split(path.sep).join('/') + '/')) {
        const next = parts[rel === '' ? 0 : rel.split(path.sep).length];
        if (!seen.has(next) && parts.length > (rel === '' ? 1 : rel.split(path.sep).length + 1)) seen.set(next, 'dir');
      }
    }
    return [...seen].map(([name, v]) => ({
      name,
      isSymbolicLink: () => v === 'link',
      isDirectory: () => v === 'dir',
      isFile: () => v !== 'link' && v !== 'dir',
    }));
  };
  const keyOf = (p) => path.relative(root, p).split(path.sep).join('/');
  return {
    written,
    promises: {
      access: async (p) => { if (!(keyOf(p) in tree)) throw new Error('ENOENT'); },
      readdir: async (d) => entries(d),
      lstat: async (p) => ({ birthtimeMs: tree[keyOf(p)] }),
      writeFile: async (p, data) => { written[p] = data; },
      unlink: async (p) => { delete written[p]; },
    },
    fix(rel) { tree[rel] = GOOD; },
  };
}

describe('isBadCreationTime', () => {
  const bad = (ms) => E.isBadCreationTime({ birthtimeMs: ms });
  it('rejects things that are not a usable date', () => {
    expect(bad(NaN)).toBe(true);
    expect(bad(Infinity)).toBe(true);
    expect(bad(undefined)).toBe(true);
    expect(bad('2020')).toBe(true);
    expect(E.isBadCreationTime(null)).toBe(true);
  });
  it('1979 is bad, 1 Jan 1980 is the first good moment', () => {
    expect(bad(Date.UTC(1979, 11, 31, 23, 59, 59))).toBe(true);
    expect(bad(Date.UTC(1980, 0, 1))).toBe(false);
  });
  it('today is fine; 2100 and beyond is bad; huge and negative are bad', () => {
    expect(bad(Date.now())).toBe(false);
    expect(bad(Date.UTC(2099, 11, 31))).toBe(false);
    expect(bad(Date.UTC(2100, 0, 1))).toBe(true);
    expect(bad(8.64e15)).toBe(true);
    expect(bad(-1e12)).toBe(true);
    expect(bad(0)).toBe(true);
  });
  it('takes a real fs.Stats too', () => {
    expect(E.isBadCreationTime(fs.statSync(__filename))).toBe(false);
  });
});

describe('scanEqFileDates', () => {
  it('finds the bad files at any depth and counts what it looked at', async () => {
    const f = fakeFs({ 'spells_en.txt': 5, 'ok.txt': GOOD, 'uifiles/a/x.xml': Date.UTC(2200, 0, 1), 'uifiles/a/y.xml': GOOD });
    const r = await E.scanEqFileDates(root, { fsImpl: f });
    expect(r.scanned).toBe(5);
    expect(r.bad.sort()).toEqual([j('spells_en.txt'), j('uifiles', 'a', 'x.xml')].sort());
    expect(r.errors).toBe(0);
  });
  it('skips symlinks (a link to a bad file or a folder is never entered)', async () => {
    const f = fakeFs({ 'link.txt': 'link', 'real.txt': 1 });
    const r = await E.scanEqFileDates(root, { fsImpl: f });
    expect(r.bad).toEqual([j('real.txt')]);
    expect(r.scanned).toBe(2);
  });
  it('refuses a folder with no eqgame.exe', async () => {
    const r = await E.scanEqFileDates(root, { fsImpl: fakeFs({ 'a.txt': 1 }, { missingExe: true }) });
    expect(r.error).toBe(`eqgame.exe not found in ${root}`);
    expect(r.bad).toBeUndefined();
  });
  it('every path it reports is inside the folder', async () => {
    const f = fakeFs({ 'a/b/c.txt': 1, 'z.txt': 2 });
    const r = await E.scanEqFileDates(root, { fsImpl: f });
    for (const p of r.bad) expect(p.startsWith(root + path.sep)).toBe(true);
  });
  it('stops at the file limit and says so', async () => {
    const files = {};
    for (let i = 0; i < 10; i++) files[`f${i}.txt`] = GOOD;
    const r = await E.scanEqFileDates(root, { fsImpl: fakeFs(files), limit: 4 });
    expect(r.scanned).toBe(4);
    expect(r.truncated).toBe(true);
  });
  it('a file it cannot read is counted, not fatal', async () => {
    const f = fakeFs({ 'a.txt': GOOD });
    f.promises.lstat = async () => { throw new Error('EPERM'); };
    const r = await E.scanEqFileDates(root, { fsImpl: f });
    expect(r.errors).toBe(2);   // eqgame.exe and a.txt
    expect(r.bad).toEqual([]);
  });
});

describe('fixScript', () => {
  const s = E.fixScript();
  it('contains no path: the list file arrives through the environment, never the code', () => {
    expect(s).not.toMatch(/[A-Za-z]:\\/);
    expect(s).not.toMatch(/\/eq|\\eq|eqgame|spells_en/i);
    expect(s).toMatch(/\$env:WP_EQ_LIST/);
    expect(s).toMatch(/SetCreationTimeUtc\(\$p, \[DateTime\]::UtcNow\)/);
    expect(s).toMatch(/fixed: /);
    expect(s).toMatch(/FAILED: /);
  });
  it('changes creation dates only: no file is opened for writing, moved or deleted', () => {
    expect(s).not.toMatch(/WriteAll|Set-Content|Out-File|Remove-Item|Move-Item|Copy-Item|Delete|SetLastWrite/i);
  });
});

describe('fixEqFileDates', () => {
  it('passes the paths through a temp list file, runs the script, re-scans, and removes the list', async () => {
    const f = fakeFs({ 'spells_en.txt': 5, 'uifiles/x.xml': 5 });
    const seen = {};
    const spawnImpl = async (script, env) => {
      seen.script = script; seen.env = env; seen.list = f.written[env.WP_EQ_LIST];
      f.fix('spells_en.txt'); f.fix('uifiles/x.xml');
      return { ok: true, stdout: `fixed: ${j('spells_en.txt')}\r\nfixed: ${j('uifiles', 'x.xml')}\r\n` };
    };
    const r = await E.fixEqFileDates(root, [j('spells_en.txt'), j('uifiles', 'x.xml')], { fsImpl: f, spawnImpl });
    expect(seen.script).toBe(E.fixScript());
    expect(seen.list.split('\n').sort()).toEqual([j('spells_en.txt'), j('uifiles', 'x.xml')].sort());
    expect(r).toEqual({ fixed: 2, failed: [], remaining: 0 });
    expect(Object.keys(f.written)).toEqual([]);   // the list file is gone
  });
  it('reports a FAILED line and what is still broken', async () => {
    const f = fakeFs({ 'a.txt': 5 });
    const spawnImpl = async () => ({ ok: true, stdout: `FAILED: ${j('a.txt')} - Access to the path is denied.\n` });
    const r = await E.fixEqFileDates(root, [j('a.txt')], { fsImpl: f, spawnImpl });
    expect(r.fixed).toBe(0);
    expect(r.failed).toEqual([{ path: j('a.txt'), msg: 'Access to the path is denied.' }]);
    expect(r.remaining).toBe(1);
  });
  it('refuses paths outside the folder: they never reach the list or PowerShell', async () => {
    const f = fakeFs({ 'a.txt': 5 });
    let ran = false;
    const spawnImpl = async () => { ran = true; return { ok: true, stdout: '' }; };
    const evil = [path.resolve('/etc/passwd'), j('..', 'other', 'x.txt'), root + '-sibling/x.txt', 'relative.txt', j('a.txt') + '\nC:\\Windows\\x'];
    const r = await E.fixEqFileDates(root, evil, { fsImpl: f, spawnImpl });
    expect(ran).toBe(false);
    expect(r.fixed).toBe(0);
    expect(r.failed.length).toBe(evil.length);
  });
  it('only the inside paths are listed when the input is mixed', async () => {
    const f = fakeFs({ 'a.txt': 5 });
    let list = null;
    const spawnImpl = async (_s, env) => { list = f.written[env.WP_EQ_LIST]; return { ok: true, stdout: '' }; };
    await E.fixEqFileDates(root, [j('a.txt'), path.resolve('/elsewhere/b.txt')], { fsImpl: f, spawnImpl });
    expect(list).toBe(j('a.txt'));
  });
});

describe('wiring', () => {
  const main = stripJs(fs.readFileSync(path.join(ROOT, 'apps/mimic/main.js'), 'utf8'));
  const settings = fs.readFileSync(path.join(ROOT, 'apps/mimic/settings.html'), 'utf8');
  it('both handlers refuse while EverQuest runs and when the platform is not Windows', () => {
    const pre = main.slice(main.indexOf('async function _eqDatesPrecheck'), main.indexOf("ipcMain.handle('eq-file-dates-scan'"));
    expect(pre).toMatch(/process\.platform !== 'win32'/);
    expect(pre).toMatch(/_isEqRunning\(\)/);
    expect(pre).toMatch(/Close EverQuest first\./);
    expect(main).toMatch(/ipcMain\.handle\('eq-file-dates-scan'[\s\S]*?_eqDatesPrecheck\(\)/);
    expect(main).toMatch(/ipcMain\.handle\('eq-file-dates-fix'[\s\S]*?_eqDatesPrecheck\(\)/);
  });
  it('the fix handler re-scans itself: the renderer sends no paths', () => {
    const fix = main.slice(main.indexOf("ipcMain.handle('eq-file-dates-fix'"));
    expect(fix.slice(0, 700)).toMatch(/scanEqFileDates\(pre\.dir\)/);
    expect(fix.slice(0, 200)).not.toMatch(/\(_e, /);
  });
  it('the tray item opens the Settings card the buttons live in (parity)', () => {
    expect(main).toMatch(/Fix EQ file dates \(time-zone crash\)…[\s\S]{0,120}openSettings\('eqdates'\)/);
    expect(settings).toMatch(/<h2 id="eqdates">/);
    expect(settings).toMatch(/Check my EQ files/);
    expect(settings).toMatch(/Fix them/);
    expect(settings).toMatch(/only file dates/);
  });
});
