// How to get from the Plane of Knowledge to every Planes of Power zone, and back (a DRAFT data module: nothing
// imports it yet; how it shows in the PoP plan is the guild lead's pick from options).
//
// The shape is the `travel_paths` row (supabase/migrations/20260525120000_initial_schema.sql): zone_from_short,
// zone_to_short, hops jsonb, notes. `seedSql()` renders the SAME rows as the seed migration, and
// test/pop-travel.test.js fails if the committed migration drifts from it.
//
// PROVENANCE, hop by hop (the guild lead, 2026-10-21: scripts and our database, never guides):
//   - Where a door stands and where it lands come from `eqemu_doors` (pos_y/pos_x/pos_z and dest_y/dest_x/dest_z) and
//     `eqemu_zone_points`. They are stored here in /loc ORDER (y, x, z), the same as popGuide's waypoints.
//   - Who may use it comes from the server's quest scripts (SecretsOTheP/quests @ ea0c766) and, for the engine rules
//     under them (zone flags, the raid-will rule), the server source (eqmacemu @ 12068490).
//   - A guide is never a source. Anything only the old guide or the popGuide blurbs claim carries `unverified`.
//   - The `eqemu_*` tables were read on 2026-10-29.
//
// DOORS BEAT ZONE POINTS FOR LANDINGS. Most `eqemu_zone_points` rows here have source coordinates 0, 0, 0 (the lines are
// driven by the client's own zone files), and several store target_x / target_y TRANSPOSED against the door that does the
// same trip (poinnovation 1 and 70, pofire 1, hohonora 2, postorms 1, potimea 10). A door click uses the door row's
// dest_y / dest_x, so a landing here comes from the door row, or from the script's MovePC(zone, x, y, z) where the door
// has no destination. Only the real zone lines (Tranquility to Disease, Disease to the Crypt and back, the second Earth
// area back to the first) are sourced from `eqemu_zone_points`, and those rows carry their own source coordinates.
//
// READ THIS BEFORE TRUSTING A GATE. A Tranquility door script (potranquility/player.lua) only SETS the zone flag when
// its condition holds and prints "You lack the will to pass through this portal safely." when it does not. The refusal
// itself is the engine: the destination's `flag_needed` and `minlevel` (zone/zoning.cpp:1354-1368), and `eqemu_zone`
// mirrors neither column. So which planes really demand a flag is INFERRED from which scripts call SetZoneFlag for that
// zone id (200, 207-212, 214-223); the planes no script flags (201, 204, 205, 206) are treated as open.

export type Loc = { y: number; x: number; z: number }; // /loc order

export type TravelHopType = 'port' | 'run';
export type TravelVia = 'book' | 'portal' | 'door' | 'zoneline' | 'spell' | 'item' | 'switch';
export type GateKind = 'level' | 'flag' | 'item' | 'raid' | 'event';

export type TravelGate = {
  kind: GateKind;
  text: string;
  /** true: an ALTERNATIVE way past the gate, not a second requirement. */
  alt?: boolean;
  src: string[];
};

export type TravelHop = {
  /** port: a click, a cast or a script moves you. run: you walk into a zone line. */
  type: TravelHopType;
  via: TravelVia;
  from: string;
  to: string;
  /** where to stand and click in `from` (omitted when the data does not place it; then `unverified` says so). */
  loc?: Loc;
  /** where you land in `to`. */
  arrive?: Loc;
  gate?: TravelGate[];
  note: string;
  /** classes that can do it; omitted when anyone can. */
  class?: string[];
  src: string[];
  /** what could not be proved from the scripts or the database. */
  unverified?: string;
};

export type TravelRow = {
  /** stable key; the seed derives the row id from it, so a re-run updates instead of duplicating. */
  key: string;
  zone_from_short: string | null;
  zone_to_short: string;
  hops: TravelHop[];
  notes: string;
};

/** Every zone the plan covers, the Plane of Knowledge first. Short names confirmed against eqemu_zone (2026-10-29). */
export const POP_ZONES = [
  'poknowledge', 'potranquility', 'podisease', 'ponightmare', 'nightmareb', 'pojustice', 'poinnovation', 'povalor',
  'postorms', 'codecay', 'potorment', 'hohonora', 'hohonorb', 'bothunder', 'potactics', 'solrotower', 'pofire',
  'poair', 'powater', 'poeartha', 'poearthb', 'potimea', 'potimeb',
] as const;
export type PopZone = (typeof POP_ZONES)[number];

/** The zones' long names, for display. `nightmareb` is "The Lair of Terris Thule", `hohonorb` the Temple of Marr, `potactics` Drunder. */
export const POP_ZONE_LONG: Record<PopZone, string> = {
  poknowledge: 'Plane of Knowledge',
  potranquility: 'Plane of Tranquility',
  podisease: 'Plane of Disease',
  ponightmare: 'Plane of Nightmares',
  nightmareb: 'The Lair of Terris Thule',
  pojustice: 'Plane of Justice',
  poinnovation: 'Plane of Innovation',
  povalor: 'Plane of Valor',
  postorms: 'Plane of Storms',
  codecay: 'The Crypt of Decay',
  potorment: 'Torment, the Plane of Pain',
  hohonora: 'Halls of Honor',
  hohonorb: 'Temple of Marr',
  bothunder: 'Bastion of Thunder',
  potactics: 'Drunder, the Fortress of Zek',
  solrotower: 'Tower of Solusek Ro',
  pofire: 'Plane of Fire',
  poair: 'Plane of Air',
  powater: 'Plane of Water',
  poeartha: 'Plane of Earth',
  poearthb: 'Plane of Earth (second area)',
  potimea: 'Plane of Time',
  potimeb: 'Plane of Time (second area)',
};

// ── citation helpers ─────────────────────────────────────────────────────────────────────────────────────────────
const QV = 'ea0c766'; // SecretsOTheP/quests
const SV = '12068490'; // eqmacemu (the server source)
const lua = (file: string, lines: string) => `${file}:${lines} @ ${QV}`;
const srv = (file: string, lines: string) => `eqmacemu ${file}:${lines} @ ${SV}`;
const door = (zone: string, id: number | string) => `eqemu_doors zone=${zone} doorid=${id}`;
const zp = (zone: string, n: number) => `eqemu_zone_points zone=${zone} number=${n}`;
const L = (y: number, x: number, z: number): Loc => ({ y, x, z });
/** Tranquility's click handler (lines 7-156) has no branch for these doors: nothing in the script gates them. */
const noBranch = (id: number) => `${lua('potranquility/player.lua', '7-156')} (no branch for door ${id})`;
const TIMEB_GODS = [lua('potimeb/player.lua', '1-20'), lua('potimeb/player.lua', '46-64')];

const TRANQ = 'potranquility/player.lua';
const FLAG_ENGINE = srv('zone/zoning.cpp', '1363-1367');
const RAID_WILL = [srv('zone/zoning.cpp', '45-72'), srv('zone/raids.cpp', '617-639')];
const ALT_BUCKET = 'the pop_alt_access_enabled data bucket is 1';

const MIRROR_NO_ENGINE_GATES =
  'the zone\'s flag_needed and minlevel are not in the eqemu_zone mirror, so whether the engine enforces this is inferred from the scripts';

