// test/attendance-active-filter.test.js — /admin/attendance hides inactive
// members by default.
//
// Hitya, 2026-08-28: "if someone falls off of the 30 day list (no ticks in 30
// days) they become inactive. we should filter by default on that page by that
// stat. Topflight is an example of that where he just went inactive."
//
// Measured when this shipped: 290 rows, 218 with zero ticks in 30 days. Three
// quarters of the page was people who are not raiding, which is what made a
// real signal — Topflight, 30% over 90 days and not one tick since 2026-07-22 —
// something you had to hunt for rather than something the page told you.
//
// Run: npx vitest run test/attendance-active-filter.test.js

import { describe, it, expect } from 'vitest';
import { readSource, ROOT } from './_source-slice.js';
import path from 'node:path';

const src = readSource(path.join(ROOT, 'web', 'app', 'admin', 'attendance', 'page.tsx'));

describe('attendance page — active by default', () => {
  it('reads the 30-day tick count from the view', () => {
    // Without selecting it there is nothing to filter on, and the filter would
    // silently pass everyone.
    expect(src).toMatch(/\.select\('[^']*att_ticks_30d/);
  });

  it('defines inactive on TICKS, not on RA%', () => {
    // ⚠ The distinction matters. A returning member can sit at 0% RA for a
    // window and still have raided this week; someone at 40% 90d RA can have
    // stopped a month ago — Topflight was exactly that. Filtering on the
    // percentage would hide the wrong people.
    expect(src).toContain('Number(m.att_ticks_30d) > 0');
    expect(src).toContain('Number(m.att_ticks_30d) === 0');
  });

  it('shows the active list unless ?show=all is asked for', () => {
    expect(src).toContain("const showAll = p.show === 'all';");
    expect(src).toContain('const shownMetrics    = showAll ? familyMetrics : activeMetrics;');
  });

  it('renders the FILTERED list, not the full one', () => {
    // The bug this would be: filter computed, table still maps familyMetrics.
    expect(src).toContain('{shownMetrics.map(m => {');
    expect(src).not.toContain('{familyMetrics.map(m => (');
  });

  it('says how many are hidden, and offers the way back', () => {
    // A silent filter is worse than no filter — it makes the page look like the
    // whole roster while it is not.
    expect(src).toContain('inactiveMetrics.length');
    expect(src).toContain('show inactive');
    expect(src).toContain('hide inactive');
  });

  it('keeps the other query params when toggling', () => {
    // Dropping a what-if `targets` override or a tuned threshold because you
    // clicked a filter link is the kind of small betrayal that stops people
    // using the filter at all.
    expect(src).toContain('const attendanceHref =');
    for (const k of ['targets', 'threshold', 'show']) {
      expect(src).toContain(`if (p.${k}) q.set('${k}', p.${k});`);
    }
  });

  it('marks inactive rows when they ARE shown', () => {
    expect(src).toContain('const inactive = Number(m.att_ticks_30d) === 0;');
    expect(src).toContain('last_attended');
  });

  it('shows the empty state against the visible list', () => {
    // Otherwise "no rows" never appears when every active member is filtered
    // out, and the table just renders blank.
    expect(src).toContain('{shownMetrics.length === 0 && (');
  });
});
