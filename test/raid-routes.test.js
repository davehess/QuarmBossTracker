// test/raid-routes.test.js: the maths behind /raid/routes (web/lib/raidRoutes.ts) and its two gates.
//
// The picture is only as honest as these rules, and a wrong one still draws a plausible gold line, so each is
// pinned on a small night built by hand:
//   • the clock starts at FIRST ENGAGE (any mob, trash included), not at zone-in;
//   • legs are cut at the named kills, and a night that skipped or reordered a stop contributes nothing to a leg
//     it did not walk;
//   • a leg is resampled by DISTANCE, so a night that stood still for ten minutes lines up with one that did not;
//   • median and best come from the nights that HAVE the leg;
//   • pre-clear: trash killed and minutes in the zone before the first named, and the "cleared earlier" flag;
//   • clearing: the trash between two named kills, placed at the spawn point nearest the raid centre, counted
//     per night so "cleared on 3 of 3 nights" means every night.
//
// Run: npx vitest run test/raid-routes.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  median, centroidSeries, centreAt, legTrack, resampleByDistance, pathLength, analyzeNight, canonicalStops, nightLegs,
  nearestSpawn, averageRoute, routeBasis, nightPath, fmtSecs, PRECLEAR_MS, LEG_POINTS, NIGHT_PATH_POINTS,
} from '../web/lib/raidRoutes.ts';

const S = 1000;
const T0 = Date.UTC(2026, 9, 18, 1, 0, 0);
const at = (sec) => T0 + sec * S;

// A frame of `n` raiders standing at (x, y) in `zone`, plus optional extra raiders somewhere else.
const frame = (sec, x, y, n = 10, zone = 'z', extra = []) => ({
  t: at(sec),
  raiders: [
    ...Array.from({ length: n }, (_, i) => ({ i, name: `r${i}`, cls: null, group: null, level: 60, x: x + (i % 3) - 1, y: y + (i % 2), z: 0, h: null, hp: null, zone })),
    ...extra,
  ],
});

// A straight walk along +x at 10 units a second, a frame every 3 seconds.
const walk = (fromSec, toSec, x0 = 0, y = 0, speed = 10) => {
  const out = [];
  for (let s = fromSec; s <= toSec; s += 3) out.push(frame(s, x0 + (s - fromSec) * speed, y));
  return out;
};

const enc = (id, npc, name, startSec, endSec) => ({ id, npc_id: npc, name, started: at(startSec), ended: endSec == null ? null : at(endSec) });
const NAMED = new Set([100, 200]);

describe('centroid path', () => {
  it('is the median of the raiders in the zone, and ignores the ones placed elsewhere', () => {
    const f = frame(0, 500, 500, 10, 'z', [
      { i: 90, name: 'far', x: -9000, y: -9000, zone: 'other' },
      { i: 91, name: 'far2', x: -9000, y: -9000, zone: 'other' },
    ]);
    const [p] = centroidSeries([f], 'z');
    expect(p.x).toBeGreaterThan(498); expect(p.x).toBeLessThan(502);
    expect(p.n).toBe(10);
  });

  it('drops a frame with fewer than 8 raiders in the zone', () => {
    expect(centroidSeries([frame(0, 500, 500, 7), frame(3, 500, 500, 8)], 'z')).toHaveLength(1);
  });

  it('drops stale coordinates from the previous zone when the walls box is known', () => {
    const f = frame(0, 500, 500, 14);
    f.raiders.slice(0, 4).forEach(r => { r.x = 90000; r.y = 90000; });   // the old zone's coordinates
    const box = { minX: 0, maxX: 1000, minY: 0, maxY: 1000 };
    const [p] = centroidSeries([f], 'z', box);
    expect(p.n).toBe(10);
    expect(p.x).toBeLessThan(600);
  });
});

