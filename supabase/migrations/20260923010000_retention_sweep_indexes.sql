-- Make the two telemetry retention sweeps actually able to run.
--
-- WHY (measured 2026-09-22): `encounter_threat_snapshots` is 1,414 MB — 58% of
-- the database — with **746,964 of 1,190,281 rows (62.8%) past its 30-day
-- retention window** and the oldest row 82 days old. The nightly DELETE has
-- never removed anything. It is also 72% of all database growth: +494 MB of the
-- +690 MB gained in the three weeks to 2026-09-22.
--
-- ⚠ THE CAUSE IS AN INDEX THAT ALMOST FITS. The table's indexes are:
--     pkey                             (id)
--     ..._unique                       (guild_id, uploader, boss_name, snapshot_at)  -- 4th
--     idx_threat_snapshots_uploader    (guild_id, uploader, snapshot_at DESC)        -- 3rd
--     idx_threat_snapshots_encounter   (encounter_id) WHERE encounter_id IS NOT NULL
--     idx_threat_snapshots_unbound     (snapshot_at) WHERE encounter_id IS NULL
--
-- The last one DOES lead on snapshot_at — but it is partial on
-- `encounter_id IS NULL`, so it covers only the backfill backlog. The sweep's
-- predicate is `snapshot_at < cutoff` with no encounter_id condition, so the
-- planner cannot use it and seq-scans 1.4 GB. That blows the client's 10s
-- AbortController, the catch logs a warning, and the night looks successful.
-- A sweep that fails quietly looks exactly like a sweep with nothing to do —
-- which is the rule `DESIGN-selfhost-wizard.md` §3 already states and this
-- table has been the standing counter-example to.
--
-- So: a PLAIN index on snapshot_at. Not partial, so it serves the sweep.
-- Reclaims ~890 MB on the first successful run, putting the database below
-- where it stood on 2026-09-01.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_threat_snapshots_snapshot_at
  ON public.encounter_threat_snapshots (snapshot_at);

-- Same fix, pre-emptively, for `target_observations`.
--
-- ⚠ Its sweep has never deleted a row either, but for an innocent reason: the
-- table was created 2026-08-04 and the retention default was 90 days, so
-- nothing has aged out yet. That also means the DELETE has never been exercised
-- at volume — and its only `at`-bearing index is (guild_id, at desc), which
-- does not lead on the swept column any more than the threat table's did.
-- Dropping retention to 1 day (the guild lead, 2026-09-22: target observations
-- "do not matter the next day") makes the very next midnight delete ~48 days in
-- one pass. That is precisely the shape of DELETE that timed out before, so the
-- index goes in FIRST rather than after the postmortem.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_target_observations_at
  ON public.target_observations (at);

-- Both built CONCURRENTLY so the agent upload path is never blocked, matching
-- migration 20260806050000. ⚠ After this applies, check `indisvalid` on both:
-- a failed concurrent build leaves an INVALID index behind that is silently
-- never used, which would reproduce this exact bug with an index that looks
-- present.
--   select indexrelid::regclass, indisvalid from pg_index
--    where indexrelid::regclass::text in
--          ('idx_threat_snapshots_snapshot_at','idx_target_observations_at');
