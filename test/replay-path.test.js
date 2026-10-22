// test/replay-path.test.js: the raid's path on the spectator replay and the shared raid (web/lib/replayPath.ts).
//
// The raid's path is always on (the guild lead's pick, 2026-10-22: the whole night's path, solid up to the playhead,
// numbered kills; the fading-trail alternative was dropped). It draws from these pure rules, so a wrong one draws a
// plausible blue line that is not where the raid went:
//   • the centre is the SAME maths as the route pages (lib/raidRoutes.ts centroidSeries), with the median z kept;
//   • the path is kept window by window and a window asked for again replaces itself;
//   • a hole in the recording or a jump is a break, never a bridge;
//   • the solid part is exactly the segments the playhead has passed;
//   • kill markers are numbered in the order the bosses died and sit where the raid centre was at that moment.
//
// Run: npx vitest run test/replay-path.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { centroidSeries } from '../web/lib/raidRoutes.ts';
import {
  PATH_MIN_RAIDERS, PATH_BREAK_MS, PATH_HOP,
  pathSeries, pathSeriesByZone, PathStore, linked, buildSegments, segmentsDone,
  headAt, rankKills, killMarks,
} from '../web/lib/replayPath.ts';

const S = 1000;
const T0 = Date.UTC(2026, 9, 18, 1, 0, 0);
const at = (sec) => T0 + sec * S;

// A frame of `n` raiders around (x, y, z) in `zone`, plus optional extra raiders somewhere else.
const frame = (sec, x, y, n = 10, zone = 'z', extra = [], z = 5) => ({
  t: at(sec),
  raiders: [
    ...Array.from({ length: n }, (_, i) => ({ i, name: `r${i}`, cls: 'WAR', group: null, level: 60, x: x + (i % 3) - 1, y: y + (i % 2), z: z + (i % 3), h: null, hp: null, zone })),
    ...extra,
  ],
});
// A walk along +x at 10 units a second, a frame every 3 seconds.
const walk = (fromSec, toSec, x0 = 0, y = 0, speed = 10, n = 10, zone = 'z') => {
  const out = [];
  for (let s = fromSec; s <= toSec; s += 3) out.push(frame(s, x0 + (s - fromSec) * speed, y, n, zone));
  return out;
};

describe('the centre of the raid', () => {
  it('is centroidSeries\' x, y, time and count at the route pages\' floor of 8', () => {
    const frames = [...walk(0, 30), frame(33, 400, 0, 7), ...walk(36, 60, 400)];
    const mine = pathSeries(frames, 'z', 8);
    const theirs = centroidSeries(frames, 'z');
    expect(mine.length).toBe(theirs.length);
    expect(mine.length).toBeGreaterThan(15);
    mine.forEach((p, i) => {
      expect([p.t, p.x, p.y, p.n]).toEqual([theirs[i].t, theirs[i].x, theirs[i].y, theirs[i].n]);
    });
  });

  it('keeps the median z, so the 3D view needs no draping', () => {
    const [p] = pathSeries([frame(0, 100, 100, 9, 'z', [], 20)], 'z');
    expect(p.z).toBe(21);   // r0..r8 stand at 20, 21, 22: the median of nine is 21
  });

  it('needs 4 raiders in the zone by default, ignores the ones placed elsewhere and the unplaced (0, 0)', () => {
    expect(PATH_MIN_RAIDERS).toBe(4);
    const far = [{ i: 90, name: 'far', x: -9000, y: -9000, z: 0, zone: 'other' }, { i: 91, name: 'far2', x: -9000, y: -9000, z: 0, zone: 'other' }];
    expect(pathSeries([frame(0, 500, 500, 3, 'z', far)], 'z')).toHaveLength(0);
    const f = frame(3, 500, 500, 4, 'z', far);
    f.raiders.push({ i: 92, name: 'nowhere', x: 0, y: 0, z: 0, zone: 'z' });
    const [p] = pathSeries([f], 'z');
    expect(p.n).toBe(4);
    expect(p.x).toBeGreaterThan(498);
    expect(p.x).toBeLessThan(502);
  });

  it('gives every zone its own path in one pass', () => {
    const f = frame(0, 100, 100, 5, 'a', frame(0, -300, -300, 6, 'b').raiders);
    const by = pathSeriesByZone([f]);
    expect([...by.keys()].sort()).toEqual(['a', 'b']);
    expect(by.get('a')[0].n).toBe(5);
    expect(by.get('b')[0].n).toBe(6);
  });
});

