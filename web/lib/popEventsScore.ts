// web/lib/popEventsScore.ts — item scores and the event ranking behind /pop/events.
//
// PURE: no database, no Next. The page (web/app/pop/events/load.ts) reads the rows and hands them in; test/pop-events.test.js
// runs this file for real. The stat weights are the gear finder's own (web/lib/gearUpgrades.ts + gearWeights.ts), so a
// retune there re-ranks this page too.
//
// The guild lead, 2026-10-30: "Give item scores to each item and then add a ranking that could be there for each event."
//
// THE SCORE (a class-relative 0 to 100 index, not raw points):
//   raw(item, class)  = scoreItem(item, resolveWeights(class, []), [], capsFor({level 65, base class, High end, no AA}))
//                       for every class that can use the item. A bare call weighs MR as short (gearUpgrades.ts), a
//                       small bias every item shares.
//   index(item, class) = 100 × raw(item, class) ÷ the highest raw(·, class) among ALL items on the page.
//   score(item)        = the best index over the classes that can use it ("best for" lists the top three).
// Why an index: the raw points follow the class tables, not item quality (a Rogue's weights are fatter than a
// Cleric's, so the same-quality melee piece out-scores a caster piece by 30 to 60 points). Normalising each class
// to its own best item on the page cancels that. The raw points of the best class stay in a tooltip so the scale
// can be audited.
// THE EVENT TUNING (the guild lead, 2026-10-30: "count procs and focus effects higher, PLUS ATTACK for melee"): the
// finder's flat +2 per focus and +1 per proc are swapped, on THIS page only, for the bonuses in EVENT_SCORE_TUNING
// below, and a melee class's attack counts double. web/lib/gearWeights.ts and /me/upgrades are untouched; the same
// tuning could go global (move the block into the finder) if the guild lead wants it there too.
// What the score does NOT see (said plainly on the page): the SIZE of a focus or a proc (any focus earns the same
// bonus; so does any proc, a little more on a weapon), a worn effect and a click (flat 1 and 0.5, as in the finder);
// and haste, attack, regen, mana regen and damage shield were back-filled for about 558 items only, so an item the
// back-fill missed scores low.
// An item that cannot be worn (slots 0: a token, a quest item, a pattern, a gem) has no score and adds nothing to
// an event's value; the page lists it under "Other loot".
//
// THE RANKING: value per run = Σ over the event's loot mobs of kills × Σ over their drops of
// (chance ÷ 100 × rolls) × score. `rolls` is the loot table's multiplier (a mob that rolls a drop list twice).
// Also: the best item, how many classes some drop helps (index of 50 or more), and the chance that at least one item
// of index 80 or more drops in a run. The drop list's own limits (droplimit, mindrop) are not in the mirror.

import { CLASS_TIERS, STAT_UNIT, TIEBREAK } from './gearWeights';
import { effectiveValue, resolveWeights, scoreItem, usableByBaseClass, type ItemStats } from './gearUpgrades';
import { capsFor, NO_AA } from './gearCaps';

/** The base classes the finder has weights for, in its table order. */
export const SCORE_CLASSES: string[] = Object.keys(CLASS_TIERS);

/**
 * The event page's own weighting, applied on top of the finder's raw score (all in raw points).
 *
 * Why these numbers: a PoP wearable lands at about 120 to 300 raw points (a typical good item carries ~150 HP, ~30 AC,
 * ~20 of a stat, gearWeights.ts), and the biggest single stat line on one is worth 30 to 70. So a focus is sized like a
 * real stat line (35 for a caster), a weapon proc like the best one (45), and a plain proc just under (30). They are
 * the same for every focus and every proc: the size of the spell is not read (it would need eqemu_spells).
 *   focus   casters: 35 · hybrids (they cast too): 20 · pure melee: 5
 *   proc    melee classes: 30, on a weapon 45 · everyone else: 5
 *   attack  a melee class's +ATK is counted twice (the finder's weight, doubled), under the same 250 cap
 */
