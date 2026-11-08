// test/gear-sets.test.js — the gear page's automatic sets and try-on (web/lib/gearSets.ts; DECISIONS §480).
//
// The maths is pure, so these are BEHAVIOUR tests: build items, build the sets, assert what is picked and what the
// card says. One source-text check holds the privacy contract (the sets are only read inside the owner gate, after
// the opt-out test), with comments stripped first (stripJs) so a header that names the thing cannot answer for the code.
//
// Run: npx vitest run test/gear-sets.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  buildSets, ownedFromRows, setDeltas, statsOf, deltaText, capNote, parseTry, serializeTry, tryWarnings,
  placedWith, isCasterClass,
} from '../web/lib/gearSets.ts';
import { UPGRADE_SLOTS } from '../web/lib/gearUpgrades.ts';
import { capsFor, NO_AA } from '../web/lib/gearCaps.ts';

const ALL = 32767;                 // every class
const WAR = 1; const CLR = 2;      // item class bits
const bit = (b) => 2 ** b;         // a slot's mask bit (Ear1 = 1, Head = 2, ... Primary = 13, Secondary = 14, Chest = 17, Waist = 20)
const SLOT = Object.fromEntries(UPGRADE_SLOTS.map(s => [s.name, s]));
const caps = (base) => capsFor({ level: 65, base, attrEnd: 'high', aa: NO_AA });

let nextId = 5000;
const item = (o = {}) => ({
  id: nextId++, name: null, icon: null, slots: bit(SLOT.Chest.bit), classes: ALL, races: 16383, required_level: 0, itemtype: 10,
  ac: null, hp: null, mana: null, damage: null, delay: null,
  str: null, sta: null, agi: null, dex: null, wis: null, intel: null, cha: null,
  mr: null, cr: null, dr: null, fr: null, pr: null,
  attack: null, haste: null, regen: null, manaregen: null, damageshield: null,
  focus_effect: null, worneffect: null, proc_effect: null, clickeffect: null,
  ...o,
});
const forSlot = (slot, o = {}) => item({ slots: bit(SLOT[slot].bit), ...o });
const worn = (slot, it) => ({ slot, item: it });
const bag = (it, count = 1) => ({ item: it, where: 'bag', count });
const bank = (it, count = 1) => ({ item: it, where: 'bank', count });

const run = (o) => buildSets({
  className: 'Warrior', race: 'Human', equipped: [], owned: [], levelCap: 65, caps: caps(o.className ?? 'Warrior'), ...o,
});
const card = (res, id) => res.cards.find(c => c.id === id);
const swapTo = (c, slot) => c.swaps.find(s => s.slot === slot)?.to;

