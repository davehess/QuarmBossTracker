// test/spectator-positions.test.js — /spectator: the rules that are easy to get backwards.
//
// The page draws raiders on a zone map. What can go wrong without anyone noticing is a dot that lands in
// the wrong place (the two raid_roster position columns are swapped relative to the map), a raider drawn
// twice or from an old position, a raider put in the wrong zone, or a heading that points the wrong way.
// These tests drive the real helpers in web/lib/spectator.ts and the real route handler, not their text.
//
// Run: npx vitest run test/spectator-positions.test.js

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  serverXY, toScreen, freshestPerName, resolveZoneIds, buildPositions, pickZone, headingVec,
  canonicalClass, classColor, classAbbr, CLASS_COLORS, UNKNOWN_CLASS_COLOR, median, nearestBand,
  fitView, zoomAt, needsRefit, mapBox, raidBox, scaleBarUnits, parseZoneMap, coreRaiders,
  effectiveLayers, layerBounds, deriveBands, lineNearZ, liftColor,
  POSITION_FRESH_S, DOT_STALE_S, FLOOR_BAND_Z,
} from '../web/lib/spectator.ts';

const NOW = Date.parse('2026-10-05T01:00:00Z');
const ago = (s) => new Date(NOW - s * 1000).toISOString();

// A roster row as raid_roster returns it.
const row = (name, over = {}) => ({
  name, class: 'Warrior', group_num: 1, level: 60, hp_pct: 100,
  loc_x: 10, loc_y: 20, loc_z: 5, heading: 0, loc_at: ago(2), uploaded_by_discord_id: 'u1',
  ...over,
});

const zones = new Map([
  [100, { short: 'poinnovation', long: 'Plane of Innovation' }],
  [101, { short: 'potimea', long: 'Plane of Time' }],
]);

describe('axes: raid_roster is swapped against the map', () => {
  it('server x is loc_y and server y is loc_x', () => {
    expect(serverXY(111, -222)).toEqual({ x: -222, y: 111 });
  });

  it('the picture is north up: screen = -server, y grows downward', () => {
    expect(toScreen(300, 400)).toEqual({ sx: -300, sy: -400 });
    // A raider further north (larger server y) sits higher on the canvas (smaller screen y).
    expect(toScreen(0, 500).sy).toBeLessThan(toScreen(0, 100).sy);
    // Further west (larger server x) sits further left (smaller screen x).
    expect(toScreen(500, 0).sx).toBeLessThan(toScreen(100, 0).sx);
  });

  it('buildPositions applies the swap to what it returns', () => {
    const live = new Map([['aldenmar', 100]]);
    const out = buildPositions([row('Aldenmar', { loc_x: 111, loc_y: -222, loc_z: 7 })], live, zones, NOW);
    expect(out.raiders[0]).toMatchObject({ name: 'Aldenmar', x: -222, y: 111, z: 7, zone: 'poinnovation' });
  });
});

describe('freshestPerName', () => {
  it('keeps the newest report of a raider, whatever the case, and draws nobody twice', () => {
    const rows = [
      row('Brackwyn', { loc_x: 1, loc_at: ago(20) }),
      row('brackwyn', { loc_x: 2, loc_at: ago(3) }),
      row('BRACKWYN', { loc_x: 3, loc_at: ago(9) }),
      row('Corvale', { loc_x: 4 }),
    ];
    const out = freshestPerName(rows);
    expect(out).toHaveLength(2);
    expect(out.find(r => r.name.toLowerCase() === 'brackwyn').loc_x).toBe(2);
  });

  it('drops exactly (0, 0, 0): a raid member in another zone, not a place; it cannot mask a real position', () => {
    const rows = [
      row('Aldenmar', { loc_x: 0, loc_y: 0, loc_z: 0, loc_at: ago(1) }),     // newest, but nowhere
      row('Aldenmar', { loc_x: 40, loc_y: -8, loc_z: 3, loc_at: ago(4) }),   // another uploader's real fix
      row('Brackwyn', { loc_x: 0, loc_y: 0, loc_z: 0 }),
      row('Corvale', { loc_x: 0, loc_y: 0, loc_z: 5 }),                      // a real spot that happens to have x = y = 0
    ];
    const out = freshestPerName(rows);
    expect(out.map(r => r.name).sort()).toEqual(['Aldenmar', 'Corvale']);
    expect(out.find(r => r.name === 'Aldenmar').loc_x).toBe(40);
    expect(buildPositions([rows[2]], new Map([['brackwyn', 100]]), zones, NOW).raiders).toEqual([]);
  });

  it('drops rows with no name, no position or no usable time', () => {
    const rows = [
      row(null), row('A1', { loc_x: null }), row('A2', { loc_y: null }),
      row('A3', { loc_at: null }), row('A4', { loc_at: 'not a time' }), row('Good'),
    ];
    expect(freshestPerName(rows).map(r => r.name)).toEqual(['Good']);
  });
});

