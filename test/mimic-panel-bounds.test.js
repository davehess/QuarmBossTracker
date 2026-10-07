// test/mimic-panel-bounds.test.js — a Canvas/dashboard panel window restores its saved size and place.
//
// Found 2026-10-07 while building the overlay height floor: a panel overlay (createPanelOverlay)
// SAVED its screen signature under `panelBounds_<panel>Sig` (_writeBounds appends 'Sig' to the
// bounds key, the way it does for every overlay) but READ it from `panelBoundsSig_<panel>`, a name
// nothing ever wrote. _resolveBounds needs the signature to match the current screens, so the read
// came back undefined, the saved rect was never used, and a panel window opened at its default
// 360x220 on every launch no matter where it had been left.
//
// The REAL _resolveBounds / _writeBounds / _persistBounds / createPanelOverlay are cut out of
// main.js and run against a fake config, a fake screen and fake windows (the pattern of
// mimic-height-floor.test.js), so the test follows whatever names the shipped code uses. Every
// assertion was mutation-checked (put the read back on `panelBoundsSig_<panel>`; drop the fallback).
//
// Run: npx vitest run test/mimic-panel-bounds.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, ROOT } from './_source-slice.js';

const MAIN = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));

const onScreenBlock = sliceBlock(MAIN, 'function _boundsOnScreen(b) {', '  } catch { return false; }\n}');
const boundsBlock = sliceBlock(MAIN, 'const _OVERLAY_MIN_W = 200;', '}, 400);\n}');
const panelBlock = sliceBlock(MAIN, 'function createPanelOverlay(panelKey) {',
  '  panelOverlays.set(panelKey, win);\n  return true;\n}');

const DEFAULT = { x: 100, y: 100, width: 360, height: 220 };
const SIG = '1920x1080@1';

function env() {
  return evalBlock(`
    let CFG = {};
    function loadConfig() { return JSON.parse(JSON.stringify(CFG)); }
    function saveConfig(c) { CFG = JSON.parse(JSON.stringify(c)); }
    function seed(c) { CFG = JSON.parse(JSON.stringify(c)); }
    function getCfg() { return CFG; }
    let SIG = ${JSON.stringify(SIG)};
    function _screenSignature() { return SIG; }
    function setSig(s) { SIG = s; }
    const screen = { getAllDisplays() { return [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]; } };
    let _displaySettleUntil = 0;
    function _rememberLayout() {}
    let setupMode = false;
    const _singleSetupWins = new Set();
    const panelOverlays = new Map();
    const agentPort = 7777;
    const created = [];
    function _wpPrefs() { return {}; }
    function applyOverlayInteractivity() {}
    function applyOverlayOpacity() {}
    function pushStatus() {}
    class BrowserWindow {
      constructor(opts) {
        this.opts = opts;
        this.bounds = { x: opts.x, y: opts.y, width: opts.width, height: opts.height };
        this.handlers = {};
        this.destroyed = false;
        created.push(this);
      }
      setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} loadURL() {} showInactive() {}
      on(ev, f) { this.handlers[ev] = f; }
      once() {}
      getBounds() { return this.bounds; }
      isDestroyed() { return this.destroyed; }
      close() { this.destroyed = true; if (this.handlers.closed) this.handlers.closed(); }
    }
    ${onScreenBlock}
    ${boundsBlock}
    ${panelBlock}
    return { createPanelOverlay, seed, getCfg, setSig, created, panelOverlays };
  `, []);
}

// The window that `createPanelOverlay` built last, as the options it was constructed with.
const lastOpts = (e) => {
  const w = e.created[e.created.length - 1];
  return { x: w.opts.x, y: w.opts.y, width: w.opts.width, height: w.opts.height };
};

// Drag/resize a panel window to `b`, let the debounced save land, then close it (the second
// createPanelOverlay call would otherwise TOGGLE it shut instead of building a new window).
function leaveAt(e, panel, b) {
  const w = e.panelOverlays.get(panel);
  w.bounds = { ...b };
  w.handlers.resize();
  vi.advanceTimersByTime(500);
  w.close();
}

describe('panel overlay windows restore their saved size and place', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('opens at the default when nothing was ever saved', () => {
    const e = env();
    e.createPanelOverlay('deeps');
    expect(lastOpts(e)).toEqual(DEFAULT);
  });

  it('comes back where it was left, size and place, on the next open', () => {
    const e = env();
    e.createPanelOverlay('deeps');
    const left = { x: 300, y: 250, width: 500, height: 333 };
    leaveAt(e, 'deeps', left);
    e.createPanelOverlay('deeps');
    expect(lastOpts(e)).toEqual(left);
  });

  it('what the save wrote is what the open read: the signature sits under the bounds key + Sig', () => {
    const e = env();
    e.createPanelOverlay('deeps');
    leaveAt(e, 'deeps', { x: 10, y: 20, width: 400, height: 260 });
    const cfg = e.getCfg();
    expect(cfg['panelBounds_deeps']).toEqual({ x: 10, y: 20, width: 400, height: 260 });
    expect(cfg['panelBounds_deepsSig']).toBe(SIG);
  });

  it('keeps each panel to its own saved place', () => {
    const e = env();
    e.createPanelOverlay('deeps');
    leaveAt(e, 'deeps', { x: 300, y: 250, width: 500, height: 333 });
    e.createPanelOverlay('raid');
    expect(lastOpts(e)).toEqual(DEFAULT);
  });

  it('does not restore onto a different screen setup', () => {
    const e = env();
    e.createPanelOverlay('deeps');
    leaveAt(e, 'deeps', { x: 300, y: 250, width: 500, height: 333 });
    e.setSig('2560x1440@1.25');
    e.createPanelOverlay('deeps');
    expect(lastOpts(e)).toEqual(DEFAULT);
  });

  it('does not restore a rect that is no longer on any screen', () => {
    const e = env();
    e.createPanelOverlay('deeps');
    leaveAt(e, 'deeps', { x: 5000, y: 5000, width: 500, height: 333 });
    e.createPanelOverlay('deeps');
    expect(lastOpts(e)).toEqual(DEFAULT);
  });

  describe('a save made under the old signature name', () => {
    const saved = { x: 640, y: 120, width: 420, height: 300 };

    it('is still found when only the old name holds the signature', () => {
      const e = env();
      e.seed({ panelBounds_raid: saved, panelBoundsSig_raid: SIG });
      e.createPanelOverlay('raid');
      expect(lastOpts(e)).toEqual(saved);
    });

    it('still respects the screen setup it was saved under', () => {
      const e = env();
      e.seed({ panelBounds_raid: saved, panelBoundsSig_raid: 'some other screens' });
      e.createPanelOverlay('raid');
      expect(lastOpts(e)).toEqual(DEFAULT);
    });

    it('loses to the current name when both are present', () => {
      const e = env();
      e.seed({ panelBounds_raid: saved, panelBounds_raidSig: 'some other screens', panelBoundsSig_raid: SIG });
      e.createPanelOverlay('raid');
      expect(lastOpts(e)).toEqual(DEFAULT);
    });
  });
});
