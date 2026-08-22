-- Per-character loot lockouts, and whether they came from one of OUR kills.
--
-- Hitya 2026-08-21: "several raiders have spent time with Breakfast Club doing
-- raids on alts. we need to remain vigilant about these not being included, but
-- also capture loot lockouts for raid mobs when they don't occur with our
-- guild — put those into another admin section."
--
-- Two different jobs that were being conflated:
--   • Foreign RAIDS must stay out of our numbers. Already handled — /parses
--     auto-hides an upload whose players are mostly not ours (web/lib/anomalies).
--   • Foreign LOCKOUTS must be captured anyway, because they are real and they
--     bind US: a raider who killed Rathe Council with another guild on Tuesday
--     cannot loot it on our Sunday. That is officer-facing information we were
--     throwing away — /sll relays were read for boss-timer refinement and then
--     discarded.
--
-- `ours` is a THREE-state answer, deliberately nullable:
--   true   — the lockout lines up with a Wolf Pack kill we have on the board.
--   false  — we have no kill of that boss anywhere near the implied kill time,
--            so they got it somewhere else.
--   null   — we cannot tell (boss not on our board, no timer history). Never
--            guess: an unknown must not read as an accusation.
CREATE TABLE IF NOT EXISTS character_lockouts (
  guild_id      text        NOT NULL,
  character     text        NOT NULL,
  boss_key      text        NOT NULL,   -- bosses.json id when known, else slugged name
  boss_name     text        NOT NULL,
  expires_at    timestamptz NOT NULL,   -- when their personal lockout lifts
  implied_kill_at timestamptz,          -- expires_at minus the boss's timer
  ours          boolean,                -- see the three states above
  observed_at   timestamptz NOT NULL DEFAULT now(),
  observed_by   text,                   -- uploading character (the /sll runner)
  PRIMARY KEY (guild_id, character, boss_key, expires_at)
);

CREATE INDEX IF NOT EXISTS character_lockouts_foreign_idx
  ON character_lockouts (guild_id, ours, expires_at DESC);
CREATE INDEX IF NOT EXISTS character_lockouts_char_idx
  ON character_lockouts (guild_id, lower(character));

ALTER TABLE character_lockouts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY character_lockouts_read ON character_lockouts
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
