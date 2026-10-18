// test/overlay-sets.test.js — Mimic 3.0 step 1: named overlay sets (R18 + R20, DECISIONS §83a).
//
// The guild lead, 2026-09-29: "multiple overlay modes per character, switchable via hotkeys or a simple
// pipe output that we pick up /pipe mimic load <overlay set name> or /pipe mimic save <overlay set name>
// the same load/save should also be available from taskbar or cycle through via command … stored locally
// in case of server issues".
//
// overlaySets.js runs for real (require). main.js's capture and placement run as slices with fake
// Electron pieces; the wiring (pipe, tray, Settings, preload) is checked as stripped source.
//
// Run: npx vitest run test/overlay-sets.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const sets = require(path.join(ROOT, 'apps', 'mimic', 'overlaySets.js'));
const main = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));

const snap = (n) => ({ show: { showHud: true, showCharm: n > 1 }, rects: {}, sig: '0,0,1920x1080' });

describe('the store: sets by name, each character\'s own modes', () => {
  it('saves, loads and cycles a character\'s own sets; a name is its own key whatever the case', () => {
    const s = sets.empty();
    expect(sets.put(s, 'Raid', snap(1), 'Brackwyn').ok).toBe(true);
    expect(sets.put(s, 'solo', snap(2), 'Brackwyn').ok).toBe(true);
    expect(sets.put(s, 'Corvale raid', snap(3), 'Corvale').ok).toBe(true);
    expect(sets.current(s, 'Brackwyn')).toBe('solo');
    expect(sets.use(s, 'RAID', 'Brackwyn').name).toBe('Raid');          // any case finds it
    expect(sets.step(s, 'Brackwyn', 1)).toBe('solo');                    // Brackwyn's two, not Corvale's
    expect(sets.step(s, 'Brackwyn', -1)).toBe('solo');
    sets.use(s, 'solo', 'Brackwyn');
    expect(sets.step(s, 'Brackwyn', 1)).toBe('raid');
  });

  it('a character with fewer than two of its own cycles every set, by name', () => {
    const s = sets.empty();
    sets.put(s, 'b', snap(1), 'Brackwyn'); sets.put(s, 'a', snap(1), null); sets.put(s, 'c', snap(1), null);
    expect(sets.step(s, 'Brackwyn', 1)).toBe('c');                       // after b, by name
    expect(sets.step(s, 'Nyssara', 1)).toBe('a');                        // never used one: the first
    expect(sets.step(sets.empty(), 'Brackwyn', 1)).toBeNull();
  });

  it('saving over keeps the name; deleting clears it from every character', () => {
    const s = sets.empty();
    sets.put(s, 'Raid', snap(1), 'Brackwyn');
    sets.put(s, 'raid', snap(2), 'Corvale');                             // same set, over it
    expect(Object.keys(s.sets)).toEqual(['raid']);
    expect(s.sets.raid.name).toBe('raid');
    expect(s.sets.raid.show.showCharm).toBe(true);
    expect(sets.remove(s, 'RAID')).toBe(true);
    expect(s.chars.brackwyn).toEqual({ list: [], current: null });
    expect(s.chars.corvale.current).toBeNull();
  });

  it('names are cleaned and capped; the store has a ceiling', () => {
    expect(sets.cleanName('  raid\u0007  night  ')).toBe('raid night');
    expect(sets.cleanName('x'.repeat(50))).toHaveLength(sets.NAME_MAX);
    expect(sets.put(sets.empty(), '   ', snap(1), null).ok).toBe(false);
    const s = sets.empty();
    for (let i = 0; i < sets.MAX_SETS; i++) expect(sets.put(s, 'set ' + i, snap(1), null).ok).toBe(true);
    expect(sets.put(s, 'one more', snap(1), null).ok).toBe(false);
    expect(sets.put(s, 'set 3', snap(2), null).ok).toBe(true);           // saving over still works at the cap
  });

  it('the list the tray and Settings show', () => {
    const s = sets.empty();
    sets.put(s, 'Raid', snap(2), 'Brackwyn'); sets.put(s, 'Bard', snap(1), 'Corvale');
    expect(sets.list(s, 'Brackwyn')).toEqual([
      { key: 'bard', name: 'Bard', savedAt: s.sets.bard.savedAt, current: false, mine: false, overlays: 1 },
      { key: 'raid', name: 'Raid', savedAt: s.sets.raid.savedAt, current: true, mine: true, overlays: 2 },
    ]);
  });
});

