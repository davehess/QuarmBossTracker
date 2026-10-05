// /spectator: the pure parts. No React, no Supabase, so the positions route, the board and the tests share
// one copy of the rules that are easy to get backwards.
//
// FRAMES (read before touching a coordinate):
//   * raid_roster stores the numbers Zeal's pipe sends, which are the /loc numbers in /loc order. Measured
//     2026-10-04 on live data against eqemu_spawn2: SERVER x = raid_roster.loc_y, SERVER y = raid_roster.loc_x.
//   * The zone map (and eqemu_spawn2) are in the SERVER frame.
//   * The picture matches Zeal's own map, north up: screen_x = -x, screen_y = -y with canvas y growing down.
//   * Heading is 0-512. The direction it turns is NOT yet checked in game (DESIGN-zone-radar.md); the
//     assumption (0 = north, counter-clockwise: 128 = west) is HEADING_CCW, one switch to flip it.

export const POSITION_FRESH_S = 30;   // a position older than this is not shown at all
export const DOT_STALE_S = 10;        // older than this the dot is drawn faded
export const ZONE_LIVE_MS = 10 * 60 * 1000;   // how fresh a character_live_state zone must be (the bot uses the same)
export const HEADING_CCW = true;

export type RosterPosRow = {
  name: string | null;
  class: string | null;
  group_num: number | null;
  level: number | null;
  hp_pct: number | string | null;
  loc_x: number | null;
  loc_y: number | null;
  loc_z: number | null;
  heading: number | null;
  loc_at: string | null;
  uploaded_by_discord_id: string | null;
};

export type Raider = {
  name: string;
  cls: string | null;
  group: number | null;
  level: number | null;
  hp: number | null;
  x: number;          // server frame
  y: number;
  z: number;
  heading: number | null;
  zone: string;       // eqemu_zone.short_name
  age_s: number;
};

export type ZoneCount = { zone: string; name: string; count: number };

export type Positions = {
  at: string;
  raiders: Raider[];
  zones: ZoneCount[];
  unplaced: number;   // fresh positions whose zone could not be worked out
};

const lower = (s: string) => s.trim().toLowerCase();
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** raid_roster (loc_x, loc_y) -> the server frame. The two columns are swapped. */
export function serverXY(locX: number, locY: number): { x: number; y: number } {
  return { x: locY, y: locX };
}

/** Server frame -> the north-up picture. */
export function toScreen(x: number, y: number): { sx: number; sy: number } {
  return { sx: -x, sy: -y };
}

/**
 * One row per raider name (case-insensitive): the one with the newest loc_at. Several uploaders can
 * report the same raider, and the roster table keeps only the last writer, but the rule is cheap and the
 * page must not draw a raider twice if that ever changes. Rows with no usable position or time are dropped.
 */
export function freshestPerName<T extends Pick<RosterPosRow, 'name' | 'loc_at' | 'loc_x' | 'loc_y'>>(rows: T[]): T[] {
  const best = new Map<string, { row: T; at: number }>();
  for (const r of rows) {
    if (!r.name || !finite(r.loc_x) || !finite(r.loc_y) || !r.loc_at) continue;
    const at = Date.parse(r.loc_at);
    if (!Number.isFinite(at)) continue;
    const k = lower(r.name);
    const cur = best.get(k);
    if (!cur || at > cur.at) best.set(k, { row: r, at });
  }
  return [...best.values()].map(v => v.row);
}

function topVote(votes: Map<number, number> | undefined): number | null {
  if (!votes) return null;
  let best: number | null = null;
  let n = 0;
  for (const [zone, c] of votes) {
    if (c > n || (c === n && best !== null && zone < best)) { best = zone; n = c; }
  }
  return best;
}

/**
 * The zone id of every raider, by lowercase name. Most raiders do not run Mimic, so most have no
 * character_live_state row. A roster row only carries a position for a raider who is in the UPLOADER's zone
 * (Zeal has a position only for a live entity in the zone it is in), so a raider with no zone of their own
 * is placed with their uploader's raiders, then with the raid as a whole:
 *   1. the raider's own live zone, when known;
 *   2. the zone most of that uploader's known raiders are in;
 *   3. the zone most of all known raiders are in;
 *   4. null.
 */
