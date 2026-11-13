// test/bot-guild-schedule.test.js — the bot's raid schedule comes from the guild's saved settings (utils/guildSchedule.js),
// and for the existing guild that changes nothing. Real functions are called throughout; the "before" side is a
// reference copy of the constant-based logic as it stood before the switch.
//
// Run: npx vitest run test/bot-guild-schedule.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { WOLFPACK_SEED, DEFAULT_SETTINGS } from '../web/lib/guildSettings.ts';

const require = createRequire(import.meta.url);
const gs = require('../utils/guildSchedule.js');
const tzu = require('../utils/timezone.js');
const rn = require('../utils/raidNight.js');
const rt = require('../utils/raidTick.js');

const H = 3_600_000;
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// ── reference: the constant-based logic before the switch ──
function refInWindow(ms) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false })
    .formatToParts(new Date(ms)).reduce((a, { type, value }) => { a[type] = value; return a; }, {});
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  if (![0, 3, 4].includes(dow)) return false;
  const mins = (parseInt(p.hour) % 24) * 60 + (parseInt(p.minute) || 0);
  return mins >= 20 * 60 + 30 && mins < 23 * 60 + 30;
}
function refRaidNightAt(ms) {
  const tz = 'America/New_York';
  const anchor = tzu.partsInTzAt(ms - 6 * H, tz);
  if (!['sunday', 'wednesday', 'thursday'].includes(anchor.dayOfWeek)) return false;
  const p = tzu.partsInTzAt(ms, tz);
  if (p.dayOfWeek === anchor.dayOfWeek) return p.hour * 60 + p.minute >= 20 * 60 + 30;
  return true;
}
function refNightKey(ms) {
  return new Date(ms - 6 * H).toLocaleDateString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
}

// 2026-11-05 is a Thursday (EST, UTC-5); 2026-03-08 is the spring-forward Sunday; 2026-11-01 the fall-back Sunday.
const et = (iso, off) => Date.parse(`${iso}${off}`);
const STAMPS = [
  et('2026-11-05T20:29:00', '-05:00'), et('2026-11-05T20:30:00', '-05:00'), et('2026-11-05T23:29:00', '-05:00'),
  et('2026-11-05T23:30:00', '-05:00'), et('2026-11-06T00:00:00', '-05:00'), et('2026-11-06T00:20:00', '-05:00'),
  et('2026-11-06T05:59:00', '-05:00'), et('2026-11-06T06:00:00', '-05:00'), et('2026-11-06T06:01:00', '-05:00'),
  et('2026-11-06T21:00:00', '-05:00'),   // Friday evening: off night
  et('2026-11-02T21:00:00', '-05:00'),   // Monday: off night
  et('2026-11-04T21:00:00', '-05:00'),   // Wednesday
  et('2026-03-08T01:59:00', '-05:00'), et('2026-03-08T03:00:00', '-04:00'), et('2026-03-08T20:30:00', '-04:00'),
  et('2026-03-08T23:30:00', '-04:00'), et('2026-03-09T00:30:00', '-04:00'), et('2026-03-09T05:59:00', '-04:00'),
  et('2026-11-01T01:30:00', '-04:00'), et('2026-11-01T01:30:00', '-05:00'), et('2026-11-01T20:30:00', '-05:00'),
  et('2026-11-01T23:29:00', '-05:00'), et('2026-11-02T00:10:00', '-05:00'), et('2026-11-02T05:59:00', '-05:00'),
];

const seedRow = (over = {}) => ([{ settings: { ...WOLFPACK_SEED, ...over } }]);
const load = async (rows) => { gs._setLoader(async () => rows); await gs.refreshSchedule(); };

beforeEach(() => { delete process.env.DEFAULT_TIMEZONE; delete process.env.RAID_NIGHT_ROLLOVER_HOUR; gs._reset(); });
afterEach(() => { gs._reset(); });

describe('defaults match the web seed', () => {
  it('the constants equal WOLFPACK_SEED.schedule', () => {
    const c = gs.constantSchedule();
    const s = WOLFPACK_SEED.schedule;
    const hm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    expect(c.tz).toBe(s.tz);
    expect([...c.days].sort()).toEqual([...s.days].sort());
    expect(hm(c.startMin)).toBe(s.start);
    expect(hm(c.endMin)).toBe(s.end);
    expect(hm(c.planEndMin)).toBe(s.planEnd);
    expect(c.cutoffHour).toBe(s.nightCutoffHour);
  });
  it('the seed row parses to the constants, field for field', () => {
    const p = gs.parseSchedule(WOLFPACK_SEED);
    const c = gs.constantSchedule();
    expect({ ...p, source: 'x', days: [...p.days] }).toEqual({ ...c, source: 'x', days: [...c.days] });
  });
  it('a row with no schedule, and the neutral web default (no days), are not used', () => {
    expect(gs.parseSchedule({})).toBeNull();
    expect(gs.parseSchedule(DEFAULT_SETTINGS)).toBeNull();
  });
});

