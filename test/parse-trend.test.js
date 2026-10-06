// test/parse-trend.test.js — /me/parses: the chart's maths (web/lib/parseTrend.ts) and the page's rules.
//
// A member asked on 2026-10-06 for a graph of their own parses over a window; the guild lead picked a Mimic
// tab plus wolfpack.quest/me/parses, both reading the my_parse_series function. This pins:
//   · the clock: Eastern raid nights (a 1 am fight belongs to the night before), 12-hour labels, DST days
//   · the scales: the DPS axis top, the x labels (hours / weekdays / dates), where a night's average sits
//   · the reader: junk in, a series out
//   · the page: it takes the person from the SESSION and never from the URL, and the chart never uses red
//
// Run: npx vitest run test/parse-trend.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  readParseSeries, nightKey, fmtWhen, wallToMs, niceTop, vsUsualPct, xTicks, buildTrend, fmtInt,
} from '../web/lib/parseTrend.ts';

const ET = 'America/New_York';
const iso = (s) => Date.parse(s);

describe('clock', () => {
  it('formats a fight the way the table and the hover show it', () => {
    // Sun Oct 4 2026, 9:17 pm EDT
    expect(fmtWhen(iso('2026-10-05T01:17:00Z'), ET)).toBe('Sun Oct 4, 9:17 pm');
    expect(fmtWhen(iso('2026-10-05T01:17:00Z'), ET, false)).toBe('Sun 9:17 pm');
    expect(fmtWhen(iso('2026-10-05T04:05:00Z'), ET)).toBe('Mon Oct 5, 12:05 am');   // not 0:05
    expect(fmtWhen(iso('2026-10-05T16:00:00Z'), ET)).toBe('Mon Oct 5, 12:00 pm');
  });

  it('shows the picked zone, not always Eastern', () => {
    expect(fmtWhen(iso('2026-10-05T01:17:00Z'), 'America/Los_Angeles')).toBe('Sun Oct 4, 6:17 pm');
    expect(fmtWhen(iso('2026-10-05T01:17:00Z'), 'Not/AZone')).toBe('Sun Oct 4, 9:17 pm');   // a bad zone falls back
  });

  it('groups by raid night: the Eastern clock minus six hours, as the database function does', () => {
    expect(nightKey(iso('2026-10-05T01:17:00Z'))).toBe('2026-10-04');   // Sun 9:17 pm
    expect(nightKey(iso('2026-10-05T05:30:00Z'))).toBe('2026-10-04');   // Mon 1:30 am: still Sunday's night
    expect(nightKey(iso('2026-10-05T09:59:00Z'))).toBe('2026-10-04');   // Mon 5:59 am
    expect(nightKey(iso('2026-10-05T10:00:00Z'))).toBe('2026-10-05');   // Mon 6:00 am: a new night
    expect(nightKey(iso('2026-11-02T04:30:00Z'))).toBe('2026-11-01');   // an EST night, after the clocks change
  });

  it('turns a wall-clock time into an instant on both sides of a DST change', () => {
    expect(wallToMs(2026, 10, 4, 22, 0, ET)).toBe(iso('2026-10-05T02:00:00Z'));    // EDT, UTC-4
    expect(wallToMs(2026, 11, 2, 22, 0, ET)).toBe(iso('2026-11-03T03:00:00Z'));    // EST, UTC-5
    expect(wallToMs(2026, 11, 1, 0, 0, ET)).toBe(iso('2026-11-01T04:00:00Z'));     // midnight before the fall-back
    expect(wallToMs(2026, 11, 2, 0, 0, ET)).toBe(iso('2026-11-02T05:00:00Z'));     // midnight after it: 25 hours later
    expect(wallToMs(2026, 3, 9, 0, 0, ET)).toBe(iso('2026-03-09T04:00:00Z'));      // the day after the spring-forward
    // a time just past the change, where the first guess lands on the wrong side of it
    expect(wallToMs(2026, 11, 1, 3, 0, ET)).toBe(iso('2026-11-01T08:00:00Z'));    // 3 am EST, after the clocks fall back
    expect(wallToMs(2026, 3, 8, 4, 0, ET)).toBe(iso('2026-03-08T08:00:00Z'));     // 4 am EDT, after they spring forward
  });
});

