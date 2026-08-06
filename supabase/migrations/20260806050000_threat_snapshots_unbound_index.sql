-- Partial index over the snapshots a backfill actually touches.
--
-- Before this, NOTHING supported "find snapshots in this time range":
--   pkey                            (id)
--   encounter_threat_snapshots_unique (guild_id, uploader, boss_name, snapshot_at)  -- snapshot_at 4th
--   idx_threat_snapshots_uploader   (guild_id, uploader, snapshot_at DESC)          -- snapshot_at 3rd
--   idx_threat_snapshots_encounter  (encounter_id) WHERE encounter_id IS NOT NULL
--
-- Note the last one is partial on IS NOT NULL — i.e. it indexes exactly the rows
-- a backfill does NOT care about. So every attempt to find unbound rows in a
-- window seq-scanned the whole 426 MB table; the measurement query for this work
-- timed out twice at 60s before the index existed, and completed instantly after.
--
-- This index is deliberately partial on IS NULL, which gives it a useful
-- property: it covers only the backlog, so it SHRINKS as the backfill succeeds,
-- and collapses to near-nothing once every snapshot is bound. It costs 11 MB
-- today against a 426 MB table.
--
-- Built CONCURRENTLY (outside a transaction) so the agent upload path was never
-- blocked; verified indisvalid = true afterwards, because a failed concurrent
-- build leaves an INVALID index behind that silently never gets used.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_threat_snapshots_unbound
  ON public.encounter_threat_snapshots (snapshot_at)
  WHERE encounter_id IS NULL;
