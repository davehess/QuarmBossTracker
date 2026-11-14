// test/ui-fit.test.js — the one rule for moving an EverQuest window layout to another screen size
// (apps/mimic/uiFit.js), and that both users of it are wired to it.
//
// The guild lead, 2026-11-14 (FB-132): "Import did not resize correctly onto this 1080 monitor from 1440p";
// "its off the page"; "I need everything from v4 when i pull it to be fixed and resized to v5 (1440 to 1080)".
// The old rule scaled a window's top-left corner and left its size alone, in two separate copies (UI Studio's
// Load + Rescale and the bring-in's fitLayout). On the real file, 13 windows hung off the 1080 screen, the worst
// by 243 px.
//
// uiFit.js is run as it ships. The wiring is checked on comment-stripped source.
//
// Run: npx vitest run test/ui-fit.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const fit = require(path.join(ROOT, 'apps', 'mimic', 'uiFit.js'));
const QHD = { w: 2560, h: 1440 }, FHD = { w: 1920, h: 1080 };

describe('a window keeps its place in the free space', () => {
  it('flush left stays flush left, flush right stays flush right, centred stays centred', () => {
    const at = (x) => fit.fitRect({ x, y: 0, w: 400, h: 300 }, QHD, FHD).x;
    expect(at(0)).toBe(0);
    expect(at(2560 - 400)).toBe(1920 - 400);
    expect(at((2560 - 400) / 2)).toBe((1920 - 400) / 2);
    // the old rule put the right-docked window at 2160 * 0.75 = 1620, 100 px off the screen
    expect(at(2160) + 400).toBeLessThanOrEqual(1920);
  });

  it('every window that fits the new screen ends up wholly on it, whatever its size and place', () => {
    let n = 0;
    for (const w of [16, 80, 200, 463, 713, 1200, 1920]) for (const h of [16, 51, 100, 257, 641, 1080]) {
      for (const fx of [0, 0.13, 0.5, 0.87, 1]) for (const fy of [0, 0.4, 1]) {
        const r = fit.fitRect({ x: Math.round(fx * (2560 - w)), y: Math.round(fy * (1440 - h)), w, h }, QHD, FHD);
        expect([r.x >= 0, r.y >= 0, r.x + r.w <= 1920, r.y + r.h <= 1080, r.w, r.h]).toEqual([true, true, true, true, w, h]);
        n++;
      }
    }
    expect(n).toBe(7 * 6 * 5 * 3);
  });

  it('keeps left-to-right order: a window further right never lands further left', () => {
    let last = -1;
    for (let x = 0; x <= 2160; x += 40) { const nx = fit.fitRect({ x, y: 0, w: 400, h: 100 }, QHD, FHD).x; expect(nx).toBeGreaterThanOrEqual(last); last = nx; }
  });

  it('a window as large as the screen, or larger, starts at the edge', () => {
    expect(fit.fitRect({ x: 300, y: 200, w: 2400, h: 1300 }, QHD, FHD)).toMatchObject({ x: 0, y: 0, w: 2400, h: 1300 });
  });

  it('works the other way too (1080p up to 1440p) and across shapes (16:9 to ultrawide)', () => {
    expect(fit.fitRect({ x: 1520, y: 780, w: 400, h: 300 }, FHD, QHD)).toMatchObject({ x: 2160, y: 1140 });
    expect(fit.fitRect({ x: 2160, y: 0, w: 400, h: 300 }, QHD, { w: 3440, h: 1440 })).toMatchObject({ x: 3040, y: 0 });
  });
});

describe('sizes', () => {
  it('only a window asked to resize is resized, each side by its own ratio; then its corner is exactly corner x ratio', () => {
    expect(fit.fitRect({ x: 1760, y: 1040, w: 800, h: 400 }, QHD, FHD, { resize: true })).toEqual({ x: 1320, y: 780, w: 600, h: 300, resized: true });
    expect(fit.fitRect({ x: 1760, y: 1040, w: 800, h: 400 }, QHD, FHD)).toMatchObject({ w: 800, h: 400, resized: false });
    expect(fit.fitRect({ x: 100, y: 100, w: 800, h: 400 }, QHD, { w: 3440, h: 1440 }, { resize: true })).toMatchObject({ w: 1075, h: 400 });
  });

  it('never shrinks a chat window below the floor, and leaves one already under it alone', () => {
    expect(fit.fitRect({ x: 0, y: 0, w: 130, h: 70 }, QHD, FHD, { resize: true })).toMatchObject({ w: fit.MIN_CHAT_W, h: fit.MIN_CHAT_H });
    expect(fit.fitRect({ x: 0, y: 0, w: 80, h: 51 }, QHD, FHD, { resize: true })).toMatchObject({ w: 80, h: 51, resized: false });
  });

  it('the same screen size never resizes: it only brings a window back on screen', () => {
    expect(fit.fitRect({ x: 2400, y: 1500, w: 300, h: 200 }, FHD, FHD, { resize: true })).toEqual({ x: 1620, y: 880, w: 300, h: 200, resized: false });
    expect(fit.fitRect({ x: 700, y: 300, w: 300, h: 200 }, FHD, FHD)).toMatchObject({ x: 700, y: 300 });
  });

  it('a size nobody stated is the 200 x 100 stand-in', () => {
    expect(fit.fitRect({ x: 2360, y: 1340 }, QHD, FHD)).toMatchObject({ x: 1720, y: 980, w: 200, h: 100 });
  });
});