describe('resolveZoneIds: most raiders run no Mimic, so most have no zone of their own', () => {
  const r = (name, uploader) => ({ name, uploaded_by_discord_id: uploader });

  it("a raider's own live zone wins", () => {
    const z = resolveZoneIds([r('Aldenmar', 'u1'), r('Brackwyn', 'u1')], new Map([['aldenmar', 100], ['brackwyn', 101]]));
    expect(z.get('aldenmar')).toBe(100);
    expect(z.get('brackwyn')).toBe(101);
  });

  it("an unknown raider takes the zone of the raiders their uploader reports", () => {
    // u1's raiders stand in 100, u2's in 101; the unknown ones follow their own uploader, not the majority.
    const rows = [r('A', 'u1'), r('B', 'u1'), r('C', 'u1'), r('D', 'u2'), r('E', 'u2'), r('Unknown1', 'u2'), r('Unknown2', 'u1')];
    const live = new Map([['a', 100], ['b', 100], ['c', 100], ['d', 101], ['e', 101]]);
    const z = resolveZoneIds(rows, live);
    expect(z.get('unknown1')).toBe(101);
    expect(z.get('unknown2')).toBe(100);
  });

  it('with nothing from their uploader, the raid as a whole decides; a tie goes to the lower id', () => {
    const rows = [r('A', 'u1'), r('B', 'u2'), r('Lost', 'u3')];
    const z = resolveZoneIds(rows, new Map([['a', 101], ['b', 100]]));
    expect(z.get('lost')).toBe(100);
  });

  it('is null when nobody anywhere has a known zone', () => {
    expect(resolveZoneIds([r('Lost', 'u1')], new Map()).get('lost')).toBeNull();
  });

  it('copes with a missing uploader id', () => {
    const z = resolveZoneIds([r('A', null), r('B', null)], new Map([['a', 100]]));
    expect(z.get('b')).toBe(100);
  });
});

