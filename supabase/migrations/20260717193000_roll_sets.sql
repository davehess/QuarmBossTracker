-- Off-night NBG roll capture (#91). The agent already groups /random into SETS
-- (same 0-N range within 10min) and links each to its item via the loot-link
-- convention; this stores those sets so off-night loot rolls aren't lost.
-- Write-only for now (a review UI comes later). Multi-uploader: each observer
-- upserts its own view of a set (rolls it saw); the site merges at read.
create table if not exists public.roll_sets (
  id                      uuid primary key default gen_random_uuid(),
  guild_id                text not null,
  uploaded_by_discord_id  text,
  roll_from               int  not null,
  roll_to                 int  not null,
  item                    text,
  qty                     int,
  zone                    text,
  session_key             text,          -- reserved: link REUSED roll sessions
  rolls                   jsonb not null default '[]'::jsonb,  -- [{name,value,at,reroll}]
  started_at              timestamptz not null,
  last_at                 timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
-- One row per uploader per set → re-uploading a growing set UPDATES in place.
create unique index if not exists roll_sets_uploader_uniq
  on public.roll_sets (guild_id, uploaded_by_discord_id, roll_from, roll_to, started_at);
create index if not exists roll_sets_started_at on public.roll_sets (guild_id, started_at desc);

alter table public.roll_sets enable row level security;
drop policy if exists roll_sets_read on public.roll_sets;
create policy roll_sets_read on public.roll_sets
  for select to authenticated using (true);
