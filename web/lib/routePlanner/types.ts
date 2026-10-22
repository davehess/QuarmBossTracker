// Route planner: the shapes (no React, no DOM, so the root vitest suite real-imports everything in this folder).
//
// COORDINATES are the server's (eqemu spawn2 x, y). The map draws screen = (-x, -y), north up, and the game's /loc
// prints "y, x"; nothing in here negates anything, the picture does.

export type Kind = 'boss' | 'named' | 'scripted' | 'objective' | 'door' | 'note';
export const KIND_KEYS: readonly Kind[] = ['boss', 'named', 'scripted', 'objective', 'door', 'note'];

export type MobLink = { label: string; url: string; ref: string };

/** One thing on the map that a pin can be made from: a catalog spawn point, or a script-spawned mob with no spawn point. */
export type Mob = {
  tier: number;               // label visibility: 1 always, 2 from mid zoom, 3 close in
  id: string;
  name: string;
  kind: Kind;
  npc?: number;
  level?: number;
  hp?: number;
  x: number;
  y: number;
  z?: number;
  spawn2?: number;
  checklist?: string;         // the PoP checklist objective this mob belongs to
  note?: string;
  trigger?: string;           // scripted: what makes it spawn
  pts?: [number, number][];   // several points (adds, corpse spots)
  links?: MobLink[];
};

/** One recorded night: the raid centre every 3 s, [unix seconds, x, y]. No names. */
export type Night = { key: string; color: string; kill: string; pts: [number, number, number][] };

/** A band of heights = one floor of the zone. A mob or pin is on the floor whose [zmin, zmax] holds its z (open ends allowed). */
export type Floor = { key: string; label: string; zmin?: number; zmax?: number; color?: string };

/** A path an NPC walks (a pather / grid): the points in order, then back to the first when it loops. */
export type Pather = { id: string; npc_names: string[]; points: [number, number, number][]; loop: boolean; wander?: boolean };

/**
 * A door, a teleport or a zone line. `from`/`to` are [x, y, z]; `to` is null for a thing that goes nowhere on this map
 * (a zone line, a door that only opens). `key` is the key item or the flag that opens a locked / flag door.
 * A 'step' is not a thing in the zone: it is a small vertical gap the walkable map has between two of its pieces, found
 * offline and bridged for the walk route (navroute.ts). A HEURISTIC, never verified in game; the map does not draw it.
 */
export type ZoneLink = {
  kind: 'teleport' | 'locked' | 'flag' | 'zoneline' | 'step';
  from: [number, number, number];
  to: [number, number, number] | null;
  label: string;
  key?: string;
  script?: { url: string; ref: string };
};

export type ZoneJson = {
  walls: Record<string, number[]>;     // floor key -> flat x1,y1,x2,y2 segments
  nights: Night[];                     // may be empty: a zone nobody has recorded yet still plans, it just cannot follow paths
  avg?: { stops: { n: number; name: string; x: number; y: number }[]; legs: [number, number][][] };
  mobs: Mob[];
  minor?: { n: string; x: number; y: number }[];
  trash?: { g: string; n: string; x: number; y: number }[];
  // Tactics: one leash line + the Warlord's box. Other zones: `boxes`, each a band with open (null) sides, from the script.
  marks?: {
    leashX?: number; warlordBox?: { x0: number; x1: number; y0: number; y1: number }; arena?: string;
    boxes?: { id: string; label: string; x0: number | null; x1: number | null; y0: number | null; y1: number | null; f?: string }[];
  };
  zonein?: { x: number; y: number };
  floors?: Floor[];
  pathers?: Pather[];
  links?: ZoneLink[];
  /** Per-zone settings the data file may carry itself (merged over the defaults in zones/make.ts). */
  config?: Partial<ZoneConfig>;
  /** True for a placeholder file: the zone is registered but its data has not been loaded. */
  stub?: boolean;
};

/** One pin the build lays down. `mob` is a Mob id; the rest override what the mob says. */
export type BuildPinSpec = { mob: string; label?: string; kind?: Kind; optional?: boolean; note?: string; y?: number };

/**
 * A group of pins that must stay together in the route (an event chain, a boss and the projection to hail after).
 * The build orders GROUPS; the pins inside a group keep their order (except `swapFirstTwo`).
 */
