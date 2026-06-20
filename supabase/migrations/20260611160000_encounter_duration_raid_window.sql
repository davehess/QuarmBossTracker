-- Encounter duration = the RAID's engaged burn window, not the longest
-- parser's window and not the first uploader's.
--
-- Problem: encounters.duration_sec was set once at creation from whichever
-- contrib arrived first and never recomputed. Real raid nights break that in
-- three distinct ways (all observed 2026-06-10/11):
--   1) Late-join first uploader pins an absurdly SHORT clock (Aten Ha Ra
--      stored 71s for a ~5min burn because the first upload was a 71s
--      late-join window).
--   2) Pull/kite windows run 10x the burn — bosses get kited 45+ minutes
--      with only the pull team engaged (Thall Va Xakra: kite-watcher contrib
--      2209s vs the raid's 457s burn cluster).
--   3) Long-window SPECTATORS: a parser idling near the kite path sees most
--      raider names (player_count is cumulative-distinct, so anyone whose
--      window spans the burn sees everyone) but captures almost no damage
--      (Kaas Thox: 1529s window with only 8% of the damage, vs the complete
--      814s witness that captured 95% of it).
--
-- Rule — the clock is set by contribs that actually WITNESSED the burn:
--   qualifying = player_count >= 60% of the peak contrib's player_count
--                (scales from 6-man splits to full raids)
--            AND total_damage >= 25% of the best qualifying contrib's damage
--                (fighters, not spectators)
--   anchor    = 75th-percentile duration of qualifying contribs
--   duration  = MAX(qualifying duration <= 2 * anchor)
--                (tolerates honest long windows; cuts pull/kite tails)
--
-- Per-player rows are untouched: damage stays max-per-player across ALL
-- contribs (out-of-range wizards/rangers keep their full parses — that's the
-- point of multi-perspective merging) and each player keeps their OWN
-- duration/dps. Only the encounter-level clock changes.
--
-- Lives in merge_encounter_players so every upload / admin backfill / merge
-- self-corrects the clock as better witnesses arrive.

create or replace function merge_encounter_players(p_encounter_id uuid)
returns void as $$
declare
  v_raid_duration int;
begin
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
  group by player->>'name';

  -- Raid-window clock (see header comment).
  with q as (
    select c.duration_sec, coalesce(c.total_damage, 0) as dmg
    from contributions c
    where c.encounter_id = p_encounter_id
      and c.duration_sec is not null
      and coalesce(c.player_count, 0) >= 0.6 * (
        select max(coalesce(player_count, 0))
        from contributions where encounter_id = p_encounter_id
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
$$ language plpgsql security definer;

-- One-shot: recompute the clock for every historical encounter that has
-- contribs. Idempotent — re-running produces the same durations.
update encounters e
set duration_sec = rw.dur
from (
  with peaks as (
    select encounter_id, max(coalesce(player_count, 0)) as peak
    from contributions group by encounter_id
  ), q as (
    select c.encounter_id, c.duration_sec, coalesce(c.total_damage, 0) as dmg
    from contributions c join peaks p on p.encounter_id = c.encounter_id
    where c.duration_sec is not null
      and coalesce(c.player_count, 0) >= 0.6 * p.peak
  ), w as (
    select q.encounter_id, q.duration_sec
    from q join (select encounter_id, max(dmg) as best from q group by encounter_id) b
      on b.encounter_id = q.encounter_id
    where q.dmg >= 0.25 * b.best
  ), a as (
    select encounter_id, percentile_cont(0.75) within group (order by duration_sec) as p75
    from w group by encounter_id
  )
  select w.encounter_id, max(w.duration_sec) as dur
  from w join a on a.encounter_id = w.encounter_id
  where w.duration_sec <= 2 * a.p75
  group by w.encounter_id
) rw
where rw.encounter_id = e.id
  and rw.dur is not null
  and rw.dur is distinct from e.duration_sec;
