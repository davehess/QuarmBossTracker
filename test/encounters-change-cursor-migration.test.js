// test/encounters-change-cursor-migration.test.js — the change cursor behind GET /api/agent/local-sync.
//
// A text test over the migration (comments stripped: its header explains what it avoids, and a comment must not
// satisfy an assertion). The behaviour itself was run against a scratch Postgres 16 when the file was written:
// applied twice, backfill = ended_at, update / player insert / player delete / loot insert each bump the fight,
// a tombstone is written with and without a merged_into, and the keyset query plans on the new index.
// Run: npx vitest run test/encounters-change-cursor-migration.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripSql } from './_source-slice.js';

const FILE = '20261021120000_encounters_change_cursor.sql';
const raw = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', FILE), 'utf8');
const sql = stripSql(raw);
const norm = sql.replace(/\s+/g, ' ');

describe('encounters_change_cursor migration', () => {
  it('adds updated_at nullable first (no rewrite), defaults it, backfills only NULLs, then makes it NOT NULL', () => {
    const add = norm.indexOf('add column if not exists updated_at timestamptz;');
    const def = norm.indexOf('alter column updated_at set default clock_timestamp()');
    const fill = norm.search(/update public\.encounters set updated_at = coalesce\(ended_at, started_at, created_at, clock_timestamp\(\)\) where updated_at is null;/);
    const nn = norm.indexOf('alter column updated_at set not null');
    expect(add).toBeGreaterThan(-1);
    expect(def).toBeGreaterThan(add);
    expect(fill).toBeGreaterThan(def);
    expect(nn).toBeGreaterThan(fill);
    expect(norm).not.toMatch(/add column[^;]*updated_at[^;]*default/i);   // a volatile default on ADD COLUMN would rewrite the table
  });

  it('the stamp trigger is installed BEFORE the backfill and leaves an explicit updated_at alone', () => {
    expect(norm.indexOf('create trigger encounters_touch_updated_at')).toBeLessThan(norm.search(/update public\.encounters set updated_at = coalesce/));
    expect(norm).toMatch(/before update on public\.encounters for each row/);
    expect(norm).toMatch(/if new\.updated_at is not distinct from old\.updated_at then new\.updated_at := clock_timestamp\(\)/);
  });

  it('children bump the parent from statement-level transition tables, once per statement', () => {
    for (const ev of ['insert', 'update', 'delete']) {
      expect(norm).toMatch(new RegExp(`after ${ev} on public\\.encounter_players referencing [^;]*for each statement`));
    }
    expect(norm).toMatch(/after insert on public\.looted_items referencing new table as new_rows for each statement/);
    expect(norm).not.toMatch(/on public\.encounter_players for each row/);
    expect((norm.match(/e\.updated_at < transaction_timestamp\(\)/g) || []).length).toBe(4);
  });

  it('loot is bumped by time window (loot_drops is empty), with the same 20-minute tail the reader uses', () => {
    expect(norm).toMatch(/coalesce\(e\.ended_at, e\.started_at\) \+ interval '20 minutes' >= l\.looted_at/);
    const reader = fs.readFileSync(path.join(ROOT, 'utils', 'localSync.js'), 'utf8');
    expect(reader).toMatch(/LOOT_TAIL_MS = 20 \* 60_000/);
  });

  it('tombstones: a table, RLS on with no policy, an AFTER DELETE trigger, merged_into from a transaction setting', () => {
    expect(norm).toMatch(/create table if not exists public\.encounter_tombstones \( id uuid primary key, guild_id text not null, deleted_at timestamptz not null default clock_timestamp\(\), merged_into uuid \)/);
    expect(norm).toMatch(/alter table public\.encounter_tombstones enable row level security/);
    expect(norm).not.toMatch(/create policy/i);
    expect(norm).toMatch(/after delete on public\.encounters for each row execute function public\.encounters_tombstone_on_delete/);
    expect(norm).toMatch(/current_setting\('wolfpack\.merged_into', true\)/);
    expect(norm).toMatch(/exception when others then v_into := null/);
  });

  it('the keyset indexes match what the reader orders and filters by', () => {
    expect(norm).toMatch(/create index if not exists encounters_guild_updated_idx on public\.encounters \(guild_id, updated_at, id\)/);
    expect(norm).toMatch(/create index if not exists encounter_tombstones_guild_deleted_idx on public\.encounter_tombstones \(guild_id, deleted_at, id\)/);
    const reader = fs.readFileSync(path.join(ROOT, 'utils', 'localSync.js'), 'utf8');
    expect(reader).toContain('order=updated_at.asc,id.asc');
    expect(reader).toContain('order=deleted_at.asc,id.asc');
  });

  it('is idempotent: every create is guarded and nothing is dropped without IF EXISTS', () => {
    for (const m of sql.matchAll(/create\s+(table|index|trigger|function)\s+(?!if not exists|or replace)/gi)) {
      // triggers have no IF NOT EXISTS in Postgres 16: each must be preceded by its own drop ... if exists
      expect(m[1].toLowerCase()).toBe('trigger');
    }
    const triggers = [...sql.matchAll(/create trigger (\w+)/g)].map(m => m[1]);
    expect(triggers).toHaveLength(6);
    for (const t of triggers) expect(norm).toContain(`drop trigger if exists ${t} on`);
    expect(sql).not.toMatch(/drop\s+(table|column|index)/i);
  });

  it('every SECURITY DEFINER function pins its search_path', () => {
    const defs = sql.match(/security definer[^$]*\$\$/gi) || [];
    expect(defs.length).toBe(5);
    for (const d of defs) expect(d).toMatch(/set search_path = public/);
  });
});
