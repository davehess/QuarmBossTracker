-- Add a `pop` flag to character_missing_spells so the spells page can mark
-- Planes-of-Power spells (unobtainable until the 2026-10-01 unlock).
--
-- "PoP spell" = its ONLY catalog sources are PoP zones (expansion 4): sold in a
-- PoP zone and/or dropped by a PoP-zone NPC, with NO pre-PoP (expansion 0..3)
-- source. This matches the owner's ask: "only sold in Plane of Knowledge or
-- dropped during that expansion." Detection maps an item to its source zone via
-- the EQEmu id-encodes-zone convention (merchantid/1000 and npc_id/1000 =
-- eqemu_zone.zone_id) — see docs/eqemu-catalog-cheatsheet.md.
--
-- The source→expansion computation walks the whole loottable tree (~1.3s), so
-- it is PRECOMPUTED into eqemu_spell_pop rather than run per page load. The
-- classification is catalog-stable (only changes with the weekly eqemu sync,
-- and PoP content is locked till October), so a materialized lookup is safe.
-- Refresh with SELECT refresh_eqemu_spell_pop(); (wire into sync-quarm.yml when
-- convenient — until then it's stable enough to leave).
--
-- Precision is high, recall partial: most level 61-65 scrolls have no
-- merchant/drop row in the mirror at all, so they can't be source-classified —
-- the RPC also ORs in a known scribe level >= 61 (Luclin capped at 60), and
-- officer-seeded levels remain the manual fallback.

CREATE TABLE IF NOT EXISTS eqemu_spell_pop (
  spell_name_lc text PRIMARY KEY,
  pop           boolean     NOT NULL DEFAULT false,
  refreshed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION refresh_eqemu_spell_pop() RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  DELETE FROM eqemu_spell_pop;
  INSERT INTO eqemu_spell_pop (spell_name_lc, pop, refreshed_at)
  WITH scroll AS (
    SELECT id, lower(regexp_replace(substring(name from 8), '\*+\s*$', '')) AS nm
    FROM eqemu_items WHERE name LIKE 'Spell: %'
  ),
  src AS (
    SELECT s.nm, z.expansion AS exp
    FROM scroll s
      JOIN eqemu_merchantlist m ON m.item = s.id
      JOIN eqemu_zone z ON z.zone_id = (m.merchantid / 1000)
    UNION ALL
    SELECT s.nm, z.expansion
    FROM scroll s
      JOIN eqemu_npc_drops d ON d.item_id = s.id
      JOIN eqemu_zone z ON z.zone_id = (d.npc_id / 1000)
  )
  SELECT nm,
         (bool_or(exp = 4) AND NOT bool_or(exp BETWEEN 0 AND 3)) AS pop,
         now()
  FROM src
  GROUP BY nm;
END;
$fn$;

SELECT refresh_eqemu_spell_pop();

-- Return type changes (adds `pop`), so DROP + CREATE rather than REPLACE.
DROP FUNCTION IF EXISTS character_missing_spells(text, text, integer);
CREATE FUNCTION public.character_missing_spells(p_guild_id text, p_character text, p_class_bit integer)
 RETURNS TABLE(spell_name text, scroll_item_id integer, spell_id integer, scribe_level integer, held_by text[], buyable boolean, pop boolean)
 LANGUAGE sql
 STABLE
AS $function$
  with scribed as (
    select lower(spell_name) as nm
    from character_spellbook
    where guild_id = p_guild_id and lower(character_name) = lower(p_character)
  ),
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
             (i.name like '%*%'),
             (not exists(select 1 from eqemu_merchantlist m where m.item = i.id)),
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
         coalesce(l.lvl, sd.level)::integer as scribe_level,
         coalesce(h.names, '{}') as held_by,
         p.buyable,
         (coalesce(sp.pop, false) or coalesce(l.lvl, sd.level, 0) >= 61) as pop
  from pool p
  left join scribed sc on sc.nm = lower(p.spell_name)
  left join levels  l  on l.nm  = lower(p.spell_name)
  left join holders h  on h.nm  = lower(p.spell_name)
  left join spell_level_seed sd on sd.spell_id = p.spell_id
  left join eqemu_spell_pop  sp on sp.spell_name_lc = lower(p.spell_name)
  where sc.nm is null
  order by coalesce(l.lvl, sd.level) nulls last, p.buyable desc, p.spell_name;
$function$;
