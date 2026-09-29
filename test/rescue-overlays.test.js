// test/rescue-overlays.test.js — 🧲 Rescue brings back lost overlays only, each to a spot of its own.
//
// The guild lead, 2026-09-29: "not only does the rescue capture all of the overlays but it puts them
// all into one spot which is dreadfully annoying."
// Before: every overlay off the cursor's screen was parked at the same corner (40 px apart), then the
// whole set was re-arranged — overlays kept on a second screen included. Now: only an overlay that
// cannot be reached moves, to where it last sat on this screen setup or the first free spot; overlays
// on another screen come only on a yes, each at the same spot; nothing else is touched.
// The real _rescueOverlays + _arrangeOnScreen + _projectRect run over two fake screens.
//
// Run: npx vitest run test/rescue-overlays.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const main = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const SRC = sliceBlock(main, 'const _OVERLAY_NAMES = {', 'missing };\n}') + '\n'
  + sliceBlock(main, 'function _projectRect(r, from, to) {', '\n}') + '\n'
  + sliceBlock(main, 'function _arrangeOnScreen(area, wins, occupied, keepMiddleClear, pinnedKey, MARGIN, STEP) {', '  return { placed, skipped };\n}');

const MAIN = { id: 1, size: { width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const SIDE = { id: 2, size: { width: 1920, height: 1080 }, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } };

async function rescue(rects, { answer = 0, remembered = {}, displays = [MAIN, SIDE] } = {}) {
  const wins = Object.entries(rects).map(([key, b]) => {
    const w = { key, b: { ...b }, moves: 0, isVisible: () => true, getBounds() { return { ...this.b }; }, setBounds(nb) { this.b = { ...nb }; this.moves++; } };
    return [key, w];
  });
  const asked = [];
  const cfg = { overlayLayoutBySig: { SIG: { rects: remembered } } };
  const env = {
    screen: {
      getCursorScreenPoint: () => ({ x: 900, y: 500 }),
      getDisplayNearestPoint: () => MAIN,
      getAllDisplays: () => displays,
    },
    loadConfig: () => cfg, saveConfig: () => {},
    _overlayEntries: () => wins,
    _boundsKeyForEntry: (key) => key + 'Bounds',
    _parseUiWindowRects: () => null,
    _screenSignature: () => 'SIG',
    dialog: { showMessageBox: async (o) => { asked.push(o); return { response: answer }; } },
    applyAllVisibility: () => {}, appendAgentLog: () => {},
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function(...Object.keys(env), SRC + '\nreturn { _rescueOverlays, _rescueSort };')(...Object.values(env));
  const result = await fn._rescueOverlays();
  return { result, asked, after: Object.fromEntries(wins.map(([k, w]) => [k, w.b])), moves: Object.fromEntries(wins.map(([k, w]) => [k, w.moves])) };
}
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const onMain = (r) => r.x >= 0 && r.x + r.width <= 1920 && r.y >= 0 && r.y + r.height <= 1040;

describe('🧲 Rescue brings back lost overlays only', () => {
  it('lost overlays come back to separate free spots; one already on this screen does not move', async () => {
    const { result, after, moves } = await rescue({
      hud:     { x: 1600, y: 20, width: 300, height: 200 },     // fine where it is
      chchain: { x: -900, y: 300, width: 260, height: 180 },    // off every screen
      who:     { x: 5000, y: 300, width: 320, height: 280 },    // off every screen
    });
    expect(moves.hud).toBe(0);
    expect(after.hud).toEqual({ x: 1600, y: 20, width: 300, height: 200 });
    for (const k of ['chchain', 'who']) {
      expect(onMain(after[k]), k).toBe(true);
      expect(overlap(after[k], after.hud), k + ' on top of the HUD').toBe(false);
    }
    expect(overlap(after.chchain, after.who), 'piled into one spot').toBe(false);
    expect(result).toMatchObject({ moved: 2, brought: 0, left: 0 });
  });

  it('an overlay straddling an edge (middle off-screen) or less than half on a screen is lost', async () => {
    const { after, moves, result } = await rescue({
      straddle: { x: -250, y: 300, width: 300, height: 200 },   // middle at x=-100
      mostlyOff: { x: -150, y: -150, width: 400, height: 400 }, // middle on screen, 39% of it showing
    });
    expect(result, 'both are lost, not nudged').toMatchObject({ moved: 2, nudged: 0 });
    expect(moves.straddle).toBe(1);
    expect(moves.mostlyOff).toBe(1);
    expect(onMain(after.straddle)).toBe(true);
    expect(onMain(after.mostlyOff)).toBe(true);
  });

  // The guild lead, 2026-09-29: "make it so that rescue to screen only brings the overlays that were
  // missing from the screen, not the ones that are already arranged".
  it('an arranged overlay whose ✥ hangs past the edge moves only as far as its ✥ needs, and says so', async () => {
    const { after, moves, asked, result } = await rescue({
      topless: { x: 700, y: -40, width: 300, height: 400 },     // 90% showing, top-left corner above the screen
    });
    expect(moves.topless).toBe(1);
    expect(after.topless).toEqual({ x: 700, y: 0, width: 300, height: 400 });
    expect(result).toMatchObject({ moved: 0, nudged: 1 });
    expect(asked[0].message).toBe('No overlay was lost.');
    expect(asked[0].detail).toBe('Nothing else moved. topless had its ✥ past the edge of the screen, so it moved just far enough to grab.');
  });

  it('the HUD ring arranged against the corner is left alone: its ✥ is under the ring, not at the top-left', async () => {
    const ring = { x: -30, y: -30, width: 360, height: 360 };  // see-through corners overhang; ✥ at bottom-centre
    const { after, moves, result } = await rescue({ me: ring, hud: { x: 1600, y: 20, width: 300, height: 200 } });
    expect(moves.me).toBe(0);
    expect(after.me).toEqual(ring);
    expect(moves.hud).toBe(0);
    expect(result).toMatchObject({ moved: 0, nudged: 0 });
  });

  it('a lost overlay goes back to where it last sat on this screen setup', async () => {
    const { after } = await rescue(
      { chchain: { x: -900, y: 300, width: 260, height: 180 } },
      { remembered: { chchainBounds: { x: 60, y: 700, width: 260, height: 180 } } });
    expect(after.chchain).toEqual({ x: 60, y: 700, width: 260, height: 180 });
  });

  it('overlays on the other screen stay there unless the raider says yes, and the question names them', async () => {
    const side = { who: { x: 1920 + 100, y: 100, width: 320, height: 280 } };
    const left = await rescue({ ...side, chchain: { x: -900, y: 300, width: 260, height: 180 } }, { answer: 0 });
    expect(left.moves.who).toBe(0);
    expect(left.asked).toHaveLength(1);
    expect(left.asked[0].message).toBe('Brought back 1 overlay that could not be reached: CH chain.');
    expect(left.asked[0].detail).toBe('1 overlay on your other screen: /who. Bring it to this screen too, each at the same spot?');
    expect(left.asked[0].buttons).toEqual(['Leave them there', 'Bring them here']);
    expect(left.asked[0].defaultId).toBe(0);
    expect(left.result).toMatchObject({ moved: 1, brought: 0, left: 1 });

    const brought = await rescue(side, { answer: 1 });
    // Same spot on this screen: 100 px in from the left, 100 down.
    expect(brought.after.who).toEqual({ x: 100, y: 100, width: 320, height: 280 });
    expect(brought.result).toMatchObject({ moved: 0, brought: 1, left: 0 });
  });

  it('nothing lost and nothing elsewhere: says so and moves nothing', async () => {
    const { asked, moves } = await rescue({ hud: { x: 1600, y: 20, width: 300, height: 200 } });
    expect(moves.hud).toBe(0);
    expect(asked).toHaveLength(1);
    expect(asked[0].message).toBe('No overlay was lost.');
  });

  it('never re-arranges the whole set (the old rescue ended in auto-arrange)', () => {
    const fn = stripJs(sliceBlock(main, 'async function _rescueOverlays() {', 'missing };\n}'));
    expect(fn).not.toMatch(/_autoArrangeOverlays\(/);
  });
});
