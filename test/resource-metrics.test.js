// The Resource use readout has to agree with Task Manager.
//
// Uilnayar checked it against Task Manager twice, and was right both times.
//
// ROUND 1 — 1267 MB vs 460.7. The card summed `workingSetSize`, which counts
// pages SHARED between processes once per process. Every Chromium renderer maps
// the same tens of MB of Electron framework, so thirteen processes counted that
// framework thirteen times.
//
// ROUND 2 — 274 MB vs 161.3, after switching to `privateBytes`. Closer, still
// not the same measurement: privateBytes is private COMMIT (every private page
// reserved, resident or not) while Task Manager's Memory column is the private
// WORKING SET (only what is in RAM now). Commit is always higher, by a
// different factor per process — the GPU helper reported 102 MB committed
// against ~32 MB resident because it reserves buffers it never touches. So this
// gap is not an error with a correct scalar; the fix is to report the same
// figure Task Manager does, which Chromium does not expose and Windows does
// (Win32_PerfRawData_PerfProc_Process.WorkingSetPrivate), and to keep commit on
// screen beside it so the difference reads as information.
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
  it('headlines the private working set Windows reports', () => {
    // The figure Task Manager's Memory column shows. Everything else is a
    // fallback for when the query has not answered (or is not Windows).
    expect(handler).toMatch(/const wsBytes = _wsPrivate\.byPid\.get\(m\.pid\);/);
    expect(handler).toMatch(/memMb: wsBytes != null/);
  });

  it('still carries the committed figure alongside it', () => {
    // Two numbers on screen turn "these disagree" into "these measure
    // different things", which is the actual answer.
    expect(handler).toMatch(/commitMb: Math\.round\(\(privKb \|\| mem\.workingSetSize \|\| 0\) \/ 1024\)/);
    expect(handler).toMatch(/out\.totalCommitMb = /);
  });

  it('reports which basis the numbers came from', () => {
    // Without this the card cannot tell the user whether its total is
    // comparable to Task Manager's — and on the wrong basis it is not.
    expect(handler).toMatch(/out\.memBasis = anyEstimated \? \(anyWorkingSet \? 'workingSet' : 'commit'\) : 'workingSetPrivate';/);
  });

  it('refreshes AFTER building the payload, so no poll waits on PowerShell', () => {
    const build = handler.indexOf('out.procs.push(');
    const refresh = handler.indexOf('_refreshPrivateWorkingSet(');
    expect(refresh).toBeGreaterThan(build);
  });

  // The selection itself, against numbers shaped like the real report.
  const pick = (mem, wsBytes) => {
    const privKb = Number(mem.privateBytes) || 0;
    const commitMb = Math.round((privKb || mem.workingSetSize || 0) / 1024);
    return {
      mb: wsBytes != null ? Math.round(wsBytes / (1024 * 1024)) : commitMb,
      commitMb,
      estimated: wsBytes == null,
      ws: !privKb,
    };
  };

  it('an overlay reports what is in RAM, not what it mapped or reserved', () => {
    // Real shape: ~100 MB working set (shared framework included), 38 MB
    // private commit, ~32 MB actually resident and private.
    const r = pick({ workingSetSize: 103 * 1024, privateBytes: 38 * 1024 }, 32 * 1024 * 1024);
    expect(r.mb).toBe(32);
    expect(r.commitMb, 'commit stays visible next to it').toBe(38);
    expect(r.estimated).toBe(false);
  });

  it('falls back to commit until Windows answers', () => {
    const r = pick({ workingSetSize: 103 * 1024, privateBytes: 38 * 1024 }, null);
    expect(r.mb).toBe(38);
    expect(r.estimated, 'and the payload must flag that it is a fallback').toBe(true);
  });

  it('falls back again to working set where privateBytes is absent (non-Windows)', () => {
    const r = pick({ workingSetSize: 103 * 1024 }, null);
    expect(r.mb).toBe(103);
    expect(r.ws).toBe(true);
  });

  it('a zero/missing memory block does not throw or invent a number', () => {
    expect(pick({}, null).mb).toBe(0);
    expect(pick({ workingSetSize: 0, privateBytes: 0 }, null).mb).toBe(0);
  });

  it('the total lands ON Task Manager, not 1.7x over it', () => {
    // Uilnayar's third measurement: five Mimic processes, 274 MB reported
    // against Task Manager's 161.
    const priv = [102, 79, 46, 25, 22];                   // committed, what we printed
    const res  = [33.8, 32.1, 35.9, 29.5, 15.8];          // Task Manager's rows
    const procs = priv.map((p, i) => pick({ privateBytes: p * 1024 }, res[i] * 1024 * 1024));
    const total = procs.reduce((a, r) => a + r.mb, 0);
    const commit = procs.reduce((a, r) => a + r.commitMb, 0);
    expect(total).toBe(148);        // Task Manager's group row read 161.3
    expect(commit).toBe(274);       // exactly what the card printed before
    expect(commit / total).toBeGreaterThan(1.5);   // the gap the user spotted
  });
});

