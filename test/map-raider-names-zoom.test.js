// test/map-raider-names-zoom.test.js — FB-119: "Raider names aren't showing up on mimic map" (a raider, 2026-11-04,
// Plane of Fire). The Map drew raid and group names only at scale >= 0.4 pixels a unit, and its default whole-zone fit of a
// big zone sits well under that, so every dot drew with no name while the Raiders button still read on. Names now follow
// the button at every zoom.
//
// Mutation-checked (by hand, 2026-11-04): put the `&& v.scale >= 0.4` back on the names branch and this fails.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { ROOT, readSource, sliceBlock, stripJs } from './_source-slice.js';

const MAP = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));

describe('the Map names raiders at every zoom (FB-119)', () => {
  const block = stripJs(sliceBlock(MAP, 'var dotsOf = function (list, color, rad, pre, names) {', "if (SH.raid) dotsOf("));

  it('draws each dot\'s name whenever names are on', () => {
    expect(block).toMatch(/if \(names\) \{\s*var nameGap/);
    expect(block).toMatch(/halo\(vis\[j\]\.name/);
  });

  it('no zoom level gates the names', () => {
    expect(block).not.toMatch(/names\s*&&\s*v\.scale/);
  });
});
