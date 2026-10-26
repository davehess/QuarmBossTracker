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
  STAT_KEYS, STAT_LABEL, STAT_UNIT, TIEBREAK, TIER_POINTS, TOP_N, type CapTable, type StatKey, type Tier,
} from './gearWeights';
import { attrCapFor, attrRoom, ATTR_KEYS, RESIST_KEYS, type CapContext } from './gearCaps';
import { containerLabel, isQuestCombine, tradeskillName } from './tradeskills';

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
  icon?: number | null;   // the icon id; read for the items the page SHOWS, never for the 14k-row pool
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

/**
 * What `item` is worth for one stat once the caps are judged against `others` (the rest of the worn set).
 * `caps` is the character's own table (gearCaps.capsFor); a bare call uses the level-65 class-blind default.
 */
export function effectiveValue(item: ItemStats, key: StatKey, others: ItemStats[], caps: CapTable = CAPS): number {
  const v = statValue(item, key);
  const cap = caps[key];
  if (!cap) return v;
  // a negative never earns room and never cancels a cap; attributes, resists and AC keep their penalty
  if (v <= 0) return cap.rule === 'soft' || (cap.rule === 'sum' && cap.keepNegative) ? v : 0;
  if (cap.rule === 'max') {
    let best = 0;
    for (const o of others) best = Math.max(best, statValue(o, key));
    return Math.max(0, v - best);
  }
  let used = 0;
  for (const o of others) used += Math.max(0, statValue(o, key));
  if (cap.rule === 'soft') {
    const below = Math.max(0, Math.min(v, cap.cap - used));
    return below + (v - below) / cap.returns;
  }
  return Math.min(v, Math.max(0, cap.cap - used));
}

