-- Per-user token forensics: stamp every agent-side write with the discord_id
-- of the mimic_sessions identity that submitted it. NULL on legacy rows
-- (pre-cutover 2026-06-04) — only populated going forward.
--
-- chat_messages.uploaded_by and who_observations.uploaded_by already exist
-- (text). We leave those alone; new columns stay typed as text but namespaced
-- so it's clear what they hold.

ALTER TABLE contributions  ADD COLUMN IF NOT EXISTS uploaded_by_discord_id text;
ALTER TABLE fun_events     ADD COLUMN IF NOT EXISTS uploaded_by_discord_id text;
ALTER TABLE pvp_kills      ADD COLUMN IF NOT EXISTS uploaded_by_discord_id text;
ALTER TABLE pvp_assists    ADD COLUMN IF NOT EXISTS uploaded_by_discord_id text;
ALTER TABLE encounters     ADD COLUMN IF NOT EXISTS uploaded_by_discord_id text;

CREATE INDEX IF NOT EXISTS contributions_uploaded_by_idx ON contributions(uploaded_by_discord_id);
CREATE INDEX IF NOT EXISTS fun_events_uploaded_by_idx    ON fun_events(uploaded_by_discord_id);
CREATE INDEX IF NOT EXISTS pvp_kills_uploaded_by_idx     ON pvp_kills(uploaded_by_discord_id);
CREATE INDEX IF NOT EXISTS pvp_assists_uploaded_by_idx   ON pvp_assists(uploaded_by_discord_id);
CREATE INDEX IF NOT EXISTS encounters_uploaded_by_idx    ON encounters(uploaded_by_discord_id);

COMMENT ON COLUMN contributions.uploaded_by_discord_id IS
  'Discord ID of the mimic_session that submitted this row. NULL for legacy rows or unauthenticated uploads (cutover 2026-06-04).';
COMMENT ON COLUMN fun_events.uploaded_by_discord_id IS
  'Discord ID of the mimic_session that submitted this row.';
COMMENT ON COLUMN pvp_kills.uploaded_by_discord_id IS
  'Discord ID of the mimic_session that submitted this row.';
COMMENT ON COLUMN pvp_assists.uploaded_by_discord_id IS
  'Discord ID of the mimic_session that submitted this row.';
COMMENT ON COLUMN encounters.uploaded_by_discord_id IS
  'Discord ID of the mimic_session that first created this encounter.';
