-- pop_spell_needs: a spell in your book is matched to its scroll by the name KEY and the scroll aliases, like
-- character_missing_spells has done since 20261008200000 (the guild lead, 2026-10-23: "Why is this missing several of my
-- spells? … primarily when the spell and the scroll are slightly different").
--
-- The function compared lower(spellbook name) = lower(scroll name), so every scroll whose name differs from its spell only
-- by an apostrophe / backtick or a typo read as still needed, for every character, and its spell_id (looked up the same way)
-- came back null, which is why those rows showed "—" instead of what the spell does. Seen on a bard's book:
--   scroll "Song: Tuyen's Chant of Ice"   / spell "Tuyen`s Chant of Ice"      (apostrophe / backtick)
--   scroll "Song: Saryn's Scream of Pain" / spell "Saryrn's Scream of Pain"   (typo, already in spell_scroll_aliases)
-- Now: the scroll's spell key is its alias if it has one, else spell_name_key(scroll name); the spell id, the "already in
-- the book" test and the holders all compare keys. Output columns and order are unchanged.
--
-- Also corrects one alias row: the scroll "Invisibility vs Undead" (item 15235) teaches "Invisibility versus Undead"
-- (spell 235), not "Invisibility to Undead" (spell 1420, which has its own scroll, item 30420). The old row told everyone
-- holding Invisibility versus Undead that they still needed it (the guild lead: "i think invis vs undead is a problem too").
--
-- Idempotent.

update public.spell_scroll_aliases
   set spell_key = public.spell_name_key('Invisibility versus Undead'),
       note = 'vs / versus (item 15235 teaches spell 235; "Invisibility to Undead" is spell 1420 with its own scroll)'
 where scroll_key = public.spell_name_key('Invisibility vs Undead');

create or replace function public.pop_spell_needs(p_guild_id text)
 returns table(spell_name text, spell_id integer, scroll_item_id integer, spell_level integer, tier text,
               character_name text, char_class text, char_level integer, held_by text[], is_main boolean)
 language sql
 stable
 set search_path to 'public'
as $function$
  WITH class_bits(cls, bit) AS (VALUES
    ('warrior',1),('cleric',2),('paladin',4),('ranger',8),('shadow knight',16),
    ('shadowknight',16),('druid',32),('monk',64),('bard',128),('rogue',256),
    ('shaman',512),('necromancer',1024),('wizard',2048),('magician',4096),
    ('enchanter',8192),('beastlord',16384)
  ),
  eligible AS (
    SELECT c.name, c.class, cb.bit,
           replace(lower(trim(c.class)), ' ', '') AS class_key,
           (c.main_name IS NULL OR lower(c.main_name) = lower(c.name)) AS is_main,
           wl.level AS lvl
    FROM characters c
    JOIN class_bits cb ON cb.cls = lower(trim(c.class))
    LEFT JOIN LATERAL (
      SELECT o.level
      FROM who_observations o
      WHERE lower(o."character") = lower(c.name)
        AND o.level IS NOT NULL
      ORDER BY o.observed_at DESC
      LIMIT 1
    ) wl ON true
    WHERE c.guild_id = p_guild_id
      AND COALESCE(c.deleted, false) = false
      AND COALESCE(c.exclude_from_stats, false) = false
      AND EXISTS (SELECT 1 FROM character_spellbook sb
                   WHERE sb.guild_id = p_guild_id
                     AND lower(sb.character_name) = lower(c.name))
  ),
  -- One spell id per name key (the lowest, as before).
  spell_keys AS (
    SELECT DISTINCT ON (spell_name_key(s.name)) spell_name_key(s.name) AS k, s.id
    FROM eqemu_spells s
    ORDER BY spell_name_key(s.name), s.id
  ),
  scroll_names AS (
    SELECT i.id, i.classes, i.name,
           regexp_replace(regexp_replace(i.name, '^(Spell|Song): ', ''), '\*+\s*$', '') AS bare
    FROM eqemu_items i
    WHERE i.name LIKE 'Spell: %' OR i.name LIKE 'Song: %'
  ),
  pool AS (
    SELECT DISTINCT ON (lower(sn.bare))
      sn.bare AS spell_name,
      sn.id   AS scroll_item_id,
      sn.classes AS class_bits,
      COALESCE(a.spell_key, spell_name_key(sn.bare)) AS skey
    FROM scroll_names sn
    LEFT JOIN spell_scroll_aliases a ON a.scroll_key = spell_name_key(sn.bare)
    ORDER BY lower(sn.bare), (sn.name LIKE '%*%'), sn.id
  ),
  scrolls AS (
    SELECT p.*, sk.id AS spell_id, sd.level AS seed_level
    FROM pool p
    LEFT JOIN spell_keys sk ON sk.k = p.skey
    LEFT JOIN spell_level_seed sd ON sd.spell_id = sk.id
  ),
  book AS (
    SELECT DISTINCT lower(sb.character_name) AS cn, spell_name_key(sb.spell_name) AS k
    FROM character_spellbook sb
    WHERE sb.guild_id = p_guild_id
  ),
  holders AS (
    SELECT COALESCE(a.spell_key, spell_name_key(h.bare)) AS skey,
           array_agg(DISTINCT h.character_name ORDER BY h.character_name) AS names
    FROM (
      SELECT ci.character_name,
             regexp_replace(regexp_replace(ci.item_name, '^(Spell|Song): ', ''), '\*+\s*$', '') AS bare
      FROM character_inventory ci
      WHERE ci.guild_id = p_guild_id
        AND (ci.item_name LIKE 'Spell: %' OR ci.item_name LIKE 'Song: %')
    ) h
    LEFT JOIN spell_scroll_aliases a ON a.scroll_key = spell_name_key(h.bare)
    GROUP BY 1
  )
  SELECT s.spell_name, s.spell_id, s.scroll_item_id,
         COALESCE(scl.level, s.seed_level) AS spell_level,
         pp.tier,
         m.name, m.class, m.lvl, COALESCE(h.names, '{}'),
         m.is_main
  FROM scrolls s
  JOIN eligible m ON (s.class_bits & m.bit) > 0
  LEFT JOIN spell_class_levels scl
         ON scl.spell_id = s.spell_id AND scl.class_key = m.class_key
  LEFT JOIN pop_parchment_pools pp
         ON pp.scroll_item_id = s.scroll_item_id
        AND replace(lower(pp.class_name), ' ', '') = m.class_key
  LEFT JOIN holders h ON h.skey = s.skey
  WHERE (COALESCE(scl.level, s.seed_level) BETWEEN 61 AND 65 OR pp.tier IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM book b
       WHERE b.cn = lower(m.name)
         AND b.k = s.skey)
  ORDER BY m.lvl DESC NULLS LAST, COALESCE(scl.level, s.seed_level) DESC, s.spell_name, m.name, pp.tier
$function$;