export function resolveZoneIds(
  rows: Pick<RosterPosRow, 'name' | 'uploaded_by_discord_id'>[],
  liveZoneByName: Map<string, number>,
): Map<string, number | null> {
  const byUploader = new Map<string, Map<number, number>>();
  const overall = new Map<number, number>();
  const bump = (m: Map<number, number>, z: number) => m.set(z, (m.get(z) ?? 0) + 1);
  for (const r of rows) {
    if (!r.name) continue;
    const z = liveZoneByName.get(lower(r.name));
    if (z == null) continue;
    const u = r.uploaded_by_discord_id ?? '';
    if (!byUploader.has(u)) byUploader.set(u, new Map());
    bump(byUploader.get(u)!, z);
    bump(overall, z);
  }
  const fallbackAll = topVote(overall);
  const out = new Map<string, number | null>();
  for (const r of rows) {
    if (!r.name) continue;
    const k = lower(r.name);
    out.set(k, liveZoneByName.get(k) ?? topVote(byUploader.get(r.uploaded_by_discord_id ?? '')) ?? fallbackAll);
  }
  return out;
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Roster rows + zone knowledge -> the feed. `zoneById` maps an eqemu zone id to its short and long name.
 * Sorted by group (ungrouped last) then name; zones by head count then name.
 */
export function buildPositions(
  rows: RosterPosRow[],
  liveZoneByName: Map<string, number>,
  zoneById: Map<number, { short: string; long: string | null }>,
  nowMs: number,
): Positions {
  const fresh = freshestPerName(rows).filter(r => {
    const age = (nowMs - Date.parse(r.loc_at as string)) / 1000;
    return age <= POSITION_FRESH_S;
  });
  const zoneIds = resolveZoneIds(fresh, liveZoneByName);
  const raiders: Raider[] = [];
  const counts = new Map<string, ZoneCount>();
  let unplaced = 0;
  for (const r of fresh) {
    const zid = zoneIds.get(lower(r.name as string));
    const z = zid == null ? undefined : zoneById.get(zid);
    if (!z) { unplaced++; continue; }
    const { x, y } = serverXY(r.loc_x as number, r.loc_y as number);
    const hp = num(r.hp_pct);
    raiders.push({
      name: r.name as string,
      cls: r.class || null,
      group: finite(r.group_num) ? r.group_num : null,
      level: finite(r.level) ? r.level : null,
      hp: hp == null ? null : Math.max(0, Math.min(100, Math.round(hp))),
      x, y,
      z: finite(r.loc_z) ? r.loc_z : 0,
      heading: finite(r.heading) ? r.heading : null,
      zone: z.short,
      age_s: Math.max(0, Math.round((nowMs - Date.parse(r.loc_at as string)) / 1000)),
    });
    const c = counts.get(z.short);
    if (c) c.count++; else counts.set(z.short, { zone: z.short, name: z.long || z.short, count: 1 });
  }
  raiders.sort((a, b) =>
    (a.group ?? 1e9) - (b.group ?? 1e9) || a.name.localeCompare(b.name));
  const zones = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { at: new Date(nowMs).toISOString(), raiders, zones, unplaced };
}

/** The zone to show: the viewer's pick while it still has raiders in it, else the busiest zone. */
export function pickZone(zones: ZoneCount[], chosen: string | null): string | null {
  if (chosen && zones.some(z => z.zone === chosen)) return chosen;
  let best: ZoneCount | null = null;
  for (const z of zones) if (!best || z.count > best.count) best = z;
  return best ? best.zone : null;
}

// ── Classes ─────────────────────────────────────────────────────────────────

// Colour is the class, the one thing a dot has to say; the roster beside the map spells the class out, so
// the map never relies on colour alone. Hues step around the wheel; Cleric is white, as in the raid window.
export const CLASS_COLORS: Record<string, string> = {
  'Warrior': '#e07a3f', 'Druid': '#f0a53a', 'Paladin': '#f2e04b', 'Rogue': '#b8d63a',
  'Ranger': '#56d364', 'Shaman': '#2fc9a0', 'Monk': '#3fd0d9', 'Magician': '#4fa8ff',
  'Wizard': '#7585f0', 'Enchanter': '#a371f7', 'Necromancer': '#d36bf0', 'Bard': '#f08ad2',
  'Shadow Knight': '#d6456b', 'Beastlord': '#b98563', 'Cleric': '#e6edf3',
};
export const UNKNOWN_CLASS_COLOR = '#6e7681';

const CLASS_ALIASES: Record<string, string> = {
  war: 'Warrior', pal: 'Paladin', rng: 'Ranger', shd: 'Shadow Knight', sk: 'Shadow Knight',
  shadowknight: 'Shadow Knight', dru: 'Druid', mnk: 'Monk', brd: 'Bard', rog: 'Rogue',
  shm: 'Shaman', nec: 'Necromancer', necro: 'Necromancer', wiz: 'Wizard', mag: 'Magician',
  mage: 'Magician', enc: 'Enchanter', bst: 'Beastlord', clr: 'Cleric',
};
const CLASS_ABBR: Record<string, string> = {
  'Warrior': 'WAR', 'Paladin': 'PAL', 'Ranger': 'RNG', 'Shadow Knight': 'SHD', 'Druid': 'DRU',
  'Monk': 'MNK', 'Bard': 'BRD', 'Rogue': 'ROG', 'Shaman': 'SHM', 'Necromancer': 'NEC',
  'Wizard': 'WIZ', 'Magician': 'MAG', 'Enchanter': 'ENC', 'Beastlord': 'BST', 'Cleric': 'CLR',
};

/** Any spelling Zeal or the agent sends (full name, three-letter, "shadowknight") -> the canonical class, or null. */
export function canonicalClass(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const k = raw.trim().toLowerCase();
  for (const c of Object.keys(CLASS_COLORS)) if (c.toLowerCase() === k) return c;
  return CLASS_ALIASES[k] ?? null;
}
export const classColor = (raw: string | null | undefined): string => {
  const c = canonicalClass(raw);
  return c ? CLASS_COLORS[c] : UNKNOWN_CLASS_COLOR;
};
export const classAbbr = (raw: string | null | undefined): string => {
  const c = canonicalClass(raw);
  return c ? CLASS_ABBR[c] : (raw ? raw.slice(0, 3).toUpperCase() : '?');
};

// ── Geometry ────────────────────────────────────────────────────────────────

/** Unit vector (screen frame, y down) a raider faces. Heading 0-512; see HEADING_CCW. */
export function headingVec(heading: number): { dx: number; dy: number } {
  const turn = ((heading % 512) + 512) % 512 / 512 * Math.PI * 2;
  const a = HEADING_CCW ? turn : -turn;
  return { dx: -Math.sin(a), dy: -Math.cos(a) };
}

export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Index of the floor band whose z is nearest `z`, or -1 with no bands. */
export function nearestBand(bands: number[], z: number | null): number {
  if (z == null || !bands.length) return -1;
  let best = 0;
  for (let i = 1; i < bands.length; i++) if (Math.abs(bands[i] - z) < Math.abs(bands[best] - z)) best = i;
  return best;
}

export type View = { cx: number; cy: number; scale: number };   // centre in screen-frame units; px per unit
export const MIN_SCALE = 0.02;
export const MAX_SCALE = 8;
const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

/** A view that fits a screen-frame box into w x h pixels with `pad` pixels spare, never tighter than minSpan units. */
export function fitView(
  box: { minX: number; maxX: number; minY: number; maxY: number },
  w: number, h: number, pad = 32, minSpan = 300,
): View {
  const spanX = Math.max(box.maxX - box.minX, minSpan);
  const spanY = Math.max(box.maxY - box.minY, minSpan);
  const scale = clampScale(Math.min(Math.max(w - pad * 2, 1) / spanX, Math.max(h - pad * 2, 1) / spanY));
  return { cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, scale };
}

type Box = { minX: number; maxX: number; minY: number; maxY: number };

/**
 * While the board follows the raid, when does it re-fit? Only when someone is about to leave the picture
 * or the raid has become a speck in it; otherwise the view stays put, so the map does not slide every poll.
 */
export function needsRefit(v: View, box: Box, w: number, h: number, margin = 24, minSpan = 300): boolean {
  const left = (box.minX - v.cx) * v.scale + w / 2;
  const right = (box.maxX - v.cx) * v.scale + w / 2;
  const top = (box.minY - v.cy) * v.scale + h / 2;
  const bottom = (box.maxY - v.cy) * v.scale + h / 2;
  if (left < margin || top < margin || right > w - margin || bottom > h - margin) return true;
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY, minSpan) * v.scale;
  return span < 0.35 * Math.min(w, h);
}

