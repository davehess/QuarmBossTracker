// web/lib/gearSets.ts — sets built from the gear a character already OWNS, and the try-on maths (the gear page,
// /character/<name>/gear; the guild lead, 2026-10-31: "build in variation for gear and automatic comparisons via
// the gear page", picked "C then A"; DECISIONS §480).
//
// PURE: no database, no Next, safe in a client bundle. web/lib/gearSetsLoad.ts reads the rows and hands them in.
//
// C — three automatic sets, each compared with what is worn: Most mitigation (AC and HP), Most damage (a melee
// class: ATK, haste and weapon damage per delay; a caster: mana, mana regen and the casting stat, named "Most
// mana / focus"), Best resists. Items come from the bags and the bank, plus what is already worn (an earring
// can move between the two ear slots). A piece must fit the slot, the class, the race and the level cap, and the
// stat caps are judged exactly as the upgrade finder judges them (gearUpgrades.effectiveValue + gearCaps), so a
// point past a cap counts for nothing and the card says so.
// A — try-on: the same eligibility, one list per slot, and the change in every stat for whatever is picked.
//
// The weapon rule is the finder's: a weapon slot only takes the same weapon type as the one wielded now, and an
// empty weapon slot takes no weapon (nothing here knows which weapon skills a class has). A two-hander never
// shares a hand set with a secondary. Behaviour tests: test/gear-sets.test.js.

import {
  fitsSlot, raceBit, resolveWeights, effectiveValue, scoredClass, statValue, usableByBaseClass, usableByRace,
  UPGRADE_SLOTS, type Equipped, type ItemStats,
} from './gearUpgrades';
import {
  CLASS_TIERS, MIN_GAIN, STAT_KEYS, STAT_LABEL, STAT_UNIT, TIEBREAK, type CapTable, type StatKey,
} from './gearWeights';

export type Where = 'worn' | 'bag' | 'bank';
export type OwnedWhere = 'bag' | 'bank';

/** An owned item that is not worn: where it sits and how many copies. */
export type OwnedItem = { item: ItemStats; where: OwnedWhere; count: number };

/** A stack of one item id, before the catalog row is attached. */
export type OwnedStack = { id: number; where: OwnedWhere; count: number };

export type StatMap = Partial<Record<StatKey, number>>;

const n = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** itemtype of the two-handed weapons: 2H slashing, 2H blunt, 2H piercing. */
export const TWO_HAND_TYPES = new Set([1, 4, 35]);
export const isTwoHand = (it: ItemStats | null | undefined): boolean => !!it && TWO_HAND_TYPES.has(it.itemtype as number);
const isWeapon = (it: ItemStats): boolean => n(it.damage) > 0 && n(it.delay) > 0;
const WEAPON_SLOTS = new Set(['Primary', 'Secondary', 'Range']);

// ── what the character owns ───────────────────────────────────────────────────────────────────────────────────

/**
 * Turn the two row sources into stacks. The gear export lists the carried bags (character_gear loc 'bag') and the
 * inventory export lists them again (General*) plus the bank (Bank*, SharedBank*): the same physical item sits in
 * both, so the bag count of an id is the LARGER of the two sources, never their sum; bank rows only exist in the
 * inventory export and are summed. Equipped labels and anything else are not "owned and spare".
 */
export function ownedFromRows(
  gearBag: { item_id: number; count: number | null }[],
  inv: { slot_label: string; item_id: number | null; quantity: number | null }[],
): OwnedStack[] {
  const gear = new Map<number, number>();
  for (const g of gearBag) gear.set(g.item_id, (gear.get(g.item_id) ?? 0) + Math.max(1, n(g.count)));
  const invBag = new Map<number, number>();
  const bank = new Map<number, number>();
  for (const r of inv) {
    if (r.item_id == null || r.item_id <= 0) continue;
    const q = Math.max(1, n(r.quantity));
    if (/^General\d/.test(r.slot_label)) invBag.set(r.item_id, (invBag.get(r.item_id) ?? 0) + q);
    else if (/^(Bank|SharedBank)\d/.test(r.slot_label)) bank.set(r.item_id, (bank.get(r.item_id) ?? 0) + q);
  }
  const out: OwnedStack[] = [];
  for (const id of new Set([...gear.keys(), ...invBag.keys()])) {
    out.push({ id, where: 'bag', count: Math.max(gear.get(id) ?? 0, invBag.get(id) ?? 0) });
  }
  for (const [id, count] of bank) out.push({ id, where: 'bank', count });
  return out;
}

