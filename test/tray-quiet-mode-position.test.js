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

describe('tray menu: Quiet mode position', () => {
  it('appears once, directly above the Overlays submenu', () => {
    const quiet = MENU.indexOf("label: '🔇 Quiet mode");
    expect(quiet).toBeGreaterThan(-1);
    expect(MENU.indexOf("label: '🔇 Quiet mode", quiet + 1)).toBe(-1);
    const overlays = MENU.indexOf("{ label: 'Overlays', submenu: overlaysSubmenu }");
    expect(overlays).toBeGreaterThan(quiet);
    // Nothing else between the two: the next item after Quiet mode is Overlays.
    expect(MENU.slice(quiet + 1, overlays)).not.toMatch(/\{ label: '/);
  });
  it('sits below the maintenance items, in the bottom block', () => {
    expect(MENU.indexOf("label: '🔇 Quiet mode")).toBeGreaterThan(MENU.indexOf("label: 'Resource use"));
    expect(MENU.indexOf("label: '🔇 Quiet mode")).toBeGreaterThan(MENU.indexOf("label: '🧲 Rescue overlays"));
  });
});
