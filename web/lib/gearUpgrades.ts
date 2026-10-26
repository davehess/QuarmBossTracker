// web/lib/gearUpgrades.ts — the gear upgrade finder's scoring and ranking (/me/upgrades).
//
// PURE: no database, no Next. The page and web/lib/gearUpgradesLoad.ts read the rows and hand them in; this
// file decides what counts as an upgrade. The tuning (class tiers, units, caps, tie-breakers) is in
// web/lib/gearWeights.ts and nowhere else. Behaviour tests: test/gear-upgrades.test.js.
//
// What it does, per worn slot:
//   1. every item in the pool that fits the slot, the class, the race and the level cap is scored with the class's
//      weights, with the stat caps judged against the REST of the worn set (so a +ATK piece is not credited
//      with attack the 250 ceiling would discard);
//   2. an item that beats the slot's current item by MIN_GAIN is an upgrade; the best POOL_DEPTH are kept;
//   3. selectTop() later drops the ones with no known source and keeps TOP_N.
// Weapons (Primary, Secondary, Range) are like-for-like only: the same weapon type as the one wielded now.
// Nothing here knows which weapon skills a class has, so it never suggests a different kind of weapon, and an
// empty weapon slot gets no suggestion.

import { normalizeClass } from './class-titles';
import { WORN_SLOTS, CLASS_BIT, type SlotInfo } from './clicky-macros';
import { MR_FLOOR } from './raidKit';
import {
  BASE_TIERS, CAPS, CLASS_TIERS, LEVEL_CAP, MIN_GAIN, MR_BELOW_FLOOR_TIER, POOL_DEPTH, POP_LIVE_AT,
  STAT_KEYS, STAT_LABEL, STAT_UNIT, TIEBREAK, TIER_POINTS, TOP_N, type StatKey, type Tier,
} from './gearWeights';

/** One catalog item, the columns the finder reads. Any stat may be null (the mirror leaves unknowns null). */
export type ItemStats = {
  id: number;
  name?: string | null;
  slots: number | null;
  classes: number | null;
  races: number | null;
  required_level: number | null;
  itemtype: number | null;
  ac: number | null; hp: number | null; mana: number | null;
  damage: number | null; delay: number | null;
  str: number | null; sta: number | null; agi: number | null; dex: number | null;
  wis: number | null; intel: number | null; cha: number | null;
  mr: number | null; cr: number | null; dr: number | null; fr: number | null; pr: number | null;
  attack: number | null; haste: number | null; regen: number | null; manaregen: number | null; damageshield: number | null;
  focus_effect: number | null; worneffect: number | null; proc_effect: number | null; clickeffect: number | null;
};

export type Slot = SlotInfo;

/** The slots the finder works: every worn slot but Ammo (a stack, not a piece of gear). Charm is not in WORN_SLOTS. */
export const UPGRADE_SLOTS: Slot[] = WORN_SLOTS.filter(s => s.name !== 'Ammo');

const WEAPON_SLOTS = new Set(['Primary', 'Secondary', 'Range']);

// Race bit per race name as `characters.race` spells it (item `races` is a bitmask, 1 << (id - 1)).
const RACE_BIT: Record<string, number> = {
  human: 1, barbarian: 2, erudite: 4, woodelf: 8, highelf: 16, darkelf: 32, halfelf: 64, dwarf: 128,
  troll: 256, ogre: 512, halfling: 1024, gnome: 2048, iksar: 4096, vahshir: 8192, froglok: 16384,
};

