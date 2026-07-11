-- Per-class default overlay sets (pretty-place phase 2).
-- Officer-crafted on /admin/overlays: which Mimic overlays a fresh install
-- should enable for each class (e.g. clerics get CH chain + Buff queue,
-- warriors get Tank HUD + Command Center). Rides the same overlay_tuning row
-- + the agents' existing 90s /api/agent/overlay-tuning poll.
--
-- Deliberately a SEPARATE column from `tuning`: that jsonb is a flat
-- numbers-only knob map and the /admin/overlays knob save rebuilds it
-- wholesale — a nested key inside it would be wiped on every knob edit.
--
-- Shape: { "<classkey>": ["hud","tank","command", ...] } where classkey is
-- the base class lowercased with non-letters stripped ("shadowknight") and
-- values are Mimic toggle-overlay keys.
ALTER TABLE public.overlay_tuning
  ADD COLUMN IF NOT EXISTS class_sets jsonb NOT NULL DEFAULT '{}'::jsonb;
