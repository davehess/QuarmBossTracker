// test/loot-pet-gear.test.js — gear a charmer hands to a charmed pet is not loot.
//
// The guild lead, 2026-10-09, on /admin/loot "By character": "when someone gives their charm pet items, they should
// not be counted as loot. Silver Jacinth ring has negative MR for charming, similar to Rusty Spiked Shoulderpads,
// Adamantium ring, or other pet weapons or haste items."
//
// The rule (one definition, two implementations): an item NAME is charm-pet gear when ANY eqemu_items row with that
// name has mr < 0, or its lower-cased name is in loot_pet_gear_names (officer-editable, ships empty).
//   SQL: supabase/migrations/20261009030000_loot_value_skip_pet_gear.sql (loot_value_rows, text assertions on the
//        comment-stripped file — the header names removed behaviour, so a comment must never satisfy these);
//   JS:  utils/lootValue.js (the Mimic Loot tab's per-looter totals), run for real against the cap fake.
// Item names are invented fixtures.
//
// Run: npx vitest run test/loot-pet-gear.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, readSource, stripSql, BOT_INDEX } from './_source-slice.js';
import { makeCapFake } from './_cap_fake_supabase.js';

const require_ = createRequire(BOT_INDEX);
const { lookupItemValues, loadPetGearNames, isPetGear, buildLootValue, _resetPriceCache } = require_('./utils/lootValue');

const MIG = path.join(ROOT, 'supabase', 'migrations');
const rawSql = readSource(path.join(MIG, '20261009030000_loot_value_skip_pet_gear.sql'));
const sql = stripSql(rawSql).replace(/\s+/g, ' ');
const prevSql = stripSql(readSource(path.join(MIG, '20261008210000_loot_value_nodrop_polarity.sql'))).replace(/\s+/g, ' ');

const NOW = Date.parse('2026-10-09T03:00:00Z');
const MIN = 60_000, HOUR = 3_600_000;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const lootRow = (looter, item, ago) => ({ looter_character: looter, item_name: item, zone: 'The Overthere', looted_at: iso(ago) });
// A catalog row; `mr` is the magic-resist stat. nodrop stays the mirror's inverted column (true = tradeable).
const itemRow = (id, name, price, mr) => ({ id, name, price, nodrop: true, mr });

beforeEach(() => { _resetPriceCache(); });

// ── SQL ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe('migration 20261009030000 — loot_value_rows', () => {
  it('keeps the exact signature and return columns of the version it replaces (no DROP FUNCTION)', () => {
    const head = (s) => s.match(/create or replace function public\.loot_value_rows\(.*?\) language sql/i)?.[0];
    expect(head(sql)).toBeTruthy();
    expect(head(sql)).toBe(head(prevSql));
    expect(sql).not.toMatch(/drop function/i);
  });

  it('creates loot_pet_gear_names with RLS on and no policy or grant for anon / authenticated', () => {
    expect(sql).toMatch(/create table if not exists public\.loot_pet_gear_names \( item_name text primary key, note text, created_at timestamptz not null default now\(\) \);/i);
    expect(sql).toMatch(/alter table public\.loot_pet_gear_names enable row level security;/i);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/\bgrant\b/i);
  });

  it('ships the table empty', () => {
    expect(sql).not.toMatch(/insert into/i);
  });

  it('decides pet gear once per DISTINCT name and anti-joins it, with no per-row probe of eqemu_items', () => {
    expect(sql).toMatch(/pet as \( select n\.item_name from names n where exists \(select 1 from eqemu_items i where i\.name = n\.item_name and i\.mr < 0\) or lower\(n\.item_name\) in \(select lower\(g\.item_name\) from loot_pet_gear_names g\) \)/i);
    expect(sql).toMatch(/left join pet on pet\.item_name = l\.item_name where pet\.item_name is null/i);
    // the final select reads eqemu_items only through the p CTE: nothing in it probes mr per looted row
    const tail = sql.slice(sql.lastIndexOf('select l.looter_lower'));
    const finalSelect = tail.slice(0, tail.indexOf('$$'));
    expect(finalSelect).not.toMatch(/eqemu_items/i);
    expect(finalSelect).not.toMatch(/\bmr\b/i);
  });

  it('keeps the DKP and price structure the previous round tuned', () => {
    for (const part of [
      /names as \(select distinct l\.item_name from l\)/i,
      /select distinct on \(i\.name\) i\.name, i\.price, i\.nodrop/i,
      /\(p\.nodrop = false\)/i,
      /interval '6 hours'/i, /interval '12 hours'/i,
    ]) {
      expect(sql).toMatch(part);
      expect(prevSql).toMatch(part);
    }
  });

  it('is idempotent: only IF NOT EXISTS / CREATE OR REPLACE / ENABLE RLS statements', () => {
    const noInline = stripSql(rawSql).replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');   // a trailing `-- note` after a statement
    const stmts = noInline.replace(/\$\$.*?\$\$/g, '$$$$').replace(/'[^']*'/g, "''").split(';').map(s => s.trim()).filter(Boolean);
    expect(stmts.length).toBe(4);
    for (const s of stmts) expect(s).toMatch(/^(create table if not exists|create or replace function|alter table public\.loot_pet_gear_names enable row level security|comment on function)/i);
  });

  it('downstream functions are not redefined here and are not touched: they read loot_value_rows', () => {
    expect(sql).not.toMatch(/loot_value_grouped|loot_value_by_looter_v3/i);
    for (const f of ['20261008190000_loot_value_grouped.sql']) {
      const s = stripSql(readSource(path.join(MIG, f))).replace(/\s+/g, ' ');
      expect(s).toMatch(/from loot_value_rows\(p_guild_id, p_since\) r group by r\.looter_lower, r\.item_name/i);
      expect(s).toMatch(/from loot_value_rows\(p_guild_id, p_since\) r group by r\.looter_lower order by/i);
      expect(s.slice(s.indexOf('function public.loot_value_grouped'))).not.toMatch(/from looted_items/i);
    }
  });
});

