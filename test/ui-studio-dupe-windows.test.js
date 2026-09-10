// test/ui-studio-dupe-windows.test.js — one window, one row.
//
// Hitya, 2026-09-02, with a screenshot: "UI studio shows multiple copies of
// several chats and windows." The header read "Hitya (2 ini files)" and
// "loaded 258 windows" for a layout holding about 129 — two of everything,
// with ZealItemDisplay0-4, Chat 14, Compass, Raid and ZealOptions all drawn
// twice on top of each other.
//
// ⚠ THE COSMETIC HALF IS NOT THE DANGEROUS HALF. UI Studio's bundle is
// deliberately several files (_readUiBundle enumerates the per-character inis
// and then catch-alls any other .ini belonging to the character), but EQ reads
// exactly ONE of them for window geometry. Dragging a duplicate was a coin flip
// over whether the edit landed in the file the client actually reads — and when
// it lost, Save reported success and nothing moved in game. Same silent-no-op
// class as the filename-case trap that _readUiBundle already warns about.
//
// Run: npx vitest run test/ui-studio-dupe-windows.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'ui-studio.html'), 'utf8');

// ⚠ End anchor is the comment opening the NEXT block, never a line of either
// function's body — a slice closed on the code under test turns every mutation
// into "suite failed to load", which reads like a kill and proves nothing.
const { _dedupeWindows, _fileRank } = evalBlock(
  sliceBlock(src, '  function _fileRank(fn, character){', '\n  // Parse + rescale + render whatever is currently in STATE.bundle.'),
  ['_dedupeWindows', '_fileRank'],
);

const UI   = 'UI_Hitya_pq.proj.ini';     // what EQ reads on Quarm
const CHAR = 'Hitya_pq.proj.ini';        // per-character client ini
const ALT  = 'UI_Hitya_pq.ini';          // a server-suffix variant
const w = (section, file, x) => ({ section, file, x });

describe('which copy survives', () => {
  it('keeps one row per window when two files carry it', () => {
    const out = _dedupeWindows([w('ChatWindow14', UI, 10), w('ChatWindow14', CHAR, 99)], 'Hitya');
    expect(out.kept).toHaveLength(1);
    expect(out.shadowed).toBe(1);
  });

  it('keeps the copy from the file EQ actually reads', () => {
    // The whole point. Keeping the other one is the silent-no-op: Save succeeds
    // and the window never moves in game.
    const out = _dedupeWindows([w('ChatWindow14', CHAR, 99), w('ChatWindow14', UI, 10)], 'Hitya');
    expect(out.kept[0].file).toBe(UI);
    expect(out.kept[0].x).toBe(10);
  });

  it('prefers UI_<char>_pq.proj.ini over another UI_ variant', () => {
    const out = _dedupeWindows([w('Compass', ALT, 5), w('Compass', UI, 7)], 'Hitya');
    expect(out.kept[0].file).toBe(UI);
  });

  it('ranks the files in the order EQ cares about', () => {
    expect(_fileRank(UI, 'Hitya')).toBeLessThan(_fileRank(ALT, 'Hitya'));
    expect(_fileRank(ALT, 'Hitya')).toBeLessThan(_fileRank(CHAR, 'Hitya'));
    expect(_fileRank(CHAR, 'Hitya')).toBeLessThan(_fileRank('zeal.ini', 'Hitya'));
  });

  it('matches the ini name case-insensitively', () => {
    // _readUiBundle keys the bundle by the REAL on-disk name, exact case, and
    // that case varies by machine — so ranking must not depend on it.
    expect(_fileRank('ui_hitya_PQ.PROJ.ini', 'HITYA')).toBe(0);
  });
});

describe('what it must not do', () => {
  it('leaves a layout with no duplicates completely untouched', () => {
    const rows = [w('Compass', UI, 1), w('BuffWindow', UI, 2), w('ChatWindow14', UI, 3)];
    const out = _dedupeWindows(rows, 'Hitya');
    expect(out.kept).toEqual(rows);
    expect(out.shadowed).toBe(0);
    expect(out.shadowFiles).toEqual({});
  });

  it('never merges two DIFFERENT windows', () => {
    // ZealItemDisplay0..4 are five separate windows that happen to look alike
    // on the canvas — collapsing them would delete four real rows.
    const rows = [0,1,2,3,4].map(n => w('ZealItemDisplay' + n, UI, n));
    expect(_dedupeWindows(rows, 'Hitya').kept).toHaveLength(5);
  });

  it('preserves the original ordering of what it keeps', () => {
    const out = _dedupeWindows(
      [w('A', UI, 1), w('B', CHAR, 2), w('A', CHAR, 3), w('C', UI, 4)], 'Hitya');
    expect(out.kept.map(r => r.section)).toEqual(['A', 'B', 'C']);
  });

  it('reports which file lost rows, and how many', () => {
    // Silently hiding windows is its own bug report. The status line names the
    // file so the user learns a second one exists.
    const out = _dedupeWindows(
      [w('A', UI, 1), w('A', CHAR, 2), w('B', UI, 3), w('B', CHAR, 4)], 'Hitya');
    expect(out.shadowed).toBe(2);
    expect(out.shadowFiles).toEqual({ [CHAR]: 2 });
  });

  it('still dedups when the character is unknown', () => {
    // Restore-from-cloud can render before the dropdown resolves. Every file
    // ties at the same rank, so first-seen wins — one row either way.
    const out = _dedupeWindows([w('Compass', UI, 1), w('Compass', CHAR, 2)], '');
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0].x).toBe(1);
  });

  it('handles the real shape: two full copies collapse to one', () => {
    const sections = ['Compass','BuffWindow','ChatWindow14','ZealOptions','RaidWindow'];
    const rows = [...sections.map(s => w(s, UI, 1)), ...sections.map(s => w(s, CHAR, 2))];
    const out = _dedupeWindows(rows, 'Hitya');
    expect(out.kept).toHaveLength(5);
    expect(out.shadowed).toBe(5);
    expect(out.kept.every(r => r.file === UI)).toBe(true);
  });
});

// ⚠ The tests above prove _dedupeWindows is RIGHT, not that anything calls it.
// Stubbing the call site out left all eleven green — the third time today a
// correct function sat unwired behind a green suite. Comments stripped first,
// because this file's own prose would satisfy a naive toContain.
describe('and it is actually wired into the load path', () => {
  const clean = stripJs(fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'ui-studio.html'), 'utf8'));

  it('runs the dedup on every load, cloud restore included', () => {
    // _renderLoadedBundle is the single shared path for "Load + Rescale" and
    // "Restore from backup", so one call covers both.
    expect(clean).toMatch(/_dedupeWindows\(STATE\.windows, STATE\.character\)/);
    expect(clean).toMatch(/STATE\.windows\s*=\s*_dedup\.kept/);
  });

  it('surfaces the shadowed count in the status line', () => {
    expect(clean).toMatch(/STATE\.shadowed\s*=\s*_dedup\.shadowed/);
    expect(clean).toMatch(/duplicate' \+ \(STATE\.shadowed === 1 \? '' : 's'\)/);
  });
});
