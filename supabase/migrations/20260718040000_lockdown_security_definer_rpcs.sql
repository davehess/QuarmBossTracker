-- Lock down SECURITY DEFINER surface exposed on the public REST API.
--
-- Supabase advisor (security) flagged 19 warnings: SECURITY DEFINER functions
-- callable by anon/authenticated via /rest/v1/rpc/*, plus 2 SECURITY DEFINER
-- views. PostgreSQL grants EXECUTE to PUBLIC by default, so a fresh function is
-- anon-callable unless revoked. The worst was prune_who_observations — an
-- anon-callable DATA-DELETION vector (DELETE FROM who_observations).
--
-- The bot connects as service_role (bypasses grants + RLS), and the web app
-- (web/) calls every one of these ONLY via supabaseAdmin() = service_role
-- (verified: bump_ui_window, merge_encounter_players, who_directory_json, and
-- both views are all queried server-side with the service-role key). So no
-- anon OR authenticated grant is needed by any surface — revoke both roles and
-- PUBLIC, keep service_role explicit for self-documentation.
--
-- Idempotent: REVOKE/GRANT and ALTER VIEW ... SET are naturally re-runnable.

BEGIN;

-- 1) SECURITY DEFINER functions: revoke the whole public grant, keep service_role.
--    Exact identity signatures (overloads matter: bump_agent_upload_stat x2).
DO $$
DECLARE
  sig text;
  sigs text[] := ARRAY[
    'public.backfill_fun_events_from_encounters(text, timestamptz, boolean)',
    'public.bump_agent_upload_stat(text, text, text, text, boolean, integer, text, jsonb)',
    'public.bump_agent_upload_stat(text, text, text, text, boolean, integer, text, jsonb, text)',
    'public.bump_ui_window(text, text)',
    'public.find_or_create_encounter(text, integer, timestamptz, integer, integer, text)',
    'public.flag_zek_proximity_recent(text, timestamptz)',
    'public.merge_encounter_players(uuid)',
    'public.prune_who_observations(integer)',
    'public.rls_auto_enable()',
    'public.who_directory_json()'
  ];
BEGIN
  FOREACH sig IN ARRAY sigs LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
  END LOOP;
END $$;

-- 2) Secure-by-default for FUTURE functions created in this schema by this role:
--    stop the automatic EXECUTE-to-PUBLIC grant so a new RPC can't silently
--    reopen the hole. Grants are checked at call time, so this does not break
--    PostgREST schema introspection.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 3) SECURITY DEFINER views -> SECURITY INVOKER. Both views only expose guild
--    tables (who_observations / opendkp_* / characters) that are already
--    authenticated-readable via RLS, and anon has no SELECT on either view.
--    Web reads both exclusively via service_role (bypasses RLS), so invoker
--    mode is transparent to the app while removing the owner-privilege
--    RLS-bypass the advisor flagged (2x ERROR security_definer_view).
ALTER VIEW public.who_directory SET (security_invoker = on);
ALTER VIEW public.opendkp_loot_recent SET (security_invoker = on);

COMMIT;
