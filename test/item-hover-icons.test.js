// test/item-hover-icons.test.js — FB-99: on /character/<name>/inventory the item hover card was "chopped up into
// pieces" and the items had no icons.
//
//   * The card was drawn INSIDE its trigger, and the grid cell is `overflow-hidden`, so the card was cut to the
//     cell's box. It now draws in a portal on <body> at fixed coordinates, placed by `placeTip` (web/lib/tipPlacement.ts).
//   * Icons hotlink PQDI, whose path is case-sensitive: `/Icons/item_633.png` is a 404, `/icons/item_633.png` is the
//     art (measured 2026-10-26). The 404 was swallowed by the image's onError, so nothing ever said why.
//
// The two helpers are run for real; the wiring is a text check over comment-stripped source (a comment quoting
// `createPortal` or `/Icons/` must not satisfy or fail it).
//
// Run: npx vitest run test/item-hover-icons.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { pqdiIconUrl, PQDI_ICON_BASE } from '../web/lib/itemIcon.ts';
import { placeTip } from '../web/lib/tipPlacement.ts';

const dir = path.join(ROOT, 'web', 'app', 'character', '[name]', 'inventory');
const read = (f) => stripJs(fs.readFileSync(path.join(dir, f), 'utf8'));

describe('pqdiIconUrl', () => {
  it('uses the lowercase /icons/ path PQDI actually serves', () => {
    expect(pqdiIconUrl(633)).toBe('https://www.pqdi.cc/icons/item_633.png');
    expect(PQDI_ICON_BASE).toBe('https://www.pqdi.cc/icons');
    expect(pqdiIconUrl(633)).not.toMatch(/\/Icons\//);
  });
  it('keeps the www. host (bare pqdi.cc resets the connection)', () => {
    expect(pqdiIconUrl(1)).toMatch(/^https:\/\/www\.pqdi\.cc\//);
  });
  it('honours a base override and trims its trailing slashes', () => {
    expect(pqdiIconUrl(12, 'https://example.test/art///')).toBe('https://example.test/art/item_12.png');
    expect(pqdiIconUrl(12, '')).toBe('https://www.pqdi.cc/icons/item_12.png');
    expect(pqdiIconUrl(12, undefined)).toBe('https://www.pqdi.cc/icons/item_12.png');
  });
  it('draws nothing for no icon', () => {
    for (const bad of [0, -3, null, undefined, NaN, Infinity]) expect(pqdiIconUrl(bad), String(bad)).toBeNull();
  });
});

describe('placeTip', () => {
  const view = { width: 1000, height: 800 };
  const tip = { width: 256, height: 280 };
  const at = (left, top, w = 90, h = 90) => ({ left, top, right: left + w, bottom: top + h });

  it('centres the card over the item, above it, when there is room', () => {
    const p = placeTip(at(500, 500), tip, view);
    expect(p.below).toBe(false);
    expect(p.top).toBe(500 - 280);
    expect(p.left).toBe(545 - 128);
  });
  it('flips below the item when there is no room above (first row of the page)', () => {
    const p = placeTip(at(500, 100), tip, view);
    expect(p.below).toBe(true);
    expect(p.top).toBe(190);
  });
  it('clamps inside the viewport on the left and right', () => {
    expect(placeTip(at(0, 500), tip, view).left).toBe(8);
    expect(placeTip(at(930, 500), tip, view).left).toBe(1000 - 256 - 8);
  });
  it('clamps at the bottom when flipped near the foot of the window', () => {
    const p = placeTip(at(500, 20, 90, 770), tip, view);
    expect(p.top + tip.height).toBeLessThanOrEqual(800 - 8);
    expect(p.top).toBeGreaterThanOrEqual(8);
  });
  it('never returns a negative position, even for a card taller than the window', () => {
    const p = placeTip(at(500, 300), { width: 256, height: 900 }, view);
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.left).toBeGreaterThanOrEqual(8);
  });
});

describe('inventory page wiring', () => {
  const hover = read('ItemHover.tsx');
  const icon = read('ItemIcon.tsx');
  const view = read('InventoryView.tsx');

  it('draws the hover card in a portal on body, at fixed coordinates, not inside the clipped cell', () => {
    expect(hover).toMatch(/createPortal\(/);
    expect(hover).toMatch(/document\.body/);
    expect(hover).toMatch(/placeTip\(/);
    const cls = hover.match(/role="tooltip"[\s\S]*?className="([^"]*)"/);
    expect(cls, 'tooltip className').toBeTruthy();
    expect(cls[1]).toMatch(/\bfixed\b/);
    expect(cls[1]).not.toMatch(/\babsolute\b/);
  });
  it('the grid cell still clips (that is why the card has to leave it)', () => {
    expect(view).toMatch(/hover:border-blue overflow-hidden/);
  });
  it('item icons come from pqdiIconUrl, never a hand-written capitalised path', () => {
    expect(icon).toMatch(/pqdiIconUrl\(/);
    expect(icon).not.toMatch(/\/Icons\b/);
  });
  it('a bag shows its own icon beside its name', () => {
    expect(view).toMatch(/c\.bagCard\?\.icon/);
    expect(view).toMatch(/<ItemIcon icon=\{c\.bagCard\.icon\}/);
  });
});
