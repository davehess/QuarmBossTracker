// test/resolution-lock.test.js — the eqclient.ini [VideoMode] transform.
//
// THE REQUIREMENT (Hitya, 2026-08-24, verbatim): "make sure we're resetting the
// height and width each time the game tries to overwrite it into the crapped
// 4:3 formats it expects."
//
// The old EQ client rewrites eqclient.ini's [VideoMode] block on exit and from
// its first-run display dialog, stomping a Steam Deck's 1280×800 back to
// 640×480 / 800×600 / 1024×768. applyVideoMode is the pure half of the fix —
// and because it edits a file the CLIENT owns, "does not touch anything else"
// matters as much as "corrects the resolution":
//
//   • an already-correct file must come back BYTE-IDENTICAL with changed:false
//     — a no-op rewrite churns the mtime, and our own fs.watch would feed that
//     straight back as another change event;
//   • CRLF is what EQ writes; normalising it is a diff across the whole file;
//   • no [VideoMode] section → no-op. We never invent one: if the client has
//     not written the block there is no user choice to defend;
//   • other sections are never touched — the top-of-file keys EQ writes
//     (VideoModeBitsPerPixel, WindowedMode) have names that deliberately look
//     like ours.
//
// Run: npx vitest run test/resolution-lock.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const { applyVideoMode, enforce } = require('../apps/mimic/resolutionLock.js');
const mainSrc = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));

// A real eqclient.ini from a Deck, tonight (field capture): note the
// top-section VideoModeBitsPerPixel + WindowedMode keys ABOVE the first
// header, and CRLF throughout — this is what EQ actually writes.
const FIELD_INI = [
  'VideoModeBitsPerPixel=32',
  'WindowedMode=TRUE',
  '[Defaults]',
  'Width=1024',
  'Height=768',
  '[VideoMode]',
  'Width=1280',
  'Height=800',
  'RefreshRate=60',
  'BitsPerPixel=32',
  '[Options]',
  'Log=TRUE',
  '',
].join('\r\n');

describe('the 4:3 stomp is corrected', () => {
  it('rewrites Width/Height inside [VideoMode] back to the locked resolution', () => {
    const stomped = FIELD_INI.replace('Width=1280', 'Width=800').replace('Height=800\r\nRefreshRate', 'Height=600\r\nRefreshRate');
    const r = applyVideoMode(stomped, 1280, 800);
    expect(r.changed).toBe(true);
    expect(r.from).toEqual({ width: 800, height: 600 });
    expect(r.to).toEqual({ width: 1280, height: 800 });
    expect(r.out).toContain('[VideoMode]\r\nWidth=1280\r\nHeight=800\r\n');
  });

  it('corrects each of the 4:3 modes the client falls back to', () => {
    for (const [w, h] of [[640, 480], [800, 600], [1024, 768]]) {
      const src = `[VideoMode]\r\nWidth=${w}\r\nHeight=${h}\r\n`;
      const r = applyVideoMode(src, 1280, 800);
      expect(r.changed).toBe(true);
      expect(r.from).toEqual({ width: w, height: h });
      expect(r.out).toBe('[VideoMode]\r\nWidth=1280\r\nHeight=800\r\n');
    }
  });

  it('corrects only the half that drifted', () => {
    const r = applyVideoMode('[VideoMode]\r\nWidth=1280\r\nHeight=768\r\n', 1280, 800);
    expect(r.changed).toBe(true);
    expect(r.out).toBe('[VideoMode]\r\nWidth=1280\r\nHeight=800\r\n');
  });

  it('locks to 1440×900 too — quarm.guide Bonus Step 7, not just the native panel', () => {
    const r = applyVideoMode('[VideoMode]\r\nWidth=1024\r\nHeight=768\r\n', 1440, 900);
    expect(r.out).toBe('[VideoMode]\r\nWidth=1440\r\nHeight=900\r\n');
  });
});

