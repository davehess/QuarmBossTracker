// web/lib/raidKit.ts — Raid Kit readiness compute for #95 (raid rule 12).
//
// Pure + dependency-light (only class-titles, itself pure) so it unit-tests
// without a DB or Next runtime (see test/raid-kit.test.js). The gear page and
// /admin/readiness fetch the data and hand plain rows in here; NOTHING in this
// file talks to Supabase.
//
// The blessed v1 (DESIGN-platform-queue.md, R.3): a 100-MR floor from worn gear
// plus a best-effort utility checklist (Enduring Breath / Levitate / self-invis
// / self-port, and the Necromancer coffin). Design stance — "helping, not
// watching":
//   * MR is the only HARD pass/fail, and only when a gear snapshot EXISTS. No
//     snapshot ⇒ no judgement (the caller shows "run Quarmy export").
//   * Utilities are covered/ not-detected, never a red "fail": a source can sit
//     in the bank (stripped before upload) or in an un-uploaded spellbook, so a
//     blank is "we can't see it", not "you don't have it".
//   * Detection UNDER-claims class-innate capability on purpose — a false green
//     ("you're covered") is worse than an honest amber ("not detected"), so the
//     innate map holds only the certain Luclin-era self-buffs; everything else
//     must be proven by an actual item clicky/worn effect or a scribed spell.

import { normalizeClass } from './class-titles';

export const MR_FLOOR = 100;

export type UtilityKey = 'eb' | 'lev' | 'invis' | 'port';
export const UTILITY_KEYS: UtilityKey[] = ['eb', 'lev', 'invis', 'port'];
export const UTILITY_LABEL: Record<UtilityKey, string> = {
  eb: 'Enduring Breath',
  lev: 'Levitate',
  invis: 'Self-invis',
  port: 'Self-port',
};

export type EquippedItem = { slot: string; item_id: number; item_name: string };
export type BaggedItem = { item_id: number; item_name: string };
export type ItemStat = {
  mr: number | null;
  clickeffect: number | null;
  worneffect: number | null;
};

export type RaidKitInput = {
  className: string | null;
  hasSnapshot: boolean;
  equipped: EquippedItem[];
  bagged: BaggedItem[];
  items: Record<number, ItemStat>;
  // spell id → spell name, for resolving click/worn effect ids to names.
  spellNames: Record<number, string>;
  // character_spellbook spell names (any case) — the "class self-spell" path.
  scribedSpells?: string[];
};

export type UtilityCheck = { covered: boolean; source: string | null };
export type CoffinCheck = {
  applicable: boolean;         // only true for Necromancers
  covered: boolean;
  source: string | null;
  note: string | null;         // privacy caveat when a necro shows no coffin
};

export type RaidKitResult = {
  hasSnapshot: boolean;
  mr: { value: number; floor: number; met: boolean };
  utilities: Record<UtilityKey, UtilityCheck>;
  coffin: CoffinCheck;
};

// Spell-NAME matchers. We test these against the resolved click/worn effect
// spell name and against scribed spell names — never item names (an item called
// "Ring of the Crimson Bull" whose clicky is Invigor must NOT read as a port).
// invis uses /invisibilit/ so it matches "Invisibility"/"Invisibility versus
// Undead"/"Improved Invisibility" but NOT the worn detection effect
// "See Invisible". "Dead Man Floating" (necro) grants both EB and Levitate.
const RX: Record<UtilityKey, RegExp> = {
  eb: /(enduring|everlasting)\s+breath|dead man floating|breath of the dead|corpse breath/i,
  lev: /levitat|dead man floating/i,
  invis: /invisibilit/i,
  port: /\bgate\b|translocat|teleport|evacuat|succor|^ring of |wizard spire|call of the hero/i,
};

