-- Resist columns on the spell catalog — populated by sync-from-eqmac.
-- resist_type: 0 unresistable / 1 Magic / 2 Fire / 3 Cold / 4 Poison /
--              5 Disease / 6 Chromatic / 7 Prismatic
-- resist_diff: negative = "lure" (harder to resist by that amount).
-- Drives the Mob Info spell-list resist column and the spell tooltip.
alter table public.eqemu_spells
  add column if not exists resist_type smallint,
  add column if not exists resist_diff int;
