-- Database hardening (security advisor cleanup). Safe to apply in a transaction; no data
-- change, no table rewrite, takes only brief catalog locks. Idempotent. Apply any time.
--
-- 1. Trigger functions are never meant to be called directly. They kept Postgres's default
--    PUBLIC EXECUTE (which anon and authenticated inherit). Triggers still fire: a trigger
--    runs its function as the table's DML path, not through the caller's EXECUTE grant.
--    service_role keeps its explicit grant.
-- 2. Views run with the OWNER's rights by default, which bypasses the reader's row-level
--    security. security_invoker makes them respect the reader. item_catalog_droppable reads
--    only anon-readable catalog tables, so anon reads keep working. The other three views
--    have no SELECT grant for anon or authenticated (service_role only, and it bypasses
--    RLS), so nothing that reads them today changes.
-- 3. Pin search_path on functions that had none.
-- 4. Drop a leftover probe function.
--
-- Deliberately NOT changed: is_guild_member() (RLS policies call it as `authenticated`) and
-- opendkp_traffic_summary() (the public /opendkp page calls it with the public key, aggregates
-- only; see 20260925021113).

revoke execute on function public.encounters_bump_from_loot()         from public, anon, authenticated;
revoke execute on function public.encounters_bump_from_players_del()  from public, anon, authenticated;
revoke execute on function public.encounters_bump_from_players_ins()  from public, anon, authenticated;
revoke execute on function public.encounters_bump_from_players_upd()  from public, anon, authenticated;
revoke execute on function public.encounters_tombstone_on_delete()    from public, anon, authenticated;

alter view public.item_catalog_droppable      set (security_invoker = on);
alter view public.member_attendance_metrics   set (security_invoker = on);
alter view public.opendkp_character_id_to_name set (security_invoker = on);
alter view public.trigger_text_audit          set (security_invoker = on);

alter function public.encounters_touch_updated_at()   set search_path = public, pg_temp;
alter function public.bump_faction_standing(jsonb)    set search_path = public, pg_temp;
alter function public.spell_scroll_sources(integer[]) set search_path = public, pg_temp;
alter function public.merge_encounter_players(uuid)   set search_path = public, pg_temp;

drop function if exists public._tmp_probe2_20261008();