/** The three zone-flag gates in Tranquility that also have an item-on-cursor alternative when the alt-access bucket is on. */
const altItem = (item: string, id: number, lines: string): TravelGate => ({
  kind: 'item',
  alt: true,
  text: `with ${ALT_BUCKET}: ${item} (item ${id}) on the cursor, or already on the key ring, takes the place of the quest flag`,
  src: [lua(TRANQ, lines)],
});

// ── the hops ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const HOPS = {
  // ---- Plane of Knowledge → Plane of Tranquility ---------------------------------------------------------------
  pok_tranq: {
    type: 'port', via: 'book', from: 'poknowledge', to: 'potranquility',
    loc: L(-148, -332, -156), arrive: L(774, -1463, -878),
    gate: [{
      kind: 'level',
      text: 'level 46: below it the book prints "You are not yet experienced enough to pass through an inter-planar portal."',
      src: [lua('poknowledge/player.lua', '4-8')],
    }],
    note: 'Click the Plane of Tranquility book (the door POKPTPORT500). It lands you at the Tranquility arrival spot, beside the book that leads back.',
    src: [door('poknowledge', 27), zp('poknowledge', 11), lua('poknowledge/player.lua', '4-8')],
    unverified: 'The script only prints the level-46 message; the block itself is the zone minlevel, which the mirror does not hold. '
      + 'The Seer\'s waypoint in popGuide is described as "next to the book" but is about 150 units from the book door.',
  },

  // ---- Plane of Tranquility, the hub: one door or zone line per plane ---------------------------------------------
  tranq_innov: {
    type: 'port', via: 'portal', from: 'potranquility', to: 'poinnovation',
    loc: L(-1542, 5, -897), arrive: L(516, 263, -53),
    note: 'The Innovation portal (door 8, TRANWMBLAD500E). No script gates it and no script sets a zone flag for Innovation.',
    src: [door('potranquility', 8), zp('potranquility', 37), noBranch(8)],
    unverified: MIRROR_NO_ENGINE_GATES + '; the guide\'s "opens at 46" is not backed by any script.',
  },
  tranq_justice: {
    type: 'port', via: 'portal', from: 'potranquility', to: 'pojustice',
    loc: L(50, -606, -524), arrive: L(-61, 58, 5),
    note: 'The Justice portal (door 38, POTPOJSC). No script gates it and no script sets a zone flag for Justice.',
    src: [door('potranquility', 38), zp('potranquility', 47), noBranch(38)],
    unverified: MIRROR_NO_ENGINE_GATES + '; the guide\'s "opens at 46" is not backed by any script.',
  },
  tranq_nightmare: {
    type: 'port', via: 'portal', from: 'potranquility', to: 'ponightmare',
    loc: L(-186, -1289, -914), arrive: L(282, 1668, 212),
    note: 'The Nightmare portal (door 85, POTRHUT500W). No script gates it and no script sets a zone flag for Nightmare.',
    src: [door('potranquility', 85), zp('potranquility', 57), noBranch(85)],
    unverified: MIRROR_NO_ENGINE_GATES + '; the guide\'s "opens at 46" is not backed by any script.',
  },
  tranq_disease: {
    type: 'run', via: 'zoneline', from: 'potranquility', to: 'podisease',
    loc: L(1700, -1440, -800), arrive: L(-1245, -1750, -59),
    note: 'Not a portal: walk into the zone line at the edge of Tranquility. It lands you at the Disease zone-in; the return line is further along (see the back route).',
    src: [zp('potranquility', 17)],
    unverified: MIRROR_NO_ENGINE_GATES + '. No script sets a zone flag for Disease.',
  },
  tranq_valor: {
    type: 'port', via: 'portal', from: 'potranquility', to: 'povalor',
    loc: L(-232, 2, -618), arrive: L(-1668, 190, 65),
    gate: [{
      kind: 'flag',
      text: 'Mavuin flag at 3 (qglobal mavuin = "3"); the click sets the Valor AND Storms zone flags together',
      src: [lua(TRANQ, '12-23')],
    }],
    note: 'The Valor portal (door 21, HONORPORT500, on the upper platform with the Honor, Solusek Ro and Tactics portals).',
    src: [door('potranquility', 21), zp('potranquility', 22), lua(TRANQ, '12-23'), FLAG_ENGINE],
  },
  tranq_storms: {
    type: 'port', via: 'portal', from: 'potranquility', to: 'postorms',
    loc: L(-721, 1230, -828), arrive: L(-2059, -1795, -473),
    gate: [{
      kind: 'flag',
      text: 'Mavuin flag at 3 (qglobal mavuin = "3"); the click sets the Storms AND Valor zone flags together',
      src: [lua(TRANQ, '12-23')],
    }],
    note: 'The Storms portal (door 16, POTRANRAIN500).',
    src: [door('potranquility', 16), zp('potranquility', 24), lua(TRANQ, '12-23'), FLAG_ENGINE],
  },
  tranq_hoh: {
    type: 'port', via: 'portal', from: 'potranquility', to: 'hohonora',
    loc: L(-163, 20, -618), arrive: L(0, -2755, 0),
    gate: [
      {
        kind: 'flag',
        text: 'Halls of Honor zone flag (211), which is set by clicking the Valor tunnel portal with the Aerin`Dar flag, so this door works only AFTER the first visit',
        src: [lua(TRANQ, '72-89'), lua('povalor/player.lua', '5-27')],
      },
      altItem('Ring of Marr', 29214, '72-89'),
    ],
    note: 'The Halls of Honor portal (door 23, VALORPORT500). A repeat-visit shortcut; the first visit goes through Valor.',
    src: [door('potranquility', 23), zp('potranquility', 23), lua(TRANQ, '72-89'), FLAG_ENGINE],
  },
  tranq_bot: {
    type: 'port', via: 'portal', from: 'potranquility', to: 'bothunder',
    loc: L(-689, 1799, -929), arrive: L(207, 178, -1620),
    gate: [{
      kind: 'flag',
      text: 'Karana flag at 3 or more, or any Zebuxoruk flag (qglobal karana >= 3, or zebuxoruk set); the click sets the Bastion zone flag',
      src: [lua(TRANQ, '59-70')],
    }],
    note: 'The Bastion of Thunder portal (door 48, BOTPORT500). The first visit usually goes through the Storms shrine, which is what raises the Karana flag to 3.',
    src: [door('potranquility', 48), zp('potranquility', 25), lua(TRANQ, '59-70'), FLAG_ENGINE],
  },
  tranq_tactics: {
    type: 'port', via: 'portal', from: 'potranquility', to: 'potactics',
    loc: L(-153, -20, -618), arrive: L(10, -210, -35),
    gate: [
      { kind: 'flag', text: 'Zeks flag at 2 or more (qglobal zeks >= 2); the click sets the Drunder zone flag', src: [lua(TRANQ, '91-105')] },
      altItem('Completed Diaku Emblem', 29215, '91-105'),
    ],
    note: 'The Plane of Tactics (Drunder) portal (door 24, TACTICPORT500).',
    src: [door('potranquility', 24), zp('potranquility', 21), lua(TRANQ, '91-105'), FLAG_ENGINE],
  },
  tranq_torment: {
    type: 'port', via: 'portal', from: 'potranquility', to: 'potorment',
    loc: L(699, -1640, -912), arrive: L(1706, -341, -491),
    gate: [
      { kind: 'flag', text: 'Fuirstel flag at 5 AND Thelin flag at 4 (both qglobals); the click sets the Torment zone flag', src: [lua(TRANQ, '44-57')] },
      altItem('Symbol of Torment', 29213, '44-57'),
    ],
    note: 'The Torment portal (door 93, POTORMFNT500). The neighbouring door 10 (POTORMFNT501) is scenery.',
    src: [door('potranquility', 93), zp('potranquility', 18), lua(TRANQ, '44-57'), FLAG_ENGINE],
  },
  tranq_solro: {
    type: 'port', via: 'portal', from: 'potranquility', to: 'solrotower',
    loc: L(-203, 31, -618), arrive: L(-2915, -1, -766),
    gate: [{
      kind: 'flag',
      text: 'The cipher (qglobal cipher set) AND Zeks flag at 6 or more; the click sets the Tower zone flag',
      src: [lua(TRANQ, '107-118')],
    }],
    note: 'The Tower of Solusek Ro portal (door 22, SOLROPORT500).',
    src: [door('potranquility', 22), zp('potranquility', 26), lua(TRANQ, '107-118'), FLAG_ENGINE],
  },
  tranq_codecay: {
    type: 'port', via: 'portal', from: 'potranquility', to: 'codecay',
    loc: L(1888, -1094, -895), arrive: L(-65, -170, -93),
    gate: [
      {
        kind: 'flag',
        text: 'Crypt of Decay zone flag (200). The script never grants it here; it comes from entering the Crypt from Disease with the Grummus flag, so this door works only AFTER the first visit',
        src: [lua(TRANQ, '25-42'), lua('podisease/player.lua', '1-5')],
      },
      altItem('Bangle of Disease Warding', 9294, '25-42'),
    ],
    note: 'The Crypt of Decay portal (door 12, POTRANCOD500). A repeat-visit shortcut; the first visit goes through Disease.',
    src: [door('potranquility', 12), zp('potranquility', 19), lua(TRANQ, '25-42'), FLAG_ENGINE],
  },
  tranq_fire: {
    type: 'port', via: 'portal', from: 'potranquility', to: 'pofire',
    loc: L(255, -2191, -914), arrive: L(1210, -1387, -180),
    gate: [{
      kind: 'flag',
      text: 'Plane of Fire zone flag (217). This door NEVER grants it (the script only refuses); it is set by falling into the Lava Well of Ro with the second Fire flag, so this door works only AFTER the first visit',
      src: [lua(TRANQ, '120-130'), lua('solrotower/player.lua', '102-105'), lua('solrotower/A_Planar_Projection.lua', '34-40')],
    }],
    note: 'The Plane of Fire portal (door 82, POTRNQFIRE500), where Miak the Searedsoul stands. The first visit is the Lava Well of Ro in the Tower.',
    src: [door('potranquility', 82), zp('potranquility', 29), lua(TRANQ, '120-130'), FLAG_ENGINE, ...RAID_WILL],
    unverified: 'With the alt-access bucket on, a raid with enough Fire-flagged members (default 85%) can also enter; the bucket and the percentage are live data we cannot read.',
  },
  tranq_air: {
    type: 'port', via: 'portal', from: 'potranquility', to: 'poair',
    loc: L(852, -688, -625), arrive: L(884, 532, -90),
    gate: [
      { kind: 'flag', text: 'Zebuxoruk flag at 2 (qglobal zebuxoruk = "2"); the click sets the Air, Water AND Earth zone flags together', src: [lua(TRANQ, '132-144')] },
      { kind: 'raid', alt: true, text: `with ${ALT_BUCKET}: a raid whose flagged share of members meets the percentage (default 85%) may enter without the flag`, src: RAID_WILL },
    ],
    note: 'The Plane of Air portal (door 81, POTRANBURN500).',
    src: [door('potranquility', 81), zp('potranquility', 28), lua(TRANQ, '132-144'), FLAG_ENGINE],
    unverified: 'The alt-access bucket and the raid percentage are live data we cannot read.',
  },
  tranq_earth: {
    type: 'port', via: 'portal', from: 'potranquility', to: 'poeartha',
    loc: L(-1326, 2211, -724), arrive: L(200, -1150, 71),
    gate: [
      { kind: 'flag', text: 'Zebuxoruk flag at 2 (qglobal zebuxoruk = "2"); the click sets the Air, Water AND Earth zone flags together', src: [lua(TRANQ, '132-144')] },
      { kind: 'raid', alt: true, text: `with ${ALT_BUCKET}: a raid whose flagged share of members meets the percentage (default 85%) may enter without the flag`, src: RAID_WILL },
    ],
    note: 'The Plane of Earth portal (door 83, POTBLDR500).',
    src: [door('potranquility', 83), zp('potranquility', 30), lua(TRANQ, '132-144'), FLAG_ENGINE],
    unverified: 'The alt-access bucket and the raid percentage are live data we cannot read.',
  },
  tranq_water: {
    type: 'port', via: 'portal', from: 'potranquility', to: 'powater',
    loc: L(-1161, 961, -781), arrive: L(-1234, -93, 11),
    gate: [
      { kind: 'flag', text: 'Zebuxoruk flag at 2 (qglobal zebuxoruk = "2"); the click sets the Air, Water AND Earth zone flags together', src: [lua(TRANQ, '132-144')] },
      { kind: 'raid', alt: true, text: `with ${ALT_BUCKET}: a raid whose flagged share of members meets the percentage (default 85%) may enter without the flag`, src: RAID_WILL },
    ],
    note: 'The Plane of Water portal (door 84, POTPOWTRG500).',
    src: [door('potranquility', 84), zp('potranquility', 27), lua(TRANQ, '132-144'), FLAG_ENGINE],
    unverified: 'The alt-access bucket and the raid percentage are live data we cannot read.',
  },
  tranq_time: {
    type: 'port', via: 'portal', from: 'potranquility', to: 'potimea',
    loc: L(-2257, 1220, -906), arrive: L(140, 223, 9),
    gate: [
      { kind: 'level', text: 'level 65 (a game master is let through)', src: [lua(TRANQ, '146-155')] },
      { kind: 'flag', text: 'Plane of Time zone flag (219) AND the "time" qglobal; both come from clicking the time machine in Innovation, so this door works only AFTER the first visit', src: [lua(TRANQ, '146-155'), lua('poinnovation/player.lua', '17-26')] },
    ],
    note: 'The Plane of Time portal (door 18, INVISWITCH500). A repeat-visit shortcut; the first visit is the time machine in Innovation.',
    src: [door('potranquility', 18), zp('potranquility', 1), lua(TRANQ, '146-155'), FLAG_ENGINE, ...RAID_WILL],
    unverified: 'A second Tranquility door (109, POKTELE500, at -2195, 1126, -914) also targets Time but its stored landing is 0, 0, 0, so it looks unfinished; it is not used here.',
  },

  // ---- from a plane, onward ---------------------------------------------------------------------------------------
  disease_codecay: {
    type: 'run', via: 'zoneline', from: 'podisease', to: 'codecay',
    loc: L(-115, 2110, 290), arrive: L(-65, -170, -93),
    gate: [{
      kind: 'flag',
      text: 'Grummus flag (qglobal grummus): zoning into the Crypt with it sets the Crypt zone flag (200)',
      src: [lua('podisease/player.lua', '1-5'), lua('potranquility/player.lua', '34') + ' (comment: the flag is set by dropping down the Disease zone-in near Grummus)'],
    }],
    note: 'Not a portal: the drop near Grummus. A key-locked door (DIZDOOR500, Grymes Crypt Key) stands just above it.',
    src: [zp('podisease', 1), lua('podisease/player.lua', '1-5'), door('podisease', 15)],
    unverified: 'Whether the Grymes Crypt Key door (podisease door 15 at 367, 2112, 383) is on the way to the drop is not in the data.',
  },
  nightmare_lair: {
    type: 'port', via: 'portal', from: 'ponightmare', to: 'nightmareb',
    loc: L(166, -1942, 120), arrive: L(23, 1597, -324),
    gate: [{
      kind: 'flag',
      text: 'Thelin flag above 1 (qglobal thelin > 1); the click sets the Lair zone flag (221)',
      src: [lua('ponightmare/player.lua', '5-13')],
    }],
    note: 'The portal to the Lair of Terris Thule (door 59, ACBARS301).',
    src: [door('ponightmare', 59), zp('ponightmare', 77), lua('ponightmare/player.lua', '5-13'), FLAG_ENGINE],
  },
  valor_hoh: {
    type: 'port', via: 'portal', from: 'povalor', to: 'hohonora',
    loc: L(4276, 657, -90), arrive: L(0, -2755, 0),
    gate: [{
      kind: 'flag',
      text: 'The Aerin`Dar flag (qglobal aerindar set): the click raises it to 2 and sets the Halls of Honor zone flag (211); with no flag the portal refuses',
      src: [lua('povalor/player.lua', '5-27')],
    }],
    note: 'The portal at the end of the Valor underground tunnel (door 3, HOHTELEPORT501): the FIRST way into the Halls of Honor.',
    src: [door('povalor', 3), zp('povalor', 77), lua('povalor/player.lua', '5-27'), FLAG_ENGINE],
  },
  storms_bot: {
    type: 'port', via: 'portal', from: 'postorms', to: 'bothunder',
    loc: L(-163, -362, -404), arrive: L(207, 178, -1620),
    gate: [{
      kind: 'flag',
      text: 'The Storms shrine takes Karana at 3 or more, or any Zebuxoruk flag, straight through; otherwise it needs Karana at 2 AND Mavuin at 3, and the click then raises Karana to 3 and sets the Bastion zone flag (209)',
      src: [lua('postorms/player.lua', '4-26')],
    }],
    note: 'The shrine portal in Storms (door 4, BOTPOSPORT500). Its message names the Talisman of Thunderous Foyer.',
    src: [door('postorms', 4), zp('postorms', 1), lua('postorms/player.lua', '4-26'), FLAG_ENGINE],
  },
  hoh_marr: {
    type: 'port', via: 'portal', from: 'hohonora', to: 'hohonorb',
    loc: L(2, 117, 0), arrive: L(-1, 960, 397),
    gate: [{
      kind: 'flag',
      text: 'All three Halls of Honor trials done (qglobal hohtrials = "111"); the click sets the Temple of Marr zone flag (220)',
      src: [lua('hohonora/player.lua', '4-18')],
    }],
    note: 'One of two Temple of Marr portals (door 19 here; door 20 at -1050, 42, 0 does the same).',
    src: [door('hohonora', 19), door('hohonora', 20), zp('hohonora', 1), lua('hohonora/player.lua', '4-18'), FLAG_ENGINE],
  },
  earth_earthb: {
    type: 'port', via: 'portal', from: 'poeartha', to: 'poearthb',
    loc: L(130, -1167, 43), arrive: L(333, -764, -59),
    gate: [{
      kind: 'flag',
      text: 'The Earth key flag (qglobal earthb_key set); the click sets the second Earth area\'s zone flag (222) and moves you',
      src: [lua('poeartha/player.lua', '4-12')],
    }],
    note: 'Doors 9, 10 and 11 all lead to the second Earth area (door 11 shown; 9 at -2724, 1586, 0 and 10 at -2756, 1586, 0).',
    src: [door('poeartha', 9), door('poeartha', 10), door('poeartha', 11), zp('poeartha', 1), lua('poeartha/player.lua', '4-12'), FLAG_ENGINE],
  },
  innov_time: {
    type: 'port', via: 'switch', from: 'poinnovation', to: 'potimea',
    loc: L(-858, 886, -1888), arrive: L(140, 223, 11),
    gate: [
      { kind: 'flag', text: 'Zebuxoruk flag at 2 (qglobal zebuxoruk = "2")', src: [lua('poinnovation/player.lua', '17-26')] },
      { kind: 'item', text: 'Quintessence of Elements (item 29165) in your bags (the script checks HasItem; the bank does not count)', src: [lua('poinnovation/player.lua', '17-26')] },
    ],
    note: 'Click the time machine (door 145, POITMMCHN500). It sets the Plane of Time flags (219, 223) and the "time" qglobal, then moves you.',
    src: [door('poinnovation', 145), zp('poinnovation', 70), lua('poinnovation/player.lua', '17-26')],
  },
  solro_chamber: {
    type: 'port', via: 'door', from: 'solrotower', to: 'solrotower',
    loc: L(-698, -1, -456), arrive: L(-847, 0, 244),
    gate: [
      { kind: 'flag', text: 'All five wings done (qglobal sol_room = "11111")', src: [lua('solrotower/player.lua', '4-25')] },
      { kind: 'flag', text: 'Zeks flag at 7 (qglobal zeks = "7")', src: [lua('solrotower/player.lua', '4-25')] },
    ],
    note: 'The lava runes (door 44, SRTGRUNES503; door 45 at -841, -1, -455 does the same) carry you up to Solusek Ro\'s chamber, inside the same zone.',
    src: [door('solrotower', 44), door('solrotower', 45), zp('solrotower', 26), lua('solrotower/player.lua', '4-25')],
  },
  solro_fire: {
    type: 'run', via: 'zoneline', from: 'solrotower', to: 'pofire',
    arrive: L(1210, -1387, -180),
    gate: [{
      kind: 'flag',
      text: 'Second Fire flag (qglobal pofire = "2"): zoning into Fire from the Tower with it sets the Plane of Fire zone flag (217)',
      src: [lua('solrotower/player.lua', '102-105'), lua('solrotower/A_Planar_Projection.lua', '34-40')],
    }],
    note: 'Fall into the Lava Well of Ro in Solusek Ro\'s chamber.',
    src: [zp('solrotower', 1), lua('solrotower/player.lua', '102-105'), lua('solrotower/A_Planar_Projection.lua', '38')],
    unverified: 'Where the well stands is not in the data: the zone line has no coordinates (0, 0, 0) and the script only calls it the Lava Well of Ro.',
  },
  time_timeb: {
    type: 'port', via: 'portal', from: 'potimea', to: 'potimeb',
    gate: [
      { kind: 'level', text: 'level 65 (a game master is let through)', src: [lua('potimea/player.lua', '64-67')] },
      { kind: 'raid', text: 'a raid of at least 7', src: [lua('potimea/player.lua', '68-71')] },
      { kind: 'event', text: 'on the guild-one timeline the raid window must be open ("The flow of time is too stable for this portal to open.")', src: [lua('potimea/player.lua', '57-60')] },
    ],
    note: 'The five dial portals in Time A (doors 8 to 12) start or rejoin your raid\'s instance of Time B.',
    src: [lua('potimea/player.lua', '48-126')],
    unverified: 'Doors 8 to 12 of potimea are not in eqemu_doors, so where they stand is unknown, and the landing is chosen by the Time controller per instance.',
  },

  // ---- the way back: every plane to Tranquility, Tranquility to the Plane of Knowledge --------------------------
  b_tranq_pok: {
    type: 'port', via: 'portal', from: 'potranquility', to: 'poknowledge',
    loc: L(773, -1437, -880), arrive: L(-148, -285, -159),
    note: 'The Knowledge portal (door 78, POKTELE500) beside the Tranquility arrival spot. No script gates it.',
    src: [door('potranquility', 78), zp('potranquility', 77), noBranch(78)],
  },
  b_disease_tranq: {
    type: 'run', via: 'zoneline', from: 'podisease', to: 'potranquility',
    loc: L(-1195, -1920, -80), arrive: L(1790, -1451, -770),
    note: 'Walk into the zone line at the far side of Disease; you land outside the Disease portal in Tranquility.',
    src: [zp('podisease', 2)],
  },
  b_codecay_tranq: {
    type: 'port', via: 'door', from: 'codecay', to: 'potranquility',
    loc: L(-2, -90, -95), arrive: L(1925, -1140, -877),
    note: 'The rocks portal in the upper Crypt (door 12, CDROCKS507). From the lower crypt the exit is door 3 (POTRANCOD500) at 0, 0, -294, same landing.',
    src: [door('codecay', 12), door('codecay', 3), zp('codecay', 1)],
  },
  b_nightmare_tranq: {
    type: 'port', via: 'portal', from: 'ponightmare', to: 'potranquility',
    loc: L(268, 1557, 209), arrive: L(-189, -1225, -902),
    note: 'The Tranquility portal at the Nightmare zone-in (door 10, POKPTPORT500). A second exit, door 60 (PONGRAVE501, near the graveyard) at 1079, -1665, 117, lands at -182, -1246, -902.',
    src: [door('ponightmare', 10), door('ponightmare', 60), zp('ponightmare', 1), zp('ponightmare', 17)],
  },
  b_lair_nightmare: {
    type: 'port', via: 'portal', from: 'nightmareb', to: 'ponightmare',
    loc: L(35, 1662, -342), arrive: L(198, -1904, 126),
    note: 'The Lair\'s exit portal (door 1, ACBARS301) back to Nightmare.',
    src: [door('nightmareb', 1), zp('nightmareb', 77)],
  },
  b_justice_tranq: {
    type: 'port', via: 'portal', from: 'pojustice', to: 'potranquility',
    loc: L(5, 367, -5), arrive: L(717, -1499, -876),
    note: 'The Tranquility portal at the Justice zone-in (door 34, POJDR501).',
    src: [door('pojustice', 34), zp('pojustice', 29)],
  },
  b_innov_tranq: {
    type: 'port', via: 'portal', from: 'poinnovation', to: 'potranquility',
    loc: L(566, 292, -55), arrive: L(-1549, 245, -919),
    note: 'The lamp portal (door 147, POILAMP500). The zone-point row stores this landing with x and y swapped; the door row, which is what the click uses, is the one recorded here.',
    src: [door('poinnovation', 147), zp('poinnovation', 1)],
  },
  b_valor_tranq: {
    type: 'port', via: 'portal', from: 'povalor', to: 'potranquility',
    loc: L(-1316, 161, 52), arrive: L(-181, -50, -616),
    note: 'The stone portal at the Valor zone-in (door 10, POVGSTONE500); it lands on the upper platform in Tranquility.',
    src: [door('povalor', 10), zp('povalor', 5)],
  },
  b_storms_tranq: {
    type: 'port', via: 'portal', from: 'postorms', to: 'potranquility',
    loc: L(-1275, -2410, -482), arrive: L(-682, 1097, -929),
    note: 'The tree portal (door 11, PONTREE501A).',
    src: [door('postorms', 11), zp('postorms', 4)],
  },
  b_bot_tranq: {
    type: 'port', via: 'portal', from: 'bothunder', to: 'potranquility',
    loc: L(259, 181, -1630), arrive: L(-720, 1740, -931),
    note: 'The Tranquility portal at the Bastion zone-in (door 68, BOTPOSPORT500).',
    src: [door('bothunder', 68), zp('bothunder', 42)],
  },
  b_hoh_tranq: {
    type: 'port', via: 'portal', from: 'hohonora', to: 'potranquility',
    loc: L(1, -2790, 0), arrive: L(-192, -8, -628),
    note: 'The portal at the Halls of Honor zone-in (door 21, HOHTESWTCH500); it lands on the upper platform in Tranquility. The zone-point row stores this landing with x and y swapped; the door row is recorded here.',
    src: [door('hohonora', 21), zp('hohonora', 2)],
  },
  b_marr_hoh: {
    type: 'port', via: 'portal', from: 'hohonorb', to: 'hohonora',
    loc: L(-1, 951, 393), arrive: L(2, 104, 4),
    note: 'The Temple of Marr exit (door 25, HOHTESWTCH501) back to the Halls of Honor.',
    src: [door('hohonorb', 25), zp('hohonorb', 1)],
  },
  b_tactics_tranq: {
    type: 'port', via: 'portal', from: 'potactics', to: 'potranquility',
    loc: L(10, -950, -240), arrive: L(-191, -4, -628),
    note: 'The portal at door 23 (POTACPORTL500) is the plain exit. Doors 24, 25 and 26 land in the same place but the script reroutes them (24 sends you to Rallos Zek while he is engaged; 25 and 26 work only while their Drunder bosses are down).',
    src: [door('potactics', 23), door('potactics', 24), zp('potactics', 3), lua('potactics/player.lua', '42-56')],
  },
  b_solro_tranq: {
    type: 'port', via: 'portal', from: 'solrotower', to: 'potranquility',
    loc: L(175, -166, -573), arrive: L(774, -1463, -878),
    note: 'The portal at the foot of the Tower (door 52, POKAAPORT500); it lands at the Tranquility arrival spot.',
    src: [door('solrotower', 52)],
  },
  b_torment_tranq: {
    type: 'port', via: 'portal', from: 'potorment', to: 'potranquility',
    loc: L(1729, -242, -476), arrive: L(686, -1647, -911),
    note: 'The Tranquility fountain portal (door 79, POTORMFNT501). Door 80 (POTORDRS500) at 1815, -512, -284 lands in the same place.',
    src: [door('potorment', 79), door('potorment', 80), zp('potorment', 13)],
  },
  b_fire_tranq: {
    type: 'port', via: 'portal', from: 'pofire', to: 'potranquility',
    loc: L(1123, -1390, -181), arrive: L(255, -2100, -928),
    note: 'The tree portal (door 6, POFOTREE500). The zone-point row stores this landing with x and y swapped; the door row is recorded here.',
    src: [door('pofire', 6), zp('pofire', 1)],
  },
  b_air_tranq: {
    type: 'port', via: 'portal', from: 'poair', to: 'potranquility',
    loc: L(900, 557, -90), arrive: L(701, -1507, -877),
    note: 'The fly-back portal (door 2, POAFLYBK502). It lands at the Tranquility spawn, not by the Air portal.',
    src: [door('poair', 2), zp('poair', 2)],
  },
  b_water_tranq: {
    type: 'port', via: 'portal', from: 'powater', to: 'potranquility',
    loc: L(-1275, -166, 5), arrive: L(-1200, 1030, -778),
    note: 'The bowl portal (door 6, POWTRSBWL500).',
    src: [door('powater', 6), zp('powater', 1)],
  },
  b_earth_tranq: {
    type: 'port', via: 'portal', from: 'poeartha', to: 'potranquility',
    loc: L(258, -1180, 83), arrive: L(-1337, 2167, -715),
    note: 'The Tranquility portal in the first Earth area (door 12, POEDRS500).',
    src: [door('poeartha', 12), zp('poeartha', 10)],
  },
  b_earthb_earth: {
    type: 'run', via: 'zoneline', from: 'poearthb', to: 'poeartha',
    loc: L(320, -800, -58), arrive: L(201, -1153, 71),
    note: 'Walk into the zone line at the edge of the second Earth area. A second line (number 2) leads straight to Tranquility but has no coordinates.',
    src: [zp('poearthb', 1), zp('poearthb', 2)],
  },
  b_time_tranq: {
    type: 'run', via: 'zoneline', from: 'potimea', to: 'potranquility',
    arrive: L(701, -1507, -877),
    note: 'Time A has a zone line to Tranquility (number 10).',
    src: [zp('potimea', 10), zp('potimeb', 10)],
    unverified: 'Where in Time A the line is, is not in the data (0, 0, 0). The row stores its landing with x and y swapped; the landing recorded here is the one Time B\'s matching row gives, which is Tranquility\'s spawn point.',
  },
  b_timeb_time: {
    type: 'port', via: 'door', from: 'potimeb', to: 'potimea',
    loc: L(-11, 867, 392), arrive: L(0, -110, 5),
    note: 'The graveyard tombstone (door 52, TMGRAVE503) in Time B; the script moves you to the same Time A spot as the door row.',
    src: [door('potimeb', 52), lua('potimeb/player.lua', '34-44')],
  },

  // ---- side exits: Time A's graveyard stone and Time B's god portals ---------------------------------------------
  s_timea_graveyard: {
    type: 'port', via: 'door', from: 'potimea', to: 'potimeb',
    loc: L(-150, 0, 4), arrive: L(-150, 865, 395),
    note: 'The tombstone in Time A (door 13, TMGRAVE503) is NOT the raid entrance: it carries you to the graveyard of Time B, following the instance you came from.',
    src: [door('potimea', 13), lua('potimea/player.lua', '31-46')],
  },
  s_timeb_tactics_a: {
    type: 'port', via: 'portal', from: 'potimeb', to: 'potactics',
    loc: L(0, 270, 345), arrive: L(10, -210, -35),
    gate: [{ kind: 'event', text: 'both Vallon and Tallon Zek down in Time B', src: [lua('potimeb/player.lua', '46-56')] }],
    note: 'Time B god portal (door 17) to Drunder.',
    src: [door('potimeb', 17), ...TIMEB_GODS],
  },
  s_timeb_tactics_b: {
    type: 'port', via: 'portal', from: 'potimeb', to: 'potactics',
    loc: L(-333, 325, 6), arrive: L(10, -210, -35),
    gate: [{ kind: 'event', text: 'Rallos Zek down in Time B', src: [lua('potimeb/player.lua', '57-62')] }],
    note: 'Time B god portal (door 20) to Drunder.',
    src: [door('potimeb', 20), ...TIMEB_GODS],
  },
  s_timeb_disease: {
    type: 'port', via: 'portal', from: 'potimeb', to: 'podisease',
    loc: L(-335, -335, 20), arrive: L(-1245, -1750, -59),
    gate: [{ kind: 'event', text: 'Bertoxxulous down in Time B', src: [lua('potimeb/player.lua', '57-62')] }],
    note: 'Time B god portal (door 21) to the Plane of Disease zone-in.',
    src: [door('potimeb', 21), ...TIMEB_GODS],
  },
  s_timeb_nightmare: {
    type: 'port', via: 'portal', from: 'potimeb', to: 'ponightmare',
    loc: L(330, -335, 362), arrive: L(282, 1668, 212),
    gate: [{ kind: 'event', text: 'Terris Thule down in Time B', src: [lua('potimeb/player.lua', '57-62')] }],
    note: 'Time B god portal (door 22) to the Plane of Nightmares zone-in.',
    src: [door('potimeb', 22), ...TIMEB_GODS],
  },
  s_timeb_torment: {
    type: 'port', via: 'portal', from: 'potimeb', to: 'potorment',
    loc: L(-335, -335, 355), arrive: L(1706, -341, -491),
    gate: [{ kind: 'event', text: 'Saryrn down in Time B', src: [lua('potimeb/player.lua', '57-62')] }],
    note: 'Time B god portal (door 23) to Torment.',
    src: [door('potimeb', 23), ...TIMEB_GODS],
  },
} satisfies Record<string, TravelHop>;
export type HopId = keyof typeof HOPS;

