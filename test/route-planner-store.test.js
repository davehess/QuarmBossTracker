// test/route-planner-store.test.js: what bot_kv `route_plan:<zone>` holds and how it changes, the conversion to the in-game
// map's `raid_route:<zone>` shape, and the officer gate in every write action.
//
//   • storage: several plans per zone (main + off-night), versions capped at 30 newest first, newest wins, the ten-minute
//     checkpoint, a restore that loses nothing, the version-1 single-plan row read as `plans.main`;
//   • the conversion: its keys are EXACTLY the keys web/app/raid/routes/actions.ts saves (read from that source), so Mimic's
//     Map overlay draws a planned route the way it draws a measured one; splits and teleports flatten into it;
//   • the actions: every write refuses a signed-out user and a non-officer BEFORE it reads or writes anything.
//
// Run: npx vitest run test/route-planner-store.test.js

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripJs } from './_source-slice.js';
import {
  parseStore, applySave, applyRestore, applyImport, applyCreatePlan, applyRenamePlan, applyDeletePlan, planSummaries, versionRows,
  MAX_VERSIONS, MAX_PLANS, AUTO_VERSION_MS, MAIN_PLAN, STORE_V, storeKey,
} from '../web/lib/routePlanner/store.ts';
import { emptyPlan } from '../web/lib/routePlanner/types.ts';
import { sanitize } from '../web/lib/routePlanner/plan.ts';
import { planToRaidRoute } from '../web/lib/routePlanner/toRaidRoute.ts';
import { createFollow } from '../web/lib/routePlanner/follow.ts';
import { zoneData } from '../web/lib/routePlanner/zones/index.ts';
import { seedFor } from '../web/lib/routePlanner/seeds/index.ts';

const Z = zoneData('potactics');
const { slim } = createRequire(import.meta.url)('../utils/raidRoute.js');   // what the bot serves to Mimic's Map
const pin = (id, x, y, extra = {}) => ({ id, label: id, kind: 'note', optional: false, x, y, ...extra });
const plan = (n, extra = {}) => ({ ...emptyPlan(), pins: Array.from({ length: n }, (_, i) => pin('p' + i, i * 10, 0)), ...extra });
const T0 = Date.UTC(2026, 9, 21, 20, 0, 0);
const at = (min) => new Date(T0 + min * 60_000).toISOString();

