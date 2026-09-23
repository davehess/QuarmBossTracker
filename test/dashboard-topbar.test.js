// test/dashboard-topbar.test.js — the top bar stays put, and carries the
// controls you reach for repeatedly.
//
// The guild lead, 2026-09-02: "Lets also lock the top nav as we scroll. move panels and
// tour up there, as well as the feedback."
//
// Tour and Panels lived at the bottom of the left rail, so on a long page you
// scrolled back up to reach them. They moved to the sticky top bar alongside
// Feedback and Reload. On 2026-09-23 the bar ran out of width, so Tour and
// Feedback went back to the rail's foot (the rail is sticky now too) and
// Reload + mail moved up into the title row.
//
// ⚠ TWO THINGS BREAK SILENTLY WHEN A CONTROL MOVES INTO A STICKY CONTAINER, and
// both are pinned below:
//   1. The Panels popover positioned itself at (button bottom + window.scrollY).
//      A sticky button keeps its VIEWPORT position while scrollY grows, so that
//      maths walks the menu down the page until it is off-screen entirely.
//   2. scrollIntoView tucks the target under the bar, because the bar is not in
//      the flow at scroll time.
//
// Behaviour verified in a real headless Chromium against the authored file:
// at scrollY 900 the bar reported position "sticky" and getBoundingClientRect
// top 0. (A scrolled --screenshot capture comes back blank in this environment,
// so the computed geometry is the evidence, not a picture.)
//
// Run: npx vitest run test/dashboard-topbar.test.js

import { describe, it, expect } from 'vitest';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';
import path from 'node:path';

const src  = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const dash = stripJs(src);

describe('the bar sticks', () => {
  it('is sticky to the top of the viewport, above the content', () => {
    expect(src).toMatch(/#wpTopBar\s*\{[^}]*position:sticky/);
    expect(src).toMatch(/#wpTopBar\s*\{[^}]*top:0/);
    expect(src).toMatch(/#wpTopBar\s*\{[^}]*z-index:\s*\d+/);
  });

  // ⚠ Content scrolls UNDER this. A translucent bar makes the bar and the
  // content behind it both unreadable.
  it('has a solid background', () => {
    expect(src).toMatch(/#wpTopBar\s*\{[^}]*background:var\(--bg/);
  });

  it('wraps the title, the stats line and the links — not just one row', () => {
    const bar = src.slice(src.indexOf('<div id="wpTopBar">'), src.indexOf('<div class="shell">'));
    expect(bar).toContain('<h1');
    expect(bar).toContain('id="header"');
    expect(bar).toContain('id="wpQuickLinks"');
  });

  // A three-row sticky bar on a short window leaves no room for the page.
  it('sheds the logo and stats line on a short window', () => {
    expect(src).toMatch(/@media \(max-height:\s*620px\)/);
  });
});

// The guild lead, 2026-09-23: "We're running out of horizontal real estate. Move
// the reload button to the top right left of settings, mail as well. Move the
// tour and feedback to the bottom left (near the bottom, stacked)."
describe('where the controls live', () => {
  const bar = src.slice(src.indexOf('<div id="wpTopBar">'), src.indexOf('<div class="shell">'));
  const h1  = bar.slice(bar.indexOf('<h1'), bar.indexOf('</h1>'));
  const links = bar.slice(bar.indexOf('id="wpQuickLinks"'));
  const nav = src.slice(src.indexOf('<div class="nav">'), src.indexOf('<div id="wpPanelMenu"'));
  const foot = nav.slice(nav.indexOf('<div class="wp-rail-foot">'));

  it('Reload and mail ride the title row, not the links row', () => {
    const right = h1.slice(h1.indexOf('<span id="wpTopRight">'));
    for (const id of ['wpReload', 'wpMailBtn']) {
      expect(right).toContain('id="' + id + '"');
      expect(links).not.toContain('id="' + id + '"');
    }
  });

  // Mimic's ⚙ is injected by preload.js at fixed top:10px right:12px, 34px wide.
  // Without a right margin, Reload sits underneath it.
  it('the title-row cluster is pushed right and kept clear of the Mimic gear', () => {
    const css = stripJs(src);
    expect(css).toMatch(/#wpTopRight\s*\{[^}]*margin-left:auto/);
    const m = css.match(/#wpTopRight\s*\{[^}]*margin-right:(\d+)px/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(34);
  });

  it('Panels stays in the bar', () => {
    expect(links).toContain('id="wpGear"');
    expect(nav).not.toContain('id="wpGear"');
  });

  it('Tour and Feedback sit stacked at the foot of the rail', () => {
    for (const id of ['wpTourBtn', 'wpFbBtn']) {
      expect(foot).toContain('id="' + id + '"');
      expect(bar).not.toContain('id="' + id + '"');
    }
    const css = stripJs(src);
    expect(css).toMatch(/\.wp-rail-foot\s*\{[^}]*margin-top:auto/);
    expect(css).toMatch(/\.wp-rail-foot\s*\{[^}]*flex-direction:column/);
    // margin-top:auto only pushes to the bottom of a rail that HAS a height.
    expect(css).toMatch(/\.shell > \.nav\s*\{[^}]*[^-]height:calc\(100vh/);
  });

  // No data-tab: the switcher binds '.nav button[data-tab]', and a data-tab here
  // would turn Tour into a tab that blanks the page.
  it('the rail-foot buttons are not tabs', () => {
    expect(foot.slice(0, foot.indexOf('</div>'))).not.toContain('data-tab');
  });

  // The ids are what every existing handler binds to. Renaming them while moving
  // them would silently unbind the tour and the popover.
  it('keeps the original ids so existing handlers still bind', () => {
    expect(dash).toContain('document.getElementById("wpGear")');
    expect(dash).toContain('wpTourStart()');
  });
});

describe('what a sticky trigger breaks', () => {
  it('the Panels popover is positioned FIXED, never offset by scrollY', () => {
    const fn = sliceBlock(dash, '  var gear = document.getElementById("wpGear");', '\n    document.addEventListener("click"');
    expect(fn).toContain('menu.style.position = "fixed"');
    expect(fn).toContain('menu.style.top = (gear.getBoundingClientRect().bottom + 4)');
    expect(fn).not.toContain('window.scrollY');
  });

  it('the feedback jump offsets by the bar\'s MEASURED height, not a guess', () => {
    const fn = sliceBlock(src, 'function wpOpenFeedback() {', '\n// 💬 Send feedback');
    expect(fn).toContain("document.getElementById('wpTopBar')");
    expect(fn).toContain('getBoundingClientRect().height');
    // A hardcoded pixel offset would be wrong the moment the bar wraps or the
    // short-window breakpoint fires.
    expect(fn).not.toMatch(/window\.scrollY\s*-\s*\d{2,}/);
  });

  it('the feedback jump switches tab, expands the card, and focuses the box', () => {
    const fn = sliceBlock(src, 'function wpOpenFeedback() {', '\n// 💬 Send feedback');
    expect(fn).toContain('data-tab="dash"');
    expect(fn).toContain('d.open = true');
    expect(fn).toContain("getElementById('wpFbText')");
  });
});