describe('the three sets', () => {
  it('picks the best piece per slot for mitigation, from the bags and the bank, and says which', () => {
    const headWorn = forSlot('Head', { name: 'Cap', ac: 5, hp: 10 });
    const headBag = forSlot('Head', { name: 'Helm', ac: 12, hp: 40 });
    const headBetter = forSlot('Head', { name: 'Bank Helm', ac: 20, hp: 100 });
    const waistWorn = forSlot('Waist', { name: 'Rope', ac: 1 });
    const waistBank = forSlot('Waist', { name: 'Belt', ac: 9, hp: 50 });
    const res = run({
      equipped: [worn('Head', headWorn), worn('Waist', waistWorn)],
      owned: [bag(headBag), bank(headBetter), bank(waistBank)],
    });
    const c = card(res, 'mitigation');
    expect(c.title).toBe('Most mitigation');
    expect(swapTo(c, 'Head').name).toBe('Bank Helm');
    expect(c.swaps.find(s => s.slot === 'Head').where).toBe('bank');
    expect(swapTo(c, 'Waist').name).toBe('Belt');
    expect(c.swaps.find(s => s.slot === 'Waist').where).toBe('bank');
    const ac = c.deltas.find(d => d.key === 'ac');
    const hp = c.deltas.find(d => d.key === 'hp');
    expect(ac.raw).toBe(23);          // (20 + 9) − (5 + 1)
    expect(hp.raw).toBe(140);         // (100 + 50) − 10
    expect(c.deltas.map(deltaText)).toEqual(['AC +23', 'HP +140']);
  });

  it('takes the best of many owned pieces for a slot, whatever order they were found in', () => {
    const cap = forSlot('Head', { name: 'Cap', ac: 1 });
    const ascending = [10, 20, 30, 40, 50, 60].map(ac => forSlot('Head', { name: `Helm ${ac}`, ac }));
    const res = run({ equipped: [worn('Head', cap)], owned: ascending.map(i => bag(i)) });
    expect(card(res, 'mitigation').swaps.map(s => s.to.name)).toEqual(['Helm 60']);
  });

  it('counts a bow in the damage set (weapon ratio on the ranged slot)', () => {
    const bowOld = forSlot('Range', { name: 'Short Bow', damage: 10, delay: 30, itemtype: 5 });
    const bowNew = forSlot('Range', { name: 'Long Bow', damage: 20, delay: 20, itemtype: 5 });
    const res = run({ className: 'Ranger', equipped: [worn('Range', bowOld)], owned: [bag(bowNew)] });
    expect(swapTo(card(res, 'damage'), 'Range').name).toBe('Long Bow');
  });

  it('marks an item that is in the bags as bag, and prefers the bag copy when it is also in the bank', () => {
    const cap = forSlot('Head', { name: 'Cap', ac: 5 });
    const helm = forSlot('Head', { name: 'Helm', ac: 30 });
    const res = run({ equipped: [worn('Head', cap)], owned: [bank(helm), bag(helm)] });
    expect(card(res, 'mitigation').swaps[0].where).toBe('bag');
  });

  it('a melee class gets "Most damage" (ATK, haste, weapon ratio) and a caster gets "Most mana / focus"', () => {
    const chestWorn = forSlot('Chest', { name: 'Tunic', ac: 40, hp: 100 });
    const chestAtk = forSlot('Chest', { name: 'Brawler Vest', attack: 20, haste: 20, ac: 1 });
    const chestMana = forSlot('Chest', { name: 'Robe', mana: 100, manaregen: 5, ac: 1 });
    const war = run({ equipped: [worn('Chest', chestWorn)], owned: [bag(chestAtk), bag(chestMana)] });
    const cw = card(war, 'damage');
    expect(cw.title).toBe('Most damage');
    expect(swapTo(cw, 'Chest').name).toBe('Brawler Vest');
    expect(cw.deltas.map(d => d.key).sort()).toEqual(['attack', 'haste']);

    const clr = run({
      className: 'Cleric', equipped: [worn('Chest', chestWorn)], owned: [bag(chestAtk), bag(chestMana)],
    });
    const cc = card(clr, 'damage');
    expect(isCasterClass('Cleric')).toBe(true);
    expect(isCasterClass('Warrior')).toBe(false);
    expect(cc.title).toBe('Most mana / focus');
    expect(swapTo(cc, 'Chest').name).toBe('Robe');
  });

  it('weapon damage per delay counts for a melee class, on the weapon slots only', () => {
    const slow = forSlot('Primary', { name: 'Slow Sword', damage: 10, delay: 40, itemtype: 0 });
    const fast = forSlot('Primary', { name: 'Fast Sword', damage: 14, delay: 20, itemtype: 0 });
    const res = run({ equipped: [worn('Primary', slow)], owned: [bag(fast)] });
    const c = card(res, 'damage');
    expect(swapTo(c, 'Primary').name).toBe('Fast Sword');
    expect(c.deltas[0].key).toBe('dmgRatio');
    expect(c.deltas[0].raw).toBe(0.45);       // 0.7 − 0.25
  });

  it('adds up the resists for "Best resists"', () => {
    const feetWorn = forSlot('Feet', { name: 'Boots', mr: 5 });
    const feetBank = forSlot('Feet', { name: 'Warded Boots', mr: 10, fr: 8, cr: 8 });
    const feetNo = forSlot('Feet', { name: 'Odd Boots', mr: 11 });
    const res = run({ equipped: [worn('Feet', feetWorn)], owned: [bank(feetBank), bag(feetNo)] });
    const c = card(res, 'resists');
    expect(swapTo(c, 'Feet').name).toBe('Warded Boots');
    expect(c.deltas.map(d => d.key)).toEqual(['mr', 'cr', 'fr']);
  });

  it('says there is nothing to swap when what is worn already wins', () => {
    const headWorn = forSlot('Head', { name: 'Crown', ac: 50, hp: 300, mr: 20 });
    const headWeak = forSlot('Head', { name: 'Cap', ac: 5, hp: 10, mr: 1 });
    const res = run({ equipped: [worn('Head', headWorn)], owned: [bag(headWeak)] });
    for (const id of ['mitigation', 'damage', 'resists']) {
      expect(card(res, id).swaps, id).toEqual([]);
      expect(card(res, id).deltas, id).toEqual([]);
    }
  });

  it('returns null for a class with no weights and for nothing worn', () => {
    expect(run({ className: 'Unknown', equipped: [worn('Head', forSlot('Head', { ac: 1 }))] })).toBeNull();
    expect(run({ equipped: [] })).toBeNull();
  });
});

