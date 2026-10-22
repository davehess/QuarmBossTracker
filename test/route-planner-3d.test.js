// test/route-planner-3d.test.js: the rules behind the route planner's 3D view (web/lib/routePlanner/view3d.ts), pinned
// without a browser or three.js. What is worth testing is where things GO: which slab a floor is, where a pin with no z
// stands, how a leg between floors climbs, where a floor clip cuts. Drawing them is Plan3D.tsx.
//
// Run: npx vitest run test/route-planner-3d.test.js

import { describe, it, expect } from 'vitest';
import {
  floorOrder, floorLevels, heightsFor, pinHeight, clipHeight, liftPolyline, arcPoints, baseSpacing, shortFloorLabel, buildView3D,
  threeToServer, dragLanding, withPinMoved, movedPast, legTouches, DRAG_SLOP,
} from '../web/lib/routePlanner/view3d.ts';
import { serverToThree } from '../web/lib/zoneMesh.ts';
import { buildPlanPins } from '../web/lib/routePlanner/build.ts';
import { emptyPlan } from '../web/lib/routePlanner/types.ts';
import { zoneData } from '../web/lib/routePlanner/zones/index.ts';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const pin = (id, x, y, extra = {}) => ({ id, label: id, kind: 'note', optional: false, x, y, ...extra });
const TOWER = zoneData('solrotower');
const TACTICS = zoneData('potactics');
const planOf = (pins, extra = {}) => ({ ...emptyPlan(), pins, ...extra });
const mob = (id, x, y, z) => ({ tier: 1, id, name: id, kind: 'named', x, y, ...(z === undefined ? {} : { z }) });

describe('floors, low to high', () => {
  it('orders bands by height, an open-ended band by its one edge', () => {
    expect(floorOrder(TACTICS.floors).map(f => f.key)).toEqual(['pit', 'mid', 'up']);
    expect(floorOrder(TOWER.floors).map(f => f.key)).toEqual(['jiva', 'rizlona', 'entrance', 'sentry', 'mid', 'tele', 'upper', 'top', 'solro', 'xuzl', 'arlyxir']);
  });

  it('a level sits where the zone data puts the floor (median z), not mid-band, and rises strictly', () => {
    const lv = floorLevels(TOWER);
    expect(lv).toHaveLength(11);
    for (let i = 1; i < lv.length; i++) expect(lv[i].z).toBeGreaterThan(lv[i - 1].z);
    const jiva = lv.find(l => l.key === 'jiva');
    expect(jiva.z).toBeLessThan(-1050);              // the floor at about -1100..-1340, not the band's middle (-1200)
    expect(floorLevels({ floors: [{ key: 'a', label: 'A', zmin: 0, zmax: 100 }], mobs: [], pathers: [], links: [] })[0].z).toBe(50);   // nothing on it: the band's middle
    expect(floorLevels({ floors: [{ key: 'a', label: 'A', zmin: 10 }], mobs: [], pathers: [], links: [] })[0].z).toBe(110);
  });

  it('a level is the median of what the data puts on the floor, not the middle of its band', () => {
    const floors = [{ key: 'a', label: 'A', zmin: 0, zmax: 100 }];
    const lv = floorLevels({ floors, mobs: [mob('m', 0, 0, 10), mob('n', 0, 0, 20), mob('o', 0, 0, 90)], pathers: [], links: [{ kind: 'zoneline', from: [0, 0, 30], to: null, label: 'z' }] });
    expect(lv[0].z).toBe(25);                        // the median of 10, 20, 30, 90; the band's middle would be 50
  });

  it('two floors whose levels would come out equal still get distinct, rising ones', () => {
    // overlapping bands: z 150 belongs to the first band listed, so the second has no data and falls back to its band's middle, also 150
    const floors = [{ key: 'a', label: 'A', zmin: 0, zmax: 500 }, { key: 'b', label: 'B', zmin: 100, zmax: 200 }];
    const lv = floorLevels({ floors, mobs: [mob('m', 0, 0, 150)], pathers: [], links: [] });
    expect(lv.map(l => l.key)).toEqual(['b', 'a']);
    expect(lv[0].z).toBe(150);
    expect(lv[1].z).toBeGreaterThan(lv[0].z);
  });

  it('a long floor name is cut for a tag, a short one is left alone', () => {
    expect(shortFloorLabel('Sentry level (z about -574): Tranquility portal, Dresolik tower base')).toBe('Sentry level');
    expect(shortFloorLabel('Ground / entrance (z about -766)')).toBe('Ground / entrance');
    expect(shortFloorLabel('Bottom: Jiva\'s wing (z about -1100 to -1340)')).toBe('Bottom: Jiva\'s wing');
    expect(shortFloorLabel('x'.repeat(40))).toHaveLength(28);
  });
});

