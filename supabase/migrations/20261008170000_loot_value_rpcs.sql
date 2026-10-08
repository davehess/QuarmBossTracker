-- Loot by value for /admin/loot (the guild lead, 2026-10-08: "make an admin page with loot, sortable by
-- highest value. note at the top that who looted it is not always the person that ends up with it").
--
-- looted_items holds one row per "You have looted" line a raider's Mimic saw for itself. Value is the
-- item's base merchant price (eqemu_items.price, in COPPER) joined by EXACT name.
--
-- Why the join is written this way:
--   * Only exact name equality is indexed on eqemu_items (btree text_pattern_ops on name). A
--     lower(name) join cannot use it and times out, so the match is on the stored name as-is.
--   * Names are not unique across item ids, so the price CTE keeps the lowest id per name.
--   * The price CTE is built from the DISTINCT names in the window first, so the item table is probed
--     once per name rather than once per looted row.
--
-- Both functions are read-only, SECURITY INVOKER, and callable by the service role only (the officer
-- page reads them through the service-role client). Idempotent: create or replace.

create or replace function public.loot_value_items(
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
  nodrop           boolean
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
  select l.looted_at, l.looter_character, l.item_name, l.zone, p.price::bigint, p.nodrop
  from l
  left join p on p.name = l.item_name
  order by p.price desc nulls last, l.looted_at desc
  limit least(greatest(coalesce(p_limit, 500), 1), 2000)
$$;

comment on function public.loot_value_items(text, timestamptz, int) is
  'Looted items since p_since with their base merchant value in copper (exact-name join to eqemu_items, lowest id per name; NULL when unpriced), highest value first, newest first within a value. p_limit is capped at 2000. Feeds /admin/loot.';

create or replace function public.loot_value_by_looter(
  p_guild_id text,
  p_since    timestamptz
)
returns table (
  looter_character text,
  items            bigint,
  value_cp         bigint,
  nodrop_items     bigint,
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
    select l.looter_lower, l.looter_character, l.item_name, l.looted_at, p.price, p.nodrop
    from l
    left join p on p.name = l.item_name
  )
  select
    (array_agg(j.looter_character order by j.looted_at desc))[1],
    count(*)::bigint,
    coalesce(sum(j.price), 0)::bigint,
    (count(*) filter (where j.nodrop))::bigint,
    (array_agg(j.item_name order by j.price desc, j.looted_at desc) filter (where j.price is not null))[1]
  from j
  group by j.looter_lower
  order by coalesce(sum(j.price), 0) desc, count(*) desc, j.looter_lower
$$;

comment on function public.loot_value_by_looter(text, timestamptz) is
  'Per looter since p_since over ALL rows in the window: items looted, total base merchant value in copper, how many were NO DROP, and the most valuable item (NULL when none is priced). Grouped on the lowercased name. Feeds /admin/loot.';

revoke all on function public.loot_value_items(text, timestamptz, int) from public, anon, authenticated;
grant execute on function public.loot_value_items(text, timestamptz, int) to service_role;
revoke all on function public.loot_value_by_looter(text, timestamptz) from public, anon, authenticated;
grant execute on function public.loot_value_by_looter(text, timestamptz) to service_role;
