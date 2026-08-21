-- Who still needs which PoP spell (Hitya 2026-08-20: "make a section on the
-- pop page for spells that mains need if they've submitted … Whoever gets to
-- that level first should get first dibs on those spells so prioritize high
-- level to low").
--
-- Reuses the shape character_missing_spells already proved: a spell scroll is
-- an eqemu_items row named 'Spell: %', and its `classes` bitmask says who can
-- scribe it. Restricted to PoP levels (61-65 from spell_level_seed) and to
-- MAINS who have actually submitted a spellbook — without a book we cannot
-- tell "doesn't have it" from "we don't know", and guessing would put someone
-- on a list they don't belong on.
--
-- Ordering IS the feature: character level descending, so whoever reached the
-- level first sits at the top of the queue for that spell.
CREATE OR REPLACE FUNCTION pop_spell_needs(p_guild_id text)
RETURNS TABLE(
  spell_name text, spell_id integer, scroll_item_id integer, spell_level integer,
  character_name text, char_class text, char_level integer, held_by text[]
)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  WITH class_bits(cls, bit) AS (VALUES
    ('warrior',1),('cleric',2),('paladin',4),('ranger',8),('shadow knight',16),
    ('shadowknight',16),('druid',32),('monk',64),('bard',128),('rogue',256),
    ('shaman',512),('necromancer',1024),('wizard',2048),('magician',4096),
    ('enchanter',8192),('beastlord',16384)
  ),
  mains AS (
    SELECT c.name, c.class, cb.bit,
           (SELECT max(w.level) FROM who_directory w
             WHERE lower(w.character) = lower(c.name)) AS lvl
    FROM characters c
    JOIN class_bits cb ON cb.cls = lower(trim(c.class))
    WHERE c.guild_id = p_guild_id
      AND COALESCE(c.deleted, false) = false
      AND COALESCE(c.exclude_from_stats, false) = false
      AND (c.main_name IS NULL OR lower(c.main_name) = lower(c.name))
      AND EXISTS (SELECT 1 FROM character_spellbook sb
                   WHERE sb.guild_id = p_guild_id
                     AND lower(sb.character_name) = lower(c.name))
  ),
  pool AS (
    SELECT DISTINCT ON (lower(regexp_replace(substring(i.name from 8), '\*+\s*$', '')))
      regexp_replace(substring(i.name from 8), '\*+\s*$', '') AS spell_name,
      i.id      AS scroll_item_id,
      i.classes AS class_bits,
      (SELECT s.id FROM eqemu_spells s
        WHERE lower(s.name) = lower(regexp_replace(substring(i.name from 8), '\*+\s*$', ''))
        ORDER BY s.id LIMIT 1) AS spell_id
    FROM eqemu_items i
    WHERE i.name LIKE 'Spell: %'
    ORDER BY lower(regexp_replace(substring(i.name from 8), '\*+\s*$', '')),
             (i.name LIKE '%*%'), i.id
  ),
  scrolls AS (
    SELECT p.*, sd.level AS spell_level
    FROM pool p
    LEFT JOIN spell_level_seed sd ON sd.spell_id = p.spell_id
  ),
  holders AS (
    SELECT lower(regexp_replace(substring(ci.item_name from 8), '\*+\s*$', '')) AS nm,
           array_agg(DISTINCT ci.character_name ORDER BY ci.character_name) AS names
    FROM character_inventory ci
    WHERE ci.guild_id = p_guild_id AND ci.item_name LIKE 'Spell: %'
    GROUP BY 1
  )
  SELECT s.spell_name, s.spell_id, s.scroll_item_id, s.spell_level,
         m.name, m.class, m.lvl, COALESCE(h.names, '{}')
  FROM scrolls s
  JOIN mains m ON (s.class_bits & m.bit) > 0
  LEFT JOIN holders h ON h.nm = lower(s.spell_name)
  WHERE s.spell_level BETWEEN 61 AND 65
    AND NOT EXISTS (
      SELECT 1 FROM character_spellbook sb
       WHERE sb.guild_id = p_guild_id
         AND lower(sb.character_name) = lower(m.name)
         AND lower(sb.spell_name) = lower(s.spell_name))
  ORDER BY m.lvl DESC NULLS LAST, s.spell_level DESC, s.spell_name, m.name
$function$;