describe('heights', () => {
  const levels = floorLevels(TOWER);
  const stack = heightsFor(levels, TOWER.floors, 'stack', 300);

  it('stack: floor n is slab n * spacing, and a thing on a floor snaps to that slab', () => {
    expect(stack.levels.map(l => l.h)).toEqual(levels.map((_, i) => i * 300));
    expect(stack.snap(-766)).toBe(2 * 300);          // the entrance
    expect(stack.snap(-384)).toBe(5 * 300);          // the teleporter hall
    expect(stack.snap(0)).toBe(7 * 300);             // the top of the central hall
    expect(stack.snap(undefined)).toBe(5 * 300);     // no height: the middle floor
  });

  it('stack: a z between two floors is on one of them, the nearer level when no band holds it', () => {
    const gappy = heightsFor(floorLevels({ floors: [{ key: 'a', label: 'A', zmax: 0 }, { key: 'b', label: 'B', zmin: 100 }], mobs: [mob('m', 0, 0, -10), mob('n', 0, 0, 120)], pathers: [], links: [] }), [{ key: 'a', label: 'A', zmax: 0 }, { key: 'b', label: 'B', zmin: 100 }], 'stack', 50);
    expect(gappy.snap(30)).toBe(0);                  // 30 is nearer level a (-10) than b (120)
    expect(gappy.snap(90)).toBe(50);
  });

  it('stack: a ramp is continuous and climbs through every slab it passes, in step with real z', () => {
    let last = -Infinity;
    for (let z = -800; z <= 20; z += 5) { const h = stack.ramp(z); expect(h).toBeGreaterThanOrEqual(last); last = h; }
    const mid = (levels[2].z + levels[3].z) / 2;     // halfway up from the entrance to the sentry level
    expect(stack.ramp(mid)).toBeCloseTo(2 * 300 + 150, 5);
    expect(stack.ramp(levels[4].z)).toBeCloseTo(4 * 300, 5);
  });

  it('stack: past the ends it runs on for a little way and then stops', () => {
    expect(stack.ramp(-99999)).toBeGreaterThanOrEqual(-150);
    expect(stack.ramp(99999)).toBeLessThanOrEqual(10 * 300 + 150);
  });

  it('mesh: heights are the real z', () => {
    const mesh = heightsFor(levels, TOWER.floors, 'mesh', 300);
    expect(mesh.snap(-766)).toBe(-766);
    expect(mesh.ramp(123)).toBe(123);
    expect(mesh.levels[2].h).toBe(levels[2].z);
  });

  it('a zone whose spacing is not given gets a ninth of its width, within bounds', () => {
    expect(baseSpacing({ x0: 0, x1: 4500, y0: 0, y1: 100 })).toBe(500);
    expect(baseSpacing({ x0: 0, x1: 100, y0: 0, y1: 100 })).toBe(120);
    expect(baseSpacing({ x0: 0, x1: 99999, y0: 0, y1: 100 })).toBe(700);
  });
});

describe('a pin with no z', () => {
  const levels = floorLevels(TOWER);
  const mobs = [mob('far', 1000, 1000, 500), mob('near', 10, 10, -384), mob('noz', 11, 11)];

  it('uses its own z', () => expect(pinHeight(pin('a', 0, 0, { z: -200 }), mobs, levels)).toEqual({ z: -200, src: 'pin' }));
  it('else the mob it was made from', () => expect(pinHeight(pin('a', 0, 0, { mob: 'far' }), mobs, levels)).toEqual({ z: 500, src: 'mob' }));
  it('else the nearest mob that HAS a z', () => expect(pinHeight(pin('a', 12, 12), mobs, levels)).toEqual({ z: -384, src: 'near' }));
  it('else the middle floor', () => {
    const r = pinHeight(pin('a', 0, 0), [], levels);
    expect(r.src).toBe('floor');
    expect(r.z).toBe(levels[5].z);
  });
  it('a mob id that no longer exists falls through to the nearest mob', () => expect(pinHeight(pin('a', 12, 12, { mob: 'gone' }), mobs, levels).src).toBe('near'));
});

