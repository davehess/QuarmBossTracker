// test/route-planner-recorded.test.js: the route planner's "Recorded" route source (web/lib/routePlanner/{nights,recorded,drape,follow,view3d}.ts).
//
// The guild lead, 2026-10-22, on the 3D view with the Compare tab on the 10/21 night: "3d map doesn't include our actual
// recording of the night. we should be able to take from that and average out the actual path rather than these straight
// lines." What is pinned here, without a browser:
//   • nights: the recorder's live raid nights merged over the zone file's (same key = one night, live wins, newest first, capped);
//   • the Recorded source: every leg along the average of the nights that ran it, and where no night did, walk, then straight;
//   • "Use recorded routes": the averages baked into bend points, at most 40 each, a hidden leg still hidden;
//   • the drape: a flat path put on the floors by continuity, so two floors over the same x, y do not swap a path's storey.
//
// Run: npx vitest run test/route-planner-recorded.test.js

import { describe, it, expect } from 'vitest';
import { killTag, liveNights, mergeNights, nightsNote, nightDay, NIGHT_CAP, nightFromSeries } from '../web/lib/routePlanner/nights.ts';
import { createFollow, REC_STEP } from '../web/lib/routePlanner/follow.ts';
import { annotateRecorded, legSource, recText, recordedPolys, useRecordedRoutes } from '../web/lib/routePlanner/recorded.ts';
import { planLegs, legLength, polyLen } from '../web/lib/routePlanner/plan.ts';
import { emptyPlan } from '../web/lib/routePlanner/types.ts';
import { densify, drapeHeights, drapePath, floorHeightsAt, nearestZ, refHeightsAt } from '../web/lib/routePlanner/drape.ts';
import { buildView3D, recordedPath3D } from '../web/lib/routePlanner/view3d.ts';
import { buildTriGrid } from '../web/lib/replayCamera.ts';
import { zoneData } from '../web/lib/routePlanner/zones/index.ts';

const pin = (id, x, y, extra = {}) => ({ id, label: id, kind: 'note', optional: false, x, y, ...extra });
const planOf = (pins, extra = {}) => ({ ...emptyPlan(), pins, ...extra });

