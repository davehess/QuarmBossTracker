// Map overlay: which way people face (the guild lead, 2026-10-22, beside Zeal's own map: "maps overlay should show 'pizza
// slices' for which way people are facing and see them easier"; then on the first beta: the slice "is too large and covers
// up other things", the arrow "works better for me", "make both available as choices").
//
// The pure helpers of apps/mimic/map.html are run as shipped (the same slice test/spawn-map.test.js uses). What is pinned:
//   * the turn direction, against the rule Zeal's own map marker draws with and against the server's heading maths;
//   * the arrow (its tip points the way they face) and the slice (opening, canvas angles, the clamped reach, you capped);
//   * the class palette is the website's, byte for byte;
//   * the setting (Facing: Arrow by default / Slice / Off, saved, a saved "wedges off" becomes Off), and the draw order
//     (slices, then markers, then names);
//   * who is drawn at all: a raider with no position (another zone) is not.
// Mutation-checked: flipping HEADING_CCW, the clamp, the palette, the arrow's tip, the setting migration, the in-zone rule
// and the draw order each fail a test below.
//
// Run: npx vitest run test/map-facing-wedges.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const MAP_HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));
const helpers = sliceBlock(MAP_HTML, '// ── pure helpers', '// ── end pure helpers ──');
// eslint-disable-next-line no-new-func
const H = new Function(helpers + '\nreturn { headingVec, toScreen, wedgeArc, wedgeRadius, classHex, arrowPoints, arrowSize, placedHere, facingFrom, WEDGE_HALF, WEDGE_MIN, WEDGE_MAX, WEDGE_SELF, ARROW_LEN, ARROW_HALF, ARROW_SELF, FACING_MODES, CLASS_HEX, mapCfgDefaults, mergeMapCfg, CFG_SHOW };')();

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
    const mid = H.wedgeRadius(0.17, 1, false);
    expect(mid).toBeGreaterThan(H.WEDGE_MIN); expect(mid).toBeLessThan(H.WEDGE_MAX);
    expect(H.wedgeRadius(0.2, 1, false)).toBeGreaterThan(mid);          // grows with the zoom between the clamps
  });
  it('is small: a raider\'s slice never reaches past 18 px, and yours is capped near theirs (the first beta\'s 26 px and 1.35x covered the neighbours)', () => {
    expect(H.WEDGE_MAX).toBeLessThanOrEqual(18);
    expect(H.WEDGE_MIN).toBeLessThanOrEqual(11);
    expect(H.WEDGE_SELF).toBeLessThanOrEqual(1.2);
    for (const scale of [0.0001, 0.1, 0.25, 1, 50]) {
      expect(H.wedgeRadius(scale, 1, true)).toBeLessThanOrEqual(H.WEDGE_MAX * 1.2 + 1e-9);   // you, at any zoom
      expect(H.wedgeRadius(scale, 1, false)).toBeLessThanOrEqual(18);
    }
  });
  it('makes you bigger, and lets the text-size setting nudge it only a little', () => {
    expect(H.wedgeRadius(0.15, 1, true)).toBeGreaterThan(H.wedgeRadius(0.15, 1, false));
    expect(H.wedgeRadius(50, 1.8, false)).toBeLessThanOrEqual(H.WEDGE_MAX * 1.3 + 1e-9);
    expect(H.wedgeRadius(0.0001, 0.7, false)).toBeGreaterThanOrEqual(H.WEDGE_MIN * 0.8 - 1e-9);
  });
});

