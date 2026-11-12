// FB-130 (Mimic 3.0.10-beta.6, the Map): "The spawn points for scripted mobs are posted here and they cannot be cleared.
// Hovering over one mob should highlight its aggro range if aggro radius is turned on, and the currently targetted mob's
// aggro radius should be purple to stand out."
//
// Overlay half only (apps/mimic/map.html), sliced and run as written. Script-spawned points (`event: true`, utils/zoneSpawns.js)
// have no respawn, so _mapApplyMark refuses to time them and a "clear" has no timer to drop: the dot could never go. Now
// eventHidden() hides them (⚙ switch, or right-click one). ringLook() + aggroRing() draw the target's ring purple and the
// hovered dot's ring heavier. Call-site assertions strip comments first.
//
// Mutation-checked: making ringLook() always say hover:false turns "hover" red; dropping the eventHidden `continue` in the
// vis loop turns "the dot loop skips hidden event points" red.
//
// Run: npx vitest run test/map-fb130.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const MAP_HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));
const CODE = stripJs(MAP_HTML);

const helpers = sliceBlock(MAP_HTML, '  var AGGRO_TARGET_COL = (function () {', '(hidden && hidden[zone + \'|\' + p.id]));\n  }');
// No DOM here, so the theme read throws and the class-colour fallback (the same purple) is what the ring gets.
const H = new Function('CLASS_HEX', helpers + '\nreturn { AGGRO_TARGET_COL, ringLook, eventHidden };')({ enchanter: '#a371f7' });

// aggroRing run for real against a recording canvas context.
function ringRun(look, kind) {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_, k) => (k === 'lineWidth' || k === 'strokeStyle' || k === 'fillStyle' ? calls.lastProps[k] : (...a) => calls.push([k, ...a])),
    set: (_, k, v) => { calls.lastProps[k] = v; if (k === 'strokeStyle' || k === 'fillStyle' || k === 'lineWidth') calls.push([k, v]); return true; },
  });
  calls.lastProps = {};
  const src = sliceBlock(MAP_HTML, 'function aggroRing(x, y, ar, as, kind, cc, now, look) {', '    if (rs && rs.mez) mezZzz(x, y, now);\n  }');
  const fn = new Function('ctx', 'S', 'AGGRO_COL', 'AGGRO_TARGET_COL', 'inkStyle', 'ringState', 'calmRadius', 'hexA', 'calmBand', 'mezZzz',
    src + '\nreturn aggroRing;')(
    ctx, { cfg: { col: { aggro: '#e5534b', aggroSafe: '#e3b341', aggroNone: '#56d364' }, ink: 1.75 }, view: { scale: 1 } },
    { none: 'aggroNone', safe: 'aggroSafe', kos: 'aggro' }, H.AGGRO_TARGET_COL,
    () => ({ ringFill: 0.1, ringLine: 0.8, ringW: 2 }), () => null, (r) => r, (hex, a) => hex + '@' + a, () => {}, () => {});
  fn(50, 50, 100, 0, kind || 'kos', null, 0, look);
  return calls;
}
const widths = (c) => c.filter(x => x[0] === 'lineWidth').map(x => x[1]);
const strokes = (c) => c.filter(x => x[0] === 'strokeStyle').map(x => x[1]);

