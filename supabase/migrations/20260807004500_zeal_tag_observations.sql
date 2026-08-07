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
  -- Append semantics (Uilnayar 2026-08-06: "tags can append as well if you do a
  -- /tag chat +<tag> with a plus symbol"). 'set' | 'append' | 'replace' |
  -- 'erase'; NULL from agents older than 3.5.17, which is deliberately NOT the
  -- same as 'set' — null means "we could not tell", and the log must not assert
  -- a replace it never observed.
  --
  -- WHY IT MATTERS BEYOND BOOKKEEPING: `tag_text` holds only THIS tagger's
  -- fragment, so on an append the nameplate in game reads "<theirs> <mine>"
  -- while the row shows just "<mine>". Reconstruct the merged string from the
  -- ordered rows for a spawn id — do not read tag_text as what the raid saw.
  tag_mode     text,
  -- The tagger this one appended ONTO. This single column can settle the whole
  -- identity question by itself: an append names two people against one spawn
  -- id in one row, proving both clients resolved that id to the same mob — with
  -- no dependence on upload timing, unlike the two-independent-taggers path.
  appended_to  text,
  -- The tag payload carries NO zone (verified against Zeal's nameplate.cpp wire
  -- format: ZEALTAG | text | name | spawn_id). Without it a name cannot be
  -- scored for uniqueness at all — "a temple guardian" matches three zones in
  -- our catalog with 2 / 68 / 11 spawn points. Taken from the OBSERVING
  -- character's own live-state row, which is the tagger's zone in practice
  -- (a tag only reaches you in-zone) but is not guaranteed to be — hence
  -- `observer_zone_*` naming, so nobody later reads it as the mob's zone.
  --
  -- Stored as the id the agent already sends, NOT resolved to a short name at
  -- ingest: this is a hot path (~40 raiders, change-driven + 45s heartbeat) and
  -- the catalog join belongs in the view, where it costs nothing per request.
  observer_zone_id   integer,
  observer_zone_name text,
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
  ON zeal_tag_observations (observer_zone_id, spawn_id, tagged_at DESC);

CREATE INDEX IF NOT EXISTS zeal_tag_obs_time
  ON zeal_tag_observations (tagged_at DESC);

ALTER TABLE zeal_tag_observations ENABLE ROW LEVEL SECURITY;
-- No policies: service_role (the bot) only. This is raw experimental evidence,
-- not a member-facing surface; open it up if it ever backs a page.

COMMENT ON TABLE zeal_tag_observations IS
  'Append-only Zeal /tag observations (#194). Verification instrument: two '
  'different taggers on one (observer_zone_id, spawn_id) confirms the spawn id is '
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
  SELECT o.observer_zone_id, z.short_name AS zone_short, o.spawn_id, lower(o.mob) AS mob,
         count(DISTINCT o.tagger)      AS taggers,
         count(DISTINCT o.observed_by) AS observers,
         string_agg(DISTINCT o.tagger, ', ') AS tagger_names,
         min(o.tagged_at) AS first_tag,
         max(o.tagged_at) AS last_tag
  FROM zeal_tag_observations o
  LEFT JOIN eqemu_zone z ON z.zone_id = o.observer_zone_id
  WHERE o.tagger IS NOT NULL
  GROUP BY 1, 2, 3, 4
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
       CASE WHEN p.spawn_points = 1 THEN 'UNIQUE - two taggers prove identity'
            WHEN p.spawn_points IS NULL THEN 'no spawn2 row (script/quest spawn) - check by hand'
            ELSE 'multi-spawn - inconclusive on its own' END AS verdict
FROM obs o
LEFT JOIN pts p ON p.mob = o.mob AND p.zone_short = o.zone_short
WHERE o.taggers > 1
ORDER BY (p.spawn_points = 1) DESC NULLS LAST, o.last_tag DESC;

-- ── The strongest single row the experiment can produce ─────────────────────
-- An APPEND names two people against one spawn id in ONE observation: the
-- appender, and the tagger they appended onto. Both clients therefore resolved
-- that id to the same mob. Unlike zeal_tag_identity_candidates this needs no
-- luck of upload timing and no second observer, so a single row here settles
-- "is the spawn id tied to the mob" for that mob.
CREATE OR REPLACE VIEW zeal_tag_append_proofs AS
SELECT o.observer_zone_id, z.short_name AS zone_short, o.spawn_id, o.mob,
       o.appended_to AS first_tagger, o.tagger AS appending_tagger,
       o.tag_text AS appended_fragment, o.tagged_at, o.observed_by
FROM zeal_tag_observations o
LEFT JOIN eqemu_zone z ON z.zone_id = o.observer_zone_id
WHERE o.tag_mode = 'append'
  AND o.appended_to IS NOT NULL
  AND o.appended_to IS DISTINCT FROM o.tagger
ORDER BY o.tagged_at DESC;

-- ── Is the id random, per-person, or a per-zone entity index? ────────────────
-- Uilnayar 2026-08-06: "we need to determine if those spawn IDs are unique or
-- random or per person. are they sequential in the channel?"
--
-- Already answered NO for "sequential in the channel" from night one: broadcast
-- order was 150, 148, 307, 145, 114, 139, 315, 318, 149, 176, 45, 71, 39, 57,
-- 61 -- not monotonic, so the number is not a message counter.
--
-- The live hypothesis is a per-ZONE-INSTANCE entity index assigned as things
-- spawn, which night one fits: Kael (242 spawn points) produced 71-318 while
-- Sleeper's Tomb (66 points) produced 39-61. This view is the standing test.
-- Read it as:
--   * id range tracking spawn_points, per zone  => per-zone entity index
--   * ranges that partition BY TAGGER           => per-person, and worthless
--   * no structure at all                       => random, and worthless
-- `taggers_agreeing` is the column that kills the per-person theory: it counts
-- taggers whose ids interleave with another tagger's in the same zone. Under a
-- per-person scheme they would never interleave.
CREATE OR REPLACE VIEW zeal_tag_id_structure AS
SELECT z.short_name AS zone_short,
       o.observer_zone_id,
       count(*)                       AS observations,
       count(DISTINCT o.spawn_id)     AS distinct_ids,
       min(o.spawn_id)                AS min_id,
       max(o.spawn_id)                AS max_id,
       count(DISTINCT o.tagger)       AS taggers,
       (SELECT count(*) FROM eqemu_spawn2 s WHERE s.zone_short = z.short_name) AS zone_spawn_points,
       count(DISTINCT o.tagger) FILTER (
         WHERE EXISTS (
           SELECT 1 FROM zeal_tag_observations o2
           WHERE o2.observer_zone_id = o.observer_zone_id
             AND o2.tagger IS DISTINCT FROM o.tagger
             AND o2.spawn_id BETWEEN o.spawn_id - 40 AND o.spawn_id + 40
         ))                           AS taggers_agreeing
FROM zeal_tag_observations o
LEFT JOIN eqemu_zone z ON z.zone_id = o.observer_zone_id
GROUP BY 1, 2
ORDER BY observations DESC;
