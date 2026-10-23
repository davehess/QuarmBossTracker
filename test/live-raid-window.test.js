// test/live-raid-window.test.js — the live Spectator timeline starts at the CURRENT raid (?v=newraid;
// web/lib/liveRaidWindow.ts, web/lib/liveRaidLoad.ts).
//
//   1. WINDOW   chooseLiveStart: two raids back to back -> the second only; one raid with a lull -> everything; three
//               groups -> the latest hand-over; a manual cut wins; an expired / future / too-old cut is ignored.
//   2. ZONE     the weaker rule: a new zone + a 20-minute kill-free spell + a different crew cuts; the same crew moving
//               on, a short spell, or too little roster to judge does not.
//   3. EARLIER  the review window for the stretch before the start.
//   4. SOURCE   the preview gate (no ?v= = the old six-hour answer), the officer-only POST, bounded reads.
//
// Names are invented tokens (a roster is only identities here). Run: npx vitest run test/live-raid-window.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { MINUTE_MS } from '../web/lib/raidReplay.ts';
import {
  CUT_TTL_MS, LOOKBACK_MS, chooseLiveStart, crewShared, cutKey, earlierWindow, manualStart, parseCut, rosterStart, zoneStart,
} from '../web/lib/liveRaidWindow.ts';

const read = (...p) => stripJs(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));

const T0 = Date.parse('2026-10-22T23:02:00Z');
const at = (min) => T0 + min * MINUTE_MS;

/** A deterministic 0..1 (no Math.random: a test that flakes proves nothing). */
const rnd = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const crew = (tag, n) => Array.from({ length: n }, (_, i) => `${tag}${i}`);
const minutes = (from, count, members, p = 0.9) => Array.from({ length: count }, (_, i) => ({
  t: at(from + i), who: members.filter((m, j) => rnd(from + i, j + m.length) < p),
}));
const zoneRows = (from, count, zone) => Array.from({ length: count }, (_, i) => ({ t: at(from + i), zones: [zone] }));
const input = (over) => ({ nowMs: at(200), cutMs: null, who: [], zones: [], killTimes: [], ...over });

describe('chooseLiveStart: the roster', () => {
  it('two raids back to back -> the timeline starts at the second', () => {
    const who = [...minutes(0, 120, crew('alder', 30)), ...minutes(120, 75, crew('birch', 18))];
    const r = chooseLiveStart(input({ who }));
    expect(r.why).toBe('roster');
    expect(Math.abs(r.startMs - at(120))).toBeLessThanOrEqual(2 * MINUTE_MS);
  });

  it('three groups in a night -> the latest hand-over', () => {
    const who = [...minutes(0, 80, crew('alder', 30)), ...minutes(80, 80, crew('birch', 20)), ...minutes(160, 40, crew('cedar', 18))];
    const r = chooseLiveStart(input({ who, nowMs: at(205) }));
    expect(r.why).toBe('roster');
    expect(Math.abs(r.startMs - at(160))).toBeLessThanOrEqual(2 * MINUTE_MS);
  });

  it('one raid with a long lull between kills -> nothing is hidden', () => {
    const who = minutes(0, 195, crew('alder', 30));
    expect(chooseLiveStart(input({ who, killTimes: [at(10), at(150)] }))).toBeNull();
    expect(rosterStart(who)).toBeNull();
  });

  it('a raid thinning out at the end, or a late group joining it, is one raid', () => {
    const a = crew('alder', 40);
    expect(chooseLiveStart(input({ who: [...minutes(0, 150, a), ...minutes(150, 40, a.slice(0, 8))] }))).toBeNull();
    expect(chooseLiveStart(input({ who: [...minutes(0, 120, a), ...minutes(120, 40, [...a, ...crew('birch', 8)])] }))).toBeNull();
  });

  it('too little recorded roster says nothing', () => {
    expect(chooseLiveStart(input({ who: [] }))).toBeNull();
    expect(chooseLiveStart(input({ who: [...minutes(0, 15, crew('alder', 30)), ...minutes(15, 15, crew('birch', 18))] }))).toBeNull();
  });

  it('a hand-over older than the six-hour window is outside it', () => {
    const who = [...minutes(0, 120, crew('alder', 30)), ...minutes(120, 75, crew('birch', 18))];
    expect(chooseLiveStart(input({ who, nowMs: at(120) + LOOKBACK_MS + 30 * MINUTE_MS }))).toBeNull();
  });
});

