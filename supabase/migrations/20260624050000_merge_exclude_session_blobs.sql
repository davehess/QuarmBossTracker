-- merge_encounter_players: exclude session-blob contributions from the merge.
--
-- A parser sometimes uploads an entire raid session as ONE "encounter" (a
-- 50-minute–to–2-hour duration with every player who did any damage in the
-- zone). When that blob merges into a real ~3-minute boss kill (same npc, ±30m
-- window), max-damage-per-player drags in parked alts and passers-by who were
-- never in the fight. (Uilnayar 2026-06-23: Hitya showed 2.3k on a Cazic Thule
-- kill she wasn't at; both of Borowhay's boxes appeared at once — all sourced
-- only from one 3024s blob upload.)
--
-- The prior statistical duration guard here failed because the blob had BOTH
-- the most players and the most damage, so it dominated the percentile math.
-- The reliable fix: when an encounter has any plausible-length contribution
-- (<= cap), build the merged player view + duration from ONLY those, ignoring
-- the blobs. Blob-only encounters still populate (so they're not emptied) but
-- get flagged data_incomplete by the cleanup + the bot's ingest guard.

create or replace function public.merge_encounter_players(p_encounter_id uuid)
returns void language plpgsql security definer as $function$
declare
  v_cap int := 1800;          -- max plausible single-fight seconds (30m); longer = session blob
  v_has_clean boolean;
  v_raid_duration int;
begin
  -- Does this encounter have any non-blob contribution to trust?
  select exists(
    select 1 from contributions
    where encounter_id = p_encounter_id
      and (duration_sec is null or duration_sec <= v_cap)
  ) into v_has_clean;

  delete from encounter_players where encounter_id = p_encounter_id;

  insert into encounter_players
    (encounter_id, character_name, total_damage, dps, duration_sec, has_pets, source_contribution_id, rank)
  select
    p_encounter_id,
    player->>'name'                                                as character_name,
    max((player->>'damage')::bigint)                               as total_damage,
    max((player->>'dps')::int)                                     as dps,
    max((player->>'duration')::int)                                as duration_sec,
    bool_or(coalesce((player->>'hasPets')::boolean, false))        as has_pets,
    (array_agg(c.id order by (player->>'damage')::bigint desc))[1] as source_contribution_id,
    row_number() over (order by max((player->>'damage')::bigint) desc) as rank
  from contributions c
  cross join lateral jsonb_array_elements(c.raw_parse->'players') as player
  where c.encounter_id = p_encounter_id
    and (not v_has_clean or c.duration_sec is null or c.duration_sec <= v_cap)
  group by player->>'name';

  -- Raid-window clock, computed over the SAME eligible (non-blob) set.
  with q as (
    select c.duration_sec, coalesce(c.total_damage, 0) as dmg
    from contributions c
    where c.encounter_id = p_encounter_id
      and c.duration_sec is not null
      and (not v_has_clean or c.duration_sec <= v_cap)
      and coalesce(c.player_count, 0) >= 0.6 * (
        select max(coalesce(player_count, 0))
        from contributions
        where encounter_id = p_encounter_id
          and (not v_has_clean or duration_sec is null or duration_sec <= v_cap)
      )
  ), w as (
    select duration_sec from q
    where dmg >= 0.25 * (select max(dmg) from q)
  ), a as (
    select percentile_cont(0.75) within group (order by duration_sec) as p75 from w
  )
  select max(w.duration_sec) into v_raid_duration
  from w, a
  where w.duration_sec <= 2 * a.p75;

  update encounters
  set total_damage = coalesce((select sum(total_damage) from encounter_players where encounter_id = p_encounter_id), 0),
      total_dps    = coalesce((select sum(dps)          from encounter_players where encounter_id = p_encounter_id), 0),
      duration_sec = coalesce(v_raid_duration, duration_sec)
  where id = p_encounter_id;
end;
$function$;