export const EVENT_SCORE_TUNING = {
  casters: ['Cleric', 'Druid', 'Shaman', 'Wizard', 'Magician', 'Enchanter', 'Necromancer'],
  hybrids: ['Paladin', 'Shadow Knight', 'Ranger', 'Beastlord', 'Bard'],
  melee: ['Warrior', 'Rogue', 'Monk', 'Ranger', 'Paladin', 'Shadow Knight', 'Bard', 'Beastlord'],
  focus: { caster: 35, hybrid: 20, other: 5 },
  proc: { melee: 30, meleeWeapon: 45, other: 5 },
  attackMultiplier: 2,
};

/** What the tuning adds to one item's raw score for one class, by part (focus and proc replace the finder's flat tie-breaker). */
export type TuningParts = { focus: number; proc: number; attack: number };

const has = (v: number | null | undefined): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isWeapon = (item: ItemStats): boolean => has(item.damage) && has(item.delay);

export function tuningFor(item: ItemStats, cls: string, caps: ReturnType<typeof capsFor>): TuningParts {
  const t = EVENT_SCORE_TUNING;
  const melee = t.melee.includes(cls);
  const parts: TuningParts = { focus: 0, proc: 0, attack: 0 };
  if (has(item.focus_effect)) {
    parts.focus = (t.focus[t.casters.includes(cls) ? 'caster' : t.hybrids.includes(cls) ? 'hybrid' : 'other']) - TIEBREAK.focus;
  }
  if (has(item.proc_effect)) {
    parts.proc = (melee ? (isWeapon(item) ? t.proc.meleeWeapon : t.proc.melee) : t.proc.other) - TIEBREAK.proc;
  }
  if (melee && t.attackMultiplier > 1) {
    const w = resolveWeights(cls, []).attack;
    parts.attack = (t.attackMultiplier - 1) * effectiveValue(item, 'attack', [], caps) * STAT_UNIT.attack * w;
  }
  return parts;
}

/** The tooltip words for what the tuning did ("+35 focus, +45 proc, ATK ×2"); empty when it did nothing. */
export function tuningNotes(item: ItemStats, cls: string): string[] {
  const t = EVENT_SCORE_TUNING;
  const out: string[] = [];
  const p = tuningFor(item, cls, capsOf(cls));
  if (has(item.focus_effect)) out.push(`+${p.focus + TIEBREAK.focus} focus`);
  if (has(item.proc_effect)) out.push(`+${p.proc + TIEBREAK.proc} proc`);
  if (p.attack > 0) out.push(`ATK ×${t.attackMultiplier}`);
  return out;
}

/** An item at or above this index counts as a big drop. */
export const BIG_INDEX = 80;
/** A class counts as helped by an event when some drop's index for it reaches this. */
export const HELPS_INDEX = 50;
/** The level the scores assume: the era cap once Planes of Power is live. */
export const SCORE_LEVEL = 65;

/** The URL token of a class: lower-case, no spaces ('Shadow Knight' → 'shadowknight'). */
export const classToken = (cls: string): string => cls.toLowerCase().replace(/[^a-z]/g, '');
export const classFromToken = (token: string | null | undefined): string | null =>
  SCORE_CLASSES.find(c => classToken(c) === String(token ?? '').toLowerCase()) ?? null;

/** True when the item goes in a worn slot at all. */
export const isWearable = (item: ItemStats): boolean => typeof item.slots === 'number' && item.slots > 0;

export type ItemScore = {
  id: number;
  wearable: boolean;
  /** Raw points per class that can use the item. */
  raw: Record<string, number>;
  /** 0 to 100 per class that can use the item. */
  idx: Record<string, number>;
  /** The highest index (0 when nobody can use it or it is not wearable). */
  best: number;
  /** The raw points of the class with the highest index. */
  bestRaw: number;
  /** Up to three classes with the highest index, best first. */
  top: { cls: string; idx: number }[];
  /** What the event tuning added for the best class ("+35 focus", "+45 proc", "ATK ×2"), for the tooltip. */
  notes: string[];
};

