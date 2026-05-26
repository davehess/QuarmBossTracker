-- supabase/migrations/20260525120000_initial_schema.sql
-- Initial schema for the RaidBosses Supabase project.
--
-- Two tiers:
--   TIER 1 — eqemu_*  (mirrored weekly from SecretsOTheP/EQMacEmu DB dumps)
--   TIER 2 — guild data (encounters, contributions, loot, characters, …)
--
-- This file is the single source of truth for the database structure. It is
-- intentionally idempotent (CREATE … IF NOT EXISTS) so it can be re-applied
-- safely if Supabase's GitHub integration runs it twice.
--
-- Security posture (defensive — works regardless of project toggle choices):
--   1. RLS is explicitly enabled on every table.
--   2. All grants to anon/authenticated are explicitly revoked at create time;
--      we add specific SELECT policies per table only where intended.
--   3. The bot uses the service_role key, which bypasses RLS — so writes
--      from the bot are unaffected by these policies.
--
-- Future migrations should be additive (alter table … add column, new tables,
-- new policies). Avoid drop column in production migrations.

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ════════════════════════════════════════════════════════════════════════════
-- TIER 1 — eqemu_* (mirrors of upstream MySQL tables)
--
-- Columns chosen are the subset we actually use. The sync job is responsible
-- for upserting from the latest quarm_*.tar.gz dump. We do NOT mirror every
-- EQEmu column (npc_types alone has ~80 columns upstream; we keep ~30).
-- ════════════════════════════════════════════════════════════════════════════

-- ── eqemu_zone ────────────────────────────────────────────────────────────────
create table if not exists eqemu_zone (
  short_name        text primary key,
  long_name         text not null,
  zone_id           int unique,
  expansion         int,            -- 0=Classic 1=Kunark 2=Velious 3=Luclin 4=PoP
  file              text,
  safe_x            real,
  safe_y            real,
  safe_z            real,
  min_status        int,
  note              text,
  synced_at         timestamptz default now()
);
create index if not exists eqemu_zone_expansion_idx on eqemu_zone (expansion);

-- ── eqemu_items ───────────────────────────────────────────────────────────────
create table if not exists eqemu_items (
  id                  int primary key,
  name                text not null,
  lore                text,
  lore_flag           boolean default false,
  nodrop              boolean default false,       -- no-trade
  norent              boolean default false,       -- rent-out / non-persistent
  magic               boolean default false,
  itemtype            int,                          -- slot type (1H, 2H, armor, etc.)
  slots               bigint,                       -- bitmask of equip slots
  icon                int,
  weight              int,
  recommended_level   int,
  required_level      int,
  classes             int,                          -- bitmask
  races               int,                          -- bitmask
  ac                  int,
  hp                  int,
  mana                int,
  damage              int,
  delay               int,
  focus_effect        int,
  proc_effect         int,
  str                 int,
  sta                 int,
  dex                 int,
  agi                 int,
  intel               int,
  wis                 int,
  cha                 int,
  mr                  int,
  cr                  int,
  dr                  int,
  fr                  int,
  pr                  int,
  price               int,
  synced_at           timestamptz default now()
);
create index if not exists eqemu_items_name_idx on eqemu_items using gin (to_tsvector('english', name));
create index if not exists eqemu_items_itemtype_idx on eqemu_items (itemtype);

-- ── eqemu_npc_types (the catalog of every NPC on the server) ─────────────────
create table if not exists eqemu_npc_types (
  id                  int primary key,
  name                text not null,
  lastname            text,
  level               int,
  race                int,
  class               int,
  bodytype            int,
  hp                  bigint,
  mana                bigint,
  gender              int,
  texture             int,
  size                real,
  ac                  int,
  mindmg              int,
  maxdmg              int,
  attack_count        int,
  aggroradius         int,
  assistradius        int,
  mr                  int,
  cr                  int,
  dr                  int,
  fr                  int,
  pr                  int,
  see_invis           boolean default false,
  see_invis_undead    boolean default false,
  see_hide            boolean default false,
  see_improved_hide   boolean default false,
  npc_spells_id       int,
  loottable_id        int,
  runspeed            real,
  walkspeed           real,
  npc_faction_id      int,
  maxlevel            int,
  scalerate           int,
  raid_target         boolean default false,
  rare_spawn          boolean default false,
  respawn_seconds     int,                          -- joined from spawn2 by sync job for convenience
  zone_short          text,                         -- joined from spawn2/zone by sync job
  synced_at           timestamptz default now()
);
create index if not exists eqemu_npc_types_name_idx     on eqemu_npc_types using gin (to_tsvector('english', name));
create index if not exists eqemu_npc_types_zone_idx     on eqemu_npc_types (zone_short);
create index if not exists eqemu_npc_types_loottable_idx on eqemu_npc_types (loottable_id);
create index if not exists eqemu_npc_types_raid_idx     on eqemu_npc_types (raid_target) where raid_target = true;

