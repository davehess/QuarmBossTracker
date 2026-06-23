-- npc_emotes upstream uses `id` (auto-inc) as the PK and `emoteid` as a
-- secondary key (the script-reference id). I'd reversed those in the
-- initial mirror migration, so the sync silently dropped 4k rows because
-- the PK upsert key didn't match the unique column. Redefine.
drop table if exists eqemu_npc_emotes;
create table eqemu_npc_emotes (
  id      integer primary key,
  emoteid integer,
  event_  smallint,    -- upstream column is already named `event_` (SQL reserved word)
  type    smallint,
  text    text
);
create index if not exists eqemu_npc_emotes_emoteid_idx on eqemu_npc_emotes (emoteid);

alter table eqemu_npc_emotes enable row level security;
drop policy if exists eqemu_npc_emotes_read on eqemu_npc_emotes;
create policy eqemu_npc_emotes_read on eqemu_npc_emotes for select to anon, authenticated using (true);
grant select on eqemu_npc_emotes to anon, authenticated;
grant all    on eqemu_npc_emotes to service_role;