describe('caps', () => {
  it('does not credit attack past the 250 ceiling: a haste piece beats an ATK piece that would be wasted', () => {
    const fullAtk = forSlot('Chest', { name: 'Atk Chest', attack: 250 });
    const headWorn = forSlot('Head', { name: 'Cap' });
    const headAtk = forSlot('Head', { name: 'ATK Helm', attack: 100 });
    const headHaste = forSlot('Head', { name: 'Haste Helm', haste: 20 });
    const res = run({
      equipped: [worn('Chest', fullAtk), worn('Head', headWorn)],
      owned: [bag(headAtk), bag(headHaste)],
    });
    expect(swapTo(card(res, 'damage'), 'Head').name).toBe('Haste Helm');
  });

  it('says how many points a cap throws away', () => {
    const chest = forSlot('Chest', { attack: 240 });
    const head = forSlot('Head', { attack: 0 });
    const headAtk = forSlot('Head', { attack: 30 });
    const c = caps('Warrior');
    const before = [{ slot: 'Chest', stats: statsOf(chest) }, { slot: 'Head', stats: statsOf(head) }];
    const after = [{ slot: 'Chest', stats: statsOf(chest) }, { slot: 'Head', stats: statsOf(headAtk) }];
    const [d] = setDeltas(before, after, ['attack'], c);
    expect(d.raw).toBe(30);
    expect(d.eff).toBe(10);
    expect(d.wasted).toBe(20);
    expect(capNote(d)).toBe('ATK at cap: +20 wasted');
  });

  it('leaves the note out when no cap bites', () => {
    const [d] = setDeltas([], [{ slot: 'Head', stats: { ac: 4 } }], ['ac'], caps('Warrior'));
    expect(d.wasted).toBe(0);
    expect(capNote(d)).toBeNull();
  });
});

