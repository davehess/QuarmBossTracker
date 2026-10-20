-- Members-only reads of guild data; the service role is unaffected.
--
-- Every read of these tables on the site, the bot, the agent and Mimic goes through the service role, which
-- bypasses row-level security and keeps its own grants. The one exception is /pvp/hate, which reads
-- hate_kills with the signed-in user's own session; that table gets a members-only policy instead.
-- Tables nobody reads with a user or anon key lose their blanket read policy and the anon/authenticated
-- SELECT grant. Game catalogs (eqemu_*) and the six public-by-design tables listed at the bottom are untouched.
--
-- Membership is the row the sign-in callback writes: wolfpack_members.user_id = auth.uid() and is_member
-- (the bot flips is_member off when someone leaves the guild).
--
-- Idempotent. Apply in the Supabase SQL editor (nothing applies migrations automatically).

BEGIN;

-- 1. Membership test ----------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_guild_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.wolfpack_members m
    WHERE m.user_id = (SELECT auth.uid())
      AND m.is_member IS TRUE
  );
$$;

REVOKE ALL ON FUNCTION public.is_guild_member() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_guild_member() TO authenticated, service_role;

-- 2. Read with a user session: members only -----------------------------------------------------------------

-- hate_kills: /pvp/hate
DROP POLICY IF EXISTS hate_kills_read_auth ON public.hate_kills;
DROP POLICY IF EXISTS hate_kills_read_members ON public.hate_kills;
CREATE POLICY hate_kills_read_members ON public.hate_kills
  FOR SELECT TO authenticated
  USING ((SELECT public.is_guild_member()));

-- 3. No user-session or anon reader: drop the blanket policy and the grant ----------------------------------

DROP POLICY IF EXISTS agent_clock_offsets_read ON public.agent_clock_offsets;
REVOKE SELECT ON public.agent_clock_offsets FROM anon, authenticated;

DROP POLICY IF EXISTS bot_announcements_anon_read ON public.bot_announcements;
REVOKE SELECT ON public.bot_announcements FROM anon, authenticated;

DROP POLICY IF EXISTS character_aas_read ON public.character_aas;
REVOKE SELECT ON public.character_aas FROM anon, authenticated;

DROP POLICY IF EXISTS character_gear_read ON public.character_gear;
REVOKE SELECT ON public.character_gear FROM anon, authenticated;

DROP POLICY IF EXISTS "live_state read" ON public.character_live_state;
REVOKE SELECT ON public.character_live_state FROM anon, authenticated;

DROP POLICY IF EXISTS character_lockouts_read ON public.character_lockouts;
REVOKE SELECT ON public.character_lockouts FROM anon, authenticated;

DROP POLICY IF EXISTS characters_auth_read ON public.characters;
DROP POLICY IF EXISTS characters_authenticated_read ON public.characters;
REVOKE SELECT ON public.characters FROM anon, authenticated;

DROP POLICY IF EXISTS charm_sessions_read ON public.charm_sessions;
REVOKE SELECT ON public.charm_sessions FROM anon, authenticated;

DROP POLICY IF EXISTS combat_events_authenticated_read ON public.combat_events;
REVOKE SELECT ON public.combat_events FROM anon, authenticated;

DROP POLICY IF EXISTS "common_macros read" ON public.common_macros;
REVOKE SELECT ON public.common_macros FROM anon, authenticated;

DROP POLICY IF EXISTS "comp_templates read" ON public.comp_templates;
REVOKE SELECT ON public.comp_templates FROM anon, authenticated;

DROP POLICY IF EXISTS contributions_authenticated_read ON public.contributions;
REVOKE SELECT ON public.contributions FROM anon, authenticated;

DROP POLICY IF EXISTS crash_reports_read ON public.crash_reports;
REVOKE SELECT ON public.crash_reports FROM anon, authenticated;

DROP POLICY IF EXISTS "eqcr read for authenticated" ON public.encounter_combat_rollup;
REVOKE SELECT ON public.encounter_combat_rollup FROM anon, authenticated;

DROP POLICY IF EXISTS encounter_events_read ON public.encounter_events;
REVOKE SELECT ON public.encounter_events FROM anon, authenticated;

DROP POLICY IF EXISTS encounter_players_authenticated_read ON public.encounter_players;
REVOKE SELECT ON public.encounter_players FROM anon, authenticated;

DROP POLICY IF EXISTS threat_rank_read_authenticated ON public.encounter_threat_rank;
REVOKE SELECT ON public.encounter_threat_rank FROM anon, authenticated;

DROP POLICY IF EXISTS encounters_authenticated_read ON public.encounters;
REVOKE SELECT ON public.encounters FROM anon, authenticated;

DROP POLICY IF EXISTS faction_cons_read ON public.faction_cons;
REVOKE SELECT ON public.faction_cons FROM anon, authenticated;

DROP POLICY IF EXISTS faction_hits_read ON public.faction_hits;
REVOKE SELECT ON public.faction_hits FROM anon, authenticated;

DROP POLICY IF EXISTS faction_standing_read ON public.faction_standing;
REVOKE SELECT ON public.faction_standing FROM anon, authenticated;

DROP POLICY IF EXISTS fight_cards_read ON public.fight_cards;
REVOKE SELECT ON public.fight_cards FROM anon, authenticated;

DROP POLICY IF EXISTS guild_rules_read ON public.guild_rules;
REVOKE SELECT ON public.guild_rules FROM anon, authenticated;

