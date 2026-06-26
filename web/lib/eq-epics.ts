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
    { itemId:  2300, name: "Journeyman's Boots",                   depth: 3 },
    { itemId: 20691, name: "Kedge Cave Crystals",                  depth: 3 },
    { itemId: 20692, name: "Ocean of Tears Seavines",              depth: 3 },
    { itemId: 20461, name: "Pulsing Green Stone",                  depth: 3 },
    { itemId: 20462, name: "Softly Glowing Stone",                 depth: 3 },
    { itemId: 20479, name: "Dwarven Smiths Hammer",                depth: 4 },
    { itemId: 20473, name: "Hardened Mixture",                     depth: 4 },
    { itemId: 20460, name: "Runecrested Bowl",                     depth: 4 },
    { itemId: 20478, name: "Soulbound Hammer",                     depth: 4 },
    { itemId: 20494, name: "Swirling Sphere of Color",             depth: 4 },
    { itemId: 21800, name: "Tan Rope Bridle",                      depth: 4 },
    { itemId: 16889, name: "Rebreather",                           depth: 5 },
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
    { itemId:  1674, name: "Iksar Scale",                          depth: 1 },
  ],
  'Wizard': [
    { itemId: 14340, name: "Magically Sealed Bag",                 depth: 1 },
  ],
  'Monk': [
    // Final-stage anchors: Lheao's Celestial Fists turn-in takes Danl's
    // Reference (1682) + Robe of the Whistling Fists (12970). Brother Balatin
    // in Dreadlands takes BOTH metal pipes (12979 + 12980, from two different
    // zones per Uilnayar 2026-06-26) + Robe of the Lost Circle (12256) →
    // Robe of the Whistling Fists. The full pre-epic chain (Shackle of
    // Tynnonium 4199, Whistling Fists 7836, Sash of the Dragonborn 1623,
    // Headband of the Righteous 3532) is the famous "headbands and sashes"
    // path Monks grind through. Depth-2 items are the Sebilis tome set +
    // Sarnak/Iksar drops that feed those steps.
    { itemId:  1682, name: "Danl's Reference",                     depth: 1 },
    { itemId: 12970, name: "Robe of the Whistling Fists",          depth: 1 },
    { itemId: 12979, name: "A Metal Pipe",                         depth: 1 },
    { itemId: 12980, name: "A Metal Pipe",                         depth: 1 },
    { itemId: 12256, name: "Robe of the Lost Circle",              depth: 1 },
    { itemId:  4199, name: "Shackle of Tynnonium",                 depth: 1 },
    { itemId:  3886, name: "Chunk of Tynnonium",                   depth: 1 },
    { itemId:  7836, name: "Whistling Fists",                      depth: 1 },
    { itemId:  1689, name: "Book of Celestial Fists",              depth: 1 },
    { itemId:  3532, name: "Headband of the Righteous",            depth: 1 },
    { itemId:  1623, name: "Sash of the Dragonborn",               depth: 1 },
    { itemId:  7879, name: "Mark of Agility",                      depth: 1 },
    { itemId:  7881, name: "Mark of Clarity",                      depth: 1 },
    { itemId:  7880, name: "Mark of Patience",                     depth: 1 },
    { itemId:  8226, name: "Satchel of Cazic-Thule",               depth: 1 },
    { itemId: 18898, name: "Flayed Skin Tome",                     depth: 1 },
    { itemId: 18899, name: "Flayed Skin Tome",                     depth: 1 },
    { itemId: 22918, name: "Chokadai Scale",                       depth: 2 },
    { itemId: 18359, name: "Dark Black Tome",                      depth: 2 },
    { itemId: 18464, name: "Dark Grey Tome",                       depth: 2 },
    { itemId: 18467, name: "Dim White Tome",                       depth: 2 },
    { itemId: 22922, name: "Earthenware Bowl",                     depth: 2 },
    { itemId: 18469, name: "Faded White Tome",                     depth: 2 },
    { itemId: 22917, name: "Frozen Soulstone",                     depth: 2 },
    { itemId: 18465, name: "Greyed Tome",                          depth: 2 },
    { itemId: 18195, name: "Immortals",                            depth: 2 },
    { itemId: 22921, name: "Kromdul Bracelet",                     depth: 2 },
    { itemId: 18463, name: "Light Black Tome",                     depth: 2 },
    { itemId: 18466, name: "Light Grey Tome",                      depth: 2 },
    { itemId: 18468, name: "Pale White Tome",                      depth: 2 },
    { itemId: 18470, name: "Pure White Tome",                      depth: 2 },
    { itemId: 22920, name: "Ring of the Construct",                depth: 2 },
    { itemId: 22919, name: "Sarnak Hide",                          depth: 2 },
    { itemId: 22924, name: "Sealed Journal",                       depth: 2 },
    { itemId: 22916, name: "Skyfire Pumice",                       depth: 2 },
    { itemId: 18462, name: "Solid Black Tome",                     depth: 2 },
    { itemId: 22923, name: "Vine Woven Basket",                    depth: 2 },
    { itemId: 12828, name: "Full Kwinn Pack",                      depth: 3 },
    { itemId: 12822, name: "A Mechanical Iksar Tail",              depth: 2 },
  ],
  // Shadow Knight / Magician chains haven't been fully captured by the
  // importer yet (the importer is most thorough on classic-zone NPCs;
  // Innoruuk's Curse + Orb of Mastery rely on scripted turn-ins we haven't
  // walked back from successfully). Left empty for now — the section just
  // skips those classes. A future importer sweep + recursive re-walk fills
  // them in.
  'Shadow Knight': [],
  'Magician':      [],
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
