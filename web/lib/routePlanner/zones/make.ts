// Fill in a zone: the defaults, the zone's own settings (its .ts), and anything its data file carries in `config`, in that
// order, then every optional part of the data file (floors, pathers, links, the averaged route, trash ...) so the page and
// the engine never test for a missing key. A zone file can be as small as walls + mobs + nights.
import type { Floor, Mob, ZoneConfig, ZoneData, ZoneJson } from '../types';

/** The three bands of the Plane of Tactics: what a zone with no floors of its own gets. */
export const DEFAULT_FLOORS: Floor[] = [
  { key: 'up', label: 'War Room level', zmin: 165 },
  { key: 'mid', label: 'Middle', zmin: -18, zmax: 164 },
  { key: 'pit', label: 'Pit', zmax: -19 },
];

const DEFAULT_LABELS: ZoneConfig['layerLabels'] = {
  bosses: 'Bosses and named (catalog spawn points)',
  scripted: 'Scripted spawns (no spawn point)',
  leash: 'Leash lines',
  avg: 'Averaged route from the site (gold)',
  trash: 'Trash spawn points',
  minor: 'Minor friendly NPCs',
  pathers: 'Pathers (where NPCs walk)',
  links: 'Doors, locks and teleports',
};

type Extent = { x0: number; x1: number; y0: number; y1: number };

/** The box around everything the data file draws, for a zone that does not say how big it is. */
function extentOf(json: ZoneJson): Extent {
  const e: Extent = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  const add = (x: number, y: number) => { if (x < e.x0) e.x0 = x; if (x > e.x1) e.x1 = x; if (y < e.y0) e.y0 = y; if (y > e.y1) e.y1 = y; };
  for (const w of Object.values(json.walls ?? {})) for (let i = 0; i + 1 < w.length; i += 2) add(w[i], w[i + 1]);
  for (const m of json.mobs ?? []) add(m.x, m.y);
  for (const p of json.pathers ?? []) for (const q of p.points) add(q[0], q[1]);
  for (const l of json.links ?? []) { add(l.from[0], l.from[1]); if (l.to) add(l.to[0], l.to[1]); }
  return Number.isFinite(e.x0) ? e : { x0: -1000, x1: 1000, y0: -1000, y1: 1000 };
}
const pad = (e: Extent, by: number): Extent => ({ x0: e.x0 - by, x1: e.x1 + by, y0: e.y0 - by, y1: e.y1 + by });
const roundOut = (e: Extent, step: number): Extent => ({
  x0: Math.floor(e.x0 / step) * step, x1: Math.ceil(e.x1 / step) * step, y0: Math.floor(e.y0 / step) * step, y1: Math.ceil(e.y1 / step) * step,
});

export type ZoneSettings = Partial<ZoneConfig> & Pick<ZoneConfig, 'zone' | 'zoneId' | 'name'>;

export function makeZone(settings: ZoneSettings, json: ZoneJson): ZoneData {
  const own = { ...settings, ...(json.config ?? {}) };
  const ext = extentOf(json);
  const bounds = own.bounds ?? pad(ext, 150);
  const mobs: Mob[] = [...(json.mobs ?? [])];
  const start = own.start ?? { mob: 'zonein', label: 'Zone-in', kind: 'door' as const };
  if (!mobs.some(m => m.id === start.mob)) {
    // a zone with no recorded entrance: the pin the build starts from sits at the centre of what is drawn
    const at = json.zonein ?? { x: Math.round((ext.x0 + ext.x1) / 2), y: Math.round((ext.y0 + ext.y1) / 2) };
    mobs.unshift({ tier: 1, id: start.mob, name: 'Zone-in (safe point)', kind: 'door', x: at.x, y: at.y });
  }
  const floors = json.floors ?? own.floors ?? DEFAULT_FLOORS;
  return {
    title: `${own.name} route planner`,
    blurb: `${own.name}. Plan an ordered route, bend it around walls, snap it to our recorded nights.`,
    bounds,
    grid: roundOut(pad(bounds, 400), 500),
    focus: { label: 'Zoom to plan', ...bounds },
    floorNote: 'Walls: public EQEmu maps.',
    trashColors: {},
    sourceNote: 'Catalog spawn points: eqemu_spawn2 joined to the NPC catalog.',
    popKeys: [],
    groups: [],
    ...own,
    start,
    floors,
    layerLabels: { ...DEFAULT_LABELS, ...(own.layerLabels ?? {}) },
    walls: json.walls ?? {},
    nights: json.nights ?? [],
    avg: json.avg ?? { stops: [], legs: [] },
    mobs,
    minor: json.minor ?? [],
    trash: json.trash ?? [],
    marks: json.marks,
    pathers: json.pathers ?? [],
    links: json.links ?? [],
    stub: !!json.stub,
  };
}
