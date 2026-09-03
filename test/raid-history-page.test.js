// test/raid-history-page.test.js — the wiring around the raid-attendance
// heatmaps: /raidhistory, the /me section, the shared grid component, nav and
// link-preview metadata (Hitya, 2026-09-03).
//
// The pure math is covered by raid-heatmap.test.js. This file is the
// call-site half: the page reads the right tables the right way (paged, tick
// gaps dropped, "full" from raid_targets with a fallback), /me unions the
// family through the overlap filter, every night cell links to its review,
// and the grid is reachable from the nav. Stripped-source assertions —
// comments stripped first, because this repo's comments quote the very
// strings a naive toContain would match.
//
// Run: npx vitest run test/raid-history-page.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const read = (...p) => stripJs(fs.readFileSync(path.join(ROOT, 'web', ...p), 'utf8'));

const page  = read('app', 'raidhistory', 'page.tsx');
const me    = read('app', 'me', 'page.tsx');
const grid  = read('components', 'RaidHeatmap.tsx');
const nav   = read('components', 'Nav.tsx');
const meta  = read('lib', 'pageMeta.ts');

describe('/raidhistory reads', () => {
  it('is member-gated', () => {
    expect(page).toMatch(/redirect\('\/auth\/signin\?next=\/raidhistory'\)/);
  });

  it('takes "full" from the 60-man raid_targets row set, with a fallback', () => {
    expect(page).toMatch(/\.from\('raid_targets'\)[\s\S]{0,200}\.eq\('raid_size', '60-man'\)/);
    expect(page).toMatch(/return sum > 0 \? sum : DEFAULT_FULL_RAID;/);
  });

  it('pages both reads and drops sync-gap ticks', () => {
    expect(page).toMatch(/selectAll<NightRaid>/);
    expect(page).toMatch(/selectAll<NightTick>/);
    expect(page).toMatch(/buildNights\(raids, ticks\.filter\(t => Array\.isArray\(t\.attendees\) && t\.attendees\.length > 0\)\)/);
    expect(page).not.toMatch(/\.limit\(/);
  });

  it('colours a night by raiders over full and links it to the review', () => {
    expect(page).toMatch(/color: fillColor\(raiders \/ full\)/);
    expect(page).toMatch(/href: `\/raid\/review\/\$\{n\.date\}`/);
    // A raid row with no captured ticks is not a night.
    expect(page).toMatch(/filter\(n => n\.tickIds\.length > 0\)/);
  });
});

describe('/me section', () => {
  const loader = me.slice(me.indexOf('async function loadFamilyAttendance('), me.indexOf('async function loadScrap('));

  it('loads the family union through the overlap filter, ids only', () => {
    expect(me).toMatch(/loadFamilyAttendance\(chars\.map\(c => c\.name\)\)/);
    expect(loader).toMatch(/\.overlaps\('attendees', names\)/);
    // Neither tick read pulls the attendee arrays — that is the wide part.
    expect(loader.match(/\.select\('raid_id, tick_id'\)/g) ?? []).toHaveLength(2);
    expect(loader).not.toMatch(/\.select\('raid_id, tick_id, attendees'\)/);
    expect(loader).toMatch(/\.neq\('attendees', '\{\}'\)/);
  });

  it('hides itself when the tick read failed rather than drawing a year of misses', () => {
    expect(loader).toMatch(/if \(heldTicks\.length === 0\) return null;/);
  });

  it('a missed night is an outline, an attended one is gold scaled by ticks', () => {
    expect(loader).toMatch(/outline: got === 0/);
    expect(loader).toMatch(/alpha: got > 0 \? attendedAlpha\(got, n\.tickIds\.length\) : undefined/);
    expect(loader).toMatch(/href: `\/raid\/review\/\$\{n\.date\}`/);
  });

  it('renders the grid and points at the guild page', () => {
    expect(me).toMatch(/<RaidHeatmap weeks=\{attendance\.weeks\}/);
    expect(me).toMatch(/href="\/raidhistory"/);
  });
});

describe('RaidHeatmap component', () => {
  it('is a client component with one fixed tooltip that hides on scroll', () => {
    expect(grid.trimStart().startsWith("'use client'")).toBe(true);
    expect(grid).toMatch(/role="tooltip"/);
    expect(grid).toMatch(/fixed z-50/);
    expect(grid).toMatch(/addEventListener\('scroll', hide/);
  });

  it('labels only the raid days', () => {
    expect(grid).toMatch(/const ROW_LABELS = \['Sun', '', '', 'Wed', 'Thu', '', ''\];/);
  });

  it('opens on the newest week and makes every night a real link', () => {
    expect(grid).toMatch(/el\.scrollLeft = el\.scrollWidth/);
    expect(grid).toMatch(/<a key=\{key\} href=\{cell\.href\}/);
    expect(grid).toMatch(/onFocus=\{e => onShow\(e\.currentTarget, cell\.lines\)\}/);
  });
});

describe('reachability', () => {
  it('sits in the Stats group of the nav', () => {
    const stats = nav.slice(nav.indexOf("id: 'stats'"), nav.indexOf("id: 'prep'"));
    expect(stats).toMatch(/\{ href: '\/raidhistory',\s+label: 'Raid history' \}/);
  });

  it('unfurls with its own description', () => {
    expect(meta).toMatch(/'\/raidhistory':\s+\{ title: 'Raid History'/);
  });
});
