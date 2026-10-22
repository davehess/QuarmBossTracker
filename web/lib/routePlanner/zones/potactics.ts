// Plane of Tactics (Drunder) for the route planner. The big static data (walls, the recorded nights, the mobs with
// their script links, the trash spawn points) is potactics.json; this file is the per-zone settings and the build order.
//
// ⚠ STATIC for now (the guild lead, 2026-10-21): the recorded nights are the three the officers used on 2026-10-21
// (pasted from raid_track_minutes). Making them live later = the same reduction web/lib/raidRoutesLoad.ts already does
// (centroidSeries over the zone's raid_track_minutes frames, 3 s apart), written as `nights` instead of an averaged
// route; the walls are the EQEmu map, mobs and spawn points are eqemu_spawn2/eqemu_npc_types.
import type { ZoneJson } from '../types';
import { makeZone, type ZoneSettings } from './make';
import json from './potactics.json';

const settings: ZoneSettings = {
  zone: 'potactics',
  zoneId: 214,
  name: 'Plane of Tactics',
  title: 'Tactics route planner',
  blurb: 'Plane of Tactics (Drunder). Plan an ordered route, bend it around walls, snap it to our recorded nights.',
  bounds: { x0: -1130, x1: 1800, y0: -2200, y1: 2220 },
  grid: { x0: -1500, x1: 2000, y0: -2500, y1: 2500 },
  focus: { label: 'War Room', x0: 180, x1: 1290, y0: -700, y1: 700 },
  floors: [
    { key: 'up', label: 'War Room level', zmin: 165 },
    { key: 'mid', label: 'Middle', zmin: -18, zmax: 164 },
    { key: 'pit', label: 'Pit', zmax: -19 },
  ],
  floorNote: 'War Room level z at or above 165, middle z 1..141, pit z at or below -19. Walls: public EQEmu maps.',
  layerLabels: {
    bosses: 'Bosses and named (catalog spawn points)',
    scripted: 'Scripted spawns (no spawn point)',
    leash: 'Leash lines (Tallon/Vallon x 820, Warlord box)',
    avg: 'Averaged route from the site (gold)',
    trash: 'Elite trash spawn points',
    minor: 'Friendly L35 NPCs, Tagrin area',
    pathers: 'Pathers (where NPCs walk)',
    links: 'Doors, locks and teleports',
  },
  trashColors: { Decorin: '#d29922', Diaku: '#8b949e', Gindan: '#bc8cff', Hendin: '#79c0ff' },
  sourceNote: 'Catalog spawn points: eqemu_spawn2 joined to the NPC catalog. Scripted: from SecretsOTheP/quests (potactics), each with a link to the exact lines.',

  // The PoP checklist steps (web/lib/popGuide.ts) that happen in this zone, in the guide's own order.
  popKeys: ['flag_vallon', 'flag_tallon', 'flag_rallos'],
  buildNotes: {
    greedy: 'Built with nearest-next from the zone-in (straight-line distance); the Rallos event stays one chain: Decorins, then Tallon and Vallon, upstairs Rallos, the Warlord, his Projection.',
    checklist: 'Built in PoP checklist order (Vallon, Tallon, Rallos event) then the west-wing bosses in the recorded night order (Tagrin, Overseer, Glykus). Zone-in first.',
  },

  start: { mob: 'zonein', label: 'Zone-in', kind: 'door' },
  groups: [
    // The friendly hail at the foot of the entrance corridor: not a raid target, so optional and always first.
    { id: 'giwin', rank: -1, lead: true, pins: [{ mob: 'giwin', optional: true, note: 'Friendly: hail only (not a raid target). Optional.' }] },
    // The Rallos event is ONE chain: nothing in it can be taken out of order.
    {
      id: 'event', rank: 3, popKey: 'flag_rallos', mimicRaid: 'rallos-event', swapFirstTwo: true,
      pins: [
        { mob: 'berik', note: 'Rallos event P1: both Decorins must die' },
        { mob: 'grunhork', note: 'Rallos event P1: both Decorins must die' },
        { mob: 'tallon_ev', note: 'P2: spawns at this point when both Decorins die, walks to the council room' },
        { mob: 'vallon_ev', note: 'P2: spawns with Tallon, splits at 50%' },
        { mob: 'rallos_up', note: 'P3: spawns when both brothers are dead' },
        { mob: 'warlord', note: 'P4: spawns at upstairs Rallos 50%; pit adds' },
        { mob: 'proj_rallos', label: 'Hail Planar Projection (Rallos)', kind: 'objective', y: -40, note: 'Spawns where the Warlord dies (approximate point)' },
      ],
    },
    {
      id: 'vallon', rank: 1, popKey: 'flag_vallon', mimicRaid: 'vallon-a',
      pins: [
        { mob: 'vallon_home', note: 'Checklist: Kill Vallon Zek. Splits at 50%; hail the Projection after.' },
        { mob: 'proj_vallon', label: 'Hail Planar Projection (Vallon)', kind: 'objective', note: 'Spawns where the real Vallon dies (the split box)' },
      ],
    },
    {
      id: 'tallon', rank: 2, popKey: 'flag_tallon',
      pins: [
        { mob: 'tallon_home', note: 'Checklist: Kill Tallon Zek. Hail the Projection after.' },
        { mob: 'proj_tallon', label: 'Hail Planar Projection (Tallon)', kind: 'objective', y: -1998, note: 'Spawns where Tallon dies (approximate point)' },
      ],
    },
    { id: 'tagrin', rank: 4, pins: [{ mob: 'tagrin', note: 'Recorded route stop 1' }, { mob: 'eriak', optional: true, note: 'Named next to Tagrin (optional)' }] },
    { id: 'overseer', rank: 5, pins: [{ mob: 'overseer', note: 'Recorded route stop 2' }] },
    { id: 'glykus', rank: 6, pins: [{ mob: 'glykus', note: 'Recorded route stop 3' }] },
  ],
};

export const potactics = makeZone(settings, json as unknown as ZoneJson);
