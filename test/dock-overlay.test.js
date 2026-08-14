// test/dock-overlay.test.js — the Dock: many overlays, one Chromium renderer.
//
// Every Electron BrowserWindow is its own renderer at ~80 MB resident before it
// paints anything (measured by Uilnayar, 2026-08-04 — the reason main.js reaps
// windows whose pref is off). The dock hosts overlays as same-origin <iframe>
// panes in ONE window, so five docked overlays cost one renderer.
//
// The design decision the tests below defend: the panes are the REAL overlay
// files, loaded unmodified. Anything that must behave differently when docked
// lives in preload.js behind WP_IS_DOCKED, so there is exactly one copy of each
// overlay and a docked fork cannot drift from the floating one.
//
// Behaviour (panes render, picker docks, pane ✕ undocks only itself, columns
// cycle) is covered by a headless-Chromium pass against dock.html. These are
// the wiring facts a browser cannot see.
//
// Run: npx vitest run test/dock-overlay.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const main    = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'preload.js'), 'utf8');
const dock    = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'dock.html'), 'utf8');

// Pull the catalog out of main.js so the tests below run against the real list.
const CATALOG = [...main.matchAll(
  /\{ key: '([^']+)',\s*label: '([^']+)',\s*file: '([^']+)',\s*flag: '([^']+)' \}/g,
)].map(m => ({ key: m[1], label: m[2], file: m[3], flag: m[4] }));

describe('the pane catalog is real', () => {
  it('lists a useful number of overlays', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(10);
  });

  it('every pane file exists on disk', () => {
    // A typo here is a blank pane at raid time, and nothing else would catch it.
    for (const c of CATALOG) {
      expect(fs.existsSync(path.join(ROOT, 'apps', 'mimic', c.file)), `${c.key} → ${c.file}`).toBe(true);
    }
  });

  it('every pane file is the one main.js loads for that overlay standalone', () => {
    // The pane must BE the overlay, not a copy that drifts. If these ever
    // diverge, the docked and floating versions are two different programs.
    for (const c of CATALOG) {
      expect(main, `${c.key} loadFile`).toMatch(new RegExp(`loadFile\\('${c.file.replace('.', '\\.')}'\\)`));
    }
  });

  it('every flag is one main.js actually manages', () => {
    for (const c of CATALOG) {
      expect(main).toMatch(new RegExp(`flag: '${c.flag}'`));
      expect(main, `${c.flag} in hide-all`).toContain(`'${c.flag}'`);
    }
  });

  it('keys and files are unique', () => {
    expect(new Set(CATALOG.map(c => c.key)).size).toBe(CATALOG.length);
    expect(new Set(CATALOG.map(c => c.file)).size).toBe(CATALOG.length);
  });

  it('deliberately EXCLUDES the trigger overlay', () => {
    // #97 fires its TTS from a hidden window and its flag means "make sound",
    // not "be visible" — docking would tie callouts to a pane's existence. It
    // is also the one overlay whose position is load-bearing (centre flash,
    // upward timer stack), which a grid cell cannot honour.
    expect(CATALOG.find(c => c.key === 'trigger')).toBeUndefined();
    expect(CATALOG.find(c => c.file === 'triggers.html')).toBeUndefined();
  });
});