describe('buildPositions: the feed', () => {
  const live = new Map([['aldenmar', 100], ['brackwyn', 100], ['corvale', 101]]);

  it(`drops a position older than ${POSITION_FRESH_S} s and keeps one at the limit`, () => {
    const out = buildPositions([
      row('Aldenmar', { loc_at: ago(POSITION_FRESH_S) }),
      row('Brackwyn', { loc_at: ago(POSITION_FRESH_S + 1) }),
    ], live, zones, NOW);
    expect(out.raiders.map(r => r.name)).toEqual(['Aldenmar']);
  });

  it(`reports age, so the page can fade a dot older than ${DOT_STALE_S} s`, () => {
    const out = buildPositions([row('Aldenmar', { loc_at: ago(14) })], live, zones, NOW);
    expect(out.raiders[0].age_s).toBe(14);
    expect(out.raiders[0].age_s).toBeGreaterThan(DOT_STALE_S);
  });

  it('counts raiders per zone, busiest first, and names each zone', () => {
    const out = buildPositions([row('Aldenmar'), row('Brackwyn'), row('Corvale')], live, zones, NOW);
    expect(out.zones).toEqual([
      { zone: 'poinnovation', name: 'Plane of Innovation', count: 2 },
      { zone: 'potimea', name: 'Plane of Time', count: 1 },
    ]);
  });

  it('counts a raider whose zone cannot be worked out as unplaced instead of guessing', () => {
    const out = buildPositions([row('Stranger', { uploaded_by_discord_id: 'u9' })], new Map(), zones, NOW);
    expect(out.raiders).toEqual([]);
    expect(out.unplaced).toBe(1);
  });

  it('counts a zone id the catalogue does not know as unplaced', () => {
    const out = buildPositions([row('Aldenmar')], new Map([['aldenmar', 999]]), zones, NOW);
    expect(out.unplaced).toBe(1);
  });

  it('sorts by group (ungrouped last) then name', () => {
    const out = buildPositions([
      row('Zarrin', { group_num: 2 }), row('Nyssara', { group_num: null }), row('Rethlan', { group_num: 1 }),
      row('Aldenmar', { group_num: 2 }),
    ], new Map([['zarrin', 100], ['nyssara', 100], ['rethlan', 100], ['aldenmar', 100]]), zones, NOW);
    expect(out.raiders.map(r => r.name)).toEqual(['Rethlan', 'Aldenmar', 'Zarrin', 'Nyssara']);
  });

  it('clamps and rounds HP, accepts the numeric string a numeric column can arrive as, and keeps unknown HP null', () => {
    const l = new Map([['a1', 100], ['a2', 100], ['a3', 100], ['a4', 100]]);
    const out = buildPositions([
      row('A1', { hp_pct: '82.6' }), row('A2', { hp_pct: 140 }), row('A3', { hp_pct: null }), row('A4', { hp_pct: -5 }),
    ], l, zones, NOW);
    const hp = Object.fromEntries(out.raiders.map(r => [r.name, r.hp]));
    expect(hp).toEqual({ A1: 83, A2: 100, A3: null, A4: 0 });
  });

  it('never returns who uploaded a position', () => {
    const out = buildPositions([row('Aldenmar', { uploaded_by_discord_id: '123456789012345678' })], live, zones, NOW);
    expect(JSON.stringify(out)).not.toContain('123456789012345678');
  });

  it('is an empty, well-formed feed with no rows', () => {
    expect(buildPositions([], new Map(), new Map(), NOW)).toMatchObject({ raiders: [], zones: [], unplaced: 0 });
  });
});

describe('pickZone', () => {
  const z = [{ zone: 'a', name: 'A', count: 5 }, { zone: 'b', name: 'B', count: 2 }];
  it('defaults to the zone with the most raiders', () => {
    expect(pickZone(z, null)).toBe('a');
    expect(pickZone([z[1], z[0]], null)).toBe('a');
  });
  it("keeps the viewer's pick while that zone still has raiders", () => {
    expect(pickZone(z, 'b')).toBe('b');
  });
  it('falls back to the busiest zone once the picked one empties', () => {
    expect(pickZone(z, 'gone')).toBe('a');
  });
  it('is null with no zones', () => {
    expect(pickZone([], 'a')).toBeNull();
  });
});

describe('heading', () => {
  const near = (v, dx, dy) => { expect(v.dx).toBeCloseTo(dx, 6); expect(v.dy).toBeCloseTo(dy, 6); };
  it('0 faces north (up the screen); 128 west, 256 south, 384 east (counter-clockwise, unverified in game)', () => {
    near(headingVec(0), 0, -1);
    near(headingVec(128), -1, 0);
    near(headingVec(256), 0, 1);
    near(headingVec(384), 1, 0);
  });
  it('wraps', () => {
    near(headingVec(512), 0, -1);
    near(headingVec(-128), 1, 0);
  });
});