/** Race name → item race bit (0 when the race is unknown: then no race restriction is applied). */
export function raceBit(race: string | null | undefined): number {
  const key = String(race ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return RACE_BIT[key] ?? 0;
}

/** The level the finder assumes (characters has no level column): 65 once Planes of Power is live, else 60. */
export function levelCap(now: Date = new Date()): number {
  return now.toISOString() >= POP_LIVE_AT ? LEVEL_CAP.popLive : LEVEL_CAP.preLaunch;
}

/** The highest `eqemu_zone.expansion` code in play: 4 (PoP) once it is live, else 3 (Luclin). 0..cap is "current era"; -1 and 99 are special zones. */
export function expansionCap(now: Date = new Date()): number {
  return now.toISOString() >= POP_LIVE_AT ? 4 : 3;
}

export const isEraExpansion = (exp: number | null | undefined, cap: number): boolean =>
  typeof exp === 'number' && exp >= 0 && exp <= cap;

const n = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The raw value of one scored stat on an item. dmgRatio is damage ÷ delay (0 when either is missing). */
export function statValue(item: ItemStats, key: StatKey): number {
  if (key === 'dmgRatio') return n(item.delay) > 0 && n(item.damage) > 0 ? n(item.damage) / n(item.delay) : 0;
  return n(item[key]);
}

/** The base class a character is, or null when the finder has no weights for it ("Unknown", a blank). */
export function scoredClass(className: string | null | undefined): string | null {
  const base = normalizeClass(className);
  return base && CLASS_TIERS[base] ? base : null;
}

/** A character's total worn MR (what raid rule 12 reads). */
export function wornMr(worn: ItemStats[]): number {
  return worn.reduce((s, it) => s + n(it.mr), 0);
}

/** The numeric weight of every stat for a class, given the worn set's state (MR under its floor is worth more). */
export function resolveWeights(base: string, worn: ItemStats[]): Record<StatKey, number> {
  const tiers: Record<StatKey, Tier> = { ...BASE_TIERS, ...(CLASS_TIERS[base] ?? {}) };
  if (wornMr(worn) < MR_FLOOR && TIER_POINTS[MR_BELOW_FLOOR_TIER] > TIER_POINTS[tiers.mr]) tiers.mr = MR_BELOW_FLOOR_TIER;
  const out = {} as Record<StatKey, number>;
  for (const k of STAT_KEYS) out[k] = TIER_POINTS[tiers[k]];
  return out;
}

/** What `item` is worth for one stat once the caps are judged against `others` (the rest of the worn set). */
export function effectiveValue(item: ItemStats, key: StatKey, others: ItemStats[]): number {
  const v = statValue(item, key);
  const cap = CAPS[key];
  if (!cap) return v;
  if (v <= 0) return 0;                      // a negative never earns room, and never cancels the cap
  if (cap.rule === 'max') {
    let best = 0;
    for (const o of others) best = Math.max(best, statValue(o, key));
    return Math.max(0, v - best);
  }
  let used = 0;
  for (const o of others) used += Math.max(0, statValue(o, key));
  return Math.min(v, Math.max(0, cap.cap - used));
}

/** An item's score for a class: weighted, capped stats plus the flat effect tie-breakers. */
export function scoreItem(item: ItemStats | null, weights: Record<StatKey, number>, others: ItemStats[]): number {
  if (!item) return 0;
  let s = 0;
  for (const k of STAT_KEYS) {
    if (!weights[k]) continue;
    s += effectiveValue(item, k, others) * STAT_UNIT[k] * weights[k];
  }
  if (n(item.focus_effect) > 0) s += TIEBREAK.focus;
  if (n(item.worneffect) > 0) s += TIEBREAK.worn;
  if (n(item.proc_effect) > 0) s += TIEBREAK.proc;
  if (n(item.clickeffect) > 0) s += TIEBREAK.click;
  return s;
}

/** True when the item can be worn in the slot (its slot bitmask carries the slot's bit). */
export function fitsSlot(item: ItemStats, slot: Slot): boolean {
  return item.slots != null && (Math.floor(item.slots / 2 ** slot.bit) % 2) === 1;   // slots is a bigint column: no `&` past 32 bits
}

/** True when the item's class mask includes the class. An empty / unknown mask is "nobody". */
export function usableByBaseClass(item: ItemStats, base: string): boolean {
  const bit = CLASS_BIT[base.toLowerCase()];
  return !!bit && item.classes != null && (item.classes & bit) !== 0;
}

/** True when the item's race mask allows the race, or when the race is unknown (then nothing is excluded). */
export function usableByRace(item: ItemStats, bit: number): boolean {
  return bit === 0 || item.races == null || item.races === 0 || (item.races & bit) !== 0;
}

export type Equipped = { slot: string; item: ItemStats };

export type Diff = { key: StatKey; label: string; diff: number; capped: boolean };

export type Candidate = {
  item: ItemStats;
  score: number;
  gain: number;          // score − the current item's score
  diffs: Diff[];         // what changes, for the stats the class weighs
};

export type SlotResult = {
  slot: string;
  current: ItemStats | null;
  currentName: string | null;
  currentScore: number;
  candidates: Candidate[];   // best first, at most POOL_DEPTH
  note: string | null;       // why a slot has nothing to suggest, when it is not simply "nothing better"
};

/** The stat changes a swap makes, for the stats the class weighs. Capped stats show the EFFECTIVE change and say so. */
export function diffStats(
  cand: ItemStats, cur: ItemStats | null, weights: Record<StatKey, number>, others: ItemStats[],
): Diff[] {
  const out: Diff[] = [];
  for (const k of STAT_KEYS) {
    if (!weights[k]) continue;
    const rawNew = statValue(cand, k);
    const rawOld = cur ? statValue(cur, k) : 0;
    const effNew = effectiveValue(cand, k, others);
    const effOld = cur ? effectiveValue(cur, k, others) : 0;
    const diff = effNew - effOld;
    if (Math.abs(diff) < 1e-9 && Math.abs(rawNew - rawOld) < 1e-9) continue;
    const capped = Math.abs((rawNew - rawOld) - diff) > 1e-9;
    out.push({ key: k, label: STAT_LABEL[k], diff: k === 'dmgRatio' ? Math.round(diff * 100) / 100 : diff, capped });
  }
  // the biggest weighted movers first
  out.sort((a, b) => Math.abs(b.diff) * STAT_UNIT[b.key] * weights[b.key] - Math.abs(a.diff) * STAT_UNIT[a.key] * weights[a.key]);
  return out;
}

export type RankInput = {
  className: string | null | undefined;
  race?: string | null;
  equipped: Equipped[];                 // what is worn now, by character_gear slot name
  pool: ItemStats[];                    // candidate items (any slot; fitted here)
  levelCap: number;
  excludeIds?: Set<number>;             // item ids never suggested (worn already, lore duplicates)
  extraIds?: Set<number>;               // pool-bypassing ids that are still candidates (items in the bags)
};

/** Rank the upgrades for every worn slot. Returns null when the class has no weights ("Unknown"). */
export function rankUpgrades(input: RankInput): SlotResult[] | null {
  const base = scoredClass(input.className);
  if (!base) return null;
  const rbit = raceBit(input.race);
  const worn = input.equipped.map(e => e.item);
  const weights = resolveWeights(base, worn);
  const bySlot = new Map<string, ItemStats>();
  for (const e of input.equipped) if (!bySlot.has(e.slot)) bySlot.set(e.slot, e.item);
  const wornIds = new Set(worn.map(i => i.id));
  const exclude = input.excludeIds ?? new Set<number>();

  // one pass to drop what no slot can use
  const usable = input.pool.filter(it =>
    it.slots != null && it.slots > 0
    && n(it.required_level) <= input.levelCap
    && usableByBaseClass(it, base) && usableByRace(it, rbit));

  const out: SlotResult[] = [];
  for (const slot of UPGRADE_SLOTS) {
    const current = bySlot.get(slot.name) ?? null;
    const others = input.equipped.filter(e => e.slot !== slot.name).map(e => e.item);   // the rest of the worn set (by slot: one item can sit in two slots)
    const currentScore = scoreItem(current, weights, others);
    const res: SlotResult = {
      slot: slot.name, current, currentName: current?.name ?? null, currentScore, candidates: [], note: null,
    };
    const isWeapon = WEAPON_SLOTS.has(slot.name);
    if (isWeapon && !current) {
      res.note = 'Nothing wielded here, and the finder only swaps like for like (the same weapon type).';
      out.push(res);
      continue;
    }
    const cands: Candidate[] = [];
    for (const it of usable) {
      if (!fitsSlot(it, slot)) continue;
      if (current && it.id === current.id) continue;
      if (wornIds.has(it.id) || exclude.has(it.id)) continue;      // already worn somewhere: lore, or just no gain
      if (isWeapon && it.itemtype !== current!.itemtype) continue;
      const score = scoreItem(it, weights, others);
      const gain = score - currentScore;
      if (gain < MIN_GAIN) continue;
      cands.push({ item: it, score, gain, diffs: diffStats(it, current, weights, others) });
    }
    cands.sort((a, b) => b.gain - a.gain || a.item.id - b.item.id);
    res.candidates = cands.slice(0, POOL_DEPTH);
    out.push(res);
  }
  return out;
}

/** Where an item can be had. `bag` means the character already carries it. */
export type Source = {
  kind: 'drop' | 'vendor' | 'bag';
  zone: string | null;
  expansion: number | null;
  npc: string | null;
  chance: number | null;       // 0..100, drops only
};

export type Upgrade = Candidate & { sources: Source[]; best: Source };

const sourceRank = (s: Source): number =>
  s.kind === 'bag' ? 3 : s.kind === 'drop' ? 2 + Math.min(0.99, (s.chance ?? 0) / 100) : 1;

/** Keep, per slot, the best TOP_N candidates that have a known source in the current era (or are already in the bags). */
export function selectTop(cands: Candidate[], sources: Map<number, Source[]>, topN: number = TOP_N): Upgrade[] {
  const out: Upgrade[] = [];
  for (const c of cands) {
    const src = sources.get(c.item.id);
    if (!src || src.length === 0) continue;
    const sorted = [...src].sort((a, b) => sourceRank(b) - sourceRank(a));
    out.push({ ...c, sources: sorted, best: sorted[0] });
    if (out.length >= topN) break;
  }
  return out;
}

/** The ids of every candidate the sources should be looked up for. */
export function candidateIds(results: SlotResult[]): number[] {
  const ids = new Set<number>();
  for (const r of results) for (const c of r.candidates) ids.add(c.item.id);
  return [...ids];
}

/** Opt-outs: a character the owner excluded gets nothing read and nothing shown. */
export function isOptedOut(flags: { exclude_inventory?: boolean | null; exclude_from_stats?: boolean | null } | null | undefined): boolean {
  return !!(flags && (flags.exclude_inventory || flags.exclude_from_stats));
}

/** Interchangeable slots the page shows side by side under one heading (the guild lead, 2026-10-26: ears and wrists, "since they're interchangeable"; rings too, which is dropped by deleting its line). */
export const SLOT_PAIRS: { title: string; slots: [string, string] }[] = [
  { title: 'Ears', slots: ['Ear1', 'Ear2'] },
  { title: 'Wrists', slots: ['Wrist1', 'Wrist2'] },
  { title: 'Fingers', slots: ['Fingers1', 'Fingers2'] },
];

export type SlotGroup<T> = { title: string | null; items: T[] };

/**
 * Lay the per-slot rows out for the page: each pair of interchangeable slots becomes ONE group (two items, pair
 * order) sitting where the pair's first slot sat; every other row is a group of its own with no title. The order
 * of everything else is untouched. A pair with only one slot present is left as a plain row. WORN_SLOTS (which
 * other code reads in bit order) is not changed.
 */
export function groupPairedSlots<T>(rows: T[], slotOf: (row: T) => string): SlotGroup<T>[] {
  const bySlot = new Map(rows.map(r => [slotOf(r), r]));
  const pairOf = new Map<string, (typeof SLOT_PAIRS)[number]>();
  for (const p of SLOT_PAIRS) {
    if (bySlot.has(p.slots[0]) && bySlot.has(p.slots[1])) for (const s of p.slots) pairOf.set(s, p);
  }
  const done = new Set<string>();
  const out: SlotGroup<T>[] = [];
  for (const row of rows) {
    const slot = slotOf(row);
    if (done.has(slot)) continue;
    const pair = pairOf.get(slot);
    if (!pair) { out.push({ title: null, items: [row] }); continue; }
    for (const s of pair.slots) done.add(s);
    out.push({ title: pair.title, items: pair.slots.map(s => bySlot.get(s) as T) });
  }
  return out;
}
