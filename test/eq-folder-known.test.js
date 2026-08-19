// test/eq-folder-known.test.js — a folder you configured counts as known.
//
// THE DEADLOCK (Pyxil's onboarding, 2026-08-14). She pointed Mimic at
// C:\TAKPv22. Settings listed it, ticked, as "eqclient.exe · no logs yet". The
// dashboard still said "No EQ folder selected", and "Set up EQ for me" answered
// "No EQ folder known yet — point Mimic at your EverQuest folder in Settings
// first."
//
// She had. The folder had no logs BECAUSE in-game logging was off, and the one
// button whose entire job is to turn logging on refused for want of the logs it
// would have created. Every user who installs EQ and Mimic before ever typing
// /log on lands in exactly that state — which is every new user.
//
// Cause: one list served two questions. `resolveEqDirsWithLogs` gated EVERY
// path on `_dirHasEqLogs`, including ones the user had configured, and the
// agent's `_eqSetupDirs` inferred folders from logs it was already tailing.
// Both are right for "what do I TAIL" and wrong for "what do I KNOW".
//
// Run: npx vitest run test/eq-folder-known.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const main  = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'main.js'), 'utf8');
const agent = fs.readFileSync(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'), 'utf8');

describe('knowing a folder does not require logs in it', () => {
  it('resolveEqDirsWithLogs returns knownDirs alongside the tailable ones', () => {
    expect(main).toMatch(/return \{ dirs: \[\.\.\.withLogs\], runningDirs, knownDirs: \[\.\.\.known\] \};/);
  });

  it('a configured path is known even with no logs', () => {
    const fn = main.slice(main.indexOf('const known = new Set(withLogs);'),
                          main.indexOf('return { dirs: [...withLogs], runningDirs, knownDirs'));
    expect(fn).toMatch(/for \(const p of userPaths\) if \(!excluded\.has\(String\(p\)\.toLowerCase\(\)\)\) known\.add\(p\);/);
    // and it must NOT re-apply the log gate on the way in
    expect(fn).not.toMatch(/_dirHasEqLogs/);
  });

  it('an excluded folder stays excluded from the known list too', () => {
    // The opt-out has to hold, or "don't watch this install" would leak back
    // in through the new path.
    const fn = main.slice(main.indexOf('const known = new Set(withLogs);'),
                          main.indexOf('return { dirs: [...withLogs], runningDirs, knownDirs'));
    const adds = fn.match(/known\.add\(/g) || [];
    const guards = fn.match(/excluded\.has\(/g) || [];
    expect(guards.length).toBeGreaterThanOrEqual(adds.length - 1);   // the seed set is already filtered
  });

  it('folders found by the eqgame.exe scan count, since that scan needs no logs', () => {
    expect(main).toMatch(/findEqInstalls\(null\)\.found/);
  });

  it('discovery failing never blocks the agent launch', () => {
    const fn = main.slice(main.indexOf('const known = new Set(withLogs);'),
                          main.indexOf('return { dirs: [...withLogs], runningDirs, knownDirs'));
    expect(fn).toMatch(/catch \(e\) \{ void e;/);
  });
});

describe('Mimic tells the agent every folder it knows', () => {
  it('sets the plural env var', () => {
    expect(main).toMatch(/env\.WOLFPACK_EQ_DIRS = knownDirs\.join\(path\.delimiter\)/);
  });

  it('still tails only the folders that have logs', () => {
    // The fix must not start tailing empty folders — `dirs` stays the gated
    // list and is what feeds --log.
    expect(main).toMatch(/const \{ dirs: eqDirs, runningDirs, knownDirs \} = await resolveEqDirsWithLogs\(\);/);
    expect(main).toMatch(/for \(const dir of eqDirs\) \{\s*\n\s*const det = detectCharacterFromLogs\(dir\);/);
  });

  it('falls back to a known folder for the primary when none have logs', () => {
    expect(main).toMatch(/const primaryEqDir = eqDirs\[0\] \|\| \(knownDirs && knownDirs\[0\]\) \|\| null;/);
  });
});

describe('the agent believes it', () => {
  it('reads WOLFPACK_EQ_DIRS before falling back to watched logs', () => {
    const fn = agent.slice(agent.indexOf('function _eqSetupDirs()'),
                           agent.indexOf('function _eqSetupDirs()') + 900);
    expect(fn).toMatch(/WOLFPACK_EQ_DIRS/);
    expect(fn.indexOf('WOLFPACK_EQ_DIRS')).toBeLessThan(fn.indexOf('stats.watchedLogs'));
  });

  it('splits on the platform path delimiter, not a comma', () => {
    expect(agent).toMatch(/plural\.split\(path\.delimiter\)/);
  });

  it('the dashboard banner asks the same question as the setup button', () => {
    // These two disagreeing IS the bug: one said "no folder", the other had
    // one. Both now read the same source.
    expect(agent).toMatch(/const hasFolders = \$\{\(process\.env\.WOLFPACK_EQ_DIRS \|\| process\.env\.WOLFPACK_EQ_DIR\) \? 'true' : 'false'\}/);
  });
});

describe('TAKP installs are found without browsing', () => {
  it('has named TAKP paths on the common drives', () => {
    expect(main).toContain("'C:\\\\TAKP', 'C:\\\\TAKPv22'");
  });

  it('also walks drive roots for any takp* folder, because the version moves', () => {
    // C:\TAKPv22 today, C:\TAKPv23 next release — a fixed string goes stale, so
    // the named entries are only the fast path.
    expect(main).toMatch(/function _takpRoots\(localDrives\)/);
    expect(main).toMatch(/if \(!\/\^takp\/i\.test\(name\)\) continue;/);
    expect(main).toMatch(/for \(const root of _takpRoots\(local\)\) probe\(root, 'common'\);/);
  });

  it('only walks LOCAL fixed drives', () => {
    // The whole reason the scan takes a drive set: probing an absent or network
    // drive costs seconds and was the "Settings is frozen" report.
    expect(main).toMatch(/for \(const root of _takpRoots\(local\)\)/);
    const fn = main.slice(main.indexOf('function _takpRoots'), main.indexOf('function _findEqInstallsUncached'));
    expect(fn).toMatch(/localDrives && localDrives\.size/);
  });

  it('survives an unreadable drive root without throwing', () => {
    const fn = main.slice(main.indexOf('function _takpRoots'), main.indexOf('function _findEqInstallsUncached'));
    expect(fn).toMatch(/catch \{ \/\* drive not readable/);
  });
});

// The matching itself, run for real against a temp tree. The source assertions
// above prove the call site; this proves the function does what it says.
describe('_takpRoots picks the right folders', () => {
  const os = require('node:os');
  const fsx = require('node:fs');

  // Lift the function out of main.js — it only touches fs + path, so it runs
  // anywhere. path.join(root, path.sep) is what makes a temp dir a valid "root".
  const src = main.slice(main.indexOf('function _takpRoots'), main.indexOf('function _findEqInstallsUncached'));
  const _takpRoots = new Function('fs', 'path', src + '\nreturn _takpRoots;')(fsx, path);

  function tree(names, files = {}) {
    const root = fsx.mkdtempSync(path.join(os.tmpdir(), 'takp-'));
    for (const n of names) fsx.mkdirSync(path.join(root, n));
    for (const [n, _] of Object.entries(files)) fsx.writeFileSync(path.join(root, n), 'x');
    return root;
  }

  it('finds a versioned TAKP folder', () => {
    const root = tree(['TAKPv22', 'Windows', 'Users']);
    expect(_takpRoots(new Set([root]))).toEqual([path.join(root, 'TAKPv22')]);
  });

  it('is case-insensitive and version-agnostic', () => {
    const root = tree(['takp', 'TAKPv23', 'TakpBeta']);
    const got = _takpRoots(new Set([root])).map(p => path.basename(p)).sort();
    expect(got).toEqual(['TAKPv23', 'TakpBeta', 'takp']);
  });

  it('ignores a FILE called takp-something', () => {
    // A stray installer or zip must not be offered as an install folder.
    const root = tree(['TAKPv22'], { 'takp-installer.exe': 1 });
    expect(_takpRoots(new Set([root]))).toEqual([path.join(root, 'TAKPv22')]);
  });

  it('returns nothing when there is no TAKP folder', () => {
    expect(_takpRoots(new Set([tree(['Windows', 'Program Files'])]))).toEqual([]);
  });

  it('does not throw on a root it cannot read', () => {
    expect(() => _takpRoots(new Set(['/definitely/not/here']))).not.toThrow();
    expect(_takpRoots(new Set(['/definitely/not/here']))).toEqual([]);
  });

  it('walks several drives', () => {
    const a = tree(['TAKPv22']), b = tree(['takp']);
    expect(_takpRoots(new Set([a, b])).length).toBe(2);
  });
});

describe('the onboarding says WHY there are no characters', () => {
  const loading = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'loading.html'), 'utf8');

  it('distinguishes "no folder" from "folder, no logs"', () => {
    // Pyxil had configured C:\TAKPv22 and still got "configure an EverQuest
    // folder above" — which reads as "the thing you just did did not work",
    // when her actual state needed no change in Mimic at all.
    expect(loading).toMatch(/var haveFolder = \(_checkedFound\.size \+ _manualFolders\.length\) > 0;/);
  });

  it('names the actual fix — /log on — rather than blaming the folder', () => {
    expect(loading).toMatch(/type <code>\/log on<\/code>/);
    expect(loading).toMatch(/Set up EQ for me/);
  });

  it('warns that EQ must be closed first', () => {
    // EQ rewrites eqclient.ini on exit, so a write while it runs is lost. The
    // setup button refuses in that case; saying so up front saves a round trip.
    expect(loading).toMatch(/close EverQuest first/i);
  });

  it('the badge stops claiming "0 chars" when the folder is fine', () => {
    expect(loading).toMatch(/badge\.textContent = haveFolder \? 'no logs yet' : '0 chars';/);
  });
});
