-- Right grain per fight type, so the threat roll-up is genuinely permanent.
--
-- Hitya: "if it's that tiny we can continue to retain it indefinitely." At
-- per-fight-per-player grain it was NOT tiny — 31 MB for five weeks
-- (~330 MB/yr), 87% of it trash. The signal differs by fight type:
--   · BOSS  — "where did I rank on THIS pull". Per-fight is the unit.
--   · TRASH — "across Wednesday's trash, who rode the top". Per-NIGHT is the
--             unit; nobody asks about trash pull #4,213.
--
-- Result: 114,444 trash rows -> 1,087, folding 104,846 pulls across 11 nights.
-- Whole table 31 MB -> 4.8 MB (~49 MB/yr), which IS indefinitely retainable.

ALTER TABLE public.encounter_threat_rank
  ADD COLUMN IF NOT EXISTS fights_counted integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.rollup_threat_ranks(p_since_hours integer DEFAULT 48)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
  v_min_group integer := 8;
BEGIN
  WITH ranked AS (
    SELECT s.guild_id, s.boss_name, s.encounter_id, s.raid_night_id,
           s.started_at, s.snapshot_at,
           p.key AS character_name,
           row_number() OVER (
             PARTITION BY s.guild_id, COALESCE(s.boss_name,''), s.started_at, s.snapshot_at, s.uploader
             ORDER BY (COALESCE((p.value->>'swing')::numeric, 0)
                     + COALESCE((p.value->>'proc')::numeric,  0)
                     + COALESCE((p.value->>'spell')::numeric, 0)
                     + COALESCE((p.value->>'heal')::numeric,  0)) DESC
           ) AS rank,
           count(*) OVER (
             PARTITION BY s.guild_id, COALESCE(s.boss_name,''), s.started_at, s.snapshot_at, s.uploader
           ) AS field
      FROM public.encounter_threat_snapshots s
      CROSS JOIN LATERAL jsonb_each(s.per_player) p
     WHERE s.started_at IS NOT NULL
       AND jsonb_typeof(s.per_player) = 'object'
       AND (p_since_hours IS NULL OR s.snapshot_at > now() - make_interval(hours => p_since_hours))
       AND (s.boss_name IS NOT NULL OR s.raid_night_id IS NOT NULL)
  ), keyed AS (
    -- A boss keeps its own fight key. Trash collapses onto the raid night
    -- (06:00 ET rollover), so one night of pulls is ONE row per character.
    SELECT guild_id, character_name, boss_name, encounter_id, raid_night_id,
           rank, field, started_at,
           CASE WHEN boss_name IS NOT NULL THEN boss_name ELSE '(raid trash)' END AS boss_name_key,
           CASE WHEN boss_name IS NOT NULL THEN started_at
                ELSE date_trunc('day', (snapshot_at AT TIME ZONE 'America/New_York') - interval '6 hours')
                     AT TIME ZONE 'America/New_York' END AS started_at_key
      FROM ranked
  ), agg AS (
    SELECT guild_id, boss_name_key, started_at_key, character_name,
           min(boss_name) AS boss_name,
           (array_agg(encounter_id)  FILTER (WHERE encounter_id  IS NOT NULL))[1] AS encounter_id,
           (array_agg(raid_night_id) FILTER (WHERE raid_night_id IS NOT NULL))[1] AS raid_night_id,
           count(DISTINCT started_at)        AS fights_counted,
           count(*)                          AS snapshots,
           count(*) FILTER (WHERE rank = 1)  AS times_top1,
           count(*) FILTER (WHERE rank <= 3) AS times_top3,
           min(rank) AS best_rank, max(rank) AS worst_rank,
           round(avg(rank)::numeric, 2)  AS avg_rank,
           round(avg(field)::numeric, 2) AS avg_field
      FROM keyed
     GROUP BY guild_id, boss_name_key, started_at_key, character_name
  )
  INSERT INTO public.encounter_threat_rank
    (guild_id, boss_name_key, started_at_key, character_name, boss_name,
     encounter_id, raid_night_id, started_at, fights_counted,
     snapshots, times_top1, times_top3, best_rank, worst_rank, avg_rank, avg_field)
  SELECT guild_id, boss_name_key, started_at_key, character_name, boss_name,
         encounter_id, raid_night_id, started_at_key, fights_counted,
         snapshots, times_top1, times_top3, best_rank, worst_rank, avg_rank, avg_field
    FROM agg
   WHERE boss_name IS NOT NULL OR avg_field >= v_min_group
  ON CONFLICT (guild_id, boss_name_key, started_at_key, character_name) DO UPDATE
    SET snapshots = EXCLUDED.snapshots, times_top1 = EXCLUDED.times_top1,
        times_top3 = EXCLUDED.times_top3, best_rank = EXCLUDED.best_rank,
        worst_rank = EXCLUDED.worst_rank, avg_rank = EXCLUDED.avg_rank,
        avg_field = EXCLUDED.avg_field, boss_name = EXCLUDED.boss_name,
        fights_counted = EXCLUDED.fights_counted,
        encounter_id  = COALESCE(EXCLUDED.encounter_id,  encounter_threat_rank.encounter_id),
        raid_night_id = COALESCE(EXCLUDED.raid_night_id, encounter_threat_rank.raid_night_id),
        rolled_up_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

-- Old per-fight trash rows are superseded by the nightly ones.
DELETE FROM public.encounter_threat_rank WHERE boss_name IS NULL;