-- ── Loot tree: loottable → loottable_entries → lootdrop → lootdrop_entries → items
create table if not exists eqemu_loottable (
  id          int primary key,
  name        text,
  mincash     int,
  maxcash     int,
  avgcoin     int,
  synced_at   timestamptz default now()
);

create table if not exists eqemu_loottable_entries (
  loottable_id   int not null references eqemu_loottable(id) on delete cascade,
  lootdrop_id    int not null,
  multiplier     int default 1,
  droplimit      int default 0,
  mindrop        int default 0,
  probability    real default 100,
  primary key (loottable_id, lootdrop_id),
  synced_at      timestamptz default now()
);

create table if not exists eqemu_lootdrop (
  id          int primary key,
  name        text,
  synced_at   timestamptz default now()
);

create table if not exists eqemu_lootdrop_entries (
  lootdrop_id      int not null references eqemu_lootdrop(id) on delete cascade,
  item_id          int not null references eqemu_items(id) on delete cascade,
  item_charges     int default 1,
  equip_item       boolean default false,
  chance           real default 0,
  minlevel         int default 0,
  maxlevel         int default 255,
  multiplier       int default 1,
  disabled_chance  real default 0,
  primary key (lootdrop_id, item_id),
  synced_at        timestamptz default now()
);
create index if not exists eqemu_lootdrop_entries_item_idx on eqemu_lootdrop_entries (item_id);

-- Spawn tree (for "where does this NPC live")
create table if not exists eqemu_spawngroup (
  id          int primary key,
  name        text,
  synced_at   timestamptz default now()
);

create table if not exists eqemu_spawnentry (
  spawngroup_id   int not null references eqemu_spawngroup(id) on delete cascade,
  npc_id          int not null references eqemu_npc_types(id) on delete cascade,
  chance          int default 100,
  primary key (spawngroup_id, npc_id),
  synced_at       timestamptz default now()
);

create table if not exists eqemu_spawn2 (
  id              int primary key,
  spawngroup_id   int references eqemu_spawngroup(id) on delete set null,
  zone_short      text references eqemu_zone(short_name) on delete cascade,
  x               real,
  y               real,
  z               real,
  heading         real,
  respawntime     int,                              -- seconds
  variance        int default 0,
  pathgrid        int default 0,
  enabled         boolean default true,
  synced_at       timestamptz default now()
);
create index if not exists eqemu_spawn2_zone_idx on eqemu_spawn2 (zone_short);

-- ── Convenience view: flat NPC → drops list ──────────────────────────────────
-- Used by /loot rarity check, /addboss preview, etc.
create or replace view eqemu_npc_drops as
select
  n.id              as npc_id,
  n.name            as npc_name,
  n.zone_short,
  i.id              as item_id,
  i.name            as item_name,
  -- effective chance = loottable_entry probability × lootdrop_entry chance
  (lte.probability * lde.chance / 100.0)::real as effective_chance,
  lde.chance         as drop_chance,
  lte.probability    as table_probability,
  lte.multiplier,
  i.lore_flag
from eqemu_npc_types n
join eqemu_loottable lt          on lt.id = n.loottable_id
join eqemu_loottable_entries lte on lte.loottable_id = lt.id
join eqemu_lootdrop ld           on ld.id = lte.lootdrop_id
join eqemu_lootdrop_entries lde  on lde.lootdrop_id = ld.id
join eqemu_items i               on i.id = lde.item_id;

-- ── sync_meta — every successful sync writes one row ─────────────────────────
create table if not exists sync_meta (
  id                  uuid primary key default uuid_generate_v4(),
  dump_date           text not null,                -- e.g. '2026-05-25_12-34'
  dump_commit_sha     text,
  tables_synced       text[],
  row_counts          jsonb,
  synced_at           timestamptz default now()
);
create index if not exists sync_meta_synced_at_idx on sync_meta (synced_at desc);

