// Fixture for the Map capture (web/public/raidmimic/shots/map.webp): the payload the agent's _mapStatePayload returns
// to apps/mimic/map.html (GET /api/map-state), for Plane of Nightmares (ponightmare).
//
// What is real and what is not:
//  - Spawn points, positions, respawn times, mob names and aggro radii are the zone's game data (the eqemu_* mirror).
//  - The WALLS are EQEmu-generated: map-walls-ponightmare.json is cropped from the EQEmu server collision mesh
//    (EQEmu/maps, GPLv2-or-later, Copyright (C) 2004-2009 EQEmulator.NET, AX-Classic, and ProjectEQ), sliced with
//    web/lib/zoneMap/slice.ts. It is never a Brewall map: those lines have no stated licence and are not committed.
//  - Everything about "tonight" (who stands where, which mobs are up, what died when, the trails) is invented, and every
//    player name is in fixtures.mjs PLAYERS.
//
// The overlay's clock is pinned to T (fixtures.mjs), so `now` here is T.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { T } from './fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WALLS = JSON.parse(fs.readFileSync(path.join(HERE, 'map-walls-ponightmare.json'), 'utf8'));

const MIN = 60000;
const mob = (name, chance, extra = {}) => ({ name, chance, aggro: 100, assist: null, level: 62, fac: 674, named: false, raid_target: false, badges: [], ...extra });

// [id, x, y, z, respawn s, npcs]. Cropped to the area on screen.
const POINTS = [
  [345912, -697, 1531, 168, 1170, [mob('a_gloom_nightmare', 100)]],
  [345913, -651, 1287, 168, 1170, [mob('a_gloom_nightmare', 100)]],
  [345914, -224, 1280, 168, 1170, [mob('a_gloom_nightmare', 100)]],
  [345915, -227, 1698, 181, 1170, [mob('a_gloom_nightmare', 100)]],
  [345916, -407, 1418, 172, 259200, [mob('Vhaksiz_the_Shade', 100, { level: 65, named: true })]],
  [346076, -501, 1786, 161, 700, [mob('#an_agony_mephit', 2, { level: 60, named: true }), mob('a_mephit', 78, { level: 57 }), mob('a_misery_mephit', 20, { level: 58 })]],
  [346077, -379, 1876, 117, 700, [mob('#an_agony_mephit', 2, { level: 60, named: true }), mob('a_mephit', 78, { level: 57 }), mob('a_misery_mephit', 20, { level: 58 })]],
  [346292, 166, 1634, 175, 700, [mob('a_hobgoblin', 100, { level: 56 })]],
  [346293, -13, 1636, 171, 700, [mob('a_hobgoblin', 100, { level: 56 })]],
  [346294, -30, 1699, 210, 700, [mob('a_hobgoblin', 100, { level: 56 })]],
  [346295, 29, 1545, 104, 700, [mob('a_hobgoblin', 100, { level: 56 })]],
  [346304, 280, 1630, 169, 700, [mob('a_scourge_hobgoblin', 99, { level: 58 }), mob('#a_painwrack_hobgoblin', 1, { level: 60, named: true })]],
].map(([id, x, y, z, rs, npcs]) => ({ id, x, y, z, grid: null, respawn: rs, sg: null, npcs }));

// A timer from "died N minutes ago", with the window the respawn time gives (80% to 120% of it).
const timer = (pointId, name, agoMin, by) => {
  const p = POINTS.find((q) => q.id === pointId);
  const died = T - agoMin * MIN;
  return { point_id: pointId, name, died_at: died, earliest: died + p.respawn * 800, latest: died + p.respawn * 1200, source: 'seen', by };
};

// An observed walk: [x, y, z, t, brk] crumbs, newest last.
const walk = (pts, z) => pts.map(([x, y], i) => [x, y, z, T - (pts.length - i) * 4000, 0]);

