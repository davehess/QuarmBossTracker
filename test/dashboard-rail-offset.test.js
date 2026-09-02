// test/dashboard-rail-offset.test.js — the tab rail must clear the sticky bar.
//
// Hitya, 2026-09-02: "Noticed that scrolling down will lose just the first few
// tabs and those should stay in place (dashboard, overlays, raid, buffs, etc"
//
// A REGRESSION I CAUSED. The rail was already `position:sticky; top:8px`. Making
// the header sticky put a ~106px bar above it, so the rail pinned itself
// UNDERNEATH the header and the first four tabs slid out of sight on any scroll.
//
// Measured in headless Chromium after the fix, at scrollY 1200 on a 1200x760
// window: bar bottom 106, first tab top 126, first tab "Dashboard", not hidden.
//
// ⚠ The offset is a MEASURED custom property with a CSS fallback, never a
// constant — the bar changes height when the quick links wrap, when the update
// or beta pills appear, and at the short-window breakpoint. A hardcoded number
// would be right today and silently wrong the first time the bar grows a row,
// which is exactly the failure being fixed here.
//
// Run: npx vitest run test/dashboard-rail-offset.test.js

import { describe, it, expect } from 'vitest';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';
import path from 'node:path';

const src  = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const dash = stripJs(src);
const railRule = src.slice(src.indexOf('.shell > .nav {'), src.indexOf('.shell > .nav {') + 260);

describe('the rail sits below the bar', () => {
  it('offsets its sticky top by the bar height, not a constant', () => {
    expect(railRule).toMatch(/top:calc\(var\(--wp-topbar-h/);
    expect(railRule).not.toMatch(/top:\s*8px/);   // the value that caused the bug
  });

  // ⚠ Asserted on the `top` declaration specifically. A looser check passes on
  // the max-height line's fallback while `top` has none — which is the half that
  // actually decides whether the first tabs are visible before JS runs.
  it('keeps a fallback on top: so the first paint is never wrong', () => {
    expect(railRule).toMatch(/top:calc\(var\(--wp-topbar-h,\s*\d+px\)/);
  });

  // A rail taller than the space under the bar pushes its own last tabs off the
  // bottom — the same complaint, at the other end.
  it('scrolls internally rather than overflowing the viewport', () => {
    expect(railRule).toMatch(/max-height:calc\(100vh - var\(--wp-topbar-h/);
    expect(railRule).toMatch(/overflow-y:auto/);
  });
});

describe('the measurement keeps up with the bar', () => {
  const fn = sliceBlock(dash, 'function _wpSyncTopBarHeight() {', '\nvar _wpLastTopBarH');

  it('publishes the real height to the custom property', () => {
    expect(fn).toContain("getElementById('wpTopBar')");
    expect(fn).toContain('getBoundingClientRect().height');
    expect(fn).toContain("setProperty('--wp-topbar-h'");
  });

  // Writing on every poll would invalidate style every tick for no reason.
  it('only writes when the height actually changed', () => {
    expect(fn).toContain('h !== _wpLastTopBarH');
  });

  // ⚠ Three triggers, and the immediate one matters most: the packaged artifact
  // runs this script at an unclear point relative to `load`, and a measurement
  // that never fires leaves the rail on its fallback — close enough today, wrong
  // the moment the bar grows a row.
  it('measures on resize, on load, AND immediately', () => {
    expect(dash).toContain("window.addEventListener('resize'");
    expect(dash).toContain("window.addEventListener('load'");
    const after = dash.slice(dash.indexOf("window.addEventListener('load'"));
    expect(after.slice(0, 400)).toContain('try { _wpSyncTopBarHeight(); } catch (e) { void e; }');
  });

  it('re-measures after every render, since the bar gains and loses pills', () => {
    const at = dash.indexOf('if (window.scrollX !== _sx');
    expect(dash.slice(at, at + 400)).toContain('_wpSyncTopBarHeight()');
  });
});