describe('classes', () => {
  it('knows every base class, each with its own colour', () => {
    const names = Object.keys(CLASS_COLORS);
    expect(names).toHaveLength(15);
    expect(new Set(Object.values(CLASS_COLORS)).size).toBe(15);
  });
  it('reads the spellings the roster can carry', () => {
    expect(canonicalClass('Shadow Knight')).toBe('Shadow Knight');
    expect(canonicalClass('shadowknight')).toBe('Shadow Knight');
    expect(canonicalClass('SHD')).toBe('Shadow Knight');
    expect(canonicalClass(' enc ')).toBe('Enchanter');
    expect(canonicalClass('Berserker')).toBeNull();
    expect(canonicalClass(null)).toBeNull();
  });
  it('colours and labels the unknown plainly', () => {
    expect(classColor('Cleric')).toBe(CLASS_COLORS.Cleric);
    expect(classColor('Berserker')).toBe(UNKNOWN_CLASS_COLOR);
    expect(classAbbr('Necromancer')).toBe('NEC');
    expect(classAbbr('Berserker')).toBe('BER');
    expect(classAbbr(null)).toBe('?');
  });
});

describe('floors', () => {
  it('the bright band is the one nearest the raid median z', () => {
    const bands = [-1934, -1914, -1890, -1850, -174, -54, -2];
    expect(nearestBand(bands, median([-1900, -1895, -1888]))).toBe(2);
    expect(nearestBand(bands, -60)).toBe(5);
    expect(nearestBand([], -60)).toBe(-1);
    expect(nearestBand(bands, null)).toBe(-1);
  });
  it('median of an even count is the mean of the middle two', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('view maths', () => {
  const W = 800, H = 600;
  const toPx = (v, sx, sy) => ({ x: (sx - v.cx) * v.scale + W / 2, y: (sy - v.cy) * v.scale + H / 2 });

  it('fitView puts the whole box in the picture, centred', () => {
    const box = { minX: -1000, maxX: 1000, minY: -500, maxY: 500 };
    const v = fitView(box, W, H);
    const a = toPx(v, box.minX, box.minY), b = toPx(v, box.maxX, box.maxY);
    expect(a.x).toBeGreaterThanOrEqual(0); expect(a.y).toBeGreaterThanOrEqual(0);
    expect(b.x).toBeLessThanOrEqual(W); expect(b.y).toBeLessThanOrEqual(H);
    expect(toPx(v, 0, 0)).toEqual({ x: W / 2, y: H / 2 });
  });

  it('fitView does not zoom into a single spot past minSpan', () => {
    const v = fitView({ minX: 5, maxX: 5, minY: 5, maxY: 5 }, W, H, 32, 300);
    expect(v.scale).toBeCloseTo(Math.min((W - 64) / 300, (H - 64) / 300), 6);
  });

  it('zoomAt keeps the point under the pointer still', () => {
    const v = { cx: 120, cy: -80, scale: 0.5 };
    const px = 610, py = 140;
    const world = { x: v.cx + (px - W / 2) / v.scale, y: v.cy + (py - H / 2) / v.scale };
    const z = zoomAt(v, 2.5, px, py, W, H);
    expect(z.scale).toBeCloseTo(1.25, 9);
    const back = toPx(z, world.x, world.y);
    expect(back.x).toBeCloseTo(px, 6);
    expect(back.y).toBeCloseTo(py, 6);
  });

  it('zoom is bounded', () => {
    const v = { cx: 0, cy: 0, scale: 1 };
    expect(zoomAt(v, 1e9, 0, 0, W, H).scale).toBeLessThanOrEqual(8);
    expect(zoomAt(v, 1e-9, 0, 0, W, H).scale).toBeGreaterThan(0);
  });

  it('while following, the view holds still until the raid is about to leave it', () => {
    const box = { minX: -100, maxX: 100, minY: -100, maxY: 100 };
    const v = fitView(box, W, H);
    expect(needsRefit(v, box, W, H)).toBe(false);
    // The raid walks off the right edge.
    expect(needsRefit(v, { ...box, maxX: 100000 }, W, H)).toBe(true);
    // The raid shrinks to a speck in a picture fitted to something much bigger.
    const wide = fitView({ minX: -5000, maxX: 5000, minY: -5000, maxY: 5000 }, W, H);
    expect(needsRefit(wide, box, W, H)).toBe(true);
  });

  it('maps a server-frame map box into the picture frame, and boxes raiders there too', () => {
    expect(mapBox({ minX: -1062, maxX: 1644, minY: -1298, maxY: 1986 }))
      .toEqual({ minX: -1644, maxX: 1062, minY: -1986, maxY: 1298 });
    expect(raidBox([])).toBeNull();
    expect(raidBox([{ x: 100, y: 50 }, { x: -40, y: 80 }])).toEqual({ minX: -100, maxX: 40, minY: -80, maxY: -50 });
  });

  it('framing the raid ignores stragglers: a clump of forty and three people hundreds of units off', () => {
    // Measured shape of a live raid (2026-10-05): ~40 within 60 units of each other, a few far away.
    const clump = Array.from({ length: 40 }, (_, i) => ({ x: (i % 8) * 8, y: Math.floor(i / 8) * 8, tag: 'clump' }));
    const far = [{ x: 330, y: 160, tag: 'far' }, { x: -300, y: 90, tag: 'far' }, { x: 20, y: 350, tag: 'far' }];
    const core = coreRaiders([...clump, ...far]);
    expect(core.filter(r => r.tag === 'far')).toHaveLength(0);
    expect(core).toHaveLength(40);
    // The framing around the core is a tight box, not one stretched to the stragglers.
    const box = raidBox(core);
    expect(box.maxX - box.minX).toBeLessThan(100);
  });

  it('a raid strung out along a corridor is all core, and a small group always is', () => {
    const line = Array.from({ length: 20 }, (_, i) => ({ x: i * 40, y: 0 }));
    expect(coreRaiders(line)).toHaveLength(20);
    const few = [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 0, y: 5000 }];
    expect(coreRaiders(few)).toEqual(few);
    expect(coreRaiders([])).toEqual([]);
  });

  it('the scale bar is a round number about 70-140 px wide', () => {
    for (const scale of [0.05, 0.2, 0.9, 3]) {
      const px = scaleBarUnits(scale) * scale;
      expect(px).toBeGreaterThanOrEqual(70);
      expect(px).toBeLessThanOrEqual(320);
    }
  });
});

// A map made up by hand for these tests: no real zone data is committed to this repo. Two floors 100 apart,
// a few walls, one black line and one place name.
const eqemu = {
  bands: [-10, 90],
  segs: [[0, 0, 5, 5, 0], [1, 2, 3, 4, 1]],
  bounds: { minX: 0, maxX: 5, minY: 0, maxY: 5 },
};
const brewall = {
  lines: [
    [0, 0, -10, 40, 0, -10, 255, 0, 0],      // red, on the lower floor
    [0, 10, 90, 40, 10, 90, 0, 0, 0],        // black, on the upper floor
    [0, 20, -30, 0, 20, 30, 10, 200, 10],    // a ramp spanning z -30..30
  ],
  labels: [[20, 5, -10, 'Test Hall']],
  bounds: { minX: -50, maxX: 60, minY: -5, maxY: 25 },
};
const both = { zone: 'testzone', frame: 'server', eqemu, brewall, sources: { eqemu: 'eqemu test', brewall: 'brewall test' } };

describe('parseZoneMap: what the map API sends (two layers)', () => {
  it('accepts a well-formed answer with both layers', () => {
    const m = parseZoneMap(both);
    expect(m.eqemu.segs).toHaveLength(2);
    expect(m.eqemu.bands).toEqual([-10, 90]);
    expect(m.brewall.lines).toHaveLength(3);
    expect(m.brewall.labels).toEqual([[20, 5, -10, 'Test Hall']]);
    expect(m.sources).toEqual({ eqemu: 'eqemu test', brewall: 'brewall test' });
  });
  it('accepts one layer when the other is null', () => {
    expect(parseZoneMap({ ...both, brewall: null }).brewall).toBeNull();
    expect(parseZoneMap({ ...both, brewall: null }).eqemu.segs).toHaveLength(2);
    expect(parseZoneMap({ ...both, eqemu: null }).eqemu).toBeNull();
    expect(parseZoneMap({ ...both, eqemu: null }).brewall.lines).toHaveLength(3);
  });
  it('drops a malformed segment, line or label but keeps the rest', () => {
    const m = parseZoneMap({
      ...both,
      eqemu: { ...eqemu, segs: [...eqemu.segs, [1, 2, 'x', 4, 0], [1, 2]] },
      brewall: { ...brewall, lines: [...brewall.lines, [1, 2, 3], [1, 2, 3, 4, 5, 6, 7, 8, NaN]], labels: [...brewall.labels, [1, 2, 3, 99], [1, 2]] },
    });
    expect(m.eqemu.segs).toHaveLength(2);
    expect(m.brewall.lines).toHaveLength(3);
    expect(m.brewall.labels).toHaveLength(1);
  });
  it('works the bounds out from the lines when Brewall sends none', () => {
    const m = parseZoneMap({ ...both, brewall: { lines: brewall.lines, labels: [] } });
    expect(m.brewall.bounds).toEqual({ minX: 0, maxX: 40, minY: 0, maxY: 20 });
  });
  it('is null, never a throw, for anything that is not a map', () => {
    expect(parseZoneMap(null)).toBeNull();
    expect(parseZoneMap({})).toBeNull();
    expect(parseZoneMap('map')).toBeNull();
    expect(parseZoneMap({ eqemu: null, brewall: null })).toBeNull();
    // A layer that is itself broken is no layer; with the other absent, there is no map.
    expect(parseZoneMap({ eqemu: { ...eqemu, bounds: { minX: 0, maxX: NaN, minY: 0, maxY: 1 } }, brewall: null })).toBeNull();
    expect(parseZoneMap({ eqemu: { ...eqemu, bands: ['a'] }, brewall: null })).toBeNull();
    expect(parseZoneMap({ eqemu: null, brewall: { lines: [], labels: [] } })).toBeNull();
  });
});

describe('layers: Brewall underneath, with the other as the fallback', () => {
  const only = (k) => ({ eqemu: k === 'eqemu' ? eqemu : null, brewall: k === 'brewall' ? brewall : null });

  it('draws what was picked when the zone has it', () => {
    expect(effectiveLayers('brewall', both)).toEqual({ brewall: true, generated: false });
    expect(effectiveLayers('generated', both)).toEqual({ brewall: false, generated: true });
    expect(effectiveLayers('both', both)).toEqual({ brewall: true, generated: true });
  });
  it('falls back to the generated walls when Brewall is missing', () => {
    expect(effectiveLayers('brewall', only('eqemu'))).toEqual({ brewall: false, generated: true });
    expect(effectiveLayers('both', only('eqemu'))).toEqual({ brewall: false, generated: true });
  });
  it('falls back to Brewall when the generated walls are missing', () => {
    expect(effectiveLayers('generated', only('brewall'))).toEqual({ brewall: true, generated: false });
    expect(effectiveLayers('both', only('brewall'))).toEqual({ brewall: true, generated: false });
  });
  it('draws nothing when the zone has neither', () => {
    expect(effectiveLayers('both', { eqemu: null, brewall: null })).toEqual({ brewall: false, generated: false });
  });
  it('fits the zone to the layers being drawn, not to one that is off', () => {
    expect(layerBounds(both, { brewall: true, generated: false })).toEqual(brewall.bounds);
    expect(layerBounds(both, { brewall: false, generated: true })).toEqual(eqemu.bounds);
    expect(layerBounds(both, { brewall: true, generated: true })).toEqual({ minX: -50, maxX: 60, minY: -5, maxY: 25 });
    expect(layerBounds(both, { brewall: false, generated: false })).toBeNull();
  });
});

describe('Brewall floors: lines are placed by their z', () => {
  it(`a line is on the raid's floor when its z-span reaches within ${FLOOR_BAND_Z} units of the raid`, () => {
    expect(lineNearZ(-10, -10, 20)).toBe(true);            // 30 below
    expect(lineNearZ(-10, -10, 31)).toBe(false);           // 41 below
    expect(lineNearZ(90, 90, 20)).toBe(false);
    expect(lineNearZ(-30, 30, 60)).toBe(true);             // a ramp reaches up to within 30 of z 60
    expect(lineNearZ(30, -30, 60)).toBe(true);             // either way round
    expect(lineNearZ(-30, 30, 100)).toBe(false);
  });
  it('derives floors from line heights where the layer has none', () => {
    const l = (z) => [0, 0, z, 1, 1, z, 1, 1, 1];
    // Ground around 0-30 (a slope, one floor), a deck near 200, a tower near 600.
    expect(deriveBands([l(0), l(20), l(35), l(200), l(210), l(600)])).toEqual([55 / 3, 205, 600]);
    expect(deriveBands([l(0), l(10)])).toHaveLength(1);
    expect(deriveBands([])).toEqual([]);
  });
  it('gives up (no floor filtering) when the heights fragment into more than 16 floors', () => {
    const l = (z) => [0, 0, z, 1, 1, z, 1, 1, 1];
    expect(deriveBands(Array.from({ length: 17 }, (_, i) => l(i * 100)))).toEqual([]);
    expect(deriveBands(Array.from({ length: 16 }, (_, i) => l(i * 100)))).toHaveLength(16);
  });
  it('lifts a dark line colour so black walls show on the dark page, and leaves a light one alone', () => {
    const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
    expect(lum(liftColor(0, 0, 0))).toBeGreaterThan(100);
    expect(lum(liftColor(20, 20, 60))).toBeGreaterThan(lum([20, 20, 60]) + 40);
    const [r, g, b] = liftColor(255, 0, 0);                  // a dark-ish colour keeps its hue
    expect(r).toBeGreaterThan(g + 150);
    expect(g).toBe(b);
    expect(liftColor(200, 200, 200)).toEqual([200, 200, 200]);
    expect(liftColor(255, 255, 0)).toEqual([255, 255, 0]);
  });
});

// ── The route ────────────────────────────────────────────────────────────────

const db = vi.hoisted(() => ({ user: null, tables: {}, calls: [] }));
vi.mock('@/lib/supabase-server', () => ({
  supabaseServer: () => ({ auth: { getUser: async () => ({ data: { user: db.user } }) } }),
}));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({
    // An RPC is recorded as table 'rpc:<name>' with its arguments as the first op.
    rpc: (fn, args) => {
      const call = { table: 'rpc:' + fn, ops: [['args', args]] };
      db.calls.push(call);
      const q = {
        range: (...a) => { call.ops.push(['range', ...a]); return q; },
        then: (ok, bad) => Promise.resolve({ data: db.tables['rpc:' + fn] ?? [], error: null }).then(ok, bad),
      };
      return q;
    },
    from: (table) => {
      const call = { table, ops: [] };
      db.calls.push(call);
      const q = {
        select: () => q,
        eq: (...a) => { call.ops.push(['eq', ...a]); return q; },
        gte: (...a) => { call.ops.push(['gte', ...a]); return q; },
        in: (...a) => { call.ops.push(['in', ...a]); return q; },
        order: (...a) => { call.ops.push(['order', ...a]); return q; },
        limit: (...a) => { call.ops.push(['limit', ...a]); return q; },
        range: (...a) => { call.ops.push(['range', ...a]); return q; },
        then: (ok, bad) => Promise.resolve({ data: db.tables[table] ?? [], error: null }).then(ok, bad),
      };
      return q;
    },
  }),
}));
vi.mock('@/lib/spectator', async () => await import('../web/lib/spectator.ts'));
vi.mock('@/lib/guild', async () => await import('../web/lib/guild.ts'));
// CI's test job installs the root packages only, so `next/server` (web/node_modules) does not
// resolve there; the route only needs NextResponse.json, which is a plain Response.
vi.mock('next/server', () => ({
  NextResponse: {
    json: (body, init = {}) => new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json', ...(init.headers || {}) },
    }),
  },
}));