DROP POLICY IF EXISTS kite_loops_read ON public.kite_loops;
REVOKE SELECT ON public.kite_loops FROM anon, authenticated;

DROP POLICY IF EXISTS loot_drops_authenticated_read ON public.loot_drops;
REVOKE SELECT ON public.loot_drops FROM anon, authenticated;

DROP POLICY IF EXISTS looted_items_read ON public.looted_items;
REVOKE SELECT ON public.looted_items FROM anon, authenticated;

DROP POLICY IF EXISTS "mimic_notices read" ON public.mimic_notices;
REVOKE SELECT ON public.mimic_notices FROM anon, authenticated;

DROP POLICY IF EXISTS name_pronunciations_read ON public.name_pronunciations;
REVOKE SELECT ON public.name_pronunciations FROM anon, authenticated;

DROP POLICY IF EXISTS opendkp_auction_bids_read ON public.opendkp_auction_bids;
REVOKE SELECT ON public.opendkp_auction_bids FROM anon, authenticated;

DROP POLICY IF EXISTS opendkp_auctions_read ON public.opendkp_auctions;
REVOKE SELECT ON public.opendkp_auctions FROM anon, authenticated;

DROP POLICY IF EXISTS opendkp_call_stats_public_read ON public.opendkp_call_stats;
REVOKE SELECT ON public.opendkp_call_stats FROM anon, authenticated;

DROP POLICY IF EXISTS opendkp_loot_read ON public.opendkp_loot;
REVOKE SELECT ON public.opendkp_loot FROM anon, authenticated;

DROP POLICY IF EXISTS opendkp_raids_read ON public.opendkp_raids;
REVOKE SELECT ON public.opendkp_raids FROM anon, authenticated;

DROP POLICY IF EXISTS opendkp_ticks_read ON public.opendkp_ticks;
REVOKE SELECT ON public.opendkp_ticks FROM anon, authenticated;

DROP POLICY IF EXISTS overlay_design_feedback_read ON public.overlay_design_feedback;
REVOKE SELECT ON public.overlay_design_feedback FROM anon, authenticated;

DROP POLICY IF EXISTS overlay_design_votes_read ON public.overlay_design_votes;
REVOKE SELECT ON public.overlay_design_votes FROM anon, authenticated;

DROP POLICY IF EXISTS "overlay_tuning read" ON public.overlay_tuning;
REVOKE SELECT ON public.overlay_tuning FROM anon, authenticated;

DROP POLICY IF EXISTS pop_flags_read ON public.pop_flags;
REVOKE SELECT ON public.pop_flags FROM anon, authenticated;

DROP POLICY IF EXISTS pvp_kills_read ON public.pvp_kills;
REVOKE SELECT ON public.pvp_kills FROM anon, authenticated;

DROP POLICY IF EXISTS pvp_quake_select ON public.pvp_quake;
REVOKE SELECT ON public.pvp_quake FROM anon, authenticated;

DROP POLICY IF EXISTS quarm_patch_notes_read ON public.quarm_patch_notes;
REVOKE SELECT ON public.quarm_patch_notes FROM anon, authenticated;

DROP POLICY IF EXISTS raid_nights_authenticated_read ON public.raid_nights;
REVOKE SELECT ON public.raid_nights FROM anon, authenticated;

DROP POLICY IF EXISTS roll_set_overrides_read ON public.roll_set_overrides;
REVOKE SELECT ON public.roll_set_overrides FROM anon, authenticated;

DROP POLICY IF EXISTS roll_sets_read ON public.roll_sets;
REVOKE SELECT ON public.roll_sets FROM anon, authenticated;

DROP POLICY IF EXISTS spell_level_seed_read ON public.spell_level_seed;
REVOKE SELECT ON public.spell_level_seed FROM anon, authenticated;

DROP POLICY IF EXISTS target_observations_read ON public.target_observations;
REVOKE SELECT ON public.target_observations FROM anon, authenticated;

DROP POLICY IF EXISTS ui_window_usage_read ON public.ui_window_usage;
REVOKE SELECT ON public.ui_window_usage FROM anon, authenticated;

DROP POLICY IF EXISTS "voice_settings read" ON public.voice_settings;
REVOKE SELECT ON public.voice_settings FROM anon, authenticated;

DROP POLICY IF EXISTS who_obs_read ON public.who_observations;
REVOKE SELECT ON public.who_observations FROM anon, authenticated;

DROP POLICY IF EXISTS who_overrides_read ON public.who_overrides;
REVOKE SELECT ON public.who_overrides FROM anon, authenticated;

DROP POLICY IF EXISTS wolfpack_roles_public_read ON public.wolfpack_roles;
REVOKE SELECT ON public.wolfpack_roles FROM anon, authenticated;

DROP POLICY IF EXISTS xp_events_read ON public.xp_events;
REVOKE SELECT ON public.xp_events FROM anon, authenticated;

-- 4. A definer function that summarises opendkp_call_stats: callable by the service role only ---------------

REVOKE ALL ON FUNCTION public.opendkp_traffic_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.opendkp_traffic_summary() TO service_role;

-- 5. Left public on purpose (policies unchanged) ------------------------------------------------------------
--   bosses_local, bot_boards   boss list and timers (guild boss board)
--   patch_notes, sync_meta     published patch notes and catalog sync dates
--   pet_names                  pet-name list used to tell pets from players
--   fun_events                 /fun page events
-- The eqemu_* game catalogs also stay readable.

COMMIT;
