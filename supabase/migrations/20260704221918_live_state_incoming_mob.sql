-- Off-tank signal for Extended Target: the mob most recently confirmed
-- hitting this character via combat log (agent's recentTankHits), independent
-- of whether they currently have it targeted. Lets the overlay surface
-- "who's tanking something nobody's targeting" — Emperor-style fights where
-- an add is off-tanked at 100% HP and deliberately never targeted/damaged
-- (Uilnayar 2026-07-04).
alter table public.character_live_state
  add column if not exists incoming_mob       text,
  add column if not exists incoming_mob_since timestamptz;
