// A destroyed overlay window must never be driven - not by one visibility pass,
// not by any other function that holds the reference.
//
// The guild lead, 2026-10-07, Mimic 2.7.10-beta.1: pressing the hide-all hotkey
// raised a main-process error dialog,
//   Uncaught Exception: TypeError: Object has been destroyed
//     at applyMobInfoVisibility (main.js:5803:68)   <- the `.hide()` call
//     at applyAllVisibility (main.js:6447:3)
//     at Function.toggleHideAllOverlays (main.js:6554:3)
// Electron throws on ANY method call against a destroyed BrowserWindow, and the
// guard in front of it was `if (!mobInfoWindow) return;` - which a destroyed
// window sails through, because the wrapper object is still truthy.
//
// This file is the class-level net. The lifecycle half (the reference is nulled
// when the window dies, and a stale one is swept and rebuilt) is in
// test/overlay-lifecycle.test.js; here:
//   1. _live() itself,
//   2. EVERY apply*Visibility, run against a destroyed window that throws on
//      any call (behaviour, not text),
//   3. a scan of main.js: no function outside the creators touches an overlay
//      reference without testing it is alive,
//   4. the 'closed' catch really is wired to every window that gets built.
//
// Source-sliced (test/_source-slice.js): main.js cannot be require()d without
// Electron, so the shipped functions are evaluated against fake windows. Rename
// or delete one and the slice throws - a red test, not a pass on a stale copy.
//
// Run: npx vitest run test/mimic-destroyed-window-guard.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const src = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const code = stripJs(src);

const liveSrc = sliceBlock(src, 'function _live(win) {', '}');
const live = new Function(liveSrc + '\nreturn _live;')();

