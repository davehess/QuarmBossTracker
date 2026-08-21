-- Split the /parses off-card rollup into RAID vs NOT-RAID kills
-- (Hitya 2026-08-20, mid-raid: "separate raid kills from no raid kills" and
-- then, as the spec: "tonight is Seru and VT trash, so it should just be two
-- zones").
--
-- The rollup lines mixed a night's raid trash with whatever anyone farmed that
-- day — "Ssraeshza Temple — 262 other kills · 4.03M" is almost all solo
-- farming, burying the dozen mobs the raid actually cleared.
--
-- TWO conditions make a kill the raid's, not one:
--
-- 1. `encounters.raid_night_id` — stamped by the bot during a raid night, and
--    it keeps stamping through the post-midnight spillover, so a 12:20 AM
--    fight still belongs to the night it started in. Better than deriving a
--    20:30-23:30 clock window, which would mis-bin every short night (the
--    Seru/alt nights run 3 ticks, 8:30-10:30 PM, until PoP).
--
-- 2. ENOUGH OF THE RAID WAS ON IT. raid_night_id is time-based only, so it
--    also tags whatever an individual raider kills in those hours. Tonight
--    that was `a_ferocious_wolf` in The Dawnshroud Peaks — 54 damage, one
--    player, someone clearing a path on the way to Vex Thal — which showed up
--    as a third "raid" zone. Every genuine raid kill tonight had 10-31
--    players; across August, 37 tagged encounters have <=5 players and 198
--    have >=7, so the gap is real and wide.
--
-- The participation bar is RELATIVE (a quarter of that night's peak) with an
-- absolute floor of a full group, so it calibrates itself to how big the raid
-- actually was instead of hard-coding this guild's size — a 12-person guild
-- and a 50-person guild both get a sane answer, which matters for the
-- self-host wizard.
DROP FUNCTION IF EXISTS parses_offcard_rollup(timestamptz);

CREATE FUNCTION parses_offcard_rollup(p_since timestamptz)
RETURNS TABLE(day date, zone_short text, is_raid boolean, kills bigint, total_damage bigint)
LANGUAGE sql STABLE AS $$
  WITH pl AS (
    SELECT encounter_id, count(*) FILTER (WHERE total_damage > 0) AS players
    FROM encounter_players GROUP BY encounter_id
  ), peak AS (
    SELECT e.raid_night_id, max(pl.players) AS peak_players
    FROM encounters e JOIN pl ON pl.encounter_id = e.id
    WHERE e.raid_night_id IS NOT NULL
    GROUP BY 1
  )
  SELECT (e.started_at AT TIME ZONE 'America/New_York')::date AS day,
         COALESCE(e.zone_short, n.zone_short, z.short_name) AS zone_short,
         (e.raid_night_id IS NOT NULL
          AND COALESCE(pl.players, 0) >= GREATEST(6, 0.25 * COALESCE(peak.peak_players, 0))) AS is_raid,
         count(*) AS kills,
         COALESCE(sum(e.total_damage), 0)::bigint AS total_damage
  FROM encounters e
  LEFT JOIN pl ON pl.encounter_id = e.id
  LEFT JOIN peak ON peak.raid_night_id = e.raid_night_id
  LEFT JOIN eqemu_npc_types n ON n.id = e.npc_id
  LEFT JOIN eqemu_zone z ON z.zone_id = (e.npc_id / 1000)
  WHERE e.started_at >= p_since
    AND e.total_damage > 0
    AND e.classification IS NULL
    AND NOT EXISTS (SELECT 1 FROM bosses_local b
                    WHERE b.npc_id = e.npc_id AND b.auto_registered = false)
  GROUP BY 1, 2, 3
$$;
