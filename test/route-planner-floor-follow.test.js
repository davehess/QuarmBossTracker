// test/route-planner-floor-follow.test.js: the floors "One leg" draws under ?v=floors (web/lib/routePlanner/legFocus.ts).
//
// Eleven floors of the Tower of Solusek Ro drew on top of each other, so with One leg on the map keeps only the walls of
// the floors the CURRENT leg walks: its pins' floors, plus the floor of every height on its walked / baked path, plus (for a
// line with heights only at its ends) the floors between. A floor picked by hand still wins. Pure maths, tested on the real
// tower floor bands; the engine wiring is checked at the bottom against the source with comments stripped.
//
// Run: npx vitest run test/route-planner-floor-follow.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { legFloorKeys, floorInView } from '../web/lib/routePlanner/legFocus.ts';
import { zoneData } from '../web/lib/routePlanner/zones/index.ts';

const FLOORS = zoneData('solrotower').floors;
// a height inside each band, bottom to top
const Z = { jiva: -1200, rizlona: -930, entrance: -766, sentry: -574, mid: -450, tele: -384, upper: -166, top: 0, solro: 250, xuzl: 300, arlyxir: 600 };
const keys = (...runs) => [...legFloorKeys(FLOORS, runs)].sort();

describe('legFloorKeys: the floors a leg touches', () => {
  it('has the tower bands this test leans on', () => {
    for (const [k, z] of Object.entries(Z)) expect(FLOORS.find(f => z >= (f.zmin ?? -Infinity) && z <= (f.zmax ?? Infinity))?.key).toBe(k);
  });

  it('pins on two floors that sit side by side: those two floors and no others', () => {
    expect(keys({ zs: [Z.entrance, Z.sentry] })).toEqual(['entrance', 'sentry']);
  });

  it('a line with heights only at its ends climbs through every floor between them', () => {
    expect(keys({ zs: [Z.entrance, Z.top], filled: true })).toEqual(['entrance', 'mid', 'sentry', 'tele', 'top', 'upper']);
  });

  it('a walked path that crosses a third floor adds it; floors it never stands on stay out', () => {
    const walked = { zs: [Z.entrance, Z.entrance, Z.sentry, Z.mid, Z.mid, Z.sentry] };
    expect(keys({ zs: [Z.entrance, Z.sentry] }, walked)).toEqual(['entrance', 'mid', 'sentry']);
  });

  it('a teleport leg counts the floor it leaves and the floor it lands on, not the ones between', () => {
    const toTele = { zs: [Z.entrance, Z.entrance], filled: true }, jump = { zs: [Z.entrance, Z.xuzl] }, onward = { zs: [Z.xuzl, Z.xuzl], filled: true };
    expect(keys({ zs: [Z.entrance, Z.xuzl] }, toTele, jump, onward)).toEqual(['entrance', 'xuzl']);
  });

  it('a leg on one floor is one floor', () => {
    expect(keys({ zs: [Z.xuzl, Z.xuzl + 20] }, { zs: [Z.xuzl, Z.xuzl + 20], filled: true })).toEqual(['xuzl']);
  });

  it('a missing or unplaceable height counts for nothing, and a leg with none is the empty set (the map then keeps every floor)', () => {
    expect(keys({ zs: [undefined, null, NaN, 99999] })).toEqual([]);
    expect(keys({ zs: [Z.top, undefined], filled: true })).toEqual(['top']);
  });

  it('a range that only touches a band at its edge does not cross it', () => {
    const edge = FLOORS.find(f => f.key === 'sentry').zmin;   // the line between the entrance and the sentry level
    expect(keys({ zs: [Z.entrance, edge], filled: true })).toEqual(['entrance']);
  });
});

describe('floorInView: a floor picked by hand wins', () => {
  const auto = new Set(['xuzl', 'solro']);
  it('on All, only the leg floors are in view; with no leg floors, all of them are', () => {
    expect(floorInView('xuzl', 'all', auto)).toBe(true);
    expect(floorInView('jiva', 'all', auto)).toBe(false);
    expect(floorInView('jiva', 'all', null)).toBe(true);
  });
  it('a picked floor is the only one in view, whatever the leg walks', () => {
    expect(floorInView('jiva', 'jiva', auto)).toBe(true);
    expect(floorInView('xuzl', 'jiva', auto)).toBe(false);
  });
});

describe('the engine wiring', () => {
  const read = p => stripJs(fs.readFileSync(path.join(ROOT, p), 'utf8'));
  const engine = read('web/app/raid/plan/routes/engine.ts');
  const page = read('web/app/raid/plan/routes/page.tsx');

  it('the walls, the leash boxes, the dimming and the pathers all ask floorInView; nothing compares ui.floor to a wall key itself', () => {
    expect(engine).toMatch(/floorInView\(p\.dataset\.floor, ui\.floor, autoFloors\)/);
    expect(engine).toMatch(/floorInView\(r\.dataset\.floor, ui\.floor, autoFloors\)/);
    expect(engine).toMatch(/const offFloor = z => \{[^}]*floorInView\(f\.key, ui\.floor, autoFloors\)/);
    expect(engine).toMatch(/pts\.some\(q => \{[^}]*floorInView\(f\.key, ui\.floor, autoFloors\)/);
    expect(engine).not.toMatch(/ui\.floor === p\.dataset\.floor/);
  });

  it('the leg floors are only computed when the host asked, One leg is on (a current leg exists) and the floor is All', () => {
    expect(engine).toMatch(/host\.floorFollow && cur && ui\.floor === 'all' && Z\.floors\.length > 1/);
  });

  it('the page turns it on only for ?v=floors', () => {
    expect(page).toMatch(/one\(searchParams\.v\) === 'floors'/);
    expect(page).toMatch(/floorFollow=\{floorFollow\}/);
  });
});
