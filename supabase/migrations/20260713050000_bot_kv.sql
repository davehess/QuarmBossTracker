-- Durable key-value store for small bits of bot state that MUST survive Railway
-- restarts. The container filesystem is ephemeral, so local JSON files (e.g.
-- data/mimic-announce.json) were wiped on every deploy — which is what made the
-- Mimic release-announcer re-post its whole backfill on each bounce (2026-07-13
-- spam). Anything that used a local dedup/cursor file belongs here instead.
--
-- Service-role only: the bot reads/writes with the service key (bypasses RLS);
-- no anon/authenticated policies are defined, so the web app can't see it.
CREATE TABLE IF NOT EXISTS public.bot_kv (
  guild_id   text        NOT NULL DEFAULT 'wolfpack',
  key        text        NOT NULL,
  value      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, key)
);

ALTER TABLE public.bot_kv ENABLE ROW LEVEL SECURITY;
-- (No policies on purpose — service_role bypasses RLS; everyone else gets nothing.)