describe('GET /api/spectator/positions', () => {
  beforeEach(() => { db.user = null; db.tables = {}; db.calls = []; });

  it('is members only: no session, 401, and the database is never read', async () => {
    const { GET } = await import('../web/app/api/spectator/positions/route.ts');
    const res = await GET();
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(db.calls).toEqual([]);
  });

  it('answers a signed-in member with placed raiders, swapped axes and no-store', async () => {
    db.user = { id: 'member-1' };
    const at = new Date(Date.now() - 2000).toISOString();
    db.tables['rpc:spectator_positions'] = [
      { name: 'Aldenmar', class: 'Cleric', group_num: 1, level: 60, hp_pct: 90, loc_x: 111, loc_y: -222, loc_z: 7, heading: 128, loc_at: at, uploaded_by_discord_id: 'u1' },
      { name: 'Brackwyn', class: 'Warrior', group_num: 1, level: 60, hp_pct: 40, loc_x: 1, loc_y: 2, loc_z: 3, heading: null, loc_at: at, uploaded_by_discord_id: 'u1' },
    ];
    db.tables.character_live_state = [{ character: 'Aldenmar', zone_id: 100, zone_name: 'x' }];
    db.tables.eqemu_zone = [{ zone_id: 100, short_name: 'poinnovation', long_name: 'Plane of Innovation' }];
    const { GET } = await import('../web/app/api/spectator/positions/route.ts');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.zones).toEqual([{ zone: 'poinnovation', name: 'Plane of Innovation', count: 2 }]);
    expect(body.raiders.find(r => r.name === 'Aldenmar')).toMatchObject({ x: -222, y: 111, z: 7, cls: 'Cleric', hp: 90, zone: 'poinnovation' });
    // Brackwyn runs no Mimic: placed with the raiders their uploader reports.
    expect(body.raiders.find(r => r.name === 'Brackwyn')).toMatchObject({ zone: 'poinnovation' });
    expect(JSON.stringify(body)).not.toContain('u1');
  });

  it('bounds every read: a fresh-position window and a row cap on each table', async () => {
    db.user = { id: 'member-1' };
    db.tables['rpc:spectator_positions'] = [{ name: 'Aldenmar', class: 'Cleric', group_num: 1, level: 60, hp_pct: 90, loc_x: 1, loc_y: 2, loc_z: 3, heading: 0, loc_at: new Date().toISOString(), uploaded_by_discord_id: 'u1' }];
    db.tables.character_live_state = [{ character: 'Aldenmar', zone_id: 100, zone_name: 'x' }];
    db.tables.eqemu_zone = [{ zone_id: 100, short_name: 'poinnovation', long_name: 'Plane of Innovation' }];
    const { GET } = await import('../web/app/api/spectator/positions/route.ts');
    await GET();
    const ops = (t) => db.calls.find(c => c.table === t).ops;
    // One row per raider from SQL, inside the 30 s window, at most 300 rows.
    expect(ops('rpc:spectator_positions')[0]).toEqual(['args', { p_guild_id: 'wolfpack', p_fresh_s: 30 }]);
    expect(ops('rpc:spectator_positions').find(o => o[0] === 'range')).toEqual(['range', 0, 299]);
    expect(ops('character_live_state').find(o => o[0] === 'range')).toEqual(['range', 0, 199]);
    expect(ops('character_live_state').find(o => o[0] === 'in')[2]).toEqual(['Aldenmar']);
    expect(ops('eqemu_zone').find(o => o[0] === 'limit')[1]).toBeLessThanOrEqual(100);
  });

  it('an empty raid reads only the positions RPC', async () => {
    db.user = { id: 'member-1' };
    const { GET } = await import('../web/app/api/spectator/positions/route.ts');
    const body = await (await GET()).json();
    expect(body).toMatchObject({ raiders: [], zones: [], unplaced: 0 });
    expect(db.calls.map(c => c.table)).toEqual(['rpc:spectator_positions']);
  });
});
