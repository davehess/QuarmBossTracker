// test/map-range-3d.test.js — FB-108 (Mimic 3.0.6-beta.4): "Map distance is only x/y not z, so when casting on something it
// should be full distance and if it's too high or too low."
//
// The Map's two readouts of how far the target is (the number on the dotted line to it, and the target row under the zone
// name) used the flat map-plane distance. A spell measures in 3D, so a target 40 units up a ramp read 30 and was out of
// range. targetRange / rangeText (apps/mimic/map.html) give the 3D number and, when the height gap is big enough to matter,
// say which way: "42 (↑18)" above you, "42 (↓18)" below. Run as written, out of the page.
//
// Out of scope on purpose: the kite circles, the aggro rings and every line on the map stay 2D; this changes a NUMBER SHOWN.
//
// Mutation-checked (2026-10-28): take dz out of the sum in targetRange and "a target above you reads the full 3D range"
// fails; flip the arrow's sign and "above is up, below is down" fails.
//
// Run: npx vitest run test/map-range-3d.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const MAP_HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));
const block = sliceBlock(MAP_HTML, '  var RANGE_DZ_SHOW = 10;', "    return t;\n  }\n");
const { targetRange, rangeText, RANGE_DZ_SHOW } = new Function(block + '\nreturn { targetRange, rangeText, RANGE_DZ_SHOW };')();

const me = { x: 100, y: 100, z: 10 };
const at = (dx, dy, z) => ({ x: me.x + dx, y: me.y + dy, z });

describe('targetRange: the distance a spell would measure', () => {
  it('a target on your level reads the flat number', () => {
    const r = targetRange(me, at(30, 40, 10));
    expect(r).toEqual({ flat: 50, d: 50, dz: 0 });
    expect(rangeText(r)).toBe('50');
  });
  it('a target above you reads the full 3D range, not the flat one', () => {
    const r = targetRange(me, at(30, 40, 10 + 120));   // 3-4-5 on the plane, 120 up: 130 in 3D
    expect(r.flat).toBe(50);
    expect(r.d).toBe(130);
    expect(r.dz).toBe(120);
  });
  it('above is up, below is down, with the size of the gap', () => {
    expect(rangeText(targetRange(me, at(30, 40, 10 + 18)))).toBe('53 (↑18)');
    expect(rangeText(targetRange(me, at(30, 40, 10 - 18)))).toBe('53 (↓18)');
  });
  it('a gap under the threshold changes the number but is not called out', () => {
    expect(RANGE_DZ_SHOW).toBe(10);
    expect(rangeText(targetRange(me, at(30, 40, 10 + 9)))).toBe('51');
    expect(rangeText(targetRange(me, at(30, 40, 10 + 10)))).toBe('51 (↑10)');   // 50.8 and 51.0
  });
  it('a missing height on either side keeps the flat number and says nothing about height (the agent sends 0 for "none")', () => {
    for (const r of [targetRange(me, at(30, 40, 0)), targetRange({ x: 100, y: 100, z: 0 }, at(30, 40, 500)), targetRange(me, { x: 130, y: 140 })]) {
      expect(r.d).toBe(50);
      expect(r.dz).toBeNull();
      expect(rangeText(r)).toBe('50');
    }
  });
  it('no position on either side: nothing to show', () => {
    expect(targetRange(null, me)).toBeNull();
    expect(targetRange(me, { x: null, y: null, z: null })).toBeNull();
    expect(rangeText(null)).toBe('');
  });
});

describe('where the Map shows it', () => {
  const src = stripJs(MAP_HTML);
  it('the number on the line to the target is the 3D range, from the drawn spots', () => {
    expect(src).toMatch(/halo\(rangeText\(targetRange\(sd, td\)\)/);
    expect(src).not.toMatch(/halo\(String\(Math\.round\(Math\.hypot\(td\.x - sd\.x/);
  });
  it('the target row under the zone name shows it too, falling back to the agent\'s number only without a position', () => {
    expect(src).toMatch(/rangeText\(targetRange\(P\.self, P\.target\)\) \|\| P\.target\.dist/);
  });
});