// ── how to get INTO the Plane of Knowledge (from anywhere that allows a cast or a click) ──────────────────────
const POK_SPELL_SRC = (id: number, line: string) => [
  `eqemu_spells id=${id}`,
  `spell_class_levels spell_id=${id}`,
  srv('utils/sql/git/required/2016_11_12_spells_part1.sql', line) + ' (its teleport zone is poknowledge)',
];
const POK_ARRIVE = L(-368, 1335, -125);

export type PokEntry = { key: string; label: string; hop: TravelHop };
export const POK_ENTRIES: PokEntry[] = [
  {
    key: 'ring-of-knowledge', label: 'Ring of Knowledge (Druid 29, self)',
    hop: { type: 'port', via: 'spell', from: 'anywhere', to: 'poknowledge', arrive: POK_ARRIVE, class: ['Druid'],
      note: 'Ring of Knowledge, Druid level 29, targets the caster. Lands at the Knowledge spell arrival spot.', src: POK_SPELL_SRC(3182, '3254') },
  },
  {
    key: 'circle-of-knowledge', label: 'Circle of Knowledge (Druid 39, group)',
    hop: { type: 'port', via: 'spell', from: 'anywhere', to: 'poknowledge', arrive: POK_ARRIVE, class: ['Druid'],
      note: 'Circle of Knowledge, Druid level 39, carries the group.', src: POK_SPELL_SRC(3184, '3256') },
  },
  {
    key: 'zephyr-knowledge', label: 'Zephyr: Knowledge (Druid 44, single target)',
    hop: { type: 'port', via: 'spell', from: 'anywhere', to: 'poknowledge', arrive: POK_ARRIVE, class: ['Druid'],
      note: 'Zephyr: Knowledge, Druid level 44, is a translocate-type effect on a single target.',
      src: [`eqemu_spells id=1236`, `spell_class_levels spell_id=1236`, srv('utils/sql/git/content/2025_07_28_Druid_Zephyr_Spells.sql', '126-129') + ' (its teleport zone is poknowledge)'],
      unverified: 'Whether the target may be the caster, and what the translocate effect does when the target is not in your group, were not checked.' },
  },
  {
    key: 'knowledge-gate', label: 'Knowledge Gate (Wizard 29, self)',
    hop: { type: 'port', via: 'spell', from: 'anywhere', to: 'poknowledge', arrive: POK_ARRIVE, class: ['Wizard'],
      note: 'Knowledge Gate, Wizard level 29, targets the caster.', src: POK_SPELL_SRC(3183, '3255') },
  },
  {
    key: 'knowledge-portal', label: 'Knowledge Portal (Wizard 39, group)',
    hop: { type: 'port', via: 'spell', from: 'anywhere', to: 'poknowledge', arrive: POK_ARRIVE, class: ['Wizard'],
      note: 'Knowledge Portal, Wizard level 39, carries the group.', src: POK_SPELL_SRC(3180, '3252') },
  },
  {
    key: 'translocate-knowledge', label: 'Translocate: Knowledge (Wizard 49, single target)',
    hop: { type: 'port', via: 'spell', from: 'anywhere', to: 'poknowledge', arrive: POK_ARRIVE, class: ['Wizard'],
      note: 'Translocate: Knowledge, Wizard level 49, is a translocate-type effect on a single target.',
      src: POK_SPELL_SRC(3181, '3253'),
      unverified: 'Whether the target may be the caster, and what the translocate effect does when the target is not in your group, were not checked.' },
  },
  {
    key: 'talisman-gate', label: 'Talisman Gate (any class, from a Clockwork Talisman or The Binden Concerrentia)',
    hop: { type: 'port', via: 'item', from: 'anywhere', to: 'poknowledge', arrive: L(725, 411, -158),
      gate: [{ kind: 'item', text: 'one of: Small Clockwork Talisman (28284), Powered Clockwork Talisman (28290), The Binden Concerrentia (28296), Summoned: Talisman of Return (28599, level 46 to click)', src: ['eqemu_items clickeffect=3046'] }],
      note: 'Click the talisman: it casts Talisman Gate, which lands in the middle of the Plane of Knowledge. Every class can click all four.',
      src: [`eqemu_spells id=3046`, 'eqemu_items clickeffect=3046', srv('utils/sql/git/required/2016_11_12_spells_part1.sql', '3146') + ' (its teleport zone is poknowledge)'] },
  },
];