describe('FB-130 part 3: the target ring is purple', () => {
  it('ringLook marks only the target point', () => {
    expect(H.ringLook(7, null, 7)).toEqual({ target: true, hover: false });
    expect(H.ringLook(7, null, 8)).toEqual({ target: false, hover: false });
    expect(H.ringLook(7, null, null)).toEqual({ target: false, hover: false });
  });
  it('a target ring strokes purple, any kind; others keep their danger colour', () => {
    expect(strokes(ringRun({ target: true, hover: false }, 'kos'))).toEqual(['#a371f7@0.8']);
    expect(strokes(ringRun({ target: true, hover: false }, 'none'))).toEqual(['#a371f7@0.8']);
    expect(strokes(ringRun({ target: false, hover: false }, 'kos'))).toEqual(['#e5534b@0.8']);
    expect(strokes(ringRun(undefined, 'safe'))).toEqual(['#e3b341@0.8']);
  });
  it('both target call sites pass the look (point ring and live ring)', () => {
    expect(CODE).toMatch(/ringLook\(ap\.id, S\.hoverPid, tgtPid\)/);
    expect(CODE).toMatch(/now,\s*\{ target: true, hover:/);
  });
});

describe('FB-130 part 2: hover highlights the ring under the cursor', () => {
  it('ringLook: hover only for the hovered point', () => {
    expect(H.ringLook(7, 7, null)).toEqual({ target: false, hover: true });
    expect(H.ringLook(7, '7', null).hover).toBe(true);
    expect(H.ringLook(7, 9, null).hover).toBe(false);
    expect(H.ringLook(7, null, null).hover).toBe(false);
  });
  it('a hovered ring is drawn heavier (wider line, full-strength outline, stronger fill)', () => {
    const cold = ringRun({ target: false, hover: false });
    const hot = ringRun({ target: false, hover: true });
    expect(widths(hot)[0]).toBe(widths(cold)[0] * 2);
    expect(strokes(hot)).toEqual(['#e5534b@1']);
    expect(cold.filter(x => x[0] === 'fillStyle')[0][1]).toBe('#e5534b@0.1');
    expect(hot.filter(x => x[0] === 'fillStyle')[0][1]).toBe('#e5534b@0.2');
  });
  it('the dot button sets and clears S.hoverPid (a real button: the hover handshake works while locked)', () => {
    expect(CODE).toMatch(/function setHoverPid\(pid\) \{ if \(S\.hoverPid !== pid\) \{ S\.hoverPid = pid; if \(S\.cfg\.show\.aggro\) renderMap\(true\); \} \}/);
    expect(CODE).toMatch(/var pid = hitFor\(e\);\s*if \(!pid\) return;\s*setHoverPid\(pid\);/);
    expect(CODE).toMatch(/setHoverGrid\(null\); setHoverPid\(null\);/);
  });
});

describe('FB-130 part 1: script-spawned points can be cleared', () => {
  const ev = { id: 9000001, event: true };
  const normal = { id: 5 };
  it('a normal point is never hidden by this', () => {
    expect(H.eventHidden(normal, { events: false }, { 'z|5': true }, 'z')).toBe(false);
  });
  it('the ⚙ switch hides them all; default (on) hides none', () => {
    expect(H.eventHidden(ev, { events: false }, {}, 'z')).toBe(true);
    expect(H.eventHidden(ev, { events: true }, {}, 'z')).toBe(false);
    expect(H.eventHidden(ev, {}, {}, 'z')).toBe(false);
  });
  it('a right-clicked one hides in that zone only', () => {
    const hidden = { 'poair|9000001': true };
    expect(H.eventHidden(ev, { events: true }, hidden, 'poair')).toBe(true);
    expect(H.eventHidden(ev, { events: true }, hidden, 'pofire')).toBe(false);
    expect(H.eventHidden({ id: 9000002, event: true }, { events: true }, hidden, 'poair')).toBe(false);
  });
  it('the switch is a ⚙ Show row, on by default', () => {
    const defaults = new Function(sliceBlock(MAP_HTML, 'var CFG_SHOW = [', '];') + '\nreturn CFG_SHOW;')();
    expect(defaults.some(([k]) => k === 'events')).toBe(true);
  });
  it('the dot loop skips hidden event points (never your target\'s own) and right-click hides instead of marking', () => {
    expect(CODE).toMatch(/String\(p0\.id\) !== tgtPid && eventHidden\(p0, SH, S\.evHidden, S\.p && S\.p\.zone\)\) continue;/);
    expect(CODE).toMatch(/if \(p\.event\) \{[^}]*S\.evHidden\[\(S\.p && S\.p\.zone\) \+ '\|' \+ p\.id\] = true;[^}]*return;\s*\}\s*var a = spawnToggle/);
  });
});
