-- member_attendance_metrics: measure each member against the ticks THEY could
-- have attended, not every tick the guild has ever run.
--
-- Reported by Hitya 2026-08-07: "Gonner has never missed a raid tick" while the
-- attendance page showed him at 64% lifetime. Both were true statements about
-- different denominators.
--
--   Gonner's first tick        2024-12-01
--   ticks since he joined             966
--   ticks he attended                 958   -> 99.2%  (the truth, and what
--                                                      OpenDKP reports)
--   ALL guild ticks ever            1,492
--   958 / 1,492                              -> 64.2%  (what we displayed)
--
-- The `denom` CTE computed guild-wide counts with no member scoping and was
-- CROSS JOINed onto every family, so every member carried an identical
-- denominator. This is not a Gonner bug — EVERY member who joined after the
-- guild started was under-reported, worst for the newest people, which is
-- exactly backwards from what a recruiting or gap-detection view wants.
--
-- Fix: the denominator is now per-family and floored at that family's first
-- attended tick, for every window. GREATEST(window_start, first_attended)
-- means a member who joined 10 days ago is measured over 10 days, not 30 —
-- the same rule OpenDKP applies (Gonner reads 56/56, 104/104, 152/152 there).
--
-- CLAUDE.md already declares this policy under "Per-character data floor"
-- (`member_since` across the character's family); it simply was never applied
-- here. Ticks-based, family-rolled-up semantics are otherwise unchanged.

CREATE OR REPLACE VIEW public.member_attendance_metrics AS
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
  SELECT family_key,
         count(*) FILTER (WHERE ts > (now() - '30 days'::interval)) AS att_ticks_30d,
         count(*) FILTER (WHERE ts > (now() - '60 days'::interval)) AS att_ticks_60d,
         count(*) FILTER (WHERE ts > (now() - '90 days'::interval)) AS att_ticks_90d,
         count(*) AS att_ticks_lifetime,
         count(DISTINCT raid_id) FILTER (WHERE ts > (now() - '30 days'::interval)) AS raids_att_30d,
         count(DISTINCT raid_id) FILTER (WHERE ts > (now() - '60 days'::interval)) AS raids_att_60d,
         count(DISTINCT raid_id) FILTER (WHERE ts > (now() - '90 days'::interval)) AS raids_att_90d,
         count(DISTINCT raid_id) AS raids_att_lifetime,
         min(ts) AS first_attended,
         max(ts) AS last_attended
    FROM fam_tick
   GROUP BY family_key
), denom AS (
  -- Per-family, floored at first_attended. The LATERAL is what makes this
  -- member-scoped: it re-counts valid_ticks for each family's own window.
  SELECT a.family_key,
         d.ticks_30d, d.ticks_60d, d.ticks_90d, d.ticks_lifetime,
         d.raids_30d, d.raids_60d, d.raids_90d, d.raids_lifetime
    FROM agg a
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE vt.ts > GREATEST(now() - '30 days'::interval, a.first_attended)) AS ticks_30d,
             count(*) FILTER (WHERE vt.ts > GREATEST(now() - '60 days'::interval, a.first_attended)) AS ticks_60d,
             count(*) FILTER (WHERE vt.ts > GREATEST(now() - '90 days'::interval, a.first_attended)) AS ticks_90d,
             count(*) FILTER (WHERE vt.ts >= a.first_attended) AS ticks_lifetime,
             count(DISTINCT vt.raid_id) FILTER (WHERE vt.ts > GREATEST(now() - '30 days'::interval, a.first_attended)) AS raids_30d,
             count(DISTINCT vt.raid_id) FILTER (WHERE vt.ts > GREATEST(now() - '60 days'::interval, a.first_attended)) AS raids_60d,
             count(DISTINCT vt.raid_id) FILTER (WHERE vt.ts > GREATEST(now() - '90 days'::interval, a.first_attended)) AS raids_90d,
             count(DISTINCT vt.raid_id) FILTER (WHERE vt.ts >= a.first_attended) AS raids_lifetime
        FROM valid_ticks vt
    ) d
)
SELECT a.family_key,
       COALESCE(mc.name, initcap(a.family_key)) AS main_name,
       mc.class AS main_class,
       mc.rank AS main_rank,
       a.att_ticks_30d, a.att_ticks_60d, a.att_ticks_90d, a.att_ticks_lifetime,
       d.ticks_30d, d.ticks_60d, d.ticks_90d, d.ticks_lifetime,
       round(a.att_ticks_30d::numeric      / NULLIF(d.ticks_30d, 0)::numeric, 4)      AS ra_30d,
       round(a.att_ticks_60d::numeric      / NULLIF(d.ticks_60d, 0)::numeric, 4)      AS ra_60d,
       round(a.att_ticks_90d::numeric      / NULLIF(d.ticks_90d, 0)::numeric, 4)      AS ra_90d,
       round(a.att_ticks_lifetime::numeric / NULLIF(d.ticks_lifetime, 0)::numeric, 4) AS ra_lifetime,
       a.raids_att_30d, a.raids_att_60d, a.raids_att_90d, a.raids_att_lifetime,
       d.raids_30d, d.raids_60d, d.raids_90d, d.raids_lifetime,
       a.first_attended, a.last_attended
  FROM agg a
  JOIN denom d ON d.family_key = a.family_key
  LEFT JOIN characters mc ON lower(mc.name) = a.family_key AND mc.guild_id = 'wolfpack'::text;
