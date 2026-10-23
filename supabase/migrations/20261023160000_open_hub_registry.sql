-- The open hub's registry: guilds, players, memberships, invites, activity, gate log, per-stream retention.
-- (the guild lead, 2026-10-23: "anyone can join, once a guild has 12 members they need to stand up their own or
-- pay for the 25 hosting"; design: docs/DESIGN-open-hub.md.)
--
-- ⚠ NOT FOR WOLF PACK'S PRODUCTION DATABASE. These tables belong to the SEPARATE commons project (DECISIONS §358:
-- "not in the Wolfpack database"). The file lives in supabase/migrations/ so the repo and the commons project share one
-- history; do not apply it to zhtoekwakucbckvatfky unless the guild lead says so. Nothing applies migrations
-- automatically; the commons project gets it through apply_migration or the SQL Editor.
--
-- Idempotent. RLS on, NO policies: the hub bot uses the service role and bypasses it; nothing else may read these
-- (a player's own view is served by the bot after it checks the session, never straight from the table).
--
-- guild_id is the SAME text tag every guild table already carries (SUPABASE_GUILD_ID today). In the commons it
-- stops being a process setting and becomes the session's: hub_memberships is where a token's guild_id is
-- checked. The columns are slugs (lowercase, 3-24 chars, utils/openHub.js validGuildSlug).

-- ── Players: one row per person, the owner of their own data ───────────────────────────────────────────────
create table if not exists hub_players (
  player_id     uuid primary key default gen_random_uuid(),
  discord_id    text not null unique,       -- identify scope only: no guild list, no email
  display_name  text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz,
  deleted_at    timestamptz                 -- set by "delete my account"; the sweep that follows is the exit flow, not this column
);

-- ── Guilds: a group of players who name it ─────────────────────────────────────────────────────────────────
create table if not exists hub_guilds (
  guild_id          text primary key,
  display_name      text not null,
  plan              text not null default 'commons' check (plan in ('commons', 'managed', 'self_hosted')),
  gate_state        text not null default 'ok'     check (gate_state in ('ok', 'nearing', 'over', 'grace', 'limited')),
  over_streak       integer not null default 0,
  over_since        timestamptz,
  grace_ends_at     timestamptz,
  grace_extra_days  integer not null default 0 check (grace_extra_days between 0 and 14),
  active_players    integer not null default 0,   -- last evaluation, utils/openHub.js countActivePlayers
  counted_at        timestamptz,
  open_join         boolean not null default false, -- true: anyone signed in may join; false: an invite code is needed
  self_host_url     text,                           -- set when plan = 'self_hosted': where the guild's own server answers
  created_by        uuid references hub_players (player_id),
  created_at        timestamptz not null default now(),
  suspended_at      timestamptz,
  constraint hub_guilds_slug_shape check (guild_id ~ '^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$' and guild_id <> 'wolfpack')
);

-- ── Membership: owner and officers are the guild's own call (no Discord roles in the commons) ──────────────
create table if not exists hub_memberships (
  guild_id    text not null references hub_guilds (guild_id) on delete cascade,
  player_id   uuid not null references hub_players (player_id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'officer', 'member', 'guest')),
  joined_at   timestamptz not null default now(),
  left_at     timestamptz,
  anon_label  text,                              -- "<Class>-<id>" the guild keeps for this person after they leave (DECISIONS §387)
  primary key (guild_id, player_id)
);
create index if not exists hub_memberships_player_idx on hub_memberships (player_id) where left_at is null;
-- exactly one owner per guild at a time
create unique index if not exists hub_memberships_one_owner on hub_memberships (guild_id) where role = 'owner' and left_at is null;

-- ── Invites: a 6-character code (no 0 O 1 I L), like a raid code, for guilds that are not open_join ────────
create table if not exists hub_invites (
  code        text primary key check (code ~ '^[A-HJKMNP-Z2-9]{6}$'),
  guild_id    text not null references hub_guilds (guild_id) on delete cascade,
  created_by  uuid references hub_players (player_id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  max_uses    integer not null default 25 check (max_uses between 1 and 100),
  uses        integer not null default 0
);

-- ── Activity: one row per (guild, player, UTC day with an accepted upload). The 12-member count reads ONLY this ──
create table if not exists hub_player_activity (
  guild_id   text not null references hub_guilds (guild_id) on delete cascade,
  player_id  uuid not null references hub_players (player_id) on delete cascade,
  day        date not null,
  streams    integer not null default 1,
  primary key (guild_id, day, player_id)
);
create index if not exists hub_player_activity_player_idx on hub_player_activity (player_id, day);

-- ── Gate log: append-only record of every state change and every notice, kept outside any sweep ────────────
create table if not exists hub_gate_events (
  id             bigint generated always as identity primary key,
  guild_id       text not null,                 -- no FK on purpose: the record outlives the guild
  at             timestamptz not null default now(),
  from_state     text,
  to_state       text not null,
  notify         text,
  active_players integer not null,
  plan           text not null,
  detail         jsonb
);
create index if not exists hub_gate_events_guild_idx on hub_gate_events (guild_id, at desc);

-- ── Retention: one row per hub stream, the sweeper's whole configuration ───────────────────────────────────
-- commons_hours / managed_hours: how long the hub keeps a row (managed null = no sweep). Kept in step with
-- utils/openHub.js RETENTION by test/open-hub.test.js. Every sweep column below needs a leading index on the
-- target table BEFORE the sweeper is switched on (the 2026-09-01 lesson: an unindexed sweep is a seq scan that
-- the client timeout kills without a word).
create table if not exists hub_retention (
  stream             text primary key,
  table_name         text not null,
  sweep_column       text not null,
  commons_hours      integer not null check (commons_hours > 0),
  managed_hours      integer check (managed_hours is null or managed_hours > 0),
  mb_per_player_day  numeric not null default 0,   -- MEASURED 2026-10-23, Wolf Pack, 14 days, 42 players
  enabled            boolean not null default false -- the sweeper stays off until the guild lead says go
);

insert into hub_retention (stream, table_name, sweep_column, commons_hours, managed_hours, mb_per_player_day) values
  ('character_live_state',       'character_live_state',       'updated_at',   6,    24,   0),
  ('raid_roster',                'raid_roster',                'captured_at',  6,    12,   0),
  ('encounter_threat_snapshots', 'encounter_threat_snapshots', 'snapshot_at',  48,   720,  1.325),
  ('buff_casts',                 'buff_casts',                 'cast_at',      72,   168,  0.300),
  ('raid_track_minutes',         'raid_track_minutes',         'minute_at',    168,  null, 0.026),
  ('encounter_events',           'encounter_events',           'at',           336,  null, 0.075),
  ('encounter_combat_rollup',    'encounter_combat_rollup',    'created_at',   336,  null, 0.049),
  ('contributions',              'contributions',              'created_at',   720,  null, 0.024),
  ('encounters',                 'encounters',                 'started_at',   1440, null, 0.0075),
  ('encounter_players',          'encounter_players',          'encounter_id', 1440, null, 0.014),
  ('encounter_threat_graph',     'encounter_threat_graph',     'encounter_id', 1440, null, 0.009)
on conflict (stream) do nothing;

-- ── RLS: on, no policies (service role only) ───────────────────────────────────────────────────────────────
alter table hub_players         enable row level security;
alter table hub_guilds          enable row level security;
alter table hub_memberships     enable row level security;
alter table hub_invites         enable row level security;
alter table hub_player_activity enable row level security;
alter table hub_gate_events     enable row level security;
alter table hub_retention       enable row level security;
