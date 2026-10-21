// How a faction cons to a player BEFORE anything they have done: base + race mod + class mod + deity mod, the way
// EQEmu's CalculateFaction reads eqemu_faction_list_full + eqemu_faction_list_mod (mod_name r<id> / c<id> / d<id>).
// The guild lead, 2026-10-13: "The factions that are never KOS by default should always be green, the ones that can be
// KOS by default could be orange, the ones that are always KOS should be red".
//
// ⚠ Three copies of this maths, kept in step by tests on the same fixtures: the bot's utils (zone-spawns), this file
// (the site imports nothing outside web/), and the Map's own (apps/mimic/map.html, beta). Change them together.
// Import-light on purpose (no `@/` alias): test/faction-con-web.test.js real-imports it.

/** [minimum value, rank]: rank 0 scowls … 8 ally, the agent's CON_STANDINGS ranks. */
export const CON_TIERS: [number, number][] = [[1100, 8], [750, 7], [500, 6], [100, 5], [0, 4], [-100, 3], [-700, 2], [-999, 1]];
/** The /consider word for each rank, indexed by rank. */
export const CON_WORDS = ['scowls', 'threateningly', 'dubiously', 'apprehensively', 'indifferently', 'amiably', 'kindly', 'warmly', 'ally'];

export function conRank(v: number): number {
  for (const [min, r] of CON_TIERS) if (v >= min) return r;
  return 0;
}
/** KOS: threatening (attacks on a roll) or scowls (attacks on sight), i.e. below -700. */
export function isKos(v: number): boolean { return v < -700; }

export const PLAYER_RACES: Record<number, string> = { 1: 'Human', 2: 'Barbarian', 3: 'Erudite', 4: 'Wood Elf', 5: 'High Elf', 6: 'Dark Elf', 7: 'Half Elf',
  8: 'Dwarf', 9: 'Troll', 10: 'Ogre', 11: 'Halfling', 12: 'Gnome', 128: 'Iksar', 130: 'Vah Shir' };
/** Races an illusion can put you in that are not player races (the ones PQDI lists on a faction). */
export const ILLUSION_RACES: Record<number, string> = { 14: 'Werewolf', 26: 'Froglok', 42: 'Wolf', 43: 'Bear', 46: 'Imp', 60: 'Skeleton', 75: 'Elemental',
  82: 'Scarecrow', 85: 'Spectre', 108: 'Eye Of Zomm', 120: 'Wolf Elemental', 161: 'Iksar Skeleton' };
export const CLASSES: Record<number, string> = { 1: 'Warrior', 2: 'Cleric', 3: 'Paladin', 4: 'Ranger', 5: 'Shadow Knight', 6: 'Druid', 7: 'Monk', 8: 'Bard',
  9: 'Rogue', 10: 'Shaman', 11: 'Necromancer', 12: 'Wizard', 13: 'Magician', 14: 'Enchanter', 15: 'Beastlord' };
export const DEITIES: Record<number, string> = { 201: 'Bertoxxulous', 202: 'Brell Serilis', 203: 'Cazic Thule', 204: 'Erollisi Marr', 205: 'Bristlebane',
  206: 'Innoruuk', 207: 'Karana', 208: 'Mithaniel Marr', 209: 'Prexus', 210: 'Quellious', 211: 'Rallos Zek', 212: 'Rodcet Nife',
  213: 'Solusek Ro', 214: 'The Tribunal', 215: 'Tunare', 216: 'Veeshan', 396: 'Agnostic' };

/** base + caps + the mod rows keyed by mod_name ({ r1: 1000, c3: -50, d215: 100 }). A cap pair of 0/0 means no cap. */
export type FactionFacts = {
  base?: number | null;
  min_cap?: number | null;
  max_cap?: number | null;
  mods?: Record<string, number> | null;
};
/** Ids of one player; null/undefined = unknown, so every player option for that part counts. */
export type Who = { race?: number | null; cls?: number | null; deity?: number | null };

export function clampCap(f: FactionFacts, v: number): number {
  const lo = Number(f.min_cap) || 0, hi = Number(f.max_cap) || 0;
  return (lo || hi) ? Math.max(lo, Math.min(hi, v)) : v;
}
function modOf(f: FactionFacts, code: string): number {
  const m = f && f.mods ? Number(f.mods[code]) : 0;
  return Number.isFinite(m) ? m : 0;
}
// The lowest and highest a mod can add across a set of ids (0 for any id without a row).
function spread(f: FactionFacts, prefix: string, ids: number[]): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const id of ids) { const m = modOf(f, prefix + id); if (m < lo) lo = m; if (m > hi) hi = m; }
  return [lo, hi];
}
const RACE_IDS = Object.keys(PLAYER_RACES).map(Number);
const CLASS_IDS = Object.keys(CLASSES).map(Number);
const DEITY_IDS = Object.keys(DEITIES).map(Number);

/** The value range for a player: who = { race, cls, deity } (ids; null = unknown, so every player option counts). */
export function valueRange(f: FactionFacts, who?: Who | null): [number, number] {
  const w = who || {}, base = Number(f && f.base) || 0;
  const parts: [string, number | null | undefined, number[]][] = [['r', w.race, RACE_IDS], ['c', w.cls, CLASS_IDS], ['d', w.deity, DEITY_IDS]];
  let lo = base, hi = base;
  for (const [p, id, all] of parts) {
    const [a, b] = id != null ? [modOf(f, p + id), modOf(f, p + id)] : spread(f, p, all);
    lo += a; hi += b;
  }
  return [clampCap(f, lo), clampCap(f, hi)];
}

/** 'never' | 'some' | 'always': is this faction KOS to a player by default, over every race, class and deity. */
export function kosClass(f: FactionFacts): 'never' | 'some' | 'always' {
  const [lo, hi] = valueRange(f, null);
  return isKos(hi) ? 'always' : isKos(lo) ? 'some' : 'never';
}

// ── names → ids (the characters table stores race and class as TEXT) ─────────

const squash = (s: string | null | undefined): string => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');
const idByName = (table: Record<number, string>, extra: Record<string, number> = {}): Map<string, number> => {
  const m = new Map<string, number>();
  for (const [id, name] of Object.entries(table)) m.set(squash(name), Number(id));
  for (const [alias, id] of Object.entries(extra)) m.set(alias, id);
  return m;
};
// 'Half-Elf' / 'Half Elf' / 'halfelf' all squash to 'halfelf'; 'Vah Shir' / 'VahShir' to 'vahshir'.
const RACE_BY_NAME = idByName(PLAYER_RACES);
const CLASS_BY_NAME = idByName(CLASSES, { sk: 5, shadowknight: 5, necro: 11, bst: 15, mage: 13, enc: 14 });

/** Player race id for a name, or null when it is not one we know. */
export function raceIdFromName(name: string | null | undefined): number | null {
  return RACE_BY_NAME.get(squash(name)) ?? null;
}
/** Class id for a name ('SK' and 'Shadowknight' both give 5), or null when unknown. */
export function classIdFromName(name: string | null | undefined): number | null {
  return CLASS_BY_NAME.get(squash(name)) ?? null;
}
