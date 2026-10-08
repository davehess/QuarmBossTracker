-- Per-CLASS spell levels — `spell_level_seed.level` is the minimum, not the truth.
--
-- Lacunanight, 2026-08-25, reading the cleric turn-in script on PQDI:
-- "Spell: Petrifying Earth is a Cleric 64 spell but get it under Ethereal
-- parchment (61-62) spells … So is the quarm DB incorrect or was it adjusted?"
--
-- Neither. Two separate errors of ours stacked into one confusing display:
--
--   1. The "(61-62)" label was OUR inference, deleted earlier today
--      (20260825030000). Parchment pools are hand-curated, not level bands —
--      Vicar Ceraen's Ethereal list genuinely contains Petrifying Earth
--      (cleric 64) and Pacification (cleric 65).
--
--   2. THIS migration's bug: the level we displayed for Petrifying Earth was
--      62 — the NECROMANCER level. `spell_level_seed` holds one integer per
--      spell, and the 2026-07-08 PQDI scrape stored the MINIMUM across every
--      class that can scribe it, keeping per-class truth only in a free-text
--      `note` ("Cleric 64, Shaman 64, Necromancer 62"). Verified over all 308
--      seeds: `level` = min(note levels) in every single row.
--
-- So a cleric reading our spell pages saw the necromancer's level. Measured
-- blast radius: 355 class rows across 308 spells; 19 rows (15 spells) show a
-- level wrong for that class. Worst case is 25 levels off (Shadow Sight:
-- necro 24 shown, SK 49) — bad enough to send someone to a vendor 25 levels
-- early. Infusion of Spirit shows a beastlord 49 when theirs is 61.
--
-- The note is machine-readable, so promote it to a real relation rather than
-- leaving the truth in prose. Parse verified: all 308 notes parse, 355 rows,
-- 11 distinct class tokens, all valid class names.
--
-- ⚠ This view is DERIVED from the note. If a future scrape writes notes in a
-- different shape, `spell_class_levels_parse_ok` (below) drops and the guard
-- test in test/spell-class-levels.test.js fails — do not "fix" that by
-- loosening the regex without re-checking a sample by hand.

CREATE OR REPLACE VIEW spell_class_levels AS
SELECT
  sd.spell_id,
  trim(t.parts[1])          AS class_name,
  -- Space-insensitive key: characters.class carries both 'Shadow Knight' and
  -- 'Shadowknight' (the existing bitmask CTEs already tolerate both).
  replace(lower(trim(t.parts[1])), ' ', '') AS class_key,
  t.parts[2]::int           AS level,
  sd.level                  AS seed_min_level,
  sd.source,
  sd.note
FROM spell_level_seed sd
CROSS JOIN LATERAL regexp_matches(
  sd.note, '([A-Za-z][A-Za-z ]*?)\s+(\d{1,2})(?:,|$)', 'g'
) AS t(parts);

-- Health signal for the parse the view depends on. A note that stops parsing
-- silently loses that spell's per-class levels, which is exactly the class of
-- silent-wrongness this migration exists to end.
CREATE OR REPLACE VIEW spell_class_levels_parse_ok AS
SELECT
  (SELECT count(*) FROM spell_level_seed)                              AS seeds,
  (SELECT count(DISTINCT spell_id) FROM spell_class_levels)            AS seeds_parsed,
  (SELECT count(*) FROM spell_class_levels)                            AS class_rows,
  (SELECT count(DISTINCT class_name) FROM spell_class_levels)          AS class_tokens,
  (SELECT count(*) FROM spell_class_levels
    WHERE class_key NOT IN ('warrior','cleric','paladin','ranger','shadowknight',
                            'druid','monk','bard','rogue','shaman','necromancer',
                            'wizard','magician','enchanter','beastlord'))       AS unknown_class_tokens;

-- pop_spell_needs v3 — same contract as v2 plus one correction: spell_level
-- is now the level FOR THAT CHARACTER'S CLASS, falling back to the seed
-- minimum only when the note doesn't name their class. Everything else
-- (tier from the quest-script pools, Song support, first-dibs ordering) is
-- unchanged from v2.
DROP FUNCTION IF EXISTS pop_spell_needs(text);

CREATE FUNCTION pop_spell_needs(p_guild_id text)
RETURNS TABLE(
  spell_name text, spell_id integer, scroll_item_id integer, spell_level integer,
  tier text,
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
           replace(lower(trim(c.class)), ' ', '') AS class_key,
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
    SELECT DISTINCT ON (lower(regexp_replace(regexp_replace(i.name, '^(Spell|Song): ', ''), '\*+\s*$', '')))
      regexp_replace(regexp_replace(i.name, '^(Spell|Song): ', ''), '\*+\s*$', '') AS spell_name,
      i.id      AS scroll_item_id,
      i.classes AS class_bits,
      (SELECT s.id FROM eqemu_spells s
        WHERE lower(s.name) = lower(regexp_replace(regexp_replace(i.name, '^(Spell|Song): ', ''), '\*+\s*$', ''))
        ORDER BY s.id LIMIT 1) AS spell_id
    FROM eqemu_items i
    WHERE i.name LIKE 'Spell: %' OR i.name LIKE 'Song: %'
    ORDER BY lower(regexp_replace(regexp_replace(i.name, '^(Spell|Song): ', ''), '\*+\s*$', '')),
             (i.name LIKE '%*%'), i.id
  ),
  scrolls AS (
    SELECT p.*, sd.level AS seed_level
    FROM pool p
    LEFT JOIN spell_level_seed sd ON sd.spell_id = p.spell_id
  ),
  holders AS (
    SELECT lower(regexp_replace(regexp_replace(ci.item_name, '^(Spell|Song): ', ''), '\*+\s*$', '')) AS nm,
           array_agg(DISTINCT ci.character_name ORDER BY ci.character_name) AS names
    FROM character_inventory ci
    WHERE ci.guild_id = p_guild_id
      AND (ci.item_name LIKE 'Spell: %' OR ci.item_name LIKE 'Song: %')
    GROUP BY 1
  )
  SELECT s.spell_name, s.spell_id, s.scroll_item_id,
         -- THE class's level, not the cross-class minimum.
         COALESCE(scl.level, s.seed_level) AS spell_level,
         pp.tier,
         m.name, m.class, m.lvl, COALESCE(h.names, '{}')
  FROM scrolls s
  JOIN mains m ON (s.class_bits & m.bit) > 0
  LEFT JOIN spell_class_levels scl
         ON scl.spell_id = s.spell_id AND scl.class_key = m.class_key
  LEFT JOIN pop_parchment_pools pp
         ON pp.scroll_item_id = s.scroll_item_id
        AND replace(lower(pp.class_name), ' ', '') = m.class_key
  LEFT JOIN holders h ON h.nm = lower(s.spell_name)
  WHERE (COALESCE(scl.level, s.seed_level) BETWEEN 61 AND 65 OR pp.tier IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM character_spellbook sb
       WHERE sb.guild_id = p_guild_id
         AND lower(sb.character_name) = lower(m.name)
         AND lower(sb.spell_name) = lower(s.spell_name))
  ORDER BY m.lvl DESC NULLS LAST, COALESCE(scl.level, s.seed_level) DESC, s.spell_name, m.name
$function$;
