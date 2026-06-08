-- Pet snapshot on character_live_state — the owner's current pet (charm or
-- summoned) name + HP% + buffs, captured from Zeal slot 16 + the agent's pet
-- buff tracker. Lets /buffs and /raid show a pet stats line under the owner so
-- the raid can see un-buffed / low pets at a glance. Null for non-pet classes.
alter table public.character_live_state
  add column if not exists pet_name   text,
  add column if not exists pet_hp_pct real,
  add column if not exists pet_buffs  jsonb;
