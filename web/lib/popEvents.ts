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
  "kindWhy": "Alternate-access quest, enabled only when server data pop_alt_access_enabled == '1'; gives key 9294 (checked by potranquility door 12 / keyring). Not part of the flag path.",
  "start": "Hail Grimror_Plaguebringer: 'stuff', 'big plan', 'help Grimror', 'dem tings'; then hand in 9290 + 9291 + 9292 + 9293 (four items).",
  "timers": "n/a",
  "mechanics": [
   "Grimror asks for the bile of the little bugs ('Keel little bugs'); otherwise he returns the items and says to come back another time."
  ],
  "npcs": [],
  "rewards": [
   {
    "itemId": 9294,
    "name": "Crypt of Decay key (item 9294)",
    "trigger": "Hand in 9290, 9291, 9292, 9293 to Grimror_Plaguebringer (QuestReward itemid 9294, exp 1)"
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
  "kindWhy": "Alternate-access chain (pop_alt_access_enabled == '1'); key 29213 used at potranquility door 93.",
  "start": "Hand Iramai_Sacredsoul 29315 -> Purified Bubonian Bile 29302 + 50000 xp; Brugga (pojustice) turns 29297 + 29298 + 29299 into 29295 (+100000 xp) and 29302 back; hand Iramai 29295 + 29302 -> 29213.",
  "timers": "n/a",
  "mechanics": [
   "Brugga requires faction < 5."
  ],
  "npcs": [],
  "rewards": [
   {
    "itemId": 29213,
    "name": "Torment key (29213)",
    "trigger": "Hand 29295 + 29302 to Iramai_Sacredsoul (6250 xp)"
   },
   {
    "itemId": 29302,
    "name": "Purified Bubonian Bile",
    "trigger": "Hand 29315 to Iramai_Sacredsoul (50000 xp)"
   },
   {
    "itemId": 29295,
    "name": "Vial of Opaque Fluid",
    "trigger": "Hand 29297, 29298, 29299 to Brugga (pojustice, 100000 xp)"
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
  "kindWhy": "Alternate-access chain (pop_alt_access_enabled == '1'); Ring of Marr 29214 opens potranquility door 23 (HoH).",
  "start": "Borik_Darkanvil (poknowledge): hand 29228 + 29229 + 29230 + 3000 platinum -> Box of Souls 29281. Hand the Box of Souls to an Exiled Soldier/Officer/Trooper of Marr (pojustice): each returns the Box plus Soul Sphere 29293 / 29294 / 29292. Hand Grenic_Drere 29281 + 29292 + 29293 + 29294.",
  "timers": "n/a",
  "mechanics": [
   "Say 'box of souls', 'Perilium' or 'forge them for me' to Borik first."
  ],
  "npcs": [],
  "rewards": [
   {
    "itemId": 29214,
    "name": "Ring of Marr",
    "trigger": "Hand 29281, 29292, 29293, 29294 to Grenic_Drere (50000 xp)"
   },
   {
    "itemId": 29281,
    "name": "Box of Souls",
    "trigger": "Hand 29228, 29229, 29230 + 3000 platinum to Borik_Darkanvil"
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
  "kindWhy": "Alternate-access quest (pop_alt_access_enabled == '1'); key 29215 opens potranquility door 24 (Drunder). Requires faction <= 4.",
  "start": "Hail Wembly_the_Forlorn: 'done', 'key', 'agree to help', 'tied to the mast', 'Diaku', 'Drunder'; hand 29216 + 29217 + 29218 + 29219.",
  "timers": "n/a",
  "mechanics": [
   "Faction hits: Askr the Lost 1609 +5 and Storm Guardians 1618 +5."
  ],
  "npcs": [],
  "rewards": [
   {
    "itemId": 29215,
    "name": "Drunder key (29215)",
    "trigger": "Hand 29216, 29217, 29218, 29219 to Wembly_the_Forlorn (150000 xp)"
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
  "kindWhy": "Final kill of the Bastion; killing Agnarr spawns Karana (209136) who sets qglobal karana 3 -> 4 ('You have received a character flag!') when told 'follow the path of the Fallen' - the flag-path boss.",
  "groupLimit": "Karana only flags the killer's raid/group (or the solo killer); FLAG_LIMIT = 72 flags per Karana spawn.",
  "start": "Enter Torden tower: click door id 51 while carrying Symbol of Torden (item 9433, must be in slot 0/cursor or on keyring) -> MovePC(209,-765,-1735,1270); one Symbol click authorises the clicker's raid/group for 300 s (SYMBOL_AUTHORIZATION_SECONDS). Without it the 1st and 2nd clicks give messages and the 3rd signals A_storm_watcher (209113) gargoyles to aggro. Upper floor doors 61/63/65/67 teleport anyone holding item 9425 to the tower floors. Fight starts on pulling Agnarr (209026).",
  "timers": "portals timer 120000 ms (90000 below 50% hp, 60000 below 25%); link timer 45000 ms (assist-link all giants/adds). Initial giant spawn timer 3000 ms. Karana depops after 1200000 ms (20 min); Karana's flagging-travel window is 1200 s.",
  "mechanics": [
   "On first aggro (hp>96%) Jolur_Sandstorm (209147) spawns after 3 s; at 75% hp Ekil_Thundercall (209142), at 50% Oljin_Stormtide (209148), at 25% Hibdin_Cyclone (209146), all unique-spawned at -1070,-1739,2257.",
   "Every portals tick signals A_storm_portal (209034) which spawns one random add: A_firestorm 209124 / A_comet 209123 / A_hurricane 209125 / A_storm_cloud 209130.",
   "Link timer pulls all giants/adds onto Agnarr's target and leashes them back if z < 2200.",
   "Agnarr death_complete spawns Karana at -477,-1758,2355 and signals him the killer's id. Karana: 'hail' (info), 'follow the path of the Fallen' (karana 3 -> 4 if karana==3; if karana<3 and no zebuxoruk/cl_karana it only sets checklist flag cl_karana), 'send me' (casts Gate on the player)."
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
  "kindWhy": "Not a zone/character flag, but killing them spawns #Askr_the_Lost / ##Askr_the_Lost who transport the group up toward Agnarr's floor (FlaggingTravel window); progression path to Agnarr.",
  "start": "Passive: pull Evynd_Firestorm (209054) or Emmerik_Skyfury (209053).",
  "timers": "portals timer 120000 ms (Emmerik: 90000 below 50%, 60000 below 25%). Askr transports expire with the FlaggingTravel window tied to Karana (209136) type; unknown exact seconds for these two.",
  "mechanics": [
   "Evynd in combat every 120 s signals A_firestorm_portal (209122); on death spawns #Askr_the_Lost (209156) at -1123,-1732,1269 ('transport' moves you to -880,-1787,1729).",
   "Emmerik in combat every 120 s signals A_celestial_portal (209102); on death spawns ##Askr_the_Lost (209157) at -1065,-1733,1727."
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
  "kindWhy": "ProgressionLoot encounter AddItem()s guaranteed Rings of Torden (17168) and Unadorned Symbols of Torden (17169) and 25% storm Gems/Spheres (9421-9424, 9429-9432); the Symbol of Torden (9433) opens Torden's tower (player.lua door 51). The tradeskill combine is not in the scripts.",
  "start": "Passive: kill the listed giants. Spawn event hands out loot.",
  "timers": "unknown (spawn2 respawns are DB-side).",
  "mechanics": [
   "Guaranteed: 209070 Laef Windfall, 209071 Gaukr Sandstorm, 209072 Oreen Wavecrasher, 209082 Hreidar Lynhillig each +3 Ring of Torden (17168).",
   "Guaranteed: 209016 Brynju Thunderclap, 209059 Auliffe Chaoswind, 209060 Eindride Icestorm, 209061 Kuanbyr Hailstorm, 209142 Ekil Thundercall, 209146 Hibdin Cyclone, 209147 Jolur Sandstorm, 209148 Oljin Stormtide each +1 Unadorned Symbol of Torden (17169).",
   "25% chance per spawn of one component: Sandstorm Gem 9421 (209001/4/11), Lightning Gem 9422 (209007/9/64), Blizzard Gem 9423 (209014/18/55/62), Tornado Gem 9424 (209000/2/51/162), Sandstorm Sphere 9429 (209015/40/41), Lightning Sphere 9430 (209013/19/20), Blizzard Sphere 9431 (209043/44/133/134/161), Tornado Sphere 9432 (209048/50/135).",
   "Kuanbyr Hailstorm (209061) links his hate to Hrani 209058 / Iri 209057 / Leistr 209056 every 6 s; Brynju/Auliffe/Eindride leash to their spawn when below z 2200/1400/2100."
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
  "kindWhy": "Environmental hazard on trash that sits in lower halls and towers; no loot or flag.",
  "start": "Pulling any Air/Earth/Fire/Water TrapSpawner mob.",
  "timers": "cast timer 5500 ms; storm cloud depops after 5000 ms; chance 50% (75% in the tower, z > 0).",
  "mechanics": [
   "Emote 'Storm clouds begin to gather over your head.'; 50%/75% a_storm_cloud (209160) spawns on the spawner and casts a spell via signal (Air 1049 Tempest Wind, Earth 1031 Stone Gale, Water one of 1050 Raging Blizzard / 1048 Monsoons / 1032 Hail Storm, Fire one of 1024 Thunderclap / 1025 Static Pulse / 1026 Thunder Call [FireTrapSpawner.lua:22]).",
   "Otherwise 'The storm clouds pass harmlessly.'"
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
  "kindWhy": "Ends with Tarkil_Adan (200267) who sets bertox_key=1 ('You have received a character flag!'); player.lua door 7 only admits characters with bertox_key into the lower crypt (Bertoxxulous), and the Bertox Planar Projection rejects anyone without bertox_key. Seer header: 'bertox_key - Access to Bertoxxulous level'.",
  "groupLimit": "Tarkil_Adan MAX_KEYS = 72 keys per spawn; only the killer's raid/group (rid/gid/cid).",
  "start": "Pull #_Carprin_Deatharn (200007, 1,000,000 hp, shielded): on first aggro it unique-spawns #Breddan_Rutyl (200229), #Fran_Prisoal (200230) and #Abroan_Drian (200222). Kill all three (they signal each other; the last one depops 200007 and spawns the vulnerable #Carprin_Deatharn 200232).",
  "timers": "Guards depop 800000 ms; #Carprin depop 12300000 ms; #Bishop_Toluwon / #High_Priest_Ultor_Szanvon depop 11700000 ms; #Raex_Pwodill / #Vindor_Mawnil depop 9900000 ms; Tarkil_Adan depop 600000 ms.",
  "mechanics": [
   "Carprin Deatharn death -> #Avhi_Escron (200225) at 405,135,-54 (spawns Reanimated_Reaver 200259 adds).",
   "Avhi death -> #Bishop_Toluwon (200228) at 258,84,-70.",
   "Bishop death -> #High_Priest_Ultor_Szanvon (200245) at 306,318,-64 plus generals #Vindor_Mawnil (200261) and #Raex_Pwodill (200258).",
   "Ultor death -> unique-spawn Tarkil_Adan at 309,330,-72.122 and signal him the killer id; hail Tarkil -> bertox_key."
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
  "kindWhy": "Flag-path boss: death spawns A_Planar_Projection 200269 whose hail sets fuirstel 3 -> 4 (requires bertox_key; no key = rejected). Seer header: 'fuirstel - PoDisease and CoD flag series (five values)'.",
  "groupLimit": "Projection FLAG_LIMIT (see codecay/A_Planar_Projection.lua).",
  "start": "Kill #Spectre_of_Corruption (200016, spawn point 360643) in the lower crypt; the kill triggers the attempt (summoners spawn at five locations).",
  "timers": "Preparation 350 s (PREPARATION_SECONDS), overall deadline 7380 s (EVENT_SECONDS), expiry warning at 300 s remaining, trash respawn every 350 s on 32 spawn points, failure cooldown 300 s, success cooldown 237600 * 1000 ms (66 h) on the Spectre spawn; watchdog 5000 ms.",
  "mechanics": [
   "After preparation, 32 trash spawn points (Knight / Priest / Necromancer of Decay and Elite variants) respawn on a 350 s clock.",
   "King spawns are keyed off trash kills: Darwol Adan at kill 44, Feig 48, Xhut 52, Kavilis 56, Raddi 84, Wavadozzik 88, Zandal 92, Akkapan 96.",
   "After the first eight kings the final four kings Meedo, Qezzin, Pzo, Bhaly Adan are summoned ('last corrupted Kings of Lxanvom'), then #Bertoxxulous (200226).",
   "Failure: deadline expiry or lost state -> Retry state; Bertoxxulous death -> victory emote, Planar Projection 200269 for the killer."
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
  "kindWhy": "No flag; wave event with loot on #Overlord_Banord_Paffa.",
  "start": "Enter Banord Paffa's proximity (75 radius around 180,-475,-390..-100): BanordEnter signals the controller (PusEventStarter 200218) unless active. #Banord_Paffa (200020).",
  "timers": "wave timer 234000 ms; at wave 3 Overlord spawns and an overall depop timer of 2400000 ms starts (fail -> spawn 360632 timer 600000 ms); spawn points re-enabled after the event with random 60-200 s timers.",
  "mechanics": [
   "Each wave spawns five Foul_Pusling (200242) / Corrupted_Pusling (200233, 25%) at fixed points.",
   "Wave 3 turns Banord into #Overlord_Banord_Paffa (200252)."
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
  "kindWhy": "Success + hail to #Trydan_Faye sets digit 1 of qglobal hohtrials (format 'abc'); hohtrials == '111' opens Temple of Marr portals (doors 19/20 -> zone flag 220) and is required for the Mithaniel Marr flags (mmarr).",
  "groupLimit": "Flagger FLAG_LIMIT 72 per success; only the killer's raid/group (rid/gid/cid) can be flagged; no scripted player cap.",
  "start": "Hail Trydan_Faye (211051): 'trials', then 'ready' -> spawns A_Custodian_of_Marr (211078) at his spot (depop timer 10000 ms) and Trydan depops with timer; killing the Custodian starts the trial and spawns Rydda`Dar.",
  "timers": "Custodian depop 10000 ms; Rydda`Dar self-depop 56000 ms; attacker depop 10000 ms; success respawn SUCCESS_RESPAWN_TIME = 64800 * 1000 ms (18 h) for the room spawn points; failed/aborted: 600000 ms retry (EnableSpawns default); #Trydan_Faye 211117 depops 600000 ms.",
  "mechanics": [
   "Custodian bounds check every 6000 ms (y outside 1750..2300 -> reset, Balance of the Nameless).",
   "On Custodian death the room spawn points (360860, 361050, 361051, 361052) are disabled and Rydda`Dar (211107, level 75, 500000 hp) spawns.",
   "Rydda`Dar death re-enables room spawns for 18 h and spawns #Trydan_Faye (211117) at -1725,2040,-111.4 for the killer's raid/group; hail #Trydan -> hohtrials digit 1 = '1'."
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
  "kindWhy": "Success + hail to #Rhaliq_Trell (211106) sets digit 2 of hohtrials.",
  "groupLimit": "Flagger FLAG_LIMIT 72; killer's raid/group only.",
  "start": "Hail Rhaliq_Trell (211050), then 'ready' -> Custodian of Marr spawns (10000 ms) and the event begins when it dies.",
  "timers": "Attackers depop 72000 ms after spawn (an unengaged timeout fails the event); retry 600000 ms after a failure; success respawn 64800000 ms (18 h); Rhaliq2 depop 600000 ms.",
  "mechanics": [
   "StartEvent spawns 7 villagers (barbarian, dwarf, gnome, half-elf, halfling, human, wood elf) and 12 named attackers (Granmuck Reiga 211105, Fligg Starp 211104, Trann Berk 211103, Shott Tarbs 211102, Ruark Barr 211101, Zullkata Reeps 211100, Maeryn Malladry 211096, Thullias Rhidron 211095, Herot Terkins 211094, Mirezvakla Ry`Ten 211099, Yarezka Tri`Lok 211098, Merken Lysonn 211097) on timed move timers (4-26 s).",
   "Kill 12 attackers (attackersKilled >= 12) -> EventSuccess; any attacker timing out -> FailEvent (attackers depop, spawn timers 600000 ms).",
   "Success spawns #Rhaliq_Trell at 456,1374,-110.4; hail -> hohtrials digit 2."
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
  "kindWhy": "Success + hail to #Alekson_Garn (211108) sets digit 3 of hohtrials.",
  "groupLimit": "Flagger FLAG_LIMIT 72; killer's raid/group only.",
  "start": "Hail Alekson_Garn (211060), then 'ready' -> Custodian spawns and the event begins when it dies.",
  "timers": "Attacker depop 50000 ms (a timeout fails the event); #Alekson depop 600000 ms; bounds 6000 ms (x outside -2800..-2200); success respawn 64800000 ms (18 h).",
  "mechanics": [
   "StartEvent spawns Miranda_Climmes (211082) and Ydira_Merok (211083) and trash rooms of a_crazed_norrathian (211074/211118) and recuso vagrant/straggler/drifter (211077/211076/211075).",
   "Killing all trash in a room spawns that room's boss: Advocent_Joran (211084), Halgoz_Rellinic (211086), Freegan_Haun (211085).",
   "After all 3 bosses die (bossKills == 3) -> EventSuccess; #Alekson_Garn (211108) spawns at -2330,-1724,-110.4; hail -> hohtrials digit 3."
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
  "kindWhy": "Flag-path boss: death spawns Planar Projection 220025 (1200 s); hail sets mmarr=1 and mmarr_book=1 when hohtrials=='111' (Seer header: mmarr/mmarr_book; zebuxoruk needs them).",
  "groupLimit": "Projection FLAG_LIMIT = 72 * 2.",
  "start": "Kill the three guardians Edium, Guardian of Marr (220021), Halon of Marr (220022) and Ralthazor, Champion of Marr (220012); each spawn signals Mithaniel 2 (untargetable), each death signals 1 (check after 3000 ms; targetable when all 3 spawn ids 367227/366604/367163 are empty).",
  "timers": "check 3000 ms; bounds 5000 ms in combat (x < 2200 resets + Balance of the Nameless); projection depop 1200000 ms.",
  "mechanics": [
   "Lord_Mithaniel_Marr (220020, level 77, 1,200,000 hp) is untargetable until all three guardians are dead.",
   "On Mithaniel spawn the three guardian spawn points are reset (SetTimer(1)).",
   "Death: Planar Projection spawns. Hail: no mmarr/cipher and hohtrials=='111' -> mmarr=1 (character flag) and, if no zebuxoruk, mmarr_book=1; otherwise checklist flags cl_mmarr / cl_mmarr_book."
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
  "kindWhy": "Flag-path boss of Air: death spawns Essence_of_Air (215432, 1200 s) whose hail summons Amorphous Cloud of Air (29164); Seer/Quintessence path (29165). Entry requires the Wind Etched Key (28638, keyring) or a 300 s raid/group authorization (player.lua door 1).",
  "groupLimit": "Essence_of_Air FLAG_LIMIT 72 items; it depops once the limit is reached.",
  "start": "Click the Xegony rainbow door (id 1) holding Wind Etched Key 28638 (or its keyring entry); one holder authorizes his raid/group for 300 s. Pull #Xegony_the_Queen_of_Air (215056).",
  "timers": "check_hp 6000 ms; HP triggers 99, 85, 70, 55, 40, 25%; if the fight lasted over 120 s when it drops she resets to spawn; all adds repop (RepopEverything) on disengage.",
  "mechanics": [
   "At each of the 6 HP triggers one unused named wave (random of 6) spawns and charges Xegony: Nuquernal Belegrodian 215404 + A_Djinni_Air_Defender 215047; Wesreh Galleantan 215403 + Servant_of_Air 215051; Rindaler Egulrtan 215408 + A_Knight_of_Air 215052; An_Elemental_Arbitor 215406 + An_Air_Infused_Defender 215050; Weruis Herfadban 215407 + An_Air_Phoenix_Scout 215049; Huridaf Vorgaasna 215405 + A_Deadly_Cloudwalker 215048.",
   "Prismatic guardians (215004), High_Councilman_of_the_Queen (215005) and #Muzlakh_the_Chosen (215053) are the room's other resident mobs (Muzlakh has the drophate / combat scripts).",
   "Essence_of_Air hail: summons Amorphous Cloud of Air (29164) if the character has neither it nor 29165."
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
    "trigger": "Hail Essence_of_Air (215432) after Xegony dies, if character lacks 29164/29165 (SummonCursorItem)"
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
  "kindWhy": "Side event on the castellan island (POACastellanController 215419); loot only, no flag.",
  "start": "Passive: kill A_Castellan_of_Air (215000) island mobs; 5th, 10th and 15th kills spawn the three constables in random order.",
  "timers": "castellan_repop 1080000 ms (18 min) when a castellan is still up, else 10800000 ms (3 h); controller only runs when the zone is guild>1 or guild 1 inside the raid window.",
  "mechanics": [
   "Kill 5/10/15 -> #Constable_Alranderisan 215383 / #Constable_Belecohen 215384 / #Constable_Ferabalen 215385 (order random) unique-spawn at fixed 403,463 / 518,456 / 461,498.",
   "When all three constables are dead a #Chamberlain_Escalardian (215411) spawns at 457,412,-88.622 (or placeholder #A_Chamberlain`s_Apprentice 215410 when armor_guy 215418 is absent)."
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
  "kindWhy": "Scripts only reduce hate on the tank every ~60 s and simulate warp-home heals; loot only.",
  "start": "Passive pulls.",
  "timers": "drophate 1000 ms timer in combat (1.666% per tick, about once per 60 s sets tank hate to 1%).",
  "mechanics": [
   "On disengage, when HP < 50% or by chance (100 - ratio %), the boss is warped to its guard point and healed 30% of max HP."
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
  "kindWhy": "Each of the four ring events ends with an Avatar whose Mystical Essence (28639 Wind / 28640 Smoke / 28641 Mist / 28642 Dust, 100%) is the ingredient for the Wind Etched Key (28638) that opens Xegony's rainbow door (player.lua door 1). The combine is not in the scripts. Xegony's Essence of Air then feeds the Quintessence of Elements / Plane of Time access.",
  "groupLimit": "No scripted cap. In the main (guild id 1) zone the ring only activates while eq.guild_one_raid_window_open() is true (ControllerSignal returns early otherwise).",
  "start": "Passive: kill every native island mob (A_Stormrider_Lightningclaw 215013 / A_Mischievous_Stormrider 215002 / A_Fearsome_Stormrider 215014 at the 27 ISLAND_SPAWNIDS). When CheckIsland() finds them all dead, POAStormriderController (215420) starts the event.",
  "timers": "Island repop clock 237600000 ms (66 h) after a success; attempt window 10800000 ms (3 h, 'air_attempt_end') and a 1080000 ms (18 min) island repop after a failed/reset attempt; the Avatar self-depops after 9000000 ms (2.5 h) out of combat; guild instances use lua_modules/air_ring_recovery (RETRY 900 s, ATTEMPT 10800 s, IDLE 9000 s, CYCLE 237600 s).",
  "mechanics": [
   "Eight A_Menacing_Stormrider (215386) spawn and are woken at 60/60/120/120/180/180/240/240 s; Stormrider_Priest_of_Destruction (215387) spawns at -259,-677,115.",
   "Priest death: menacing riders depop and 4 storm_boss_inv traps (215424) are placed randomly (x -589..-169, y -842..-498); stepping into combat with a trap spawns an A_Sporadic_Stormrider (215388).",
   "When the sporadic stormriders are dead and the marker (215414) is up, one real Pherlondien_Clawpike (215390) and fake bosses (215389) spawn at BOSS_LOCS; otherwise placeholder A_Loathesome_Stormclaw (215425).",
   "Boss death spawns #Avatar_of_Wind (215391) at -1591,484,15."
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
  "kindWhy": "Each of the four ring events ends with an Avatar whose Mystical Essence (28639 Wind / 28640 Smoke / 28641 Mist / 28642 Dust, 100%) is the ingredient for the Wind Etched Key (28638) that opens Xegony's rainbow door (player.lua door 1). The combine is not in the scripts. Xegony's Essence of Air then feeds the Quintessence of Elements / Plane of Time access.",
  "groupLimit": "No scripted cap. In the main (guild id 1) zone the ring only activates while eq.guild_one_raid_window_open() is true (ControllerSignal returns early otherwise).",
  "start": "Passive: kill the 21 island elementals (A_Confused_Air_Elemental 215012 / A_Swirling_Elemental_Force 215039). Each kill signals POAElementalController (215421).",
  "timers": "Island repop clock 237600000 ms (66 h) after a success; attempt window 10800000 ms (3 h, 'air_attempt_end') and a 1080000 ms (18 min) island repop after a failed/reset attempt; the Avatar self-depops after 9000000 ms (2.5 h) out of combat; guild instances use lua_modules/air_ring_recovery (RETRY 900 s, ATTEMPT 10800 s, IDLE 9000 s, CYCLE 237600 s).",
  "mechanics": [
   "Island kills 5, 10, 15 and 21 spawn An_Elemental_Champion variants (215395, 215447, 215448, 215449) at -491,-1274 / -434,-1208 / -395,-1283 / -452,-1341; at kill 21 all champions are made attackable.",
   "When all champions are dead, An_Elemental_Masterpiece (215396) unique-spawns at -445,-1284,323 (or the placeholder An_Elemental_Anomaly 215427).",
   "Masterpiece death spawns #Avatar_of_Smoke (215392) at 1396,-680,18."
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
  "kindWhy": "Each of the four ring events ends with an Avatar whose Mystical Essence (28639 Wind / 28640 Smoke / 28641 Mist / 28642 Dust, 100%) is the ingredient for the Wind Etched Key (28638) that opens Xegony's rainbow door (player.lua door 1). The combine is not in the scripts. Xegony's Essence of Air then feeds the Quintessence of Elements / Plane of Time access.",
  "groupLimit": "No scripted cap. In the main (guild id 1) zone the ring only activates while eq.guild_one_raid_window_open() is true (ControllerSignal returns early otherwise).",
  "start": "Passive: kill the island phoenixes (A_Wind_Phoenix 215026 / 215450, Servitor_of_Xegony 215027, A_Phoenix_Breezewing 215058, A_Phoenix_Searedwing 215028, #Calebgrothiel 215324). POAPhoenixController (215423) starts the event when the island is clear.",
  "timers": "Island repop clock 237600000 ms (66 h) after a success; attempt window 10800000 ms (3 h, 'air_attempt_end') and a 1080000 ms (18 min) island repop after a failed/reset attempt; the Avatar self-depops after 9000000 ms (2.5 h) out of combat; guild instances use lua_modules/air_ring_recovery (RETRY 900 s, ATTEMPT 10800 s, IDLE 9000 s, CYCLE 237600 s).",
  "mechanics": [
   "Stage 1: four A_Phoenix_Firesurger (215397) spawn at SURGER_LOCS (369,-741,438 etc.); when all die stage 2 spawns four A_Phoenix_Windsurger (215398).",
   "When the windsurgers are dead Melernil_Faal`Armanna (215399) unique-spawns at 326,-718,441 (or placeholder A_Firewing_Imitor 215429).",
   "Killing a wizard Wind Phoenix (215450) spawns two Ardent_Phoenix_of_Xegony (215430).",
   "Boss death spawns #Avatar_of_Mist (215393) at -1573,-570,356.125."
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
  "kindWhy": "Each of the four ring events ends with an Avatar whose Mystical Essence (28639 Wind / 28640 Smoke / 28641 Mist / 28642 Dust, 100%) is the ingredient for the Wind Etched Key (28638) that opens Xegony's rainbow door (player.lua door 1). The combine is not in the scripts. Xegony's Essence of Air then feeds the Quintessence of Elements / Plane of Time access.",
  "groupLimit": "No scripted cap. In the main (guild id 1) zone the ring only activates while eq.guild_one_raid_window_open() is true (ControllerSignal returns early otherwise).",
  "start": "Passive: kill the 35 island spiders/windwalkers (A_Crystalline_Windwalker 215043 / A_Pristine_Recluse 215044 / A_Vorladien_Webspinner 215045 / #Lossenmachar 215060). POASpiderController (215422) starts the event when the island is clear.",
  "timers": "Island repop clock 237600000 ms (66 h) after a success; attempt window 10800000 ms (3 h, 'air_attempt_end') and a 1080000 ms (18 min) island repop after a failed/reset attempt; the Avatar self-depops after 9000000 ms (2.5 h) out of combat; guild instances use lua_modules/air_ring_recovery (RETRY 900 s, ATTEMPT 10800 s, IDLE 9000 s, CYCLE 237600 s). Dust stage 2 has an extra 3600000 ms (1 h) limit.",
  "mechanics": [
   "Sigismond_Windwalker (215375) grows in size with island kills (every 3 kills, 16 at the last).",
   "Stage 2 (1 h limit, '1h_despawn' 3600000 ms): A_Vorladien_Archwalker (215400) spawn with A_Vorladien_Spawn (215401) adds; 3 archwalker waves, with An_Erratic_Arachnid (215402) spawn points toggled on.",
   "After the third wave Sigismond is made attackable (or placeholder An_Ominous_Recluse 215428 at -400,889,433.6).",
   "Death of the boss spawns #Avatar_of_Dust (215394) at 1671,527,344."
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
  "kindWhy": "Flag-path boss: death spawns Planar Projection 205156 (1200 s) whose hail sets fuirstel 1 -> 2 (if fuirstel==1) and grummus=1 (grants access to the Crypt of Decay; player.lua event_zone sets zone flag 200 when entering zone 200 with grummus). Otherwise gives checklist cl_grummus.",
  "groupLimit": "Projection FLAG_LIMIT = 72 * 2 = 144.",
  "start": "Pull #Grummus (205091).",
  "timers": "Projection depops 1200000 ms (20 min).",
  "mechanics": [
   "Death: ProjectionEligibility.Spawn(205156) at the corpse for the killer's raid/group.",
   "Hail projection: fuirstel==1 -> fuirstel=2; no fuirstel and no cl_grummus -> checklist flag cl_grummus; any hail without grummus -> grummus=1 (flags++)."
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
  "kindWhy": "No flag; death spawns 7-8 arachnae and has gear drops.",
  "start": "Pull #Aramin_the_Spider_Guardian (205095).",
  "timers": "Arachnae script timers not summarised (see An_Arachnae_*.lua).",
  "mechanics": [
   "On death_complete spawns 3-4 An_Arachnae_Serioun (205158) and 3-4 An_Arachnae_Maleveler (205157) (7 or 8 total) at fixed coordinates near z 373."
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
  "kindWhy": "Loot/side event (Rattican's Head 29133 100%); no flag in script.",
  "start": "Engage #Rallius_Rattican (205134) - first combat join starts the event.",
  "timers": "cronies every 290000 ms (initially 1000 ms); youth every 360000 ms (first at 150000 ms); reset 1200000 ms (paused while in combat); trash depop 300000 ms.",
  "mechanics": [
   "On first combat: 2 A_gargantuan_arachnae (205159) spawn at 96,-3384 and -539,-3482.",
   "Every cycle 2 a_bubonian_cronie (205160) spawn at the boss's lair; every 6 min 3-6 A_bubonian_youth (205161) spawn and walk waypoint 7.",
   "Boss death or timeout resets: depop spiders."
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
  "kindWhy": "Drops Grymes Crypt Key (28999) 100%; grep found no script that consumes item 28999 in this repo, so purpose is unknown. No script file for Gryme.",
  "start": "Passive pull of #Gryme_the_Crypt_Guardian (205096).",
  "timers": "unknown",
  "mechanics": [
   "No dedicated script; drops come from the database loot table."
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
  "kindWhy": "Each of the four rings signals the Arbitor controller (arbitor_guy, signal 4 = Dust, 2 = Mud, 1 = Stone, 3 = Vine); once all four are completed within 24 h the Mystical Arbitor of Earth spawns, and its Planar Projection sets earthb_key (door 9-11 into Plane of Earth B).",
  "groupLimit": "none scripted",
  "start": "Passive: kill the dusty warder (218022, spawn point 366233) - the temple wakes.",
  "timers": "Failure respawn FAILURE_RESPAWN_TIME = 900000 ms (15 min); success respawn SUCCESS_RESPAWN_TIME = 237600 * 1000 ms (66 h); invisible 'invis' timer 60000 ms; the despawn man times the attempt out.",
  "mechanics": [
   "Warder death: three streams of dust devotees (218366) rise; kill 37 devotees (devoteeKills == 37).",
   "Then the Triumvirate of Soil (218367 / 218421) advance; when all fall the final defender appears (Perfected Warder of Earth 218413, with Protector 218414 and Follower 218415).",
   "Success sends signal 4 to the Arbitor controller (ARBITOR_GUY 218393); failure resets the ring (15 min)."
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
  "kindWhy": "Ring 2 of 4 toward the Arbitor (signal 2); see Dust Ring.",
  "groupLimit": "none scripted",
  "start": "Passive: kill the blue mudwalkers (218317) in the mire; red mudwalkers (218418) follow.",
  "timers": "Failure respawn 900000 ms (15 min); success respawn 237600 * 1000 ms (66 h); watchdog 5000 ms; RUNNER_GRACE 30 s for the red-wave runners.",
  "mechanics": [
   "Red mudwalkers (218418) release little golem runners (218419) that run to the temple after they die.",
   "The final mudwalker bursts and A_Sludge_Lurker (218357) heaves free; Muck Mudlets (218358), Mud-dite Mudlings (218361), Filth Gorgers (218359), Monsterous Mudwalker (218360) and Merciless Mudslinger (218365) are the later defenders.",
   "Success signals the Arbitor controller with 2."
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
  "kindWhy": "Ring 1 of 4 toward the Arbitor (signal 1); see Dust Ring.",
  "groupLimit": "none scripted",
  "start": "Passive: kill the trigger mobs (Rock Creation 218032 / Crumbling Stone Mass 218031 / Pile of Boulders 218030 / Boulder Thrower 218033).",
  "timers": "The invisible STONEDESPAWN man (218395) spawns when the event begins and depops in 98 minutes, which fails the event; failure respawn 900000 ms; success respawn 237600 * 1000 ms (66 h).",
  "mechanics": [
   "Fortifications (218369) and Mound of Rubble (218370) waves; A_Rock_Monstrosity (218371, 800000 hp) with stone heaps (218372).",
   "Final: Peregrin_Rockskull (218374) with An_Encrusted_Dirt_Cloud (218373).",
   "Success signals the Arbitor controller with 1."
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
  "kindWhy": "Ring 3 of 4 toward the Arbitor (signal 3); see Dust Ring.",
  "groupLimit": "none scripted",
  "start": "Passive: kill the tainted rock beasts (218019).",
  "timers": "Boss adds timer 60000 ms; adds depop 600000 ms; success cleanup depop 600000 ms; failure respawn 900000 ms; success respawn 66 h.",
  "mechanics": [
   "Last tainted rock beast falls -> vines raise the bloodthirsty creatures (218362).",
   "Last bloodthirsty creature falls -> Derugoak_Bloodwalker (218363; fake boss A_Bloodsoaked_Vegerog 218364) emerges; mangled adds (218420) spawn every 60 s in combat.",
   "Success signals the Arbitor controller with 3."
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
  "kindWhy": "Flag-path boss: death spawns A_Planar_Projection 218398 (1200 s) whose hail sets earthb_key=1 ('character flag'); doors 9-11 move characters with earthb_key into Plane of Earth B (zone flag 222). Seer header lists earthb_key.",
  "groupLimit": "Projection MAX_KEYS = 72 per spawn.",
  "start": "Complete all four rings (Stone 1, Mud 2, Vine 3, Dust 4), each within the last 24 h (WINDOW = 86400 s); arbitor_guy then unique-spawns A_Mystical_Arbitor_of_Earth (218375) at 1530,-2739,28 (retry every 30 s if it fails).",
  "timers": "Arbitor depop 3000000 ms; drophate 5% per second tick (about once per 20 s: sets tank hate to 1%); ring progress persisted per guild in eq data for 24 h + 1 s.",
  "mechanics": [
   "Disengage heal: below 50% HP or random warp-home with 30% heal.",
   "Death: ProjectionEligibility spawns the Planar Projection; hail -> earthb_key."
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
  "kindWhy": "Named mob with only a drophate script; traps (encounters/Traps.lua) are environment.",
  "start": "Passive.",
  "timers": "trap mob depop 1200000 ms.",
  "mechanics": [
   "Tantisala_Jaggedtooth (218038) drophate timer 1000 ms."
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
  "kindWhy": "Flag-path boss of Earth: Avatar death spawns Essence_of_Earth (222041, 1200 s) whose hail summons Mound of Living Stone (29146), one of the four Essence items for the Quintessence of Elements (29165) / Plane of Time.",
  "groupLimit": "Essence_of_Earth FLAG_LIMIT 72.",
  "start": "Kill all twelve Rathe Councilmen on their native spawn points (369377, 369380, 369382, 369384, 369386, 369387 = A_Rathe_Councilman 222003 mezable; 369376, 369378, 369379, 369381, 369383, 369385 = 222039 unmezable). Combat mechanics live in A_Rathe_Councilman.lua; the encounter file only owns deaths and recovery.",
  "timers": "COUNCIL_RESPAWN 420 s; AVATAR_IDLE 2100 s (35 min of hesitation, paused during combat and never refilled); failure cooldown 900 s; success cooldown 496800 s (138 h); watchdog 1000 ms. Council teleport timer 60000 ms and unmezable checkhp 3000 ms.",
  "mechanics": [
   "When all twelve Council deaths are confirmed, the Council spawn points are held and #Avatar_of_Earth (222040, level 80, 500,000 hp) unique-spawns at 2050,410,-210.",
   "Idle budget of the Avatar is 35 minutes; running out -> Fail (Retry 900 s).",
   "Avatar death -> Essence_of_Earth projection for the killer; Council spawn points are held for the success cooldown."
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
    "trigger": "Hail Essence_of_Earth after the Avatar dies, if character lacks 29146/29165 (SummonCursorItem)"
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
  "kindWhy": "Chain unlocking the Warlord; loot only. Door 2/3 click requires the wall spawn sets (DOOR1_IDS/DOOR2_IDS in player.lua) to be dead to open - zone access, not a character flag.",
  "start": "Passive: kill the three #War_Chieftan_* (222035 Birak, 222036 Galronar, 222037 Awisano); the invisible kill markers (spawn ids 369487-369489) let Gintolaken (spawn 369491) spawn even after a zone crash.",
  "timers": "check timer 1000 ms at Chieftan spawn; Gintolaken drophate 1000 ms.",
  "mechanics": [
   "'The' (signal controller) checks the three markers; when none remains #Warlord_Gintolaken (222038, 1,050,000 hp) is allowed to spawn.",
   "Warlord and chieftain script share the standard disengage-heal / tank-hate-drop behaviour."
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
  "kindWhy": "Flag-path boss of Fire: death spawns Essence_of_Fire (217454, ProjectionEligibility) whose hail summons Globe of Dancing Flame (29147) - one of the four Essence items that make the Quintessence of Elements (29165) needed for the Plane of Time (zebuxoruk '2' + 29165). pofire flag series is 'pofire' in Seer header.",
  "groupLimit": "Essence_of_Fire FLAG_LIMIT = 72 (it depops when 72 items have been handed out); killer raid/group eligibility via ProjectionEligibility.",
  "start": "Engage Guardian_of_Doomfire (217050, spawn point 367088) while the encounter phase is Ready (phase 0).",
  "timers": "Shared event clock EVENT_SECONDS = 17500 s (4 h 51 min 40 s) including combat, never extended; Fennin Ro red-text warnings every WARNING_SECONDS = 2700 s; failure retry FAILURE_RETRY_TIME = 64800 * 1000 ms (18 h); success respawn SUCCESS_RESPAWN_TIME = 496800 * 1000 ms (5 d 18 h = 138 h Guardian reuse); watchdog 1000 ms.",
  "mechanics": [
   "Stage 1 (Army of Flames): a_rage_reaver_of_flame 217417, a_chaos_healer_of_flame 217418, a_dark_magus_of_flame 217419 and a_doomfire_darkfiend 217421 / chaosfiend 217420 / ragefiend 217422 at fixed coordinates; all must be confirmed dead to advance.",
   "Stage 2 (commanders): Azobian_the_Darklord 217425, Javonn_the_Overlord 217426, Hebabbilys_the_Ragelord 217453, Reaxnous_the_Chaoslord 217427 plus fresh soldiers.",
   "Stage 3 (Council of Fire): Chancellor_Kirtra 217432, Chancellor_Traxom 217433, Omni_Magus_Crato 217429, Warlord_Prollaz 217428.",
   "Stage 4: Fennin_Ro_the_Tyrant_of_Fire (217440, level 80, 1,000,000 hp) at -930,-1504,-160 plus ten elite_guardian_of_ro (217430) spawn points armed.",
   "Clock expiry or an unverifiable state -> Fail (retry 18 h); Fennin death -> victory, 138 h cooldown, Essence_of_Fire spawns for the killer."
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
    "trigger": "Hail Essence_of_Fire (217454) after Fennin Ro dies, if character lacks 29147/29165 (SummonCursorItem)"
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
  "kindWhy": "SnareImmunity encounter gives each of 9 field-1 mob types a 1-in-5 chance (math.random(5)==1) to spawn snare-immune; named field mobs (Blazzax, Babnoxis, Arch Mage Yozanni, General Reparm...) are unscripted here.",
  "start": "Passive.",
  "timers": "none",
  "mechanics": [
   "Spawn-time snare immunity (special ability 16) on obsidian tree spiders, jopal hunters/gatherers/lavahurlers, flame lords and fiery spirit steeds."
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
  "kindWhy": "Giwin_Mirakon (206038 preflag NPC) 'test the machine' sets zeks=1; killing the Behemoth spawns flagger #Giwin_Mirakon (206203, 600 s) whose hail sets zeks 1 -> 2 (needed for Drunder door: zeks >= 2). Seer header: 'zeks - PoI Giwin flags + Zeks in Tactics'.",
  "groupLimit": "Flagger FLAG_LIMIT 72 per spawn (ProjectionEligibility).",
  "start": "Talk to Giwin_Mirakon (preflag NPC): hail, 'great warrior', 'task', 'test the machine' (zeks=1). Then enter the main construction area; the Weapon_Event_Master controller (206197) fires clockwork devices.",
  "timers": "Wave timer WAVE_TIME = 48000 ms; devices spawn one per wave location (6 locations/wave table, 12:00-10:30 clock positions); Behemoth stays asleep until 10 qualifying kills ('kills >= 10'); once awake depop timer 10800000 ms (3 h) with failure retry FAILURE_RETRY = 600000 ms (10 min) on spawn timer 345273; boundscheck 2000 ms; flagger Giwin depops 600000 ms.",
  "mechanics": [
   "Every 48 s a clockwork device (206001) spawns at a random of 6 points in each of 6 'clock' areas, on grids 13-20, and walks to the Behemoth room where it can blow up (spell 2321).",
   "After 10 qualifying kills the Behemoth (206046) is woken (bodytype construct, aggro on) and gets a random AI spell (Gas Leak 1080 / Deathfog IV 1081 / Biomelt IX 1082 / Liquid Hydrokill 1083).",
   "If the Behemoth leaves x 1033..1215 / y -120..120 it resets (Balance of the Nameless).",
   "Death: waves stop, devices depop, #Giwin_Mirakon (206203) spawns at 1013,0,2.1 for the killer's group (600 s)."
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
  "name": "Xanamech Nezmirthafen / Nitram Anizok (poi_door flag)",
  "kind": "flag",
  "kindWhy": "Killing #Xanamech_Nezmirthafen signals Nitram_Anizok (206033) who then, on hail, sets qglobal poi_door=1; player.lua door 7 only force-opens for characters with poi_door. Seer header: 'poi_door - Plane of Innovation door openable: Xanamech killed'.",
  "groupLimit": "Nitram FLAG_LIMIT 72 per kill, killer's raid/group only (ClientCanFlag).",
  "start": "Hand Nitram_Anizok (206033) item1=9295 Copper Node, item2=9426 Bundle of Super Conductive Wires, item3=9434 Intact Power Cell (all three; they drop 2% each from Xanamech and the Innovation junk) -> 'please follow me!', he walks waypoint grid 22 and the dragon wakes via signal 1.",
  "timers": "Nitram depop 3600000 ms after the turn-in; after the dragon dies 600000 ms; Xanamech lies down at spawn (300 ms 'lie'), wake timer 3500 ms; Xanamech depop 1800000 ms.",
  "mechanics": [
   "Xanamech (206208) is asleep until Nitram's walk signals him; once awake he is attackable (construct).",
   "Death: signal 206033 with the killer's entity id -> Nitram records the killer's raid/group, becomes interactive; hail while still unflagged -> poi_door=1 'character flag'.",
   "Nitram's spawn respawn timer is set to 1 so new attempts can begin after his window ends."
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
  "kindWhy": "player.lua door 145 sets qglobal time=1 and zone flags 219 and 223 for a character with zebuxoruk == '2' AND Quintessence of Elements (29165) in inventory; Muon's 'yes' ports to the time-projection chamber and spawns Loreseeker Maelin (206209).",
  "start": "Hail #Chronographer_Muon (206044) while holding item 29165 and zebuxoruk == 2; say 'yes' -> MovePC to 291,-860,-1850 and unique-spawn Maelin at 763,-837,-1887. Then click door id 145 (needs 29165 + zebuxoruk 2).",
  "timers": "Maelin depop 900000 ms.",
  "mechanics": [
   "Muon only recognises players with qglobal zebuxoruk == '2' and 29165 in main inventory/bags/cursor (HasItemInvOnly).",
   "Maelin says the Plane of Time bond will be formed once the machine is activated ('researched')."
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
  "kindWhy": "No flag or reward is scripted; runs continue until the group quits; Kelrig only teleports you out.",
  "size": "6 players",
  "groupLimit": "Max six players ('a maximum of six at one time'); two rooms; MoveGroup radius 150.",
  "start": "Talk to #Researcher_Kaeon (206045): hail, 'comply to endurance testing', 'ready' -> group sent to the testing bay (-274,-760); Assistant Kelrig (206204) then asks 'ready' / 'quit'.",
  "timers": "Wave timer 120000 ms (randomised (0..21)+107 s thereafter); room reset 1800000 ms (720000 ms after completion); mob depop 720000 ms; idle check 3000000 ms.",
  "mechanics": [
   "8 waves with WAVE_SPAWN_NUMS = {3,4,6,8,4,4,8,7} (44 mobs) of manaetic contraption / gadget / persistent mechanization (206199/206201/206202) and manaetic devices (206200/206205/206206/206207, device tier rises with run count).",
   "After wave 8 and enough kills (> total-15) Kelrig respawns; saying ready starts another, harder run; at runs>3 he thanks you and casts Mechinetic Dislocation IV (1090) to eject you."
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
  "name": "#Junk Beast (roamer)",
  "kind": "optional",
  "kindWhy": "Scripted patrol only; drops Junk Beast Power Source (29145) 100%, whose use is not in the scripts.",
  "start": "Roaming spawn (spawn id 345196 = grid 4 patrol; roambox spawn ids > 700000).",
  "timers": "type timers 3000 ms at spawn.",
  "mechanics": [
   "Spawns via grid 4 -> walks to -690,962,-44.5 and patrols the short route near the mech-dragon room; or roambox spawn -> grid 9 whole-zone route."
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
  "kindWhy": "Named mobs that teleport during the fight; loot only.",
  "start": "Passive pulls.",
  "timers": "teleport timer random 2-30 s in combat; boundscheck 3000 ms.",
  "mechanics": [
   "Each prototype randomly teleports on a 2-30 second timer while engaged and has a boundscheck leash."
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
  "kindWhy": "qglobal mavuin 0 -> 1 -> 2 -> 3 is the Justice flag series; mavuin==3 opens the Valor/Storms portals in Tranquility and gates the Askr door in Storms (mavuin>=3).",
  "start": "#Mavuin: say 'information' (mavuin unset -> 1) after hail; The_Tribunal (201508): say 'mavuin' with mavuin==1 and at least one Mark in inventory (FindMarks > 0) -> mavuin=2; #Mavuin: hail with mavuin>=2 -> mavuin=3.",
  "timers": "qglobal expiry arg 5,'F' (permanent).",
  "mechanics": [
   "Mark items checked: 31796, 31842, 31844, 31845, 31846, 31960 (one per trial).",
   "The Tribunal also summons The Mark of Justice (31599) on 'knowledge' when all 6 marks are present or qglobal seventh is set."
  ],
  "npcs": [],
  "rewards": [
   {
    "itemId": 31599,
    "name": "The Mark of Justice",
    "trigger": "Say 'knowledge' to The_Tribunal holding all six Marks (or qglobal seventh); also sets seventh=1"
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
  "kindWhy": "Entered with The Mark of Justice (31599) after the six trial Marks; the kill script sets no qglobal or flag (the 'seventh' flag was set earlier by The_Tribunal). 1,080,000 hp boss, treated as optional raid loot.",
  "start": "Hold The Mark of Justice (31599) on the cursor and click doors id 1-6 (player.lua event_click_door sets a 1 ms 'seventh' timer that MovePC's you to 76,1310,10, unless the Hammer is engaged). Then hail The_Seventh_Hammer (201074) and say 'ready to face' -> he adds you to his hate list.",
  "timers": "'verdict' timer first at 181-190 s then every 187000 ms (casts Verdict of Eternity 1108 via the invisible Tribunal 201423); 'tremor' first at 86-95 s then every 187000 ms (Tremor of Judgment 1107); 'stop' timer 600000 ms after combat ends.",
  "mechanics": [
   "Both spells are cast by #The_Tribunal_ (201423) and animate the visible The_Tribunal (201427)."
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
  "name": "#the_ancient_crawler (raid_target)",
  "kind": "optional",
  "kindWhy": "Flagged raid_target in eqemu_npc_types; no script for it was found in pojustice/ (loot only).",
  "start": "unknown (no script)",
  "timers": "unknown",
  "mechanics": [
   "No quest script; named in the DB only."
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
  "kindWhy": "Completing ANY one trial (a Mark in inventory) lets The Tribunal advance mavuin 1 -> 2 on 'mavuin'; having all six Marks lets 'knowledge' set qglobal seventh=1 and summon The Mark of Justice (31599). Mavuin=3 is the key for Valor/Storms (PoTranquility portal 16/21).",
  "groupLimit": "No scripted cap; The Tribunal teleports group/raid-group members within 50 units of the speaker (MoveGroup(201, ..., 50, ...)).",
  "start": "Say to The_Tribunal (201508): 'prove' -> 'prepared' -> 'ready to begin the Trial of Lashing'. Fails with 'That trial is already underway' if trialsUnderway or a mob is in the trial. Controller 201512 is spawned and the group is teleported.",
  "timers": "First wave 26000 ms after the controller spawns; wave interval 192000 ms (WAVE_TIMER 192000 ms, 'AK timer 3:12'); 4 waves; mobs depop 60000 ms out of combat (a timeout after wave 1 fails the trial); trial failed -> accessible again in 60 s (update_spawn_timer 60000) and players returned after 10 s; trial won -> accessible again in 600 s, 'warn' at 540 s and boot at 599 s.",
  "mechanics": [
   "Four waves from the controller (#Event_Lashing_Control 201512): savage lashers (201466), malevolent punishers (201463), rare #a_harrowing_lasher (201462) / #a_stinging_nemesis (201472), plus a_scourge_of_honor (201467) that cannot be fought directly.",
   "Tormented prisoners (a_tormented_prisoner 201502, ogres) are being lashed; if any prisoner dies ('You have failed') the trial fails (OgreDeath -> TrialFail -> signal 1 to Tribunal).",
   "Scourges of honor spawn on a 30-60 s timer alongside flickering spirits (201503 level 15 / 201516 level 30, 7000 hp); killing the 7k hp spirit removes all scourges.",
   "Boss #Lashman_Azakal (201479) spawns at 1334,-1119,1.126 when wave 4 is out and scourges == 0; his death signals the Tribunal with 7 (success).",
   "Randomised spirit placement (3 locations)."
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
    "trigger": "100% loot from #Lashman_Azakal (201479) - the Mark that proves this trial (script lists marks 31796, 31842, 31844, 31845, 31846, 31960 in FindMarks)"
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
  "kindWhy": "Completing ANY one trial (a Mark in inventory) lets The Tribunal advance mavuin 1 -> 2 on 'mavuin'; having all six Marks lets 'knowledge' set qglobal seventh=1 and summon The Mark of Justice (31599). Mavuin=3 is the key for Valor/Storms (PoTranquility portal 16/21).",
  "groupLimit": "No scripted cap; The Tribunal teleports group/raid-group members within 50 units of the speaker (MoveGroup(201, ..., 50, ...)).",
  "start": "Say to The_Tribunal (201508): 'prove' -> 'prepared' -> 'ready to begin the Trial of Execution'. Fails with 'That trial is already underway' if trialsUnderway or a mob is in the trial. Controller 201511 is spawned and the group is teleported.",
  "timers": "First wave 26000 ms after the controller spawns; wave interval 137000 ms (WAVE_TIMER 137000 ms, 'AK timer 2:15-2:20'); 4 waves; mobs depop 60000 ms out of combat (a timeout after wave 1 fails the trial); trial failed -> accessible again in 60 s (update_spawn_timer 60000) and players returned after 10 s; trial won -> accessible again in 600 s, 'warn' at 540 s and boot at 599 s.",
  "mechanics": [
   "Controller #Event_Execution_Control (201511) spawns nemesis waves (a_dark_nemesis 201457 / a_fierce_nemesis 201458) with named #priest_of_doom (201484) and #herald_of_destruction (201478) while an_executioner (201501) walks toward a_sentenced_prisoner (201500).",
   "Executioner timer 60000 ms first / 40000 ms, then 34000 ms after each kill; if the executioner reaches the prisoner the prisoner dies and the trial fails (fail timer 2500 ms, TrialFail -> signal 2).",
   "After four kills per wave the executioner is depopped; at wave 4 the prisoner depops and #Prime_Executioner_Vathoch (201485) spawns at 195,-1157,82.",
   "Boss death signals Tribunal 8 (success).",
   ""
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
    "trigger": "100% loot from #Prime_Executioner_Vathoch (201485) - the Mark that proves this trial (script lists marks 31796, 31842, 31844, 31845, 31846, 31960 in FindMarks)"
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
  "kindWhy": "Completing ANY one trial (a Mark in inventory) lets The Tribunal advance mavuin 1 -> 2 on 'mavuin'; having all six Marks lets 'knowledge' set qglobal seventh=1 and summon The Mark of Justice (31599). Mavuin=3 is the key for Valor/Storms (PoTranquility portal 16/21).",
  "groupLimit": "No scripted cap; The Tribunal teleports group/raid-group members within 50 units of the speaker (MoveGroup(201, ..., 50, ...)).",
  "start": "Say to The_Tribunal (201508): 'prove' -> 'prepared' -> 'ready to begin the Trial of Stoning'. Fails with 'That trial is already underway' if trialsUnderway or a mob is in the trial. Controller 201513 is spawned and the group is teleported.",
  "timers": "First wave 26000 ms after the controller spawns; wave interval 170000 ms (WAVE_TIMER 170000 ms, 'AK timer 2:50-2:55'); 4 waves; mobs depop 60000 ms out of combat (a timeout after wave 1 fails the trial); trial failed -> accessible again in 60 s (update_spawn_timer 60000) and players returned after 10 s; trial won -> accessible again in 600 s, 'warn' at 540 s and boot at 599 s.",
  "mechanics": [
   "Controller #Event_Stoning_Control (201513) spawns waves of a_relentless_punisher (201464), a_shadow_grinder (201469) with rare #nemesis_of_stone (201482) / #a_ruthless_grinder (201465) around a_pitiless_avenger archers (201475) pelting an_accused_prisoner (201504).",
   "Prisoner takes damage from archers; if she collapses ('no longer shielding herself from the stones') the trial fails (TrialFail -> signal 3).",
   "When killed == spawned in wave 4, #Yurae_Zhaleem (201496) unique-spawns at -130,-1120,75.",
   "Boss death signals Tribunal 9 (success).",
   ""
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
    "trigger": "100% loot from #Yurae_Zhaleem (201496) - the Mark that proves this trial (script lists marks 31796, 31842, 31844, 31845, 31846, 31960 in FindMarks)"
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
  "kindWhy": "Completing ANY one trial (a Mark in inventory) lets The Tribunal advance mavuin 1 -> 2 on 'mavuin'; having all six Marks lets 'knowledge' set qglobal seventh=1 and summon The Mark of Justice (31599). Mavuin=3 is the key for Valor/Storms (PoTranquility portal 16/21).",
  "groupLimit": "No scripted cap; The Tribunal teleports group/raid-group members within 50 units of the speaker (MoveGroup(201, ..., 50, ...)).",
  "start": "Say to The_Tribunal (201508): 'prove' -> 'prepared' -> 'ready to begin the Trial of Torture'. Fails with 'That trial is already underway' if trialsUnderway or a mob is in the trial. Controller 201514 is spawned and the group is teleported.",
  "timers": "First wave 26000 ms after the controller spawns; wave interval 172000 ms (WAVE_TIMER 172000 ms, 'AK timer ~172 s'); 4 waves; mobs depop 60000 ms out of combat (a timeout after wave 1 fails the trial); trial failed -> accessible again in 60 s (update_spawn_timer 60000) and players returned after 10 s; trial won -> accessible again in 600 s, 'warn' at 540 s and boot at 599 s.",
  "mechanics": [
   "Controller #Event_Torture_Control (201514) spawns wraith_of_agony (201495) with twisted tormentors (201473), nemesis_of_pain (201481), #nemesis_of_despair (201480) and #an_accursed_tormentor (201474) near a_tortured_prisoner (201505); Pain_and_Suffering (201506) and Relief (201507) are scenery/relief NPCs.",
   "Prisoner death fails the trial (event death on PRISONER_TYPE -> TrialFail -> signal 4); killing the wraith of agony gives relief.",
   "At wave 4 with killed >= 19, #Punisher_Veshtaq (201487) spawns at 887,-1121,60.",
   "Boss death signals Tribunal 10 (success).",
   ""
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
    "trigger": "100% loot from #Punisher_Veshtaq (201487) - the Mark that proves this trial (script lists marks 31796, 31842, 31844, 31845, 31846, 31960 in FindMarks)"
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
  "kindWhy": "Completing ANY one trial (a Mark in inventory) lets The Tribunal advance mavuin 1 -> 2 on 'mavuin'; having all six Marks lets 'knowledge' set qglobal seventh=1 and summon The Mark of Justice (31599). Mavuin=3 is the key for Valor/Storms (PoTranquility portal 16/21).",
  "groupLimit": "No scripted cap; The Tribunal teleports group/raid-group members within 50 units of the speaker (MoveGroup(201, ..., 50, ...)).",
  "start": "Say to The_Tribunal (201508): 'prove' -> 'prepared' -> 'ready to begin the Trial of Hanging'. Fails with 'That trial is already underway' if trialsUnderway or a mob is in the trial. Controller 201515 is spawned and the group is teleported.",
  "timers": "First wave 26000 ms after the controller spawns; wave interval 118000 ms (WAVE_TIMER 118000 ms, 'AK timer ~118-119 s'); 4 waves; mobs depop 60000 ms out of combat (a timeout after wave 1 fails the trial); trial failed -> accessible again in 60 s (update_spawn_timer 60000) and players returned after 10 s; trial won -> accessible again in 600 s, 'warn' at 540 s and boot at 599 s.",
  "mechanics": [
   "Controller #Event_Hanging_Control (201515) spawns a_breathless_void (201449), a_stifling_nemesis (201471), rare #a_smothering_nemesis (201470) / #phantom_of_asphyxiation (201483) and spirit_of_suffocation (201489/201490/201491, timer 47000 ms) around three sentenced prisoners (201497/201498/201499).",
   "Each prisoner has a 'noose' timer of 17000 ms; letting a prisoner die fails the trial (TrialFail -> signal 5).",
   "At wave 4 with killed >= 16 #Gallows_Master_Teion (201477) spawns at 490,-1052,76.251.",
   "Boss death signals Tribunal 11 (success).",
   ""
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
    "trigger": "100% loot from #Gallows_Master_Teion (201477) - the Mark that proves this trial (script lists marks 31796, 31842, 31844, 31845, 31846, 31960 in FindMarks)"
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
  "kindWhy": "Completing ANY one trial (a Mark in inventory) lets The Tribunal advance mavuin 1 -> 2 on 'mavuin'; having all six Marks lets 'knowledge' set qglobal seventh=1 and summon The Mark of Justice (31599). Mavuin=3 is the key for Valor/Storms (PoTranquility portal 16/21).",
  "groupLimit": "No scripted cap; The Tribunal teleports group/raid-group members within 50 units of the speaker (MoveGroup(201, ..., 50, ...)).",
  "start": "Say to The_Tribunal (201508): 'prove' -> 'prepared' -> 'ready to begin the Trial of Flame'. Fails with 'That trial is already underway' if trialsUnderway or a mob is in the trial. Controller 201510 is spawned and the group is teleported.",
  "timers": "First wave 26000 ms after the controller spawns; wave interval 130000 ms (WAVE_TIMER 130000 ms, 'AK timer ~130 s'); 4 waves; mobs depop 60000 ms out of combat (a timeout after wave 1 fails the trial); trial failed -> accessible again in 60 s (update_spawn_timer 60000) and players returned after 10 s; trial won -> accessible again in 600 s, 'warn' at 540 s and boot at 599 s.",
  "mechanics": [
   "Controller #Event_Burning_Control (201510) spawns fiend_of_flame (201476) / spirit_of_flame (201488) in 4-mob waves (47/47/3/3 percent mix with #a_burning_nemesis 201450 and #a_fiery_aggressor 201459) and The_flame (201509) casting Searing Heat 1281 / Wave of Heat 1131 every 28 s.",
   "Mobs walk to the centre (880,-730); a mob timing out (60000 ms) after wave 1 fails the trial (TrialFail -> signal 6); mobs that reach the stake cast Unfold Fletching Kit 3610.",
   "At wave 4 with killed >= 16 #Punisher_of_Flame (201486) spawns at 885,-725,58.251.",
   "Boss death signals Tribunal 12 (success); boss corpse decay timer 480000 ms.",
   ""
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
    "trigger": "100% loot from #Punisher_of_Flame (201486) - the Mark that proves this trial (script lists marks 31796, 31842, 31844, 31845, 31846, 31960 in FindMarks)"
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
  "kindWhy": "Hub NPC that converts boss-kill flags into the next flag: cipher=1 (needs mmarr and saryrn, which are then deleted), zebuxoruk=1 (needs mmarr_book and karana==4, which are deleted), zebuxoruk=2 (zebuxoruk==1 and zeks==7), zeks 5 -> 6 (needs cipher). cipher + zeks>=6 gate Tower of Solusek Ro; zebuxoruk 2 gates Water/Earth/Air and the Time machine.",
  "start": "Hail Maelin (cipher check; requires qglobals mmarr AND saryrn); say 'lore' with mmarr_book and karana==4 (zebuxoruk=1); say 'information' with zebuxoruk==1 and zeks==7 (zebuxoruk=2), or with cipher and zeks==5 (zeks=6).",
  "timers": "all qglobals have expiry arg 5,'F' (permanent).",
  "mechanics": [
   "Hail with qglobal time, or zebuxoruk=='2' plus Quintessence of Elements (29165): Maelin points you to Chronographer Muon.",
   "zebuxoruk '2' text: collect the elemental essences (Fire, Air, Water, Earth) and combine them to open the Plane of Time machine in Innovation."
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
  "kindWhy": "The authoritative PoP flag index: header lists every character-flag qglobal and checklist flag; 'unlock memories' converts a cl_* checklist flag into its real flag if the preflags are present (checklistFlags table).",
  "start": "Sit and say 'guided meditation' (lists your flag state) or 'unlock' + 'memories' (UnlockMemories). GMs (Admin >= 80) can say 'time' to grant every flag or 'delete' to remove them.",
  "timers": "n/a",
  "mechanics": [
   "Flags: mavuin (3 values), seventh, thelin (4), poi_door, zeks (7), fuirstel (5), grummus, aerindar (2), bertox_key, hohtrials ('abc'), mmarr, mmarr_book, tylis (2), saryrn, karana (4), cipher, sol_room ('abcde'), zebuxoruk (2), pofire (2), time, earthb_key.",
   "Checklist flags: cl_grummus, cl_maze, cl_behemoth, cl_aerindar, cl_terris, cl_bertox, cl_keeper, cl_saryrn, cl_vallon, cl_tallon, cl_rallos, cl_karana, cl_mmarr, cl_mmarr_book, cl_solusek."
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
  "kindWhy": "Hailing Thelin_Poxbourne at the end (state 4) with qglobal thelin == 1 sets thelin=2 ('character flag'); the Seer header lists 'thelin - PoNightmare flag series'. Checklist flag cl_maze is given instead if the player has no thelin flag.",
  "size": "24 per dream",
  "groupLimit": "Three simultaneous dreams (rooms); max 24 seats per room (Seats()+Needed > 24 denied); one raid per room (rid recorded), in-room clients beyond the limit are removed (CheckRemoveFromTrial).",
  "start": "Talk to Thelin_Poxbourne outside (204070): 'hail', 'dagger', 'help', then 'ready' -> raid/group sent to a free maze room (needs Maze_Checker governor 204458). First port-in sets state 1 and a 300 s wait (room.wait_until = Now()+300) before the maze starts.",
  "timers": "Start wait 300 s after first entry; ARRIVAL_GRACE 60 s; boss-state depop timer 7200000 ms (2 h) so the room cannot lock; after the dagger is restored the depop timer is reset to 1500000 ms (25 min); Terris dialogue talk1 5000 ms, talk2 8000 ms, talk3 8000 ms, terrisdepop 2000 ms, then 600000 ms; mobs depop 1200000 ms.",
  "mechanics": [
   "Maze room states: 0 free, 1 group ported but not started, 2 Thelin wandering, 3 boss spawned (accepting Dagger Blade Shard), 4 dialogue complete, 5 cleanup.",
   "Thelin (204486 inside) walks waypoints; at waypoints 26/46/57/71/88/99 he recovers dagger pieces and spawn waves of nightstalkers (204472 sinister, 204473 thulian, 204476 abhorrent), ravens (204463), arachnids (204477) plus a nightmarish_construct (204487) each wave.",
   "At waypoint 26 the final a_construct_of_nightmares (204464) spawns; it drops the Dagger Blade Shard (9258) 100%.",
   "Hand the Dagger Blade Shard 9258 to Thelin (state 3) -> QuestReward Thelin's Dagger (9259); Terris_Thule (204483, lvl 1 dialogue form) spawns and talks; hail Thelin again (state 4) for thelin=2 and exit."
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
    "trigger": "Turn in Dagger Blade Shard (9258) to Thelin_Poxbourne while room state == 3"
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
  "kindWhy": "Death spawns A_Planar_Projection (221042) whose hail sets thelin 2 -> 3 (flag series); preflag 'cl_terris' if thelin missing/1.",
  "groupLimit": "Projection FLAG_LIMIT (72 per ProjectionEligibility; see nightmareb/A_Planar_Projection.lua).",
  "start": "Pull Terris_Thule (221041).",
  "timers": "checkhp 3000 ms after combat drop (reset to 100%); boundscheck 1000 ms in combat; projection depops 1200000 ms (20 min).",
  "mechanics": [
   "Event hp: 95% message; 79% and 69% spawn one dream defiler per attacking client (221045 small / 221044 large) at -1661,-168,140; 50% casts Direption of Dreams (3150); 40% four grotesque statues (221043) wake from spawn ids 365397/366053/366176/367232.",
   "Leashes: outside x -1580..-2090 / y -280..250 she resets to spawn, full HP, Balance of the Nameless 3230.",
   "Death: reset adds, Planar Projection spawns at the corpse."
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
  "kindWhy": "No flag or qglobal in Mujaki.lua; loot/xp event (Nightmare Rift 32546 100%).",
  "size": "24 per room",
  "groupLimit": "Three rooms, up to 24 each (Etumer says 'twenty four'); ports<4 groups per room; raid rule: first group's raid id is saved and only that raid may enter; non-raid groups cannot join raided rooms.",
  "start": "Talk to Etumer (204036): 'hail', 'brother', 'perhaps', then 'ready' -> group moved into a free trial room (Grave_Checker governor 204455). Event starts 5 minutes after the first group ports in.",
  "timers": "First wave 5 min after port; wave timer 120000 ms; 8 waves then the boss is made targetable; Mujaki/riders depop 1500000 ms after becoming active (paused in combat); respawn after 25 minutes of cumulative non-aggro per header comment.",
  "mechanics": [
   "Waves 1-3 singles, 4-7 doubles ('double' timer 3000 ms spawns a second set), 8 -> ActivateBoss.",
   "a_servant_of_Mujaki (204470, lvl 58) wave mobs; platform riders (204471, lvl 60) are created from servants that reach Mujaki; helots (204466).",
   "Mujaki (204039) becomes targetable (bodytype 3) only after wave 8."
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
  "kindWhy": "No flag; loot (Screamstaff, Ribbon Choker, Scorched Wand) only.",
  "size": "2 groups",
  "groupLimit": "Seilaen ports at most 2 groups ('ports < 2') to the plateau; 'ready' ports a group within 150 units.",
  "start": "Talk to Seilaen (204047): hail, 'help', 'following', 'locket', 'want' (if Deyid not already up it spawns #Deyid_the_Twisted 204461 at 1011,1081,283 and moves you to 1213,1103,282), then 'deyid' and 'ready' to bring more groups.",
  "timers": "Deyid depop 1800000 ms; checkbounds 5000 ms; foreboding trees (204484) depop 3600000 ms; blighted/corrupt treants (204459/204460) depop 100000 ms; Seilaen resets ports 600000 ms after if players remain on plateau.",
  "mechanics": [
   "HP events: 85% spawns 11 foreboding trees ringed round the plateau; 60% they close in; 45% six of them transform into blighted/corrupt treants that run at Deyid's target.",
   "Death signals Seilaen (frees her) and foreboding trees."
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
  "kindWhy": "Placeholder chain of named mobs; no flag.",
  "start": "Passive: kill #The_Bullyrag_Bat (204010); each death unique-spawns the next link.",
  "timers": "unknown (spawn2 respawn is DB-side).",
  "mechanics": [
   "#The_Bullyrag_Bat dies -> #The_Painwrack_Hobgoblin (204482) at 727,4567,-97.75.",
   "Painwrack dies -> #The_Fearsome_Hobgoblin (204481) at 1686,4079,36.875.",
   "Fearsome dies -> #Hobgoblin_Anguish_Lord (204479) at 1484,2650,-69.5 with a_malevolent_mephit (204468) and a_fearsome_bat (204465)."
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
  "kindWhy": "Scripts only leash / spawn adds. Vhaksiz drops Heart of Vhaksiz (28801) which is a turn-in item to Cadelid_Etord in Plane of Knowledge together with 28795 (side quest).",
  "start": "Passive pulls.",
  "timers": "Terror Matriarch hatchling timer 30000 ms; Dreamkeeper depop 600000 ms; Vhaksiz leash 3000 ms (>155 units reset, spell 2830).",
  "mechanics": [
   "#Terror_Matriarch (204034) every 30 s in combat spawns a hatchling (204475/204469/204474).",
   "Vhaksiz_the_Shade (204028) resets if pulled >155 from spawn.",
   "Untel`Dak (204035) boundscheck 3000 ms."
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
  "kindWhy": "Nothing in the script sets a flag or zone flag; reward is a Ruby Pendant (7755) + 50000 xp for turning in Lightning Crystals dropped by Falto. Loot/xp side event.",
  "size": "4 groups, one at a time; 24 players in",
  "groupLimit": "Up to 4 parties, one at a time; MoveGroup sends the clicker's group (or raid group); CheckRemoveFromTrial(24) removes anyone over 24 clients in the trial every 30s.",
  "start": "Talk to Relv_the_Mysterious (210090): say 'hail' (state 1), then 'destruction' or 'continue' (x3 'continue' through states 2-4), then say 'courageous' -> StartEvent() (only if event not active and nobody in trial). Then say 'ready' to be moved (group within 100 units) to -1087,6040,-483; max 4 groups (groups>=4 refused).",
  "timers": "Event ends after 10800000 ms (3 h) via Decrepit Ent 'event' timer (everyone pulled back to 1562,2088,-450; EndEvent depops all). 'check' timer 30000 ms trims >24 clients. Falto adds timer 60000 ms (adds wave = 1,2,3... mephits per tick, reset on each combat join). Add mobs self-depop after 180000 ms out of combat. Vivacious Ent 'check' every 20000 ms ends event when no client is in the trial (y>3000).",
  "mechanics": [
   "StartEvent unique-spawns a_decrepit_ent (210486) at -1017,6055,-486 and spawns 30 mephits (random blazing 210459 / burning 210460, level 62) across the burning forest.",
   "Each mephit death spawns 3 a_fiery_mepheeka (210462); when no blazing/burning mephit remains alive, Falto, Lord of Thunder (210470) unique-spawns at -574,5469,-480.",
   "While Falto is in combat, every 60s a growing wave of level-60 blazing/burning mephit adds (210488/210489) spawns (wave 1, 2, 3, ...).",
   "Falto death: decrepit ent depops and a_vivacious_ent (210487) spawns; saying 'ready to return' to it ports the group back to Relv. Turn in Lightning Crystals (28784) to Relv for Ruby Pendant with a Gold Chain + 50000 xp."
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
    "trigger": "Hand Lightning Crystals (28784, a Falto drop) to Relv_the_Mysterious; 50000 xp (Relv Trade event)"
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
  "kindWhy": "Script sets no flag and gives no quest item; Drornok has only gear/parchment drops. Not referenced by the karana/Askr chain.",
  "start": "Passive: kill the cave placeholder spawns (spawn2 ids 346427..346458 in SPAWNPOINT_IDS). When >31 of those have been killed AND none of a_typhoon_amphan 210040 / a_tempest_toad 210047 / a_hurricane_loktole 210046 / a_vacillating_loktole 210084 are alive at the same time, Drornok spawns.",
  "timers": "Respawns of the 32 cave spawn points are disabled (spawn_condition postorms 1 0) while Drornok is up; on his death each spawn point timer is set to 3000000 + rand(0..600000) ms (50-60 min) and respawns re-enabled. Add depop 180000 ms after spawn out of combat. Drornok adds timer 120000 ms.",
  "mechanics": [
   "Drornok (210469) unique-spawns at -46,-180,-574 with 20 random cave mobs (210040/210047/210046/210084) placed around the cave.",
   "In combat every 120s he spawns 4 random adds (210473/210474/210475/210476) near himself.",
   "Adds depop 180s after spawn unless in combat."
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
  "kindWhy": "Drops Esoteric Medallion 28780 (Krendic) guaranteed (5 + up to 3 more via AddItem; 3 + 0/2 in PvP instance). The script gives medallions only; the karana flag turn-in (Esoteric Meld 11488 -> Askr) needs the medallion set, but the tradeskill combine is not in these scripts. Treated as flag path.",
  "start": "Passive. Gurebk starts untargetable (no-aggro) and becomes attackable when every trash giant (210035, 210407, 210022) is dead (checked 5s after his spawn and on each trash death_complete). He re-hides after 3600000 ms (1h) if not engaged.",
  "timers": "untarget timer 3600000 ms (paused in combat). Adds timer 20000 ms. Add depop 170000 ms. While active, trash giants that respawn are instantly depopped.",
  "mechanics": [
   "On spawn Gurebk (210332) is given 5 Krendic medallions + 3 x 50% chance for another (PvP instance: 3 + 50% for 2). Trash giants carry one medallion with 20% chance each (2% PvP instance).",
   "Once active, every 20s in combat he spawns 4-6 level-56 adds (210482 scorpioco, 210483 scorponnis, 210485 cactore, 210484 cactoric), capped at 6 alive.",
   "Adds spawn within x+-100, y-50..-100 of him."
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
  "kindWhy": "Real Jeplak is given 5 guaranteed Srerendi Esoteric Medallions (28765); medallions feed the karana flag chain via Esoteric Meld (combine not in scripts).",
  "start": "Passive, two stages. Fake Jeplak (210403, level 65): becomes attackable when all 23 spawn points in SPAWNPOINT_IDS1 are dead; at that moment 8 more trash hleyta (210099/210419/210056) spawn at x248..442,y-2412..-2364. Killing fake spawns Real Jeplak (210472) at 348,-3159,-440.5 and a_confused_castaway (210461) at 346,-2513,-455.56; real becomes attackable when the 11 spawn points in SPAWNPOINT_IDS2 are dead.",
  "timers": "untarget 3600000 ms (1h; paused in combat). If the untarget expires on Real Jeplak he depops and the fake is respawned via spawn2 346711. Adds timer 60000 ms; adds depop 57000 ms. Castaway talk: say hail, 'yes'/'you did', 'jeplak' then he depops.",
  "mechanics": [
   "Real Jeplak in combat: every 60s spawns 7 adds (i=2..8) of a_mangled_traveler (210478) / a_lost_soul (210477) north of him.",
   "Trash giants carry a Srerendi medallion 20% (2% PvP instance); trash re-spawns depop while the real Jeplak is active.",
   "Castaway (210461) is a flavor NPC that explains the fake Jeplak."
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
  "kindWhy": "Drops 5+ guaranteed Kelek`Vor Esoteric Medallions (28783); part of the karana flag medallion set (combine not in scripts).",
  "start": "Passive. Neffiken (210251) becomes attackable once all trash giants (210038, 210411, 210015) are dead; he re-hides after 3600000 ms.",
  "timers": "untarget 3600000 ms (paused in combat); trees timer 35000 ms; tree depop 170000 ms. On Neffiken death the Dolshak spawn point (369224) is set to rand(900..3600) s. Dolshak (210468) depops after 900000 ms (15 min) out of combat and 4200000 ms (70 min) outright; he depops if Neffiken is up.",
  "mechanics": [
   "Neffiken spawn: 5 guaranteed Kelek`Vor medallions + 3 x 50% extra; trash giants hold one with 20% chance each (2% PvP).",
   "In combat every 35s he spawns 5-8 ents (210479/210480/210481), max 8 alive, south of him in a semi-circle (dist 50-100).",
   "Dolshak the Ornery (210468) is a side spawn that drops Polished Obsidian Tomahawk 28785 (100%); its use is not in the scripts."
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
  "kindWhy": "No flag or medallion in the script; loot (Storm Rider Blood/Skin, gear). Whether Storm Rider Blood is a flag component is not in the scripts.",
  "start": "Passive, two phases. Phase 1: kill 38 of the Koka`Vor senvar/krovian guards (210087, 210088) and none of those types remain. Phase 2: 8 Koka`Vor Elder/Chieftain (210466/210465) spawn at fixed PHASE2_LOCS; when none alive Ston`Ruak spawns at -206,669,-368.",
  "timers": "Adds timer 35000 ms in combat; totem depop 170000 ms. Trash re-spawns during phase 2 / while Ston`Ruak is up depop at once.",
  "mechanics": [
   "Every 35s in combat 5-8 totem adds (210458 earthen spirit, 210463 advisor, 210464 bark spirit) spawn, capped at 8 alive.",
   "killed counter resets to 0 on Ston`Ruak spawn."
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
  "kindWhy": "Each spawns holding 1-3 medallions (AddItem) of its tribe: Laruken/Zertuken Kelek`Vor 28783, Paruek/Faruek Srerendi 28765, Pendubk/Solnebk Krendic 28780. These feed the karana flag chain.",
  "start": "Passive: roaming giant mini-bosses; fighting one starts storm adds.",
  "timers": "storms timer 60000 ms while in combat; each storm depops after 9000 ms.",
  "mechanics": [
   "On spawn: math.random(1, 3) medallions (max 2 in PvP instance).",
   "In combat every 60s spawn 7-10 a_tumultuous_storm (210467) within 75 units."
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
  "kindWhy": "Sets qglobal karana 1 -> 2 and the shrine door (door id 4) in player.lua sets zone flag 209 (Bastion of Thunder) when karana>=2 and mavuin>=3.",
  "start": "Hail Askr_the_Lost (state machine; saying 'it was me', 'paying attention', 'yes', 'continue' etc.). Turn in a giant head (28749 wind / 28781 desert / 28782 forest) -> returns Storm Giant Head 11486 on cursor and sets state 6; 'continue' at state 9 summons Askr's Bag of Verity (17192). Turn in 11487 Askr's Sealed Bag of Verity (karana 0 -> 1, 1000 xp). Turn in 11488 Esoteric Meld (karana 1 -> 2, 10000 xp). Click door id 4 in the zone with karana>=2 and mavuin>=3 -> zone flag 209 and karana=3.",
  "timers": "qglobal 'karana' set with expiry arg 5,'F' (permanent); conversation state cleared when player leaves zone (checkreset 15000 ms).",
  "mechanics": [
   "Needs the Esoteric Meld (made from the three tribal Esoteric Medallions; the combine recipe is not in the scripts).",
   "Door click also requires qglobal mavuin >= 3 (Plane of Justice Mavuin chain)."
  ],
  "npcs": [],
  "rewards": [
   {
    "itemId": 17192,
    "name": "Askr's Bag of Verity",
    "trigger": "SummonCursorItem at Askr state 9 'continue' (karana 0) or on saying 'bastion of thunder' at karana 1"
   },
   {
    "itemId": 11486,
    "name": "Storm Giant Head (non-turn-in)",
    "trigger": "Returned when a tribal giant head is handed in"
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
  "kindWhy": "Death spawns A_Planar_Projection 214323 (1200 s) whose hail sets zeks 2 -> 4 (or 3 -> 5): the 'Tallon' half of the zeks flag series (zeks>=2 opens Drunder door; zeks==5 needs both twins; 5 -> 6 via Maelin in Plane of Knowledge). Seer header: 'zeks - PoI Giwin flags + Zeks in Tactics (seven values)'.",
  "groupLimit": "Projection FLAG_LIMIT 72; killer's raid/group (ProjectionEligibility).",
  "start": "Pull Tallon_Zek (214026) in the south wing.",
  "timers": "shadowstep timer 20000 ms in combat: teleports (GMMove) to a random point x -725..-505, y -2100..-1820, z 207.6 and wipes hate; stops when not engaged and returns to spawn. Projection depops 1200000 ms.",
  "mechanics": [
   "Spawn: detrimental cast rate set to 75 (about 3.5 s between barbs).",
   "Death: Planar Projection (214323) for the killer; hail: zeks==2 -> 4, zeks==3 -> 5 (character flag); zeks<2 and no cl_tallon -> checklist flag cl_tallon."
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
  "kindWhy": "Death of the real Vallon (214317) spawns A_Planar_Projection 214324 whose hail sets zeks 2 -> 3 (or 4 -> 5): the 'Vallon' half of the zeks series.",
  "groupLimit": "Projection FLAG_LIMIT 72; killer's raid/group.",
  "start": "Pull Vallon_Zek (214316, level 73, 175000 hp) in the north wing.",
  "timers": "each Vallon copy depops 120000 ms after spawn (paused in combat); the real one on timeout also calls eq.spawn_from_spawn2(369265) to restore the base spawn; bounds 6000 ms (resets to -625,1980,204.5 if y < 1750).",
  "mechanics": [
   "At 50% HP each Vallon says 'fades into the shadows as five figures take shape' and depops, spawning five copies in x -645..-565, y 1940..2020: one real (214317, level 64, 84000 hp) and four fakes (214318 / 214319, 42000 hp).",
   "The real one carries a wave counter via signal (wave+1) and splits again at 50% until wave == 4 (four generations).",
   "The real Vallon (214317) death spawns the Planar Projection for the killer; hail: zeks==2 -> 3, zeks==4 -> 5; zeks<2 and no cl_vallon -> checklist flag cl_vallon."
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
  "kindWhy": "Flag-path boss: Warlord death spawns A_Planar_Projection 214322 (1200 s); hail with zeks == 6 sets zeks=7 (needed for Tower of Solusek Ro / Plane of Fire: solrotower door requires zeks 7) else checklist flag cl_rallos.",
  "groupLimit": "Projection FLAG_LIMIT 72; no scripted raid cap; arena/guard recovery state is persisted via eq.set_data per guild id.",
  "start": "Kill both War Room door guards Decorin_Berik (214056) and Decorin_Grunhork (214057) while phase is Ready (guardDeaths for both) -> StartAttempt().",
  "timers": "Success: guards on a 66-hour cooldown (SUCCESS_RESPAWN_TIME = 237600 * 1000 ms), arena restored 30 min later (arenaUntil +1800). Failure: phase Retry, cooldownUntil = Now()+600 s. Idle allowances: upstairs Rallos 1170000 ms, Warlord 1200000 ms (FailureTimeout). Elite waves: 20000 ms after engage then every 50000 ms. Pit wave 'twitch' timer 55000 ms then wraiths 10000 ms later. Watchdog 5000 ms.",
  "mechanics": [
   "Phase 1 (Brothers): Tallon_Zek (214313) spawned at 621,-560,158 and Vallon_Zek (214320) at 594,581,158 walk to the council room; Vallon splits like his wing counterpart (HP event 50 with 9001 signal); both must die (BrotherDeathEvent) to advance.",
   "Phase 2 (Upstairs): Rallos_Zek (214311, 750000 hp) spawns where the brothers died; HP events 98/75/50; every 50 s while engaged two A_Decorin_Elite (214289) spawn at 1060,581,124 and 1060,-560,124; at 75% the arena spawn points are disabled; at 50% Rallos jumps down and despawns.",
   "Phase 3 (Pit): Rallos_Zek_the_Warlord (214312, 1,050,000 hp) unique-spawns at 705,0,-290; his corpses of 'the unworthy' (CORPSE_TYPES 214007-214011) twitch and become A_Chaos_Wraith (214288) every 55 s, and two A_Chaos_Boar (214287) spawn each wave; leaving bounds (x 439..940, y -400..410, z <= -250) casts spell 982 and resets him.",
   "Failure at any phase (idle timeout, Rallos dying early, adds failing to spawn) -> Retry state, 10-minute cooldown."
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
  "kindWhy": "Scripts only handle evolving boars, blade spawns, splitting or quest text; no flag set. Eriak (214073) hails/gives A Vial of Black Blood (28592) only when zeks > 4. Diaku Emblem pieces (29216-29219) used by the alternate-access key quest are not in these loot tables as listed.",
  "start": "Passive pulls (Glykus Helmir 214053, Tagrin Maldric 214054, #Anival_the_Blade 214033, #Hinvat_Deathbringer 214075, The_Diaku_Overseer 214092, Eriak 214073).",
  "timers": "Glykus: evolve 59000 ms, respawn 6000 ms, poof 90000 ms; Anival copy depop 360000 ms (script-spawned); Tagrin tick 6000 ms.",
  "mechanics": [
   "Glykus Helmir evolves a_Fledgling_War_Boar (214040) through enraged/fierce/greater/enchanted war boars (214308/214296/214300/214307) on the five boar spawn points.",
   "Tagrin Maldric spawns Animated_Decorin_Blades (214310 drops Decorin Ore Shard, 214326 drops Useless Hunk of Metal) at four points.",
   "#Anival_the_Blade splits at <50% hp (75% of the time) into two copies, one with an empty item list.",
   "Eriak: with zeks > 4, say 'blood' to receive A Vial of Black Blood (28592)."
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
    "trigger": "Say 'blood' to Eriak when qglobal zeks > 4 (SummonCursorItem)"
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
  "name": "Plane of Time A: dial hub and Time B instance controller",
  "kind": "flag",
  "kindWhy": "Entry is gated upstream by qglobal time (set in Plane of Innovation by the time-machine door with zebuxoruk '2' + Quintessence of Elements 29165) and zone flag 219; potimea/219053.lua then relays dial clicks to the Time B instance. Seer header: 'time - PoTime series (1 value)'.",
  "size": "90 players",
  "groupLimit": "Time B MAX_CLIENTS = 90 per instance; one instance per raid (activeRaidID / activeInstanceID); one in-flight entry per character.",
  "start": "Click a dial (1-5) in Plane of Time A (DIALS = {2,4,1,5,3}); signal 3 to controller 219053 starts a new Time B instance for the clicking raid when Time A is idle (activeRaidID == 0 and activeInstanceID == 0 and activePhase == 0). Door 13 (graveyard tombstone) is handled in Lua to avoid the default teleport to the public copy of Time B.",
  "timers": "Cycle: fixed guild cycle duration 6 d 18 h (6*86400 + 18*3600 = 583200 s, empty_grace 600 s) in lua_modules/potime_cycle.lua; 'cooldown' timer 120000 ms after the instance expires; start_retry 5000 ms (12 tries); 'unblock' 60000 ms.",
  "mechanics": [
   "Signals: 1 = new instance started, 2 = instance expired, 3 = dial clicked, 4 = phase changed (from Time B).",
   "Foreign loot lockouts are checked (12 timer slots) before entry; partial/malformed records do not release a character."
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
  "kindWhy": "Time content past the flagging chain: no qglobal is set. Each boss drops loot and counts toward the Time B phase progression (zoneBossTable[1]); a boss already killed in the 12 h lockout respawns as a 'Shadow_of_X' (bossStatus == 1).",
  "size": "90 players",
  "groupLimit": "Time B instance max 90 clients; a trial starts when the first player stands in its room region.",
  "start": "Walk into a trial room (REGIONS 1-5): the controller sets trialStates[i]=1 and the 'trial<i>start' timer fires after 44000 ms. Signals 111 Earth, 121 Air, 131 Undead, 141 Water, 151 Fire start each trial; signal 100 depops it.",
  "timers": "Per-boss loot lockout 43200 s (12 h) for phase 1; Time B cycle 583200 s (6 d 18 h).",
  "mechanics": [
   "Earth (223032 Terlok of Earth): living rubble (223030) and rock-shaped assassins (223031) wave in; boss at 71,1646,500.",
   "Water (223037 Anar of Water): triloun gatherers (223035/223036) and deepwater trilouns (223033/223034); boss appears after 7 kills at 68,867,500.",
   "Fire (223018 Kazrok of Fire): flame (223009-223011) and inferno (223012-223017) mephits; boss at 68,573,504 with add waves at 9 and 16 kills.",
   "Air (223044 Neimon of Air): phoenix nobles (223038-223040) and servitors (223041-223043); boss at 68,1355,504 after 4/9 kills.",
   "Undead (223029 Rythor of the Undead): undead guardians in 3 waves (223019-223027) and protectors (223028); boss at 68,1109,500."
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
  "kindWhy": "Time content; no flag set. Added after Phase 1 (GetAdditionalHours(2) = 1 extra hour on the attempt clock).",
  "start": "Phase advance from Phase 1; events controller signal 201 spawns the phase (undead guardian waves 223055-223059 first).",
  "timers": "Boss lockout 302400 s (3 d 12 h) for phases 2 and 3 (223077 line 178); +1 hour added to the attempt clock.",
  "mechanics": [
   "Undead guardian waves (223055, 223056, 223057 wizard, 223058, plus summoned guardians 223059) are cleared in waves 1-3 before the champions engage.",
   "Five champions: Windshapen_Warlord_of_Air 223075, Earthen_Overseer 223072, Ralthos_Enrok 223076, War_Shapen_Emissary 223074, Gutripping_War_Beast 223073 (each with a Shadow_ variant when already killed)."
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
  "kindWhy": "Time content; no flag set. +1.25 hours added to the attempt clock (GetAdditionalHours(3)).",
  "start": "Phase advance from Phase 2; signal 301 begins wave 1.",
  "timers": "Boss lockout 302400 s (3 d 12 h); hatelink timer 2000 ms; waves advance at kills == 10 (wave 9: kills == 2).",
  "mechanics": [
   "Waves 1-8 are a named pair plus eight adds each: (A_Ferocious_Warboar 223084, Deathbringer_Blackheart 223083), (Xeroan_Xi`Geruonask 223090, Kraksmaal_Fir`Dethsin 223091), (A_Deadly_Warboar 223096, Deathbringer_Skullsmash 223097), (Herlsoakian 223101, Sinrunal_Gorgedreal 223105), (Deathbringer_Rianit 223109, A_Needletusk_Warboar 223108), (Xerskel_Gerodnsal 223115, Dersool_Fal`Giersnaol 223116), (Undead_Squad_Leader 223124, Dark_Knight_of_Terris 223123), (Champion_of_Torment 223132, Dreamwarp 223131).",
   "Wave 9: Avatar_of_the_Elements (223134) and Supernatural_Guardian (223133) only."
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
  "kindWhy": "God kills of the Time chain (no flag set by the script); original god lockout 561600 s (6 d 12 h). GetAdditionalHours(4/5) adds 1 hour per god still unkilled.",
  "start": "Phase advance from Phase 3 via the events controller (signal 401).",
  "timers": "Boss loot lockout 561600 s (6 d 12 h); leash 3000-6000 ms; check_hp 3000 ms; HP events 95/50/10 (and 90/50/10 for the second pair); +1 h to the attempt clock for each unkilled god.",
  "mechanics": [
   "Four gods: Vallon_Zek 223000, Tallon_Zek 223001, Terris_Thule 223002, Saryrn 223003 (1,100,000-1,400,000 hp).",
   "Terris spawns A_Phantasm_of_Terris (223140), A_Nightmare_Knight_of_Terris (223143), A_Summoned_Guardian_of_Terris (223141), A_Summoned_Knight_of_Terris (223142); Saryrn adds A_Mouth_of_Insanity (223136), A_Mouth_of_Dementia (223137), A_Tormentor (223139)."
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
  "kindWhy": "God kills of the Time chain (no flag set by the script); lockout 561600 s.",
  "start": "Phase advance from Phase 4 (signals 501/502 from the instance controller).",
  "timers": "Lockout 561600 s; HP events at 91/71/56/46/31/11% (first pair) and 91/76/51/26% (second pair); leash 3000 ms.",
  "mechanics": [
   "Four gods: Cazic_Thule 223004, Bertoxxulous 223005, Rallos_Zek 223006, Innoruuk 223007 (1,700,000 hp).",
   "Adds: Guardian_of_the_Crypt 223147, Guardian_Knight_of_Pestilence 223145, A_Firebone_Caster 223146, Amygdalan_knight 223149, phoboplasm 223148, an_abhorrent 223153, Cleric_of_Innoruuk 223152.",
   "At later HP events a god's stats change (flurry/wild rampage off, 5% rampage, resists and ATK modified)."
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
  "kindWhy": "Final boss of Plane of Time; lockout 561600 s; +2 hours on the attempt clock. No flag set by the script.",
  "start": "Phase advance from Phase 5 (signal 601).",
  "timers": "HP events random 73-77% / 48-52% / 23-27%; 'aoe' timer 10000 ms first then 25000-33000 ms; 'vortices' 25000 ms; 'phase_spell' 4000 ms; end dialog timers 6000-32000 ms then 'port' 2000 ms and depop 10000 ms.",
  "mechanics": [
   "Quarm (223008, level 80, 1,700,000 hp) changes resist/AC state at each HP event (QUARM_STATE table of mr/fr/cr/pr/dr/ac).",
   "Spawns vortices (223158) and eggs (223161) during the fight; Zebuxoruk (223159) and Druzzil (223160) appear in the closing dialog."
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
  "kindWhy": "Flag-path boss: death spawns A_Planar_Projection (207317, 1800 s) whose hail sets qglobal saryrn=1 (needs tylis==2, no existing saryrn/cipher). Seer Mal Nae`Shi header lists 'saryrn - Saryrn (one value)'.",
  "groupLimit": "Projection FLAG_LIMIT 72 flags per spawn; eligibility restricted to killer credit via ProjectionEligibility (module not read).",
  "start": "Pull Saryrn (207001). On spawn the script force-spawns Sorrowsong via spawn2 346761 (SetTimer(1)).",
  "timers": "bounds check 5000 ms in combat (leash z<575 -> Balance of the Nameless 3230 + wipe hate); checkhp 5000 ms out of combat (reset when 100%). Projection depops 1800000 ms (30 min).",
  "mechanics": [
   "HP events at 99,90,80,70,60,50,40,30,25,20,10%. At 99% Saryrn says 'Sorrowsong, sing for us' (Sorrowsong signal 1: sings Sorrow Song 3011, patrols) and 5 stair/floor mobs spawn (207023 / 207284 / 207024 / 207291) at fixed SPAWN_LOCS.",
   "At 25% Sorrowsong is signalled to become targetable and attack (signal 2).",
   "At every other HP event 3 adds (a_summoned_servant 207306 / a_twisted_spirit 207308) spawn near 580 z.",
   "Death: Despawn() stairs mobs and Planar Projection 207317 spawns at the corpse."
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
  "kindWhy": "Part of the tylis flag series: Maareq's death frees Tylis (entrance NPC becomes targetable); the tylis=1 preflag is granted in Plane of Tranquility by Fahlia_Shadyglade, tylis=2 by the rescued Tylis (see Keeper event). Without Maareq death, Tylis stays untargetable.",
  "start": "Hail Tylis_Newleaf (207014): say 'will assist you' (requires qglobal tylis and a raid/group member with Screaming Sphere 22954 on keyring or inventory), then 'we are ready' / 'i am ready' -> casts Insanity of Tylis (spell 1134) on you.",
  "timers": "Minion timer 5000 ms in combat; upgrade timer 3000 ms (after power thresholds); revert timer 480000 ms (8 min) after leaving combat if upgraded.",
  "mechanics": [
   "Every 5 s in combat Maareq spawns a_minion_of_Maareq (207297) at -25,0,451 which walks to him.",
   "Each minion signals Maareq: power +1; at power>=10 state 0->1 (flurry 25%, size 12), >=20 state 1->2 (race change, size 12, flurry off, wild/aoe rampage 10%), >=40 state 2->3 (size 17, attack_delay 8).",
   "Death: depops minions, Tylis_Newleaf (207014) becomes targetable ('Maareq's hold over Tylis fades')."
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
  "kindWhy": "Keeper death spawns the rescued #Tylis_Newleaf (207318); hailing him with qglobal tylis==1 sets tylis=2 ('character flag'), required for the Saryrn Planar Projection flag.",
  "groupLimit": "#Tylis flags max 72 (keeper_flags counter) per kill.",
  "start": "Reach and kill The_Keeper_of_Sorrows (207015) after Maareq's death (Tylis release).",
  "timers": "Both Tylis copies share a 1800 s deadline from the Keeper kill (FlaggingTravel.StartFixed os.time()+1800); the 207014 entrance copy re-spawned at the original position stays usable for that window and the entrance spawn timer starts normally.",
  "mechanics": [
   "On death: depop_with_timer(207014), spawns a temporary Tylis_Newleaf copy at the entrance (targetable) and #Tylis_Newleaf (207318) at -176,368,-764.8.",
   "Hail #Tylis: qglobal tylis=='1' -> tylis=2 + 'You have received a character flag!'; no tylis and no cl_keeper -> checklist flag cl_keeper; 'ready to return' casts Torment's Beckon (1136)."
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
  "kindWhy": "No qglobal or flag set in these scripts; Baraguj's reward form #Baraguj_Szuul (207319) holds loot only. Not in the Seer flag list.",
  "start": "Say 'save' and 'memories' to #Argan_Milek (once 'here to aid you' conversation reached) -> casts Visions of Argan (1135). Argan spawns only while A_Horrifying_Vision (207047) is up (otherwise depop_with_timer).",
  "timers": "Argan depops after 1800000 ms (30 min); #Baraguj_Szuul reward form depops after 43200000 ms (12 h). Entry Baraguj (207028) defers while 207319 is up.",
  "mechanics": [
   "A_Horrifying_Vision death spawns Argan_Milek (207322) at its position; Argan then tells 'ready' to MovePC to 207,-257,1711,-481.",
   "An_Unimaginable_Horror (207031) death: depop_with_timer(207028), unique-spawn #Baraguj_Szuul (207319) at 5,-1041,-26.25 and An_unseen_entity (207321) at -805,962,-1644; player corpses in the stomach box are moved to the instance graveyard."
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
  "kindWhy": "Loot-only named mob; no flag or quest in script.",
  "start": "Passive pull of The_Acolyte_of_Affliction (207003).",
  "timers": "adds timer 50000 ms in combat; construct depop 100000 ms.",
  "mechanics": [
   "Every 50 s spawns 5-10 A_construct_seedling (207295) near -32..32,-175..-153,194; seedlings walk to the Acolyte.",
   "On death all seedlings depop."
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
  "kindWhy": "Named mob with a single HP-event buff; loot only.",
  "start": "Passive pull of Salczek_the_Fleshgrinder (207027).",
  "timers": "none in script.",
  "mechanics": [
   "At 50% HP gains wild/aoe rampage 20%."
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
  "kindWhy": "Click-door script that grants zone flags when the character flags (qglobals) are met; this is the flag consumption point for the chains.",
  "start": "Click a portal door in Plane of Tranquility.",
  "timers": "n/a",
  "mechanics": [
   "door 16 or 21 (Valor / Storms): needs qglobal mavuin == 3 -> SetZoneFlag(210) and (208).",
   "door 12 (Crypt of Decay): zone flag 200 is set elsewhere (Plane of Disease toilet drop); alt-access item 9294 only if pop_alt_access_enabled == '1'.",
   "door 93 (Torment): needs fuirstel == 5 AND thelin == 4 (or alt-access key 29213) -> SetZoneFlag(207).",
   "door 48 (Bastion of Thunder): needs karana >= 3 or zebuxoruk -> SetZoneFlag(209).",
   "door 23 (Halls of Honor): zone flag 211 set by zoning in from Valor; alt-access key 29214.",
   "door 24 (Drunder, Fortress of Zek): needs zeks >= 2 (or alt key 29215) -> SetZoneFlag(214).",
   "door 22 (Tower of Solusek Ro): needs qglobal cipher AND zeks >= 6 -> SetZoneFlag(212).",
   "door 82 (Plane of Fire): script only shows 'You lack the will...' if flag 217 absent (flag is set elsewhere).",
   "doors 81/83/84 (Water/Earth/Air): need zebuxoruk == '2' -> SetZoneFlag(216), (215), (218).",
   "door 18 (Plane of Time A): GM or level>=65 with zone flag 219 and qglobal time."
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
  "kindWhy": "Each sets or advances a character-flag qglobal used by the other planes (thelin, fuirstel, tylis, pofire).",
  "start": "Hail / keyword to each NPC: Adroha Jezith - 'tortured by nightmares' (thelin 0 -> 1); Adler Fuirstel - 'ward' (fuirstel unset -> 1); Elder Fuirstel - hail (fuirstel 2 -> 3, and 4 -> 5); Elder Poxbourne (Thelin) - hail with thelin >= 3 (3 -> 4); Fahlia Shadyglade - 'will go' (needs thelin==4 AND fuirstel==5; tylis unset -> 1); Miak the Searedsoul - 'portal's destination' (pofire unset -> 1; pofire==2 is the unlocked state).",
  "timers": "all flags qglobal expiry arg 5, 'F' (permanent).",
  "mechanics": [
   "thelin: 1 (Adroha) -> 2 (Maze, ponightmare) -> 3 (Terris Thule Planar Projection, nightmareb) -> 4 (Poxbourne hail).",
   "fuirstel: 1 (Adler 'ward') -> 2 (podisease Planar Projection) -> 3 (Elder Fuirstel) -> 4 (codecay Planar Projection) -> 5 (Elder Fuirstel).",
   "tylis: 1 (Fahlia) -> 2 (potorment #Tylis_Newleaf).",
   "pofire: 1 (Miak) -> 2 (solrotower Planar Projection)."
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
  "kindWhy": "Flag-path boss: death spawns Planar Projection 208207 whose hail sets aerindar=1 (requires mavuin==3); then clicking the HoH zone-in door 3 sets aerindar=2 and zone flag 211 (Halls of Honor). Seer header: 'aerindar - Aerin`Dar flag; access to HoH (two values)'.",
  "groupLimit": "Planar Projection FLAG_LIMIT (see povalor/A_Planar_Projection.lua).",
  "start": "Enter the lair (glass door switches doors 8/9 open with A Crystalline Globe 25596, or the dragon-orb teleporter door 6 while #Aerin`Dar 208074 is up); pull #Aerin`Dar.",
  "timers": "checkhp 3000 ms after combat drop (reset at 100%); boundscheck 3000 ms (leash z>120 or y outside 2100..2880); projection depops 1200000 ms (20 min).",
  "mechanics": [
   "On spawn all 9 Rahlgon/minion spawn points are respawned (SetTimer(1)); the adds start asleep (no-aggro, no harm).",
   "HP events wake adds: 85% -> spawn idx 1,2; 65% -> 3,4; 45% -> 5,6; 25% -> 7,8,9 (idx 9 = Rahlgon spawn 347213).",
   "Death: Rahlgon spawn disabled, Planar Projection (208207) spawns at 360,2528,39."
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
  "name": "Battalion orb quest (pov_orb_quest) -> A Crystalline Globe",
  "kind": "optional",
  "kindWhy": "Side quest chain on qglobal pov_orb_quest (expiry arg 1,'F'); the Crystalline Globe (25596) only opens the glass-lair door switches and does not set a PoP flag.",
  "start": "Sergeant_Johson_Popoah: hail (0 -> 1) / 'compound' (-> 2); Paralin_Notion: 'things' (-> 3); Master_Sergeant_Aaramis_Daryln: 'aerin' (3 -> 4); turn in hearts 25597+25598+25599 to Paralin with questState>=4 (4 -> 5, xp 1); Aaramis 'mission' (5 -> 6); Captain_Ryglot_Cupperhide: turn in globe pieces 25796+25797+25798 -> Crystalline Globe 25596.",
  "timers": "n/a",
  "mechanics": [
   "Door switches 8/9 force open the glass door when you hold or have keyringed the globe."
  ],
  "npcs": [],
  "rewards": [
   {
    "itemId": 25596,
    "name": "A Crystalline Globe",
    "trigger": "Turn in 25796, 25797, 25798 to Captain_Ryglot_Cupperhide"
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
  "kindWhy": "250000 xp quest that spawns #A_Wandering_Spirit (208209, level 70, 168000 hp); no flag.",
  "start": "Hail A_Wandering_Spirit (208061): 'help', 'belongings', 'amulet'; hand in 20605 Crescent Symbol of Rhaj + 20606 Righteous Amulet of Marr.",
  "timers": "Spirit depop 100000 ms (#A_Wandering_Spirit).",
  "mechanics": [
   "Turn-in gives 250000 xp, spawns #A_Wandering_Spirit at the same spot and depops the quest NPC with timer."
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
  "kindWhy": "Named mobs with no script found in povalor/; loot only (Signet of the Valorous, Band of the Visionary...).",
  "start": "unknown (no script)",
  "timers": "unknown",
  "mechanics": [
   "Three #The_Sleep_Walker variants (208157, 208202, 208208) exist in the NPC table."
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
  "kindWhy": "Flag-path boss of Water: death spawns Essence_of_Water (216266) whose hail summons Sphere of Coalesced Water (29163), one of the four Essence items for the Quintessence of Elements (29165) / Plane of Time.",
  "groupLimit": "Essence_of_Water FLAG_LIMIT = 72 (powater/Essence_of_Water.lua:1).",
  "start": "Kill Guardian_of_Coirnav (216053, spawn point 366321) while Coirnav (216048, spawn point 365647) is up and the encounter phase is Ready.",
  "timers": "EVENT_SECONDS = 900 s (15 min) from the Guardian kill (deadline never extended; red-text warnings at 600, 720, 840 s); wave 2 at +180 s, wave 3 at +300 s; failure cooldown FAILURE_SECONDS = 1200 s; success cooldown SUCCESS_SECONDS = 496800 s (138 h); lings wave every 49 s in the final phase.",
  "mechanics": [
   "Phase 1: three waves, each 25 individually tracked fiends and an early miniboss (a_triloun_vaporfiend/ling 216257/216256, a_hraquis_icefiend/ling 216260/216259, a_regrua_waterfiend/ling 216258/216265); all 75 must be killed (kills == 75).",
   "Phase 2: Pwelon_of_Vapor (216236), Nrinda_of_Ice (216245), Vamuil_of_Water (216247) (level 75, 2,000,000 hp each in the NPC table) are summoned and Coirnav (216048, level 80, 3,000,000 hp in the table) becomes attackable.",
   "Phase 3: after the three minibosses die Coirnav's base HP is set to 250000 and he is buffed-faded; lings reinforcements spawn every 49 s.",
   "Expiry of the 15-minute deadline -> Fail (1200 s retry); Coirnav death -> 138 h cooldown and Essence_of_Water (216266)."
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
    "trigger": "Hail Essence_of_Water after Coirnav dies, if character lacks 29163/29165 (SummonCursorItem)"
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
  "kindWhy": "Pay-to-summon anglerfish event; no flag; loot on the summoned 'dwellers' only.",
  "start": "Say 'dwellers' to Fishlord_Lezom (216020) or Fishlord_Craiyk (216019): 'For 100 platinum I will summon them forth.' Hand in platinum = 100 (check_turn_in) -> a scripted Lezom/Craiyk copy (216284 / 216283) walks to 94,217,-359 / -269,157,-362 and the native spawn is disabled.",
  "timers": "Lord spawn timer set to 1500000 ms (25 min) on EndEvent; anglerfish self-depop 180000 ms.",
  "mechanics": [
   "At the waypoint the Fishlord chants and trash spawn points (369521-369528) are enabled; he is vulnerable ('If death claims me the summoning will be finished').",
   "Killing 5/10/15/25 of each anglerfish family (ferocious 216268, fierce 216270, furious 216269) spawns a stronger named dweller from the SPAWNS table (e.g. a_master_anglerfish 216267, a_king_anglerfish 216281, a_supreme_anglerfish 216282); the 25th kill ends the event and the Fishlord leaves."
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
  "kindWhy": "No dedicated scripts; Traps.lua only adds a 1200000 ms depop to 8 trap mob types (216249-216255, 216264).",
  "start": "Passive.",
  "timers": "trap mobs depop 1200000 ms.",
  "mechanics": [
   "Trap types: 216255, 216252, 216250, 216249, 216264, 216254, 216253, 216251."
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
  "kindWhy": "Flag-path boss: death spawns Planar Projection 212420 whose hail sets pofire 1 -> 2 (needs sol_room=='11111', pofire=='1' (Miak in Tranquility) and zeks=='7'); otherwise checklist flag cl_solusek. Seer header: 'pofire - PoFire flag and preflag (two values)'.",
  "groupLimit": "Projection FLAG_LIMIT (see solrotower/A_Planar_Projection.lua).",
  "start": "Enter via door 44/45 (needs sol_room == '11111' AND zeks == '7') -> MovePC to 0,-847,244; pull Solusek_Ro (212025). Floor doors 38/39 open when A_Planar_Projection 212420 is up.",
  "timers": "anti_cheat 30000 ms in combat: if Solusek is below z 240 and HP < 50% the Guardians of Fire (212041) are teleported to him and he is healed 100000.",
  "mechanics": [
   "Death: ProjectionEligibility.Spawn(212420) at 0,-815,244 for the killer.",
   "A_focus_of_Sol: charmed pets above z 240 lose charm and get MR 200."
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
  "kindWhy": "Named mob with HP-event splitting; loot only.",
  "start": "Passive pull of Galremos (212033).",
  "timers": "none",
  "mechanics": [
   "HP events 90/60/35/20/5% shrink him and spawn 1/2/1/4/6 a_magmite (212397)."
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
  "name": "Xuzl's wing (sol_room digit 1)",
  "kind": "flag",
  "kindWhy": "Each wing sets one digit of qglobal sol_room (five characters, '11111' = all wings); sol_room=='11111' AND zeks=='7' are required by the Solusek Ro Planar Projection to give pofire=2, and sol_room + zeks>=6 + cipher gate the tower portal door 22 / lava runes doors 44-45.",
  "groupLimit": "none scripted (the flag is per clicking player)",
  "start": "Kill the wing boss, then click the flaming cauldron (door id 12) while a_flaming_cauldron 212410 is spawned.",
  "timers": "bounds 6000 ms; cauldron depop 1800000 ms; warders depop 3600000 ms.",
  "mechanics": [
   "Xuzl (212055, level 75, 600000 hp) is leashed to y >= -914 (bounds 6000 ms, Annul Self 2830).",
   "Death spawns a_flaming_cauldron (212410) at 1780,-336,339 and three a_warder_of_Xuzl (212415).",
   "Clicking the cauldron (door 12) sets sol_room digit 1 = '1'."
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
  "name": "Arlyxir's wing (sol_room digit 2)",
  "kind": "flag",
  "kindWhy": "Each wing sets one digit of qglobal sol_room (five characters, '11111' = all wings); sol_room=='11111' AND zeks=='7' are required by the Solusek Ro Planar Projection to give pofire=2, and sol_room + zeks>=6 + cipher gate the tower portal door 22 / lava runes doors 44-45.",
  "groupLimit": "none scripted (the flag is per clicking player)",
  "start": "Kill the wing boss, then click the flaming cauldron (door id 7) while a_flaming_cauldron 212411 is spawned.",
  "timers": "heal timer 750000 ms; bounds 6000 ms; cauldron depop 1800000 ms.",
  "mechanics": [
   "Arlyxir (212023, level 75, 750000 hp) heals to full every 750000 ms in combat ('is immolated in flames, and is reborn!') and casts Searing Flames 1281; leashed to y >= 1230.",
   "Death spawns a_flaming_cauldron (212411) at 1607,1891,627 and three a_warder_of_Arlyxir (212416).",
   "Clicking the cauldron (door 7) sets sol_room digit 2 = '1'."
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
  "name": "Dresolik's wing (sol_room digit 3)",
  "kind": "flag",
  "kindWhy": "Each wing sets one digit of qglobal sol_room (five characters, '11111' = all wings); sol_room=='11111' AND zeks=='7' are required by the Solusek Ro Planar Projection to give pofire=2, and sol_room + zeks>=6 + cipher gate the tower portal door 22 / lava runes doors 44-45.",
  "groupLimit": "none scripted (the flag is per clicking player)",
  "start": "Kill the wing boss, then click the flaming cauldron (door id 10) while a_flaming_cauldron 212414 is spawned.",
  "timers": "Protector depop 9000000 ms (paused in combat); bounds 6000 ms; guardian respawn after depop 600000 ms.",
  "mechanics": [
   "Guardian_of_Dresolik (212046) spawns reset the four guardian spawn points (367793-367796, SetTimer(1)); when no Guardian is left alive the last death unique-spawns The_Protector_of_Dresolik (212408) at 606,1584,-152.",
   "Protector (level 75, 800000 hp): if he is not killed within 9000000 ms (2.5 h) he depops and the guardian spawn timers reset to 600000 ms.",
   "Protector death spawns a_flaming_cauldron (212414) at 166,1449,-68 and three a_warder_of_Dresolik (212419); cauldron click (door 10) sets sol_room digit 3 = '1'. Both leash to x 558..978."
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
  "name": "Rizlona's wing (sol_room digit 4)",
  "kind": "flag",
  "kindWhy": "Each wing sets one digit of qglobal sol_room (five characters, '11111' = all wings); sol_room=='11111' AND zeks=='7' are required by the Solusek Ro Planar Projection to give pofire=2, and sol_room + zeks>=6 + cipher gate the tower portal door 22 / lava runes doors 44-45.",
  "groupLimit": "none scripted (the flag is per clicking player)",
  "start": "Kill the wing boss, then click the flaming cauldron (door id 6) while a_flaming_cauldron 212413 is spawned.",
  "timers": "depop 9000000 ms (paused in combat); bounds 6000 ms.",
  "mechanics": [
   "Rizlona (212026) is a phase-1 mob (drops The Time Grows Near 18440 100%); her death spawns #Rizlona (212407, 600000 hp) in place.",
   "#Rizlona depops after 9000000 ms (resetting spawn 367546 to 600000 ms); bounds leash y 2047..2538 (moves to -1103,2384,-905).",
   "#Rizlona death spawns a_flaming_cauldron (212413) at -980,2717,-908 and three a_warder_of_Rizonla (212418); cauldron click (door 6) sets sol_room digit 4 = '1'."
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
  "name": "Jiva's wing (sol_room digit 5)",
  "kind": "flag",
  "kindWhy": "Each wing sets one digit of qglobal sol_room (five characters, '11111' = all wings); sol_room=='11111' AND zeks=='7' are required by the Solusek Ro Planar Projection to give pofire=2, and sol_room + zeks>=6 + cipher gate the tower portal door 22 / lava runes doors 44-45.",
  "groupLimit": "none scripted (the flag is per clicking player)",
  "start": "Kill the wing boss, then click the flaming cauldron (door id 11) while a_flaming_cauldron 212412 is spawned.",
  "timers": "adds timer 45000 ms; helper depop 600000 ms.",
  "mechanics": [
   "Jiva (212014, level 75, 700000 hp) in combat every 45000 ms calls one of 8 named helpers in a cycle (Makin, Adeel, Jiri, Seif, Nabil, Aydin, Cemal, Fahim = types 212404, 212399, 212403, 212406, 212405, 212400, 212401, 212402) to fixed spots around (-2255..-2183, -338..-192).",
   "Helpers depop 600000 ms (JivaAdds encounter).",
   "Death spawns a_flaming_cauldron (212412) at -2126,105,-1100 and three a_warder_of_Jiva (212417); cauldron click (door 11) sets sol_room digit 5 = '1'."
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