describe('scales', () => {
  it('picks the top of the DPS axis: the next round number up, never under 10', () => {
    expect(niceTop(189)).toBe(200);
    expect(niceTop(200)).toBe(200);
    expect(niceTop(201)).toBe(250);
    expect(niceTop(251)).toBe(300);
    expect(niceTop(1290)).toBe(1500);
    expect(niceTop(9800)).toBe(10000);
    expect(niceTop(0)).toBe(10);
    expect(niceTop(3)).toBe(10);
  });

  it('formats a comparison with the usual, or says there is none', () => {
    expect(vsUsualPct(112, 100)).toBe(12);
    expect(vsUsualPct(92, 100)).toBe(-8);
    expect(vsUsualPct(100, 100)).toBe(0);
    expect(vsUsualPct(100, null)).toBeNull();
    expect(vsUsualPct(100, 0)).toBeNull();
    expect(fmtInt(1234.6)).toBe('1,235');
  });

  it('labels a day by the hour, a week by weekday, a month by date', () => {
    const now = iso('2026-10-06T16:00:00Z');                 // Tue 12 pm EDT

    const day = xTicks(now - 86_400_000, now, ET);
    expect(day.map(t => t.label)).toEqual(['12 pm', '6 pm', 'Tue', '6 am', '12 pm']);   // midnight reads as the new day
    expect(day.every(t => t.ms >= now - 86_400_000 && t.ms <= now)).toBe(true);

    const week = xTicks(now - 7 * 86_400_000, now, ET);
    const weekLabels = week.filter(t => t.label).map(t => t.label);
    expect(weekLabels).toEqual(['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue']);
    // each weekday label is centred inside its own day, never on the midnight line
    for (const t of week.filter(x => x.label)) {
      expect(t.labelMs).toBeGreaterThanOrEqual(now - 7 * 86_400_000);
      expect(t.labelMs).toBeLessThanOrEqual(now);
    }

    const month = xTicks(now - 30 * 86_400_000, now, ET);
    expect(month.length).toBeLessThanOrEqual(8);
    expect(month.every(t => /^[A-Z][a-z]{2} \d{1,2}$/.test(t.label))).toBe(true);
    const quarter = xTicks(now - 90 * 86_400_000, now, ET);
    expect(quarter.length).toBeLessThanOrEqual(8);
    expect(quarter.length).toBeGreaterThan(3);
  });
});

const fight = (o) => ({
  t: '2026-10-05T01:17:00Z', eid: 'e1', npc_id: 1, name: 'Lord Nagafen', boss: true, char: 'Aldenmar',
  dps: 189, dmg: 100000, dur: 500, rank: 3, usual: 168, ...o,
});

describe('readParseSeries', () => {
  it('survives junk and fills defaults', () => {
    for (const bad of [null, undefined, 5, 'x', [], {}]) {
      const s = readParseSeries(bad);
      expect(s.fights).toEqual([]);
      expect(s.nights).toEqual([]);
      expect(s.characters).toEqual([]);
      expect(s.truncated).toBe(false);
      expect(s.floor).toBe('2026-07-14T00:00:00Z');
    }
  });

  it('keeps good rows, drops unusable ones, coerces numbers, sorts oldest first', () => {
    const s = readParseSeries({
      floor: '2026-07-14T00:00:00Z', total: '3', truncated: true,
      characters: [{ name: 'Aldenmar', class: 'Wizard', active: true }, { name: '' }, null],
      fights: [
        fight({ t: '2026-10-05T02:00:00Z', eid: 'b', dps: '250.5', usual: null, rank: null }),
        fight({ t: 'garbage', eid: 'x' }),
        fight({ eid: null }),
        fight({ dps: null }),
        fight({ t: '2026-10-05T01:00:00Z', eid: 'a' }),
      ],
      nights: [{ night: '2026-10-04', fights: 2, bosses: 2, avg_dps: 200, best_dps: 250 }, { night: 4 }],
    });
    expect(s.fights.map(f => f.eid)).toEqual(['a', 'b']);
    expect(s.fights[1].dps).toBe(250.5);
    expect(s.fights[1].usual).toBeNull();
    expect(s.total).toBe(3);
    expect(s.truncated).toBe(true);
    expect(s.characters).toEqual([{ name: 'Aldenmar', class: 'Wizard', active: true }]);
    expect(s.nights).toHaveLength(1);
  });
});

