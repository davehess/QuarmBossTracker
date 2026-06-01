-- Charm sessions — per-session record of "Enchanter X charmed mob Y for Z
-- seconds, who did N damage during the charm."
--
-- The minimum unit is one *charm landing* to one *charm break (or pet death)*.
-- Multi-cycle charm phases produce many short sessions; Dire Charm produces
-- one long one (or one that ends when the enchanter / pet leaves the zone).
--
-- Aggregations off this table answer:
--   - "Which pet has the highest avg DPS when charmed?"
--   - "Total time Glyphed Familiar was charmed across all raids?"
--   - "Which Dire Charm pets does X like to take and walk off with?"
--
-- Dedup: same (guild, pet_name, owner, started_at) is the same session.
-- Multi-parser uploads upsert on this key. Max-keep semantics for damage so
-- a parser that saw more events than another wins.
--
-- encounter_id is optional — null when the session lived outside a fight
-- (Dire Charm pet farming between pulls, etc.).

CREATE TABLE IF NOT EXISTS public.charm_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL,
  pet_name text NOT NULL,
  owner text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  duration_sec numeric,
  total_damage bigint NOT NULL DEFAULT 0,
  is_dire_charm boolean NOT NULL DEFAULT false,
  encounter_id uuid REFERENCES public.encounters(id) ON DELETE SET NULL,
  -- Reason the session ended: 'charm_break' | 'pet_death' | 'timeout' | 'agent_exit'.
  -- Null while the session is still open. 'timeout' = no damage events for >5 min
  -- (agent assumes charm broke off-screen).
  end_reason text,
  uploaded_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT charm_sessions_unique UNIQUE (guild_id, pet_name, owner, started_at)
);

CREATE INDEX IF NOT EXISTS idx_charm_sessions_owner ON public.charm_sessions (guild_id, owner);
CREATE INDEX IF NOT EXISTS idx_charm_sessions_pet   ON public.charm_sessions (guild_id, pet_name);
CREATE INDEX IF NOT EXISTS idx_charm_sessions_encounter
  ON public.charm_sessions (encounter_id) WHERE encounter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_charm_sessions_dire
  ON public.charm_sessions (guild_id, is_dire_charm, ended_at DESC) WHERE is_dire_charm;

-- Convenience view: per-pet aggregate stats. Derived, not materialised — query
-- volume is small (few hundred sessions per guild, refreshed live).
CREATE OR REPLACE VIEW public.charm_pet_stats AS
SELECT
  guild_id,
  pet_name,
  COUNT(*)                              AS session_count,
  COUNT(*) FILTER (WHERE is_dire_charm) AS dire_charm_count,
  COALESCE(SUM(duration_sec), 0)        AS total_charmed_sec,
  COALESCE(SUM(total_damage), 0)        AS total_damage,
  CASE
    WHEN COALESCE(SUM(duration_sec), 0) > 0
      THEN COALESCE(SUM(total_damage), 0) / SUM(duration_sec)
    ELSE 0
  END                                   AS avg_dps,
  MAX(ended_at)                         AS last_charmed_at
FROM public.charm_sessions
WHERE duration_sec IS NOT NULL AND duration_sec > 0
GROUP BY guild_id, pet_name;

GRANT SELECT ON public.charm_pet_stats TO anon, authenticated;

COMMENT ON TABLE public.charm_sessions IS
  'One row per charm landing → charm break. Aggregations off this answer "best charm pet by avg DPS" and "Dire Charm hours per pet."';
COMMENT ON COLUMN public.charm_sessions.is_dire_charm IS
  'True when the agent detected a Dire Charm cast immediately before the charm landed. Dire Charm is the AA permanent variant.';
COMMENT ON COLUMN public.charm_sessions.end_reason IS
  'charm_break | pet_death | timeout | agent_exit. Helps distinguish "pet got killed" from "we let it go."';