describe('(a) no row: every value is today\'s constant', () => {
  it('missing row', async () => {
    await load([]);
    const s = gs.getSchedule();
    expect(s.source).toBe('constants');
    expect(s.tz).toBe('America/New_York');
    expect([...s.days]).toEqual([...tzu.RAID_DAYS]);
    expect(s.startMin).toBe(tzu.RAID_WINDOW_START);
    expect(s.endMin).toBe(tzu.RAID_WINDOW_END);
    expect(s.cutoffHour).toBe(6);
    expect(rn.rolloverHour()).toBe(6);
  });
  it('Supabase disabled (no loader, no env) answers constants synchronously', () => {
    expect(gs.getSchedule().source).toBe('constants');
  });
  it('the tick slots are TICK_SLOTS', () => {
    expect(rt.slotsFor(gs.constantSchedule())).toEqual(rt.TICK_SLOTS);
  });
  it('the DEFAULT_TIMEZONE env still drives the night key when no row is saved', async () => {
    await load([]);
    process.env.DEFAULT_TIMEZONE = 'America/Chicago';
    const ms = et('2026-11-05T21:30:00', '-05:00');           // 20:30 Chicago
    expect(rn.isRaidNightAt(ms)).toBe(true);
    expect(rn.isRaidNightAt(et('2026-11-05T21:29:00', '-05:00'))).toBe(false);
  });
  it('a DEFAULT_TIMEZONE set on the deployment wins over the saved row for night keys', async () => {
    await load([{ settings: { schedule: { tz: 'America/New_York', days: [0, 3, 4], start: '20:30', end: '23:30', nightCutoffHour: 6 } } }]);
    expect(gs.getSchedule().source).toBe('row');
    process.env.DEFAULT_TIMEZONE = 'America/Chicago';
    expect(rn.isRaidNightAt(et('2026-11-05T21:30:00', '-05:00'))).toBe(true);    // 20:30 Chicago, 21:30 New York
    expect(rn.isRaidNightAt(et('2026-11-05T21:29:00', '-05:00'))).toBe(false);   // 20:29 Chicago: the row's zone would say true
  });
});

describe('(b) the seeded row is identical to the constant-based functions', () => {
  it.each(['no row', 'seed row'])('%s: window, night membership and night key agree on every stamp', async (mode) => {
    await load(mode === 'seed row' ? seedRow() : []);
    if (mode === 'seed row') expect(gs.getSchedule().source).toBe('row');
    for (const ms of STAMPS) {
      const label = new Date(ms).toISOString();
      expect(tzu.isInRaidWindow(ms), `window ${label}`).toBe(refInWindow(ms));
      expect(rn.isRaidNightAt(ms), `night ${label}`).toBe(refRaidNightAt(ms));
      expect(rn.nightKey(ms), `key ${label}`).toBe(refNightKey(ms));
    }
  });
  it('ticks: the same slot fires at the same minutes on every day', async () => {
    const run = () => {
      const out = [];
      for (const d of DAYS) for (let h = 19; h <= 23; h++) for (const m of [0, 29, 30, 34, 35, 59]) {
        out.push(rt.dueSlotAt({ dayOfWeek: d, hour: h, minute: m })?.slot ?? null);
      }
      return out;
    };
    await load([]);
    const before = run();
    await load(seedRow());
    expect(run()).toEqual(before);
    expect(before.filter(Boolean).length).toBeGreaterThan(0);
  });
});

