-- pop_spell_needs v4 — stop hiding alts. PoP flagging isn't a mains-only
-- activity (Hitya, 2026-08-26: "due to the nature of pop flagging they may do
-- it for many of their toons and we shouldn't only track mains"), but the
-- function's `mains` CTE hard-filtered to
-- `c.main_name IS NULL OR c.main_name = c.name` — an alt with a submitted
-- spellbook was invisible here no matter what.
--
-- Widen the CTE to every non-deleted, non-excluded character with a submitted
-- spellbook (main or alt) and surface `is_main` on each row so callers choose
-- their own default. /pop's guild-wide table keeps defaulting to mains
-- (Hitya: "we should default our views to mains") by filtering is_main=true
-- client-side; a new "My Characters" view ignores it entirely, same as the
-- flags-based chart/matrix already do per this session's other change.
--
-- Renamed the CTE `mains` -> `eligible` since it's no longer main-only; every
-- other reference (`JOIN mains m` etc.) follows. No other logic changes —
-- same class-scoping, same parchment-pool tiering, same held-by/scribed
-- exclusion. Signature gains one column, so the function must be dropped and
-- recreated (RETURNS TABLE shape changed).
--
-- ⚠ Also fixes a real perf bug this widening would otherwise have turned
-- catastrophic. The level lookup was a per-row CORRELATED subquery against
-- `who_directory` — a view with SIX DISTINCT ON / GROUP BY passes over all of
-- `who_observations` (120k+ rows) and no materialization. Postgres can't push
-- the character filter below those passes, so every row of `eligible` re-ran
-- the entire view: measured at 267k buffer hits PER CHARACTER. At 28 mains
-- that was already ~7.5M buffer hits and (unmeasured, but plausibly) slow;
-- widening to 117 eligible characters (main+alt) pushed it to ~31M and a
-- reproducible 60s+ hang calling the function directly against prod
-- (confirmed via EXPLAIN ANALYZE on the inlined query body: the correlated
-- form is what made it non-inlinable-fast). Switched to a plain
-- `LEFT JOIN who_directory wd ON wd.character_key = lower(c.name)` — the view
-- computes ONCE, characters hash-join against it — verified 1.2s end-to-end
-- with all 2550 output rows. `who_directory` already returns one row per
-- character (its own internal DISTINCT ON), so the join is equivalent to the
-- old `MAX(w.level)`, not an approximation.

DROP FUNCTION IF EXISTS pop_spell_needs(text);

CREATE FUNCTION pop_spell_needs(p_guild_id text)
RETURNS TABLE(
  spell_name text, spell_id integer, scroll_item_id integer, spell_level integer,
  tier text,
  character_name text, char_class text, char_level integer, held_by text[],
  is_main boolean
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
  eligible AS (
    SELECT c.name, c.class, cb.bit,
           replace(lower(trim(c.class)), ' ', '') AS class_key,
           (c.main_name IS NULL OR lower(c.main_name) = lower(c.name)) AS is_main,
           wd.level AS lvl
    FROM characters c
    JOIN class_bits cb ON cb.cls = lower(trim(c.class))
    LEFT JOIN who_directory wd ON wd.character_key = lower(c.name)
    WHERE c.guild_id = p_guild_id
      AND COALESCE(c.deleted, false) = false
      AND COALESCE(c.exclude_from_stats, false) = false
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
  LEFT JOIN holders h ON h.nm = lower(s.spell_name)
  WHERE (COALESCE(scl.level, s.seed_level) BETWEEN 61 AND 65 OR pp.tier IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM character_spellbook sb
       WHERE sb.guild_id = p_guild_id
         AND lower(sb.character_name) = lower(m.name)
         AND lower(sb.spell_name) = lower(s.spell_name))
  ORDER BY m.lvl DESC NULLS LAST, COALESCE(scl.level, s.seed_level) DESC, s.spell_name, m.name
$function$;

GRANT EXECUTE ON FUNCTION pop_spell_needs(text) TO service_role;
