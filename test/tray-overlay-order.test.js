// Tray → Overlays: the overlay entries are alphabetical (a member,
// 2026-09-23: "We need to reorder the overlays in alpha"). Runs the real
// _sortOverlayMenuItems sliced from main.js against the menu's real shape.
//
// Run: npx vitest run test/tray-overlay-order.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'apps', 'mimic', 'main.js'), 'utf8');
const { _sortOverlayMenuItems } = evalBlock(
  sliceBlock(MAIN, 'function _sortOverlayMenuItems(menu) {', '\n}'),
  ['_sortOverlayMenuItems'],
);

const item = (label) => ({ label, type: 'checkbox' });
const SEP = { type: 'separator' };
// The submenu as built, 2026-09-23 order.
const built = () => [
  item('◫ Dock'),
  SEP,
  item('DPS HUD'),
  item('Trigger alerts (TTS)'),
  item('Charm tracker'),
  item('Pet tracker (summoned pets)'),
  item('Target Info (target stats)'),
  item('Buff queue (raid gaps + cures)'),
  item('/who (zone roster)'),
  item('Casting tracker (melody on bards, spells otherwise)'),
  item('  ↳ Only show on bard characters'),
  item('  ↳ Show AE song damage (per hit + kite total)'),
  item('Zeal health (diagnostic)'),
  item('Threat meter'),
  item('Tank HUD (DS, buffs, DA, rampage)'),
  item('CH chain'),
  item('Extended Target (raid-wide targets)'),
  item('Command Center (one-window raid board)'),
  item('PoP raids (encounter slideshow)'),
  SEP,
  item('Overlays: Locked (click to move)'),
  item('🛠 Setup mode — place all overlays'),
  item('🙈 Hide all overlays (Ctrl+Shift+H)'),
];
const labels = (m) => m.map(i => i.type === 'separator' ? '---' : i.label.trim());

describe('_sortOverlayMenuItems', () => {
  const out = labels(_sortOverlayMenuItems(built()));

  it('puts the overlay entries in alphabetical order', () => {
    expect(out.slice(2, 19)).toEqual([
      'Buff queue (raid gaps + cures)',
      'Casting tracker (melody on bards, spells otherwise)',
      '↳ Only show on bard characters',
      '↳ Show AE song damage (per hit + kite total)',
      'CH chain',
      'Charm tracker',
      'Command Center (one-window raid board)',
      'DPS HUD',
      'Extended Target (raid-wide targets)',
      'Pet tracker (summoned pets)',
      'PoP raids (encounter slideshow)',
      'Tank HUD (DS, buffs, DA, rampage)',
      'Target Info (target stats)',
      'Threat meter',
      'Trigger alerts (TTS)',
      '/who (zone roster)',
      'Zeal health (diagnostic)',
    ]);
  });
  it('keeps the Dock first and the controls below untouched', () => {
    expect(out.slice(0, 2)).toEqual(['◫ Dock', '---']);
    expect(out.slice(19)).toEqual(['---', 'Overlays: Locked (click to move)',
      '🛠 Setup mode — place all overlays', '🙈 Hide all overlays (Ctrl+Shift+H)']);
  });
  it('loses and duplicates nothing', () => {
    expect(out.slice().sort()).toEqual(labels(built()).sort());
  });
});

describe('buildTrayMenu applies it', () => {
  it('sorts the Overlays submenu after building it', () => {
    expect(stripJs(MAIN)).toMatch(/\.\.\._charProfileTrayItems\(\),\s*\];\s*_sortOverlayMenuItems\(overlaysSubmenu\);/);
  });
});
