-- Server-wide PvP earthquake schedule — one row per guild. The bot upserts the
-- next-quake time (parsed by the agent from "The next earthquake will begin
-- in…") so the web /pvp page can show a countdown banner above the kill timers.
create table if not exists public.pvp_quake (
  guild_id      text primary key,
  next_quake_at timestamptz,
  detected_at   timestamptz,
  source_text   text,
  updated_at    timestamptz not null default now()
);

alter table public.pvp_quake enable row level security;

-- Read-open to signed-in guild members (the web reads via service role anyway,
-- but keep the authenticated SELECT for parity with the other guild tables).
drop policy if exists pvp_quake_select on public.pvp_quake;
create policy pvp_quake_select on public.pvp_quake
  for select to authenticated using (true);