// ── stat totals and the change between two sets ───────────────────────────────────────────────────────────────

/** An item's stats as a plain map of the scored keys it carries (what the try-on ships to the browser). */
export function statsOf(item: ItemStats): StatMap {
  const m: StatMap = {};
  for (const k of STAT_KEYS) { const v = statValue(item, k); if (v) m[k] = v; }
  return m;
}

export type Placed = { slot: string; stats: StatMap };

/** The worn total of one stat: `raw` as the items read, `eff` after the cap (a capped point counts for nothing). */
function totalOf(placed: Placed[], key: StatKey, caps: CapTable): { raw: number; eff: number } {
  const vals = placed.map(p => p.stats[key] ?? 0);
  const pos = vals.reduce((s, v) => s + Math.max(0, v), 0);
  const neg = vals.reduce((s, v) => s + Math.min(0, v), 0);
  const cap = caps[key];
  if (cap && cap.rule === 'max') { const best = Math.max(0, ...vals); return { raw: best, eff: best }; }
  const raw = pos + neg;
  if (!cap) return { raw, eff: raw };
  if (cap.rule === 'soft') {
    const below = Math.min(pos, cap.cap);
    return { raw, eff: below + (pos - below) / cap.returns + neg };
  }
  return { raw, eff: Math.min(pos, cap.cap) + (cap.keepNegative ? neg : 0) };
}

export type StatDelta = {
  key: StatKey;
  label: string;
  raw: number;                       // the change as the items read
  eff: number;                       // the change that lands under the cap
  wasted: number;                    // raw − eff when a cap throws points away, else 0
  cap: 'hard' | 'soft' | null;
};

/** The change from `before` to `after` for each key; a key that does not move is left out. */
export function setDeltas(before: Placed[], after: Placed[], keys: StatKey[], caps: CapTable): StatDelta[] {
  const out: StatDelta[] = [];
  for (const key of keys) {
    const b = totalOf(before, key, caps);
    const a = totalOf(after, key, caps);
    const raw = a.raw - b.raw;
    const eff = a.eff - b.eff;
    if (Math.abs(raw) < 1e-9 && Math.abs(eff) < 1e-9) continue;
    const places = key === 'dmgRatio' ? 100 : 10;
    const r = (v: number) => Math.round(v * places) / places;
    const rule = caps[key]?.rule;
    const wasted = Math.max(0, r(raw - eff));
    out.push({
      key, label: STAT_LABEL[key], raw: r(raw), eff: r(eff), wasted,
      cap: wasted > 0 && (rule === 'sum' || rule === 'soft') ? (rule === 'soft' ? 'soft' : 'hard') : null,
    });
  }
  return out;
}

/** "AC +56", "Haste +10%", "Dmg/delay -0.12". */
export function deltaText(d: StatDelta): string {
  const sign = d.raw > 0 ? '+' : '';
  return `${d.label} ${sign}${d.raw}${d.key === 'haste' ? '%' : ''}`;
}

/** "STR at cap: +5 wasted", "AC past the soft cap: only +30 of +56 counts"; null when no cap bites. */
export function capNote(d: StatDelta): string | null {
  if (d.cap === 'hard') return `${d.label} at cap: +${d.wasted} wasted`;
  if (d.cap === 'soft') return `${d.label} past the soft cap: only +${d.eff} of +${d.raw} counts`;
  return null;
}

// ── the three objectives ──────────────────────────────────────────────────────────────────────────────────────

export type SetObjectiveId = 'mitigation' | 'damage' | 'resists';

export type Objective = {
  id: SetObjectiveId;
  title: string;
  blurb: string;
  keys: StatKey[];
  weights: Partial<Record<StatKey, number>>;
  focus: boolean;                    // a focus effect earns the small flat bonus (casters only)
};

/** A class whose mana is "crit" in the finder's table is a caster; every other class swings. */
export const isCasterClass = (base: string): boolean => CLASS_TIERS[base]?.mana === 'crit';

const MELEE_KEYS: StatKey[] = ['attack', 'haste', 'dmgRatio'];
const CASTER_KEYS: StatKey[] = ['mana', 'manaregen', 'wis', 'intel', 'cha'];
const RESIST_KEYS: StatKey[] = ['mr', 'cr', 'dr', 'fr', 'pr'];

