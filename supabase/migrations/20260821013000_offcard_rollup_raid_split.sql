-- Split the /parses off-card rollup into RAID vs NOT-RAID kills
-- (Hitya 2026-08-20, mid-raid: "separate raid kills from no raid kills").
--
-- The rollup lines currently mix a night's raid trash in with whatever anyone
-- farmed that day — "Ssraeshza Temple — 262 other kills" is mostly solo
-- farming, and the dozen mobs the raid actually cleared are buried in it.
--
-- The split is already in the data: the bot stamps `encounters.raid_night_id`
-- during a raid night (and keeps stamping through the post-midnight spillover,
-- so a fight at 12:20 AM still belongs to the night it started in). No window
-- arithmetic here — deriving 20:30-23:30 in SQL would also get short nights
-- wrong (tonight's Seru run is 3 ticks, 8:30-10:30 PM).
DROP FUNCTION IF EXISTS parses_offcard_rollup(timestamptz);

CREATE FUNCTION parses_offcard_rollup(p_since timestamptz)
RETURNS TABLE(day date, zone_short text, is_raid boolean, kills bigint, total_damage bigint)
LANGUAGE sql STABLE AS $$
  SELECT (e.started_at AT TIME ZONE 'America/New_York')::date AS day,
         COALESCE(e.zone_short, n.zone_short, z.short_name) AS zone_short,
         (e.raid_night_id IS NOT NULL) AS is_raid,
         count(*) AS kills,
         COALESCE(sum(e.total_damage), 0)::bigint AS total_damage
  FROM encounters e
  LEFT JOIN eqemu_npc_types n ON n.id = e.npc_id
  LEFT JOIN eqemu_zone z ON z.zone_id = (e.npc_id / 1000)
  WHERE e.started_at >= p_since
    AND e.total_damage > 0
    AND e.classification IS NULL
    AND NOT EXISTS (SELECT 1 FROM bosses_local b
                    WHERE b.npc_id = e.npc_id AND b.auto_registered = false)
  GROUP BY 1, 2, 3
$$;
