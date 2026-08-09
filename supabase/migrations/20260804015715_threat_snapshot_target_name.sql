-- The sampling uploader's OWN current target (Zeal gauge slot 6) at the moment
-- of the snapshot.
--
-- Distinct from boss_name, which is the FIGHT — the most-damaged defender this
-- encounter. A healer is on their heal target, an off-tank on an add, a slower
-- on the next mob, and that difference is exactly what healing attribution and
-- off-tank review need (Hitya 2026-08-03). Carrying it here puts the damage
-- curve and who-was-on-what on one row, so a fight scrubber needs no join.
--
-- target_observations remains the durable, all-raiders, append-on-change view;
-- this column is the in-fight, per-sample one and ages out with the rest of the
-- snapshot table's retention.
--
-- Nullable and untouched on existing rows: agents older than v3.5.5 simply do
-- not send it, and there is no sensible backfill (the value is a moment-in-time
-- gauge reading that was never recorded).
alter table public.encounter_threat_snapshots
  add column if not exists target_name text;

comment on column public.encounter_threat_snapshots.target_name is
  'The uploading character''s own Zeal target at sample time. NOT the fight — see boss_name for that. NULL for pre-v3.5.5 agents and when nothing was targeted.';
