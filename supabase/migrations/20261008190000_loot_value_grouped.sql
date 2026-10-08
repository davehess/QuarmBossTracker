-- 20261008190000_loot_value_grouped.sql
-- /admin/loot, round three: one row per looter + item with a count and a row total, paged in the database.
--
-- The guild lead, 2026-10-08: "that page … takes forever to load. bringing in a full list of loot on there isn't
-- great. it lags out my machine just to open it. Please paginate, and give distinct looter+item+count rows
-- instead, and totals for that row."
--
-- Two costs, both fixed here:
--   * the browser drew up to 1,000 single-loot rows; now the page asks for one page (50) of GROUPED rows;
--   * the DKP test ran two EXISTS per looted row, and opendkp_loot has no item_name index, so 90 days took
--     2.2 s. Now the DKP events in the window (auctions with a winner or bid, awards) are collected ONCE into a
--     small set, and only rows whose item name appears there are tested against it. Same rule as
--     20261008180000_loot_value_dkp.sql: same item name, auction within ±6 h or award in a raid within ±12 h.
--
-- loot_value_rows(): the shared per-row base (price by exact name, lowest id; nodrop; dkp).
-- loot_value_grouped(): looter + item groups, sorted and paged, with the total group count on every row.
-- loot_value_by_looter_v3(): the per-character totals, on the faster base. Totals leave DKP rows out.
--
-- v1 / v2 stay (a DROP FUNCTION hung on production on 2026-10-08); nothing calls them after this ships.
-- Idempotent: CREATE OR REPLACE.

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
  -- Every DKP event that could touch a row in the window, once: (item, time, slack).
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
    p.price::bigint, p.nodrop,
    exists (
      select 1 from d
      where d.item_name = l.item_name
        and d.t between l.looted_at - d.slack and l.looted_at + d.slack
    ) as dkp
  from l
  left join p on p.name = l.item_name
$$;

comment on function public.loot_value_rows(text, timestamptz) is
  'One row per looted_items line since p_since: base merchant value in copper (exact-name join, lowest id; NULL when unpriced), NO DROP, and whether the item went through OpenDKP (auction with a winner or bid within ±6 h, or an award in a raid within ±12 h). Base for /admin/loot.';

create or replace function public.loot_value_grouped(
  p_guild_id text,
  p_since    timestamptz,
  p_sort     text default 'total',
  p_limit    int  default 50,
  p_offset   int  default 0
)
returns table (
  looter_character text,
  item_name        text,
  looted           bigint,
  dkp_count        bigint,
  unit_cp          bigint,
  total_cp         bigint,
  nodrop           boolean,
  zone             text,
  last_looted_at   timestamptz,
  total_groups     bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with g as (
    select
      (array_agg(r.looter_character order by r.looted_at desc))[1] as looter_character,
      r.looter_lower,
      r.item_name,
      count(*)::bigint                                   as looted,
      (count(*) filter (where r.dkp))::bigint            as dkp_count,
      max(r.price)::bigint                               as unit_cp,
      coalesce(sum(r.price) filter (where not r.dkp), 0)::bigint as total_cp,
      bool_or(r.nodrop)                                  as nodrop,
      (array_agg(r.zone order by r.looted_at desc))[1]   as zone,
      max(r.looted_at)                                   as last_looted_at
    from loot_value_rows(p_guild_id, p_since) r
    group by r.looter_lower, r.item_name
  )
  select g.looter_character, g.item_name, g.looted, g.dkp_count, g.unit_cp, g.total_cp, g.nodrop, g.zone,
         g.last_looted_at, count(*) over ()::bigint
  from g
  order by
    case when p_sort = 'unit'   then g.unit_cp end desc nulls last,
    case when p_sort = 'count'  then g.looted end desc,
    case when p_sort = 'recent' then g.last_looted_at end desc,
    case when p_sort = 'looter' then g.looter_lower end asc,
    case when p_sort = 'item'   then g.item_name end asc,
    g.total_cp desc, g.unit_cp desc nulls last, g.looted desc, g.looter_lower, g.item_name
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

comment on function public.loot_value_grouped(text, timestamptz, text, int, int) is
  'Looted items since p_since grouped by looter + item: count, DKP count, unit value, row total (non-DKP lines only), NO DROP, latest zone and time, and total_groups (the group count, for paging). p_sort total|unit|count|recent|looter|item; p_limit capped at 200. Feeds /admin/loot.';

create or replace function public.loot_value_by_looter_v3(
  p_guild_id text,
  p_since    timestamptz
)
returns table (
  looter_character text,
  items            bigint,
  value_cp         bigint,
  nodrop_items     bigint,
  dkp_items        bigint,
  top_item         text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (array_agg(r.looter_character order by r.looted_at desc))[1],
    count(*)::bigint,
    coalesce(sum(r.price) filter (where not r.dkp), 0)::bigint,
    (count(*) filter (where r.nodrop))::bigint,
    (count(*) filter (where r.dkp))::bigint,
    (array_agg(r.item_name order by r.price desc, r.looted_at desc) filter (where r.price is not null and not r.dkp))[1]
  from loot_value_rows(p_guild_id, p_since) r
  group by r.looter_lower
  order by coalesce(sum(r.price) filter (where not r.dkp), 0) desc, count(*) desc, r.looter_lower
$$;

comment on function public.loot_value_by_looter_v3(text, timestamptz) is
  'Per looter since p_since over ALL rows: items, base value in copper of the NON-DKP items, NO DROP count, DKP count, most valuable non-DKP item. loot_value_by_looter_v2 on the faster loot_value_rows base. Feeds /admin/loot.';

revoke all on function public.loot_value_rows(text, timestamptz) from public, anon, authenticated;
grant execute on function public.loot_value_rows(text, timestamptz) to service_role;
revoke all on function public.loot_value_grouped(text, timestamptz, text, int, int) from public, anon, authenticated;
grant execute on function public.loot_value_grouped(text, timestamptz, text, int, int) to service_role;
revoke all on function public.loot_value_by_looter_v3(text, timestamptz) from public, anon, authenticated;
grant execute on function public.loot_value_by_looter_v3(text, timestamptz) to service_role;