// ── the routes (hop ids, in order) ───────────────────────────────────────────────────────────────────────────────
export type RouteDef = { to: PopZone; hops: HopId[]; notes: string; alt?: string };

const AIR_EARTH_WATER_NOTE = 'Needs the Zebuxoruk flag at 2, and one click sets all three elemental flags (Air, Water, Earth).';

/** Forward routes from the Plane of Knowledge. A route with `alt` is a second way to the same zone (its key gets that suffix). */
export const FORWARD_ROUTES: RouteDef[] = [
  { to: 'potranquility', hops: ['pok_tranq'], notes: 'The hub. Every other plane is one portal or zone line away from here.' },
  { to: 'podisease', hops: ['pok_tranq', 'tranq_disease'], notes: 'By zone line, not portal.' },
  { to: 'ponightmare', hops: ['pok_tranq', 'tranq_nightmare'], notes: 'Open: no script gates the portal.' },
  { to: 'nightmareb', hops: ['pok_tranq', 'tranq_nightmare', 'nightmare_lair'], notes: 'Through Nightmare; the Lair portal needs the Thelin flag above 1.' },
  { to: 'pojustice', hops: ['pok_tranq', 'tranq_justice'], notes: 'Open: no script gates the portal.' },
  { to: 'poinnovation', hops: ['pok_tranq', 'tranq_innov'], notes: 'Open: no script gates the portal.' },
  { to: 'povalor', hops: ['pok_tranq', 'tranq_valor'], notes: 'Needs the Mavuin flag at 3 (the same click opens Storms).' },
  { to: 'postorms', hops: ['pok_tranq', 'tranq_storms'], notes: 'Needs the Mavuin flag at 3 (the same click opens Valor).' },
  { to: 'codecay', hops: ['pok_tranq', 'tranq_disease', 'disease_codecay'], notes: 'First visit: through Disease with the Grummus flag.' },
  { to: 'codecay', hops: ['pok_tranq', 'tranq_codecay'], alt: 'tranq', notes: 'Repeat visits: the Tranquility portal works once the Crypt zone flag exists.' },
  { to: 'potorment', hops: ['pok_tranq', 'tranq_torment'], notes: 'Needs the Fuirstel flag at 5 and the Thelin flag at 4.' },
  { to: 'hohonora', hops: ['pok_tranq', 'tranq_valor', 'valor_hoh'], notes: 'First visit: Valor, then the underground tunnel portal with the Aerin`Dar flag.' },
  { to: 'hohonora', hops: ['pok_tranq', 'tranq_hoh'], alt: 'tranq', notes: 'Repeat visits: the Tranquility portal works once the Halls of Honor zone flag exists.' },
  { to: 'hohonorb', hops: ['pok_tranq', 'tranq_valor', 'valor_hoh', 'hoh_marr'], notes: 'Through the Halls of Honor, after all three trials.' },
  { to: 'bothunder', hops: ['pok_tranq', 'tranq_storms', 'storms_bot'], notes: 'First visit: the Storms shrine, which raises the Karana flag to 3.' },
  { to: 'bothunder', hops: ['pok_tranq', 'tranq_bot'], alt: 'tranq', notes: 'Repeat visits: the Tranquility portal, once Karana is at 3 or any Zebuxoruk flag exists.' },
  { to: 'potactics', hops: ['pok_tranq', 'tranq_tactics'], notes: 'Needs the Zeks flag at 2.' },
  { to: 'solrotower', hops: ['pok_tranq', 'tranq_solro'], notes: 'Needs the cipher and the Zeks flag at 6.' },
  { to: 'pofire', hops: ['pok_tranq', 'tranq_solro', 'solro_chamber', 'solro_fire'], notes: 'First visit: the Lava Well of Ro in the Tower, with the second Fire flag. The Tranquility portal never grants the flag.' },
  { to: 'pofire', hops: ['pok_tranq', 'tranq_fire'], alt: 'tranq', notes: 'Repeat visits: the Tranquility portal, once the Plane of Fire zone flag exists.' },
  { to: 'poair', hops: ['pok_tranq', 'tranq_air'], notes: AIR_EARTH_WATER_NOTE },
  { to: 'powater', hops: ['pok_tranq', 'tranq_water'], notes: AIR_EARTH_WATER_NOTE },
  { to: 'poeartha', hops: ['pok_tranq', 'tranq_earth'], notes: AIR_EARTH_WATER_NOTE },
  { to: 'poearthb', hops: ['pok_tranq', 'tranq_earth', 'earth_earthb'], notes: 'Through the first Earth area, with the Earth key flag.' },
  { to: 'potimea', hops: ['pok_tranq', 'tranq_innov', 'innov_time'], notes: 'First visit: the time machine in Innovation, with the Zebuxoruk flag at 2 and the Quintessence in your bags.' },
  { to: 'potimea', hops: ['pok_tranq', 'tranq_time'], alt: 'tranq', notes: 'Repeat visits: the Tranquility portal, level 65, once the Time flag and the time qglobal exist.' },
  { to: 'potimeb', hops: ['pok_tranq', 'tranq_innov', 'innov_time', 'time_timeb'], notes: 'Raid only: the dial portals in Time A, level 65, 7 or more in the raid.' },
  { to: 'potimeb', hops: ['pok_tranq', 'tranq_time', 'time_timeb'], alt: 'tranq', notes: 'Raid only, repeat visits through the Tranquility portal.' },
];

