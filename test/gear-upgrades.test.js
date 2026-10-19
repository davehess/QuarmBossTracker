// test/gear-upgrades.test.js — the gear upgrade finder (/me/upgrades; DECISIONS §383, companion gap §94).
//
// The scoring is pure (web/lib/gearUpgrades.ts + the tuning table web/lib/gearWeights.ts), so these are BEHAVIOUR
// tests: build items, rank, assert what is suggested. Two source-text checks hold the privacy contract (the
// opt-out is decided before any gear is read; the wishlist read never selects a bid column), with comments
// stripped first (stripJs) so a header that names the thing cannot answer for the code.
//
// Run: npx vitest run test/gear-upgrades.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  rankUpgrades, selectTop, candidateIds, scoreItem, resolveWeights, effectiveValue, diffStats, scoredClass,
  fitsSlot, raceBit, levelCap, expansionCap, isEraExpansion, isOptedOut, UPGRADE_SLOTS,
} from '../web/lib/gearUpgrades.ts';
import {
  CLASS_TIERS, BASE_TIERS, TIER_POINTS, STAT_KEYS, CAPS, MIN_GAIN, TOP_N, POOL_DEPTH,
} from '../web/lib/gearWeights.ts';
import { metaForPath } from '../web/lib/pageMeta.ts';

const read = (...p) => stripJs(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));

const ALL = 32767;                 // every class
const bit = (b) => 2 ** b;         // a slot's mask bit (WORN_SLOTS: Ear1 = 1, Head = 2, ... Chest = 17, Waist = 20)
const SLOT = Object.fromEntries(UPGRADE_SLOTS.map(s => [s.name, s]));

let nextId = 1000;
const item = (o = {}) => ({
  id: nextId++, name: null, slots: bit(17), classes: ALL, races: 16383, required_level: 0, itemtype: 10,
  ac: null, hp: null, mana: null, damage: null, delay: null,
  str: null, sta: null, agi: null, dex: null, wis: null, intel: null, cha: null,
  mr: null, cr: null, dr: null, fr: null, pr: null,
  attack: null, haste: null, regen: null, manaregen: null, damageshield: null,
  focus_effect: null, worneffect: null, proc_effect: null, clickeffect: null,
  ...o,
});

describe('the weight table', () => {
  it('covers all fifteen classes, with valid tiers and real stats', () => {
    expect(Object.keys(CLASS_TIERS).sort()).toEqual([
      'Bard', 'Beastlord', 'Cleric', 'Druid', 'Enchanter', 'Magician', 'Monk', 'Necromancer', 'Paladin',
      'Ranger', 'Rogue', 'Shadow Knight', 'Shaman', 'Warrior', 'Wizard',
    ]);
    for (const [cls, tiers] of Object.entries(CLASS_TIERS)) {
      for (const [stat, tier] of Object.entries(tiers)) {
        expect(STAT_KEYS, `${cls}.${stat}`).toContain(stat);
        expect(TIER_POINTS[tier], `${cls}.${stat} tier`).toBeDefined();
      }
    }
    for (const k of STAT_KEYS) expect(BASE_TIERS[k]).toBeDefined();
  });
  it('scoredClass folds level titles to base classes and refuses what it cannot weigh', () => {
    expect(scoredClass('Shadow Knight')).toBe('Shadow Knight');
    expect(scoredClass('Unknown')).toBeNull();
    expect(scoredClass(null)).toBeNull();
  });
});

describe('scoring is per class', () => {
  const tank = item({ ac: 40, hp: 60 });
  const mana = item({ mana: 150, hp: 20, wis: 20, manaregen: 3 });
  it('a warrior prefers AC and a cleric prefers mana', () => {
    const wWar = resolveWeights('Warrior', []);
    const wClr = resolveWeights('Cleric', []);
    expect(scoreItem(tank, wWar, [])).toBeGreaterThan(scoreItem(mana, wWar, []));
    expect(scoreItem(mana, wClr, [])).toBeGreaterThan(scoreItem(tank, wClr, []));
  });
  it('a focus effect breaks a tie between otherwise identical items, and never outweighs a real stat', () => {
    const w = resolveWeights('Cleric', []);
    const plain = item({ mana: 100 });
    const focused = item({ mana: 100, focus_effect: 77 });
    expect(scoreItem(focused, w, [])).toBeGreaterThan(scoreItem(plain, w, []));
    expect(scoreItem(item({ mana: 110 }), w, [])).toBeGreaterThan(scoreItem(focused, w, []));
  });
  it('weapon damage per delay counts for a rogue and not for a wizard', () => {
    const blade = item({ slots: bit(13) | bit(14), damage: 30, delay: 20 });
    expect(scoreItem(blade, resolveWeights('Rogue', []), [])).toBeGreaterThan(10);
    expect(scoreItem(blade, resolveWeights('Wizard', []), [])).toBe(0);
  });
});

