// web/lib/gearCaps.ts — the game's stat ceilings, per character. PURE: no database, no Next.
//
// The gear upgrade finder (/me/upgrades) and the gear page (/character/<name>/gear) judge a stat by how much of the
// gain still lands BELOW its cap (the guild lead, 2026-10-26: "we should be evaluating how close this gets you to
// maximums on stats, attack, flowing thought, AC, etc."). Every number here is read off the Quarm server source,
// SecretsOTheP/EQMacEmu at commit a3b80b2 (the file:line is in each comment), not remembered from a guide:
//
//   attributes   zone/client_mods.cpp:31-40   GetMaxStat: 255 up to level 60; above it 255 + 5 × (level − 60) + the
//                                             AA cap mod. 280 at 65, and 305 with Planar Power (the guild lead,
//                                             2026-10-26: "cap with planar power at level 65 is 305 now, instead of
//                                             255 previous"). ⚠ A server rule Character:StatCap > 0 overrides the
//                                             whole formula; the code cannot tell us Quarm's rule value, and the
//                                             305 the guild lead sees in game says it is unset.
//   resists      zone/client_mods.cpp:42-45   GetMaxResist is a flat 500; :68-81 add the AA resist cap mod.
//   item ATK     zone/bonuses.cpp:78,176      itembonuses.ATK clamps to ItemATKCap, 250 (zone/ruletypes.h:55).
//   HP regen     zone/client_mods.cpp:196-202 CalcHPRegenCap: 30; above level 60 it is level − 30 (35 at 65).
//   mana regen   zone/client_mods.cpp:975-983 CalcManaRegenCap: 0 for a non-caster, else ItemManaRegenCap, 15
//                                             (zone/ruletypes.h:54). A non-caster is Warrior, Rogue or Monk
//                                             (zone/mob.cpp:856-888 GetCasterClass: Bard, Paladin, Ranger,
//                                             Shadow Knight and Beastlord all cast).
//   AC           zone/attack.cpp:5320-5451    a soft cap per class, past which each AC point counts 1 / returns.
//
// ⚠ AC here is ITEM AC. The game applies the soft cap to total mitigation (item AC + defense skill + AGI + spell
// AC), which we cannot see, so the cap is reached EARLIER in game than this file says. The taper therefore
// under-fires: it never invents a cap hit the character has not reached, it can miss one that is real.
//
// The AA stat-cap raises are read from the character's own AAs, not hard-coded: SPA 262 (SE_RaiseStatCap,
// zone/bonuses.cpp:609-647), base1 points per rank into the stat named by base2. In the mirror that is
// eqemu_aa_effects joined to eqemu_altadv_vars on skill_id, and the character's rows (character_aas.aa_index) are
// the catalog's eqmacid. Measured 2026-10-26: Planar Power (eqmacid 142, skill_id 418) is +5 per rank to STR STA
// AGI DEX WIS INT CHA, five ranks, +25; Innate Enlightenment (eqmacid 144, skill_id 426) is +10 per rank to WIS and
// INT for the seven casting classes whose bit is in its class mask, five ranks, +50 (355 for a caster with both,
// the figure the gear page has always quoted).

import { ATTR_ASSUMED_NONGEAR, type AttrEnd, type CapTable, type StatKey } from './gearWeights';

export const ATTR_KEYS: StatKey[] = ['str', 'sta', 'agi', 'dex', 'wis', 'intel', 'cha'];
export const RESIST_KEYS: StatKey[] = ['mr', 'cr', 'dr', 'fr', 'pr'];

export const STAT_CAP_BASE = 255;
export const STAT_CAP_PER_LEVEL = 5;
export const STAT_CAP_FIRST_LEVEL = 60;
export const RESIST_CAP = 500;
export const ITEM_ATK_CAP = 250;
export const ITEM_MANA_REGEN_CAP = 15;
/** Classes whose item mana regen is thrown away (Mob::GetCasterClass returns 'N'). */
export const NON_CASTERS = new Set(['Warrior', 'Rogue', 'Monk']);

