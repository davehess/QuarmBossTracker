// web/lib/gearWeights.ts — the gear upgrade finder's tuning table. ONE file, data only.
//
// /me/upgrades (DECISIONS §383, companion gap §94: "class weights off / low / med / high / crit with rules for
// the attack, haste, mana-regen and weapon-damage caps") scores every wearable item for a class with this
// table and lists the three best upgrades per slot. Change a number here and the page, the tests' shape and
// nothing else moves; the scoring code (web/lib/gearUpgrades.ts) has no weights of its own.
//
// HOW AN ITEM IS SCORED
//   score = Σ over stats of  effective(stat) × STAT_UNIT[stat] × TIER_POINTS[tier(class, stat)]   + tie-breakers
//   · effective(stat) is the item's value after the CAPS below are applied against everything ELSE worn;
//   · STAT_UNIT puts the stats on one scale (a typical good item carries ~150 HP, ~30 AC, ~20 of a stat);
//   · the tier is the class's own call: off 0 · low 0.5 · med 1 · high 2 · crit 3 (TIER_POINTS);
//   · the tie-breakers are flat points for a focus, worn, proc or click effect (TIEBREAK). They are small on
//     purpose: they decide between two items that otherwise score alike, and never outweigh a real stat.
// An upgrade is an item that beats the slot's current item by at least MIN_GAIN points.
//
// THE TIERS, PER CLASS. Anything a class does not list falls back to BASE_TIERS. Read them as "how much does
// one more point of this help THIS class on a raid night":
//   · casters (CLR DRU SHM NEC WIZ MAG ENC): mana, mana regen and their casting stat are crit; HP is the
//     survival stat; AC and melee stats are off or low.
//   · tanks (WAR PAL SHD): AC and HP lead; PAL/SHD also care about mana and their casting stat (mid).
//   · melee (MNK ROG RNG BST BRD): HP, haste, attack and weapon damage-per-delay, plus the dexterity/agility
//     stats the class swings on.
//
// CAPS (the "cap rules"). Each capped stat is judged against the REST of the worn set, so an upgrade can
// never be credited with points the game would throw away. The numbers come from the Quarm server source
// (SecretsOTheP/EQMacEmu @ a3b80b2) and are computed per character in web/lib/gearCaps.ts (capsFor); the CAPS
// table below is only the level-65, class-blind default that a bare effectiveValue() call falls back to:
//   · attack — ONE shared ceiling of 250 for worn +ATK (zone/bonuses.cpp:78 ItemATKCap, ruletypes.h:55; also
//     verified in game 2026-07-14). A piece's +ATK only counts up to the room the other pieces leave.
//   · haste — the highest worn haste wins and they do not stack. A piece's haste counts only by how far it beats
//     the best OTHER worn piece.
//   · hp regen — summed to a ceiling of 30, or (level − 30) above level 60: 35 at 65 (client_mods.cpp:196-202).
//     ⚠ This table said 30 until 2026-10-26; that was the level-60 number.
//   · mana regen (Flowing Thought) — summed to 15 for any class that casts, 0 for Warrior / Rogue / Monk, whose
//     item mana regen is discarded (client_mods.cpp:975-983; mob.cpp:856-888 for who casts). The default below is
//     the caster 15; the class-aware 0 is in gearCaps.
//   · damage shield — NO cap. The EQEmu default of 30 that used to sit here has no counterpart in the Quarm
//     server source (grep of zone/ finds no ItemDamageShieldCap), so the unbacked ceiling was removed.
//   · Magic resist has a FLOOR, not a cap: raid rule 12 wants 100 worn (web/lib/raidKit.ts MR_FLOOR). While the
//     worn set sits under it, MR is weighed at MR_BELOW_FLOOR_TIER; at or over it, at the class's own tier.
//     (The game's ceiling on a resist is 500, plus AA; gearCaps applies that to the per-character caps.)
//   · attributes — per-character: the stat cap is 255 to level 60, then +5 a level (280 at 65), plus the AA cap
//     raises the character owns (Planar Power +25, Innate Enlightenment +50 on WIS/INT for casters). Base stats
//     are not in our data, so how much of the cap gear can still fill is ASSUMED: see ATTR_ASSUMED_NONGEAR.
//   · AC — a soft cap per class; past it each point counts 1 / `returns` (attack.cpp:5320-5451).
// There is no "heroic" stat on Quarm items; the finder reads none.

