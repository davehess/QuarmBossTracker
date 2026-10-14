-- Synced spawn-map events (the guild lead, 2026-10-12: "need the tab targetting to set the specific mob
-- in a synced way on the map once it's certain").
--
-- The Mimic Spawn map overlay (beta) attributes mob sightings and deaths to spawn points on the client.
-- Once an attribution is CERTAIN the agent pushes it here (POST /api/agent/map-sync) and pulls everyone
-- else's (GET), so every guild member with the map open in the same zone sees the same respawn timers.
--
-- Scope is guild-wide per zone. One guild per bot today; guild_id is stored for future tenancy.
-- Known ceiling: two guild raids in different instances of the same zone see each other's events.
--
-- Short-lived by design: the bot deletes a zone's rows older than 24 h on every push, because database
-- size is the metered cost that only grows (CLAUDE.md, Supabase section). Rows are small and the reads are
-- bounded (a zone, the last 8 h, at most 500 rows).
--
-- Service role only: RLS on, no policies, no grants to anon/authenticated (the bot uses service_role).
-- Idempotent.

create table if not exists public.map_spawn_events (
    id             bigserial primary key,
    guild_id       text not null,
    zone           text not null,
    point_id       integer not null,
    kind           text not null check (kind in ('seen', 'died', 'empty', 'up', 'clear')),
    spawn_id       integer,
    npc_name       text,
    at             timestamptz not null,
    by_character   text,
    by_discord_id  text,
    created_at     timestamptz default now()
);

create index if not exists map_spawn_events_zone_at_idx
    on public.map_spawn_events (zone, at);

alter table public.map_spawn_events enable row level security;
revoke all on public.map_spawn_events from anon, authenticated;
grant all  on public.map_spawn_events to service_role;
grant usage, select on sequence public.map_spawn_events_id_seq to service_role;
