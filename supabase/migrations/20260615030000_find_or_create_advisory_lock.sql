-- Serialize concurrent same-boss uploads in find_or_create_encounter.
--
-- Observed 2026-06-14: a single kill produced 2-3 duplicate encounter rows
-- (Xerkizh The Creator x2, Arch Lich Rhag`Zadune x3, a glyph covered serpent
-- x2). Every sibling shared the same npc_id + started_at and was created within
-- the SAME SECOND by DIFFERENT uploaders -- the signature of a read-then-insert
-- race: when several raiders' agents upload the same kill at once, each call's
-- dedup SELECT runs before any sibling's INSERT has committed, so they all miss
-- and all insert. Historical data (single-user sequential backfill) had ZERO
-- duplicates; the race only surfaces under concurrent live multi-agent uploads,
-- which grow as Mimic adoption rises.
--
-- Fix: take a transaction-scoped advisory lock on (guild_id, npc_id) at entry.
-- Concurrent calls for the same boss now serialize -- the second blocks until
-- the first commits, then its SELECT finds the row and reuses it (the intended
-- merge). Different bosses hash to different lock keys, so there is no real
-- contention. An advisory lock, NOT a unique index, because dedup is a +/-window
-- RANGE match plus the double-kill guard -- not a fixed unique key.

create or replace function find_or_create_encounter(
  p_guild_id text,
  p_npc_id integer,
  p_started_at timestamptz,
  p_duration integer,
  p_window_min integer default 30,
  p_zone_short text default null
)
returns uuid as $$
declare
  v_id        uuid;
  v_start     timestamptz;
  v_dur       integer;
  v_dmg       bigint;
  v_hp        bigint;
  v_zone      text;
begin
  -- Serialize concurrent uploads of the SAME boss so the dedup SELECT below
  -- cannot race a sibling INSERT (see header). Auto-released at COMMIT.
  perform pg_advisory_xact_lock(hashtextextended(p_guild_id || ':' || p_npc_id::text, 0));

  select id, started_at, coalesce(duration_sec, 0), coalesce(total_damage, 0)
    into v_id, v_start, v_dur, v_dmg
  from encounters
  where guild_id = p_guild_id
    and npc_id   = p_npc_id
    and started_at between p_started_at - (p_window_min || ' minutes')::interval
                       and p_started_at + (p_window_min || ' minutes')::interval
  order by abs(extract(epoch from (started_at - p_started_at)))
  limit 1;

  -- Double-kill guard (see 20260611170000_find_or_create_double_kill_guard.sql).
  if v_id is not null then
    select hp into v_hp from eqemu_npc_types where id = p_npc_id;
    if v_hp is not null and v_hp > 0
       and v_dmg >= 0.9 * v_hp
       and p_started_at > v_start + make_interval(secs => greatest(v_dur, 60) + 120)
    then
      v_id := null;   -- matched row is a finished, complete kill -- this is a new one
    end if;
  end if;

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