export type Tier = 'off' | 'low' | 'med' | 'high' | 'crit';

export const TIER_POINTS: Record<Tier, number> = { off: 0, low: 0.5, med: 1, high: 2, crit: 3 };

export type StatKey =
  | 'hp' | 'mana' | 'ac'
  | 'str' | 'sta' | 'agi' | 'dex' | 'wis' | 'intel' | 'cha'
  | 'mr' | 'cr' | 'dr' | 'fr' | 'pr'
  | 'attack' | 'haste' | 'regen' | 'manaregen' | 'damageshield'
  | 'dmgRatio';

export const STAT_KEYS: StatKey[] = [
  'hp', 'mana', 'ac',
  'str', 'sta', 'agi', 'dex', 'wis', 'intel', 'cha',
  'mr', 'cr', 'dr', 'fr', 'pr',
  'attack', 'haste', 'regen', 'manaregen', 'damageshield',
  'dmgRatio',
];

export const STAT_LABEL: Record<StatKey, string> = {
  hp: 'HP', mana: 'Mana', ac: 'AC',
  str: 'STR', sta: 'STA', agi: 'AGI', dex: 'DEX', wis: 'WIS', intel: 'INT', cha: 'CHA',
  mr: 'MR', cr: 'CR', dr: 'DR', fr: 'FR', pr: 'PR',
  attack: 'ATK', haste: 'Haste', regen: 'HP regen', manaregen: 'Mana regen', damageshield: 'Dmg shield',
  dmgRatio: 'Dmg/delay',
};

// Points per raw unit, before the class tier. dmgRatio is damage ÷ delay (a 30 / 28 weapon is 1.07).
export const STAT_UNIT: Record<StatKey, number> = {
  hp: 0.1, mana: 0.1, ac: 0.35,
  str: 1, sta: 1, agi: 1, dex: 1, wis: 1, intel: 1, cha: 1,
  mr: 1, cr: 1, dr: 1, fr: 1, pr: 1,
  attack: 0.2, haste: 0.5, regen: 2, manaregen: 3, damageshield: 1.5,
  dmgRatio: 20,
};

export const BASE_TIERS: Record<StatKey, Tier> = {
  hp: 'med', mana: 'off', ac: 'low',
  str: 'off', sta: 'off', agi: 'off', dex: 'off', wis: 'off', intel: 'off', cha: 'off',
  mr: 'low', cr: 'low', dr: 'low', fr: 'low', pr: 'low',
  attack: 'off', haste: 'off', regen: 'low', manaregen: 'off', damageshield: 'off',
  dmgRatio: 'off',
};

