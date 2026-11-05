-- Fight files (the guild lead, 2026-11-05: "do A, keep everything").
--
-- The per-second fight snapshots stop being Postgres rows: the bot holds a fight's snapshots in memory while it
-- is on and writes ONE gzipped ndjson file per fight to the private bucket below when it ends (utils/fightFiles.js).
-- This table is the index of those files; the files are kept forever.
--
-- Reached only by the bot (service role): RLS on, no policies. The bucket is private with no storage policies,
-- so only the service role can read or write it. NOT applied by the repo: apply via the Supabase MCP or paste
-- into the SQL editor. Nothing changes until the tuning number `snapshot_store` is set to 1 or 2.

create table if not exists public.fight_snapshot_files (
  id            uuid        primary key default gen_random_uuid(),
  guild_id      text        not null,
  boss_name     text,
  started_at    timestamptz not null,
  ended_at      timestamptz not null,
  path          text        not null,
  uploaders     text[]      not null default '{}',
  rows          integer     not null default 0,
  bytes         integer     not null default 0,
  encounter_id  uuid,
  raid_night_id uuid,
  created_at    timestamptz not null default now(),
  constraint fight_snapshot_files_path_uq unique (guild_id, path)
);

create index if not exists fight_snapshot_files_started_idx
  on public.fight_snapshot_files (guild_id, started_at);

alter table public.fight_snapshot_files enable row level security;

insert into storage.buckets (id, name, public)
values ('fight-snapshots', 'fight-snapshots', false)
on conflict (id) do nothing;
