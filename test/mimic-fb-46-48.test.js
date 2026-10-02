// test/mimic-fb-46-48.test.js — two Mimic feedback fixes.
//
// FB-48: "scaling an overlay will be 'saved' but then if you close it and open it back up it's back
// to standard scale but larger size". The overlay's own size slider saved under the bounds-key name
// ('mobInfo', 'extTarget', 'chChain', 'popRaid', 'panelBounds_<x>') while every reader looks the
// scale up under the _overlayEntries() name ('mobinfo', …). A size saved under the old name still
// applies, and is moved to the new name on the next change.
//
// FB-46: "When sending notices about zeal updates, it would be helpful if you added a link to click
// directly to the area that has the ability to update zeal." The desktop notice and the dashboard
// notice both open Settings at the Zeal part.
//
// Run: npx vitest run test/mimic-fb-46-48.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT, AGENT_INDEX } from './_source-slice.js';

const MAIN = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));

describe('FB-48: an overlay\'s own scale is read back under the name it is saved under', () => {
  const block = sliceBlock(MAIN, "// The key an overlay's OWN setup bar", '  return _validScale(cfg.overlayScale) ?? 1.0;\n}');
  function load(cfg, entries) {
    return evalBlock(`
      function loadConfig() { return CFG; }
      function _overlayEntries() { return ENTRIES; }
      function _validScale(v) { const s = Number(v); return (Number.isFinite(s) && s >= 0.5 && s <= 2.0) ? s : null; }
      ${block}
    `.replace('CFG', JSON.stringify(cfg)).replace('ENTRIES', entries), ['_ownOverlayKey', 'overlayScaleFor', '_legacyScaleKey']);
  }
  it('the key is the overlay entry name, not the bounds name', () => {
    const W = '[["dock",{d:1}],["mobinfo",{m:1}],["exttarget",{e:1}],["panel:raid",{p:1}],["canvas",{c:1}]]';
    const A = evalBlock(`
      const ENTRIES = ${W};
      function loadConfig() { return {}; }
      function _overlayEntries() { return ENTRIES; }
      function _validScale() { return null; }
      ${block}
    `, ['_ownOverlayKey', 'ENTRIES']);
    expect(A._ownOverlayKey(A.ENTRIES[1][1])).toBe('mobinfo');
    expect(A._ownOverlayKey(A.ENTRIES[2][1])).toBe('exttarget');
    expect(A._ownOverlayKey(A.ENTRIES[3][1])).toBe('panel:raid');
    expect(A._ownOverlayKey(A.ENTRIES[0][1])).toBeNull();   // the dock stays out, as before
    expect(A._ownOverlayKey(A.ENTRIES[4][1])).toBeNull();   // and the Canvas
  });
  it('a scale a member already saved under the old name still applies', () => {
    const A = load({ overlayScale: 1.0, overlayScaleByKey: { mobInfo: 1.4, panelBounds_raid: 0.8 } }, '[]');
    expect(A.overlayScaleFor('mobinfo')).toBe(1.4);
    expect(A.overlayScaleFor('panel:raid')).toBe(0.8);
    expect(A.overlayScaleFor('hud')).toBe(1.0);
  });
  it('the new name wins over the old one', () => {
    const A = load({ overlayScaleByKey: { mobInfo: 1.4, mobinfo: 1.2 } }, '[]');
    expect(A.overlayScaleFor('mobinfo')).toBe(1.2);
  });
  it('the slider handlers and Setup THIS use it; nothing derives the key from the bounds name', () => {
    const code = stripJs(MAIN);
    expect(code).not.toMatch(/_boundsKeyForWindow\(win\)\.replace\(\/Bounds\$\/, ''\)/);
    const setH = sliceBlock(code, "ipcMain.handle('set-overlay-scale-this'", '\n});');
    expect(setH).toMatch(/const key = _ownOverlayKey\(win\);/);
    expect(setH).toMatch(/if \(_legacyScaleKey\(key\)\) delete cfg\.overlayScaleByKey\[_legacyScaleKey\(key\)\];/);
    expect(sliceBlock(code, "ipcMain.handle('get-overlay-scale-this'", '\n});')).toMatch(/const key = _ownOverlayKey\(win\);/);
    expect(sliceBlock(code, "ipcMain.handle('set-setup-mode-this'", '\n});')).toMatch(/const key = _ownOverlayKey\(win\);/);
  });
});

describe('FB-46: a Zeal update notice opens Settings at Zeal', () => {
  const block = sliceBlock(MAIN, 'function openSettings(section) {', "settingsWindow.on('closed', () => { settingsWindow = null; });\n}");
  function run(arg, open) {
    const { go } = evalBlock(`
      let settingsWindow = OPEN ? { focus() {}, webContents: { send(ch, s) { log.push(['send', ch, s]); } } } : null;
      const log = [];
      function _wpPrefs() { return {}; }
      class BrowserWindow { constructor() {} loadFile(f, o) { log.push(['load', f, o]); } on() {} }
      ${block}
      function go(a) { openSettings(a); return log; }
    `.replace('OPEN', open ? 'true' : 'false'), ['go']);
    return go(arg);
  }
  it('a new window loads at #zeal', () => {
    expect(run('zeal', false)).toEqual([['load', 'settings.html', { hash: 'zeal' }]]);
  });
  it('an open window is told to scroll there', () => {
    expect(run('zeal', true)).toEqual([['send', 'settings-goto', 'zeal']]);
  });
  it('a tray click (a menu item as the argument) opens Settings at the top, as before', () => {
    expect(run({ label: 'Settings…' }, false)).toEqual([['load', 'settings.html', undefined]]);
  });
  it('the desktop notice and the dashboard notice both go there', () => {
    const code = stripJs(MAIN);
    expect(code).toMatch(/n\.on\('click', \(\) => \{ try \{ openSettings\('zeal'\); \} catch \{\} \}\);\n\s+_zealNotice = n;/);
    expect(code).toMatch(/ipcMain\.handle\('open-settings', \(_e, section\) => \{ openSettings\(section\); return true; \}\);/);
    const pre = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js')));
    expect(pre).toMatch(/openSettings: +\(section\) +=> ipcRenderer\.invoke\('open-settings', section\),/);
    expect(pre).toMatch(/onSettingsGoto: +\(cb\) +=> ipcRenderer\.on\('settings-goto'/);
    const settings = readSource(path.join(ROOT, 'apps', 'mimic', 'settings.html'));
    expect(settings).toContain('<h2 id="zeal">Zeal</h2>');
    expect(stripJs(settings)).toMatch(/_gotoSection\(\(location\.hash \|\| ''\)\.slice\(1\)\);/);
    expect(stripJs(readSource(AGENT_INDEX))).toMatch(/created_at: _zealUpdate\.at \|\| new Date\(\)\.toISOString\(\),\n\s+action: 'zeal',/);
    const dash = stripJs(readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html')));
    expect(dash).toMatch(/n\.action === "zeal" && window\.mimic && window\.mimic\.openSettings/);
    expect(dash).toMatch(/window\.mimic\.openSettings\("zeal"\)/);
  });
});
