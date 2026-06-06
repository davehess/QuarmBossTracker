-- loot_observations — per-item observation log of corpse loot seen by Wolf
-- Pack. Populated by the /loot officer command (one row per parsed item from
-- a Zeal corpse paste). Joined back into the bot's /api/agent/mob-info Loot
-- tab so each row shows "seen N times" alongside the published EQEmu drop %.
-- Distinct from loot_drops (the OpenDKP-award table) — that records who WON
-- the item; this records that the item simply ROLLED on a corpse.
create table if not exists public.loot_observations (
  id                     bigint generated always as identity primary key,
  guild_id               text not null default 'wolfpack',
  npc_name_lower         text not null,
  npc_id                 int,
  item_id                int  not null,
  item_name              text,
  posted_at              timestamptz not null default now(),
  posted_by_discord_id   text,
  source                 text not null default 'loot_command'
);
create index if not exists loot_observations_lookup_idx
  on public.loot_observations (guild_id, npc_name_lower, item_id);
create index if not exists loot_observations_npc_idx
  on public.loot_observations (guild_id, npc_id) where npc_id is not null;
create index if not exists loot_observations_recent_idx
  on public.loot_observations (guild_id, posted_at desc);

alter table public.loot_observations enable row level security;
revoke all on public.loot_observations from anon;
grant select on public.loot_observations to authenticated;
grant all on public.loot_observations to service_role;