/** The objectives for a class. The class's own weights order the damage / mana stats; AC and HP, and the resists, are even. */
export function objectivesFor(base: string, weights: Record<StatKey, number>): Objective[] {
  const caster = isCasterClass(base);
  const pick = (keys: StatKey[]) => Object.fromEntries(keys.map(k => [k, weights[k]])) as Partial<Record<StatKey, number>>;
  const even = (keys: StatKey[]) => Object.fromEntries(keys.map(k => [k, 1])) as Partial<Record<StatKey, number>>;
  const keys = caster ? CASTER_KEYS : MELEE_KEYS;
  return [
    {
      id: 'mitigation', title: 'Most mitigation', blurb: 'AC and HP first.',
      keys: ['ac', 'hp'], weights: even(['ac', 'hp']), focus: false,
    },
    caster
      ? {
        id: 'damage', title: 'Most mana / focus', blurb: 'Mana, mana regen and your casting stat, with a focus effect as the tie-break.',
        keys, weights: pick(keys), focus: true,
      }
      : {
        id: 'damage', title: 'Most damage', blurb: 'Attack, haste and weapon damage per delay.',
        keys, weights: pick(keys), focus: false,
      },
    {
      id: 'resists', title: 'Best resists', blurb: 'MR, FR, CR, DR and PR together, up to the resist cap.',
      keys: RESIST_KEYS, weights: even(RESIST_KEYS), focus: false,
    },
  ];
}

// ── eligibility ───────────────────────────────────────────────────────────────────────────────────────────────

type Ctx = { base: string; rbit: number; levelCap: number };
type Slot = (typeof UPGRADE_SLOTS)[number];

/** Can this item be worn in the slot by this character, given what is wielded there now (the weapon rule)? */
function eligibleFor(item: ItemStats, slot: Slot, current: ItemStats | null, ctx: Ctx): boolean {
  if (item.slots == null || item.slots <= 0) return false;
  if (n(item.required_level) > ctx.levelCap) return false;
  if (!usableByBaseClass(item, ctx.base) || !usableByRace(item, ctx.rbit)) return false;
  if (!fitsSlot(item, slot)) return false;
  if (WEAPON_SLOTS.has(slot.name)) {
    if (current) { if (item.itemtype !== current.itemtype) return false; }
    else if (isWeapon(item)) return false;
  }
  return true;
}

function slotScore(item: ItemStats, slot: string, obj: Objective, others: ItemStats[], caps: CapTable): number {
  let s = 0;
  for (const k of obj.keys) {
    const w = obj.weights[k] ?? 0;
    if (!w) continue;
    s += effectiveValue(item, k, others, caps) * STAT_UNIT[k] * w;
  }
  if (obj.focus && n(item.focus_effect) > 0) s += TIEBREAK.focus;
  return s;
}

// ── building the sets ─────────────────────────────────────────────────────────────────────────────────────────

export type SetsInput = {
  className: string | null | undefined;
  race?: string | null;
  equipped: Equipped[];              // what is worn, by character_gear slot name
  owned: OwnedItem[];                // bags and bank, not worn
  loreIds?: Set<number>;             // item ids that are lore: one copy, whatever the stack says
  levelCap: number;
  caps: CapTable;                    // the character's own cap rules (gearCaps.capsFor)
};

export type SetSwap = {
  slot: string;
  from: ItemStats | null;
  to: ItemStats;
  where: Where;                      // the copy you have to fetch: worn (it only moves), bag, or bank
  movedFrom: string | null;          // worn → the slot it comes out of
};

export type SetCard = {
  id: SetObjectiveId;
  title: string;
  blurb: string;
  swaps: SetSwap[];
  deltas: StatDelta[];               // the whole set against what is worn, for the objective's stats
};

/** A card's picks as plain data for the try-on (and the shared link). */
export type TryItem = {
  id: number;
  name: string;
  icon: number | null;
  where: Where;
  copies: number;                    // how many slots can hold it at once (1 for lore)
  twoHand: boolean;
  stats: StatMap;
};

export type TrySlot = { slot: string; wornId: number | null; options: number[] };

export type TryData = {
  caps: CapTable;
  weights: Partial<Record<StatKey, number>>;   // the class's tiers, to order the changes
  worn: { slot: string; id: number }[];
  slots: TrySlot[];                  // only the slots with something to try
  items: Record<number, TryItem>;    // every item a slot lists, and everything worn
};

export type SetsResult = { base: string; cards: SetCard[]; tryOn: TryData };

