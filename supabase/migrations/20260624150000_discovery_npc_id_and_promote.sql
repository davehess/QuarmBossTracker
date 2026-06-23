-- Discovery panel rework (Uilnayar 2026-06-24):
--   • "Everything here should have a link to PQDI" — resolve each turn-in NPC to
--     its eqemu_npc_types.id so the page can build pqdi.cc/npc/<id>. EQ npc ids
--     are zone-prefixed (id / 1000 == eqemu_zone.zone_id), so we match on
--     name + zone and only return an id when the match is UNAMBIGUOUS (exactly
--     one) — a wrong link is worse than no link (e.g. four "Cazic Thule" rows).
--   • "Let people move those quests to the active quests section" — a per-
--     character pin table (character_active_turnins) referencing the scripted
--     turn-in, plus a by-id fetch RPC so promoted turn-ins always render even
--     after the matching inventory item is consumed.

-- 1) discover_quests_for_item gains npc_id (unambiguous resolution only).
drop function if exists discover_quests_for_item(integer[]);
create or replace function discover_quests_for_item(p_item_ids integer[])
returns table(
  turnin_id     bigint,
  zone_short    text,
  npc_name      text,
  npc_id        integer,
  evidence      text,
  matched_item_id integer,
  inputs        jsonb,
  outputs       jsonb,
  faction_changes jsonb,
  exp_award     integer,
  cash          jsonb,
  money_required jsonb,
  random_outputs boolean
) language sql stable as $$
  with held(item_id) as (select unnest(p_item_ids))
  select s.id, s.zone_short, s.npc_name,
         (select case when count(*) = 1 then min(n.id) end
            from eqemu_npc_types n
            join eqemu_zone z on z.short_name = s.zone_short
           where lower(replace(n.name,'_',' ')) = lower(s.npc_name)
             and (n.id / 1000) = z.zone_id) as npc_id,
         'piece' as evidence,
         h.item_id, s.inputs, s.outputs, s.faction_changes, s.exp_award, s.cash, s.money_required, s.random_outputs
  from scripted_npc_turnins s
  join held h on s.inputs @> jsonb_build_array(jsonb_build_object('item_id', h.item_id))
  union all
  select s.id, s.zone_short, s.npc_name,
         (select case when count(*) = 1 then min(n.id) end
            from eqemu_npc_types n
            join eqemu_zone z on z.short_name = s.zone_short
           where lower(replace(n.name,'_',' ')) = lower(s.npc_name)
             and (n.id / 1000) = z.zone_id) as npc_id,
         'completed' as evidence,
         h.item_id, s.inputs, s.outputs, s.faction_changes, s.exp_award, s.cash, s.money_required, s.random_outputs
  from scripted_npc_turnins s
  join held h on s.outputs @> jsonb_build_array(jsonb_build_object('item_id', h.item_id))
  order by 5 desc, 2, 3
  limit 500;
$$;
grant execute on function discover_quests_for_item(integer[]) to service_role;

-- 2) turnins_by_id — fetch specific turn-ins (with resolved npc_id) by id, for
--    rendering promoted turn-ins in the Active section regardless of inventory.
create or replace function turnins_by_id(p_ids bigint[])
returns table(
  turnin_id     bigint,
  zone_short    text,
  npc_name      text,
  npc_id        integer,
  inputs        jsonb,
  outputs       jsonb,
  faction_changes jsonb,
  exp_award     integer,
  cash          jsonb,
  money_required jsonb,
  random_outputs boolean
) language sql stable as $$
  select s.id, s.zone_short, s.npc_name,
         (select case when count(*) = 1 then min(n.id) end
            from eqemu_npc_types n
            join eqemu_zone z on z.short_name = s.zone_short
           where lower(replace(n.name,'_',' ')) = lower(s.npc_name)
             and (n.id / 1000) = z.zone_id) as npc_id,
         s.inputs, s.outputs, s.faction_changes, s.exp_award, s.cash, s.money_required, s.random_outputs
  from scripted_npc_turnins s
  where s.id = any(p_ids);
$$;
grant execute on function turnins_by_id(bigint[]) to service_role;

-- 3) character_active_turnins — per-character "I'm working on this" pins for
--    discovered scripted turn-ins (which aren't in quest_catalog).
create table if not exists character_active_turnins (
  id             bigserial primary key,
  guild_id       text not null default 'wolfpack',
  character_name text not null,
  turnin_id      bigint not null references scripted_npc_turnins(id) on delete cascade,
  created_at     timestamptz not null default now(),
  unique (guild_id, character_name, turnin_id)
);
create index if not exists character_active_turnins_char_idx
  on character_active_turnins (guild_id, lower(character_name));
alter table character_active_turnins enable row level security;
grant all on character_active_turnins to service_role;
grant usage, select on all sequences in schema public to service_role;
