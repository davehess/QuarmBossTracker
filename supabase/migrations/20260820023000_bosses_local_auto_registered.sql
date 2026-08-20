-- #47 follow-up (Hitya 2026-08-19: "THESE are not the right parses to display
-- here for nonbosses"): bot 3.1.52's self-registration opened bosses_local to
-- any exact eqemu name match so first kills can never be dropped — but that
-- also means farm/raid trash now persists encounters, and wolfpack.quest
-- /parses (which had no boss filter of its own — the curated allowlist was
-- accidentally doing that job at ingest) flooded with trash cards, 336 in one
-- day. Collection stays open on purpose; this records PROVENANCE so display
-- surfaces can filter: curated rows (human-added) vs auto-registered
-- first-time content.
ALTER TABLE bosses_local
  ADD COLUMN IF NOT EXISTS auto_registered boolean NOT NULL DEFAULT false;

-- Backfill: every row added since 3.1.52 deployed (2026-08-17) was
-- self-registered EXCEPT the three Sleeper's Tomb nameds patched by hand
-- during the P1 recovery that same morning.
UPDATE bosses_local SET auto_registered = true
WHERE added_at >= '2026-08-17'
  AND internal_id NOT IN ('final_arbiter', 'progenitor', 'master_of_the_guard');

-- Per-night rollup of the off-card kills for /parses: one muted line per
-- raid-day + zone instead of a card flood. Day bucketing matches the web's
-- Eastern raid-day grouping (dayKey). NOTE for the self-host wizard: the
-- raid-day timezone is a guild setting — another deployment wants its own.
CREATE OR REPLACE FUNCTION parses_offcard_rollup(p_since timestamptz)
RETURNS TABLE(day date, zone_short text, kills bigint, total_damage bigint)
LANGUAGE sql STABLE AS $$
  SELECT (e.started_at AT TIME ZONE 'America/New_York')::date AS day,
         COALESCE(e.zone_short, n.zone_short) AS zone_short,
         count(*) AS kills,
         COALESCE(sum(e.total_damage), 0)::bigint AS total_damage
  FROM encounters e
  LEFT JOIN eqemu_npc_types n ON n.id = e.npc_id
  WHERE e.started_at >= p_since
    AND e.total_damage > 0
    AND e.classification IS NULL
    AND NOT EXISTS (SELECT 1 FROM bosses_local b
                    WHERE b.npc_id = e.npc_id AND b.auto_registered = false)
  GROUP BY 1, 2
$$;
