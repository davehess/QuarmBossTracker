-- Zone-key inference v2, made fast enough for a page load.
--
-- v2 (20260925112238) computed the whole item → zone map on every call:
-- 4.5 s for the character holding the most items. Two changes:
--   1. Work only on the items asked about (a character's inventory), and
--   2. keep only NO DROP ones before touching the loot tables — only they can
--      be evidence, and the common tradeable drops are what fan out into
--      tens of thousands of spawn rows.
-- Same heaviest character: 84 ms, with no new indexes. Rules are unchanged
-- (see 20260925112238's header): NO DROP, drops in exactly one zone (placed
-- spawns + NPC-id zone prefix for unplaced NPCs), that zone keyed, not a quest
-- reward anywhere.

create or replace function locked_zone_evidence_for(p_item_ids integer[] default null)
returns table(item_id integer, zone_short text, item_name text)
language sql stable set search_path = public as $$
  with ids as (
    select i.id as item_id
    from eqemu_items i
    where i.nodrop = false                                -- inverted polarity: false = NO DROP
      and (p_item_ids is null or i.id = any(p_item_ids))
  ),
  src as (
    select lde.item_id, s2.zone_short
    from ids
    join eqemu_lootdrop_entries lde  on lde.item_id = ids.item_id
    join eqemu_loottable_entries lte on lte.lootdrop_id = lde.lootdrop_id
    join eqemu_npc_types n            on n.loottable_id = lte.loottable_id
    join eqemu_spawnentry se          on se.npc_id = n.id
    join eqemu_spawn2 s2              on s2.spawngroup_id = se.spawngroup_id
    where s2.zone_short is not null
    union
    select lde.item_id, z.short_name
    from ids
    join eqemu_lootdrop_entries lde  on lde.item_id = ids.item_id
    join eqemu_loottable_entries lte on lte.lootdrop_id = lde.lootdrop_id
    join eqemu_npc_types n            on n.loottable_id = lte.loottable_id
    join eqemu_zone z                 on z.zone_id = n.id / 1000
    where not exists (select 1 from eqemu_spawnentry se where se.npc_id = n.id)
  ),
  zone_sets as (
    select src.item_id, array_agg(distinct src.zone_short) as zones from src group by src.item_id
  ),
  quest_rewards as (
    select distinct (o->>'item_id')::int as item_id
    from scripted_npc_turnins t,
         jsonb_array_elements(case when jsonb_typeof(t.outputs::jsonb) = 'array' then t.outputs::jsonb else '[]'::jsonb end) o
    where (o->>'item_id') ~ '^[0-9]+$'
  )
  select zs.item_id, zs.zones[1], i.name
  from zone_sets zs
  join eqemu_items i      on i.id = zs.item_id
  join locked_zone_keys k on k.zone_short = zs.zones[1]
  where cardinality(zs.zones) = 1
    and not exists (select 1 from quest_rewards r where r.item_id = zs.item_id);
$$;

-- The audit view keeps its name and columns; it is the helper over every item.
create or replace view locked_zone_evidence_items with (security_invoker = true) as
  select * from locked_zone_evidence_for(null);

create or replace function inferred_keys_for_character(p_guild_id text, p_character text)
returns table(
  zone_short text,
  zone_long  text,
  key_item_id integer,
  key_item_name text,
  evidence_items text[],
  evidence_count integer,
  quest_catalog_id bigint
) language sql stable set search_path = public as $$
  with held as (
    select array_agg(distinct item_id) as ids
    from character_inventory
    where guild_id = p_guild_id and lower(character_name) = lower(p_character) and item_id is not null
  )
  select k.zone_short, k.zone_long, k.key_item_id, k.key_item_name,
         (array_agg(e.item_name order by e.item_name))[1:5] as evidence_items,
         count(*)::int                                    as evidence_count,
         k.quest_catalog_id
  from held
  cross join lateral locked_zone_evidence_for(coalesce(held.ids, '{}')) e
  join locked_zone_keys k on k.zone_short = e.zone_short
  group by k.zone_short, k.zone_long, k.key_item_id, k.key_item_name, k.quest_catalog_id
  order by evidence_count desc;
$$;

create or replace function inferred_zone_access(p_guild_id text)
returns table(
  character_name text,
  zone_short text,
  zone_long  text,
  key_item_id integer,
  key_item_name text,
  evidence_items text[],
  evidence_count integer,
  quest_catalog_id bigint
) language sql stable set search_path = public as $$
  with held as (
    select lower(character_name) as ch, min(character_name) as name, item_id
    from character_inventory
    where guild_id = p_guild_id and item_id is not null
    group by lower(character_name), item_id
  ),
  evidence as (
    select * from locked_zone_evidence_for((select array_agg(distinct item_id) from held))
  )
  select min(h.name), k.zone_short, k.zone_long, k.key_item_id, k.key_item_name,
         (array_agg(e.item_name order by e.item_name))[1:5],
         count(*)::int,
         k.quest_catalog_id
  from held h
  join evidence e         on e.item_id = h.item_id
  join locked_zone_keys k on k.zone_short = e.zone_short
  group by h.ch, k.zone_short, k.zone_long, k.key_item_id, k.key_item_name, k.quest_catalog_id
  order by 1, 2;
$$;

revoke execute on function locked_zone_evidence_for(integer[]) from public, anon, authenticated;
grant  execute on function locked_zone_evidence_for(integer[]) to service_role;
revoke execute on function inferred_keys_for_character(text, text) from public, anon, authenticated;
grant  execute on function inferred_keys_for_character(text, text) to service_role;
revoke execute on function inferred_zone_access(text) from public, anon, authenticated;
grant  execute on function inferred_zone_access(text) to service_role;
revoke all on locked_zone_evidence_items from public, anon, authenticated;
grant select on locked_zone_evidence_items to service_role;
