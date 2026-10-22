// test/route-planner-model.test.js: the rules behind /raid/plan/routes (web/lib/routePlanner/*), pinned without a browser.
//
// The engine is a ported DOM script; what is worth testing is everything it leans on:
//   • sanitize: the one gate. Caps, numbers only, no author, an old plan with no splits/headcount still reads;
//   • legs: a split replaces the leg it sits on by one run per branch; an optional leg is dashed and out of the totals; a
//     teleport's jump is drawn and NOT counted; a split's time is its slowest branch;
//   • headcount: the raiders a plan needs at once (the main group, or a split's branches added up);
//   • floors: which band a height is on;
//   • build: named + checklist + scripted + the fight-card bosses (first, "on the plan"); a zone with no groups still builds;
//   • compare: tonight's real order against the plan the officers drew that night;
//   • the data: every popGuide key and Mimic raid a build group names exists; the seed is clean (no author).
//
// Run: npx vitest run test/route-planner-model.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';
import {
  sanitize, planLegs, planTotals, legLength, legPoly, plannedHeadcount, floorOf, findPin, removePin, allPins, activeSplits,
  pruneLines, planSame, MAX_PINS,
} from '../web/lib/routePlanner/plan.ts';
import { emptyPlan, MAX_BRANCHES } from '../web/lib/routePlanner/types.ts';
import { buildPlanPins } from '../web/lib/routePlanner/build.ts';
import { createFollow } from '../web/lib/routePlanner/follow.ts';
import { comparePlan, matchKills, pinNumbers } from '../web/lib/routePlanner/compare.ts';
import { fewestLine, fewestByNpc, shortDate } from '../web/lib/routePlanner/fewest.ts';
import { ZONES, zoneData, DEFAULT_ZONE } from '../web/lib/routePlanner/zones/index.ts';
import { makeZone, DEFAULT_FLOORS } from '../web/lib/routePlanner/zones/make.ts';
import { seedFor } from '../web/lib/routePlanner/seeds/index.ts';
import { GUIDE_KEYS, GUIDE_ITEMS } from '../web/lib/popGuide.ts';

const pin = (id, x, y, extra = {}) => ({ id, label: id, kind: 'note', optional: false, x, y, ...extra });
const Z = zoneData('potactics');