describe('a deliberate tuck past an edge', () => {
  it('is kept on the same edge; anything further out is brought to the edge', () => {
    expect(fit.fitRect({ x: -5, y: 1087, w: 463, h: 257 }, QHD, FHD).x).toBe(-5);
    expect(fit.fitRect({ x: 2560 - 300 + 4, y: 0, w: 300, h: 100 }, QHD, FHD).x).toBe(1920 - 300 + 4);
    expect(fit.fitRect({ x: -fit.TUCK - 1, y: 0, w: 300, h: 100 }, QHD, FHD).x).toBe(0);
    expect(fit.fitRect({ x: 2560 + 500, y: 1440 + 500, w: 300, h: 100 }, QHD, FHD)).toMatchObject({ x: 1620, y: 980 });
  });

  it('isOffScreen ignores a tuck and reports a real overhang on any edge', () => {
    const off = (r) => fit.isOffScreen(r, FHD);
    expect([off({ x: -5, y: 0, w: 100, h: 100 }), off({ x: 1830, y: 990, w: 100, h: 100 })]).toEqual([false, false]);
    expect([off({ x: -17, y: 0, w: 100, h: 100 }), off({ x: 0, y: -17, w: 100, h: 100 }),
      off({ x: 1837, y: 0, w: 100, h: 100 }), off({ x: 0, y: 997, w: 100, h: 100 })]).toEqual([true, true, true, true]);
  });
});

describe('helpers', () => {
  it('names the chat sections: MainChat and Chat N, spaced or not, and nothing else', () => {
    expect(['MainChat', 'mainchat', 'Chat 1', 'Chat12', 'chat  7'].map(fit.isChatSection)).toEqual([true, true, true, true, true]);
    expect(['ChatWindow', 'ChatManager', 'Chat', 'MerchantWnd', 'ZealChat', '', null].map(fit.isChatSection)).toEqual([false, false, false, false, false, false, false]);
  });
  it('parseRes reads a block suffix', () => {
    expect([fit.parseRes('2559x1440'), fit.parseRes('1920X1080'), fit.parseRes(''), fit.parseRes('0x0'), fit.parseRes('abc')])
      .toEqual([{ w: 2559, h: 1440 }, { w: 1920, h: 1080 }, null, null, null]);
  });
});

