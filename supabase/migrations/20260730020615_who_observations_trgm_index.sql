-- Perf: /character/[name] (and any ILIKE lookup on who_observations.character)
-- was seq-scanning all ~107k rows every load — the page filters with
-- `character ILIKE '<name>'`, which the existing lower(character) btree can't
-- serve, so it cost ~4.7s per page load just to read a level + guild tag.
--
-- A trigram GIN index lets ILIKE be index-served (4.7s -> <0.4s). Applied to
-- prod 2026-07-27 via the Supabase MCP with CREATE INDEX CONCURRENTLY (no write
-- lock); this file is the idempotent record so repo + prod history match. On a
-- fresh DB the non-concurrent form below is fine (runs inside the migration tx).
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS who_obs_character_trgm
  ON public.who_observations USING gin (character extensions.gin_trgm_ops);
