-- A character's own known timers — disciplines, Mend, Lay on Hands / Harm
-- Touch, Feign Death, AAs such as Area Taunt — as their Mimic last reported
-- them (agent 3.7.66+). [{key, label, ready_at, total_ms, est}], ready_at an
-- absolute time so a reader counts down without a fresh upload. Read back by
-- GET /api/agent/character-live-state, so another raider's Target Info can show
-- them while targeting this character (the guild lead, 2026-10-02). NULL from
-- older agents.
ALTER TABLE public.character_live_state
  ADD COLUMN IF NOT EXISTS cooldowns jsonb;
