// test/gear-caps.test.js — the gear finder's cap-aware scoring and its quest / tradeskill sources (2026-10-26).
//
// The guild lead's asks: quest and tradeskill items in the finder; "how close this gets you to maximums on stats,
// attack, flowing thought, AC"; and "cap with planar power at level 65 is 305 now, instead of 255 previous".
// The numbers are the Quarm server's (SecretsOTheP/EQMacEmu @ a3b80b2; cited in web/lib/gearCaps.ts). These are
// BEHAVIOUR tests over the pure modules, plus a few source-text checks (comments stripped first) for the contracts a
// behaviour test cannot reach: who sees the gear page's upgrade check, and that the migration only reads rewards.
//
// Run: npx vitest run test/gear-caps.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import {
  statCapAt, hpRegenCapAt, manaRegenCapFor, acSoftcap, acReturns, aaCapMods, capsFor, attrCapFor, attrRoom, attrCapLabel,
  NO_AA, RESIST_CAP, ITEM_ATK_CAP,
} from '../web/lib/gearCaps.ts';
import {
  effectiveValue, scoreItem, resolveWeights, rankUpgrades, selectTop, capRows, capRowText, capStatus,
  altSourcesFromRows, recipeInEra, sourceLine, UPGRADE_SLOTS,
} from '../web/lib/gearUpgrades.ts';
import { loadAltSources, loadAaCapMods } from '../web/lib/gearUpgradesLoad.ts';
import { parseAttrEnd } from '../web/lib/gearUpgradesRun.ts';
import { CAPS, ATTR_ASSUMED_NONGEAR } from '../web/lib/gearWeights.ts';
import { pqdiIconUrl, hasItemIcon, inAtlasRange, ICON_LAST } from '../web/lib/itemIcon.ts';

