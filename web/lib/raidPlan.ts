// The raid-night plan for /pop/raid (the guild lead, 2026-10-13: "this is our target list for tomorrow. make us a
// raid page that has preflag checking, travel guide, expectations, and maps with paths preferably").
//
// All content, no JSX. Read off Quarm's own quest scripts and spawn tables, not a guide; anything the scripts
// do not say outright is marked "(inferred)". Coordinates are x, y in the SERVER frame (as stored in the spawn
// table). The game's /loc prints Y then X, so `loc()` flips them for anything a player will type or compare.
//
// The order is the guild's list for the night: Disease, Innovation, Nightmare, the Lair, Valor.

export type Pt = { x: number; y: number };
export type RoutePt = Pt & { label: string };
export type MarkerKind = 'boss' | 'zonein' | 'npc';
export type MapMarker = Pt & { label: string; kind: MarkerKind };

export type Boss = {
  name: string;
  npc: number;
  stats: string;
  abilities: string;
  mechanics: string[];
  before?: string[];
  after?: string[];
  history?: string;
};

export type PlanSection = {
  id: string;
  title: string;
  zone: string;        // zone short name, for the walls
  zoneName: string;
  needs: string[];     // preflag keys this section wants (keys of PREFLAGS)
  before: string[];
  travel: string[];
  bosses: Boss[];
  markers: MapMarker[];
  route: RoutePt[];
  altRoutes?: RoutePt[][];
  patrol?: Pt[];
};

export type Preflag = { key: string; short: string; label: string; target: string; why: string };

export const RAID_DATE = '2026-10-14';
export const RAID_DATE_LINE = 'Wednesday 2026-10-14 · 8:30pm ET';

/**
 * The sign-up event for the raid night: of the events that start on `date` (an ET calendar date), the earliest
 * that starts at 18:00 ET or later, else the earliest of the day. Null when none.
 */
export function pickRaidEvent<T extends { start_time: string }>(events: T[], date: string = RAID_DATE): T | null {
  const et = (iso: string) => {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(iso));
    const g = (t: string) => p.find(x => x.type === t)?.value ?? '';
    return { day: `${g('year')}-${g('month')}-${g('day')}`, hour: Number(g('hour')) };
  };
  const sameDay = events
    .filter(e => et(e.start_time).day === date)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  return sameDay.find(e => et(e.start_time).hour >= 18) ?? sameDay[0] ?? null;
}

/** The in-page anchor of one boss, so the overview can link straight to it. */
export const bossAnchor = (sectionId: string, npc: number): string => `${sectionId}-${npc}`;

/** What a player types to compare: /loc prints Y first, then X. */
export const loc = (x: number, y: number): string => `/loc ${y}, ${x}`;

// The preflags that matter tonight. `key` is a step key (web/lib/popSteps.ts); holding a later step of a series
// counts, because stepsHeld() expands it (thelin_2 includes thelin_1).
export const PREFLAGS: Preflag[] = [
  {
    key: 'fuirstel_1', short: 'Adler', label: 'Adler: say "ward"', target: 'Grummus',
    why: `Adler Fuirstel stands by the Disease zone line in Tranquility (${loc(-1467, 1786)}). Without it the kill only gives a checklist flag; the Seer fixes that later.`,
  },
  {
    key: 'poi_door_1', short: 'Door', label: 'Innovation door (Xanamech + Nitram)', target: 'Prototypes, Behemoth',
    why: 'Opens factory door 7, the way to the Prototypes and the Behemoth. One flagged person opening it lets everyone through while it stays open (inferred).',
  },
  {
    key: 'zeks_1', short: 'Giwin', label: 'Giwin: "test the machine"', target: 'Behemoth',
    why: `Giwin Mirakon in Innovation (${loc(49, -52)}): hail, then say "great warrior", "task", "test the machine". Without it the Behemoth kill gives a checklist flag only.`,
  },
  {
    key: 'thelin_1', short: 'Adroha', label: 'Adroha: "tortured by nightmares"', target: 'Maze, Terris',
    why: `Adroha in Tranquility (${loc(-1428, -258)}). Needed BEFORE the hedge maze for the maze to count.`,
  },
  {
    key: 'thelin_2', short: 'Maze', label: 'Hedge maze + Thelin', target: 'Lair of Terris Thule',
    why: 'REQUIRED TO ENTER the Lair: its door checks that this step is held. Also needed for the Terris flag.',
  },
  {
    key: 'mavuin_3', short: 'Justice', label: 'Justice flag (Mavuin 3)', target: 'Valor, Aerin`Dar',
    why: 'REQUIRED TO ENTER Valor (the Tranquility Valor door checks it) and for Aerin`Dar\'s flag.',
  },
];

