-- member_attendance_metrics — RA% could exceed 100% for a new member.
--
-- Reported 2026-08-28: SuperBloodWolf showed **175%** at 30/60/90d while
-- lifetime read 100%. Measured: att_ticks_90d = 7, ticks_90d = 4.
--
-- CAUSE — the numerator and denominator did not share a boundary rule:
--
--   numerator    ts >  now() - '90 days'                        -- no lower clamp
--   denominator  ts >  GREATEST(now() - '90 days', first_attended)   -- STRICTLY >
--   lifetime     ts >= first_attended                           -- but this one >=
--
-- Raid timestamps are date-only (noon UTC), so every tick in a raid shares one
-- ts, and for a new member `first_attended` IS that timestamp. The strict `>`
-- therefore drops their ENTIRE FIRST RAID from the denominator while the
-- numerator still counts it. SuperBloodWolf's first raid held 3 ticks: 7/(7-3)
-- = 175%. The lifetime column used `>=`, which is why it alone was right — the
-- two lines were written to different rules and the disagreement only shows on
-- someone new enough for the clamp to bind.
--
-- FIX: `>=` in the windowed denominators, matching lifetime. Harmless where
-- first_attended is older than the window (the bound is the window edge and a
-- tick exactly on it is a boundary case either way); correct where it binds.
--
-- ⚠ This view is the source for the #80 review cards and the attendance page,
-- so a wrong RA% feeds real decisions about people.
create or replace view public.member_attendance_metrics as
 WITH fam AS (
         SELECT lower(c.name) AS name_l,
            lower(COALESCE(NULLIF(c.main_name, ''::text), c.name)) AS family_key
           FROM characters c
          WHERE c.guild_id = 'wolfpack'::text
        ), valid_ticks AS (
         SELECT t.tick_id, t.raid_id, r.ts, t.attendees
           FROM opendkp_ticks t
             JOIN opendkp_raids r ON r.raid_id = t.raid_id
          WHERE t.attendees IS NOT NULL AND array_length(t.attendees, 1) >= 1
        ), fam_tick AS (
         SELECT DISTINCT COALESCE(f.family_key, lower(att.name)) AS family_key,
            vt.tick_id, vt.raid_id, vt.ts
           FROM valid_ticks vt
             CROSS JOIN LATERAL unnest(vt.attendees) att(name)
             LEFT JOIN fam f ON f.name_l = lower(att.name)
        ), agg AS (
         SELECT fam_tick.family_key,
            count(*) FILTER (WHERE fam_tick.ts > (now() - '30 days'::interval)) AS att_ticks_30d,
            count(*) FILTER (WHERE fam_tick.ts > (now() - '60 days'::interval)) AS att_ticks_60d,
            count(*) FILTER (WHERE fam_tick.ts > (now() - '90 days'::interval)) AS att_ticks_90d,
            count(*) AS att_ticks_lifetime,
            count(DISTINCT fam_tick.raid_id) FILTER (WHERE fam_tick.ts > (now() - '30 days'::interval)) AS raids_att_30d,
            count(DISTINCT fam_tick.raid_id) FILTER (WHERE fam_tick.ts > (now() - '60 days'::interval)) AS raids_att_60d,
            count(DISTINCT fam_tick.raid_id) FILTER (WHERE fam_tick.ts > (now() - '90 days'::interval)) AS raids_att_90d,
            count(DISTINCT fam_tick.raid_id) AS raids_att_lifetime,
            min(fam_tick.ts) AS first_attended,
            max(fam_tick.ts) AS last_attended
           FROM fam_tick
          GROUP BY fam_tick.family_key
        ), denom AS (
         SELECT a_1.family_key,
            d_1.ticks_30d, d_1.ticks_60d, d_1.ticks_90d, d_1.ticks_lifetime,
            d_1.raids_30d, d_1.raids_60d, d_1.raids_90d, d_1.raids_lifetime
           FROM agg a_1
             CROSS JOIN LATERAL ( SELECT
                    count(*) FILTER (WHERE vt.ts >= GREATEST(now() - '30 days'::interval, a_1.first_attended)) AS ticks_30d,
                    count(*) FILTER (WHERE vt.ts >= GREATEST(now() - '60 days'::interval, a_1.first_attended)) AS ticks_60d,
                    count(*) FILTER (WHERE vt.ts >= GREATEST(now() - '90 days'::interval, a_1.first_attended)) AS ticks_90d,
                    count(*) FILTER (WHERE vt.ts >= a_1.first_attended) AS ticks_lifetime,
                    count(DISTINCT vt.raid_id) FILTER (WHERE vt.ts >= GREATEST(now() - '30 days'::interval, a_1.first_attended)) AS raids_30d,
                    count(DISTINCT vt.raid_id) FILTER (WHERE vt.ts >= GREATEST(now() - '60 days'::interval, a_1.first_attended)) AS raids_60d,
                    count(DISTINCT vt.raid_id) FILTER (WHERE vt.ts >= GREATEST(now() - '90 days'::interval, a_1.first_attended)) AS raids_90d,
                    count(DISTINCT vt.raid_id) FILTER (WHERE vt.ts >= a_1.first_attended) AS raids_lifetime
                   FROM valid_ticks vt) d_1
        )
 SELECT a.family_key,
    COALESCE(mc.name, initcap(a.family_key)) AS main_name,
    mc.class AS main_class,
    mc.rank AS main_rank,
    a.att_ticks_30d, a.att_ticks_60d, a.att_ticks_90d, a.att_ticks_lifetime,
    d.ticks_30d, d.ticks_60d, d.ticks_90d, d.ticks_lifetime,
    round(a.att_ticks_30d::numeric / NULLIF(d.ticks_30d, 0)::numeric, 4) AS ra_30d,
    round(a.att_ticks_60d::numeric / NULLIF(d.ticks_60d, 0)::numeric, 4) AS ra_60d,
    round(a.att_ticks_90d::numeric / NULLIF(d.ticks_90d, 0)::numeric, 4) AS ra_90d,
    round(a.att_ticks_lifetime::numeric / NULLIF(d.ticks_lifetime, 0)::numeric, 4) AS ra_lifetime,
    a.raids_att_30d, a.raids_att_60d, a.raids_att_90d, a.raids_att_lifetime,
    d.raids_30d, d.raids_60d, d.raids_90d, d.raids_lifetime,
    a.first_attended, a.last_attended
   FROM agg a
     JOIN denom d ON d.family_key = a.family_key
     LEFT JOIN characters mc ON lower(mc.name) = a.family_key AND mc.guild_id = 'wolfpack'::text;
