-- Zeal /tag observations — an APPEND-ONLY log, built to answer one question:
-- is the spawn id in a /tag broadcast actually tied to the mob, or is it a
-- number that only means something on the tagger's own client?
--
-- Uilnayar 2026-08-06, after the first night of tags reached us: "let's craft a
-- table to store these tags into to verify how this operates … or have a friend
-- tag the same mob as me."
--
-- WHY THIS IS NOT AN UPSERTED STATE TABLE. character_live_state.zeal_tags
-- already holds current state and it CANNOT answer the question — it is
-- overwritten on every upload, and the agent's own `_zealTags` is a Map keyed by
-- spawn id, so a second tagger on the same mob overwrites the first. The
-- evidence we need is exactly the thing both layers discard. So: one row per
-- (observer, tag event), nothing collapsed, and the analysis happens in SQL.
--
-- THE TEST IT EXISTS TO RUN (the reason `tagger` and `observed_by` are separate
-- columns): a tag is BROADCAST, so N agents receiving one tag proves only
-- fan-out. Confirmation requires two different `tagger` values on one
-- (zone_short, spawn_id) — ideally on a mob with a single eqemu_spawn2 point,
-- where two taggers MUST be looking at the same entity. Derakor the Vindicator
-- is the ideal subject: one spawn point (spawn2 338037, spawngroup 113118,
-- pathgrid 23), so there can only ever be one of him.
--
-- HOW IT CAN WORK WITHOUT AN AGENT RELEASE. The agent's Map collapses two
-- taggers into one *per agent*, but agents upload independently every few
-- seconds. If Dafeet tags at T and someone else tags at T+3s, any agent that
-- uploaded in between carries the first tagger while later uploads carry the
-- second — and an append-only log keeps both. That is luck-of-timing rather
-- than a guarantee, but it needs only this table plus a bot-side write, with no
-- fleet rollout. Key the agent Map by (spawn_id, tagger) only if a full raid of
-- passive collection fails to produce a pair.

CREATE TABLE IF NOT EXISTS zeal_tag_observations (
  id           bigserial PRIMARY KEY,
  guild_id     text        NOT NULL,
  -- WHO RECEIVED IT vs WHO SENT IT. Collapsing these is the single easiest way
  -- to fool yourself here: `observed_by` repeating across rows is one broadcast
  -- landing in many logs; `tagger` repeating is nothing; `tagger` DIFFERING on
  -- one spawn id is the whole point of the table.
  observed_by  text        NOT NULL,
  tagger       text,
  spawn_id     integer     NOT NULL,
  mob          text        NOT NULL,
  tag_text     text,
  shape        text,
  -- The tag payload carries NO zone (verified against Zeal's nameplate.cpp wire
  -- format: ZEALTAG | text | name | spawn_id). Without it a name cannot be
  -- scored for uniqueness at all — "a temple guardian" matches three zones in
  -- our catalog with 2 / 68 / 11 spawn points. Joined at ingest from the
  -- observing character's live-state row; nullable because that row can be
  -- missing, and a null zone makes the row unusable for the uniqueness test
  -- rather than silently wrong.
  zone_short   text,
  zone_name    text,
  -- The tag's own timestamp as the observing agent stamped it, NOT ingest time.
  -- Doubles as the idempotency key: an agent re-reports an unchanged tag every
  -- upload for the 120s freshness window, and `since` stays put across those
  -- re-reports, so the unique index below collapses them without collapsing
  -- genuinely distinct tag events.
  tagged_at    timestamptz NOT NULL,
  observed_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per (observer, tag event). Different observers of the SAME broadcast
-- deliberately survive as separate rows — that is how fan-out gets told apart
-- from independent tagging.
CREATE UNIQUE INDEX IF NOT EXISTS zeal_tag_obs_dedup
  ON zeal_tag_observations (guild_id, observed_by, spawn_id, tagger, tagged_at);

-- The correlation query's access path: everything that shared an identity.
CREATE INDEX IF NOT EXISTS zeal_tag_obs_identity
  ON zeal_tag_observations (zone_short, spawn_id, tagged_at DESC);

CREATE INDEX IF NOT EXISTS zeal_tag_obs_time
  ON zeal_tag_observations (tagged_at DESC);

ALTER TABLE zeal_tag_observations ENABLE ROW LEVEL SECURITY;
-- No policies: service_role (the bot) only. This is raw experimental evidence,
-- not a member-facing surface; open it up if it ever backs a page.

COMMENT ON TABLE zeal_tag_observations IS
  'Append-only Zeal /tag observations (#194). Verification instrument: two '
  'different taggers on one (zone_short, spawn_id) confirms the spawn id is '
  'server-assigned. Not current state — see character_live_state.zeal_tags.';

-- ── The verification query ───────────────────────────────────────────────────
-- Candidate confirmations: one identity, two or more distinct taggers. Ranked
-- so single-spawn-point mobs (where two taggers CANNOT be two different mobs)
-- sort first. `spawn_points IS NULL` is a THIRD state, not "many" — script- and
-- quest-spawned named mobs (Trooper Mykeor, Master of the Guard) have no
-- eqemu_spawn2 row at all, and reading that as multi-spawn would throw away the
-- best confirmation candidates.
CREATE OR REPLACE VIEW zeal_tag_identity_candidates AS
WITH obs AS (
  SELECT zone_short, spawn_id, lower(mob) AS mob,
         count(DISTINCT tagger)      AS taggers,
         count(DISTINCT observed_by) AS observers,
         string_agg(DISTINCT tagger, ', ') AS tagger_names,
         min(tagged_at) AS first_tag,
         max(tagged_at) AS last_tag
  FROM zeal_tag_observations
  WHERE tagger IS NOT NULL
  GROUP BY 1, 2, 3
),
pts AS (
  SELECT lower(replace(n.name, '_', ' ')) AS mob, s.zone_short,
         count(DISTINCT s.id) AS spawn_points
  FROM eqemu_spawn2 s
  JOIN eqemu_spawnentry se ON se.spawngroup_id = s.spawngroup_id
  JOIN eqemu_npc_types  n  ON n.id = se.npc_id
  GROUP BY 1, 2
)
SELECT o.*, p.spawn_points,
       CASE WHEN p.spawn_points = 1 THEN 'UNIQUE — two taggers prove identity'
            WHEN p.spawn_points IS NULL THEN 'no spawn2 row (script/quest spawn) — check by hand'
            ELSE 'multi-spawn — inconclusive on its own' END AS verdict
FROM obs o
LEFT JOIN pts p ON p.mob = o.mob AND p.zone_short = o.zone_short
WHERE o.taggers > 1
ORDER BY (p.spawn_points = 1) DESC NULLS LAST, o.last_tag DESC;