describe('chooseLiveStart: a manual cut', () => {
  const who = [...minutes(0, 120, crew('alder', 30)), ...minutes(120, 75, crew('birch', 18))];

  it('wins over what the roster says', () => {
    const r = chooseLiveStart(input({ who, cutMs: at(170) }));
    expect(r).toEqual({ startMs: at(170), why: 'manual' });
  });

  it('is ignored once 12 hours old (and a cut that old is always older than the window too)', () => {
    // with a floor far back, the 12 h rule alone decides
    expect(manualStart(at(0), at(0) + CUT_TTL_MS, at(0) - MINUTE_MS)).toBeNull();
    expect(manualStart(at(0), at(0) + CUT_TTL_MS - MINUTE_MS, at(0) - MINUTE_MS)).toBe(at(0));
    const r = chooseLiveStart(input({ who, cutMs: at(200) - CUT_TTL_MS - 60_000 }));
    expect(r.why).toBe('roster');
  });

  it('is ignored when it lies in the future, and when it is older than the six-hour window', () => {
    expect(manualStart(at(200) + 10 * MINUTE_MS, at(200), at(200) - LOOKBACK_MS)).toBeNull();
    expect(manualStart(at(200) - LOOKBACK_MS - MINUTE_MS, at(200), at(200) - LOOKBACK_MS)).toBeNull();
    expect(manualStart(at(190), at(200), at(200) - LOOKBACK_MS)).toBe(at(190));
  });

  it('is read from the stored value and from nothing else', () => {
    expect(parseCut({ v: 1, at: '2026-10-23T04:00:00.000Z' })).toBe(Date.parse('2026-10-23T04:00:00.000Z'));
    for (const bad of [null, undefined, {}, { at: 5 }, { at: 'tomorrow' }, 'x', []]) expect(parseCut(bad)).toBeNull();
    expect(cutKey('wolfpack')).toBe('live_raid_cut:wolfpack');
  });
});

describe('the zone rule', () => {
  const a = crew('alder', 30);
  const halfNew = [...a.slice(0, 12), ...crew('birch', 12)];
  const base = (secondCrew, kills) => {
    const who = [...minutes(0, 121, a, 1), ...minutes(130, 70, secondCrew, 1)];
    const zones = [...zoneRows(0, 121, 'zonea'), ...zoneRows(130, 70, 'zoneb')];
    return { who, zones, killTimes: kills };
  };

  it('a new zone after a 20-minute kill-free spell with a different crew starts a new raid', () => {
    const { who, zones, killTimes } = base(halfNew, [at(60), at(115), at(160)]);
    expect(zoneStart(zones, who, killTimes, at(200))).toBe(at(130));
    expect(chooseLiveStart(input({ who, zones, killTimes }))).toEqual({ startMs: at(130), why: 'zone' });
  });

  it('the same crew walking on to the next zone is one raid', () => {
    const { who, zones, killTimes } = base(a, [at(60), at(115), at(160)]);
    expect(zoneStart(zones, who, killTimes, at(200))).toBeNull();
  });

  it('a kill soon after the move (a gap under 20 minutes) is one raid', () => {
    const { who, zones, killTimes } = base(halfNew, [at(60), at(115), at(132)]);
    expect(zoneStart(zones, who, killTimes, at(200))).toBeNull();
  });

  it('with no kill yet in the new zone, the quiet spell runs to now', () => {
    const { who, zones, killTimes } = base(halfNew, [at(60), at(115)]);
    expect(zoneStart(zones, who, killTimes, at(200))).toBe(at(130));
    expect(zoneStart(zones, who, killTimes, at(125))).toBeNull();
  });

  it('too little roster to compare the crews means no cut; so does a stay of under 10 minutes', () => {
    const { zones, killTimes } = base(halfNew, [at(60), at(115), at(160)]);
    expect(zoneStart(zones, [], killTimes, at(200))).toBeNull();
    expect(crewShared([], at(130))).toBeNull();
    const brief = [...zoneRows(0, 121, 'zonea'), ...zoneRows(130, 6, 'zoneb'), ...zoneRows(136, 60, 'zonea')];
    expect(zoneStart(brief, base(halfNew, []).who, [at(60), at(115), at(160)], at(200))).toBeNull();
  });

  it('nothing earlier to hide is no cut', () => {
    const { who, zones } = base(halfNew, []);
    expect(zoneStart(zones, who, [at(160)], at(200))).toBeNull();
  });
});

