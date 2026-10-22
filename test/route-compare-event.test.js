// test/route-compare-event.test.js: the route planner's Compare tab on the night of the Rallos event.
//
// The recorder stores a brother killed at the event under his HOME npc id (encounters are written by name), so Compare
// listed "Tallon Zek (event)", "Vallon Zek (event)" and upstairs Rallos as never visited for a raid that fought them in the
// War Room (the guild lead, 2026-10-22). The night below is built from the shape of 2026-10-21 with invented raider data:
// the raid centre sits in the wings for the home kills and in the War Room for the event ones.
//   • a home-id kill whose raid centre is inside the War Room box is the EVENT brother (214313 / 214320), always named;
//   • a home kill, and a kill with no track at all, stays home (fail-safe);
//   • an event brother keeps his LAST row (a short early row is not the death); one card with two rows of one death is one kill;
//   • matchKills puts each kill on the pin of its own npc id before it tries names;
//   • a planned pin with no kill that the night's path came within FOLLOW_R of reads "passed", else "never visited".
//
// Run: npx vitest run test/route-compare-event.test.js

import { describe, it, expect } from 'vitest';
import {
  centroidSeries, analyzeNight, averageRoute, routeBasis, nightPath, ZONE_EVENTS,
} from '../web/lib/raidRoutes.ts';
import { comparePlan, matchKills } from '../web/lib/routePlanner/compare.ts';
import { FOLLOW_R } from '../web/lib/routePlanner/follow.ts';
import { zoneData } from '../web/lib/routePlanner/zones/index.ts';
import { seedFor } from '../web/lib/routePlanner/seeds/index.ts';

const T0 = Date.UTC(2026, 9, 22, 0, 0, 0);
const at = (sec) => T0 + sec * 1000;
const EV = ZONE_EVENTS.potactics;

// The raid centre over time: straight lines between these [sec, x, y] waypoints, one frame every 3 s, 10 raiders.
const WAY = [
  [0, -812, 2000], [300, -812, 2000],              // north wing: home Vallon
  [360, -619, -1958], [560, -619, -1958],          // south wing: home Tallon
  [640, 319, 301], [700, 320, -286],               // the Decorins
  [780, 600, 100], [1500, 600, 100],               // the War Room: event Vallon, event Tallon
  [2300, 705, 0], [2400, 1375, 23], [2600, 1375, 23],   // the pit, then the east
];
const posAt = (s) => {
  for (let i = 1; i < WAY.length; i++) {
    if (s <= WAY[i][0]) {
      const [t0, x0, y0] = WAY[i - 1], [t1, x1, y1] = WAY[i], f = (s - t0) / (t1 - t0);
      return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
    }
  }
  return [WAY[WAY.length - 1][1], WAY[WAY.length - 1][2]];
};
const frames = [];
for (let s = 0; s <= 2600; s += 3) {
  const [x, y] = posAt(s);
  frames.push({ t: at(s), raiders: Array.from({ length: 10 }, (_, i) => ({ i, name: `r${i}`, cls: null, group: null, level: 60, x: x + (i % 3) - 1, y: y + (i % 2), z: 0, h: null, hp: null, zone: 'potactics' })) });
}
const series = centroidSeries(frames, 'potactics');