export function mapState() {
  const target = { name: 'a gloom nightmare', id: 433, hp_pct: 68, x: -566, y: 1352, z: 170, dist: 135, point_id: 345913, type: 1, tot: { id: 7001, name: 'Brackwyn' } };
  return {
    zone: 'ponightmare', long_name: 'Plane of Nightmares', zone_id: 204, version: 'ponightmare@2026-10-21', status: 'ok', local_only: false,
    map: { bounds: { minX: -1250, maxX: 450, minY: 800, maxY: 2100 }, bands: WALLS.bands, segs: WALLS.segs },
    local_map: null, local_version: null,
    points: POINTS, grids: null, factions: null, spawngroups: null,
    pos_at: T, now: T, copy: null, cons: {}, cc: [], me: { name: 'Aldenmar', level: 65, race: 1, cls: 3, deity: 201 },
    self: { name: 'Aldenmar', x: -380, y: 1520, z: 170, heading: 170 },
    group: [],
    raid: [
      { name: 'Brackwyn', class: 'Warrior', grp: '1', x: -515, y: 1418, z: 170, heading: 120 },
      { name: 'Corvale', class: 'Cleric', grp: '1', x: -300, y: 1545, z: 170, heading: 200 },
      { name: 'Rethlan', class: 'Wizard', grp: '2', x: -410, y: 1565, z: 171, heading: 90 },
      { name: 'Nyssara', class: 'Enchanter', grp: '2', x: -325, y: 1480, z: 170, heading: 260 },
      { name: 'Zarrin', class: 'Ranger', grp: '3', x: -455, y: 1500, z: 170, heading: 40 },
    ],
    target, focus: null, corpses: [], watched: {}, legs: {}, kite: null,
    // Two walks the raid has been watching: the pulled mob coming off its spawn point toward the raid, and a mephit
    // wandering between two spots.
    paths: {
      'a gloom nightmare': { name: 'a gloom nightmare', at: T, live: true,
        pts: walk([[-651, 1287], [-640, 1296], [-628, 1310], [-612, 1319], [-598, 1334], [-585, 1337], [-575, 1345], [-566, 1352]], 169) },
      'a mephit': { name: 'a mephit', at: T - 20000, live: false,
        pts: walk([[-640, 1740], [-612, 1758], [-585, 1771], [-562, 1760], [-540, 1775], [-520, 1790], [-501, 1786]], 161) },
    },
    timers: [
      timer(345915, 'a gloom nightmare', 5, 'Brackwyn'),
      timer(345914, 'a gloom nightmare', 24, 'Corvale'),
      timer(346292, 'a hobgoblin', 17, 'Rethlan'),
      timer(346293, 'a hobgoblin', 18, 'Nyssara'),
      timer(346294, 'a hobgoblin', 21, 'Zarrin'),
      timer(346295, 'a hobgoblin', 3, 'Brackwyn'),
      timer(346304, 'a scourge hobgoblin', 8, 'Corvale'),
      timer(346077, 'a mephit', 6, 'Rethlan'),
    ],
    seen: [
      { point_id: 345916, spawn_id: 432, name: 'Vhaksiz the Shade', at: T - 45000, by: 'Corvale', hp_pct: 100, hp_live: true },
      { point_id: 345912, spawn_id: 431, name: 'a gloom nightmare', at: T - 2 * MIN, by: 'Brackwyn', hp_pct: null, hp_live: false },
      { point_id: 346076, spawn_id: 4812, name: 'a mephit', at: T - 5 * MIN, by: 'Rethlan', hp_pct: null, hp_live: false },
      // The pulled one: hurt and away from home, so its aggro circle rides it and the list shows it under Engaged.
      { point_id: 345913, spawn_id: 433, name: 'a gloom nightmare', at: T - 3000, by: 'Aldenmar', hp_pct: 68, hp_live: true, engaged: true,
        pos: { x: -566, y: 1352, z: 170, at: T - 1000 } },
    ],
    engaged: [{ name: 'a gloom nightmare', spawn_id: 433, hp_pct: 68, n: 3, point_id: 345913, hp_at: T, hp_live: true }],
    unassigned: [{ id: 1, name: 'a hobgoblin', died_at: T - 2 * MIN, candidates: [346292, 346293] }],
  };
}

// What the overlay keeps in localStorage on the capture machine: aggro circles on, the pane scaled to the area.
export const MAP_LS = {
  'wp-map-cfg': JSON.stringify({ show: { aggro: true }, wallMode: 'one' }),
  'wp-map-scale': '0.55',
  'wp-map-walls': 'ours',
  'wp-map-levels': '7',
};

// ─── The raid pull: Plane of Disease, zoomed in on the building's floor plan (web/public/raidmimic/shots/map-raid.webp) ───
// Walls are EQEmu-generated like the capture above (map-walls-podisease.json, cropped from base/podisease.map). Spawn points,
// mob names, levels and respawn times are the zone's game data (the eqemu_* mirror). Bertoxxulous is placed by a script in
// the real zone and has no spawn point, so where he stands, and every raider, is invented for this capture.
const WALLS_DIS = JSON.parse(fs.readFileSync(path.join(HERE, 'map-walls-podisease.json'), 'utf8'));

