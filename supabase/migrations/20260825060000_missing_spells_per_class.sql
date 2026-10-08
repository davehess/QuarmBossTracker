-- character_missing_spells v2 — stop showing one class another class's level.
--
-- Follows 20260825050000 (per-class seed levels) to the surface Lacunanight is
-- reading next: the character spell pages. Same root cause, TWO more instances
-- of it in this one function, and the worse of the two was not the seed:
--
--   scribe_level := coalesce(l.lvl, sd.level)
--
--   • `l.lvl` was `min(spell_level)` over character_spellbook grouped by SPELL
--     NAME ONLY — a guild-wide minimum across every class. Measured on live
--     data: three necromancers hold Shadow Sight at 24 and one shadow knight
--     holds it at 49, so the function returned 24 and EVERY shadow knight was
--     told a level-49 spell was level 24. It also takes precedence over the
--     seed, so it was the value actually displayed.
--   • `sd.level` is the seed minimum — the bug fixed in 20260825050000.
--
-- The spellbook data itself is per-class CORRECT (necro 24 / SK 49 matches the
-- PQDI note exactly). Only the GROUP BY threw the class away. So group by
-- (spell, class) instead, and prefer that observed same-class level: it comes
-- from a real Quarm spellbook export, which beats a pqdi.cc scrape when the
-- two could disagree (see the open Quarm-fork question in DECISIONS-2026-08-25).
--
-- Resolution order for scribe_level, most to least authoritative:
--   1. observed level from a spellbook of the SAME CLASS (live Quarm truth)
--   2. spell_class_levels — the class's level from the PQDI note
--   3. spell_level_seed.level — the cross-class minimum, last resort only
--
-- Also: `i.name like 'Spell: %'` excluded bards entirely (their scrolls are
-- 'Song: %'), so a bard's missing-spell list was silently empty. Same omission
-- pop_spell_needs had.
--
-- Signature is unchanged, so no web change is needed — the page gets correct
-- numbers on the next request.

CREATE OR REPLACE FUNCTION public.character_missing_spells(
  p_guild_id text, p_character text, p_class_bit integer)
RETURNS TABLE(spell_name text, scroll_item_id integer, spell_id integer,
              scribe_level integer, held_by text[], buyable boolean, pop boolean)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  with me as (
    -- The asking character's class, as a space-insensitive key. Fall back to
    -- the bit when the character row is missing, so the function still works
    -- for a character we only know by name.
    select coalesce(
      (select replace(lower(trim(c.class)), ' ', '')
         from characters c
        where c.guild_id = p_guild_id and lower(c.name) = lower(p_character)
        limit 1),
      (select cb.cls from (values
        (1,'warrior'),(2,'cleric'),(4,'paladin'),(8,'ranger'),(16,'shadowknight'),
        (32,'druid'),(64,'monk'),(128,'bard'),(256,'rogue'),(512,'shaman'),
        (1024,'necromancer'),(2048,'wizard'),(4096,'magician'),(8192,'enchanter'),
        (16384,'beastlord')) cb(bit, cls) where cb.bit = p_class_bit)
    ) as class_key
  ),
  scribed as (
    select lower(spell_name) as nm
    from character_spellbook
    where guild_id = p_guild_id and lower(character_name) = lower(p_character)
  ),
  pool as (
    select distinct on (lower(regexp_replace(regexp_replace(i.name, '^(Spell|Song): ', ''), '\*+\s*$', '')))
      regexp_replace(regexp_replace(i.name, '^(Spell|Song): ', ''), '\*+\s*$', '') as spell_name,
      i.id                                                          as scroll_item_id,
      (select s.id from eqemu_spells s
         where lower(s.name) = lower(regexp_replace(regexp_replace(i.name, '^(Spell|Song): ', ''), '\*+\s*$', ''))
         order by s.id limit 1)                                     as spell_id,
      exists(select 1 from eqemu_merchantlist m where m.item = i.id) as buyable
    from eqemu_items i
    where (i.name like 'Spell: %' or i.name like 'Song: %')   -- bards have Songs
      and (i.classes & p_class_bit) > 0
    order by lower(regexp_replace(regexp_replace(i.name, '^(Spell|Song): ', ''), '\*+\s*$', '')),
             (i.name like '%*%'),
             (not exists(select 1 from eqemu_merchantlist m where m.item = i.id)),
             i.id
  ),
  -- Observed levels grouped by (spell, CLASS) — the class is what the old
  -- version threw away.
  levels as (
    select lower(sb.spell_name) as nm,
           replace(lower(trim(c.class)), ' ', '') as class_key,
           min(sb.spell_level) as lvl
    from character_spellbook sb
    join characters c
      on c.guild_id = sb.guild_id and lower(c.name) = lower(sb.character_name)
    where sb.guild_id = p_guild_id and sb.spell_level is not null
    group by 1, 2
  ),
  holders as (
    select lower(regexp_replace(regexp_replace(ci.item_name, '^(Spell|Song): ', ''), '\*+\s*$', '')) as nm,
           array_agg(distinct ci.character_name order by ci.character_name) as names
    from character_inventory ci
    where ci.guild_id = p_guild_id
      and (ci.item_name like 'Spell: %' or ci.item_name like 'Song: %')
    group by 1
  )
  select p.spell_name, p.scroll_item_id, p.spell_id,
         coalesce(l.lvl, scl.level, sd.level)::integer as scribe_level,
         coalesce(h.names, '{}') as held_by,
         p.buyable,
         (coalesce(sp.pop, false)
           or coalesce(l.lvl, scl.level, sd.level, 0) >= 61) as pop
  from pool p
  cross join me
  left join scribed sc on sc.nm = lower(p.spell_name)
  left join levels  l  on l.nm  = lower(p.spell_name) and l.class_key = me.class_key
  left join spell_class_levels scl
                       on scl.spell_id = p.spell_id and scl.class_key = me.class_key
  left join holders h  on h.nm  = lower(p.spell_name)
  left join spell_level_seed sd on sd.spell_id = p.spell_id
  left join eqemu_spell_pop  sp on sp.spell_name_lc = lower(p.spell_name)
  where sc.nm is null
  order by coalesce(l.lvl, scl.level, sd.level) nulls last, p.buyable desc, p.spell_name;
$function$;

GRANT EXECUTE ON FUNCTION character_missing_spells(text, text, integer) TO service_role;
