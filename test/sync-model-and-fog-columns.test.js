// test/sync-model-and-fog-columns.test.js — the catalog columns that make an item a model and a zone a look.
//
// The guild lead, 2026-10-05: "mostly the theme and the view of the area and how we look as characters so
// if we animate something in the future it looks good." eqemu_items.idfile/material/color/light say how
// an item is drawn on a body, and eqemu_zone's sky/clip/fog columns say how a zone looks. Both come from
// the weekly EQMacEmu sync (scripts/sync-from-eqmac.js), which picks upstream columns BY NAME — so the
// failure that matters is silent: a column in the migration the transform never picks stays NULL for
// ever, and a column the transform picks that the migration never adds makes PostgREST refuse the whole
// upsert (PGRST204) and fails the sync.
//
// The transforms are run for real. The migration is checked as text on stripSql.
//
// Run: npx vitest run test/sync-model-and-fog-columns.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, readSource, sliceArrayLiteral, stripSql } from './_source-slice.js';

const require = createRequire(import.meta.url);
const sync = require('../scripts/sync-from-eqmac.js');
const SYNC_SRC = readSource(path.join(ROOT, 'scripts', 'sync-from-eqmac.js'));
const MIGRATION = stripSql(readSource(path.join(ROOT, 'supabase', 'migrations', '20261006010000_eqemu_model_and_fog_columns.sql')));

// The `alter table <t> … add column if not exists a …, add column if not exists b …;` columns of one table.
function migrationColumns(table) {
  const m = new RegExp(`alter table public\\.${table}\\b([\\s\\S]*?);`, 'i').exec(MIGRATION);
  expect(m, `no alter table for ${table}`).not.toBeNull();
  return [...m[1].matchAll(/add column if not exists (\w+)\s+(\w+)/gi)].map(x => ({ name: x[1], type: x[2].toLowerCase() }));
}

describe('eqemu_items: idfile, material, color, light', () => {
  const cols = ['id', 'name', 'color', 'idfile', 'light', 'material', 'slots'];

  it('carries the four model columns from the dump row, whatever order the dump lists them in', () => {
    // 4294967168 is the largest real colour in the dump (0xFFFFFF80): it must stay a plain number.
    const out = sync.TRANSFORMS.items(cols, [5001, 'Corvale Robe', 4294967168, 'IT63', 7, 16, 131072]);
    expect(out).toMatchObject({ id: 5001, idfile: 'IT63', material: 16, color: 4294967168, light: 7 });
  });

  it('turns a numeric-looking idfile into a string (the dump has 29 items whose idfile is 0)', () => {
    const out = sync.TRANSFORMS.items(cols, [1, 'Odd Item', 0, 0, 0, 0, 0]);
    expect(out.idfile).toBe('0');
  });

  it('a dump without the columns leaves them undefined, so JSON drops them and a stored value is never nulled', () => {
    const out = sync.TRANSFORMS.items(['id', 'name'], [1, 'Old Dump Item']);
    const sent = JSON.parse(JSON.stringify(out));
    for (const k of ['idfile', 'material', 'color', 'light']) expect(sent, k).not.toHaveProperty(k);
  });

  it('the migration adds exactly those four, and colour is bigint because it is unsigned 32-bit', () => {
    const got = Object.fromEntries(migrationColumns('eqemu_items').map(c => [c.name, c.type]));
    expect(got).toEqual({ idfile: 'text', material: 'integer', color: 'bigint', light: 'integer' });
  });
});

describe('eqemu_zone: sky, clip distances and the five fog sets', () => {
  // The transform's own list of look columns, read from the shipped source.
  const LOOK = sliceArrayLiteral(SYNC_SRC, 'const ZONE_LOOK_COLS = [');

  it('picks sky, ztype, minclip, maxclip, underworld and fog_density, plus colour and clip for each of the five fog sets', () => {
    expect(LOOK).toEqual(expect.arrayContaining(['underworld', 'minclip', 'maxclip', 'sky', 'ztype', 'fog_density']));
    for (const n of ['', '1', '2', '3', '4']) {
      for (const c of ['fog_red', 'fog_green', 'fog_blue', 'fog_minclip', 'fog_maxclip']) expect(LOOK).toContain(c + n);
    }
    expect(LOOK).toHaveLength(6 + 5 * 5);
  });

  it('every look column of a dump row comes out of the transform under the upstream name', () => {
    const names = ['short_name', 'long_name', 'zoneidnumber', ...LOOK];
    const row = names.map((n, i) => (n === 'short_name' ? 'poinnovation' : n === 'long_name' ? 'Plane of Innovation' : n === 'zoneidnumber' ? 206 : i + 0.5));
    const out = sync.TRANSFORMS.zone(names, row);
    expect(out.short_name).toBe('poinnovation');
    expect(out.zone_id).toBe(206);
    for (const c of LOOK) expect(out[c], c).toBe(names.indexOf(c) + 0.5);
  });

  it('a dump that lacks them still yields a zone, with the keys absent rather than null', () => {
    const out = sync.TRANSFORMS.zone(['short_name', 'long_name', 'zoneidnumber'], ['x', 'X', 1]);
    const sent = JSON.parse(JSON.stringify(out));
    for (const c of LOOK) expect(sent, c).not.toHaveProperty(c);
  });

  it('the migration adds exactly the columns the transform picks (none missing, none extra)', () => {
    const cols = migrationColumns('eqemu_zone');
    expect(cols.map(c => c.name).sort()).toEqual([...LOOK].sort());
  });

  it('the types fit the data: colours and sky in smallint (0-255 / 0-17), distances in real', () => {
    const t = Object.fromEntries(migrationColumns('eqemu_zone').map(c => [c.name, c.type]));
    for (const c of Object.keys(t)) {
      const want = /^(fog_(red|green|blue)\d?|sky|ztype)$/.test(c) ? 'smallint' : 'real';
      expect(t[c], c).toBe(want);
    }
  });
});

describe('the migration', () => {
  it('only ever adds columns, each guarded with if not exists, and grants nothing', () => {
    expect(MIGRATION).not.toMatch(/\bdrop\b|create policy|\bgrant\b/i);
    const adds = MIGRATION.match(/add column/gi) || [];
    const guarded = MIGRATION.match(/add column if not exists/gi) || [];
    expect(adds.length).toBeGreaterThan(30);
    expect(guarded).toHaveLength(adds.length);
  });
});