describe('one plan per zone: the main-night plan', () => {
  it('the first save creates the store: version 2, a main plan, no versions yet, the author nowhere', () => {
    const { store, versioned } = applySave(null, MAIN_PLAN, plan(3), 'potactics', at(0));
    expect(versioned).toBeNull();
    expect(store).toMatchObject({ v: STORE_V, zone: 'potactics', updated_at: at(0) });
    expect(Object.keys(store.plans)).toEqual(['main']);
    expect(store.plans.main).toMatchObject({ name: 'Main night', night_type: 'main', updated_at: at(0), versions: [] });
    expect(store.plans.main.current.pins).toHaveLength(3);
    expect(JSON.stringify(store)).not.toMatch(/updatedBy|user|email/i);
    expect(storeKey('potactics')).toBe('route_plan:potactics');
  });

  it('newest wins: a save replaces the current plan outright', () => {
    let { store } = applySave(null, MAIN_PLAN, plan(2), 'z', at(0));
    ({ store } = applySave(store, MAIN_PLAN, plan(5), 'z', at(1)));
    ({ store } = applySave(store, MAIN_PLAN, plan(4), 'z', at(2)));
    expect(store.plans.main.current.pins).toHaveLength(4);
    expect(store.updated_at).toBe(at(2));
  });

  it('a clock in the future is not newer than the server', () => {
    const p = plan(2); p.updatedAt = T0 + 10 * 86_400_000;
    const { store } = applySave(null, MAIN_PLAN, p, 'z', at(0));
    expect(store.plans.main.current.updatedAt).toBe(T0);
  });

  it('Save version pushes the plan as it is now; pressing it again with nothing changed says so', () => {
    let { store } = applySave(null, MAIN_PLAN, plan(2), 'z', at(0));
    let out = applySave(store, MAIN_PLAN, plan(3), 'z', at(1), { version: true });
    expect(out.versioned).toBe('manual');
    expect(out.store.plans.main.versions).toHaveLength(1);
    expect(out.store.plans.main.versions[0]).toMatchObject({ saved_at: at(1) });
    expect(out.store.plans.main.versions[0].plan.pins).toHaveLength(3);
    out = applySave(out.store, MAIN_PLAN, plan(3), 'z', at(2), { version: true });
    expect(out.versioned).toBe('same');
    expect(out.store.plans.main.versions).toHaveLength(1);
  });

  it('keeps the state an edit replaced, at most once every ten minutes', () => {
    let { store } = applySave(null, MAIN_PLAN, plan(2), 'z', at(0));
    let out = applySave(store, MAIN_PLAN, plan(3), 'z', at(1));            // first edit: keeps the 2-pin plan it replaced
    expect(out.versioned).toBe('auto');
    expect(out.store.plans.main.versions[0].plan.pins).toHaveLength(2);
    out = applySave(out.store, MAIN_PLAN, plan(4), 'z', at(5));            // four minutes later: not yet
    expect(out.versioned).toBeNull();
    expect(out.store.plans.main.versions).toHaveLength(1);
    out = applySave(out.store, MAIN_PLAN, plan(5), 'z', at(1 + AUTO_VERSION_MS / 60_000 + 1));   // ten minutes on: the 4-pin state is kept
    expect(out.versioned).toBe('auto');
    expect(out.store.plans.main.versions).toHaveLength(2);
    expect(out.store.plans.main.versions[0].plan.pins).toHaveLength(4);
  });

  it('never versions an empty plan or an unchanged one', () => {
    let { store } = applySave(null, MAIN_PLAN, plan(0), 'z', at(0));
    expect(applySave(store, MAIN_PLAN, plan(2), 'z', at(30)).versioned).toBeNull();      // what it replaced had no pins
    ({ store } = applySave(store, MAIN_PLAN, plan(2), 'z', at(31)));
    expect(applySave(store, MAIN_PLAN, plan(2), 'z', at(60)).versioned).toBeNull();      // nothing differs
  });

  it('keeps only the newest 30 versions, newest first', () => {
    let { store } = applySave(null, MAIN_PLAN, plan(1), 'z', at(0));
    for (let i = 1; i <= 40; i++) ({ store } = applySave(store, MAIN_PLAN, plan(1 + i), 'z', at(i), { version: true }));
    const v = store.plans.main.versions;
    expect(v).toHaveLength(MAX_VERSIONS);
    expect(v[0].saved_at).toBe(at(40));
    expect(v[0].plan.pins).toHaveLength(41);
    expect(v[MAX_VERSIONS - 1].saved_at).toBe(at(40 - (MAX_VERSIONS - 1)));
  });

  it('a restore makes the version current and keeps what it replaced as a version first', () => {
    let { store } = applySave(null, MAIN_PLAN, plan(2), 'z', at(0));
    ({ store } = applySave(store, MAIN_PLAN, plan(3), 'z', at(1), { version: true }));
    ({ store } = applySave(store, MAIN_PLAN, plan(6), 'z', at(2)));
    const next = applyRestore(store, MAIN_PLAN, at(1), at(3));
    expect(next.plans.main.current.pins).toHaveLength(3);
    expect(next.plans.main.versions[0].plan.pins).toHaveLength(6);          // the 6-pin plan it replaced
    expect(next.plans.main.versions.some(v => v.saved_at === at(1))).toBe(true);
    expect(applyRestore(store, MAIN_PLAN, at(99), at(3))).toBeNull();
  });
});

