-- The 20260621053900_hate_kills migration enabled RLS + a SELECT policy for
-- `authenticated`, but never granted the underlying table privilege. Postgres
-- checks table grants BEFORE applying RLS, so every web read returned 42501
-- permission denied — the /pvp/hate page rendered empty even with rows in
-- the table. Found 2026-06-21 by running the page's exact query under
-- `SET ROLE authenticated`. Granting SELECT to authenticated + anon (anon
-- stays read-only; writes still flow through service_role).

GRANT SELECT ON public.hate_kills TO authenticated;
GRANT SELECT ON public.hate_kills TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.hate_kills_id_seq TO authenticated;
