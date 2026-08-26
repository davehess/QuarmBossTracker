-- opendkp_call_stats — a public, live counter of every request we send OpenDKP.
--
-- WHY (Hitya, 2026-08-26): "moncs is ready to unblock us, so I need a live
-- counter site that's open access on wolfpack.quest." After an incident where
-- our traffic cost a third party real money, "trust us, it's fixed" is not a
-- reasonable ask. He gets a URL that shows what we are actually sending, in his
-- own vocabulary (the endpoint shapes his API Gateway log groups by), and can
-- watch it himself the moment he lifts the IP block.
--
-- Minute buckets, not a row per call. A row per call would reproduce our own
-- incident in miniature — the write amplification that started this whole
-- affair — so the bot aggregates in memory and flushes one upsert per minute
-- per endpoint. At ~6 endpoints that is <9k rows/day worst case, and the prune
-- below keeps it bounded.
--
-- ⚠ PUBLIC READ. This is the only table in the schema readable by `anon`,
-- deliberately: the page has no sign-in because the person who most needs it
-- is not in our Discord. It carries no member names, no character names and no
-- credentials — only endpoint shapes and counts.

CREATE TABLE IF NOT EXISTS opendkp_call_stats (
  minute       timestamptz NOT NULL,
  endpoint     text        NOT NULL,   -- normalized: /clients/{client}/auctions
  method       text        NOT NULL DEFAULT 'GET',
  calls        integer     NOT NULL DEFAULT 0,
  bytes        bigint      NOT NULL DEFAULT 0,
  errors       integer     NOT NULL DEFAULT 0,
  blocked      integer     NOT NULL DEFAULT 0,   -- refused locally (halt/budget)
  PRIMARY KEY (minute, endpoint, method)
);

CREATE INDEX IF NOT EXISTS opendkp_call_stats_minute_idx
  ON opendkp_call_stats (minute DESC);

ALTER TABLE opendkp_call_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS opendkp_call_stats_public_read ON opendkp_call_stats;
CREATE POLICY opendkp_call_stats_public_read
  ON opendkp_call_stats FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON opendkp_call_stats TO anon, authenticated;

-- Rolling 30-day window. Called from the bot's midnight chain; safe to run any
-- time, and deliberately NOT a trigger (a per-write delete is the amplification
-- pattern this table exists to avoid).
CREATE OR REPLACE FUNCTION prune_opendkp_call_stats(p_days integer DEFAULT 30)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH d AS (
    DELETE FROM opendkp_call_stats
     WHERE minute < now() - make_interval(days => greatest(1, p_days))
    RETURNING 1)
  SELECT count(*)::integer FROM d;
$$;

GRANT EXECUTE ON FUNCTION prune_opendkp_call_stats(integer) TO service_role;
