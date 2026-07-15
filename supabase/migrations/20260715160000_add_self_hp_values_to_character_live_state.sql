-- Exact self HP (Zeal labels 17/18) uploaded by the character's own Mimic.
-- Powers the cross-client Tank overlay "cur / max · pct%" label for a
-- Mimic-running MT; previously only the /pipeverbose raid-sample path carried
-- exact numbers (2026-07-15).
ALTER TABLE public.character_live_state
  ADD COLUMN IF NOT EXISTS self_hp_cur integer,
  ADD COLUMN IF NOT EXISTS self_hp_max integer;
