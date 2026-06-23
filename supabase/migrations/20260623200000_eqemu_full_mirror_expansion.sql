-- Full eqemu_* gameplay-table mirror. Sourced from the Al'Kabor base dump
-- (TAKP is Quarm's parent — Quarm inherits its world data) since the Quarm
-- content tarball only carries the live-server snapshot tables and skips
-- everything classic-EQ-static (factions, recipes, doors, merchants, …).
--
-- All tables follow the existing eqemu_* mirror convention: anon +
-- authenticated read, service_role (the sync + bot) bypasses RLS. Sizing
-- was sanity-checked against the dump — the heaviest new table is
-- tradeskill_recipe_entries at 54k rows / 1.4 MB on disk, still smaller
-- than lootdrop_entries which we've happily mirrored for months.
--
-- Faction tables drive /character/[name]/factions — name resolution, PQDI
-- links, and per-character BASELINE computation from race/class/deity
-- (faction_list.base + faction_list_mod entries for the character's
-- r<N>/c<N>/d<N> codes). Uilnayar 2026-06-23.

-- ── Faction definitions ────────────────────────────────────────────────────
create table if not exists eqemu_faction_list_full (
  id           integer primary key,
  name         text,
  base         integer not null default 0,    -- baseline everyone starts at
  see_illusion smallint not null default 1,
  min_cap      integer not null default 0,    -- floor standing
  max_cap      integer not null default 0     -- ceiling standing
);

-- Per-race/class/deity faction adjustment matrix. mod_name encoding:
--   r<N> = race id  (1 Human, 6 Dark Elf, 128 Iksar, 130 Vah Shir, …)
--   c<N> = class id (1 Warrior … 15 Beastlord)
--   d<N> = deity id (201 Bertoxxulous … 216 Veeshan)
-- characters.race/class/deity_id join here directly.
create table if not exists eqemu_faction_list_mod (
  id          integer primary key,
  faction_id  integer not null,    -- → eqemu_faction_list_full.id
  mod         integer not null,
  mod_name    text not null        -- one of r<N> / c<N> / d<N>
);
create index if not exists eqemu_faction_list_mod_fkey_idx
  on eqemu_faction_list_mod (faction_id, mod_name);

-- ── NPC → faction mapping (already created in 20260623160000; redefine
--     here only to add the columns the v1 migration missed) ─────────────
alter table eqemu_npc_faction
  add column if not exists ignore_primary_assist smallint not null default 0;

alter table eqemu_npc_faction_entries
  add column if not exists temp       smallint not null default 0,
  add column if not exists sort_order smallint not null default 0;

-- ── Tradeskill recipes (powers a future quest tracker) ────────────────
create table if not exists eqemu_tradeskill_recipe (
  id           integer primary key,
  name         text,
  tradeskill   integer,
  skillneeded  integer,
  trivial      integer,
  nofail       smallint,
  replace_container smallint,
  notes        text,
  must_learn   integer,
  quest        smallint
);
create index if not exists eqemu_tradeskill_recipe_skill_idx
  on eqemu_tradeskill_recipe (tradeskill);

create table if not exists eqemu_tradeskill_recipe_entries (
  id          integer primary key,
  recipe_id   integer not null,    -- → eqemu_tradeskill_recipe.id
  item_id     integer,             -- → eqemu_items.id
  successcount integer,
  failcount   integer,
  componentcount integer,
  salvagecount integer,
  iscontainer  smallint
);
create index if not exists eqemu_tradeskill_recipe_entries_recipe_idx
  on eqemu_tradeskill_recipe_entries (recipe_id);
create index if not exists eqemu_tradeskill_recipe_entries_item_idx
  on eqemu_tradeskill_recipe_entries (item_id);

-- ── World navigation: doors + zone connections + ground spawns + forage ──
create table if not exists eqemu_doors (
  id           integer primary key,
  doorid       integer,
  zone         text,
  version      integer,
  name         text,
  pos_x        real,
  pos_y        real,
  pos_z        real,
  heading      real,
  opentype     integer,
  guild        integer,
  lockpick     integer,
  keyitem      integer,
  nokeyring    smallint,
  triggerdoor  integer,
  triggertype  integer,
  doorisopen   smallint,
  dest_zone    text,
  dest_instance integer,
  dest_x       real,
  dest_y       real,
  dest_z       real,
  dest_heading real,
  invert_state smallint,
  incline      integer,
  size         integer,
  client_version_mask integer
);
create index if not exists eqemu_doors_zone_idx on eqemu_doors (zone);

create table if not exists eqemu_zone_points (
  id           integer primary key,
  zone         text,
  number       integer,
  x            real,
  y            real,
  z            real,
  heading      real,
  target_x     real,
  target_y     real,
  target_z     real,
  target_zone_id integer,
  heading_target real,
  client_version_mask integer
);
create index if not exists eqemu_zone_points_zone_idx on eqemu_zone_points (zone);

create table if not exists eqemu_ground_spawns (
  id           integer primary key,
  zoneid       integer,
  version      integer,
  max_x        real,
  max_y        real,
  max_z        real,
  min_x        real,
  min_y        real,
  heading      real,
  name         text,
  item         integer,
  max_allowed  integer,
  respawn_timer integer
);
create index if not exists eqemu_ground_spawns_zone_idx on eqemu_ground_spawns (zoneid);

create table if not exists eqemu_forage (
  id           integer primary key,
  zoneid       integer,
  itemid       integer,
  level        integer,
  chance       integer,
  min_expansion smallint,
  max_expansion smallint,
  content_flags text,
  content_flags_disabled text
);
create index if not exists eqemu_forage_zone_idx on eqemu_forage (zoneid);

create table if not exists eqemu_fishing (
  id           integer primary key,
  zoneid       integer,
  itemid       integer,
  skill_level  integer,
  chance       integer,
  npc_id       integer,
  npc_chance   integer,
  min_expansion smallint,
  max_expansion smallint,
  content_flags text,
  content_flags_disabled text
);
create index if not exists eqemu_fishing_zone_idx on eqemu_fishing (zoneid);

-- ── Merchant inventories + placed objects + traps ─────────────────────
create table if not exists eqemu_merchantlist (
  merchantid   integer not null,
  slot         integer not null,
  item         integer,
  faction_required integer,
  level_required smallint,
  alt_currency_cost integer,
  classes_required integer,
  min_expansion smallint,
  max_expansion smallint,
  content_flags text,
  content_flags_disabled text,
  probability  smallint,
  primary key (merchantid, slot)
);
create index if not exists eqemu_merchantlist_item_idx on eqemu_merchantlist (item);

create table if not exists eqemu_object (
  id          integer primary key,
  zoneid      integer,
  xpos        real,
  ypos        real,
  zpos        real,
  heading     real,
  itemid      integer,
  charges     integer,
  objectname  text,
  type        smallint,
  icon        integer,
  unknown08   integer,
  unknown10   integer,
  unknown20   integer,
  min_expansion smallint,
  max_expansion smallint
);
create index if not exists eqemu_object_zone_idx on eqemu_object (zoneid);

-- ── NPC mob chatter (so the quest tracker can show what they say) ─────
create table if not exists eqemu_npc_emotes (
  emoteid     integer primary key,
  event_      integer,                  -- "event" is reserved-ish; underscored
  type        integer,
  text        text
);
create index if not exists eqemu_npc_emotes_emoteid_idx on eqemu_npc_emotes (emoteid);

-- ── RLS posture matches the other eqemu_* mirrors ──────────────────────
do $$
declare t text;
begin
  for t in select unnest(array[
    'eqemu_faction_list_full', 'eqemu_faction_list_mod',
    'eqemu_tradeskill_recipe', 'eqemu_tradeskill_recipe_entries',
    'eqemu_doors', 'eqemu_zone_points',
    'eqemu_ground_spawns', 'eqemu_forage', 'eqemu_fishing',
    'eqemu_merchantlist', 'eqemu_object', 'eqemu_npc_emotes'
  ]) loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select to anon, authenticated using (true)', t, t);
    execute format('grant select on %I to anon, authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end$$;