describe('buildTrend', () => {
  // Sunday and Monday nights, a trash fight on Sunday.
  const series = readParseSeries({
    floor: '2026-07-14T00:00:00Z', total: 4, truncated: false,
    characters: [{ name: 'Aldenmar', class: 'Wizard', active: true }],
    fights: [
      fight({ t: '2026-10-05T00:30:00Z', eid: 'a', dps: 100, name: 'a cave bat', boss: false }),   // Sun 8:30 pm
      fight({ t: '2026-10-05T01:30:00Z', eid: 'b', dps: 200 }),                                       // Sun 9:30 pm
      fight({ t: '2026-10-06T01:00:00Z', eid: 'c', dps: 300 }),                                       // Mon 9:00 pm
      fight({ t: '2026-10-06T02:00:00Z', eid: 'd', dps: 100 }),                                       // Mon 10:00 pm
    ],
    nights: [
      { night: '2026-10-04', fights: 2, bosses: 1, avg_dps: 150, best_dps: 200 },
      { night: '2026-10-05', fights: 2, bosses: 2, avg_dps: 200, best_dps: 300 },
    ],
  });
  const nowMs = iso('2026-10-06T16:00:00Z');
  const weekAgo = nowMs - 7 * 86_400_000;
  const m = buildTrend(series, { sinceMs: weekAgo, nowMs, tz: ET });

  it('puts every dot inside the plot, boss and trash apart', () => {
    expect(m.dots).toHaveLength(4);
    for (const d of m.dots) {
      expect(d.x).toBeGreaterThanOrEqual(0); expect(d.x).toBeLessThanOrEqual(1);
      expect(d.y).toBeGreaterThanOrEqual(0); expect(d.y).toBeLessThanOrEqual(1);
    }
    expect(m.dots.map(d => d.boss)).toEqual([false, true, true, true]);
    expect(m.hasOther).toBe(true);
    // later is further right, higher DPS is higher up
    expect(m.dots[1].x).toBeGreaterThan(m.dots[0].x);
    expect(m.dots[2].y).toBeGreaterThan(m.dots[1].y);
    expect(m.top).toBe(niceTop(300 * 1.04));
  });

  it('words the hover the way the page promises', () => {
    expect(m.dots[1].title).toBe('Lord Nagafen · 200 dps · Sun 9:30 pm');
    // a month shows the date too, and a second character is named
    const month = buildTrend(series, { sinceMs: nowMs - 30 * 86_400_000, nowMs, tz: ET, multiChar: true });
    expect(month.dots[1].title).toBe('Lord Nagafen · 200 dps · Sun Oct 4, 9:30 pm · Aldenmar');
  });

  it('puts a night average in the middle of that night\'s fights, with the numbers in its hover', () => {
    expect(m.avgs).toHaveLength(2);
    expect(m.avgs[0].x).toBeCloseTo((m.dots[0].x + m.dots[1].x) / 2, 10);
    expect(m.avgs[1].x).toBeCloseTo((m.dots[2].x + m.dots[3].x) / 2, 10);
    expect(m.avgs[0].y).toBeCloseTo(150 / m.top, 10);
    expect(m.avgs[0].title).toBe('Sun night · average 150 dps · best 200 · 2 fights');
  });

  it('falls back to 10 pm Eastern when a night\'s fights did not come back (a window cut at the cap)', () => {
    const cut = buildTrend({ ...series, fights: [], nights: [series.nights[0]] }, { sinceMs: weekAgo, nowMs, tz: ET });
    const at10 = wallToMs(2026, 10, 4, 22, 0, ET);
    const hi = nowMs;
    expect(cut.avgs[0].x).toBeCloseTo((at10 - weekAgo) / (hi - weekAgo), 10);
  });

  it('starts a lifetime window at the first day with data and never before the floor', () => {
    const life = buildTrend(series, { sinceMs: null, nowMs, tz: ET });
    // from Oct 4 midnight EDT to now is 60 hours; the first fight is 20.5 hours in
    expect(life.dots[0].x).toBeCloseTo(20.5 / 60, 5);
    const old = buildTrend(series, { sinceMs: iso('2026-06-01T00:00:00Z'), nowMs, tz: ET });
    expect(old.spanDays).toBeCloseTo((nowMs - iso('2026-07-14T00:00:00Z')) / 86_400_000, 5);
  });

  it('keeps labels inside the plot', () => {
    for (const t of m.xTicks) { expect(t.labelX).toBeGreaterThanOrEqual(0); expect(t.labelX).toBeLessThanOrEqual(1); }
  });
});

describe('the page and the chart', () => {
  const read = (rel) => stripJs(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const page = read('web/app/me/parses/page.tsx');
  const chart = read('web/components/ParseTrendChart.tsx');

  it('takes the person from the session, never from the URL', () => {
    expect(page).toMatch(/\.eq\('user_id', user\.id\)/);
    expect(page).toMatch(/p_discord_id:\s*discordId/);
    // the query string carries only the window, the scope and one character
    expect(page).toMatch(/const \{ w: wParam, scope: scopeParam, char: charParam \} = await searchParams;/);
    expect(page).not.toMatch(/searchParams[^;]*discord/i);
    expect(page).toMatch(/redirect\('\/auth\/signin\?next=\/me\/parses'\)/);
  });

  it('is marked [beta] at the top, as every new page is', () => {
    expect(page).toMatch(/<NewPageTag/);
    expect(page).toMatch(/title: '\[beta\] My parses'/);
  });

  it('draws in the shared palette and never in the death red', () => {
    expect(chart).not.toMatch(/f85149/i);
    for (const hex of ['#4493e8', '#4a5568', '#a371f7']) expect(chart).toContain(hex);
    expect(chart).toMatch(/viewBox=\{`0 0 \$\{W\} \$\{H\}`\}/);
    expect(chart).toMatch(/width: '100%', height: 'auto'/);
  });
});
