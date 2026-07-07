-- who_observations retention (Uilnayar 2026-07-07: "keep the who information,
-- but we don't need every instance of a player if we know their information,
-- really just the latest one").
--
-- who_observations was append-only (one row per character per minute per
-- uploader) and had never been pruned — 170k rows / 102MB, oldest from
-- 2023-11, and ~65% of it older than 45 days. But it's not JUST an identity
-- store: two consumers read raw timestamped rows —
--   • flag_zek_proximity_recent (±3 min zone co-occurrence; only ever the
--     last ~5 minutes), and
--   • /admin/encounters + /admin/signups (who was in-zone ±15 min of a raid).
-- So we CAN'T collapse everything to one row per character without losing
-- recent-raid attendance reconstruction. Instead: keep everything from the
-- last N days RAW, and before that keep only each character's single latest
-- sighting. That preserves every character's known info (the /who directory
-- shows everyone ever seen, last-known class/level/guild/zek) while dropping
-- the redundant historical duplicates.
--
-- Idempotent — safe to re-run. Called nightly from the bot's midnight chain
-- and once here for the initial cleanup.

CREATE OR REPLACE FUNCTION public.prune_who_observations(p_keep_days int DEFAULT 60)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count int;
BEGIN
  -- The single most-recent row per character (case-insensitive) is protected
  -- from deletion at ANY age, so the identity directory never loses a player.
  WITH latest AS (
    SELECT DISTINCT ON (lower("character")) id
    FROM public.who_observations
    ORDER BY lower("character"), observed_at DESC
  ), del AS (
    DELETE FROM public.who_observations w
    WHERE w.observed_at < now() - make_interval(days => p_keep_days)
      AND NOT EXISTS (SELECT 1 FROM latest l WHERE l.id = w.id)
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM del;
  RETURN v_count;
END;
$$;

-- Initial cleanup pass (this migration also runs it once on apply).
SELECT public.prune_who_observations(60);
