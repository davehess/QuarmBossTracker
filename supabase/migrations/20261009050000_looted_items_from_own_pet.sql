-- 20261009050000_looted_items_from_own_pet.sql
-- /admin/loot + the Mimic Loot tab: gear a charmer loots back off their OWN pet's corpse is not loot.
--
-- The guild lead, 2026-10-09: "anything a charmer gives to their pet (and we have the spawn ID) and they loot is not
-- counted as loot. It was already theirs."
--
-- The agent (the charmer's own, the only one that can know) sets `from_own_pet` on a "You have looted" line when the
-- looter's target was the corpse of the pet it had been watching alive (same spawn id, same zone, fresh). The log line
-- itself names no corpse and no log line exists for handing an item to a pet, so this is a flag set from Zeal's target,
-- never inferred here. Default false: every existing row, every older agent and every box without a pet id stays loot.
--
-- Sticky true. The bot writes the column only on flagged lines (the key is left out of an unflagged row's upsert, and
-- merge-duplicates updates just the columns in the body), so a re-sent duplicate from an older agent, or from one that
-- lost the pet record on a restart, cannot flip a true back to false; false -> true is allowed (a newer agent
-- re-reading the same line). A direct UPDATE that sets false is the only way back, which is the right way to undo one.
--
-- loot_value_rows keeps the charm-pet-gear rule of 20261009030000 (the `pet` CTE and its anti-join) and adds the
-- `from_own_pet` exclusion to the `l` CTE, so loot_value_grouped and loot_value_by_looter_v3, which read
-- loot_value_rows, inherit it untouched. Same signature and return columns (a DROP FUNCTION hung production on
-- 2026-10-08), so CREATE OR REPLACE works.
--
-- Idempotent.

alter table public.looted_items add column if not exists from_own_pet boolean not null default false;

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
      and not li.from_own_pet
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
  'One row per looted_items line since p_since, except lines the looter''s own agent flagged from_own_pet (gear looted back off the looter''s own charm pet''s corpse) and charm-pet gear (a name with any eqemu_items row at mr < 0, or listed in loot_pet_gear_names): base merchant value in copper (exact-name join, lowest id; NULL when unpriced), nodrop in plain polarity (true = NO DROP; the eqemu_items column is inverted), and whether the item went through OpenDKP (auction with a winner or bid within ±6 h, or an award in a raid within ±12 h). Base for /admin/loot.';
