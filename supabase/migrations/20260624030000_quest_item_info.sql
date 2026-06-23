-- quest_item_info — authoritative per-item display data for the quest tracker.
--
-- The Vex Thal key (recipe 10040) needs 10 components ALL named "A Lucid Shard"
-- — distinguishable only by their lore tag (Set/Raf/Vin/…). Matching quest
-- components by NAME is therefore wrong; the tracker keys on item_id and shows
-- the lore + drop zone so a human can tell the shards apart. (Uilnayar
-- 2026-06-23: "display the item lore name for these Lucid Shards and the zone
-- that it's from.")
--
-- Zone is derived from the drop chain we now mirror:
--   item -> lootdrop_entries -> loottable_entries -> npc_types(loottable_id)
--        -> spawnentry -> spawn2 -> zone
-- (verified: Lucid Shard 22187 -> Scarlet Desert). Items with no drop data
-- (vendor/crafted/reward items) return an empty zone array, which is honest.

create or replace function quest_item_info(p_item_ids integer[])
returns table(item_id integer, name text, lore text, zones text[])
language sql stable as $$
  select
    i.id   as item_id,
    i.name as name,
    -- Strip the leading '*' lore-flag marker for display.
    nullif(regexp_replace(coalesce(i.lore, ''), '^\*', ''), '') as lore,
    coalesce((
      select array_agg(zz.long_name order by zz.cnt desc)
      from (
        select z.long_name, count(distinct n.id) as cnt
        from eqemu_lootdrop_entries lde
        join eqemu_loottable_entries lte on lte.lootdrop_id = lde.lootdrop_id
        join eqemu_npc_types n on n.loottable_id = lte.loottable_id
        join eqemu_spawnentry se on se.npc_id = n.id
        join eqemu_spawn2 s2 on s2.spawngroup_id = se.spawngroup_id
        join eqemu_zone z on z.short_name = s2.zone_short
        where lde.item_id = i.id
        group by z.long_name
        order by cnt desc
        limit 3
      ) zz
    ), '{}') as zones
  from eqemu_items i
  where i.id = any(p_item_ids);
$$;

grant execute on function quest_item_info(integer[]) to service_role;
