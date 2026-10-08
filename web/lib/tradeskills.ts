// Tradeskill labels for the /db recipe surfaces (a member, 2026-09-24: "our
// pages don't have tradeskill recipes or quests listed").
//
// Both tables below are read off the Quarm server source (SecretsOTheP/EQMacEmu)
// rather than remembered, because both are positional enums and an off-by-one
// shifts every label after it:
//   • TRADESKILL — `EQ::skills::SkillType` in common/skills.h. Fishing is 55;
//     the run is contiguous to Pottery (69) with Sense Traps (62) and the two
//     non-crafting skills (66, 67) in between.
//   • WORLD_CONTAINER — `BagTypes` in common/item_data.h. tradeskills.cpp treats
//     any container id below 75 as a WORLD object ("world combiner so no item
//     number"), so the id IS the bag type. Cross-checked against the data: 39
//     and 40 (Freeport / Royal Qeynos forge) carry the same 344 recipes, and the
//     Brew Barrel (19) sits in 194 of Brewing's 196. PQDI's recipe pages agree
//     wherever they name one (Loom 16, Forge 17, Brew Barrel 19, the two human
//     forges) and leave the rest blank, so the enum is the only source for those.
//
// Skills 0 and 75 are not skills at all: 75 is the server's always-succeeds
// branch (`spec->tradeskill == 75` in tradeskills.cpp), and both hold quest
// combines (poison doses, the Justice-trial satchels). No trivial applies.

export const TRADESKILL: Record<number, string> = {
  55: 'Fishing',
  56: 'Make Poison',
  57: 'Tinkering',
  58: 'Research',
  59: 'Alchemy',
  60: 'Baking',
  61: 'Tailoring',
  63: 'Blacksmithing',
  64: 'Fletching',
  65: 'Brewing',
  68: 'Jewelry Making',
  69: 'Pottery',
};

export const isQuestCombine = (skill: number | null | undefined) =>
  skill == null || !(skill in TRADESKILL);

export const tradeskillName = (skill: number | null | undefined) =>
  (skill != null && TRADESKILL[skill]) || 'Quest combine';

// "Brewing 135" / "Quest combine" — the trivial is meaningless for the latter.
export const skillLine = (skill: number | null | undefined, trivial: number | null | undefined) =>
  isQuestCombine(skill) ? 'Quest combine' : `${tradeskillName(skill)}${trivial ? ` ${trivial}` : ''}`;

export const WORLD_CONTAINER: Record<number, string> = {
  9: 'Medicine Bag',
  10: 'Toolbox',
  11: 'Lexicon',
  12: 'Mortar',
  13: 'Quest container',
  14: 'Mixing Bowl',
  15: 'Oven',
  16: 'Loom',
  17: 'Forge',
  18: 'Fletching Kit',
  19: 'Brew Barrel',
  20: "Jeweler's Kit",
  21: 'Pottery Wheel',
  22: 'Kiln',
  23: 'Keymaker',
  24: "Wizard's Lexicon",
  25: "Mage's Lexicon",
  26: "Necromancer's Lexicon",
  27: "Enchanter's Lexicon",
  30: 'Quest container',
  31: "Koada'Dal Forge (High Elf)",
  32: "Teir'Dal Forge (Dark Elf)",
  33: 'Oggok Forge (Ogre)',
  34: 'Stormguard Forge (Dwarf)',
  35: "Ak'Anon Forge (Gnome)",
  36: 'Northman Forge (Barbarian)',
  38: 'Cabilis Forge (Iksar)',
  39: 'Freeport Forge (Human)',
  40: 'Royal Qeynos Forge (Human)',
  41: 'Halfling Tailoring Kit',
  42: 'Erudite Tailoring Kit',
  43: "Fier'Dal Tailoring Kit (Wood Elf)",
  44: "Fier'Dal Fletching Kit (Wood Elf)",
  45: 'Iksar Pottery Wheel',
  46: 'Tackle Box',
  47: 'Troll Forge',
  48: "Fier'Dal Forge (Wood Elf)",
  49: 'Vale Forge (Halfling)',
  50: 'Erudite Forge',
};

// One entry of a recipe as item_recipes() / the recipe page returns it:
// c = consumed count, s = count returned on success, k = 1 when it is the
// container, n = item name (null for a world container).
export type RecipePart = { id: number; n: string | null; c: number; s: number; k: number };

export const isWorldContainer = (p: Pick<RecipePart, 'id' | 'k'>) => p.k === 1 && p.id < 75;

export const containerLabel = (p: Pick<RecipePart, 'id' | 'n' | 'k'>) =>
  p.n || WORLD_CONTAINER[p.id] || `Container #${p.id}`;

// Split a recipe's entries the way the combine window reads: what goes in, what
// comes out, what it is combined in. A part both consumed and returned (a
// hammer, a mold that survives) is a TOOL — listing it as a result read as
// "makes a Smithy Hammer" on 772 recipes.
export function splitParts(parts: RecipePart[] | null | undefined) {
  const all = parts ?? [];
  const containers = all.filter(p => p.k === 1);
  const rest = all.filter(p => p.k !== 1);
  return {
    containers,
    tools:      rest.filter(p => p.c > 0 && p.s > 0),
    components: rest.filter(p => p.c > 0 && !(p.s > 0)),
    results:    rest.filter(p => p.s > 0 && !(p.c > 0)),
  };
}

export const partLabel = (p: RecipePart, count: number) =>
  `${p.n || `#${p.id}`}${count > 1 ? ` ×${count}` : ''}`;