/** The attribute / resist cap in an SPA 262 effect's base2 slot (zone/bonuses.cpp:609-647). */
export const STAT_CAP_INDEX: StatKey[] = ['str', 'sta', 'agi', 'dex', 'wis', 'intel', 'cha', 'mr', 'cr', 'fr', 'pr', 'dr'];
export const SPA_RAISE_STAT_CAP = 262;

/** The attribute cap at a level, with the AA raise (0 when none or unknown). */
export function statCapAt(level: number, aaMod = 0): number {
  if (level <= STAT_CAP_FIRST_LEVEL) return STAT_CAP_BASE;
  return STAT_CAP_BASE + (level - STAT_CAP_FIRST_LEVEL) * STAT_CAP_PER_LEVEL + aaMod;
}

export const resistCapAt = (aaMod = 0): number => RESIST_CAP + aaMod;

/** Worn HP regen ceiling: 30, or level − 30 above level 60. */
export function hpRegenCapAt(level: number): number {
  return level > 60 ? level - 30 : 30;
}

/** Worn mana regen (Flowing Thought) ceiling for a base class: 0 for a non-caster. */
export function manaRegenCapFor(base: string): number {
  return NON_CASTERS.has(base) ? 0 : ITEM_MANA_REGEN_CAP;
}

/** AC soft cap above level 50 with Velious live, by base class (zone/attack.cpp:5320-5352). */
const AC_SOFTCAP: Record<string, number> = {
  Warrior: 430,
  Paladin: 403, 'Shadow Knight': 403, Cleric: 403, Bard: 403,
  Ranger: 375, Shaman: 375,
  // ⚠ attack.cpp:5347 reads `RuleB(AlKabor, ReducedMonkAC) ? 315 : 350` and the rule's default is true. 350 is what the
  // guild lead gave; if Quarm's rule is on, the monk number is 315. One constant to change.
  Monk: 350,
};
const AC_SOFTCAP_DEFAULT = 350;   // druid, rogue, wizard, enchanter, necromancer, magician, beastlord; and every class to level 50

export function acSoftcap(base: string, level: number): number {
  if (level <= 50) return AC_SOFTCAP_DEFAULT;
  return AC_SOFTCAP[base] ?? AC_SOFTCAP_DEFAULT;
}

/** The divisor past the soft cap, with Planes of Power live (zone/attack.cpp:5385-5451). */
export function acReturns(base: string, level: number): number {
  const tier = (to61: number, to63: number, from64: number) => (level <= 61 ? to61 : level <= 63 ? to63 : from64);
  switch (base) {
    case 'Warrior': return tier(5, 4, 3);
    case 'Paladin': case 'Shadow Knight': return tier(6, 5, 4);
    case 'Bard': return tier(8, 7, 6);
    case 'Monk': case 'Rogue':
      return level <= 61 ? 20 : level === 62 ? 18 : level === 63 ? 16 : level === 64 ? 14 : 12;
    case 'Ranger': case 'Beastlord':
      return level <= 61 ? 10 : level === 62 ? 9 : level === 63 ? 8 : 7;
    default: return 20;
  }
}

// ── AA stat-cap raises ────────────────────────────────────────────────────────────────────────────────────────

/** AA class masks are 1 << classId (Warrior 1 … Enchanter 14, Beastlord 15), unlike the item mask (1 << classId − 1). */
const AA_CLASS_ID: Record<string, number> = {
  Warrior: 1, Cleric: 2, Paladin: 3, Ranger: 4, 'Shadow Knight': 5, Druid: 6, Monk: 7, Bard: 8, Rogue: 9,
  Shaman: 10, Necromancer: 11, Wizard: 12, Magician: 13, Enchanter: 14, Beastlord: 15,
};

export type AaRow = { aa_index: number; rank: number };
export type AaVar = { skill_id: number; eqmacid: number; name: string | null; max_level: number | null; classes: number | null };
export type AaEffect = { aaid: number; effectid: number | null; base1: number | null; base2: number | null };
export type AaCapUse = { eqmacid: number; skill_id: number; name: string; rank: number; stat: StatKey; amount: number };
export type AaCapMods = {
  known: boolean;                              // false: the character has no AA rows at all, so "no raise" is a guess
  mods: Partial<Record<StatKey, number>>;
  used: AaCapUse[];
};