-- ════════════════════════════════════════════════════════════════════════════
-- TIER 2 — Guild data (encounters, contributions, characters, loot, …)
-- ════════════════════════════════════════════════════════════════════════════

-- ── characters (mirror of Discord roster + opt-in discord_id mapping) ────────
create table if not exists characters (
  guild_id        text not null default 'wolfpack',
  name            text not null,
  race            text,
  class           text,
  rank            text,
  main_name       text,                         -- null = main; set = alt of {main_name}
  opendkp_id      int,
  discord_id      text,                         -- populated only via opt-in command
  quarmy_url      text,
  active          boolean default true,
  updated_at      timestamptz default now(),
  primary key (guild_id, name)
);
create index if not exists characters_discord_idx on characters (discord_id) where discord_id is not null;
create index if not exists characters_main_idx    on characters (guild_id, main_name) where main_name is not null;

-- ── bosses_local — the opt-in "we track this NPC" set ────────────────────────
create table if not exists bosses_local (
  npc_id                  int primary key references eqemu_npc_types(id) on delete restrict,
  internal_id             text not null unique,          -- "lord_nagafen" for slash-command autocomplete
  nicknames               text[] default '{}',
  emoji                   text,
  timer_hours_override    real,                          -- our measured timer when it differs from upstream respawntime
  expansion_label         text,                          -- our Classic/Kunark/Velious/Luclin/PoP bucket
  path_notes              text,                          -- "PoK → Twilight Sea → Akheva Ruins"
  strat_notes             text,                          -- private strat docs (officer-only via RLS)
  added_by_discord_id     text,
  added_at                timestamptz default now()
);

-- ── raid_nights ──────────────────────────────────────────────────────────────
create table if not exists raid_nights (
  id                  uuid primary key default uuid_generate_v4(),
  guild_id            text not null default 'wolfpack',
  date                date not null,
  zone_main           text references eqemu_zone(short_name) on delete set null,
  leader_discord_id   text,
  raid_size_expected  int default 30,
  created_at          timestamptz default now(),
  unique (guild_id, date)
);
create index if not exists raid_nights_date_idx on raid_nights (date desc);

-- ── encounters — one per boss kill ───────────────────────────────────────────
create table if not exists encounters (
  id              uuid primary key default uuid_generate_v4(),
  guild_id        text not null default 'wolfpack',
  npc_id          int not null references eqemu_npc_types(id) on delete restrict,
  raid_night_id   uuid references raid_nights(id) on delete set null,
  started_at      timestamptz not null,
  ended_at        timestamptz,
  duration_sec    int,
  zone_short      text references eqemu_zone(short_name) on delete set null,
  total_damage    bigint default 0,
  total_dps       int    default 0,
  created_at      timestamptz default now()
);
create index if not exists encounters_npc_started_idx on encounters (npc_id, started_at desc);
create index if not exists encounters_started_idx     on encounters (started_at desc);
create index if not exists encounters_raid_night_idx  on encounters (raid_night_id);

-- ── contributions — each contributor's view of an encounter ──────────────────
create table if not exists contributions (
  id                       uuid primary key default uuid_generate_v4(),
  encounter_id             uuid not null references encounters(id) on delete cascade,
  contributor_discord_id   text,
  contributor_character    text,
  source                   text not null,
                                                  -- 'eqlogparser_send_to_eq'
                                                  -- 'local_agent_v1'
                                                  -- 'manual_paste'
  total_damage             bigint,
  player_count             int,
  duration_sec             int,
  raw_parse                jsonb,
  created_at               timestamptz default now()
);
create index if not exists contributions_encounter_idx   on contributions (encounter_id);
create index if not exists contributions_contributor_idx on contributions (contributor_discord_id) where contributor_discord_id is not null;

-- ── encounter_players — merged max-damage view per character per encounter ──
create table if not exists encounter_players (
  encounter_id             uuid not null references encounters(id) on delete cascade,
  character_name           text not null,
  total_damage             bigint default 0,
  dps                      int    default 0,
  duration_sec             int,
  has_pets                 boolean default false,
  source_contribution_id   uuid references contributions(id) on delete set null,
  rank                     int,
  primary key (encounter_id, character_name)
);
create index if not exists encounter_players_char_idx on encounter_players (character_name);