describe('both places that fit a layout use this one rule', () => {
  const studio = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'ui-studio.html')));
  const plan = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'uiRestorePlan.js')));
  const main = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')));

  it('UI Studio loads uiFit.js and no longer scales a corner by the screen ratio', () => {
    expect(studio).toMatch(/<script src="uiFit\.js"><\/script>/);
    expect(studio).toMatch(/UiFit\.fitRect\(\{ x: x, y: y, w: memo \? memo\.w : w, h: memo \? memo\.h : h \}, usedRes, tgtRes, \{ resize: chatFit \}\)/);
    expect(studio).not.toMatch(/Math\.round\(x \* fxX\);\s*y = Math\.round\(y \* fxY\)/);
    // a window read from another block than the Source one is fitted from THAT block's screen size
    expect(studio).toMatch(/var usedRes = \(pos\.used === srcSuffix\) \? \{ w: STATE\.srcW, h: STATE\.srcH \} : UiFit\.parseRes\(pos\.used\);/);
  });

  it('the bring-in fits with uiFit.js, from the screen size the backup was played at', () => {
    expect(plan).toMatch(/const uiFit = require\('\.\/uiFit'\);/);
    expect(plan).toMatch(/uiFit\.fitRect\(\{ x: from\.x, y: from\.y, w, h \}, from\.res, tgt, \{ resize: uiFit\.isChatSection\(s\.name\)/);
    // ...except a backup made on THIS computer, which is put back as it was (its block for this screen size is kept)
    expect(plan).toMatch(/const fitOpts = \(backupFiles, skinSizes, target, sameMachine\) =>\s*\(\{ source: sameMachine && target && target\.w > 0 && target\.h > 0 \? target : videoModeOf\(backupFiles\), skinSizes \}\);/);
    expect(plan).not.toMatch(/x \* tw \/ rw/);
    // main hands the skin's window sizes, and whether the backup is this PC's own, to all three calls
    expect(main.match(/skinSizes: _uiSkinSizes\(entry\.eqDir\), sameMachine: !!entry\.sameMachine|\{ knownChars, target, skinSizes, sameMachine \}|uiRestorePlan\.fitOpts\(snap\.files, skinSizes, target, sameMachine\)/g)).toHaveLength(3);
    expect(main).toMatch(/if \(snap\.local === true\) return true;/);
    expect(main).toMatch(/snap\.machine_name === me/);
  });

  it('UI Studio warns about windows off the screen and can bring only those back', () => {
    expect(studio).toMatch(/id="offBanner"/);
    expect(studio).toMatch(/\(_isOffScreen\(w\) \? ' off' : ''\)/);
    expect(studio).toMatch(/document\.getElementById\('offFix'\)\.addEventListener\('click', function\(\)\{\s*var n = _bringOnScreen\(\);/);
  });

  // Files copied over by hand hold a full layout for the OTHER screen size. The editor says so and offers to fit it.
  it('UI Studio offers to fit a layout made for another screen, and Save writes a place for every window shown', () => {
    expect(studio).toMatch(/id="fitBanner"/);
    expect(studio).toMatch(/if \(!STATE\.nativeLoad \|\| STATE\.fromCloud \|\| STATE\.srcSuffix !== tgt\) return null;/);
    // only when MANY windows have no place (a fifth or more, at least three): a member's own file after a change of
    // screen size has a layout in use, and the button would lay the old screen's layout over it
    expect(studio).toMatch(/var fuller = \(STATE\.otherBlocks \|\| \[\]\)\.filter\(function\(k\)\{ return counts\[k\] > have; \}\);\s*if \(!np\.many \|\| !fuller\.length\) return null;/);
    expect(studio).toMatch(/many: missing >= Math\.max\(3, Math\.ceil\(total \* 0\.2\)\)/);
    // the game's own parked windows (the group it never shows in play) are not "off the screen"
    expect(studio).toMatch(/function _isOffScreen\(w\)\{\s*if \(w\.category === 'offscreen'\) return false;/);
    // a save that waits for the camp leaves a guessed place to the game, unless the layout was made for another screen
    expect(studio).toMatch(/if \(!_noPlaceCount\(\)\.many\) edits = edits\.filter\(function\(e\)\{ return !e\.guess; \}\);/);
    expect(studio).toMatch(/var guess = !all && !_windowChanged\(w\);/);
    expect(studio).toMatch(/_syncPresetFromInputs\('src'\);\s*loadAndRescale\(\)\.then\(/);
    expect(studio).toMatch(/var pos = _readPos\(s\.props, srcSuffix, otherBlocks\);/);
    expect(studio).toMatch(/if \(!all && !_windowChanged\(w\) && !\(w\.noBlock && !w\.zealBar\)\) continue;/);
  });

  it('after a bring-in the canvas re-reads the files, so the next Save cannot write the old places back', () => {
    expect(studio).toMatch(/mount\(document\.getElementById\('bringCard'\), \{ all: true, fresh: true, onDone: _reloadAfterBringIn \}\)/);
    expect(studio).toMatch(/function _reloadAfterBringIn\(ok, rows\)\{\s*if \(!STATE\.character \|\| !STATE\.eqDir\) return;/);
    // only for the character on the canvas, and never over moves that are not saved
    expect(studio).toMatch(/r\.kind === 'done' && String\(r\.character\)\.toLowerCase\(\) === me && r\.files && r\.files\.length/);
    expect(studio).toMatch(/if \(!wrote\) return;\s*if \(STATE\.windows\.some\(_windowChanged\)\) \{[^}]*return;\s*\}\s*loadAndRescale\(true\)/);
    expect(stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'bring-setup.js')))).toMatch(/el\.__wpbsDone\(ok, rows\)/);
  });

  it('a Save queued while a bring-in waits no longer drops the bring-in', () => {
    expect(main).toMatch(/e\.eqDir === eqDir\s*&& e\.kind !== 'layout' && e\.kind !== 'restore'\)\);/);
  });

  it('Detect reports a display in real pixels, not Windows\' scaled units', () => {
    expect(main).toMatch(/function _displayPixels\(d\) \{/);
    expect(main).toMatch(/const \{ w, h \} = _displayPixels\(d\);/);
    expect(main).toMatch(/primary: _displayPixels\(primary\),/);
    expect(main).toMatch(/function _primarySize\(\) \{\s*try \{ return _displayPixels\(screen\.getPrimaryDisplay\(\)\); \}/);
  });
});