describe('a floor clip', () => {
  it('cuts at the top of the floor band', () => {
    expect(clipHeight(TOWER.floors, 'tele')).toBe(-250);
    expect(clipHeight(TOWER.floors, 'entrance')).toBe(-680);
  });
  it('is nothing for no floor, an unknown one, or a band open at the top', () => {
    expect(clipHeight(TOWER.floors, null)).toBeNull();
    expect(clipHeight(TOWER.floors, 'nope')).toBeNull();
    expect(clipHeight(TACTICS.floors, 'up')).toBeNull();
  });
});

describe('lines', () => {
  it('a leg climbs in proportion to the way walked', () => {
    const p = liftPolyline([[0, 0], [30, 0], [100, 0]], 0, 100);
    expect(p.map(q => q[2])).toEqual([0, 30, 100]);
    expect(liftPolyline([[0, 0], [0, 0]], 5, 9).map(q => q[2])).toEqual([5, 9]);   // a leg of no length does not divide by zero
    expect(liftPolyline([], 0, 1)).toEqual([]);
  });

  it('a teleport arc starts and ends exactly on its ends and rises between', () => {
    const a = [0, 0, 0], b = [1000, 0, 0];
    const arc = arcPoints(a, b, 10);
    expect(arc).toHaveLength(11);
    expect(arc[0]).toEqual(a);
    expect(arc[10][0]).toBeCloseTo(1000, 6);
    expect(arc[10][2]).toBeCloseTo(0, 6);
    expect(arc[5][2]).toBeGreaterThan(100);          // the bow
  });
});