/** An item's score for a class: weighted, capped stats plus the flat effect tie-breakers. */
export function scoreItem(item: ItemStats | null, weights: Record<StatKey, number>, others: ItemStats[], caps: CapTable = CAPS): number {
  if (!item) return 0;
  let s = 0;
  for (const k of STAT_KEYS) {
    if (!weights[k]) continue;
    s += effectiveValue(item, k, others, caps) * STAT_UNIT[k] * weights[k];
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
  cand: ItemStats, cur: ItemStats | null, weights: Record<StatKey, number>, others: ItemStats[], caps: CapTable = CAPS,
): Diff[] {
  const out: Diff[] = [];
  for (const k of STAT_KEYS) {
    if (!weights[k]) continue;
    const rawNew = statValue(cand, k);
    const rawOld = cur ? statValue(cur, k) : 0;
    const effNew = effectiveValue(cand, k, others, caps);
    const effOld = cur ? effectiveValue(cur, k, others, caps) : 0;
    const diff = effNew - effOld;
    if (Math.abs(diff) < 1e-9 && Math.abs(rawNew - rawOld) < 1e-9) continue;
    const capped = Math.abs((rawNew - rawOld) - diff) > 1e-9;
    // 2 places for the ratio, 1 for the rest (an AC point past the soft cap counts a fraction)
    const places = k === 'dmgRatio' ? 100 : 10;
    out.push({ key: k, label: STAT_LABEL[k], diff: Math.round(diff * places) / places, capped });
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
  caps?: CapTable;                      // the character's own cap rules (gearCaps.capsFor); the level-65 default when absent
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
  const caps = input.caps ?? CAPS;

  // one pass to drop what no slot can use
  const usable = input.pool.filter(it =>
    it.slots != null && it.slots > 0
    && n(it.required_level) <= input.levelCap
    && usableByBaseClass(it, base) && usableByRace(it, rbit));

  const out: SlotResult[] = [];
  for (const slot of UPGRADE_SLOTS) {
    const current = bySlot.get(slot.name) ?? null;
    const others = input.equipped.filter(e => e.slot !== slot.name).map(e => e.item);   // the rest of the worn set (by slot: one item can sit in two slots)
    const currentScore = scoreItem(current, weights, others, caps);
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
      const score = scoreItem(it, weights, others, caps);
      const gain = score - currentScore;
      if (gain < MIN_GAIN) continue;
      cands.push({ item: it, score, gain, diffs: diffStats(it, current, weights, others, caps) });
    }
    cands.sort((a, b) => b.gain - a.gain || a.item.id - b.item.id);
    res.candidates = cands.slice(0, POOL_DEPTH);
    out.push(res);
  }
  return out;
}

/** A tradeskill recipe that makes an item (the quest combines of skill 0 / 75 carry their components and bag). */
export type CraftInfo = {
  recipe: string | null;
  skill: string;               // 'Tailoring', or 'Quest combine'
  trivial: number | null;
  mustLearn: boolean;
  questCombine: boolean;
  container: string | null;
  components: string[];        // quest combines only; "Cured Ethereal Energy ×2"
};

/**
 * Where an item can be had. `bag` means the character already carries it. `quest` is an NPC's quest reward (the
 * zone is the script's), `craft` a tradeskill recipe (no zone: the item's own required level is its era proxy).
 */
export type Source = {
  kind: 'drop' | 'vendor' | 'bag' | 'quest' | 'craft';
  zone: string | null;
  expansion: number | null;
  npc: string | null;
  chance: number | null;       // 0..100, drops only
  craft?: CraftInfo;           // craft only
};

export type Upgrade = Candidate & { sources: Source[]; best: Source };

// Bag first, then a drop (likeliest first), then a vendor; a quest reward and a crafted piece come after, because a
// shop you can walk into beats both.
const sourceRank = (s: Source): number =>
  s.kind === 'bag' ? 3 : s.kind === 'drop' ? 2 + Math.min(0.99, (s.chance ?? 0) / 100)
    : s.kind === 'vendor' ? 1 : s.kind === 'quest' ? 0.8 : 0.6;

/** The one-line "where do I get it" the page prints under an upgrade. */
export function sourceLine(s: Source): string {
  if (s.kind === 'bag') return 'Already in your bags';
  const where = s.zone ?? 'an unknown zone';
  if (s.kind === 'vendor') return `Sold in ${where}${s.npc ? ` by ${s.npc}` : ''}`;
  if (s.kind === 'quest') return `Quest reward: ${s.npc ?? 'an NPC'}, ${where}`;
  if (s.kind === 'craft' && s.craft) {
    const c = s.craft;
    const learn = c.mustLearn ? ' · recipe must be learned first' : '';
    if (c.questCombine) {
      const parts = c.components.length > 0 ? c.components.join(', ') : 'the quest components';
      return `Quest combine: ${parts}${c.container ? ` in ${c.container}` : ''}${learn}`;
    }
    return `Made with ${c.skill}${c.trivial ? ` (trivial ${c.trivial})` : ''}${learn}`;
  }
  return `Drops in ${where}${s.npc ? ` from ${s.npc}` : ''}${s.chance != null && s.chance > 0 ? ` (${s.chance}%)` : ''}`;
}

/** One row of item_alt_sources() (supabase/migrations/20261026200000_item_alt_sources.sql). */
export type AltSourceRow = {
  item_id: number;
  kind: string;
  zone_short: string | null; zone_name: string | null; zone_expansion: number | null; npc_name: string | null;
  recipe_id: number | null; recipe_name: string | null; tradeskill: number | null; trivial: number | null;
  must_learn: boolean | null;
  container_id: number | null; container_name: string | null;
  components: { id: number; n: string | null; c: number; s: number }[] | null;
};

/** A recipe has no zone, so its era is the item's own required level: usable at or under the level cap. */
export const recipeInEra = (requiredLevel: number | null | undefined, cap: number): boolean => n(requiredLevel) <= cap;

const cleanNpc = (name: string | null) => (name ? name.replace(/_/g, ' ').replace(/^#/, '').trim() || null : null);

/**
 * Turn item_alt_sources() rows into Sources, applying the era rules: a quest needs its script's zone to be current
 * era (the same `eqemu_zone.expansion` test the drops use; a zone we cannot place is out), a recipe needs the item's
 * required level to be within the level cap. Duplicate (item, NPC, zone) rows collapse; an item's quest rows come
 * before its recipes.
 */
export function altSourcesFromRows(
  rows: AltSourceRow[], items: Map<number, Pick<ItemStats, 'required_level'>>, expCap: number, cap: number,
): Map<number, Source[]> {
  const out = new Map<number, Source[]>();
  const seen = new Set<string>();
  const add = (id: number, s: Source) => { const l = out.get(id) ?? []; l.push(s); out.set(id, l); };
  for (const r of rows) {
    if (r.kind === 'quest') {
      if (!isEraExpansion(r.zone_expansion, expCap)) continue;
      const npc = cleanNpc(r.npc_name);
      const key = `q:${r.item_id}:${(npc ?? '').toLowerCase()}:${(r.zone_name ?? r.zone_short ?? '').toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      add(r.item_id, { kind: 'quest', zone: r.zone_name ?? r.zone_short, expansion: r.zone_expansion, npc, chance: null });
    } else if (r.kind === 'recipe') {
      if (!recipeInEra(items.get(r.item_id)?.required_level, cap)) continue;
      const key = `r:${r.item_id}:${r.recipe_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const quest = isQuestCombine(r.tradeskill);
      const parts = (r.components ?? []).filter(p => p.c > 0);
      add(r.item_id, {
        kind: 'craft', zone: null, expansion: null, npc: null, chance: null,
        craft: {
          recipe: r.recipe_name, skill: tradeskillName(r.tradeskill), trivial: quest ? null : r.trivial,
          mustLearn: !!r.must_learn, questCombine: quest,
          container: r.container_id == null ? null : containerLabel({ id: r.container_id, n: r.container_name, k: 1 }),
          components: parts.map(p => `${p.n ?? `Item #${p.id}`}${p.c > 1 ? ` ×${p.c}` : ''}`),
        },
      });
    }
  }
  return out;
}

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

// ── how close to the caps ────────────────────────────────────────────────────────────────────────────────────

/** The order cap lines are read in: the stats the guild lead named first (ATK, Flowing Thought), then the rest. */
const CAP_ORDER: StatKey[] = ['attack', 'manaregen', 'regen', 'haste', 'ac', ...ATTR_KEYS, ...RESIST_KEYS];
const ATTR_SET = new Set<StatKey>(ATTR_KEYS);
/** FT is the player-facing name of item mana regen. */
const CAP_LABEL: Partial<Record<StatKey, string>> = { manaregen: 'FT', regen: 'HP regen' };
const capLabel = (k: StatKey) => CAP_LABEL[k] ?? STAT_LABEL[k];

export type CapRow = {
  key: StatKey;
  label: string;
  kind: 'sum' | 'max' | 'soft';
  now: number;                 // worn total before the swap (haste: the best piece)
  after: number;               // worn total after it
  cap: number | null;          // null for haste (no number: only the best piece counts)
  over: number;                // points past a hard cap after the swap (they are thrown away)
  gear: boolean;               // an attribute: `cap` is the room for GEAR points under the High / Low end assumption
};

/** For the stats an item moves: where the worn total stands against its cap before and after the swap. */
export function capRows(cand: ItemStats, cur: ItemStats | null, others: ItemStats[], caps: CapTable): CapRow[] {
  const rows: CapRow[] = [];
  for (const k of CAP_ORDER) {
    const rule = caps[k];
    if (!rule) continue;
    const vNew = statValue(cand, k);
    const vOld = cur ? statValue(cur, k) : 0;
    if ((vNew <= 0 && vOld <= 0) || vNew === vOld) continue;
    let now: number; let after: number;
    if (rule.rule === 'max') {
      const best = others.reduce((m, o) => Math.max(m, statValue(o, k)), 0);
      now = Math.max(best, vOld); after = Math.max(best, vNew);
    } else {
      const used = others.reduce((s, o) => s + Math.max(0, statValue(o, k)), 0);
      now = used + Math.max(0, vOld); after = used + Math.max(0, vNew);
    }
    const cap = rule.rule === 'max' ? null : rule.cap;
    rows.push({
      key: k, label: capLabel(k), kind: rule.rule, now, after, cap,
      over: rule.rule === 'sum' && cap != null ? Math.max(0, after - cap) : 0,
      gear: ATTR_SET.has(k),
    });
  }
  return rows;
}

/** One cap line as text: "ATK 212→250/250", "FT 9→12/15", "Haste 28%→41%", "AC 300→312 (soft cap 350)". */
export function capRowText(r: CapRow): string {
  if (r.kind === 'max') return `${r.label} ${r.now}%→${r.after}%`;
  if (r.kind === 'soft') return `${r.label} ${r.now}→${r.after} (soft cap ${r.cap})`;
  const shown = r.cap != null ? Math.min(r.after, r.cap) : r.after;
  const waste = r.over > 0 ? ` (${r.over} over, wasted)` : '';
  return `${r.label}${r.gear ? ' gear' : ''} ${r.now}→${shown}/${r.cap}${waste}`;
}

export type CapStatus = {
  key: StatKey;
  label: string;
  kind: 'sum' | 'max' | 'soft';
  have: number;                // the worn total (haste: the best piece)
  cap: number | null;
  detail: string | null;       // the cap's own wording, "305 with Planar Power" / "discarded for a Monk"
};

/** The worn set against every cap, for the summary above the slot cards and on the gear page. */
export function capStatus(worn: ItemStats[], caps: CapTable, ctx: CapContext): CapStatus[] {
  const out: CapStatus[] = [];
  for (const k of CAP_ORDER) {
    const rule = caps[k];
    if (!rule) continue;
    const vals = worn.map(it => statValue(it, k));
    const have = rule.rule === 'max' ? Math.max(0, ...vals) : vals.reduce((s, v) => s + Math.max(0, v), 0);
    if (rule.rule === 'max') {
      out.push({ key: k, label: capLabel(k), kind: 'max', have, cap: null, detail: 'the best piece counts; they do not stack' });
      continue;
    }
    let detail: string | null = null;
    if (ATTR_SET.has(k)) {
      const full = attrCapFor(ctx, k);
      const aa = ctx.aa.mods[k] ?? 0;
      detail = `cap ${full}${aa > 0 ? ` (incl. +${aa} from AAs)` : ctx.aa.known ? '' : ' (+AA unknown)'}; ${attrRoom(ctx, k)} of it open to gear`;
    } else if (k === 'manaregen' && rule.rule === 'sum' && rule.cap === 0) {
      detail = `item mana regen is discarded for a ${ctx.base}`;
    } else if (k === 'ac' && rule.rule === 'soft') {
      detail = `soft cap for a ${ctx.base}; item AC only (defense skill and AGI are not counted)`;
    }
    out.push({ key: k, label: capLabel(k), kind: rule.rule, have, cap: rule.cap, detail });
  }
  return out;
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
