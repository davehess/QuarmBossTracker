// test/tray-quiet-mode-position.test.js — Quiet mode sits in the tray's bottom block.
//
// The guild lead, 2026-10-08: "Move quiet mode towards the bottom of the right click window for task bar".
// The tray opens upward with the cursor at the bottom, so the bottom block is the near end: Quiet mode
// sits directly above the Overlays submenu, and appears once.
//
// Run: npx vitest run test/tray-quiet-mode-position.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const SRC = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const MENU = stripJs(sliceBlock(SRC, '  const menu = Menu.buildFromTemplate([', "    { label: 'Quit Mimic', click: _quitMimic },"));

// Layout B (2026-10-14): Quiet mode is the last top-level toggle, directly above the Settings / Open /
// Help block (the full order is asserted in tray-menu-layout.test.js).
describe('tray menu: Quiet mode position', () => {
  it('appears once, directly above the Settings submenu', () => {
    const quiet = MENU.indexOf("label: '🔇 Quiet mode");
    expect(quiet).toBeGreaterThan(-1);
    expect(MENU.indexOf("label: '🔇 Quiet mode", quiet + 1)).toBe(-1);
    const settings = MENU.indexOf("{ label: 'Settings', submenu: settingsSubmenu }");
    expect(settings).toBeGreaterThan(quiet);
    // Nothing but a separator between the two.
    expect(MENU.slice(quiet + 1, settings)).not.toMatch(/\{ label: '/);
  });
  it('sits right after the Rescue item, in the top block', () => {
    expect(MENU.indexOf("label: '🔇 Quiet mode")).toBeGreaterThan(MENU.indexOf("label: '🧲 Rescue overlays"));
  });
});
