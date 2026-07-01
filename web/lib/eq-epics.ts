// EQ Class Epic 1.0 component catalog. Built by recursively walking
// scripted_npc_turnins backward from each final Epic 1.0 reward — every input
// that feeds the chain is here, deduplicated and labelled by class. Used by
// /character/[name]/quests to surface the "Epics" section at the top: when a
// member holds an Epic-chain item, they (and every officer/MQ planner) can
// see it at a glance.  (Uilnayar 2026-06-26: "for example the dragon scales
// of kedge backbone".)
//
// Some items legitimately belong to multiple class chains (Shining Metallic
// Robes feeds Rogue Epic + Enchanter Epic; Robe of the Kedge feeds Rogue Epic
// + serves as a Bard component path). The catalog reflects that — an item
// with two class entries shows up under both class sections of the page.
//
// `depth` is how many turn-in steps back from the final reward this item
// sits (1 = direct input to the final turn-in, 2 = input to the input, …).
// We use it to sort the most-iconic / final-stage items to the top when
// rendering, since holding a depth-1 piece usually means the player is close
// to the finish line.
//
// Catalog source: SQL recursive walk over scripted_npc_turnins seeded with
// the final Epic 1.0 reward IDs (Druid 20490, Cleric 5532, Wizard 14341,
// Rogue 11057, Paladin 10099, Shadow Knight 14383, Monk 10652, Bard 20542,
// Shaman 10651, Ranger 20488, Necromancer 20544, Enchanter 10650, Magician
// 28034). Re-run when the importer captures new precursor steps.

export type EpicComponent = {
  itemId: number;
  name:   string;
  depth:  number;   // 1 = final-turn-in input; higher = earlier in the chain
};

export const EPIC_ROOT: Record<string, { weapon: string; rewardId: number }> = {
  'Druid':         { weapon: "Nature Walker's Scimitar",     rewardId: 20490 },
  'Cleric':        { weapon: "Water Sprinkler of Nem Ankh",  rewardId: 5532  },
  'Wizard':        { weapon: "Staff of the Four",            rewardId: 14341 },
  'Rogue':         { weapon: "Ragebringer",                  rewardId: 11057 },
  'Paladin':       { weapon: "Fiery Defender",               rewardId: 10099 },
  'Shadow Knight': { weapon: "Innoruuk's Curse",             rewardId: 14383 },
  'Monk':          { weapon: "Celestial Fists",              rewardId: 10652 },
  'Bard':          { weapon: "Singing Short Sword",          rewardId: 20542 },
  'Shaman':        { weapon: "Spear of Fate",                rewardId: 10651 },
  'Ranger':        { weapon: "Earthcaller",                  rewardId: 20488 },
  'Necromancer':   { weapon: "Scythe of the Shadowed Soul",  rewardId: 20544 },
  'Enchanter':     { weapon: "Staff of the Serpent",         rewardId: 10650 },
  'Magician':      { weapon: "Orb of Mastery",               rewardId: 28034 },
};

