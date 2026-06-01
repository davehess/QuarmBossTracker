-- "The Scrap" — friendly damage competition leaderboard (server-side aggregate).
--
-- Per-character total damage + best single-encounter DPS over a window. Done as
-- a SECURITY DEFINER function so the GROUP BY runs in Postgres and isn't
-- truncated by PostgREST's 1000-row response cap (the same cap that made the
-- chat-browser counts wrong). Returns ~one row per character (well under the
-- cap), already ranked.
--
-- exclude_from_stats characters are omitted (member opt-out). service_role-only
-- (the /me + leaderboard pages call it with the admin client); EXECUTE revoked
-- from PUBLIC so it can't be called around the table RLS by anon/authenticated.

create or replace function public.scrap_damage_leaderboard(p_since timestamptz)
returns table(character_name text, total_damage bigint, best_dps int, encounters bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    ep.character_name,
    sum(ep.total_damage)::bigint as total_damage,
    max(ep.dps)::int             as best_dps,
    count(*)::bigint             as encounters
  from encounter_players ep
  join encounters e on e.id = ep.encounter_id
  where e.started_at >= p_since
    and ep.character_name is not null
    and not exists (
      select 1 from characters c
      where lower(c.name) = lower(ep.character_name)
        and c.exclude_from_stats
    )
  group by ep.character_name
  having sum(ep.total_damage) > 0
  order by sum(ep.total_damage) desc
$$;

revoke all on function public.scrap_damage_leaderboard(timestamptz) from public;
grant execute on function public.scrap_damage_leaderboard(timestamptz) to service_role;
