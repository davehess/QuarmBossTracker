-- db/0001_initial_schema.sql
-- Initial Supabase schema for multi-perspective raid parse aggregation.
--
-- Apply via: Supabase Dashboard → SQL Editor → paste this file → Run
-- Or via: psql $SUPABASE_DB_URL < db/0001_initial_schema.sql
--
-- Tables:
--   raid_nights        — groups encounters by night
--   encounters         — one row per kill (boss + time window)
--   contributions      — each player's perspective uploaded for an encounter
--   encounter_players  — denormalized per-player aggregate (fast reads)
--   combat_events      — granular event stream (populated by local agent)
--   characters         — guild roster (synced from Discord roster threads)

create extension if not exists "uuid-ossp";

-- ── raid_nights ───────────────────────────────────────────────────────────────
create table if not exists raid_nights (
  id                  uuid primary key default uuid_generate_v4(),
  guild_id            text not null,
  date                date not null,
  zone_main           text,
  leader_discord_id   text,
  raid_size_expected  int default 30,
  created_at          timestamptz default now(),
  unique (guild_id, date)
);
create index if not exists raid_nights_guild_date_idx on raid_nights (guild_id, date desc);

-- ── encounters ────────────────────────────────────────────────────────────────
-- One per boss kill. Identified by (guild_id, boss_id, started_at window).
create table if not exists encounters (
  id              uuid primary key default uuid_generate_v4(),
  guild_id        text not null,
  raid_night_id   uuid references raid_nights(id) on delete set null,
  boss_id         text not null,
  boss_name       text not null,
  started_at      timestamptz not null,
  ended_at        timestamptz,
  duration_sec    int,
  zone            text,
  -- denormalized totals (max across contributions)
  total_damage    bigint default 0,
  total_dps       int    default 0,
  created_at      timestamptz default now()
);
create index if not exists encounters_guild_started_idx on encounters (guild_id, started_at desc);
create index if not exists encounters_boss_started_idx  on encounters (boss_id, started_at desc);

-- ── contributions ─────────────────────────────────────────────────────────────
-- Each row is one player's view of an encounter (their EQ log perspective).
-- raw_parse stores the parsed structure (header + per-player rows).
create table if not exists contributions (
  id                       uuid primary key default uuid_generate_v4(),
  encounter_id             uuid not null references encounters(id) on delete cascade,
  contributor_discord_id   text,
  contributor_character    text,
  source                   text not null,
    -- 'eqlogparser_send_to_eq' (legacy /parse paste)
    -- 'local_agent_v1'         (filtered event stream from wolfpack-logsync)
    -- 'manual_paste'           (anything else)
  total_damage             bigint,
  player_count             int,
  duration_sec             int,
  raw_parse                jsonb,
  created_at               timestamptz default now()
);
create index if not exists contributions_encounter_idx on contributions (encounter_id);
create index if not exists contributions_contributor_idx on contributions (contributor_discord_id);

-- ── encounter_players ─────────────────────────────────────────────────────────
-- Denormalized: one row per (encounter, character) with the *best seen* damage
-- across all contributions. Updated by merge_encounter() after each contrib.
create table if not exists encounter_players (
  encounter_id             uuid not null references encounters(id) on delete cascade,
  character_name           text not null,
  total_damage             bigint default 0,
  dps                      int default 0,
  duration_sec             int,
  has_pets                 boolean default false,
  source_contribution_id   uuid references contributions(id) on delete set null,
  rank                     int,
  primary key (encounter_id, character_name)
);
create index if not exists encounter_players_char_idx on encounter_players (character_name);

-- ── combat_events ─────────────────────────────────────────────────────────────
-- Granular events (populated only by local-agent uploads). Empty for legacy /parse contributions.
create table if not exists combat_events (
  id              bigserial primary key,
  encounter_id    uuid not null references encounters(id) on delete cascade,
  contribution_id uuid references contributions(id) on delete cascade,
  ts_ms           bigint not null,
  event_type      text not null,   -- 'damage' | 'heal' | 'death' | 'cast' | 'miss'
  attacker        text not null,
  defender        text,
  ability         text,
  amount          int,
  created_at      timestamptz default now()
);
create index if not exists combat_events_encounter_ts_idx on combat_events (encounter_id, ts_ms);
create index if not exists combat_events_attacker_idx     on combat_events (attacker, encounter_id);

