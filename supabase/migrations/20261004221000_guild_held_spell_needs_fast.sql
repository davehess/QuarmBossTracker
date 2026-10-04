-- 20261004221000_guild_held_spell_needs_fast.sql
-- guild_held_spell_needs: the same answer in about half a second instead of 29 (DECISIONS §155, "found,
-- not fixed"). /admin/spells calls it, and at 29 s it ran past the request timeout, so the page showed
-- "canceling statement due to statement timeout" instead of the list.
--
-- Where the time went: `needers` was a correlated subquery run once per held spell (561 times). Each run
-- called eq_class_bit() on every character (~312k calls; the function is not inlined because of its
-- pinned search_path) and scanned the spellbook on lower(spell_name) with no index (~9.4M row checks).
--
-- Now each character's class bit is computed once (`chars`, MATERIALIZED: without it the planner moves
-- eq_class_bit back into the join filter and the call takes 12 s), the spellbook is reduced once to
-- distinct (character, spell) pairs (`have`), and needers are one grouped join.
--
-- Same signature, same columns, same order. Checked on 2026-10-04 before applying: the old function and
-- this body both return 561 rows with the same md5 over the sorted output. One theoretical difference:
-- the old body could list a character twice if the spellbook held its name in two casings; this one
-- cannot. That does not happen in the data today.
--
-- `set search_path = public` is restated: CREATE OR REPLACE would otherwise drop the pin that
-- 20260718043553_pin_function_search_path.sql added. Grants are kept by CREATE OR REPLACE.
-- Idempotent.

create or replace function public.guild_held_spell_needs(p_guild_id text)
returns table(
  spell_name text, scroll_item_id integer, class_bitmask integer,
  holders text[], needers text[])
language sql stable
set search_path = public
as $$
  with held as (       -- each spell held as a scroll, and who holds it
    select lower(substring(ci.item_name from 8)) as nm,
           array_agg(distinct ci.character_name order by ci.character_name) as names
    from character_inventory ci
    where ci.guild_id = p_guild_id and ci.item_name like 'Spell: %'
    group by 1
  ),
  scrollmeta as (      -- merge scroll variants → one item id + union class bitmask
    select lower(substring(i.name from 8)) as nm,
           min(i.id)                       as scroll_item_id,
           bit_or(i.classes)               as class_bitmask,
           min(substring(i.name from 8))   as spell_name
    from eqemu_items i
    where i.name like 'Spell: %'
    group by 1
  ),
  chars as materialized (   -- spellbook uploaders, class bit computed once each
    select c.name, lower(c.name) as nm_l, eq_class_bit(c.class) as bit
    from characters c
    where c.guild_id = p_guild_id
      and exists (select 1 from character_spellbook s
                  where s.guild_id = p_guild_id and lower(s.character_name) = lower(c.name))
  ),
  have as (            -- every (character, spell) already in a spellbook
    select distinct lower(character_name) as nm_l, lower(spell_name) as nm
    from character_spellbook
    where guild_id = p_guild_id
  ),
  needs as (
    select h.nm, array_agg(c.name order by c.name) as names
    from held h
    join scrollmeta sm on sm.nm = h.nm
    join chars c on (c.bit & sm.class_bitmask) > 0
    where not exists (select 1 from have hv where hv.nm_l = c.nm_l and hv.nm = h.nm)
    group by h.nm
  )
  select sm.spell_name, sm.scroll_item_id, sm.class_bitmask,
         h.names as holders,
         coalesce(n.names, '{}') as needers
  from held h
  join scrollmeta sm on sm.nm = h.nm
  left join needs n on n.nm = h.nm
  order by sm.spell_name;
$$;