describe('sanitize', () => {
  it('reads a plan from before splits, headcount and optional legs as the same plan with none of them', () => {
    const old = { pins: [pin('a', 0, 0), pin('b', 100, 0)], lines: [{ k: 'a>b', pts: [[5, 5]], off: false }], hiddenTracks: ['x:1'], updatedAt: 5, built: { order: 'greedy', at: 1 } };
    const p = sanitize(old);
    expect(p.splits).toEqual([]);
    expect(p.headcount).toBeUndefined();
    expect(p.lines[0]).toEqual({ k: 'a>b', pts: [[5, 5]], off: false });
  });

  it('keeps no author and nothing it does not know', () => {
    const p = sanitize({ pins: [pin('a', 1, 2, { who: 'someone', updatedBy: 'u_1' })], updatedBy: 'u_9', author: 'x' });
    expect(JSON.stringify(p)).not.toMatch(/someone|u_1|u_9|author/);
  });

  it('drops a pin with a bad coordinate and caps the pin list', () => {
    expect(sanitize({ pins: [pin('a', NaN, 0), pin('b', 'x', 0), pin('c', 1, 1)] }).pins.map(p => p.id)).toEqual(['c']);
    const many = Array.from({ length: MAX_PINS + 40 }, (_, i) => pin('p' + i, i, 0));
    expect(sanitize({ pins: many }).pins).toHaveLength(MAX_PINS);
  });

  it('gives duplicate pin ids new ones, across the main route and the branches', () => {
    const p = sanitize({
      pins: [pin('a', 0, 0), pin('b', 9, 0)],
      splits: [{ id: 's', from: 'a', to: 'b', branches: [{ id: 'x', pins: [pin('a', 3, 3)] }, { id: 'y', pins: [] }] }],
    });
    const ids = allPins(p).map(q => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps a split only when both its anchors are main pins and it has two to four branches', () => {
    const base = { pins: [pin('a', 0, 0), pin('b', 9, 0)] };
    const mk = (extra) => sanitize({ ...base, splits: [{ id: 's', from: 'a', to: 'b', branches: [{ id: '1', pins: [] }, { id: '2', pins: [] }], ...extra }] });
    expect(mk({}).splits).toHaveLength(1);
    expect(mk({ branches: [{ id: '1', pins: [] }] }).splits).toHaveLength(0);                              // one branch is not a split
    expect(mk({ to: 'nope' }).splits).toHaveLength(0);
    expect(mk({ branches: Array.from({ length: 7 }, (_, i) => ({ id: 'b' + i, pins: [] })) }).splits[0].branches).toHaveLength(MAX_BRANCHES);
    const p = mk({});
    expect(p.splits[0].branches.map(b => b.label)).toEqual(['Team A', 'Team B']);
    expect(p.splits[0].branches[0].color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('keeps headcounts and roles as whole numbers and short text only', () => {
    const p = sanitize({ pins: [pin('a', 0, 0), pin('b', 9, 0)], headcount: 12, roles: '  2 tanks, 2 clerics ',
      splits: [{ id: 's', from: 'a', to: 'b', branches: [{ id: '1', headcount: 5, roles: 'tank', pins: [] }, { id: '2', headcount: -3, pins: [] }] }] });
    expect(p.headcount).toBe(12);
    expect(p.roles).toBe('2 tanks, 2 clerics');
    expect(p.splits[0].branches[0]).toMatchObject({ headcount: 5, roles: 'tank' });
    expect(p.splits[0].branches[1].headcount).toBeUndefined();
    expect(sanitize({ headcount: 1.5 }).headcount).toBeUndefined();
    expect(sanitize({ headcount: 9999 }).headcount).toBeUndefined();
  });
});

describe('legs', () => {
  const split = (extra = {}) => ({
    id: 's1', from: 'a', to: 'c',
    branches: [
      { id: 'x', label: 'Team A', color: '#2dd4bf', pins: [pin('a1', 0, 100)] },
      { id: 'y', label: 'Team B', color: '#d946ef', pins: [pin('b1', 0, -300), pin('b2', 100, -300)] },
    ], ...extra,
  });
  const withSplit = () => ({ ...emptyPlan(), pins: [pin('a', 0, 0), pin('c', 100, 0), pin('d', 200, 0)], splits: [split()] });

  it('a split replaces the leg it sits on by one run of legs per branch, in the branch colour', () => {
    const legs = planLegs(withSplit(), false);
    expect(legs.map(l => l.k)).toEqual(['a>a1', 'a1>c', 'a>b1', 'b1>b2', 'b2>c', 'c>d']);
    expect(legs.filter(l => l.branch).every(l => l.branch.split.id === 's1')).toBe(true);
    expect(legs.find(l => l.k === 'b1>b2').branch.branch.color).toBe('#d946ef');
    expect(legs.map(l => l.idx)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('a split whose anchors are not neighbours draws nothing and says so', () => {
    const p = withSplit();
    p.pins = [pin('a', 0, 0), pin('d', 200, 0), pin('c', 100, 0)];
    expect(activeSplits(p, false).size).toBe(0);
    expect(planLegs(p, false).every(l => !l.branch)).toBe(true);
  });

  it('a plan with no splits has the legs it always had', () => {
    const p = { ...emptyPlan(), pins: [pin('a', 0, 0), pin('b', 100, 0), pin('c', 100, 100)] };
    expect(planLegs(p, false).map(l => l.k)).toEqual(['a>b', 'b>c']);
  });

  it('a leg marked optional is dashed, kept in the list, and left out in skip mode', () => {
    const p = { ...emptyPlan(), pins: [pin('a', 0, 0), pin('b', 100, 0), pin('c', 100, 100)], lines: [{ k: 'a>b', pts: [], off: false, opt: true }] };
    const [l0, l1] = planLegs(p, false);
    expect(l0.optLeg).toBe(true); expect(l0.dashed).toBe(true); expect(l1.dashed).toBe(false);
    expect(planLegs(p, true).map(l => l.k)).toEqual(['b>c']);
  });

  it('pruneLines keeps a line that only says "optional" or "via", and finds pins in a branch', () => {
    const p = withSplit();
    p.lines = [{ k: 'a>a1', pts: [], off: false, opt: true }, { k: 'a1>c', pts: [], off: false, via: 'T' }, { k: 'a>zzz', pts: [[1, 1]], off: false }, { k: 'a1>c', pts: [], off: false }];
    pruneLines(p);
    expect(p.lines.map(l => l.k)).toEqual(['a>a1', 'a1>c']);
  });

  it('removing a split anchor takes the split with it; removing a branch pin does not', () => {
    let p = withSplit();
    expect(removePin(p, 'a1')).toEqual({ removed: true, droppedSplit: false });
    expect(p.splits[0].branches[0].pins).toHaveLength(0);
    p = withSplit();
    expect(removePin(p, 'c')).toEqual({ removed: true, droppedSplit: true });
    expect(p.splits).toHaveLength(0);
    expect(findPin(p, 'b1')).toBeNull();
  });
});

describe('totals: optional legs and splits', () => {
  const p = {
    ...emptyPlan(),
    pins: [pin('a', 0, 0), pin('c', 1000, 0), pin('d', 1000, 500)],
    splits: [{ id: 's', from: 'a', to: 'c', branches: [
      { id: 'x', label: 'North', color: '#2dd4bf', pins: [pin('n1', 500, 300)] },
      { id: 'y', label: 'South', color: '#d946ef', pins: [pin('s1', 500, -100)] },
    ] }],
    lines: [{ k: 'c>d', pts: [], off: false, opt: true }],
  };
  const secs = { 'a>n1': 60, 'n1>c': 40, 'a>s1': 30, 's1>c': 20, 'c>d': 999 };
  const median = l => (secs[l.k] ?? null);

  it('counts the longest branch of a split, not the sum, and leaves the optional leg out', () => {
    const legs = planLegs(p, false);
    const T = planTotals(legs, median);
    const north = legLength(legs.find(l => l.k === 'a>n1')) + legLength(legs.find(l => l.k === 'n1>c'));
    const south = legLength(legs.find(l => l.k === 'a>s1')) + legLength(legs.find(l => l.k === 's1>c'));
    expect(T.splits).toHaveLength(1);
    expect(T.splits[0].branches.map(b => Math.round(b.pathU))).toEqual([Math.round(north), Math.round(south)]);
    expect(T.pathU).toBeCloseTo(Math.max(north, south), 5);        // c>d is optional: not in the path
    expect(T.timeS).toBe(100);                                     // the slowest branch (60 + 40), not 150, and not the optional leg's 999
    expect(T.splits[0].slowest).toBe(100);
  });

  it('a branch with a leg nobody walked has no honest time, so the split falls back to the branches that do', () => {
    const T = planTotals(planLegs(p, false), l => (l.k === 'n1>c' ? null : median(l)));
    expect(T.splits[0].branches[0].timeS).toBeNull();
    expect(T.splits[0].slowest).toBe(50);
  });

  it('a hidden leg is not in the drawn path', () => {
    const q = { ...p, lines: [{ k: 'a>s1', pts: [], off: true }] };
    const legs = planLegs(q, false);
    expect(planTotals(legs, median).splits[0].branches[1].pathU).toBeCloseTo(legLength(legs.find(l => l.k === 's1>c')), 5);
  });
});

describe('teleports', () => {
  const links = [{ kind: 'teleport', from: [100, 0, 0], to: [900, 0, 80], label: 'Stair pad', key: undefined }];
  const p = { ...emptyPlan(), pins: [pin('a', 0, 0), pin('b', 1000, 0)], lines: [{ k: 'a>b', pts: [], off: false, via: 'Stair pad' }] };

  it('a leg via a teleport walks to it, jumps, and walks on; the jump is drawn but not counted', () => {
    const [leg] = planLegs(p, false, links);
    expect(leg.jump).toMatchObject({ label: 'Stair pad', from: [100, 0], to: [900, 0] });
    expect(legPoly(leg)).toEqual([[0, 0], [100, 0], [900, 0], [1000, 0]]);
    expect(legLength(leg)).toBe(200);                              // 100 + 100, not 1000
  });

  it('a via that names no teleport of the zone is ignored', () => {
    const [leg] = planLegs(p, false, []);
    expect(leg.jump).toBeUndefined();
    expect(legLength(leg)).toBe(1000);
  });
});

describe('headcount', () => {
  it('is the larger of the main group and a split’s branches added up', () => {
    const base = { ...emptyPlan(), pins: [pin('a', 0, 0), pin('b', 9, 0)], headcount: 10 };
    const sp = (a, b) => ({ id: 's', from: 'a', to: 'b', branches: [{ id: 'x', label: 'A', color: '#000000', headcount: a, pins: [] }, { id: 'y', label: 'B', color: '#111111', headcount: b, pins: [] }] });
    expect(plannedHeadcount({ ...base, splits: [sp(4, 5)] }).peak).toBe(10);
    expect(plannedHeadcount({ ...base, splits: [sp(7, 6)] }).peak).toBe(13);
    expect(plannedHeadcount({ ...base, headcount: undefined, splits: [sp(7, 6)] }).peak).toBe(13);
  });
  it('is unknown, not zero, when nothing is filled in', () => {
    expect(plannedHeadcount(emptyPlan()).peak).toBeNull();
    expect(plannedHeadcount({ ...emptyPlan(), headcount: 0 }).peak).toBe(0);
  });
});

describe('floors', () => {
  it('finds the band a height is on, with open ends', () => {
    expect(floorOf(DEFAULT_FLOORS, 200).key).toBe('up');
    expect(floorOf(DEFAULT_FLOORS, 50).key).toBe('mid');
    expect(floorOf(DEFAULT_FLOORS, -290).key).toBe('pit');
    expect(floorOf(DEFAULT_FLOORS, undefined)).toBeNull();
  });
  it('handles a tower with many levels', () => {
    const tower = Array.from({ length: 8 }, (_, i) => ({ key: 'f' + i, label: 'Level ' + i, zmin: i * 100, zmax: i * 100 + 99 }));
    expect(floorOf(tower, 735).key).toBe('f7');
    expect(floorOf(tower, 801)).toBeNull();
  });
});

describe('zones', () => {
  it('registers Tactics and the Sol Ro tower, each by its own short name', () => {
    expect(Object.keys(ZONES)).toEqual(['potactics', 'solrotower']);
    expect(DEFAULT_ZONE).toBe('potactics');
    expect(zoneData('nope')).toBeNull();
    expect(zoneData('__proto__')).toBeNull();
  });

  it('a zone with no recorded nights, no pathers and no links is still a whole zone', () => {
    const z = zoneData('solrotower');
    expect(z.zoneId).toBe(212);
    expect(z.nights).toEqual([]);
    expect(z.pathers).toEqual([]);
    expect(z.links).toEqual([]);
    expect(z.floors.length).toBeGreaterThan(0);
    expect(z.mobs.some(m => m.id === z.start.mob)).toBe(true);     // the build always has its start
    const fol = createFollow(z.nights);
    expect(fol.legStats({ x: 0, y: 0 }, { x: 900, y: 0 })).toMatchObject({ nights: 0, median: null });
    expect(fol.followPath({ x: 0, y: 0 }, { x: 900, y: 0 })).toBeNull();
  });

  it('a data file can carry its own floors, pathers, links and settings, and they win', () => {
    const z = makeZone({ zone: 'zz', zoneId: 1, name: 'Z' }, {
      walls: { f0: [0, 0, 10, 0] }, nights: [], mobs: [],
      floors: [{ key: 'f0', label: 'Ground', zmax: 10 }, { key: 'f1', label: 'Up', zmin: 11 }],
      pathers: [{ id: 'p', npc_names: ['a guard'], points: [[0, 0, 0], [50, 0, 0]], loop: true }],
      links: [{ kind: 'locked', from: [5, 5, 0], to: null, label: 'Door', key: 'A Key' }],
      config: { title: 'Mine', zoneId: 7 },
    });
    expect(z.floors.map(f => f.key)).toEqual(['f0', 'f1']);
    expect(z.pathers).toHaveLength(1);
    expect(z.links[0].key).toBe('A Key');
    expect(z.title).toBe('Mine'); expect(z.zoneId).toBe(7);
    expect(z.bounds.x1).toBeGreaterThan(z.bounds.x0);               // sized from what it draws
  });

  it('every build group of every zone names mobs, popGuide steps and Mimic raids that exist', () => {
    const pop = fs.readFileSync(path.join(ROOT, 'apps/mimic/pop-raids.js'), 'utf8');
    for (const z of Object.values(ZONES)) {
      const ids = new Set(z.mobs.map(m => m.id));
      for (const k of z.popKeys) expect(GUIDE_KEYS.has(k), `${z.zone}: popGuide has no step ${k}`).toBe(true);
      for (const g of z.groups) {
        if (g.popKey) expect(GUIDE_KEYS.has(g.popKey), `${z.zone}/${g.id}: popGuide has no step ${g.popKey}`).toBe(true);
        if (g.mimicRaid) expect(pop.includes(`id: '${g.mimicRaid}'`), `${z.zone}/${g.id}: pop-raids.js has no raid ${g.mimicRaid}`).toBe(true);
        for (const s of g.pins) expect(ids.has(s.mob), `${z.zone}/${g.id}: no mob ${s.mob}`).toBe(true);
      }
    }
  });
});

describe('build from the checklist', () => {
  let n = 0;
  const uid = () => 'u' + ++n;
  const checklist = Z.popKeys.map(key => ({ key, title: GUIDE_ITEMS.find(i => i.key === key).title }));
  const run = (extra = {}) => buildPlanPins({ zone: Z, mobs: Z.mobs, order: 'greedy', onPlanNpcs: [], checklist, uid, ...extra });

  it('lays down the start, the named, the checklist objectives and the scripted event chain with its Projections', () => {
    const { pins } = run();
    const labels = pins.map(p => p.label);
    expect(labels[0]).toBe('Zone-in');
    for (const want of ['Giwin Mirakon', 'Eriak', 'Vallon Zek (north wing)', 'Tallon Zek (south wing)', 'Decorin Berik', 'Decorin Grunhork',
      'Tallon Zek (event)', 'Vallon Zek (event)', 'Rallos Zek (upstairs, War Room)', 'Rallos Zek the Warlord (pit)',
      'Hail Planar Projection (Rallos)', 'Hail Planar Projection (Tallon)', 'Hail Planar Projection (Vallon)',
      'The Diaku Overseer', 'Tagrin Maldric', 'Glykus Helmir']) expect(labels, want).toContain(want);
    expect(pins.find(p => p.label === 'Giwin Mirakon').optional).toBe(true);
    expect(pins.find(p => p.label === 'Eriak').optional).toBe(true);
    expect(pins.find(p => p.mob === 'tallon_ev').kind).toBe('scripted');
    expect(new Set(pins.map(p => p.id)).size).toBe(pins.length);
  });

  it('keeps the Rallos event one chain, in order, in both orders', () => {
    for (const order of ['greedy', 'checklist']) {
      const mobs = run({ order }).pins.map(p => p.mob);
      const at = ['berik', 'grunhork'].map(m => mobs.indexOf(m)).sort((a, b) => a - b);
      const chain = [mobs[at[0]], mobs[at[1]], ...mobs.slice(at[1] + 1, at[1] + 6)];
      expect(chain.slice(2)).toEqual(['tallon_ev', 'vallon_ev', 'rallos_up', 'warlord', 'proj_rallos']);
    }
  });

  it('the checklist order follows the guide: Vallon, Tallon, the Rallos event, then the west wing', () => {
    const mobs = run({ order: 'checklist' }).pins.map(p => p.mob);
    const first = m => mobs.indexOf(m);
    expect(first('vallon_home')).toBeLessThan(first('tallon_home'));
    expect(first('tallon_home')).toBeLessThan(first('berik'));
    expect(first('berik')).toBeLessThan(first('tagrin'));
    expect(first('tagrin')).toBeLessThan(first('overseer'));
    expect(first('overseer')).toBeLessThan(first('glykus'));
    expect(mobs[1]).toBe('giwin');                                  // the hail on the way in comes right after the zone-in
  });

  it('puts the bosses on the fight cards first and marks them on the plan', () => {
    const { pins, onPlanPins, note } = run({ order: 'checklist', onPlanNpcs: [214054] });   // Tagrin: last in the checklist order
    const mobs = pins.map(p => p.mob);
    expect(mobs.indexOf('tagrin')).toBeLessThan(mobs.indexOf('vallon_home'));
    expect(pins.find(p => p.mob === 'tagrin').onPlan).toBe(true);
    expect(pins.find(p => p.mob === 'eriak').onPlan).toBeUndefined();   // the named beside him is not on a card
    expect(onPlanPins).toBe(1);
    expect(note).toMatch(/on the plan/);
  });

  it('adds a fight-card boss the zone data has no group for, from the mobs it was given', () => {
    const extra = { tier: 1, id: 'npc214999', name: 'A New Boss', kind: 'boss', npc: 214999, x: 5, y: 6 };
    const { pins } = run({ mobs: [...Z.mobs, extra], onPlanNpcs: [214999] });
    expect(pins[2].mob).toBe('npc214999');                          // on the plan, so first (after the zone-in and the hail on the way in)
    expect(pins.find(p => p.mob === 'npc214999').onPlan).toBe(true);
  });

  it('builds a zone that has no groups of its own from its bosses and named', () => {
    const z = makeZone({ zone: 'zz', zoneId: 9, name: 'Z' }, {
      walls: {}, nights: [],
      mobs: [
        { tier: 1, id: 'zonein', name: 'Zone-in', kind: 'door', x: 0, y: 0 },
        { tier: 1, id: 'b1', name: 'Boss One', kind: 'boss', npc: 9001, x: 500, y: 0 },
        { tier: 2, id: 'n1', name: 'Named One', kind: 'named', npc: 9002, x: 100, y: 0 },
      ],
    });
    const { pins } = buildPlanPins({ zone: z, mobs: z.mobs, order: 'greedy', onPlanNpcs: [], checklist: [], uid });
    expect(pins.map(p => p.mob)).toEqual(['zonein', 'n1', 'b1']);   // nearest first
    expect(pins[1].optional).toBe(true);                            // a named is optional, a boss is not
    expect(pins[2].optional).toBe(false);
  });

  it('an empty zone builds just its start and does not throw', () => {
    const z = zoneData('solrotower');
    const r = buildPlanPins({ zone: z, mobs: z.mobs, order: 'greedy', onPlanNpcs: [], checklist: [], uid });
    expect(r.pins).toHaveLength(1);
  });
});

describe('compare a night with the plan', () => {
  const seed = seedFor('potactics').plan;
  // 2026-10-21: Vallon, Tallon, Decorin Berik, Decorin Grunhork, Rallos Zek the Warlord, Diaku Overseer, Tagrin
  const stop = (n, npc_id, name, x, y) => ({ n, npc_id, name, x, y, at: 'spawn', medianClockS: n * 100 });
  const stops = [
    stop(1, 214317, 'Vallon Zek', -812, 2157), stop(2, 214026, 'Tallon Zek', -619, -1958), stop(3, 214056, 'Decorin Berik', 319, 301),
    stop(4, 214057, 'Decorin Grunhork', 320, -286), stop(5, 214312, 'Rallos Zek the Warlord', 576, -253),
    stop(6, 214092, 'The Diaku Overseer', 1375, 23), stop(7, 214054, 'Tagrin Maldric', 1357, 2141),
  ];
  const line = (len) => [[0, 0], [len, 0]];
  const actual = {
    label: '2026-10-21', stops,
    legs: stops.map((s, i) => ({ from: i ? stops[i - 1].name : 'First engage', to: s.name, medianS: 60 + i, pts: line(1000 + i * 100) })),
    path: [],
  };

  it('matches each kill to the pin of the same boss, the nearest one when a name is on two pins', () => {
    const m = matchKills(seed, stops);
    const labelOf = i => m.get(i).label;
    expect(labelOf(0)).toBe('Vallon Zek (north wing)');
    expect(labelOf(1)).toBe('Tallon Zek (south wing)');             // not the event Tallon: the kill was in the south wing
    expect(labelOf(4)).toBe('Rallos Zek the Warlord (pit)');
    expect(m.size).toBe(7);
  });

  it('tonight’s plan against tonight: the legs walked, what the plan had that the night never killed', () => {
    const c = comparePlan(seed, false, actual);
    expect(c.actualOrder.map(a => a.name)).toEqual(stops.map(s => s.name));
    expect(c.notInPlan).toEqual([]);
    // planned kill pins the night never made: the event Tallon and Vallon and upstairs Rallos, and Eriak and Glykus
    const never = c.neverVisited.map(n => n.name);
    expect(never).toEqual(expect.arrayContaining(['Tallon Zek (event)', 'Vallon Zek (event)', 'Rallos Zek (upstairs, War Room)', 'Glykus Helmir']));
    expect(never).not.toContain('Tagrin Maldric');
    // Vallon -> Tallon (planned legs 2 -> 3): killed 1st and 2nd, nothing between, the second kill's leg is the actual walk
    const leg = c.legs.find(l => l.leg.a.label.startsWith('Vallon Zek (north') && l.leg.b.label.startsWith('Tallon Zek (south'));
    expect(leg).toMatchObject({ status: 'walked', actualOrder: [1, 2], between: 0 });
    expect(leg.actualU).toBe(1100);                                 // actual.legs[1]: 1000 + 100
    expect(leg.actualS).toBe(61);
    expect(leg.plannedU).toBeGreaterThan(0);
  });

  it('a pair killed in the other order is called reversed, with no length', () => {
    const swapped = { ...actual, stops: [stops[1], stops[0], ...stops.slice(2)].map((s, i) => ({ ...s, n: i + 1 })), legs: actual.legs };
    const c = comparePlan(seed, false, swapped);
    const leg = c.legs.find(l => l.leg.a.label.startsWith('Vallon Zek (north') && l.leg.b.label.startsWith('Tallon Zek (south'));
    expect(leg.status).toBe('reversed');
    expect(leg.actualU).toBeNull();
  });

  it('a kill the plan has no pin for is listed as not in the plan; a skipped kill in between is counted', () => {
    const extra = [...stops.slice(0, 2), stop(3, 999999, 'A Surprise', 0, 0), ...stops.slice(2).map(s => ({ ...s, n: s.n + 1 }))];
    const c = comparePlan(seed, false, { ...actual, stops: extra, legs: extra.map(() => ({ from: '', to: '', medianS: 10, pts: line(100) })) });
    expect(c.notInPlan).toEqual([{ n: 3, name: 'A Surprise' }]);
    const leg = c.legs.find(l => l.leg.a.label.startsWith('Tallon Zek (south') && l.leg.b.label === 'Decorin Berik');
    expect(leg.between).toBe(1);
    expect(leg.actualU).toBe(200);                                  // two actual legs of 100
  });

  it('numbers the pins of a branch A1, A2, B1 so a split reads in the table', () => {
    const p = { ...emptyPlan(), pins: [pin('a', 0, 0), pin('b', 9, 0)], splits: [{ id: 's', from: 'a', to: 'b', branches: [
      { id: 'x', label: 'A', color: '#000000', pins: [pin('a1', 1, 1), pin('a2', 2, 2)] }, { id: 'y', label: 'B', color: '#111111', pins: [pin('b1', 3, 3)] }] }] };
    const nums = pinNumbers(p);
    expect([...nums.values()]).toEqual(['1', '2', 'A1', 'A2', 'B1']);
  });
});

describe('fewest raiders so far', () => {
  const row = { npc_id: 1, raiders: 18, night: '2026-10-09', classes: [{ cls: 'Cleric', n: 3 }, { cls: 'Warrior', n: 2 }, { cls: 'Shadow Knight', n: 1 }] };
  it('reads as one line', () => {
    expect(fewestLine(row)).toBe('fewest: 18 raiders, Oct 9 — 3 clerics, 2 warriors, 1 shadow knight');
    expect(fewestLine({ ...row, raiders: 1, classes: [] })).toBe('fewest: 1 raider, Oct 9');
    expect(shortDate('nonsense')).toBe('');
  });
  it('keeps the smallest group per boss', () => {
    const m = fewestByNpc([row, { ...row, raiders: 12, night: '2026-10-12' }, { ...row, npc_id: 2, raiders: 30 }]);
    expect(m.get(1).raiders).toBe(12);
    expect(m.get(2).raiders).toBe(30);
  });
  it('the server hook answers nothing until the real data is wired in', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'web/lib/routePlanner/fewestKills.ts'), 'utf8');
    expect(src).toMatch(/export async function fewestKills\(/);
    expect(src).toMatch(/return \[\];/);
  });
});

describe('the committed plan from 2026-10-21', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/lib/routePlanner/seeds/potactics-2026-10-21.json'), 'utf8'));
  it('carries no author and survives the gate unchanged', () => {
    expect(raw.updatedBy).toBeUndefined();
    expect(JSON.stringify(raw)).not.toMatch(/updatedBy|u_[A-Za-z0-9_-]{10,}/);
    const clean = sanitize(raw);
    expect(clean.pins).toEqual(raw.pins);                           // nothing the gate would drop or change
    expect(clean.lines).toEqual(raw.lines);
    expect(clean.pins).toHaveLength(14);
  });
  it('every label is an NPC name or an objective of the zone, never a person', () => {
    const names = new Set(Z.mobs.map(m => m.name));
    for (const p of raw.pins) {
      expect(names.has(p.label) || p.label === 'Zone-in door' || p.label === p.label.replace(/\s+/g, ' ')).toBe(true);
      if (p.mob) expect(Z.mobs.some(m => m.id === p.mob), p.label).toBe(true);
    }
  });
  it('is offered for Tactics and for nothing else', () => {
    expect(seedFor('potactics').label).toMatch(/Oct 21/);
    expect(seedFor('solrotower')).toBeNull();
    expect(seedFor('__proto__')).toBeNull();
  });
});
