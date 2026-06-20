-- Planes of Power flagging (pre-built for the 2026-10-01 PoP unlock).
--
-- One row per (character, flag). The agent detects the universal grant line
-- "You have received a character flag!" — which does NOT name the flag — and
-- attributes it from context: the character's current zone (Zeal) plus the
-- most recent boss kill. The bot maps (zone, boss) → flag_key via a draft
-- catalog; anything unrecognized lands as flag_key='unmapped' WITH the zone
-- and boss preserved, so launch-week catalog corrections are a data edit +
-- one UPDATE, never lost data. Seer Mal Nae dialogue parsing (the
-- authoritative "what do I have" recital) is a launch-week follow-up once
-- Quarm's exact wording is observable.
--
-- Web: /pop — roster × zone matrix, filter "who is flagged for X".

create table if not exists public.pop_flags (
  id         bigint generated always as identity primary key,
  guild_id   text        not null,
  character  text        not null,
  flag_key   text        not null,          -- catalog key, or 'unmapped'
  zone       text,                          -- where the grant line fired
  boss       text,                          -- most recent boss kill at grant time
  source     text        not null default 'event',   -- event | seer | manual
  earned_at  timestamptz not null,
  created_at timestamptz not null default now(),
  -- One row per char per flag; 'unmapped' is exempted via the partial unique
  -- below so multiple unrecognized grants don't collide.
  unique (guild_id, character, flag_key, earned_at)
);
create index if not exists pop_flags_char_idx
  on public.pop_flags (guild_id, character, flag_key);

alter table public.pop_flags enable row level security;
drop policy if exists pop_flags_read on public.pop_flags;
create policy pop_flags_read on public.pop_flags
  for select to authenticated using (true);
