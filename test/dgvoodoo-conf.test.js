// The dgVoodoo.conf FPS cap — the only frame limiter this client honours.
//
// The lutris.net Quarm installer's own notes (revision `quarmNov2025`) say EQ
// IGNORES the FPS limit in eqclient.ini and that `FPSLimit` in dgVoodoo.conf is
// what actually works. The shipped conf has `FPSLimit = 0` (unlimited), which
// on a Steam Deck means the fan spinning up on character select and roughly
// half the battery life.
//
// What these tests actually protect: dgVoodoo.conf is ~330 lines of inline
// documentation for every other knob the user has, and it sits next to
// eqgame.exe in the renderer path. Reformatting it, corrupting it, or writing a
// section into a file that turns out not to be dgVoodoo.conf all present as
// "the game stopped starting" — the single hardest thing to debug on a Deck
// (RUNBOOK §5). So the transform is byte-exact by construction and the fixtures
// below are lifted from the real file.
//
// Run: npx vitest run test/dgvoodoo-conf.test.js

import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { ROOT } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const D = require_(path.join(ROOT, 'apps', 'mimic', 'dgvoodooConf.js'));

// Verbatim shape from the real dgVoodoo.conf (v0x280) shipped with the install:
// aligned `Key<spaces>= value`, a comment block above each section.
const REAL = [
  ';--------------------------------------------------------------------------',
  '',
  '[GeneralExt]',
  '',
  ';       FPSLimit: An integer or rational (fractional) value, 0 = unlimited',
  '',
  'DesktopResolution                    = ',
  'Resampling                           = bilinear',
  'FPSLimit                             = 0',
  'Environment                          = ',
  '',
  '[DirectX]',
  '',
  'VideoCard                           = internal3D',
  'dgVoodooWatermark                   = false',
  '',
].join('\n');

describe('applyFpsLimit', () => {
  it('caps an unlimited install and reports what it changed', () => {
    const r = D.applyFpsLimit(REAL, 60);
    expect(r.changed).toBe(true);
    expect(r.from).toBe('0');
    expect(r.to).toBe(60);
    expect(r.out).toContain('FPSLimit                             = 60');
  });

  it('preserves the alignment padding rather than reformatting the line', () => {
    // The file is column-aligned; collapsing that is churn the user did not ask
    // for and makes any future diff of theirs unreadable.
    const r = D.applyFpsLimit(REAL, 90);
    expect(r.out).toContain('FPSLimit                             = 90');
    expect(r.out).not.toContain('FPSLimit = 90');
  });

  it('is a byte-identical no-op when already correct', () => {
    const once = D.applyFpsLimit(REAL, 60).out;
    const twice = D.applyFpsLimit(once, 60);
    expect(twice.changed).toBe(false);
    expect(twice.out).toBe(once);          // same string instance semantics
  });

  it('changes nothing else in the file', () => {
    const r = D.applyFpsLimit(REAL, 60);
    // Every line except the FPSLimit one must survive verbatim.
    const before = REAL.split('\n').filter(l => !l.startsWith('FPSLimit'));
    const after  = r.out.split('\n').filter(l => !l.startsWith('FPSLimit'));
    expect(after).toEqual(before);
  });

  it('keeps CRLF files CRLF', () => {
    const crlf = REAL.replace(/\n/g, '\r\n');
    const r = D.applyFpsLimit(crlf, 60);
    expect(r.changed).toBe(true);
    expect(r.out).toContain('\r\n');
    expect(r.out).not.toMatch(/[^\r]\n/);
  });

  it('accepts 0 — dgVoodoo\'s own encoding for unlimited', () => {
    const capped = D.applyFpsLimit(REAL, 60).out;
    const back = D.applyFpsLimit(capped, 0);
    expect(back.changed).toBe(true);
    expect(back.to).toBe(0);
  });

  it('refuses garbage rather than writing it into the renderer config', () => {
    for (const bad of [null, undefined, '', 'sixty', -1, 1.5, 99999, NaN]) {
      const r = D.applyFpsLimit(REAL, bad);
      expect(r.changed, `value ${JSON.stringify(bad)}`).toBe(false);
      expect(r.out).toBe(REAL);
    }
  });
});

describe('section scoping', () => {
  it('only touches FPSLimit inside [GeneralExt]', () => {
    // A same-named key in another section must be left alone.
    const src = [
      '[Glide]',
      'FPSLimit                             = 0',
      '[GeneralExt]',
      'FPSLimit                             = 0',
    ].join('\n');
    const r = D.applyFpsLimit(src, 60);
    const lines = r.out.split('\n');
    expect(lines[1]).toContain('= 0');      // [Glide] untouched
    expect(lines[3]).toContain('= 60');     // [GeneralExt] changed
  });

  it('leaves commented-out keys commented', () => {
    // dgVoodoo.conf ships several keys as `;Key = value`. Turning one live by
    // accident is a silent behaviour change.
    // ⚠ This asserts the BEHAVIOUR, not the explicit comment guard in the
    // module: the key regex already excludes `;`-prefixed lines, so deleting
    // that guard leaves this test green (confirmed by mutation). Both are kept
    // — the guard for when the regex is broadened, this test for the property
    // that actually matters to a user.
    const src = '[GeneralExt]\n;FPSLimit                             = 0\n';
    const r = D.applyFpsLimit(src, 60);
    expect(r.changed).toBe(false);
    expect(r.out).toBe(src);
  });

  it('reports when [GeneralExt] is absent instead of inventing it', () => {
    // Writing a section into a file we do not recognise is how you break the
    // renderer, which is the hardest failure to recover from on a Deck.
    const r = D.applyFpsLimit('[DirectX]\nVideoCard = internal3D\n', 60);
    expect(r.sawSection).toBe(false);
    expect(r.changed).toBe(false);
  });

  it('is case-insensitive about the section and key spelling', () => {
    const src = '[generalext]\nfpslimit                             = 0\n';
    const r = D.applyFpsLimit(src, 60);
    expect(r.changed).toBe(true);
    expect(r.out).toContain('= 60');
  });
});

