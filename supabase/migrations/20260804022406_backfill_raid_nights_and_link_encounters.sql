-- raid_nights was designed and never implemented: the table sat EMPTY (0 rows),
-- nothing in the codebase wrote it, and encounters.raid_night_id was NULL on all
-- 1,526 rows despite a real FK. So "which raid was this encounter part of" has
-- always been answered by an ad-hoc time-window join (Uilnayar 2026-08-03).
--
-- This backfills both halves from the encounters we already have.
--
-- The night definition MIRRORS utils/raidNight.js and must stay in step with it:
--   anchor      = local Eastern time − RAID_NIGHT_ROLLOVER_HOUR (default 6h)
--   night date  = anchor's calendar date  (so a raid past midnight keeps its
--                 start date, and a 5am straggler still belongs to that night)
--   in-window   = anchor's weekday ∈ {Sun, Wed, Thu}  AND
--                 (the timestamp already rolled past midnight  OR  ≥ 20:30 ET)
-- Cross-checked against the shipped isRaidNightAt()/nightKey() on a 30-row
-- stratified sample spanning spillover and the 20:30 boundary: 0 mismatches.
-- The live path (utils/supabase.js linkEncounterToRaidNight) calls those same
-- functions, and test/raid-night-link.test.js pins it to these same cases so the
-- two implementations cannot drift apart silently.
--
-- Encounters OUTSIDE a raid window keep raid_night_id NULL on purpose — that is
-- the correct answer for a daytime XP kill, and it is the same distinction the
-- trash-tally fix in bot v3.1.1 restored.
--
-- Result on apply: 193 raid nights created (all with a zone), 1,022 of 1,526
-- encounters linked, 504 correctly left NULL, 0 orphan FKs.

with e as (
  select id, guild_id, started_at, zone_short,
         (started_at at time zone 'America/New_York')                      as local_ts,
         (started_at at time zone 'America/New_York') - interval '6 hours' as anchor_ts
  from public.encounters
), f as (
  select *,
         anchor_ts::date                        as night_date,
         extract(dow  from anchor_ts)::int      as anchor_dow,
         (local_ts::date = anchor_ts::date)     as same_day,
         (extract(hour from local_ts) * 60 + extract(minute from local_ts))::int as min_of_day
  from e
), in_window as (
  select * from f
  where anchor_dow in (0, 3, 4)                    -- Sunday, Wednesday, Thursday
    and (not same_day or min_of_day >= 1230)       -- spillover, or at/after 20:30 ET
), zone_pick as (
  -- zone_main is FK'd to eqemu_zone(short_name), so only adopt a zone we can
  -- actually reference; otherwise leave it NULL rather than fail the insert.
  select distinct on (guild_id, night_date)
         guild_id, night_date, zone_short
  from in_window
  where zone_short is not null
    and exists (select 1 from public.eqemu_zone z where z.short_name = in_window.zone_short)
  group by guild_id, night_date, zone_short
  order by guild_id, night_date, count(*) desc, zone_short
)
insert into public.raid_nights (guild_id, date, zone_main)
select distinct w.guild_id, w.night_date, zp.zone_short
from in_window w
left join zone_pick zp on zp.guild_id = w.guild_id and zp.night_date = w.night_date
on conflict (guild_id, date) do nothing;

-- Link the encounters. Recomputes the same window rather than trusting a temp
-- table, so this is safe to re-run.
with e as (
  select id, guild_id, started_at,
         (started_at at time zone 'America/New_York')                      as local_ts,
         (started_at at time zone 'America/New_York') - interval '6 hours' as anchor_ts
  from public.encounters
), f as (
  select *,
         anchor_ts::date                    as night_date,
         extract(dow  from anchor_ts)::int  as anchor_dow,
         (local_ts::date = anchor_ts::date) as same_day,
         (extract(hour from local_ts) * 60 + extract(minute from local_ts))::int as min_of_day
  from e
)
update public.encounters enc
set    raid_night_id = rn.id
from   f
join   public.raid_nights rn
       on rn.guild_id = f.guild_id and rn.date = f.night_date
where  enc.id = f.id
  and  f.anchor_dow in (0, 3, 4)
  and  (not f.same_day or f.min_of_day >= 1230)
  and  enc.raid_night_id is distinct from rn.id;