/** The way back: each zone to the Plane of Knowledge. */
export const BACK_ROUTES: RouteDef[] = [
  { to: 'potranquility', hops: ['b_tranq_pok'], notes: 'One portal beside the Tranquility arrival spot.' },
  { to: 'podisease', hops: ['b_disease_tranq', 'b_tranq_pok'], notes: 'By zone line to Tranquility.' },
  { to: 'ponightmare', hops: ['b_nightmare_tranq', 'b_tranq_pok'], notes: 'Two exits to Tranquility; door 10 is the one at the zone-in.' },
  { to: 'nightmareb', hops: ['b_lair_nightmare', 'b_nightmare_tranq', 'b_tranq_pok'], notes: 'Back through Nightmare.' },
  { to: 'pojustice', hops: ['b_justice_tranq', 'b_tranq_pok'], notes: '' },
  { to: 'poinnovation', hops: ['b_innov_tranq', 'b_tranq_pok'], notes: '' },
  { to: 'povalor', hops: ['b_valor_tranq', 'b_tranq_pok'], notes: '' },
  { to: 'postorms', hops: ['b_storms_tranq', 'b_tranq_pok'], notes: '' },
  { to: 'codecay', hops: ['b_codecay_tranq', 'b_tranq_pok'], notes: 'The upper Crypt and the lower crypt have their own exit doors.' },
  { to: 'potorment', hops: ['b_torment_tranq', 'b_tranq_pok'], notes: '' },
  { to: 'hohonora', hops: ['b_hoh_tranq', 'b_tranq_pok'], notes: '' },
  { to: 'hohonorb', hops: ['b_marr_hoh', 'b_hoh_tranq', 'b_tranq_pok'], notes: 'Back through the Halls of Honor.' },
  { to: 'bothunder', hops: ['b_bot_tranq', 'b_tranq_pok'], notes: '' },
  { to: 'potactics', hops: ['b_tactics_tranq', 'b_tranq_pok'], notes: 'Use door 23; the others are rerouted by the script.' },
  { to: 'solrotower', hops: ['b_solro_tranq', 'b_tranq_pok'], notes: '' },
  { to: 'pofire', hops: ['b_fire_tranq', 'b_tranq_pok'], notes: '' },
  { to: 'poair', hops: ['b_air_tranq', 'b_tranq_pok'], notes: '' },
  { to: 'powater', hops: ['b_water_tranq', 'b_tranq_pok'], notes: '' },
  { to: 'poeartha', hops: ['b_earth_tranq', 'b_tranq_pok'], notes: '' },
  { to: 'poearthb', hops: ['b_earthb_earth', 'b_earth_tranq', 'b_tranq_pok'], notes: 'Back through the first Earth area.' },
  { to: 'potimea', hops: ['b_time_tranq', 'b_tranq_pok'], notes: 'The zone line out of Time A is not placed in the data.' },
  { to: 'potimeb', hops: ['b_timeb_time', 'b_time_tranq', 'b_tranq_pok'], notes: 'Back through Time A.' },
];

