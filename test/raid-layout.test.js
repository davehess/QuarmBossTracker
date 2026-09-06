// test/raid-layout.test.js — the member's choice between the two attendance
// layouts (Hitya, 2026-09-04: "I like blocks and strips, let's keep both as
// options, default to strips").
//
// The pure picker is real-imported; the wiring is stripped-source: both pages
// read the cookie the picker writes, default to strips, and nothing references
// the dropped calendar variant any more.
//
// Run: npx vitest run test/raid-layout.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { pickRaidLayout, DEFAULT_RAID_LAYOUT, RAID_LAYOUT_COOKIE, RAID_LAYOUTS } from '../web/lib/raidLayout.ts';

const read = (...p) => stripJs(fs.readFileSync(path.join(ROOT, 'web', ...p), 'utf8'));
const history = read('app', 'raidhistory', 'page.tsx');
const me      = read('app', 'me', 'page.tsx');
const picker  = read('components', 'RaidLayoutPicker.tsx');

describe('pickRaidLayout', () => {
  it('defaults to strips', () => {
    expect(DEFAULT_RAID_LAYOUT).toBe('strips');
    expect(pickRaidLayout()).toBe('strips');
    expect(pickRaidLayout(null, null)).toBe('strips');
    expect(pickRaidLayout('calendars', 'nonsense')).toBe('strips');
  });

  it('cookie beats default, query beats cookie', () => {
    expect(pickRaidLayout(undefined, 'blocks')).toBe('blocks');
    expect(pickRaidLayout('strips', 'blocks')).toBe('strips');
    expect(pickRaidLayout('blocks', 'strips')).toBe('blocks');
    expect(pickRaidLayout('c', 'blocks')).toBe('blocks');   // the dropped variant is not a value
  });

  it('exposes exactly the two layouts, strips first', () => {
    expect(RAID_LAYOUTS.map(l => l.key)).toEqual(['strips', 'blocks']);
    expect(RAID_LAYOUT_COOKIE).toBe('wp_raid_layout');
  });
});

describe('the pages honour the choice', () => {
  it('both read ?layout= then the cookie, through the one picker function', () => {
    expect(history).toMatch(/pickRaidLayout\(sp\.layout, \(await cookies\(\)\)\.get\(RAID_LAYOUT_COOKIE\)\?\.value\)/);
    expect(me).toMatch(/pickRaidLayout\(\(await searchParams\)\?\.layout, \(await cookies\(\)\)\.get\(RAID_LAYOUT_COOKIE\)\?\.value\)/);
  });

  it('render strips or blocks and nothing else', () => {
    expect(history).toMatch(/layout === 'strips' \? \(\s*<RaidNightsStrips/);
    expect(me).toMatch(/layout === 'strips' \? \(\s*<RaidNightsStrips/);
    expect(history).toMatch(/<RaidLayoutPicker current=\{layout\} \/>/);
    expect(me).toMatch(/<RaidLayoutPicker current=\{layout\} \/>/);
    for (const src of [history, me]) {
      expect(src).not.toMatch(/RaidNightsCalendar|CalNight|IS_BETA|pickVariant/);
    }
    expect(fs.existsSync(path.join(ROOT, 'web', 'components', 'RaidNightsCalendar.tsx'))).toBe(false);
  });
});

describe('RaidLayoutPicker', () => {
  it('writes a year-long cookie the way the timezone picker does, then re-renders from the server', () => {
    expect(picker).toMatch(/document\.cookie = `\$\{RAID_LAYOUT_COOKIE\}=\$\{v\}; path=\/; max-age=31536000; SameSite=Lax`;/);
    expect(picker).toMatch(/url\.searchParams\.delete\('layout'\);/);
    expect(picker).toMatch(/router\.refresh\(\);/);
    expect(picker).toMatch(/aria-pressed=\{key === current\}/);
  });
});
