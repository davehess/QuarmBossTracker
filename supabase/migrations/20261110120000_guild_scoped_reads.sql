-- Guild-scoped read policies (2026-11-10, security hardening phase 2).
--
-- Until now a read policy asked "is the caller a Wolf Pack member" (public.is_guild_member()), whatever guild the row
-- belonged to. With hub guilds registering into the shared tables the question has to be "is the caller a current
-- member of THIS row's guild". Three parts:
--   1. public.home_guild_id() names the home guild in one place; public.my_guild_ids() returns the caller's guilds once
--      per query (home guild: the wolfpack_members check as before; any other guild: an active hub membership);
--      public.is_member_of(guild) asks about one guild. is_guild_member() keeps its meaning and delegates.
--   2. Every member-only read policy on a table that has a guild_id column is recreated as
--      guild_id in (select public.my_guild_ids()).
--      Same name, command and roles. overlay_design_feedback, overlay_design_votes and ui_window_usage have no
--      guild_id and stay on is_guild_member() (home-guild-only tables).
--   3. Public (anon / public role) read policies on tables that have a guild_id column now expose home-guild rows
--      only. Catalog tables (eqemu_*, sync_meta; no guild_id) are untouched, as are the guild_scoped-role policies and
--      wolfpack_members_self_read (already "own row").
-- A hub membership links to the login through the Discord identity: auth.identities.provider_id (provider
-- 'discord') = hub_players.discord_id. That column is set by the auth server, not editable by the user the way
-- user metadata is.
-- Idempotent: CREATE OR REPLACE, DROP POLICY IF EXISTS + CREATE POLICY.

create or replace function public.home_guild_id()
returns text
language sql
immutable
as $$ select 'wolfpack'::text $$;

revoke all on function public.home_guild_id() from public;
grant execute on function public.home_guild_id() to anon, authenticated, service_role;

-- The caller's guilds, computed once per query (policies wrap it in an uncorrelated subquery, so the planner runs it
-- as an initplan and each row is a plain comparison).
create or replace function public.my_guild_ids()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.home_guild_id()
  where exists (
    select 1 from public.wolfpack_members m
    where m.user_id = auth.uid() and m.is_member is true
  )
  union
  select hm.guild_id
  from public.hub_memberships hm
  join public.hub_players hp on hp.player_id = hm.player_id
  join public.hub_guilds g on g.guild_id = hm.guild_id
  join auth.identities i on i.provider = 'discord' and i.provider_id = hp.discord_id
  where hm.left_at is null
    and hp.deleted_at is null
    and g.suspended_at is null
    and i.user_id = auth.uid();
$$;

revoke all on function public.my_guild_ids() from public, anon;
grant execute on function public.my_guild_ids() to authenticated;