const capsByClass = new Map<string, ReturnType<typeof capsFor>>();
function capsOf(cls: string) {
  let c = capsByClass.get(cls);
  if (!c) { c = capsFor({ level: SCORE_LEVEL, base: cls, attrEnd: 'high', aa: NO_AA }); capsByClass.set(cls, c); }
  return c;
}

/** Raw points of one item for every class that can use it. Empty for an item that cannot be worn. */
export function rawByClass(item: ItemStats): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isWearable(item)) return out;
  for (const cls of SCORE_CLASSES) {
    if (!usableByBaseClass(item, cls)) continue;
    const caps = capsOf(cls);
    const parts = tuningFor(item, cls, caps);
    out[cls] = scoreItem(item, resolveWeights(cls, []), [], caps) + parts.focus + parts.proc + parts.attack;
  }
  return out;
}

/** Score every item against the others in the set: the index is relative to each class's best raw in `items`. */
export function scoreItems(items: ItemStats[]): Map<number, ItemScore> {
  const raws = new Map<number, Record<string, number>>();
  const maxRaw: Record<string, number> = {};
  for (const it of items) {
    const raw = rawByClass(it);
    raws.set(it.id, raw);
    for (const [cls, v] of Object.entries(raw)) if (v > (maxRaw[cls] ?? 0)) maxRaw[cls] = v;
  }
  const out = new Map<number, ItemScore>();
  for (const it of items) {
    const raw = raws.get(it.id) ?? {};
    const idx: Record<string, number> = {};
    for (const [cls, v] of Object.entries(raw)) idx[cls] = maxRaw[cls] > 0 ? Math.max(0, (100 * v) / maxRaw[cls]) : 0;
    const ranked = Object.entries(idx).sort((a, b) => b[1] - a[1] || SCORE_CLASSES.indexOf(a[0]) - SCORE_CLASSES.indexOf(b[0]));
    out.set(it.id, {
      id: it.id,
      wearable: isWearable(it),
      raw,
      idx,
      best: ranked[0]?.[1] ?? 0,
      bestRaw: ranked[0] ? raw[ranked[0][0]] : 0,
      top: ranked.slice(0, 3).map(([cls, v]) => ({ cls, idx: v })),
      notes: ranked[0] ? tuningNotes(it, ranked[0][0]) : [],
    });
  }
  return out;
}

// ── the ranking ──────────────────────────────────────────────────────────────────────────────────────────────────

/** One row of eqemu_npc_drops, the columns the ranking reads. */
export type DropRow = {
  npc_id: number;
  item_id: number;
  item_name: string;
  /** Percent (table probability × item chance). */
  effective_chance: number | null;
  /** The loot table's roll count (null or 0 reads as 1). */
  multiplier: number | null;
};

export type EventLike = { slug: string; npcs: { npcId: number; kills?: number }[] };

export type DropLine = {
  npcId: number;
  itemId: number;
  name: string;
  /** Percent per roll. */
  chance: number;
  rolls: number;
  kills: number;
  /** Expected copies per run: kills × rolls × chance ÷ 100. */
  perRun: number;
  /** The index this line is valued at (the class's index when a class is asked for, else the best). */
  index: number;
  wearable: boolean;
};

export type EventResult = {
  slug: string;
  /** Expected index points per run. */
  value: number;
  best: { itemId: number; name: string; index: number; chance: number } | null;
  /** How many classes have some drop at HELPS_INDEX or more. */
  helps: number;
  /** Chance (0 to 1) that at least one item at BIG_INDEX or more drops in a run. */
  bigOdds: number;
  wearables: number;
  lines: DropLine[];
};

const killsOf = (n: { kills?: number }): number => (typeof n.kills === 'number' && n.kills >= 0 ? n.kills : 1);
const rollsOf = (d: DropRow): number => (d.multiplier && d.multiplier > 0 ? d.multiplier : 1);

