-- Bootstrap 2/2 — five tables production has that NO migration creates.
--
-- Measured 2026-08-12: applying all 193 committed migrations to an empty database
-- leaves 11 of them failing, and 5 of those failures are because these tables were
-- created out-of-band (dashboard / MCP apply_migration) without the matching file
-- ever being committed — precisely the drift CLAUDE.md's Migrations rule warns
-- about. Reconstructed from the live project's information_schema + pg_indexes.
--
-- Deliberately NOT in supabase/migrations/: landing it there would need a
-- timestamp older than the migrations that reference these tables, which
-- rewrites applied history on a project where they already exist. The durable fix
-- (commit them properly, or squash to a baseline) is a call for the guild lead —
-- this file just makes a FRESH database buildable today.
--
-- Every statement is idempotent. Applying it to the live project is a no-op.
--
-- ⚠ Column definitions and indexes are faithful; RLS POLICIES were not captured.
-- The bot and web both use the service-role key, which bypasses RLS, so a fresh
-- install works — but anon/authenticated reads of these five tables will return
-- nothing until policies are added.

create table if not exists public.fun_events (
  id                    bigserial primary key,
  guild_id              text        not null,
  event_ts              timestamptz not null,
  event_type            text        not null,
  caster                text,
  target                text,
  reagent_qty           smallint default 1,
  encounter_id          uuid,
  raw_text              text,
  created_at            timestamptz not null default now(),
  uploaded_by_discord_id text
);
create unique index if not exists fun_events_guild_id_event_type_caster_event_ts_key
  on public.fun_events (guild_id, event_type, caster, event_ts);
create index if not exists fun_events_caster_idx      on public.fun_events (lower(caster));
create index if not exists fun_events_type_ts_idx     on public.fun_events (event_type, event_ts desc);
create index if not exists fun_events_uploaded_by_idx on public.fun_events (uploaded_by_discord_id);

create table if not exists public.pvp_kills (
  id                    bigserial primary key,
  guild_id              text        not null,
  killer                text        not null,
  killer_guild          text,
  victim                text        not null,
  victim_guild          text,
  zone                  text,
  via_pet               boolean     not null default false,
  pet_name              text,
  killed_at             timestamptz not null,
  source                text        not null default 'pvp_channel',
  raw_text              text,
  dedup_key             text        not null unique,
  created_at            timestamptz not null default now(),
  killer_is_npc         boolean     default false,
  uploaded_by_discord_id text
);
create index if not exists pvp_kills_killed_at_idx   on public.pvp_kills (killed_at desc);
create index if not exists pvp_kills_killer_idx      on public.pvp_kills (guild_id, lower(killer));
create index if not exists pvp_kills_victim_idx      on public.pvp_kills (guild_id, lower(victim));
create index if not exists pvp_kills_uploaded_by_idx on public.pvp_kills (uploaded_by_discord_id);
create index if not exists pvp_kills_npc_killer_idx  on public.pvp_kills (killer, killed_at desc)
  where killer_is_npc = true;

create table if not exists public.pvp_boss_kills (
  id                      bigserial primary key,
  guild_id                text        not null default 'wolfpack',
  boss_id                 text        not null,
  boss_name               text        not null,
  zone                    text,
  timer_hours             numeric     not null,
  killed_at               timestamptz not null,
  killed_by               text,
  killed_by_guild         text,
  recorded_by             text,
  source                  text        not null default 'auto_broadcast',
  raw_text                text,
  spawn_earliest          timestamptz not null,
  spawn_latest            timestamptz not null,
  dedup_key               text        not null unique,
  created_at              timestamptz not null default now(),
  spawn_earliest_override timestamptz
);
create index if not exists pvp_boss_kills_boss_killed_at_idx on public.pvp_boss_kills (boss_id, killed_at desc);
create index if not exists pvp_boss_kills_guild_killed_at_idx on public.pvp_boss_kills (guild_id, killed_at desc);
create index if not exists pvp_boss_kills_spawn_earliest_idx  on public.pvp_boss_kills (spawn_earliest);

create table if not exists public.mimic_sessions (
  id            uuid primary key default gen_random_uuid(),
  session_token text        not null unique,
  user_id       uuid,
  discord_id    text        not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  machine_label text,
  agent_version text
);
create index if not exists mimic_sessions_discord_id_idx on public.mimic_sessions (discord_id);
create index if not exists mimic_sessions_user_id_idx    on public.mimic_sessions (user_id);

create table if not exists public.trigger_timing_feedback (
  id               bigserial primary key,
  guild_id         text        not null default 'wolfpack',
  trigger_id       text,
  trigger_name     text        not null,
  direction        text        not null,
  fired_at         timestamptz,
  voted_at         timestamptz not null default now(),
  voter_character  text,
  voter_discord_id text,
  note             text
);
create index if not exists trigger_timing_feedback_name_idx  on public.trigger_timing_feedback (trigger_name, voted_at desc);
create index if not exists trigger_timing_feedback_voter_idx on public.trigger_timing_feedback (voter_discord_id, voted_at desc);

alter table public.fun_events              enable row level security;
alter table public.pvp_kills               enable row level security;
alter table public.pvp_boss_kills          enable row level security;
alter table public.mimic_sessions          enable row level security;
alter table public.trigger_timing_feedback enable row level security;

-- pvp_assists — the sixth uncaptured table, same story as the five above.
create table if not exists public.pvp_assists (
  id                     bigserial primary key,
  guild_id               text        not null default 'wolfpack',
  pvp_kill_id            bigint,
  assister               text        not null,
  assister_guild         text,
  victim                 text        not null,
  victim_guild           text,
  killer                 text,
  killer_is_npc          boolean     default false,
  zone                   text,
  killed_at              timestamptz not null,
  source                 text        default 'live_agent',
  raw_text               text,
  dedup_key              text        not null unique,
  created_at             timestamptz not null default now(),
  uploaded_by_discord_id text
);
create index if not exists pvp_assists_assister_idx       on public.pvp_assists (assister, killed_at desc);
create index if not exists pvp_assists_victim_idx         on public.pvp_assists (victim, killed_at desc);
create index if not exists pvp_assists_guild_killed_at_idx on public.pvp_assists (guild_id, killed_at desc);
create index if not exists pvp_assists_uploaded_by_idx    on public.pvp_assists (uploaded_by_discord_id);

alter table public.pvp_assists enable row level security;