// ── JS definition ───────────────────────────────────────────────────────────────────────────────────────────
describe('lookupItemValues — the mr < 0 half of the rule', () => {
  it('flags a name whose row has mr < 0; mr 0 and mr null stay kept', async () => {
    const sb = makeCapFake({ tables: { eqemu_items: [
      itemRow(1, 'Rusty Band', 100, -10), itemRow(2, 'Plain Band', 100, 0), itemRow(3, 'Odd Band', 100, null), itemRow(4, 'Warded Band', 100, 7),
    ] } });
    const { values } = await lookupItemValues(sb, ['Rusty Band', 'Plain Band', 'Odd Band', 'Warded Band'], { nowMs: NOW });
    expect(values.get('Rusty Band').pet_gear).toBe(true);
    expect(values.get('Plain Band').pet_gear).toBe(false);
    expect(values.get('Odd Band').pet_gear).toBe(false);
    expect(values.get('Warded Band').pet_gear).toBe(false);
  });

  it('a name with mixed same-name rows (one mr < 0, lowest id mr 0) is pet gear', async () => {
    const sb = makeCapFake({ tables: { eqemu_items: [itemRow(14696, 'Jade Ring', 5000, -7), itemRow(16792, 'Jade Ring', 5000, 0)] } });
    const a = (await lookupItemValues(sb, ['Jade Ring'], { nowMs: NOW })).values.get('Jade Ring');
    expect(a.pet_gear).toBe(true);
    _resetPriceCache();
    const sb2 = makeCapFake({ tables: { eqemu_items: [itemRow(1, 'Jade Ring', 5000, 0), itemRow(2, 'Jade Ring', 5000, -7)] } });
    expect((await lookupItemValues(sb2, ['Jade Ring'], { nowMs: NOW })).values.get('Jade Ring').pet_gear).toBe(true);
  });

  it('asks the catalog for the mr column', async () => {
    const sb = makeCapFake({ tables: { eqemu_items: [] } });
    await lookupItemValues(sb, ['Anything'], { nowMs: NOW });
    expect(sb.calls.find(c => c.table === 'eqemu_items').qs).toMatch(/select=[^&]*\bmr\b/);
  });
});

describe('loadPetGearNames — the officer list, fail-open', () => {
  it('returns the names lower-cased', async () => {
    const sb = makeCapFake({ tables: { loot_pet_gear_names: [{ item_name: 'Haste Wand', note: 'x' }, { item_name: 'PET Spear' }] } });
    expect([...(await loadPetGearNames(sb))].sort()).toEqual(['haste wand', 'pet spear']);
  });

  it('a failed read (null) is an empty set, not an error', async () => {
    const sb = makeCapFake({ tables: {}, missing: ['loot_pet_gear_names'] });
    const s = await loadPetGearNames(sb);
    expect(s).toBeInstanceOf(Set);
    expect(s.size).toBe(0);
  });

  it('a thrown read is an empty set too', async () => {
    const s = await loadPetGearNames({ selectAllPaged: async () => { throw new Error('boom'); } });
    expect(s.size).toBe(0);
  });
});

describe('isPetGear', () => {
  it('table names match case-insensitively; the mr flag matches on its own; neither keeps the item', () => {
    const names = new Set(['haste wand']);
    expect(isPetGear('HASTE Wand', { pet_gear: false }, names)).toBe(true);
    expect(isPetGear('Plain Band', { pet_gear: true }, new Set())).toBe(true);
    expect(isPetGear('Plain Band', { pet_gear: false }, names)).toBe(false);
    expect(isPetGear('Unlisted', null, names)).toBe(false);
    expect(isPetGear('Unlisted', null, null)).toBe(false);
  });
});

