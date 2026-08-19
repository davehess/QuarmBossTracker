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
  /\{ key: '([^']+)',\s*label: '([^']+)',\s*file: '([^']+)',\s*flag: '([^']+)'[\s\S]{0,80}?\}/g,
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

  it('every pane loads what the standalone window loads', () => {
    // The pane must BE the overlay, not a copy that drifts. If these ever
    // diverge, the docked and floating versions are two different programs.
    // Two shapes: most windows loadFile() their page; the Command Center is
    // served from the AGENT (#65) with the bundled file as its fallback, and a
    // pane pinned to the file alone would silently lag behind.
    for (const c of CATALOG) {
      const file = c.file.replace('.', '\\.');
      const plain  = new RegExp(`loadFile\\('${file}'\\)`).test(main);
      const served = new RegExp(`_loadOverlayPreferAgent\\([^)]*'${file}'\\)`).test(main);
      expect(plain || served, `${c.key} → ${c.file} is not what main.js loads`).toBe(true);
      // An agent-served overlay must carry its path in the catalog too, or the
      // pane would fall back to the stale bundled copy.
      if (served && !plain) {
        expect(main, `${c.key} needs an agentPath`).toMatch(/agentPath: '\/overlay\//);
      }
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
    expect(dock).toMatch(/\[hideBtn, moveBtn, addBtn, colBtn, growBtn, doneBtn, slider\]\.forEach\(interactive\)/);
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
    const rule = /\.pane > \.ph \.ctl\{[^}]*opacity:\s*([0-9.]+)/.exec(dock);
    expect(rule).toBeTruthy();
    expect(Number(rule[1])).toBeGreaterThan(0.1);
  });
});

// ── Round two (Hitya, 2026-08-14) ───────────────────────────────────────────
// Ten findings from the first live look. The ones with a rule behind them are
// pinned here; the rest (setup bar, spans, per-pane background, drag-reorder,
// auto-height, grow-upward) are exercised in the headless-Chromium pass.

describe('the dock can be found without setup mode', () => {
  it('holding panes implies being on screen', () => {
    // "The dock is only accessible from doing the 'Setup ALL Overlays' option."
    // The only ways to set showDock were the tray entry and docking something
    // from INSIDE the dock — unreachable while the dock is hidden. Setup mode
    // force-shows everything, which is how it was found at all.
    expect(main).toMatch(/const wanted = cfg\.showDock \|\| _dockedKeys\(cfg\)\.length > 0;/);
  });

  it('and the window survives as long as it holds panes', () => {
    // Visibility is not enough: the reaper would destroy the window under them.
    expect(main).toMatch(/if \(e && e\.key === 'dock' && _dockedKeys\(cfg\)\.length > 0\) return true;/);
  });

  it('docking from anywhere turns the dock on', () => {
    const setH  = main.slice(main.indexOf("ipcMain.handle('dock-set'"), main.indexOf("ipcMain.handle('dock-span'"));
    const dashH = main.slice(main.indexOf("ipcMain.handle('dock-overlay'"), main.indexOf("ipcMain.handle('toggle-overlay'"));
    expect(setH).toMatch(/if \(!cfg\.showDock\) cfg\.showDock = true;/);
    expect(dashH).toMatch(/if \(!cfg\.showDock\) cfg\.showDock = true;/);
  });
});

describe('the Command Center is dockable again', () => {
  it('is in the catalog', () => {
    expect(CATALOG.find(c => c.key === 'command')).toBeTruthy();
  });

  it('carries its agent path, so the pane is never a stale copy', () => {
    // #65 serves it from the AGENT for hot-swaps; the bundled file is only the
    // offline fallback. A pane pinned to command.html would silently lag behind
    // the version everyone else runs.
    expect(main).toMatch(/agentPath: '\/overlay\/command'/);
    expect(main).toMatch(/const srcFor = \(c\) => \(c\.agentPath && agentPort\)/);
  });

  it('and the pane uses that src rather than the bare filename', () => {
    expect(dock).toMatch(/fr\.setAttribute\('src', spec\.src \|\| spec\.file\)/);
  });
});

describe('dragging a pane moves the PANE', () => {
  it('makes the iframes inert in setup mode', () => {
    // "Dragging the inner dock items from inside of the setup mode moves the
    // entire window instead of just that docked overlay" — a mousedown inside a
    // pane reached the overlay's own ✥ handler, which drags the window.
    expect(dock).toMatch(/body\.setup \.pane > iframe\{pointer-events:none\}/);
  });

  it('reorders through one atomic write of the whole order', () => {
    expect(dock).toMatch(/M\.dockReorder\(order\)/);
    const h = main.slice(main.indexOf("ipcMain.handle('dock-reorder'"), main.indexOf("ipcMain.handle('dock-grow'"));
    // A bad payload must not silently undock anything.
    expect(h).toMatch(/for \(const k of have\) if \(!next\.includes\(k\)\) next\.push\(k\);/);
  });
});

describe('spans, clamped so they cannot break the grid', () => {
  it('never lets a pane span more columns than the grid has', () => {
    expect(main).toMatch(/const c = Math\.max\(1, Math\.min\(cols, Math\.round\(Number\(s\.c\) \|\| 1\)\)\);/);
  });

  it('bounds row span too', () => {
    expect(main).toMatch(/const r = Math\.max\(1, Math\.min\(4, Math\.round\(Number\(s\.r\) \|\| 1\)\)\);/);
  });
});

describe('backgrounds', () => {
  it('the dock plate is opt-in, so "off" really removes it', () => {
    // "Background on/off doesn't do much for the dock. It should fully remove
    // the background from the inside of the box when off."
    expect(dock).toMatch(/#shell\{[^}]*background:transparent/);
    expect(dock).toMatch(/body\.wp-backdrop #shell\{background:rgb\(14 17 22 \/ var\(--bg-alpha\)\)/);
  });

  it('a pane can override the dock, and null means follow it', () => {
    expect(main).toMatch(/return all\[key\] === undefined \? null : !!all\[key\];/);
    expect(dock).toMatch(/\[\['Dock', null\], \['On', true\], \['Off', false\]\]/);
  });

  it('a pane with its background off zeroes the alpha INSIDE its own document', () => {
    // Same-origin, so we can reach in. Setting --bg-alpha to 0 is what makes
    // the overlay's own cards transparent — tinting the pane would not.
    expect(dock).toMatch(/doc\.documentElement\.style\.setProperty\('--bg-alpha', on \? dockAlpha : '0'\)/);
  });
});

describe('auto height and grow-upward', () => {
  it('measures each pane from its own content', () => {
    expect(dock).toMatch(/function fitPane\(pane\)/);
    expect(dock).toMatch(/wrap\.scrollHeight/);
  });

  it('keeps fitting as panes grow and shrink, not just on load', () => {
    // A fight starts, a queue fills — the content changes without any user
    // action, so a one-shot fit on load would be wrong within seconds.
    expect(dock).toMatch(/setInterval\(fitAll, 1000\)/);
  });

  it('grow-upward keeps the BOTTOM edge fixed', () => {
    // That is the whole of "grow upward" — otherwise the window expands down
    // over the game.
    const h = main.slice(main.indexOf("ipcMain.handle('dock-auto-height'"), main.indexOf("ipcMain.handle('dock-cols'"));
    expect(h).toMatch(/const y = growUp \? \(b\.y \+ b\.height - want\) : b\.y;/);
    expect(h).toMatch(/if \(Math\.abs\(b\.height - want\) < 8\) return true;/);   // hysteresis
  });

  it('is on by default', () => {
    expect(main).toMatch(/autoFit: cfg\.dockAutoFit !== false/);
    expect(main).toMatch(/growUp: cfg\.dockGrowUp !== false/);
  });
});

describe('the setup bar', () => {
  it('has the opacity slider and the Done button every other overlay has', () => {
    expect(dock).toMatch(/id="opacitySlider"/);
    expect(dock).toMatch(/id="exitSetupBtn"/);
    expect(dock).toMatch(/M\.setSetupMode\(false\)/);
  });

  it('reserves a gutter so the pane count is not under the ✕', () => {
    expect(dock).toMatch(/\.bar\{[^}]*padding:3px 30px 3px 26px/);
  });
});

describe('the dashboard Dock button', () => {
  const agent = fs.readFileSync(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'), 'utf8');

  it('renders a button per row and wires it', () => {
    expect(agent).toMatch(/class="wp-ov-dock" data-ov="/);
    expect(agent).toMatch(/function wpDockOverlay\(name\)/);
    expect(agent).toMatch(/closest\('\.wp-ov-dock'\)/);
  });

  it('offers no Dock button for the trigger overlay (or the dock itself)', () => {
    expect(agent).toMatch(/var dockCell = \(key === 'trigger' \|\| key === 'dock'\)/);
  });

  it('greys out a docked overlay\'s on/off toggle', () => {
    // Its flag no longer controls anything — the dock owns its visibility.
    expect(agent).toMatch(/tb2\.disabled = isDocked;/);
  });

  it('reads the docked list from Mimic status', () => {
    expect(agent).toMatch(/st\.dockedOverlays/);
    expect(main).toMatch(/dockedOverlays: _dockedKeys\(cfg\)/);
  });
});