const enc = (id, npc, name, a, b) => ({ id, npc_id: npc, name, started: at(a), ended: b == null ? null : at(b) });
const NAMED = new Set([214316, 214026, 214056, 214057, 214312, 214092, 214054]);   // bosses_local knows only the HOME ids
const ENCS = [
  enc(1, 5001, 'a Diaku guard', 20, 30),
  enc(2, 214316, 'Vallon Zek', 100, 140),                  // home Vallon
  enc(3, 214316, 'Vallon Zek', 200, 204),                  // the split figures, 4 s, still the wing
  enc(4, 214026, 'Tallon Zek', 400, 500),                  // home Tallon
  enc(5, 214056, 'Decorin Berik', 650, 660),
  enc(6, 214057, 'Decorin Grunhork', 700, 710),
  enc(7, 214316, 'Vallon Zek', 900, 951),                  // EVENT Vallon, stored under the home id
  enc(8, 214026, 'Tallon Zek', 953, 961),                  // 8 s in the War Room: not a death
  enc(9, 214026, 'Tallon Zek', 1300, 1375),                // EVENT Tallon: the real death
  enc(10, 214312, 'Rallos Zek the Warlord', 1400, 2300),
  enc(11, 214312, 'Rallos Zek the Warlord', 2200, 2300),   // the same death on a second card
  enc(12, 214092, 'The Diaku Overseer', 2400, 2450),
  enc(13, 214054, 'Tagrin Maldric', 2500, 2550),
];
const night = (encs = ENCS, s = series, ev = EV) => analyzeNight('k', { from: at(0), to: at(3000) }, s, encs, NAMED, ev);

describe('event brothers are re-keyed by where the raid stood', () => {
  it('the War Room kills are 214313 / 214320, the wing kills stay home, in the order they died', () => {
    const n = night();
    expect(n.named.map(k => k.npc_id)).toEqual([214316, 214026, 214056, 214057, 214320, 214313, 214312, 214092, 214054]);
    expect(n.named.find(k => k.npc_id === 214320)).toMatchObject({ name: 'Vallon Zek (event)', start: at(900), end: at(951) });
    expect(n.named.find(k => k.npc_id === 214026)).toMatchObject({ name: 'Tallon Zek', start: at(400) });
    expect(n.named.find(k => k.npc_id === 214316)).toMatchObject({ start: at(100) });   // first row of the wing Vallon, not the 4 s one
    expect(n.trash).toHaveLength(1);                                                   // re-keyed kills are named, never trash
  });

  it('the event Tallon keeps his LAST row: the 8 s row in the War Room is not the death', () => {
    const t = night().named.find(k => k.npc_id === 214313);
    expect(t).toMatchObject({ name: 'Tallon Zek (event)', start: at(1300), end: at(1375) });
  });

  it('one death on two cards is one kill, with the earlier start', () => {
    const w = night().named.filter(k => k.npc_id === 214312);
    expect(w).toHaveLength(1);
    expect(w[0].start).toBe(at(1400));
  });

  it('an event brother on two cards with one death keeps the earlier start; a later death replaces him', () => {
    const dup = [...ENCS, enc(14, 214026, 'Tallon Zek', 1330, 1375)];
    const t = night(dup).named.filter(k => k.npc_id === 214313);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ start: at(1300), end: at(1375) });
  });

  it('a kill with no track stays on the home id (fail-safe)', () => {
    const n = night(ENCS, []);
    expect(n.named.some(k => k.npc_id === 214313 || k.npc_id === 214320)).toBe(false);
    expect(n.named.filter(k => k.npc_id === 214026)).toHaveLength(1);
  });

  it('a zone with no event table is untouched', () => {
    const n = night(ENCS, series, null);       // not undefined: the helper's default would put the table back
    expect(n.named.some(k => k.npc_id === 214313 || k.npc_id === 214320)).toBe(false);
  });

  it('the box is the planner\'s War Room box', () => {
    const f = zoneData('potactics').focus;
    expect(EV.box).toEqual({ minX: f.x0, maxX: f.x1, minY: f.y0, maxY: f.y1 });
  });
});

