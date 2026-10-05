-- 20261005003000_spectator_positions.sql
-- One row per raider for /spectator (DECISIONS §160): each raider's freshest position.
--
-- raid_roster keeps one row per (uploader, raider): every Mimic raider uploads the whole raid as their
-- Zeal sees it, every ~3 s. On 2026-10-04 that was ~20 uploaders × 39 raiders = 780 rows inside any 30-second
-- window. Reading them raw for a page that polls every few seconds either cuts raiders off at a row limit
-- or ships ~100 KB per poll. DISTINCT ON in SQL returns at most one row per raider (~6 KB for a full raid).
--
-- p_fresh_s is clamped to 1-300 s; the page asks for 30. The limit (300) is two full raids with headroom,
-- under PostgREST's 1,000-row cap. Called by the website's server route with the service role only, so
-- execute is revoked from anon and authenticated (the lockdown pattern of 20260718040000).
-- Idempotent.

create or replace function public.spectator_positions(p_guild_id text, p_fresh_s integer default 30)
returns table(
  name text, class text, group_num integer, level integer, hp_pct numeric,
  loc_x double precision, loc_y double precision, loc_z double precision, heading double precision,
  loc_at timestamptz, uploaded_by_discord_id text)
language sql stable
set search_path = public
as $$
  select distinct on (lower(r.name))
         r.name, r.class, r.group_num, r.level, r.hp_pct,
         r.loc_x, r.loc_y, r.loc_z, r.heading, r.loc_at, r.uploaded_by_discord_id
    from raid_roster r
   where r.guild_id = p_guild_id
     and r.name is not null
     and r.loc_x is not null
     and r.loc_y is not null
     and r.loc_at > now() - make_interval(secs => least(greatest(coalesce(p_fresh_s, 30), 1), 300))
   order by lower(r.name), r.loc_at desc
   limit 300;
$$;

revoke all on function public.spectator_positions(text, integer) from public, anon, authenticated;
grant execute on function public.spectator_positions(text, integer) to service_role;
