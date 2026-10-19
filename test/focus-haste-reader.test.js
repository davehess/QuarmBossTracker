// test/focus-haste-reader.test.js — the bot's spell-haste focus reader finds foci in `focus_effect`.
//
// The guild lead, 2026-10-19 (DECISIONS §383, from §155 "Found, not fixed"): "fix the haste-focus
// reader". `_refreshFocusHaste` decoded eqemu_items.worneffect and found no spell-haste foci, though
// ~180 are held by ~100 characters — a spell-haste focus lives in the item's FOCUS slot. So the cast
// bar of every foci holder ran at catalog speed. Runs the REAL reader + `_focusHastePctFor` over a
// fake PostgREST. Shapes are copied from eqemu_items / eqemu_spells (Quickening of Druzzil: SPA 127 =
// 23%, limit 143 min cast 3000 ms; Affliction Haste II: limit 138 base 0 = detrimental only).
// Character names are invented.
//
// Run: npx vitest run test/focus-haste-reader.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, BOT_INDEX } from './_source-slice.js';
import { installFakePostgrest } from './_fake-fetch-postgrest.js';

const nodeRequire = createRequire(import.meta.url);
const supabase = nodeRequire('../utils/supabase.js');
const SRC = readSource(BOT_INDEX);
const botRequire = (m) => nodeRequire(m.startsWith('./') ? '../' + m.slice(2) : m);

const BLOCK = sliceBlock(SRC, 'let _focusHasteByChar = null;', '    .finally(() => { _focusHasteInflight = false; });\n}');
// _spellFxByName as the spell-effects catalog leaves it: good = 1 beneficial, 0 detrimental; dur in ticks.
const FX = `let _spellFxByName = new Map([
  ['healing wave',    { good: 1, dur: 0 }],
  ['sow',             { good: 1, dur: 60 }],
  ['fire strike',     { good: 0, dur: 0 }],
  ['venom of rot',    { good: 0, dur: 30 }],
]);`;
const load = () =>
  // eslint-disable-next-line no-new-func
  new Function('require', `${FX}\n${BLOCK}\nreturn { refresh: _refreshFocusHaste, pct: _focusHastePctFor, map: () => _focusHasteByChar };`)(botRequire);

const SPELLS = [
  { id: 3527, raw: { eff: [127, 134, 139, 143, 137], base: [23, 65, -13, 3000, -147] } },   // Quickening of Druzzil
  { id: 3533, raw: { eff: [127, 134, 139, 143, 138, 137], base: [30, 65, -13, 3000, 1, -147] } }, // beneficial only
  { id: 2361, raw: { eff: [127, 134, 140, 143, 138, 137], base: [33, 44, 6, 2000, 0, 0] } },  // detrimental only, 6+ ticks
  { id: 1229, raw: { eff: [127], base: [99] } },                                              // a haste spell as a WORN effect
];
const ITEMS = [
  { id: 32110, focus_effect: 3527, worneffect: 144 },     // the focus
  { id: 26983, focus_effect: 3533, worneffect: 1229 },    // focus + a (haste-shaped) worn effect: only the focus counts
  { id: 1412,  focus_effect: 2361, worneffect: -1 },
  { id: 777,   focus_effect: 0,    worneffect: 1229 },    // haste spell in the WORN slot: not a focus
  { id: 778,   focus_effect: 0,    worneffect: 0 },
];
const GEAR = [
  { guild_id: 'wolfpack', character: 'Aldenmar', loc: 'equipped', slot: 9,  item_id: 32110 },
  { guild_id: 'wolfpack', character: 'Brackwyn', loc: 'equipped', slot: 2,  item_id: 26983 },
  { guild_id: 'wolfpack', character: 'Corvale',  loc: 'equipped', slot: 4,  item_id: 1412 },
  { guild_id: 'wolfpack', character: 'Rethlan',  loc: 'equipped', slot: 4,  item_id: 777 },     // worn-slot haste only
  { guild_id: 'wolfpack', character: 'Nyssara',  loc: 'equipped', slot: 4,  item_id: 778 },
  { guild_id: 'wolfpack', character: 'Zarrin',   loc: 'bank',     slot: 1,  item_id: 32110 },   // not worn
];

let fake;
beforeEach(() => {
  delete process.env.SUPABASE_GUILD_ID;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  supabase._resetBreaker();
  fake = installFakePostgrest({ tables: { character_gear: GEAR, eqemu_items: ITEMS, eqemu_spells: SPELLS } });
});
afterEach(() => { fake && fake.restore(); fake = null; vi.restoreAllMocks(); });

describe('spell-haste foci are read from focus_effect', () => {
  it('a character wearing an item whose focus_effect is a haste spell has that focus', async () => {
    const { refresh, map } = load();
    await refresh();
    expect(map().get('aldenmar')).toEqual([{ pct: 23, minCastMs: 3000, minDurTicks: 0, beneficialOnly: false, detrimentalOnly: false }]);
  });

  it('the items lookup asks for focus_effect, not worneffect', async () => {
    const { refresh } = load();
    await refresh();
    const q = fake.calls.find(c => c.table === 'eqemu_items').query;
    expect(q).toContain('select=id,focus_effect');
    expect(q).not.toContain('worneffect');
  });

  it('a haste spell in the WORN slot is not a focus, and bank gear is not worn', async () => {
    const { refresh, map } = load();
    await refresh();
    expect(map().has('rethlan')).toBe(false);
    expect(map().has('nyssara')).toBe(false);
    expect(map().has('zarrin')).toBe(false);
    // an item with both: the focus spell is what is decoded (30%, not the 99% worn spell)
    expect(map().get('brackwyn')).toHaveLength(1);
    expect(map().get('brackwyn')[0].pct).toBe(30);
  });
});

describe('_focusHastePctFor — the cast bar gets the focus where its limits allow', () => {
  const ready = async () => { const l = load(); await l.refresh(); return l; };

  it('a focus holder gets the haste on a cast long enough; none on a short cast (min cast limit)', async () => {
    const { pct } = await ready();
    expect(pct('Aldenmar', 'Healing Wave', 6)).toBe(23);
    expect(pct('Aldenmar', 'Healing Wave', 2)).toBe(0);      // under the 3 s floor
  });

  it('a character with no focus, or an unknown one, gets nothing', async () => {
    const { pct } = await ready();
    expect(pct('Rethlan', 'Healing Wave', 6)).toBe(0);
    expect(pct('Nobody', 'Healing Wave', 6)).toBe(0);
  });

  it('beneficial-only focus: heals yes, detrimentals no', async () => {
    const { pct } = await ready();
    expect(pct('Brackwyn', 'Healing Wave', 6)).toBe(30);
    expect(pct('Brackwyn', 'Fire Strike', 6)).toBe(0);
  });

  it('detrimental-only focus (Affliction Haste): detrimentals with the min duration yes, beneficials no', async () => {
    const { pct } = await ready();
    expect(pct('Corvale', 'Venom of Rot', 4)).toBe(33);
    expect(pct('Corvale', 'Fire Strike', 4)).toBe(0);        // instant: under the 6-tick duration floor
    expect(pct('Corvale', 'Sow', 4)).toBe(0);                // beneficial
  });
});