describe('buildLootValue — pet gear is out of the totals', () => {
  const values = new Map([
    ['Cloak of Flames', { value_cp: 54000, nodrop: true, pet_gear: false }],
    ['Rusty Band', { value_cp: 9000, nodrop: true, pet_gear: true }],
    ['Haste Wand', { value_cp: 7000, nodrop: false, pet_gear: false }],
    ['Zero Ring', { value_cp: 100, nodrop: false, pet_gear: false }],
  ]);
  const rows = [
    lootRow('Aldenmar', 'Cloak of Flames', MIN),
    lootRow('Aldenmar', 'Rusty Band', 2 * MIN),
    lootRow('Brackwyn', 'Haste Wand', 3 * MIN),
    lootRow('Brackwyn', 'Zero Ring', 4 * MIN),
  ];

  it('leaves mr < 0 rows out of items, value, priced and unpriced; counts them in pet_gear_items', () => {
    const out = buildLootValue(rows, values, { nowMs: NOW, windowMs: 12 * HOUR, petGearNames: new Set() });
    expect(out.totals).toEqual([
      { looter: 'Aldenmar', items: 1, value_cp: 54000, nodrop_items: 1 },
      { looter: 'Brackwyn', items: 2, value_cp: 7100, nodrop_items: 0 },
    ]);
    expect(out.total_value_cp).toBe(61100);
    expect(out.priced_items).toBe(3);
    expect(out.unpriced_items).toBe(0);
    expect(out.pet_gear_items).toBe(1);
  });

  it('leaves a name on the officer list out, whatever its case', () => {
    const out = buildLootValue(rows, values, { nowMs: NOW, windowMs: 12 * HOUR, petGearNames: new Set(['haste wand']) });
    expect(out.totals.find(t => t.looter === 'Brackwyn')).toEqual({ looter: 'Brackwyn', items: 1, value_cp: 100, nodrop_items: 0 });
    expect(out.pet_gear_items).toBe(2);
  });

  it('a looter whose only loot was pet gear has no row at all', () => {
    const out = buildLootValue([lootRow('Corvale', 'Rusty Band', MIN)], values, { nowMs: NOW, windowMs: 12 * HOUR, petGearNames: new Set() });
    expect(out.totals).toEqual([]);
    expect(out.pet_gear_items).toBe(1);
  });

  it('with no list passed it falls back to the mr flag alone', () => {
    const out = buildLootValue(rows, values, { nowMs: NOW, windowMs: 12 * HOUR });
    expect(out.pet_gear_items).toBe(1);
  });
});

describe('end to end through the shipped panel body', () => {
  it('lookup + list + totals: the list keeps the rows, the totals drop them, a failed list read falls open', async () => {
    const { readSource: rs, sliceBlock, evalBlock } = await import('./_source-slice.js');
    const src = rs(BOT_INDEX);
    const bodyBlock = sliceBlock(src, 'async function _nightLootPanelBody', '// ── end night-loot panel fetch ──');
    globalThis.__petGearRequire = require_;
    const { _nightLootPanelBody } = evalBlock('const require = globalThis.__petGearRequire;\n' + bodyBlock, ['_nightLootPanelBody']);
    const tables = {
      roll_sets: [],
      looted_items: [
        { id: 1, guild_id: 'wolfpack', looter_character: 'Aldenmar', item_name: 'Cloak of Flames', zone: 'Z', looted_at: iso(MIN) },
        { id: 2, guild_id: 'wolfpack', looter_character: 'Aldenmar', item_name: 'Rusty Band', zone: 'Z', looted_at: iso(2 * MIN) },
        { id: 3, guild_id: 'wolfpack', looter_character: 'Aldenmar', item_name: 'Haste Wand', zone: 'Z', looted_at: iso(3 * MIN) },
      ],
      eqemu_items: [itemRow(1, 'Cloak of Flames', 54000, 0), itemRow(2, 'Rusty Band', 9000, -10), itemRow(3, 'Haste Wand', 7000, 0)],
      loot_pet_gear_names: [{ item_name: 'haste wand' }],
    };
    const out = await _nightLootPanelBody(makeCapFake({ tables }), 'wolfpack', NOW, 12);
    expect(out.loot.map(r => r.item).sort()).toEqual(['Cloak of Flames', 'Haste Wand', 'Rusty Band']);   // the list is unchanged
    expect(out.totals).toEqual([{ looter: 'Aldenmar', items: 1, value_cp: 54000, nodrop_items: 0 }]);
    expect(out.pet_gear_items).toBe(2);

    _resetPriceCache();
    const down = await _nightLootPanelBody(makeCapFake({ tables, missing: ['loot_pet_gear_names'] }), 'wolfpack', NOW, 12);
    expect(down.totals).toEqual([{ looter: 'Aldenmar', items: 2, value_cp: 61000, nodrop_items: 0 }]);   // mr rule alone
    expect(down.pet_gear_items).toBe(1);
  });
});
