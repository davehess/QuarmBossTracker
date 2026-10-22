// Map overlay: facing wedges (the guild lead, 2026-10-22, beside Zeal's own map: "maps overlay should show 'pizza
// slices' for which way people are facing and see them easier").
//
// The pure helpers of apps/mimic/map.html are run as shipped (the same slice test/spawn-map.test.js uses). What is pinned:
//   * the turn direction, against the rule Zeal's own map marker draws with and against the server's heading maths;
//   * the slice geometry (opening, canvas angles, the clamped reach);
//   * the class palette is the website's, byte for byte;
//   * the setting (Facing wedges, default on, saved), and the draw order (slices, then dots, then names).
// Mutation-checked: flipping HEADING_CCW, the clamp, the palette and the draw order each fail a test below.
//
// Run: npx vitest run test/map-facing-wedges.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const MAP_HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));
const helpers = sliceBlock(MAP_HTML, '// ── pure helpers', '// ── end pure helpers ──');
// eslint-disable-next-line no-new-func
const H = new Function(helpers + '\nreturn { headingVec, toScreen, wedgeArc, wedgeRadius, classHex, WEDGE_HALF, WEDGE_MIN, WEDGE_MAX, CLASS_HEX, mapCfgDefaults, mergeMapCfg, CFG_SHOW };')();

const near = (a, b) => expect(a).toBeCloseTo(b, 6);
const deg = (r) => r * 180 / Math.PI;

describe('which way a heading turns', () => {
  it('follows the rule Zeal draws its own map markers with (zone_map.cpp: screen x tracks -sin, y tracks -cos of heading * pi / 256)', () => {
    for (let h = 0; h < 512; h += 7) {
      const v = H.headingVec(h), d = h * Math.PI / 256;
      near(v.dx, -Math.sin(d)); near(v.dy, -Math.cos(d));
    }
    // and its four named points: 0 north (up), 128 west (left), 256 south (down), 384 east (right)
    const at = (h) => { const v = H.headingVec(h); return [Math.round(v.dx) + 0, Math.round(v.dy) + 0]; };   // + 0 turns -0 into 0
    expect(at(0)).toEqual([0, -1]); expect(at(128)).toEqual([-1, 0]); expect(at(256)).toEqual([0, 1]); expect(at(384)).toEqual([1, 0]);
  });
  it('agrees with the server: facing a point on +y is heading 0, on +x 64, on -y 128, on -x 192 (256 scale, EQMacEmu CalculateHeadingAngleBetweenPositions)', () => {
    // the server's own function, ported as written (zone/position.cpp), so the check is not a restatement of ours
    const serverHeading = (x1, y1, x2, y2) => {
      let yd = Math.abs(y1 - y2); const xd = Math.abs(x1 - x2);
      if (yd < 0.000001) yd = 0.000001;
      const angle = Math.atan2(xd, yd) * 180 * 0.3183099014828645;
      if (y1 >= y2) {
        if (x2 >= x1) return (90 - angle + 90) * 256 * 0.0027777778;
        if (x2 <= x1) return (angle + 180) * 256 * 0.0027777778;
      }
      if (y1 > y2 || x2 > x1) return angle * 256 * 0.0027777778;
      return (90 - angle + 270) * 256 * 0.0027777778;
    };
    for (const [dx, dy, want] of [[0, 1, 0], [1, 0, 64], [0, -1, 128], [-1, 0, 192]]) {
      expect(Math.round(serverHeading(0, 0, dx, dy)) % 256).toBe(want);
      // the Map draws the world at screen = (-x, -y); the slice must open toward where that point lands
      const s = H.toScreen(dx, dy), v = H.headingVec(want * 2);
      near(v.dx, s.sx); near(v.dy, s.sy);
    }
  });
  it('is the counter-clockwise turn the helpers assume', () => {
    expect(stripJs(helpers)).toMatch(/var HEADING_CCW = true;/);
  });
});

describe('the slice', () => {
  it('opens 56 degrees centred on the way they face, in canvas angles (clockwise from +x, y down)', () => {
    const up = H.wedgeArc(0);
    near(deg(up.a1 - up.a0), 56);
    // the middle of the slice as a screen direction (cos, sin of its canvas angle: west is +-pi, so compare vectors)
    const mid = (h) => { const a = H.wedgeArc(h), m = (a.a0 + a.a1) / 2; return [Math.cos(m), Math.sin(m)]; };
    for (const [h, x, y] of [[0, 0, -1], [128, -1, 0], [256, 0, 1], [384, 1, 0]]) {   // north up, west left, south down, east right
      near(mid(h)[0], x); near(mid(h)[1], y);
    }
  });
  it('has no slice without a heading', () => {
    expect(H.wedgeArc(null)).toBeNull();
    expect(H.wedgeArc(undefined)).toBeNull();
    expect(H.wedgeArc(NaN)).toBeNull();
    expect(H.wedgeArc(0)).not.toBeNull();   // heading 0 is north, not "none"
  });
  it('reaches a readable distance at every zoom: scaled by the zoom, clamped to the min and max px', () => {
    expect(H.wedgeRadius(0.0001, 1, false)).toBe(H.WEDGE_MIN);          // whole zone on screen: still readable
    expect(H.wedgeRadius(50, 1, false)).toBe(H.WEDGE_MAX);              // zoomed right in: never a floodlight
    expect(H.wedgeRadius(undefined, 1, false)).toBe(H.WEDGE_MIN);       // no zoom yet
    const mid = H.wedgeRadius(0.25, 1, false);
    expect(mid).toBeGreaterThan(H.WEDGE_MIN); expect(mid).toBeLessThan(H.WEDGE_MAX);
    expect(H.wedgeRadius(0.3, 1, false)).toBeGreaterThan(mid);          // grows with the zoom between the clamps
  });
  it('makes you bigger, and lets the text-size setting nudge it only a little', () => {
    expect(H.wedgeRadius(0.25, 1, true)).toBeGreaterThan(H.wedgeRadius(0.25, 1, false));
    expect(H.wedgeRadius(50, 1.8, false)).toBeLessThanOrEqual(H.WEDGE_MAX * 1.3 + 1e-9);
    expect(H.wedgeRadius(0.0001, 0.7, false)).toBeGreaterThanOrEqual(H.WEDGE_MIN * 0.8 - 1e-9);
  });
});

