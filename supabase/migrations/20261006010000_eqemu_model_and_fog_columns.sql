-- 20261006010000_eqemu_model_and_fog_columns.sql
-- The catalog columns that turn an item id into a MODEL and a zone into a LOOK (the guild lead,
-- 2026-10-05: "mostly the theme and the view of the area and how we look as characters so if we animate
-- something in the future it looks good and we can recreate from point map during raids").
--
-- Checked against the EQMacEmu Quarm dump the weekly sync reads (quarm_2026-09-27-22_44): its `items`
-- table has idfile, material, color and light, and its `zone` table has underworld, minclip, maxclip,
-- sky, ztype, fog_density and five fog sets (fog_red/green/blue + fog_minclip/maxclip, unnumbered and
-- 1-4). Nothing here is invented; every column below exists upstream under the same name.
--
-- eqemu_items
--   idfile    the model a weapon or shield is drawn from ('IT63'); the number is what the client wants
--   material  the armor texture number for the slot the item sits in (0 = none)
--   color     the dye, ARGB as an UNSIGNED 32-bit number: the largest value in the dump is 4294967168
--             (0xFFFFFF80), which does not fit integer, so this is bigint
--   light     the light the item gives off while worn
-- eqemu_zone
--   fog_*     the fog colour (0-255 each) and its near/far clip, for the base set and variants 1-4
--   minclip/maxclip  the view distance; sky the sky number; ztype the zone type; underworld the z below
--             which a body is under the world; fog_density how thick the fog is
--
-- utils/raidAppearance.js reads eqemu_items.idfile/material/color to build a raider's look from their
-- equipped items. It tolerates these columns being absent, so the order of "apply this" and "run the
-- sync" does not matter, but they stay NULL until sync-from-eqmac.js runs again (workflow_dispatch with
-- force=true backfills the whole catalog at once instead of waiting for Sunday).
--
-- Tier 1 catalog data, readable like the rest of eqemu_*. Idempotent.

alter table public.eqemu_items
  add column if not exists idfile   text,
  add column if not exists material integer,
  add column if not exists color    bigint,
  add column if not exists light    integer;

alter table public.eqemu_zone
  add column if not exists underworld   real,
  add column if not exists minclip      real,
  add column if not exists maxclip      real,
  add column if not exists sky          smallint,
  add column if not exists ztype        smallint,
  add column if not exists fog_density  real,
  add column if not exists fog_red      smallint,
  add column if not exists fog_green    smallint,
  add column if not exists fog_blue     smallint,
  add column if not exists fog_minclip  real,
  add column if not exists fog_maxclip  real,
  add column if not exists fog_red1     smallint,
  add column if not exists fog_green1   smallint,
  add column if not exists fog_blue1    smallint,
  add column if not exists fog_minclip1 real,
  add column if not exists fog_maxclip1 real,
  add column if not exists fog_red2     smallint,
  add column if not exists fog_green2   smallint,
  add column if not exists fog_blue2    smallint,
  add column if not exists fog_minclip2 real,
  add column if not exists fog_maxclip2 real,
  add column if not exists fog_red3     smallint,
  add column if not exists fog_green3   smallint,
  add column if not exists fog_blue3    smallint,
  add column if not exists fog_minclip3 real,
  add column if not exists fog_maxclip3 real,
  add column if not exists fog_red4     smallint,
  add column if not exists fog_green4   smallint,
  add column if not exists fog_blue4    smallint,
  add column if not exists fog_minclip4 real,
  add column if not exists fog_maxclip4 real;
