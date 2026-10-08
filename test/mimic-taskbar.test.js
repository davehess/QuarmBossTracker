// Only the dashboard belongs on the Windows taskbar.
//
// FB-61 (a beta tester, 2026-10-07, Mimic 2.7.10-beta.1): "Overlays are showing
// up on the Windows taskbar and shouldn't, as they will eat up space on the
// bar." Mimic builds twenty-three windows. Audited that day: the eighteen
// overlays, the Dock and the panel overlay already declared `skipTaskbar: true`;
// Settings, Resource use and UI Studio - ordinary framed windows - did not, and
// each one that is open takes a slot beside the dashboard's.
//
// This pins the rule for every window, present and future: each
// `new BrowserWindow({...})` in the main process declares `skipTaskbar: true`,
// except the one assigned to `mainWindow`. A twenty-fourth window added without
// it fails here and says which one.
//
// Text assertions run over comment-stripped source (test/_source-slice.js
// stripJs): this repo's comments quote the exact phrases being matched and would
// satisfy the assertion on their own.
//
// Run: npx vitest run test/mimic-taskbar.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, stripJs, ROOT } from './_source-slice.js';

const MIMIC = path.join(ROOT, 'apps', 'mimic');

// Every main-process script under apps/mimic (the .html files are renderers).
const files = [MIMIC, path.join(MIMIC, 'scripts')]
  .flatMap(dir => fs.existsSync(dir) ? fs.readdirSync(dir).map(f => path.join(dir, f)) : [])
  .filter(f => f.endsWith('.js') && fs.statSync(f).isFile());

// One entry per `new BrowserWindow({ ... })`: the options object text (found by
// brace matching, so `${panelKey}` inside a template literal balances) and what
// the result is assigned to.
function windows(file) {
  const code = stripJs(readSource(file));
  const out = [];
  const re = /new BrowserWindow\(\{/g;
  let m;
  while ((m = re.exec(code))) {
    const open = m.index + m[0].length - 1;
    let depth = 0, i = open;
    for (; i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}' && --depth === 0) break;
    }
    const lead = code.slice(Math.max(0, m.index - 60), m.index);
    out.push({
      file: path.basename(file),
      options: code.slice(open, i + 1),
      target: (lead.match(/(\w+)\s*=\s*$/) || lead.match(/(\w+)\s*=\s*\S*\s*$/) || [])[1] || '(unassigned)',
    });
  }
  return out;
}
const all = files.flatMap(windows);
const code = files.map(f => stripJs(readSource(f))).join('\n');

describe('the window scan sees every window (it is not vacuous)', () => {
  it('finds all twenty-three BrowserWindows, each with its own webPreferences', () => {
    // test/window-process-names.test.js counts the same twenty-three by their
    // _wpPrefs() names; if either number moves, the other test says so too.
    expect(all.length).toBeGreaterThanOrEqual(23);
    for (const w of all) {
      expect(w.options, `${w.target}: the brace match should span the whole options object`)
        .toMatch(/webPreferences:\s*_wpPrefs\(/);
    }
  });

  it('finds the dashboard, and only one of it', () => {
    expect(all.filter(w => w.target === 'mainWindow')).toHaveLength(1);
  });
});

describe('only the dashboard takes a taskbar slot', () => {
  it('every other window declares skipTaskbar: true', () => {
    const missing = all
      .filter(w => w.target !== 'mainWindow')
      .filter(w => !/\bskipTaskbar:\s*true\b/.test(w.options))
      .map(w => `${w.file}: ${w.target}`);
    expect(missing, 'windows that would show on the taskbar:\n' + missing.join('\n')).toEqual([]);
  });

  it('names the three framed windows that used to be missing it', () => {
    // The ones FB-61 found. Settings / Resource use / UI Studio are the only
    // windows with a title bar of their own, which is why they were skipped.
    for (const t of ['settingsWindow', 'resourcesWindow', 'uiStudioWindow']) {
      const w = all.find(x => x.target === t);
      expect(w, `${t} should be found`).toBeTruthy();
      expect(w.options, t).toMatch(/\bskipTaskbar:\s*true\b/);
    }
  });

  it('the dashboard stays ON the taskbar (it is how a user finds Mimic again)', () => {
    const dash = all.find(w => w.target === 'mainWindow');
    expect(dash.options).not.toMatch(/skipTaskbar:\s*true/);
  });

  it('nothing ever puts a window back on the taskbar afterwards', () => {
    expect(code).not.toMatch(/setSkipTaskbar\(\s*false/);
    expect(code).not.toMatch(/skipTaskbar:\s*false/);
  });
});
