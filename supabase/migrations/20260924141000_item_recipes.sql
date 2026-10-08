-- item_recipes(p_item_id, p_with_parts) — the tradeskill recipes an item takes
-- part in, for /db/item (a member, 2026-09-24: "our pages don't have tradeskill
-- recipes or quests listed"). PQDI shows them as "Component In" / "Result Of".
--
-- ROLE, per recipe, from how the item's entry rows read:
--   made      — successcount > 0, never consumed      (Result Of)
--   used      — componentcount > 0, never returned    (Component In)
--   tool      — consumed AND returned on success: the Smithy Hammer shape, which
--               sits in 777 recipes and comes back from 772 of them. Without
--               this split every hammer recipe read as "makes a Smithy Hammer".
--   container — iscontainer = 1: a portable kit (Collapsible Sewing Kit, 418).
--               World containers (forge, oven, loom) are ids below 75 and are
--               not items — the server's own `some_id < 75` rule in
--               tradeskills.cpp — so they never reach an item page.
--
-- PARTS. Every entry of a recipe (components, results, container) as a compact
-- jsonb array, but only for the first p_with_parts recipes in display order —
-- Water Flask is a component in 744 recipes, and shipping all ~4,500 entry rows
-- with every page view is egress for a list nobody reads to the end. The page
-- asks for parts only where it renders them; /db/recipe/<id> has the full set.
--
-- Mirror data only (eqemu_tradeskill_recipe + _entries, 7,448 / 54,231 rows,
-- weekly sync). Both joins are on indexed columns.

create or replace function public.item_recipes(p_item_id integer, p_with_parts integer default 0)
returns table (
  recipe_id  integer,
  name       text,
  tradeskill integer,
  trivial    integer,
  nofail     boolean,
  role       text,
  parts      jsonb
)
language sql
stable
set search_path = public
as $$
  with mine as (
    select e.recipe_id,
           case when bool_or(e.iscontainer = 1)                                then 'container'
                when bool_or(e.componentcount > 0) and bool_or(e.successcount > 0) then 'tool'
                when bool_or(e.successcount > 0)                               then 'made'
                when bool_or(e.componentcount > 0)                             then 'used'
           end as role
      from public.eqemu_tradeskill_recipe_entries e
     where e.item_id = p_item_id
     group by e.recipe_id
  ),
  ranked as (
    select r.id, r.name, r.tradeskill, r.trivial, coalesce(r.nofail, 0) <> 0 as nofail, m.role,
           row_number() over (
             order by case m.role when 'made' then 0 when 'used' then 1 when 'tool' then 2 else 3 end,
                      r.tradeskill, r.trivial, r.name) as rn
      from mine m
      join public.eqemu_tradeskill_recipe r on r.id = m.recipe_id
     where m.role is not null
  )
  select k.id, k.name, k.tradeskill, k.trivial, k.nofail, k.role,
         case when k.rn <= p_with_parts then (
           select jsonb_agg(jsonb_build_object(
                    'id', e.item_id, 'n', i.name,
                    'c', e.componentcount, 's', e.successcount, 'k', e.iscontainer)
                  order by e.iscontainer desc, e.successcount desc, e.componentcount desc, i.name)
             from public.eqemu_tradeskill_recipe_entries e
             left join public.eqemu_items i
                    on i.id = e.item_id and not (e.iscontainer = 1 and e.item_id < 75)
            where e.recipe_id = k.id)
         end as parts
    from ranked k
   order by k.rn
   limit 1000;
$$;

grant execute on function public.item_recipes(integer, integer) to anon, authenticated;
