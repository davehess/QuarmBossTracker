// The Resource use readout has to agree with Task Manager.
//
// THE BUG (Uilnayar, 2026-08-04): "this shows way less in task manager. How
// reliable are these numbers?" — Mimic said 1267 MB across 13 processes; Task
// Manager said 460.7 MB across 14.
//
// The card summed `workingSetSize`, which counts pages SHARED between processes
// once per process. Every Chromium renderer maps the same tens of MB of Electron
// framework, so thirteen processes counted that framework thirteen times. The
// per-process rows were inflated ~2.5× and the total was meaningless.
//
// `privateBytes` is the memory NOT shared with any other process — the figure
// Task Manager's Memory column shows, and the only one where per-process rows
// legitimately sum to a total. It is Windows-only, so the payload has to say
// which basis produced the number rather than let an uncomparable figure pass
// as a comparable one.
//
// This mattered beyond the card: the inflated reading is what sized the overlay
// memory problem in the first place.
//
// Run: npx vitest run test/resource-metrics.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, ROOT } from './_source-slice.js';

const src = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const handler = sliceBlock(src, "ipcMain.handle('app-metrics'", '\n});');

describe('memory basis', () => {
  it('prefers privateBytes over workingSetSize', () => {
    expect(handler).toMatch(/const privKb = Number\(mem\.privateBytes\) \|\| 0;/);
    expect(handler, 'workingSetSize is the FALLBACK, never the first choice')
      .toMatch(/privKb \|\| mem\.workingSetSize/);
  });

  it('reports which basis the numbers came from', () => {
    // Without this the card cannot tell the user whether its total is
    // comparable to Task Manager's — and on the wrong basis it is not.
    expect(handler).toMatch(/out\.memBasis = anyWorkingSet \? 'workingSet' : 'private';/);
  });

  // The selection itself, against numbers shaped like the real report.
  const pick = (mem) => {
    const privKb = Number(mem.privateBytes) || 0;
    return { mb: Math.round((privKb || mem.workingSetSize || 0) / 1024), ws: !privKb };
  };

  it('an overlay reports its private cost, not its mapped-framework cost', () => {
    // Real shape: ~100 MB working set, ~38 MB actually unique to the process.
    const r = pick({ workingSetSize: 103 * 1024, privateBytes: 38 * 1024 });
    expect(r.mb).toBe(38);
    expect(r.ws).toBe(false);
  });

  it('falls back to working set where privateBytes is absent (non-Windows)', () => {
    const r = pick({ workingSetSize: 103 * 1024 });
    expect(r.mb).toBe(103);
    expect(r.ws, 'and the payload must flag that it did').toBe(true);
  });

  it('a zero/missing memory block does not throw or invent a number', () => {
    expect(pick({}).mb).toBe(0);
    expect(pick({ workingSetSize: 0, privateBytes: 0 }).mb).toBe(0);
  });

  it('the summed total lands near Task Manager instead of 2.5x over it', () => {
    // Uilnayar's measured set: thirteen Mimic processes.
    const ws   = [125, 119, 118, 105, 103, 103, 101, 99, 93, 85, 82, 80, 54];
    const priv = [ 45,  40,  49,  38,  38,  36,  35, 49, 28, 18, 15, 14, 13];
    const procs = ws.map((w, i) => ({ workingSetSize: w * 1024, privateBytes: priv[i] * 1024 }));
    const total = procs.reduce((a, m) => a + pick(m).mb, 0);
    expect(total).toBe(418);                        // Task Manager read 460.7
    expect(ws.reduce((a, b) => a + b, 0)).toBe(1267); // what the card used to print
  });
});

