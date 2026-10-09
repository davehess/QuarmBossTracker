-- 20261009030000_loot_value_skip_pet_gear.sql
-- /admin/loot: gear a charmer hands to a charmed pet is not loot.
--
-- The guild lead, 2026-10-09, looking at "By character": "when someone gives their charm pet items, they should not
-- be counted as loot. Silver Jacinth ring has negative MR for charming, similar to Rusty Spiked Shoulderpads,
-- Adamantium ring, or other pet weapons or haste items."
--
-- Why: a charmer loots an item and hands it to the charmed pet. Gear with NEGATIVE magic resist is worn by charm pets
-- on purpose (lower MR = the charm holds longer), so the log's "has looted" line is not a keep-for-self drop.
--
-- The rule ("charm-pet gear"), shared with utils/lootValue.js (the Mimic Loot tab's totals): an item NAME is
-- charm-pet gear when
--   (a) ANY eqemu_items row with that exact name has mr < 0, OR
--   (b) its lower-cased name is in loot_pet_gear_names (officer-editable; ships EMPTY).
-- looted_items carries only the item name, so the rule is name-based.
--
-- The data (90 days to 2026-10-09): 7 looted names have mr < 0, 152 of 41,447 rows: Adamantite Band (-10, 61x),
-- Rusty Spiked Shoulderpads (-10, 61x), Silver Jacinth Wedding Ring (-7 is id 14696; a same-name mr 0 version, id 16792,
-- exists; 20x), Gauntlets of Mortality (-5, 4x), Astral Leggings of the Titans (-5, 3x), Astral Cloak of the Titans
-- (-5, 2x), Greenish Metal Shard (-7, 1x). Known cost of "any row": the same-name mr 0 ring is left out too, and the
-- three -5 Titans/Mortality pieces are included. "Pet weapons or haste items" were named but not which, so (b) is the
-- escape hatch: an officer or session adds a name with an INSERT into loot_pet_gear_names.
--
-- Pet gear is decided on the DISTINCT names CTE (one probe per name, not per looted row) and removed by an anti-join,
-- so the 90-day window stays as fast as 20261008190000 left it. loot_value_grouped and
-- loot_value_by_looter_v3 read loot_value_rows, so both inherit the filter; neither is touched. Same signature and
-- return columns as 20261008210000 (a DROP FUNCTION hung production on 2026-10-08), so CREATE OR REPLACE works.
--
-- Idempotent.

create table if not exists public.loot_pet_gear_names (
  item_name  text primary key,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.loot_pet_gear_names enable row level security;   -- service role only, like the other officer lookups

create or replace function public.loot_value_rows(
  p_guild_id text,
  p_since    timestamptz
)
returns table (
  looter_lower     text,
  looter_character text,
  item_name        text,
  zone             text,
  looted_at        timestamptz,
  price            bigint,
  nodrop           boolean,
  dkp              boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with l as (
    select li.looter_lower, li.looter_character, li.item_name, li.zone, li.looted_at
    from looted_items li
    where li.guild_id = p_guild_id
      and li.looted_at >= p_since
  ),
  names as (select distinct l.item_name from l),
  pet as (
    select n.item_name
    from names n
    where exists (select 1 from eqemu_items i where i.name = n.item_name and i.mr < 0)
       or lower(n.item_name) in (select lower(g.item_name) from loot_pet_gear_names g)
  ),
  p as (
    select distinct on (i.name) i.name, i.price, i.nodrop
    from eqemu_items i
    where i.name in (select n.item_name from names n)
    order by i.name, i.id
  ),
  d as (
    select a.item_name, coalesce(a.created_at, a.awarded_at, a.end_at) as t, interval '6 hours' as slack
    from opendkp_auctions a
    where a.item_name in (select n.item_name from names n)
      and coalesce(a.created_at, a.awarded_at, a.end_at) >= p_since - interval '6 hours'
      and (a.winner is not null or exists (select 1 from opendkp_auction_bids b where b.auction_id = a.auction_id))
    union all
    select o.item_name, r.ts, interval '12 hours'
    from opendkp_raids r
    join opendkp_loot o on o.raid_id = r.raid_id
    where r.ts >= p_since - interval '12 hours'
      and o.item_name in (select n.item_name from names n)
  )
  select l.looter_lower, l.looter_character, l.item_name, l.zone, l.looted_at,
    p.price::bigint,
    (p.nodrop = false),          -- the mirror's column is inverted: false = NO DROP
    exists (
      select 1 from d
      where d.item_name = l.item_name
        and d.t between l.looted_at - d.slack and l.looted_at + d.slack
    ) as dkp
  from l
  left join p on p.name = l.item_name
  left join pet on pet.item_name = l.item_name
  where pet.item_name is null
$$;

comment on function public.loot_value_rows(text, timestamptz) is
  'One row per looted_items line since p_since, except charm-pet gear (a name with any eqemu_items row at mr < 0, or listed in loot_pet_gear_names): base merchant value in copper (exact-name join, lowest id; NULL when unpriced), nodrop in plain polarity (true = NO DROP; the eqemu_items column is inverted), and whether the item went through OpenDKP (auction with a winner or bid within ±6 h, or an award in a raid within ±12 h). Base for /admin/loot.';
