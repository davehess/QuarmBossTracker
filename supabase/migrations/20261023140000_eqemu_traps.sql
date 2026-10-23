-- eqemu_traps — the server's own `traps` table, mirrored for the maps (the guild lead, 2026-10-23: "maps should
-- show traps as well").
--
-- Source: the `traps` table in Quarm's published database dump (scripts/sync-from-eqmac.js, weekly). 83 rows in
-- the 2026-09-27 dump, across 8 zones (necropolis, chardok, chardok_instanced, ssratemple, echo, velketor,
-- frozenshadow, paludal). NONE are in the Planes of Power: a PoP "trap" is a trap NPC placed through the spawn
-- tables, which needs no table of its own (utils/trapSpawns.js reads the spawn mirrors and the quest scripts).
--
-- x / y / z are the SERVER frame, the same axes as eqemu_spawn2 (zone/trap.cpp reads them straight into the
-- trap's m_Position), so no pipe swap applies. `effect` follows zone/trap.h: 0 debuff (effectvalue = a spell id),
-- 1 alarm (effectvalue = shout radius, effectvalue2 = how far the alarm pulls), 2 mystic spawn and 3 bandit
-- spawn (effectvalue = npc id, effectvalue2 = how many), 4 damage (effectvalue..effectvalue2 = damage range).
-- A trap fires when a player stands within `radius` (and `maxzdiff` in height), rolling `chance` percent.
-- `trap_group` = the dump's `group` (a reserved word): at most one trap of a group is up at a time.
--
-- Not mirrored: skill, content_flags, content_flags_disabled (nothing on a map reads them).
-- Idempotent. Tier 1 mirror: readable by anon + authenticated like every other eqemu_* table, written only by
-- the service role (the sync). Apply by hand (nothing applies migrations automatically); then run the sync
-- once with force=true so the table fills before the next Sunday.

create table if not exists eqemu_traps (
  id                     integer primary key,
  zone                   text    not null,
  x                      integer not null default 0,
  y                      integer not null default 0,
  z                      integer not null default 0,
  chance                 smallint not null default 0,
  maxzdiff               real    not null default 0,
  radius                 real    not null default 0,
  effect                 integer not null default 0,
  effectvalue            integer not null default 0,
  effectvalue2           integer not null default 0,
  message                text    not null default '',
  level                  integer not null default 1,
  respawn_time           integer not null default 60,
  respawn_var            integer not null default 0,
  triggered_number       smallint not null default 0,
  trap_group             smallint not null default 0,
  despawn_when_triggered smallint not null default 0,
  undetectable           smallint not null default 0,
  min_expansion          real,
  max_expansion          real
);
create index if not exists eqemu_traps_zone_idx on eqemu_traps (zone);

-- No DROP here: as applied 2026-10-23, the policy is created only when missing (a `drop policy` sends the MCP's
-- apply to an approval step that stalled twice).
alter table eqemu_traps enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'eqemu_traps' and policyname = 'eqemu_traps_read') then
    create policy eqemu_traps_read on eqemu_traps for select to anon, authenticated using (true);
  end if;
end $$;
grant select on eqemu_traps to anon, authenticated;
grant all on eqemu_traps to service_role;