describe('what may be worn where', () => {
  it('never picks an item the class cannot use, the race cannot use, that is over the level cap, or that does not fit', () => {
    const headWorn = forSlot('Head', { name: 'Cap', ac: 1 });
    const wrongClass = forSlot('Head', { name: 'Cleric Helm', ac: 99, classes: CLR });
    const wrongRace = forSlot('Head', { name: 'Troll Helm', ac: 99, races: 256 });
    const tooHigh = forSlot('Head', { name: 'Level 70 Helm', ac: 99, required_level: 70 });
    const wrongSlot = forSlot('Waist', { name: 'Belt', ac: 99 });
    const ok = forSlot('Head', { name: 'Fine Helm', ac: 10, classes: WAR });
    const res = run({
      race: 'Human', equipped: [worn('Head', headWorn)],
      owned: [bag(wrongClass), bag(wrongRace), bag(tooHigh), bank(wrongSlot), bag(ok)],
    });
    const c = card(res, 'mitigation');
    // the belt fits the empty waist and nowhere else
    expect(c.swaps.map(s => `${s.slot}:${s.to.name}`).sort()).toEqual(['Head:Fine Helm', 'Waist:Belt']);
    // the try-on lists the same pieces and no others
    const headOptions = res.tryOn.slots.find(s => s.slot === 'Head').options.map(id => res.tryOn.items[id].name);
    expect(headOptions).toEqual(['Fine Helm']);
    expect(res.tryOn.slots.find(s => s.slot === 'Waist').options.map(id => res.tryOn.items[id].name)).toEqual(['Belt']);
  });

  it('uses each lore item once: one earring cannot go in both ears', () => {
    const e1 = forSlot('Ear1', { name: 'Stud', ac: 1 });
    const e2 = forSlot('Ear2', { name: 'Stud B', ac: 1 });
    const strong = item({ name: 'Loop', slots: bit(SLOT.Ear1.bit) | bit(SLOT.Ear2.bit), ac: 20, hp: 50 });
    const res = run({
      equipped: [worn('Ear1', e1), worn('Ear2', e2)], owned: [bag(strong, 2)], loreIds: new Set([strong.id]),
    });
    const c = card(res, 'mitigation');
    expect(c.swaps.filter(s => s.to.id === strong.id)).toHaveLength(1);
    expect(c.swaps).toHaveLength(1);
  });

  it('puts two copies of a non-lore item in both paired slots, and not three', () => {
    const e1 = forSlot('Ear1', { name: 'Stud', ac: 1 });
    const e2 = forSlot('Ear2', { name: 'Stud B', ac: 1 });
    const strong = item({ name: 'Loop', slots: bit(SLOT.Ear1.bit) | bit(SLOT.Ear2.bit), ac: 20, hp: 50 });
    const res = run({ equipped: [worn('Ear1', e1), worn('Ear2', e2)], owned: [bag(strong, 2)] });
    const c = card(res, 'mitigation');
    expect(c.swaps.map(s => s.slot).sort()).toEqual(['Ear1', 'Ear2']);
    const one = run({ equipped: [worn('Ear1', e1), worn('Ear2', e2)], owned: [bag(strong, 1)] });
    expect(card(one, 'mitigation').swaps).toHaveLength(1);
  });

  it('fills the two paired slots with the two best pieces and moves a worn one across when that is better', () => {
    const slots = bit(SLOT.Ear1.bit) | bit(SLOT.Ear2.bit);
    const a = item({ name: 'A', slots, ac: 5 });
    const b = item({ name: 'B', slots, ac: 1 });
    const best = item({ name: 'Best', slots, ac: 30 });
    const res = run({ equipped: [worn('Ear1', a), worn('Ear2', b)], owned: [bank(best)] });
    const c = card(res, 'mitigation');
    const e1 = c.swaps.find(s => s.slot === 'Ear1');
    const e2 = c.swaps.find(s => s.slot === 'Ear2');
    expect(e1.to.name).toBe('Best');
    expect(e1.where).toBe('bank');
    expect(e2.to.name).toBe('A');
    expect(e2.where).toBe('worn');
    expect(e2.movedFrom).toBe('Ear1');
  });

  it('a two-hander blocks the secondary: a shield is not offered beside a worn two-hander', () => {
    const twoHander = forSlot('Primary', { name: 'Greatsword', damage: 30, delay: 40, itemtype: 1 });
    const shield = forSlot('Secondary', { name: 'Shield', ac: 25, hp: 50, itemtype: 8 });
    const res = run({ equipped: [worn('Primary', twoHander)], owned: [bag(shield)] });
    expect(card(res, 'mitigation').swaps).toEqual([]);
    expect(res.tryOn.slots.find(s => s.slot === 'Secondary')).toBeDefined();   // the try-on still lists it ...
    const sel = { Secondary: shield.id };
    expect(tryWarnings(res.tryOn, sel).join(' ')).toMatch(/two-handed/);       // ... and says why it cannot work
  });

  it('offers the same shield beside a one-hander (the control for the two-hander test)', () => {
    const oneHander = forSlot('Primary', { name: 'Sword', damage: 10, delay: 20, itemtype: 0 });
    const shield = forSlot('Secondary', { name: 'Shield', ac: 25, hp: 50, itemtype: 8 });
    const res = run({ equipped: [worn('Primary', oneHander)], owned: [bag(shield)] });
    expect(swapTo(card(res, 'mitigation'), 'Secondary').name).toBe('Shield');
    expect(tryWarnings(res.tryOn, { Secondary: shield.id })).toEqual([]);
  });

  it('only swaps a weapon for the same weapon type, and never fills an empty weapon slot with a weapon', () => {
    const sword = forSlot('Primary', { name: 'Sword', damage: 10, delay: 30, itemtype: 0 });
    const axe = forSlot('Primary', { name: 'Axe', damage: 30, delay: 20, itemtype: 1 });
    const blade = forSlot('Primary', { name: 'Blade', damage: 20, delay: 30, itemtype: 0 });
    const offhand = forSlot('Secondary', { name: 'Dagger', damage: 9, delay: 20, itemtype: 2 });
    const res = run({ equipped: [worn('Primary', sword)], owned: [bag(axe), bag(blade), bag(offhand)] });
    expect(swapTo(card(res, 'damage'), 'Primary').name).toBe('Blade');
    expect(swapTo(card(res, 'damage'), 'Secondary')).toBeUndefined();
  });
});

