-- Guild data is readable by guild members only (2026-11-01).
--
-- Since raidmimic.com opened sign-in to any Discord account (web 2.1.79), being signed in no longer means being a
-- Wolf Pack member. The read policies below were written when it did: `to authenticated using (true)`. They now
-- require a current member: a wolfpack_members row for the session's login with is_member = true.
--
-- The website's server reads use the service role and are unaffected; this governs reads made with a signed-in
-- user's own token. Game catalog tables (eqemu_*, spell_level_seed, quarm_patch_notes) stay readable as before.
-- Idempotent: ALTER POLICY only changes the USING clause; a missing policy is skipped.

create or replace function public.is_guild_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.wolfpack_members m
    where m.user_id = auth.uid() and m.is_member is true
  );
$$;

revoke all on function public.is_guild_member() from public, anon;
grant execute on function public.is_guild_member() to authenticated, service_role;

do $$
declare
  p record;
begin
  for p in select * from (values
    ('agent_clock_offsets', 'agent_clock_offsets_read'),
    ('bosses_local', 'bosses_local_authenticated_read'),
    ('character_aas', 'character_aas_read'),
    ('character_gear', 'character_gear_read'),
    ('character_live_state', 'live_state read'),
    ('character_lockouts', 'character_lockouts_read'),
    ('characters', 'characters_auth_read'),
    ('characters', 'characters_authenticated_read'),
    ('charm_sessions', 'charm_sessions_read'),
    ('combat_events', 'combat_events_authenticated_read'),
    ('common_macros', 'common_macros read'),
    ('comp_templates', 'comp_templates read'),
    ('contributions', 'contributions_authenticated_read'),
    ('crash_reports', 'crash_reports_read'),
    ('encounter_combat_rollup', 'eqcr read for authenticated'),
    ('encounter_events', 'encounter_events_read'),
    ('encounter_players', 'encounter_players_authenticated_read'),
    ('encounter_threat_rank', 'threat_rank_read_authenticated'),
    ('encounters', 'encounters_authenticated_read'),
    ('faction_cons', 'faction_cons_read'),
    ('faction_hits', 'faction_hits_read'),
    ('faction_standing', 'faction_standing_read'),
    ('fight_cards', 'fight_cards_read'),
    ('guild_rules', 'guild_rules_read'),
    ('hate_kills', 'hate_kills_read_auth'),
    ('kite_loops', 'kite_loops_read'),
    ('loot_drops', 'loot_drops_authenticated_read'),
    ('looted_items', 'looted_items_read'),
    ('mimic_notices', 'mimic_notices read'),
    ('name_pronunciations', 'name_pronunciations_read'),
    ('opendkp_auction_bids', 'opendkp_auction_bids_read'),
    ('opendkp_auctions', 'opendkp_auctions_read'),
    ('opendkp_loot', 'opendkp_loot_read'),
    ('opendkp_raids', 'opendkp_raids_read'),
    ('opendkp_ticks', 'opendkp_ticks_read'),
    ('overlay_design_feedback', 'overlay_design_feedback_read'),
    ('overlay_design_votes', 'overlay_design_votes_read'),
    ('overlay_tuning', 'overlay_tuning read'),
    ('pop_flags', 'pop_flags_read'),
    ('pvp_quake', 'pvp_quake_select'),
    ('raid_nights', 'raid_nights_authenticated_read'),
    ('roll_set_overrides', 'roll_set_overrides_read'),
    ('roll_sets', 'roll_sets_read'),
    ('target_observations', 'target_observations_read'),
    ('ui_window_usage', 'ui_window_usage_read'),
    ('voice_settings', 'voice_settings read'),
    ('who_observations', 'who_obs_read'),
    ('who_overrides', 'who_overrides_read'),
    ('xp_events', 'xp_events_read')
  ) as t(tbl, pol) loop
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = p.tbl and policyname = p.pol) then
      -- (select …) makes Postgres evaluate the check once per query, not once per row.
      execute format('alter policy %I on public.%I using ((select public.is_guild_member()))', p.pol, p.tbl);
    end if;
  end loop;
end
$$;
