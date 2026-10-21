// test/local-site-nav.test.js — the local site has back / forward / reload (the guild lead, 2026-10-21:
// "the browser has no navigation buttons at all"). Mimic opens web/local in a window with no browser chrome.
// Text tier, comments stripped (a comment quoting 'app-command' must not satisfy the wiring check).

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const nav = stripJs(fs.readFileSync(path.join(ROOT, 'web', 'local', 'app', 'LocalNav.tsx'), 'utf8'));
const main = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'main.js'), 'utf8');

// The local-site window's own block, so the check cannot be satisfied by another window's handlers.
const start = main.indexOf('function openLocalSite(');
const block = stripJs(main.slice(start, main.indexOf('// UI Studio', start)));

describe('LocalNav buttons', () => {
  it('renders back, forward and reload, driven by window.history / location', () => {
    expect(nav).toMatch(/window\.history\.back\(\)/);
    expect(nav).toMatch(/window\.history\.forward\(\)/);
    expect(nav).toMatch(/window\.location\.reload\(\)/);
    expect(nav).toMatch(/aria-label=\{b\.title\}/);
    for (const t of ["title: 'Back'", "title: 'Forward'", "title: 'Reload'"]) expect(nav).toContain(t);
  });
  it('dims back/forward from the Navigation API where it exists', () => {
    expect(nav).toMatch(/canGoBack/);
    expect(nav).toMatch(/canGoForward/);
    expect(nav).toMatch(/currententrychange/);
    expect(nav).toMatch(/disabled=\{!b\.ok\}/);
  });
  it('puts the buttons before the page links', () => {
    expect(nav.indexOf("title: 'Back'")).toBeLessThan(nav.indexOf('PAGES.map'));
  });
});

describe('local-site window navigation wiring', () => {
  it('handles the mouse / keyboard back and forward commands on that window', () => {
    expect(block).toMatch(/localSiteWindow\.on\('app-command'/);
    expect(block).toContain("'browser-backward'");
    expect(block).toContain("'browser-forward'");
  });
  it('handles Alt+Left / Alt+Right through before-input-event', () => {
    expect(block).toMatch(/webContents\.on\('before-input-event'/);
    expect(block).toContain("'ArrowLeft'");
    expect(block).toContain("'ArrowRight'");
    expect(block).toMatch(/input\.alt/);
  });
  it('uses navigationHistory (Electron 30+) with the old goBack/goForward as fallback', () => {
    expect(block).toMatch(/navigationHistory/);
    expect(block).toMatch(/h\.goBack\(\)/);
    expect(block).toMatch(/wc\.goBack\(\)/);
    expect(block).toMatch(/h\.goForward\(\)/);
    expect(block).toMatch(/wc\.goForward\(\)/);
  });
});