-- ── characters ────────────────────────────────────────────────────────────────
-- Mirror of the Discord roster (synced from /rosterimport).
-- Lets the web UI resolve character names without bot calls.
create table if not exists characters (
  guild_id        text not null,
  name            text not null,
  race            text,
  class           text,
  rank            text,
  main_name       text,         -- null = main; set = alt
  opendkp_id      int,
  discord_id      text,         -- populated when user runs /mycharacter
  quarmy_url      text,
  active          boolean default true,
  updated_at      timestamptz default now(),
  primary key (guild_id, name)
);
create index if not exists characters_discord_idx on characters (discord_id);
create index if not exists characters_main_idx    on characters (guild_id, main_name);

-- ── helper view: encounter completeness ───────────────────────────────────────
-- Completeness = (unique characters seen / raid_size_expected) bounded 0..1.
-- Time coverage is computed at merge time and stored on encounters.
create or replace view encounter_completeness as
select
  e.id                     as encounter_id,
  e.guild_id,
  e.boss_id,
  e.boss_name,
  e.started_at,
  e.duration_sec,
  count(distinct ep.character_name)             as unique_attackers_seen,
  coalesce(rn.raid_size_expected, 30)           as raid_size_expected,
  count(distinct c.id)                          as contributor_count,
  least(1.0, count(distinct ep.character_name)::float
              / nullif(coalesce(rn.raid_size_expected, 30), 0)
        )                                       as completeness_score
from encounters e
left join raid_nights rn on rn.id = e.raid_night_id
left join encounter_players ep on ep.encounter_id = e.id
left join contributions c on c.encounter_id = e.id
group by e.id, rn.raid_size_expected;

-- ── helper function: find or create encounter ────────────────────────────────
-- Matches existing encounter by (guild_id, boss_id) within ±window minutes of started_at.
-- Returns the matched or newly created encounter id.
create or replace function find_or_create_encounter(
  p_guild_id   text,
  p_boss_id    text,
  p_boss_name  text,
  p_started_at timestamptz,
  p_duration   int,
  p_window_min int default 30
) returns uuid as $$
declare
  v_id uuid;
begin
  select id into v_id
  from encounters
  where guild_id = p_guild_id
    and boss_id  = p_boss_id
    and started_at between p_started_at - (p_window_min || ' minutes')::interval
                       and p_started_at + (p_window_min || ' minutes')::interval
  order by abs(extract(epoch from (started_at - p_started_at)))
  limit 1;

  if v_id is null then
    insert into encounters (guild_id, boss_id, boss_name, started_at, duration_sec)
    values (p_guild_id, p_boss_id, p_boss_name, p_started_at, p_duration)
    returning id into v_id;
  end if;

  return v_id;
end;
$$ language plpgsql;

-- ── helper function: merge contribution into encounter_players ───────────────
-- Called after inserting a contribution. Updates encounter_players with the
-- max-damage view per character across all contributions for that encounter.
create or replace function merge_encounter_players(p_encounter_id uuid)
returns void as $$
begin
  -- Wipe and rebuild from raw_parse jsonb of all contributions.
  delete from encounter_players where encounter_id = p_encounter_id;

  insert into encounter_players (encounter_id, character_name, total_damage, dps, duration_sec, has_pets, source_contribution_id, rank)
  select
    p_encounter_id,
    player->>'name' as character_name,
    max((player->>'damage')::bigint)                          as total_damage,
    max((player->>'dps')::int)                                as dps,
    max((player->>'duration')::int)                           as duration_sec,
    bool_or(coalesce((player->>'hasPets')::boolean, false))   as has_pets,
    (array_agg(c.id order by (player->>'damage')::bigint desc))[1] as source_contribution_id,
    row_number() over (order by max((player->>'damage')::bigint) desc) as rank
  from contributions c
  cross join lateral jsonb_array_elements(c.raw_parse->'players') as player
  where c.encounter_id = p_encounter_id
  group by player->>'name';

  -- Update encounter totals from merged players.
  update encounters
  set total_damage = coalesce((select sum(total_damage) from encounter_players where encounter_id = p_encounter_id), 0),
      total_dps    = coalesce((select sum(dps)          from encounter_players where encounter_id = p_encounter_id), 0)
  where id = p_encounter_id;
end;
$$ language plpgsql;