describe('what the character owns', () => {
  it('takes the larger of the gear export and the inventory export for the bags, and sums the bank', () => {
    const stacks = ownedFromRows(
      [{ item_id: 1, count: 1 }, { item_id: 2, count: 1 }],
      [
        { slot_label: 'General1-Slot1', item_id: 1, quantity: 1 },     // the same item as the gear row, not a second one
        { slot_label: 'General2-Slot3', item_id: 3, quantity: 1 },
        { slot_label: 'Bank4-Slot2', item_id: 4, quantity: 1 },
        { slot_label: 'SharedBank1-Slot1', item_id: 4, quantity: 1 },
        { slot_label: 'Bank7', item_id: 5, quantity: 1 },
        { slot_label: 'Head', item_id: 6, quantity: 1 },              // worn, not spare
        { slot_label: 'Bank1-Slot1', item_id: null, quantity: 1 },
      ],
    );
    const key = (s) => `${s.id}:${s.where}:${s.count}`;
    expect(stacks.map(key).sort()).toEqual(['1:bag:1', '2:bag:1', '3:bag:1', '4:bank:2', '5:bank:1'].sort());
  });

  it('does not count one carried item as two copies when both exports list it', () => {
    const slots = bit(SLOT.Ear1.bit) | bit(SLOT.Ear2.bit);
    const stud = item({ name: 'Stud', slots, ac: 1 });
    const loop = item({ name: 'Loop', slots, ac: 20 });
    const [stack] = ownedFromRows(
      [{ item_id: loop.id, count: 1 }], [{ slot_label: 'General1-Slot1', item_id: loop.id, quantity: 1 }],
    );
    const res = run({
      equipped: [worn('Ear1', stud), worn('Ear2', stud)], owned: [{ item: loop, where: stack.where, count: stack.count }],
    });
    expect(card(res, 'mitigation').swaps).toHaveLength(1);
  });
});