describe('(c) another guild\'s row moves the schedule', () => {
  const chicago = { v: 1, schedule: { tz: 'America/Chicago', days: [2, 6], start: '19:00', end: '22:00', planEnd: '23:00', nightCutoffHour: 4 } };
  it('window, night and key follow the row', async () => {
    await load([{ settings: chicago }]);
    const tue1900 = et('2026-11-03T19:00:00', '-06:00');
    expect(tzu.isInRaidWindow(tue1900)).toBe(true);
    expect(tzu.isInRaidWindow(tue1900 - 60_000)).toBe(false);
    expect(tzu.isInRaidWindow(et('2026-11-03T22:00:00', '-06:00'))).toBe(false);
    expect(tzu.isInRaidWindow(et('2026-11-05T20:30:00', '-06:00'))).toBe(false);   // Thursday is not a day any more
    expect(tzu.isInRaidWindow(et('2026-11-07T20:00:00', '-06:00'))).toBe(true);    // Saturday
    expect(rn.isRaidNightAt(et('2026-11-03T18:59:00', '-06:00'))).toBe(false);
    expect(rn.isRaidNightAt(et('2026-11-03T19:00:00', '-06:00'))).toBe(true);
    expect(rn.isRaidNightAt(et('2026-11-04T03:59:00', '-06:00'))).toBe(true);      // still Tuesday's night before 04:00
    expect(rn.isRaidNightAt(et('2026-11-04T04:00:00', '-06:00'))).toBe(false);
    expect(rn.nightKey(et('2026-11-04T02:00:00', '-06:00'))).toBe('11/03/2026');
    expect(rn.rolloverHour()).toBe(4);
  });
  it('the env rollover hour still wins over the row', async () => {
    await load([{ settings: chicago }]);
    process.env.RAID_NIGHT_ROLLOVER_HOUR = '8';
    expect(rn.rolloverHour()).toBe(8);
  });
  it('ticks run hourly from the start to the end, in the row\'s zone', async () => {
    await load([{ settings: chicago }]);
    expect(rt.slotsFor(gs.getSchedule()).map(s => [s.hour, s.minute, s.description])).toEqual([
      [19, 0, 'Tick 1 (Raid Start)'], [20, 0, 'Tick 2 (1 Hour)'], [21, 0, 'Tick 3 (2 Hour)'], [22, 0, 'Tick 4 (Raid End)'],
    ]);
    expect(rt.dueSlotAt({ dayOfWeek: 'tuesday', hour: 19, minute: 1 })?.slot).toBe(1);
    expect(rt.dueSlotAt({ dayOfWeek: 'thursday', hour: 19, minute: 1 })).toBeNull();
    expect(gs.getSchedule().tz).toBe('America/Chicago');
  });
  it('a window that wraps midnight belongs to the day it started on', async () => {
    await load([{ settings: { v: 1, schedule: { tz: 'UTC', days: [5], start: '22:00', end: '01:00', planEnd: '02:00', nightCutoffHour: 6 } } }]);
    expect(tzu.isInRaidWindow(Date.parse('2026-11-06T23:00:00Z'))).toBe(true);     // Friday 23:00
    expect(tzu.isInRaidWindow(Date.parse('2026-11-07T00:30:00Z'))).toBe(true);     // Saturday 00:30
    expect(tzu.isInRaidWindow(Date.parse('2026-11-07T23:00:00Z'))).toBe(false);    // Saturday night is not a day
  });
});

describe('(d) invalid or failed reads fall back', () => {
  const bad = [
    ['unknown zone', { schedule: { tz: 'Mars/Olympus' } }],
    ['bad day', { schedule: { days: [0, 9] } }],
    ['bad time', { schedule: { start: '8:30pm' } }],
    ['start equals end', { schedule: { start: '20:00', end: '20:00' } }],
    ['bad cutoff', { schedule: { nightCutoffHour: 20 } }],
    ['no days', { schedule: { days: [] } }],
    ['not an object', 'nope'],
  ];
  it.each(bad)('%s → constants', async (_n, settings) => {
    await load([{ settings }]);
    expect(gs.getSchedule().source).toBe('constants');
    for (const ms of STAMPS) expect(tzu.isInRaidWindow(ms)).toBe(refInWindow(ms));
  });
  it('a failed read keeps the last good row and logs once on stdout, never stderr', async () => {
    let rows = [{ settings: { v: 1, schedule: { tz: 'America/Chicago', days: [2], start: '19:00', end: '22:00' } } }];
    gs._setLoader(async () => rows);
    await gs.refreshSchedule();
    expect(gs.getSchedule().tz).toBe('America/Chicago');
    rows = null;
    const logs = []; const errs = [];
    const lg = console.log, er = console.error, wn = console.warn;
    console.log = (...a) => logs.push(a.join(' ')); console.error = (...a) => errs.push(a.join(' ')); console.warn = (...a) => errs.push(a.join(' '));
    try { await gs.refreshSchedule(); await gs.refreshSchedule(); await gs.refreshSchedule(); } finally { console.log = lg; console.error = er; console.warn = wn; }
    expect(errs).toEqual([]);
    expect(logs.filter(l => l.includes('[guild-schedule]'))).toHaveLength(1);
    expect(gs.getSchedule().tz).toBe('America/Chicago');
  });
  it('a throwing read keeps the last good value', async () => {
    let n = 0;
    gs._setLoader(async () => { if (n++ === 0) return [{ settings: { v: 1, schedule: { tz: 'America/Chicago', days: [2], start: '19:00', end: '22:00' } } }]; throw new Error('boom'); });
    await gs.refreshSchedule();
    expect(gs.getSchedule().tz).toBe('America/Chicago');
    const lg = console.log; console.log = () => {};
    try { await gs.refreshSchedule(); } finally { console.log = lg; }
    expect(gs.getSchedule().tz).toBe('America/Chicago');
  });
});
