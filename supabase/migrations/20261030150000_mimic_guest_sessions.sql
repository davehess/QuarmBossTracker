-- Guest Mimic links (the guild lead, 2026-10-30): "where can i give someone a temp key to contribute to shared parses
-- as a raider from another guild" -> an officer-approved, time-limited GUEST link that can upload parses only.
--
-- The officer types the code the guest's Mimic shows on /admin/links, a label, and an expiry. The link-code row carries
-- the label and the expiry; the bot's poll handler copies them onto the minted mimic_sessions row, which the bot then
-- treats as scope 'guest': expired = revoked, and only the parse upload (plus the control-plane poll) is served.
--
-- ORDER MATTERS: apply this BEFORE the bot version that reads these columns deploys. Idempotent: applying it twice is
-- harmless.

ALTER TABLE mimic_link_codes
  ADD COLUMN IF NOT EXISTS guest_label       text,          -- who the guest is, officer-typed (<= 64 chars)
  ADD COLUMN IF NOT EXISTS guest_expires_at  timestamptz;   -- when the session minted from this code stops working

ALTER TABLE mimic_sessions
  ADD COLUMN IF NOT EXISTS expires_at   timestamptz,        -- null = no expiry (every member session)
  ADD COLUMN IF NOT EXISTS scope        text,               -- null = member, 'guest' = guest
  ADD COLUMN IF NOT EXISTS guest_label  text;

-- The /admin/links "Guest links" list reads only guest rows; a partial index keeps that cheap as member sessions grow.
CREATE INDEX IF NOT EXISTS mimic_sessions_guest_expires_idx
  ON mimic_sessions (expires_at)
  WHERE scope = 'guest';
