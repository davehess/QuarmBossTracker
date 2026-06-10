-- Per-character faction tracking (v1, BETA) — fed by the agent's two
-- self-only log line families via POST /api/agent/faction:
--
--   faction_hits — "Your faction standing with <X> got better/worse."
--     Classic prints no numeric delta, so we store direction (+1/-1) and
--     marry magnitudes to PQDI's faction pages (per-mob / per-quest values)
--     at display time. capped=true is the at-cap form ("could not possibly
--     get any better/worse") — it pins the character's absolute min/max
--     position on that faction, which no amount of hit-counting can.
--
--   faction_cons — /consider standing TRANSITIONS per (character, mob).
--     The con line's leading phrase is the mob's faction tier toward the
--     character (scowls=0 … ally=8). The agent dedups unchanged standings,
--     so each row is a tier CHANGE — a complete-log crawl charts when each
--     faction moved. Also the only log-visible evidence that a Feign Death
--     actually stuck (success is silent; a non-scowling con on a previously
--     KOS mob is the tell).
--
-- Unique constraints make backfill replays idempotent. Known undercount:
-- two same-second hits on the SAME faction (AE-killing twin mobs) collapse
-- into one row — acceptable for v1 tallies.
--
-- Surfaced on wolfpack.quest /character/<name>/factions (BETA).
-- Follow-ups: class/race/deity base standing model, Ornate Velium Pendant
-- (+100) attempt tracking, per-class faction-raising spells/songs.

create table if not exists public.faction_hits (
  id         bigint generated always as identity primary key,
  guild_id   text        not null,
  character  text        not null,
  faction    text        not null,
  direction  smallint    not null,                 -- +1 better / -1 worse
  capped     boolean     not null default false,
  event_ts   timestamptz not null,
  uploaded_by_discord_id text,
  created_at timestamptz not null default now(),
  unique (guild_id, character, faction, event_ts, direction)
);
create index if not exists faction_hits_char_idx
  on public.faction_hits (guild_id, character, faction, event_ts desc);

create table if not exists public.faction_cons (
  id         bigint generated always as identity primary key,
  guild_id   text        not null,
  character  text        not null,
  mob        text        not null,
  standing   text        not null,                 -- scowls … ally
  rank       smallint,                             -- 0 (scowls) … 8 (ally)
  event_ts   timestamptz not null,
  uploaded_by_discord_id text,
  created_at timestamptz not null default now(),
  unique (guild_id, character, mob, event_ts)
);
create index if not exists faction_cons_char_idx
  on public.faction_cons (guild_id, character, event_ts desc);

alter table public.faction_hits enable row level security;
alter table public.faction_cons enable row level security;

-- Guild members can read (GUILD visibility scope); only the bot's
-- service_role writes.
drop policy if exists faction_hits_read on public.faction_hits;
create policy faction_hits_read on public.faction_hits
  for select to authenticated using (true);
drop policy if exists faction_cons_read on public.faction_cons;
create policy faction_cons_read on public.faction_cons
  for select to authenticated using (true);
