-- 20261014040000_npc_types_combat_and_look.sql
-- The rest of a mob's sheet: how fast it swings, its stats, and what it looks like.
--
-- The guild lead, 2026-10-13: "mob attack speed is in the data on PQDI. I presume we have all of the info for each
-- mob in the database, including model and what it [looks like]". We had the model basics (race, gender,
-- texture, size) but not the swing speed or stats: scripts/sync-from-eqmac.js never picked those columns, though
-- the same eqmac dump carries them (PQDI shows Grummus at attack_delay 18 = one swing round per 1.8 s).
--
-- attack_delay is in tenths of a second per round. The look columns (helm/armour textures, tint, held weapon
-- models, face) are what an artist or an image prompt needs to draw the mob as the client does.
-- Additive and idempotent; the weekly sync fills them (an older dump without a column leaves it null).

alter table public.eqemu_npc_types
  add column if not exists attack_delay      integer,
  add column if not exists str               integer,
  add column if not exists sta               integer,
  add column if not exists dex               integer,
  add column if not exists agi               integer,
  add column if not exists int_stat          integer,
  add column if not exists wis               integer,
  add column if not exists cha               integer,
  add column if not exists atk               integer,
  add column if not exists accuracy          integer,
  add column if not exists avoidance         integer,
  add column if not exists slow_mitigation   integer,
  add column if not exists hp_regen_rate     integer,
  add column if not exists mana_regen_rate   integer,
  add column if not exists combat_hp_regen   integer,
  add column if not exists combat_mana_regen integer,
  add column if not exists see_sneak         boolean,
  add column if not exists npc_aggro         boolean,
  add column if not exists helmtexture       integer,
  add column if not exists face              integer,
  add column if not exists chesttexture      integer,
  add column if not exists armtexture        integer,
  add column if not exists bracertexture     integer,
  add column if not exists handtexture       integer,
  add column if not exists legtexture        integer,
  add column if not exists feettexture       integer,
  add column if not exists armortint_red     integer,
  add column if not exists armortint_green   integer,
  add column if not exists armortint_blue    integer,
  add column if not exists d_melee_texture1  integer,
  add column if not exists d_melee_texture2  integer,
  add column if not exists prim_melee_type   integer,
  add column if not exists sec_melee_type    integer,
  add column if not exists ranged_type       integer,
  add column if not exists light             integer;