describe('Compare lays the night over the plan', () => {
  const seed = seedFor('potactics').plan;
  const n = night();
  const stops = routeBasis([n]).stops;
  const route = averageRoute([n], new Map());
  const actual = {
    label: '2026-10-21', stops: route.stops,
    legs: route.legs.map(l => ({ from: l.from, to: l.to, medianS: l.medianS, pts: l.pts })),
    path: nightPath(n, stops),
  };

  it('the Actual order lists both event brothers by their event names', () => {
    const c = comparePlan(seed, false, actual);
    expect(c.actualOrder.map(a => a.name)).toEqual([
      'Vallon Zek', 'Tallon Zek', 'Decorin Berik', 'Decorin Grunhork', 'Vallon Zek (event)', 'Tallon Zek (event)',
      'Rallos Zek the Warlord', 'The Diaku Overseer', 'Tagrin Maldric',
    ]);
    expect(c.notInPlan).toEqual([]);
  });

  it('each kill lands on its own pin and the event pins are visited', () => {
    const c = comparePlan(seed, false, actual);
    const killed = Object.fromEntries(c.plannedOrder.map(p => [p.name, p.killed]));
    expect(killed['Vallon Zek (north wing)']).toBe(1);
    expect(killed['Tallon Zek (south wing)']).toBe(2);
    expect(killed['Vallon Zek (event)']).toBe(5);
    expect(killed['Tallon Zek (event)']).toBe(6);
    expect(c.neverVisited.map(p => p.name)).not.toContain('Vallon Zek (event)');
    expect(c.neverVisited.map(p => p.name)).not.toContain('Tallon Zek (event)');
  });

  it('upstairs Rallos, who never dies, reads "passed"; what the path never came near stays "never visited"', () => {
    const c = comparePlan(seed, false, actual);
    expect(c.passed.map(p => p.name)).toContain('Rallos Zek (upstairs, War Room)');
    expect(c.neverVisited.map(p => p.name)).not.toContain('Rallos Zek (upstairs, War Room)');
    expect(c.neverVisited.map(p => p.name)).toContain('Glykus Helmir');
    expect(c.plannedOrder.find(p => p.name === 'Glykus Helmir').passed).toBe(false);
  });

  it('a path that stays further than FOLLOW_R from the pin does not pass it', () => {
    const up = seed.pins.find(p => p.label === 'Rallos Zek (upstairs, War Room)') ?? seed.splits.flatMap(s => s.branches.flatMap(b => b.pins)).find(p => p.label === 'Rallos Zek (upstairs, War Room)');
    const near = comparePlan(seed, false, { ...actual, path: [[up.x + FOLLOW_R - 5, up.y], [up.x + FOLLOW_R - 5, up.y + 50]] });
    const far = comparePlan(seed, false, { ...actual, path: [[up.x + FOLLOW_R + 5, up.y], [up.x + FOLLOW_R + 5, up.y + 50]] });
    expect(near.passed.map(p => p.name)).toContain(up.label);
    expect(far.passed.map(p => p.name)).not.toContain(up.label);
    expect(far.neverVisited.map(p => p.name)).toContain(up.label);
    // a segment passes it even when no sample is near: the path jumps from one side to the other
    const across = comparePlan(seed, false, { ...actual, path: [[up.x - 2000, up.y + 10], [up.x + 2000, up.y + 10]] });
    expect(across.passed.map(p => p.name)).toContain(up.label);
  });

  it('with no path at all nothing is passed', () => {
    expect(comparePlan(seed, false, { ...actual, path: [] }).passed).toEqual([]);
  });
});

describe('matchKills asks the npc id before the name', () => {
  const seed = seedFor('potactics').plan;
  it('an event kill that happens to sit nearest the HOME pin still takes the event pin', () => {
    const m = matchKills(seed, [{ n: 1, npc_id: 214313, name: 'Tallon Zek (event)', x: -619, y: -1958, at: 'raid', medianClockS: 0 }]);
    expect(m.get(0).label).toBe('Tallon Zek (event)');
  });
  it('a kill with no pin of its id still falls back to its name', () => {
    const m = matchKills(seed, [{ n: 1, npc_id: 999999, name: 'Tallon Zek', x: 0, y: 0, at: 'raid', medianClockS: 0 }]);
    expect(m.get(0).label).toMatch(/^Tallon Zek/);
  });
});
