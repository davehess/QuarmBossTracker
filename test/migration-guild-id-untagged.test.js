// test/migration-guild-id-untagged.test.js — the step-2 segmentation migration stays additive and idempotent.
//
// A text test over the migration with comments stripped (its header names every excluded table and the words
// "backfill" and "delete"; a comment must not satisfy or trip an assertion). The file is a DRAFT until applied.
// Run: npx vitest run test/migration-guild-id-untagged.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripSql } from './_source-slice.js';

const FILE = '20261028170000_guild_id_on_untagged_tables.sql';
const raw = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', FILE), 'utf8');
const sql = stripSql(raw);
const stmts = sql.split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
const alters = stmts.filter((s) => /^alter table/i.test(s));

describe('guild_id on untagged tables migration', () => {
  it('is additive: no drop, delete, truncate, update, index, constraint or policy statements', () => {
    expect(sql).not.toMatch(/\b(drop|delete|truncate|update|create\s+(unique\s+)?index|add\s+constraint|policy)\b/i);
  });

  it('every statement is either the lock_timeout guard or a guarded add-column', () => {
    for (const s of stmts) {
      if (/^set local lock_timeout\b/i.test(s)) continue;
      expect(s).toMatch(/^alter table public\.[a-z_]+ add column if not exists guild_id text not null default 'wolfpack'$/i);
    }
  });

  it('tags each table exactly once and tags no eqemu_* mirror', () => {
    const tables = alters.map((s) => /^alter table public\.([a-z_]+)/i.exec(s)[1]);
    expect(tables.length).toBeGreaterThanOrEqual(30);
    expect(new Set(tables).size).toBe(tables.length);
    expect(tables.filter((t) => t.startsWith('eqemu_'))).toEqual([]);
  });

  it('leaves the shared catalogs and platform tables alone', () => {
    const tables = alters.map((s) => /^alter table public\.([a-z_]+)/i.exec(s)[1]);
    for (const t of ['spell_level_seed', 'travel_paths', 'zone_map_lines', 'sync_meta', 'anon_feedback', 'roadmap_votes']) {
      expect(tables).not.toContain(t);
    }
  });

  it('covers the tables the design names', () => {
    const tables = alters.map((s) => /^alter table public\.([a-z_]+)/i.exec(s)[1]);
    for (const t of ['contributions', 'encounter_players', 'loot_drops', 'wishlists', 'audit_log', 'combat_events',
      'wolfpack_members', 'wolfpack_roles', 'officer_notes', 'mimic_sessions', 'rh_signups', 'opendkp_raids']) {
      expect(tables).toContain(t);
    }
  });
});
