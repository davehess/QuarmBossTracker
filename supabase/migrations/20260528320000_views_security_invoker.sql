-- Postgres 15+ views default to security_invoker=false, meaning they bypass
-- base-table RLS and execute with the view OWNER's privileges. Discovered
-- after tightening anon-read on the base tables: anon was still able to
-- read opendkp_loot_recent because the view ran as the owner, not the
-- caller.
--
-- security_invoker=true forces the view to respect the calling user's
-- grants + RLS. Web app SSR uses service_role (which bypasses all RLS
-- regardless), so this doesn't break the rendered pages. Authenticated
-- guild members reading through the anon-key client also keep working
-- because the base tables have authenticated_read policies.
--
-- For the public views (eqemu_npc_drops, item_with_proc), security_invoker
-- is also set so the security model is uniform across all views.

alter view encounter_completeness    set (security_invoker = true);
alter view opendkp_attendance_recent set (security_invoker = true);
alter view opendkp_loot_recent       set (security_invoker = true);
alter view eqemu_npc_drops           set (security_invoker = true);
alter view item_with_proc            set (security_invoker = true);
