-- Parse-card extras: NPC self-heal totals + per-encounter fun-event correlation.
--
-- 1. encounters.npc_healed_total — running sum of damage the boss healed
--    BACK to itself during the fight. Some bosses (Lady Vox, Naggy, Drakkin
--    Knight Vyrkma, etc.) Complete Heal themselves, and the raw "total damage
--    dealt" number doesn't reflect how much HP the raid had to push through.
--    Stored as bigint to be safe; default 0 for back-compat with old rows.
--
-- 2. fun_events.encounter_id — optional FK linking a fun-event (Feral Avatar
--    received, Savagery received, etc.) to the encounter it landed during.
--    Agent fills this when it knows the active encounter (live tail). Null
--    for events outside a fight (idle buffs, between pulls) and for backfill
--    replays where the agent hasn't reconstructed encounters yet. Indexed for
--    cheap per-encounter rollup queries.
--
-- Both columns are additive and nullable — safe to apply mid-raid.

ALTER TABLE public.encounters
  ADD COLUMN IF NOT EXISTS npc_healed_total bigint NOT NULL DEFAULT 0;

ALTER TABLE public.fun_events
  ADD COLUMN IF NOT EXISTS encounter_id uuid REFERENCES public.encounters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fun_events_encounter_id
  ON public.fun_events (encounter_id)
  WHERE encounter_id IS NOT NULL;

COMMENT ON COLUMN public.encounters.npc_healed_total IS
  'Sum of damage the boss healed back to itself during this encounter. NPC self-heal events accumulated by the agent. Used to show "27.1k (+10k healed)" on parse cards for Complete-Healing bosses.';

COMMENT ON COLUMN public.fun_events.encounter_id IS
  'Optional FK to encounters.id when the fun-event (e.g. feral_avatar_received) was recorded during an active fight. Null for between-pulls or backfill replays.';
