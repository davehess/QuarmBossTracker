-- Pin search_path on the advisor's remaining SECURITY-agnostic stragglers.
--
-- Supabase advisor (security) flagged 23 `function_search_path_mutable` WARNs:
-- functions with a role-mutable search_path. A caller (or a malicious role that
-- can set search_path) could shadow an unqualified table/function reference with
-- an object in another schema. Pinning search_path at the function level closes
-- that — the setting is captured at definition time and cannot be overridden by
-- the caller's session.
--
-- Pin VALUE = `public` for all 23. Every one of these bodies references only
-- public tables (most unqualified, e.g. `encounters`, `eqemu_items`,
-- `character_spellbook`; some already `public.`-qualified) plus pg_catalog
-- built-ins (now, regexp_replace, jsonb_*, percentile_cont, hashtextextended,
-- pg_advisory_xact_lock, …). pg_catalog stays implicitly first in the search
-- path even when it isn't named, so built-ins still resolve. None reference the
-- `extensions` schema (no pgcrypto/uuid-ossp/pg_trgm objects) or vault/auth, so
-- no extra schema is needed in the pin. `search_path = ''` is deliberately NOT
-- used: these bodies rely on unqualified public refs and an empty pin would
-- break them at runtime.
--
-- Idempotent: ALTER FUNCTION ... SET is naturally re-runnable. This changes only
-- the function's config (proconfig); bodies, ownership, and grants are untouched
-- (the 20260718040000 lockdown already revoked PUBLIC/anon/authenticated EXECUTE
-- on the SECURITY DEFINER subset).

BEGIN;

-- Triggers
ALTER FUNCTION public._touch_guild_triggers_updated_at()            SET search_path = public;
ALTER FUNCTION public._touch_raid_targets()                         SET search_path = public;
ALTER FUNCTION public._wm_merge_validate()                          SET search_path = public;
ALTER FUNCTION public.apply_main_name_override()                    SET search_path = public;
ALTER FUNCTION public.resolve_turnin_npc_id()                       SET search_path = public;

-- SECURITY DEFINER RPCs (locked down in 20260718040000)
ALTER FUNCTION public.bump_ui_window(text, text)                    SET search_path = public;
ALTER FUNCTION public.find_or_create_encounter(text, integer, timestamptz, integer, integer, text)
                                                                    SET search_path = public;
ALTER FUNCTION public.flag_zek_proximity_recent(text, timestamptz)  SET search_path = public;
ALTER FUNCTION public.merge_encounter_players(uuid)                 SET search_path = public;
ALTER FUNCTION public.prune_who_observations(integer)               SET search_path = public;

-- SECURITY INVOKER RPCs / helpers
ALTER FUNCTION public.bump_faction_standing(jsonb)                  SET search_path = public;
ALTER FUNCTION public.character_missing_spells(text, text, integer) SET search_path = public;
ALTER FUNCTION public.chat_attribution_conflicts(integer)          SET search_path = public;
ALTER FUNCTION public.discover_quests_for_item(integer[])          SET search_path = public;
ALTER FUNCTION public.eq_class_bit(text)                            SET search_path = public;
ALTER FUNCTION public.fun_dirge_damage()                            SET search_path = public;
ALTER FUNCTION public.fun_tunare_stats(text[])                      SET search_path = public;
ALTER FUNCTION public.guild_held_spell_needs(text)                  SET search_path = public;
ALTER FUNCTION public.inferred_keys_for_character(text, text)       SET search_path = public;
ALTER FUNCTION public.item_card_info(integer[])                     SET search_path = public;
ALTER FUNCTION public.quest_item_info(integer[])                    SET search_path = public;
ALTER FUNCTION public.refresh_eqemu_spell_pop()                     SET search_path = public;
ALTER FUNCTION public.turnins_by_id(bigint[])                       SET search_path = public;

COMMIT;
