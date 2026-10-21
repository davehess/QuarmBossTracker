// The Map's timers panel (#side): its header lines never cover the list (the guild lead, 2026-10-21: "Cutting off the top of
// this timer window"). The header (zone, position age, walls, target) are overflow:hidden flex items in a column, so with the
// default flex-shrink they were squeezed to nothing in a short window and their text drew over the first rows. The fix: they
// are flex:none, in normal flow above #lists, and only #lists gives way - from a zero basis, scrolling inside its own box.
// Comments are stripped before matching (CLAUDE.md, "comments satisfy text assertions"). Mutation-checked: removing the
// `#side > :not(#lists)` rule, or putting flex-shrink back on the header, turns these red.
//
// Run: npx vitest run test/map-timers-header-clear.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, stripCss } from './_source-slice.js';

const RAW = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));
const CSS = stripCss(RAW);
const rule = sel => {
  const i = CSS.indexOf(sel + '{');
  if (i < 0) throw new Error('rule not found: ' + sel);
  return CSS.slice(i + sel.length + 1, CSS.indexOf('}', i));
};

describe('Map timers panel: the header sits above the list, never over it', () => {
  it('every header line and the foot is a non-shrinking flex item', () => {
    expect(rule('#side > :not(#lists)')).toMatch(/flex:0 0 auto/);
  });
  it('the list is the only thing that gives way, from a zero basis, and scrolls in its own box', () => {
    const r = rule('#lists');
    expect(r).toMatch(/flex:1 1 0\b/);
    expect(r).toMatch(/overflow:auto/);
    expect(r).toMatch(/min-height:0/);
  });
  it('no header line is taken out of flow (absolute/fixed/sticky) or pulled up with a negative margin', () => {
    for (const id of ['#zone', '#posage', '#wallsrc', '#tgt', '#foot', '#lists']) {
      const r = rule(id);
      expect(r).not.toMatch(/position:\s*(absolute|fixed|sticky)/);
      expect(r).not.toMatch(/margin(-top)?:\s*-/);
    }
  });
  it('in the markup the header lines come before #lists inside #side', () => {
    const side = RAW.slice(RAW.indexOf('<div id="side">'));
    const at = id => side.indexOf('id="' + id + '"');
    expect(at('zone')).toBeGreaterThan(-1);
    for (const id of ['zone', 'posage', 'wallsrc', 'tgt']) expect(at(id)).toBeLessThan(at('lists'));
  });
});
