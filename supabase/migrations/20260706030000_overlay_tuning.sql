-- overlay_tuning — officer-set numeric knob overrides for Mimic overlays and
-- the bot's Extended Target aggregation, so thresholds (off-heal hurt cutoff,
-- Extended Target hurt %, stale grace, …) can be changed mid-raid WITHOUT
-- cutting a Mimic release or redeploying the bot (Uilnayar 2026-07-06).
--
-- One row per guild; `tuning` is a flat jsonb object of snake_case keys →
-- NUMBERS ONLY (agents ignore non-numeric values by design — nothing stringy
-- from the network ever reaches parsing code). Missing keys mean "use the
-- compiled default", so an empty object is always safe.
--
-- Reads: bot merges over its own defaults (60s cache) for Extended Target
-- knobs, and serves the raw object to agents at GET /api/agent/overlay-tuning
-- (agents poll every ~90s and merge over their compiled defaults).
-- Writes: officers only via /admin/overlays (Next.js server action with
-- service_role).

CREATE TABLE IF NOT EXISTS public.overlay_tuning (
  guild_id              text PRIMARY KEY,
  tuning                jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by_discord_id text,
  updated_by_name       text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Seed Wolf Pack's row. Idempotent — re-running never resets officer tuning.
INSERT INTO public.overlay_tuning (guild_id)
VALUES ('wolfpack')
ON CONFLICT (guild_id) DO NOTHING;

ALTER TABLE public.overlay_tuning ENABLE ROW LEVEL SECURITY;

-- Signed-in members can read (the /admin/overlays page is officer-gated at
-- the route level; this keeps the DB door closed to anon probes). Writes go
-- through service_role only — no INSERT/UPDATE policy for authenticated.
DROP POLICY IF EXISTS "overlay_tuning read" ON public.overlay_tuning;
CREATE POLICY "overlay_tuning read" ON public.overlay_tuning
  FOR SELECT TO authenticated USING (true);
