// test/item-icon.test.js — sprite arithmetic for the item icon atlas.
//
// This is the half of the icon work that can be tested without the art, and it
// is the half that fails invisibly: a wrong offset shows the WRONG ITEM'S
// picture, which looks like bad data rather than a bug. The packer already ate
// one version of exactly that (sheets were 256x256, so cropping tiled 7x7 and
// every cell past the sixth in a row got the next icon's id).
//
// The positions asserted below are cross-checked against live catalog rows.
//
// Run: npx vitest run test/item-icon.test.js

import { describe, it, expect } from 'vitest';
import {
  itemIconPos, itemIconStyle, hasItemIcon, inAtlasRange,
  ICON_CELL, ICON_PER_ROW, ICON_FIRST, ICON_LAST, ICON_ATLAS_DISABLED,
} from '../web/lib/itemIcon.ts';

describe('constants match the packer', () => {
  it('agrees with scripts/pack-item-icons.ps1 defaults', () => {
    // These four are a contract with the script. Change one without the other
    // and every icon silently shifts.
    expect(ICON_CELL).toBe(40);
    expect(ICON_PER_ROW).toBe(40);
    expect(ICON_FIRST).toBe(500);
  });

  it('caps at what the client actually ships', () => {
    // 34 sheets x 36 = 1224 icons, 500..1723 — measured on the real install.
    expect(ICON_LAST).toBe(1723);
    expect(ICON_LAST - ICON_FIRST + 1).toBe(34 * 36);
  });
});

describe('itemIconPos', () => {
  it('puts the first icon at the origin', () => {
    expect(itemIconPos(500)).toEqual({ x: 0, y: 0 });
  });

  it('walks across the first row', () => {
    expect(itemIconPos(501)).toEqual({ x: 40, y: 0 });
    expect(itemIconPos(539)).toEqual({ x: 39 * 40, y: 0 });
  });

  it('wraps to the next row at exactly PER_ROW', () => {
    // The off-by-one that would shift an entire row.
    expect(itemIconPos(540)).toEqual({ x: 0, y: 40 });
    expect(itemIconPos(541)).toEqual({ x: 40, y: 40 });
  });

  it('places real catalog items where the client puts them', () => {
    // Live rows, cross-checked against the client's own 6x6 sheet layout:
    //   icon 549 -> dragitem02 cell 13   (Thick Banded Belt)
    //   icon 771 -> dragitem08 cell 19   (Guise of the Deceiver)
    // In OUR atlas those become (icon-500) laid out 40 per row.
    expect(itemIconPos(549)).toEqual({ x: 9 * 40, y: 1 * 40 });    // idx  49 -> row 1, col  9
    expect(itemIconPos(771)).toEqual({ x: 31 * 40, y: 6 * 40 });   // idx 271 -> row 6, col 31
  });

  it('agrees with the client sheet math for a sample of ids', () => {
    // Independent derivation: idx must round-trip through our layout.
    for (const icon of [500, 535, 536, 700, 1000, 1500, 1723]) {
      const p = itemIconPos(icon);
      const idx = (p.y / ICON_CELL) * ICON_PER_ROW + p.x / ICON_CELL;
      expect(idx, `round-trip failed for icon ${icon}`).toBe(icon - ICON_FIRST);
    }
  });
});

describe('range guard', () => {
  it('rejects icons the atlas does not cover', () => {
    // Above the ceiling there is no art; drawing it would crop past the atlas
    // edge and look like a broken image.
    expect(hasItemIcon(1724)).toBe(false);
    expect(hasItemIcon(2000)).toBe(false);
    expect(itemIconPos(2000)).toBeNull();
    expect(itemIconStyle(2000)).toBeNull();
  });

  it('rejects below the first icon, and junk', () => {
    for (const bad of [499, 0, -1, null, undefined, NaN, Infinity]) {
      expect(hasItemIcon(bad), `should reject ${String(bad)}`).toBe(false);
      expect(itemIconPos(bad)).toBeNull();
    }
  });

  it('accepts both ends of the real range', () => {
    // Range membership is inAtlasRange; hasItemIcon additionally answers
    // "and do we trust the art", which is false while the kill switch is on.
    expect(inAtlasRange(ICON_FIRST)).toBe(true);
    expect(inAtlasRange(ICON_LAST)).toBe(true);
  });
});

describe.skipIf(ICON_ATLAS_DISABLED)('itemIconStyle scaling', () => {
  it('at full size uses raw cell offsets', () => {
    const s = itemIconStyle(541, 40);
    expect(s.width).toBe('40px');
    expect(s.backgroundPosition).toBe('-40px -40px');
    expect(s.backgroundSize).toBe(`${40 * 40}px auto`);
  });

  it('scales the ATLAS with the cell, not just the window', () => {
    // The classic sprite bug: shrink the box but not the background, and you
    // show the top-left quarter of the right cell instead of the whole cell.
    const s = itemIconStyle(541, 20);
    expect(s.width).toBe('20px');
    expect(s.backgroundPosition).toBe('-20px -20px');       // offsets halved too
    expect(s.backgroundSize).toBe(`${40 * 40 * 0.5}px auto`); // atlas halved
  });

  it('leaves atlas height auto so adding rows needs no code change', () => {
    expect(itemIconStyle(500).backgroundSize).toMatch(/ auto$/);
  });

  it('renders crisp rather than smoothed', () => {
    // 40px pixel art scaled down looks like mud with default interpolation.
    expect(itemIconStyle(500).imageRendering).toBe('pixelated');
  });
});

// ── Kill switch ─────────────────────────────────────────────────────────────
// The shipped atlas draws the wrong art (icon 633 is 276 items all named
// "…Boots" and renders a shovel), so every surface is name-only until it is
// repacked. These tests describe the DISABLED state on purpose: when someone
// regenerates the atlas and flips the flag, they fail loudly and force a look
// at the block above — which is where the "verify a known icon first"
// instruction lives.
describe('atlas kill switch', () => {
  it('is currently ON', () => {
    expect(ICON_ATLAS_DISABLED).toBe(true);
  });

  it('draws nothing at all while disabled', () => {
    for (const icon of [ICON_FIRST, 633, 1050, ICON_LAST]) {
      expect(hasItemIcon(icon), `icon ${icon} must not draw`).toBe(false);
      expect(itemIconStyle(icon), `icon ${icon} must have no style`).toBeNull();
    }
  });

  it('keeps the layout maths intact underneath, ready for the repack', () => {
    // itemIconPos deliberately does NOT consult the kill switch: the offsets
    // were never the bug, and gating them would delete the only coverage that
    // makes re-enabling safe.
    expect(itemIconPos(ICON_FIRST)).toEqual({ x: 0, y: 0 });
    expect(itemIconPos(540)).toEqual({ x: 0, y: 40 });
    expect(itemIconPos(2000)).toBeNull();
  });

  it('did not catch the bug, and says so', () => {
    // Characterisation, not an assertion about behaviour: every positional test
    // in this file passed while the atlas showed a cake for an earring. Index
    // maths and art correctness are different properties, and only one of them
    // is testable here.
    expect(itemIconPos(1050)).not.toBeNull();
  });
});
