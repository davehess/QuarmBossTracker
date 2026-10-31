-- The Mimic link flow carries the guild the player chose (the guild lead, 2026-10-31, DECISIONS §499: the Mimic guild
-- picker; the slice after it puts the chosen guild on the link code and, through the bot's poll, on the session).
--
-- mimic_link_codes.hub: the hub guild slug (hub_guilds.guild_id) the code was started for. NULL = Wolf Pack, exactly as
-- every code before this column. The bot's /api/mimic-link/start writes it only for a hub link, the website finishes the
-- link on the guild's site only for a player who is an active member of that guild, and the bot's poll mints the
-- mimic_sessions row with guild_id = hub (mimic_sessions.guild_id is the 2026-10-28 column; nothing to add there).
--
-- ORDER MATTERS: apply this BEFORE the bot version that writes the column deploys. A Wolf Pack link never names the
-- column, so only a hub link is affected if it is late. Idempotent: applying it twice is harmless.

ALTER TABLE mimic_link_codes
  ADD COLUMN IF NOT EXISTS hub text;   -- null = Wolf Pack; otherwise a slug in the registry's shape

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mimic_link_codes_hub_slug_shape') THEN
    ALTER TABLE mimic_link_codes
      ADD CONSTRAINT mimic_link_codes_hub_slug_shape
      CHECK (hub IS NULL OR hub ~ '^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$');
  END IF;
END $$;
