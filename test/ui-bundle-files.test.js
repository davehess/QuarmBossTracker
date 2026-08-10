// UI Studio backup: WHICH ini files get captured for a character.
//
// Why this test exists (2026-08-09): the capture list was an ENUMERATION of the
// filename conventions we happened to know about — UI_<Char>, <Char>, Sock_,
// Socials_, *spellsets*. Anything else silently did not travel, so a player
// moving to a second machine lost whatever lived in a file nobody had listed
// (bandolier sets), and zeal.ini was missing outright, dropping every Zeal
// setting. The fix adds zeal.ini to the globals plus a name-boundary catch-all
// for per-character files.
//
// _readUiBundle touches the filesystem and lives in an Electron main process, so
// this MIRRORS its selection predicate. Keep the two in lock-step: the mirror is
// the block guarded by `if (/\.ini$/i.test(f))` in apps/mimic/main.js, plus the
// UI_/spellsets special cases above it.
//
// Run: npx vitest run test/ui-bundle-files.test.js

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { ROOT } from './_source-slice.js';

const MIMIC_MAIN = path.join(ROOT, 'apps', 'mimic', 'main.js');
const src = fs.readFileSync(MIMIC_MAIN, 'utf8');

// MIRROR of the selection in _readUiBundle.
const GLOBALS = ['eqclient.ini', 'zeal.ini'];
function wanted(entries, character) {
  const c = String(character).trim();
  const cLower = c.toLowerCase();
  const want = new Set([
    ...GLOBALS,
    `UI_${c}_pq.proj.ini`, `${c}_pq.proj.ini`,
    `Sock_${c}_pq.proj.ini`, `Socials_${c}_pq.proj.ini`,
  ]);
  for (const f of entries) {
    const m = f.match(/^UI_([A-Za-z]+).*\.ini$/i);
    if (m && m[1].toLowerCase() === cLower) want.add(f);
    const ms = f.match(/^([A-Za-z]+).*spellsets.*\.ini$/i);
    if (ms && ms[1].toLowerCase() === cLower) want.add(f);
    if (/\.ini$/i.test(f)) {
      const lf = f.toLowerCase();
      if (lf.startsWith(cLower + '_') || lf.startsWith(cLower + '.') ||
          lf.includes('_' + cLower + '_') || lf.includes('_' + cLower + '.')) {
        want.add(f);
      }
    }
  }
  // Only files that actually exist on disk are read.
  const have = new Set(entries.map(e => e.toLowerCase()));
  return [...want].filter(w => have.has(w.toLowerCase()));
}

// A realistic EQ folder, including files the old enumeration did NOT know about.
const FOLDER = [
  'eqclient.ini', 'zeal.ini',
  'Hitya_pq.proj.ini', 'UI_Hitya_pq.proj.ini',
  'Sock_Hitya_pq.proj.ini', 'Socials_Hitya_pq.proj.ini',
  'Hitya_spellsets.ini',
  // REAL filenames, confirmed against Hitya's own EQ folder 2026-08-09 — these
  // are the two the old enumeration dropped on a machine move.
  'Hitya_bandolier.ini',            // [setname] → 4 item-id slots per weapon set
  'Hitya_protected.ini',            // itemid^Name, guards against destroying items
  'Bandolier_Hitya_pq.proj.ini',    // defensive: other plausible convention
  'Canopy_pq.proj.ini', 'UI_Canopy_pq.proj.ini',   // a DIFFERENT character
  'defaults.ini', 'notes.txt',
];

describe('UI Studio bundle — what travels to a new machine', () => {
  const got = wanted(FOLDER, 'Hitya');

  it('captures the globals, including zeal.ini', () => {
    expect(got).toContain('eqclient.ini');
    expect(got).toContain('zeal.ini');
  });

  it('captures every known per-character convention', () => {
    for (const f of ['Hitya_pq.proj.ini', 'UI_Hitya_pq.proj.ini',
                     'Sock_Hitya_pq.proj.ini', 'Socials_Hitya_pq.proj.ini',
                     'Hitya_spellsets.ini']) {
      expect(got).toContain(f);
    }
  });

  it('captures per-character files nobody enumerated (the actual bug)', () => {
    expect(got).toContain('Hitya_bandolier.ini');
    expect(got).toContain('Hitya_protected.ini');
    expect(got).toContain('Bandolier_Hitya_pq.proj.ini');
  });

  it('does NOT sweep in another character or non-ini files', () => {
    expect(got).not.toContain('Canopy_pq.proj.ini');
    expect(got).not.toContain('UI_Canopy_pq.proj.ini');
    expect(got).not.toContain('defaults.ini');
    expect(got).not.toContain('notes.txt');
  });

  it('name must sit on a boundary — a short name cannot match a longer one', () => {
    // 'Uil' must not drag in Uilnayar's files.
    const folder = ['Uilnayar_pq.proj.ini', 'UI_Uilnayar_pq.proj.ini', 'Uil_pq.proj.ini'];
    const short = wanted(folder, 'Uil');
    expect(short).toContain('Uil_pq.proj.ini');
    expect(short).not.toContain('Uilnayar_pq.proj.ini');
    expect(short).not.toContain('UI_Uilnayar_pq.proj.ini');
  });

  it('main.js actually ships both halves of the fix', () => {
    expect(src).toMatch(/UI_STUDIO_GLOBAL\s*=\s*\['eqclient\.ini',\s*'zeal\.ini'\]/);
    expect(src).toMatch(/lf\.startsWith\(cLower \+ '_'\)/);
  });
});
