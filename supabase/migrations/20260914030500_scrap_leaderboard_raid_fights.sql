-- 20260914030500_scrap_leaderboard_raid_fights.sql
-- The Scrap (the /me damage competition, scrap_damage_leaderboard) counted
-- every fight in the last 30 days. The guild lead, 2026-09-13: "a member's 26.8M
-- damage on a non-raid swarm shouldn't be in here for the leaderboards" —
-- 25.96M of that 26.8M was one-to-two-player Shik`nar farming.
--
-- A fight counts when the raid fought it: at least seven damage-dealers
-- credited on the encounter (more than one group). Not the raid-night
-- binding — that only covers the scheduled window, and 655 raid-sized fights
-- this month sat outside it. Officer-classified encounters (foreign / wipe /
-- live / pvp / test) are dropped too, the same rule /leaderboards already
-- applies. Same signature; /me needs no change.
--
-- Measured 2026-09-13 on the live 30 days: a floor of 6 and a floor of 12
-- produce the same top five (8.7M at the head of it); seven is "more than a
-- group".
create or replace function public.scrap_damage_leaderboard(p_since timestamptz)
returns table(character_name text, total_damage bigint, best_dps int, encounters bigint)
language sql
stable
security definer
set search_path = public
as $$
  with raid_sized as (
    select ep.encounter_id
    from encounter_players ep
    join encounters e on e.id = ep.encounter_id
    where e.started_at >= p_since
    group by ep.encounter_id
    having count(*) >= 7
  )
  select
    ep.character_name,
    sum(ep.total_damage)::bigint as total_damage,
    max(ep.dps)::int             as best_dps,
    count(*)::bigint             as encounters
  from encounter_players ep
  join encounters e on e.id = ep.encounter_id
  join raid_sized r on r.encounter_id = ep.encounter_id
  where e.started_at >= p_since
    and e.classification is null
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
