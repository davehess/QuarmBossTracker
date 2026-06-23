-- discover_quests_for_item(item_ids[]) — given a set of inventory item ids,
-- return the scripted-NPC turn-ins where ANY of those items is consumed (a
-- "piece" of a quest the player could be partway through) OR is one of the
-- outputs (a "completed" turn-in they've already done). The quest page joins
-- this with eqemu_items to render readable names and faction context.
create or replace function discover_quests_for_item(p_item_ids integer[])
returns table(
  turnin_id     bigint,
  zone_short    text,
  npc_name      text,
  evidence      text,           -- 'piece' | 'completed'
  matched_item_id integer,
  inputs        jsonb,
  outputs       jsonb,
  faction_changes jsonb,
  exp_award     integer,
  cash          jsonb,
  random_outputs boolean
) language sql stable as $$
  with held(item_id) as (select unnest(p_item_ids))
  select s.id, s.zone_short, s.npc_name, 'piece' as evidence,
         h.item_id, s.inputs, s.outputs, s.faction_changes, s.exp_award, s.cash, s.random_outputs
  from scripted_npc_turnins s
  join held h on s.inputs @> jsonb_build_array(jsonb_build_object('item_id', h.item_id))
  union all
  select s.id, s.zone_short, s.npc_name, 'completed' as evidence,
         h.item_id, s.inputs, s.outputs, s.faction_changes, s.exp_award, s.cash, s.random_outputs
  from scripted_npc_turnins s
  join held h on s.outputs @> jsonb_build_array(jsonb_build_object('item_id', h.item_id))
  order by 4 desc, 2, 3
  limit 500;
$$;

grant execute on function discover_quests_for_item(integer[]) to service_role;