-- ── combat_events — granular event stream (populated by local agent only) ───
create table if not exists combat_events (
  id              bigserial primary key,
  encounter_id    uuid not null references encounters(id) on delete cascade,
  contribution_id uuid references contributions(id) on delete cascade,
  ts_ms           bigint not null,
  event_type      text not null,                 -- damage|heal|death|cast|miss
  attacker        text not null,
  defender        text,
  ability         text,
  amount          int,
  created_at      timestamptz default now()
);
create index if not exists combat_events_encounter_ts_idx on combat_events (encounter_id, ts_ms);
create index if not exists combat_events_attacker_idx     on combat_events (attacker, encounter_id);

-- ── loot_drops — items awarded from each encounter ───────────────────────────
create table if not exists loot_drops (
  id                  uuid primary key default uuid_generate_v4(),
  encounter_id        uuid not null references encounters(id) on delete cascade,
  item_id             int not null references eqemu_items(id) on delete restrict,
  quantity            int default 1,
  winner_character    text,
  dkp_spent           int default 0,
  runner_up_bids      jsonb,                     -- [{character, dkp_bid, was_lore_skipped}]
  lore_flagged        boolean default false,
  awarded_at          timestamptz default now(),
  awarded_by_discord_id text
);
create index if not exists loot_drops_encounter_idx on loot_drops (encounter_id);
create index if not exists loot_drops_item_idx      on loot_drops (item_id);
create index if not exists loot_drops_character_idx on loot_drops (winner_character) where winner_character is not null;

-- ── wishlists — per-character BIS lists ──────────────────────────────────────
create table if not exists wishlists (
  character_name      text not null,
  item_id             int not null references eqemu_items(id) on delete cascade,
  priority            int default 5,             -- 1=top BIS, 10=nice-to-have
  note                text,
  source              text,                       -- 'manual' | 'quarmy_import'
  source_url          text,
  added_at            timestamptz default now(),
  primary key (character_name, item_id)
);

-- ── travel_paths — our novel data: how to get to a zone via ports/runs ──────
create table if not exists travel_paths (
  id                  uuid primary key default uuid_generate_v4(),
  zone_from_short     text references eqemu_zone(short_name) on delete cascade,
  zone_to_short       text not null references eqemu_zone(short_name) on delete cascade,
  hops                jsonb,                      -- [{type:'port'|'run',from,to,note,class}]
  notes               text,
  posted_by_discord_id text,
  updated_at          timestamptz default now()
);
create index if not exists travel_paths_to_idx on travel_paths (zone_to_short);

-- ── officer_notes — strat notes (officer-only via RLS) ──────────────────────
create table if not exists officer_notes (
  id                  uuid primary key default uuid_generate_v4(),
  npc_id              int references eqemu_npc_types(id) on delete cascade,
  zone_short          text references eqemu_zone(short_name) on delete cascade,
  body                text not null,
  visibility          text not null default 'officer',   -- 'officer' | 'guild'
  posted_by_discord_id text,
  updated_at          timestamptz default now()
);
create index if not exists officer_notes_npc_idx  on officer_notes (npc_id) where npc_id is not null;
create index if not exists officer_notes_zone_idx on officer_notes (zone_short) where zone_short is not null;

-- ── patch_notes — our own changelog, yaqds-style ─────────────────────────────
create table if not exists patch_notes (
  id                  uuid primary key default uuid_generate_v4(),
  version             text not null,             -- e.g. '1.3.15'
  posted_at           timestamptz default now(),
  category            text,                       -- 'feature' | 'fix' | 'qol' | 'balance' | 'content'
  title               text not null,
  body                text,
  affected_npcs       int[],                     -- optional FK-ish list
  affected_items      int[],
  posted_by_discord_id text
);
create index if not exists patch_notes_posted_idx on patch_notes (posted_at desc);

-- ── audit_log — mirror of the Discord audit trail (officer-only) ────────────
create table if not exists audit_log (
  id                  uuid primary key default uuid_generate_v4(),
  ts                  timestamptz default now(),
  action              text not null,             -- 'kill', 'unkill', 'updatetimer', 'register', etc.
  actor_discord_id    text,
  actor_name          text,
  payload             jsonb,
  msg_link            text                       -- link to Discord audit thread message if any
);
create index if not exists audit_log_ts_idx on audit_log (ts desc);

-- ════════════════════════════════════════════════════════════════════════════
-- Helper functions
-- ════════════════════════════════════════════════════════════════════════════

