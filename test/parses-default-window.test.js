// test/parses-default-window.test.js — /parses opens on the last 7 days and loads its reads together.
//
// FB-59 (a member, 2026-10-07): "Parses page on wolfpack.quest defaults to 60 days instead of 7 days,
// and lags out when it loads." Measured the same day on production: 7 days holds 15 curated kill cards
// (131 player rows); 60 days holds 320 of which the 250-card limit keeps 250, carrying 6,031 embedded
// player rows (~460 KB of JSON). The page also awaited its eight reads one after another.
//
// What is pinned here:
//   · no ?w= means 7 days — and every other window stays selectable (the picker still lists them);
//   · the six independent reads are started together (Promise.all) instead of one by one;
//   · the zone read asks only for the columns the page uses;
//   · an empty window says "quiet window", not "nothing recorded yet" (the shorter default makes an
//     empty week an ordinary thing).
//
// Source-text assertions run on comment-stripped source (CLAUDE.md: comments satisfy text assertions);
// the default itself is checked by running the REAL resolveWindow on the value the page passes it.
//
// Run: npx vitest run test/parses-default-window.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, sliceBlock } from './_source-slice.js';
import { resolveWindow } from '../web/lib/timeWindow.ts';

const page = stripJs(fs.readFileSync(path.join(ROOT, 'web', 'app', 'parses', 'page.tsx'), 'utf8'));
const loadAll = sliceBlock(page, 'async function loadAll(', '\nfunction resolveZone(');

describe('/parses default window', () => {
  it('passes the page constant to resolveWindow, and that constant is 7 days', () => {
    expect(page).toMatch(/resolveWindow\(wParam, DEFAULT_WINDOW\)/);
    const def = /const DEFAULT_WINDOW = '(\w+)'/.exec(page)?.[1];
    expect(def).toBeTruthy();
    const w = resolveWindow(undefined, def);
    expect(w.key).toBe('7d');
    expect(w.days).toBe(7);
    // The URL without ?w= and a junk ?w= both mean the default; an explicit 60d still means 60 days.
    expect(resolveWindow('nonsense', def).key).toBe('7d');
    expect(resolveWindow('60d', def).days).toBe(60);
    expect(resolveWindow('life', def).sinceIso).toBeNull();
  });

  it('the picker still offers every window, 60d included', () => {
    const options = /<WindowPicker page="parses" current=\{w\.key\} options=\{\[([^\]]*)\]\}/.exec(page)?.[1];
    expect(options, 'the WindowPicker element changed shape: update this test with it').toBeTruthy();
    for (const k of ['7d', '30d', '60d', '90d', 'exp', 'life']) expect(options).toContain(`'${k}'`);
  });

  it('an empty window points at a longer one instead of claiming nothing was ever recorded', () => {
    expect(page).toMatch(/w\.key === 'life'/);
    expect(page).toMatch(/pick a longer one above/);
  });
});

describe('/parses loads its reads together', () => {
  const all = /await Promise\.all\(\[([\s\S]*?)\]\);/.exec(loadAll)?.[1] ?? '';

  it('starts the cards, off-card rollup, roster, zones, loot and attendance in ONE Promise.all', () => {
    expect(all, 'no Promise.all in loadAll').not.toBe('');
    for (const part of ['encQuery', 'loadOffcardRollup(', "from('characters')", "from('eqemu_zone')", 'loadLootRecent<LootDbRow>(', 'loadRaidTicks(']) {
      expect(all, part).toContain(part);
    }
  });

  it('does not await any of them on its own again', () => {
    expect(loadAll).not.toMatch(/await\s+(loadOffcardRollup|loadLootRecent|loadRaidTicks|loadTicksForRaids)\b/);
    expect(loadAll).not.toMatch(/await\s+encQuery\b/);
    // The only thing left to wait on before the fan-out is the curated-id lookup the cards filter on.
    expect(loadAll.slice(0, loadAll.indexOf('await Promise.all')).match(/\bawait\b/g)).toHaveLength(1);
  });

  it('reads only the zone columns the page uses', () => {
    expect(loadAll).toMatch(/from\('eqemu_zone'\)\.select\('short_name, long_name, zone_id'\)/);
    expect(page).not.toMatch(/expansion/);
  });
});