describe('an already-correct file is left alone', () => {
  it('is BYTE-IDENTICAL and reports changed:false', () => {
    const r = applyVideoMode(FIELD_INI, 1280, 800);
    expect(r.changed).toBe(false);
    // Byte-for-byte, not merely equal-looking: a no-op rewrite would churn the
    // mtime and re-trigger our own fs.watch.
    expect(r.out).toBe(FIELD_INI);
    expect(Buffer.from(r.out, 'latin1').equals(Buffer.from(FIELD_INI, 'latin1'))).toBe(true);
  });

  it('still reports what it found, so the caller can log old → new', () => {
    const r = applyVideoMode(FIELD_INI, 1280, 800);
    expect(r.from).toEqual({ width: 1280, height: 800 });
  });

  it('treats a spaced value as already-correct rather than reformatting it', () => {
    // Rewriting `Width= 1280 ` to `Width=1280` would be a byte change for no
    // behavioural gain — the resolution is already what the user asked for.
    const src = '[VideoMode]\r\nWidth= 1280 \r\nHeight= 800 \r\n';
    const r = applyVideoMode(src, 1280, 800);
    expect(r.changed).toBe(false);
    expect(r.out).toBe(src);
  });
});

describe('line endings survive', () => {
  it('preserves CRLF on the lines it rewrites AND the ones it does not', () => {
    const r = applyVideoMode(FIELD_INI.replace('Width=1280', 'Width=640'), 1280, 800);
    expect(r.changed).toBe(true);
    // Every terminator in the output is still CRLF — no lone \n anywhere.
    expect(/[^\r]\n/.test(r.out)).toBe(false);
    expect(r.out.split('\r\n').length).toBe(FIELD_INI.split('\r\n').length);
  });

  it('preserves LF-only files as LF-only', () => {
    const src = '[VideoMode]\nWidth=800\nHeight=600\nRefreshRate=60\n';
    const r = applyVideoMode(src, 1280, 800);
    expect(r.out).toBe('[VideoMode]\nWidth=1280\nHeight=800\nRefreshRate=60\n');
    expect(r.out).not.toContain('\r');
  });

  it('preserves a mixed file line by line', () => {
    const src = '[VideoMode]\r\nWidth=800\nHeight=600\r\n';
    const r = applyVideoMode(src, 1280, 800);
    expect(r.out).toBe('[VideoMode]\r\nWidth=1280\nHeight=800\r\n');
  });

  it('does not append a trailing newline to a file that lacks one', () => {
    const src = '[VideoMode]\r\nWidth=800\r\nHeight=600';
    const r = applyVideoMode(src, 1280, 800);
    expect(r.out).toBe('[VideoMode]\r\nWidth=1280\r\nHeight=800');
  });
});

describe('[VideoMode] missing → no-op, never invent a section', () => {
  it('leaves a file with no [VideoMode] byte-identical', () => {
    const src = 'VideoModeBitsPerPixel=32\r\nWindowedMode=TRUE\r\n[Options]\r\nLog=TRUE\r\n';
    const r = applyVideoMode(src, 1280, 800);
    expect(r.changed).toBe(false);
    expect(r.out).toBe(src);
    expect(r.out).not.toContain('[VideoMode]');
    expect(r.from).toEqual({ width: null, height: null });
  });

  it('leaves an empty file empty', () => {
    const r = applyVideoMode('', 1280, 800);
    expect(r.changed).toBe(false);
    expect(r.out).toBe('');
  });

  it('does not invent Width/Height keys inside an existing but bare [VideoMode]', () => {
    // The client writes the keys with the section; adding them ourselves means
    // guessing at a format we only half-understand, in a file that decides
    // whether EQ starts.
    const src = '[VideoMode]\r\nRefreshRate=60\r\nBitsPerPixel=32\r\n';
    const r = applyVideoMode(src, 1280, 800);
    expect(r.changed).toBe(false);
    expect(r.out).toBe(src);
    expect(r.from).toEqual({ width: null, height: null });
  });
});