describe('the file on this computer', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-sets-'));
  const file = path.join(dir, 'overlay-sets.json');
  it('round-trips, keeps a backup, and falls back to it when the file is torn', () => {
    const s = sets.empty();
    sets.put(s, 'Raid', snap(1), 'Brackwyn');
    sets.save(file, s);
    sets.put(s, 'Solo', snap(2), 'Brackwyn');
    sets.save(file, s);
    expect(Object.keys(sets.load(file).sets)).toEqual(['raid', 'solo']);
    fs.writeFileSync(file, '{"version":1,"sets":{"ra');                 // killed mid-write
    expect(Object.keys(sets.load(file).sets)).toEqual(['raid']);         // the backup: the save before
    expect(sets.load(path.join(dir, 'none.json'))).toEqual(sets.empty());
  });
  it('what comes off disk is checked: bad names, strangers in a character\'s list, a current set that is gone', () => {
    const j = { sets: { raid: { name: 'Raid' }, x: { name: 'Other' }, '': { name: '' } },
      chars: { brackwyn: { list: ['raid', 'gone', 'raid'], current: 'gone' }, 'no one': { list: [] } } };
    expect(sets.normalize(j)).toEqual({ version: 1, sets: { raid: { name: 'Raid' } }, chars: { brackwyn: { list: ['raid'], current: null } } });
  });
});

