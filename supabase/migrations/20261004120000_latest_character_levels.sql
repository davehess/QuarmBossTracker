-- 20261004120000_latest_character_levels.sql
-- The newest levels we hold for a character, for the /who overlay's anon rows: the level its OWN Mimic
-- reported (xp_events) and the last non-anon /who level (who_observations), one row per name.
--
-- The guild lead, 2026-10-04: "We shouldn't have a gap in our own players levels." Two members who
-- are /anon in /who showed a class and no level on Mimic's /who overlay. who-lookup (the bot) takes a
-- class from who_overrides / the roster, which carry no level, and a level only from a live /who.
--
-- Two sources, because each fails where the other holds:
--   level      xp_events: every Mimic-running character uploads `level` (before) and `level_after` on
--              each experience gain (20261002070000_xp_events.sql). Exact and current, but only for a
--              character running Mimic.
--   who_level  who_observations: the last /who line that showed a level, i.e. the last NON-anon /who
--              level. History: for an /anon member it is whatever they showed before they hid it
--              (59 on a member who was 64 by their own Mimic the same day, because Planes of Power
--              raised the cap in between), but it covers characters that never run Mimic.
-- The bot takes the higher of the two (levels only rise).
--
-- Why who_observations directly and not the who_directory view: the view's best_* CTEs do not take the
-- name filter, so every call scans all of who_observations (1,406 ms for 10 names, EXPLAIN ANALYZE on
-- production, 2026-10-04). The lateral below reads who_obs_character_idx (lower(character),
-- observed_at desc) one name at a time: 3.2 ms for the same 10 names. No guild filter on
-- who_observations, to match who_directory, which has none.
--
-- Each lateral stops at the first row with a level, newest first. xp_events is read through
-- xp_events_guild_id_character_at_kind_key (guild_id, character, at, kind) backwards. Both are LEFT
-- joins: a name with only one source still comes back with the other column null; the WHERE drops
-- names with neither.
--
-- SECURITY INVOKER: xp_events and who_observations are plain tables with authenticated-read policies;
-- the function adds nothing they do not already allow. The bot calls it as service_role, and no other
-- surface needs it, so the grant matches 20260718040000_lockdown_security_definer_rpcs.sql.
--
-- Idempotent: CREATE OR REPLACE, REVOKE and GRANT all re-run cleanly.

create or replace function public.latest_character_levels(p_guild_id text, p_names text[])
returns table("character" text, level int, at timestamptz, who_level int)
language sql
stable
security invoker
set search_path = public
as $$
  select n.nm as "character", x.lvl as level, x.at as at, w.level as who_level
  from unnest(p_names) as n(nm)
  left join lateral (
    select coalesce(e.level_after, e.level) as lvl, e.at
    from xp_events e
    where e.guild_id = p_guild_id
      and e.character = n.nm
      and coalesce(e.level_after, e.level) is not null
    order by e.at desc
    limit 1
  ) x on true
  left join lateral (
    select o.level
    from who_observations o
    where lower(o.character) = lower(n.nm)
      and o.level is not null
    order by o.observed_at desc
    limit 1
  ) w on true
  where x.lvl is not null or w.level is not null
$$;

comment on function public.latest_character_levels(text, text[]) is
  'Per name: level = newest level the character''s own Mimic reported (xp_events level_after, else level), at = when; who_level = last non-anon /who level (who_observations). A name with neither is omitted. xp_events names are matched exactly, in EQ capitalisation (Aldenmar); who_observations on lower(). Feeds /api/agent/who-lookup.';

revoke all on function public.latest_character_levels(text, text[]) from public;
revoke all on function public.latest_character_levels(text, text[]) from anon;
revoke all on function public.latest_character_levels(text, text[]) from authenticated;
grant execute on function public.latest_character_levels(text, text[]) to service_role;