describe('the whole view of the tower', () => {
  const checklist = TOWER.popKeys.map(k => ({ key: k, title: k }));
  let n = 0;
  const built = buildPlanPins({ zone: TOWER, mobs: TOWER.mobs, order: 'checklist', onPlanNpcs: [], checklist, uid: () => 'u' + ++n });
  const plan = planOf(built.pins);
  const stack = buildView3D({ zone: TOWER, plan, skipOptional: false, mode: 'stack', spacing: 300 });
  const mesh = buildView3D({ zone: TOWER, plan, skipOptional: false, mode: 'mesh' });

  it('has a slab for each floor and a pin for each pin, each on its floor', () => {
    expect(stack.slabs).toHaveLength(11);
    expect(stack.pins).toHaveLength(plan.pins.length);
    for (const p of stack.pins) {
      expect(Number.isFinite(p.h)).toBe(true);
      expect(stack.slabs.some(s => s.h === p.h)).toBe(true);           // on a slab, not between two
      expect(p.floor).not.toBeNull();
    }
    const solro = stack.pins.find(p => p.label === 'Solusek Ro');
    const jiva = stack.pins.find(p => p.label === 'Jiva');
    expect(solro.h).toBeGreaterThan(jiva.h);                           // the chamber is above the bottom wing
  });

  it('mesh puts the same pins at their real z', () => {
    for (const p of mesh.pins) expect(p.h).toBe(p.z);
    expect(mesh.pins.find(p => p.label === 'Jiva').h).toBeCloseTo(TOWER.mobs.find(m => m.id === 'jiva').z, 5);
  });

  it('draws a leg between floors as a line that climbs from one slab to the other', () => {
    const a = pin('a', 0, -2915, { z: -766 }), b = pin('b', 0, -1590, { z: 270 });
    const v = buildView3D({ zone: TOWER, plan: planOf([a, b]), skipOptional: false, mode: 'stack', spacing: 300 });
    const walk = v.legs[0].walks[0];
    expect(walk[0][2]).toBe(2 * 300);
    expect(walk[walk.length - 1][2]).toBe(8 * 300);
  });

  it('draws a leg through a teleport as two walks and an arc between the teleport ends', () => {
    const tp = TOWER.links.find(l => l.label === 'Teleporter to Arlyxir\'s wing');
    const a = pin('a', 300, 300, { z: 0 }), b = pin('b', 1600, 258, { z: 577 });
    const plan2 = planOf([a, b], { lines: [{ k: 'a>b', pts: [], off: false, via: tp.label }] });
    const v = buildView3D({ zone: TOWER, plan: plan2, skipOptional: false, mode: 'stack', spacing: 300 });
    const leg = v.legs[0];
    expect(leg.walks).toHaveLength(2);
    expect(leg.arc[0].slice(0, 2)).toEqual([tp.from[0], tp.from[1]]);
    expect(leg.arc[leg.arc.length - 1].slice(0, 2)).toEqual([tp.to[0], tp.to[1]]);
    expect(leg.arc[0][2]).toBe(7 * 300);                                // the top of the central hall
    expect(leg.arc[leg.arc.length - 1][2]).toBe(10 * 300);              // Arlyxir's wing
  });

  it('leaves out a hidden leg and keeps a leg of a split branch in its branch colour', () => {
    const a = pin('a', 0, 0, { z: -766 }), b = pin('b', 100, 0, { z: -766 }), c = pin('c', 200, 0, { z: -766 });
    const hidden = buildView3D({ zone: TOWER, plan: planOf([a, b], { lines: [{ k: 'a>b', pts: [], off: true }] }), skipOptional: false, mode: 'stack', spacing: 300 });
    expect(hidden.legs).toHaveLength(0);
    const split = { id: 's', from: 'a', to: 'c', branches: [{ id: 'x', label: 'Team A', color: '#2dd4bf', pins: [pin('p', 100, 50, { z: -766 })] }, { id: 'y', label: 'Team B', color: '#d946ef', pins: [] }] };
    const v = buildView3D({ zone: TOWER, plan: planOf([a, c], { splits: [split] }), skipOptional: false, mode: 'stack', spacing: 300 });
    expect(v.legs.map(l => l.color)).toEqual(['#2dd4bf', '#2dd4bf']);
    expect(v.pins.find(p => p.id === 'p').branch).toBe('#2dd4bf');
    expect(v.pins.find(p => p.id === 'p').num).toBe('A1');
  });

  it('One leg mode: draws only the focused leg and marks every pin but its two ends faint', () => {
    const key = stack.legs[4].key;
    const [fa, fb] = key.split('>');
    const one = buildView3D({ zone: TOWER, plan, skipOptional: false, mode: 'stack', spacing: 300, focusLeg: key });
    expect(one.legs.map(l => l.key)).toEqual([key]);
    expect(one.pins.filter(p => !p.faint).map(p => p.id).sort()).toEqual([fa, fb].sort());
    expect(one.pins.filter(p => p.faint)).toHaveLength(plan.pins.length - 2);
    // no focus, or a key that names no leg: the whole plan, nothing faint
    for (const f of [undefined, null, 'nope>nope']) {
      const v = buildView3D({ zone: TOWER, plan, skipOptional: false, mode: 'stack', spacing: 300, focusLeg: f });
      expect(v.legs).toHaveLength(stack.legs.length);
      expect(v.pins.some(p => p.faint)).toBe(false);
    }
  });

  it('carries every pather with a few heights that climb on a ramp', () => {
    expect(stack.pathers).toHaveLength(TOWER.pathers.length);
    const g1 = stack.pathers.find(p => p.id === 'grid-1');
    const hs = g1.pts.map(q => q[2]);
    expect(Math.max(...hs) - Math.min(...hs)).toBeGreaterThan(100);    // grid-1 walks from the sentry level down to the entrance
  });

  // two floors, one mob on each, and a pather that walks from the lower to the upper through z 100 (the top of the lower band)
  const twoFloors = {
    floors: [{ key: 'lo', label: 'Lo', zmax: 100 }, { key: 'hi', label: 'Hi', zmin: 101 }],
    mobs: [mob('a', 0, 0, 50), mob('b', 0, 0, 150)],
    bounds: { x0: 0, x1: 100, y0: 0, y1: 100 },
    links: [],
  };

  it('a pather on a ramp climbs smoothly between the slabs; a pin on the same ramp snaps to one', () => {
    const pather = { id: 'p', npc_names: ['a sentry'], points: [[0, 0, 50], [10, 0, 100], [20, 0, 150]], loop: false };
    const v = buildView3D({ zone: { ...twoFloors, pathers: [pather] }, plan: planOf([pin('x', 10, 0, { z: 100 })]), skipOptional: false, mode: 'stack', spacing: 500 });
    expect(v.pathers[0].pts.map(q => q[2])).toEqual([0, 250, 500]);    // z 100 is halfway between the two floors' levels
    expect(v.pins[0].h).toBe(0);                                       // z 100 is on the lower floor, so the pin stands on its slab
  });

  it('a looping pather is drawn closed, a walking one is not', () => {
    const loop = { id: 'l', npc_names: [], points: [[0, 0, 50], [10, 0, 50], [10, 10, 50]], loop: true };
    const walk = { id: 'w', npc_names: ['a guard'], points: [[0, 0, 50], [10, 0, 50]], loop: false };
    const v = buildView3D({ zone: { ...twoFloors, pathers: [loop, walk] }, plan: emptyPlan(), skipOptional: false, mode: 'stack', spacing: 500 });
    expect(v.pathers[0].pts).toHaveLength(4);
    expect(v.pathers[0].pts[3]).toEqual(v.pathers[0].pts[0]);
    expect(v.pathers[0].label).toBe('pather');                         // no NPC name known
    expect(v.pathers[1].pts).toHaveLength(2);
    expect(v.pathers[1].label).toBe('a guard');
  });

  it('leaves out a pather with one point', () => {
    const v = buildView3D({ zone: { ...twoFloors, pathers: [{ id: 'd', npc_names: [], points: [[0, 0, 50]], loop: false }] }, plan: emptyPlan(), skipOptional: false, mode: 'stack' });
    expect(v.pathers).toEqual([]);
  });

  it('carries the teleports as arcs and the doors as plain markers', () => {
    expect(stack.links.filter(l => l.arc)).toHaveLength(10);
    expect(stack.links.filter(l => l.kind === 'flag' || l.kind === 'locked' || l.kind === 'zoneline').every(l => l.arc === null)).toBe(true);
  });

  it('works for a zone on the default three floors, and for an empty plan', () => {
    const v = buildView3D({ zone: TACTICS, plan: emptyPlan(), skipOptional: false, mode: 'stack' });
    expect(v.slabs.map(s => s.key)).toEqual(['pit', 'mid', 'up']);
    expect(v.pins).toEqual([]);
    expect(v.legs).toEqual([]);
    expect(v.spacing).toBe(baseSpacing(TACTICS.bounds));
  });
});

