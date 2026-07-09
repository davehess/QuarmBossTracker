-- thin_threat_snapshots(p_older_than_days) — downsample old threat telemetry.
--
-- encounter_threat_snapshots lands a row every ~18s per uploader during fights
-- (~78MB/week — 11x the projection the 120-day retention was budgeted on; the
-- table hit 351MB in a month). The only reader is the bot's per-character
-- threat-rank card (30-day window, limit 2000), which doesn't need 3.3
-- rows/minute on week-old fights. This keeps the FIRST snapshot per minute per
-- (guild, uploader, boss) for rows older than the cutoff and deletes the rest
-- (~70% of aged rows), preserving the per-minute shape the rank card samples.
-- Called by the bot's midnight chain; the retention sweep (30d default) still
-- hard-deletes beyond the window.
create or replace function public.thin_threat_snapshots(p_older_than_days int default 7)
returns integer
language sql
security definer
set search_path = public
as $$
  with ranked as (
    select ctid, row_number() over (
      partition by guild_id, uploader, boss_name, date_trunc('minute', snapshot_at)
      order by snapshot_at
    ) as rn
    from encounter_threat_snapshots
    where snapshot_at < now() - make_interval(days => p_older_than_days)
  ),
  del as (
    delete from encounter_threat_snapshots
    where ctid in (select ranked.ctid from ranked where ranked.rn > 1)
    returning 1
  )
  select coalesce(count(*), 0)::integer from del;
$$;

revoke all on function public.thin_threat_snapshots(int) from public;
revoke all on function public.thin_threat_snapshots(int) from anon;
revoke all on function public.thin_threat_snapshots(int) from authenticated;
grant execute on function public.thin_threat_snapshots(int) to service_role;