describe('applyWatermark', () => {
  it('turns the watermark off in [DirectX] without opening a Windows control panel', () => {
    const src = '[DirectX]\ndgVoodooWatermark                   = true\n';
    const r = D.applyWatermark(src, false);
    expect(r.changed).toBe(true);
    expect(r.out).toContain('dgVoodooWatermark                   = false');
  });

  it('no-ops on the shipped conf, which already has it off', () => {
    expect(D.applyWatermark(REAL, false).changed).toBe(false);
  });
});

describe('enforce', () => {
  const mkFs = (files) => ({
    _f: files,
    existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFileSync: (p) => files[p],
    writeFileSync: (p, d) => { files[p] = d; },
    copyFileSync: (a, b) => { files[b] = files[a]; },
    renameSync: (a, b) => { files[b] = files[a]; delete files[a]; },
  });

  it('writes the cap and leaves a one-time backup', () => {
    const p = '/eq/dgVoodoo.conf';
    const F = mkFs({ [p]: REAL });
    const r = D.enforce('/eq', { fps: 60 }, F);
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);
    expect(r.backedUp).toBe(p + '.mimic-bak');
    expect(F._f[p]).toContain('= 60');
    expect(F._f[p + '.mimic-bak']).toBe(REAL);      // pre-Mimic original kept
  });

  it('never overwrites an existing backup on a later run', () => {
    const p = '/eq/dgVoodoo.conf';
    const F = mkFs({ [p]: REAL });
    D.enforce('/eq', { fps: 60 }, F);
    D.enforce('/eq', { fps: 90 }, F);
    // The backup must still be the ORIGINAL, not the 60fps intermediate.
    expect(F._f[p + '.mimic-bak']).toBe(REAL);
    expect(F._f[p]).toContain('= 90');
  });

  it('does not write at all when nothing changed', () => {
    const p = '/eq/dgVoodoo.conf';
    const capped = D.applyFpsLimit(REAL, 60).out;
    const F = mkFs({ [p]: capped });
    const r = D.enforce('/eq', { fps: 60 }, F);
    expect(r.changed).toBe(false);
    expect(F._f[p + '.mimic-bak']).toBeUndefined();  // no backup, no churn
  });

  it('reports a missing conf rather than creating one', () => {
    const r = D.enforce('/eq', { fps: 60 }, mkFs({}));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no dgVoodoo\.conf/);
  });

  it('refuses a file with no [GeneralExt] and says why', () => {
    const p = '/eq/dgVoodoo.conf';
    const F = mkFs({ [p]: '[DirectX]\nVideoCard = internal3D\n' });
    const r = D.enforce('/eq', { fps: 60 }, F);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/GeneralExt/);
    expect(F._f[p]).toBe('[DirectX]\nVideoCard = internal3D\n');   // untouched
  });

  it('writes through a tmp file so a crash cannot truncate the conf', () => {
    const p = '/eq/dgVoodoo.conf';
    const F = mkFs({ [p]: REAL });
    const seen = [];
    F.writeFileSync = (q, d) => { seen.push(q); F._f[q] = d; };
    D.enforce('/eq', { fps: 60 }, F);
    // The only direct write target is the tmp path; the conf itself arrives by
    // rename, which is atomic.
    expect(seen).toEqual([p + '.mimic-tmp']);
  });

  it('reads and writes latin1 so high bytes survive the round trip', () => {
    const p = '/eq/dgVoodoo.conf';
    const F = mkFs({ [p]: REAL });
    const enc = [];
    F.readFileSync = (q, e) => { enc.push(['r', e]); return F._f[q]; };
    F.writeFileSync = (q, d, e) => { enc.push(['w', e]); F._f[q] = d; };
    D.enforce('/eq', { fps: 60 }, F);
    expect(enc).toContainEqual(['r', 'latin1']);
    expect(enc).toContainEqual(['w', 'latin1']);
  });

  it('looks beside eqgame.exe, not under drive_c', () => {
    // On a Lutris install the prefix root IS the game dir; dgVoodoo reads its
    // conf from the application directory either way.
    expect(D.confPathFor('/home/deck/Games/everquest')).toBe('/home/deck/Games/everquest/dgVoodoo.conf');
  });
});