describe('several plans per zone', () => {
  const base = () => applySave(null, MAIN_PLAN, plan(4), 'z', at(0)).store;

  it('adds an off-night plan, blank or copied from another, and does not touch the main one', () => {
    const blank = applyCreatePlan(base(), 'z', 'Off-night: Tallon only', null, at(1), 'otal');
    expect(blank.id).toBe('otal');
    expect(blank.store.plans.otal).toMatchObject({ name: 'Off-night: Tallon only', night_type: 'off', versions: [] });
    expect(blank.store.plans.otal.current.pins).toHaveLength(0);
    expect(blank.store.plans.main.current.pins).toHaveLength(4);
    const copy = applyCreatePlan(base(), 'z', 'Copy', MAIN_PLAN, at(1), 'ocopy');
    expect(copy.store.plans.ocopy.current.pins).toHaveLength(4);
    expect(applyCreatePlan(base(), 'z', 'x', 'nope', at(1))).toBeNull();
  });

  it('can start from nothing stored: a blank main plan appears with the first off-night plan', () => {
    const out = applyCreatePlan(null, 'z', 'First', null, at(1), 'ofirst');
    expect(Object.keys(out.store.plans)).toEqual(['ofirst']);
    expect(planSummaries(out.store).map(p => p.id)).toEqual(['main', 'ofirst']);       // main always listed first
  });

  it('refuses a plan past the cap', () => {
    let s = base();
    for (let i = 1; i < MAX_PLANS; i++) s = applyCreatePlan(s, 'z', 'p' + i, null, at(i), 'o' + i).store;
    expect(Object.keys(s.plans)).toHaveLength(MAX_PLANS);
    expect(applyCreatePlan(s, 'z', 'one too many', null, at(99))).toBeNull();
  });

  it('only a plan that exists can be saved to; only main can start from nothing', () => {
    expect(applySave(base(), 'ogone', plan(1), 'z', at(1))).toBeNull();
    expect(applySave(null, 'ogone', plan(1), 'z', at(1))).toBeNull();
    expect(applySave(null, MAIN_PLAN, plan(1), 'z', at(1))).not.toBeNull();
  });

  it('each plan has its own versions', () => {
    let s = applyCreatePlan(base(), 'z', 'Off', null, at(1), 'ooff').store;
    s = applySave(s, 'ooff', plan(2), 'z', at(2), { version: true }).store;
    expect(s.plans.ooff.versions).toHaveLength(1);
    expect(s.plans.main.versions).toHaveLength(0);
    expect(versionRows(s, 'ooff')).toHaveLength(1);
    expect(versionRows(s, 'main')).toHaveLength(0);
  });

  it('renames an off-night plan and sets its target headcount; the main plan keeps its name but may have a target', () => {
    let s = applyCreatePlan(base(), 'z', 'Off', null, at(1), 'ooff').store;
    s = applyRenamePlan(s, 'ooff', { name: 'Tallon only', target_headcount: 12 }, at(2));
    expect(s.plans.ooff).toMatchObject({ name: 'Tallon only', target_headcount: 12 });
    s = applyRenamePlan(s, 'main', { name: 'Hijacked' }, at(3));
    expect(s.plans.main.name).toBe('Main night');
    s = applyRenamePlan(s, 'ooff', { target_headcount: null }, at(4));
    expect(s.plans.ooff.target_headcount).toBeUndefined();
    expect(applyRenamePlan(s, 'ooff', { target_headcount: 0 }, at(5))).toBeNull();
    expect(applyRenamePlan(s, 'ooff', { target_headcount: 2.5 }, at(5))).toBeNull();
    expect(applyRenamePlan(s, 'ogone', { name: 'x' }, at(5))).toBeNull();
  });

  it('deletes an off-night plan, never the main one', () => {
    const s = applyCreatePlan(base(), 'z', 'Off', null, at(1), 'ooff').store;
    expect(applyDeletePlan(s, 'main', at(2))).toBeNull();
    const gone = applyDeletePlan(s, 'ooff', at(2));
    expect(Object.keys(gone.plans)).toEqual(['main']);
    expect(applyDeletePlan(gone, 'ooff', at(3))).toBeNull();
  });

  it('the plan picker lists name, target and the raiders the plan needs, without the plans', () => {
    let s = applyCreatePlan(base(), 'z', 'Off', null, at(1), 'ooff').store;
    s = applySave(s, 'ooff', { ...plan(2), headcount: 11 }, 'z', at(2)).store;
    s = applyRenamePlan(s, 'ooff', { target_headcount: 10 }, at(3));
    const rows = planSummaries(s);
    expect(rows.find(r => r.id === 'ooff')).toMatchObject({ name: 'Off', night_type: 'off', target_headcount: 10, pins: 2, planned: 11 });
    expect(JSON.stringify(rows)).not.toMatch(/"current"/);
  });
});

