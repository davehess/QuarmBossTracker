// web/lib/popEvents.ts — every scripted Planes of Power event, as data (/pop/events).
//
// The guild lead, 2026-10-30: "add this [the Relv / Falto, Lord of Thunder event] to the pop guide for plane of
// storms as an optional event. Please comb through the PoP LUA scripts and get us a repository of those events
// and include the loot that can drop and the percentages."
//
// WHAT IS HERE: the event list only. One record per event, read from the quest scripts at
// SecretsOTheP/quests @ 572bc06 (QUESTS_SHA below): how it starts, the timers, the mechanics in plain sentences, the
// mobs that drop its loot (npc id, name, level, HP), what a script hands out directly, and `cites`, every claim's
// script file and line range. The mechanics come from the server's scripts and our database, never from a guide.
//
// WHAT IS NOT HERE: the drops and the item stats. Those are read LIVE from eqemu_npc_drops and eqemu_items by
// the page (web/app/pop/events/load.ts), so a Quarm loot-table patch or the weekly mirror sync moves the page
// without a commit. The scoring and the ranking are web/lib/popEventsScore.ts (pure, no database).
//
// `kind` says how much of the flag path the event is:
//   flag       an event that sets or advances a flag on the road to Quarm, or hands out the items one needs
//   raid-boss  a god or final boss whose Planar Projection sets a flag
//   optional   nothing in the scripts sets a flag: loot, experience, keys, side content
// `kills` on a mob is how many of it a run kills when the script spawns a known number (default 1). Mobs a script
// spawns in unstated numbers (waves of trash) count once, so trash-heavy events are under-counted; the page says so.
//
// ⚠ Upstream's scripts: Quarm's own may differ. Where the scripts name no number the field says "unknown".
// This file is generated once from the research pass (events.json); edit a record by hand, keep its `cites` honest.
//
// ⚠ The TEXT of a record (kindWhy, start, timers, groupLimit, mechanics, reward names and triggers) is read by raiders
// (the guild lead, 2026-10-30: "the technical bits up here ... are not really worth displaying for everyone"). Write
// minutes and seconds, item and mob names with spaces, and /loc as Y, X. No ids, no script words, no milliseconds. The
// ids live in npcId, itemId and `cites`; test/pop-events.test.js refuses them in a sentence.

/** The commit of SecretsOTheP/quests the cites were read at. */
export const QUESTS_SHA = '572bc06874612ade7e9274979158747737bcd9bb';

export type EventKind = 'flag' | 'raid-boss' | 'optional';

export type EventNpc = {
  npcId: number;
  name: string;
  level: number;
  hp: number;
  /** Kills per run when the script spawns a known number (default 1). */
  kills?: number;
  killsNote?: string;
};

export type EventReward = { itemId: number; name: string; trigger: string };

export type PopEvent = {
  /** The anchor on /pop/events (`#<slug>`) and the key everything else uses. Unique. */
  slug: string;
  /** eqemu_zone.short_name. */
  zone: string;
  zoneName: string;
  name: string;
  kind: EventKind;
  kindWhy: string;
  /** A short group-size label when the scripts cap who can take part; the full script text is `groupLimit`. */
  size?: string;
  groupLimit?: string;
  start: string;
  timers: string;
  mechanics: string[];
  /** The mobs whose loot belongs to the event. Their drops are read live from eqemu_npc_drops. */
  npcs: EventNpc[];
  /** Items a script hands out directly (a turn-in), not from a loot table. */
  rewards: EventReward[];
  /** `<path>:<first>-<last>` inside the quests repo, lines inclusive. */
  cites: string[];
};

