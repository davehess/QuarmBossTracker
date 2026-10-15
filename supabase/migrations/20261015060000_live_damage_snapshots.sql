-- live_damage_snapshots(...): the DPS/Tank Meter's live-damage read, phrased so it can use an index
-- (2026-10-15, after the raid-night database overload).
--
-- Why. /api/agent/live-damage read encounter_threat_snapshots with `boss_name = $boss`. The only boss index is
-- idx_threat_snapshots_boss_time on (lower(boss_name), snapshot_at) WHERE boss_name IS NOT NULL, which a plain
-- `boss_name =` cannot use, so every call walked the snapshot_at range and filtered: 153 ms and ~14,400 buffers
-- per call. pg_stat_statements (since 2026-10-12): 183k calls, ~8.8 h of database time, the largest single cost
-- on a 1 GB instance that ran out of memory mid-raid. With lower(boss_name) the same read is an index range scan:
-- 0.9 ms, 3 buffers (EXPLAIN ANALYZE, production, 2026-10-15). No new index, no extra disk.
--
-- Boss names are compared case-insensitively, as the index is built. STABLE + LANGUAGE sql so the planner inlines
-- it and sees the index. Called only by the bot (service_role).

create or replace function public.live_damage_snapshots(
  p_guild_id text,
  p_boss     text,
  p_since    timestamptz,
  p_start_lo timestamptz default null,
  p_start_hi timestamptz default null
)
returns table (uploader text, snapshot_at timestamptz, per_player jsonb)
language sql
stable
set search_path = public
as $$
  select s.uploader, s.snapshot_at, s.per_player
    from public.encounter_threat_snapshots s
   where s.boss_name is not null
     and lower(s.boss_name) = lower(p_boss)
     and s.snapshot_at >= p_since
     and s.guild_id = p_guild_id
     and (p_start_lo is null or s.started_at >= p_start_lo)
     and (p_start_hi is null or s.started_at <= p_start_hi)
   order by s.snapshot_at desc
   limit 400
$$;

revoke all on function public.live_damage_snapshots(text, text, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.live_damage_snapshots(text, text, timestamptz, timestamptz, timestamptz) to service_role;