describe('reading a row back', () => {
  it('reads the old single-plan row as the main-night plan, versions and all', () => {
    const v1 = { v: 1, zone: 'potactics', updated_at: at(5), current: plan(3), versions: [{ saved_at: at(1), plan: plan(2) }] };
    const s = parseStore(v1, 'potactics');
    expect(s.v).toBe(2);
    expect(s.plans.main).toMatchObject({ name: 'Main night', night_type: 'main', updated_at: at(5) });
    expect(s.plans.main.current.pins).toHaveLength(3);
    expect(s.plans.main.versions[0].plan.pins).toHaveLength(2);
    expect(applySave(s, MAIN_PLAN, plan(4), 'potactics', at(6)).store.v).toBe(2);       // written back as version 2
  });

  it('is null for a row that is not one of ours, for another zone, or for a bad stamp', () => {
    const ok = applySave(null, MAIN_PLAN, plan(1), 'potactics', at(0)).store;
    expect(parseStore(ok, 'potactics')).not.toBeNull();
    expect(parseStore(ok, 'solrotower')).toBeNull();
    expect(parseStore({ ...ok, updated_at: 'yesterday' }, 'potactics')).toBeNull();
    expect(parseStore({ ...ok, v: 9 }, 'potactics')).toBeNull();
    expect(parseStore(null, 'potactics')).toBeNull();
    expect(parseStore('x', 'potactics')).toBeNull();
  });

  it('re-sanitizes everything inside it, drops a bad plan id, forces night_type from the id, and caps the versions', () => {
    const ok = applySave(null, MAIN_PLAN, plan(1), 'z', at(0)).store;
    const hostile = JSON.parse(JSON.stringify(ok));
    hostile.plans['Bad Id!'] = hostile.plans.main;
    hostile.plans.o1 = { name: 'x'.repeat(500), night_type: 'main', current: { pins: [{ id: 'a', x: 'NaN', y: 0, evil: 1 }], updatedBy: 'u_1' }, versions: Array.from({ length: 80 }, (_, i) => ({ saved_at: at(i), plan: plan(1) })) };
    hostile.plans.main.night_type = 'off';
    const s = parseStore(hostile, 'z');
    expect(Object.keys(s.plans).sort()).toEqual(['main', 'o1']);
    expect(s.plans.main.night_type).toBe('main');
    expect(s.plans.o1.night_type).toBe('off');
    expect(s.plans.o1.name).toHaveLength(60);
    expect(s.plans.o1.current.pins).toEqual([]);
    expect(s.plans.o1.versions).toHaveLength(MAX_VERSIONS);
    expect(JSON.stringify(s)).not.toMatch(/u_1|evil/);
  });
});

describe('importing tonight’s plan', () => {
  const seed = seedFor('potactics');
  it('becomes the main plan AND its first saved version, with its label', () => {
    const s = applyImport(null, MAIN_PLAN, seed.plan, seed.label, 'potactics', at(0));
    expect(s.plans.main.current.pins).toHaveLength(14);
    expect(s.plans.main.versions).toHaveLength(1);
    expect(s.plans.main.versions[0].label).toBe(seed.label);
    expect(s.plans.main.versions[0].plan.pins).toHaveLength(14);
    expect(versionRows(s, MAIN_PLAN)[0]).toMatchObject({ label: seed.label, pins: 14 });
    expect(parseStore(JSON.parse(JSON.stringify(s)), 'potactics').plans.main.versions[0].label).toBe(seed.label);   // the label survives a round trip
  });
  it('keeps what it replaced as a version', () => {
    const had = applySave(null, MAIN_PLAN, plan(3), 'potactics', at(0)).store;
    const s = applyImport(had, MAIN_PLAN, seed.plan, seed.label, 'potactics', at(1));
    expect(s.plans.main.versions.map(v => v.plan.pins.length)).toEqual([14, 3]);
  });
  it('imports into a plan that exists, and only there', () => {
    expect(applyImport(null, 'ogone', seed.plan, 'x', 'potactics', at(0))).toBeNull();
  });
});

