-- HOTFIX: discover_quests_for_item resolved npc_id via a correlated subquery
-- (scan eqemu_npc_types with lower(replace(name)) per result row). For a
-- heavy inventory (Hitya, 498 items) that pushed the RPC to ~8.1s — over the
-- PostgREST statement timeout — so the call failed and the discovery panel
-- vanished. Fix: materialize npc_id as a column on scripted_npc_turnins
-- (resolved once via trigger + a one-time backfill), and have the RPCs just
-- read it. (Uilnayar 2026-06-24.)

alter table scripted_npc_turnins add column if not exists npc_id integer;

-- Speeds both the backfill and the per-row trigger lookup.
create index if not exists eqemu_npc_types_name_norm_idx
  on eqemu_npc_types (lower(replace(name, '_', ' ')));

-- Resolve npc_id from name + zone, only when the match is UNAMBIGUOUS (exactly
-- one) — EQ npc ids are zone-prefixed (id / 1000 == eqemu_zone.zone_id).
create or replace function resolve_turnin_npc_id() returns trigger as $$
begin
  select (case when count(n.id) = 1 then min(n.id) end) into new.npc_id
  from eqemu_zone z
  join eqemu_npc_types n
    on lower(replace(n.name, '_', ' ')) = lower(new.npc_name)
   and (n.id / 1000) = z.zone_id
  where z.short_name = new.zone_short;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_resolve_turnin_npc_id on scripted_npc_turnins;
create trigger trg_resolve_turnin_npc_id
  before insert or update of zone_short, npc_name on scripted_npc_turnins
  for each row execute function resolve_turnin_npc_id();

-- One-time backfill for existing rows (set-based — single pass).
with resolved as (
  select s.id, (case when count(n.id) = 1 then min(n.id) end) as npc_id
  from scripted_npc_turnins s
  join eqemu_zone z on z.short_name = s.zone_short
  left join eqemu_npc_types n
    on lower(replace(n.name, '_', ' ')) = lower(s.npc_name)
   and (n.id / 1000) = z.zone_id
  group by s.id
)
update scripted_npc_turnins s
set npc_id = r.npc_id
from resolved r
where r.id = s.id and s.npc_id is distinct from r.npc_id;

-- RPCs now just read s.npc_id (no per-row subquery → fast).
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
  select s.id, s.zone_short, s.npc_name, s.npc_id, 'piece' as evidence,
         h.item_id, s.inputs, s.outputs, s.faction_changes, s.exp_award, s.cash, s.money_required, s.random_outputs
  from scripted_npc_turnins s
  join held h on s.inputs @> jsonb_build_array(jsonb_build_object('item_id', h.item_id))
  union all
  select s.id, s.zone_short, s.npc_name, s.npc_id, 'completed' as evidence,
         h.item_id, s.inputs, s.outputs, s.faction_changes, s.exp_award, s.cash, s.money_required, s.random_outputs
  from scripted_npc_turnins s
  join held h on s.outputs @> jsonb_build_array(jsonb_build_object('item_id', h.item_id))
  order by 5 desc, 2, 3
  limit 500;
$$;
grant execute on function discover_quests_for_item(integer[]) to service_role;

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
  select s.id, s.zone_short, s.npc_name, s.npc_id,
         s.inputs, s.outputs, s.faction_changes, s.exp_award, s.cash, s.money_required, s.random_outputs
  from scripted_npc_turnins s
  where s.id = any(p_ids);
$$;
grant execute on function turnins_by_id(bigint[]) to service_role;