describe('the cap rules', () => {
  const w = resolveWeights('Warrior', []);
  it('worn +ATK shares one 250 ceiling', () => {
    const cand = item({ attack: 50 });
    const rest = [item({ attack: 250 })];
    expect(effectiveValue(cand, 'attack', [])).toBe(50);
    expect(effectiveValue(cand, 'attack', rest)).toBe(0);
    expect(effectiveValue(cand, 'attack', [item({ attack: 220 })])).toBe(30);
    expect(CAPS.attack).toEqual({ rule: 'sum', cap: 250 });
    expect(scoreItem(cand, w, rest)).toBe(0);
    expect(scoreItem(cand, w, [])).toBeGreaterThan(0);
  });
  it('haste does not stack: only the margin over the best other piece counts', () => {
    const cand = item({ haste: 30 });
    expect(effectiveValue(cand, 'haste', [])).toBe(30);
    expect(effectiveValue(cand, 'haste', [item({ haste: 28 })])).toBe(2);
    expect(effectiveValue(cand, 'haste', [item({ haste: 30 })])).toBe(0);
    expect(effectiveValue(cand, 'haste', [item({ haste: 41 })])).toBe(0);
  });
  it('mana regen sums to its ceiling', () => {
    expect(effectiveValue(item({ manaregen: 10 }), 'manaregen', [item({ manaregen: 9 })])).toBe(6);
    expect(effectiveValue(item({ manaregen: 10 }), 'manaregen', [item({ manaregen: 15 })])).toBe(0);
  });
  it('magic resist is worth more while the worn set is under the raid floor, and no more once it is over', () => {
    const wUnder = resolveWeights('Wizard', [item({ mr: 20 })]);
    const wOver = resolveWeights('Wizard', [item({ mr: 100 })]);
    const ring = item({ mr: 15 });
    expect(wUnder.mr).toBeGreaterThan(wOver.mr);
    expect(scoreItem(ring, wUnder, [])).toBeGreaterThan(scoreItem(ring, wOver, []));
  });
  it('a swap that is limited by a cap says so in its diff', () => {
    const cur = item({ attack: 10 });
    const cand = item({ attack: 50 });
    const rest = [item({ attack: 220 })];            // room for 30 only
    const d = diffStats(cand, cur, resolveWeights('Warrior', rest), rest).find(x => x.key === 'attack');
    expect(d.diff).toBe(20);                         // 30 effective − 10 effective
    expect(d.capped).toBe(true);
  });
});

