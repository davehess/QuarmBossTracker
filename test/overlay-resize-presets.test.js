// The move-icon menu's size presets: the width main.js applies and the label
// preload.js prints are two literals in two files, so they are checked
// against each other. L is 420 (a member, 2026-09-24: "the large 400px preset
// cuts off a bit on the dps window. and the xl is just a bit too wide. Is
// there a way to make the L preset like 420px").
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, stripJs } from './_source-slice.js';

const main = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')));
const preload = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js')));

const widths = (() => {
  const m = main.match(/const widths = \{ ([^}]+) \};/);
  return Object.fromEntries(m[1].split(',').map(kv => kv.trim().split(/:\s*/)).map(([k, v]) => [k, +v]));
})();
const labels = Object.fromEntries([...preload.matchAll(/\['(xs|sm|md|lg|xl)','[A-Z]+ · (\d+)px/g)].map(m => [m[1], +m[2]]));

describe('overlay size presets', () => {
  it('L is 420 px — wide enough for the DPS HUD\'s title row, narrower than XL', () => {
    expect(widths.lg).toBe(420);
    expect(widths.lg).toBeLessThan(widths.xl);
  });
  it('every menu label says the width the preset actually applies', () => {
    expect(Object.keys(labels).sort()).toEqual(Object.keys(widths).sort());
    for (const k of Object.keys(widths)) expect(labels[k], k).toBe(widths[k]);
  });
});
