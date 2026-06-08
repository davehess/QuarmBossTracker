-- pvp_boss_kills.spawn_earliest_override — a quake opens every PVP mob's window
-- immediately, so its EARLIEST spawn becomes "available now" while the kill date
-- and latest spawn (the ±20% window) stay put. spawn_earliest is derived from
-- killed_at + timer, so we can't move just the early edge without this override
-- column. When set, the web board uses it in place of the computed
-- spawn_earliest; a fresh kill clears it (mirrorPvpBossKill writes null).
alter table public.pvp_boss_kills
  add column if not exists spawn_earliest_override timestamptz;

comment on column public.pvp_boss_kills.spawn_earliest_override is
  'When set (by /quake), overrides the computed spawn_earliest so the PvP board shows the window open "now" while keeping killed_at + spawn_latest. Cleared (null) on the next real kill.';