// [id, x, y, z, respawn s, npcs]
const DIS_POINTS = [
  [344757, 2038, -332, 327.3, 1170, [mob('Guardian_of_Pestilence', 100, { level: 61 })]],
  [344758, 1979, -292, 327.3, 1170, [mob('Guardian_of_Pestilence', 100, { level: 61 })]],
  [344759, 1908, -327, 327.3, 1170, [mob('Guardian_of_Pestilence', 100, { level: 61 })]],
  [344760, 1915, -298, 327.3, 1170, [mob('Guardian_of_Pestilence', 100, { level: 61 })]],
  [344762, 2041, -275, 333.5, 237600, [mob('#Grummus', 100, { level: 70, named: true, raid_target: true })]],
  [344889, 1817, -237, 327.3, 1170, [mob('a_firebone_caster', 100, { level: 58 })]],
  [344890, 1843, -245, 327.3, 1170, [mob('a_firebone_caster', 100, { level: 58 })]],
].map(([id, x, y, z, rs, npcs]) => ({ id, x, y, z, grid: null, respawn: rs, sg: null, npcs }));

const disTimer = (pointId, name, agoMin, by) => {
  const p = DIS_POINTS.find((q) => q.id === pointId);
  const died = T - agoMin * MIN;
  return { point_id: pointId, name, died_at: died, earliest: died + p.respawn * 800, latest: died + p.respawn * 1200, source: 'seen', by };
};

export function raidMapState() {
  const boss = { name: 'Bertoxxulous', id: 5871, hp_pct: 62, x: 2000, y: -330, z: 328, dist: 152, point_id: null, type: 1, tot: { id: 7003, name: 'Brackwyn' } };
  return {
    zone: 'podisease', long_name: 'Plane of Disease', zone_id: 205, version: 'podisease@2026-10-23', status: 'ok', local_only: false,
    map: { bounds: { minX: 1550, maxX: 2260, minY: -460, maxY: 580 }, bands: WALLS_DIS.bands, segs: WALLS_DIS.segs },
    local_map: null, local_version: null,
    points: DIS_POINTS, grids: null, factions: null, spawngroups: null,
    pos_at: T, now: T, copy: null, cons: {}, cc: [], me: { name: 'Aldenmar', level: 65, race: 1, cls: 3, deity: 201 },
    // Headings are the game's 0..511 turn; the boss is south-east of the group, which is about 215.
    self: { name: 'Aldenmar', x: 1935, y: -195, z: 327, heading: 216 },
    group: [
      { name: 'Brackwyn', class: 'Warrior', x: 1990, y: -290, z: 327, heading: 214 },
      { name: 'Corvale', class: 'Cleric', x: 1893, y: -168, z: 327, heading: 232 },
      { name: 'Rethlan', class: 'Wizard', x: 1912, y: -222, z: 327, heading: 205 },
      { name: 'Nyssara', class: 'Enchanter', x: 1958, y: -165, z: 327, heading: 240 },
      { name: 'Zarrin', class: 'Ranger', x: 1862, y: -212, z: 327, heading: 175 },
    ],
    raid: [
      { name: 'Odelle', class: 'Druid', grp: '2', x: 1882, y: -250, z: 327, heading: 150 },
      { name: 'Halric', class: 'Paladin', grp: '2', x: 1955, y: -245, z: 327, heading: 222 },
      { name: 'Tavrin', class: 'Shaman', grp: '3', x: 1836, y: -176, z: 327, heading: 262 },
    ],
    target: boss, focus: null, corpses: [], watched: {}, legs: {}, kite: null,
    paths: {},
    timers: [
      disTimer(344758, 'Guardian of Pestilence', 6, 'Brackwyn'),
      disTimer(344889, 'a firebone caster', 14, 'Zarrin'),
    ],
    seen: [
      { point_id: 344757, spawn_id: 4101, name: 'Guardian of Pestilence', at: T - 30000, by: 'Aldenmar', hp_pct: 100, hp_live: true },
      { point_id: 344762, spawn_id: 4108, name: 'Grummus', at: T - 50000, by: 'Corvale', hp_pct: 100, hp_live: true },
    ],
    engaged: [], unassigned: [],
  };
}

// The overlay's own settings on the capture machine: aggro rings on, raiders shown as facing slices, names on targets only is
// the Labels button, the view fitted to the group, the Timers list slid away so the map takes the whole width.
export const RAID_MAP_LS = {
  'wp-map-cfg': JSON.stringify({ show: { aggro: true }, facing: 'slice', wallMode: 'layers', wallV: 2 }),
  'wp-map-labels': 'targets',
  'wp-map-fit': 'group',
  'wp-map-side': '0',
  'wp-map-scale': '1.4',
  'wp-map-walls': 'ours',
  'wp-map-levels': '3',
};