describe('the working-set query does not become the cost it measures', () => {
  const fn = sliceBlock(src, 'function _refreshPrivateWorkingSet(pids) {', '\n}');

  it('does NOTHING unless the user opted in', () => {
    // "I'd rather not take up extra cycles all the time just to be right and
    // match Task Manager" (Uilnayar 2026-08-04). Default off; the free number
    // plus an explanation of the difference is the shipped behaviour.
    expect(fn).toMatch(/if \(!cfg\.exactMemory\) \{ _wsPrivate\.byPid = new Map\(\); return; \}/);
    // …and the opt-out must DROP the snapshot, or stale resident numbers would
    // keep being printed as if the query were still running.
    expect(src).toMatch(/ipcMain\.handle\('set-exact-memory'/);
  });

  it('does not run at all once the Resource use window is closed', () => {
    // "when we close that resource use window make sure we're not matching task
    // manager still and querying for the exact in the background" (Uilnayar
    // 2026-08-04). Today the only caller is that window's own 2s poll, so it
    // already stops — but that is the RENDERER's behaviour, and a background
    // PowerShell loop should not rest on it.
    // Must be the FIRST thing after the platform check — an identical guard
    // also lives in the callback, so match on position, not on the text.
    const gate = fn.indexOf('_resourcesWindowOpen()');
    expect(gate, 'no window gate at all').toBeGreaterThan(-1);
    expect(gate, 'the gate must precede the config read, not just exist somewhere')
      .toBeLessThan(fn.indexOf('loadConfig()'));
    expect(src).toMatch(/function _resourcesWindowOpen\(\) \{[\s\S]*?resourcesWindow && !resourcesWindow\.isDestroyed\(\)/);
  });

  it('a query still in flight when the window closes does not repopulate', () => {
    const cb = fn.slice(fn.indexOf('(err, stdout) =>'));
    expect(cb).toMatch(/if \(!_resourcesWindowOpen\(\)\) \{ _wsPrivate\.byPid = new Map\(\); return; \}/);
    // …and the guard must sit BEFORE the parse, not after it.
    expect(cb.indexOf('_resourcesWindowOpen()')).toBeLessThan(cb.indexOf('const byPid = new Map();'));
  });

  it('closing the window drops the snapshot outright', () => {
    // Otherwise the next open shows resident numbers, from a query that is no
    // longer running, with the checkbox reading whatever it reads.
    const closer = src.slice(src.indexOf("resourcesWindow.on('closed'"));
    const stanza = closer.slice(0, 400);
    expect(stanza).toMatch(/resourcesWindow = null;/);
    expect(stanza).toMatch(/_wsPrivate\.byPid = new Map\(\);/);
    expect(stanza, 'the TTL clock must reset too, or the reopen waits 12s')
      .toMatch(/_wsPrivate\.at = 0;/);
  });

  it('reports what the query cost on THIS machine', () => {
    // An estimate from us is worth less than a measurement from them, and the
    // whole point of the toggle is deciding whether the cost is acceptable.
    expect(fn).toMatch(/const started = Date\.now\(\);/);
    expect(fn).toMatch(/_wsPrivate\.lastMs = _wsPrivate\.at - started;/);
    expect(handler).toMatch(/out\.wsQueryMs = _wsPrivate\.lastMs \|\| 0;/);
    expect(handler).toMatch(/out\.exactMemory = !!loadConfig\(\)\.exactMemory;/);
  });

  it('rate-limits to one PowerShell spawn per TTL', () => {
    // The card polls every 2s and claims Mimic is free at idle. A query per
    // poll would make this window the biggest CPU consumer on the list.
    expect(src).toMatch(/const _WS_TTL_MS = 12_000;/);
    expect(fn).toMatch(/if \(Date\.now\(\) - _wsPrivate\.at < _WS_TTL_MS\) return;/);
  });

  it('never runs two at once', () => {
    expect(fn).toMatch(/if \(_wsPrivate\.inFlight\) return;/);
    expect(fn).toMatch(/_wsPrivate\.inFlight = true;/);
  });

  it('stamps the clock even when the query FAILS', () => {
    // Otherwise a broken query re-spawns PowerShell on every 2s poll forever —
    // the runaway version of this feature.
    const cb = fn.slice(fn.indexOf('(err, stdout) =>'));
    expect(cb.indexOf('_wsPrivate.at = Date.now();'))
      .toBeLessThan(cb.indexOf('if (err || !stdout) return;'));
    expect(fn, 'the throw path must stamp it too').toMatch(/catch \{ _wsPrivate\.inFlight = false; _wsPrivate\.at = Date\.now\(\); \}/);
  });

  it('keeps the last good snapshot rather than blanking on a bad read', () => {
    expect(fn).toMatch(/if \(byPid\.size\) _wsPrivate\.byPid = byPid;/);
  });

  it('does nothing off Windows, and nothing with no pids', () => {
    expect(fn).toMatch(/if \(process\.platform !== 'win32'\) return;/);
    expect(fn).toMatch(/if \(!pids \|\| !pids\.length\) return;/);
  });

  it('parses the pid|bytes lines the query emits', () => {
    const parse = (out) => {
      const byPid = new Map();
      for (const line of String(out).split(/\r?\n/)) {
        const m = line.trim().match(/^(\d+)\|(\d+)$/);
        if (m) byPid.set(Number(m[1]), Number(m[2]));
      }
      return byPid;
    };
    const r = parse('1234|35438592\r\n5678|15204352\r\n');
    expect(r.get(1234)).toBe(35438592);
    expect(Math.round(r.get(5678) / (1024 * 1024))).toBe(15);
    expect(parse('nonsense\r\n').size, 'garbage must not become a zero-byte process').toBe(0);
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
