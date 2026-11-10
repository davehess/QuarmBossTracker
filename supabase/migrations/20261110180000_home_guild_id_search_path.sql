-- Pin the search path on public.home_guild_id() (2026-11-10). The function names no table, so this only clears the
-- Supabase security advisor's "role mutable search_path" warning raised after 20261110120000_guild_scoped_reads.sql.
-- Idempotent.
alter function public.home_guild_id() set search_path = public, pg_temp;
