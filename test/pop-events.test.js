// test/pop-events.test.js — /pop/events: the event list, the item score and the event ranking (the guild lead,
// 2026-10-30: "a repository of those events … include the loot that can drop and the percentages. Give item scores to
// each item and then add a ranking").
//
// The scoring (web/lib/popEventsScore.ts) is pure, so these are BEHAVIOUR tests on small fixtures: build items, score
// them, rank events. The event list (web/lib/popEvents.ts) is checked for integrity, not for content. The tuning
// numbers (more for procs and focus, attack doubled for melee) are each pinned on their own.
//
// Run: npx vitest run test/pop-events.test.js

import { describe, it, expect } from 'vitest';
import { EVENTS, QUESTS_SHA, parseCite, citeUrl, eventBySlug, eventZones, eventNpcIds } from '../web/lib/popEvents.ts';
import {
  EVENT_SCORE_TUNING, SCORE_CLASSES, BIG_INDEX, HELPS_INDEX, rawByClass, scoreItems, evaluateEvent, rankEvents,
  classFromToken, classToken, sortFromParam, dkpByName, tuningNotes,
} from '../web/lib/popEventsScore.ts';
import { scoreItem, resolveWeights, effectiveValue } from '../web/lib/gearUpgrades.ts';
import { capsFor, NO_AA } from '../web/lib/gearCaps.ts';
import { STAT_UNIT } from '../web/lib/gearWeights.ts';
import { GUIDE_ITEMS } from '../web/lib/popGuide.ts';
import { metaForPath } from '../web/lib/pageMeta.ts';

const ALL = 32767;
let nextId = 1;
const item = (o = {}) => ({
  id: nextId++, name: null, slots: 4, classes: ALL, races: 16383, required_level: 0, itemtype: 10,
  ac: null, hp: null, mana: null, damage: null, delay: null,
  str: null, sta: null, agi: null, dex: null, wis: null, intel: null, cha: null,
  mr: null, cr: null, dr: null, fr: null, pr: null,
  attack: null, haste: null, regen: null, manaregen: null, damageshield: null,
  focus_effect: null, worneffect: null, proc_effect: null, clickeffect: null,
  ...o,
});