type Info = { item: ItemStats; ownedWhere: OwnedWhere | null; copies: number; wornCopies: number };

const label = (it: ItemStats) => it.name ?? `Item #${it.id}`;

/**
 * Build the three sets and the try-on data. Returns null for a class with no weights or a character with nothing worn.
 *
 * ponytail: greedy, one slot at a time, up to three passes from the worn set, so every move is a real gain under
 * the caps AS THEY STAND at that moment. It is not a global optimum: two pieces that only pay off together (a
 * lone +ATK piece that would be the first to fill the cap) can be missed. Fine for the dozen pieces a member owns
 * per slot; the ceiling is a handful of owned items per slot, past which an exact search (or a knapsack over
 * the cap) would be needed.
 */
export function buildSets(input: SetsInput): SetsResult | null {
  const base = scoredClass(input.className);
  if (!base) return null;
  const ctx: Ctx = { base, rbit: raceBit(input.race), levelCap: input.levelCap };
  const lore = input.loreIds ?? new Set<number>();

  const worn = new Map<string, ItemStats>();
  for (const e of input.equipped) {
    if (UPGRADE_SLOTS.some(s => s.name === e.slot) && !worn.has(e.slot)) worn.set(e.slot, e.item);
  }
  if (worn.size === 0) return null;

  const info = new Map<number, Info>();
  const touch = (item: ItemStats): Info => {
    let i = info.get(item.id);
    if (!i) { i = { item, ownedWhere: null, copies: 0, wornCopies: 0 }; info.set(item.id, i); }
    return i;
  };
  for (const it of worn.values()) { const i = touch(it); i.copies += 1; i.wornCopies += 1; }
  for (const o of input.owned) {
    const i = touch(o.item);
    i.copies += Math.max(1, o.count);
    // a copy in the bags is the easier one to fetch
    if (i.ownedWhere !== 'bag') i.ownedWhere = o.where;
  }
  for (const i of info.values()) if (lore.has(i.item.id)) i.copies = 1;

  const wornItems = [...worn.values()];
  const weights = resolveWeights(base, wornItems);
  const objectives = objectivesFor(base, weights);
  const wornPlaced: Placed[] = [...worn].map(([slot, it]) => ({ slot, stats: statsOf(it) }));

  const cards: SetCard[] = objectives.map(obj => {
    const work = new Map(worn);
    const used = (id: number, except: string) =>
      [...work].filter(([s, it]) => s !== except && it.id === id).length;
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (const slot of UPGRADE_SLOTS) {
        const cur = work.get(slot.name) ?? null;
        const origin = worn.get(slot.name) ?? null;
        const others = [...work].filter(([s]) => s !== slot.name).map(([, it]) => it);
        const curScore = cur ? slotScore(cur, slot.name, obj, others, input.caps) : 0;
        const needed = curScore + MIN_GAIN - 1e-9;       // a swap has to gain at least MIN_GAIN, like an upgrade
        let best: ItemStats | null = null;
        let bestScore = needed;
        for (const { item, copies } of info.values()) {
          if (cur && item.id === cur.id) continue;
          if (!eligibleFor(item, slot, origin, ctx)) continue;
          if (used(item.id, slot.name) >= copies) continue;           // lore, or every copy is already placed
          if (slot.name === 'Secondary' && isTwoHand(work.get('Primary'))) continue;
          if (slot.name === 'Primary' && isTwoHand(item) && work.get('Secondary')) continue;
          const score = slotScore(item, slot.name, obj, others, input.caps);
          if (score < needed) continue;
          if (!best || score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && item.id < best.id)) {
            best = item; bestScore = score;
          }
        }
        if (best) { work.set(slot.name, best); changed = true; }
      }
      if (!changed) break;
    }

    const swaps: SetSwap[] = [];
    const placedAfter: Placed[] = [];
    for (const slot of UPGRADE_SLOTS) {
      const now = work.get(slot.name) ?? null;
      if (now) placedAfter.push({ slot: slot.name, stats: statsOf(now) });
      const was = worn.get(slot.name) ?? null;
      if (!now || (was && was.id === now.id)) continue;
      const i = info.get(now.id)!;
      const finalUse = [...work.values()].filter(it => it.id === now.id).length;
      const fromWorn = i.wornCopies > 0 && finalUse <= i.wornCopies;
      const movedFrom = fromWorn
        ? ([...worn].find(([s, it]) => it.id === now.id && work.get(s)?.id !== now.id)?.[0] ?? null)
        : null;
      swaps.push({
        slot: slot.name, from: was, to: i.item,
        where: fromWorn ? 'worn' : (i.ownedWhere ?? 'bag'), movedFrom,
      });
    }
    return {
      id: obj.id, title: obj.title, blurb: obj.blurb, swaps,
      deltas: setDeltas(wornPlaced, placedAfter, obj.keys, input.caps),
    };
  });

  // ── the try-on lists ──
  const items: Record<number, TryItem> = {};
  const addItem = (i: Info) => {
    if (items[i.item.id]) return;
    const wornOnly = i.ownedWhere == null;
    items[i.item.id] = {
      id: i.item.id, name: label(i.item), icon: i.item.icon ?? null,
      where: wornOnly ? 'worn' : (i.ownedWhere as OwnedWhere), copies: i.copies,
      twoHand: isTwoHand(i.item), stats: statsOf(i.item),
    };
  };
  const slots: TrySlot[] = [];
  for (const slot of UPGRADE_SLOTS) {
    const cur = worn.get(slot.name) ?? null;
    const options = [...info.values()]
      .filter(i => (!cur || i.item.id !== cur.id) && eligibleFor(i.item, slot, cur, ctx))
      .sort((a, b) => label(a.item).localeCompare(label(b.item)) || a.item.id - b.item.id);
    if (options.length === 0) continue;
    for (const o of options) addItem(o);
    if (cur) addItem(info.get(cur.id)!);
    slots.push({ slot: slot.name, wornId: cur?.id ?? null, options: options.map(o => o.item.id) });
  }
  for (const it of worn.values()) addItem(info.get(it.id)!);

  return {
    base, cards,
    tryOn: {
      caps: input.caps, weights,
      worn: [...worn].map(([slot, it]) => ({ slot, id: it.id })),
      slots, items,
    },
  };
}

