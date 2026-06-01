-- Threat snapshots — the local dashboard's "Live Threat" panel exposes a
-- second-by-second hate ranking that ONLY exists at the agent level. Without
-- persisting some of it to the server, the wolfpack.quest /me view can never
-- show "how often you topped threat this raid" or "your hottest pulls."
--
-- This table stores periodic snapshots from the agent's
-- currentEncounterThreat.perPlayer map. One row per (encounter, snapshot
-- time, uploader). Dedup'd via the unique constraint so a re-upload by the
-- same uploader at the same wall-clock second is idempotent.
--
-- Encounter linkage is best-effort: the agent doesn't always know the bot's
-- encounter UUID, so we store boss_name + started_at and let downstream
-- queries join to encounters via find_or_create_encounter's bucketing
-- semantics. encounter_id is filled when known.

CREATE TABLE IF NOT EXISTS public.encounter_threat_snapshots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id     text NOT NULL,
  encounter_id uuid REFERENCES public.encounters(id) ON DELETE SET NULL,
  boss_name    text,
  started_at   timestamptz,
  snapshot_at  timestamptz NOT NULL,
  uploader     text,
  per_player   jsonb NOT NULL,    -- { "Hitya": { swing:0, proc:0, spell:0, heal:0 }, ... }
  total        numeric,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT encounter_threat_snapshots_unique
    UNIQUE (guild_id, uploader, boss_name, snapshot_at)
);

CREATE INDEX IF NOT EXISTS idx_threat_snapshots_uploader
  ON public.encounter_threat_snapshots (guild_id, uploader, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_threat_snapshots_encounter
  ON public.encounter_threat_snapshots (encounter_id) WHERE encounter_id IS NOT NULL;

COMMENT ON TABLE public.encounter_threat_snapshots IS
  'Periodic samples of the local-dashboard threat ranking, uploaded by the agent every ~15s during active combat. Powers per-character "time near the top of threat" rollups for /me.';