// Keyed by the BASE class name (web/lib/class-titles.ts normalizeClass).
export const CLASS_TIERS: Record<string, Partial<Record<StatKey, Tier>>> = {
  Warrior:       { hp: 'high', ac: 'crit', sta: 'med', str: 'med', agi: 'low', dex: 'low', attack: 'high', haste: 'high', dmgRatio: 'high', regen: 'med', damageshield: 'low' },
  Paladin:       { hp: 'high', ac: 'high', mana: 'med', sta: 'med', str: 'med', wis: 'med', attack: 'med', haste: 'med', dmgRatio: 'med', regen: 'med', manaregen: 'low' },
  'Shadow Knight': { hp: 'high', ac: 'high', mana: 'med', sta: 'med', str: 'med', intel: 'med', attack: 'med', haste: 'med', dmgRatio: 'med', regen: 'med', manaregen: 'low' },
  Cleric:        { hp: 'high', mana: 'crit', wis: 'crit', manaregen: 'crit', ac: 'med', sta: 'low', regen: 'low' },
  Druid:         { hp: 'high', mana: 'crit', wis: 'crit', manaregen: 'crit', ac: 'low', sta: 'low', regen: 'low' },
  Shaman:        { hp: 'high', mana: 'crit', wis: 'crit', manaregen: 'crit', ac: 'low', sta: 'med', regen: 'low' },
  Wizard:        { hp: 'med', mana: 'crit', intel: 'crit', manaregen: 'crit', ac: 'low', sta: 'low' },
  Magician:      { hp: 'med', mana: 'crit', intel: 'crit', manaregen: 'crit', ac: 'low', sta: 'low' },
  Enchanter:     { hp: 'med', mana: 'crit', intel: 'crit', cha: 'high', manaregen: 'crit', ac: 'low', sta: 'low' },
  Necromancer:   { hp: 'med', mana: 'crit', intel: 'crit', manaregen: 'crit', ac: 'low', sta: 'low', regen: 'med' },
  Bard:          { hp: 'high', mana: 'med', ac: 'med', cha: 'med', dex: 'med', sta: 'med', attack: 'med', haste: 'med', dmgRatio: 'high', regen: 'low' },
  Rogue:         { hp: 'high', ac: 'high', dex: 'crit', str: 'high', agi: 'med', sta: 'med', attack: 'high', haste: 'crit', dmgRatio: 'crit', regen: 'low' },
  Monk:          { hp: 'high', ac: 'high', agi: 'high', dex: 'high', str: 'high', sta: 'med', attack: 'high', haste: 'crit', dmgRatio: 'med', regen: 'low' },
  Ranger:        { hp: 'high', ac: 'med', dex: 'high', agi: 'med', str: 'med', wis: 'med', mana: 'med', attack: 'high', haste: 'high', dmgRatio: 'high', regen: 'low' },
  Beastlord:     { hp: 'high', ac: 'med', str: 'med', dex: 'med', agi: 'med', wis: 'med', mana: 'med', sta: 'med', attack: 'med', haste: 'med', dmgRatio: 'med', regen: 'low' },
};

// Raid rule 12 (web/lib/raidKit.ts MR_FLOOR): while worn MR is under the floor, MR is worth this much.
export const MR_BELOW_FLOOR_TIER: Tier = 'high';

export type CapRule =
  | { rule: 'sum'; cap: number; keepNegative?: boolean }      // every worn piece's value adds up, to a ceiling
  | { rule: 'max' }                                           // only the best worn piece counts; they do not stack
  | { rule: 'soft'; cap: number; returns: number };           // full value to the soft cap, 1 / returns past it
export type CapTable = Partial<Record<StatKey, CapRule>>;
// The level-65, class-blind default (see the CAPS notes above). Per-character caps: web/lib/gearCaps.ts capsFor().
export const CAPS: CapTable = {
  attack: { rule: 'sum', cap: 250 },
  haste: { rule: 'max' },
  regen: { rule: 'sum', cap: 35 },
  manaregen: { rule: 'sum', cap: 15 },
};

// How much of an attribute is assumed to come from somewhere other than worn gear (race and class base, level,
// AAs, buffs). Base stats are not in our data, so this is a model, not a measurement, and the page names it:
//   high — "High end": the character is near the cap before gear, so only gear points that still fit under the cap
//          count. 205 is 255 − 50: the old pre-Planes cap, less the 50 points a gear set typically adds.
//   low  — "Low end": nothing is assumed, every gear point counts (up to the cap).
// The AA cap raises widen the room in High end (cap 305 → 100 points of gear count, not 75), which is the point of
// them. Change a number here and nothing else moves.
export const ATTR_ASSUMED_NONGEAR = { high: 205, low: 0 };
export type AttrEnd = keyof typeof ATTR_ASSUMED_NONGEAR;
export const DEFAULT_ATTR_END: AttrEnd = 'high';

// Flat points a worn-effect item earns on top of its stats. Deliberately small: tie-breakers, not drivers.
export const TIEBREAK = { focus: 2, worn: 1, proc: 1, click: 0.5 };

// An item is only an "upgrade" when it beats what is worn by at least this many points.
export const MIN_GAIN = 1;

// How many upgrades the page shows per slot, and how many the ranker keeps before sources are looked up
// (an item with no known drop or vendor falls out, so a few spares are kept behind the top three).
export const TOP_N = 3;
export const POOL_DEPTH = 15;

// The level the finder assumes: Planes of Power raised the cap from 60 to 65 on 2026-10-01. characters has no
// level column, so the finder never reads one; it simply assumes the era cap (a level-60 item is fair game).
export const LEVEL_CAP = { preLaunch: 60, popLive: 65 };
export const POP_LIVE_AT = '2026-10-01T00:00:00Z';