export const TRAVEL_BASICS: { title: string; points: string[] } = {
  title: 'Travel basics',
  points: [
    'Tranquility is the hub. Get there from PoK with the portal (the book).',
    'Guild instance doors are in the buildings around the PoK book in Tranquility. Tier 1 is to the SOUTH (Disease, Innovation, Nightmare). Tier 2 is to the NORTH, and more of tier 2 plus tier 3 is to the EAST. Valor is tier 2, so its door is north or east.',
    'The Lair of Terris Thule is not in Tranquility: its door is inside Plane of Nightmare.',
    'FIRST TIME into a zone: you must have zoned into the LIVE version once through its standard Tranquility portal. After that the guild-instance door lets you in.',
    `Seer Mal Nae\`Shi in PoK (${loc(-224, -42)}): sit and say "guided meditation" to list your flags. Say "unlock memories" to turn a checklist flag into the real one once the missing pre-step is done.`,
    'After a flag boss, a Planar Projection appears (Giwin for the Behemoth). Only the raid or group that got the kill can flag from it; anyone else is refused without a word.',
  ],
};

export const PLAN: PlanSection[] = [
  {
    id: 'disease',
    title: 'Plane of Disease: Grummus',
    zone: 'podisease',
    zoneName: 'Plane of Disease',
    needs: ['fuirstel_1'],
    before: [
      `Everyone who wants the real flag: hail Adler Fuirstel in Tranquility (${loc(-1467, 1786)}) and say "ward".`,
      'Safe zone-in is far from him: about 3,900 units in a straight line.',
    ],
    travel: [
      `Zone in at ${loc(-1750, -1245)} and go east to his spawn at ${loc(2041, -275)}.`,
      `The Crypt of Decay pipe is beside him: zone line ${loc(2110, -115)}, pipe door ${loc(2170, -130)}.`,
      'He walks a loop: do not pull him toward the pipe.',
    ],
    bosses: [{
      name: 'Grummus',
      npc: 205091,
      stats: 'L70 · 500,000 HP · AC 675',
      abilities: 'Summons, enrages, rampages. Unslowable, unmezzable, unstunnable, uncharmable, unsnareable, unfearable. Needs magic weapons. Not pacify-immune.',
      mechanics: [
        'Nukes: Plasma Decay, Stench of Decay. 10% proc: Decay of the Plaguebringer.',
        `He patrols: ${loc(2040, -108)} to ${loc(2040, -314)} to ${loc(1855, -314)} to ${loc(1855, -280)}, then loops back.`,
      ],
      after: [
        'A Planar Projection spawns at his corpse for 20 minutes. Hail it.',
        'With the Adler step: the Milyk flag (fuirstel 2) plus the Crypt key. Without it: a checklist flag, plus the Crypt key (silently, no chat line).',
        'Later: hail Elder Fuirstel in Tranquility with the ward (fuirstel 3).',
      ],
      history: 'Our history: 1 kill (Oct 10), 42 players, about 5 minutes.',
    }],
    markers: [
      { label: 'Zone-in', kind: 'zonein', x: -1750, y: -1245 },
      { label: 'Grummus spawn', kind: 'boss', x: 2041, y: -275 },
      { label: 'Crypt of Decay pipe', kind: 'npc', x: 2170, y: -130 },
    ],
    route: [
      { label: 'Zone-in', x: -1750, y: -1245 },
      { label: 'Grummus spawn', x: 2041, y: -275 },
    ],
    patrol: [
      { x: 2040, y: -108 }, { x: 2040, y: -314 }, { x: 1855, y: -314 }, { x: 1855, y: -280 }, { x: 2040, y: -108 },
    ],
  },
  {
    id: 'innovation',
    title: 'Plane of Innovation: Prototypes X, IX, XI and the Behemoth',
    zone: 'poinnovation',
    zoneName: 'Plane of Innovation',
    needs: ['poi_door_1', 'zeks_1'],
    before: [
      'Innovation door flag (Xanamech + Nitram): needed to open factory door 7.',
      `Behemoth flag: Giwin Mirakon at ${loc(49, -52)}. Hail, then "great warrior", "task", "test the machine".`,
    ],
    travel: [
      `Zone in at ${loc(263, 516)}. Factory door 7 is at ${loc(0, 84)}.`,
      'Order: X, then IX, then XI, then the Behemoth far to the east.',
    ],
    bosses: [
      {
        name: 'Manaetic Prototype X',
        npc: 206053,
        stats: 'L66 · about 96,000 HP · AC 300',
        abilities: 'Enrages, area rampage. Can be slowed, mezzed, stunned. Oil Spray, Steam Blast.',
        mechanics: [
          `Spawns at ${loc(-267, -241)}. Leash: x -400 to -100. Pulled out of it, it resets to full HP.`,
          'Teleports its target every 2 to 30 seconds, toward IX\'s room (inferred).',
          'Fight each one in its own room and expect the tank to be pulled into a neighbour\'s room.',
        ],
      },
      {
        name: 'Manaetic Prototype IX',
        npc: 206054,
        stats: 'L66 · about 96,000 HP · AC 300',
        abilities: 'Enrages, flurries. Can be slowed, mezzed, stunned. Oil Spray, Steam Blast.',
        mechanics: [
          `Spawns at ${loc(-1, -495)}. Leash: y -600 to -350.`,
          'Teleports its target every 2 to 30 seconds, toward XI\'s room (inferred).',
        ],
      },
      {
        name: 'Manaetic Prototype XI',
        npc: 206055,
        stats: 'L66 · about 96,000 HP · AC 300',
        abilities: 'Enrages, rampages. Can be slowed, mezzed, stunned. Oil Spray, Steam Blast.',
        mechanics: [
          `Spawns at ${loc(295, -240)}. Leash: x 100 to 400.`,
          'Teleports its target every 2 to 30 seconds, toward X\'s room (inferred).',
        ],
        history: 'Our last run (Oct 5): about 12 to 37 seconds each, about 30 players. No flags, loot only.',
      },
      {
        name: 'Manaetic Behemoth',
        npc: 206046,
        stats: 'L70 · 150,000 HP',
        abilities: 'Summons, enrages. Unslowable, unmezzable, unstunnable.',
        mechanics: [
          'The list said "Magnetic"; the game calls it the Manaetic Behemoth.',
          `He sleeps until the clockwork-device event. A device spawns every 48 seconds from 6 places (event master at ${loc(1254, -96)}) and walks to the factory to blow up. KILL 10 DEVICES and he wakes, with one random extra spell: Gas Leak, Deathfog, Biomelt or Liquid Hydrokill.`,
          `He spawns at ${loc(1125, 0)}. Leash: x 1033 to 1215, y within 120 of zero.`,
          'Our Mimic card: "split the raid in two and hold both doors; spiders run in and explode for 4000 AE".',
        ],
        after: [
          `#Giwin Mirakon spawns at ${loc(1013, 0)} for ONLY 10 MINUTES. Hail him.`,
          'With the Giwin step (zeks 1): the real flag (zeks 2, opens Plane of Tactics). Without it: a checklist flag.',
        ],
        history: 'Our history: 4 kills, 45 to 84 seconds, 20 to 32 players.',
      },
    ],
    markers: [
      { label: 'Zone-in', kind: 'zonein', x: 263, y: 516 },
      { label: 'Factory door 7', kind: 'zonein', x: 0, y: 84 },
      { label: 'Prototype XI', kind: 'boss', x: 295, y: -240 },
      { label: 'Prototype X', kind: 'boss', x: -267, y: -241 },
      { label: 'Prototype IX', kind: 'boss', x: -1, y: -495 },
      { label: 'Behemoth', kind: 'boss', x: 1125, y: 0 },
      { label: 'Device event master', kind: 'npc', x: 1254, y: -96 },
      { label: 'Giwin (before)', kind: 'npc', x: 49, y: -52 },
      { label: 'Giwin (after kill)', kind: 'npc', x: 1013, y: 0 },
    ],
    route: [
      { label: 'Zone-in', x: 263, y: 516 },
      { label: 'Factory door 7', x: 0, y: 84 },
      { label: 'Prototype X', x: -267, y: -241 },
      { label: 'Prototype IX', x: -1, y: -495 },
      { label: 'Prototype XI', x: 295, y: -240 },
      { label: 'Behemoth', x: 1125, y: 0 },
    ],
  },
  {
    id: 'nightmare',
    title: 'Plane of Nightmare: Vhaksiz and Mujaki',
    zone: 'ponightmare',
    zoneName: 'Plane of Nightmares',
    needs: ['thelin_1', 'thelin_2'],
    before: [
      `Terris preflag: Adroha first (${loc(-1428, -258)} in Tranquility), then the hedge maze, then Thelin Poxbourne.`,
      `The maze starts outside: Thelin Poxbourne at ${loc(-1519, 1104)}. Say "ready". 3 dreams, 24 players each, 4 groups per dream. Hail Thelin at the end (thelin 2).`,
    ],
    travel: [
      `Zone in at ${loc(1668, 282)}. Vhaksiz is at ${loc(-407, 1418)}. Etumer is at ${loc(-1309, -1654)}.`,
      `The Lair door (door 59) is at ${loc(-1942, 166)}.`,
    ],
    bosses: [
      {
        name: 'Vhaksiz the Shade',
        npc: 204028,
        stats: 'L65 · 300,000 HP',
        abilities: 'Summons, rampages. Unslowable, unmezzable, uncharmable, unsnareable, unfearable, pacify-immune. Needs magic weapons.',
        mechanics: [
          'The list said "Vhaksiv"; the game spells it Vhaksiz.',
          `Stands still at ${loc(-407, 1418)}, no patrol. Leash 155 units: pull him further and he resets.`,
          'Casts Nullify Magic (dispel), Aura of Pain, Invoke Fear, Festering Darkness (snare), Ignite Blood and Asystole (DoTs), Touch of Innoruuk (lifetap). 5% Shadowblade proc.',
        ],
        history: 'No flag.',
      },
      {
        name: 'Mujaki the Devourer',
        npc: 204039,
        stats: 'L70 · 400,000 HP',
        abilities: 'Summons, enrages. Unmezzable, pacify-immune. Can be slowed and stunned. Needs magic weapons. 25% proc: Devouring Nightmare.',
        before: [
          `A timed TRIAL, not a standing spawn. Start it at Etumer (${loc(-1309, -1654)}): the group leader hails, then says "brother", "perhaps", "ready".`,
          'He ports everyone within 150 units into ONE room per raid (up to 24 players, 4 groups; extras are ported out). A second room needs a different raid.',
        ],
        mechanics: [
          `Rooms: ${loc(-1475, -2555)}, ${loc(-422, -3555)}, ${loc(621, -2555)}.`,
          'Waves every 2 minutes from 2 minutes in (waves 4 to 7 are doubled). Servants that reach the platform become Riders (L60, 22,000 HP) and fight beside Mujaki.',
          'Mujaki and the Riders become attackable about 18 minutes in. The room empties after 25 minutes if not engaged.',
        ],
        history: 'No flag.',
      },
    ],
    markers: [
      { label: 'Zone-in', kind: 'zonein', x: 1668, y: 282 },
      { label: 'Vhaksiz', kind: 'boss', x: -407, y: 1418 },
      { label: 'Etumer (Mujaki start)', kind: 'npc', x: -1309, y: -1654 },
      { label: 'Mujaki room 1', kind: 'boss', x: -1475, y: -2555 },
      { label: 'Mujaki room 2', kind: 'boss', x: -422, y: -3555 },
      { label: 'Mujaki room 3', kind: 'boss', x: 621, y: -2555 },
      { label: 'Thelin Poxbourne (maze)', kind: 'npc', x: -1519, y: 1104 },
      { label: 'Lair door 59', kind: 'zonein', x: -1942, y: 166 },
    ],
    route: [
      { label: 'Zone-in', x: 1668, y: 282 },
      { label: 'Vhaksiz', x: -407, y: 1418 },
    ],
    altRoutes: [[
      { label: 'Zone-in', x: 1668, y: 282 },
      { label: 'Etumer', x: -1309, y: -1654 },
    ]],
  },
  {
    id: 'lair',
    title: 'Lair of Terris Thule: Terris Thule',
    zone: 'nightmareb',
    zoneName: 'The Lair of Terris Thule',
    needs: ['thelin_2'],
    before: [
      'Needs the hedge maze step (thelin 2). Without it the door says "you lack the will".',
      'Terris Thule here is NPC 221041, not the Plane of Time one.',
    ],
    travel: [
      `Enter from INSIDE Plane of Nightmare: door 59 at ${loc(-1942, 166)}. It lands you at ${loc(-1904, 198)}, right beside her.`,
      `The Lair's own safe zone-in is ${loc(1608, 30)}, far away.`,
    ],
    bosses: [{
      name: 'Terris Thule',
      npc: 221041,
      stats: 'L70 · 450,000 HP',
      abilities: 'Summons, enrages, flurries. Unmezzable, unstunnable, uncharmable, pacify-immune. Can be slowed. Magic weapons. 10% proc: Touch of Night.',
      mechanics: [
        `She stands at ${loc(-1803, -13)}.`,
        `At 79% and 69%: one dream defiler spawns for EVERY player on her hate list (at ${loc(-1661, -168)}).`,
        'At 50%: Direption of Dreams (slow and miss debuff). Our Mimic card: "MASS AE DISPEL, all but MT + 2 healers hide behind the wall".',
        `At 40%: four statues wake (L63, 53,000 HP, enrage) at ${loc(-1954, 99)}, ${loc(-1748, 91)}, ${loc(-1736, -125)}, ${loc(-1958, -104)}.`,
        'Leash box: x -2090 to -1580, y -280 to 250. Out of combat she resets all adds.',
      ],
      after: [
        'A Planar Projection spawns at her corpse for 20 minutes. Hail it.',
        'With thelin 2 you get thelin 3; otherwise a checklist flag.',
        'Later: hail Thelin (Elder Poxbourne) in Tranquility (thelin 4, half of the Torment gate).',
      ],
      history: 'Our history: none.',
    }],
    markers: [
      { label: 'Arrival (door 59)', kind: 'zonein', x: -1904, y: 198 },
      { label: 'Terris Thule', kind: 'boss', x: -1803, y: -13 },
      { label: 'Defiler spawn', kind: 'npc', x: -1661, y: -168 },
      { label: 'Statue 1', kind: 'npc', x: -1954, y: 99 },
      { label: 'Statue 2', kind: 'npc', x: -1748, y: 91 },
      { label: 'Statue 3', kind: 'npc', x: -1736, y: -125 },
      { label: 'Statue 4', kind: 'npc', x: -1958, y: -104 },
    ],
    route: [
      { label: 'Arrival', x: -1904, y: 198 },
      { label: 'Terris Thule', x: -1803, y: -13 },
    ],
  },
  {
    id: 'valor',
    title: 'Plane of Valor: Aerin`Dar',
    zone: 'povalor',
    zoneName: 'Plane of Valor',
    needs: ['mavuin_3'],
    before: [
      'Needs the Justice flag (mavuin 3) to enter.',
      'Bring A Crystalline Globe (item 25596) on the cursor or keyring. First use adds it to the keyring.',
    ],
    travel: [
      `Zone in at ${loc(190, -1668)}. The glass door is at ${loc(360, 1840)}; a lever opens it at ${loc(304, 1802)} or ${loc(375, 1909)}.`,
      `Then the orb teleporter at ${loc(360, 2089)} sends you to ${loc(352, 2172)}, ONLY while Aerin\`Dar is up.`,
      `His round floor door is at ${loc(360, 2698)}.`,
    ],
    bosses: [{
      name: 'Aerin`Dar',
      npc: 208074,
      stats: 'L70 · 300,000 HP',
      abilities: 'Summons, enrages, rampages. Unmezzable, unstunnable, uncharmable. Can be slowed. Magic weapons. Glass Roar. 20% proc: Glass Shards.',
      mechanics: [
        `He stands at ${loc(366, 2672)}. Adds wake at 85% (2), 65% (2), 45% (2) and 25% (3, Rahlgon last): eight Mindless Minions (25,000 HP) and Rahlgon (30,000 HP, at ${loc(360, 2500)}).`,
        'Our Mimic card: "PULL HIM OFF HIS PLATFORM ... CC golems".',
        'Leash: z above 120, or y outside 2100 to 2880, warps him back.',
      ],
      after: [
        `A Planar Projection spawns at ${loc(360, 2528)} for 20 minutes. Hail it (silently sets the Aerin\`Dar step, only with mavuin 3).`,
        `Then click the Halls of Honor door at ${loc(656, 4276)} for the HoH flag.`,
      ],
      history: 'Our history: none.',
    }],
    markers: [
      { label: 'Zone-in', kind: 'zonein', x: 190, y: -1668 },
      { label: 'Lever 1', kind: 'npc', x: 304, y: 1802 },
      { label: 'Lever 2', kind: 'npc', x: 375, y: 1909 },
      { label: 'Glass door', kind: 'zonein', x: 360, y: 1840 },
      { label: 'Orb', kind: 'zonein', x: 360, y: 2089 },
      { label: 'Rahlgon', kind: 'boss', x: 360, y: 2500 },
      { label: 'Aerin`Dar', kind: 'boss', x: 366, y: 2672 },
      { label: 'Projection', kind: 'npc', x: 360, y: 2528 },
      { label: 'Halls of Honor door', kind: 'zonein', x: 656, y: 4276 },
    ],
    route: [
      { label: 'Zone-in', x: 190, y: -1668 },
      { label: 'Glass door', x: 360, y: 1840 },
      { label: 'Orb', x: 360, y: 2089 },
      { label: 'Landing', x: 352, y: 2172 },
      { label: 'Aerin`Dar', x: 366, y: 2672 },
    ],
  },
];
