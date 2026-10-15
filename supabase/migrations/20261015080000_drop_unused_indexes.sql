-- Drop indexes that cost a write on every row and serve no read (2026-10-15; the guild lead picked A and B of
-- DECISIONS §334's last bullet). Scan counts below cover ~3 days of pg_stat_user_indexes; each drop was also
-- checked against the readers, not just the counter.
--
--   idx_threat_snapshots_uploader (guild_id, uploader, snapshot_at)        157 MB, 9 scans
--     The unique encounter_threat_snapshots_unique (guild_id, uploader, boss_name, snapshot_at) has the same
--     prefix; claimThreatSnapshots (uploader + encounter_id IS NULL + time range) plans on
--     idx_threat_snapshots_unbound, and no function filters on uploader alone.
--   target_observations_char_at_idx, target_observations_target_at_idx     ~50 MB, 0 scans
--     The table is inserted and swept (at < cutoff, a seq scan of a small table), never read.
--     target_observations_at_idx stays.
--   faction_hits_char_faction_ts_idx (guild_id, character, faction, ts)    24 MB, 0 scans
--     An exact prefix of the unique faction_hits_dedup_idx (a btree scans either direction).
--
-- Plain DROP (not CONCURRENTLY) so it runs as one SQL-editor batch; each takes a brief lock. Run outside the
-- raid window.

drop index if exists public.idx_threat_snapshots_uploader;
drop index if exists public.target_observations_char_at_idx;
drop index if exists public.target_observations_target_at_idx;
drop index if exists public.faction_hits_char_faction_ts_idx;