export const NO_AA: AaCapMods = { known: false, mods: {}, used: [] };

/**
 * The stat-cap raises a character's trained AAs give. A row counts when the catalog knows it, its rank fits the
 * AA's max rank (the export writes junk rows, rank 255 and the like) and the class can train it. Points are
 * base1 × rank into the stat base2 names. No AA rows at all is `known: false`: the caller labels the cap "+AA unknown".
 */
export function aaCapMods(base: string, aas: AaRow[], vars: AaVar[], effects: AaEffect[]): AaCapMods {
  if (aas.length === 0) return NO_AA;
  const classId = AA_CLASS_ID[base] ?? 0;
  const varBySkill = new Map(vars.map(v => [v.skill_id, v]));
  const rankByMac = new Map<number, number>();
  for (const a of aas) rankByMac.set(a.aa_index, Math.max(rankByMac.get(a.aa_index) ?? 0, a.rank));
  const mods: Partial<Record<StatKey, number>> = {};
  const used: AaCapUse[] = [];
  for (const e of effects) {
    if (e.effectid !== SPA_RAISE_STAT_CAP || e.base1 == null || e.base2 == null) continue;
    const v = varBySkill.get(e.aaid);
    const stat = STAT_CAP_INDEX[e.base2];
    if (!v || !stat) continue;
    const rank = rankByMac.get(v.eqmacid) ?? 0;
    if (rank <= 0) continue;
    if (v.max_level != null && v.max_level > 0 && rank > v.max_level) continue;
    if (classId > 0 && v.classes != null && v.classes !== 0 && (v.classes & (1 << classId)) === 0) continue;
    const amount = e.base1 * rank;
    mods[stat] = (mods[stat] ?? 0) + amount;
    used.push({ eqmacid: v.eqmacid, skill_id: v.skill_id, name: v.name ?? `AA #${v.eqmacid}`, rank, stat, amount });
  }
  return { known: true, mods, used };
}

// ── the per-character cap table ───────────────────────────────────────────────────────────────────────────────

export type CapContext = {
  level: number;
  base: string;                  // base class name (web/lib/class-titles.ts normalizeClass)
  attrEnd: AttrEnd;              // High end / Low end (gearWeights ATTR_ASSUMED_NONGEAR)
  aa: AaCapMods;
};

/** The attribute cap for one stat, AA raise included. */
export function attrCapFor(ctx: CapContext, key: StatKey): number {
  return statCapAt(ctx.level, ctx.aa.mods[key] ?? 0);
}

/** How many points of worn gear can still matter for an attribute under the End assumption. */
export function attrRoom(ctx: CapContext, key: StatKey): number {
  return Math.max(0, attrCapFor(ctx, key) - ATTR_ASSUMED_NONGEAR[ctx.attrEnd]);
}

/** The cap rules for one character: what effectiveValue() judges every stat against. */
export function capsFor(ctx: CapContext): CapTable {
  const caps: CapTable = {
    attack: { rule: 'sum', cap: ITEM_ATK_CAP },
    haste: { rule: 'max' },
    regen: { rule: 'sum', cap: hpRegenCapAt(ctx.level) },
    manaregen: { rule: 'sum', cap: manaRegenCapFor(ctx.base) },
    ac: { rule: 'soft', cap: acSoftcap(ctx.base, ctx.level), returns: acReturns(ctx.base, ctx.level) },
  };
  for (const k of ATTR_KEYS) caps[k] = { rule: 'sum', cap: attrRoom(ctx, k), keepNegative: true };
  for (const k of RESIST_KEYS) caps[k] = { rule: 'sum', cap: resistCapAt(ctx.aa.mods[k] ?? 0), keepNegative: true };
  return caps;
}

/** "280", "305" or "280 (+AA unknown)" — the attribute cap as the page says it. */
export function attrCapLabel(ctx: CapContext, key: StatKey): string {
  const cap = attrCapFor(ctx, key);
  return ctx.aa.known || ctx.level <= STAT_CAP_FIRST_LEVEL ? String(cap) : `${cap} (+AA unknown)`;
}