export const EPIC_COMPONENTS: Record<string, EpicComponent[]> = {
  'Bard': [
    { itemId: 20383, name: "Maestro's Symphony Page 24 Bottom",   depth: 1 },
    { itemId: 20376, name: "Maestro's Symphony Page 24 Top",      depth: 1 },
    { itemId: 20377, name: "Maestros Symphony Page 25",            depth: 1 },
    { itemId: 20538, name: "Mystical Lute",                        depth: 1 },
    { itemId: 20527, name: "Chromodrac Gut",                       depth: 2 },
    { itemId: 20366, name: "Mahlins Mystical Bongos",              depth: 2 },
    { itemId: 20536, name: "Mystical Lute Body",                   depth: 2 },
    { itemId: 20535, name: "Mystical Lute Head",                   depth: 2 },
    { itemId: 20529, name: "Onyx Drake Gut",                       depth: 2 },
    { itemId: 20379, name: "Proof of Speed",                       depth: 2 },
    { itemId: 20528, name: "Red Wurm Gut",                         depth: 2 },
    { itemId: 20526, name: "Undead Dragongut Strings",             depth: 2 },
    { itemId:  5520, name: "Amygdalan Tendril",                    depth: 3 },
    { itemId: 20380, name: "Forpars Note to Himself",              depth: 3 },
    { itemId: 20524, name: "Kedge Backbone",                       depth: 3 },
    { itemId: 20367, name: "Maligar's Head",                       depth: 3 },
    { itemId: 16905, name: "Metal Bits",                           depth: 3 },
    { itemId: 20525, name: "Petrified Werewolf Skull",             depth: 3 },
    { itemId: 11622, name: "Red Dragon Scales",                    depth: 3 },
    { itemId: 20534, name: "Torch of Rathe",                       depth: 3 },
    { itemId: 11602, name: "White Dragon Scales",                  depth: 3 },
    { itemId: 20378, name: "Note to Forpar Fizfla",                depth: 4 },
    { itemId: 20533, name: "Torch of Ro",                          depth: 4 },
    { itemId: 20530, name: "Alluring Horn",                        depth: 5 },
    { itemId: 20532, name: "Torch of Misty",                       depth: 5 },
  ],
  'Cleric': [
    { itemId: 28023, name: "Orb of the Triumvirate",               depth: 1 },
    { itemId: 28048, name: "Orb of Clear Water",                   depth: 2 },
    { itemId: 28049, name: "Orb of Frozen Water",                  depth: 2 },
    { itemId: 28050, name: "Orb of Vapor",                         depth: 2 },
    { itemId: 18170, name: "A Singed Scroll",                      depth: 3 },
    { itemId:  1299, name: "Blood Soaked Plasmatic Priest Robe",   depth: 3 },
    { itemId: 28017, name: "Sceptre of Ixiblat Fer",               depth: 3 },
    { itemId: 28019, name: "Zordak Ragefires Heart",               depth: 3 },
  ],
  'Druid': [
    // Journeyman's Boots (2300), Tan Rope Bridle (21800), and Rebreather
    // (16889) were removed 2026-06-30 (Uilnayar: "journeyman's boots are not
    // part of the druid epic at all"). The recursive walk had picked them up
    // because they form a joke NPC chain — "Triathalon Bike" (Lake Rathetear,
    // takes a Rebreather) → "Triathalon Running Shoes" (South Karana, takes
    // the Bridle) → "Triathalon Token" (North Karana, takes the Boots) —
    // whose FINAL output happens to coincidentally be Warm Pulsing Treant
    // Heart (20695), a real Druid component. A naive backward walk over
    // "anything that outputs a chain item" can't distinguish the ONE
    // canonical quest NPC from an unrelated vendor/novelty NPC that also
    // happens to produce the same item — verified via scripted_npc_turnins:
    // every other item below independently re-derives from the same recursive
    // walk, so only this joke branch was pruned.
    { itemId: 20698, name: "Cleansed Spirit of Antonica",          depth: 1 },
    { itemId: 20697, name: "Cleansed Spirit of Faydwer",           depth: 1 },
    { itemId: 20699, name: "Cleansed Spirit of Kunark",            depth: 1 },
    { itemId: 20440, name: "Elaborate Scimitar",                   depth: 1 },
    { itemId: 20483, name: "Refined Mithril Blade",                depth: 1 },
    { itemId: 20484, name: "Shattered Emerald of Corruption",      depth: 1 },
    { itemId: 20694, name: "Gleaming Unicorn Horn",                depth: 2 },
    { itemId: 20482, name: "Small bit of Mithril Ore",             depth: 2 },
    { itemId: 20695, name: "Warm Pulsing Treant Heart",            depth: 2 },
    { itemId: 20468, name: "Warmly Glowing Stone",                 depth: 2 },
    { itemId: 20688, name: "Ancient Rock",                         depth: 3 },
    { itemId: 20690, name: "Chunk of Tundra",                      depth: 3 },
    { itemId: 20689, name: "Clean Lakewater",                      depth: 3 },
    { itemId: 20693, name: "Green Heartwood Branch",               depth: 3 },
    { itemId: 20485, name: "Hammer of the Ancients",               depth: 3 },
    { itemId: 20691, name: "Kedge Cave Crystals",                  depth: 3 },
    { itemId: 20692, name: "Ocean of Tears Seavines",              depth: 3 },
    { itemId: 20461, name: "Pulsing Green Stone",                  depth: 3 },
    { itemId: 20462, name: "Softly Glowing Stone",                 depth: 3 },
    { itemId: 20479, name: "Dwarven Smiths Hammer",                depth: 4 },
    { itemId: 20473, name: "Hardened Mixture",                     depth: 4 },
    { itemId: 20460, name: "Runecrested Bowl",                     depth: 4 },
    { itemId: 20478, name: "Soulbound Hammer",                     depth: 4 },
    { itemId: 20494, name: "Swirling Sphere of Color",             depth: 4 },
  ],
  'Enchanter': [
    { itemId: 10639, name: "A Bundle of Staves",                   depth: 1 },
    { itemId: 10603, name: "Copy of Notes",                        depth: 1 },
    { itemId: 10601, name: "Ink of the Dark",                      depth: 2 },
    { itemId: 10600, name: "Mechanical Pen",                       depth: 2 },
    { itemId: 10602, name: "White Paper",                          depth: 2 },
    { itemId: 10626, name: "Empty Ink Vial",                       depth: 3 },
    { itemId: 18703, name: "Old Folded Letter",                    depth: 3 },
    { itemId:  1360, name: "Shining Metallic Robes",               depth: 3 },
  ],
  'Necromancer': [
    { itemId: 20652, name: "Gkzzallk in a Box",                    depth: 1 },
    { itemId: 18087, name: "Tome of Instruction",                  depth: 2 },
    { itemId: 20653, name: "Prepared Reagent Box",                 depth: 3 },
    { itemId:  1278, name: "Cloak of Spiroc Feathers",             depth: 4 },
    { itemId: 20656, name: "Eye of Innoruuk",                      depth: 4 },
    { itemId: 18086, name: "Journal of Drendico",                  depth: 4 },
    { itemId: 20655, name: "Slime Blood of Cazic Thule",           depth: 4 },
    { itemId: 20783, name: "Black Silk Cape",                      depth: 5 },
    { itemId: 20780, name: "Ebon Shard",                           depth: 5 },
    { itemId: 20781, name: "Griffons Beak",                        depth: 5 },
    { itemId: 20938, name: "Silver Disc",                          depth: 5 },
    { itemId: 20782, name: "Spiroc Feathers",                      depth: 5 },
    { itemId: 20648, name: "Symbol of Insanity",                   depth: 5 },
    { itemId: 20932, name: "Verdant Tessera",                      depth: 5 },
  ],
  'Paladin': [
    { itemId: 11050, name: "Fiery Avenger",                        depth: 1 },
    { itemId: 29010, name: "Mark of Atonement",                    depth: 1 },
    { itemId: 29009, name: "bucket of pure water",                 depth: 2 },
    { itemId:  5403, name: "Ghoulbane",                            depth: 2 },
    { itemId: 29004, name: "Gleaming Crested Breastplate",         depth: 2 },
    { itemId: 29005, name: "Gleaming Crested Shield",              depth: 2 },
    { itemId: 29003, name: "Gleaming Crested Sword",               depth: 2 },
    { itemId: 18033, name: "Intes First Blessing",                 depth: 2 },
    { itemId: 18034, name: "Intes Second Blessing",                depth: 2 },
    { itemId: 19073, name: "Miragul's Head",                       depth: 2 },
    { itemId:  1254, name: "Miragul's Robe",                       depth: 2 },
    { itemId: 29006, name: "Pure Crystal",                         depth: 2 },
    { itemId:  5504, name: "SoulFire",                             depth: 2 },
    { itemId: 29001, name: "Tainted Darksteel Breastplate",        depth: 2 },
    { itemId: 29000, name: "Tainted Darksteel Sword",              depth: 2 },
    { itemId: 13947, name: "Brilliant Sword of Faith",             depth: 3 },
    { itemId: 12197, name: "Glowing Sword Hilt",                   depth: 3 },
    { itemId: 29002, name: "Tainted Darksteel Shield",             depth: 3 },
  ],
  'Ranger': [
    { itemId: 20483, name: "Refined Mithril Blade",                depth: 1 },
    { itemId: 20484, name: "Shattered Emerald of Corruption",      depth: 1 },
    { itemId: 20482, name: "Small bit of Mithril Ore",             depth: 2 },
    { itemId: 20485, name: "Hammer of the Ancients",               depth: 3 },
    { itemId: 20479, name: "Dwarven Smiths Hammer",                depth: 4 },
    { itemId: 20478, name: "Soulbound Hammer",                     depth: 4 },
    { itemId: 20494, name: "Swirling Sphere of Color",             depth: 4 },
  ],
  'Rogue': [
    { itemId:  7505, name: "Cazic Quill",                          depth: 1 },
    { itemId: 28013, name: "Generals Pouch",                       depth: 1 },
    { itemId:  7506, name: "Jagged Diamond Dagger",                depth: 1 },
    { itemId:  5308, name: "A Gigantic Zweihander",                depth: 2 },
    { itemId:  5401, name: "A Mithril Two-Handed Sword",           depth: 2 },
    { itemId:  5411, name: "Fleshripper",                          depth: 2 },
    { itemId:  5410, name: "Painbringer",                          depth: 2 },
    { itemId:  1357, name: "Robe of the Ishva",                    depth: 2 },
    { itemId:  1253, name: "Robe of the Kedge",                    depth: 2 },
    { itemId:  1354, name: "Robe of the Oracle",                   depth: 2 },
    { itemId:  1360, name: "Shining Metallic Robes",               depth: 2 },
    { itemId: 28014, name: "Stanos' Pouch",                        depth: 2 },
    { itemId:  7041, name: "Burning Rapier",                       depth: 3 },
    { itemId:  7508, name: "Eyerazzia",                            depth: 3 },
    { itemId:  7509, name: "Martune Rapier",                       depth: 3 },
    { itemId:  7020, name: "Well-Balanced Rapier",                 depth: 3 },
  ],
  'Shaman': [
    // Spirit Sentinel's final turn-in takes Iksar Scale (the scale of Lord
    // Rak'Ashiir, looted after killing him in City of Mist). Rak'Ashiir is
    // triggered by handing him a Child's Tear, which drops from the Iksar
    // Broodling that spawns after killing a Plane of Fear golem (Dread /
    // Fright / Terror). The Erudin paper trail (depth 3) is the long-faction
    // grind that comes before the Tear. (Uilnayar 2026-06-26: P99/quarm.guide
    // hints + DB verify.)
    { itemId:  1674, name: "Iksar Scale",                          depth: 1 },
    { itemId:  1673, name: "Child's Tear",                         depth: 2 },
    { itemId: 18450, name: "Personal Diary Page",                  depth: 3 },
    { itemId: 18451, name: "Crier's Scroll",                       depth: 3 },
    { itemId: 18452, name: "Merchants Letter",                     depth: 3 },
    { itemId: 18453, name: "Written Announcement",                 depth: 3 },
    { itemId: 18454, name: "Priests Diary Page",                   depth: 3 },
    { itemId: 18455, name: "Students Log",                         depth: 3 },
  ],
  'Wizard': [
    // Magically Sealed Bag = the Pack you carry from Arantir Karondor in
    // Felwithe to Solomen in Temple of Sol Ro. Pack is assembled from three
    // staves: Blue Crystal Staff (Phinigel Autropos, Kedge Keep), Gnarled
    // Staff (Venril Sathir, Karnor's Castle), Staff of Gabstik (Kandin
    // Firepot chain — Sprocket + Green Oil + Note to Arantir).
    { itemId: 14340, name: "Magically Sealed Bag",                 depth: 1 },
    { itemId: 14337, name: "Blue Crystal Staff",                   depth: 2 },
    { itemId: 14338, name: "Gnarled Staff",                        depth: 2 },
    { itemId: 14339, name: "Staff of Gabstik",                     depth: 2 },
    { itemId: 14319, name: "Golem Sprocket",                       depth: 3 },
    { itemId: 14349, name: "Green Oil",                            depth: 3 },
    { itemId: 18168, name: "Note to Arantir",                      depth: 3 },
  ],
  'Monk': [
    // Final-stage anchors: Lheao's Celestial Fists turn-in takes Danl's
    // Reference (1682) + Robe of the Whistling Fists (12970). Brother Balatin
    // in Dreadlands takes BOTH metal pipes (12979 + 12980, from two different
    // zones per Uilnayar 2026-06-26) + Robe of the Lost Circle (12256) →
    // Robe of the Whistling Fists. Tomekeeper Danl (Erudin) takes Immortals
    // (18195) → Danl's Reference.
    //
    // 2026-06-30 (Uilnayar: "shackle of tynnonium and Whistling Fists are not
    // turnins for the celestial fists"): the previous version of this list
    // also carried a large "headbands and sashes" branch (Shackle of
    // Tynnonium, Whistling Fists, Book of Celestial Fists, Headband of the
    // Righteous, Sash of the Dragonborn, the three Marks, and a two-dozen-item
    // Sebilis tome/Sarnak-drop tail feeding them). Re-verified against
    // scripted_npc_turnins: that ENTIRE branch is real (East Cabilis/Dreadlands
    // turn-ins genuinely exist), but it's a DIFFERENT, unrelated quest chain —
    // none of it has any database path into the five confirmed items below.
    // It was removed wholesale rather than item-by-item once the recursive
    // re-walk showed the whole branch was disconnected.
    { itemId:  1682, name: "Danl's Reference",                     depth: 1 },
    { itemId: 12970, name: "Robe of the Whistling Fists",          depth: 1 },
    { itemId: 12979, name: "A Metal Pipe",                         depth: 1 },
    { itemId: 12980, name: "A Metal Pipe",                         depth: 1 },
    { itemId: 12256, name: "Robe of the Lost Circle",              depth: 1 },
    { itemId: 18195, name: "Immortals",                            depth: 2 },
  ],
  // Shadow Knight (Innoruuk's Curse). Final turn-in to Lhranc in City of Mist
  // takes the four canonical items (Corrupted Ghoulbane + Heart of the
  // Innocent + Head of the Valiant + Will of Innoruuk). The Glohnor/Kyrenna
  // drops feed the crafted finals via Gerot Kastane, Marl Kastane, and the
  // Soulcase. Built from P99/EQProgression hints + DB verify; the importer
  // hasn't captured these turn-ins as scripted yet. (Uilnayar 2026-06-26.)
  'Shadow Knight': [
    { itemId: 14367, name: "Corrupted Ghoulbane",                  depth: 1 },
    { itemId: 14368, name: "Heart of the Innocent",                depth: 1 },
    { itemId: 14369, name: "Head of the Valiant",                  depth: 1 },
    { itemId: 14370, name: "Will of Innoruuk",                     depth: 1 },
    { itemId: 14378, name: "Head of Glohnor",                      depth: 2 },
    { itemId: 14379, name: "Glohnor wrappings",                    depth: 2 },
    { itemId: 14380, name: "Heart of Kyrenna",                     depth: 2 },
    { itemId: 14381, name: "Blood of Kyrenna",                     depth: 2 },
    { itemId: 17051, name: "Soulcase",                             depth: 2 },
  ],
  // Magician (Orb of Mastery). Final turn-in to the Master of Elements takes
  // the four Elements (Fire / Earth / Water / Wind). Each Element is its own
  // sub-quest with multiple components (Powers + element-specific items +
  // Staves of Elemental Mastery). The Words quests (Mastery, Magi`kot) feed
  // the path. Lots of overlap with other quests on Quarm — Tears of Erollisi
  // and Shovel of Ponz both appear in unrelated chains too.
  'Magician': [
    { itemId: 28009, name: "Element of Fire",                      depth: 1 },
    { itemId: 28032, name: "Element of Earth",                     depth: 1 },
    { itemId: 28006, name: "Element of Water",                     depth: 1 },
    { itemId: 28033, name: "Element of Wind",                      depth: 1 },
    { itemId: 28036, name: "Power of Fire",                        depth: 2 },
    { itemId: 28038, name: "Power of Earth",                       depth: 2 },
    { itemId: 28039, name: "Power of Water",                       depth: 2 },
    { itemId: 28037, name: "Power of Wind",                        depth: 2 },
    { itemId: 28004, name: "Words of Mastery",                     depth: 2 },
    { itemId: 28003, name: "Words of Magi`kot",                    depth: 2 },
    { itemId: 28008, name: "Burning Embers",                       depth: 2 },
    { itemId: 10376, name: "Blazing Wand",                         depth: 2 },
    { itemId: 28042, name: "Dirt of Underfoot",                    depth: 2 },
    { itemId:  6361, name: "Shovel of Ponz",                       depth: 2 },
    { itemId: 28040, name: "Tears of Erollisi",                    depth: 2 },
    { itemId: 28041, name: "Rain of Karana",                       depth: 2 },
    { itemId: 20764, name: "Crown of Elemental Mastery",           depth: 2 },
    { itemId: 28043, name: "Elemental Binder",                     depth: 2 },
    { itemId: 11567, name: "Staff of Elemental Mastery: Earth",    depth: 2 },
    { itemId: 11568, name: "Staff of Elemental Mastery: Air",      depth: 2 },
    { itemId: 11569, name: "Staff of Elemental Mastery: Water",    depth: 2 },
    { itemId: 28027, name: "Torn Page of Mastery Fire",            depth: 3 },
    { itemId: 28028, name: "Torn Page of Mastery Wind",            depth: 3 },
    { itemId: 28029, name: "Torn Page of Mastery Earth",           depth: 3 },
    { itemId: 28030, name: "Torn Page of Mastery Water",           depth: 3 },
  ],
};

// Item id → list of classes that need it (for fast lookup against an
// inventory map). An item can belong to several class chains.
export const EPIC_CLASSES_BY_ITEM: Map<number, string[]> = (() => {
  const m = new Map<number, string[]>();
  for (const [cls, list] of Object.entries(EPIC_COMPONENTS)) {
    for (const c of list) {
      const arr = m.get(c.itemId) ?? [];
      arr.push(cls);
      m.set(c.itemId, arr);
    }
  }
  return m;
})();