// ── the conversion to the in-game map ────────────────────────────────────────

describe('send to in-game map: the raid_route:<zone> shape', () => {
  const routesActions = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/raid/routes/actions.ts'), 'utf8'));
  /** the keys of the object literal that follows `marker`, one nesting level (no values, no nested keys) */
  const keysAfter = (src, marker) => {
    const start = src.indexOf(marker);
    if (start < 0) throw new Error('marker not found: ' + marker);
    const open = src.indexOf('{', start + marker.length - 1);
    let depth = 0, i = open, top = '';
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{' || c === '[' || c === '(') depth++;
      else if (c === '}' || c === ']' || c === ')') { depth--; if (depth === 0) break; }
      else if (depth === 1) top += c;
    }
    return top.split(/[,\n]/).map(s => s.trim().split(/[:\s]/)[0]).filter(Boolean);
  };

  const follow = createFollow(Z.nights);
  const route = (p, opts = {}) => planToRaidRoute(p, Z, follow, { nowIso: at(0), ...opts });
  const seedPlan = seedFor('potactics').plan;

  it('has exactly the keys the measured route has', () => {
    const want = keysAfter(routesActions, 'const value = {');
    expect(want).toEqual(expect.arrayContaining(['v', 'zone', 'name', 'saved_at', 'nights', 'keys', 'points', 'stops', 'legs', 'clears']));
    expect(Object.keys(route(seedPlan)).sort()).toEqual([...want].sort());
  });

  it('its stops and legs have the keys of the measured ones', () => {
    const between = (from, to) => { const i = routesActions.indexOf(from); return routesActions.slice(i, routesActions.indexOf(to, i)); };
    const objKeys = (snippet) => [...snippet.matchAll(/(\w+):/g)].map(m => m[1]);
    const wantStop = objKeys(between('stops: a.route.stops.map(s => ({', '})),')).slice(1);   // the first match is the `stops:` key itself
    const wantLeg = objKeys(between('return { from: l.from', '};'));
    const r = route(seedPlan);
    expect(wantStop.sort()).toEqual(Object.keys(r.stops[0]).sort());
    expect(wantLeg.sort()).toEqual(Object.keys(r.legs[0]).sort());
  });

  it('draws the plan end to end in the server frame, whole units, each leg a slice of points', () => {
    const r = route(seedPlan);
    expect(r).toMatchObject({ v: 1, zone: 'potactics', name: 'Plane of Tactics', saved_at: at(0), keys: [], clears: [] });
    expect(r.nights).toEqual(Z.nights.map(n => n.key));
    expect(r.stops.map(s => s.n)).toEqual(r.stops.map((_, i) => i + 1));
    expect(r.stops[0]).toMatchObject({ name: 'Zone-in', x: -411, y: 1, at: 'spawn' });      // not negated: the server frame
    expect(r.points.flat().every(Number.isInteger)).toBe(true);
    let end = -1;
    for (const l of r.legs) {
      expect(l.start_index).toBeGreaterThan(end - 1);
      expect(l.end_index).toBeGreaterThan(l.start_index);
      expect(l.end_index).toBeLessThan(r.points.length);
      end = l.end_index;
    }
    // the first leg runs from its first pin (the zone-in) through its bends to the second pin
    expect(r.points[r.legs[0].start_index]).toEqual([-411, 1]);
    expect(r.points[r.legs[0].end_index]).toEqual([-812, 2157]);
  });

  it('the bot serves it to Mimic as it is: every visible leg and every stop survives utils/raidRoute.js', () => {
    const r = route(seedPlan);
    const served = slim(JSON.parse(JSON.stringify(r)), 'potactics');
    expect(served).not.toBeNull();
    expect(served.legs).toHaveLength(r.legs.length);
    expect(served.stops.map(s => s.name)).toEqual(r.stops.map(s => s.name));
    expect(served.stops[0]).toMatchObject({ n: 1, x: -411, y: 1, at: 'spawn' });
    expect(served.name).toBe('Plane of Tactics');
    expect(served.points.length).toBeGreaterThan(r.legs.length * 2 - 1);
  });

  it('a hidden leg has no slice; a pin dropped by hand is "raid", not "spawn"', () => {
    const p = { ...emptyPlan(), pins: [pin('a', 0, 0, { mob: 'zonein' }), pin('b', 500, 0), pin('c', 900, 0)], lines: [{ k: 'a>b', pts: [], off: true }] };
    const r = route(p);
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0]).toMatchObject({ from: 'b', to: 'c', start_index: 0, end_index: 1 });
    expect(r.stops.map(s => s.at)).toEqual(['spawn', 'raid', 'raid']);
  });

  it('skip-optional leaves the optional pins and legs out', () => {
    const p = { ...emptyPlan(), pins: [pin('a', 0, 0), pin('b', 500, 0, { optional: true }), pin('c', 900, 0)] };
    expect(route(p).stops).toHaveLength(3);
    expect(route(p, { skipOptional: true }).stops).toHaveLength(2);
  });

  it('is null for a plan with nothing to draw', () => {
    expect(route(emptyPlan())).toBeNull();
    expect(route({ ...emptyPlan(), pins: [pin('a', 0, 0)] })).toBeNull();
    expect(route({ ...emptyPlan(), pins: [pin('a', 0, 0), pin('b', 9, 9)], lines: [{ k: 'a>b', pts: [], off: true }] })).toBeNull();
  });

  it('flattens a split: the start, each branch’s pins, then the regroup pin; the clock waits for the slowest branch', () => {
    const p = {
      ...emptyPlan(), pins: [pin('a', 0, 0), pin('c', 1000, 0)],
      splits: [{ id: 's', from: 'a', to: 'c', branches: [
        { id: 'x', label: 'Team A', color: '#2dd4bf', pins: [pin('a1', 500, 400)] },
        { id: 'y', label: 'Team B', color: '#d946ef', pins: [pin('b1', 500, -400)] },
      ] }],
    };
    const stats = { 'a>a1': 30, 'a1>c': 30, 'a>b1': 50, 'b1>c': 70 };
    const fake = { legStats: (A, B) => { const m = stats[A.id + '>' + B.id] ?? null; return { nights: m == null ? 0 : 1, median: m, best: m, found: [] }; } };
    const r = planToRaidRoute(p, Z, fake, { nowIso: at(0) });
    expect(r.stops.map(s => s.name)).toEqual(['a', 'Team A: a1', 'Team B: b1', 'c']);
    expect(r.legs.map(l => l.from + '>' + l.to)).toEqual(['a>a1', 'a1>c', 'a>b1', 'b1>c']);
    expect(r.stops.map(s => s.median_clock_s)).toEqual([0, 30, 50, 120]);   // regroup at 50 + 70, the slower branch
  });

  it('a teleport leg carries the teleport’s two points in its slice', () => {
    const z = { ...Z, links: [{ kind: 'teleport', from: [100, 0, 0], to: [900, 0, 80], label: 'Pad' }] };
    const p = { ...emptyPlan(), pins: [pin('a', 0, 0), pin('b', 1000, 0)], lines: [{ k: 'a>b', pts: [], off: false, via: 'Pad' }] };
    const r = planToRaidRoute(p, z, follow, { nowIso: at(0) });
    expect(r.points).toEqual([[0, 0], [100, 0], [900, 0], [1000, 0]]);
  });
});