describe('other sections are never touched', () => {
  it('ignores Width/Height that belong to a different section', () => {
    const src = '[Defaults]\r\nWidth=1024\r\nHeight=768\r\n[VideoMode]\r\nWidth=800\r\nHeight=600\r\n';
    const r = applyVideoMode(src, 1280, 800);
    expect(r.out).toBe('[Defaults]\r\nWidth=1024\r\nHeight=768\r\n[VideoMode]\r\nWidth=1280\r\nHeight=800\r\n');
    expect(r.from).toEqual({ width: 800, height: 600 });
  });

  it('ignores Width/Height above the first section header', () => {
    const src = 'Width=1024\r\nHeight=768\r\n[VideoMode]\r\nWidth=800\r\nHeight=600\r\n';
    const r = applyVideoMode(src, 1280, 800);
    expect(r.out.startsWith('Width=1024\r\nHeight=768\r\n')).toBe(true);
  });

  it('stops at the next header — a section AFTER [VideoMode] is safe', () => {
    const src = '[VideoMode]\r\nWidth=800\r\nHeight=600\r\n[UI]\r\nWidth=640\r\nHeight=480\r\n';
    const r = applyVideoMode(src, 1280, 800);
    expect(r.out).toBe('[VideoMode]\r\nWidth=1280\r\nHeight=800\r\n[UI]\r\nWidth=640\r\nHeight=480\r\n');
  });

  it('leaves the sibling [VideoMode] keys the client also writes alone', () => {
    const r = applyVideoMode(FIELD_INI.replace('Width=1280', 'Width=800'), 1280, 800);
    expect(r.out).toContain('RefreshRate=60');
    expect(r.out).toContain('BitsPerPixel=32');
    expect(r.out).toContain('VideoModeBitsPerPixel=32');
    expect(r.out).toContain('WindowedMode=TRUE');
  });

  it('does not match keys that merely START with Width/Height', () => {
    const src = '[VideoMode]\r\nWidth2=800\r\nHeightScale=600\r\nWidth=800\r\nHeight=600\r\n';
    const r = applyVideoMode(src, 1280, 800);
    expect(r.out).toBe('[VideoMode]\r\nWidth2=800\r\nHeightScale=600\r\nWidth=1280\r\nHeight=800\r\n');
  });

  it('matches the section name case-insensitively (the client is inconsistent)', () => {
    const r = applyVideoMode('[VIDEOMODE]\r\nwidth=800\r\nheight=600\r\n', 1280, 800);
    expect(r.changed).toBe(true);
    // The KEY's own casing is preserved — we rewrite the value, not the line.
    expect(r.out).toBe('[VIDEOMODE]\r\nwidth=1280\r\nheight=800\r\n');
  });
});

describe('a garbage target is refused, not written', () => {
  it('no-ops on a missing / zero / non-integer resolution', () => {
    const src = '[VideoMode]\r\nWidth=800\r\nHeight=600\r\n';
    for (const [w, h] of [[0, 800], [1280, 0], [null, null], ['wide', 800], [1280.5, 800], [-1280, 800]]) {
      const r = applyVideoMode(src, w, h);
      expect(r.changed).toBe(false);
      expect(r.out).toBe(src);
    }
  });
});

// ── The I/O half ────────────────────────────────────────────────────────────
// enforce() takes an injectable fs so the write discipline is testable without
// touching a real EQ folder. What is pinned here is the part that would cost a
// user their client if we got it wrong: never write when nothing changed, back
// up ONCE, and land the new bytes via a temp + rename rather than in place.
function fakeFs(files) {
  const calls = [];
  return {
    calls,
    store: files,
    readdirSync(dir) { calls.push(['readdir', dir]); return Object.keys(files).filter(f => f.startsWith(dir + '/')).map(f => f.slice(dir.length + 1)); },
    readFileSync(p) { calls.push(['read', p]); if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files[p]; },
    writeFileSync(p, body) { calls.push(['write', p]); files[p] = body; },
    renameSync(a, b) { calls.push(['rename', a, b]); files[b] = files[a]; delete files[a]; },
    copyFileSync(a, b) { calls.push(['copy', a, b]); files[b] = files[a]; },
    existsSync(p) { return p in files; },
    rmSync(p) { delete files[p]; },
  };
}
const INI = '/eq/eqclient.ini';