export type BuildGroup = {
  id: string;
  rank: number;                   // checklist order for groups with no popKey (after the popKey ones)
  popKey?: string;                // the web/lib/popGuide.ts step this group completes
  mimicRaid?: string;             // the apps/mimic/pop-raids.js raid card it is the same fight as
  lead?: boolean;                 // sits right after the start in every order (a hail on the way in)
  swapFirstTwo?: boolean;         // the first two pins are interchangeable: nearest one first
  last?: boolean;                 // laid down after everything else in every order (a final boss that needs the rest done)
  pins: BuildPinSpec[];
};

export type ZoneConfig = {
  zone: string;                   // eqemu short name
  zoneId: number;                 // npc ids in the zone are zoneId * 1000 + n
  name: string;
  title: string;                  // the page's h-line
  blurb: string;
  bounds: { x0: number; x1: number; y0: number; y1: number };
  grid: { x0: number; x1: number; y0: number; y1: number };
  focus: { label: string; x0: number; x1: number; y0: number; y1: number };
  floors: Floor[];
  floorNote: string;
  layerLabels: { bosses: string; scripted: string; leash: string; avg: string; trash: string; minor: string; pathers: string; links: string };
  trashColors: Record<string, string>;
  sourceNote: string;
  popKeys: string[];              // popGuide steps whose objectives are in this zone
  start: { mob: string; label: string; kind: Kind };
  groups: BuildGroup[];
  buildNotes?: Partial<Record<BuildOrder, string>>;   // what "Build plan" says it did, per order (a default when absent)
};

/** What the page and engine use: every optional part of the json is filled in (zones/make.ts). */
export type ZoneData = ZoneConfig & Omit<ZoneJson, 'avg' | 'minor' | 'trash' | 'marks' | 'zonein' | 'floors' | 'pathers' | 'links' | 'config' | 'stub'> & {
  avg: NonNullable<ZoneJson['avg']>;
  minor: NonNullable<ZoneJson['minor']>;
  trash: NonNullable<ZoneJson['trash']>;
  marks: ZoneJson['marks'];
  pathers: Pather[];
  links: ZoneLink[];
  stub: boolean;
};

// ── the plan ─────────────────────────────────────────────────────────────────

export type Pin = {
  id: string;
  label: string;
  kind: Kind;
  optional: boolean;
  x: number;
  y: number;
  z?: number;
  mob?: string;
  npc?: number;
  note?: string;
  onPlan?: boolean;               // came from a fight card on /raid/plan
};

/** The bends of one leg, keyed 'pinA>pinB'. `opt`: the whole leg is optional (drawn dashed, left out of the totals). `via`: the label of a teleport (ZoneLink) the leg goes through; the jump is drawn but not counted. `h`: the heights [x, y, z] of bends that came from "Use this route" on the walk route, matched to a bend by its x, y (a bend moved since has none and the walk route guesses its height from its neighbours). */
export type Line = { k: string; pts: [number, number][]; off: boolean; follow?: number; opt?: boolean; via?: string; h?: [number, number, number][] };

/**
 * A SPLIT: the raid divides into parallel branches where it does several things at once, then regroups. It sits on the
 * leg between two neighbouring main-route pins: `from` is the pin the raid leaves, `to` is the regroup pin. Each branch
 * is an ordered list of its own pins; its legs run from -> its pins -> to, in the branch's colour. A plan with no splits
 * (the original shape) has `splits: []`; an older stored plan with no `splits` key reads as that.
 */
export type Branch = { id: string; label: string; color: string; pins: Pin[]; headcount?: number; roles?: string };
export type Split = { id: string; from: string; to: string; branches: Branch[] };
export const MIN_BRANCHES = 2;
export const MAX_BRANCHES = 4;
export const BRANCH_COLORS = ['#2dd4bf', '#d946ef', '#818cf8', '#fb7185'];

export type BuildOrder = 'greedy' | 'checklist';

export type Plan = {
  pins: Pin[];
  hiddenTracks: string[];
  lines: Line[];
  splits: Split[];
  headcount?: number;             // raiders on the main route (off-night planning: how few can do it)
  roles?: string;                 // free text: "2 tanks, 2 clerics, 1 enchanter"
  updatedAt: number;              // ms; the officer's clock, only for "newest wins" inside one browser
  built: { order: BuildOrder; at: number } | null;
};

export const emptyPlan = (): Plan => ({ pins: [], hiddenTracks: [], lines: [], splits: [], updatedAt: 0, built: null });
