-- Charm-session history — one row per charm segment the agent observed during
-- an encounter (pet name + owner + timing + damage + how the charm ended).
-- The bot has been upserting these on every charm-carrying encounter upload
-- since the charm pipeline shipped, but the table was never created — every
-- write 404'd into a catch-warn (found 2026-07-13). Schema matches the writer
-- in index.js verbatim; conflict target is its upsert key.
CREATE TABLE IF NOT EXISTS public.charm_sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id      text        NOT NULL,
  pet_name      text        NOT NULL,
  owner         text        NOT NULL,
  started_at    timestamptz NOT NULL,
  ended_at      timestamptz,
  duration_sec  integer,
  total_damage  bigint      NOT NULL DEFAULT 0,
  is_dire_charm boolean     NOT NULL DEFAULT false,
  -- Keep charm history even if its encounter is later merged/deleted.
  encounter_id  uuid        REFERENCES public.encounters(id) ON DELETE SET NULL,
  end_reason    text,
  uploaded_by   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, pet_name, owner, started_at)
);

CREATE INDEX IF NOT EXISTS charm_sessions_encounter_idx ON public.charm_sessions (encounter_id);
CREATE INDEX IF NOT EXISTS charm_sessions_owner_idx     ON public.charm_sessions (guild_id, owner, started_at DESC);

-- Guild data: signed-in members can read; the bot writes via service_role
-- (bypasses RLS), so no write policies are defined.
ALTER TABLE public.charm_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS charm_sessions_read ON public.charm_sessions;
CREATE POLICY charm_sessions_read ON public.charm_sessions
  FOR SELECT TO authenticated USING (true);