describe('ranking upgrades for a slot', () => {
  const chest = (o) => item({ slots: bit(17), ...o });
  const worn = (slot, it) => ({ slot, item: it });
  const base = { className: 'Cleric', race: 'Human', levelCap: 65 };

  it('lists better items best first, and nothing at or below the current item', () => {
    const cur = chest({ hp: 50, mana: 50 });
    const better = chest({ hp: 80, mana: 120 });
    const best = chest({ hp: 100, mana: 200 });
    const worse = chest({ hp: 10, mana: 10 });
    const res = rankUpgrades({ ...base, equipped: [worn('Chest', cur)], pool: [worse, better, best] });
    const r = res.find(x => x.slot === 'Chest');
    expect(r.candidates.map(c => c.item.id)).toEqual([best.id, better.id]);
    expect(r.candidates[0].gain).toBeGreaterThan(r.candidates[1].gain);
    expect(r.currentScore).toBeGreaterThan(0);
  });
  it('an empty slot is filled by the best item for it', () => {
    const res = rankUpgrades({ ...base, equipped: [worn('Head', item({ slots: bit(2), hp: 10 }))], pool: [chest({ hp: 80, mana: 80 })] });
    const r = res.find(x => x.slot === 'Chest');
    expect(r.current).toBeNull();
    expect(r.candidates).toHaveLength(1);
  });
  it('respects the class, the race and the level cap', () => {
    const warriorOnly = chest({ hp: 200, classes: 1 });
    const trollOnly = chest({ hp: 200, races: 256 });
    const tooHigh = chest({ hp: 200, required_level: 66 });
    const fine = chest({ hp: 150, required_level: 65 });
    const res = rankUpgrades({ ...base, equipped: [worn('Chest', chest({ hp: 1 }))], pool: [warriorOnly, trollOnly, tooHigh, fine] });
    expect(res.find(x => x.slot === 'Chest').candidates.map(c => c.item.id)).toEqual([fine.id]);
    // an unknown race excludes nothing
    const noRace = rankUpgrades({ ...base, race: 'UNKNOWN', equipped: [worn('Chest', chest({ hp: 1 }))], pool: [trollOnly] });
    expect(noRace.find(x => x.slot === 'Chest').candidates).toHaveLength(1);
    expect(raceBit('Half-Elf')).toBe(64);
    expect(raceBit('Vah Shir')).toBe(8192);
  });
  it('only suggests an item that fits the slot (a ring is not a chest piece)', () => {
    const ring = item({ slots: bit(15) | bit(16), hp: 500 });
    const res = rankUpgrades({ ...base, equipped: [worn('Chest', chest({ hp: 1 }))], pool: [ring] });
    expect(res.find(x => x.slot === 'Chest').candidates).toHaveLength(0);
    expect(res.find(x => x.slot === 'Fingers1').candidates).toHaveLength(1);
    expect(fitsSlot(ring, SLOT.Fingers2)).toBe(true);
    expect(fitsSlot(ring, SLOT.Chest)).toBe(false);
  });
  it('does not suggest what is already worn, nor anything under the minimum gain', () => {
    const cur = chest({ hp: 100 });
    const ear = item({ slots: bit(1) | bit(4), hp: 100 });
    const tiny = chest({ hp: 100, focus_effect: null, mana: 0, ac: 0, str: 1 });   // cleric weighs STR at 0
    const res = rankUpgrades({ ...base, equipped: [worn('Chest', cur), worn('Ear1', ear)], pool: [ear, tiny] });
    expect(res.find(x => x.slot === 'Ear2').candidates).toHaveLength(0);           // the same ear item, already worn
    expect(res.find(x => x.slot === 'Chest').candidates).toHaveLength(0);
    expect(MIN_GAIN).toBeGreaterThan(0);
  });
  it('credits attack only up to the room the rest of the worn set leaves', () => {
    const atkGear = item({ slots: bit(2), attack: 250 });
    const cur = chest({ hp: 10 });
    const piece = chest({ hp: 10, attack: 80 });
    const noRoom = rankUpgrades({ className: 'Warrior', race: 'Human', levelCap: 65, equipped: [worn('Head', atkGear), worn('Chest', cur)], pool: [piece] });
    expect(noRoom.find(x => x.slot === 'Chest').candidates).toHaveLength(0);
    const room = rankUpgrades({ className: 'Warrior', race: 'Human', levelCap: 65, equipped: [worn('Head', item({ slots: bit(2), attack: 100 })), worn('Chest', cur)], pool: [piece] });
    expect(room.find(x => x.slot === 'Chest').candidates).toHaveLength(1);
  });
  it('weapons are like for like: same weapon type, and nothing for an empty hand', () => {
    const cur = item({ slots: bit(13) | bit(14), itemtype: 0, damage: 20, delay: 25 });
    const sameType = item({ slots: bit(13) | bit(14), itemtype: 0, damage: 30, delay: 25 });
    const twoHander = item({ slots: bit(13), itemtype: 1, damage: 60, delay: 40 });
    const res = rankUpgrades({ className: 'Warrior', race: 'Human', levelCap: 65, equipped: [worn('Primary', cur)], pool: [sameType, twoHander] });
    expect(res.find(x => x.slot === 'Primary').candidates.map(c => c.item.id)).toEqual([sameType.id]);
    const sec = res.find(x => x.slot === 'Secondary');
    expect(sec.candidates).toHaveLength(0);
    expect(sec.note).toMatch(/like for like/);
  });
  it('returns null for a class it has no weights for', () => {
    expect(rankUpgrades({ className: 'Unknown', race: 'Human', levelCap: 65, equipped: [], pool: [] })).toBeNull();
  });
  it('keeps at most POOL_DEPTH candidates per slot', () => {
    const pool = Array.from({ length: POOL_DEPTH + 10 }, (_, i) => chest({ hp: 100 + i }));
    const res = rankUpgrades({ ...base, equipped: [worn('Chest', chest({ hp: 1 }))], pool });
    expect(res.find(x => x.slot === 'Chest').candidates).toHaveLength(POOL_DEPTH);
  });
});