describe('dragging a pin in 3D', () => {
  it('three.js back to the server frame is the inverse of serverToThree, and never -0', () => {
    for (const [x, y, z] of [[120.5, -340.2, -1342], [0, 0, 0], [-5, 7, 250]]) {
      const [tx, ty, tz] = serverToThree(x, y, z);
      expect(threeToServer(tx, ty, tz)).toEqual([x, y, z]);
    }
    const o = threeToServer(-0, 5, -0);
    expect(Object.is(o[0], 0) && Object.is(o[1], 0)).toBe(true);
  });

  it('c: the height of the point under the pointer is the pin\'s new z, x and y are rounded to a tenth', () => {
    const [tx, ty, tz] = serverToThree(-410.04, 1203.96, -1288.349);
    expect(dragLanding('mesh', [tx, ty, tz], { z: 5, h: 5 })).toEqual({ x: -410, y: 1204, z: -1288.3, h: -1288.3 });
  });

  it('b: slides along its slab and keeps its z, so a drag cannot change floors', () => {
    const [tx, ty, tz] = serverToThree(10, 20, 9999);   // whatever height the pointer ray reaches, the stack ignores it
    expect(dragLanding('stack', [tx, ty, tz], { z: -1100, h: 600 })).toEqual({ x: 10, y: 20, z: -1100, h: 600 });
  });

  it('x and y stop at the zone bounds, on both views', () => {
    const B = { x0: -100, x1: 100, y0: -50, y1: 50 };
    const far = serverToThree(5000, -9000, 7);
    expect(dragLanding('mesh', far, { z: 0, h: 0 }, B)).toMatchObject({ x: 100, y: -50, z: 7 });
    expect(dragLanding('stack', far, { z: 3, h: 9 }, B)).toEqual({ x: 100, y: -50, z: 3, h: 9 });
    expect(dragLanding('mesh', serverToThree(-20.04, 10, 1), { z: 0, h: 0 }, B)).toMatchObject({ x: -20, y: 10 });
  });

  it('a press is a drag only past 4 px (|dx| + |dy|), a click up to it', () => {
    expect(DRAG_SLOP).toBe(4);
    expect(movedPast(2, 2)).toBe(false);
    expect(movedPast(-4, 0)).toBe(false);
    expect(movedPast(3, -2)).toBe(true);
    expect(movedPast(0, 9, 10)).toBe(false);
  });

  it('shows the plan with one pin moved, on the main route or in a branch, and leaves the plan itself alone', () => {
    const plan = planOf([pin('a', 0, 0, { z: 10 }), pin('b', 5, 5)], {
      splits: [{ id: 's', from: 'a', to: 'b', branches: [{ id: 'br', label: 'L', color: '#fff', pins: [pin('c', 9, 9, { z: 1 })] }] }],
    });
    const moved = withPinMoved(plan, 'b', { x: 70, y: 80, z: -3 });
    expect(moved.pins.map(p => [p.id, p.x, p.y, p.z])).toEqual([['a', 0, 0, 10], ['b', 70, 80, -3]]);
    const inBranch = withPinMoved(plan, 'c', { x: 1, y: 2, z: 3 });
    expect(inBranch.splits[0].branches[0].pins[0]).toMatchObject({ id: 'c', x: 1, y: 2, z: 3 });
    expect(plan.pins[1]).toEqual(pin('b', 5, 5));                    // not mutated
    expect(plan.splits[0].branches[0].pins[0].x).toBe(9);
  });

  it('the moved pin is where the view draws it: mesh at the new z, stack on its own slab', () => {
    const base = TOWER.mobs.filter(m => typeof m.z === 'number').slice(0, 2);
    const plan = planOf(base.map(m => pin(m.id, m.x, m.y, { z: m.z })));
    const to = { x: base[0].x + 100, y: base[0].y - 50, z: base[0].z + 12 };
    const after = withPinMoved(plan, base[0].id, to);
    const mesh = buildView3D({ zone: TOWER, plan: after, skipOptional: false, mode: 'mesh' }).pins[0];
    expect([mesh.x, mesh.y, mesh.h, mesh.z]).toEqual([to.x, to.y, to.z, to.z]);
    const was = buildView3D({ zone: TOWER, plan, skipOptional: false, mode: 'stack', spacing: 300 }).pins[0];
    const now = buildView3D({ zone: TOWER, plan: withPinMoved(plan, base[0].id, { ...to, z: base[0].z }), skipOptional: false, mode: 'stack', spacing: 300 }).pins[0];
    expect([now.x, now.y, now.h, now.floor]).toEqual([to.x, to.y, was.h, was.floor]);
  });

  it('a walk route belongs to a leg that ends at the pin, by the leg key "<from>><to>"', () => {
    expect(legTouches('p1>p2', 'p1')).toBe(true);
    expect(legTouches('p1>p2', 'p2')).toBe(true);
    expect(legTouches('p1>p2', 'p')).toBe(false);
    expect(legTouches('p1>p2', '2')).toBe(false);
    expect(legTouches('p10>p2', 'p1')).toBe(false);
  });
});

