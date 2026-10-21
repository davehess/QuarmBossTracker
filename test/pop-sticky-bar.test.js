// test/pop-sticky-bar.test.js — the /pop control bar stays under the site header while the page scrolls (the guild
// lead, 2026-10-21: "Top nav bar for the pop page should come down when scrolling so we can see who needs what
// steps instead of having to scroll up").
//
// Read as comment-stripped source: there is no React renderer in this suite.
//
// Run: npx vitest run test/pop-sticky-bar.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const page = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/pop/page.tsx'), 'utf8'));
const bar = page.slice(page.indexOf('data-pop-bar'), page.indexOf('data-pop-bar') + 700);

describe('/pop control bar', () => {
  it('exists and carries the scope chips', () => {
    expect(page).toContain('data-pop-bar');
    expect(page.indexOf('aria-label="Whose characters"')).toBeGreaterThan(page.indexOf('data-pop-bar'));
  });

  it('sticks below the site header (top-20) above content, on a solid background', () => {
    expect(bar).toMatch(/sticky top-20 z-30/);
    expect(bar).toMatch(/bg-panel/);
    expect(bar).toMatch(/shadow-/);
  });

  it('is one line that scrolls inside itself, so a phone gets no sideways page scroll', () => {
    expect(bar).toMatch(/flex-nowrap/);
    expect(bar).toMatch(/overflow-x-auto/);
  });

  it('is not a child of a section (a sticky element only sticks within its parent)', () => {
    const before = page.slice(0, page.indexOf('data-pop-bar'));
    expect(before.lastIndexOf('</section>')).toBeGreaterThan(before.lastIndexOf('<section'));
  });

  it('leaves the sidebar previews their own stuck panel instead of stacking a second bar', () => {
    expect(bar).toMatch(/side \? '' : 'sticky/);
    expect(page).toMatch(/\{side !== 'b' && \(\s*<div data-pop-bar/);
  });

  it('matrix header cells stick to the top of their bounded scroller', () => {
    expect(page).toMatch(/const stickyTh = 'sticky top-0 z-10 bg-panel/);
    expect((page.match(/\$\{stickyTh\}/g) || []).length).toBeGreaterThanOrEqual(8);
    expect(page).toMatch(/overflow-x-auto overflow-y-auto max-h-\[75vh\]/);
    expect(page).toMatch(/overflow-x-auto overflow-y-auto max-h-\[80vh\]/);
  });
});
