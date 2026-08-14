// Every renderer carries its name on its own command line.
//
// "Can these expose their names in Task manager as well?" (Hitya 2026-08-04)
//
// Partly, and the limit is worth writing down so nobody tries again: Task
// Manager's Name column reads the executable's version resource, and every
// Mimic renderer IS the same Wolf Pack Mimic.exe — that column cannot be
// changed. The Dashboard row is named only because it owns a visible taskbar
// window whose title Task Manager appends; overlays are skipTaskbar on purpose
// (they would otherwise flood alt-tab), so they have no such window.
//
// What CAN carry a name is the process command line. Electron's
// `additionalArguments` is appended to the renderer's argv, which shows up under
// Task Manager → Details → Select columns → Command line, and in Process
// Explorer / Resource Monitor.
//
// Run: npx vitest run test/window-process-names.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, ROOT } from './_source-slice.js';

const src = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));

const prefs = evalBlock(
  "const path = { join: (...a) => a.join('/') };\nconst __dirname = '/app';\n"
  + sliceBlock(src, 'function _wpPrefs(name, extra) {', '\n}'),
  ['_wpPrefs'],
)._wpPrefs;

describe('_wpPrefs', () => {
  it('stamps the window name onto the renderer command line', () => {
    expect(prefs('Charm tracker').additionalArguments).toEqual(['--wp-window=Charm-tracker']);
  });

  it('collapses whitespace so the tag stays ONE command-line token', () => {
    // '--wp-window=DPS HUD' would split into two arguments and read as a stray
    // "HUD" arg in every process viewer.
    for (const a of prefs('DPS HUD').additionalArguments) {
      expect(a, a).not.toMatch(/\s/);
    }
    expect(prefs('Extended  target').additionalArguments).toEqual(['--wp-window=Extended-target']);
  });

  it('still supplies the preload and context isolation every window needs', () => {
    const p = prefs('Melody');
    expect(p.preload).toBe('/app/preload.js');
    expect(p.contextIsolation, 'contextIsolation must never be lost to this refactor').toBe(true);
  });

  it('merges per-window extras without dropping the defaults', () => {
    // The trigger overlay needs backgroundThrottling:false — it speaks callouts
    // while hidden, and a throttled renderer would stutter them.
    const p = prefs('Trigger alerts', { backgroundThrottling: false });
    expect(p.backgroundThrottling).toBe(false);
    expect(p.contextIsolation).toBe(true);
    expect(p.additionalArguments).toEqual(['--wp-window=Trigger-alerts']);
  });

  it('never emits a nameless tag', () => {
    expect(prefs().additionalArguments).toEqual(['--wp-window=window']);
    expect(prefs('').additionalArguments).toEqual(['--wp-window=window']);
  });
});

describe('every window goes through it', () => {
  it('no window is still built with a raw webPreferences literal', () => {
    // A window that skipped the helper is a nameless process in Task Manager —
    // exactly the thing being fixed, and invisible unless asserted.
    expect(src, 'this window bypasses _wpPrefs')
      .not.toMatch(/webPreferences: \{ preload: path\.join\(__dirname, 'preload\.js'\)/);
  });

  it('names all twenty-one windows, with no duplicates', () => {
    const names = [...src.matchAll(/webPreferences: _wpPrefs\((?:'([^']+)'|([^,)]+))/g)]
      .map(m => m[1] || m[2].trim());
    expect(names).toHaveLength(21);
    // Panel overlays are named from their runtime key, so that one is an
    // expression rather than a literal.
    const literals = names.filter(n => !n.includes('panelKey'));
    expect(new Set(literals).size, 'two windows sharing a name defeats the point')
      .toBe(literals.length);
    for (const want of ['DPS HUD', 'Charm tracker', 'Mob Info', 'CH chain', 'Dashboard', 'Resource use', 'Dock']) {
      expect(literals, `${want} should be named`).toContain(want);
    }
  });

  it('the panel overlay is named from its key, not a constant', () => {
    expect(src).toMatch(/_wpPrefs\('panel overlay ' \+ panelKey\)/);
  });

  it('the trigger overlay keeps backgroundThrottling off through the helper', () => {
    expect(src).toMatch(/_wpPrefs\('Trigger alerts', \{ backgroundThrottling: false \}\)/);
  });
});