// CONSERVATIVE class-innate self-buff map (Luclin-era Project Quarm). Only the
// certain capabilities — a class here provides that utility from its own
// spellbook regardless of gear, so it shows "self (Class)". Everything omitted
// falls through to item / scribed-spell proof. Under-claim on purpose.
const CLASS_SELF: Record<string, UtilityKey[]> = {
  Druid: ['eb', 'lev', 'invis', 'port'],       // EB, Levitate, Superior Camo, ports/Gate/Succor
  Wizard: ['lev', 'invis', 'port'],            // Levitate, Invisibility, Gate/Translocate/Teleport/Evac
  Enchanter: ['invis'],                        // Invisibility line
  Necromancer: ['eb', 'lev'],                  // Dead Man Floating = EB + Levitate
  Shaman: ['eb'],                              // Enduring Breath
};

// Does any resolved click/worn effect on this item, or this bag item's clicky,
// grant `key`? Returns a source label ("<item> (worn)"/"(click)") or null.
function itemSource(
  key: UtilityKey,
  item_name: string,
  stat: ItemStat | undefined,
  spellNames: Record<number, string>,
  includeWorn: boolean,
): string | null {
  if (!stat) return null;
  const rx = RX[key];
  if (includeWorn && stat.worneffect && stat.worneffect > 0) {
    const n = spellNames[stat.worneffect];
    if (n && rx.test(n)) return `${item_name} (worn)`;
  }
  if (stat.clickeffect && stat.clickeffect > 0) {
    const n = spellNames[stat.clickeffect];
    if (n && rx.test(n)) return `${item_name} (click)`;
  }
  return null;
}

function detectUtility(key: UtilityKey, input: RaidKitInput): UtilityCheck {
  const base = normalizeClass(input.className);

  // 1. Class innate (strongest signal, no snapshot needed).
  if (base && CLASS_SELF[base]?.includes(key)) {
    return { covered: true, source: `self (${base})` };
  }

  // 2. Scribed spell (concrete per-character evidence from character_spellbook).
  const rx = RX[key];
  const scribed = (input.scribedSpells ?? []).find(n => n && rx.test(n));
  if (scribed) return { covered: true, source: `scribed: ${scribed}` };

  // 3. An item they actually hold — worn/click on an equipped piece, or a
  //    clicky sitting in bags (port stones, EB rings, etc.).
  for (const g of input.equipped) {
    const s = itemSource(key, g.item_name, input.items[g.item_id], input.spellNames, true);
    if (s) return { covered: true, source: s };
  }
  for (const g of input.bagged) {
    const s = itemSource(key, g.item_name, input.items[g.item_id], input.spellNames, false);
    if (s) return { covered: true, source: s };
  }

  return { covered: false, source: null };
}

// "coffin"/"casket" container carried by a Necromancer (Summon Corpse fodder).
// Excludes the rogue "Coffin Poison Bottle" false positive.
const COFFIN_RX = /coffin|casket/i;
const COFFIN_EXCLUDE_RX = /poison/i;

function detectCoffin(input: RaidKitInput): CoffinCheck {
  const base = normalizeClass(input.className);
  if (base !== 'Necromancer') {
    return { applicable: false, covered: false, source: null, note: null };
  }
  const found = [...input.equipped, ...input.bagged].find(
    g => COFFIN_RX.test(g.item_name) && !COFFIN_EXCLUDE_RX.test(g.item_name),
  );
  if (found) return { applicable: true, covered: true, source: found.item_name, note: null };
  return {
    applicable: true,
    covered: false,
    source: null,
    note: 'No coffin in visible bags — the bank is stripped before upload, so a coffin kept in the bank can’t be confirmed here.',
  };
}

export function computeMrFromGear(
  equipped: EquippedItem[],
  items: Record<number, ItemStat>,
): number {
  let value = 0;
  for (const g of equipped) value += items[g.item_id]?.mr ?? 0;
  return value;
}

export function computeRaidKit(input: RaidKitInput): RaidKitResult {
  const mrValue = computeMrFromGear(input.equipped, input.items);
  const utilities = {} as Record<UtilityKey, UtilityCheck>;
  for (const k of UTILITY_KEYS) utilities[k] = detectUtility(k, input);
  return {
    hasSnapshot: input.hasSnapshot,
    mr: { value: mrValue, floor: MR_FLOOR, met: mrValue >= MR_FLOOR },
    utilities,
    coffin: detectCoffin(input),
  };
}