describe('a docked overlay gives up its window', () => {
  it('docking clears the flag, so the reaper frees the renderer', () => {
    // This is the whole saving. Merely hiding the window would keep the ~80 MB.
    expect(main).toMatch(/cfg\[spec\.flag\] = false;\s*\/\/ the reaper frees its window/);
  });

  it('remembers what the pref was, so undocking restores it', () => {
    expect(main).toMatch(/cfg\.dockedPrev\[spec\.key\] = !!cfg\[spec\.flag\];/);
  });

  it('undocking gives the overlay back VISIBLE', () => {
    // It was on screen a second ago as a pane; having it vanish would read as
    // having lost it.
    const h = main.slice(main.indexOf("ipcMain.handle('dock-set'"), main.indexOf("ipcMain.handle('dock-cols'"));
    expect(h).toMatch(/cfg\[spec\.flag\] = true;/);
  });

  it('is never force-created by unlock or setup mode', () => {
    // Otherwise dragging your layout around spawns the floating copy next to
    // the pane — the same overlay twice, and docking undone.
    expect(main).toMatch(/if \(e && e\.key !== 'dock' && _dockedKeys\(cfg\)\.includes\(e\.key\)\) return false;/);
  });

  it('greys out its own tray entry while docked', () => {
    const tray = main.slice(main.indexOf('const overlaysSubmenu = ['), main.indexOf("{ label: 'Overlays', submenu"));
    const guards = (tray.match(/!_dockedNow\.includes\(/g) || []).length;
    expect(guards).toBe(CATALOG.length);
  });
});

describe('the dock is an overlay like any other', () => {
  // The feature-parity checklist in CLAUDE.md — a whole class of beta bugs was
  // overlays missing one of these.
  it('has the ✕ hide and ✥ move chrome', () => {
    expect(dock).toMatch(/id="hide-btn"/);
    expect(dock).toMatch(/id="move-btn"/);
  });

  it('does the hover-interact handshake on every control', () => {
    // A locked overlay is click-through; without this the clicks land in EQ.
    expect(dock).toMatch(/overlayHoverInteractive\(true\)/);
    expect(dock).toMatch(/overlayHoverInteractive\(false\)/);
    expect(dock).toMatch(/\[hideBtn, moveBtn, addBtn, colBtn\]\.forEach\(interactive\)/);
  });

  it('is in _overlayEntries, the lifecycle table and _HIDEALL_FLAGS', () => {
    expect(main).toMatch(/out\.push\(\['dock',\s*dockWindow\]\)/);
    expect(main).toMatch(/\{ key: 'dock',\s+flag: 'showDock'/);
    const hideAll = main.slice(main.indexOf('const _HIDEALL_FLAGS = ['), main.indexOf('function toggleHideAllOverlays'));
    expect(hideAll).toContain("'showDock'");
  });

  it('is applied by applyAllVisibility', () => {
    const fn = main.slice(main.indexOf('function applyAllVisibility()'));
    expect(fn.slice(0, 400)).toMatch(/applyDockVisibility\(\);/);
  });

  it('hiding the dock does NOT scatter the panes back into windows', () => {
    // One misclick must not undo somebody's whole layout. Undocking is the
    // pane ✕; hiding is the dock ✕.
    const branch = main.slice(main.indexOf('if (win === dockWindow) {'), main.indexOf('} else if (win === overlayWindow)'));
    expect(branch).toMatch(/cfg\.showDock = false/);
    expect(branch).not.toMatch(/dockedOverlays/);
  });
});

describe('the panes get a working bridge', () => {
  it('the dock window enables nodeIntegrationInSubFrames', () => {
    // THE load-bearing line. Without it every pane silently loses window.mimic:
    // it still renders and still polls the agent, and quietly cannot hide,
    // drag, or arm click-through.
    expect(main).toMatch(/_wpPrefs\('Dock',\s*\{\s*nodeIntegrationInSubFrames:\s*true\s*\}\)/);
  });

  it('preload knows when it is a pane rather than a window', () => {
    expect(preload).toMatch(/const WP_IS_DOCKED = /);
    expect(preload).toMatch(/window\.top !== window\.self/);
  });

  it('a pane\'s ✕ undocks that pane instead of hiding the dock', () => {
    const h = preload.slice(preload.indexOf('hideThisOverlay:'), preload.indexOf('hideThisOverlay:') + 400);
    expect(h).toMatch(/WP_IS_DOCKED/);
    expect(h).toMatch(/'dock-set', _wpDockKey\(\), false/);
  });

  it('a pane cannot resize the dock to fit itself', () => {
    // Both auto-fit paths, because nine overlays call the raw one directly.
    const fit = preload.slice(preload.indexOf('function _autoFitOverlay'), preload.indexOf('function _autoFitOverlay') + 300);
    expect(fit).toMatch(/if \(WP_IS_DOCKED\) return;/);
    const raw = preload.slice(preload.indexOf('function _overlayAutoHeightRaw'), preload.indexOf('function _overlayAutoHeightRaw') + 260);
    expect(raw).toMatch(/if \(WP_IS_DOCKED\)/);
  });

  it('a pane\'s resize-preset menu does not resize the dock', () => {
    const menu = preload.slice(preload.indexOf('function _attachOverlayMenu'), preload.indexOf('function _attachOverlayMenu') + 320);
    expect(menu).toMatch(/if \(WP_IS_DOCKED\) return;/);
  });

  it('resolves a pane by its FILENAME, which is all a pane knows about itself', () => {
    expect(preload).toMatch(/function _wpDockKey\(\)/);
    // main must accept both, since the picker sends keys and panes send files.
    expect(main).toMatch(/c\.file\.replace\(\/\\\.html\$\/i, ''\)\.toLowerCase\(\) === s/);
  });
});

describe('the pane ✕ is drawn, not hover-revealed', () => {
  it('has a resting opacity above zero', () => {
    // Panes repaint constantly (cast bars, countdowns) and a freshly-created
    // element under a stationary cursor never picks up :hover — the trap that
    // made the CH chain's own ✕ invisible on exactly the row you wanted it on.
    const rule = /\.pane > \.ph \.x\{[^}]*opacity:\s*([0-9.]+)/.exec(dock);
    expect(rule).toBeTruthy();
    expect(Number(rule[1])).toBeGreaterThan(0.1);
  });
});