create or replace function public.is_member_of(p_guild text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select p_guild in (select public.my_guild_ids()) $$;

revoke all on function public.is_member_of(text) from public, anon;
grant execute on function public.is_member_of(text) to authenticated;

create or replace function public.is_guild_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select public.is_member_of(public.home_guild_id()) $$;

-- Member-only reads: current member of the row's guild.
drop policy if exists "agent_clock_offsets_read" on public.agent_clock_offsets;
create policy "agent_clock_offsets_read" on public.agent_clock_offsets for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "bosses_local_authenticated_read" on public.bosses_local;
create policy "bosses_local_authenticated_read" on public.bosses_local for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "character_aas_read" on public.character_aas;
create policy "character_aas_read" on public.character_aas for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "character_gear_read" on public.character_gear;
create policy "character_gear_read" on public.character_gear for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "live_state read" on public.character_live_state;
create policy "live_state read" on public.character_live_state for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "character_lockouts_read" on public.character_lockouts;
create policy "character_lockouts_read" on public.character_lockouts for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "characters_auth_read" on public.characters;
create policy "characters_auth_read" on public.characters for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "characters_authenticated_read" on public.characters;
create policy "characters_authenticated_read" on public.characters for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "charm_sessions_read" on public.charm_sessions;
create policy "charm_sessions_read" on public.charm_sessions for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "combat_events_authenticated_read" on public.combat_events;
create policy "combat_events_authenticated_read" on public.combat_events for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "common_macros read" on public.common_macros;
create policy "common_macros read" on public.common_macros for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "comp_templates read" on public.comp_templates;
create policy "comp_templates read" on public.comp_templates for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "contributions_authenticated_read" on public.contributions;
create policy "contributions_authenticated_read" on public.contributions for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "crash_reports_read" on public.crash_reports;
create policy "crash_reports_read" on public.crash_reports for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "eqcr read for authenticated" on public.encounter_combat_rollup;
create policy "eqcr read for authenticated" on public.encounter_combat_rollup for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "encounter_events_read" on public.encounter_events;
create policy "encounter_events_read" on public.encounter_events for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "encounter_players_authenticated_read" on public.encounter_players;
create policy "encounter_players_authenticated_read" on public.encounter_players for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "threat_rank_read_authenticated" on public.encounter_threat_rank;
create policy "threat_rank_read_authenticated" on public.encounter_threat_rank for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "encounters_authenticated_read" on public.encounters;
create policy "encounters_authenticated_read" on public.encounters for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "faction_cons_read" on public.faction_cons;
create policy "faction_cons_read" on public.faction_cons for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "faction_hits_read" on public.faction_hits;
create policy "faction_hits_read" on public.faction_hits for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "faction_standing_read" on public.faction_standing;
create policy "faction_standing_read" on public.faction_standing for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "fight_cards_read" on public.fight_cards;
create policy "fight_cards_read" on public.fight_cards for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "guild_rules_read" on public.guild_rules;
create policy "guild_rules_read" on public.guild_rules for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "hate_kills_read_auth" on public.hate_kills;
create policy "hate_kills_read_auth" on public.hate_kills for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "kite_loops_read" on public.kite_loops;
create policy "kite_loops_read" on public.kite_loops for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "loot_drops_authenticated_read" on public.loot_drops;
create policy "loot_drops_authenticated_read" on public.loot_drops for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "looted_items_read" on public.looted_items;
create policy "looted_items_read" on public.looted_items for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "mimic_notices read" on public.mimic_notices;
create policy "mimic_notices read" on public.mimic_notices for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "name_pronunciations_read" on public.name_pronunciations;
create policy "name_pronunciations_read" on public.name_pronunciations for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "opendkp_auction_bids_read" on public.opendkp_auction_bids;
create policy "opendkp_auction_bids_read" on public.opendkp_auction_bids for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "opendkp_auctions_read" on public.opendkp_auctions;
create policy "opendkp_auctions_read" on public.opendkp_auctions for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "opendkp_loot_read" on public.opendkp_loot;
create policy "opendkp_loot_read" on public.opendkp_loot for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "opendkp_raids_read" on public.opendkp_raids;
create policy "opendkp_raids_read" on public.opendkp_raids for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "opendkp_ticks_read" on public.opendkp_ticks;
create policy "opendkp_ticks_read" on public.opendkp_ticks for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "overlay_tuning read" on public.overlay_tuning;
create policy "overlay_tuning read" on public.overlay_tuning for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "pop_flags_read" on public.pop_flags;
create policy "pop_flags_read" on public.pop_flags for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "pvp_quake_select" on public.pvp_quake;
create policy "pvp_quake_select" on public.pvp_quake for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "raid_nights_authenticated_read" on public.raid_nights;
create policy "raid_nights_authenticated_read" on public.raid_nights for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "roll_set_overrides_read" on public.roll_set_overrides;
create policy "roll_set_overrides_read" on public.roll_set_overrides for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "roll_sets_read" on public.roll_sets;
create policy "roll_sets_read" on public.roll_sets for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "target_observations_read" on public.target_observations;
create policy "target_observations_read" on public.target_observations for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "voice_settings read" on public.voice_settings;
create policy "voice_settings read" on public.voice_settings for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "who_obs_read" on public.who_observations;
create policy "who_obs_read" on public.who_observations for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "who_overrides_read" on public.who_overrides;
create policy "who_overrides_read" on public.who_overrides for select to authenticated using (guild_id in (select public.my_guild_ids()));

drop policy if exists "xp_events_read" on public.xp_events;
create policy "xp_events_read" on public.xp_events for select to authenticated using (guild_id in (select public.my_guild_ids()));

-- Public reads: home-guild rows only.
drop policy if exists "bosses_local_public_read" on public.bosses_local;
create policy "bosses_local_public_read" on public.bosses_local for select to public using (guild_id = public.home_guild_id());

drop policy if exists "bot_announcements_anon_read" on public.bot_announcements;
create policy "bot_announcements_anon_read" on public.bot_announcements for select to anon, authenticated using (guild_id = public.home_guild_id());

drop policy if exists "bot_boards_anon_read" on public.bot_boards;
create policy "bot_boards_anon_read" on public.bot_boards for select to anon, authenticated using (guild_id = public.home_guild_id());

drop policy if exists "fun_events_anon_read" on public.fun_events;
create policy "fun_events_anon_read" on public.fun_events for select to public using (guild_id = public.home_guild_id());

drop policy if exists "opendkp_call_stats_public_read" on public.opendkp_call_stats;
create policy "opendkp_call_stats_public_read" on public.opendkp_call_stats for select to anon, authenticated using (guild_id = public.home_guild_id());

drop policy if exists "patch_notes_anon_read_all" on public.patch_notes;
create policy "patch_notes_anon_read_all" on public.patch_notes for select to public using (guild_id = public.home_guild_id());

drop policy if exists "pet_names_read" on public.pet_names;
create policy "pet_names_read" on public.pet_names for select to anon, authenticated using (guild_id = public.home_guild_id());

drop policy if exists "pvp_kills_read" on public.pvp_kills;
create policy "pvp_kills_read" on public.pvp_kills for select to anon, authenticated using (guild_id = public.home_guild_id());

drop policy if exists "wolfpack_roles_public_read" on public.wolfpack_roles;
create policy "wolfpack_roles_public_read" on public.wolfpack_roles for select to public using (guild_id = public.home_guild_id());
