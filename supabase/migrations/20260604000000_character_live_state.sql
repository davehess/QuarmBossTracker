-- character_live_state — current buffs + last-seen zone per character, synced
-- from the Mimic/agent Zeal stream (POST /api/agent/live-state → upsert).
-- Powers wolfpack.quest/me's "Buffs & Zone" snapshot. A SNAPSHOT, not a
-- heartbeat: the agent pushes only on change (zone / buff-set / first sight),
-- and the local dashboard (localhost:7777) stays the source for live data.
--
-- NOTE: this table was first created directly against prod via the Supabase
-- MCP during development; this migration captures it in version control so a
-- fresh project rebuilds identically. Fully idempotent (IF NOT EXISTS + policy
-- drop-then-create) so re-applying over the existing prod table is a no-op.

CREATE TABLE IF NOT EXISTS public.character_live_state (
  guild_id    text        NOT NULL DEFAULT 'wolfpack',
  character   text        NOT NULL,
  zone_id     integer,
  zone_name   text,
  self_hp_pct real,
  buffs       jsonb,
  buff_count  integer,
  uploaded_by text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, character)
);

CREATE INDEX IF NOT EXISTS character_live_state_updated_idx
  ON public.character_live_state (updated_at DESC);

ALTER TABLE public.character_live_state ENABLE ROW LEVEL SECURITY;

-- Read-open (guild members browse on the web; the bot writes via service_role,
-- which bypasses RLS). Drop-then-create keeps this idempotent.
DROP POLICY IF EXISTS "live_state read" ON public.character_live_state;
CREATE POLICY "live_state read" ON public.character_live_state
  FOR SELECT USING (true);