describe('class colours', () => {
  it('is the website\'s palette, byte for byte (web/lib/spectator.ts CLASS_COLORS)', () => {
    const ts = readSource(path.join(ROOT, 'web', 'lib', 'spectator.ts'));
    const block = sliceBlock(ts, 'export const CLASS_COLORS', '};');
    const web = {};
    for (const m of block.matchAll(/'([A-Za-z ]+)':\s*'(#[0-9a-f]{6})'/g)) web[m[1].toLowerCase().replace(/ /g, '')] = m[2];
    expect(Object.keys(web)).toHaveLength(15);
    expect(H.CLASS_HEX).toEqual(web);
  });
  it('reads every spelling the pipe and the agent send, and says null for the rest', () => {
    expect(H.classHex('Shadow Knight')).toBe(H.CLASS_HEX.shadowknight);
    expect(H.classHex('shadowknight')).toBe(H.CLASS_HEX.shadowknight);
    expect(H.classHex('SHD')).toBe(H.CLASS_HEX.shadowknight);
    expect(H.classHex('Necro')).toBe(H.CLASS_HEX.necromancer);
    expect(H.classHex('clr')).toBe(H.CLASS_HEX.cleric);
    expect(H.classHex('Cleric')).toBe('#e6edf3');
    expect(H.classHex(null)).toBeNull();
    expect(H.classHex('')).toBeNull();
    expect(H.classHex('Tinkerer')).toBeNull();
  });
});

describe('the Facing wedges setting', () => {
  it('is in the Map settings list, on by default, and a saved off survives', () => {
    expect(H.CFG_SHOW.some(([k, label]) => k === 'wedges' && /wedge/i.test(label))).toBe(true);
    expect(H.mapCfgDefaults().show.wedges).toBe(true);
    expect(H.mergeMapCfg(null).show.wedges).toBe(true);
    expect(H.mergeMapCfg({ show: { wedges: false } }).show.wedges).toBe(false);
    expect(H.mergeMapCfg({ show: { wedges: 'no' } }).show.wedges).toBe(true);   // junk is dropped, never trusted
  });
});

describe('what the draw does with it', () => {
  const js = stripJs(MAP_HTML);
  const dots = sliceBlock(js, 'var dotsOf = function', 'if (SH.raid) dotsOf(');
  it('draws every slice, then every dot, then the names: nothing sits on top of a label', () => {
    const slice = dots.indexOf('wedgeArc(');
    const dot = dots.indexOf('ctx.arc(vis[j + 2], vis[j + 3], wedgesOn ?');
    const name = dots.indexOf('halo(vis[j].name');
    expect(slice).toBeGreaterThan(-1);
    expect(slice).toBeLessThan(dot);
    expect(dot).toBeLessThan(name);
  });
  it('turns the slice with the glide (the drawn heading, not the last reported one) and colours it by class with the old colour as the fallback', () => {
    expect(dots).toMatch(/vis\.push\(m, dm\.heading, q\[0\], q\[1\]\)/);
    expect(dots).toMatch(/classHex\(vis\[j\]\.class\) \|\| color/);
  });
  it('turns off cleanly: the setting gates the slices, and you keep the old arrow', () => {
    expect(js).toMatch(/wedgesOn = SH\.wedges !== false/);
    expect(js).toMatch(/if \(P\.self && SH\.you && SH\.wedges !== false\) \{[\s\S]+?\} else if \(P\.self && SH\.you\) \{[\s\S]+?headingVec\(md\.heading\)/);
  });
  it('lays raiders under the group, and you on top of both', () => {
    const raid = js.indexOf('if (SH.raid) dotsOf(P.raid'), group = js.indexOf('if (SH.group) dotsOf(P.group'), you = js.indexOf('if (P.self && SH.you && SH.wedges');
    expect(raid).toBeGreaterThan(-1);
    expect(raid).toBeLessThan(group);
    expect(group).toBeLessThan(you);
  });
});