-- find_or_create_encounter — central RPC used by /parse and /parsecontrib.
-- Matches existing encounter by (guild_id, npc_id) within ±window minutes.
create or replace function find_or_create_encounter(
  p_guild_id   text,
  p_npc_id     int,
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
    and npc_id   = p_npc_id
    and started_at between p_started_at - (p_window_min || ' minutes')::interval
                       and p_started_at + (p_window_min || ' minutes')::interval
  order by abs(extract(epoch from (started_at - p_started_at)))
  limit 1;

  if v_id is null then
    insert into encounters (guild_id, npc_id, started_at, duration_sec)
    values (p_guild_id, p_npc_id, p_started_at, p_duration)
    returning id into v_id;
  end if;

  return v_id;
end;
$$ language plpgsql security definer;

-- merge_encounter_players — recompute encounter_players from contributions.
create or replace function merge_encounter_players(p_encounter_id uuid)
returns void as $$
begin
  delete from encounter_players where encounter_id = p_encounter_id;

  insert into encounter_players
    (encounter_id, character_name, total_damage, dps, duration_sec, has_pets, source_contribution_id, rank)
  select
    p_encounter_id,
    player->>'name'                                              as character_name,
    max((player->>'damage')::bigint)                             as total_damage,
    max((player->>'dps')::int)                                   as dps,
    max((player->>'duration')::int)                              as duration_sec,
    bool_or(coalesce((player->>'hasPets')::boolean, false))      as has_pets,
    (array_agg(c.id order by (player->>'damage')::bigint desc))[1] as source_contribution_id,
    row_number() over (order by max((player->>'damage')::bigint) desc) as rank
  from contributions c
  cross join lateral jsonb_array_elements(c.raw_parse->'players') as player
  where c.encounter_id = p_encounter_id
  group by player->>'name';

  update encounters
  set total_damage = coalesce((select sum(total_damage) from encounter_players where encounter_id = p_encounter_id), 0),
      total_dps    = coalesce((select sum(dps)          from encounter_players where encounter_id = p_encounter_id), 0)
  where id = p_encounter_id;
end;
$$ language plpgsql security definer;

-- encounter_completeness view: how well-covered is each kill?
create or replace view encounter_completeness as
select
  e.id                                                          as encounter_id,
  e.guild_id,
  e.npc_id,
  n.name                                                        as boss_name,
  e.started_at,
  e.duration_sec,
  e.zone_short,
  count(distinct ep.character_name)                             as unique_attackers_seen,
  coalesce(rn.raid_size_expected, 30)                           as raid_size_expected,
  count(distinct c.id)                                          as contributor_count,
  least(1.0, count(distinct ep.character_name)::float
              / nullif(coalesce(rn.raid_size_expected, 30), 0)
        )                                                       as completeness_score
from encounters e
left join eqemu_npc_types n  on n.id = e.npc_id
left join raid_nights rn     on rn.id = e.raid_night_id
left join encounter_players ep on ep.encounter_id = e.id
left join contributions c    on c.encounter_id = e.id
group by e.id, n.name, rn.raid_size_expected;

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — defensive by default
-- ════════════════════════════════════════════════════════════════════════════
-- Strategy:
--   * Enable RLS on EVERY table (even if it was already on at the project level).
--   * Revoke all default privileges from anon and authenticated.
--   * service_role bypasses RLS — so the bot is unaffected.
--   * Add anon-readable policies only on tables that should be public (eqemu_*
--     game data, patch_notes, sync_meta).
--   * Guild-only and officer-only tables get NO policy until the web UI lands
--     and we know which auth scheme we're using. They're "deny-all" until then.

do $$
declare
  t text;
begin
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Public game data — readable by anon & authenticated (the eqemu_* tier).
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'eqemu_zone','eqemu_items','eqemu_npc_types',
      'eqemu_loottable','eqemu_loottable_entries',
      'eqemu_lootdrop','eqemu_lootdrop_entries',
      'eqemu_spawngroup','eqemu_spawnentry','eqemu_spawn2',
      'sync_meta','patch_notes'
    ])
  loop
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format(
      'create policy "%I_read_all" on public.%I for select using (true)',
      t || '_anon', t
    );
  end loop;
end $$;

-- Grant SELECT on the convenience view as well.
grant select on public.eqemu_npc_drops      to anon, authenticated;
grant select on public.encounter_completeness to authenticated;

comment on schema public is
  'RaidBosses — bot writes via service_role; anon/authenticated reads gated by RLS.';
