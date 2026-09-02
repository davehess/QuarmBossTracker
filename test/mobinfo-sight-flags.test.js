// test/mobinfo-sight-flags.test.js — the mob-info row carries enough to answer
// "will invis hide me from this?"
//
// Hitya, 2026-09-02: "mob info needs to also denote if a mob can see invis."
//
// ⚠ THE RAW FLAG IS NOT THE ANSWER, AND SHIPPING IT ALONE WOULD BE NOISE.
// Measured over the 18,033-row catalog:
//   • non-undead — see_invis 11%, see_invis_undead 96%
//   • UNDEAD (bodytype 3) — see_invis 98%, see_invis_undead 15%
// Each flag is signal on exactly ONE side and near-universal on the other, so
// the overlay cannot pick the right chip without knowing undead-ness. That is
// the whole reason `undead` joins the payload.
//
// Also measured: see_hide is 0 rows across the ENTIRE catalog, and
// see_improved_hide is 91 (0.5%).
//
// Run: npx vitest run test/mobinfo-sight-flags.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, stripJs } from './_source-slice.js';

const clean = stripJs(readSource(BOT_INDEX));

describe('what the mob-info row promises the overlay', () => {
  it('ships all four sight flags as booleans', () => {
    // EQEmu stores them as 0/1 ints; a raw int would make `if (mob.see_invis)`
    // work by luck and `=== false` fail.
    for (const f of ['see_invis', 'see_invis_undead', 'see_hide', 'see_improved_hide']) {
      expect(clean, f).toMatch(new RegExp(f + ':\\s*!!r\\.' + f));
    }
  });

  it('ships undead-ness, without which the flags cannot be read', () => {
    expect(clean).toMatch(/undead:\s*Number\(r\.bodytype\)\s*===\s*3/);
  });

  it('selects every column it returns', () => {
    // The row is built from an explicit select list; returning a column that
    // was never fetched yields undefined, which reads as "does not see invis"
    // — a false all-clear on a mob that does.
    const sel = clean.match(/const _nameSel = `select=([^&]+)/);
    expect(sel, 'the mob-info select list should be findable').toBeTruthy();
    const cols = sel[1].split(',');
    for (const c of ['see_invis', 'see_invis_undead', 'see_hide', 'see_improved_hide', 'bodytype']) {
      expect(cols, c + ' must be selected').toContain(c);
    }
  });
});