describe('choosing what to show', () => {
  const cands = Array.from({ length: 6 }, (_, i) => ({ item: item({ hp: 100 - i }), score: 60 - i, gain: 50 - i, diffs: [] }));
  const drop = (z = 'Plane of Time', chance = 5) => ({ kind: 'drop', zone: z, expansion: 4, npc: 'A mob', chance });
  it('skips items with no known source and keeps the top three that have one', () => {
    const sources = new Map([[cands[0].item.id, []], [cands[1].item.id, [drop()]], [cands[2].item.id, [drop()]], [cands[3].item.id, [drop()]], [cands[4].item.id, [drop()]]]);
    const top = selectTop(cands, sources);
    expect(top.map(u => u.item.id)).toEqual([cands[1].item.id, cands[2].item.id, cands[3].item.id]);
    expect(top).toHaveLength(TOP_N);
  });
  it('an item already in the bags needs no drop, and its bag source leads', () => {
    const sources = new Map([[cands[0].item.id, [drop(), { kind: 'bag', zone: null, expansion: null, npc: null, chance: null }]]]);
    const [u] = selectTop(cands, sources);
    expect(u.best.kind).toBe('bag');
    expect(u.sources).toHaveLength(2);
  });
  it('the best source is the likeliest drop before a vendor', () => {
    const sources = new Map([[cands[0].item.id, [{ kind: 'vendor', zone: 'Freeport', expansion: 0, npc: 'A merchant', chance: null }, drop('Kael', 2), drop('Time', 40)]]]);
    const [u] = selectTop(cands, sources);
    expect(u.best).toMatchObject({ kind: 'drop', zone: 'Time' });
  });
  it('candidateIds is every distinct candidate across slots', () => {
    const a = item({}); const b = item({});
    const ids = candidateIds([{ candidates: [{ item: a }, { item: b }] }, { candidates: [{ item: a }] }]);
    expect(ids.sort()).toEqual([a.id, b.id].sort());
  });
});

describe('the era', () => {
  it('PoP raises the level cap to 65 and the expansion cap to 4 on 2026-10-01', () => {
    expect(levelCap(new Date('2026-09-30T23:00:00Z'))).toBe(60);
    expect(levelCap(new Date('2026-10-19T12:00:00Z'))).toBe(65);
    expect(expansionCap(new Date('2026-09-30T23:00:00Z'))).toBe(3);
    expect(expansionCap(new Date('2026-10-19T12:00:00Z'))).toBe(4);
  });
  it('special and out-of-era zones are not current era', () => {
    expect(isEraExpansion(0, 4)).toBe(true);
    expect(isEraExpansion(4, 4)).toBe(true);
    expect(isEraExpansion(4, 3)).toBe(false);
    expect(isEraExpansion(99, 4)).toBe(false);
    expect(isEraExpansion(-1, 4)).toBe(false);
    expect(isEraExpansion(null, 4)).toBe(false);
  });
});

describe('opt-outs are honoured', () => {
  it('either exclusion flag opts the character out', () => {
    expect(isOptedOut({ exclude_inventory: true })).toBe(true);
    expect(isOptedOut({ exclude_from_stats: true })).toBe(true);
    expect(isOptedOut({ exclude_inventory: false, exclude_from_stats: false })).toBe(false);
    expect(isOptedOut(null)).toBe(false);
  });
  const page = read('web', 'app', 'me', 'upgrades', 'page.tsx');
  it('the page decides the opt-out BEFORE it reads any gear', () => {
    const gate = page.indexOf('isOptedOut(flags)');
    const gear = page.indexOf(".from('character_gear')");
    expect(gate).toBeGreaterThan(0);
    expect(gear).toBeGreaterThan(gate);
    expect(page.indexOf('loadItemPool(')).toBeGreaterThan(gate);
    expect(page.indexOf('loadWishlist(')).toBeGreaterThan(gate);
  });
  it('is scoped to the signed-in member\'s own characters', () => {
    expect(page).toMatch(/ownedCharacters\(user\.id\)/);
    expect(page).toMatch(/redirect\('\/auth\/signin\?next=\/me\/upgrades'\)/);
  });
  it('the wishlist read selects the item and priority only, never a bid', () => {
    const load = read('web', 'lib', 'gearUpgradesLoad.ts');
    const at = load.indexOf(".from('wishlists')");
    expect(at).toBeGreaterThan(0);
    const stmt = load.slice(at, at + 160);
    expect(stmt).toMatch(/select\('item_id, priority'\)/);
    expect(load).not.toMatch(/bid_amount/);
    expect(page).not.toMatch(/bid_amount/);
  });
});

describe('the page is named', () => {
  it('has a Discord card and is marked [beta]', () => {
    const m = metaForPath('/me/upgrades');
    expect(m.title).toBe('[beta] Gear upgrades');
    expect(m.description.length).toBeGreaterThan(20);
    expect(read('web', 'app', 'me', 'upgrades', 'page.tsx')).toMatch(/<NewPageTag/);
  });
});
