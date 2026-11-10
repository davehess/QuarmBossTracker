// Database hardening migration (2026-11-10): revokes, security_invoker views, pinned
// search_path, leftover probe dropped. Comments are stripped before matching because the
// header names the very things it deliberately leaves alone.
//
// Run: npx vitest run test/db-hardening-migration.test.js

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { ROOT, stripSql } from './_source-slice.js';

const sql = stripSql(fs.readFileSync(
  path.join(ROOT, 'supabase', 'migrations', '20261110010000_db_hardening_privileges.sql'), 'utf8'));

describe('db hardening migration', () => {
  it.each([
    'encounters_bump_from_loot', 'encounters_bump_from_players_del', 'encounters_bump_from_players_ins',
    'encounters_bump_from_players_upd', 'encounters_tombstone_on_delete',
  ])('revokes EXECUTE on %s from public, anon and authenticated', (fn) => {
    expect(sql).toMatch(new RegExp(`revoke execute on function public\\.${fn}\\(\\)\\s+from public, anon, authenticated;`));
  });
  it('leaves the two intentionally-callable functions alone', () => {
    expect(sql).not.toMatch(/is_guild_member/);
    expect(sql).not.toMatch(/opendkp_traffic_summary/);
  });
  it.each(['item_catalog_droppable', 'member_attendance_metrics', 'opendkp_character_id_to_name', 'trigger_text_audit'])(
    'switches view %s to security_invoker', (v) => {
      expect(sql).toMatch(new RegExp(`alter view public\\.${v}\\s+set \\(security_invoker = on\\);`));
    });
  it.each([
    'encounters_touch_updated_at()', 'bump_faction_standing(jsonb)', 'spell_scroll_sources(integer[])', 'merge_encounter_players(uuid)',
  ])('pins search_path on %s', (sig) => {
    expect(sql).toContain(`alter function public.${sig}`);
  });
  it('pins every function to public, pg_temp', () => {
    const n = (sql.match(/set search_path = public, pg_temp;/g) || []).length;
    expect(n).toBe(4);
  });
  it('drops the probe with IF EXISTS and never cascades', () => {
    expect(sql).toMatch(/drop function if exists public\._tmp_probe2_20261008\(\);/);
    expect(sql).not.toMatch(/cascade/i);
  });
  it('touches no data and builds no index', () => {
    expect(sql).not.toMatch(/\b(delete|update|insert|truncate)\b/i);
    expect(sql).not.toMatch(/create\s+(unique\s+)?index/i);
  });
});