describe('enforce — the write discipline', () => {
  it('does not write AT ALL when the file is already correct (no mtime churn)', () => {
    const fsImpl = fakeFs({ [INI]: FIELD_INI });
    const lines = [];
    const r = enforce({ eqDir: '/eq', width: 1280, height: 800, trigger: 'eq-closed', log: l => lines.push(l), fsImpl });
    expect(r.changed).toBe(false);
    expect(r.reason).toBe('already-locked');
    expect(fsImpl.calls.some(c => c[0] === 'write' || c[0] === 'rename' || c[0] === 'copy')).toBe(false);
    expect(lines).toEqual([]);   // silence is correct — nothing happened
    expect(fsImpl.store[INI]).toBe(FIELD_INI);
  });

  it('backs up once, then writes via temp + rename', () => {
    const fsImpl = fakeFs({ [INI]: FIELD_INI.replace('Width=1280', 'Width=800') });
    const r = enforce({ eqDir: '/eq', width: 1280, height: 800, trigger: 'eq-closed', fsImpl });
    expect(r.changed).toBe(true);
    const verbs = fsImpl.calls.filter(c => ['copy', 'write', 'rename'].includes(c[0])).map(c => c[0]);
    // Backup BEFORE the write, and the write never lands on the target directly.
    expect(verbs).toEqual(['copy', 'write', 'rename']);
    expect(fsImpl.calls.find(c => c[0] === 'write')[1]).toBe(INI + '.mimic-tmp');
    expect(fsImpl.calls.find(c => c[0] === 'rename')[2]).toBe(INI);
    expect(fsImpl.store[INI + '.mimic-bak']).toBeDefined();
    expect(fsImpl.store[INI + '.mimic-tmp']).toBeUndefined();
    expect(fsImpl.store[INI]).toContain('[VideoMode]\r\nWidth=1280\r\nHeight=800\r\n');
  });

  it('never overwrites the backup — it is the pristine pre-Mimic file', () => {
    const pristine = FIELD_INI.replace('Width=1280', 'Width=640');
    const fsImpl = fakeFs({ [INI]: pristine });
    enforce({ eqDir: '/eq', width: 1280, height: 800, fsImpl });
    // A second stomp + a second enforcement must not replace the .bak with our
    // own previous output — that would destroy the only thing it exists for.
    fsImpl.store[INI] = FIELD_INI.replace('Width=1280', 'Width=800');
    enforce({ eqDir: '/eq', width: 1280, height: 800, fsImpl });
    expect(fsImpl.store[INI + '.mimic-bak']).toBe(pristine);
  });

  it('logs exactly one line carrying old → new and which trigger fired', () => {
    const fsImpl = fakeFs({ [INI]: '[VideoMode]\r\nWidth=800\r\nHeight=600\r\n' });
    const lines = [];
    enforce({ eqDir: '/eq', width: 1280, height: 800, trigger: 'ini-changed', log: l => lines.push(l), fsImpl });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('ini-changed');
    expect(lines[0]).toContain('800×600');
    expect(lines[0]).toContain('1280×800');
    expect(lines[0].endsWith('\n')).toBe(true);
  });

  it('guards a missing file and a missing folder, and never creates either', () => {
    const empty = fakeFs({});
    expect(enforce({ eqDir: '/eq', width: 1280, height: 800, fsImpl: empty }).reason).toBe('missing-file');
    expect(enforce({ width: 1280, height: 800, fsImpl: empty }).reason).toBe('no-eq-dir');
    expect(Object.keys(empty.store)).toEqual([]);
  });

  it('finds the file whatever its case — Deck prefixes are case-sensitive', () => {
    const fsImpl = fakeFs({ '/eq/EQClient.ini': '[VideoMode]\r\nWidth=800\r\nHeight=600\r\n' });
    const r = enforce({ eqDir: '/eq', width: 1280, height: 800, fsImpl });
    expect(r.changed).toBe(true);
    expect(r.path).toBe('/eq/EQClient.ini');
  });
});

