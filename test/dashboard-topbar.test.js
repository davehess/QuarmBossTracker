// test/dashboard-topbar.test.js — the top bar stays put, and carries the
// controls you reach for repeatedly.
//
// Hitya, 2026-09-02: "Lets also lock the top nav as we scroll. move panels and
// tour up there, as well as the feedback."
//
// Tour and Panels lived at the bottom of the left rail, so on a long page you
// scrolled back up to reach them. They now live in a sticky top bar alongside
// Feedback and Reload.
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

describe('the controls moved up', () => {
  const bar = src.slice(src.indexOf('<div id="wpTopBar">'), src.indexOf('<div class="shell">'));
  const nav = src.slice(src.indexOf('<div class="nav">'), src.indexOf('<div id="wpPanelMenu"'));

  it('Tour, Panels and Feedback are in the bar', () => {
    for (const id of ['wpTourBtn', 'wpGear', 'wpFbBtn']) expect(bar).toContain('id="' + id + '"');
  });

  it('and are no longer in the left rail', () => {
    for (const id of ['wpTourBtn', 'wpGear']) expect(nav).not.toContain('id="' + id + '"');
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
