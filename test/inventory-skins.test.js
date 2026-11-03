// test/inventory-skins.test.js — the gear page's inventory window (web/lib/inventorySkins.ts; the guild lead, 2026-11-03).
//
// The skin maps are data, so the checks are on the data: every skin places all 21 equipment slots exactly once, no two
// share a cell, nothing sits outside the grid or under the paper doll's figure. The slot normaliser is run on the
// spellings the gear data really uses. One source-text check holds the page order (the window above the old sections),
// with comments stripped first so a header that names the component cannot answer for the markup.
// Every check is a pure function so the mutation block can run it against a deliberately broken skin.
//
// Run: npx vitest run test/inventory-skins.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { SKINS, SLOT_IDS, SLOT_LABEL, normaliseSlot, skinById, DEFAULT_SKIN } from '../web/lib/inventorySkins.ts';

// ── checks ──
const problems = (skin) => {
  const out = [];
  const seen = new Map();
  for (const c of skin.cells) seen.set(c.slot, (seen.get(c.slot) ?? 0) + 1);
  for (const s of SLOT_IDS) if (seen.get(s) !== 1) out.push(`slot ${s} placed ${seen.get(s) ?? 0} times`);
  for (const s of seen.keys()) if (!SLOT_IDS.includes(s)) out.push(`unknown slot ${s}`);
  const taken = new Set();
  const f = skin.figure;
  for (const c of skin.cells) {
    const key = `${c.col},${c.row}`;
    if (taken.has(key)) out.push(`two slots in cell ${key}`);
    taken.add(key);
    if (c.col < 1 || c.col > skin.cols || c.row < 1) out.push(`${c.slot} outside the grid`);
    if (f && c.col >= f.col && c.col < f.col + f.colSpan && c.row >= f.row && c.row < f.row + f.rowSpan) out.push(`${c.slot} under the figure`);
  }
  return out;
};

describe('skins', () => {
  it('there are the four skins, with unique ids and a Classic default', () => {
    expect(SKINS.map(s => s.id)).toEqual(['classic', 'grid', 'doll', 'compact']);
    expect(new Set(SKINS.map(s => s.id)).size).toBe(4);
    expect(skinById(DEFAULT_SKIN)?.name).toBe('Classic');
    expect(skinById('nope')).toBeNull();
    expect(SLOT_IDS.length).toBe(21);
  });
  for (const skin of SKINS) {
    it(`${skin.name}: all 21 slots exactly once, one per cell, inside the grid`, () => {
      expect(problems(skin)).toEqual([]);
      expect(skin.cells.length).toBe(21);
    });
  }
  it('column counts and stats sides follow the screenshots', () => {
    expect(SKINS.map(s => [s.cols, s.statsSide])).toEqual([[6, 'right'], [5, 'right'], [5, 'left'], [3, 'right']]);
  });
  it('Classic row 1 is Ear 1, Neck, Face, Head, Ear 2', () => {
    const r1 = skinById('classic').cells.filter(c => c.row === 1).map(c => SLOT_LABEL[c.slot]);
    expect(r1).toEqual(['Ear 1', 'Neck', 'Face', 'Head', 'Ear 2']);
  });
});

describe('normaliseSlot', () => {
  it.each([
    ['Ear1', 'Ear1'], ['Ear 1', 'Ear1'], ['Ear2', 'Ear2'], ['Left Ear', 'Ear1'],
    ['Wrist1', 'Wrist1'], ['Wrist 2', 'Wrist2'],
    ['Fingers1', 'Finger1'], ['Fingers 2', 'Finger2'], ['Finger 1', 'Finger1'],
    ['Shoulders', 'Shoulders'], ['Range', 'Range'], ['Ammo', 'Ammo'], ['Primary', 'Primary'],
    ['  chest ', 'Chest'], ['FEET', 'Feet'],
  ])('%s -> %s', (raw, id) => expect(normaliseSlot(raw)).toBe(id));
  it('Charm, bag slots and blanks are not window slots', () => {
    for (const raw of ['Charm', 'General1-Slot3', '', null, undefined]) expect(normaliseSlot(raw)).toBeNull();
  });
  it('every slot the gear page sorts by (other than Charm) maps to a canonical slot', () => {
    const order = ['Ear1', 'Head', 'Face', 'Ear2', 'Neck', 'Shoulders', 'Arms', 'Back', 'Wrist1', 'Wrist2', 'Range', 'Hands',
      'Primary', 'Secondary', 'Fingers1', 'Fingers2', 'Chest', 'Legs', 'Feet', 'Waist', 'Ammo'];
    expect(new Set(order.map(normaliseSlot))).toEqual(new Set(SLOT_IDS));
  });
});

describe('gear page', () => {
  const page = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/character/[name]/gear/page.tsx'), 'utf8'));
  it('draws the inventory window above the totals and the other sections', () => {
    const win = page.indexOf('<InventoryWindow');
    expect(win).toBeGreaterThan(-1);
    for (const later of ['<RaidKitCard kit=', 'Item totals', 'Attributes &amp; resists', 'Equipped (']) {
      expect(page.indexOf(later), later).toBeGreaterThan(win);
    }
  });
  it('hands the window the page\'s own sums, not new ones', () => {
    expect(page).toMatch(/ac: acSum, hp: hpSum, atk: atkCapped, attrs: gearStat, resists: gearResist/);
  });
});

describe('mutation: the checks fail on a broken skin', () => {
  const base = () => JSON.parse(JSON.stringify(SKINS[0]));
  it('a dropped slot', () => { const s = base(); s.cells.pop(); expect(problems(s).length).toBeGreaterThan(0); });
  it('a duplicated slot', () => { const s = base(); s.cells[1].slot = s.cells[0].slot; expect(problems(s).length).toBeGreaterThan(0); });
  it('two slots in one cell', () => { const s = base(); s.cells[1].col = s.cells[0].col; s.cells[1].row = s.cells[0].row; expect(problems(s)).toContain('two slots in cell 1,1'); });
  it('a slot outside the grid', () => { const s = base(); s.cells[0].col = 99; expect(problems(s).join()).toMatch(/outside the grid/); });
  it('a slot under the figure', () => { const s = JSON.parse(JSON.stringify(SKINS[2])); s.cells[0].col = 3; s.cells[0].row = 3; expect(problems(s).join()).toMatch(/under the figure/); });
});