/** Zoom by `factor` keeping the world point under pixel (px, py) where it is. */
export function zoomAt(v: View, factor: number, px: number, py: number, w: number, h: number): View {
  const scale = clampScale(v.scale * factor);
  const k = v.scale / scale;
  const wx = v.cx + (px - w / 2) / v.scale;
  const wy = v.cy + (py - h / 2) / v.scale;
  return { scale, cx: wx - (px - w / 2) / scale, cy: wy - (py - h / 2) / scale };
}

/** The screen-frame box around a map's server-frame bounds. */
export function mapBox(b: { minX: number; maxX: number; minY: number; maxY: number }) {
  return { minX: -b.maxX, maxX: -b.minX, minY: -b.maxY, maxY: -b.minY };
}

/** The screen-frame box around some raiders. Null with none. */
export function raidBox(rs: Pick<Raider, 'x' | 'y'>[]) {
  if (!rs.length) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const r of rs) {
    const { sx, sy } = toScreen(r.x, r.y);
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  return { minX, maxX, minY, maxY };
}

/** A round scale-bar length (in game units) that is about 70-140 px wide at this scale. */
export function scaleBarUnits(scale: number): number {
  const steps = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
  for (const s of steps) if (s * scale >= 70) return s;
  return steps[steps.length - 1];
}

