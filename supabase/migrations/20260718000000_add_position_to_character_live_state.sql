-- Position (Zeal loc {x,y,z}) uploaded by the character's own Mimic on the
-- live-state stream. Powers position-based buff-range awareness (#117): the
-- raid-buff-queue flags same-zone targets beyond a heuristic range from the
-- requesting buffer as "likely out of range" (advisory — positions are stale by
-- up to the live-state heartbeat cadence). Nullable + fail-open everywhere.
ALTER TABLE public.character_live_state
  ADD COLUMN IF NOT EXISTS loc_x real,
  ADD COLUMN IF NOT EXISTS loc_y real,
  ADD COLUMN IF NOT EXISTS loc_z real;
