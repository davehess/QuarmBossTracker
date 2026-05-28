-- find_or_create_encounter — populate encounters.zone_short on insert so we
-- stop accruing NULL-zone rows that need backfill scripts later. Adds an
-- optional p_zone_short parameter; if the caller omits it, fall back to
-- whatever bosses_local has for the npc. Existing rows are left alone.
--
-- Drop the previous 5-arg overload first; otherwise Postgres keeps it as a
-- distinct function and PostgREST happily routes old callers to the old body.

drop function if exists find_or_create_encounter(text, int, timestamptz, int, int);

create or replace function find_or_create_encounter(
  p_guild_id   text,
  p_npc_id     int,
  p_started_at timestamptz,
  p_duration   int,
  p_window_min int  default 30,
  p_zone_short text default null
) returns uuid as $$
declare
  v_id   uuid;
  v_zone text;
begin
  select id into v_id
  from encounters
  where guild_id = p_guild_id
    and npc_id   = p_npc_id
    and started_at between p_started_at - (p_window_min || ' minutes')::interval
                       and p_started_at + (p_window_min || ' minutes')::interval
  order by abs(extract(epoch from (started_at - p_started_at)))
  limit 1;

  if v_id is null then
    v_zone := coalesce(
      p_zone_short,
      (select zone_short from bosses_local where npc_id = p_npc_id limit 1)
    );

    insert into encounters (guild_id, npc_id, started_at, duration_sec, zone_short)
    values (p_guild_id, p_npc_id, p_started_at, p_duration, v_zone)
    returning id into v_id;
  end if;

  return v_id;
end;
$$ language plpgsql security definer;