// ── the officer gate ─────────────────────────────────────────────────────────

describe('the server actions', () => {
  const ACTIONS = path.join(ROOT, 'web/app/raid/plan/routes/actions.ts');
  const src = stripJs(fs.readFileSync(ACTIONS, 'utf8'));
  const WRITES = ['saveRoutePlan', 'restoreRouteVersion', 'importSeedPlan', 'createRoutePlan', 'updateRoutePlanMeta', 'deleteRoutePlan', 'publishRoutePlan'];
  const READS = ['pollRoutePlan', 'listRouteVersions', 'getRouteVersion'];

  const body = (name) => {
    const i = src.indexOf(`export async function ${name}(`);
    if (i < 0) throw new Error('no action ' + name);
    const next = src.indexOf('\nexport async function ', i + 10);
    return src.slice(i, next < 0 ? src.length : next);
  };

  it('every write action asks for an officer on its first line, before any read or write', () => {
    for (const name of WRITES) {
      const b = body(name);
      const guard = b.indexOf('officerUser()');
      expect(guard, `${name} has no officer check`).toBeGreaterThan(-1);
      for (const touch of ['readStore(', 'writeStore(', 'supabaseAdmin(', 'upsert(']) {
        const at2 = b.indexOf(touch);
        if (at2 >= 0) expect(guard, `${name}: ${touch} before the officer check`).toBeLessThan(at2);
      }
    }
  });
  it('every read action asks for a signed-in user', () => {
    for (const name of READS) expect(body(name)).toMatch(/signedIn\(\)/);
  });
  it('the file exports no action this test does not know about', () => {
    const all = [...src.matchAll(/export async function (\w+)\(/g)].map(m => m[1]).sort();
    expect(all).toEqual([...WRITES, ...READS].sort());
  });

  // behaviour, with the session, the officer test and the row mocked out
  let user, officer, row, writes, admin;
  async function load() {
    vi.resetModules();
    const real = (rel) => async () => await import(rel);
    vi.doMock('@/lib/supabase-server', () => ({ supabaseServer: () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }));
    vi.doMock('@/lib/officer', () => ({ isOfficer: async () => officer }));
    vi.doMock('@/lib/supabase', () => ({ supabaseAdmin: () => admin }));
    vi.doMock('@/lib/guild', () => ({ GUILD_TAG: 'wolfpack' }));
    vi.doMock('@/lib/routePlanner/zones', real('../web/lib/routePlanner/zones/index.ts'));
    vi.doMock('@/lib/routePlanner/follow', real('../web/lib/routePlanner/follow.ts'));
    vi.doMock('@/lib/routePlanner/store', real('../web/lib/routePlanner/store.ts'));
    vi.doMock('@/lib/routePlanner/toRaidRoute', real('../web/lib/routePlanner/toRaidRoute.ts'));
    vi.doMock('@/lib/routePlanner/seeds', real('../web/lib/routePlanner/seeds/index.ts'));
    vi.doMock('@/lib/routePlanner/plan', real('../web/lib/routePlanner/plan.ts'));
    vi.doMock('@/lib/routePlanner/load', async () => {
      const { parseStore } = await import('../web/lib/routePlanner/store.ts');
      return {
        readStore: async (zone) => (row ? parseStore(JSON.parse(JSON.stringify(row)), zone) : null),
        readRowStamp: async () => (row ? row.updated_at : null),
        writeStore: async (s) => { writes.push(s); row = s; },
      };
    });
    return await import('../web/app/raid/plan/routes/actions.ts');
  }
  const kv = new Map();
  beforeEach(() => {
    user = { id: 'u1' }; officer = true; row = null; writes = []; kv.clear();
    admin = {
      from: () => {
        const q = { f: {} };
        q.select = () => q; q.eq = (k, v) => { q.f[k] = v; return q; }; q.limit = () => q;
        q.maybeSingle = async () => ({ data: kv.has(q.f.key) ? { value: kv.get(q.f.key) } : null, error: null });
        q.upsert = async (r) => { writes.push({ kv: r.key }); kv.set(r.key, r.value); return { error: null }; };
        return q;
      },
    };
  });

  it('a signed-out visitor and a member who is not an officer cannot write anything', async () => {
    const a = await load();
    for (const who of [() => { user = null; officer = false; }, () => { user = { id: 'u2' }; officer = false; }]) {
      who();
      const calls = [
        a.saveRoutePlan('potactics', 'main', plan(2)),
        a.restoreRouteVersion('potactics', 'main', at(0)),
        a.importSeedPlan('potactics'),
        a.createRoutePlan('potactics', 'x', null),
        a.updateRoutePlanMeta('potactics', 'main', { target_headcount: 5 }),
        a.deleteRoutePlan('potactics', 'o1'),
        a.publishRoutePlan('potactics', 'main', {}),
      ];
      for (const r of await Promise.all(calls)) expect(r).toEqual({ ok: false, error: 'Officers only.' });
      expect(writes).toEqual([]);
    }
  });

  it('a signed-out visitor cannot read, a member can', async () => {
    const a = await load();
    user = null; officer = false;
    expect((await a.pollRoutePlan('potactics', 'main', null)).ok).toBe(false);
    expect((await a.listRouteVersions('potactics', 'main')).ok).toBe(false);
    user = { id: 'u2' };
    expect((await a.listRouteVersions('potactics', 'main'))).toEqual({ ok: true, versions: [] });
  });

  it('an officer saves, versions, creates, restores and imports', async () => {
    const a = await load();
    expect((await a.saveRoutePlan('potactics', 'main', plan(2))).ok).toBe(true);
    const v = await a.saveRoutePlan('potactics', 'main', plan(3), { version: true });
    expect(v).toMatchObject({ ok: true, versioned: 'manual', versions: 1 });
    const made = await a.createRoutePlan('potactics', 'Off-night: Tallon only', null);
    expect(made.ok).toBe(true);
    expect(made.plans.map(p => p.name)).toEqual(['Main night', 'Off-night: Tallon only']);
    const poll = await a.pollRoutePlan('potactics', 'main', null);
    expect(poll).toMatchObject({ ok: true, changed: true });
    expect(poll.doc.current.pins).toHaveLength(3);
    expect(await a.pollRoutePlan('potactics', 'main', poll.row_stamp)).toEqual({ ok: true, changed: false });   // nothing moved: cheap
    const list = await a.listRouteVersions('potactics', 'main');
    const back = await a.restoreRouteVersion('potactics', 'main', list.versions[0].saved_at);
    expect(back.ok).toBe(true);
    // the seed: replaces nothing without a yes
    expect(await a.importSeedPlan('potactics')).toMatchObject({ ok: false, confirm: true });
    const imp = await a.importSeedPlan('potactics', { overwrite: true });
    expect(imp.ok).toBe(true);
    expect(imp.versions[0].label).toMatch(/Oct 21/);
  });

  it('refuses a bad zone, a bad plan id, a bad stamp and an oversized plan', async () => {
    const a = await load();
    expect((await a.saveRoutePlan('nowhere', 'main', plan(1))).ok).toBe(false);
    expect((await a.saveRoutePlan('potactics', 'Main Plan!', plan(1))).ok).toBe(false);
    expect((await a.saveRoutePlan('potactics', 'main', null)).ok).toBe(false);
    expect((await a.saveRoutePlan('potactics', 'main', { pins: Array.from({ length: 5000 }, (_, i) => pin('p' + i, i, i, { note: 'x'.repeat(200) })) })).ok).toBe(false);
    expect((await a.saveRoutePlan('potactics', 'ogone', plan(1))).ok).toBe(false);
    expect((await a.restoreRouteVersion('potactics', 'main', 'yesterday')).ok).toBe(false);
    expect((await a.deleteRoutePlan('potactics', 'main')).ok).toBe(false);
    expect((await a.importSeedPlan('solrotower')).ok).toBe(false);
  });

  it('sending to the in-game map asks before replacing a route, then writes the shape under raid_route:<zone>', async () => {
    const a = await load();
    await a.importSeedPlan('potactics');
    const first = await a.publishRoutePlan('potactics', 'main', {});
    expect(first).toMatchObject({ ok: true });
    expect(kv.has('raid_route:potactics')).toBe(true);
    expect(kv.get('raid_route:potactics')).toMatchObject({ v: 1, zone: 'potactics' });
    const again = await a.publishRoutePlan('potactics', 'main', {});
    expect(again).toMatchObject({ ok: false, confirm: { stops: expect.any(Number) } });
    const yes = await a.publishRoutePlan('potactics', 'main', { overwrite: true });
    expect(yes.ok).toBe(true);
    kv.clear(); row = null;
    expect((await a.publishRoutePlan('potactics', 'main', {})).ok).toBe(false);      // nothing saved yet
  });
});
