// test/sync-npc-sheet-columns.test.js — a mob's swing speed, stats and look reach eqemu_npc_types.
//
// The guild lead, 2026-10-13: "mob attack speed is in the data on PQDI. I presume we have all of the info for each
// mob in the database, including model and what it [looks like]". We had race/gender/texture/size but not
// attack_delay, the stats or the armour/weapon textures: the weekly sync (scripts/sync-from-eqmac.js) picks
// upstream columns BY NAME and never named them. Two silent failures to guard, as with the item/zone columns
// (test/sync-model-and-fog-columns.test.js): a migration column the transform never fills stays NULL forever, and
// a column the transform sends that no migration adds makes PostgREST refuse the whole upsert (PGRST204).
//
// Run: npx vitest run test/sync-npc-sheet-columns.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, readSource, stripSql } from './_source-slice.js';

const require = createRequire(import.meta.url);
const sync = require('../scripts/sync-from-eqmac.js');
const MIGRATION = stripSql(readSource(path.join(ROOT, 'supabase', 'migrations', '20261014040000_npc_types_combat_and_look.sql')));
const added = [...MIGRATION.matchAll(/add column if not exists (\w+)\s+\w+/gi)].map(m => m[1]);

// Grummus's real values as PQDI shows them (attack_delay 18, AC 675, STR 474 …), in a dump's mixed-case columns.
const COLS = ['id', 'name', 'AC', 'attack_delay', 'STR', '_INT', 'ATK', 'Accuracy', 'see_sneak', 'helmtexture',
  'd_melee_texture1', 'armortint_red', 'light'];
const ROW = [205091, 'Grummus', 675, 18, 474, 474, 0, 0, 1, 0, 0, 0, 0];

describe('eqemu_npc_types: attack speed, stats and look', () => {
  it('carries attack_delay and the stats from the dump row', () => {
    const out = sync.TRANSFORMS.npc_types(COLS, ROW);
    expect(out).toMatchObject({ id: 205091, ac: 675, attack_delay: 18, str: 474, int_stat: 474, see_sneak: true });
  });

  it('every new column the transform sends exists in the migration, and every migration column is sent', () => {
    const allCols = [...COLS, 'STA', 'DEX', 'AGI', 'WIS', 'CHA', 'avoidance', 'slow_mitigation', 'hp_regen_rate',
      'mana_regen_rate', 'combat_hp_regen', 'combat_mana_regen', 'npc_aggro', 'face', 'chesttexture', 'armtexture',
      'bracertexture', 'handtexture', 'legtexture', 'feettexture', 'armortint_green', 'armortint_blue',
      'd_melee_texture2', 'prim_melee_type', 'sec_melee_type', 'ranged_type'];
    const out = sync.TRANSFORMS.npc_types(allCols, allCols.map((c, i) => (c === 'id' ? 1 : c === 'name' ? 'x' : i)));
    for (const col of added) expect(out, `migration column ${col} never filled`).toHaveProperty(col);
  });

  it('a dump without the columns leaves them undefined, so JSON drops them and a stored value is never nulled', () => {
    const sent = JSON.parse(JSON.stringify(sync.TRANSFORMS.npc_types(['id', 'name'], [1, 'Old Dump Mob'])));
    for (const col of added) expect(sent, col).not.toHaveProperty(col);
  });
});
