// merge_encounter_players — concurrency migration (20261015040000).
//
// Two agent uploads for one encounter run the delete-then-reinsert RPC at the
// same time and the second INSERT 409s on encounter_players_pkey (raid night
// 2026-10-14). The fix serializes merges of the same encounter with a
// transaction-scoped advisory lock taken before anything is read or deleted.
// This pins the lock's presence and ORDER, and that the rest of the function —
// signature, security, the never-delete-what-it-cannot-rebuild guard — is
// unchanged from the migration it replaces.
//
// Run: npx vitest run test/merge-encounter-players-lock.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripSql } from './_source-slice.js';

const DIR = path.join(ROOT, 'supabase', 'migrations');
const NEW = '20261015040000_merge_encounter_players_concurrency.sql';
const PREV = '20260903121500_merge_players_never_deletes_what_it_cannot_rebuild.sql';

const norm = (s) => stripSql(s).replace(/\s+/g, ' ').trim().toLowerCase();
const sql = norm(fs.readFileSync(path.join(DIR, NEW), 'utf8'));
const prev = norm(fs.readFileSync(path.join(DIR, PREV), 'utf8'));

const LOCK = "perform pg_advisory_xact_lock(hashtext('merge_encounter_players:' || p_encounter_id::text));";

describe('merge_encounter_players concurrency migration', () => {
  it('is the newest migration that defines the function', () => {
    const defs = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')
      && /create (or replace )?function merge_encounter_players/i.test(stripSql(fs.readFileSync(path.join(DIR, f), 'utf8')))).sort();
    expect(defs[defs.length - 1]).toBe(NEW);
  });

  it('keeps the signature, return type, language and SECURITY DEFINER', () => {
    expect(sql).toContain('create or replace function merge_encounter_players(p_encounter_id uuid) returns void as $$');
    expect(sql).toMatch(/\$\$ language plpgsql security definer;$/);
  });

  it('takes a per-encounter transaction advisory lock', () => {
    expect(sql).toContain(LOCK);
  });

  it('takes the lock BEFORE reading contributions or deleting anything', () => {
    const lockAt = sql.indexOf(LOCK);
    expect(lockAt).toBeGreaterThan(sql.indexOf('begin'));
    expect(lockAt).toBeLessThan(sql.indexOf('select lower(replace'));
    expect(lockAt).toBeLessThan(sql.indexOf('select count(*) into v_rebuildable'));
    expect(lockAt).toBeLessThan(sql.indexOf('delete from encounter_players'));
  });

  it('is otherwise the previous function body (no semantic drift)', () => {
    const body = (s) => s.slice(s.indexOf('declare'));
    expect(body(sql).replace(LOCK, '').replace(/begin\s+/, 'begin ')).toBe(body(prev).replace(/begin\s+/, 'begin '));
  });

  it('still refuses to wipe rows it cannot rebuild', () => {
    expect(sql).toContain('if v_rebuildable = 0 then');
    expect(sql.indexOf('if v_rebuildable = 0')).toBeLessThan(sql.indexOf('delete from encounter_players'));
  });
});