/** Single hops that are not on any route from the Plane of Knowledge (Time's graveyard stone and the Time B god portals). */
export const SIDE_HOPS: HopId[] = [
  's_timea_graveyard', 's_timeb_tactics_a', 's_timeb_tactics_b', 's_timeb_disease', 's_timeb_nightmare', 's_timeb_torment',
];

// ── the rows ─────────────────────────────────────────────────────────────────────────────────────────────────────
const KEY_PREFIX = 'wolfpack:travel_paths:pop:';
const hopsOf = (ids: HopId[]): TravelHop[] => ids.map(id => HOPS[id] as TravelHop);

/** Every travel_paths row this module seeds, in a fixed order. */
export function travelPathRows(): TravelRow[] {
  const rows: TravelRow[] = [];
  for (const r of FORWARD_ROUTES) {
    rows.push({
      key: `fwd:poknowledge>${r.to}${r.alt ? '#' + r.alt : ''}`,
      zone_from_short: 'poknowledge', zone_to_short: r.to, hops: hopsOf(r.hops),
      notes: (r.alt ? 'Alternate route. ' : '') + r.notes,
    });
  }
  for (const r of BACK_ROUTES) {
    rows.push({
      key: `back:${r.to}>poknowledge`,
      zone_from_short: r.to, zone_to_short: 'poknowledge', hops: hopsOf(r.hops), notes: r.notes,
    });
  }
  for (const e of POK_ENTRIES) {
    rows.push({
      key: `into-pok:${e.key}`,
      zone_from_short: null, zone_to_short: 'poknowledge', hops: [e.hop],
      notes: `Into the Plane of Knowledge from anywhere that allows it: ${e.label}.`,
    });
  }
  for (const id of SIDE_HOPS) {
    const h = HOPS[id] as TravelHop;
    rows.push({
      key: `side:${id}`, zone_from_short: h.from, zone_to_short: h.to, hops: [h],
      notes: h.note,
    });
  }
  return rows;
}

