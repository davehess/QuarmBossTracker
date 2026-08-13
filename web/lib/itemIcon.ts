// Item icon positioning against the atlas built by scripts/pack-item-icons.ps1.
//
// The atlas layout is DETERMINISTIC, which is the whole point: there is no
// manifest to fetch, parse, or keep in sync with the catalog. Two modulos and
// you have the sprite offset.
//
//   col = (icon - FIRST_ICON) % PER_ROW
//   row = floor((icon - FIRST_ICON) / PER_ROW)
//
// Regenerating the atlas from a client with MORE sheets extends it downward and
// changes nothing here — existing icons keep their positions, because position
// is a pure function of the icon id.

/** px per icon cell, both in the client sheets and in our atlas. */
export const ICON_CELL = 40;
/** icons per row in our atlas. Must match -PerRow in the packer. */
export const ICON_PER_ROW = 40;
/** The client's first icon id. Must match -FirstIcon in the packer. */
export const ICON_FIRST = 500;

/**
 * Highest icon the shipped atlas covers.
 *
 * ⚠ Measured, not assumed: the Titanium-era client ships 34 dragitem sheets =
 * 1,224 icons = 500..1723, but `eqemu_items.icon` runs to 2000. Items above the
 * ceiling have no art in this client and would otherwise render as a blank cell
 * cropped from beyond the atlas edge — which looks like a broken image rather
 * than "no icon". `hasItemIcon` is how callers avoid drawing one.
 */
export const ICON_LAST = 1723;

/**
 * ⚠ KILL SWITCH — the shipped atlas draws the WRONG ART and is disabled.
 *
 * Measured 2026-08-13 against catalog ground truth, not by eye:
 *   • icon 633 is shared by 276 items, every one named "…Boots" → draws a shovel
 *   • icon 1050 is shared by earrings only                      → draws a cake
 *   • icon 746 is plate helms                                   → draws a flower
 * 2 of 10 sampled icons matched, which is what chance looks like. Wrong art is
 * worse than no art — it reads as bad DATA rather than a missing picture — so
 * every surface falls back to name-only until the atlas is regenerated
 * (Hitya: "before raid", 2026-08-13).
 *
 * The bug is NOT in this file. Verified about the atlas itself: 1600×1240 =
 * exactly 40×31 cells, 1191 distinct non-blank cells, ZERO duplicates, and the
 * blank cells form a clean period-6 pattern — i.e. a partially-filled 6-wide
 * source sheet read row-major. The packer walked the sheets correctly; the
 * sheet-to-icon-id mapping is what is wrong. Ruled out from here: a
 * lexicographic `dragitem1, dragitem10, dragitem11…` glob, and any constant
 * whole-sheet offset (scanned ±180 in steps of 36).
 *
 * To re-enable: re-run `scripts/pack-item-icons.ps1` on the machine with the EQ
 * install, VISUALLY confirm a known icon first (633 must be boots), then delete
 * this constant and the guard below. Do not flip it back on untested — the
 * arithmetic tests in test/item-icon.test.js pass today and did not catch this,
 * because they check the index maths, never the art.
 */
export const ICON_ATLAS_DISABLED = true;

/**
 * Pure range check — "does the atlas have a cell for this id", independent of
 * whether we currently trust the atlas. Kept separate from `hasItemIcon` so the
 * layout maths stays exercised by tests while the art is disabled.
 */
export function inAtlasRange(icon: number | null | undefined): boolean {
  return typeof icon === 'number' && Number.isFinite(icon)
      && icon >= ICON_FIRST && icon <= ICON_LAST;
}

/** What callers ask before drawing. False while the atlas is disabled. */
export function hasItemIcon(icon: number | null | undefined): boolean {
  if (ICON_ATLAS_DISABLED) return false;
  return inAtlasRange(icon);
}

export type IconPos = { x: number; y: number };

/** Sprite offset for an icon id, or null when the atlas does not cover it. */
export function itemIconPos(icon: number | null | undefined): IconPos | null {
  // Range check only — NOT hasItemIcon. The offset maths is still correct while
  // the atlas is disabled; it is the art that is untrustworthy, and
  // itemIconStyle is where the kill switch stops anything being drawn.
  if (!inAtlasRange(icon)) return null;
  const idx = (icon as number) - ICON_FIRST;
  return {
    x: (idx % ICON_PER_ROW) * ICON_CELL,
    y: Math.floor(idx / ICON_PER_ROW) * ICON_CELL,
  };
}

/**
 * Inline style for a sprite cell. Negative offsets, because the background is
 * shifted under a fixed-size window rather than the window moving.
 *
 * `size` scales the whole atlas so a 20px icon shows the right cell rather than
 * the top-left quarter of it — the background-size must scale with it, which is
 * the part that is easy to get wrong.
 */
export function itemIconStyle(icon: number | null | undefined, size = ICON_CELL) {
  if (ICON_ATLAS_DISABLED) return null;   // nothing renders while the art is wrong
  const pos = itemIconPos(icon);
  if (!pos) return null;
  const scale = size / ICON_CELL;
  return {
    width: `${size}px`,
    height: `${size}px`,
    backgroundImage: 'url(/icons/items.png)',
    backgroundPosition: `-${pos.x * scale}px -${pos.y * scale}px`,
    // The atlas is ICON_PER_ROW cells wide; height is left auto so adding rows
    // to the atlas never requires touching this file.
    backgroundSize: `${ICON_PER_ROW * ICON_CELL * scale}px auto`,
    backgroundRepeat: 'no-repeat',
    imageRendering: 'pixelated' as const,
    flex: '0 0 auto',
  };
}
