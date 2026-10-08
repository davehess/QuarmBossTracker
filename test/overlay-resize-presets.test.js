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

const MIN_W = +(main.match(/const _OVERLAY_MIN_W = (\d+);/) || [])[1];
const num = (v) => (v === '_OVERLAY_MIN_W' ? MIN_W : +v);
const widths = (() => {
  const m = main.match(/const widths = \{ ([^}]+) \};/);
  return Object.fromEntries(m[1].split(',').map(kv => kv.trim().split(/:\s*/)).map(([k, v]) => [k, num(v)]));
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
  // FB-38 (a member, 2026-09-29): "When you set an individual window size, like
  // setting it to XS, it does not remember the size after logout." A locked
  // window takes any width, so 200 was saved; the next launch built the window
  // with its own larger minimum and it came back wider.
  it('no overlay window has a minimum wider than XS, so a saved XS comes back as XS', () => {
    expect(MIN_W).toBe(200);
    expect(widths.xs).toBe(MIN_W);
    // Every window restored from saved bounds is an overlay; each one's minimum.
    const mins = [...main.matchAll(/_resolveBounds\([^\n]*\n[\s\S]*?minWidth: ([\w.]+),/g)].map(m => m[1]);
    expect(mins.length).toBeGreaterThanOrEqual(18);
    for (const v of mins) expect(num(v), v).toBeLessThanOrEqual(widths.xs);
  });
});