describe('try-on', () => {
  const base = () => {
    const headWorn = forSlot('Head', { name: 'Cap', ac: 5, str: 10 });
    const headBank = forSlot('Head', { name: 'Helm', ac: 15, str: 30 });
    const waistWorn = forSlot('Waist', { name: 'Rope', ac: 1 });
    const waistBag = forSlot('Waist', { name: 'Belt', ac: 4, hp: 20 });
    const res = run({
      equipped: [worn('Head', headWorn), worn('Waist', waistWorn)], owned: [bank(headBank), bag(waistBag)],
    });
    return { res, headBank, waistBag, headWorn };
  };

  it('lists, per slot, the owned pieces that fit and the worn one', () => {
    const { res, headBank, headWorn } = base();
    const head = res.tryOn.slots.find(s => s.slot === 'Head');
    expect(head.wornId).toBe(headWorn.id);
    expect(head.options).toEqual([headBank.id]);
    expect(res.tryOn.items[headBank.id].where).toBe('bank');
  });

  it('shows the change in every stat for the picks', () => {
    const { res, headBank, waistBag } = base();
    const { before, after } = placedWith(res.tryOn, { Head: headBank.id, Waist: waistBag.id });
    const d = Object.fromEntries(setDeltas(before, after, Object.keys({ ac: 1, hp: 1, str: 1 }), res.tryOn.caps).map(x => [x.key, x]));
    expect(d.ac.raw).toBe(13);        // (15 + 4) − (5 + 1)
    expect(d.hp.raw).toBe(20);
    expect(d.str.raw).toBe(20);
  });

  it('warns that a stat is at its cap and how much is wasted', () => {
    const headWorn = forSlot('Head', { name: 'Cap' });
    const headStr = forSlot('Head', { name: 'Strong Helm', str: 60 });
    const chest = forSlot('Chest', { name: 'Vest', str: 70 });
    const res = run({ equipped: [worn('Head', headWorn), worn('Chest', chest)], owned: [bag(headStr)] });
    const { before, after } = placedWith(res.tryOn, { Head: headStr.id });
    const [d] = setDeltas(before, after, ['str'], res.tryOn.caps);
    expect(d.raw).toBe(60);
    expect(d.wasted).toBe(55);                    // the High end leaves 75 points of gear room: 70 + 60 − 75 = 55 over
    expect(capNote(d)).toBe('STR at cap: +55 wasted');
  });

  it('warns when one copy is picked for two slots', () => {
    const slots = bit(SLOT.Ear1.bit) | bit(SLOT.Ear2.bit);
    const stud = item({ name: 'Stud', slots, ac: 1 });
    const loop = item({ name: 'Loop', slots, ac: 20 });
    const res = run({ equipped: [worn('Ear1', stud), worn('Ear2', stud)], owned: [bag(loop)] });
    expect(tryWarnings(res.tryOn, { Ear1: loop.id })).toEqual([]);
    expect(tryWarnings(res.tryOn, { Ear1: loop.id, Ear2: loop.id }).join(' ')).toMatch(/Loop is in 2 slots/);
  });

  it('round-trips the picks through ?try= and drops anything the data does not list', () => {
    const { res, headBank, waistBag } = base();
    const sel = { Head: headBank.id, Waist: waistBag.id };
    const q = serializeTry(sel, res.tryOn);
    expect(q).toBe(`Head:${headBank.id},Waist:${waistBag.id}`);
    expect(parseTry(q, res.tryOn)).toEqual(sel);
    // an item that is not in the owner's list, a slot that does not exist, and junk
    expect(parseTry(`Head:1,Nope:${headBank.id},<script>,Waist:${waistBag.id}`, res.tryOn)).toEqual({ Waist: waistBag.id });
    expect(parseTry('', res.tryOn)).toEqual({});
    expect(parseTry(null, res.tryOn)).toEqual({});
  });

  it('ships only items the character owns or wears', () => {
    const { res } = base();
    expect(Object.keys(res.tryOn.items)).toHaveLength(4);
    expect(JSON.stringify(res.tryOn)).not.toMatch(/undefined/);
  });
});

describe('who sees it', () => {
  const read = (...p) => stripJs(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));

  it('reads the owner\'s bank only inside the owner gate, after the opt-out test', () => {
    const src = read('web', 'app', 'character', '[name]', 'gear', 'page.tsx');
    const optOut = src.indexOf('!isOptedOut(char)');
    const owner = src.indexOf('mine.some(');
    const load = src.indexOf('loadGearSets(');
    expect(optOut).toBeGreaterThan(-1);
    expect(owner).toBeGreaterThan(optOut);
    expect(load).toBeGreaterThan(owner);
    expect(src.indexOf('<GearSets')).toBeGreaterThan(-1);
    // the render is conditional on the load having produced something, and nothing else loads it
    expect(src).toMatch(/\{gearSets && <GearSets /);
    expect(src.match(/loadGearSets\(/g)).toHaveLength(1);
  });

  it('the loader reads only the inventory columns it needs, for the one character it was given', () => {
    const src = read('web', 'lib', 'gearSetsLoad.ts');
    expect(src).toMatch(/\.from\('character_inventory'\)\s*\.select\('slot_label, item_id, quantity'\)/);
    expect(src).toMatch(/\.ilike\('character_name', input\.name\)/);
  });
});