describe('earlierWindow', () => {
  it('is the recorded stretch just before the start', () => {
    const times = [...Array.from({ length: 30 }, (_, i) => at(i)), ...Array.from({ length: 60 }, (_, i) => at(100 + i))];
    expect(earlierWindow(times, at(150))).toEqual({ fromMs: at(100), toMs: at(150) });
  });
  it('walks back across a short break but not a long one', () => {
    const times = [...Array.from({ length: 30 }, (_, i) => at(i)), ...Array.from({ length: 30 }, (_, i) => at(45 + i))];
    expect(earlierWindow(times, at(80))).toEqual({ fromMs: at(0), toMs: at(80) });
    const longBreak = [...Array.from({ length: 30 }, (_, i) => at(i)), ...Array.from({ length: 30 }, (_, i) => at(60 + i))];
    expect(earlierWindow(longBreak, at(95))).toEqual({ fromMs: at(60), toMs: at(95) });
  });
  it('is null with nothing before it, or under two minutes of it', () => {
    expect(earlierWindow([at(10), at(11)], at(5))).toBeNull();
    expect(earlierWindow([at(10)], at(11))).toBeNull();
  });
});

describe('source', () => {
  const route = read('web/app/api/spectator/timeline/route.ts');
  const post = read('web/app/api/spectator/newraid/route.ts');
  const load = read('web/lib/liveRaidLoad.ts');
  const page = read('web/app/spectator/page.tsx');

  it('only ?v=newraid reaches the new window; the default answer is the old six hours', () => {
    expect(route).toMatch(/searchParams\.get\('v'\) === 'newraid'/);
    expect(route.indexOf("'newraid'")).toBeLessThan(route.indexOf('LOOKBACK_MS)'));
    expect(page).toMatch(/\) === 'newraid'/);
    expect(page).toMatch(/newRaid \? <RaidTimeline src="\/api\/spectator\/timeline\?v=newraid"/);
    expect(page).toMatch(/: <RaidTimeline \/>/);
  });

  it('the POST is signed-in, officer-only and JSON-only, and forgets the kept answer', () => {
    expect(post.indexOf('auth.getUser()')).toBeLessThan(post.indexOf('await isOfficer(user.id)'));
    expect(post.indexOf('await isOfficer(user.id)')).toBeGreaterThan(0);
    expect(post.indexOf('await isOfficer(user.id)')).toBeLessThan(post.indexOf('supabaseAdmin()', post.indexOf('export async function')));
    expect(post).toMatch(/403/);
    expect(post).toMatch(/application\/json/);
    expect(post).toMatch(/dropLiveMemo\(\)/);
    expect(post).not.toMatch(/user\.(id|email)\b.*(value|upsert)/);
  });

  it('the page asks isOfficer only for the preview', () => {
    expect(page).toMatch(/newRaid && await isOfficer\(user\.id\)/);
  });

  it('every read is windowed, ordered and paged; the roster is skipped under a manual cut', () => {
    expect(load).toMatch(/\.gte\('minute_at', floorIso\)/);
    expect((load.match(/\.range\(from, to\)/g) || []).length).toBe(1);
    expect(load).toMatch(/!manual && minuteTimes\.length >= 2 \* MIN_SIDE_MINUTES\) \{\s*try \{ who = await readWhoMinutes/);
    expect(load).toMatch(/\.select\('minute_at, zones'\)/);
  });
});
