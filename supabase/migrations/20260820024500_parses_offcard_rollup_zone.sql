-- Rollup v2: derive the zone from the catalog id convention when the
-- denormalized columns are NULL (they are, for every fresh encounter —
-- find_or_create_encounter doesn't set zone on insert, and
-- eqemu_npc_types.zone_short is NULL across the mirror). npc_id encodes the
-- zone as id = zone_id*1000 + n (docs/eqemu-catalog-cheatsheet.md), which
-- resolves tonight's flood to Ssraeshza Temple / The Fungus Grove instead of
-- "Unknown zone". Instanced npc ids that don't follow the convention just
-- fall through to NULL as before.
CREATE OR REPLACE FUNCTION parses_offcard_rollup(p_since timestamptz)
RETURNS TABLE(day date, zone_short text, kills bigint, total_damage bigint)
LANGUAGE sql STABLE AS $$
  SELECT (e.started_at AT TIME ZONE 'America/New_York')::date AS day,
         COALESCE(e.zone_short, n.zone_short, z.short_name) AS zone_short,
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
  GROUP BY 1, 2
$$;
