-- Return money_required from discover_quests_for_item so the quest page can
-- render "Give: 3 items + 900pp → ..." when a turn-in demands currency.
drop function if exists discover_quests_for_item(integer[]);
create or replace function discover_quests_for_item(p_item_ids integer[])
returns table(
  turnin_id     bigint,
  zone_short    text,
  npc_name      text,
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
  select s.id, s.zone_short, s.npc_name, 'piece' as evidence,
         h.item_id, s.inputs, s.outputs, s.faction_changes, s.exp_award, s.cash, s.money_required, s.random_outputs
  from scripted_npc_turnins s
  join held h on s.inputs @> jsonb_build_array(jsonb_build_object('item_id', h.item_id))
  union all
  select s.id, s.zone_short, s.npc_name, 'completed' as evidence,
         h.item_id, s.inputs, s.outputs, s.faction_changes, s.exp_award, s.cash, s.money_required, s.random_outputs
  from scripted_npc_turnins s
  join held h on s.outputs @> jsonb_build_array(jsonb_build_object('item_id', h.item_id))
  order by 4 desc, 2, 3
  limit 500;
$$;
grant execute on function discover_quests_for_item(integer[]) to service_role;
