-- 20261012013000_spectator_positions_hp.sql
-- /spectator: take each raider's HP from the freshest row that HAS an HP, not from the row that won the position.
--
-- The guild lead, 2026-10-12: "Spectator keeps only showing one group's HP then showing everyone else".
-- Measured the same night, one 60-second window of raid_roster: 8 uploaders sent HP for all 45 raiders,
-- 13 sent it only for their own group (4-6 rows each, the rest null). The first version picked one row per
-- raider by newest loc_at and read hp_pct off that same row, so the HP column showed whichever uploader
-- happened to write last: one group's bars, then everyone's, then another group's.
--
-- Position, class, group and level still come from the freshest position row. HP comes from the freshest row
-- with a non-null hp_pct inside the same window, and only from a row with a real position: a raider in another
-- zone arrives as (0,0,0), and the HP beside that is not a reading.
-- Same signature and grants as 20261005003000. Idempotent.

create or replace function public.spectator_positions(p_guild_id text, p_fresh_s integer default 30)
returns table(
  name text, class text, group_num integer, level integer, hp_pct numeric,
  loc_x double precision, loc_y double precision, loc_z double precision, heading double precision,
  loc_at timestamptz, uploaded_by_discord_id text)
language sql stable
set search_path = public
as $$
  with fresh as (
    select r.*
      from raid_roster r
     where r.guild_id = p_guild_id
       and r.name is not null
       and r.loc_x is not null
       and r.loc_y is not null
       -- (0,0,0) is how an uploader reports a raider who is in another zone; a newer zero row from that
       -- uploader must not hide a real position another uploader has for the same raider.
       and not (r.loc_x = 0 and r.loc_y = 0 and coalesce(r.loc_z, 0) = 0)
       and r.loc_at > now() - make_interval(secs => least(greatest(coalesce(p_fresh_s, 30), 1), 300))
  ),
  pos as (
    select distinct on (lower(f.name)) f.*
      from fresh f
     order by lower(f.name), f.loc_at desc
  ),
  hp as (
    select distinct on (lower(f.name)) lower(f.name) as k, f.hp_pct
      from fresh f
     where f.hp_pct is not null
     order by lower(f.name), f.loc_at desc
  )
  select p.name, p.class, p.group_num, p.level, h.hp_pct,
         p.loc_x, p.loc_y, p.loc_z, p.heading, p.loc_at, p.uploaded_by_discord_id
    from pos p
    left join hp h on h.k = lower(p.name)
   limit 300;
$$;

revoke all on function public.spectator_positions(text, integer) from public, anon, authenticated;
grant execute on function public.spectator_positions(text, integer) to service_role;
