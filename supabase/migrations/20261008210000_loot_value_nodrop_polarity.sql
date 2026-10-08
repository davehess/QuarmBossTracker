-- 20261008210000_loot_value_nodrop_polarity.sql
-- /admin/loot: the ND (NO DROP) tag was backwards.
--
-- The guild lead, 2026-10-08, looking at the page: "All of these ND items are not actually no drop, i think the
-- display is backwards." It was: eqemu_items.nodrop is INVERTED on this Quarm mirror (false = NO DROP, true =
-- tradeable; see 20260624100000_zone_key_inference.sql and the item card). 16,978 rows are true, 9,994 false.
-- loot_value_rows passed the raw column through as `nodrop`, so the page tagged every tradeable item (Diamond,
-- Raw Diamond, Blue Diamond) ND and left the real NO DROP items untagged. The "about 90% of looted items are NO
-- DROP" figure noted while building it was the same inversion.
--
-- Fix: loot_value_rows returns `nodrop` in plain polarity (true = NO DROP; NULL when the item is not in the
-- database). Everything downstream (loot_value_grouped, loot_value_by_looter_v3, the page) already reads true as
-- NO DROP, so nothing else changes. Same signature, so CREATE OR REPLACE works. The older v1/v2 functions
-- pass the raw column too, but nothing calls them.
--
-- Idempotent.

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
$$;

comment on function public.loot_value_rows(text, timestamptz) is
  'One row per looted_items line since p_since: base merchant value in copper (exact-name join, lowest id; NULL when unpriced), nodrop in plain polarity (true = NO DROP; the eqemu_items column is inverted), and whether the item went through OpenDKP (auction with a winner or bid within ±6 h, or an award in a raid within ±12 h). Base for /admin/loot.';