describe('PathStore', () => {
  it('accumulates windows in time order and keeps the ones the playhead has left', () => {
    const s = new PathStore();
    s.addWindow(2, walk(1800, 1830));
    s.addWindow(0, walk(0, 30));
    const ser = s.seriesFor('z');
    expect(ser[0].t).toBe(at(0));
    expect(ser[ser.length - 1].t).toBe(at(1830));
    expect(ser.every((p, i) => i === 0 || p.t > ser[i - 1].t)).toBe(true);
    expect(s.size).toBe(2);
    expect(s.has(0) && s.has(2) && !s.has(1)).toBe(true);
  });

  it('replaces a window asked for again instead of doubling it (the live tail grows)', () => {
    const s = new PathStore();
    s.addWindow(0, walk(0, 30));
    const before = s.seriesFor('z').length;
    s.addWindow(0, walk(0, 60));
    expect(s.seriesFor('z').length).toBeGreaterThan(before);
    expect(s.seriesFor('z').length).toBe(walk(0, 60).length);
  });

  it('hands back the same array until something changes, and a new one after', () => {
    const s = new PathStore();
    s.addWindow(0, walk(0, 30));
    const a = s.seriesFor('z');
    expect(s.seriesFor('z')).toBe(a);
    s.addWindow(1, walk(900, 930));
    expect(s.seriesFor('z')).not.toBe(a);
  });

  it('keeps zones apart and answers an unseen zone with an empty path', () => {
    const s = new PathStore();
    s.addWindow(0, [...walk(0, 30, 0, 0, 10, 10, 'a'), ...walk(33, 60, 0, 0, 10, 10, 'b')]);
    expect(s.seriesFor('a').every(p => p.t <= at(30))).toBe(true);
    expect(s.seriesFor('b').every(p => p.t >= at(33))).toBe(true);
    expect(s.seriesFor('nowhere')).toEqual([]);
  });

  it('clear() empties it', () => {
    const s = new PathStore();
    s.addWindow(0, walk(0, 30));
    s.clear();
    expect(s.size).toBe(0);
    expect(s.seriesFor('z')).toEqual([]);
  });
});

describe('breaks', () => {
  const pt = (sec, x, y = 0) => ({ t: at(sec), x, y, z: 0, n: 10 });

  it('joins neighbours that are close in time and space, not across a hole or a jump', () => {
    const base = 3 + PATH_BREAK_MS / S + 1;   // a hole just over the break after the second sample
    const s = [pt(0, 0), pt(3, 30), pt(base, 60), pt(base + 3, 60 + PATH_HOP + 5), pt(base + 6, 60 + PATH_HOP + 30)];
    expect(linked(s, 0)).toBe(true);
    expect(linked(s, 1)).toBe(false);   // a hole longer than the break, no distance to speak of
    expect(linked(s, 2)).toBe(false);   // three seconds, but a jump over the hop
    expect(linked(s, 3)).toBe(true);    // three seconds and 25 units
    expect(linked(s, 4)).toBe(false);   // nothing after the last
  });

  it('builds segments only for joined pairs', () => {
    const s = [pt(0, 0), pt(3, 30), pt(300, 60), pt(303, 90)];
    const seg = buildSegments(s);
    expect(seg.count).toBe(2);
    expect(Array.from(seg.from)).toEqual([0, 2]);
    expect(Array.from(seg.end)).toEqual([at(3), at(303)]);
  });
});

describe('the solid part of the path (the playhead split)', () => {
  const series = pathSeries(walk(0, 90), 'z');   // 31 samples, 30 segments
  const seg = buildSegments(series);

  it('is nothing before the first segment finishes, all of it after the last', () => {
    expect(seg.count).toBe(30);
    expect(segmentsDone(seg, at(-10))).toBe(0);
    expect(segmentsDone(seg, at(2))).toBe(0);
    expect(segmentsDone(seg, at(90))).toBe(30);
    expect(segmentsDone(seg, at(9000))).toBe(30);
  });

  it('counts a segment the moment its end sample is reached', () => {
    expect(segmentsDone(seg, at(3))).toBe(1);
    expect(segmentsDone(seg, at(3) - 1)).toBe(0);
    expect(segmentsDone(seg, at(30))).toBe(10);
    expect(segmentsDone(seg, at(31))).toBe(10);
    expect(segmentsDone(seg, at(33))).toBe(11);
  });

  it('does not count a segment that was never drawn (a hole)', () => {
    const holey = pathSeries([...walk(0, 30), ...walk(600, 630, 400)], 'z');
    const hs = buildSegments(holey);
    expect(hs.count).toBe(holey.length - 2);   // two stretches: one segment fewer each
    expect(segmentsDone(hs, at(300))).toBe(10);
    expect(segmentsDone(hs, at(9000))).toBe(hs.count);
  });
});

