// test/item-card.test.js — FB-73: the compact item card Mimic's Target Info shows when a dropped item
// is hovered. Runs the real builder (utils/itemCard.js) on two rows read from the catalog, and checks
// the route that serves it (/api/agent/item-card).
//
// Run: npx vitest run test/item-card.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, BOT_INDEX, sliceBlock, stripJs } from './_source-slice.js';

const nodeRequire = createRequire(import.meta.url);
const { buildItemCard, itemCardSpellIds, ITEM_CARD_COLUMNS } = nodeRequire('../utils/itemCard.js');

// Rows as eqemu_items holds them (2026-10-10).
const WAND = { id: 21874, name: 'Blood Runed Battle Wand', lore: '*Blood Runed Battle Wand', nodrop: true, magic: true,
  slots: 8192, classes: 15360, races: 16383, required_level: 0, recommended_level: 56, ac: 0, hp: 70, mana: 70,
  damage: 21, delay: 24, str: 0, sta: 0, dex: 10, agi: 0, intel: 12, wis: 0, cha: 12, mr: 0, cr: 12, dr: 12, fr: 12, pr: 0,
  attack: null, haste: null, regen: null, manaregen: null, damageshield: null, weight: 30, price: 0,
  clickeffect: -1, clicklevel: 0, casttime: 0, proc_effect: 0, focus_effect: 3528, worneffect: 0 };
const RAGE = { id: 11057, name: 'Ragebringer', lore: '*Tainter of Souls', nodrop: false, magic: true, slots: 24576,
  classes: 256, races: 15595, required_level: 0, recommended_level: 0, ac: 0, hp: 100, mana: 0, damage: 15, delay: 25,
  str: 20, sta: 10, dex: 10, agi: 10, intel: 0, wis: 0, cha: 0, mr: 20, cr: 0, dr: 10, fr: 0, pr: 20, attack: 40, haste: 40,
  regen: null, manaregen: null, damageshield: null, weight: 25, price: 1, clickeffect: 0, clicklevel: 0, casttime: 0,
  proc_effect: 0, focus_effect: 0, worneffect: 1927 };

describe('buildItemCard', () => {
  it('reads a caster weapon the way the in-game card does', () => {
    const c = buildItemCard(WAND, new Map([[3528, 'Spell Focus Name']]));
    expect(c.id).toBe(21874);
    expect(c.name).toBe('Blood Runed Battle Wand');
    expect(c.flags).toBe('MAGIC ITEM · LORE ITEM');                 // nodrop true = tradeable, so no NO DROP
    expect(c.lines).toContain('Slot: PRIMARY');
    expect(c.lines).toContain('DMG: 21   Delay: 24');
    expect(c.lines).toContain('HP: +70   Mana: +70');
    expect(c.lines).toContain('DEX +10  INT +12  CHA +12');
    expect(c.lines).toContain('CR +12  DR +12  FR +12');
    expect(c.lines).toContain('Class: NEC WIZ MAG ENC');
    expect(c.lines).toContain('Race: ALL');                         // the classic 14, no Froglok
    expect(c.lines).toContain('Recommended level: 56');
    expect(c.lines).toContain('Focus: Spell Focus Name');
    expect(c.lines).toContain('WT: 3');
    expect(c.lines.some((l) => l.startsWith('Click:'))).toBe(false); // clickeffect -1 = none
  });

  it('marks an item NO DROP when the (inverted) tradeable column is false', () => {
    const c = buildItemCard(RAGE, new Map([[1927, 'Some Worn Spell']]));
    expect(c.flags).toBe('MAGIC ITEM · LORE ITEM · NO DROP');
    expect(c.lines).toContain('Slot: PRIMARY SECONDARY');
    expect(c.lines).toContain('Atk +40  Haste +40%');
    expect(c.lines).toContain('Worn: Some Worn Spell');
    expect(c.lines).toContain('WT: 2.5   Value: 1 cp');
  });

  it('says "spell #id" when a spell name is not known, and lists only the effect ids it needs', () => {
    expect(buildItemCard(RAGE, new Map()).lines).toContain('Worn: spell #1927');
    expect(itemCardSpellIds(RAGE)).toEqual([1927]);
    expect(itemCardSpellIds(WAND)).toEqual([3528]);
    expect(itemCardSpellIds({ clickeffect: 5, proc_effect: 5, focus_effect: 6 })).toEqual([5, 6]);
  });

  it('shows a click effect with its level and cast time', () => {
    const c = buildItemCard({ ...WAND, clickeffect: 4, clicklevel: 51, casttime: 3000, focus_effect: 0 }, { 4: 'Gate' });
    expect(c.lines).toContain('Click: Gate (level 51) · cast 3s');
  });

  it('paired slots read once, and an all-classes item reads ALL', () => {
    const c = buildItemCard({ id: 1, name: 'Ring', slots: 98304, classes: 32767, races: 32767 }, null);
    expect(c.lines).toContain('Slot: FINGER');
    expect(c.lines).toContain('Class: ALL');
    expect(c.lines).toContain('Race: ALL');
  });

  it('is null for a row with no id or name', () => {
    expect(buildItemCard(null, null)).toBe(null);
    expect(buildItemCard({ id: 5 }, null)).toBe(null);
  });

  it('selects every column it reads', () => {
    for (const k of ['nodrop', 'lore', 'slots', 'classes', 'races', 'clickeffect', 'proc_effect', 'focus_effect', 'worneffect', 'intel', 'price']) {
      expect(ITEM_CARD_COLUMNS.split(',')).toContain(k);
    }
  });
});

describe('GET /api/agent/item-card', () => {
  const code = stripJs(readSource(BOT_INDEX));
  const handler = sliceBlock(code, 'async function _handleAgentItemCard(req, res) {', "res.end(JSON.stringify({ ok: true, card }));\n}");

  it('is behind agent auth, wants an id, and never caches a failed read', () => {
    expect(handler).toMatch(/mimicLink\.requireAgentAuth\(req, res\)/);
    expect(handler).toMatch(/!Number\.isInteger\(itemId\) \|\| itemId <= 0\) \{ res\.writeHead\(400\)/);
    // the 503 returns before anything is written to the cache
    expect(handler.indexOf('writeHead(503')).toBeGreaterThan(-1);
    expect(handler.indexOf('writeHead(503')).toBeLessThan(handler.indexOf('_itemCardCache.set('));
  });

  it('reads the item row and then only the spells it names', () => {
    expect(handler).toMatch(/supabase\.select\('eqemu_items', `id=eq\.\$\{itemId\}&select=\$\{itemCard\.ITEM_CARD_COLUMNS\}&limit=1`\)/);
    expect(handler).toMatch(/supabase\.select\('eqemu_spells', `id=in\.\(\$\{spellIds\.join\(','\)\}\)&select=id,name`\)/);
  });

  it('is wired to the request router', () => {
    expect(code).toMatch(/req\.url\.startsWith\('\/api\/agent\/item-card'\)\) \{\s*\n\s*try \{ return await _handleAgentItemCard\(req, res\); \}/);
  });
});