// ── The zone map: two layers, both in the SERVER frame ──────────────────────
//
//   eqemu   generated walls, one set of segments per floor band: segs [x1, y1, x2, y2, bandIndex]
//   brewall Brewall's EverQuest maps (the lines Zeal draws): lines [x1, y1, z1, x2, y2, z2, r, g, b] and
//           labels [x, y, z, text]. No floors of its own, so a line is placed on a floor by its z.
//
// Either layer can be missing for a zone. Nothing from either layer is stored in this repo.

export type Bounds = { minX: number; maxX: number; minY: number; maxY: number };
export type BwLine = [number, number, number, number, number, number, number, number, number];
export type BwLabel = [number, number, number, string];
export type EqemuLayer = { bands: number[]; segs: [number, number, number, number, number][]; bounds: Bounds };
export type BrewallLayer = { lines: BwLine[]; labels: BwLabel[]; bounds: Bounds };
export type ZoneMap = {
  zone: string;
  eqemu: EqemuLayer | null;
  brewall: BrewallLayer | null;
  sources: { eqemu: string; brewall: string };
};

/** How far a line's z may sit from the raid's z and still count as "on the raid's floor". */
export const FLOOR_BAND_Z = 40;

const parseBounds = (b: unknown): Bounds | null => {
  const o = b as Partial<Bounds> | null;
  return o && [o.minX, o.maxX, o.minY, o.maxY].every(finite)
    ? { minX: o.minX!, maxX: o.maxX!, minY: o.minY!, maxY: o.maxY! } : null;
};

const arr = (a: unknown): unknown[] => (Array.isArray(a) ? a : []);

function parseEqemu(j: unknown): EqemuLayer | null {
  const o = j as { bands?: unknown; segs?: unknown; bounds?: unknown } | null;
  if (!o) return null;
  const bounds = parseBounds(o.bounds);
  const bands = arr(o.bands);
  if (!bounds || !bands.every(finite)) return null;
  const segs = arr(o.segs).filter(s => Array.isArray(s) && s.length >= 5 && s.slice(0, 5).every(finite)) as EqemuLayer['segs'];
  return segs.length ? { bands: bands as number[], segs, bounds } : null;
}

function parseBrewall(j: unknown): BrewallLayer | null {
  const o = j as { lines?: unknown; labels?: unknown; bounds?: unknown } | null;
  if (!o) return null;
  const lines = arr(o.lines).filter(l => Array.isArray(l) && l.length >= 9 && l.slice(0, 9).every(finite)) as BwLine[];
  if (!lines.length) return null;
  const labels = arr(o.labels).filter(
    l => Array.isArray(l) && l.length >= 4 && l.slice(0, 3).every(finite) && typeof l[3] === 'string',
  ) as BwLabel[];
  let bounds = parseBounds(o.bounds);
  if (!bounds) {
    bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const l of lines) {
      bounds.minX = Math.min(bounds.minX, l[0], l[3]); bounds.maxX = Math.max(bounds.maxX, l[0], l[3]);
      bounds.minY = Math.min(bounds.minY, l[1], l[4]); bounds.maxY = Math.max(bounds.maxY, l[1], l[4]);
    }
  }
  return { lines, labels, bounds };
}