describe('tracks and resampling', () => {
  const series = centroidSeries(walk(0, 60), 'z');

  it('centreAt interpolates between samples and is null outside the track', () => {
    expect(centreAt(series, at(30)).x).toBeCloseTo(300, -1);
    expect(centreAt(series, at(-60))).toBeNull();
    expect(centreAt(series, at(600))).toBeNull();
  });

  it('legTrack has the interpolated ends and what is between, and refuses a hole', () => {
    const pts = legTrack(series, at(10), at(50));
    expect(pts[0].x).toBeCloseTo(100, -1);
    expect(pts[pts.length - 1].x).toBeCloseTo(500, -1);
    const holey = centroidSeries([...walk(0, 20), ...walk(300, 320)], 'z');
    expect(legTrack(holey, at(5), at(315))).toBeNull();
  });

  it('resamples by distance: a long stand-still does not change the shape', () => {
    const quick = [{ x: 0, y: 0 }, { x: 1000, y: 0 }];
    const lingering = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 0 }, { x: 1000, y: 0 }];
    const a = resampleByDistance(quick, 11);
    const b = resampleByDistance(lingering, 11);
    expect(a).toHaveLength(11);
    a.forEach((p, i) => expect(b[i].x).toBeCloseTo(p.x, 6));
    expect(pathLength(a)).toBeCloseTo(1000, 6);
  });

  it('a path with no length comes back as copies of its point', () => {
    const r = resampleByDistance([{ x: 7, y: 8 }, { x: 7, y: 8 }], 5);
    expect(r).toHaveLength(5);
    expect(new Set(r.map(p => `${p.x},${p.y}`))).toEqual(new Set(['7,8']));
  });

  it('median and the even-count case', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('first engage and pre-clear', () => {
  // zone-in at 0 s; trash pulls from 120 s; first named engaged at 900 s, dead at 960 s.
  const series = centroidSeries(walk(0, 1200), 'z');
  const encs = [
    enc(1, 5, 'a_guard', 120, 140),
    enc(2, 6, 'a_sentry', 200, 230),
    enc(3, 5, 'a_guard', 400, 420),
    enc(4, 100, 'Boss_One', 900, 960),
    enc(5, 7, 'a_late_one', 1000, 1020),
  ];
  const n = analyzeNight('k', { from: at(0), to: at(1300) }, series, encs, NAMED);

  it('starts the clock at the first encounter of ANY mob, not at zone-in', () => {
    expect(n.zoneIn).toBe(at(0));
    expect(n.firstEngage).toBe(at(120));
  });

  it('counts the trash killed and the minutes in the zone before the first named', () => {
    expect(n.preTrash).toBe(3);
    expect(n.preMinutes).toBeCloseTo(15, 6);
    expect(n.engageToNamedS).toBe(840);   // 120 s -> 960 s
    expect(n.flags).toEqual([]);
  });

  it('flags a night whose first named died within a few minutes of first engage as cleared earlier', () => {
    const cleared = analyzeNight('c', { from: at(0), to: at(1300) }, series, [enc(1, 5, 'a_guard', 600, 610), enc(2, 100, 'Boss_One', 700, 700 + PRECLEAR_MS / S - 100)], NAMED);
    expect(cleared.flags).toContain('precleared');
    const later = analyzeNight('d', { from: at(0), to: at(1300) }, series, [enc(1, 5, 'a_guard', 300, 310), enc(2, 100, 'Boss_One', 700, 760)], NAMED);
    expect(later.flags).not.toContain('precleared');
  });

  it('flags a night with no named kill, and ignores an unconfirmed named engagement', () => {
    const none = analyzeNight('n', { from: at(0), to: at(1300) }, series, [enc(1, 5, 'a_guard', 100, 110), enc(2, 100, 'Boss_One', 500, null)], NAMED);
    expect(none.flags).toContain('no-named');
    expect(none.named).toHaveLength(0);
    expect(none.firstEngage).toBe(at(100));
  });

  it('keeps the first kill of a boss killed twice, and ignores encounters outside the visit', () => {
    const two = analyzeNight('t', { from: at(0), to: at(1300) }, series, [enc(1, 100, 'Boss_One', 500, 560), enc(2, 100, 'Boss_One', 700, 760), enc(3, 5, 'x', 5000, 5010)], NAMED);
    expect(two.named).toHaveLength(1);
    expect(two.named[0].start).toBe(at(500));
    expect(two.trash).toHaveLength(0);
  });
});

// Three nights through the same two stops, along +x then +y. Night B stands still for ten minutes before the second boss.
function night(key, { engage, b1, b2, trash = [], idle = 0, yShift = 0 }) {
  const frames = [];
  for (let s = 0; s <= b2 + 30; s += 3) {
    let x, y;
    if (s <= b1) { x = (s / b1) * 1000; y = yShift; }
    else if (s <= b1 + idle) { x = 1000; y = yShift; }
    else { const f = Math.min(1, (s - b1 - idle) / (b2 - b1 - idle)); x = 1000; y = yShift + f * 1000; }
    frames.push(frame(s, x, y));
  }
  const encs = [
    enc(1, 1, 'a_scout', engage, engage + 5),
    ...trash.map(([sec, npc, name], i) => enc(10 + i, npc, name, sec, sec + 8)),
    enc(90, 100, 'Boss_One', b1, b1 + 30),
    enc(91, 200, 'Boss_Two', b2, b2 + 30),
  ];
  return analyzeNight(key, { from: at(0), to: at(b2 + 100) }, centroidSeries(frames, 'z'), encs, NAMED);
}

describe('stops, legs and the average', () => {
  const A = night('A', { engage: 60, b1: 400, b2: 900, trash: [[500, 20, 'a_guard'], [520, 20, 'a_guard'], [600, 21, 'a_sentry']] });
  const B = night('B', { engage: 100, b1: 500, b2: 1300, idle: 600, yShift: 30, trash: [[700, 20, 'a_guard'], [800, 21, 'a_sentry'], [850, 21, 'a_sentry']] });
  const C = night('C', { engage: 20, b1: 300, b2: 800, yShift: -30, trash: [[400, 20, 'a_guard'], [450, 21, 'a_sentry']] });

  it('stops are the named kills most nights share, ordered by clock after first engage', () => {
    const stops = canonicalStops([A, B, C]);
    expect(stops.map(s => s.npc_id)).toEqual([100, 200]);
    expect(stops[0].medianClockS).toBe(340);   // 340, 400, 280 -> 340
    const rare = night('R', { engage: 0, b1: 300, b2: 800 });
    rare.named.push({ npc_id: 100, name: 'Boss_Three', start: at(1), end: at(2) });
    expect(canonicalStops([A, B, C, rare, rare]).map(s => s.npc_id)).toContain(100);
  });

  it('cuts the legs at the kills: leg 0 from first engage, leg 1 from the first boss', () => {
    const legs = nightLegs(A, canonicalStops([A, B, C]));
    expect(legs[0].secs).toBe(340);     // 60 -> 400
    expect(legs[1].secs).toBe(500);     // 400 -> 900
    expect(legs[0].track).toHaveLength(LEG_POINTS);
  });

  it('a night that killed the stops in the other order, or skipped one, has no leg it did not walk', () => {
    const stops = canonicalStops([A, B, C]);
    const swapped = night('S', { engage: 0, b1: 800, b2: 300 });   // Boss_Two first
    const l = nightLegs(swapped, stops);
    expect(l[0]).toBeNull();
    expect(l[1]).toBeNull();
    const skipped = night('K', { engage: 0, b1: 300, b2: 800 });
    skipped.named = skipped.named.filter(k => k.npc_id === 200);
    const l2 = nightLegs(skipped, stops);
    expect(l2[0]).toBeNull();
    expect(l2[1]).toBeNull();
  });

  it('median, best and night count per leg', () => {
    const r = averageRoute([A, B, C], new Map());
    expect(r.stops.map(s => s.n)).toEqual([1, 2]);
    // leg 0: 340, 400, 280
    expect(r.legs[0].medianS).toBe(340);
    expect(r.legs[0].bestS).toBe(280);
    expect(r.legs[0].nights).toBe(3);
    // leg 1: 500, 800, 500
    expect(r.legs[1].medianS).toBe(500);
    expect(r.legs[1].bestS).toBe(500);
  });

  it('averages by distance: the idle night lies on the same route, and the band is the across-night spread', () => {
    const r = averageRoute([A, B, C], new Map());
    const leg1 = r.legs[1];
    expect(leg1.pts).toHaveLength(LEG_POINTS);
    // halfway along leg 1 every night is half way up +y (x = 1000), the average y is the mean of the shifts (0)
    const mid = leg1.pts[Math.round((LEG_POINTS - 1) / 2)];
    expect(mid[0]).toBeGreaterThan(990); expect(mid[0]).toBeLessThan(1010);
    expect(Math.abs(mid[1] - 500)).toBeLessThan(40);
    expect(Math.max(...leg1.band)).toBeGreaterThan(15);     // the +-30 shifts show as spread
    const one = averageRoute([A], new Map());
    expect(Math.max(...one.legs[0].band)).toBe(0);           // one night has no spread
  });

  it('a stop sits at the boss spawn point when it has one, else where the raid stood', () => {
    const r = averageRoute([A, B, C], new Map([[200, [{ id: 'p', x: 1000, y: 1010 }]]]));
    expect(r.stops[1].at).toBe('spawn');
    expect([r.stops[1].x, r.stops[1].y]).toEqual([1000, 1010]);
    expect(r.stops[0].at).toBe('raid');
    expect(Math.abs(r.stops[0].x - 1000)).toBeLessThan(20);
  });

  it('with the nights unticked, the average follows the ticked ones only', () => {
    expect(averageRoute([A, C], new Map()).legs[0].nights).toBe(2);
    expect(averageRoute([], new Map()).stops).toEqual([]);
  });
});

// A zone with one real raid draws its route (2026-10-22: Torment, one raid and two visits that killed nothing named,
// said "no named kill in common"). `later` shifts the night's clock so "most recent" is decidable.
describe('one night, and nights that share nothing', () => {
  const OTHER = new Set([300, 400]);
  const walkNight = (key, { named, ids = NAMED, later = 0 }) => {
    const [b1, b2] = [300, 800];
    const frames = [];
    for (let s = 0; s <= b2 + 30; s += 3) {
      const f = s <= b1 ? s / b1 : 1;
      const g = s <= b1 ? 0 : Math.min(1, (s - b1) / (b2 - b1));
      frames.push(frame(s + later, f * 1000, g * 1000));
    }
    const encs = [enc(1, 1, 'a_scout', 60 + later, 65 + later), ...named.map(([npc, name, sec], i) => enc(90 + i, npc, name, sec + later, sec + later + 30))];
    return analyzeNight(key, { from: at(later), to: at(b2 + 100 + later) }, centroidSeries(frames, 'z'), encs, ids);
  };
  const quiet = (key, later = 5000) => {
    const frames = walk(0, 400).map(f => ({ ...f, t: f.t + later * S }));
    return analyzeNight(key, { from: at(later), to: at(later + 500) }, centroidSeries(frames, 'z'), [enc(1, 1, 'a_scout', later + 10, later + 20)], NAMED);
  };

  it('a single ticked night draws its route: every boss it killed is a stop, in kill order, with legs and tracks', () => {
    const one = walkNight('A', { named: [[100, 'Boss_One', 300], [200, 'Boss_Two', 800]] });
    const r = averageRoute([one], new Map());
    expect(r.fallback).toBeNull();
    expect(r.stops.map(s => s.npc_id)).toEqual([100, 200]);
    expect(r.legs).toHaveLength(2);
    expect(r.legs[0].pts).toHaveLength(LEG_POINTS);
    expect(r.legs[1].nights).toBe(1);
  });

  it('nights that killed nothing named do not vote: one real night plus two empty visits is still that night\'s route', () => {
    const one = walkNight('A', { named: [[100, 'Boss_One', 300], [200, 'Boss_Two', 800]] });
    expect(quiet('Q1').named).toHaveLength(0);
    const r = averageRoute([quiet('Q1'), one, quiet('Q2', 9000)], new Map());
    expect(r.fallback).toBeNull();
    expect(r.stops.map(s => s.npc_id)).toEqual([100, 200]);
    expect(r.legs[0].pts.length).toBeGreaterThan(0);
    expect(canonicalStops([quiet('Q1'), one, quiet('Q2', 9000)]).map(s => s.npc_id)).toEqual([100, 200]);
  });

  it('two nights with no named kill in common fall back to the most recent one, and say so', () => {
    const early = walkNight('E', { named: [[100, 'Boss_One', 300], [200, 'Boss_Two', 800]] });
    const late = walkNight('L', { named: [[300, 'Boss_Three', 300], [400, 'Boss_Four', 800]], ids: OTHER, later: 4000 });
    expect(canonicalStops([early, late])).toEqual([]);
    const r = averageRoute([early, late], new Map());
    expect(r.fallback).toEqual({ nightKey: 'L', of: 2 });
    expect(r.stops.map(s => s.npc_id)).toEqual([300, 400]);
    expect(r.legs[0].pts.length).toBeGreaterThan(0);
    expect(routeBasis([late, early]).used.map(n => n.key)).toEqual(['L']);   // the order they are ticked in does not matter
    expect(routeBasis([late, early]).stops.map(s => s.npc_id)).toEqual([300, 400]);
  });

  it('two nights that share a boss still average over the shared one only', () => {
    const a = walkNight('A', { named: [[100, 'Boss_One', 300], [200, 'Boss_Two', 800]] });
    const b = walkNight('B', { named: [[100, 'Boss_One', 300]], later: 4000 });
    const r = averageRoute([a, b], new Map());
    expect(r.fallback).toBeNull();
    expect(r.stops.map(s => s.npc_id)).toEqual([100]);
    expect(r.legs[0].nights).toBe(2);
  });

  it('no ticked night with a named kill: no stops and no fallback', () => {
    const r = averageRoute([quiet('Q1'), quiet('Q2', 9000)], new Map());
    expect(r.stops).toEqual([]);
    expect(r.fallback).toBeNull();
  });

  it('the Tactics-like case (three nights walking the same bosses) is unchanged: averaged, no fallback', () => {
    const A = night('A', { engage: 60, b1: 400, b2: 900 });
    const B = night('B', { engage: 100, b1: 500, b2: 1300, idle: 600, yShift: 30 });
    const C = night('C', { engage: 20, b1: 300, b2: 800, yShift: -30 });
    const r = averageRoute([A, B, C], new Map());
    expect(r.fallback).toBeNull();
    expect(r.stops.map(s => s.npc_id)).toEqual([100, 200]);
    expect(r.legs[0].nights).toBe(3);
    expect(r.legs[0].medianS).toBe(340);
  });
});

describe('clearing', () => {
  const A = night('A', { engage: 60, b1: 400, b2: 900, trash: [[100, 20, 'a_guard'], [500, 20, 'a_guard'], [520, 21, 'a_sentry'], [600, 21, 'a_sentry']] });
  const B = night('B', { engage: 100, b1: 500, b2: 1000, trash: [[200, 20, 'a_guard'], [700, 20, 'a_guard']] });
  const C = night('C', { engage: 20, b1: 300, b2: 800, trash: [[400, 21, 'a_sentry']] });
  const spawns = new Map([
    [20, [{ id: 'near', x: 1000, y: 300 }, { id: 'far', x: -5000, y: 5000 }]],
    [21, [{ id: 'only', x: 1000, y: 700 }]],
    [1, [{ id: 'door', x: 0, y: 0 }]],
  ]);
  const r = averageRoute([A, B, C], spawns);

  it('counts the trash killed between the two named kills, per night', () => {
    // leg 1 (boss one -> boss two): A has 3 (500, 520, 600), B has 1 (700), C has 1 (400)
    expect(r.legs[1].clear.medianKills).toBe(1);
    // leg 0 (first engage -> boss one): every night's first-engage scout, plus A 1 (100), B 1 (200)
    expect(r.legs[0].clear.medianKills).toBe(2);
  });

  it('clearing time is the first trash pull to the last trash death in the leg, and "other" is the rest', () => {
    // night A leg 1: pulls at 500..., last dies at 608 -> 108 s; B: 700 -> 708 = 8 s; C: 400 -> 408 = 8 s
    expect(r.legs[1].clear.medianClearS).toBe(8);
    expect(r.legs[1].clear.medianOtherS).toBe(492);      // 500 - 8 (nights A and C: 500-108=392, 500-8=492, 500-8=492)
  });

  it('names the trash with a per-night count', () => {
    const top = r.legs[1].clear.top;
    const guard = top.find(t => t.name === 'a_guard');
    const sentry = top.find(t => t.name === 'a_sentry');
    expect(guard.perNight).toBeCloseTo(2 / 3, 6);    // A 1, B 1, C 0 over 3 nights
    expect(sentry.perNight).toBeCloseTo(3 / 3, 6);   // A 2, B 0, C 1
    expect(top[0].name).toBe('a_sentry');            // the most-killed first
  });

  it('places each kill at the spawn point of its npc nearest the raid centre, and counts nights per point', () => {
    const near = r.clears.filter(c => c.name === 'a_guard');
    expect(near.every(c => c.x === 1000 && c.y === 300)).toBe(true);    // never the far point
    const sentryLeg1 = r.clears.find(c => c.name === 'a_sentry' && c.leg === 1);
    expect(sentryLeg1.nights).toBe(2);                                  // A and C; B never killed one in this leg
    expect(sentryLeg1.kills).toBe(3);
    const scout = r.clears.find(c => c.name === 'a_scout');
    expect([scout.nights, scout.of, scout.leg]).toEqual([3, 3, 0]);     // cleared on 3 of 3 nights: always
    const guardLeg1 = r.clears.find(c => c.name === 'a_guard' && c.leg === 1);
    expect(guardLeg1.nights).toBe(2);
    expect(guardLeg1.of).toBe(3);
  });

  it('a kill whose npc has no spawn point is counted but not drawn', () => {
    const none = averageRoute([A, B, C], new Map());
    expect(none.clears).toEqual([]);
    expect(none.legs[1].clear.medianKills).toBe(1);
  });

  it('nearestSpawn: the nearest to the centre, the only one regardless, null with none', () => {
    const pts = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 100, y: 0 }];
    expect(nearestSpawn(pts, { x: 90, y: 0 }).id).toBe('b');
    expect(nearestSpawn(pts, { x: 10, y: 0 }).id).toBe('a');
    expect(nearestSpawn([pts[1]], { x: -999, y: 0 }).id).toBe('b');
    expect(nearestSpawn(undefined, null)).toBeNull();
    expect(nearestSpawn(pts, null).id).toBe('a');
  });
});

