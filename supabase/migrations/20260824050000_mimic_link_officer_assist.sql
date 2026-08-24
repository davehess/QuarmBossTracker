-- Officer-assisted Mimic linking (Hitya 2026-08-24, from Gonner's report):
-- "gonner wants to install but doesn't have discord auth working."
--
-- Discord refuses OAuth consent for unverified accounts, and the ONLY stamper
-- of mimic_link_codes was the /auth/mimic-link page, which requires the member
-- themself to OAuth. The bot's poll handler has accepted a discord-only
-- authorization since 2026-07-31 (members Discord blocks from OAuth have no
-- auth.users row) — but nothing could WRITE that shape. These columns carry
-- the audit trail for the new writer: an officer attesting "this code belongs
-- to that member" on /admin/links.
--
-- The link-code row is DELETED when Mimic exchanges it, so the durable audit
-- lives on mimic_sessions — the poll handler copies the two fields across at
-- mint time.
ALTER TABLE mimic_link_codes
  ADD COLUMN IF NOT EXISTS authorized_via         text,   -- 'self' | 'officer'
  ADD COLUMN IF NOT EXISTS authorized_by_discord_id text; -- the attesting officer

ALTER TABLE mimic_sessions
  ADD COLUMN IF NOT EXISTS linked_via           text,
  ADD COLUMN IF NOT EXISTS linked_by_discord_id text;
