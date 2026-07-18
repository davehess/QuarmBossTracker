-- #92 — family-aware attendance metrics (60d / 90d / lifetime RA% + tick counts).
--
-- AUDIT FINDING (see docs/STATUS.md #92): OpenDKP + the existing surfaces
-- already cover a lot but leave three genuine gaps the rules half of the queue
-- needs:
--   * opendkp_attendance_recent (view) gives per-CHARACTER raid COUNTS for
--     30d/90d/lifetime — but no 60d window, no RA% (no denominator), no tick
--     counts, and it is NOT family-aware (main+alts counted separately).
--   * /admin/attendance computes TICK-level RA% but only for 30d + prior-30d,
--     per character, also not family-aware.
--
-- This view fills exactly those gaps and nothing more: RA% is TICK-based to
-- match OpenDKP's own "30 Day (52/52)" definition and the attendance page's
-- math (denominator = valid ticks in the window; a tick with zero attendees is
-- a sync gap and excluded, same as the page). Family rollup uses the
-- established idiom lower(coalesce(nullif(main_name,''), name)) — identical to
-- character_data_floor — so a main and its alts collapse into one family;
-- attending a tick as ANY family member counts the tick once for the family.
-- Attendee names not in `characters` become their own singleton family so no
-- attendance is silently dropped.
--
-- Consumers (seating priority, Active-roster drop-off, review cards / future
-- #80) should read RA% + tick counts FROM HERE rather than re-deriving.
create or replace view public.member_attendance_metrics
with (security_invoker = on) as
with fam as (
  select
    lower(c.name)                                      as name_l,
    lower(coalesce(nullif(c.main_name, ''), c.name))   as family_key
  from characters c
  where c.guild_id = 'wolfpack'
),
-- Valid ticks only: a tick with no attendees is a mid-raid sync gap (detail
-- fetched before attendance finalized) — counting it credits nobody and would
-- deflate everyone's RA, so it is excluded from BOTH numerator and denominator.
valid_ticks as (
  select t.tick_id, t.raid_id, r.ts, t.attendees
  from opendkp_ticks t
  join opendkp_raids r on r.raid_id = t.raid_id
  where t.attendees is not null
    and array_length(t.attendees, 1) >= 1
),
-- Per-window denominators (total valid ticks / raids held). Same for every
-- family, carried onto each row so consumers can verify / recompute RA%.
denom as (
  select
    count(*) filter (where ts > now() - interval '30 days')            as ticks_30d,
    count(*) filter (where ts > now() - interval '60 days')            as ticks_60d,
    count(*) filter (where ts > now() - interval '90 days')            as ticks_90d,
    count(*)                                                           as ticks_lifetime,
    count(distinct raid_id) filter (where ts > now() - interval '30 days') as raids_30d,
    count(distinct raid_id) filter (where ts > now() - interval '60 days') as raids_60d,
    count(distinct raid_id) filter (where ts > now() - interval '90 days') as raids_90d,
    count(distinct raid_id)                                            as raids_lifetime
  from valid_ticks
),
-- One (family, tick) row per family-attended tick — DISTINCT collapses a main
-- and its alt both present in the same tick into a single family credit.
fam_tick as (
  select distinct
    coalesce(f.family_key, lower(att.name)) as family_key,
    vt.tick_id, vt.raid_id, vt.ts
  from valid_ticks vt
  cross join lateral unnest(vt.attendees) att(name)
  left join fam f on f.name_l = lower(att.name)
),
agg as (
  select
    family_key,
    count(*) filter (where ts > now() - interval '30 days')            as att_ticks_30d,
    count(*) filter (where ts > now() - interval '60 days')            as att_ticks_60d,
    count(*) filter (where ts > now() - interval '90 days')            as att_ticks_90d,
    count(*)                                                           as att_ticks_lifetime,
    count(distinct raid_id) filter (where ts > now() - interval '30 days') as raids_att_30d,
    count(distinct raid_id) filter (where ts > now() - interval '60 days') as raids_att_60d,
    count(distinct raid_id) filter (where ts > now() - interval '90 days') as raids_att_90d,
    count(distinct raid_id)                                            as raids_att_lifetime,
    min(ts) as first_attended,
    max(ts) as last_attended
  from fam_tick
  group by family_key
)
select
  a.family_key,
  coalesce(mc.name, initcap(a.family_key)) as main_name,
  mc.class as main_class,
  mc.rank  as main_rank,
  -- attended tick counts (the numerator / "tick counts" the rules need)
  a.att_ticks_30d, a.att_ticks_60d, a.att_ticks_90d, a.att_ticks_lifetime,
  -- tick denominators (held) so RA% is verifiable
  d.ticks_30d, d.ticks_60d, d.ticks_90d, d.ticks_lifetime,
  -- tick-based RA% (0..1 fraction, matches OpenDKP + the attendance page)
  round(a.att_ticks_30d::numeric      / nullif(d.ticks_30d, 0),      4) as ra_30d,
  round(a.att_ticks_60d::numeric      / nullif(d.ticks_60d, 0),      4) as ra_60d,
  round(a.att_ticks_90d::numeric      / nullif(d.ticks_90d, 0),      4) as ra_90d,
  round(a.att_ticks_lifetime::numeric / nullif(d.ticks_lifetime, 0), 4) as ra_lifetime,
  -- raid-level attendance counts (family-aware; supersedes opendkp_attendance_recent)
  a.raids_att_30d, a.raids_att_60d, a.raids_att_90d, a.raids_att_lifetime,
  d.raids_30d, d.raids_60d, d.raids_90d, d.raids_lifetime,
  a.first_attended, a.last_attended
from agg a
cross join denom d
left join characters mc
  on lower(mc.name) = a.family_key and mc.guild_id = 'wolfpack';
