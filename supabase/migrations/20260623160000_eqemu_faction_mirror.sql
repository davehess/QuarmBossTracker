-- Tier-1 eqemu_* mirrors for faction resolution. These let us turn a mob into
-- its faction (name + PQDI faction id) and compute the faction hits a kill
-- grants, instead of relying on Quarm to print a magnitude.
--
-- Chain: eqemu_npc_types.npc_faction_id → eqemu_npc_faction.id
--        → eqemu_npc_faction.primaryfaction → eqemu_faction_list.id (name)
-- Kill-hit values: eqemu_npc_faction_entries (npc_faction_id, faction_id, value)
--
-- Populated by the weekly sync (scripts/sync-from-eqmac.js, chunked 500-row
-- upserts with return=minimal so no PostgREST row cap). Read-only for the app.
create table if not exists eqemu_faction_list (
  id    integer primary key,
  name  text
);

create table if not exists eqemu_npc_faction (
  id              integer primary key,
  name            text,
  primaryfaction  integer            -- → eqemu_faction_list.id
);
create index if not exists eqemu_npc_faction_primary_idx on eqemu_npc_faction (primaryfaction);

create table if not exists eqemu_npc_faction_entries (
  npc_faction_id  integer not null,  -- → eqemu_npc_faction.id
  faction_id      integer not null,  -- → eqemu_faction_list.id
  value           integer,           -- faction delta granted on kill
  npc_value       integer,
  primary key (npc_faction_id, faction_id)
);
create index if not exists eqemu_npc_faction_entries_faction_idx on eqemu_npc_faction_entries (faction_id);

-- Tier-1 mirrors: readable by anon + authenticated (same posture as the other
-- eqemu_* catalogs); service_role (the sync + bot) bypasses RLS.
alter table eqemu_faction_list        enable row level security;
alter table eqemu_npc_faction         enable row level security;
alter table eqemu_npc_faction_entries enable row level security;

drop policy if exists eqemu_faction_list_read on eqemu_faction_list;
create policy eqemu_faction_list_read on eqemu_faction_list for select to anon, authenticated using (true);
drop policy if exists eqemu_npc_faction_read on eqemu_npc_faction;
create policy eqemu_npc_faction_read on eqemu_npc_faction for select to anon, authenticated using (true);
drop policy if exists eqemu_npc_faction_entries_read on eqemu_npc_faction_entries;
create policy eqemu_npc_faction_entries_read on eqemu_npc_faction_entries for select to anon, authenticated using (true);

grant select on eqemu_faction_list, eqemu_npc_faction, eqemu_npc_faction_entries to anon, authenticated;
grant all    on eqemu_faction_list, eqemu_npc_faction, eqemu_npc_faction_entries to service_role;
