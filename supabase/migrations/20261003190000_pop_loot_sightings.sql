-- pop_loot_sightings(guild) — loot as presence proof for the PoP pages (the guild lead, 2026-10-03: "if
-- anyone has looted any distinct items from any of the planes we should go through and flag them up to
-- that plane").
--
-- Same idea as a /who sighting (pop_who_sightings, 20261002010000): a character that looted something
-- inside a plane stood in it, so it holds that plane's gate and the gates on the way in. The site turns
-- these rows into flags the way it turns /who rows into flags (web/lib/popWho.ts).
--
-- One row per (character, plane): the first and last time we have proof, how many distinct items, one
-- sample item, and where the proof came from —
--   'looted'    "--You have looted <item>.--" (self-only in EQ, so it IS the looter), with the zone Zeal
--               reported at that moment: looted_items.zone is the numeric zone id as text, mapped here
--               through eqemu_zone.zone_id to the short name.
--   'inventory' a NO DROP item in the character's uploaded inventory that drops in exactly one zone, and
--               that zone is a PoP plane. A NO DROP item cannot be traded or put in the shared bank, so
--               whoever holds one looted it there. This is locked_zone_evidence_for's rule
--               (20260925112514) with the keyed-zone list swapped for the planes below:
--                 * NO DROP is eqemu_items.nodrop = FALSE. The polarity is INVERTED on this mirror
--                   (true = freely tradeable; web/lib/itemDecode.ts isNoDrop), so `nodrop = true` here
--                   would select every tradeable item and prove nothing;
--                 * a drop's zone comes from its placed spawns, plus the NPC id's zone prefix
--                   (id = zone_id * 1000 + n) for NPCs with no placed spawn;
--                 * exactly one zone, so an item shared with another zone proves neither;
--                 * not a reward of any imported quest script (scripted_npc_turnins).
--               A character that hides its inventory (characters.exclude_inventory) gives no inventory
--               proof, like every other consumer of that table. Looted rows carry no such opt-out: they
--               come from the raid's own logs, as the Justice marks on /pop already do.
-- When both exist for a plane the row says 'looted' and its times and count cover both.
--
-- The plane list is the short names web/lib/popWho.ts WHO_ZONE maps to a chart zone — nothing outside it
-- (Justice, Disease, Nightmare and Innovation are open, so a loot there proves no flag).
-- test/pop-loot-proof.test.js keeps this list and WHO_ZONE's short names equal.
--
-- Read-only. looted_items and character_inventory are guild data, so only the service role (the site's
-- server) may call it. Ordered so a reader can page through it a thousand rows at a time.

create or replace function public.pop_loot_sightings(p_guild_id text)
returns table(character_key text, zone text, first_at timestamptz, last_at timestamptz, items bigint, sample_item text, source text)
language sql
stable
set search_path = public
as $$
  with pop_zones(short_name) as (values
    ('postorms'), ('povalor'), ('codecay'), ('nightmareb'), ('potorment'), ('bothunder'), ('hohonora'),
    ('hohonorb'), ('potactics'), ('solrotower'), ('poeartha'), ('poearthb'), ('poair'), ('powater'),
    ('pofire'), ('potimea'), ('potimeb')
  ),
  looted as (
    select l.looter_lower as ck, z.short_name as zone, l.item_name, l.looted_at as at, 'looted'::text as source
    from looted_items l
    join eqemu_zone z on z.zone_id::text = l.zone
    where l.guild_id = p_guild_id
      and z.short_name in (select short_name from pop_zones)
  ),
  nodrop as (
    select i.id as item_id from eqemu_items i where i.nodrop = false      -- inverted polarity: false = NO DROP
  ),
  src as (
    select lde.item_id, s2.zone_short
    from nodrop
    join eqemu_lootdrop_entries lde  on lde.item_id = nodrop.item_id
    join eqemu_loottable_entries lte on lte.lootdrop_id = lde.lootdrop_id
    join eqemu_npc_types n            on n.loottable_id = lte.loottable_id
    join eqemu_spawnentry se          on se.npc_id = n.id
    join eqemu_spawn2 s2              on s2.spawngroup_id = se.spawngroup_id
    where s2.zone_short is not null
    union
    select lde.item_id, z.short_name
    from nodrop
    join eqemu_lootdrop_entries lde  on lde.item_id = nodrop.item_id
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
  ),
  single as (
    select zs.item_id, zs.zones[1] as zone
    from zone_sets zs
    where cardinality(zs.zones) = 1
      and zs.zones[1] in (select short_name from pop_zones)
      and not exists (select 1 from quest_rewards r where r.item_id = zs.item_id)
  ),
  inventory as (
    select lower(ci.character_name) as ck, s.zone, ci.item_name, ci.observed_at as at, 'inventory'::text as source
    from single s
    join character_inventory ci on ci.item_id = s.item_id
    where ci.guild_id = p_guild_id
      and not exists (select 1 from characters c
                      where c.guild_id = ci.guild_id and lower(c.name) = lower(ci.character_name)
                        and coalesce(c.exclude_inventory, false))
  ),
  proof as (
    select * from looted
    union all
    select * from inventory
  )
  select p.ck, p.zone, min(p.at), max(p.at), count(distinct p.item_name),
         (array_agg(p.item_name order by p.at))[1],
         case when bool_or(p.source = 'looted') then 'looted' else 'inventory' end
  from proof p
  group by p.ck, p.zone
  order by p.ck, p.zone
$$;

revoke all on function public.pop_loot_sightings(text) from public, anon, authenticated;
grant execute on function public.pop_loot_sightings(text) to service_role;