describe('what goes to the browser', () => {
  it('a night path is capped and starts at first engage', () => {
    const long = night('L', { engage: 60, b1: 4000, b2: 9000 });
    const p = nightPath(long, canonicalStops([long]));
    expect(p.length).toBeLessThanOrEqual(NIGHT_PATH_POINTS);
    expect(p.length).toBeGreaterThan(10);
    expect(p[0][0]).toBeLessThan(30);     // 60 s of a 4000 s walk to x = 1000
  });
  it('no first engage, no path', () => {
    expect(nightPath(analyzeNight('e', { from: at(0), to: at(10) }, [], [], NAMED), [])).toEqual([]);
  });
  it('fmtSecs', () => {
    expect(fmtSecs(580)).toBe('9m 40s');
    expect(fmtSecs(3840)).toBe('1h 04m');
    expect(fmtSecs(null)).toBe('-');
  });
});

describe('the gates', () => {
  const read = (rel) => stripJs(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

  it('the API route answers 401 before it reads anything', () => {
    const src = read('web/app/api/raid/routes/route.ts');
    expect(src.indexOf('auth.getUser()')).toBeGreaterThan(-1);
    expect(src.indexOf('auth.getUser()')).toBeLessThan(src.indexOf('listZones('));
    expect(src.indexOf('auth.getUser()')).toBeLessThan(src.indexOf('zoneRoutes('));
    expect(src).toMatch(/fail\(401/);
  });

  it('the save is officer-only, recomputed on the server, and written to bot_kv under raid_route:<zone>', () => {
    const src = read('web/app/raid/routes/actions.ts');
    expect(src).toMatch(/^'use server';/m);
    expect(src.indexOf('isOfficer(')).toBeGreaterThan(-1);
    expect(src.indexOf('isOfficer(')).toBeLessThan(src.indexOf("from('bot_kv')"));
    expect(src.indexOf('zoneRoutes(')).toBeLessThan(src.indexOf("from('bot_kv')"));
    expect(src).toMatch(/`raid_route:\$\{zone\}`/);
    expect(src).toMatch(/onConflict: 'guild_id,key'/);
  });

  it('the answer type carries paths and figures, never frames or raiders', () => {
    const src = read('web/lib/raidRoutesLoad.ts');
    const block = src.slice(src.indexOf('export type NightOut'), src.indexOf('export async function zoneRoutes'));
    expect(block.length).toBeGreaterThan(200);
    expect(block).not.toMatch(/series|frames|who\b|raiders|CPoint/);
  });
});