/** The map API's answer, checked. Anything malformed is "no map", never a crash mid-raid. */
export function parseZoneMap(j: unknown): ZoneMap | null {
  const o = j as { zone?: unknown; eqemu?: unknown; brewall?: unknown; sources?: { eqemu?: unknown; brewall?: unknown } } | null;
  if (!o || typeof o !== 'object') return null;
  const eqemu = parseEqemu(o.eqemu);
  const brewall = parseBrewall(o.brewall);
  if (!eqemu && !brewall) return null;
  return {
    zone: String(o.zone ?? ''),
    eqemu, brewall,
    sources: { eqemu: String(o.sources?.eqemu ?? ''), brewall: String(o.sources?.brewall ?? '') },
  };
}

export type LayerChoice = 'brewall' | 'generated' | 'both';

/**
 * Which layers to draw. The viewer's choice, except that a layer the zone does not have is never drawn:
 * Brewall wanted but missing falls back to the generated walls, generated wanted but missing to Brewall.
 */
export function effectiveLayers(choice: LayerChoice, map: Pick<ZoneMap, 'eqemu' | 'brewall'>): { brewall: boolean; generated: boolean } {
  let brewall = choice !== 'generated' && !!map.brewall;
  let generated = choice !== 'brewall' && !!map.eqemu;
  if (!brewall && !generated) { brewall = !!map.brewall; generated = !brewall && !!map.eqemu; }
  return { brewall, generated };
}

/** The server-frame box that covers every layer being drawn. Null when none is. */
export function layerBounds(map: Pick<ZoneMap, 'eqemu' | 'brewall'>, on: { brewall: boolean; generated: boolean }): Bounds | null {
  const bs = [on.generated ? map.eqemu?.bounds : null, on.brewall ? map.brewall?.bounds : null].filter((b): b is Bounds => !!b);
  if (!bs.length) return null;
  return {
    minX: Math.min(...bs.map(b => b.minX)), maxX: Math.max(...bs.map(b => b.maxX)),
    minY: Math.min(...bs.map(b => b.minY)), maxY: Math.max(...bs.map(b => b.maxY)),
  };
}

/**
 * Floors for a layer that has none of its own: lines are sorted by height and a new floor starts wherever
 * the next line sits more than FLOOR_BAND_Z above the last. A zone that never leaves the ground comes back
 * as one floor, and one that fragments into more than 16 is not a building at all, so it comes back empty
 * (no floor filtering). Ascending, one z per floor.
 */
export function deriveBands(lines: readonly BwLine[]): number[] {
  const zs = lines.map(l => (l[2] + l[5]) / 2).sort((a, b) => a - b);
  if (!zs.length) return [];
  const groups: number[][] = [[zs[0]]];
  for (let i = 1; i < zs.length; i++) {
    if (zs[i] - zs[i - 1] > FLOOR_BAND_Z) groups.push([zs[i]]);
    else groups[groups.length - 1].push(zs[i]);
  }
  if (groups.length > 16) return [];
  return groups.map(g => g.reduce((a, b) => a + b, 0) / g.length);
}

/** Does a line spanning z1..z2 reach within FLOOR_BAND_Z of `z`? */
export const lineNearZ = (z1: number, z2: number, z: number, band = FLOOR_BAND_Z): boolean =>
  Math.max(z1, z2) >= z - band && Math.min(z1, z2) <= z + band;

/**
 * Brewall draws many walls black, which vanishes on this page's dark ground. A colour darker than a mid
 * grey is lifted toward light grey, keeping a hint of its hue; a lighter one is left alone.
 */
export function liftColor(r: number, g: number, b: number): [number, number, number] {
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  if (luma >= 110) return [r, g, b];
  const f = ((110 - luma) / 110) * 0.65;
  const lift = (c: number) => Math.round(c + (230 - c) * f);
  return [lift(r), lift(g), lift(b)];
}
