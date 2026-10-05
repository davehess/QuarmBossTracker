-- 20261006020000_raid_night_appearance.sql
-- How each raider LOOKED on a raid night, one row per raider per distinct look, so a night recorded in
-- raid_track_minutes can be replayed with bodies that look like the people who were there (the guild lead,
-- 2026-10-05: "mostly the theme and the view of the area and how we look as characters so if we animate
-- something in the future it looks good and we can recreate from point map during raids").
--
-- Why it exists: raid_track_minutes says WHERE every raider stood, minute by minute, and nothing about
-- what they looked like. utils/raidAppearance.js fills this table from data we already hold: the first
-- time a night gets a track row in a bot process, and again every 60 minutes, it reads each raider's race
-- and deity from `characters`, their equipped items from `character_gear` (a Quarmy export; else the
-- worn rows of `character_inventory`), and turns those item ids into models through
-- eqemu_items.idfile/material/color (migration 20261006010000). A look that has not changed adds no row.
--
-- A LATER SOURCE WRITES HERE TOO. Zeal will be able to read a spawn's real appearance off the entity
-- (gender, face, hair, beard, dyes), which the exports above never carry. That writer inserts with
-- source = 'zeal_entity' and the same look_hash function (utils/raidAppearance.js lookHash), so a
-- body Zeal saw and a body we derived from gear never collide on the primary key by accident, and a
-- reader takes the best row per raider by source: zeal_entity, then quarmy, then inventory, then who.
--
-- Columns:
--   name_key        lower(character_name). A primary key cannot hold an expression, and every other
--                   per-character table here keys on lower(name) too (character_inventory does)
--   character_name  the name as the roster spells it, for display
--   look_hash       first 16 hex characters of sha256 over the JSON array
--                   [race_id (else lower(race)), gender, face, hair_style, hair_color, beard_style,
--                    beard_color, texture, height rounded to 2 places, mat, tint, prim_it, sec_it]
--                   with unknown values as null. Only what is VISIBLE goes in: deity, worn and
--                   first_seen_at do not, so changing a ring never makes a "new" look
--   source          where the row came from: zeal_entity (read off the live entity), quarmy (equipped
--                   items from the Quarmy export), inventory (worn rows of the inventory file),
--                   who (race/deity only: no item data for this raider)
--   race / race_id  the race as `characters` spells it ('Dark Elf') and the client's race number (6)
--   gender, face, hair_*, beard_*, texture, height
--                   what the entity carries; NULL until a zeal_entity row says so. gender is the client's
--                   0 male / 1 female / 2 neutral
--   deity           characters.deity_id
--   mat             the armor material in the seven textured slots, in the client's order:
--                   head, chest, arms, wrist, hands, legs, feet; 0 = nothing worn there. NULL when
--                   no item data was available at all (a raider with source = 'who')
--   tint            the dye of those same seven slots (eqemu_items.color, unsigned 32-bit ARGB, hence
--                   bigint[] and not int[]); 0 = undyed
--   prim_it/sec_it  the model number of the primary and secondary weapon: 63 for idfile 'IT63'
--   worn            what the model columns were built from: [{slot, item_id, idfile, material, color}]
--                   for the nine visible slots that held an item
--
-- Privacy: a character with characters.exclude_from_stats = true is never written, and one with
-- exclude_inventory = true is written with no item data (source = 'who'), as raid_track_minutes and the
-- gear pages do. The bot fails closed: if it cannot read those flags it writes nothing.
--
-- Retention: kept, like raid_track_minutes. A raider adds a row only when their look changes, so a night
-- is about the size of its roster. The Tower archive keeps its own copy forever
-- (scripts/lib/archive-merge.sql).
--
-- Access: service_role only. RLS is on with no policy, so neither anon nor authenticated can read it.
-- Idempotent.

create table if not exists public.raid_night_appearance (
  guild_id       text        not null,
  night_key      text        not null,   -- utils/raidNight.js nightKey()
  name_key       text        not null,   -- lower(character_name)
  look_hash      text        not null,   -- see the header
  character_name text        not null,
  first_seen_at  timestamptz not null default now(),
  source         text        not null check (source in ('zeal_entity', 'quarmy', 'inventory', 'who')),
  race           text,
  race_id        integer,
  gender         integer,
  face           integer,
  hair_style     integer,
  hair_color     integer,
  beard_style    integer,
  beard_color    integer,
  texture        integer,
  height         real,
  deity          integer,
  mat            integer[],
  tint           bigint[],
  prim_it        integer,
  sec_it         integer,
  worn           jsonb,
  primary key (guild_id, night_key, name_key, look_hash)
);

alter table public.raid_night_appearance enable row level security;