const read = (...p) => stripJs(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
const readRaw = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

let nextId = 5000;
const item = (o = {}) => ({
  id: nextId++, name: null, slots: 2 ** 17, classes: 32767, races: 16383, required_level: 0, itemtype: 10,
  ac: null, hp: null, mana: null, damage: null, delay: null,
  str: null, sta: null, agi: null, dex: null, wis: null, intel: null, cha: null,
  mr: null, cr: null, dr: null, fr: null, pr: null,
  attack: null, haste: null, regen: null, manaregen: null, damageshield: null,
  focus_effect: null, worneffect: null, proc_effect: null, clickeffect: null, icon: null,
  ...o,
});

// The rows the mirror holds for the two stat-cap AAs (measured 2026-10-26): Planar Power eqmacid 142 / skill 418 is
// +5 per rank to all seven attributes; Innate Enlightenment eqmacid 144 / skill 426 is +10 per rank to WIS (4) and
// INT (5), class mask 31812 (the seven casting classes).
const VARS = [
  { skill_id: 418, eqmacid: 142, name: 'Planar Power', max_level: 5, classes: 65534 },
  { skill_id: 426, eqmacid: 144, name: 'Innate Enlightenment', max_level: 5, classes: 31812 },
];
const EFFECTS = [
  ...[0, 1, 2, 3, 4, 5, 6].map(b2 => ({ aaid: 418, effectid: 262, base1: 5, base2: b2 })),
  { aaid: 426, effectid: 262, base1: 10, base2: 4 },
  { aaid: 426, effectid: 262, base1: 10, base2: 5 },
];
const ctxFor = (base, aa = NO_AA, attrEnd = 'high', level = 65) => ({ level, base, attrEnd, aa });

describe('the stat cap', () => {
  it('is 255 to level 60, then 5 a level: 280 at 65', () => {
    expect(statCapAt(60)).toBe(255);
    expect(statCapAt(51)).toBe(255);
    expect(statCapAt(61)).toBe(260);
    expect(statCapAt(65)).toBe(280);
  });
  it('is 305 at 65 with Planar Power rank 5, read from the character\'s own AAs', () => {
    const aa = aaCapMods('Monk', [{ aa_index: 142, rank: 5 }], VARS, EFFECTS);
    expect(aa.known).toBe(true);
    expect(aa.used.map(u => [u.eqmacid, u.skill_id, u.stat, u.amount]).slice(0, 2)).toEqual([[142, 418, 'str', 25], [142, 418, 'sta', 25]]);
    expect(statCapAt(65, aa.mods.str)).toBe(305);
    expect(attrCapFor(ctxFor('Monk', aa), 'dex')).toBe(305);
    expect(attrCapLabel(ctxFor('Monk', aa), 'dex')).toBe('305');
  });
  it('scales with the rank trained and ignores a junk row', () => {
    expect(aaCapMods('Monk', [{ aa_index: 142, rank: 3 }], VARS, EFFECTS).mods.str).toBe(15);
    const junk = aaCapMods('Monk', [{ aa_index: 142, rank: 255 }], VARS, EFFECTS);   // the export writes rank-255 sentinels
    expect(junk.known).toBe(true);
    expect(junk.mods.str ?? 0).toBe(0);
  });
  it('gives a caster Innate Enlightenment (355 WIS / INT with both) and a monk none', () => {
    const rows = [{ aa_index: 142, rank: 5 }, { aa_index: 144, rank: 5 }];
    const wiz = aaCapMods('Wizard', rows, VARS, EFFECTS);
    expect(attrCapFor(ctxFor('Wizard', wiz), 'intel')).toBe(355);
    expect(attrCapFor(ctxFor('Wizard', wiz), 'str')).toBe(305);
    const mnk = aaCapMods('Monk', rows, VARS, EFFECTS);
    expect(attrCapFor(ctxFor('Monk', mnk), 'wis')).toBe(305);
    expect(aaCapMods('Beastlord', rows, VARS, EFFECTS).mods.wis).toBe(25);   // not in the caster mask
  });
  it('says "+AA unknown" when the character has no AA rows, and assumes no raise', () => {
    const c = ctxFor('Monk');
    expect(c.aa.known).toBe(false);
    expect(attrCapFor(c, 'str')).toBe(280);
    expect(attrCapLabel(c, 'str')).toBe('280 (+AA unknown)');
  });
});

describe('the item-capped stats', () => {
  it('Flowing Thought is 15 for a caster and 0 for a Monk, Warrior or Rogue', () => {
    expect(manaRegenCapFor('Monk')).toBe(0);
    expect(manaRegenCapFor('Warrior')).toBe(0);
    expect(manaRegenCapFor('Rogue')).toBe(0);
    for (const c of ['Wizard', 'Cleric', 'Paladin', 'Shadow Knight', 'Ranger', 'Bard', 'Beastlord']) expect(manaRegenCapFor(c)).toBe(15);
    const ft = item({ manaregen: 8 });
    expect(effectiveValue(ft, 'manaregen', [], capsFor(ctxFor('Monk')))).toBe(0);
    expect(effectiveValue(ft, 'manaregen', [], capsFor(ctxFor('Wizard')))).toBe(8);
    expect(effectiveValue(ft, 'manaregen', [item({ manaregen: 9 })], capsFor(ctxFor('Wizard')))).toBe(6);   // 15 − 9
  });
  it('item HP regen is 35 at level 65, 30 at 60', () => {
    expect(hpRegenCapAt(65)).toBe(35);
    expect(hpRegenCapAt(60)).toBe(30);
    expect(CAPS.regen).toEqual({ rule: 'sum', cap: 35 });
    const caps = capsFor(ctxFor('Warrior'));
    expect(effectiveValue(item({ regen: 10 }), 'regen', [item({ regen: 30 })], caps)).toBe(5);   // 35 − 30; the old 30 gave 0
    expect(effectiveValue(item({ regen: 10 }), 'regen', [item({ regen: 30 })], capsFor(ctxFor('Warrior', NO_AA, 'high', 60)))).toBe(0);
  });
  it('item ATK stays 250 and resists are 500 + AA', () => {
    expect(ITEM_ATK_CAP).toBe(250);
    expect(effectiveValue(item({ attack: 50 }), 'attack', [item({ attack: 220 })], capsFor(ctxFor('Warrior')))).toBe(30);
    expect(RESIST_CAP).toBe(500);
    expect(effectiveValue(item({ mr: 30 }), 'mr', [item({ mr: 480 })], capsFor(ctxFor('Warrior')))).toBe(20);
  });
  it('damage shield has no cap any more', () => {
    expect(CAPS.damageshield).toBeUndefined();
    expect(effectiveValue(item({ damageshield: 40 }), 'damageshield', [item({ damageshield: 30 })], capsFor(ctxFor('Warrior')))).toBe(40);
  });
  it('a negative attribute or AC keeps its penalty; a negative ATK still never cancels the cap', () => {
    const caps = capsFor(ctxFor('Warrior'));
    expect(effectiveValue(item({ str: -5 }), 'str', [], caps)).toBe(-5);
    expect(effectiveValue(item({ ac: -4 }), 'ac', [], caps)).toBe(-4);
    expect(effectiveValue(item({ attack: -10 }), 'attack', [], caps)).toBe(0);
  });
});

describe('AC soft cap', () => {
  it('has the server\'s per-class caps and returns at level 65', () => {
    expect(acSoftcap('Warrior', 65)).toBe(430);
    expect(acSoftcap('Paladin', 65)).toBe(403);
    expect(acSoftcap('Ranger', 65)).toBe(375);
    expect(acSoftcap('Monk', 65)).toBe(350);
    expect(acSoftcap('Wizard', 65)).toBe(350);
    expect(acSoftcap('Warrior', 50)).toBe(350);
    expect(acReturns('Warrior', 65)).toBe(3);
    expect(acReturns('Monk', 65)).toBe(12);
    expect(acReturns('Wizard', 65)).toBe(20);
  });
  it('counts AC past the soft cap at 1 / returns, and in full below it', () => {
    const caps = capsFor(ctxFor('Monk'));                      // soft cap 350, returns 12
    const others = [item({ ac: 340 })];
    expect(effectiveValue(item({ ac: 10 }), 'ac', [], caps)).toBe(10);
    expect(effectiveValue(item({ ac: 22 }), 'ac', others, caps)).toBeCloseTo(10 + 12 / 12, 9);    // 10 under, 12 over → 1
    expect(effectiveValue(item({ ac: 24 }), 'ac', [item({ ac: 360 })], caps)).toBeCloseTo(2, 9);  // all over: 24 / 12
  });
});

describe('High end / Low end for attributes', () => {
  it('High end counts only the gear points that fit under the cap; Low end counts them all', () => {
    expect(ATTR_ASSUMED_NONGEAR).toEqual({ high: 205, low: 0 });
    const hi = capsFor(ctxFor('Rogue', NO_AA, 'high'));
    const lo = capsFor(ctxFor('Rogue', NO_AA, 'low'));
    const rest = [item({ dex: 60 })];
    expect(attrRoom(ctxFor('Rogue', NO_AA, 'high'), 'dex')).toBe(75);          // 280 − 205
    expect(effectiveValue(item({ dex: 30 }), 'dex', rest, hi)).toBe(15);        // 75 − 60 of room left
    expect(effectiveValue(item({ dex: 30 }), 'dex', rest, lo)).toBe(30);
  });
  it('Planar Power widens the room: 100 points of gear fit, not 75', () => {
    const aa = aaCapMods('Rogue', [{ aa_index: 142, rank: 5 }], VARS, EFFECTS);
    expect(attrRoom(ctxFor('Rogue', aa, 'high'), 'dex')).toBe(100);
    expect(effectiveValue(item({ dex: 30 }), 'dex', [item({ dex: 60 })], capsFor(ctxFor('Rogue', aa, 'high')))).toBe(30);
  });
  it('changes what is suggested: a DEX piece is worth nothing to a rogue who is already past the room', () => {
    const cur = item({ ac: 5 });
    const dexy = item({ dex: 25, ac: 5 });
    const eq = [
      { slot: 'Chest', item: cur },
      { slot: 'Head', item: item({ dex: 90, slots: 2 ** 2 }) },
    ];
    const run = (end) => rankUpgrades({
      className: 'Rogue', race: null, equipped: eq, pool: [dexy], levelCap: 65, caps: capsFor(ctxFor('Rogue', NO_AA, end)),
    }).find(r => r.slot === 'Chest').candidates;
    expect(run('low').map(c => c.item.id)).toEqual([dexy.id]);
    expect(run('high')).toEqual([]);
  });
  it('defaults to High end', () => {
    expect(parseAttrEnd(undefined)).toBe('high');
    expect(parseAttrEnd('low')).toBe('low');
    expect(parseAttrEnd('nonsense')).toBe('high');
  });
});

describe('how close to the caps', () => {
  it('reports the worn total before and after a swap against the cap', () => {
    const caps = capsFor(ctxFor('Warrior'));
    const cur = item({ attack: 10 });
    const cand = item({ attack: 60, haste: 30 });
    const others = [item({ attack: 190, haste: 28 })];
    const rows = capRows(cand, cur, others, caps);
    const atk = rows.find(r => r.key === 'attack');
    expect(atk).toMatchObject({ now: 200, after: 250, cap: 250, over: 0 });
    expect(capRowText(atk)).toBe('ATK 200→250/250');
    expect(capRowText(rows.find(r => r.key === 'haste'))).toBe('Haste 28%→30%');
    expect(capRowText(capRows(item({ attack: 80 }), cur, others, caps).find(r => r.key === 'attack'))).toBe('ATK 200→250/250 (20 over, wasted)');
  });
  it('names Flowing Thought "FT" and skips it for a class that discards it', () => {
    const ft = item({ manaregen: 4 });
    const wiz = capRows(ft, null, [item({ manaregen: 5 })], capsFor(ctxFor('Wizard')));
    expect(capRowText(wiz.find(r => r.key === 'manaregen'))).toBe('FT 5→9/15');
    const mnk = capRows(ft, null, [], capsFor(ctxFor('Monk')));
    expect(capRowText(mnk.find(r => r.key === 'manaregen'))).toBe('FT 0→0/0 (4 over, wasted)');
  });
  it('summarises the worn set against every cap, with the cap\'s own wording', () => {
    const aa = aaCapMods('Monk', [{ aa_index: 142, rank: 5 }], VARS, EFFECTS);
    const ctx = ctxFor('Monk', aa);
    const rows = capStatus([item({ attack: 100, str: 50, haste: 28, ac: 40 })], capsFor(ctx), ctx);
    const by = Object.fromEntries(rows.map(r => [r.key, r]));
    expect(by.attack).toMatchObject({ have: 100, cap: 250 });
    expect(by.str.cap).toBe(100);                                // 305 − 205 open to gear
    expect(by.str.detail).toContain('cap 305');
    expect(by.str.detail).toContain('+25 from AAs');
    expect(by.manaregen.detail).toContain('discarded for a Monk');
    expect(by.haste).toMatchObject({ kind: 'max', have: 28 });
  });
});

describe('quest and tradeskill sources', () => {
  const fx = new Map([[1, { required_level: 65 }], [2, { required_level: 46 }], [3, { required_level: 66 }]]);
  const quest = (o) => ({
    item_id: 1, kind: 'quest', zone_short: 'tox', zone_name: 'Toxxulia Forest', zone_expansion: 0, npc_name: '#a skeleton',
    recipe_id: null, recipe_name: null, tradeskill: null, trivial: null, must_learn: null, container_id: null, container_name: null, components: null, ...o,
  });
  const recipe = (o) => ({
    item_id: 2, kind: 'recipe', zone_short: null, zone_name: null, zone_expansion: null, npc_name: null,
    recipe_id: 3303, recipe_name: 'Stonehide Tunic', tradeskill: 61, trivial: 335, must_learn: false, container_id: null, container_name: null, components: null, ...o,
  });

  it('a quest reward reads "Quest reward: <NPC>, <zone>"', () => {
    const m = altSourcesFromRows([quest()], fx, 4, 65);
    expect(sourceLine(m.get(1)[0])).toBe('Quest reward: a skeleton, Toxxulia Forest');
  });
  it('a quest in a zone beyond the era, or in a zone we cannot place, is not a source', () => {
    expect(altSourcesFromRows([quest({ zone_expansion: 4 })], fx, 3, 60).size).toBe(0);     // PoP zone before PoP
    expect(altSourcesFromRows([quest({ zone_expansion: 4 })], fx, 4, 65).size).toBe(1);
    expect(altSourcesFromRows([quest({ zone_expansion: null })], fx, 4, 65).size).toBe(0);
    expect(altSourcesFromRows([quest({ zone_expansion: 99 })], fx, 4, 65).size).toBe(0);    // special zone
  });
  it('instanced copies of the same script collapse to one line', () => {
    const m = altSourcesFromRows([quest(), quest({ zone_short: 'tox_copy' }), quest({ npc_name: 'a skeleton' })], fx, 4, 65);
    expect(m.get(1)).toHaveLength(1);
  });
  it('a plain recipe reads "Made with <skill> (trivial N)"', () => {
    const m = altSourcesFromRows([recipe()], fx, 4, 65);
    expect(sourceLine(m.get(2)[0])).toBe('Made with Tailoring (trivial 335)');
  });
  it('a recipe is flagged when it must be learned first', () => {
    const m = altSourcesFromRows([recipe({ must_learn: true })], fx, 4, 65);
    expect(sourceLine(m.get(2)[0])).toBe('Made with Tailoring (trivial 335) · recipe must be learned first');
  });
  it('a quest combine lists its components and the bag it goes in', () => {
    const m = altSourcesFromRows([recipe({
      item_id: 1, recipe_id: 13596, tradeskill: 75, trivial: 0, container_id: 17185, container_name: "Druzzil's Mystical Sewing Kit",
      components: [
        { id: 16287, n: 'Cured Ethereal Energy', c: 2, s: 0 }, { id: 16275, n: 'Monk Emblem', c: 1, s: 0 },
        { id: 16361, n: 'Tanaan Embroidery Needle', c: 1, s: 1 }, { id: 16377, n: 'Timeless Leather Tunic Pattern', c: 1, s: 0 },
      ],
    })], fx, 4, 65);
    expect(sourceLine(m.get(1)[0])).toBe(
      "Quest combine: Cured Ethereal Energy ×2, Monk Emblem, Tanaan Embroidery Needle, Timeless Leather Tunic Pattern in Druzzil's Mystical Sewing Kit");
    expect(m.get(1)[0].craft.questCombine).toBe(true);
  });
  it('a world container (id under 75) is labelled from the container table', () => {
    const m = altSourcesFromRows([recipe({ item_id: 1, tradeskill: 75, container_id: 17, container_name: null, components: [{ id: 5, n: 'Rock', c: 1, s: 0 }] })], fx, 4, 65);
    expect(sourceLine(m.get(1)[0])).toBe('Quest combine: Rock in Forge');
  });
  it('a recipe\'s era is the item\'s own required level against the level cap', () => {
    expect(recipeInEra(65, 65)).toBe(true);
    expect(recipeInEra(66, 65)).toBe(false);
    expect(recipeInEra(null, 60)).toBe(true);
    expect(altSourcesFromRows([recipe({ item_id: 3 })], fx, 4, 65).size).toBe(0);           // level 66 item
    expect(altSourcesFromRows([recipe({ item_id: 1 })], fx, 3, 60).size).toBe(0);           // level 65 item before the cap rises
    expect(altSourcesFromRows([recipe({ item_id: 404 })], fx, 4, 65).size).toBe(1);         // item not in the map: level 0
  });
  it('an item whose only source is a quest or a recipe is no longer dropped, and ranks after a shop', () => {
    const a = { item: item({ id: 91 }), score: 9, gain: 9, diffs: [] };
    const sources = altSourcesFromRows([quest({ item_id: 91 }), recipe({ item_id: 92 })], new Map(), 4, 65);
    const top = selectTop([a, { item: item({ id: 92 }), score: 8, gain: 8, diffs: [] }, { item: item({ id: 93 }), score: 7, gain: 7, diffs: [] }], sources);
    expect(top.map(u => u.item.id)).toEqual([91, 92]);                                      // 93 has no source at all
    const both = [{ kind: 'quest', zone: 'z', expansion: 0, npc: 'n', chance: null }, { kind: 'vendor', zone: 'z', expansion: 0, npc: 'm', chance: null }];
    expect(selectTop([a], new Map([[91, both]]))[0].best.kind).toBe('vendor');
  });
});

describe('the quest / tradeskill lookup degrades safely', () => {
  // rpc(...) is awaited after .range(0, 999): hand back a thenable that carries the call's result
  const rpcSb = (fn) => ({ rpc: (name, args) => { const p = Promise.resolve().then(() => fn(name, args)); return { range: () => p, then: (a, b) => p.then(a, b) }; } });
  it('returns ok:false and no sources when item_alt_sources is missing (migration not applied)', async () => {
    const sb = rpcSb(async () => ({ data: null, error: { message: 'Could not find the function public.item_alt_sources' } }));
    const r = await loadAltSources(sb, [1, 2, 3], new Map(), 4, 65);
    expect(r.ok).toBe(false);
    expect(r.sources.size).toBe(0);
  });
  it('never throws when the call itself blows up', async () => {
    const r = await loadAltSources(rpcSb(async () => { throw new Error('network'); }), [1], new Map(), 4, 65);
    expect(r.ok).toBe(false);
  });
  it('maps the function\'s rows, in chunks of 50 ids (under the 1,000-row response cap)', async () => {
    const seen = [];
    const sb = rpcSb(async (name, args) => {
      seen.push([name, args.p_item_ids.length]);
      return { error: null, data: args.p_item_ids.includes(7) ? [{
        item_id: 7, kind: 'quest', zone_short: 'tox', zone_name: 'Toxxulia Forest', zone_expansion: 0, npc_name: 'Aldenmar',
        recipe_id: null, recipe_name: null, tradeskill: null, trivial: null, must_learn: null, container_id: null, container_name: null, components: null,
      }] : [] };
    });
    const ids = Array.from({ length: 150 }, (_, i) => i + 1);
    const r = await loadAltSources(sb, ids, new Map(), 4, 65);
    expect(seen).toEqual([['item_alt_sources', 50], ['item_alt_sources', 50], ['item_alt_sources', 50]]);
    expect(r.ok).toBe(true);
    expect(sourceLine(r.sources.get(7)[0])).toBe('Quest reward: Aldenmar, Toxxulia Forest');
  });
  it('asks for nothing when nothing lacks a source', async () => {
    let called = false;
    const r = await loadAltSources(rpcSb(async () => { called = true; return { data: [], error: null }; }), [], new Map(), 4, 65);
    expect(called).toBe(false);
    expect(r.ok).toBe(true);
  });
});

describe('the AA read', () => {
  // a tiny stand-in for the query builder: every filter is chainable and the awaited value is the table's rows
  const fakeSb = (tables) => ({
    from: (t) => {
      const q = { select: () => q, ilike: () => q, eq: () => q, in: () => q, limit: () => q, order: () => q, range: () => q, then: (res) => res(tables[t] ?? { data: [], error: null }) };
      return q;
    },
  });
  it('joins the character\'s ranks to the stat-cap effects: Planar Power makes it 305', async () => {
    const sb = fakeSb({
      character_aas: { data: [{ aa_index: 142, rank: 5 }, { aa_index: 1, rank: 5 }], error: null },
      eqemu_aa_effects: { data: EFFECTS, error: null },
      eqemu_altadv_vars: { data: VARS, error: null },
    });
    const aa = await loadAaCapMods(sb, 'Brackwyn', 'Monk');
    expect(aa.known).toBe(true);
    expect(aa.used.map(u => u.name)).toContain('Planar Power');
    expect(statCapAt(65, aa.mods.str)).toBe(305);
  });
  it('is "unknown" with no AA rows or a failed read, never an error', async () => {
    expect((await loadAaCapMods(fakeSb({ character_aas: { data: [], error: null } }), 'Brackwyn', 'Monk')).known).toBe(false);
    expect((await loadAaCapMods(fakeSb({ character_aas: { data: null, error: { message: 'x' } } }), 'Brackwyn', 'Monk')).known).toBe(false);
  });
});

describe('item icons', () => {
  it('guards ids outside the atlas, and builds the PQDI address for the ones inside', () => {
    expect(inAtlasRange(ICON_LAST + 1)).toBe(false);
    expect(hasItemIcon(ICON_LAST + 1)).toBe(false);
    expect(hasItemIcon(null)).toBe(false);
    expect(pqdiIconUrl(632)).toBe('https://www.pqdi.cc/icons/item_632.png');
    expect(pqdiIconUrl(null)).toBeNull();
    expect(pqdiIconUrl(0)).toBeNull();
    expect(pqdiIconUrl(Number.NaN)).toBeNull();
  });
  const upgrades = read('web', 'app', 'me', 'upgrades', 'page.tsx');
  const check = read('web', 'app', 'character', '[name]', 'gear', 'UpgradeCheck.tsx');
  const gear = read('web', 'app', 'character', '[name]', 'gear', 'page.tsx');
  it('both pages draw icons through the inventory component (atlas first, PQDI when the atlas is switched off)', () => {
    // components/ItemIcon alone draws nothing while ICON_ATLAS_DISABLED is true
    for (const src of [upgrades, check, gear]) {
      expect(src).toMatch(/import ItemIcon from '[^']*inventory\/ItemIcon'/);
      expect(src).toMatch(/<ItemIcon icon=/);
      expect(src).not.toMatch(/from '@\/components\/ItemIcon'/);
    }
  });
  it('the icon id is read for the items shown, never for the 14k-row pool', () => {
    const load = read('web', 'lib', 'gearUpgradesLoad.ts');
    expect(load).toMatch(/clickeffect, icon'/);
    expect(load).toMatch(/\.replace\(', icon', ''\)/);
    expect(gear).toMatch(/select\('id, name, icon,/);
  });
});

describe('who sees the gear page\'s upgrade check', () => {
  const gear = read('web', 'app', 'character', '[name]', 'gear', 'page.tsx');
  it('only the character\'s owner, and never an opted-out character', () => {
    const owned = gear.indexOf('ownedCharacters(user.id)');
    const optOut = gear.indexOf('isOptedOut(char)');
    const run = gear.indexOf('runUpgradeEval(');
    expect(owned).toBeGreaterThan(0);
    expect(optOut).toBeGreaterThan(0);
    expect(run).toBeGreaterThan(owned);
    expect(run).toBeGreaterThan(optOut);
    expect(gear).toMatch(/mine\.some\(o => o\.name\.toLowerCase\(\) === decoded\.toLowerCase\(\)\)/);
    expect(gear).toMatch(/\{upgradeEval && <UpgradeCheck/);
    // the evaluation only ever runs inside that gate: one call site
    expect(gear.split('runUpgradeEval(').length - 1).toBe(1);
  });
  it('links each slot to its card on the finder, and the finder has that anchor', () => {
    const check = read('web', 'app', 'character', '[name]', 'gear', 'UpgradeCheck.tsx');
    expect(check).toMatch(/\/me\/upgrades\?c=\$\{enc\}#\$\{r\.slot\}/);
    expect(read('web', 'app', 'me', 'upgrades', 'page.tsx')).toMatch(/<section id=\{r\.slot\}/);
  });
  it('shows no wishlist or bid', () => {
    const check = read('web', 'app', 'character', '[name]', 'gear', 'UpgradeCheck.tsx');
    expect(check).not.toMatch(/wishlist|bid_amount|WishlistControls|callBotWishlist/i);
  });
});

describe('the migration', () => {
  const sql = stripSql(readRaw('supabase', 'migrations', '20261026200000_item_alt_sources.sql'));
  it('is idempotent and granted like the two functions it batches', () => {
    expect(sql).toMatch(/create or replace function public\.item_alt_sources\(p_item_ids integer\[\]\)/);
    expect(sql).toMatch(/grant execute on function public\.item_alt_sources\(integer\[\]\) to anon, authenticated;/);
    for (const f of ['item_recipes', 'quest_scripts_for_item']) {
      const other = stripSql(readRaw('supabase', 'migrations', f === 'item_recipes' ? '20260924141000_item_recipes.sql' : '20260924140000_quest_scripts_for_item.sql'));
      expect(other).not.toMatch(/security definer/i);
    }
    expect(sql).not.toMatch(/security definer/i);
  });
  it('reads only the reward direction of a script, and only recipes that MAKE the item', () => {
    expect(sql).toMatch(/\(QuestReward\|SummonItem\)/);
    expect(sql).not.toMatch(/check_turn_in|count_handed_item/);
    expect(sql).toMatch(/not bool_or\(coalesce\(e\.componentcount, 0\) > 0\)/);
    expect(sql).toMatch(/not bool_or\(coalesce\(e\.iscontainer, 0\) = 1\)/);
  });
  it('clips the array so a caller cannot ask for the catalog', () => {
    expect(sql).toMatch(/p_item_ids\[1:400\]/);
  });
});

describe('the whole thing on a monk chest slot', () => {
  it('lists Ton Po\'s Chestwraps (a quest combine) over Shroud of Longevity once the quest source exists', () => {
    const shroud = item({ id: 1137, name: 'Shroud of Longevity', classes: 64, ac: 20, hp: 100, agi: 15, str: 15, sta: 20 });
    const tonpo = item({ id: 32131, name: "Ton Po's Chestwraps of Composure", classes: 64, required_level: 65, ac: 45, hp: 210, agi: 30, str: 25, dex: 30, sta: 25 });
    const res = rankUpgrades({
      className: 'Monk', race: 'Human', equipped: [{ slot: 'Chest', item: shroud }], pool: [tonpo], levelCap: 65,
      caps: capsFor(ctxFor('Monk')),
    });
    const chest = res.find(r => r.slot === 'Chest');
    expect(chest.candidates.map(c => c.item.id)).toEqual([32131]);
    // without a source it falls out, exactly as before
    expect(selectTop(chest.candidates, new Map())).toEqual([]);
    const src = altSourcesFromRows([{
      item_id: 32131, kind: 'recipe', zone_short: null, zone_name: null, zone_expansion: null, npc_name: null,
      recipe_id: 13596, recipe_name: "Ton Po's Chestwraps Of Composure", tradeskill: 75, trivial: 0, must_learn: false,
      container_id: 17185, container_name: "Druzzil's Mystical Sewing Kit",
      components: [{ id: 16287, n: 'Cured Ethereal Energy', c: 2, s: 0 }, { id: 16275, n: 'Monk Emblem', c: 1, s: 0 }],
    }], new Map([[32131, tonpo]]), 4, 65);
    const top = selectTop(chest.candidates, src);
    expect(top).toHaveLength(1);
    expect(sourceLine(top[0].best)).toBe("Quest combine: Cured Ethereal Energy ×2, Monk Emblem in Druzzil's Mystical Sewing Kit");
  });
  it('every slot the finder works still has a card', () => {
    expect(UPGRADE_SLOTS.length).toBeGreaterThan(15);
    expect(scoreItem(null, resolveWeights('Monk', []), [])).toBe(0);
  });
});