describe('the 3D button (live, no ?v= variants)', () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const host = stripJs(read('web/app/raid/plan/routes/RoutePlanner.tsx'));
  const plan3d = stripJs(read('web/app/raid/plan/routes/Plan3D.tsx'));
  const page = stripJs(read('web/app/raid/plan/routes/page.tsx'));

  it('is always shown, with Real (the default) and Floors as its two modes', () => {
    expect(host).toMatch(/useState<Mode3D>\('real'\)/);
    expect(host).toMatch(/\{view3d \? '2D map' : '3D'\}/);
    expect(host).toMatch(/setMode3d\('real'\)/);
    expect(host).toMatch(/setMode3d\('floors'\)/);
    expect(host).toMatch(/<Plan3D key=\{mode3d\}[^>]*mode=\{mode3d\}/);      // a mode change rebuilds the scene
    expect(plan3d).toMatch(/const stack = mode === 'floors';/);
  });

  it('is not gated by a variant anywhere', () => {
    expect(host).not.toMatch(/variant|v3\b/);
    expect(plan3d).not.toMatch(/variant/);
    // the ?v= left are the floors preview (test/route-planner-floor-follow.test.js) and the draw preview (test/route-planner-draw.test.js); the 3D views are not behind them
    expect(page.replace(/one\(searchParams\.v\) === '(floors|draw)'/g, '').replace(/&v=(floors|draw)/g, '')).not.toMatch(/searchParams\.v\b|variant|&v=/);
  });

  it('keeps the page marked [beta]', () => {
    expect(read('web/app/raid/plan/routes/page.tsx')).toMatch(/title: '\[beta\] Route planner'/);
    expect(page).toMatch(/<NewPageTag /);
  });
});
