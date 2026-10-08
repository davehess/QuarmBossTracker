-- Zone-key inference, v2 — every zone the server gates behind a key, and a
-- guild-wide sweep (the guild lead, 2026-09-25: "sweep for no drop items from
-- zones that require keys and make key assumptions for them").
--
-- WHICH ZONES: read from the server's own door table, not from memory. Every
-- door with a key item that teleports into another zone (opentype 58 — each
-- player clicks it with the key in hand, so a key-holder cannot let a group
-- through). On the Quarm mirror that is exactly five:
--   skyfire    → veeshan   Key of Veeshan          20884
--   eastwastes → sleeper   Sleeper's Key           27265   (new here)
--   overthere  → charasis  Key to Charasis         20600   (was seeded with no key item)
--   trakanon   → sebilis   Trakanon Idol           20883
--   umbral     → vexthal   The Scepter of Shadows  22198
-- Each zone's one zone_points row sits on its door's coordinates (the door's
-- destination record, not a walk-in zone line) — except veeshan's, ~200 units
-- from the doors; treated the same, noted as unconfirmed.
--
-- WHAT COUNTS AS EVIDENCE (locked_zone_evidence_items): an item that
--   • is NO DROP (eqemu_items.nodrop = false — the polarity is inverted on this
--     mirror; re-verified 2026-09-25: Bone Chips / Cloth Cap / Peridot read
--     true, every key reads false);
--   • drops in exactly ONE zone, and that zone is keyed. A drop's zone comes
--     from its placed spawns, PLUS — new in v2 — the NPC id's zone prefix
--     (id = zone_id * 1000 + n) for NPCs with no placed spawn (scripted bosses).
--     That second source only ever makes the rule stricter or adds items: an
--     item a scripted NPC also drops elsewhere stops counting;
--   • is not a reward from any imported quest script — new in v2. The sweep
--     found five that were: the four Resistance Stones (Sleeper's Tomb drops,
--     also Shadowhaven rewards) and A Dusty Iksar Skull (Howling Stones drop,
--     also a Cabilis reward). No evidence item is a tradeskill product.
-- A NO DROP item cannot be traded or put in the shared bank, so holding one
-- means this character looted it inside the zone.

insert into locked_zone_keys (zone_short, zone_long, key_item_id, key_item_name, notes) values
  ('sleeper',  'Sleeper''s Tomb',      27265, 'Sleeper''s Key',
     'Keyed on Quarm: the Eastern Wastes doors into the tomb need Sleeper''s Key (door data, opentype 58).'),
  ('charasis', 'The Howling Stones',   20600, 'Key to Charasis',
     'The Overthere doors into the zone need the Key to Charasis (door data, opentype 58) — the end of the translation chain.')
on conflict (zone_short) do update set
  zone_long = excluded.zone_long, key_item_id = excluded.key_item_id,
  key_item_name = excluded.key_item_name, notes = excluded.notes;

update locked_zone_keys k
   set quest_catalog_id = q.id
  from quest_catalog q
 where q.guild_id = 'wolfpack' and q.reward_item_id = k.key_item_id and k.quest_catalog_id is null;

create or replace view locked_zone_evidence_items with (security_invoker = true) as
with src as (
  select lde.item_id, s2.zone_short
  from eqemu_lootdrop_entries lde
  join eqemu_loottable_entries lte on lte.lootdrop_id = lde.lootdrop_id
  join eqemu_npc_types n            on n.loottable_id = lte.loottable_id
  join eqemu_spawnentry se          on se.npc_id = n.id
  join eqemu_spawn2 s2              on s2.spawngroup_id = se.spawngroup_id
  where s2.zone_short is not null
  union
  select lde.item_id, z.short_name
  from eqemu_lootdrop_entries lde
  join eqemu_loottable_entries lte on lte.lootdrop_id = lde.lootdrop_id
  join eqemu_npc_types n            on n.loottable_id = lte.loottable_id
  join eqemu_zone z                 on z.zone_id = n.id / 1000
  where not exists (select 1 from eqemu_spawnentry se where se.npc_id = n.id)
),
zone_sets as (
  select item_id, array_agg(distinct zone_short) as zones from src group by item_id
),
quest_rewards as (
  select distinct (o->>'item_id')::int as item_id
  from scripted_npc_turnins t,
       jsonb_array_elements(case when jsonb_typeof(t.outputs::jsonb) = 'array' then t.outputs::jsonb else '[]'::jsonb end) o
  where (o->>'item_id') ~ '^[0-9]+$'
)
select zs.item_id, zs.zones[1] as zone_short, i.name as item_name
from zone_sets zs
join eqemu_items i      on i.id = zs.item_id
join locked_zone_keys k on k.zone_short = zs.zones[1]
where cardinality(zs.zones) = 1
  and i.nodrop = false                                   -- inverted polarity: false = NO DROP
  and not exists (select 1 from quest_rewards r where r.item_id = zs.item_id);

revoke all on locked_zone_evidence_items from public, anon, authenticated;
grant select on locked_zone_evidence_items to service_role;

-- Same signature and columns as v1, so the quests page needs no change.
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
    select distinct item_id
    from character_inventory
    where guild_id = p_guild_id and lower(character_name) = lower(p_character) and item_id is not null
  )
  select k.zone_short, k.zone_long, k.key_item_id, k.key_item_name,
         (array_agg(e.item_name order by e.item_name))[1:5] as evidence_items,
         count(*)::int                                    as evidence_count,
         k.quest_catalog_id
  from held h
  join locked_zone_evidence_items e on e.item_id = h.item_id
  join locked_zone_keys k           on k.zone_short = e.zone_short
  group by k.zone_short, k.zone_long, k.key_item_id, k.key_item_name, k.quest_catalog_id
  order by evidence_count desc;
$$;

-- The sweep: every character's assumed keys at once.
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
  )
  select min(h.name), k.zone_short, k.zone_long, k.key_item_id, k.key_item_name,
         (array_agg(e.item_name order by e.item_name))[1:5],
         count(*)::int,
         k.quest_catalog_id
  from held h
  join locked_zone_evidence_items e on e.item_id = h.item_id
  join locked_zone_keys k           on k.zone_short = e.zone_short
  group by h.ch, k.zone_short, k.zone_long, k.key_item_id, k.key_item_name, k.quest_catalog_id
  order by 1, 2;
$$;

revoke execute on function inferred_keys_for_character(text, text) from public, anon, authenticated;
grant  execute on function inferred_keys_for_character(text, text) to service_role;
revoke execute on function inferred_zone_access(text) from public, anon, authenticated;
grant  execute on function inferred_zone_access(text) to service_role;
