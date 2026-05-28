-- Ensure service_role has full privileges on every public table/sequence/function.
-- The bot connects with the service_role key and bypasses RLS, but it still
-- needs SQL-level GRANTs. Supabase normally auto-grants these, but tables
-- created via the SQL Editor (e.g. bosses_local was manually populated before
-- the migration system caught up) can end up with no grants for service_role.
-- This migration is idempotent — safe to re-run.

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Future-proof: any new table/sequence/function inherits these grants.
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant all on sequences to service_role;
alter default privileges in schema public
  grant execute on functions to service_role;