// ── Naming the processes ────────────────────────────────────────────────────
//
// "It looks like there's more overlays here, these should be off" — asked of a
// list of ten rows all reading "overlay / window". getAppMetrics() has no idea
// what a process is FOR; only main.js does.
describe('_windowLabelsByPid', () => {
  function labels({ cfg = {}, overlays = [], extra = {} }) {
    const win = (pid) => ({ pid, isDestroyed: () => false, webContents: { getOSProcessId: () => pid } });
    const prelude = `
      const __cfg = ${JSON.stringify(cfg)};
      function loadConfig() { return __cfg; }
      const __win = (pid) => ({ isDestroyed: () => false, webContents: { getOSProcessId: () => pid } });
      const _OVERLAY_WINDOWS = ${JSON.stringify(overlays)}
        .map(o => ({ key: o.key, flag: o.flag, __pid: o.pid }))
        .map(o => ({ ...o, get: () => (o.__pid ? __win(o.__pid) : null) }));
      const panelOverlays = new Map(${JSON.stringify(Object.entries(extra.panels || {}))}
        .map(([k, pid]) => [k, __win(pid)]));
      const mainWindow      = ${extra.main      ? '__win(' + extra.main + ')'      : 'null'};
      const settingsWindow  = ${extra.settings  ? '__win(' + extra.settings + ')'  : 'null'};
      const uiStudioWindow  = ${extra.uiStudio  ? '__win(' + extra.uiStudio + ')'  : 'null'};
      const resourcesWindow = ${extra.resources ? '__win(' + extra.resources + ')' : 'null'};
    `;
    void win;
    const h = evalBlock(prelude + sliceBlock(src, 'function _windowLabelsByPid() {', '\n}'), ['_windowLabelsByPid']);
    return Object.fromEntries(h._windowLabelsByPid());
  }

  it('names each overlay instead of "overlay / window"', () => {
    expect(labels({
      cfg: { showHud: true, showCharm: true },
      overlays: [{ key: 'hud', flag: 'showHud', pid: 11 }, { key: 'charm', flag: 'showCharm', pid: 12 }],
    })).toEqual({ 11: 'DPS HUD', 12: 'Charm tracker' });
  });

  it('calls out an overlay that is ALIVE while switched off', () => {
    // The pairing the window exists to surface. A named row with no marker
    // would still leave "why is this running?" unanswered.
    expect(labels({
      cfg: { showHud: false },
      overlays: [{ key: 'hud', flag: 'showHud', pid: 11 }],
    })).toEqual({ 11: 'DPS HUD (switched OFF)' });
  });

  it('skips overlays that have no window', () => {
    expect(labels({
      cfg: { showHud: true },
      overlays: [{ key: 'hud', flag: 'showHud', pid: 11 }, { key: 'charm', flag: 'showCharm', pid: 0 }],
    })).toEqual({ 11: 'DPS HUD' });
  });

  it('names the non-overlay windows too', () => {
    expect(labels({
      overlays: [],
      extra: { main: 1, settings: 2, uiStudio: 3, resources: 4, panels: { parses: 5 } },
    })).toEqual({
      1: 'Dashboard', 2: 'Settings', 3: 'UI Studio',
      4: 'Resource use (this window)', 5: 'panel overlay · parses',
    });
  });

  it('accumulates when two windows share one renderer process', () => {
    // Chromium may co-locate same-origin windows. Overwriting would silently
    // drop one from the list and make the row look cheaper than it is.
    expect(labels({
      cfg: { showHud: true, showPets: true },
      overlays: [{ key: 'hud', flag: 'showHud', pid: 9 }, { key: 'pets', flag: 'showPets', pid: 9 }],
    })).toEqual({ 9: 'DPS HUD + Pet tracker' });
  });

  it('every lifecycle key has a human name', () => {
    // A missing entry falls back to the raw key ('chchain'), which is the kind
    // of thing that ships unnoticed.
    const names = sliceBlock(src, '  const NAMES = {', '\n  };');
    const table = new Function('return ' + names.slice(names.indexOf('{')))();
    const keys = [...src.matchAll(/\{ key: '([a-zA-Z]+)',\s+flag:/g)].map(m => m[1]);
    expect(keys.length).toBe(15);
    for (const k of keys) expect(table[k], `${k} has no display name`).toBeTruthy();
  });
});