export const EVENTS: PopEvent[] = [
 {
  "slug": "podisease-altaccess-grimror",
  "zone": "podisease",
  "zoneName": "Plane of Disease",
  "name": "Alternate access: Grimror Plaguebringer (Crypt of Decay key)",
  "kind": "optional",
  "kindWhy": "Optional back door into the Crypt of Decay. It sets no flag, and it only works while the server has the alternate-access quests switched on.",
  "start": "In the Plane of Disease, hail Grimror Plaguebringer, then say 'stuff', 'big plan', 'help Grimror' and 'dem tings'. Hand him one each of Sengian, Generian, Scaevian and Harrion Larvae Flesh.",
  "timers": "None.",
  "mechanics": [
   "Grimror wants the larvae of four little bugs: two from the flies, one from the worms and one from the moss-skeeters.",
   "Hand in the right four and he gives you the Bangle of Disease Warding. Any other hand-in is returned.",
   "Hold the bangle on your cursor at the Crypt of Decay portal in the Plane of Tranquility once. It goes on your key ring and lets you through."
  ],
  "npcs": [],
  "rewards": [
   {
    "itemId": 9294,
    "name": "Bangle of Disease Warding (Crypt of Decay key)",
    "trigger": "Hand the four larvae flesh to Grimror Plaguebringer"
   }
  ],
  "cites": [
   "podisease/Grimror_Plaguebringer.lua:20-52",
   "potranquility/player.lua:25-40"
  ]
 },
 {
  "slug": "potranquility-altaccess-torment",
  "zone": "potranquility",
  "zoneName": "Plane of Tranquility",
  "name": "Alternate access: Torment key (Iramai Sacredsoul / Brugga / Purified Bubonian Bile)",
  "kind": "optional",
  "kindWhy": "Optional chain that earns the Symbol of Torment, a back door into the Plane of Torment. It sets no flag, and it only works while the server has the alternate-access quests switched on.",
  "start": "Hand Iramai Sacredsoul the Bubonian Bile for Purified Bubonian Bile and 50,000 experience. Take the Purified Bubonian Bile to Brugga in the Plane of Justice, who hands it back and asks for a Mechanical Clockwork Venom, a Terror Matriarch Venom Sack and a Nettling Wraith Stinger. Hand those to Brugga for a Vial of Opaque Fluid and 100,000 experience. Hand Iramai the Vial and the Purified Bubonian Bile for the Symbol of Torment.",
  "timers": "None.",
  "mechanics": [
   "Brugga only deals with you at Amiable standing or better."
  ],
  "npcs": [],
  "rewards": [
   {
    "itemId": 29213,
    "name": "Symbol of Torment",
    "trigger": "Hand the Vial of Opaque Fluid and the Purified Bubonian Bile to Iramai Sacredsoul (6,250 experience)"
   },
   {
    "itemId": 29302,
    "name": "Purified Bubonian Bile",
    "trigger": "Hand the Bubonian Bile to Iramai Sacredsoul (50,000 experience)"
   },
   {
    "itemId": 29295,
    "name": "Vial of Opaque Fluid",
    "trigger": "Hand the three venoms and stinger to Brugga in the Plane of Justice (100,000 experience)"
   }
  ],
  "cites": [
   "potranquility/Iramai_Sacredsoul.lua:30-40",
   "pojustice/Brugga.lua:28-38",
   "potranquility/player.lua:44-58"
  ]
 },
 {
  "slug": "povalor-altaccess-honor",
  "zone": "povalor",
  "zoneName": "Plane of Valor",
  "name": "Alternate access: Halls of Honor key (Grenic Drere / Borik Darkanvil / exiled soldiers)",
  "kind": "optional",
  "kindWhy": "Optional chain that earns the Ring of Marr, a back door into the Halls of Honor. It sets no flag, and it only works while the server has the alternate-access quests switched on.",
  "start": "Say 'box of souls', 'Perilium' or 'forge them for me' to Borik Darkanvil in the Plane of Knowledge. Hand him a Nightmare Mephit Heart, a Crystal Spider Brain, a Solid Block of Perilium and 3,000 platinum for a Box of Souls. Bring the box to an Exiled Soldier, Officer and Trooper of Marr in the Plane of Justice. Each hands it back with a Soul Sphere. Hand Grenic Drere the Box of Souls and all three Soul Spheres.",
  "timers": "None.",
  "mechanics": [
   "Each exile returns the box together with one of the three Soul Spheres."
  ],
  "npcs": [],
  "rewards": [
   {
    "itemId": 29214,
    "name": "Ring of Marr",
    "trigger": "Hand the Box of Souls and the three Soul Spheres to Grenic Drere (50,000 experience)"
   },
   {
    "itemId": 29281,
    "name": "Box of Souls",
    "trigger": "Hand Borik Darkanvil a Nightmare Mephit Heart, a Crystal Spider Brain, a Solid Block of Perilium and 3,000 platinum"
   }
  ],
  "cites": [
   "povalor/Grenic_Drere.lua:28-41",
   "poknowledge/Borik_Darkanvil.lua:1-40",
   "pojustice/Exiled_Soldier_of_Marr.lua:20-26",
   "pojustice/Exiled_Officer_of_Marr.lua:20-26",
   "pojustice/Exiled_Trooper_of_Marr.lua:20-26",
   "potranquility/player.lua:72-90"
  ]
 },
 {
  "slug": "postorms-altaccess-tactics",
  "zone": "postorms",
  "zoneName": "Plane of Storms",
  "name": "Alternate access: Drunder key (Askr the Lost / Wembly the Forlorn, four Diaku Emblem pieces)",
  "kind": "optional",
  "kindWhy": "Optional chain that earns the Completed Diaku Emblem, a back door into Drunder. It sets no flag, and it only works while the server has the alternate-access quests switched on. You need Amiable standing or better with Wembly.",
  "start": "In the Plane of Storms, hail Wembly the Forlorn and say 'done', 'key', 'agree to help', 'tied to the mast', 'Diaku' and 'Drunder'. Hand him all four Quarter of a Diaku Emblem pieces.",
  "timers": "None.",
  "mechanics": [
   "The hand-in also raises your standing a little with Askr the Lost and with the Storm Guardians."
  ],
  "npcs": [],
  "rewards": [
   {
    "itemId": 29215,
    "name": "Completed Diaku Emblem (Drunder key)",
    "trigger": "Hand the four Quarter of a Diaku Emblem pieces to Wembly the Forlorn (150,000 experience)"
   }
  ],
  "cites": [
   "postorms/Wembly_the_Forlorn.lua:1-67",
   "potranquility/player.lua:91-105"
  ]
 },
 {
  "slug": "bothunder-agnarr-karana",
  "zone": "bothunder",
  "zoneName": "Bastion of Thunder",
  "name": "Agnarr the Storm Lord (top of Torden) + Karana flagging",
  "kind": "raid-boss",
  "kindWhy": "The last kill of the Bastion of Thunder. Agnarr's death brings Karana, who gives the character flag on the road to Quarm.",
  "groupLimit": "Karana only flags the raid, group or solo player that got credit for the kill, and only 72 players per Karana.",
  "start": "Click the door into Torden's tower while the Symbol of Torden is on your cursor or key ring. One click covers your raid or group for 5 minutes. Without it, the first two clicks only give messages and the third wakes the storm watcher gargoyles. Doors on the upper floors take anyone carrying an Enchanted Ring of Torden up the tower. The fight starts when Agnarr is pulled.",
  "timers": "A storm portal adds one monster every 2 minutes, every 1 min 30 s below half health and every minute below a quarter. Every 45 seconds all the giants and adds are pulled onto Agnarr's target. Karana stays for 20 minutes.",
  "mechanics": [
   "Jolur Sandstorm appears 3 seconds after the pull. Ekil Thundercall joins at 75% health, Oljin Stormtide at 50% and Hibdin Cyclone at 25%. They all appear at /loc -1739, -1070.",
   "Each storm portal adds one random monster: a firestorm, a comet, a hurricane or a storm cloud.",
   "Giants and adds that fall below the top of the tower are sent back to where they started.",
   "When Agnarr dies, Karana appears at /loc -1758, -477. Hail him for his story. Say 'follow the path of the Fallen' to get the flag if you are at that step of the road. If you are at an earlier step, you only get the checklist flag.",
   "Say 'send me' and Karana casts Gate on you."
  ],
  "npcs": [
   {
    "npcId": 209026,
    "name": "Agnarr the Storm Lord",
    "level": 75,
    "hp": 1050000
   },
   {
    "npcId": 209136,
    "name": "Karana",
    "level": 75,
    "hp": 875000
   },
   {
    "npcId": 209142,
    "name": "Ekil Thundercall",
    "level": 67,
    "hp": 240000
   },
   {
    "npcId": 209146,
    "name": "Hibdin Cyclone",
    "level": 67,
    "hp": 240000
   },
   {
    "npcId": 209147,
    "name": "Jolur Sandstorm",
    "level": 67,
    "hp": 240000
   },
   {
    "npcId": 209148,
    "name": "Oljin Stormtide",
    "level": 67,
    "hp": 240000
   }
  ],
  "rewards": [],
  "cites": [
   "bothunder/Agnarr_the_Storm_Lord.lua:1-31",
   "bothunder/Agnarr_the_Storm_Lord.lua:33-90",
   "bothunder/Karana.lua:1-50",
   "bothunder/player.lua:165-217",
   "bothunder/A_storm_portal.lua:1-9",
   "bothunder/A_storm_watcher.lua:1-9"
  ]
 },
 {
  "slug": "bothunder-tower-lieutenants",
  "zone": "bothunder",
  "zoneName": "Bastion of Thunder",
  "name": "Evynd Firestorm and Emmerik Skyfury (lieutenants, Askr transports)",
  "kind": "flag",
  "kindWhy": "Not a flag. Each lieutenant's death brings Askr the Lost, who carries your group up toward Agnarr's floor.",
  "start": "Pull Evynd Firestorm or Emmerik Skyfury.",
  "timers": "While Evynd fights, a firestorm portal adds a monster every 2 minutes. Emmerik's portals come every 2 minutes, every 1 min 30 s below half health and every minute below a quarter. Askr does not stay long, and the script does not say exactly how long.",
  "mechanics": [
   "Evynd Firestorm calls a firestorm portal every 2 minutes. When he dies, Askr the Lost appears at /loc -1732, -1123. Say 'transport' to him and he takes you to /loc -1787, -880.",
   "Emmerik Skyfury calls a celestial portal every 2 minutes. When he dies, a second Askr the Lost appears at /loc -1733, -1065."
  ],
  "npcs": [
   {
    "npcId": 209054,
    "name": "Evynd Firestorm",
    "level": 70,
    "hp": 460000
   },
   {
    "npcId": 209053,
    "name": "Emmerik Skyfury",
    "level": 73,
    "hp": 640000
   }
  ],
  "rewards": [],
  "cites": [
   "bothunder/Evynd_Firestorm.lua:1-19",
   "bothunder/Emmerik_Skyfury.lua:1-27",
   "bothunder/#Askr_the_Lost.lua:1-23"
  ]
 },
 {
  "slug": "bothunder-torden-components",
  "zone": "bothunder",
  "zoneName": "Bastion of Thunder",
  "name": "Progression loot: Symbol of Torden components (giants of the lower halls)",
  "kind": "flag",
  "kindWhy": "The giants of the lower halls hand out the pieces for the Symbol of Torden, which opens Torden's tower. How the pieces are combined is not in the scripts.",
  "start": "Nothing to start: kill the listed giants. The loot is handed out when each one spawns.",
  "timers": "Unknown. Respawn times are in the database, not the scripts.",
  "mechanics": [
   "Laef Windfall, Gaukr Sandstorm, Oreen Wavecrasher and Hreidar Lynhillig each carry 3 Rings of Torden, always.",
   "Brynju Thunderclap, Auliffe Chaoswind, Eindride Icestorm, Kuanbyr Hailstorm, Ekil Thundercall, Hibdin Cyclone, Jolur Sandstorm and Oljin Stormtide each carry 1 Unadorned Symbol of Torden, always.",
   "Many other giants have a 25% chance to carry one component. Earth (jord) giants carry Sandstorm Gems and Spheres, fire (brann) giants Lightning, water (vann) giants Blizzard and wind (vind) giants Tornado.",
   "Kuanbyr Hailstorm shares his hate with Hrani, Iri and Leistr every 6 seconds. Brynju, Auliffe and Eindride are sent back to where they started if they fall too far."
  ],
  "npcs": [
   {
    "npcId": 209016,
    "name": "Brynju Thunderclap",
    "level": 67,
    "hp": 330000
   },
   {
    "npcId": 209059,
    "name": "Auliffe Chaoswind",
    "level": 67,
    "hp": 300000
   },
   {
    "npcId": 209060,
    "name": "Eindride Icestorm",
    "level": 67,
    "hp": 300000
   },
   {
    "npcId": 209061,
    "name": "Kuanbyr Hailstorm",
    "level": 67,
    "hp": 330000
   },
   {
    "npcId": 209070,
    "name": "Laef Windfall",
    "level": 65,
    "hp": 80000
   },
   {
    "npcId": 209071,
    "name": "Gaukr Sandstorm",
    "level": 65,
    "hp": 80000
   },
   {
    "npcId": 209072,
    "name": "Oreen Wavecrasher",
    "level": 65,
    "hp": 80000
   },
   {
    "npcId": 209082,
    "name": "Hreidar Lynhillig",
    "level": 65,
    "hp": 80000
   },
   {
    "npcId": 209057,
    "name": "Iri",
    "level": 65,
    "hp": 118000
   },
   {
    "npcId": 209058,
    "name": "Hrani",
    "level": 65,
    "hp": 120000
   },
   {
    "npcId": 209056,
    "name": "Leistr",
    "level": 65,
    "hp": 80000
   }
  ],
  "rewards": [],
  "cites": [
   "bothunder/encounters/ProgressionLoot.lua:1-51",
   "bothunder/Kuanbyr_Hailstorm.lua:1-30",
   "bothunder/Brynju_Thunderclap.lua:1-17",
   "bothunder/Auliffe_Chaoswind.lua:1-17",
   "bothunder/209060.lua:1-17",
   "bothunder/player.lua:171-216"
  ]
 },
 {
  "slug": "bothunder-storm-traps",
  "zone": "bothunder",
  "zoneName": "Bastion of Thunder",
  "name": "Elemental trap spawners (storm clouds)",
  "kind": "optional",
  "kindWhy": "A storm hazard on trash in the lower halls and towers. It gives no loot and no flag.",
  "start": "Pull any air, earth, fire or water trap monster.",
  "timers": "The storm cloud casts 5.5 seconds after it appears and leaves 5 seconds later.",
  "mechanics": [
   "You see 'Storm clouds begin to gather over your head.' There is a 50% chance a storm cloud follows (75% in the tower). Otherwise you see 'The storm clouds pass harmlessly.'",
   "The cloud casts one spell by trap type. Air: Tempest Wind. Earth: Stone Gale. Water: Raging Blizzard, Monsoons or Hail Storm. Fire: Thunderclap, Static Pulse or Thunder Call."
  ],
  "npcs": [],
  "rewards": [],
  "cites": [
   "bothunder/AirTrapSpawner.lua:1-27",
   "bothunder/EarthTrapSpawner.lua:1-27",
   "bothunder/WaterTrapSpawner.lua:1-27",
   "bothunder/FireTrapSpawner.lua:1-27",
   "bothunder/209160.lua:1-20"
  ]
 },
 {
  "slug": "codecay-chapel-chain",
  "zone": "codecay",
  "zoneName": "The Crypt of Decay",
  "name": "Chapel chain: Carprin Deatharn -> Avhi Escron -> Bishop Toluwon -> Ultor Szanvon (Tarkil Adan key)",
  "kind": "flag",
  "kindWhy": "The chapel chain ends with Tarkil Adan, who gives the key that lets you into Bertoxxulous's lower crypt. Without it the Bertoxxulous projection turns you away.",
  "groupLimit": "Tarkil Adan flags only the raid, group or solo player that got credit, and only 72 players per Tarkil Adan.",
  "start": "Pull the shielded Carprin Deatharn, who has 1,000,000 HP. On the first pull, Breddan Rutyl, Fran Prisoal and Abroan Drian appear. Kill all three. The last one removes the shielded Carprin and brings the real one.",
  "timers": "The three guards leave after 13 min 20 s. Carprin stays 3 h 25 min. Bishop Toluwon and High Priest Ultor Szanvon stay 3 h 15 min. Raex Pwodill and Vindor Mawnil stay 2 h 45 min. Tarkil Adan stays 10 minutes.",
  "mechanics": [
   "Carprin Deatharn dies, then Avhi Escron appears at /loc 135, 405 with Reanimated Reaver adds.",
   "Avhi dies, then Bishop Toluwon appears at /loc 84, 258.",
   "The Bishop dies, then High Priest Ultor Szanvon appears at /loc 318, 306 with the generals Vindor Mawnil and Raex Pwodill.",
   "Ultor dies, then Tarkil Adan appears at /loc 330, 309. Hail him for the key flag."
  ],
  "npcs": [
   {
    "npcId": 200007,
    "name": "Carprin Deatharn",
    "level": 70,
    "hp": 1000000
   },
   {
    "npcId": 200232,
    "name": "Carprin Deatharn",
    "level": 70,
    "hp": 160000
   },
   {
    "npcId": 200229,
    "name": "Breddan Rutyl",
    "level": 60,
    "hp": 26000
   },
   {
    "npcId": 200230,
    "name": "Fran Prisoal",
    "level": 60,
    "hp": 22500
   },
   {
    "npcId": 200222,
    "name": "Abroan Drian",
    "level": 60,
    "hp": 22000
   },
   {
    "npcId": 200225,
    "name": "Avhi Escron",
    "level": 70,
    "hp": 120000
   },
   {
    "npcId": 200228,
    "name": "Bishop Toluwon",
    "level": 70,
    "hp": 160000
   },
   {
    "npcId": 200245,
    "name": "High Priest Ultor Szanvon",
    "level": 70,
    "hp": 250000
   },
   {
    "npcId": 200261,
    "name": "Vindor Mawnil",
    "level": 70,
    "hp": 200000
   },
   {
    "npcId": 200258,
    "name": "Raex Pwodill",
    "level": 70,
    "hp": 200000
   },
   {
    "npcId": 200267,
    "name": "Tarkil Adan",
    "level": 1,
    "hp": 22600
   }
  ],
  "rewards": [],
  "cites": [
   "codecay/#_Carprin_Deatharn.lua:1-12",
   "codecay/#Fran_Prisoal.lua:1-22",
   "codecay/#Carprin_Deatharn.lua:1-35",
   "codecay/#Avhi_Escron.lua:1-44",
   "codecay/#Bishop_Toluwon.lua:1-31",
   "codecay/#High_Priest_Ultor_Szanvon.lua:1-22",
   "codecay/Tarkil_Adan.lua:50-79",
   "codecay/player.lua:1-23"
  ]
 },
 {
  "slug": "codecay-bertoxxulous",
  "zone": "codecay",
  "zoneName": "The Crypt of Decay",
  "name": "Bertoxxulous (kings + trash waves in the lower crypt)",
  "kind": "raid-boss",
  "kindWhy": "The flag boss of the Crypt of Decay. His death brings a Planar Projection that advances the Disease and Crypt flag series. You need the chapel key flag first, or the projection turns you away.",
  "groupLimit": "The projection flags only the raid, group or solo player that got credit, and only 72 players per projection.",
  "start": "Kill the Spectre of Corruption in the lower crypt. His death begins the attempt and summoners appear at five spots.",
  "timers": "There are 5 min 50 s of preparation, then 2 h 3 min to finish. You get a warning when 5 minutes are left. Trash respawns every 5 min 50 s on 32 spawn points. After a failed attempt there is a 5 minute wait. After a win, the Spectre is back in 66 hours.",
  "mechanics": [
   "After preparation, 32 trash spawn points (Knights, Priests and Necromancers of Decay, and their Elite versions) respawn on that 5 min 50 s clock.",
   "The kings come out by the number of trash kills. Darwol Adan at kill 44, Feig at 48, Xhut at 52, Kavilis at 56, Raddi at 84, Wavadozzik at 88, Zandal at 92 and Akkapan at 96.",
   "After the first eight kings, the last four corrupted Kings of Lxanvom come: Meedo, Qezzin, Pzo and Bhaly Adan. Then Bertoxxulous himself.",
   "If time runs out, the attempt fails and resets. When Bertoxxulous dies, a victory message plays and a Planar Projection appears for whoever killed him."
  ],
  "npcs": [
   {
    "npcId": 200226,
    "name": "Bertoxxulous",
    "level": 75,
    "hp": 600000
   },
   {
    "npcId": 200016,
    "name": "Spectre of Corruption",
    "level": 70,
    "hp": 230000
   },
   {
    "npcId": 200234,
    "name": "Darwol Adan",
    "level": 70,
    "hp": 160000
   },
   {
    "npcId": 200240,
    "name": "Feig Adan",
    "level": 70,
    "hp": 100000
   },
   {
    "npcId": 200265,
    "name": "Xhut Adan",
    "level": 70,
    "hp": 110000
   },
   {
    "npcId": 200246,
    "name": "Kavilis Adan",
    "level": 70,
    "hp": 130000
   },
   {
    "npcId": 200257,
    "name": "Raddi Adan",
    "level": 70,
    "hp": 200000
   },
   {
    "npcId": 200263,
    "name": "Wavadozzik Adan",
    "level": 70,
    "hp": 180000
   },
   {
    "npcId": 200266,
    "name": "Zandal Adan",
    "level": 70,
    "hp": 150000
   },
   {
    "npcId": 200223,
    "name": "Akkapan Adan",
    "level": 70,
    "hp": 160000
   },
   {
    "npcId": 200250,
    "name": "Meedo Adan",
    "level": 70,
    "hp": 200000
   },
   {
    "npcId": 200256,
    "name": "Qezzin Adan",
    "level": 70,
    "hp": 200000
   },
   {
    "npcId": 200255,
    "name": "Pzo Adan",
    "level": 70,
    "hp": 200000
   },
   {
    "npcId": 200227,
    "name": "Bhaly Adan",
    "level": 70,
    "hp": 200000
   },
   {
    "npcId": 200260,
    "name": "Summoner of Bertoxxulous",
    "level": 1,
    "hp": 75000
   }
  ],
  "rewards": [],
  "cites": [
   "codecay/encounters/Bertox.lua:1-100",
   "codecay/encounters/Bertox.lua:275-360",
   "codecay/A_Planar_Projection.lua:22-50",
   "poknowledge/Seer_Mal_Nae-Shi.lua:1-43"
  ]
 },
 {
  "slug": "codecay-paffa",
  "zone": "codecay",
  "zoneName": "The Crypt of Decay",
  "name": "Banord Paffa (puslings event)",
  "kind": "optional",
  "kindWhy": "Optional wave fight with loot on Overlord Banord Paffa. It sets no flag.",
  "start": "The first player (not a GM) to step into the room around Banord starts it. Nothing happens if it is already running.",
  "timers": "A wave of puslings comes every 3 min 54 s, the first one 3 min 54 s after the start. At the third wave Banord becomes Overlord Banord Paffa and the raid has 40 minutes to kill him. If time runs out he laughs and despawns, and Banord is back in 10 minutes. After a win, Banord's own respawn is 3 days.",
  "mechanics": [
   "Each wave is five puslings at fixed spots in the room. Each has a 25% chance to be a Corrupted Pusling; the rest are Foul Puslings.",
   "Waves keep coming every 3 min 54 s until the event ends.",
   "While the event runs, the room's normal pusling spawns are switched off.",
   "At the third wave Banord shouts and turns into Overlord Banord Paffa, level 70.",
   "Win: kill the Overlord. The puslings vanish and the normal spawns come back after 1 to 3 minutes.",
   "Fail: the Overlord and the puslings vanish and the normal spawns come back the same way."
  ],
  "npcs": [
   {
    "npcId": 200252,
    "name": "Overlord Banord Paffa",
    "level": 70,
    "hp": 120000
   },
   {
    "npcId": 200242,
    "name": "Foul Pusling",
    "level": 60,
    "hp": 22400
   },
   {
    "npcId": 200233,
    "name": "Corrupted Pusling",
    "level": 60,
    "hp": 23300
   }
  ],
  "rewards": [],
  "cites": [
   "codecay/encounters/Paffa.lua:1-133"
  ]
 },
 {
  "slug": "hohonora-trial-ryddadar",
  "zone": "hohonora",
  "zoneName": "Halls of Honor",
  "name": "Trial of Honor 1: Rydda`Dar (Trydan Faye)",
  "kind": "flag",
  "kindWhy": "Trial of Honor 1. Winning and hailing Trydan Faye gives the first of the three trial flags. All three open the Temple of Marr portals and are needed for the Mithaniel Marr flags.",
  "groupLimit": "Trydan Faye flags only the raid, group or solo player that got credit, and only 72 players per win. The script sets no cap on how many can take part.",
  "start": "Hail Trydan Faye and say 'trials', then 'ready'. A Custodian of Marr appears in his place and Trydan leaves. Killing the Custodian starts the trial and Rydda`Dar appears.",
  "timers": "The Custodian leaves after 10 seconds, and Rydda`Dar after 56 seconds, unless they are in a fight. The timer stops while they fight. After a win, the room's spawns stay off for 18 hours. After a fail or abort, Trydan Faye is back in 10 minutes.",
  "mechanics": [
   "Every 6 seconds the Custodian is checked. If it leaves the room, it is sent back, loses its hate list and casts Balance of the Nameless.",
   "When the Custodian dies, the room's normal spawns are switched off and Rydda`Dar appears, level 75 with 500,000 HP.",
   "When Rydda`Dar dies, the normal spawns stay off for 18 hours and Trydan Faye appears at /loc 2040, -1725 for the killer's raid or group. Hail him to get the first trial flag."
  ],
  "npcs": [
   {
    "npcId": 211107,
    "name": "Rydda`Dar",
    "level": 75,
    "hp": 500000
   },
   {
    "npcId": 211051,
    "name": "Trydan Faye",
    "level": 70,
    "hp": 125000
   },
   {
    "npcId": 211078,
    "name": "A Custodian of Marr",
    "level": 63,
    "hp": 125000
   },
   {
    "npcId": 211117,
    "name": "Trydan Faye",
    "level": 70,
    "hp": 125000
   }
  ],
  "rewards": [],
  "cites": [
   "hohonora/encounters/RyddaDar.lua:1-60",
   "hohonora/encounters/RyddaDar.lua:41-156",
   "hohonora/player.lua:1-19"
  ]
 },
 {
  "slug": "hohonora-trial-villagers",
  "zone": "hohonora",
  "zoneName": "Halls of Honor",
  "name": "Trial of Honor 2: Villagers (Rhaliq Trell)",
  "kind": "flag",
  "kindWhy": "Trial of Honor 2. Winning and hailing Rhaliq Trell gives the second of the three trial flags.",
  "groupLimit": "Rhaliq Trell flags only the raid, group or solo player that got credit, and only 72 players per win.",
  "start": "Hail Rhaliq Trell and say 'ready'. A Custodian of Marr appears. The trial begins when it dies.",
  "timers": "Each attacker must be fought within 72 seconds of appearing, or the trial fails. The clock stops while it fights. After a fail, Rhaliq Trell is back in 10 minutes. After a win, the room stays closed for 18 hours. The reward Rhaliq stays 10 minutes.",
  "mechanics": [
   "Seven villagers appear (barbarian, dwarf, gnome, half-elf, halfling, human and wood elf), along with twelve named attackers. The attackers are Granmuck Reiga, Fligg Starp, Trann Berk, Shott Tarbs, Ruark Barr, Zullkata Reeps, Maeryn Malladry, Thullias Rhidron, Herot Terkins, Mirezvakla Ry`Ten, Yarezka Tri`Lok and Merken Lysonn.",
   "The attackers set off on their own timers, between 4 and 26 seconds apart.",
   "Kill all twelve attackers to win. If any attacker times out, the trial fails and they all vanish.",
   "On a win Rhaliq Trell appears at /loc 1374, 456. Hail him to get the second trial flag."
  ],
  "npcs": [
   {
    "npcId": 211096,
    "name": "Maeryn Malladry",
    "level": 65,
    "hp": 60000
   },
   {
    "npcId": 211095,
    "name": "Thullias Rhidron",
    "level": 65,
    "hp": 90000
   },
   {
    "npcId": 211094,
    "name": "Herot Terkins",
    "level": 65,
    "hp": 60000
   },
   {
    "npcId": 211105,
    "name": "Granmuck Reiga",
    "level": 65,
    "hp": 60000
   }
  ],
  "rewards": [],
  "cites": [
   "hohonora/encounters/Villagers.lua:1-60",
   "hohonora/encounters/Villagers.lua:60-284"
  ]
 },
 {
  "slug": "hohonora-trial-crazed",
  "zone": "hohonora",
  "zoneName": "Halls of Honor",
  "name": "Trial of Honor 3: Crazed Norrathians (Alekson Garn)",
  "kind": "flag",
  "kindWhy": "Trial of Honor 3. Winning and hailing Alekson Garn gives the third of the three trial flags.",
  "groupLimit": "Alekson Garn flags only the raid, group or solo player that got credit, and only 72 players per win.",
  "start": "Hail Alekson Garn and say 'ready'. A Custodian of Marr appears. The trial begins when it dies.",
  "timers": "Each attacker must be fought within 50 seconds of appearing, or the trial fails. The clock stops while it fights. Alekson Garn stays 10 minutes. After a win, the room stays closed for 18 hours. Mobs that leave the trial area are checked every 6 seconds.",
  "mechanics": [
   "Miranda Climmes and Ydira Merok appear, with rooms of crazed Norrathians and of recuso vagrants, stragglers and drifters.",
   "Kill every mob in a room and that room's boss appears: Advocent Joran, Halgoz Rellinic or Freegan Haun.",
   "Kill all three bosses to win. Alekson Garn then appears at /loc -1724, -2330. Hail him to get the third trial flag."
  ],
  "npcs": [
   {
    "npcId": 211085,
    "name": "Freegan Haun",
    "level": 72,
    "hp": 200000
   },
   {
    "npcId": 211086,
    "name": "Halgoz Rellinic",
    "level": 72,
    "hp": 200000
   },
   {
    "npcId": 211084,
    "name": "Advocent Joran",
    "level": 70,
    "hp": 115000
   },
   {
    "npcId": 211074,
    "name": "a crazed norrathian",
    "level": 63,
    "hp": 25000
   },
   {
    "npcId": 211118,
    "name": "a crazed norrathian",
    "level": 62,
    "hp": 25000
   }
  ],
  "rewards": [],
  "cites": [
   "hohonora/encounters/Crazed.lua:1-120",
   "hohonora/encounters/Crazed.lua:165-363"
  ]
 },
 {
  "slug": "hohonorb-mithaniel-marr",
  "zone": "hohonorb",
  "zoneName": "Temple of Marr",
  "name": "Lord Mithaniel Marr (with Edium, Halon, Ralthazor)",
  "kind": "raid-boss",
  "kindWhy": "The flag boss of the Temple of Marr. His death brings a Planar Projection that gives the Mithaniel Marr flag, which the road to Zebuxoruk needs. You need all three trial flags to get it.",
  "groupLimit": "The projection flags only the raid, group or solo player that got credit, and up to 144 players.",
  "start": "Kill the three guardians, Edium, Halon of Marr and Ralthazor, Champion of Marr. Lord Mithaniel Marr cannot be targeted until all three are dead.",
  "timers": "The game checks the guardians 3 seconds after each one dies. During the fight it checks every 5 seconds that Mithaniel has not been pulled out of the room. The projection stays for 20 minutes.",
  "mechanics": [
   "Lord Mithaniel Marr is level 77 with 1,200,000 HP.",
   "A mob pulled out of the room is sent back, loses its hate list and casts Balance of the Nameless.",
   "When Mithaniel appears, the three guardians' spawn points are reset.",
   "When he dies, a Planar Projection appears. With all three trials done, hailing it gives the Mithaniel Marr flag, plus the Marr book flag if you have not yet been to Zebuxoruk. Otherwise you get the checklist flags."
  ],
  "npcs": [
   {
    "npcId": 220020,
    "name": "Lord Mithaniel Marr",
    "level": 77,
    "hp": 1200000
   },
   {
    "npcId": 220021,
    "name": "Edium, Guardian of Marr",
    "level": 75,
    "hp": 200000
   },
   {
    "npcId": 220022,
    "name": "Halon of Marr",
    "level": 75,
    "hp": 200000
   },
   {
    "npcId": 220012,
    "name": "Ralthazor, Champion of Marr",
    "level": 75,
    "hp": 275000
   }
  ],
  "rewards": [],
  "cites": [
   "hohonorb/Lord_Mithaniel_Marr.lua:1-60",
   "hohonorb/Edium,_Guardian_of_Marr.lua:1-6",
   "hohonorb/Halon_of_Marr.lua:1-6",
   "hohonorb/Ralthazor,_Champion_of_Marr.lua:1-6",
   "hohonorb/A_Planar_Projection.lua:1-60",
   "hohonora/player.lua:1-19"
  ]
 },
 {
  "slug": "poair-xegony",
  "zone": "poair",
  "zoneName": "Plane of Air",
  "name": "Xegony, the Queen of Air (rainbow room)",
  "kind": "raid-boss",
  "kindWhy": "The flag boss of the Plane of Air. Her death brings the Essence of Air, which gives you an Amorphous Cloud of Air, a step toward the Plane of Time.",
  "groupLimit": "The Essence of Air gives out 72 items, then leaves.",
  "start": "Click Xegony's rainbow door while carrying the Wind Etched Key on your cursor or key ring. One holder covers the raid or group for 5 minutes. Then pull Xegony, the Queen of Air.",
  "timers": "Her health is checked every 6 seconds. Waves come at 99%, 85%, 70%, 55%, 40% and 25%. The Essence of Air stays for 20 minutes.",
  "mechanics": [
   "At each health mark, one named wave you have not met yet (picked at random of six) appears and runs to Xegony. The six are Nuquernal Belegrodian with a Djinni Air Defender, Wesreh Galleantan with a Servant of Air, Rindaler Egulrtan with a Knight of Air, an Elemental Arbitor with an Air Infused Defender, Weruis Herfadban with an Air Phoenix Scout, and Huridaf Vorgaasna with a Deadly Cloudwalker.",
   "The ordinary defender of that wave in the room joins in as well.",
   "If you stop fighting after more than 2 minutes, Xegony goes back to her spot and all the adds come back.",
   "The room's other mobs are the prismatic guardians, the High Councilman of the Queen and Muzlakh the Chosen.",
   "Hail the Essence of Air after she dies to be given an Amorphous Cloud of Air, if you have neither it nor a Quintessence of Elements."
  ],
  "npcs": [
   {
    "npcId": 215056,
    "name": "Xegony the Queen of Air",
    "level": 80,
    "hp": 1500000
   },
   {
    "npcId": 215053,
    "name": "Muzlakh the Chosen",
    "level": 73,
    "hp": 1100000
   },
   {
    "npcId": 215404,
    "name": "Nuquernal Belegrodian",
    "level": 65,
    "hp": 75000
   },
   {
    "npcId": 215403,
    "name": "Wesreh Galleantan",
    "level": 65,
    "hp": 75000
   },
   {
    "npcId": 215408,
    "name": "Rindaler Egulrtan",
    "level": 65,
    "hp": 75000
   },
   {
    "npcId": 215406,
    "name": "An Elemental Arbitor",
    "level": 65,
    "hp": 75400
   },
   {
    "npcId": 215407,
    "name": "Weruis Herfadban",
    "level": 65,
    "hp": 75000
   },
   {
    "npcId": 215405,
    "name": "Huridaf Vorgaasna",
    "level": 65,
    "hp": 178000
   },
   {
    "npcId": 215004,
    "name": "A Prismatic Guardian of Xegony",
    "level": 69,
    "hp": 365000
   },
   {
    "npcId": 215005,
    "name": "High Councilman of the Queen",
    "level": 69,
    "hp": 183000
   }
  ],
  "rewards": [
   {
    "itemId": 29164,
    "name": "Amorphous Cloud of Air",
    "trigger": "Hail the Essence of Air after Xegony dies, if you have neither the Cloud nor a Quintessence of Elements"
   }
  ],
  "cites": [
   "poair/encounters/Xegony.lua:1-142",
   "poair/Essence_of_Air.lua:1-45",
   "poair/player.lua:88-110"
  ]
 },
 {
  "slug": "poair-castellan",
  "zone": "poair",
  "zoneName": "Plane of Air",
  "name": "Castellan event (Constables -> Chamberlain Escalardian)",
  "kind": "optional",
  "kindWhy": "Side event on the castellan island, with loot and no flag.",
  "start": "Nothing to start: kill the castellans of air on the island. Kills 5, 10 and 15 each bring one of three constables, in random order. In the shared copy of the zone this only runs while the server's raid window is open.",
  "timers": "The castellans come back after 18 minutes if one is still alive, otherwise after 3 hours.",
  "mechanics": [
   "Kill 5, 10 and 15 bring Constable Alranderisan at /loc 463, 403, Constable Belecohen at /loc 456, 518 and Constable Ferabalen at /loc 498, 461. Which one comes first is random.",
   "When all three constables are dead, Chamberlain Escalardian appears at /loc 412, 457. A Chamberlain's Apprentice can stand in for him."
  ],
  "npcs": [
   {
    "npcId": 215411,
    "name": "Chamberlain Escalardian",
    "level": 70,
    "hp": 300000
   },
   {
    "npcId": 215410,
    "name": "A Chamberlain`s Apprentice",
    "level": 63,
    "hp": 41600
   },
   {
    "npcId": 215383,
    "name": "Constable Alranderisan",
    "level": 66,
    "hp": 71800
   },
   {
    "npcId": 215384,
    "name": "Constable Belecohen",
    "level": 66,
    "hp": 79400
   },
   {
    "npcId": 215385,
    "name": "Constable Ferabalen",
    "level": 66,
    "hp": 77400
   }
  ],
  "rewards": [],
  "cites": [
   "poair/POACastellanController.lua:1-126",
   "poair/#Constable_Alranderisan.lua:1-12",
   "poair/#Chamberlain_Escalardian.lua:1-10"
  ]
 },
 {
  "slug": "poair-named-optional",
  "zone": "poair",
  "zoneName": "Plane of Air",
  "name": "Named air mobs: Queen Silandria, Baltaldor, Gakamenial, Rinturion, Arch Mage Alchtonion, Inlokher",
  "kind": "optional",
  "kindWhy": "Named mobs on the Plane of Air with loot and no flag. Their scripts only drop the tank's hate and let them warp home and heal.",
  "start": "Nothing to start: pull them.",
  "timers": "About once a minute during the fight, the mob drops its target's hate to almost nothing.",
  "mechanics": [
   "When the fight ends, a boss below half health always warps back to its post and heals 30% of its health. Above half health the chance is 100 minus its health percent.",
   "The mobs are Queen Silandria, Baltaldor the Cursed, Gakamenial Fir`Disralsi, Rinturion Windblade, Arch Mage Alchtonion and Inlokher."
  ],
  "npcs": [
   {
    "npcId": 215003,
    "name": "Queen Silandria",
    "level": 68,
    "hp": 280000
   },
   {
    "npcId": 215054,
    "name": "Baltaldor the Cursed",
    "level": 67,
    "hp": 265000
   },
   {
    "npcId": 215024,
    "name": "Gakamenial Fir`Disralsi",
    "level": 67,
    "hp": 265000
   },
   {
    "npcId": 215034,
    "name": "Rinturion Windblade",
    "level": 70,
    "hp": 306000
   },
   {
    "npcId": 215011,
    "name": "Arch Mage Alchtonion",
    "level": 65,
    "hp": 175000
   },
   {
    "npcId": 215409,
    "name": "Inlokher the Warlord",
    "level": 66,
    "hp": 120000
   }
  ],
  "rewards": [],
  "cites": [
   "poair/#Queen_Silandria.lua:1-30",
   "poair/#Baltaldor_the_Cursed.lua:1-30",
   "poair/#Gakamenial_Fir`Disralsi.lua:1-30",
   "poair/#Rinturion_Windblade.lua:1-30",
   "poair/Arch_Mage_Alchtonion.lua:1-30"
  ]
 },
 {
  "slug": "poair-ring-wind",
  "zone": "poair",
  "zoneName": "Plane of Air",
  "name": "Plane of Air ring: Wind (Stormriders -> Pherlondien Clawpike -> Avatar of Wind)",
  "kind": "flag",
  "kindWhy": "One of four ring events on the Plane of Air. Each ends with an Avatar that drops a Mystical Essence, a part of the Wind Etched Key for Xegony's door. How the key is made is not in the scripts.",
  "groupLimit": "No cap in the script. In the shared copy of the zone the ring only starts while the server's raid window is open. Guild instances have no such limit.",
  "start": "Kill every native stormrider on the island: Stormrider Lightningclaws, Mischievous Stormriders and Fearsome Stormriders, 27 spawn points in all. When the last one is dead, the event begins.",
  "timers": "After a win the island is back in 66 hours. The attempt lasts 3 hours. After a failed or reset attempt the island is back in 18 minutes. The Avatar leaves after 2 hours 30 minutes out of combat. Guild instances retry after 15 minutes.",
  "mechanics": [
   "Eight Menacing Stormriders appear and wake at 1, 1, 2, 2, 3, 3, 4 and 4 minutes. The Stormrider Priest of Destruction appears at /loc -677, -259.",
   "When the Priest dies, the riders vanish and four traps are placed at random in the area. Stepping into combat with a trap brings a Sporadic Stormrider.",
   "When the Sporadic Stormriders are dead, one real Pherlondien Clawpike appears among fake bosses. If something is missing, a Loathesome Stormclaw appears instead.",
   "When the boss dies, the Avatar of Wind appears at /loc 484, -1591 and drops the Mystical Essence of Wind every time."
  ],
  "npcs": [
   {
    "npcId": 215391,
    "name": "Avatar of Wind",
    "level": 75,
    "hp": 750000
   },
   {
    "npcId": 215390,
    "name": "Pherlondien Clawpike",
    "level": 68,
    "hp": 550000
   },
   {
    "npcId": 215387,
    "name": "Stormrider Priest of Destruction",
    "level": 66,
    "hp": 157000
   },
   {
    "npcId": 215388,
    "name": "A Sporadic Stormrider",
    "level": 66,
    "hp": 78000
   },
   {
    "npcId": 215386,
    "name": "A Menacing Stormrider",
    "level": 64,
    "hp": 42000,
    "kills": 8,
    "killsNote": "eight spawn"
   }
  ],
  "rewards": [],
  "cites": [
   "poair/encounters/Wind.lua:1-40",
   "poair/encounters/Wind.lua:98-214",
   "poair/encounters/Wind.lua:215-250",
   "poair/encounters/Wind.lua:300-318",
   "lua_modules/air_ring_recovery.lua:1-30"
  ]
 },
 {
  "slug": "poair-ring-smoke",
  "zone": "poair",
  "zoneName": "Plane of Air",
  "name": "Plane of Air ring: Smoke (Elemental Champions -> Masterpiece -> Avatar of Smoke)",
  "kind": "flag",
  "kindWhy": "One of four ring events on the Plane of Air. Each ends with an Avatar that drops a Mystical Essence, a part of the Wind Etched Key for Xegony's door. How the key is made is not in the scripts.",
  "groupLimit": "No cap in the script. In the shared copy of the zone the ring only starts while the server's raid window is open. Guild instances have no such limit.",
  "start": "Kill the 21 island elementals, Confused Air Elementals and Swirling Elemental Forces. Each kill counts toward the event.",
  "timers": "After a win the island is back in 66 hours. The attempt lasts 3 hours. After a failed or reset attempt the island is back in 18 minutes. The Avatar leaves after 2 hours 30 minutes out of combat. Guild instances retry after 15 minutes.",
  "mechanics": [
   "Kills 5, 10, 15 and 21 each bring an Elemental Champion, at /loc -1274, -491, /loc -1208, -434, /loc -1283, -395 and /loc -1341, -452. At kill 21 all the champions can be attacked.",
   "When all the champions are dead, the Elemental Masterpiece appears at /loc -1284, -445. An Elemental Anomaly can stand in for it.",
   "When the Masterpiece dies, the Avatar of Smoke appears at /loc -680, 1396 and drops the Mystical Essence of Smoke every time."
  ],
  "npcs": [
   {
    "npcId": 215392,
    "name": "Avatar of Smoke",
    "level": 75,
    "hp": 750000
   },
   {
    "npcId": 215396,
    "name": "An Elemental Masterpiece",
    "level": 72,
    "hp": 550000
   },
   {
    "npcId": 215395,
    "name": "An Elemental Champion",
    "level": 67,
    "hp": 100000
   },
   {
    "npcId": 215447,
    "name": "An Elemental Champion",
    "level": 67,
    "hp": 125000
   },
   {
    "npcId": 215448,
    "name": "An Elemental Champion",
    "level": 67,
    "hp": 250000
   },
   {
    "npcId": 215449,
    "name": "An Elemental Champion",
    "level": 67,
    "hp": 100000
   }
  ],
  "rewards": [],
  "cites": [
   "poair/encounters/Smoke.lua:1-40",
   "poair/encounters/Smoke.lua:100-160",
   "poair/encounters/Smoke.lua:185-200",
   "poair/encounters/Smoke.lua:260-271"
  ]
 },
 {
  "slug": "poair-ring-mist",
  "zone": "poair",
  "zoneName": "Plane of Air",
  "name": "Plane of Air ring: Mist (Phoenixes -> Melernil Faal`Armanna -> Avatar of Mist)",
  "kind": "flag",
  "kindWhy": "One of four ring events on the Plane of Air. Each ends with an Avatar that drops a Mystical Essence, a part of the Wind Etched Key for Xegony's door. How the key is made is not in the scripts.",
  "groupLimit": "No cap in the script. In the shared copy of the zone the ring only starts while the server's raid window is open. Guild instances have no such limit.",
  "start": "Kill the island phoenixes: Wind Phoenixes, Servitors of Xegony, Phoenix Breezewings, Phoenix Searedwings and Calebgrothiel. When the island is clear, the event begins.",
  "timers": "After a win the island is back in 66 hours. The attempt lasts 3 hours. After a failed or reset attempt the island is back in 18 minutes. The Avatar leaves after 2 hours 30 minutes out of combat. Guild instances retry after 15 minutes.",
  "mechanics": [
   "Stage 1: four Phoenix Firesurgers appear. When all are dead, stage 2 brings four Phoenix Windsurgers.",
   "When the Windsurgers are dead, Melernil Faal`Armanna appears at /loc -718, 326. A Firewing Imitor can stand in for her.",
   "Killing a wizard Wind Phoenix brings two Ardent Phoenixes of Xegony.",
   "When the boss dies, the Avatar of Mist appears at /loc -570, -1573 and drops the Mystical Essence of Mist every time."
  ],
  "npcs": [
   {
    "npcId": 215393,
    "name": "Avatar of Mist",
    "level": 75,
    "hp": 750000
   },
   {
    "npcId": 215399,
    "name": "Melernil Faal`Armanna",
    "level": 73,
    "hp": 550000
   },
   {
    "npcId": 215397,
    "name": "A Phoenix Firesurger",
    "level": 65,
    "hp": 75300,
    "kills": 4,
    "killsNote": "four spawn"
   },
   {
    "npcId": 215398,
    "name": "A Phoenix Windsurger",
    "level": 68,
    "hp": 89300,
    "kills": 4,
    "killsNote": "four spawn"
   },
   {
    "npcId": 215324,
    "name": "Calebgrothiel",
    "level": 68,
    "hp": 135000
   }
  ],
  "rewards": [],
  "cites": [
   "poair/encounters/Mist.lua:1-35",
   "poair/encounters/Mist.lua:98-165",
   "poair/encounters/Mist.lua:235-243"
  ]
 },
 {
  "slug": "poair-ring-dust",
  "zone": "poair",
  "zoneName": "Plane of Air",
  "name": "Plane of Air ring: Dust (Vorladien spiders / Sigismond Windwalker -> Avatar of Dust)",
  "kind": "flag",
  "kindWhy": "One of four ring events on the Plane of Air. Each ends with an Avatar that drops a Mystical Essence, a part of the Wind Etched Key for Xegony's door. How the key is made is not in the scripts.",
  "groupLimit": "No cap in the script. In the shared copy of the zone the ring only starts while the server's raid window is open. Guild instances have no such limit.",
  "start": "Kill the 35 island spiders and windwalkers: Crystalline Windwalkers, Pristine Recluses, Vorladien Webspinners and Lossenmachar. When the island is clear, the event begins.",
  "timers": "After a win the island is back in 66 hours. The attempt lasts 3 hours, and stage 2 has its own 1 hour limit. After a failed or reset attempt the island is back in 18 minutes. The Avatar leaves after 2 hours 30 minutes out of combat. Guild instances retry after 15 minutes.",
  "mechanics": [
   "Sigismond Windwalker grows bigger as the island is cleared: every 3 kills, and the most at the last.",
   "Stage 2 has three waves of Vorladien Archwalkers with Vorladien Spawn adds, and Erratic Arachnid spawn points switched on.",
   "After the third wave Sigismond can be attacked. An Ominous Recluse can stand in for him at /loc 889, -400.",
   "When the boss dies, the Avatar of Dust appears at /loc 527, 1671 and drops the Mystical Essence of Dust every time."
  ],
  "npcs": [
   {
    "npcId": 215394,
    "name": "Avatar of Dust",
    "level": 75,
    "hp": 750000
   },
   {
    "npcId": 215375,
    "name": "Sigismond Windwalker",
    "level": 74,
    "hp": 600000
   },
   {
    "npcId": 215400,
    "name": "A Vorladien Archwalker",
    "level": 69,
    "hp": 183000
   },
   {
    "npcId": 215401,
    "name": "A Vorladien Spawn",
    "level": 68,
    "hp": 105000
   },
   {
    "npcId": 215060,
    "name": "Lossenmachar",
    "level": 69,
    "hp": 150000
   }
  ],
  "rewards": [],
  "cites": [
   "poair/encounters/Dust.lua:1-40",
   "poair/encounters/Dust.lua:145-215",
   "poair/encounters/Dust.lua:255-270"
  ]
 },
 {
  "slug": "podisease-grummus",
  "zone": "podisease",
  "zoneName": "Plane of Disease",
  "name": "Grummus (Planar Projection grants grummus / fuirstel=2)",
  "kind": "raid-boss",
  "kindWhy": "The flag boss of the Plane of Disease. His death brings a Planar Projection that moves the Disease and Crypt flag series on and gives the Grummus flag, which opens the Crypt of Decay.",
  "groupLimit": "The projection flags the killer's raid, group or solo player, up to 144 players.",
  "start": "Pull Grummus.",
  "timers": "The projection stays for 20 minutes.",
  "mechanics": [
   "When Grummus dies, a Planar Projection appears on his corpse for the killer's raid or group.",
   "Hail the projection. If you are on step 1 of the Disease and Crypt flag series, you move to step 2. Any hail without the Grummus flag gives you the Grummus flag.",
   "If you have neither the series flag nor the checklist flag for Grummus, you get the checklist flag."
  ],
  "npcs": [
   {
    "npcId": 205091,
    "name": "Grummus",
    "level": 70,
    "hp": 500000
   }
  ],
  "rewards": [],
  "cites": [
   "podisease/#Grummus.lua:1-7",
   "podisease/A_Planar_Projection.lua:1-60",
   "podisease/player.lua:1-4"
  ]
 },
 {
  "slug": "podisease-aramin",
  "zone": "podisease",
  "zoneName": "Plane of Disease",
  "name": "Aramin the Spider Guardian (arachnae spawns)",
  "kind": "optional",
  "kindWhy": "Optional fight that sets no flag. His death brings 7 or 8 arachnae, and he has gear drops.",
  "start": "Pull Aramin the Spider Guardian.",
  "timers": "The arachnae's own timers are not covered here.",
  "mechanics": [
   "When Aramin dies, 3 or 4 Arachnae Serioun and 3 or 4 Arachnae Maleveler appear (7 or 8 in all) at fixed spots near him."
  ],
  "npcs": [
   {
    "npcId": 205095,
    "name": "Aramin the Spider Guardian",
    "level": 68,
    "hp": 225000
   },
   {
    "npcId": 205157,
    "name": "An Arachnae Maleveler",
    "level": 60,
    "hp": 12000
   },
   {
    "npcId": 205158,
    "name": "An Arachnae Serioun",
    "level": 55,
    "hp": 14220
   }
  ],
  "rewards": [],
  "cites": [
   "podisease/#Aramin_the_Spider_Guardian.lua:1-39"
  ]
 },
 {
  "slug": "podisease-rallius-rattican",
  "zone": "podisease",
  "zoneName": "Plane of Disease",
  "name": "Rallius Rattican (ratboss wave event)",
  "kind": "optional",
  "kindWhy": "Optional wave fight with loot (Rattican's Head, always) and no flag.",
  "start": "Engage Rallius Rattican. The first fight begins the event.",
  "timers": "Two cronies appear right away, then every 4 min 50 s. Bubonian youths come every 6 minutes, the first after 2 min 30 s. The event resets after 20 minutes (the clock stops while you fight). Leftover adds leave after 5 minutes.",
  "mechanics": [
   "On the first fight, two gargantuan arachnae appear at /loc -3384, 96 and /loc -3482, -539.",
   "Every cycle, two Bubonian cronies appear at the boss's lair.",
   "Every 6 minutes, 3 to 6 Bubonian youths appear and walk along a set path.",
   "When the boss dies or the time runs out, the spiders vanish and the event resets."
  ],
  "npcs": [
   {
    "npcId": 205134,
    "name": "Rallius Rattican",
    "level": 61,
    "hp": 25000
   },
   {
    "npcId": 205159,
    "name": "A gargantuan arachnae",
    "level": 65,
    "hp": 14220
   },
   {
    "npcId": 205160,
    "name": "a bubonian cronie",
    "level": 53,
    "hp": 14700
   },
   {
    "npcId": 205161,
    "name": "A bubonian youth",
    "level": 50,
    "hp": 11400
   }
  ],
  "rewards": [],
  "cites": [
   "podisease/encounters/Ratboss.lua:1-90"
  ]
 },
 {
  "slug": "podisease-gryme-crypt-guardian",
  "zone": "podisease",
  "zoneName": "Plane of Disease",
  "name": "Gryme the Crypt Guardian",
  "kind": "optional",
  "kindWhy": "Always drops the Grymes Crypt Key. No script in the quest files uses that key, so what it opens is unknown. There is no script for Gryme.",
  "start": "Nothing to start: pull Gryme the Crypt Guardian.",
  "timers": "Unknown.",
  "mechanics": [
   "No script covers Gryme. His drops come from the loot table only."
  ],
  "npcs": [
   {
    "npcId": 205096,
    "name": "Gryme the Crypt Guardian",
    "level": 66,
    "hp": 100000
   }
  ],
  "rewards": [],
  "cites": []
 },
 {
  "slug": "poeartha-ring-dust",
  "zone": "poeartha",
  "zoneName": "Plane of Earth (Rathe Temple, A)",
  "name": "Dust Ring (dusty warder -> devotees -> Triumvirate of Soil -> Perfected Warder)",
  "kind": "flag",
  "kindWhy": "Ring 4 of 4. When all four rings are done within 24 hours, the Mystical Arbitor of Earth appears, and his projection gives the key into the Plane of Earth B.",
  "groupLimit": "No cap in the script.",
  "start": "Kill the dusty warder. The temple wakes.",
  "timers": "After a fail the ring is back in 15 minutes. After a win it is back in 66 hours. The attempt is timed out by a hidden despawn timer.",
  "mechanics": [
   "When the warder dies, three streams of dust devotees rise. Kill 37 of them.",
   "Then the Triumvirate of Soil advances. When all three fall, the final defender appears: the Perfected Warder of Earth, with a Protector and a Follower.",
   "A win counts the Dust ring toward the Arbitor. A fail resets the ring for 15 minutes."
  ],
  "npcs": [
   {
    "npcId": 218413,
    "name": "A Perfected Warder of Earth",
    "level": 73,
    "hp": 600000
   },
   {
    "npcId": 218414,
    "name": "A Triumvirate Protector",
    "level": 64,
    "hp": 33500
   },
   {
    "npcId": 218415,
    "name": "A Dust Follower",
    "level": 73,
    "hp": 600000
   },
   {
    "npcId": 218367,
    "name": "Triumvirate of Soil",
    "level": 71,
    "hp": 85000
   },
   {
    "npcId": 218421,
    "name": "Triumvirate of Soil",
    "level": 71,
    "hp": 48300
   },
   {
    "npcId": 218022,
    "name": "a dusty warder",
    "level": 70,
    "hp": 46400
   }
  ],
  "rewards": [],
  "cites": [
   "poeartha/encounters/DustRing.lua:1-30",
   "poeartha/encounters/DustRing.lua:110-200",
   "poeartha/encounters/DustRing.lua:355-376",
   "poeartha/arbitor_guy.lua:93-101"
  ]
 },
 {
  "slug": "poeartha-ring-mud",
  "zone": "poeartha",
  "zoneName": "Plane of Earth (Rathe Temple, A)",
  "name": "Mud Ring (blue/red mudwalkers -> Sludge Lurker -> mudlings)",
  "kind": "flag",
  "kindWhy": "Ring 2 of 4 toward the Mystical Arbitor of Earth. See the Dust Ring.",
  "groupLimit": "No cap in the script.",
  "start": "Kill the blue mudwalkers in the mire. The red mudwalkers follow.",
  "timers": "After a fail the ring is back in 15 minutes. After a win it is back in 66 hours. The ring waits up to 30 seconds for the little golem runners.",
  "mechanics": [
   "When red mudwalkers die, they release little golem runners that run to the temple.",
   "The last mudwalker bursts and a Sludge Lurker heaves free. Later defenders are Muck Mudlets, Mud-dite Mudlings, Filth Gorgers, a Monsterous Mudwalker and a Merciless Mudslinger.",
   "A win counts the Mud ring toward the Arbitor."
  ],
  "npcs": [
   {
    "npcId": 218357,
    "name": "A Sludge Lurker",
    "level": 72,
    "hp": 200000
   },
   {
    "npcId": 218360,
    "name": "A Monsterous Mudwalker",
    "level": 73,
    "hp": 600000
   },
   {
    "npcId": 218365,
    "name": "A Merciless Mudslinger",
    "level": 73,
    "hp": 600000
   },
   {
    "npcId": 218359,
    "name": "A Filth Gorger",
    "level": 70,
    "hp": 80000
   },
   {
    "npcId": 218358,
    "name": "A Muck Mudlet",
    "level": 55,
    "hp": 19000
   },
   {
    "npcId": 218361,
    "name": "A Muddite Mudling",
    "level": 55,
    "hp": 19000
   }
  ],
  "rewards": [],
  "cites": [
   "poeartha/encounters/MudRing.lua:1-62",
   "poeartha/encounters/MudRing.lua:166-260",
   "poeartha/encounters/MudRing.lua:582"
  ]
 },
 {
  "slug": "poeartha-ring-stone",
  "zone": "poeartha",
  "zoneName": "Plane of Earth (Rathe Temple, A)",
  "name": "Stone Ring (rock creations -> fortifications -> Rock Monstrosity / Peregrin Rockskull)",
  "kind": "flag",
  "kindWhy": "Ring 1 of 4 toward the Mystical Arbitor of Earth. See the Dust Ring.",
  "groupLimit": "No cap in the script.",
  "start": "Kill the trigger mobs: Rock Creation, Crumbling Stone Mass, Pile of Boulders or Boulder Thrower.",
  "timers": "You have 98 minutes from the start, then the event fails. After a fail the ring is back in 15 minutes. After a win it is back in 66 hours.",
  "mechanics": [
   "Waves of Fortifications and Mounds of Rubble come first.",
   "Then a Rock Monstrosity (800,000 HP) comes with stone heaps.",
   "Last is Peregrin Rockskull with an Encrusted Dirt Cloud.",
   "A win counts the Stone ring toward the Arbitor."
  ],
  "npcs": [
   {
    "npcId": 218374,
    "name": "Peregrin Rockskull",
    "level": 73,
    "hp": 600000
   },
   {
    "npcId": 218371,
    "name": "A Rock Monstrosity",
    "level": 71,
    "hp": 800000
   },
   {
    "npcId": 218373,
    "name": "An Encrusted Dirt Cloud",
    "level": 73,
    "hp": 600000
   },
   {
    "npcId": 218370,
    "name": "A Mound of Rubble",
    "level": 70,
    "hp": 105000
   },
   {
    "npcId": 218369,
    "name": "A Stone Fortification",
    "level": 59,
    "hp": 25000
   },
   {
    "npcId": 218372,
    "name": "A Stone Heap",
    "level": 64,
    "hp": 33500
   }
  ],
  "rewards": [],
  "cites": [
   "poeartha/encounters/StoneRing.lua:1-30",
   "poeartha/encounters/StoneRing.lua:149-260",
   "poeartha/encounters/StoneRing.lua:354-376"
  ]
 },
 {
  "slug": "poeartha-ring-vine",
  "zone": "poeartha",
  "zoneName": "Plane of Earth (Rathe Temple, A)",
  "name": "Vine Ring (tainted rock beasts -> bloodthirsty creatures -> Derugoak Bloodwalker)",
  "kind": "flag",
  "kindWhy": "Ring 3 of 4 toward the Mystical Arbitor of Earth. See the Dust Ring.",
  "groupLimit": "No cap in the script.",
  "start": "Kill the tainted rock beasts.",
  "timers": "Boss adds come every minute during the fight. Adds leave after 10 minutes, and the cleanup after a win also takes 10 minutes. After a fail the ring is back in 15 minutes. After a win it is back in 66 hours.",
  "mechanics": [
   "When the last tainted rock beast falls, the vines raise the bloodthirsty creatures.",
   "When the last bloodthirsty creature falls, Derugoak Bloodwalker emerges (a fake boss, a Bloodsoaked Vegerog, is also in play). Mangled adds appear every minute while he fights.",
   "A win counts the Vine ring toward the Arbitor."
  ],
  "npcs": [
   {
    "npcId": 218363,
    "name": "Derugoak Bloodwalker",
    "level": 73,
    "hp": 600000
   },
   {
    "npcId": 218364,
    "name": "A Bloodsoaked Vegerog",
    "level": 73,
    "hp": 600000
   },
   {
    "npcId": 218362,
    "name": "A Bloodthirsty Vegerog",
    "level": 70,
    "hp": 80000
   },
   {
    "npcId": 218019,
    "name": "A Tainted Rock Beast",
    "level": 66,
    "hp": 37500
   }
  ],
  "rewards": [],
  "cites": [
   "poeartha/encounters/VineRing.lua:1-40",
   "poeartha/encounters/VineRing.lua:82-230",
   "poeartha/encounters/VineRing.lua:229-250"
  ]
 },
 {
  "slug": "poeartha-mystical-arbitor",
  "zone": "poeartha",
  "zoneName": "Plane of Earth (Rathe Temple, A)",
  "name": "Mystical Arbitor of Earth (after all four rings)",
  "kind": "raid-boss",
  "kindWhy": "The flag boss of the Plane of Earth A. His death brings a Planar Projection that gives the key into the Plane of Earth B.",
  "groupLimit": "The projection flags only the raid, group or solo player that got credit, and only 72 players per projection.",
  "start": "Finish all four rings (Stone, Mud, Vine, Dust), each within the last 24 hours. The Mystical Arbitor of Earth then appears at /loc -2739, 1530, retrying every 30 seconds if it fails.",
  "timers": "The Arbitor stays for 50 minutes. Ring progress is kept for 24 hours for the guild.",
  "mechanics": [
   "About once every 20 seconds he drops his target's hate to almost nothing.",
   "When the fight ends he may warp home and heal 30%, and always does below half health.",
   "When he dies, a Planar Projection appears. Hail it to get the key flag."
  ],
  "npcs": [
   {
    "npcId": 218375,
    "name": "A Mystical Arbitor of Earth",
    "level": 74,
    "hp": 600000
   }
  ],
  "rewards": [],
  "cites": [
   "poeartha/arbitor_guy.lua:1-110",
   "poeartha/A_Mystical_Arbitor_of_Earth.lua:1-50",
   "poeartha/A_Planar_Projection.lua:1-52",
   "poeartha/player.lua:1-12"
  ]
 },
 {
  "slug": "poeartha-tantisala",
  "zone": "poeartha",
  "zoneName": "Plane of Earth (Rathe Temple, A)",
  "name": "Tantisala Jaggedtooth and traps",
  "kind": "optional",
  "kindWhy": "A named mob with only a hate-drop script. The traps in the zone are a hazard, not an event.",
  "start": "Nothing to start: pull Tantisala Jaggedtooth.",
  "timers": "Trap mobs leave after 20 minutes. Her hate-drop check runs every second.",
  "mechanics": [
   "Tantisala Jaggedtooth now and then drops her target's hate. Nothing else is scripted for her."
  ],
  "npcs": [
   {
    "npcId": 218038,
    "name": "Tantisala Jaggedtooth",
    "level": 73,
    "hp": 600000
   }
  ],
  "rewards": [],
  "cites": [
   "poeartha/Tantisala_Jaggedtooth.lua:1-35",
   "poeartha/encounters/Traps.lua:1-85"
  ]
 },
 {
  "slug": "poearthb-rathe-council-avatar",
  "zone": "poearthb",
  "zoneName": "Plane of Earth (B)",
  "name": "Rathe Council (12) -> Avatar of Earth",
  "kind": "raid-boss",
  "kindWhy": "The flag boss of the Plane of Earth B. The Avatar's death brings the Essence of Earth, which gives a Mound of Living Stone, one of four parts of the Quintessence of Elements (a step toward the Plane of Time).",
  "groupLimit": "The Essence of Earth flags up to 72 players.",
  "start": "Kill all twelve Rathe Councilmen at their spawn points. Six can be mesmerized and six cannot. The fight itself is in the Councilman's own script. The event script only tracks deaths and recovery.",
  "timers": "The Council respawns after 7 minutes. The Avatar can wait 35 minutes, paused during combat and never refilled. After a fail there is a 15 minute wait. After a win, the Council is held for 138 hours. The Council teleports every minute, and the unmezzable ones are checked every 3 seconds.",
  "mechanics": [
   "When all twelve Council deaths are confirmed, the Avatar of Earth appears at /loc 410, 2050. He is level 80 with 500,000 HP.",
   "If the Avatar's 35 minutes of waiting run out, the attempt fails and retries after 15 minutes.",
   "When the Avatar dies, the Essence of Earth appears for the killer. Hail it to be given a Mound of Living Stone, if you have neither it nor a Quintessence of Elements."
  ],
  "npcs": [
   {
    "npcId": 222040,
    "name": "Avatar of Earth",
    "level": 80,
    "hp": 500000
   },
   {
    "npcId": 222003,
    "name": "A Rathe Councilman",
    "level": 68,
    "hp": 300000
   },
   {
    "npcId": 222039,
    "name": "A Rathe Councilman",
    "level": 68,
    "hp": 300000
   }
  ],
  "rewards": [
   {
    "itemId": 29146,
    "name": "Mound of Living Stone",
    "trigger": "Hail the Essence of Earth after the Avatar dies, if you have neither the Mound nor a Quintessence of Elements"
   }
  ],
  "cites": [
   "poearthb/encounters/RatheCouncil.lua:1-24",
   "poearthb/encounters/RatheCouncil.lua:150-200",
   "poearthb/encounters/RatheCouncil.lua:324-326",
   "poearthb/Essence_of_Earth.lua:28-45",
   "poearthb/#Avatar_of_Earth.lua:1-2"
  ]
 },
 {
  "slug": "poearthb-war-chieftains",
  "zone": "poearthb",
  "zoneName": "Plane of Earth (B)",
  "name": "War Chieftains (Birak, Galronar, Awisano) -> Warlord Gintolaken",
  "kind": "optional",
  "kindWhy": "Optional chain: three war chieftains unlock Warlord Gintolaken. It has loot and no character flag. The wall doors open only when the guards on them are dead, which is zone access.",
  "start": "Kill the three war chieftains: Birak, Galronar and Awisano. Hidden kill markers let Gintolaken appear even after a zone crash.",
  "timers": "Checked every second. Gintolaken's hate-drop check also runs every second.",
  "mechanics": [
   "A hidden check looks at the three markers. When none is left, Warlord Gintolaken (1,050,000 HP) is allowed to appear.",
   "The Warlord and the chieftains use the usual behavior: they drop their target's hate now and then and may warp home and heal when a fight ends."
  ],
  "npcs": [
   {
    "npcId": 222038,
    "name": "Warlord Gintolaken",
    "level": 77,
    "hp": 1050000
   },
   {
    "npcId": 222035,
    "name": "War Chieftan Birak",
    "level": 75,
    "hp": 350000
   },
   {
    "npcId": 222036,
    "name": "War Chieftan Galronar",
    "level": 75,
    "hp": 300000
   },
   {
    "npcId": 222037,
    "name": "War Chieftan Awisano",
    "level": 75,
    "hp": 400000
   }
  ],
  "rewards": [],
  "cites": [
   "poearthb/#War_Chieftan_Birak.lua:1-19",
   "poearthb/#Warlord_Gintolaken.lua:1-25",
   "poearthb/The.lua:1-16",
   "poearthb/player.lua:1-30"
  ]
 },
 {
  "slug": "pofire-fennin-ro",
  "zone": "pofire",
  "zoneName": "Plane of Fire",
  "name": "Fennin Ro, the Tyrant of Fire (Doomfire army, 4 stages)",
  "kind": "raid-boss",
  "kindWhy": "The flag boss of the Plane of Fire, in four stages. His death brings the Essence of Fire, which gives a Globe of Dancing Flame, one of four parts of the Quintessence of Elements (needed for the Plane of Time).",
  "groupLimit": "The Essence of Fire gives out 72 items, then leaves. Only the killer's raid or group can take one.",
  "start": "Engage the Guardian of Doomfire while the event is ready to begin.",
  "timers": "One clock of 4 hours 51 min 40 s covers the whole event, combat included. It is never extended. Fennin Ro gives a red-text warning every 45 minutes. After a fail you retry in 18 hours. After a win the Guardian is back in 138 hours (5 days 18 hours).",
  "mechanics": [
   "Stage 1, the Army of Flames: a rage reaver, a chaos healer, a dark magus and doomfire darkfiends, chaosfiends and ragefiends at fixed spots. All must be dead to move on.",
   "Stage 2, the commanders: Azobian the Darklord, Javonn the Overlord, Hebabbilys the Ragelord and Reaxnous the Chaoslord, with fresh soldiers.",
   "Stage 3, the Council of Fire: Chancellor Kirtra, Chancellor Traxom, Omni Magus Crato and Warlord Prollaz.",
   "Stage 4: Fennin Ro, the Tyrant of Fire (level 80, 1,000,000 HP) at /loc -1504, -930, and ten elite Guardians of Ro are armed.",
   "If the clock runs out, the attempt fails. When Fennin Ro dies, the Essence of Fire appears for the killer."
  ],
  "npcs": [
   {
    "npcId": 217440,
    "name": "Fennin Ro the Tyrant of Fire",
    "level": 80,
    "hp": 1000000
   },
   {
    "npcId": 217050,
    "name": "Guardian of Doomfire",
    "level": 70,
    "hp": 150000
   },
   {
    "npcId": 217425,
    "name": "Azobian the Darklord",
    "level": 78,
    "hp": 190000
   },
   {
    "npcId": 217426,
    "name": "Javonn the Overlord",
    "level": 78,
    "hp": 205000
   },
   {
    "npcId": 217453,
    "name": "Hebabbilys the Ragelord",
    "level": 78,
    "hp": 200000
   },
   {
    "npcId": 217427,
    "name": "Reaxnous the Chaoslord",
    "level": 78,
    "hp": 200000
   },
   {
    "npcId": 217432,
    "name": "Chancellor Kirtra",
    "level": 78,
    "hp": 230000
   },
   {
    "npcId": 217433,
    "name": "Chancellor Traxom",
    "level": 78,
    "hp": 230000
   },
   {
    "npcId": 217429,
    "name": "Omni Magus Crato",
    "level": 78,
    "hp": 215000
   },
   {
    "npcId": 217428,
    "name": "Warlord Prollaz",
    "level": 78,
    "hp": 250000
   },
   {
    "npcId": 217430,
    "name": "elite guardian of ro",
    "level": 70,
    "hp": 76200
   }
  ],
  "rewards": [
   {
    "itemId": 29147,
    "name": "Globe of Dancing Flame",
    "trigger": "Hail the Essence of Fire after Fennin Ro dies, if you have neither the Globe nor a Quintessence of Elements"
   }
  ],
  "cites": [
   "pofire/encounters/Fennin.lua:1-34",
   "pofire/encounters/Fennin.lua:100-147",
   "pofire/encounters/Fennin.lua:330-430",
   "pofire/Essence_of_Fire.lua:28-48"
  ]
 },
 {
  "slug": "pofire-field-named",
  "zone": "pofire",
  "zoneName": "Plane of Fire",
  "name": "Field named mobs and snare-immune spawns",
  "kind": "optional",
  "kindWhy": "Optional field mobs with loot and no flag. The only script makes some of the common mobs immune to snare.",
  "start": "Nothing to start: pull them.",
  "timers": "None.",
  "mechanics": [
   "Nine kinds of common field mob each have a 1 in 5 chance to appear immune to snare. They are obsidian tree spiders, jopal hunters, gatherers and lavahurlers, flame lords and fiery spirit steeds.",
   "The named field mobs (Blazzax, Babnoxis, Arch Mage Yozanni, General Reparm and others) have no script."
  ],
  "npcs": [
   {
    "npcId": 217003,
    "name": "Blazzax the Omnifiend",
    "level": 78,
    "hp": 850000
   },
   {
    "npcId": 217005,
    "name": "Babnoxis the Spider Queen",
    "level": 75,
    "hp": 625000
   },
   {
    "npcId": 217019,
    "name": "Arch Mage Yozanni",
    "level": 78,
    "hp": 800000
   },
   {
    "npcId": 217032,
    "name": "General Reparm",
    "level": 78,
    "hp": 850000
   },
   {
    "npcId": 217036,
    "name": "General Druav Flamesinger",
    "level": 75,
    "hp": 600000
   },
   {
    "npcId": 217049,
    "name": "Jaxoliz Dawneyes",
    "level": 75,
    "hp": 625000
   },
   {
    "npcId": 217051,
    "name": "Criare Sunmane",
    "level": 75,
    "hp": 625000
   },
   {
    "npcId": 217056,
    "name": "Quavonis Firetail",
    "level": 78,
    "hp": 825000
   },
   {
    "npcId": 217059,
    "name": "Magmaton",
    "level": 75,
    "hp": 800000
   },
   {
    "npcId": 217063,
    "name": "Pyronis",
    "level": 75,
    "hp": 650000
   }
  ],
  "rewards": [],
  "cites": [
   "pofire/encounters/SnareImmunity.lua:1-24"
  ]
 },
 {
  "slug": "poinnovation-manaetic-behemoth",
  "zone": "poinnovation",
  "zoneName": "Plane of Innovation",
  "name": "Manaetic Behemoth (weapon test, Giwin Mirakon flag)",
  "kind": "flag",
  "kindWhy": "The weapon test. Killing the Behemoth lets Giwin Mirakon give the second step of his flag, which the Drunder door needs.",
  "groupLimit": "Giwin flags the killer's group, up to 72 players per spawn.",
  "start": "Talk to Giwin Mirakon: hail, then 'great warrior', 'task' and 'test the machine'. That gives step 1. Then go to the main construction area, where clockwork devices begin to appear.",
  "timers": "A new set of devices comes every 48 seconds. Once the Behemoth wakes you have 3 hours. After a fail you retry in 10 minutes. Giwin stays 10 minutes after the win.",
  "mechanics": [
   "Every 48 seconds clockwork devices appear around the construction area and walk to the Behemoth's room, where they can blow up.",
   "Kill 10 clockwork devices to wake the Manaetic Behemoth. He then casts one random spell: Gas Leak, Deathfog IV, Biomelt IX or Liquid Hydrokill.",
   "If the Behemoth leaves his room, he is sent back and casts Balance of the Nameless.",
   "When he dies, the waves stop and the devices vanish. Giwin Mirakon appears at /loc 0, 1013 for the killer's group. Hail him to move from step 1 to step 2."
  ],
  "npcs": [
   {
    "npcId": 206046,
    "name": "Manaetic Behemoth",
    "level": 70,
    "hp": 150000
   },
   {
    "npcId": 206001,
    "name": "a clockwork device",
    "level": 50,
    "hp": 11000
   },
   {
    "npcId": 206203,
    "name": "Giwin Mirakon",
    "level": 60,
    "hp": 23000
   }
  ],
  "rewards": [],
  "cites": [
   "poinnovation/encounters/Behemoth.lua:1-240",
   "poinnovation/Giwin_Mirakon.lua:1-44",
   "poinnovation/#Giwin_Mirakon.lua:1-55",
   "poknowledge/Seer_Mal_Nae-Shi.lua:1-43"
  ]
 },
 {
  "slug": "poinnovation-xanamech-nitram",
  "zone": "poinnovation",
  "zoneName": "Plane of Innovation",
  "name": "Xanamech Nezmirthafen / Nitram Anizok (Innovation door flag)",
  "kind": "flag",
  "kindWhy": "Killing Xanamech Nezmirthafen lets Nitram Anizok give the door flag for the Plane of Innovation. The door only opens by force for players who have it.",
  "groupLimit": "Nitram flags only the killer's raid, group or solo player, and only 72 players per kill.",
  "start": "Hand Nitram Anizok a Copper Node, a Bundle of Super Conductive Wires and an Intact Power Cell, all three. Xanamech and the junk of Innovation each drop them at 2%. Nitram says 'please follow me!', walks his route and the dragon wakes.",
  "timers": "Nitram leaves 1 hour after the hand-in, or 10 minutes after the dragon dies. Xanamech lies asleep until woken, 3.5 seconds into Nitram's walk. Xanamech leaves after 30 minutes.",
  "mechanics": [
   "Xanamech is asleep until Nitram's walk wakes him. Then he can be attacked.",
   "When Xanamech dies, Nitram notes the killer's raid or group and can be talked to. Hail him while you are unflagged to get the door flag.",
   "Nitram's respawn is reset so a new attempt can begin after his window ends."
  ],
  "npcs": [
   {
    "npcId": 206208,
    "name": "Xanamech Nezmirthafen",
    "level": 66,
    "hp": 220000
   },
   {
    "npcId": 206033,
    "name": "Nitram Anizok",
    "level": 46,
    "hp": 10000
   }
  ],
  "rewards": [],
  "cites": [
   "poinnovation/Nitram_Anizok.lua:1-136",
   "poinnovation/#Xanamech_Nezmirthafen.lua:1-41",
   "poinnovation/player.lua:8-16"
  ]
 },
 {
  "slug": "poinnovation-time-access",
  "zone": "poinnovation",
  "zoneName": "Plane of Innovation",
  "name": "Chronographer Muon / Loreseeker Maelin / time-machine door (Plane of Time access)",
  "kind": "flag",
  "kindWhy": "The way into the Plane of Time. Chronographer Muon, Loreseeker Maelin and the time-machine door need the Zebuxoruk flag at step 2 and a Quintessence of Elements.",
  "start": "Hail Chronographer Muon while carrying a Quintessence of Elements and having the Zebuxoruk flag at step 2. Say 'yes' and he sends you to the time chamber, where Loreseeker Maelin appears. Then click the time-machine door, which needs the same two things.",
  "timers": "Maelin stays for 15 minutes.",
  "mechanics": [
   "Muon only knows players with the Zebuxoruk flag at step 2 and a Quintessence of Elements in their bags, inventory or on the cursor.",
   "The door gives you the Plane of Time flag and the zone flags for the Plane of Time.",
   "Maelin says the Plane of Time bond will be formed once the machine is activated."
  ],
  "npcs": [
   {
    "npcId": 206044,
    "name": "Chronographer Muon",
    "level": 70,
    "hp": 50000
   }
  ],
  "rewards": [],
  "cites": [
   "poinnovation/#Chronographer_Muon.lua:1-42",
   "poinnovation/Loreseeker_Maelin.lua:1-21",
   "poinnovation/player.lua:17-27"
  ]
 },
 {
  "slug": "poinnovation-endurance-room",
  "zone": "poinnovation",
  "zoneName": "Plane of Innovation",
  "name": "Endurance testing rooms (Researcher Kaeon, Assistant Kelrig)",
  "kind": "optional",
  "kindWhy": "A repeatable test room. No flag or reward is scripted. Runs go on until the group quits, and Assistant Kelrig only sends you out.",
  "size": "6 players",
  "groupLimit": "A maximum of six players at a time, in either of two rooms. Your group is moved if within 150 units.",
  "start": "Talk to Researcher Kaeon: hail, then 'comply to endurance testing' and 'ready'. Your group goes to the testing bay. Assistant Kelrig then asks 'ready' or 'quit'.",
  "timers": "The first wave comes after 2 minutes, then every 1 min 47 s to 2 min 8 s. A room resets after 30 minutes, or 12 minutes after a finished run. Mobs leave 12 minutes after they appear.",
  "mechanics": [
   "A run is 8 waves of 3, 4, 6, 8, 4, 4, 8 and 7 mobs (44 in all). They are manaetic contraptions, gadgets and persistent mechanizations, and manaetic devices. The device tier rises with each run.",
   "After wave 8, with all but about 15 of the mobs dead, Kelrig comes back. Say 'ready' to start another, harder run.",
   "After four runs he thanks you and casts Mechinetic Dislocation IV to eject you."
  ],
  "npcs": [
   {
    "npcId": 206199,
    "name": "a manaetic contraption",
    "level": 48,
    "hp": 6000
   },
   {
    "npcId": 206201,
    "name": "a manaetic gadget",
    "level": 49,
    "hp": 5900
   },
   {
    "npcId": 206202,
    "name": "a persistent mechanization",
    "level": 50,
    "hp": 8000
   },
   {
    "npcId": 206200,
    "name": "a manaetic device",
    "level": 50,
    "hp": 10800
   },
   {
    "npcId": 206205,
    "name": "a manaetic device",
    "level": 50,
    "hp": 10800
   },
   {
    "npcId": 206206,
    "name": "a manaetic device",
    "level": 50,
    "hp": 10800
   },
   {
    "npcId": 206207,
    "name": "a manaetic device",
    "level": 50,
    "hp": 10800
   }
  ],
  "rewards": [],
  "cites": [
   "poinnovation/encounters/EnduranceRoom.lua:1-405"
  ]
 },
 {
  "slug": "poinnovation-junk-beast",
  "zone": "poinnovation",
  "zoneName": "Plane of Innovation",
  "name": "Junk Beast (roamer)",
  "kind": "optional",
  "kindWhy": "A roaming mob with a patrol script. It always drops the Junk Beast Power Source, whose use is not in the scripts.",
  "start": "It roams on its own.",
  "timers": "Nothing is timed in the scripts.",
  "mechanics": [
   "It walks to /loc 962, -690 and patrols a short route near the mech-dragon room. A second spawn of it walks a route through the whole zone."
  ],
  "npcs": [
   {
    "npcId": 206060,
    "name": "Junk Beast",
    "level": 60,
    "hp": 110000
   }
  ],
  "rewards": [],
  "cites": [
   "poinnovation/encounters/JunkBeast.lua:1-67"
  ]
 },
 {
  "slug": "poinnovation-manaetic-prototypes",
  "zone": "poinnovation",
  "zoneName": "Plane of Innovation",
  "name": "Manaetic Prototypes IX / X / XI",
  "kind": "optional",
  "kindWhy": "Named mobs that teleport during the fight. They have loot and no flag.",
  "start": "Nothing to start: pull them.",
  "timers": "While engaged, each teleports at a random time between 2 and 30 seconds.",
  "mechanics": [
   "Manaetic Prototypes IX, X and XI teleport at random in a fight. A check every 3 seconds sends them back if they leave their area."
  ],
  "npcs": [
   {
    "npcId": 206054,
    "name": "Manaetic Prototype IX",
    "level": 66,
    "hp": 95678
   },
   {
    "npcId": 206053,
    "name": "Manaetic Prototype X",
    "level": 66,
    "hp": 95678
   },
   {
    "npcId": 206055,
    "name": "Manaetic Prototype XI",
    "level": 66,
    "hp": 95678
   }
  ],
  "rewards": [],
  "cites": [
   "poinnovation/Manaetic_Prototype_IX.lua:1-34",
   "poinnovation/Manaetic_Prototype_X.lua:1-34",
   "poinnovation/Manaetic_Prototype_XI.lua:1-34"
  ]
 },
 {
  "slug": "pojustice-mavuin-chain",
  "zone": "pojustice",
  "zoneName": "Plane of Justice",
  "name": "Mavuin / Tribunal plea (mavuin flag series)",
  "kind": "flag",
  "kindWhy": "The Plane of Justice flag series. At the last step it opens the Valor and Storms portals in Tranquility and the Askr door in Storms.",
  "start": "Hail Mavuin and say 'information' for step 1. Tell the Tribunal 'mavuin' with at least one Mark in your inventory for step 2. Hail Mavuin again for step 3.",
  "timers": "None. The flags are permanent.",
  "mechanics": [
   "Any one of the six trial Marks counts: Mark of Flame, Mark of Execution, Mark of Torture, Mark of Stone, Mark of Suffocation or Mark of Lashing. There is one per trial.",
   "Say 'knowledge' to the Tribunal when you hold all six Marks, or have the Seventh flag, and he gives you The Mark of Justice."
  ],
  "npcs": [],
  "rewards": [
   {
    "itemId": 31599,
    "name": "The Mark of Justice",
    "trigger": "Say 'knowledge' to the Tribunal holding all six Marks (or having the Seventh flag), which also sets the Seventh flag"
   }
  ],
  "cites": [
   "pojustice/#Mavuin.lua:1-29",
   "pojustice/The_Tribunal.lua:47-56",
   "pojustice/The_Tribunal.lua:244-306",
   "potranquility/player.lua:13-22",
   "postorms/player.lua:5-27"
  ]
 },
 {
  "slug": "pojustice-seventh-hammer",
  "zone": "pojustice",
  "zoneName": "Plane of Justice",
  "name": "The Seventh Hammer (judgement room)",
  "kind": "optional",
  "kindWhy": "The judgement room, entered with The Mark of Justice after the six trials. Killing the Seventh Hammer sets no flag. He has 1,080,000 HP and counts as optional raid loot.",
  "start": "Hold The Mark of Justice on your cursor and click any of the six doors. That sends you to /loc 1310, 76, unless the Hammer is already fighting. Hail the Seventh Hammer and say 'ready to face' and he adds you to his hate list.",
  "timers": "The Tribunal casts Tremor of Judgment first at 1 min 26 s to 1 min 35 s, then every 3 min 7 s. It casts Verdict of Eternity first at 3 min 1 s to 3 min 10 s, then every 3 min 7 s. The room resets 10 minutes after combat ends.",
  "mechanics": [
   "A hidden Tribunal casts both spells, and the visible Tribunal animates them."
  ],
  "npcs": [
   {
    "npcId": 201074,
    "name": "The Seventh Hammer",
    "level": 73,
    "hp": 1080000
   }
  ],
  "rewards": [],
  "cites": [
   "pojustice/The_Seventh_Hammer.lua:1-57",
   "pojustice/player.lua:1-28",
   "pojustice/The_Tribunal.lua:286-306"
  ]
 },
 {
  "slug": "pojustice-ancient-crawler",
  "zone": "pojustice",
  "zoneName": "Plane of Justice",
  "name": "The ancient crawler (marked as a raid target)",
  "kind": "optional",
  "kindWhy": "Marked as a raid target in our database. No script covers it, so only the loot tables speak for it.",
  "start": "Unknown: no script covers it.",
  "timers": "Unknown.",
  "mechanics": [
   "No quest script exists for it. It is named in the database only."
  ],
  "npcs": [
   {
    "npcId": 201492,
    "name": "the ancient crawler",
    "level": 62,
    "hp": 19000
   }
  ],
  "rewards": [],
  "cites": []
 },
 {
  "slug": "pojustice-trial-lashing",
  "zone": "pojustice",
  "zoneName": "Plane of Justice",
  "name": "Trial of Lashing (Lashman Azakal)",
  "kind": "flag",
  "kindWhy": "One of the six Justice trials. Winning gives a Mark. Any one Mark lets the Tribunal move the Mavuin flag on, and all six let him give The Mark of Justice.",
  "groupLimit": "No cap in the script. The Tribunal moves your group or raid group, anyone within 50 units of you.",
  "start": "Say to the Tribunal 'prove', then 'prepared', then 'ready to begin the Trial of Lashing'. He refuses with 'That trial is already underway' if another trial is running.",
  "timers": "The first wave comes 26 seconds after the start, then one every 3 min 12 s, four in all. Mobs that stay out of combat for 60 seconds after wave 1 fail the trial. After a fail you are returned after 10 seconds and the trial is open again in 1 minute. After a win it is open again in 10 minutes, with a warning at 9 minutes and a boot at 9 min 59 s.",
  "mechanics": [
   "The waves are savage lashers and malevolent punishers, with a rare Harrowing Lasher or Stinging Nemesis. Scourges of Honor also appear and cannot be fought directly.",
   "Tormented prisoners (ogres) are being lashed. If any prisoner dies, you see 'You have failed' and the trial fails.",
   "Scourges of Honor come every 30 to 60 seconds with flickering spirits (a level 15 or a level 30 one with 7,000 HP) in one of three places. Killing the 7,000 HP spirit removes all the scourges.",
   "When wave 4 is out and no scourge is left, Lashman Azakal appears at /loc -1119, 1334. His death wins the trial."
  ],
  "npcs": [
   {
    "npcId": 201479,
    "name": "Lashman Azakal",
    "level": 65,
    "hp": 36300
   },
   {
    "npcId": 201462,
    "name": "a harrowing lasher",
    "level": 58,
    "hp": 12000
   },
   {
    "npcId": 201472,
    "name": "a stinging nemesis",
    "level": 58,
    "hp": 15500
   },
   {
    "npcId": 201466,
    "name": "a savage lasher",
    "level": 55,
    "hp": 11000
   },
   {
    "npcId": 201463,
    "name": "a malevolent punisher",
    "level": 55,
    "hp": 13300
   },
   {
    "npcId": 201467,
    "name": "a scourge of honor",
    "level": 53,
    "hp": 10000
   }
  ],
  "rewards": [
   {
    "itemId": 31960,
    "name": "Mark of Lashing",
    "trigger": "Always dropped by Lashman Azakal. It proves this trial."
   }
  ],
  "cites": [
   "pojustice/encounters/LashingTrial.lua:1-35",
   "pojustice/encounters/LashingTrial.lua:132-222",
   "pojustice/The_Tribunal.lua:1-45",
   "pojustice/The_Tribunal.lua:186-311"
  ]
 },
 {
  "slug": "pojustice-trial-execution",
  "zone": "pojustice",
  "zoneName": "Plane of Justice",
  "name": "Trial of Execution (Prime Executioner Vathoch)",
  "kind": "flag",
  "kindWhy": "One of the six Justice trials. Winning gives a Mark. Any one Mark lets the Tribunal move the Mavuin flag on, and all six let him give The Mark of Justice.",
  "groupLimit": "No cap in the script. The Tribunal moves your group or raid group, anyone within 50 units of you.",
  "start": "Say to the Tribunal 'prove', then 'prepared', then 'ready to begin the Trial of Execution'. He refuses with 'That trial is already underway' if another trial is running.",
  "timers": "The first wave comes 26 seconds after the start, then one every 2 min 17 s, four in all. Mobs that stay out of combat for 60 seconds after wave 1 fail the trial. After a fail you are returned after 10 seconds and the trial is open again in 1 minute. After a win it is open again in 10 minutes, with a warning at 9 minutes and a boot at 9 min 59 s.",
  "mechanics": [
   "Waves of dark and fierce nemeses come, with the named Priest of Doom and Herald of Destruction, while an executioner walks toward a sentenced prisoner.",
   "The executioner is on a clock of about 34 to 60 seconds. If it runs out, he kills the prisoner and the trial fails. After you kill four mobs of a wave he leaves.",
   "At wave 4 the prisoner leaves and Prime Executioner Vathoch appears at /loc -1157, 195. His death wins the trial."
  ],
  "npcs": [
   {
    "npcId": 201485,
    "name": "Prime Executioner Vathoch",
    "level": 65,
    "hp": 38500
   },
   {
    "npcId": 201484,
    "name": "priest of doom",
    "level": 53,
    "hp": 10000
   },
   {
    "npcId": 201478,
    "name": "herald of destruction",
    "level": 53,
    "hp": 8000
   },
   {
    "npcId": 201457,
    "name": "a dark nemesis",
    "level": 51,
    "hp": 6700
   },
   {
    "npcId": 201458,
    "name": "a fierce nemesis",
    "level": 51,
    "hp": 9200
   },
   {
    "npcId": 201501,
    "name": "an executioner",
    "level": 50,
    "hp": 10600
   }
  ],
  "rewards": [
   {
    "itemId": 31842,
    "name": "Mark of Execution",
    "trigger": "Always dropped by Prime Executioner Vathoch. It proves this trial."
   }
  ],
  "cites": [
   "pojustice/encounters/ExecutionTrial.lua:1-222"
  ]
 },
 {
  "slug": "pojustice-trial-stoning",
  "zone": "pojustice",
  "zoneName": "Plane of Justice",
  "name": "Trial of Stoning (Yurae Zhaleem)",
  "kind": "flag",
  "kindWhy": "One of the six Justice trials. Winning gives a Mark. Any one Mark lets the Tribunal move the Mavuin flag on, and all six let him give The Mark of Justice.",
  "groupLimit": "No cap in the script. The Tribunal moves your group or raid group, anyone within 50 units of you.",
  "start": "Say to the Tribunal 'prove', then 'prepared', then 'ready to begin the Trial of Stoning'. He refuses with 'That trial is already underway' if another trial is running.",
  "timers": "The first wave comes 26 seconds after the start, then one every 2 min 50 s, four in all. Mobs that stay out of combat for 60 seconds after wave 1 fail the trial. After a fail you are returned after 10 seconds and the trial is open again in 1 minute. After a win it is open again in 10 minutes, with a warning at 9 minutes and a boot at 9 min 59 s.",
  "mechanics": [
   "The waves are relentless punishers and shadow grinders, with a rare Nemesis of Stone or Ruthless Grinder. Pitiless avenger archers pelt an accused prisoner.",
   "The prisoner takes damage from the archers. If she collapses, you see 'no longer shielding herself from the stones' and the trial fails.",
   "When you have killed every mob of wave 4, Yurae Zhaleem appears at /loc -1120, -130. Her death wins the trial."
  ],
  "npcs": [
   {
    "npcId": 201496,
    "name": "Yurae Zhaleem",
    "level": 65,
    "hp": 42400
   },
   {
    "npcId": 201482,
    "name": "nemesis of stone",
    "level": 58,
    "hp": 12000
   },
   {
    "npcId": 201465,
    "name": "a ruthless grinder",
    "level": 58,
    "hp": 12150
   },
   {
    "npcId": 201464,
    "name": "a relentless punisher",
    "level": 55,
    "hp": 12150
   },
   {
    "npcId": 201469,
    "name": "a shadow grinder",
    "level": 55,
    "hp": 13300
   },
   {
    "npcId": 201475,
    "name": "a pitiless avenger",
    "level": 55,
    "hp": 10000
   }
  ],
  "rewards": [
   {
    "itemId": 31845,
    "name": "Mark of Stone",
    "trigger": "Always dropped by Yurae Zhaleem. It proves this trial."
   }
  ],
  "cites": [
   "pojustice/encounters/StoningTrial.lua:1-192"
  ]
 },
 {
  "slug": "pojustice-trial-torture",
  "zone": "pojustice",
  "zoneName": "Plane of Justice",
  "name": "Trial of Torture (Punisher Veshtaq)",
  "kind": "flag",
  "kindWhy": "One of the six Justice trials. Winning gives a Mark. Any one Mark lets the Tribunal move the Mavuin flag on, and all six let him give The Mark of Justice.",
  "groupLimit": "No cap in the script. The Tribunal moves your group or raid group, anyone within 50 units of you.",
  "start": "Say to the Tribunal 'prove', then 'prepared', then 'ready to begin the Trial of Torture'. He refuses with 'That trial is already underway' if another trial is running.",
  "timers": "The first wave comes 26 seconds after the start, then one every 2 min 52 s, four in all. Mobs that stay out of combat for 60 seconds after wave 1 fail the trial. After a fail you are returned after 10 seconds and the trial is open again in 1 minute. After a win it is open again in 10 minutes, with a warning at 9 minutes and a boot at 9 min 59 s.",
  "mechanics": [
   "A Wraith of Agony comes with twisted tormentors, a Nemesis of Pain, a Nemesis of Despair and an Accursed Tormentor near a tortured prisoner. Pain and Suffering, and Relief, are scenery.",
   "If the prisoner dies, the trial fails. Killing the Wraith of Agony gives relief.",
   "At wave 4, once 19 or more mobs are dead, Punisher Veshtaq appears at /loc -1121, 887. His death wins the trial."
  ],
  "npcs": [
   {
    "npcId": 201487,
    "name": "Punisher Veshtaq",
    "level": 65,
    "hp": 42400
   },
   {
    "npcId": 201480,
    "name": "nemesis of despair",
    "level": 58,
    "hp": 14800
   },
   {
    "npcId": 201474,
    "name": "an accursed tormentor",
    "level": 58,
    "hp": 14300
   },
   {
    "npcId": 201473,
    "name": "a twisted tormentor",
    "level": 55,
    "hp": 9800
   },
   {
    "npcId": 201481,
    "name": "nemesis of pain",
    "level": 55,
    "hp": 13300
   },
   {
    "npcId": 201495,
    "name": "wraith of agony",
    "level": 58,
    "hp": 18500
   }
  ],
  "rewards": [
   {
    "itemId": 31844,
    "name": "Mark of Torture",
    "trigger": "Always dropped by Punisher Veshtaq. It proves this trial."
   }
  ],
  "cites": [
   "pojustice/encounters/TortureTrial.lua:1-234"
  ]
 },
 {
  "slug": "pojustice-trial-hanging",
  "zone": "pojustice",
  "zoneName": "Plane of Justice",
  "name": "Trial of Hanging (Gallows Master Teion)",
  "kind": "flag",
  "kindWhy": "One of the six Justice trials. Winning gives a Mark. Any one Mark lets the Tribunal move the Mavuin flag on, and all six let him give The Mark of Justice.",
  "groupLimit": "No cap in the script. The Tribunal moves your group or raid group, anyone within 50 units of you.",
  "start": "Say to the Tribunal 'prove', then 'prepared', then 'ready to begin the Trial of Hanging'. He refuses with 'That trial is already underway' if another trial is running.",
  "timers": "The first wave comes 26 seconds after the start, then one every 1 min 58 s, four in all. Mobs that stay out of combat for 60 seconds after wave 1 fail the trial. After a fail you are returned after 10 seconds and the trial is open again in 1 minute. After a win it is open again in 10 minutes, with a warning at 9 minutes and a boot at 9 min 59 s.",
  "mechanics": [
   "The waves are breathless voids and stifling nemeses, with a rare Smothering Nemesis or Phantom of Asphyxiation. Spirits of Suffocation come every 47 seconds. They gather around three sentenced prisoners.",
   "Each prisoner has a noose that tightens every 17 seconds. If a prisoner dies, the trial fails.",
   "At wave 4, once 16 or more mobs are dead, Gallows Master Teion appears at /loc -1052, 490. His death wins the trial."
  ],
  "npcs": [
   {
    "npcId": 201477,
    "name": "Gallows Master Teion",
    "level": 65,
    "hp": 32300
   },
   {
    "npcId": 201470,
    "name": "a smothering nemesis",
    "level": 58,
    "hp": 15200
   },
   {
    "npcId": 201483,
    "name": "phantom of asphyxiation",
    "level": 58,
    "hp": 12000
   },
   {
    "npcId": 201449,
    "name": "a breathless void",
    "level": 55,
    "hp": 9750
   },
   {
    "npcId": 201471,
    "name": "a stifling nemesis",
    "level": 55,
    "hp": 11000
   }
  ],
  "rewards": [
   {
    "itemId": 31846,
    "name": "Mark of Suffocation",
    "trigger": "Always dropped by Gallows Master Teion. It proves this trial."
   }
  ],
  "cites": [
   "pojustice/encounters/HangingTrial.lua:1-271"
  ]
 },
 {
  "slug": "pojustice-trial-burning",
  "zone": "pojustice",
  "zoneName": "Plane of Justice",
  "name": "Trial of Flame (Punisher of Flame)",
  "kind": "flag",
  "kindWhy": "One of the six Justice trials. Winning gives a Mark. Any one Mark lets the Tribunal move the Mavuin flag on, and all six let him give The Mark of Justice.",
  "groupLimit": "No cap in the script. The Tribunal moves your group or raid group, anyone within 50 units of you.",
  "start": "Say to the Tribunal 'prove', then 'prepared', then 'ready to begin the Trial of Flame'. He refuses with 'That trial is already underway' if another trial is running.",
  "timers": "The first wave comes 26 seconds after the start, then one every 2 min 10 s, four in all. Mobs that stay out of combat for 60 seconds after wave 1 fail the trial. After a fail you are returned after 10 seconds and the trial is open again in 1 minute. After a win it is open again in 10 minutes, with a warning at 9 minutes and a boot at 9 min 59 s. The boss's corpse lasts 8 minutes.",
  "mechanics": [
   "Waves of four come: fiends of flame (47%), spirits of flame (47%), and a burning nemesis or a fiery aggressor (3% each). The Flame casts Searing Heat or Wave of Heat every 28 seconds.",
   "The mobs walk to the middle at /loc -730, 880. A mob that reaches the stake casts Unfold Fletching Kit. If a mob times out after wave 1, the trial fails.",
   "At wave 4, once 16 or more mobs are dead, Punisher of Flame appears at /loc -725, 885. His death wins the trial."
  ],
  "npcs": [
   {
    "npcId": 201486,
    "name": "Punisher of Flame",
    "level": 65,
    "hp": 32300
   },
   {
    "npcId": 201450,
    "name": "a burning nemesis",
    "level": 58,
    "hp": 16400
   },
   {
    "npcId": 201459,
    "name": "a fiery aggressor",
    "level": 58,
    "hp": 16000
   },
   {
    "npcId": 201476,
    "name": "fiend of flame",
    "level": 55,
    "hp": 11500
   },
   {
    "npcId": 201488,
    "name": "spirit of flame",
    "level": 55,
    "hp": 12800
   }
  ],
  "rewards": [
   {
    "itemId": 31796,
    "name": "Mark of Flame",
    "trigger": "Always dropped by Punisher of Flame. It proves this trial."
   }
  ],
  "cites": [
   "pojustice/encounters/BurningTrial.lua:1-172"
  ]
 },
 {
  "slug": "poknowledge-maelin-flags",
  "zone": "poknowledge",
  "zoneName": "Plane of Knowledge",
  "name": "Grand Librarian Maelin - cipher, zebuxoruk and zeks 6 flags",
  "kind": "flag",
  "kindWhy": "Grand Librarian Maelin turns boss-kill flags into the next flag in the series. The Cipher flag and Zeks step 6 open the Tower of Solusek Ro. Zebuxoruk step 2 opens the Water, Earth and Air planes and the time machine.",
  "start": "Hail Maelin to check for the Cipher flag, which needs the Mithaniel Marr and Saryrn flags. Say 'lore' with the Marr book flag and Karana step 4 for Zebuxoruk step 1. Say 'information' with Zebuxoruk step 1 and Zeks step 7 for Zebuxoruk step 2, or with the Cipher flag and Zeks step 5 for Zeks step 6.",
  "timers": "None. The flags are permanent.",
  "mechanics": [
   "The Cipher flag uses up the Mithaniel Marr and Saryrn flags. Zebuxoruk step 1 uses up the Marr book flag and Karana step 4.",
   "If you have the Time flag, or Zebuxoruk step 2 with a Quintessence of Elements, Maelin points you to Chronographer Muon.",
   "At Zebuxoruk step 2 he tells you to collect the essences of Fire, Air, Water and Earth and combine them to open the time machine in the Plane of Innovation."
  ],
  "npcs": [],
  "rewards": [],
  "cites": [
   "poknowledge/Grand_Librarian_Maelin.lua:1-85",
   "poknowledge/Seer_Mal_Nae-Shi.lua:1-43"
  ]
 },
 {
  "slug": "poknowledge-seer-mal-nae-shi",
  "zone": "poknowledge",
  "zoneName": "Plane of Knowledge",
  "name": "Seer Mal Nae`Shi - guided meditation / unlock memories (flag checklist)",
  "kind": "flag",
  "kindWhy": "The Seer's list of every Planes of Power flag. 'Unlock memories' turns a checklist flag into the real flag if you have the earlier steps.",
  "start": "Sit and say 'guided meditation' to list your flags, or say 'unlock' and 'memories' to turn checklist flags into real ones. GMs can say 'time' to grant every flag or 'delete' to remove them.",
  "timers": "None.",
  "mechanics": [
   "Flags: Mavuin (3 steps), Seventh, Thelin (4), Innovation door, Zeks (7), Fuirstel (5), Grummus, Aerindar (2), Bertoxxulous key, Halls of Honor trials (3 parts), Mithaniel Marr, Marr book, Tylis (2), Saryrn, Karana (4), Cipher, Solusek Ro room (5 parts), Zebuxoruk (2), Fire (2), Time and Earth B key.",
   "Checklist flags: Grummus, Maze, Behemoth, Aerindar, Terris, Bertoxxulous, Keeper, Saryrn, Vallon, Tallon, Rallos, Karana, Mithaniel Marr, Marr book and Solusek."
  ],
  "npcs": [],
  "rewards": [],
  "cites": [
   "poknowledge/Seer_Mal_Nae-Shi.lua:1-43",
   "poknowledge/Seer_Mal_Nae-Shi.lua:45-110",
   "poknowledge/Seer_Mal_Nae-Shi.lua:324-368"
  ]
 },
 {
  "slug": "ponightmare-maze-thelin",
  "zone": "ponightmare",
  "zoneName": "Plane of Nightmares",
  "name": "Thelin's Maze (dagger shards, Terris dialogue)",
  "kind": "flag",
  "kindWhy": "Thelin's Maze. Hailing Thelin Poxbourne at the end with Thelin step 1 moves you to step 2 of the Thelin flag series. If you have no Thelin flag, you get the Maze checklist flag.",
  "size": "24 per dream",
  "groupLimit": "Three dreams (rooms) can run at once, with up to 24 players each. One raid per room. Players beyond the limit are removed from the room.",
  "start": "Talk to Thelin Poxbourne outside: hail, then 'dagger', 'help' and 'ready'. Your raid or group goes to a free maze room. After the first group enters, the maze waits 5 minutes before it starts.",
  "timers": "The maze starts 5 minutes after the first entry. Players have 60 seconds to arrive. The room closes after 2 hours at most, so it cannot lock up. After the dagger is restored that drops to 25 minutes. Mobs leave after 20 minutes.",
  "mechanics": [
   "Thelin walks the maze. At six points he recovers pieces of his dagger, and each time waves appear: sinister, Thulian and abhorrent nightstalkers, ravens, arachnids and a nightmarish construct.",
   "At the first of those points the last Construct of Nightmares appears. It always drops the Dagger Blade Shard.",
   "Hand the Dagger Blade Shard to Thelin for Thelin's Dagger. Terris Thule, in a harmless level 1 form, appears and speaks. Hail Thelin again for step 2 of the flag and to leave."
  ],
  "npcs": [
   {
    "npcId": 204464,
    "name": "a construct of nightmares",
    "level": 65,
    "hp": 300000
   },
   {
    "npcId": 204486,
    "name": "Thelin Poxbourne",
    "level": 60,
    "hp": 15000
   },
   {
    "npcId": 204070,
    "name": "Thelin Poxbourne",
    "level": 30,
    "hp": 6500
   }
  ],
  "rewards": [
   {
    "itemId": 9259,
    "name": "Thelin's Dagger",
    "trigger": "Hand the Dagger Blade Shard to Thelin Poxbourne once the maze boss is dead"
   }
  ],
  "cites": [
   "ponightmare/encounters/Maze.lua:1-30",
   "ponightmare/encounters/Maze.lua:459-496",
   "ponightmare/encounters/Maze.lua:505-575",
   "ponightmare/encounters/Maze.lua:608-630",
   "poknowledge/Seer_Mal_Nae-Shi.lua:1-43"
  ]
 },
 {
  "slug": "nightmareb-terris-thule",
  "zone": "nightmareb",
  "zoneName": "The Lair of Terris Thule",
  "name": "Terris Thule (lair)",
  "kind": "raid-boss",
  "kindWhy": "The flag boss of the Lair of Terris Thule. His death brings a Planar Projection that moves the Thelin flag from step 2 to step 3. If you have no Thelin flag, you get the Terris checklist flag.",
  "groupLimit": "The projection flags up to 72 players.",
  "start": "Pull Terris Thule.",
  "timers": "If a fight drops, she resets to full health after 3 seconds. Her area is checked every second. The projection stays 20 minutes.",
  "mechanics": [
   "At 95% health a message plays. At 79% and 69% one dream defiler appears for each player attacking, small or large, at /loc -168, -1661.",
   "At 50% she casts Direption of Dreams. At 40% four grotesque statues wake.",
   "If she leaves her area she resets to full health and casts Balance of the Nameless.",
   "When she dies, her adds are reset and a Planar Projection appears on her corpse."
  ],
  "npcs": [
   {
    "npcId": 221041,
    "name": "Terris Thule",
    "level": 70,
    "hp": 450000
   },
   {
    "npcId": 221043,
    "name": "a grotesque statue",
    "level": 63,
    "hp": 53000
   },
   {
    "npcId": 221044,
    "name": "a dream defiler",
    "level": 55,
    "hp": 11000
   },
   {
    "npcId": 221045,
    "name": "a dream defiler",
    "level": 55,
    "hp": 12500
   }
  ],
  "rewards": [],
  "cites": [
   "nightmareb/Terris_Thule.lua:1-135",
   "nightmareb/A_Planar_Projection.lua:13-48"
  ]
 },
 {
  "slug": "ponightmare-mujaki",
  "zone": "ponightmare",
  "zoneName": "Plane of Nightmares",
  "name": "Mujaki the Devourer (Etumer's rescue, wave event)",
  "kind": "optional",
  "kindWhy": "Optional wave event with loot (the Nightmare Rift, always) and experience. It sets no flag.",
  "size": "24 per room",
  "groupLimit": "Three rooms, up to 24 players each, fewer than 4 groups per room. The first group's raid is saved and only that raid may enter. A group not in a raid cannot join a raided room.",
  "start": "Talk to Etumer: hail, then 'brother', 'perhaps' and 'ready'. Your group is moved to a free trial room. The event starts 5 minutes after the first group arrives.",
  "timers": "The first wave comes 5 minutes after you arrive, then one every 2 minutes, 8 waves in all. Mujaki and the riders leave 25 minutes after they become active (the clock stops in combat). The room comes back after 25 minutes with no one fighting.",
  "mechanics": [
   "Waves 1 to 3 are single waves, 4 to 7 are doubles (a second set follows 3 seconds later), and wave 8 makes Mujaki attackable.",
   "The wave mobs are Servants of Mujaki (level 58). Platform riders (level 60) are made from servants that reach Mujaki. Helots also appear.",
   "Mujaki can only be targeted after wave 8."
  ],
  "npcs": [
   {
    "npcId": 204039,
    "name": "Mujaki the Devourer",
    "level": 70,
    "hp": 400000
   },
   {
    "npcId": 204036,
    "name": "Etumer",
    "level": 60,
    "hp": 33000
   },
   {
    "npcId": 204470,
    "name": "a servant of Mujaki",
    "level": 58,
    "hp": 19600
   },
   {
    "npcId": 204471,
    "name": "a servant of Mujaki",
    "level": 60,
    "hp": 22000
   },
   {
    "npcId": 204466,
    "name": "a helot of Mujaki",
    "level": 60,
    "hp": 33500
   }
  ],
  "rewards": [],
  "cites": [
   "ponightmare/encounters/Mujaki.lua:1-30",
   "ponightmare/encounters/Mujaki.lua:206-260",
   "ponightmare/encounters/Mujaki.lua:294-330",
   "ponightmare/encounters/Mujaki.lua:395-440"
  ]
 },
 {
  "slug": "ponightmare-deyid",
  "zone": "ponightmare",
  "zoneName": "Plane of Nightmares",
  "name": "Deyid the Twisted (Seilaen's forest plateau)",
  "kind": "optional",
  "kindWhy": "Optional fight on Seilaen's plateau with loot (Screamstaff, Ribbon Choker, Scorched Wand) and no flag.",
  "size": "2 groups",
  "groupLimit": "Seilaen sends at most 2 groups to the plateau. Saying 'ready' sends a group that is within 150 units.",
  "start": "Talk to Seilaen: hail, then 'help', 'following', 'locket' and 'want'. If Deyid is not already up, Deyid the Twisted appears at /loc 1081, 1011 and you are moved to /loc 1103, 1213. Say 'deyid' and 'ready' to bring more groups.",
  "timers": "Deyid leaves after 30 minutes. The foreboding trees stay up to an hour. Treants leave after 1 min 40 s. Seilaen resets her ports 10 minutes later if players are still on the plateau. The plateau edge is checked every 5 seconds.",
  "mechanics": [
   "At 85% health, 11 foreboding trees appear in a ring round the plateau. At 60% they close in. At 45% six of them become blighted or corrupt treants and run at Deyid's target.",
   "When Deyid dies, Seilaen and the trees are freed."
  ],
  "npcs": [
   {
    "npcId": 204461,
    "name": "Deyid the Twisted",
    "level": 65,
    "hp": 35000
   },
   {
    "npcId": 204484,
    "name": "a foreboding tree",
    "level": 1,
    "hp": 10
   },
   {
    "npcId": 204459,
    "name": "a blighted treant",
    "level": 55,
    "hp": 16000
   },
   {
    "npcId": 204460,
    "name": "a corrupt treant",
    "level": 55,
    "hp": 16000
   }
  ],
  "rewards": [],
  "cites": [
   "ponightmare/Seilaen.lua:71-125",
   "ponightmare/#Deyid_the_Twisted.lua:1-95"
  ]
 },
 {
  "slug": "ponightmare-hobgoblin-chain",
  "zone": "ponightmare",
  "zoneName": "Plane of Nightmares",
  "name": "Hobgoblin chain: Bullyrag Bat -> Painwrack -> Fearsome -> Anguish Lord",
  "kind": "optional",
  "kindWhy": "A chain of named placeholder mobs with no flag.",
  "start": "Nothing to start: kill The Bullyrag Bat. Each death brings the next one.",
  "timers": "Unknown. Respawn times are in the database, not the scripts.",
  "mechanics": [
   "The Bullyrag Bat dies, then The Painwrack Hobgoblin appears at /loc 4567, 727.",
   "Painwrack dies, then The Fearsome Hobgoblin appears at /loc 4079, 1686.",
   "Fearsome dies, then the Hobgoblin Anguish Lord appears at /loc 2650, 1484 with a malevolent mephit and a fearsome bat."
  ],
  "npcs": [
   {
    "npcId": 204010,
    "name": "The Bullyrag Bat",
    "level": 65,
    "hp": 30000
   },
   {
    "npcId": 204482,
    "name": "The Painwrack Hobgoblin",
    "level": 68,
    "hp": 32500
   },
   {
    "npcId": 204481,
    "name": "The Fearsome Hobgoblin",
    "level": 70,
    "hp": 37000
   },
   {
    "npcId": 204479,
    "name": "Hobgoblin Anguish Lord",
    "level": 75,
    "hp": 75000
   },
   {
    "npcId": 204468,
    "name": "a malevolent mephit",
    "level": 65,
    "hp": 22000
   },
   {
    "npcId": 204465,
    "name": "a fearsome bat",
    "level": 68,
    "hp": 37800
   }
  ],
  "rewards": [],
  "cites": [
   "ponightmare/#The_Bullyrag_Bat.lua:1-2",
   "ponightmare/#The_Painwrack_Hobgoblin.lua:1-2",
   "ponightmare/#The_Fearsome_Hobgoblin.lua:1-4"
  ]
 },
 {
  "slug": "ponightmare-named-uniques",
  "zone": "ponightmare",
  "zoneName": "Plane of Nightmares",
  "name": "Named uniques: Terror Matriarch, Vhaksiz the Shade, Untel`Dak, The Dreamkeeper",
  "kind": "optional",
  "kindWhy": "Named mobs whose scripts only send them back when pulled too far or add monsters. Vhaksiz drops the Heart of Vhaksiz, which goes with a Beginner Magic Manual to Cadelid Etord in the Plane of Knowledge for a side quest.",
  "start": "Nothing to start: pull them.",
  "timers": "The Terror Matriarch adds a hatchling every 30 seconds. The Dreamkeeper leaves after 10 minutes. Vhaksiz is checked every 3 seconds.",
  "mechanics": [
   "The Terror Matriarch spawns a hatchling every 30 seconds in a fight.",
   "Vhaksiz the Shade resets if pulled more than 155 units from where he spawns.",
   "Untel`Dak is checked every 3 seconds to see that he has not left his area.",
   "The Dreamkeeper has only a despawn timer."
  ],
  "npcs": [
   {
    "npcId": 204034,
    "name": "Terror Matriarch",
    "level": 65,
    "hp": 36000
   },
   {
    "npcId": 204028,
    "name": "Vhaksiz the Shade",
    "level": 65,
    "hp": 300000
   },
   {
    "npcId": 204035,
    "name": "Untel`Dak",
    "level": 68,
    "hp": 37000
   },
   {
    "npcId": 204480,
    "name": "The Dreamkeeper",
    "level": 64,
    "hp": 40000
   }
  ],
  "rewards": [],
  "cites": [
   "ponightmare/#Terror_Matriarch.lua:1-14",
   "ponightmare/Vhaksiz_the_Shade.lua:1-25",
   "ponightmare/Untel-Dak.lua:1-10",
   "ponightmare/The_Dreamkeeper.lua:1-17",
   "poknowledge/Cadelid_Etord.lua:17"
  ]
 },
 {
  "slug": "postorms-relv-falto",
  "zone": "postorms",
  "zoneName": "Plane of Storms",
  "name": "Relv the Mysterious - Falto, Lord of Thunder (burning forest)",
  "kind": "optional",
  "kindWhy": "Optional event. It sets no flag. Turn in the Lightning Crystals that Falto drops for a Ruby Pendant with a Gold Chain and 50,000 experience.",
  "size": "4 groups, one at a time; 24 players in",
  "groupLimit": "Up to 4 parties, sent in one at a time. Relv moves your group or raid group, anyone within 100 units. Every 30 seconds, anyone beyond the 24th player in the burning forest is sent back to /loc -2059, -1795.",
  "start": "Talk to Relv the Mysterious. Say 'hail' once. Then say 'destruction' or 'continue', then 'continue' twice more. Finally say 'courageous'. That starts the event, but only if no event is running and nobody is inside. Then say 'ready' and your group is moved into the burning forest. Four groups at most.",
  "timers": "The event lasts 3 hours from the start. When it ends, everyone is pulled back to Relv at /loc 2088, 1562 and everything resets. Falto's adds come every minute during his fight: 1 mephit in the first wave, 2 in the second, 3 in the third, and so on. The count starts again at 1 each time a new fight starts. Add mobs leave after 3 minutes out of combat.",
  "mechanics": [
   "Don't repeat 'hail' to Relv. After a few he gets annoyed and ignores you.",
   "When the event starts, a Decrepit Ent appears at /loc 6055, -1017 and 30 mephits are spread across the burning forest, each randomly blazing or burning, level 62.",
   "Each mephit that dies leaves 3 fiery mepheekas. You don't have to kill them. When no blazing or burning mephit is left alive, Falto, Lord of Thunder appears at /loc 5469, -574.",
   "While Falto fights, level 60 blazing and burning mephit adds spawn around him once a minute.",
   "When Falto dies, the Decrepit Ent is replaced by a Vivacious Ent. Say 'ready to return' to it and your group goes back to Relv. If nobody is left in the burning forest, the event ends and resets.",
   "Hand the Lightning Crystals that Falto drops to Relv for the Ruby Pendant with a Gold Chain and 50,000 experience."
  ],
  "npcs": [
   {
    "npcId": 210470,
    "name": "Falto, Lord of Thunder",
    "level": 70,
    "hp": 305000
   },
   {
    "npcId": 210459,
    "name": "a blazing mephit",
    "level": 62,
    "hp": 30000,
    "kills": 15,
    "killsNote": "about half of the 30 mephits"
   },
   {
    "npcId": 210460,
    "name": "a burning mephit",
    "level": 62,
    "hp": 30000,
    "kills": 15,
    "killsNote": "about half of the 30 mephits"
   },
   {
    "npcId": 210462,
    "name": "a fiery mepheeka",
    "level": 56,
    "hp": 13500,
    "kills": 90,
    "killsNote": "3 spawn per mephit; you do not have to kill them"
   },
   {
    "npcId": 210487,
    "name": "a vivacious ent",
    "level": 58,
    "hp": 14400
   }
  ],
  "rewards": [
   {
    "itemId": 7755,
    "name": "Ruby Pendant with a Gold Chain",
    "trigger": "Hand the Lightning Crystals (a Falto drop) to Relv the Mysterious; 50,000 experience"
   }
  ],
  "cites": [
   "postorms/encounters/Relv.lua:1-9",
   "postorms/encounters/Relv.lua:107-132",
   "postorms/encounters/Relv.lua:134-177",
   "postorms/encounters/Relv.lua:179-212",
   "postorms/encounters/Relv.lua:214-293",
   "postorms/encounters/Relv.lua:320-328",
   "postorms/script_init.lua:7"
  ]
 },
 {
  "slug": "postorms-drornok",
  "zone": "postorms",
  "zoneName": "Plane of Storms",
  "name": "Drornok Tok Vo`Lok (Grenidor caves, Lok frog king)",
  "kind": "optional",
  "kindWhy": "Optional fight in the Grenidor caves. It sets no flag and gives no quest item, only gear and parchment drops. The Karana and Askr chain does not use him.",
  "start": "Clear the cave: kill all 32 of its spawns, and make sure none of the typhoon amphans, tempest toads, hurricane loktoles or vacillating loktoles is left alive. Drornok Tok Vo`Lok then appears.",
  "timers": "While Drornok is up, the cave's respawns are off. After he dies each cave spawn returns after 50 to 60 minutes. Adds leave 3 minutes after spawning if not in combat. He calls adds every 2 minutes.",
  "mechanics": [
   "Drornok appears at /loc -180, -46 with 20 random cave mobs placed around the cave.",
   "In a fight, every 2 minutes he spawns 4 random adds near himself."
  ],
  "npcs": [
   {
    "npcId": 210469,
    "name": "Drornok Tok Vo`Lok",
    "level": 65,
    "hp": 175000
   }
  ],
  "rewards": [],
  "cites": [
   "postorms/encounters/Drornok.lua:1-40",
   "postorms/encounters/Drornok.lua:44-84",
   "postorms/encounters/Drornok.lua:86-118",
   "postorms/encounters/Drornok.lua:135"
  ]
 },
 {
  "slug": "postorms-gurebk",
  "zone": "postorms",
  "zoneName": "Plane of Storms",
  "name": "Gurebk, Lord of Krendic (Krendic storm giants)",
  "kind": "flag",
  "kindWhy": "Gurebk, Lord of Krendic, is guaranteed to drop Krendic Esoteric Medallions. They belong to the set the Karana flag turn-in needs. The combine is not in the scripts. Treated as part of the flag path.",
  "start": "Nothing to start. Gurebk cannot be attacked until every trash giant around him is dead. This is checked 5 seconds after he spawns and after each trash giant dies. He hides again after 1 hour if not engaged.",
  "timers": "The hide timer is 1 hour and stops while he fights. Adds come every 20 seconds and leave after 2 min 50 s. While he is active, trash giants that respawn are removed at once.",
  "mechanics": [
   "Gurebk spawns carrying 5 Krendic medallions, plus three more with a 50% chance each. In a PvP instance he carries 3 and two more at 50%. Trash giants each carry one with a 20% chance (2% in a PvP instance).",
   "Once active, every 20 seconds in a fight he spawns 4 to 6 level 56 adds: scorpiocos, scorponnis, cactores and cactorics. No more than 6 stay alive.",
   "Adds appear within 100 units either side of him."
  ],
  "npcs": [
   {
    "npcId": 210332,
    "name": "Gurebk, Lord of Krendic",
    "level": 70,
    "hp": 305000
   },
   {
    "npcId": 210035,
    "name": "a jotna fannsk",
    "level": 62,
    "hp": 35700
   },
   {
    "npcId": 210407,
    "name": "a jotna fannsk",
    "level": 62,
    "hp": 40000
   },
   {
    "npcId": 210022,
    "name": "a jotna her megir",
    "level": 62,
    "hp": 31800
   }
  ],
  "rewards": [],
  "cites": [
   "postorms/encounters/Gurebk.lua:1-17",
   "postorms/encounters/Gurebk.lua:19-53",
   "postorms/encounters/Gurebk.lua:55-124"
  ]
 },
 {
  "slug": "postorms-jeplak",
  "zone": "postorms",
  "zoneName": "Plane of Storms",
  "name": "Jeplak, Lord of Srerendi (fake then real)",
  "kind": "flag",
  "kindWhy": "Jeplak, Lord of Srerendi, has a fake and then a real fight. The real one carries Srerendi Esoteric Medallions for the Karana flag chain (via an Esoteric Meld; the combine is not in the scripts).",
  "start": "Two stages. The fake Jeplak (level 65) can be attacked once all 23 spawn points around him are dead. At that moment 8 more hleyta trash appear. Killing him brings the real Jeplak at /loc -3159, 348 and a confused castaway at /loc -2513, 346. The real Jeplak can be attacked once the 11 spawn points of his stage are dead.",
  "timers": "The hide timer is 1 hour and stops while he fights. If it runs out on the real Jeplak, he leaves and the fake one comes back. Adds come every minute and leave after 57 seconds.",
  "mechanics": [
   "The real Jeplak carries 5 Srerendi medallions, always. Trash giants carry one with a 20% chance (2% in a PvP instance). Their respawns vanish while the real Jeplak is active.",
   "In a fight, every minute the real Jeplak spawns 7 adds, mangled travelers and lost souls, north of him.",
   "The confused castaway just explains the fake Jeplak. Hail him and say 'yes' or 'you did', then 'jeplak', and he leaves."
  ],
  "npcs": [
   {
    "npcId": 210472,
    "name": "Jeplak, Lord of Srerendi",
    "level": 70,
    "hp": 305000
   },
   {
    "npcId": 210403,
    "name": "Jeplak, Lord of Srerendi",
    "level": 65,
    "hp": 177000
   },
   {
    "npcId": 210478,
    "name": "a mangled traveler",
    "level": 56,
    "hp": 14000
   },
   {
    "npcId": 210477,
    "name": "a lost soul",
    "level": 56,
    "hp": 14000
   },
   {
    "npcId": 210099,
    "name": "a hleyta menn",
    "level": 61,
    "hp": 31700
   },
   {
    "npcId": 210419,
    "name": "a hleyta menn",
    "level": 62,
    "hp": 17100
   },
   {
    "npcId": 210056,
    "name": "a hleytis maor",
    "level": 62,
    "hp": 40000
   }
  ],
  "rewards": [],
  "cites": [
   "postorms/encounters/Jeplak.lua:1-29",
   "postorms/encounters/Jeplak.lua:47-112",
   "postorms/encounters/Jeplak.lua:114-171",
   "postorms/encounters/Jeplak.lua:173-227",
   "postorms/a_confused_castaway.lua:1-25"
  ]
 },
 {
  "slug": "postorms-neffiken",
  "zone": "postorms",
  "zoneName": "Plane of Storms",
  "name": "Neffiken, Lord of Kelek`Vor (+ Dolshak the Ornery)",
  "kind": "flag",
  "kindWhy": "Neffiken, Lord of Kelek`Vor, is guaranteed to drop at least 5 Kelek`Vor Esoteric Medallions, part of the set for the Karana flag chain. The combine is not in the scripts.",
  "start": "Nothing to start. Neffiken can be attacked once all the trash giants around him are dead. He hides again after 1 hour if not engaged.",
  "timers": "The hide timer is 1 hour and stops while he fights. Ents come every 35 seconds and leave after 2 min 50 s. When Neffiken dies, Dolshak the Ornery comes back after a random 15 to 60 minutes. Dolshak leaves after 15 minutes out of combat or 70 minutes in all, and does not appear while Neffiken is up.",
  "mechanics": [
   "Neffiken spawns with 5 Kelek`Vor medallions, plus three more at 50% each. Trash giants carry one with a 20% chance (2% in a PvP instance).",
   "In a fight, every 35 seconds he spawns 5 to 8 ents south of him in a half circle, 50 to 100 units away. No more than 8 stay alive.",
   "Dolshak the Ornery is a side spawn that always drops a Polished Obsidian Tomahawk. What it is for is not in the scripts."
  ],
  "npcs": [
   {
    "npcId": 210251,
    "name": "Neffiken, Lord of Kelek`Vor",
    "level": 70,
    "hp": 305000
   },
   {
    "npcId": 210468,
    "name": "Dolshak the Ornery",
    "level": 65,
    "hp": 305000
   },
   {
    "npcId": 210038,
    "name": "an irmin fannsk",
    "level": 62,
    "hp": 29400
   },
   {
    "npcId": 210411,
    "name": "an irmin fannsk",
    "level": 62,
    "hp": 31800
   },
   {
    "npcId": 210015,
    "name": "an irmin her megir",
    "level": 62,
    "hp": 40000
   },
   {
    "npcId": 210479,
    "name": "a maligned ent",
    "level": 57,
    "hp": 14400
   },
   {
    "npcId": 210480,
    "name": "a manipulated ent",
    "level": 57,
    "hp": 14400
   },
   {
    "npcId": 210481,
    "name": "a restrained ent",
    "level": 57,
    "hp": 14400
   }
  ],
  "rewards": [],
  "cites": [
   "postorms/encounters/Neffiken.lua:1-16",
   "postorms/encounters/Neffiken.lua:21-46",
   "postorms/encounters/Neffiken.lua:57-139",
   "postorms/Dolshak_the_Ornery.lua:1-22"
  ]
 },
 {
  "slug": "postorms-stonruak",
  "zone": "postorms",
  "zoneName": "Plane of Storms",
  "name": "Ston`Ruak, Ancient of the Trees (Koka`Vor tree city)",
  "kind": "optional",
  "kindWhy": "Optional fight in the Koka`Vor tree city. It gives loot (Storm Rider Blood and Skin, gear), but no flag or medallion. Whether Storm Rider Blood is part of a flag is not in the scripts.",
  "start": "Two phases. Phase 1: kill 38 of the Koka`Vor guards (senvar and krovian) until none are left. Phase 2: 8 Koka`Vor Elders and Chieftains appear at set spots. When none are alive, Ston`Ruak appears at /loc 669, -206.",
  "timers": "Totem adds come every 35 seconds in a fight and leave after 2 min 50 s. Trash that respawns during phase 2, or while Ston`Ruak is up, is removed at once.",
  "mechanics": [
   "Every 35 seconds in a fight, 5 to 8 totem adds appear: earthen spirits, advisors and bark spirits. No more than 8 stay alive.",
   "The kill count starts again when Ston`Ruak appears."
  ],
  "npcs": [
   {
    "npcId": 210471,
    "name": "Ston`Ruak, Ancient of the Trees",
    "level": 70,
    "hp": 305000
   },
   {
    "npcId": 210466,
    "name": "a Koka`Vor Elder",
    "level": 63,
    "hp": 105000
   },
   {
    "npcId": 210465,
    "name": "a Koka`Vor Chieftain",
    "level": 63,
    "hp": 105000
   },
   {
    "npcId": 210458,
    "name": "an earthen spirit",
    "level": 57,
    "hp": 14500
   },
   {
    "npcId": 210463,
    "name": "a Koka`Vor advisor",
    "level": 57,
    "hp": 14600
   },
   {
    "npcId": 210464,
    "name": "a Koka`Vor bark spirit",
    "level": 57,
    "hp": 14600
   }
  ],
  "rewards": [],
  "cites": [
   "postorms/encounters/StonRuak.lua:1-28",
   "postorms/encounters/StonRuak.lua:30-82",
   "postorms/encounters/StonRuak.lua:84-137"
  ]
 },
 {
  "slug": "postorms-minibosses",
  "zone": "postorms",
  "zoneName": "Plane of Storms",
  "name": "Storm giant mini-bosses (Zertuken, Solnebk, Pendubk, Paruek, Laruken, Faruek)",
  "kind": "flag",
  "kindWhy": "Each storm giant mini-boss spawns holding 1 to 3 Esoteric Medallions of its tribe. They feed the Karana flag chain. Laruken and Zertuken carry Kelek`Vor, Paruek and Faruek carry Srerendi, and Pendubk and Solnebk carry Krendic.",
  "start": "Nothing to start: they roam. Fighting one brings storm adds.",
  "timers": "A storm comes every minute in a fight and each storm leaves after 9 seconds.",
  "mechanics": [
   "Each carries 1 to 3 medallions (at most 2 in a PvP instance).",
   "In a fight, every minute 7 to 10 tumultuous storms appear within 75 units."
  ],
  "npcs": [
   {
    "npcId": 210026,
    "name": "Laruken the Rigid",
    "level": 65,
    "hp": 177000
   },
   {
    "npcId": 210027,
    "name": "Zertuken the Unyielding",
    "level": 65,
    "hp": 177000
   },
   {
    "npcId": 210028,
    "name": "Paruek the Strong",
    "level": 65,
    "hp": 177000
   },
   {
    "npcId": 210029,
    "name": "Faruek the Bold",
    "level": 65,
    "hp": 177000
   },
   {
    "npcId": 210032,
    "name": "Pendubk the Turbulent",
    "level": 65,
    "hp": 177000
   },
   {
    "npcId": 210033,
    "name": "Solnebk the Unruly",
    "level": 65,
    "hp": 177000
   }
  ],
  "rewards": [],
  "cites": [
   "postorms/encounters/MiniBosses.lua:1-25",
   "postorms/encounters/MiniBosses.lua:27-54"
  ]
 },
 {
  "slug": "postorms-askr-karana-flag",
  "zone": "postorms",
  "zoneName": "Plane of Storms",
  "name": "Askr the Lost - Karana flag chain (Bastion of Thunder access)",
  "kind": "flag",
  "kindWhy": "Askr the Lost's chain moves the Karana flag from step 1 to step 2. The shrine door then opens the Bastion of Thunder to anyone with Karana step 2 and the Mavuin flag at step 3.",
  "start": "Hail Askr the Lost and answer him ('it was me', 'paying attention', 'yes', 'continue' and so on). Hand him a giant head (wind, desert or forest) and he returns a Storm Giant Head. At the right point, 'continue' gives you Askr's Bag of Verity. Hand in Askr's Sealed Bag of Verity (Karana step 0 to 1, 1,000 experience). Hand in the Esoteric Meld (step 1 to 2, 10,000 experience). Click the shrine door in the zone with Karana step 2 and Mavuin step 3 to get the Bastion of Thunder zone flag and Karana step 3.",
  "timers": "None. The flag is permanent. Askr forgets your conversation when you leave the zone.",
  "mechanics": [
   "The Esoteric Meld is made from the three tribal Esoteric Medallions. The recipe is not in the scripts.",
   "The shrine door also needs the Mavuin flag at step 3, from the Plane of Justice chain."
  ],
  "npcs": [],
  "rewards": [
   {
    "itemId": 17192,
    "name": "Askr's Bag of Verity",
    "trigger": "Given by Askr at the right point of his talk, or when you say 'bastion of thunder' at Karana step 1"
   },
   {
    "itemId": 11486,
    "name": "Storm Giant Head",
    "trigger": "Returned when you hand in a tribal giant head"
   }
  ],
  "cites": [
   "postorms/Askr_the_Lost.lua:75-152",
   "postorms/Askr_the_Lost.lua:154-196",
   "postorms/player.lua:1-27"
  ]
 },
 {
  "slug": "potactics-tallon-zek",
  "zone": "potactics",
  "zoneName": "Drunder, the Fortress of Zek",
  "name": "Tallon Zek (south wing)",
  "kind": "flag",
  "kindWhy": "Tallon's half of the Zeks flag series. His death brings a Planar Projection. Zeks step 2 opens the Drunder door. Step 5 needs both twins, and step 6 comes from Maelin in the Plane of Knowledge.",
  "groupLimit": "The projection flags the killer's raid, group or solo player, up to 72 players.",
  "start": "Pull Tallon Zek in the south wing.",
  "timers": "In a fight, every 20 seconds he teleports to a random spot in the room and wipes his hate. When the fight ends he returns to his spawn. The projection stays 20 minutes.",
  "mechanics": [
   "He casts his harmful spells faster than normal, about every 3.5 seconds.",
   "When he dies, a Planar Projection appears for the killer. Hail it to move from Zeks step 2 to 4, or from step 3 to 5.",
   "If you are below Zeks step 2 and have no Tallon checklist flag, you get that instead."
  ],
  "npcs": [
   {
    "npcId": 214026,
    "name": "Tallon Zek",
    "level": 73,
    "hp": 440000
   }
  ],
  "rewards": [],
  "cites": [
   "potactics/214026.lua:1-30",
   "potactics/214323.lua:1-57",
   "poknowledge/Seer_Mal_Nae-Shi.lua:1-43"
  ]
 },
 {
  "slug": "potactics-vallon-zek",
  "zone": "potactics",
  "zoneName": "Drunder, the Fortress of Zek",
  "name": "Vallon Zek (north wing, splitting illusion)",
  "kind": "flag",
  "kindWhy": "Vallon's half of the Zeks flag series. The real Vallon's death brings a Planar Projection.",
  "groupLimit": "The projection flags the killer's raid, group or solo player, up to 72 players.",
  "start": "Pull Vallon Zek (level 73, 175,000 HP) in the north wing.",
  "timers": "Each Vallon copy leaves 2 minutes after appearing, and the clock stops in combat. If the real one times out, the base spawn is restored. The room is checked every 6 seconds.",
  "mechanics": [
   "At 50% health each Vallon says he 'fades into the shadows as five figures take shape' and leaves. Five copies appear: one real (level 64, 84,000 HP) and four fakes (42,000 HP).",
   "The real one splits again at 50%, up to four times in all.",
   "When the real Vallon dies, a Planar Projection appears. Hail it to move from Zeks step 2 to 3, or from step 4 to 5.",
   "If you are below Zeks step 2 and have no Vallon checklist flag, you get that instead.",
   "A Vallon that leaves the room is sent back."
  ],
  "npcs": [
   {
    "npcId": 214316,
    "name": "Vallon Zek",
    "level": 73,
    "hp": 175000
   },
   {
    "npcId": 214317,
    "name": "Vallon Zek",
    "level": 64,
    "hp": 84000
   },
   {
    "npcId": 214318,
    "name": "Vallon Zek",
    "level": 64,
    "hp": 42000
   },
   {
    "npcId": 214319,
    "name": "Vallon Zek",
    "level": 64,
    "hp": 42000
   }
  ],
  "rewards": [],
  "cites": [
   "potactics/214316.lua:1-45",
   "potactics/214317.lua:1-70",
   "potactics/214318.lua:1-20",
   "potactics/214324.lua:1-57"
  ]
 },
 {
  "slug": "potactics-rallos-zek",
  "zone": "potactics",
  "zoneName": "Drunder, the Fortress of Zek",
  "name": "Rallos Zek / the Warlord (War Room)",
  "kind": "raid-boss",
  "kindWhy": "The flag boss of Drunder, in three phases. The Warlord's death brings a Planar Projection. With Zeks step 6, hailing it gives Zeks step 7, which the Tower of Solusek Ro needs. Otherwise you get a checklist flag.",
  "groupLimit": "The projection flags up to 72 players. There is no raid cap in the script. The state of the arena is kept per guild.",
  "start": "Kill both War Room door guards, Decorin Berik and Decorin Grunhork, while the event is ready to begin.",
  "timers": "After a win the guards are on a 66 hour cooldown, and the arena is restored 30 minutes later. After a fail there is a 10 minute wait. Rallos upstairs can idle for 19 min 30 s and the Warlord for 20 minutes before the attempt fails. Elite waves come 20 seconds after the fight begins, then every 50 seconds. In the pit, the corpses twitch every 55 seconds and the wraiths come 10 seconds later.",
  "mechanics": [
   "Phase 1, the Brothers: Tallon Zek appears at /loc -560, 621 and Vallon Zek at /loc 581, 594. They walk to the council room. Vallon splits as in his wing. Both must die.",
   "Phase 2, upstairs: Rallos Zek (750,000 HP) appears where the brothers died. Every 50 seconds in a fight two Decorin Elites appear, at /loc 581, 1060 and /loc -560, 1060. At 75% health the arena's spawns are switched off. At 50% Rallos jumps down and leaves.",
   "Phase 3, the pit: Rallos Zek the Warlord (1,050,000 HP) appears at /loc 0, 705. The corpses of the unworthy twitch and become Chaos Wraiths every 55 seconds, and two Chaos Boars come with each wave. If he leaves the pit he is reset.",
   "A fail in any phase (idle time out, Rallos dying early, adds that fail to appear) puts the event into a 10 minute wait."
  ],
  "npcs": [
   {
    "npcId": 214312,
    "name": "Rallos Zek the Warlord",
    "level": 75,
    "hp": 1050000
   },
   {
    "npcId": 214311,
    "name": "Rallos Zek",
    "level": 75,
    "hp": 750000
   },
   {
    "npcId": 214313,
    "name": "Tallon Zek",
    "level": 73,
    "hp": 440000
   },
   {
    "npcId": 214320,
    "name": "Vallon Zek",
    "level": 73,
    "hp": 225000
   },
   {
    "npcId": 214289,
    "name": "A Decorin Elite",
    "level": 68,
    "hp": 71000
   },
   {
    "npcId": 214056,
    "name": "Decorin Berik",
    "level": 68,
    "hp": 69400
   },
   {
    "npcId": 214057,
    "name": "Decorin Grunhork",
    "level": 68,
    "hp": 69600
   }
  ],
  "rewards": [],
  "cites": [
   "potactics/encounters/Rallos.lua:1-60",
   "potactics/encounters/Rallos.lua:262-315",
   "potactics/encounters/Rallos.lua:507-566",
   "potactics/encounters/Rallos.lua:597-664",
   "potactics/encounters/Rallos.lua:707-744",
   "potactics/214322.lua:1-50"
  ]
 },
 {
  "slug": "potactics-named-optional",
  "zone": "potactics",
  "zoneName": "Drunder, the Fortress of Zek",
  "name": "Named side mobs: Glykus Helmir, Tagrin Maldric, Anival the Blade, Hinvat Deathbringer, Diaku Overseer, Eriak",
  "kind": "optional",
  "kindWhy": "Named side mobs with loot and no flag. Their scripts handle evolving boars, blade spawns, splitting and quest text. Eriak gives A Vial of Black Blood only once you are past Zeks step 4. The Diaku Emblem pieces for the alternate-access key quest are not in these loot tables.",
  "start": "Nothing to start: pull Glykus Helmir, Tagrin Maldric, Anival the Blade, Hinvat Deathbringer, the Diaku Overseer or Eriak.",
  "timers": "Glykus evolves a boar every 59 seconds. Anival's copy leaves after 6 minutes.",
  "mechanics": [
   "Glykus Helmir evolves a Fledgling War Boar through enraged, fierce, greater and enchanted war boars on the five boar spawn points.",
   "Tagrin Maldric spawns Animated Decorin Blades at four spots. Some drop a Decorin Ore Shard and some a Useless Hunk of Metal.",
   "Anival the Blade splits below 50% health (75% of the time) into two copies, one with nothing to drop.",
   "Eriak: past Zeks step 4, say 'blood' to be given A Vial of Black Blood."
  ],
  "npcs": [
   {
    "npcId": 214053,
    "name": "Glykus Helmir",
    "level": 67,
    "hp": 130000
   },
   {
    "npcId": 214054,
    "name": "Tagrin Maldric",
    "level": 70,
    "hp": 150000
   },
   {
    "npcId": 214033,
    "name": "Anival the Blade",
    "level": 69,
    "hp": 73500
   },
   {
    "npcId": 214075,
    "name": "Hinvat Deathbringer",
    "level": 70,
    "hp": 76600
   },
   {
    "npcId": 214092,
    "name": "The Diaku Overseer",
    "level": 70,
    "hp": 76550
   },
   {
    "npcId": 214073,
    "name": "Eriak",
    "level": 70,
    "hp": 230000
   }
  ],
  "rewards": [
   {
    "itemId": 28592,
    "name": "A Vial of Black Blood",
    "trigger": "Say 'blood' to Eriak when you are past Zeks step 4"
   }
  ],
  "cites": [
   "potactics/Glykus_Helmir.lua:1-90",
   "potactics/Tagrin_Maldric.lua:1-80",
   "potactics/#Anival_the_Blade.lua:1-35",
   "potactics/Eriak.lua:1-26"
  ]
 },
 {
  "slug": "potimea-dial-hub",
  "zone": "potimea",
  "zoneName": "Plane of Time (A)",
  "name": "Plane of Time A: dial hub (starts the Time B instance)",
  "kind": "flag",
  "kindWhy": "The way into the Plane of Time B. You need the Time flag, from the time-machine door in the Plane of Innovation, and the Plane of Time zone flag. Clicking a dial sends your raid to a Time B instance.",
  "size": "90 players",
  "groupLimit": "90 players per Time B instance. One instance per raid. Each character can have one entry in progress. In Phase 1, a trial room takes up to 18 players.",
  "start": "Click one of the five dials in the Plane of Time A. When Time A is idle, the first click starts a new Time B instance for your raid. The graveyard tombstone door is handled by script so it does not send you to the public copy.",
  "timers": "The instance cycle lasts 6 days 18 hours, with a 10 minute grace if it is empty. After an instance ends there is a 2 minute wait. A pending entry expires after 60 seconds.",
  "mechanics": [
   "Loot lockouts from other raids are checked before you enter. A broken or partial record does not let a character in."
  ],
  "npcs": [],
  "rewards": [],
  "cites": [
   "potimea/219053.lua:1-130",
   "potimea/player.lua:1-60",
   "lua_modules/potime_cycle.lua:1-26",
   "poinnovation/player.lua:17-27",
   "potranquility/player.lua:146-153"
  ]
 },
 {
  "slug": "potimeb-phase1-trials",
  "zone": "potimeb",
  "zoneName": "Plane of Time (B)",
  "name": "Phase 1: five elemental trials (Terlok of Earth, Neimon of Air, Rythor of the Undead, Anar of Water, Kazrok of Fire)",
  "kind": "optional",
  "kindWhy": "Time content past the flag chain. It sets no flag. Each boss drops loot and counts toward the next phase. A boss already killed in the last 12 hours comes back as a 'Shadow of' version.",
  "size": "90 players",
  "groupLimit": "A Time B instance holds up to 90 players. A trial starts when the first player stands in its room.",
  "start": "Walk into one of the five trial rooms. The trial starts 44 seconds later.",
  "timers": "Each boss has a 12 hour loot lockout in Phase 1. The Time B cycle lasts 6 days 18 hours.",
  "mechanics": [
   "Earth, Terlok of Earth: waves of living rubble and rock-shaped assassins come in, then the boss.",
   "Water, Anar of Water: triloun gatherers and deepwater trilouns. The boss appears after 7 kills.",
   "Fire, Kazrok of Fire: flame and inferno mephits. The boss comes with add waves at 9 and 16 kills.",
   "Air, Neimon of Air: phoenix nobles and servitors. The boss appears after 4 and 9 kills.",
   "Undead, Rythor of the Undead: undead guardians in 3 waves and protectors, then the boss."
  ],
  "npcs": [
   {
    "npcId": 223032,
    "name": "Terlok of Earth",
    "level": 68,
    "hp": 250000
   },
   {
    "npcId": 223037,
    "name": "Anar of Water",
    "level": 68,
    "hp": 250000
   },
   {
    "npcId": 223018,
    "name": "Kazrok of Fire",
    "level": 68,
    "hp": 200000
   },
   {
    "npcId": 223044,
    "name": "Neimon of Air",
    "level": 68,
    "hp": 200000
   },
   {
    "npcId": 223029,
    "name": "Rythor of the Undead",
    "level": 68,
    "hp": 250000
   }
  ],
  "rewards": [],
  "cites": [
   "potimeb/encounters/Phase1Earth.lua:1-70",
   "potimeb/encounters/Phase1Water.lua:1-70",
   "potimeb/encounters/Phase1Fire.lua:1-95",
   "potimeb/encounters/Phase1Air.lua:1-80",
   "potimeb/encounters/Phase1Undead.lua:1-85",
   "potimeb/223077.lua:168-185",
   "potimeb/223077.lua:445-470"
  ]
 },
 {
  "slug": "potimeb-phase2",
  "zone": "potimeb",
  "zoneName": "Plane of Time (B)",
  "name": "Phase 2: elemental war champions (Windshapen Warlord, Earthen Overseer, Ralthos Enrok, War Shapen Emissary, Gutripping War Beast)",
  "kind": "optional",
  "kindWhy": "Time content. It sets no flag. It adds 1 hour to the attempt clock.",
  "start": "It begins when Phase 1 is done. Three lanes open: top, middle and bottom.",
  "timers": "The boss loot lockout is 3 days 12 hours. The attempt clock gets 1 extra hour.",
  "mechanics": [
   "Top lane: the Windshapen Warlord of Air and the Earthen Overseer, with elemental stonefists, unholy rock fiends and Champions of Korascian.",
   "Middle lane: undead guardians come in waves. Kill the first two and two more come. Kill those and the skeleton guardians and a wizard come. Kill five of them and Ralthos Enrok appears. At 75% and 25% health he calls two summoned guardians each time, up to four in all.",
   "Bottom lane: the War Shapen Emissary and the Gutripping War Beast, with crustacean champions, watercrafted hunters, deepwater assassins, warboars, doombringers and smoldering elementals.",
   "When a lane is cleared, ethereal mists gather at the far wall. The phase is done once 54 kills are counted and no champion is left alive.",
   "A champion that is still under the lockout comes back as a 'Shadow of' version with no loot."
  ],
  "npcs": [
   {
    "npcId": 223075,
    "name": "Windshapen Warlord of Air",
    "level": 67,
    "hp": 200000
   },
   {
    "npcId": 223072,
    "name": "Earthen Overseer",
    "level": 67,
    "hp": 200000
   },
   {
    "npcId": 223076,
    "name": "Ralthos Enrok",
    "level": 69,
    "hp": 250000
   },
   {
    "npcId": 223074,
    "name": "War Shapen Emissary",
    "level": 67,
    "hp": 200000
   },
   {
    "npcId": 223073,
    "name": "Gutripping War Beast",
    "level": 67,
    "hp": 200000
   }
  ],
  "rewards": [],
  "cites": [
   "potimeb/encounters/Phase2.lua:1-60",
   "potimeb/encounters/Phase2.lua:148-180",
   "potimeb/encounters/Phase2.lua:234-340",
   "potimeb/223077.lua:1157-1175"
  ]
 },
 {
  "slug": "potimeb-phase3",
  "zone": "potimeb",
  "zoneName": "Plane of Time (B)",
  "name": "Phase 3: nine waves of the gods' champions (Warboars, Deathbringers, Avatar of the Elements, Supernatural Guardian)",
  "kind": "optional",
  "kindWhy": "Time content. It sets no flag. It adds 1 hour 15 minutes to the attempt clock.",
  "start": "It begins when Phase 2 is done. The first wave comes at once.",
  "timers": "The boss loot lockout is 3 days 12 hours. The mobs link their hate every 2 seconds. Each wave ends after 10 kills, and wave 9 after 2.",
  "mechanics": [
   "Waves 1 to 8 are each a named pair and eight adds: a Ferocious Warboar and Deathbringer Blackheart; Xeroan Xi`Geruonask and Kraksmaal Fir`Dethsin; a Deadly Warboar and Deathbringer Skullsmash; Herlsoakian and Sinrunal Gorgedreal; Deathbringer Rianit and a Needletusk Warboar; Xerskel Gerodnsal and Dersool Fal`Giersnaol; an Undead Squad Leader and a Dark Knight of Terris; a Champion of Torment and Dreamwarp.",
   "Wave 9 is only the Avatar of the Elements and the Supernatural Guardian."
  ],
  "npcs": [
   {
    "npcId": 223084,
    "name": "A Ferocious Warboar",
    "level": 71,
    "hp": 220000
   },
   {
    "npcId": 223083,
    "name": "Deathbringer Blackheart",
    "level": 71,
    "hp": 220000
   },
   {
    "npcId": 223090,
    "name": "Xeroan Xi`Geruonask",
    "level": 71,
    "hp": 220000
   },
   {
    "npcId": 223091,
    "name": "Kraksmaal Fir`Dethsin",
    "level": 71,
    "hp": 220000
   },
   {
    "npcId": 223096,
    "name": "A Deadly Warboar",
    "level": 71,
    "hp": 220000
   },
   {
    "npcId": 223097,
    "name": "Deathbringer Skullsmash",
    "level": 71,
    "hp": 220000
   },
   {
    "npcId": 223101,
    "name": "Herlsoakian",
    "level": 71,
    "hp": 220000
   },
   {
    "npcId": 223105,
    "name": "Sinrunal Gorgedreal",
    "level": 71,
    "hp": 220000
   },
   {
    "npcId": 223109,
    "name": "Deathbringer Rianit",
    "level": 71,
    "hp": 220000
   },
   {
    "npcId": 223108,
    "name": "A Needletusk Warboar",
    "level": 71,
    "hp": 220000
   },
   {
    "npcId": 223115,
    "name": "Xerskel Gerodnsal",
    "level": 71,
    "hp": 220000
   },
   {
    "npcId": 223116,
    "name": "Dersool Fal`Giersnaol",
    "level": 71,
    "hp": 220000
   },
   {
    "npcId": 223124,
    "name": "Undead Squad Leader",
    "level": 71,
    "hp": 220000
   },
   {
    "npcId": 223123,
    "name": "Dark Knight of Terris",
    "level": 71,
    "hp": 220000
   },
   {
    "npcId": 223132,
    "name": "Champion of Torment",
    "level": 71,
    "hp": 220000
   },
   {
    "npcId": 223131,
    "name": "Dreamwarp",
    "level": 71,
    "hp": 220000
   },
   {
    "npcId": 223134,
    "name": "Avatar of the Elements",
    "level": 72,
    "hp": 700000
   },
   {
    "npcId": 223133,
    "name": "Supernatural Guardian",
    "level": 72,
    "hp": 580000
   }
  ],
  "rewards": [],
  "cites": [
   "potimeb/encounters/Phase3.lua:1-60",
   "potimeb/encounters/Phase3.lua:97-143",
   "potimeb/encounters/Phase3.lua:230-262"
  ]
 },
 {
  "slug": "potimeb-phase4-gods-torment",
  "zone": "potimeb",
  "zoneName": "Plane of Time (B)",
  "name": "Phase 4: Vallon Zek, Tallon Zek, Terris Thule, Saryrn",
  "kind": "raid-boss",
  "kindWhy": "The first four gods of the Time chain: Vallon Zek, Tallon Zek, Terris Thule and Saryrn. The script sets no flag.",
  "start": "It begins when Phase 3 is done.",
  "timers": "Each god has a loot lockout of 6 days 12 hours. The attempt clock gets 1 extra hour for each god not yet killed. Health events fire at 95%, 50% and 10% (90%, 50% and 10% for the second pair). Health is checked every 3 seconds.",
  "mechanics": [
   "The gods have 1,100,000 to 1,400,000 HP.",
   "Terris adds a Phantasm of Terris, a Nightmare Knight of Terris, a Summoned Guardian of Terris and a Summoned Knight of Terris.",
   "Saryrn adds a Mouth of Insanity, a Mouth of Dementia and a Tormentor."
  ],
  "npcs": [
   {
    "npcId": 223000,
    "name": "Vallon Zek",
    "level": 71,
    "hp": 1400000
   },
   {
    "npcId": 223001,
    "name": "Tallon Zek",
    "level": 71,
    "hp": 1400000
   },
   {
    "npcId": 223002,
    "name": "Terris Thule",
    "level": 71,
    "hp": 1100000
   },
   {
    "npcId": 223003,
    "name": "Saryrn",
    "level": 71,
    "hp": 1400000
   }
  ],
  "rewards": [],
  "cites": [
   "potimeb/encounters/Phase4.lua:1-130",
   "potimeb/encounters/Phase4.lua:160-320",
   "potimeb/223077.lua:170-215"
  ]
 },
 {
  "slug": "potimeb-phase5-gods-war-plague",
  "zone": "potimeb",
  "zoneName": "Plane of Time (B)",
  "name": "Phase 5: Cazic Thule, Bertoxxulous, Rallos Zek, Innoruuk",
  "kind": "raid-boss",
  "kindWhy": "The last four gods of the Time chain: Cazic Thule, Bertoxxulous, Rallos Zek and Innoruuk. The script sets no flag.",
  "start": "It begins when Phase 4 is done.",
  "timers": "Each god has a loot lockout of 6 days 12 hours. Health events fire at 91%, 71%, 56%, 46%, 31% and 11% for the first pair, and 91%, 76%, 51% and 26% for the second. Mobs that wander too far are sent back after 3 seconds.",
  "mechanics": [
   "Each god has 1,700,000 HP.",
   "The adds are a Guardian of the Crypt, a Guardian Knight of Pestilence, a Firebone Caster, an Amygdalan knight, a phoboplasm, an abhorrent and a Cleric of Innoruuk.",
   "At the later health events a god changes: flurry and wild rampage go off, a 5% rampage comes on, and the resists and attack change."
  ],
  "npcs": [
   {
    "npcId": 223004,
    "name": "Cazic Thule",
    "level": 75,
    "hp": 1700000
   },
   {
    "npcId": 223005,
    "name": "Bertoxxulous",
    "level": 75,
    "hp": 1700000
   },
   {
    "npcId": 223006,
    "name": "Rallos Zek",
    "level": 75,
    "hp": 1700000
   },
   {
    "npcId": 223007,
    "name": "Innoruuk",
    "level": 75,
    "hp": 1700000
   }
  ],
  "rewards": [],
  "cites": [
   "potimeb/encounters/Phase5.lua:1-40",
   "potimeb/encounters/Phase5.lua:220-372"
  ]
 },
 {
  "slug": "potimeb-phase6-quarm",
  "zone": "potimeb",
  "zoneName": "Plane of Time (B)",
  "name": "Phase 6: Quarm (with Zebuxoruk and Druzzil)",
  "kind": "raid-boss",
  "kindWhy": "The final boss of the Plane of Time. The script sets no flag. It adds 2 hours to the attempt clock.",
  "start": "It begins when Phase 5 is done.",
  "timers": "Quarm has a loot lockout of 6 days 12 hours. His area attack first comes 10 seconds into the fight, then every 25 to 33 seconds. Vortices come every 25 seconds. His three head events fire near 75%, 50% and 25% health.",
  "mechanics": [
   "Quarm is level 80 with 1,700,000 HP. At each head event his resists and armor change and he casts Balance of the Nameless.",
   "At about 75% his red head explodes and he starts a cold area attack (Drakeen Vortex). At about 50% his blue head explodes and he stuns with an 18 second Timeforged Airblast. At about 25% his white head explodes and he casts a Venomed Mist that drains 500 mana a tick.",
   "Vortices and eggs appear during the fight.",
   "After he dies the egg can be attacked. Killing it brings Zebuxoruk, who speaks. Druzzil appears, and then everyone is sent back to the Plane of Knowledge."
  ],
  "npcs": [
   {
    "npcId": 223008,
    "name": "Quarm",
    "level": 80,
    "hp": 1700000
   },
   {
    "npcId": 223158,
    "name": "a time vortex",
    "level": 68,
    "hp": 100000
   },
   {
    "npcId": 223159,
    "name": "Zebuxoruk",
    "level": 70,
    "hp": 33671
   },
   {
    "npcId": 223160,
    "name": "Druzzil Ro",
    "level": 80,
    "hp": 45625
   }
  ],
  "rewards": [],
  "cites": [
   "potimeb/encounters/Phase6.lua:1-60",
   "potimeb/encounters/Phase6.lua:125-240",
   "potimeb/encounters/Phase6.lua:270-335",
   "potimeb/223077.lua:170-190"
  ]
 },
 {
  "slug": "potorment-saryrn",
  "zone": "potorment",
  "zoneName": "Torment, the Plane of Pain",
  "name": "Saryrn (Citadel) + Sorrowsong + Planar Projection",
  "kind": "raid-boss",
  "kindWhy": "The flag boss of the Plane of Torment. Her death brings a Planar Projection that gives the Saryrn flag. You need Tylis step 2, and you cannot already have the Saryrn or Cipher flag.",
  "groupLimit": "The projection flags up to 72 players, only for those with kill credit.",
  "start": "Pull Saryrn. When she appears, Sorrowsong appears with her.",
  "timers": "Every 5 seconds in a fight it checks that she has not left her area. She resets when out of combat and healed. The projection stays 30 minutes.",
  "mechanics": [
   "Health events fire at 99%, 90%, 80%, 70%, 60%, 50%, 40%, 30%, 25%, 20% and 10%.",
   "At 99% Saryrn says 'Sorrowsong, sing for us'. Sorrowsong sings the Sorrow Song and patrols, and 5 stair and floor mobs appear at set spots.",
   "At 25% Sorrowsong becomes targetable and attacks.",
   "At every other health event, 3 adds (summoned servants and twisted spirits) appear near her.",
   "If she leaves her area she resets, casts Balance of the Nameless and wipes hate.",
   "When she dies, the stair mobs vanish and a Planar Projection appears on her corpse."
  ],
  "npcs": [
   {
    "npcId": 207001,
    "name": "Saryrn",
    "level": 70,
    "hp": 850000
   },
   {
    "npcId": 207052,
    "name": "Sorrowsong",
    "level": 66,
    "hp": 116000
   },
   {
    "npcId": 207023,
    "name": "An acolyte of Pain",
    "level": 65,
    "hp": 118500
   },
   {
    "npcId": 207284,
    "name": "An acolyte of pain",
    "level": 65,
    "hp": 118500
   },
   {
    "npcId": 207024,
    "name": "A blood soaked guard",
    "level": 65,
    "hp": 88700
   },
   {
    "npcId": 207291,
    "name": "A blood soaked guard",
    "level": 65,
    "hp": 88700
   },
   {
    "npcId": 207306,
    "name": "a summoned servant",
    "level": 59,
    "hp": 15000
   },
   {
    "npcId": 207308,
    "name": "a twisted spirit",
    "level": 59,
    "hp": 15000
   }
  ],
  "rewards": [],
  "cites": [
   "potorment/Saryrn.lua:1-119",
   "potorment/Sorrowsong.lua:1-68",
   "potorment/A_Planar_Projection.lua:1-51",
   "poknowledge/Seer_Mal_Nae-Shi.lua:1-43"
  ]
 },
 {
  "slug": "potorment-maareq",
  "zone": "potorment",
  "zoneName": "Torment, the Plane of Pain",
  "name": "Maareq the Prophet (Tylis entrance via Insanity of Tylis)",
  "kind": "flag",
  "kindWhy": "Part of the Tylis flag series. Maareq's death frees Tylis Newleaf, the entrance NPC. Without it Tylis stays untargetable.",
  "start": "Hail Tylis Newleaf and say 'will assist you'. This needs the Tylis flag and a raid or group member with a Screaming Sphere. Then say 'we are ready' or 'i am ready' and he casts Insanity of Tylis on you.",
  "timers": "A minion comes every 5 seconds in a fight. If he was powered up, he reverts 8 minutes after the fight ends.",
  "mechanics": [
   "Tylis step 1 comes from Fahlia Shadyglade in the Plane of Tranquility. Step 2 comes from the rescued Tylis after the Keeper of Sorrows.",
   "Every 5 seconds in a fight, a minion of Maareq appears at /loc 0, -25 and walks to him.",
   "Each minion that reaches him powers him up. At 10 he gains flurry and grows. At 20 he changes form, loses flurry and gains a wild rampage. At 40 he grows larger and attacks faster.",
   "When Maareq dies, the minions vanish and Tylis Newleaf can be targeted again."
  ],
  "npcs": [
   {
    "npcId": 207004,
    "name": "Maareq the Prophet",
    "level": 70,
    "hp": 850000
   },
   {
    "npcId": 207297,
    "name": "a minion of Maareq",
    "level": 40,
    "hp": 20800
   },
   {
    "npcId": 207014,
    "name": "Tylis Newleaf",
    "level": 35,
    "hp": 875
   }
  ],
  "rewards": [],
  "cites": [
   "potorment/Maareq_the_Prophet.lua:1-98",
   "potorment/Tylis_Newleaf.lua:1-88",
   "potranquility/Fahlia_Shadyglade.lua:44"
  ]
 },
 {
  "slug": "potorment-keeper-of-sorrows",
  "zone": "potorment",
  "zoneName": "Torment, the Plane of Pain",
  "name": "The Keeper of Sorrows (Tylis rescue)",
  "kind": "flag",
  "kindWhy": "The rescue of Tylis. The Keeper's death brings the rescued Tylis Newleaf. Hailing him at Tylis step 1 gives step 2, which the Saryrn projection needs.",
  "groupLimit": "Tylis flags at most 72 players per kill.",
  "start": "Reach and kill the Keeper of Sorrows after Maareq has died.",
  "timers": "Both Tylis copies leave 30 minutes after the Keeper dies. The entrance copy stays usable for that time.",
  "mechanics": [
   "When the Keeper dies, a temporary Tylis Newleaf appears at the entrance and the rescued Tylis Newleaf appears at /loc 368, -176.",
   "Hail the rescued Tylis at Tylis step 1 to reach step 2. You see 'You have received a character flag!'. If you have no Tylis flag and no Keeper checklist flag, you get the checklist flag.",
   "Say 'ready to return' and he casts Torment's Beckon on you."
  ],
  "npcs": [
   {
    "npcId": 207015,
    "name": "The Keeper of Sorrows",
    "level": 66,
    "hp": 100000
   },
   {
    "npcId": 207318,
    "name": "Tylis Newleaf",
    "level": 35,
    "hp": 875
   }
  ],
  "rewards": [],
  "cites": [
   "potorment/The_Keeper_of_Sorrows.lua:1-22",
   "potorment/#Tylis_Newleaf.lua:1-50"
  ]
 },
 {
  "slug": "potorment-argan-baraguj",
  "zone": "potorment",
  "zoneName": "Torment, the Plane of Pain",
  "name": "Argan Milek / A Horrifying Vision / Baraguj Szuul (vision and stomach)",
  "kind": "optional",
  "kindWhy": "Optional vision and stomach event. It sets no flag. Baraguj's reward form holds loot only and is not in the Seer's flag list.",
  "start": "Once Argan Milek has talked to you ('here to aid you'), say 'save' and then 'memories' and he casts Visions of Argan on you. Argan only appears while A Horrifying Vision is up.",
  "timers": "Argan leaves after 30 minutes. The reward form of Baraguj Szuul leaves after 12 hours. The entry Baraguj waits while the reward form is up.",
  "mechanics": [
   "When A Horrifying Vision dies, Argan Milek appears where it stood. Say 'ready' and he moves you on.",
   "When An Unimaginable Horror dies, Baraguj Szuul (the reward form) appears at /loc -1041, 5 and An Unseen Entity at /loc 962, -805. Player corpses in the stomach box are moved to the instance graveyard."
  ],
  "npcs": [
   {
    "npcId": 207047,
    "name": "A Horrifying Vision",
    "level": 65,
    "hp": 86000
   },
   {
    "npcId": 207031,
    "name": "An Unimaginable Horror",
    "level": 64,
    "hp": 110000
   },
   {
    "npcId": 207319,
    "name": "Baraguj Szuul",
    "level": 66,
    "hp": 217000
   }
  ],
  "rewards": [],
  "cites": [
   "potorment/#Argan_Milek.lua:1-14",
   "potorment/Argan_Milek.lua:1-26",
   "potorment/An_Unimaginable_Horror.lua:1-25",
   "potorment/Baraguj_Szuul.lua:1-11",
   "potorment/#Baraguj_Szuul.lua:1-9",
   "potorment/A_Horrifying_Vision.lua:1-3"
  ]
 },
 {
  "slug": "potorment-acolyte-affliction",
  "zone": "potorment",
  "zoneName": "Torment, the Plane of Pain",
  "name": "The Acolyte of Affliction",
  "kind": "optional",
  "kindWhy": "A named mob with loot and no flag or quest.",
  "start": "Nothing to start: pull the Acolyte of Affliction.",
  "timers": "Seedlings come every 50 seconds in a fight and leave after 1 min 40 s.",
  "mechanics": [
   "Every 50 seconds, 5 to 10 construct seedlings appear near him and walk to him.",
   "When he dies, all the seedlings vanish."
  ],
  "npcs": [
   {
    "npcId": 207003,
    "name": "The Acolyte of Affliction",
    "level": 65,
    "hp": 250000
   },
   {
    "npcId": 207295,
    "name": "A construct seedling",
    "level": 56,
    "hp": 7500
   }
  ],
  "rewards": [],
  "cites": [
   "potorment/The_Acolyte_of_Affliction.lua:1-22",
   "potorment/A_construct_seedling.lua:1-28"
  ]
 },
 {
  "slug": "potorment-salczek",
  "zone": "potorment",
  "zoneName": "Torment, the Plane of Pain",
  "name": "Salczek the Fleshgrinder",
  "kind": "optional",
  "kindWhy": "A named mob with one health event. It has loot and no flag.",
  "start": "Nothing to start: pull Salczek the Fleshgrinder.",
  "timers": "None.",
  "mechanics": [
   "At 50% health he gains a 20% wild rampage."
  ],
  "npcs": [
   {
    "npcId": 207027,
    "name": "Salczek the Fleshgrinder",
    "level": 69,
    "hp": 288000
   }
  ],
  "rewards": [],
  "cites": [
   "potorment/Salczek_the_Fleshgrinder.lua:1-7"
  ]
 },
 {
  "slug": "potranquility-portal-gates",
  "zone": "potranquility",
  "zoneName": "Plane of Tranquility",
  "name": "Zone portals / zone-flag gates (player.lua)",
  "kind": "flag",
  "kindWhy": "The portals of the Plane of Tranquility give out zone flags once your character flags are met. This is where the flag chains get used.",
  "start": "Click a portal in the Plane of Tranquility.",
  "timers": "None.",
  "mechanics": [
   "Valor and Storms: you need the Mavuin flag at step 3.",
   "Crypt of Decay: the zone flag is set elsewhere, by dropping down the Plane of Disease zone-in near Grummus. The Bangle of Disease Warding only works when the alternate-access quests are switched on.",
   "Torment: you need Fuirstel step 5 and Thelin step 4, or the Symbol of Torment.",
   "Bastion of Thunder: you need Karana step 3 or the Zebuxoruk flag.",
   "Halls of Honor: the zone flag is set by zoning in from Valor, or use the Ring of Marr.",
   "Drunder, the Fortress of Zek: you need Zeks step 2 or higher, or the Completed Diaku Emblem.",
   "Tower of Solusek Ro: you need the Cipher flag and Zeks step 6 or higher.",
   "Plane of Fire: the script only shows 'You lack the will...' if the flag is missing. The flag is set elsewhere.",
   "Water, Earth and Air: you need Zebuxoruk step 2.",
   "Plane of Time A: a GM, or level 65 or higher with the Plane of Time zone flag and the Time flag."
  ],
  "npcs": [],
  "rewards": [],
  "cites": [
   "potranquility/player.lua:9-151"
  ]
 },
 {
  "slug": "potranquility-flag-npcs",
  "zone": "potranquility",
  "zoneName": "Plane of Tranquility",
  "name": "Quest-giver flags: Adroha Jezith, Elder Poxbourne, Adler/Elder Fuirstel, Fahlia Shadyglade, Miak the Searedsoul",
  "kind": "flag",
  "kindWhy": "Each of these quest-givers sets or moves a character flag that the other planes use: Thelin, Fuirstel, Tylis and Fire.",
  "start": "Hail each NPC or say the keyword. Adroha Jezith: 'tortured by nightmares' (Thelin 0 to 1). Adler Fuirstel: 'ward' (Fuirstel 0 to 1). Elder Fuirstel: hail (Fuirstel 2 to 3, and 4 to 5). Elder Poxbourne: hail at Thelin step 3 or higher (3 to 4). Fahlia Shadyglade: 'will go', which needs Thelin step 4 and Fuirstel step 5 (Tylis 0 to 1). Miak the Searedsoul: 'portal's destination' (Fire 0 to 1; step 2 is the unlocked state).",
  "timers": "None. The flags are permanent.",
  "mechanics": [
   "Thelin: step 1 from Adroha, step 2 from the Maze in the Plane of Nightmares, step 3 from the Terris Thule projection, step 4 from Poxbourne.",
   "Fuirstel: step 1 from Adler, step 2 from the Plane of Disease projection, step 3 from Elder Fuirstel, step 4 from the Crypt of Decay projection, step 5 from Elder Fuirstel.",
   "Tylis: step 1 from Fahlia, step 2 from the rescued Tylis Newleaf in the Plane of Torment.",
   "Fire: step 1 from Miak, step 2 from the Tower of Solusek Ro projection."
  ],
  "npcs": [],
  "rewards": [],
  "cites": [
   "potranquility/Adroha_Jezith.lua:19-23",
   "potranquility/Elder_Poxbourne.lua:5-13",
   "potranquility/Adler_Fuirstel.lua:22-26",
   "potranquility/Elder_Fuirstel.lua:6-20",
   "potranquility/Fahlia_Shadyglade.lua:39-46",
   "potranquility/Miak_the_Searedsoul.lua:25-32"
  ]
 },
 {
  "slug": "povalor-aerindar",
  "zone": "povalor",
  "zoneName": "Plane of Valor",
  "name": "Aerin`Dar (glass dragon lair)",
  "kind": "raid-boss",
  "kindWhy": "The flag boss of the Plane of Valor. His death brings a Planar Projection that gives Aerin`Dar step 1 if you have the Mavuin flag at step 3. Then clicking the Halls of Honor zone-in door gives step 2 and the Halls of Honor zone flag.",
  "groupLimit": "The projection flags up to 72 players.",
  "start": "Get into the lair. The glass door switches open with A Crystalline Globe, or use the dragon-orb teleporter while Aerin`Dar is up. Then pull Aerin`Dar.",
  "timers": "After a fight drops he resets to full health within 3 seconds. His area is checked every 3 seconds. The projection stays 20 minutes.",
  "mechanics": [
   "When he appears, the 9 Rahlgon and minion spawn points respawn, and the adds start asleep.",
   "Adds wake as he loses health: two at 85%, two at 65%, two at 45%, and three at 25%.",
   "If he leaves his area he resets.",
   "When he dies, the Planar Projection appears at /loc 2528, 360."
  ],
  "npcs": [
   {
    "npcId": 208074,
    "name": "Aerin`Dar",
    "level": 70,
    "hp": 300000
   },
   {
    "npcId": 208175,
    "name": "A Mindless Minion",
    "level": 62,
    "hp": 25000
   },
   {
    "npcId": 208176,
    "name": "Rahlgon",
    "level": 65,
    "hp": 30000
   }
  ],
  "rewards": [],
  "cites": [
   "povalor/#Aerin-Dar.lua:1-100",
   "povalor/A_Planar_Projection.lua:22-41",
   "povalor/player.lua:1-37",
   "poknowledge/Seer_Mal_Nae-Shi.lua:1-43"
  ]
 },
 {
  "slug": "povalor-crystalline-globe-quest",
  "zone": "povalor",
  "zoneName": "Plane of Valor",
  "name": "Battalion orb quest -> A Crystalline Globe",
  "kind": "optional",
  "kindWhy": "A side quest chain that ends with A Crystalline Globe. The globe only opens the glass lair door switches. It sets no flag.",
  "start": "Hail Sergeant Johson Popoah, then say 'compound'. Tell Paralin Notion 'things'. Tell Master Sergeant Aaramis Daryln 'aerin'. Hand Paralin a Crystalline Spider's Heart, a Razorfiend's Heart and a Planarian Larvae's Heart. Tell Aaramis 'mission'. Hand Captain Ryglot Cupperhide the three pieces of the crystalline globe.",
  "timers": "None.",
  "mechanics": [
   "The glass door switches open the door when you hold the globe or have it on your key ring."
  ],
  "npcs": [],
  "rewards": [
   {
    "itemId": 25596,
    "name": "A Crystalline Globe",
    "trigger": "Hand the three pieces of the crystalline globe to Captain Ryglot Cupperhide"
   }
  ],
  "cites": [
   "povalor/Sergeant_Johson_Popoah.lua:5-24",
   "povalor/Paralin_Notion.lua:55-86",
   "povalor/Master_Sergeant_Aaramis_Daryln.lua:12-40",
   "povalor/Captain_Ryglot_Cupperhide.lua:36-42",
   "povalor/player.lua:39-52"
  ]
 },
 {
  "slug": "povalor-wandering-spirit",
  "zone": "povalor",
  "zoneName": "Plane of Valor",
  "name": "A Wandering Spirit (Crescent Symbol of Rhaj + Righteous Amulet of Marr)",
  "kind": "optional",
  "kindWhy": "A 250,000 experience quest that brings the Wandering Spirit (level 70, 168,000 HP). It sets no flag.",
  "start": "Hail A Wandering Spirit and say 'help', 'belongings' and 'amulet'. Hand in the Crescent Symbol of Rhaj and the Righteous Amulet of Marr.",
  "timers": "The Wandering Spirit leaves after 1 min 40 s.",
  "mechanics": [
   "The hand-in gives 250,000 experience. The Wandering Spirit appears on the same spot and the quest NPC leaves."
  ],
  "npcs": [
   {
    "npcId": 208061,
    "name": "A Wandering Spirit",
    "level": 70,
    "hp": 168000
   },
   {
    "npcId": 208209,
    "name": "A Wandering Spirit",
    "level": 70,
    "hp": 168000
   }
  ],
  "rewards": [],
  "cites": [
   "povalor/A_Wandering_Spirit.lua:1-25",
   "povalor/#A_Wandering_Spirit.lua:1-45"
  ]
 },
 {
  "slug": "povalor-sleep-walkers",
  "zone": "povalor",
  "zoneName": "Plane of Valor",
  "name": "The Sleep Walker named mobs",
  "kind": "optional",
  "kindWhy": "Named mobs with loot (Signet of the Valorous, Band of the Visionary and others). No script covers them, so only the loot tables speak for them.",
  "start": "Unknown: no script covers them.",
  "timers": "Unknown.",
  "mechanics": [
   "Three versions of The Sleep Walker exist in the NPC table."
  ],
  "npcs": [
   {
    "npcId": 208157,
    "name": "The Sleep Walker",
    "level": 67,
    "hp": 150000
   },
   {
    "npcId": 208202,
    "name": "The Sleep Walker",
    "level": 65,
    "hp": 130000
   },
   {
    "npcId": 208208,
    "name": "The Sleep Walker",
    "level": 66,
    "hp": 140000
   }
  ],
  "rewards": [],
  "cites": []
 },
 {
  "slug": "powater-coirnav",
  "zone": "powater",
  "zoneName": "Plane of Water",
  "name": "Coirnav, the Avatar of Water (Triumvirate defenders)",
  "kind": "raid-boss",
  "kindWhy": "The flag boss of the Plane of Water. His death brings the Essence of Water, which gives a Sphere of Coalesced Water, one of four parts of the Quintessence of Elements (a step toward the Plane of Time).",
  "groupLimit": "The Essence of Water flags up to 72 players.",
  "start": "Kill the Guardian of Coirnav while Coirnav is up and the event is ready to begin.",
  "timers": "You have 15 minutes from the Guardian's death. It is never extended. Red-text warnings come at 10, 12 and 14 minutes. Wave 2 comes at 3 minutes and wave 3 at 5 minutes. After a fail you retry in 20 minutes. After a win Coirnav is back in 138 hours. In the last phase, lings arrive every 49 seconds.",
  "mechanics": [
   "Phase 1 is three waves of 25 fiends each, with an early miniboss: triloun vaporfiends, hraquis icefiends and regrua waterfiends, and their lings. All 75 must die.",
   "Phase 2: Pwelon of Vapor, Nrinda of Ice and Vamuil of Water (level 75, 2,000,000 HP each in the NPC table) are summoned and Coirnav (level 80, 3,000,000 HP in the table) can be attacked.",
   "Phase 3: when the three minibosses are dead, Coirnav's health is cut to 250,000 and his buffs fade. Lings arrive every 49 seconds.",
   "If the 15 minutes run out, the attempt fails. When Coirnav dies, the Essence of Water appears."
  ],
  "npcs": [
   {
    "npcId": 216048,
    "name": "Coirnav the Avatar of Water",
    "level": 80,
    "hp": 3000000
   },
   {
    "npcId": 216053,
    "name": "Guardian of Coirnav",
    "level": 70,
    "hp": 100000
   },
   {
    "npcId": 216236,
    "name": "Pwelon of Vapor",
    "level": 75,
    "hp": 2000000
   },
   {
    "npcId": 216245,
    "name": "Nrinda of Ice",
    "level": 75,
    "hp": 2000000
   },
   {
    "npcId": 216247,
    "name": "Vamuil of Water",
    "level": 75,
    "hp": 2000000
   }
  ],
  "rewards": [
   {
    "itemId": 29163,
    "name": "Sphere of Coalesced Water",
    "trigger": "Hail the Essence of Water after Coirnav dies, if you have neither the Sphere nor a Quintessence of Elements"
   }
  ],
  "cites": [
   "powater/encounters/Coirnav.lua:1-70",
   "powater/encounters/Coirnav.lua:195-250",
   "powater/encounters/Coirnav.lua:262-300",
   "powater/Essence_of_Water.lua:20-39"
  ]
 },
 {
  "slug": "powater-fishlords",
  "zone": "powater",
  "zoneName": "Plane of Water",
  "name": "Fishlords Lezom and Craiyk (100 platinum summoning)",
  "kind": "optional",
  "kindWhy": "Pay-to-summon anglerfish event with no flag. Only the summoned 'dwellers' carry loot.",
  "start": "Say 'dwellers' to Fishlord Lezom or Fishlord Craiyk. He says, 'For 100 platinum I will summon them forth.' Hand him 100 platinum. A scripted copy of Lezom or Craiyk walks to /loc 217, 94 or /loc 157, -269, and the normal spawn is switched off.",
  "timers": "The Fishlord is back 25 minutes after the event ends. Anglerfish leave after 3 minutes.",
  "mechanics": [
   "At the stopping point the Fishlord chants and the trash spawns switch on. He can be killed ('If death claims me the summoning will be finished').",
   "Kill 5, 10, 15 and 25 of each anglerfish kind (ferocious, fierce and furious) and a stronger named dweller appears, such as a master, king or supreme anglerfish. The 25th kill ends the event and the Fishlord leaves."
  ],
  "npcs": [
   {
    "npcId": 216267,
    "name": "a master anglerfish",
    "level": 71,
    "hp": 92800
   },
   {
    "npcId": 216281,
    "name": "a king anglerfish",
    "level": 71,
    "hp": 70400
   },
   {
    "npcId": 216282,
    "name": "a supreme anglerfish",
    "level": 71,
    "hp": 80100
   },
   {
    "npcId": 216020,
    "name": "Fishlord Lezom",
    "level": 40,
    "hp": 10000
   }
  ],
  "rewards": [],
  "cites": [
   "powater/encounters/Fishlords.lua:1-80",
   "powater/encounters/Fishlords.lua:85-125",
   "powater/encounters/Fishlords.lua:126-205"
  ]
 },
 {
  "slug": "powater-named",
  "zone": "powater",
  "zoneName": "Plane of Water",
  "name": "Named water mobs (Ofossaa, Krziik, Grioihin, Hydrotha) and trap mobs",
  "kind": "optional",
  "kindWhy": "Named water mobs (Ofossaa, Krziik, Grioihin, Hydrotha) and trap mobs. No script covers the named ones.",
  "start": "Nothing to start: pull them.",
  "timers": "Trap mobs leave after 20 minutes.",
  "mechanics": [
   "The only script gives eight kinds of trap mob a 20 minute despawn timer."
  ],
  "npcs": [
   {
    "npcId": 216040,
    "name": "Ofossaa the Enlightened",
    "level": 78,
    "hp": 800000
   },
   {
    "npcId": 216041,
    "name": "Krziik the Mighty",
    "level": 77,
    "hp": 900000
   },
   {
    "npcId": 216042,
    "name": "Grioihin the Wise",
    "level": 75,
    "hp": 550000
   },
   {
    "npcId": 216043,
    "name": "Hydrotha",
    "level": 75,
    "hp": 650000
   }
  ],
  "rewards": [],
  "cites": [
   "powater/encounters/Traps.lua:1-27"
  ]
 },
 {
  "slug": "solrotower-solusek-ro",
  "zone": "solrotower",
  "zoneName": "Tower of Solusek Ro",
  "name": "Solusek Ro (summit)",
  "kind": "raid-boss",
  "kindWhy": "The flag boss of the Tower of Solusek Ro. His death brings a Planar Projection that gives Fire step 2. You need the full Solusek Ro room flag, Fire step 1 (from Miak in Tranquility) and Zeks step 7. Otherwise you get a checklist flag.",
  "groupLimit": "The projection flags up to 72 players.",
  "start": "Enter by the lava rune doors, which need the full Solusek Ro room flag and Zeks step 7. They take you to /loc -847, 0. Pull Solusek Ro. The floor doors open while the projection is up.",
  "timers": "Every 30 seconds in a fight the script checks his position. If he is below the top level and under 50% health, the Guardians of Fire are teleported to him and he is healed 100,000.",
  "mechanics": [
   "When he dies, a Planar Projection appears at /loc -815, 0 for the killer.",
   "A Focus of Sol takes the charm off pets above the top level and gives them 200 magic resist."
  ],
  "npcs": [
   {
    "npcId": 212025,
    "name": "Solusek Ro",
    "level": 80,
    "hp": 850000
   },
   {
    "npcId": 212041,
    "name": "Guardian of Fire",
    "level": 73,
    "hp": 130000
   }
  ],
  "rewards": [],
  "cites": [
   "solrotower/Solusek_Ro.lua:1-30",
   "solrotower/A_Planar_Projection.lua:20-56",
   "solrotower/player.lua:1-23",
   "solrotower/a_focus_of_Sol.lua:1-7"
  ]
 },
 {
  "slug": "solrotower-galremos",
  "zone": "solrotower",
  "zoneName": "Tower of Solusek Ro",
  "name": "Galremos (magmite split)",
  "kind": "optional",
  "kindWhy": "A named mob that splits. It has loot and no flag.",
  "start": "Nothing to start: pull Galremos.",
  "timers": "None.",
  "mechanics": [
   "At 90%, 60%, 35%, 20% and 5% health he shrinks and 1, 2, 1, 4 and 6 magmites appear."
  ],
  "npcs": [
   {
    "npcId": 212033,
    "name": "Galremos",
    "level": 63,
    "hp": 265000
   },
   {
    "npcId": 212397,
    "name": "a magmite",
    "level": 60,
    "hp": 22100
   }
  ],
  "rewards": [],
  "cites": [
   "solrotower/Galremos.lua:1-39"
  ]
 },
 {
  "slug": "solrotower-wing-xuzl",
  "zone": "solrotower",
  "zoneName": "Tower of Solusek Ro",
  "name": "Xuzl's wing (room flag part 1)",
  "kind": "flag",
  "kindWhy": "Xuzl's wing gives part 1 of the five-part Solusek Ro room flag. All five parts plus Zeks step 7 let the Solusek Ro projection give Fire step 2. The room flag with Zeks step 6 and the Cipher flag also opens the tower portal and the lava rune doors.",
  "groupLimit": "No cap in the script. The flag goes to whoever clicks the cauldron.",
  "start": "Kill Xuzl, then click the flaming cauldron while it is there.",
  "timers": "The cauldron stays 30 minutes. The warders stay 1 hour. His area is checked every 6 seconds.",
  "mechanics": [
   "Xuzl is level 75 with 600,000 HP. If he leaves his area, he is sent back.",
   "When he dies, a flaming cauldron appears at /loc -336, 1780 with three Warders of Xuzl.",
   "Click the cauldron to set part 1 of the room flag."
  ],
  "npcs": [
   {
    "npcId": 212055,
    "name": "Xuzl",
    "level": 75,
    "hp": 600000
   },
   {
    "npcId": 212415,
    "name": "a warder of Xuzl",
    "level": 1,
    "hp": 23600
   }
  ],
  "rewards": [],
  "cites": [
   "solrotower/Xuzl.lua:1-27",
   "solrotower/a_flaming_cauldron.lua:1-17",
   "solrotower/player.lua:75-86"
  ]
 },
 {
  "slug": "solrotower-wing-arlyxir",
  "zone": "solrotower",
  "zoneName": "Tower of Solusek Ro",
  "name": "Arlyxir's wing (room flag part 2)",
  "kind": "flag",
  "kindWhy": "Arlyxir's wing gives part 2 of the five-part Solusek Ro room flag. All five parts plus Zeks step 7 let the Solusek Ro projection give Fire step 2. The room flag with Zeks step 6 and the Cipher flag also opens the tower portal and the lava rune doors.",
  "groupLimit": "No cap in the script. The flag goes to whoever clicks the cauldron.",
  "start": "Kill Arlyxir, then click the flaming cauldron while it is there.",
  "timers": "In a fight he heals to full every 12 min 30 s. The cauldron stays 30 minutes. His area is checked every 6 seconds.",
  "mechanics": [
   "Arlyxir is level 75 with 750,000 HP. He casts Searing Flames. When he heals he is 'immolated in flames, and is reborn!'. If he leaves his area, he is sent back.",
   "When he dies, a flaming cauldron appears at /loc 1891, 1607 with three Warders of Arlyxir.",
   "Click the cauldron to set part 2 of the room flag."
  ],
  "npcs": [
   {
    "npcId": 212023,
    "name": "Arlyxir",
    "level": 75,
    "hp": 750000
   },
   {
    "npcId": 212416,
    "name": "a warder of Arlyxir",
    "level": 1,
    "hp": 23600
   }
  ],
  "rewards": [],
  "cites": [
   "solrotower/Arlyxir.lua:1-33",
   "solrotower/player.lua:48-60"
  ]
 },
 {
  "slug": "solrotower-wing-dresolik",
  "zone": "solrotower",
  "zoneName": "Tower of Solusek Ro",
  "name": "Dresolik's wing (room flag part 3)",
  "kind": "flag",
  "kindWhy": "Dresolik's wing gives part 3 of the five-part Solusek Ro room flag. All five parts plus Zeks step 7 let the Solusek Ro projection give Fire step 2. The room flag with Zeks step 6 and the Cipher flag also opens the tower portal and the lava rune doors.",
  "groupLimit": "No cap in the script. The flag goes to whoever clicks the cauldron.",
  "start": "Kill the Guardians of Dresolik and then the Protector of Dresolik. Then click the flaming cauldron while it is there.",
  "timers": "If the Protector is not killed within 2 hours 30 minutes, he leaves and the guardians return after 10 minutes. The clock stops in combat. His area is checked every 6 seconds.",
  "mechanics": [
   "When a Guardian of Dresolik appears, the four guardian spawn points reset. When no guardian is left, the last one to die brings the Protector of Dresolik at /loc 1584, 606.",
   "The Protector is level 75 with 800,000 HP. Both stay within their own area.",
   "When the Protector dies, a flaming cauldron appears at /loc 1449, 166 with three Warders of Dresolik.",
   "Click the cauldron to set part 3 of the room flag."
  ],
  "npcs": [
   {
    "npcId": 212408,
    "name": "The Protector of Dresolik",
    "level": 75,
    "hp": 800000
   },
   {
    "npcId": 212046,
    "name": "Guardian of Dresolik",
    "level": 68,
    "hp": 285000
   },
   {
    "npcId": 212419,
    "name": "a warder of Dresolik",
    "level": 1,
    "hp": 23600
   }
  ],
  "rewards": [],
  "cites": [
   "solrotower/Guardian_of_Dresolik.lua:1-36",
   "solrotower/The_Protector_of_Dresolik.lua:1-43",
   "solrotower/player.lua:62-73"
  ]
 },
 {
  "slug": "solrotower-wing-rizlona",
  "zone": "solrotower",
  "zoneName": "Tower of Solusek Ro",
  "name": "Rizlona's wing (room flag part 4)",
  "kind": "flag",
  "kindWhy": "Rizlona's wing gives part 4 of the five-part Solusek Ro room flag. All five parts plus Zeks step 7 let the Solusek Ro projection give Fire step 2. The room flag with Zeks step 6 and the Cipher flag also opens the tower portal and the lava rune doors.",
  "groupLimit": "No cap in the script. The flag goes to whoever clicks the cauldron.",
  "start": "Kill Rizlona, then the stronger Rizlona who takes her place. Then click the flaming cauldron while it is there.",
  "timers": "The second Rizlona leaves after 2 hours 30 minutes, and her spawn comes back after 10 minutes. The clock stops in combat. Her area is checked every 6 seconds.",
  "mechanics": [
   "The first Rizlona is a phase 1 mob and always drops The Time Grows Near. When she dies, a second Rizlona (600,000 HP) appears in her place.",
   "The second Rizlona is sent back to /loc 2384, -1103 if she leaves her area.",
   "When she dies, a flaming cauldron appears at /loc 2717, -980 with three Warders of Rizlona.",
   "Click the cauldron to set part 4 of the room flag."
  ],
  "npcs": [
   {
    "npcId": 212026,
    "name": "Rizlona",
    "level": 70,
    "hp": 300000
   },
   {
    "npcId": 212407,
    "name": "Rizlona",
    "level": 70,
    "hp": 600000
   },
   {
    "npcId": 212418,
    "name": "a warder of Rizlona",
    "level": 1,
    "hp": 23600
   }
  ],
  "rewards": [],
  "cites": [
   "solrotower/Rizlona.lua:1-23",
   "solrotower/#Rizlona.lua:1-41",
   "solrotower/player.lua:34-47"
  ]
 },
 {
  "slug": "solrotower-wing-jiva",
  "zone": "solrotower",
  "zoneName": "Tower of Solusek Ro",
  "name": "Jiva's wing (room flag part 5)",
  "kind": "flag",
  "kindWhy": "Jiva's wing gives part 5 of the five-part Solusek Ro room flag. All five parts plus Zeks step 7 let the Solusek Ro projection give Fire step 2. The room flag with Zeks step 6 and the Cipher flag also opens the tower portal and the lava rune doors.",
  "groupLimit": "No cap in the script. The flag goes to whoever clicks the cauldron.",
  "start": "Kill Jiva, then click the flaming cauldron while it is there.",
  "timers": "In a fight a helper is called every 45 seconds. Helpers leave after 10 minutes.",
  "mechanics": [
   "Jiva is level 75 with 700,000 HP. Every 45 seconds in a fight he calls one of eight named helpers in turn: Makin, Adeel, Jiri, Seif, Nabil, Aydin, Cemal and Fahim. They appear at set spots in the wing.",
   "When he dies, a flaming cauldron appears at /loc 105, -2126 with three Warders of Jiva.",
   "Click the cauldron to set part 5 of the room flag."
  ],
  "npcs": [
   {
    "npcId": 212014,
    "name": "Jiva",
    "level": 75,
    "hp": 700000
   },
   {
    "npcId": 212417,
    "name": "a warder of Jiva",
    "level": 1,
    "hp": 23600
   },
   {
    "npcId": 212404,
    "name": "an efreeti makin",
    "level": 68,
    "hp": 34700
   },
   {
    "npcId": 212399,
    "name": "an efreeti adeel",
    "level": 68,
    "hp": 31500
   },
   {
    "npcId": 212403,
    "name": "an efreeti jiri",
    "level": 68,
    "hp": 31500
   },
   {
    "npcId": 212406,
    "name": "an efreeti seif",
    "level": 68,
    "hp": 33000
   },
   {
    "npcId": 212405,
    "name": "an efreeti nabil",
    "level": 68,
    "hp": 31600
   },
   {
    "npcId": 212400,
    "name": "an efreeti aydin",
    "level": 68,
    "hp": 30000
   },
   {
    "npcId": 212401,
    "name": "an efreeti cemal",
    "level": 68,
    "hp": 30000
   },
   {
    "npcId": 212402,
    "name": "an efreeti fahim",
    "level": 68,
    "hp": 30000
   }
  ],
  "rewards": [],
  "cites": [
   "solrotower/Jiva.lua:1-50",
   "solrotower/encounters/JivaAdds.lua:1-25",
   "solrotower/player.lua:88-99"
  ]
 }
];