describe('the head', () => {
  const series = pathSeries(walk(0, 30), 'z');

  it('sits between the two samples around the playhead', () => {
    const a = headAt(series, at(3)), b = headAt(series, at(6)), mid = headAt(series, at(4.5));
    expect(mid.x).toBeCloseTo((a.x + b.x) / 2, 5);
    expect(mid.t).toBe(at(4.5));
  });

  it('is null outside the path and in a long hole', () => {
    expect(headAt(series, at(-60))).toBeNull();
    expect(headAt(series, at(500))).toBeNull();
    const holey = pathSeries([...walk(0, 9), ...walk(900, 909)], 'z');
    expect(headAt(holey, at(450))).toBeNull();
    expect(headAt(holey, at(9))).not.toBeNull();
  });
});

describe('kill markers', () => {
  const series = pathSeries(walk(0, 600), 'z');   // x = 10 * seconds
  const kills = [
    { name: 'Second Boss', to: at(300), zones: ['z'] },
    { name: 'First Boss', to: at(120), zones: ['z'] },
    { name: 'Elsewhere Boss', to: at(200), zones: ['other'] },
    { name: 'No Path Boss', to: at(5000), zones: ['z'] },
  ];

  it('numbers the night\'s kills in the order they died', () => {
    const r = rankKills(kills);
    expect(r.map(k => [k.n, k.name])).toEqual([[1, 'First Boss'], [2, 'Elsewhere Boss'], [3, 'Second Boss'], [4, 'No Path Boss']]);
  });

  it('puts each marker where the raid centre was at the kill, with the night\'s number', () => {
    const marks = killMarks(kills, series, 'z', at(250));
    expect(marks.map(m => m.n)).toEqual([1, 3]);   // 2 died in another zone, 4 is off the path: their numbers stay taken
    expect(marks[0].x).toBeCloseTo(1200, 0);
    expect(marks[1].x).toBeCloseTo(3000, 0);
  });

  it('marks a kill done only once the playhead has passed it', () => {
    expect(killMarks(kills, series, 'z', at(250)).map(m => m.done)).toEqual([true, false]);
    expect(killMarks(kills, series, 'z', at(300)).map(m => m.done)).toEqual([true, true]);
  });

  it('keeps a boss with no known zone (a marker is better than none)', () => {
    const marks = killMarks([{ name: 'Nowhere Known', to: at(60) }], series, 'z', 0);
    expect(marks).toHaveLength(1);
  });
});

describe('the path is always on, with its toggle, and the trail is gone', () => {
  const board = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/spectator/replay/ReplayBoard.tsx'), 'utf8'));
  const lib = stripJs(fs.readFileSync(path.join(ROOT, 'web/lib/replayPath.ts'), 'utf8'));
  const layer = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/spectator/replay/RouteLayer3D.ts'), 'utf8'));
  it('builds the route whenever the Path toggle is on, with no variant in the URL', () => {
    expect(board).toMatch(/let route: RouteFeed \| null = null;\s*if \(routeRef\.current\.path\) \{/);
    expect(board).toMatch(/const \[showPath, setShowPath\] = useState\(true\)/);   // on by default
    expect(board).not.toMatch(/setVariant|\bvariant\b/);   // nothing in the board reads a ?v= any more
  });
  it('keeps every window\'s path and reads the rest of the night while the toggle is on', () => {
    expect(board).toMatch(/pathStore\.current\.addWindow\(w, decoded\)/);
    expect(board).not.toMatch(/routeRef\.current\.variant/);
    expect(board).toMatch(/if \(!showPath \|\| !night\) return;/);
  });
  it('shows the path controls to everyone, without a preview tag', () => {
    expect(board).toMatch(/<div[^>]*aria-label="Raid path"/);
    expect(board).not.toMatch(/\{variant && \(/);
    expect(board).not.toMatch(/preview \{/);
  });
  it('has no trail, raider trails, trail slider or variant left anywhere', () => {
    for (const src of [board, lib, layer]) {
      expect(src).not.toMatch(/trailSegments|trailBox|raiderTrails|RaiderTrail|clampTrailMin|TRAIL_|trailMs|showRtrails|RouteVariant|parseRouteVariant/);
    }
    expect(layer).not.toMatch(/MAX_TRAIL|MAX_RT|updateTrail/);
  });
});
