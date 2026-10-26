-- item_alt_sources(p_item_ids) — where an item can be had WITHOUT a drop or a vendor: a quest reward, or a
-- tradeskill recipe. One batch call for the gear upgrade finder (/me/upgrades; the guild lead, 2026-10-26:
-- "yes we should have quest and tradeskill items in as well"). Until now the finder dropped every item whose only
-- source was a quest or a combine (Ton Po's Chestwraps of Composure, the Chestwraps of Enlightenment, the
-- Stonehide Tunic), which is exactly the monk chest the member asked about.
--
-- It composes the two single-item lookups /db/item already uses, as a batch:
--   · quest_scripts_for_item (20260924140000) — the quest-script reward regex, per id;
--   · item_recipes (20260924141000)           — the recipe role split, 'made' only.
-- The shapes are copied, not called, so one round trip answers ~100 ids (the finder asks for the finalists in one go).
--
-- QUESTS. A script is a reward source when the id sits inside the argument list of QuestReward / SummonItem. Only
-- the reward direction is returned (a script that merely TAKES the item in is not a source). Instanced zones copy
-- the same script under another short name, so rows are collapsed to one per (item, NPC, zone long name); at
-- most five per item. zone_expansion rides along so the page can apply the same era rule as drops (the zone's
-- eqemu_zone.expansion); NULL when the script's zone has no eqemu_zone row.
--
-- RECIPES. Role 'made' only: the item is a success result of the recipe and is neither consumed (that is a tool,
-- the Smithy Hammer shape) nor the container. At most three per item, plain trades first. A recipe has no zone, so
-- no expansion is returned: the page uses the item's own required_level as the era proxy. tradeskill 0 and 75 are
-- quest combines (web/lib/tradeskills.ts: the server's always-succeeds branch); for those, and only those, the
-- consumed components come back as jsonb [{id, n, c, s}] (c consumed, s returned) plus the container, because a
-- quest combine's whole point is WHAT to put in WHICH bag. A world container (id < 75) has no item row: the page
-- labels it from WORLD_CONTAINER, so container_name is NULL for those.
--
-- Mirror data only (eqemu_quest_scripts, eqemu_tradeskill_recipe + _entries, eqemu_zone, eqemu_items). Plain
-- invoker rights like the two functions above — Tier 1 catalog data, same audience as the tables read — and the
-- same grants. The array is clipped to 400 ids so a caller cannot ask for the whole catalog.

create or replace function public.item_alt_sources(p_item_ids integer[])
returns table (
  item_id        integer,
  kind           text,       -- 'quest' | 'recipe'
  zone_short     text,       -- quest
  zone_name      text,       -- quest
  zone_expansion integer,    -- quest
  npc_name       text,       -- quest
  recipe_id      integer,    -- recipe
  recipe_name    text,       -- recipe
  tradeskill     integer,    -- recipe
  trivial        integer,    -- recipe
  must_learn     boolean,    -- recipe
  container_id   integer,    -- recipe, quest combines only
  container_name text,       -- recipe, quest combines only (NULL for a world container)
  components     jsonb       -- recipe, quest combines only
)
language sql
stable
set search_path = public
as $$
  with ids as (
    select distinct x as id from unnest(p_item_ids[1:400]) as x where x > 0
  ),
  quest_hits as (
    select i.id as item_id, h.zone_short, h.npc_name
      from ids i
      cross join lateral (
        select s.zone_short, s.npc_name
          from public.eqemu_quest_scripts s
         where s.body ~ ('\m' || i.id || '\M')
           and s.body ~ ('(QuestReward|SummonItem)\s*\([^)]*\m' || i.id || '\M')
      ) h
  ),
  quests as (
    select distinct on (q.item_id, lower(ltrim(q.npc_name, '#')), coalesce(z.long_name, z.short_name, q.zone_short))
           q.item_id,
           q.zone_short,
           coalesce(z.long_name, z.short_name, q.zone_short) as zone_name,
           z.expansion as zone_expansion,
           q.npc_name
      from quest_hits q
      left join public.eqemu_zone z on z.short_name = q.zone_short
     order by q.item_id, lower(ltrim(q.npc_name, '#')), coalesce(z.long_name, z.short_name, q.zone_short), q.zone_short
  ),
  quests_kept as (
    select k.*, row_number() over (partition by k.item_id order by k.zone_name, k.npc_name) as rn
      from quests k
  ),
  made as (
    select e.item_id, e.recipe_id
      from public.eqemu_tradeskill_recipe_entries e
     where e.item_id in (select id from ids)
     group by e.item_id, e.recipe_id
    having bool_or(coalesce(e.successcount, 0) > 0)
       and not bool_or(coalesce(e.componentcount, 0) > 0)
       and not bool_or(coalesce(e.iscontainer, 0) = 1)
  ),
  recipes_kept as (
    select m.item_id, r.id as recipe_id, r.name as recipe_name, r.tradeskill, r.trivial,
           coalesce(r.must_learn, 0) <> 0 as must_learn,
           row_number() over (
             partition by m.item_id
             order by (coalesce(r.tradeskill, 0) in (0, 75)), coalesce(r.must_learn, 0), r.trivial, r.id) as rn
      from made m
      join public.eqemu_tradeskill_recipe r on r.id = m.recipe_id
  )
  select q.item_id, 'quest'::text, q.zone_short, q.zone_name, q.zone_expansion, q.npc_name,
         null::integer, null::text, null::integer, null::integer, null::boolean,
         null::integer, null::text, null::jsonb
    from quests_kept q
   where q.rn <= 5
  union all
  select r.item_id, 'recipe'::text, null::text, null::text, null::integer, null::text,
         r.recipe_id, r.recipe_name, r.tradeskill, r.trivial, r.must_learn,
         c.container_id, c.container_name, p.components
    from recipes_kept r
    left join lateral (
      select e.item_id as container_id, ci.name as container_name
        from public.eqemu_tradeskill_recipe_entries e
        left join public.eqemu_items ci on ci.id = e.item_id and e.item_id >= 75
       where e.recipe_id = r.recipe_id
         and e.iscontainer = 1
         and coalesce(r.tradeskill, 0) in (0, 75)
       order by (e.item_id >= 75) desc, e.item_id
       limit 1
    ) c on true
    left join lateral (
      select jsonb_agg(jsonb_build_object('id', x.item_id, 'n', x.name, 'c', x.consumed, 's', x.returned)
                       order by x.consumed desc, x.name) as components
        from (
          select e.item_id, ei.name,
                 sum(coalesce(e.componentcount, 0)) as consumed,
                 sum(coalesce(e.successcount, 0))   as returned
            from public.eqemu_tradeskill_recipe_entries e
            left join public.eqemu_items ei on ei.id = e.item_id
           where e.recipe_id = r.recipe_id
             and coalesce(e.iscontainer, 0) = 0
             and coalesce(r.tradeskill, 0) in (0, 75)
           group by e.item_id, ei.name
          having sum(coalesce(e.componentcount, 0)) > 0
        ) x
    ) p on true
   where r.rn <= 3
   order by 1, 2
   limit 2000;
$$;

grant execute on function public.item_alt_sources(integer[]) to anon, authenticated;