const CITE = /^(.+\.lua):(\d+)(?:-(\d+))?$/;

/** `path:a-b` (or `path:a`) → its parts, or null when it is not that shape. */
export function parseCite(cite: string): { path: string; from: number; to: number } | null {
  const m = CITE.exec(cite);
  if (!m) return null;
  const from = Number(m[2]);
  const to = m[3] ? Number(m[3]) : from;
  return from >= 1 && to >= from ? { path: m[1], from, to } : null;
}

/** The GitHub link to the cited lines at the pinned commit. Script names carry `#`, backticks and commas: encode each segment. */
export function citeUrl(cite: string): string | null {
  const p = parseCite(cite);
  if (!p) return null;
  const path = p.path.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/SecretsOTheP/quests/blob/${QUESTS_SHA}/${path}#L${p.from}-L${p.to}`;
}

export const eventBySlug = (slug: string): PopEvent | undefined => EVENTS.find(e => e.slug === slug);

/** The zones that have events, in the order the first event of each appears. */
export function eventZones(): { zone: string; zoneName: string; count: number }[] {
  const out: { zone: string; zoneName: string; count: number }[] = [];
  for (const e of EVENTS) {
    const z = out.find(o => o.zone === e.zone);
    if (z) z.count++;
    else out.push({ zone: e.zone, zoneName: e.zoneName, count: 1 });
  }
  return out;
}

/** Every npc id the events name, de-duplicated, for the live drop read. */
export function eventNpcIds(): number[] {
  return [...new Set(EVENTS.flatMap(e => e.npcs.map(n => n.npcId)))];
}

/** Every directly-handed-out item id, for the stat read. */
export function eventRewardIds(): number[] {
  return [...new Set(EVENTS.flatMap(e => e.rewards.map(r => r.itemId)))];
}
