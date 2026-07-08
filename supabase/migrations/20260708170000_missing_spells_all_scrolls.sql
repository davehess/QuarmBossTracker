-- Missing-spells rework (Uilnayar 2026-07-08):
--   1. "Spell: Courage*" and other trailing-'*' EQEmu duplicate items showed
--      as phantom missing spells — the '*' meant they never matched the
--      scribed "Courage". Strip a trailing '*' so junk rows collapse into the
--      real spell and match what's actually scribed.
--   2. The list was scoped to VENDOR-BUYABLE scrolls only, so class spells you
--      have to quest/drop for (Divine Intervention L60, Mark of Karn L56, …)
--      never appeared as missing. Now include EVERY class spell scroll and
--      return a `buyable` flag; the page links non-buyable ones to PQDI so you
--      can see where to get them.
--
-- Signature changes (adds `buyable`), so DROP + CREATE rather than REPLACE.

DROP FUNCTION IF EXISTS public.character_missing_spells(text, text, integer);

CREATE FUNCTION public.character_missing_spells(p_guild_id text, p_character text, p_class_bit integer)
RETURNS TABLE(spell_name text, scroll_item_id integer, spell_id integer,
              scribe_level integer, held_by text[], buyable boolean)
LANGUAGE sql STABLE
AS $function$
  with scribed as (
    select lower(spell_name) as nm
    from character_spellbook
    where guild_id = p_guild_id and lower(character_name) = lower(p_character)
  ),
  -- Every spell SCROLL for the class, buyable or not. A trailing '*' on the
  -- item name is an EQEmu duplicate-item artifact ("Spell: Courage*"); strip
  -- it so the junk row collapses into the real spell. When a spell has several
  -- scroll items, keep the merchant-sold, non-asterisk variant.
  pool as (
    select distinct on (lower(regexp_replace(substring(i.name from 8), '\*+\s*$', '')))
      regexp_replace(substring(i.name from 8), '\*+\s*$', '')       as spell_name,
      i.id                                                          as scroll_item_id,
      (select s.id from eqemu_spells s
         where lower(s.name) = lower(regexp_replace(substring(i.name from 8), '\*+\s*$', ''))
         order by s.id limit 1)                                     as spell_id,
      exists(select 1 from eqemu_merchantlist m where m.item = i.id) as buyable
    from eqemu_items i
    where i.name like 'Spell: %'
      and (i.classes & p_class_bit) > 0
    order by lower(regexp_replace(substring(i.name from 8), '\*+\s*$', '')),
             (i.name like '%*%'),                                            -- non-asterisk first
             (not exists(select 1 from eqemu_merchantlist m where m.item = i.id)),  -- merchant-sold first
             i.id
  ),
  levels as (
    select lower(spell_name) as nm, min(spell_level) as lvl
    from character_spellbook
    where guild_id = p_guild_id and spell_level is not null
    group by lower(spell_name)
  ),
  holders as (
    select lower(regexp_replace(substring(ci.item_name from 8), '\*+\s*$', '')) as nm,
           array_agg(distinct ci.character_name order by ci.character_name) as names
    from character_inventory ci
    where ci.guild_id = p_guild_id and ci.item_name like 'Spell: %'
    group by lower(regexp_replace(substring(ci.item_name from 8), '\*+\s*$', ''))
  )
  select p.spell_name, p.scroll_item_id, p.spell_id,
         l.lvl::integer as scribe_level,
         coalesce(h.names, '{}') as held_by,
         p.buyable
  from pool p
  left join scribed sc on sc.nm = lower(p.spell_name)
  left join levels  l  on l.nm  = lower(p.spell_name)
  left join holders h  on h.nm  = lower(p.spell_name)
  where sc.nm is null
  order by l.lvl nulls last, p.buyable desc, p.spell_name;
$function$;
