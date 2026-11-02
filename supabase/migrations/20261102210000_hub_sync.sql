-- Free PoP-flag syncing for players outside Wolf Pack (the guild lead, 2026-11-02, DECISIONS §526/§527: "we need to build
-- that ASAP"; docs/DESIGN-raidmimic-hosted.md §8e: what costs us money is what we charge for). Slice 1: the claimed tier.
--
-- Three things:
--   1. mimic_link_codes.hub may be '~player': a Mimic link for a player with no guild. '~' cannot appear in a real slug, so
--      it never collides with a guild; mimic_sessions.guild_id carries the same marker for such a session (scope 'player').
--   2. hub_characters: which character names a player holds, and how sure we are ('claimed' = they uploaded as that name;
--      'proven' is for a later proof; 'contested' = two players claim the same name, hidden from feeds until settled).
--   3. hub_flags: the flags each of those characters has earned, as the agent reported them.
--
-- hub_characters and hub_flags carry NO guild_id, deliberately: a flag belongs to the person, so a player who changes guild
-- keeps their flags. They are person tables, not guild tables (scripts/guild-tables.json lists only tables with guild_id).
-- Written and read ONLY through the service role: RLS is ON with NO policies and anon/authenticated hold no grants (the
-- flag_events / hub_* pattern).
--
-- ORDER MATTERS: apply this BEFORE the bot version that writes them deploys. Only a player link ('~player') and a hub
-- guild's flag upload need it, so a Wolf Pack session is unaffected if it is late. Idempotent: applying it twice is harmless.

-- 1. the link code's hub value: a slug, or the player marker
alter table public.mimic_link_codes drop constraint if exists mimic_link_codes_hub_slug_shape;
alter table public.mimic_link_codes
  add constraint mimic_link_codes_hub_slug_shape
  check (hub is null or hub = '~player' or hub ~ '^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$');

-- 2. who holds which character name
create table if not exists public.hub_characters (
  player_id     uuid        not null references public.hub_players (player_id) on delete cascade,
  name          text        not null check (char_length(name) between 3 and 24),
  name_lc       text        not null,
  proof         text        not null default 'claimed' check (proof in ('claimed', 'proven', 'contested')),
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (player_id, name_lc)
);

-- the holders of a name are read by name on every upload
create index if not exists hub_characters_name_lc_idx on public.hub_characters (name_lc);

-- 3. the flags
create table if not exists public.hub_flags (
  id          bigint generated always as identity primary key,
  player_id   uuid        not null references public.hub_players (player_id) on delete cascade,
  character   text        not null,
  name_lc     text        not null,
  flag_key    text        not null,
  stage       text,
  source      text        not null,
  earned_at   timestamptz not null,
  created_at  timestamptz not null default now(),
  unique (player_id, name_lc, flag_key, earned_at)
);

alter table public.hub_characters enable row level security;
alter table public.hub_flags      enable row level security;

revoke all on public.hub_characters from anon, authenticated;
revoke all on public.hub_flags      from anon, authenticated;

comment on table public.hub_characters is
  'Character names a hub player holds (utils/hubSync.js). Person-scoped, no guild_id. Service role only: RLS on, no policies.';
comment on table public.hub_flags is
  'PoP flags a hub player''s characters have earned (utils/hubSync.js). Person-scoped, no guild_id. Service role only: RLS on, no policies.';
