-- merge_encounter_players: robust per-player merge (Uilnayar 2026-07-14).
--
-- The old merge took MAX damage per player across contributions — on the theory
-- that each parser sees only a subset (distance culling) so the max is the most
-- complete. But it also lets a SINGLE over-counting parser win every row and
-- ~double the totals: a finishing-blow-heavy trash parse, a multi-kill aggregate
-- (a 297s "Terror" spanning several kills), or one melee positioned to witness
-- far more. Seen across the Aten Ha Ra, Terror and raid parses, with DPS doubled
-- to match.
--
-- Now: MEDIAN damage per player across contributions. Median is robust to a
-- single high outlier (the inflated parse) AND a single low outlier (a partial
-- view), and lands on the tight consensus the well-positioned parsers already
-- agree on. NOT the lowest — the middle.
--
-- DPS and duration are also recomputed CONSISTENTLY on the robust raid duration,
-- fixing the split where a player showed 236/s next to a 25m35s column (the DPS
-- came from a short-window outlier upload while the duration came from an
-- over-long aggregate). Raid duration keeps its existing outlier-trimmed calc.
--
-- (The finishing-blow SOURCE — Quarm's <54 trash Finishing Blow AA logging a
-- mob-HP-sized melee hit — is filtered at parse time in agent 3.3.32; this RPC
-- repairs the HISTORICAL parses already carrying inflated numbers, and hardens
-- every future merge against any single divergent parser.)
CREATE OR REPLACE FUNCTION public.merge_encounter_players(p_encounter_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_cap int := 1800;
  v_has_clean boolean;
  v_raid_duration int;
begin
  -- Duration-clean gate: if any contribution is <= 30min, ignore the over-long
  -- session-blob aggregates for the whole merge.
  select exists(
    select 1 from contributions
    where encounter_id = p_encounter_id
      and (duration_sec is null or duration_sec <= v_cap)
  ) into v_has_clean;

  -- Robust raid duration (unchanged): from the damage-heavy, roster-full
  -- contributions, take the longest that isn't an over-long outlier (> 2x p75).
  with q as (
    select c.duration_sec, coalesce(c.total_damage, 0) as dmg
    from contributions c
    where c.encounter_id = p_encounter_id
      and c.duration_sec is not null
      and (not v_has_clean or c.duration_sec <= v_cap)
      and coalesce(c.player_count, 0) >= 0.6 * (
        select max(coalesce(player_count, 0)) from contributions
        where encounter_id = p_encounter_id
          and (not v_has_clean or duration_sec is null or duration_sec <= v_cap))
  ), w as (
    select duration_sec from q where dmg >= 0.25 * (select max(dmg) from q)
  ), a as (
    select percentile_cont(0.75) within group (order by duration_sec) as p75 from w
  )
  select max(w.duration_sec) into v_raid_duration
  from w, a where w.duration_sec <= 2 * a.p75;

  delete from encounter_players where encounter_id = p_encounter_id;

  with per_player as (
    select
      player->>'name' as character_name,
      round(percentile_cont(0.5) within group (order by (player->>'damage')::bigint))::bigint as total_damage,
      max((player->>'duration')::int) as max_dur,
      bool_or(coalesce((player->>'hasPets')::boolean, false)) as has_pets,
      (array_agg(c.id order by (player->>'damage')::bigint desc))[1] as src
    from contributions c
    cross join lateral jsonb_array_elements(c.raw_parse->'players') as player
    where c.encounter_id = p_encounter_id
      and (not v_has_clean or c.duration_sec is null or c.duration_sec <= v_cap)
    group by player->>'name'
  )
  insert into encounter_players
    (encounter_id, character_name, total_damage, dps, duration_sec, has_pets, source_contribution_id, rank)
  select
    p_encounter_id,
    character_name,
    total_damage,
    round(total_damage::numeric / greatest(coalesce(v_raid_duration, max_dur, 1), 1))::int as dps,
    coalesce(v_raid_duration, max_dur) as duration_sec,
    has_pets,
    src,
    row_number() over (order by total_damage desc) as rank
  from per_player;

  update encounters
  set total_damage = coalesce((select sum(total_damage) from encounter_players where encounter_id = p_encounter_id), 0),
      total_dps    = coalesce((select sum(dps)          from encounter_players where encounter_id = p_encounter_id), 0),
      duration_sec = coalesce(v_raid_duration, duration_sec)
  where id = p_encounter_id;
end;
$function$;