describe('the arrow', () => {
  const sz = H.arrowSize(1, false);
  const tipOf = (heading) => { const p = H.arrowPoints(heading, 100, 200, sz.len, sz.half); return [p[0] - 100, p[1] - 200]; };
  it('points along the heading: the tip is the way they face (north up, west left, south down, east right)', () => {
    const want = { 0: [0, -1], 128: [-1, 0], 256: [0, 1], 384: [1, 0] };
    for (const h of Object.keys(want)) {
      const [x, y] = tipOf(Number(h)), [wx, wy] = want[h];
      expect(Math.sign(Math.round(x * 1000))).toBe(wx); expect(Math.sign(Math.round(y * 1000))).toBe(wy);
      near(Math.hypot(x, y), sz.len * 0.6);                              // the tip is ahead of the spot by 60% of the length
    }
    // and for any heading it is the headingVec direction, so the arrow turns exactly as the slice and Zeal's marker do
    for (let h = 0; h < 512; h += 13) {
      const v = H.headingVec(h), [x, y] = tipOf(h);
      near(x / (sz.len * 0.6), v.dx); near(y / (sz.len * 0.6), v.dy);
    }
  });
  it('is a symmetric arrowhead: two tail corners behind the spot, a notch between them, the tip alone in front', () => {
    for (const h of [0, 77, 256, 401]) {
      const p = H.arrowPoints(h, 0, 0, sz.len, sz.half), v = H.headingVec(h);
      const along = (i) => p[i] * v.dx + p[i + 1] * v.dy;               // distance ahead of the spot
      const across = (i) => p[i] * -v.dy + p[i + 1] * v.dx;             // distance to the side
      expect(along(0)).toBeGreaterThan(0);                              // tip ahead
      expect(along(2)).toBeLessThan(0); expect(along(6)).toBeLessThan(0);   // both tail corners behind
      near(along(2), along(6)); near(across(2), -across(6));            // mirror images
      near(Math.abs(across(2)), sz.half);
      expect(along(4)).toBeGreaterThan(along(2)); expect(along(4)).toBeLessThan(0);   // the notch is inside the tail, behind the spot
      near(across(4), 0);
    }
  });
  it('has no arrow without a heading, and heading 0 is north, not "none"', () => {
    expect(H.arrowPoints(null, 0, 0, 8, 4)).toBeNull();
    expect(H.arrowPoints(undefined, 0, 0, 8, 4)).toBeNull();
    expect(H.arrowPoints(NaN, 0, 0, 8, 4)).toBeNull();
    expect(H.arrowPoints(0, 0, 0, 8, 4)).not.toBeNull();
  });
  it('is compact (a raider about 10 px long at the default line strength), and you are a little bigger', () => {
    const raider = H.arrowSize(1.26, false), me = H.arrowSize(1.26, true);
    expect(raider.len).toBeLessThanOrEqual(11); expect(raider.len * 2).toBeLessThan(26);
    expect(raider.half * 2).toBeLessThanOrEqual(11);
    expect(me.len).toBeGreaterThan(raider.len); expect(me.len).toBeLessThanOrEqual(raider.len * 1.35 + 1e-9);
    expect(H.arrowSize(undefined, false).len).toBe(H.ARROW_LEN);        // no line-strength scale: the base size
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

describe('the Facing setting', () => {
  it('has three choices, Arrow by default', () => {
    expect(H.FACING_MODES).toEqual(['arrow', 'slice', 'off']);
    expect(H.mapCfgDefaults().facing).toBe('arrow');
    expect(H.mergeMapCfg(null).facing).toBe('arrow');
    expect(H.mergeMapCfg({}).facing).toBe('arrow');
  });
  it('keeps a saved choice, and drops a junk one', () => {
    for (const f of ['arrow', 'slice', 'off']) expect(H.mergeMapCfg({ facing: f }).facing).toBe(f);
    expect(H.mergeMapCfg({ facing: 'wedge' }).facing).toBe('arrow');
    expect(H.mergeMapCfg({ facing: 7 }).facing).toBe('arrow');
    expect(H.mergeMapCfg({ facing: null, show: {} }).facing).toBe('arrow');
  });
  it('moves the first beta\'s Facing wedges tick box over: a saved off stays Off, a saved on takes the new Arrow default', () => {
    expect(H.mergeMapCfg({ show: { wedges: false } }).facing).toBe('off');
    expect(H.mergeMapCfg({ show: { wedges: true } }).facing).toBe('arrow');
    expect(H.mergeMapCfg({ show: { wedges: 'no' } }).facing).toBe('arrow');   // junk is dropped, never trusted
    expect(H.mergeMapCfg({ facing: 'slice', show: { wedges: false } }).facing).toBe('slice');   // the new choice wins over the old box
    expect(H.facingFrom({ show: { wedges: false } })).toBe('off');
  });
  it('is not a tick box in the Show list any more, and the old box is not carried forward', () => {
    expect(H.CFG_SHOW.some(([k]) => k === 'wedges')).toBe(false);
    expect('wedges' in H.mapCfgDefaults().show).toBe(false);
    expect('wedges' in H.mergeMapCfg({ show: { wedges: false } }).show).toBe(false);
  });
  it('is in the ⚙ Map settings panel, under Show, with all three choices', () => {
    const row = MAP_HTML.match(/<label class="row"[^>]*><span class="bl">Facing<\/span><select id="cfgFacing">([\s\S]*?)<\/select><\/label>/);
    expect(row).not.toBeNull();
    expect([...row[1].matchAll(/<option value="(\w+)">(\w+)<\/option>/g)].map(m => [m[1], m[2]])).toEqual([['arrow', 'Arrow'], ['slice', 'Slice'], ['off', 'Off']]);
    expect(MAP_HTML.indexOf('<div class="grp">Show</div>')).toBeLessThan(MAP_HTML.indexOf('id="cfgFacing"'));
    expect(MAP_HTML.indexOf('id="cfgFacing"')).toBeLessThan(MAP_HTML.indexOf('id="cfgShow"'));
  });
});

describe('who is drawn: nobody from another zone', () => {
  it('draws a raider with a real position', () => {
    expect(H.placedHere({ name: 'Brackwyn', x: 40, y: -30, z: 2 })).toBe(true);
    expect(H.placedHere({ name: 'Brackwyn', x: 0, y: 0, z: 12 })).toBe(true);     // the origin at another height is a real spot
    expect(H.placedHere({ name: 'Brackwyn', x: 0, y: 5 })).toBe(true);
  });
  it('does not draw one the agent could not place: no position, or the zero spot the old agent made out of none', () => {
    expect(H.placedHere({ name: 'Corvale', x: null, y: null, z: null })).toBe(false);   // Zeal sends no loc for someone not in your zone
    expect(H.placedHere({ name: 'Corvale', x: 5, y: null })).toBe(false);
    expect(H.placedHere({ name: 'Corvale' })).toBe(false);
    expect(H.placedHere({ name: 'Corvale', x: 0, y: 0, z: 0 })).toBe(false);
    expect(H.placedHere({ name: 'Corvale', x: 0, y: 0 })).toBe(false);
    expect(H.placedHere({ name: 'Corvale', x: NaN, y: 3 })).toBe(false);
    expect(H.placedHere({ name: 'Corvale', x: '4', y: '3' })).toBe(false);          // a string is not a position
    expect(H.placedHere(null)).toBe(false);
  });
  it('is applied to the poll and to Mimic\'s direct push before anything reads the lists', () => {
    const js = stripJs(MAP_HTML);
    expect(js).toMatch(/p\.group = \(p\.group \|\| \[\]\)\.filter\(placedHere\); p\.raid = \(p\.raid \|\| \[\]\)\.filter\(placedHere\);\s+S\.p = p;/);
    expect(js).toMatch(/d\.group = \(d\.group \|\| \[\]\)\.filter\(placedHere\); d\.raid = \(d\.raid \|\| \[\]\)\.filter\(placedHere\);[^\n]*\n\s+S\.direct = /);
  });
});

describe('what the draw does with it', () => {
  const js = stripJs(MAP_HTML);
  const dots = sliceBlock(js, 'var dotsOf = function', 'if (SH.raid) dotsOf(');
  it('draws every slice, then every marker, then the names: nothing sits on top of a label', () => {
    const slice = dots.indexOf('wedgeArc(');
    const marker = dots.indexOf('arrowPoints(vis[j + 1]');
    const name = dots.indexOf('halo(vis[j].name');
    expect(slice).toBeGreaterThan(-1);
    expect(slice).toBeLessThan(marker);
    expect(marker).toBeLessThan(name);
  });
  it('turns the marker with the glide (the drawn heading, not the last reported one) and colours it by class with the old colour as the fallback', () => {
    expect(dots).toMatch(/vis\.push\(m, dm\.heading, q\[0\], q\[1\]\)/);
    expect(dots).toMatch(/classHex\(vis\[j\]\.class\) \|\| color/);
    expect(dots).toMatch(/arrowPoints\(vis\[j \+ 1\], vis\[j \+ 2\], vis\[j \+ 3\]/);
  });
  it('lets the setting pick the shape: arrows by default, slices only on Slice, plain dots on Off', () => {
    expect(js).toMatch(/facingOn = C\.facing !== 'off', wedgesOn = C\.facing === 'slice', arrowsOn = C\.facing === 'arrow'/);
    expect(dots).toMatch(/if \(wedgesOn\) \{[\s\S]+?wedgeArc\(/);
    expect(dots).toMatch(/pts = arrowsOn \? arrowPoints\(/);
    expect(dots).toMatch(/ctx\.arc\(vis\[j \+ 2\], vis\[j \+ 3\], facingOn \?/);   // no heading yet: still the dot
  });
  it('turns off cleanly: you keep the old arrow, and Arrow / Slice share your white rim', () => {
    expect(js).toMatch(/if \(P\.self && SH\.you && C\.facing !== 'off'\) \{[\s\S]+?\} else if \(P\.self && SH\.you\) \{[\s\S]+?headingVec\(md\.heading, rot\)/);
    const me = sliceBlock(js, "if (P.self && SH.you && C.facing !== 'off') {", '} else if (P.self && SH.you) {');
    expect(me).toMatch(/arrowSize\(I\.dot, true\)/);
    expect(me).toMatch(/wedgeRadius\(v\.scale, C\.text, true\)/);
    expect((me.match(/strokeStyle = '#ffffff'/g) || []).length).toBeGreaterThanOrEqual(3);   // arrow, slice, dot
  });
  it('keeps a name clear of an arrow\'s tip', () => {
    expect(dots).toMatch(/nameGap = \(arrowsOn \? Math\.max\(rad, arrowSz\.len \* 0\.6\) : rad\) \+ 3/);
  });
  it('lays raiders under the group, and you on top of both', () => {
    const raid = js.indexOf('if (SH.raid) dotsOf(P.raid'), group = js.indexOf('if (SH.group) dotsOf(P.group'), you = js.indexOf("if (P.self && SH.you && C.facing !== 'off')");
    expect(raid).toBeGreaterThan(-1);
    expect(raid).toBeLessThan(group);
    expect(group).toBeLessThan(you);
  });
});

describe('the agent leaves a raider in another zone off the Map', () => {
  const agent = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
  const fn = sliceBlock(stripJs(agent), 'for (const m of (rp ? rp.members : [])) {', 'if (st.target_name) {');
  it('skips a raider with no position before _mapPos can turn null into 0, and the zero spot', () => {
    const guard = fn.indexOf('!Number.isFinite(m.loc_x) || !Number.isFinite(m.loc_y)');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(fn.indexOf('_mapPos({ x: m.loc_x'));
    expect(fn).toMatch(/m\.loc_x === 0 && m\.loc_y === 0 && !m\.loc_z/);
  });
});
