-- Locked-zone → required-key mapping. Holding any NO-DROP item that drops ONLY
-- in a locked zone is proof you had its key (Uilnayar 2026-06-24). Seeded for
-- four zones; add a row to extend (PoP planar access, NToV, etc).
--
-- Polarity note (verified against Key of Veeshan, Trakanon Idol, etc.):
-- eqemu_items.nodrop is INVERTED on this Quarm mirror — false means NO DROP.
-- Every consumer of this RPC pairs that with zone-exclusivity to gate against
-- droppable cross-zone gear leaking in.
create table if not exists locked_zone_keys (
  zone_short          text primary key,
  zone_long           text not null,
  key_item_id         integer,                -- → eqemu_items.id (nullable; some chains have no single mirrored "key" item)
  key_item_name       text not null,
  quest_catalog_id    bigint,                 -- → quest_catalog.id; the quest whose reward IS the key
  notes               text,
  created_at          timestamptz not null default now()
);
alter table locked_zone_keys enable row level security;
grant all on locked_zone_keys to service_role;

insert into locked_zone_keys (zone_short, zone_long, key_item_id, key_item_name, notes) values
  ('sebilis',  'Ruins of Sebilis', 20883, 'Trakanon Idol',           'Glowing orb activator. Inner Sebilis nameds drop NO DROP loot that proves you held the idol.'),
  ('veeshan',  'Veeshan''s Peak',  20884, 'Key of Veeshan',          'VP boss loot is exclusive to the zone; any NO DROP VP item proves you held the master key.'),
  ('charasis', 'The Howling Stones', NULL, 'Howling Stones translation chain',
                'HS access chain (collect 10 glyphed skin samples → Completed Specimen Kit → turn-in). No single canonical "key" item id is mirrored, so inference relies on the held HS-only NO DROP loot as direct evidence of access.'),
  ('vexthal',  'Vex Thal',         22198, 'The Scepter of Shadows', 'VT NO DROP loot is exclusive; held = walked through the door with the scepter.')
on conflict (zone_short) do update set
  zone_long = excluded.zone_long, key_item_id = excluded.key_item_id,
  key_item_name = excluded.key_item_name, notes = excluded.notes;

-- Backfill quest_catalog_id where a catalog quest's reward matches the key.
update locked_zone_keys k
   set quest_catalog_id = q.id
  from quest_catalog q
 where q.guild_id = 'wolfpack' and q.reward_item_id = k.key_item_id;

-- inferred_keys_for_character — given a character's inventory, which keys
-- they provably hold by virtue of carrying NO-DROP items exclusive to a
-- locked zone. Caller is the quests page (consumed alongside character_keys).
create or replace function inferred_keys_for_character(p_guild_id text, p_character text)
returns table(
  zone_short text,
  zone_long  text,
  key_item_id integer,
  key_item_name text,
  evidence_items text[],
  evidence_count integer,
  quest_catalog_id bigint
) language sql stable as $$
  with held as (
    select distinct item_id
    from character_inventory
    where guild_id = p_guild_id and lower(character_name) = lower(p_character) and item_id is not null
  ),
  item_zones as (
    select lde.item_id, s2.zone_short
    from eqemu_lootdrop_entries lde
    join eqemu_loottable_entries lte on lte.lootdrop_id = lde.lootdrop_id
    join eqemu_npc_types n            on n.loottable_id = lte.loottable_id
    join eqemu_spawnentry se          on se.npc_id = n.id
    join eqemu_spawn2 s2              on s2.spawngroup_id = se.spawngroup_id
    where s2.zone_short is not null
  ),
  item_zone_set as (
    select item_id, array_agg(distinct zone_short) as zones from item_zones group by item_id
  ),
  evidence as (
    select iz.zones[1] as zone_short, i.id, i.name
    from held h
    join item_zone_set iz on iz.item_id = h.item_id
    join eqemu_items i on i.id = h.item_id
    join locked_zone_keys k on k.zone_short = iz.zones[1]
    where i.nodrop = false                                     -- inverted polarity: false = NO DROP
      and iz.zones = array[k.zone_short]                       -- drops ONLY in the locked zone
  )
  select k.zone_short, k.zone_long, k.key_item_id, k.key_item_name,
         (array_agg(e.name order by e.name))[1:5] as evidence_items,
         count(*)::int                            as evidence_count,
         k.quest_catalog_id
  from evidence e
  join locked_zone_keys k on k.zone_short = e.zone_short
  group by k.zone_short, k.zone_long, k.key_item_id, k.key_item_name, k.quest_catalog_id
  order by evidence_count desc;
$$;

grant execute on function inferred_keys_for_character(text, text) to service_role;