describe('/pipe mimic …', () => {
  const p = sets.parsePipeCommand;
  it('reads the verbs', () => {
    expect(p('mimic load raid night')).toEqual({ verb: 'load', name: 'raid night' });
    expect(p('Mimic Load Raid')).toEqual({ verb: 'load', name: 'Raid' });
    expect(p('mimic save raid')).toEqual({ verb: 'save', name: 'raid' });
    expect(p('mimic save')).toEqual({ verb: 'save', name: null });      // over the current one
    expect(p('mimic next')).toEqual({ verb: 'next' });
    expect(p('mimic prev')).toEqual({ verb: 'prev' });
    expect(p('mimic lock')).toEqual({ verb: 'lock', on: null });        // flips
    expect(p('mimic lock off')).toEqual({ verb: 'lock', on: false });
    expect(p('mimic unlock')).toEqual({ verb: 'lock', on: false });
  });
  it('leaves everything else alone — including a delete, which a hotbar typo must never do', () => {
    for (const t of ['fd', 'mend', 'mimic', 'mimic load', 'mimic delete raid', 'mimic lock maybe', 'mimicload raid', 'say mimic load raid', null]) {
      expect(p(t), String(t)).toBeNull();
    }
  });
  it('is wired: the character who typed it runs it', () => {
    const b = stripJs(sliceBlock(main, '} else if (type === 4) {', '} else if (type === 6) {'));
    expect(b).toMatch(/const cmd = overlaySets\.parsePipeCommand\(text\);\s*if \(cmd\) \{ try \{ _overlaySetCommand\(cmd, character\); \}/);
  });
});

describe('main.js: what a set holds, and where it lands', () => {
  const ONE = '0,0,1920x1080';
  const BOTH = '0,0,1920x1080|1920,0,1920x1080';
  const MAIN = { x: 0, y: 0, width: 1920, height: 1080 };
  const SIDE = { x: 1920, y: 0, width: 1920, height: 1080 };
  const planSrc = sliceBlock(main, 'function _parseSigDisplays(sig) {',
    "return Object.keys(moves).length ? { kind: 'bring', moves, withEq, side, sideOntoEq } : { kind: 'none', moves: {} };\n}");
  const hereSrc = sliceBlock(main, 'function _setRectsHere(set) {', '  return Object.assign({}, rects, plan.moves);\n}');
  const here = (sig, displays) => new Function('_screenSignature', '_eqMainWindow', 'screen',
    planSrc + '\n' + hereSrc + '\nreturn _setRectsHere;')(
    () => sig, () => null,
    { getPrimaryDisplay: () => ({ bounds: MAIN, workArea: MAIN }), getAllDisplays: () => displays.map(b => ({ bounds: b, workArea: b })) });

  const hud = { x: 1920 + 900, y: 500, width: 300, height: 200 };        // on the side screen
  const trig = { x: 700, y: 200, width: 600, height: 200 };              // with EverQuest

  it('on the screens it was saved on, every overlay goes exactly where the set had it', () => {
    const rects = { hudBounds: hud, triggerBounds: trig };
    expect(here(BOTH, [MAIN, SIDE])({ sig: BOTH, rects })).toEqual(rects);
  });
  it('saved with two screens, loaded with one: the side screen\'s overlay comes over at the same spot; the rest stay', () => {
    const out = here(ONE, [MAIN])({ sig: BOTH, rects: { hudBounds: hud, triggerBounds: trig } });
    expect(out.triggerBounds).toEqual(trig);
    expect(out.hudBounds).toEqual({ x: 900, y: 500, width: 300, height: 200 });
  });

  it('captures which overlays are on, open windows\' spots, saved spots of closed ones on this setup only, and the look', () => {
    const capSrc = sliceBlock(main, 'function _captureOverlaySet() {', '\n  };\n}');
    const consts = sliceBlock(main, 'const _SET_BOUNDS_KEYS = [', "const _SET_LOOK_KEYS = ['overlayOpacity', 'overlayBgAlpha', 'overlayBackdrop', 'overlayScaleByKey'];");
    const HIDEALL = ['showDock', 'showHud', 'showTriggerOverlay', 'showCharm'];
    const run = (cfg, hidden, prev) => new Function('loadConfig', '_screenSignature', '_HIDEALL_FLAGS', '_hideAllActive', '_hideAllPrev',
      '_overlayRectsNow', '_eqMainWindow', consts + '\n' + capSrc + '\nreturn _captureOverlaySet();')(
      () => cfg, () => ONE, HIDEALL, hidden, prev, () => ({ hudBounds: { x: 5, y: 6, width: 7, height: 8 } }), () => null);
    const cfg = {
      showHud: true, showCharm: false,                                    // showTriggerOverlay unset = shown
      charmBounds: { x: 1, y: 2, width: 3, height: 4 }, charmBoundsSig: ONE,
      petsBounds: { x: 9, y: 9, width: 9, height: 9 }, petsBoundsSig: BOTH, // another setup's spot: not this set's
      hudBounds: { x: 0, y: 0, width: 1, height: 1 }, hudBoundsSig: ONE,   // the open window wins
      overlayOpacity: { hud: 0.6 }, canvasLayouts: { '1920x1080': { panels: [] } },
    };
    const s = run(cfg, false, null);
    expect(s.show).toEqual({ showDock: false, showHud: true, showTriggerOverlay: true, showCharm: false });
    expect(s.rects).toEqual({ charmBounds: { x: 1, y: 2, width: 3, height: 4 }, hudBounds: { x: 5, y: 6, width: 7, height: 8 } });
    expect(s.look).toEqual({ overlayOpacity: { hud: 0.6 } });
    expect(s.canvas).toEqual({ '1920x1080': { panels: [] } });
    expect(s.sig).toBe(ONE);
    // Hidden with the hotkey: the set is what the unhide would bring back.
    const hidden = run(Object.assign({}, cfg, { showHud: false }), true, { showHud: true, showCharm: true });
    expect(hidden.show.showHud).toBe(true);
    expect(hidden.show.showCharm).toBe(true);
  });

  it('loading writes the spots before the windows open, and lets a hide-all go', () => {
    const b = stripJs(sliceBlock(main, 'function _applyOverlaySet(set) {', '\n  return true;\n}'));
    expect(b).toMatch(/if \(_hideAllActive\) \{ _hideAllActive = false; _hideAllPrev = null;/);
    expect(b.indexOf("cfg[bk + 'Sig'] = sig")).toBeGreaterThan(-1);
    expect(b.indexOf("cfg[bk + 'Sig'] = sig")).toBeLessThan(b.indexOf('applyAllVisibility();'));
    expect(b).toMatch(/if \(bk && rects\[bk\]\) \{ try \{ win\.setBounds\(rects\[bk\]\); \}/);
  });
});

describe('tray ↔ Settings parity (the same command behind both)', () => {
  const code = stripJs(main);
  const settings = readSource(path.join(ROOT, 'apps', 'mimic', 'settings.html'));
  const preload = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js')));
  it('the tray has the sets, next, save over, save as new', () => {
    expect(code).toMatch(/\{ label: '🗂 Overlay sets', submenu: _overlaySetTrayItems\(\) \}/);
    const tray = sliceBlock(code, 'function _overlaySetTrayItems() {', '\n  return items;\n}');
    for (const v of ["verb: 'load'", "verb: 'next'", "verb: 'save' }", "verb: 'save', name: 'Set ' + n"]) expect(tray).toContain(v);
  });
  it('Settings lists, loads, saves over, saves as and deletes through the same command', () => {
    expect(preload).toMatch(/overlaySetsList:\s+\(\)\s+=> ipcRenderer\.invoke\('overlay-sets-list'\)/);
    expect(preload).toMatch(/overlaySetsCommand: \(cmd\) => ipcRenderer\.invoke\('overlay-sets-command', cmd\)/);
    expect(code).toMatch(/ipcMain\.handle\('overlay-sets-command', \(_e, cmd\) => \{[\s\S]{0,300}return _overlaySetCommand\(\{ verb, name: overlaySets\.cleanName\(cmd\.name\) \}, null, true\);/);
    for (const v of ["verb: 'load'", "verb: 'save', name: b.dataset.setSave", "verb: 'delete'", "verb: 'save', name: name"]) expect(settings).toContain(v);
    expect(settings).toContain('id="overlaySetsList"');
  });
});