/** The index an item is valued at: for one class when `cls` is set (0 if that class cannot use it), else its best. */
export function indexFor(score: ItemScore | undefined, cls?: string | null): number {
  if (!score || !score.wearable) return 0;
  return cls ? score.idx[cls] ?? 0 : score.best;
}

export function evaluateEvent(
  ev: EventLike,
  drops: ReadonlyMap<number, readonly DropRow[]>,
  scores: ReadonlyMap<number, ItemScore>,
  cls?: string | null,
): EventResult {
  const lines: DropLine[] = [];
  let value = 0;
  let missBig = 1;                       // probability that NO big item drops
  let best: EventResult['best'] = null;
  const helped = new Set<string>();
  for (const npc of ev.npcs) {
    const kills = killsOf(npc);
    for (const d of drops.get(npc.npcId) ?? []) {
      const sc = scores.get(d.item_id);
      const wearable = !!sc?.wearable;
      const chance = Math.max(0, d.effective_chance ?? 0);
      const rolls = rollsOf(d);
      const perRun = (kills * rolls * chance) / 100;
      const index = indexFor(sc, cls);
      lines.push({ npcId: npc.npcId, itemId: d.item_id, name: d.item_name, chance, rolls, kills, perRun, index, wearable });
      if (!wearable) continue;
      value += perRun * index;
      if (index > 0 && (!best || index > best.index || (index === best.index && chance > best.chance))) {
        best = { itemId: d.item_id, name: d.item_name, index, chance };
      }
      if (index >= BIG_INDEX) missBig *= Math.pow(1 - Math.min(1, chance / 100), kills * rolls);
      for (const [c, v] of Object.entries(sc!.idx)) if (v >= HELPS_INDEX) helped.add(c);
    }
  }
  return {
    slug: ev.slug, value, best, helps: helped.size, bigOdds: 1 - missBig,
    wearables: lines.filter(l => l.wearable).length, lines,
  };
}

export type SortKey = 'value' | 'best' | 'breadth' | 'big';
export const SORT_KEYS: SortKey[] = ['value', 'best', 'breadth', 'big'];
export const sortFromParam = (v: string | null | undefined): SortKey => (SORT_KEYS as string[]).includes(String(v)) ? (v as SortKey) : 'value';

/** Every event evaluated and ordered; ties fall back to value, then slug, so the order never shuffles. */
export function rankEvents(
  events: readonly EventLike[],
  drops: ReadonlyMap<number, readonly DropRow[]>,
  scores: ReadonlyMap<number, ItemScore>,
  opts: { cls?: string | null; sort?: SortKey } = {},
): EventResult[] {
  const sort = opts.sort ?? 'value';
  const primary = (r: EventResult): number =>
    sort === 'best' ? r.best?.index ?? 0 : sort === 'breadth' ? r.helps : sort === 'big' ? r.bigOdds : r.value;
  return events
    .map(e => evaluateEvent(e, drops, scores, opts.cls))
    .sort((a, b) => primary(b) - primary(a) || b.value - a.value || a.slug.localeCompare(b.slug));
}

// ── the guild's price for an item ────────────────────────────────────────────────────────────────────────────────

export type DkpSummary = { avg: number; n: number };

/** Average DKP paid and the number of awards, by lower-cased item name (the lookup raidGuide.attributeLoot uses). */
export function dkpByName(rows: readonly { item_name: string | null; dkp: number | null }[]): Map<string, DkpSummary> {
  const acc = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    if (!r.item_name) continue;
    const k = r.item_name.toLowerCase();
    const cur = acc.get(k) ?? { sum: 0, n: 0 };
    cur.sum += Number(r.dkp) || 0;
    cur.n += 1;
    acc.set(k, cur);
  }
  return new Map([...acc].map(([k, v]) => [k, { avg: Math.round(v.sum / v.n), n: v.n }]));
}