// a night walking (0,0) -> bend -> (1000,0), a sample every 3 s; `dy` shifts the bend so two nights differ
function walk(key, t0, via, color = '#58a6ff') {
  const way = [[0, 0], ...via, [1000, 0]];
  const pts = [];
  let t = t0;
  for (let i = 0; i + 1 < way.length; i++) {
    const [x0, y0] = way[i], [x1, y1] = way[i + 1], n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 80);
    for (let k = 0; k < n; k++, t += 3) pts.push([t, x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  pts.push([t, 1000, 0]);
  return { key, color, kill: 'x', pts };
}
const NIGHT_A = walk('10/20/2026', 1_000_000, [[500, 300]]);
const NIGHT_B = walk('10/21/2026', 2_000_000, [[500, 340]]);

describe('nights: the recorder over the zone file', () => {
  const live = (key, from, minutes, n = 3) => ({ night_key: key, from, minutes, kills: ['Vallon Zek', 'The Diaku Overseer'], series: Array.from({ length: n }, (_, i) => ({ t: from + i * 3000, x: i * 10.26, y: -i * 7.74 })) });
  const saved = [
    { key: '10/08/2026', color: '#58a6ff', kill: 'a', pts: [[1, 0, 0], [4, 5, 5]] },
    { key: '10/12/2026', color: '#b6e354', kill: 'b', pts: [[2, 0, 0], [5, 5, 5]] },
  ];

  it('a live visit becomes a night of [seconds, x, y] to the half unit, with a short kill tag', () => {
    const n = nightFromSeries(live('10/21/2026', 1_791_000_000_000, 90), '#f778ba');
    expect(n.pts[1]).toEqual([1_791_000_003, 10.5, -7.5]);
    expect(n.kill).toBe('Vallon, Diaku');
    expect(killTag(['Decorin Berik', 'Decorin Grunhork', 'The Diaku Overseer'])).toBe('Decorin, Diaku');
    expect(killTag([])).toBe('no named kill');
  });

  it('the same night key is one night and the live copy wins, with the file\'s colour kept', () => {
    const lv = liveNights([live('10/12/2026', 3_000_000, 60, 9), live('10/21/2026', 4_000_000, 80)], saved);
    const m = mergeNights(saved, lv);
    expect(m.nights.map(n => n.key)).toEqual(['10/21/2026', '10/12/2026', '10/08/2026']);
    const same = m.nights.find(n => n.key === '10/12/2026');
    expect(same.pts).toHaveLength(9);                  // the live copy, not the file's 2 samples
    expect(same.color).toBe('#b6e354');                // the file's colour
    expect(m.nights.find(n => n.key === '10/21/2026').color).not.toBe('#58a6ff');   // a new night takes a colour not in use
    expect(m).toMatchObject({ live: 2, saved: 1, dropped: 0 });
  });

  it('two visits on one night key are one night: the longer visit stands for it', () => {
    const lv = liveNights([live('10/21/2026', 1_000, 30, 4), live('10/21/2026', 900_000, 95, 7)], []);
    expect(lv).toHaveLength(1);
    expect(lv[0].pts).toHaveLength(7);
  });

  it('newest first, and no more than the cap; the note says how many were left out', () => {
    const many = Array.from({ length: NIGHT_CAP + 3 }, (_, i) => ({ key: `10/${String(i + 1).padStart(2, '0')}/2026`, color: '#fff', kill: '', pts: [[i, 0, 0], [i + 3, 1, 1]] }));
    const m = mergeNights(many, []);
    expect(m.nights).toHaveLength(NIGHT_CAP);
    expect(m.nights[0].key).toBe(`10/${NIGHT_CAP + 3}/2026`);
    expect(m.dropped).toBe(3);
    expect(nightsNote(m)).toMatch(new RegExp(`Newest ${NIGHT_CAP}`));
    expect(nightsNote(m)).toMatch(/3 older left out/);
    expect(mergeNights(many, [], 2).nights).toHaveLength(2);
    expect(nightDay('10/21/2026')).toBeGreaterThan(nightDay('10/09/2026'));
    expect(nightDay('nonsense')).toBe(0);
  });

  it('a visit with no samples is not a night', () => {
    expect(liveNights([live('10/21/2026', 1000, 90, 1)], [])).toEqual([]);
  });
});

describe('the Recorded source: every leg, lazily, fallback recorded -> walk -> straight', () => {
  const fol = createFollow([NIGHT_A, NIGHT_B]);
  const plan = planOf([pin('a', 0, 0), pin('b', 1000, 0), pin('c', 1000, 1500)]);

  it('a leg both nights ran follows their average (the bend, not the chord); one nobody ran has none', () => {
    const L = planLegs(plan, false);
    annotateRecorded(L, fol);
    expect(L[0].rec).toMatchObject({ state: 'ok', nights: 2 });
    expect(L[0].rec.len).toBeGreaterThan(1040);          // the chord is 1000; the bend adds at least 40 on 2 x ~(560 + 570)
    expect(L[1].rec).toEqual({ state: 'none' });
    const r = fol.recorded({ x: 0, y: 0 }, { x: 1000, y: 0 });
    expect(r.poly[0]).toEqual([0, 0]);
    expect(r.poly[r.poly.length - 1]).toEqual([1000, 0]);
    const nearBend = Math.min(...r.poly.map(p => Math.hypot(p[0] - 500, p[1] - 320)));
    expect(nearBend).toBeLessThan(70);                   // the average of the two bends (300 and 340)
    expect(r.poly.length).toBeGreaterThanOrEqual(28);
    expect(Math.max(...r.poly.slice(1).map((p, i) => Math.hypot(p[0] - r.poly[i][0], p[1] - r.poly[i][1])))).toBeLessThan(REC_STEP * 2.5);
  });

  it('the leg\'s length is the recorded one; with no recorded route it is the walk, then the line', () => {
    const L = planLegs(plan, false);
    annotateRecorded(L, fol);
    expect(legLength(L[0])).toBe(L[0].rec.len);
    expect(legLength(L[1])).toBeCloseTo(1500, 6);        // none: its own line
    L[1].walk = { state: 'ok', len: 1750, via: [], steps: 0, ignoredBends: false };
    expect(legLength(L[1])).toBe(1750);                  // none recorded, walked
    L[0].walk = { state: 'ok', len: 99999, via: [], steps: 0, ignoredBends: false };
    expect(legLength(L[0])).toBe(L[0].rec.len);          // recorded beats walked when both exist
  });

  it('which source a leg is drawn along, and what its card says', () => {
    const L = planLegs(plan, false);
    annotateRecorded(L, fol);
    const ok = { state: 'ok', len: 1, via: [], steps: 0, ignoredBends: false };
    expect(legSource(L[0])).toBe('recorded');
    expect(legSource({ rec: L[0].rec, walk: ok })).toBe('recorded');      // both exist: where we actually ran wins
    expect(recText(L[0])).toBe('recorded: 2 nights');
    expect(legSource({ rec: L[1].rec, walk: ok })).toBe('walked');
    expect(recText({ rec: L[1].rec, walk: ok })).toBe('no recorded night: walked');
    expect(legSource({ rec: L[1].rec, walk: { state: 'none' } })).toBe('straight');
    expect(recText({ rec: L[1].rec, walk: { state: 'none' } })).toBe('straight');
    expect(legSource({ rec: L[1].rec })).toBe('straight');
    expect(recText({ rec: L[1].rec, walk: { state: 'pending' } })).toMatch(/finding the walking route/);
    expect(recText({ rec: { state: 'ok', len: 5, nights: 1 } })).toBe('recorded: 1 night');
  });

  it('a leg through a teleport is left to the walk route, and a leg between pins too close for a path has none', () => {
    const tp = planOf([pin('a', 0, 0), pin('b', 1000, 0)], { lines: [{ k: 'a>b', pts: [], off: false, via: 'Door' }] });
    const L = planLegs(tp, false, [{ kind: 'teleport', from: [10, 0, 0], to: [900, 0, 0], label: 'Door' }]);
    expect(L[0].jump).toBeTruthy();
    annotateRecorded(L, fol);
    expect(L[0].rec).toEqual({ state: 'none' });
    const close = planLegs(planOf([pin('a', 0, 0), pin('b', 60, 0)]), false);
    annotateRecorded(close, fol);
    expect(close[0].rec).toEqual({ state: 'none' });
  });

  it('only the covered legs go to the 3D view', () => {
    const L = planLegs(plan, false);
    annotateRecorded(L, fol);
    const m = recordedPolys(L, fol);
    expect([...m.keys()]).toEqual(['a>b']);
    expect(m.get('a>b')[0]).toEqual([0, 0]);
  });
});

describe('"Use recorded routes": the averages become bend points', () => {
  const fol = createFollow([NIGHT_A, NIGHT_B]);

  it('bakes every covered leg, at most 40 bends, marked as following the nights; the pins are not bends', () => {
    const plan = planOf([pin('a', 0, 0), pin('b', 1000, 0), pin('c', 1000, 1500)]);
    const L = planLegs(plan, false);
    const r = useRecordedRoutes(plan, L, fol, 40);
    expect(r).toEqual({ baked: 1, skipped: 1 });
    expect(plan.lines).toHaveLength(1);
    const ln = plan.lines[0];
    expect(ln.k).toBe('a>b');
    expect(ln.follow).toBe(2);
    expect(ln.pts.length).toBeGreaterThanOrEqual(1);       // two straight runs and a corner: the simplifier keeps the corner (and a point or two of resampling slack)
    expect(ln.pts.length).toBeLessThan(10);                // far fewer than the ~28 samples it was averaged from
    expect(ln.pts.length).toBeLessThanOrEqual(40);
    expect(ln.pts.some(p => Math.hypot(p[0] - 500, p[1] - 320) < 90)).toBe(true);        // the corner survives the simplifying
    expect(ln.pts.every(p => !(p[0] === 0 && p[1] === 0) && !(p[0] === 1000 && p[1] === 0))).toBe(true);
    const baked = polyLen([[0, 0], ...ln.pts, [1000, 0]]);
    expect(baked).toBeGreaterThan(1040);                                                    // still the way the nights ran
  });

  it('a tight limit is kept, a hidden leg stays hidden and keeps its other flags, a baked height is dropped', () => {
    const zig = createFollow([walk('10/22/2026', 5_000_000, [[100, 200], [250, -200], [400, 200], [550, -200], [700, 200], [850, -200]])]);
    const loose = planOf([pin('a', 0, 0), pin('b', 1000, 0)]);
    useRecordedRoutes(loose, planLegs(loose, false), zig, 40);
    expect(loose.lines[0].pts.length).toBeGreaterThan(3);   // a zigzag has corners that matter
    const plan = planOf([pin('a', 0, 0), pin('b', 1000, 0)], { lines: [{ k: 'a>b', pts: [[1, 1]], off: true, opt: true, h: [[1, 1, 5]] }] });
    useRecordedRoutes(plan, planLegs(plan, false), zig, 3);
    const ln = plan.lines[0];
    expect(ln.pts.length).toBeLessThanOrEqual(3);
    expect(ln.off).toBe(true);
    expect(ln.opt).toBe(true);
    expect(ln.h).toBeUndefined();
  });

  it('a plan with no covered leg is left exactly as it was', () => {
    const plan = planOf([pin('a', 0, 5000), pin('b', 1000, 5000)]);
    expect(useRecordedRoutes(plan, planLegs(plan, false), fol)).toEqual({ baked: 0, skipped: 1 });
    expect(plan.lines).toEqual([]);
  });
});

describe('the drape: a flat path put on the floors', () => {
  // two storeys over x 0..1000: a floor at z 0 and a floor at z 300; between x 400 and 600 a ramp joins them (single floor, rising)
  const storeys = (x) => (x < 400 || x > 600 ? [0, 300] : [0 + ((x - 400) / 200) * 300]);
  const at = (x) => storeys(x);

  it('stays on the storey it starts on, though another lies over or under the same x, y', () => {
    const upper = drapeHeights([[100, 0], [200, 0], [300, 0]], at, 300);
    expect(upper).toEqual([300, 300, 300]);
    const lower = drapeHeights([[100, 0], [200, 0], [300, 0]], at, 0);
    expect(lower).toEqual([0, 0, 0]);
  });

  it('climbs a ramp smoothly, then keeps the storey it climbed to', () => {
    const xs = [300, 400, 450, 500, 550, 600, 700, 800];
    const z = drapeHeights(xs.map(x => [x, 0]), at, 0);
    expect(z[0]).toBe(0);
    expect(z[3]).toBeCloseTo(150, 6);                      // halfway up the ramp
    expect(z[5]).toBeCloseTo(300, 6);
    expect(z.slice(5)).toEqual([300, 300, 300]);           // past the ramp it is on the upper storey: the nearest hit to 300 is 300, not the 0 below
    for (let i = 1; i < z.length; i++) expect(Math.abs(z[i] - z[i - 1])).toBeLessThanOrEqual(75);   // no jump between storeys on the way
  });

  it('a sample with no floor under it carries the height before it (and the start height before any)', () => {
    const hole = x => (x > 150 && x < 250 ? [] : [40]);
    expect(drapeHeights([[100, 0], [200, 0], [300, 0]], hole, 40)).toEqual([40, 40, 40]);
    expect(drapeHeights([[200, 0], [300, 0]], hole, 7)).toEqual([7, 40]);
    expect(drapeHeights([[1, 1]], () => [], 12)).toEqual([12]);
  });

  it('cuts a long step into samples, and leaves a jump (a teleport, a hole in the recording) as one', () => {
    expect(densify([[0, 0], [100, 0]], 40)).toHaveLength(4);       // 0, 33, 67, 100
    expect(densify([[0, 0], [5000, 0]], 40)).toHaveLength(2);
    const p = drapePath([[0, 0], [300, 0]], at, 300);
    expect(p.length).toBeGreaterThan(6);
    expect(p.every(q => q[2] === 300)).toBe(true);
  });

  it('floorHeightsAt reads every floor over a point from a triangle grid, and nothing outside it', () => {
    // three-frame triangles (X = -x, Y = z, Z = -y): a floor at z 0 and one at z 300, both covering x 0..100, y 0..100
    const tri = (z) => [0, z, 0, -100, z, 0, 0, z, -100];
    const g = buildTriGrid(new Float32Array([...tri(0), ...tri(300)]));
    expect(floorHeightsAt(g, 20, 20).sort((a, b) => a - b)).toEqual([0, 300]);
    expect(floorHeightsAt(g, 90, 90)).toEqual([]);          // outside the triangle (the other half of the square)
    expect(floorHeightsAt(g, 5000, 5000)).toEqual([]);      // outside the grid
    // a slope: one triangle rising from z 0 at X=0 to z 100 at X=-100
    const ramp = buildTriGrid(new Float32Array([0, 0, 0, -100, 100, 0, 0, 0, -100]));
    expect(floorHeightsAt(ramp, 50, 10)[0]).toBeCloseTo(50, 6);
  });

  it('with no mesh, the floors are those the pins and mobs around a sample stand on, kept by continuity', () => {
    const refs = [{ x: 0, y: 0, z: -500 }, { x: 1000, y: 0, z: 200 }, { x: 500, y: 20, z: -500 }, { x: 520, y: 0, z: 200 }];
    expect(nearestZ(100, 0, refs)).toBe(-500);
    expect(nearestZ(0, 0, [])).toBeNull();
    const at = refHeightsAt(refs);
    expect(at(10, 0)).toEqual([-500]);                           // only the pin it stands by
    expect(at(510, 10).sort((a, b) => a - b)).toEqual([-500, 200]);  // two floors' pins near it
    expect(at(5000, 0)).toEqual([200]);                          // none within reach: the nearest
    expect(refHeightsAt([])(1, 1)).toEqual([]);
    // a path along the lower floor past a pin that stands on the upper one stays on the lower floor
    expect(drapeHeights([[0, 0], [250, 0], [510, 10], [750, 0]], at, -500)).toEqual([-500, -500, -500, -500]);
  });
});

describe('the 3D view: recorded legs and nights', () => {
  const Z = zoneData('potactics');
  const a = pin('a', 0, 0, { z: 10 }), b = pin('b', 1000, 0, { z: 10 });
  const plan = planOf([a, b]);
  const poly = [[0, 0], [250, 150], [500, 300], [750, 150], [1000, 0]];

  it('mesh: a recorded leg is draped (its storey kept) and starts and ends on its pins', () => {
    const heightsAt = () => [10, 500];                    // a second storey right over the first, everywhere
    const v = buildView3D({ zone: Z, plan, skipOptional: false, mode: 'mesh', recorded: new Map([['a>b', poly]]), heightsAt });
    const w = v.legs[0].walks[0];
    expect(w.length).toBeGreaterThan(poly.length);        // cut into samples to be draped
    expect(w[0]).toEqual([0, 0, 10]);
    expect(w[w.length - 1]).toEqual([1000, 0, 10]);
    expect(w.every(p => p[2] === 10)).toBe(true);         // never the storey above
  });

  it('mesh without floors, and stack: the leg rises from one pin to the other; a leg with no recorded path is straight', () => {
    const noMesh = buildView3D({ zone: Z, plan, skipOptional: false, mode: 'mesh', recorded: new Map([['a>b', poly]]) });
    expect(noMesh.legs[0].walks[0]).toHaveLength(poly.length);
    const stack = buildView3D({ zone: Z, plan, skipOptional: false, mode: 'stack', spacing: 300, recorded: new Map([['a>b', poly]]) });
    expect(stack.legs[0].walks[0]).toHaveLength(poly.length);
    const plain = buildView3D({ zone: Z, plan, skipOptional: false, mode: 'mesh' });
    expect(plain.legs[0].walks[0]).toHaveLength(2);
  });

  it('a recorded night is draped from its first kill, or put on the nearest pin\'s floor without a mesh', () => {
    const v = buildView3D({ zone: Z, plan, skipOptional: false, mode: 'mesh' });
    const pts = [[0, 0], [500, 0], [1000, 0]];
    const two = x => (x < 800 ? [10, 400] : [400]);       // the lower floor ends at x 800; the upper one carries on
    const draped = recordedPath3D(pts, { mode: 'mesh', heightsAt: two, refs: v.refs, snap: v.snap, startZ: 10, fallback: 0 });
    expect(draped[0][2]).toBe(10);
    expect(draped[draped.length - 1][2]).toBe(400);       // it ran off the lower floor onto the upper
    const near = recordedPath3D(pts, { mode: 'mesh', refs: [{ x: 0, y: 0, z: 10 }, { x: 1000, y: 0, z: 400 }], snap: z => z, startZ: null, fallback: 0 });
    expect(near.map(p => p[2])).toEqual([10, 10, 400]);
  });
});