describe('the event list', () => {
  it('has unique slugs and every event names its zone, kind and a way in', () => {
    const slugs = EVENTS.map(e => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(EVENTS.length).toBeGreaterThanOrEqual(100);
    for (const e of EVENTS) {
      expect(e.slug, e.slug).toMatch(/^[a-z0-9-]+$/);
      expect(e.zone, e.slug).toBeTruthy();
      expect(e.zoneName, e.slug).toBeTruthy();
      expect(['flag', 'raid-boss', 'optional'], e.slug).toContain(e.kind);
      expect(e.name && e.start && e.timers, e.slug).toBeTruthy();
      expect(Array.isArray(e.mechanics) && Array.isArray(e.npcs) && Array.isArray(e.rewards), e.slug).toBe(true);
      for (const n of e.npcs) {
        expect(Number.isInteger(n.npcId) && n.npcId > 0, `${e.slug} ${n.name}`).toBe(true);
        expect(n.name, e.slug).not.toMatch(/_|^#/);
        if (n.kills != null) expect(n.kills, `${e.slug} ${n.name}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('cites every event to well-formed script lines that link to the pinned commit', () => {
    for (const e of EVENTS) {
      // three entries are loot-only mobs no script touches; they say so, and cite nothing
      if (e.cites.length === 0) expect(`${e.start} ${e.kindWhy}`, e.slug).toMatch(/no script/i);
      for (const c of e.cites) {
        const p = parseCite(c);
        expect(p, `${e.slug}: ${c}`).not.toBeNull();
        expect(p.path.endsWith('.lua'), c).toBe(true);
        expect(p.to, c).toBeGreaterThanOrEqual(p.from);
        const url = citeUrl(c);
        expect(url, c).toContain(`https://github.com/SecretsOTheP/quests/blob/${QUESTS_SHA}/`);
        expect(url, c).toMatch(new RegExp(`#L${p.from}-L${p.to}$`));
        expect(url.slice(0, url.indexOf('#L')), c).not.toMatch(/[`,]|#$/);   // the script names' backticks, commas and # are encoded
      }
    }
    expect(parseCite('postorms/encounters/Relv.lua:107-132')).toEqual({ path: 'postorms/encounters/Relv.lua', from: 107, to: 132 });
    expect(parseCite('postorms/encounters/Relv.lua:5')).toEqual({ path: 'postorms/encounters/Relv.lua', from: 5, to: 5 });
    expect(parseCite('postorms/encounters/Relv.lua:9-3')).toBeNull();
    expect(parseCite('nonsense')).toBeNull();
    expect(citeUrl('poair/#Queen_Silandria.lua:1-30')).toContain('poair/%23Queen_Silandria.lua#L1-L30');
  });

  it('carries the Falto event with the numbers the script gives', () => {
    const f = eventBySlug('postorms-relv-falto');
    expect(f.kind).toBe('optional');
    expect(f.zone).toBe('postorms');
    const falto = f.npcs.find(n => n.npcId === 210470);
    expect(falto).toMatchObject({ name: 'Falto, Lord of Thunder', level: 70, hp: 305000 });
    expect(f.npcs.find(n => n.npcId === 210459).kills).toBe(15);
    expect(f.rewards.map(r => r.itemId)).toContain(7755);
    expect(eventNpcIds()).toContain(210470);
    expect(eventZones().find(z => z.zone === 'postorms').count).toBeGreaterThanOrEqual(5);
  });

  // The guild lead, 2026-10-30: "The bits that are more technical up here (PusEventStarter and ID) are not really
  // worth displaying for everyone." Every text field the page prints is plain raider English. Ids stay in the data
  // (npcId and itemId feed the PQDI links and the loot reads); they never appear in a sentence.
  const TECHNICAL = [
    [/\b\d{5,}\b/, 'a bare id or a millisecond count (write 40 minutes, or 50,000 with its comma)'],
    [/\bms\b/i, 'milliseconds'],
    [/\beq\./, 'a script call'],
    [/#/, 'a # name prefix'],
    [/_/, 'an underscore in a name'],
    [/\b(signal|controller|spawn2|depop|qglobal|unique_spawn|spawn_condition|MovePC|GMMove|PusEventStarter)\w*/i, 'a script word'],
    [/\b(npc|item|spawn|zone) ?id\b|\bid \d/i, 'an id'],
  ];
  const technicalIn = (text) => TECHNICAL.filter(([re]) => re.test(text)).map(([, why]) => why);
  // every string the page prints about an event, outside the loot tables the database fills
  const shownText = (e) => [
    ['name', e.name], ['kindWhy', e.kindWhy], ['start', e.start], ['timers', e.timers],
    ['groupLimit', e.groupLimit ?? ''], ['size', e.size ?? ''],
    ...e.mechanics.map((m, i) => [`mechanics[${i}]`, m]),
    ...e.rewards.flatMap((r, i) => [[`rewards[${i}].name`, r.name], [`rewards[${i}].trigger`, r.trigger]]),
    ...e.npcs.flatMap((n, i) => [[`npcs[${i}].name`, n.name], [`npcs[${i}].killsNote`, n.killsNote ?? '']]),
  ];

  it('prints no id, no script word and no raw timer in an event’s text', () => {
    const bad = [];
    for (const e of EVENTS) for (const [field, text] of shownText(e)) {
      for (const why of technicalIn(text)) bad.push(`${e.slug} ${field}: ${why}: ${text.slice(0, 80)}`);
    }
    expect(bad).toEqual([]);
  });

  it('the plain-words check catches what it is for and passes real raider text', () => {
    for (const bad of [
      'Enter the proximity: BanordEnter signals the controller (PusEventStarter 200218).',
      'wave timer 234000 ms', 'calls eq.spawn2 on the pad', '#Overlord_Banord_Paffa', 'Foul_Pusling', 'npc id 200252',
      'a depop timer', 'set the qglobal',
    ]) expect(technicalIn(bad), bad).not.toEqual([]);
    for (const good of [
      'A wave of puslings comes every 3 min 54 s. The raid has 40 minutes to kill Overlord Banord Paffa (level 70, 1,000,000 HP).',
      'Hand in the Lightning Crystals for 50,000 experience. Go to /loc 5469, -574.', 'Rydda`Dar leaves after 56 seconds.',
    ]) expect(technicalIn(good), good).toEqual([]);
  });

  it('tells the Banord Paffa event in minutes, from the script’s numbers', () => {
    const p = eventBySlug('codecay-paffa');
    expect(p.start).toMatch(/first player/i);
    expect(p.timers).toMatch(/3 min 54 s/);
    expect(p.timers).toMatch(/40 minutes/);
    expect(p.timers).toMatch(/10 minutes/);
    expect(p.timers).toMatch(/3 days/);
    expect(p.mechanics.join(' ')).toMatch(/25% chance to be a Corrupted Pusling/);
  });

  it('is what the PoP guide step links to, and the page unfurls with its own name', () => {
    const step = GUIDE_ITEMS.find(i => i.key === 'storms_relv_falto');
    expect(step.title).toMatch(/^Optional: /);
    expect(step.flag).toBeUndefined();               // the script sets no flag
    const m = /^\/pop\/events#(.+)$/.exec(step.link.href);
    expect(m, step.link.href).not.toBeNull();
    expect(eventBySlug(m[1])).toBeTruthy();
    expect(metaForPath('/pop/events').title).toBe('[beta] PoP events');
  });
});

describe('the item score', () => {
  // Armour-class-only items: raw points are proportional to AC, so the indexes are exact.
  const big = item({ ac: 20 });
  const half = item({ ac: 10 });
  const token = item({ slots: 0, ac: 99 });                       // not wearable: no score even with stats
  const scores = scoreItems([big, half, token]);

  it('scales to 100 for the best item of each class and proportionally below', () => {
    expect(scores.get(big.id).best).toBeCloseTo(100, 6);
    expect(scores.get(half.id).best).toBeCloseTo(50, 6);
    for (const cls of SCORE_CLASSES) {
      expect(scores.get(big.id).idx[cls], cls).toBeCloseTo(100, 6);
      expect(scores.get(half.id).idx[cls], cls).toBeCloseTo(50, 6);
    }
    expect(scores.get(big.id).top).toHaveLength(3);
  });

  it('gives an item nobody can use, or that cannot be worn, no score and keeps it out of the maximum', () => {
    const t = scores.get(token.id);
    expect(t.wearable).toBe(false);
    expect(t.best).toBe(0);
    expect(t.idx).toEqual({});
    expect(rawByClass(token)).toEqual({});
    const nobody = item({ ac: 50, classes: 0 });
    expect(scoreItems([big, nobody]).get(nobody.id).best).toBe(0);
    expect(scoreItems([big, nobody]).get(big.id).best).toBeCloseTo(100, 6);   // an unusable item never lowers the others
  });

  it('only scores the classes the item allows', () => {
    const warriorOnly = item({ ac: 20, classes: 1 });
    expect(Object.keys(rawByClass(warriorOnly))).toEqual(['Warrior']);
  });
});

describe('the event tuning: procs, focus and attack', () => {
  const caps = (cls) => capsFor({ level: 65, base: cls, attrEnd: 'high', aa: NO_AA });
  const raw = (it, cls) => rawByClass(it)[cls];
  const T = EVENT_SCORE_TUNING;

  it('adds the focus bonus in place of the finder’s flat 2: caster 35, hybrid 20, pure melee 5', () => {
    const plain = item({ ac: 10 });
    const focus = item({ ac: 10, focus_effect: 4000 });
    expect(raw(focus, 'Cleric') - raw(plain, 'Cleric')).toBeCloseTo(35, 9);
    expect(raw(focus, 'Wizard') - raw(plain, 'Wizard')).toBeCloseTo(35, 9);
    expect(raw(focus, 'Paladin') - raw(plain, 'Paladin')).toBeCloseTo(20, 9);
    expect(raw(focus, 'Bard') - raw(plain, 'Bard')).toBeCloseTo(20, 9);
    expect(raw(focus, 'Warrior') - raw(plain, 'Warrior')).toBeCloseTo(5, 9);
    expect(T.focus).toEqual({ caster: 35, hybrid: 20, other: 5 });
  });

  it('adds the proc bonus in place of the flat 1: melee 30, a melee weapon 45, everyone else 5', () => {
    const plain = item({ ac: 10 });
    const proc = item({ ac: 10, proc_effect: 5000 });
    expect(raw(proc, 'Rogue') - raw(plain, 'Rogue')).toBeCloseTo(30, 9);
    expect(raw(proc, 'Beastlord') - raw(plain, 'Beastlord')).toBeCloseTo(30, 9);
    expect(raw(proc, 'Cleric') - raw(plain, 'Cleric')).toBeCloseTo(5, 9);
    expect(raw(proc, 'Enchanter') - raw(plain, 'Enchanter')).toBeCloseTo(5, 9);
    const weapon = item({ damage: 20, delay: 30 });
    const procWeapon = item({ damage: 20, delay: 30, proc_effect: 5000 });
    expect(raw(procWeapon, 'Warrior') - raw(weapon, 'Warrior')).toBeCloseTo(45, 9);
    expect(raw(procWeapon, 'Monk') - raw(weapon, 'Monk')).toBeCloseTo(45, 9);
    expect(raw(procWeapon, 'Magician') - raw(weapon, 'Magician')).toBeCloseTo(5, 9);   // a caster gets the small bonus even on a weapon
    expect(T.proc).toEqual({ melee: 30, meleeWeapon: 45, other: 5 });
  });

  it('counts a melee class’s attack twice, under the same 250 cap, and nobody else’s', () => {
    const atk = item({ attack: 40 });
    const w = (cls) => resolveWeights(cls, []);
    const finder = (cls) => scoreItem(atk, w(cls), [], caps(cls));
    // the finder's contribution is 40 × 0.2 × 2 (Warrior 'high') = 16; the page adds the same again
    expect(finder('Warrior')).toBeCloseTo(40 * STAT_UNIT.attack * w('Warrior').attack, 9);
    expect(raw(atk, 'Warrior')).toBeCloseTo(2 * finder('Warrior'), 9);
    expect(raw(atk, 'Ranger')).toBeCloseTo(2 * finder('Ranger'), 9);
    expect(raw(atk, 'Cleric')).toBeCloseTo(finder('Cleric'), 9);                      // not melee: untouched
    // the cap logic is the finder's: 300 attack counts only 250, then doubles
    const huge = item({ attack: 300 });
    expect(effectiveValue(huge, 'attack', [], caps('Warrior'))).toBe(250);
    expect(raw(huge, 'Warrior')).toBeCloseTo(2 * scoreItem(huge, w('Warrior'), [], caps('Warrior')), 9);
    expect(T.attackMultiplier).toBe(2);
  });

  it('says what it did, for the tooltip', () => {
    const it1 = item({ focus_effect: 1, proc_effect: 1, attack: 10 });
    expect(tuningNotes(it1, 'Warrior')).toEqual(['+5 focus', '+30 proc', 'ATK ×2']);
    expect(tuningNotes(it1, 'Cleric')).toEqual(['+35 focus', '+5 proc']);
    expect(tuningNotes(item({ ac: 5 }), 'Warrior')).toEqual([]);
    const s = scoreItems([item({ ac: 1 }), it1]).get(it1.id);
    expect(Array.isArray(s.notes)).toBe(true);
  });
});

describe('the event value and ranking', () => {
  const a = item({ ac: 20 });            // index 100 everywhere
  const b = item({ ac: 10 });            // index 50 everywhere
  const warrior = item({ ac: 30, classes: 1 });   // only a Warrior can use it
  const token = item({ slots: 0 });
  const scores = scoreItems([a, b, warrior, token]);
  const drop = (npc_id, it, effective_chance, multiplier = 1) => ({ npc_id, item_id: it.id, item_name: `i${it.id}`, effective_chance, multiplier });
  const drops = new Map([
    [1, [drop(1, a, 20), drop(1, b, 40, 2), drop(1, token, 100)]],
    [2, [drop(2, a, 10)]],
    [3, [drop(3, warrior, 50)]],
  ]);
  const ev = { slug: 'x', npcs: [{ npcId: 1 }, { npcId: 2, kills: 3 }] };

  it('adds kills × rolls × chance × score over every drop', () => {
    const r = evaluateEvent(ev, drops, scores);
    // npc 1: 0.20 × 100 + 0.40 × 2 rolls × 50 = 60 · npc 2: 3 kills × 0.10 × 100 = 30
    expect(r.value).toBeCloseTo(90, 9);
    expect(r.best).toMatchObject({ itemId: a.id, index: 100, chance: 20 });
    expect(r.wearables).toBe(3);                          // a, b, a again; the token is loot, not gear
  });

  it('counts a token as loot but not as value', () => {
    const r = evaluateEvent(ev, drops, scores);
    const t = r.lines.find(l => l.itemId === token.id);
    expect(t).toMatchObject({ wearable: false, index: 0, chance: 100 });
    const without = evaluateEvent(ev, new Map([[1, drops.get(1).filter(d => d.item_id !== token.id)], [2, drops.get(2)]]), scores);
    expect(r.value).toBeCloseTo(without.value, 9);
  });

  it('works out the chance of at least one big item in a run', () => {
    const r = evaluateEvent(ev, drops, scores);
    // only `a` reaches BIG_INDEX: it misses 0.8 on npc 1 and 0.9 three times on npc 2
    expect(BIG_INDEX).toBe(80);
    expect(r.bigOdds).toBeCloseTo(1 - 0.8 * 0.9 ** 3, 9);
    const none = evaluateEvent({ slug: 'n', npcs: [{ npcId: 9 }] }, new Map(), scores);
    expect(none).toMatchObject({ value: 0, best: null, helps: 0, bigOdds: 0 });
  });

  it('counts the classes a drop helps at the HELPS threshold', () => {
    expect(HELPS_INDEX).toBe(50);
    const r = evaluateEvent(ev, drops, scores);
    expect(r.helps).toBe(SCORE_CLASSES.length);                                       // `a` is 100 for everyone
    const onlyWarrior = evaluateEvent({ slug: 'w', npcs: [{ npcId: 3 }] }, drops, scores);
    expect(onlyWarrior.helps).toBe(1);
  });

  it('rescoring for a class values only what that class can use', () => {
    const ev3 = { slug: 'y', npcs: [{ npcId: 3 }, { npcId: 2 }] };
    expect(evaluateEvent(ev3, drops, scores, 'Warrior').value).toBeCloseTo(0.5 * 100 + 0.1 * (100 * 20) / 30 , 6);
    expect(evaluateEvent(ev3, drops, scores, 'Cleric').value).toBeCloseTo(0.1 * 100 * 20 / 20, 6);   // the Warrior-only item is worth nothing to a Cleric
  });

  it('orders by value by default, and by the sort asked for, with the slug as the last tie-break', () => {
    const evs = [
      { slug: 'low', npcs: [{ npcId: 2 }] },                 // 10
      { slug: 'high', npcs: [{ npcId: 1 }] },                // 60
      { slug: 'wide', npcs: [{ npcId: 3 }] },                // 50 for a Warrior
      { slug: 'alpha', npcs: [{ npcId: 2 }] },               // ties 'low' on every key
    ];
    expect(rankEvents(evs, drops, scores).map(r => r.slug)).toEqual(['high', 'wide', 'alpha', 'low']);
    expect(rankEvents(evs, drops, scores, { sort: 'breadth' }).map(r => r.slug)).toEqual(['high', 'alpha', 'low', 'wide']);
    // 'big' puts the one with the best chance of an 80+ drop first
    expect(rankEvents(evs, drops, scores, { sort: 'big' })[0].slug).toBe('wide');
    // a class filter re-ranks: for a Cleric the Warrior-only event is worthless
    expect(rankEvents(evs, drops, scores, { cls: 'Cleric' }).map(r => r.slug).at(-1)).toBe('wide');
    // for a Warrior the Warrior-only item is the page's best (index 100) and the plain ones fall to 67 and 33
    expect(rankEvents(evs, drops, scores, { cls: 'Warrior' })[0].slug).toBe('wide');
    expect(rankEvents(evs, drops, scores, { cls: 'Warrior' })[1].value).toBeCloseTo(0.2 * (100 * 20 / 30) + 0.8 * (100 * 10 / 30), 6);
  });

  it('reads the url params safely', () => {
    expect(sortFromParam('best')).toBe('best');
    expect(sortFromParam('nonsense')).toBe('value');
    expect(sortFromParam(undefined)).toBe('value');
    expect(classFromToken('shadowknight')).toBe('Shadow Knight');
    expect(classFromToken('WARRIOR')).toBe('Warrior');
    expect(classFromToken('berserker')).toBeNull();
    expect(classToken('Shadow Knight')).toBe('shadowknight');
  });

  it('averages the DKP paid by item name, counting the awards', () => {
    const m = dkpByName([
      { item_name: 'Tempest Mace', dkp: 10 }, { item_name: 'tempest mace', dkp: 21 }, { item_name: 'Other', dkp: null }, { item_name: null, dkp: 5 },
    ]);
    expect(m.get('tempest mace')).toEqual({ avg: 16, n: 2 });
    expect(m.get('other')).toEqual({ avg: 0, n: 1 });
    expect(m.size).toBe(2);
  });
});
