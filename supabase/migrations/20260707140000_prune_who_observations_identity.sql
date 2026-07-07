-- who_observations retention, identity-preserving fix.
--
-- The first cut (20260707110000) protected only each character's single LATEST
-- sighting from deletion. That is NOT enough to "keep the who information": the
-- who_directory view recovers a character's class/level/guild/zone from the
-- most-recent NON-NULL row for each field, which is often NOT the latest row —
-- an EQ /who while /anon hides class, level, AND guild, so an anon-latest
-- character's real identity lives on an OLDER row. Keeping only the latest row
-- meant that once the identity-bearing row aged past the retention window it
-- would be pruned and the directory would blank the player's class/level/guild
-- even though we still list them (the latest anon row survives).
--
-- Fix: protect, per character, the latest row PLUS the most-recent row that
-- actually supplies each directory attribute (class / level / guild_name /
-- zone), plus one row establishing the "ever seen in Zek" PvP signal the
-- directory's bool_or flags expose. Everything else older than N days is still
-- pruned, so the volume win is preserved — we just never drop the last row that
-- tells us who someone is.
--
-- first_seen in the directory becomes "earliest RETAINED sighting" rather than
-- the true first ever; that column is informational only (the membership data
-- floor is derived from chat + OpenDKP, not from /who), so this is acceptable.
--
-- Idempotent — safe to re-run. Called nightly from the bot's midnight chain.

CREATE OR REPLACE FUNCTION public.prune_who_observations(p_keep_days int DEFAULT 60)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count int;
BEGIN
  WITH keep AS (
    -- The latest sighting per character (case-insensitive) — the row the /who
    -- window anchors on. Protected at ANY age. Each DISTINCT ON branch is
    -- parenthesized so its ORDER BY binds to the branch, not the whole UNION.
    (SELECT DISTINCT ON (lower("character")) id
     FROM public.who_observations
     ORDER BY lower("character"), observed_at DESC)
    UNION
    -- Most-recent row that carries each identity attribute, so the directory's
    -- best_class / best_level / best_guild / best_zone fallbacks keep their
    -- source row even when the latest /who was /anon (which hides all four).
    (SELECT DISTINCT ON (lower("character")) id
     FROM public.who_observations
     WHERE class IS NOT NULL AND class <> ''
     ORDER BY lower("character"), observed_at DESC)
    UNION
    (SELECT DISTINCT ON (lower("character")) id
     FROM public.who_observations
     WHERE level IS NOT NULL
     ORDER BY lower("character"), observed_at DESC)
    UNION
    (SELECT DISTINCT ON (lower("character")) id
     FROM public.who_observations
     WHERE guild_name IS NOT NULL AND guild_name <> ''
     ORDER BY lower("character"), observed_at DESC)
    UNION
    (SELECT DISTINCT ON (lower("character")) id
     FROM public.who_observations
     WHERE zone IS NOT NULL AND zone <> ''
     ORDER BY lower("character"), observed_at DESC)
    UNION
    -- One row per character establishing the "ever seen in Zek" signal so the
    -- directory's ever_zek_guild / ever_inferred_zek bool_or flags stay true.
    (SELECT DISTINCT ON (lower("character")) id
     FROM public.who_observations
     WHERE inferred_zek_at IS NOT NULL
        OR btrim(guild_name) ~* '^(zek|rise of zek)$'
     ORDER BY lower("character"), observed_at DESC)
  ), del AS (
    DELETE FROM public.who_observations w
    WHERE w.observed_at < now() - make_interval(days => p_keep_days)
      AND NOT EXISTS (SELECT 1 FROM keep k WHERE k.id = w.id)
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM del;
  RETURN v_count;
END;
$$;

-- Re-run once on apply (idempotent; deletes nothing that is now protected).
SELECT public.prune_who_observations(60);