// The eighteen overlay windows: module-level binding → its apply function.
// Discovered from the source, not listed here, so a nineteenth overlay that
// ships without a guard is caught instead of silently outside this file.
const applyFns = [...code.matchAll(/^function (apply\w+Visibility)\(\) \{/gm)]
  .map(m => m[1])
  .filter(n => n !== 'applyAllVisibility');
function windowVarOf(fnName) {
  const body = sliceBlock(src, `function ${fnName}() {`, '\n}');
  const m = body.match(/(\w+Window)\.showInactive\(\)/);
  return { body, v: m && m[1] };
}

// A window that is gone: truthy, isDestroyed() true, and EVERY other member
// throws the way Electron's does. If an apply function touches it, it throws.
function deadWindow() {
  return new Proxy({}, {
    get(_t, prop) {
      if (prop === 'isDestroyed') return () => true;
      return () => { throw new TypeError('Object has been destroyed'); };
    },
  });
}

describe('_live()', () => {
  it('is false for nothing, and for a destroyed window', () => {
    expect(live(null)).toBe(false);
    expect(live(undefined)).toBe(false);
    expect(live(deadWindow())).toBe(false);
  });
  it('is true for a window that is alive', () => {
    expect(live({ isDestroyed: () => false })).toBe(true);
  });
});

describe('every apply*Visibility refuses to drive a destroyed window', () => {
  it('finds all eighteen overlay apply functions (the discovery is not vacuous)', () => {
    expect(applyFns).toHaveLength(18);
    const vars = applyFns.map(f => windowVarOf(f).v);
    for (const [f, v] of applyFns.map((f, i) => [f, vars[i]])) {
      expect(v, `${f} should drive a *Window binding with showInactive()`).toBeTruthy();
    }
    expect(new Set(vars).size, 'one binding per apply function').toBe(18);
  });

  // setupMode on  -> the show branch; off with everything false -> the hide
  // branch; showCanvas on -> applyTriggerVisibility's own hide-and-return.
  const scenarios = [
    { name: 'show branch', setupMode: true,  cfg: { overlaysLocked: true } },
    { name: 'hide branch', setupMode: false, cfg: { overlaysLocked: true } },
    { name: 'canvas on',   setupMode: false, cfg: { overlaysLocked: true, showCanvas: true } },
  ];

  for (const fnName of applyFns) {
    it(`${fnName}: a destroyed window is neither shown nor hidden, and nothing throws`, () => {
      const { body, v } = windowVarOf(fnName);
      for (const s of scenarios) {
        const run = new Function('__win', '__setup', '__cfg', `
          let ${v} = __win;
          let setupMode = __setup, _canvasArrange = false;
          function loadConfig() { return __cfg; }
          function _eqGateOk() { return true; }
          function _blindForceOpen() { return false; }
          function _dockedKeys() { return ['hud']; }
          ${liveSrc}
          ${body}
          return ${fnName};
        `);
        const fn = run(deadWindow(), s.setupMode, s.cfg);
        expect(() => fn(), `${fnName} (${s.name})`).not.toThrow();
      }
    });

    it(`${fnName}: a live window is still driven (the guard does not over-bail)`, () => {
      const { body, v } = windowVarOf(fnName);
      const calls = [];
      const win = {
        isDestroyed: () => false,
        showInactive: () => calls.push('show'),
        hide: () => calls.push('hide'),
      };
      const fn = new Function('__win', '__calls', `
        let ${v} = __win;
        let setupMode = true, _canvasArrange = false;
        function loadConfig() { return { overlaysLocked: true }; }
        function _eqGateOk() { return true; }
        function _blindForceOpen() { return false; }
        function _dockedKeys() { return ['hud']; }
        ${liveSrc}
        ${body}
        return ${fnName};
      `)(win, calls);
      fn();
      expect(calls, `${fnName} must still show or hide a live window`).toHaveLength(1);
    });
  }
});

describe('no function reaches into an overlay window without checking it is alive', () => {
  // Every `let xWindow` that is an overlay binding.
  const overlayVars = [...code.matchAll(/^let (\w+Window)\s*=\s*null;/gm)]
    .map(m => m[1])
    .filter(v => !['mainWindow', 'settingsWindow', 'uiStudioWindow', 'resourcesWindow'].includes(v));

  // Split the file into units at each top-level function / handler.
  const units = [];
  {
    const lines = code.split('\n');
    let cur = { head: '(file top)', lines: [] };
    for (const line of lines) {
      if (/^(async )?function \w+|^ipcMain\.(handle|on)\(|^app\.(on|whenReady)\(/.test(line)) {
        units.push(cur);
        cur = { head: line.trim(), lines: [] };
      }
      cur.lines.push(line);
    }
    units.push(cur);
  }

  it('sees all eighteen overlay bindings', () => {
    expect(overlayVars).toHaveLength(18);
  });

  it('every member access outside a creator is guarded', () => {
    const offenders = [];
    for (const u of units) {
      // A creator's `ready-to-show` closure runs for a window that was just
      // built; there is nothing to guard. They are the only exemption.
      if (/^function create\w+(Overlay|Window)\b/.test(u.head)) continue;
      const text = u.lines.join('\n');
      for (const v of overlayVars) {
        const access = new RegExp(`\\b${v}\\.(?!isDestroyed\\b)\\w+`, 'g');
        const guarded = text.includes(`_live(${v})`) || text.includes(`${v}.isDestroyed()`);
        for (const line of u.lines) {
          if (!access.test(line)) { access.lastIndex = 0; continue; }
          access.lastIndex = 0;
          // `try { xWindow.hide(); } catch {}` swallows the throw by design.
          if (/\btry\s*\{/.test(line)) continue;
          if (!guarded) offenders.push(`${u.head.slice(0, 60)}  →  ${line.trim().slice(0, 90)}`);
        }
      }
    }
    expect(offenders, 'unguarded overlay access:\n' + offenders.join('\n')).toEqual([]);
  });

  it('the old truthy-only guard is gone from every apply function', () => {
    // `if (!xWindow) return;` is the exact line that let the destroyed window in.
    for (const v of overlayVars) {
      expect(code, `${v} still has a truthy-only guard`)
        .not.toMatch(new RegExp(`^\\s*if \\(!${v}\\) return;`, 'm'));
    }
  });
});

describe("the 'closed' catch is wired to every window that is built", () => {
  // app 'browser-window-created' fires inside the BrowserWindow constructor for
  // every window, so none of the creators has to remember its own listener.
  const wiring = sliceBlock(src, "app.on('browser-window-created'", '\n});');

  function wire() {
    const handlers = {};
    const forgotten = [];
    const app = { on: (ev, fn) => { handlers[ev] = fn; } };
    new Function('app', '_forgetClosedOverlay', wiring)(app, (w) => forgotten.push(w));
    return { handlers, forgotten };
  }

  it("registers on 'browser-window-created'", () => {
    expect(Object.keys(wire().handlers)).toEqual(['browser-window-created']);
  });

  it("hands a window to _forgetClosedOverlay when that window's 'closed' fires", () => {
    const { handlers, forgotten } = wire();
    const listeners = {};
    const win = { once: (ev, fn) => { listeners[ev] = fn; } };
    handlers['browser-window-created']({}, win);
    expect(forgotten, 'nothing is forgotten before the window dies').toEqual([]);
    listeners.closed();
    expect(forgotten).toEqual([win]);
  });

  it('a window that cannot take a listener does not break window creation', () => {
    const { handlers } = wire();
    expect(() => handlers['browser-window-created']({}, { once() { throw new Error('boom'); } })).not.toThrow();
  });
});
