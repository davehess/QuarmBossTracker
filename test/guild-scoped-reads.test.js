// test/guild-scoped-reads.test.js — read policies mean "current member of THIS row's guild".
// Source-text checks on supabase/migrations/20261110120000_guild_scoped_reads.sql (comments stripped first, so the
// header cannot satisfy an assertion). Behaviour is checked by supabase/tests/two_guild_rls.sql, run by hand.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { stripSql } from './_source-slice.js';

const SQL = stripSql(fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20261110120000_guild_scoped_reads.sql'), 'utf8'));
const stmts = SQL.split(';').map((s) => s.trim()).filter(Boolean);
const policies = stmts.filter((s) => /^create policy/i.test(s));

// Tables with a guild_id column whose member-only read moved to is_member_of(guild_id).
const MEMBER_TABLES = [
  'agent_clock_offsets', 'bosses_local', 'character_aas', 'character_gear', 'character_live_state',
  'character_lockouts', 'characters', 'charm_sessions', 'combat_events', 'common_macros', 'comp_templates',
  'contributions', 'crash_reports', 'encounter_combat_rollup', 'encounter_events', 'encounter_players',
  'encounter_threat_rank', 'encounters', 'faction_cons', 'faction_hits', 'faction_standing', 'fight_cards',
  'guild_rules', 'hate_kills', 'kite_loops', 'loot_drops', 'looted_items', 'mimic_notices', 'name_pronunciations',
  'opendkp_auction_bids', 'opendkp_auctions', 'opendkp_loot', 'opendkp_raids', 'opendkp_ticks', 'overlay_tuning',
  'pop_flags', 'pvp_quake', 'raid_nights', 'roll_set_overrides', 'roll_sets', 'target_observations',
  'voice_settings', 'who_observations', 'who_overrides', 'xp_events',
];
// Public read policies on guild_id tables: home guild only.
const PUBLIC_TABLES = [
  'bosses_local', 'bot_announcements', 'bot_boards', 'fun_events', 'opendkp_call_stats', 'patch_notes', 'pet_names',
  'pvp_kills', 'wolfpack_roles',
];
// No guild_id column: still on is_guild_member() (home-guild-only), deliberately not in this migration.
const LEFT_ALONE = ['overlay_design_feedback', 'overlay_design_votes', 'ui_window_usage'];

const policiesOn = (t) => policies.filter((p) => new RegExp(`\\son public\\.${t}\\s`, 'i').test(p));

describe.each([['my_guild_ids', '\\(\\)'], ['is_member_of', '\\(text\\)']])('%s', (name, sig) => {
  const fn = stmts.find((s) => new RegExp(`^create or replace function public\\.${name}`, 'i').test(s));
  it('exists as a stable security definer with a pinned search_path', () => {
    expect(fn).toBeTruthy();
    expect(fn).toMatch(/security definer/i);
    expect(fn).toMatch(/set search_path = public, pg_temp/i);
    expect(fn).toMatch(/\bstable\b/i);
  });
  it('is executable by authenticated only', () => {
    expect(SQL).toMatch(new RegExp(`revoke all on function public\\.${name}${sig} from public, anon`, 'i'));
    expect(SQL).toMatch(new RegExp(`grant execute on function public\\.${name}${sig} to authenticated;`, 'i'));
    expect(SQL).not.toMatch(new RegExp(`grant execute on function public\\.${name}${sig} to [^;]*(anon|public)`, 'i'));
  });
});

describe('my_guild_ids / is_member_of', () => {
  const fn = stmts.find((s) => /^create or replace function public\.my_guild_ids/i.test(s));
  it('checks hub membership: not left, player not deleted, guild not suspended', () => {
    expect(fn).toMatch(/hm\.left_at is null/);
    expect(fn).toMatch(/hp\.deleted_at is null/);
    expect(fn).toMatch(/g\.suspended_at is null/);
  });
  it('is_member_of delegates to my_guild_ids', () => {
    expect(SQL).toMatch(/function public\.is_member_of[\s\S]*select p_guild in \(select public\.my_guild_ids\(\)\)/i);
  });
  it('home guild id lives in one function and is_guild_member delegates', () => {
    expect(SQL.match(/'wolfpack'/g)).toHaveLength(1);
    expect(SQL).toMatch(/function public\.is_guild_member[\s\S]*select public\.is_member_of\(public\.home_guild_id\(\)\)/i);
  });
});

describe('member-only read policies', () => {
  it.each(MEMBER_TABLES)('%s uses guild_id in (select my_guild_ids()) and not is_guild_member()', (t) => {
    const ps = policiesOn(t).filter((p) => /to authenticated\s+using/i.test(p));
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) {
      expect(p).toMatch(/using \(guild_id in \(select public\.my_guild_ids\(\)\)\)/);
      expect(p).not.toMatch(/is_member_of/);
      expect(p).not.toMatch(/is_guild_member/);
    }
  });
  it('no policy in the migration still calls is_guild_member()', () => {
    expect(policies.filter((p) => /is_guild_member/.test(p))).toEqual([]);
  });
  it('tables without guild_id are not touched', () => {
    for (const t of LEFT_ALONE) expect(policiesOn(t)).toEqual([]);
  });
});

describe('public read policies', () => {
  it.each(PUBLIC_TABLES)('%s exposes home-guild rows only', (t) => {
    const ps = policiesOn(t).filter((p) => /to (anon|public)/i.test(p));
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatch(/using \(guild_id = public\.home_guild_id\(\)\)/);
  });
});