// ── try-on: the shared link and the checks ────────────────────────────────────────────────────────────────────

/** `Head:12345,Waist:6789` → { Head: 12345, Waist: 6789 }, keeping only picks the data actually lists for that slot. */
export function parseTry(raw: string | null | undefined, data: TryData): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  for (const part of String(raw).slice(0, 2000).split(',')) {
    const m = /^([A-Za-z0-9]+):(\d+)$/.exec(part.trim());
    if (!m) continue;
    const id = Number(m[2]);
    const slot = data.slots.find(s => s.slot === m[1]);
    if (slot && slot.options.includes(id)) out[slot.slot] = id;
  }
  return out;
}

/** The query value for a set of picks, in slot order, so the same picks always give the same link. */
export function serializeTry(sel: Record<string, number>, data: TryData): string {
  return data.slots.filter(s => sel[s.slot] != null).map(s => `${s.slot}:${sel[s.slot]}`).join(',');
}

/** The worn set with the picks swapped in, as the maths reads it. */
export function placedWith(data: TryData, sel: Record<string, number>): { before: Placed[]; after: Placed[]; ids: Map<string, number> } {
  const ids = new Map<string, number>();
  for (const w of data.worn) ids.set(w.slot, w.id);
  const before: Placed[] = data.worn.map(w => ({ slot: w.slot, stats: data.items[w.id]?.stats ?? {} }));
  for (const [slot, id] of Object.entries(sel)) ids.set(slot, id);
  const after: Placed[] = [...ids].map(([slot, id]) => ({ slot, stats: data.items[id]?.stats ?? {} }));
  return { before, after, ids };
}

/** Things the picks cannot do in the game: one copy in two slots, a two-hander beside a secondary. */
export function tryWarnings(data: TryData, sel: Record<string, number>): string[] {
  const { ids } = placedWith(data, sel);
  const out: string[] = [];
  const count = new Map<number, number>();
  for (const id of ids.values()) count.set(id, (count.get(id) ?? 0) + 1);
  for (const [id, c] of count) {
    const it = data.items[id];
    if (it && c > it.copies) out.push(`${it.name} is in ${c} slots but you have ${it.copies === 1 ? 'one copy (or it is lore)' : `${it.copies} copies`}.`);
  }
  const primary = ids.get('Primary');
  if (primary != null && data.items[primary]?.twoHand && ids.get('Secondary') != null) {
    out.push(`${data.items[primary].name} is two-handed: the secondary slot has to stay empty.`);
  }
  return out;
}