// ── the seed migration, rendered ─────────────────────────────────────────────────────────────────────────────────
const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The migration body (everything after the header comment is generated). The test compares the committed file to this. */
export function seedSql(): string {
  const values = travelPathRows().map(r => {
    const hopsJson = '[\n' + r.hops.map(h => ' ' + JSON.stringify(h)).join(',\n') + '\n]';
    if (hopsJson.includes('$j$')) throw new Error('hops JSON contains the dollar-quote tag');
    return `  (uuid_generate_v5(uuid_ns_url(), ${sqlText(KEY_PREFIX + r.key)}), ${r.zone_from_short ? sqlText(r.zone_from_short) : 'null'}, ${sqlText(r.zone_to_short)},\n$j$${hopsJson}$j$::jsonb,\n  ${sqlText(r.notes)}, null)`;
  });
  return [
    'insert into travel_paths (id, zone_from_short, zone_to_short, hops, notes, posted_by_discord_id)',
    'values',
    values.join(',\n'),
    'on conflict (id) do update',
    '  set hops = excluded.hops, notes = excluded.notes, updated_at = now()',
    '  where travel_paths.posted_by_discord_id is null;',
    '',
  ].join('\n');
}

// ── reading it ───────────────────────────────────────────────────────────────────────────────────────────────────
/** The main route from the Plane of Knowledge to `zone`, or null for the Plane of Knowledge itself. */
export function routeFromPok(zone: PopZone): TravelRow | null {
  return travelPathRows().find(r => r.key === `fwd:poknowledge>${zone}`) ?? null;
}

/** Every zone reachable from the Plane of Knowledge over the hops of the forward routes (a plain graph walk). */
export function reachableFromPok(): Set<string> {
  const edges = new Map<string, Set<string>>();
  for (const r of FORWARD_ROUTES) for (const h of hopsOf(r.hops)) {
    if (!edges.has(h.from)) edges.set(h.from, new Set());
    edges.get(h.from)!.add(h.to);
  }
  const seen = new Set<string>(['poknowledge']);
  const queue = ['poknowledge'];
  while (queue.length) {
    const z = queue.shift()!;
    for (const n of edges.get(z) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  }
  return seen;
}
