-- 20261004140300_cap_safe_misc.sql
-- The distinct set of characters whose agent has uploaded since a time, as ONE small result.
--
-- PostgREST answers at most 1,000 rows per response, silently. Two bot reads wanted "which characters
-- uploaded in the last 14 days" and did it the long way: select contributor_character from every
-- contribution row in the window, then dedupe in JS. The window holds 21,509 rows (46,301 in the whole
-- table) for 88 distinct characters, so each read got the first 1,000 rows and a covered set built from
-- whichever raiders happened to sit in them:
--   /backfillscan  (utils/backfillScan.js)   "active uploaders", which decides who qualifies as a bystander
--                                            to ask for a backfill
--   /juicylogs     (commands/juicylogs.js)   the green "already uploading" dot beside a top attendee
-- A distinct in SQL returns the 88 names, and no row count can reach the cap.
--
-- Measured on production, 2026-10-04: seq scan of contributions, 21,509 rows kept, 24,792 removed,
-- 191 ms (EXPLAIN ANALYZE). contributions has no index on created_at and would not use one here (the
-- window is 46% of the table), so none is added.
--
-- The column keeps its source name, contributor_character, so both callers read the rows exactly as
-- they did. NULL names are dropped (the JS side filtered them out anyway).
--
-- SECURITY INVOKER: contributions is a plain table with an authenticated-read policy; the function adds
-- nothing it does not already allow. Only the bot calls it, as service_role, so the grant matches
-- 20260718040000_lockdown_security_definer_rpcs.sql and 20261004120000_latest_character_levels.sql.
--
-- Idempotent: CREATE OR REPLACE, REVOKE and GRANT all re-run cleanly.

create or replace function public.recent_contributor_characters(p_since timestamptz)
returns table(contributor_character text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct c.contributor_character
  from contributions c
  where c.contributor_character is not null
    and c.created_at >= p_since
$$;

comment on function public.recent_contributor_characters(timestamptz) is
  'Distinct contributions.contributor_character with created_at >= p_since, NULLs dropped: the characters whose agents have uploaded recently. One row per character, so it is far under the PostgREST 1,000-row cap. Feeds /backfillscan and /juicylogs.';

revoke all on function public.recent_contributor_characters(timestamptz) from public;
revoke all on function public.recent_contributor_characters(timestamptz) from anon;
revoke all on function public.recent_contributor_characters(timestamptz) from authenticated;
grant execute on function public.recent_contributor_characters(timestamptz) to service_role;
