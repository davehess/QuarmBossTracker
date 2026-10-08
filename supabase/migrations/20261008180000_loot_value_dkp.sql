-- 20261008180000_loot_value_dkp.sql
-- /admin/loot: an item that went through DKP is listed but left out of the value totals.
--
-- The guild lead, 2026-10-08: "If something has a DKP bid associated with it, don't count that in the totals."
--
-- `looted_items` carries no auction link, so a looted row is DKP when the same item name was:
--   * auctioned in OpenDKP (opendkp_auctions) with a winner or at least one bid, created / awarded / ended
--     within 6 hours either side of the loot line (auctions run during the raid the item dropped in), or
--   * awarded in OpenDKP loot (opendkp_loot) for a raid dated within 12 hours either side (a raid's ts is
--     when the raid was opened, so an award late in a long night still lands).
-- Measured over 30 days (2026-10-08): 24,460 looted rows, 127 match an auction, 23 an award.
--
-- New `_v2` functions: loot_value_items_v2 adds `dkp boolean`; loot_value_by_looter_v2's value_cp counts only
-- non-DKP rows and it adds `dkp_items`. The return types change, which CREATE OR REPLACE cannot do, and a DROP
-- FUNCTION on production hung past every client timeout on 2026-10-08 (a CREATE returned at once) — so the
-- v1 functions from 20261008170000 stay in place, unused, and /admin/loot calls the v2 pair. Everything else
-- is 20261008170000_loot_value_rpcs.sql unchanged: exact-name price join, lowest id per name, the 2000-row
-- cap, SECURITY INVOKER, service_role only.
--
-- Idempotent: CREATE OR REPLACE.

create or replace function public.loot_value_items_v2(
  p_guild_id text,
  p_since    timestamptz,
  p_limit    int default 500
)
returns table (
  looted_at        timestamptz,
  looter_character text,
  item_name        text,
  zone             text,
  value_cp         bigint,
  nodrop           boolean,
  dkp              boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with l as (
    select li.looted_at, li.looter_character, li.item_name, li.zone
    from looted_items li
    where li.guild_id = p_guild_id
      and li.looted_at >= p_since
  ),
  p as (
    select distinct on (i.name) i.name, i.price, i.nodrop
    from eqemu_items i
    where i.name in (select distinct l.item_name from l)
    order by i.name, i.id
  )
  select l.looted_at, l.looter_character, l.item_name, l.zone, p.price::bigint, p.nodrop,
    (
      exists (
        select 1 from opendkp_auctions a
        where a.item_name = l.item_name
          and coalesce(a.created_at, a.awarded_at, a.end_at)
              between l.looted_at - interval '6 hours' and l.looted_at + interval '6 hours'
          and (a.winner is not null or exists (select 1 from opendkp_auction_bids b where b.auction_id = a.auction_id))
      )
      or exists (
        select 1 from opendkp_loot o join opendkp_raids r on r.raid_id = o.raid_id
        where o.item_name = l.item_name
          and r.ts between l.looted_at - interval '12 hours' and l.looted_at + interval '12 hours'
      )
    ) as dkp
  from l
  left join p on p.name = l.item_name
  order by p.price desc nulls last, l.looted_at desc
  limit least(greatest(coalesce(p_limit, 500), 1), 2000)
$$;

comment on function public.loot_value_items_v2(text, timestamptz, int) is
  'Looted items since p_since with base merchant value in copper (exact-name join, lowest id per name; NULL when unpriced) and whether the item went through OpenDKP (auction with a winner or bid within ±6 h, or an award in a raid within ±12 h). Highest value first; p_limit capped at 2000. Feeds /admin/loot.';

create or replace function public.loot_value_by_looter_v2(
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
  with l as (
    select li.looter_lower, li.looter_character, li.item_name, li.looted_at
    from looted_items li
    where li.guild_id = p_guild_id
      and li.looted_at >= p_since
  ),
  p as (
    select distinct on (i.name) i.name, i.price, i.nodrop
    from eqemu_items i
    where i.name in (select distinct l.item_name from l)
    order by i.name, i.id
  ),
  j as (
    select l.looter_lower, l.looter_character, l.item_name, l.looted_at, p.price, p.nodrop,
      (
        exists (
          select 1 from opendkp_auctions a
          where a.item_name = l.item_name
            and coalesce(a.created_at, a.awarded_at, a.end_at)
                between l.looted_at - interval '6 hours' and l.looted_at + interval '6 hours'
            and (a.winner is not null or exists (select 1 from opendkp_auction_bids b where b.auction_id = a.auction_id))
        )
        or exists (
          select 1 from opendkp_loot o join opendkp_raids r on r.raid_id = o.raid_id
          where o.item_name = l.item_name
            and r.ts between l.looted_at - interval '12 hours' and l.looted_at + interval '12 hours'
        )
      ) as dkp
    from l
    left join p on p.name = l.item_name
  )
  select
    (array_agg(j.looter_character order by j.looted_at desc))[1],
    count(*)::bigint,
    coalesce(sum(j.price) filter (where not j.dkp), 0)::bigint,
    (count(*) filter (where j.nodrop))::bigint,
    (count(*) filter (where j.dkp))::bigint,
    (array_agg(j.item_name order by j.price desc, j.looted_at desc) filter (where j.price is not null and not j.dkp))[1]
  from j
  group by j.looter_lower
  order by coalesce(sum(j.price) filter (where not j.dkp), 0) desc, count(*) desc, j.looter_lower
$$;

comment on function public.loot_value_by_looter_v2(text, timestamptz) is
  'Per looter since p_since over ALL rows in the window: items looted, total base merchant value in copper of the NON-DKP items, NO DROP count, DKP count, and the most valuable non-DKP item. Grouped on the lowercased name. Feeds /admin/loot.';

revoke all on function public.loot_value_items_v2(text, timestamptz, int) from public, anon, authenticated;
grant execute on function public.loot_value_items_v2(text, timestamptz, int) to service_role;
revoke all on function public.loot_value_by_looter_v2(text, timestamptz) from public, anon, authenticated;
grant execute on function public.loot_value_by_looter_v2(text, timestamptz) to service_role;