// ── The wiring in main.js ───────────────────────────────────────────────────
// Source-sliced against the shipped apps/mimic/main.js: Electron main-process
// code can't be imported (it needs a real `app`), and the properties below are
// the ones whose absence is SILENT — a lock that writes while EQ is up corrupts
// the file, and a lock nothing calls simply never fires.
describe('main.js wiring', () => {
  it('EVERY enforcement is gated on eqgame not running', () => {
    // EQ holds eqclient.ini open and flushes [VideoMode] at exit, so a write
    // landing mid-session is overwritten anyway and risks a torn file.
    const fn = sliceBlock(mainSrc, 'async function _enforceResolutionLock(trigger) {', '\n}');
    expect(fn).toMatch(/if \(await _isEqRunning\(\)\) return;/);
    // …and the gate precedes the write, not the other way round.
    expect(fn.indexOf('_isEqRunning')).toBeLessThan(fn.indexOf('resolutionLock.enforce'));
  });

  it('fires on the EQ running→stopped edge — the moment the stomp lands', () => {
    const fn = sliceBlock(mainSrc, 'async function _pollEqPresence() {', '\n}');
    expect(fn).toMatch(/wasRunning && !running/);
    expect(fn).toMatch(/_enforceResolutionLock\('eq-closed'\)/);
    // Settled, not immediate: the client is still flushing the ini as it exits.
    expect(fn).toMatch(/RESOLUTION_LOCK_SETTLE_MS/);
  });

  it('fires on an eqclient.ini change while EQ is down', () => {
    const fn = sliceBlock(mainSrc, 'async function _armResolutionLockWatch() {', '\n}');
    expect(fn).toMatch(/_enforceResolutionLock\('ini-changed'\)/);
    expect(fn).toMatch(/eqclient\\\.ini/);
    // Watch the DIRECTORY: EQ replaces the file, which detaches a file-level
    // inotify watch after the very first stomp.
    expect(fn).toMatch(/fs\.watch\(dir,/);
  });

  it('wires the watcher LINUX-ONLY — Windows behaviour is unchanged', () => {
    const fn = sliceBlock(mainSrc, 'async function _armResolutionLockWatch() {', '\n}');
    expect(fn).toMatch(/if \(process\.platform !== 'linux'\) return;/);
  });

  it('defaults OFF and never auto-enables, even on a Deck', () => {
    expect(mainSrc).toMatch(/resolutionLock: \{ enabled: false, width: null, height: null \}/);
    // The Deck suggestion supplies the NUMBERS, never the switch: the target
    // resolver bails on `enabled` before it ever looks at the platform.
    const fn = sliceBlock(mainSrc, 'function _resolutionLockTarget(cfg) {', '\n}');
    expect(fn).toMatch(/if \(!rl\.enabled\) return null;/);
    expect(fn.indexOf('rl.enabled')).toBeLessThan(fn.indexOf('_deckDetected'));
  });

  it('suggests 1280×800 on a detected Deck and refuses to guess anywhere else', () => {
    expect(mainSrc).toMatch(/const DECK_SUGGESTED_RESOLUTION = \{ width: 1280, height: 800 \}/);
    const fn = sliceBlock(mainSrc, 'function _resolutionLockTarget(cfg) {', '\n}');
    expect(fn).toMatch(/_deckDetected\(\) \? \{ \.\.\.DECK_SUGGESTED_RESOLUTION \} : null/);
  });

  it('reuses the existing Deck detection rather than adding a second one', () => {
    const fn = sliceBlock(mainSrc, 'function _deckDetected() {', '\n}');
    expect(fn).toMatch(/_deckModeCached/);
    expect(fn).toMatch(/process\.platform === 'linux'/);
  });

  it('locks the eqclient.ini in the EQ folder Mimic is actually watching', () => {
    const fn = sliceBlock(mainSrc, 'async function _resolutionLockEqDir() {', '\n}');
    expect(fn).toMatch(/resolveEqDirsWithLogs\(\)/);
    expect(fn).toMatch(/dirs\[0\] \|\| knownDirs\[0\] \|\| null/);
  });
});
