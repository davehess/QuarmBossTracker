-- PoP parchment pools from the ACTUAL quest scripts, replacing level inference.
--
-- Lacunanight, first night on the site (2026-08-25): "The spells I think are
-- double dipping on the Matrix page … Necros have 9 spells but shows 12" —
-- then, with the Quarm quest source in hand: the necro Glyphed turn-in awards
-- exactly THREE spells (ChooseRandom of Blood of Thule / Child of
-- Bertoxxulous / Word of Terris), not "every level-65 necro spell". The
-- level-tier heuristic in web/lib/popSpells.ts was honest about being a
-- one-witness inference (cleric); the second witness broke it: pools are
-- hand-curated per class in the scripts, and a spell like Destroy Undead
-- (cleric 64 / necro 65) lives in the CLERIC Spectral pool, not the necro
-- Glyphed one.
--
-- We already mirror the ProjectEQ turn-in scripts into scripted_npc_turnins,
-- and the mirrored pools were verified against Lacunanight's live-Quarm
-- screenshot: the necro Glyphed trio matches byte-for-byte. One KNOWN
-- divergence: our necro Ethereal pool holds 7 scrolls where he counted 8 in
-- Quarm's (Lua) script — Quarm's fork differs by ~one spell there. Needs the
-- Quarm script file to reconcile (docs/HANDOFF-pop-quest-extract.md route, or
-- Lacunanight's copy); recorded in docs/DECISIONS-2026-08-25.md.
--
-- The trainer's class is DERIVED, not hand-listed: bit_and over the pool's
-- scroll class-bitmasks resolves to exactly one class bit for every PoK
-- trainer (verified over all 13 NPCs, incl. both druid Wanderers). A future
-- re-import can therefore add/change pools without touching this view.
--
-- ⚠ Bards: Minstrel Eoweril's 19 rewards are 'Song: %' items, not 'Spell: %'.
-- The old pop_spell_needs filter silently dropped every bard reward.

CREATE OR REPLACE VIEW pop_parchment_pools AS
WITH class_bits(class_name, bit) AS (VALUES
  ('Cleric', 2), ('Paladin', 4), ('Ranger', 8), ('Shadow Knight', 16),
  ('Druid', 32), ('Bard', 128), ('Shaman', 512), ('Necromancer', 1024),
  ('Wizard', 2048), ('Magician', 4096), ('Enchanter', 8192), ('Beastlord', 16384)
),
turnin AS (
  SELECT t.npc_name,
         (t.inputs->0->>'item_id')::int AS parchment_id,
         (o->>'item_id')::int           AS scroll_item_id
  FROM scripted_npc_turnins t
  CROSS JOIN LATERAL jsonb_array_elements(t.outputs) o
  WHERE t.zone_short = 'poknowledge'
    AND jsonb_array_length(t.inputs) = 1
    AND (t.inputs->0->>'item_id')::int IN (29112, 29131, 29132)
    AND COALESCE(t.is_duplicate, false) = false
),
npc_class AS (
  SELECT tu.npc_name, bit_and(i.classes) AS common_bits
  FROM turnin tu JOIN eqemu_items i ON i.id = tu.scroll_item_id
  GROUP BY tu.npc_name
)
SELECT DISTINCT
  cb.class_name,
  CASE tu.parchment_id
    WHEN 29112 THEN 'ethereal'
    WHEN 29131 THEN 'spectral'
    ELSE 'glyphed'
  END AS tier,
  tu.parchment_id,
  tu.scroll_item_id,
  regexp_replace(regexp_replace(i.name, '^(Spell|Song): ', ''), '\*+\s*$', '') AS spell_name,
  i.classes AS scroll_class_bits
FROM turnin tu
JOIN npc_class nc ON nc.npc_name = tu.npc_name
JOIN class_bits cb ON cb.bit = nc.common_bits   -- only cleanly single-class trainers
JOIN eqemu_items i ON i.id = tu.scroll_item_id;

-- pop_spell_needs v2: same job (who still needs which PoP spell, level-desc
-- priority per Hitya's first-dibs rule), two fixes and one new column:
--   • membership now includes 'Song: %' scrolls — bards existed all along;
--   • NEW `tier` column: the parchment that buys this spell FOR THIS
--     CHARACTER'S CLASS, from the script pools. NULL means "your class's
--     turn-ins can't award it" (research, or another class's scroll via
--     trade) — the page shows those honestly instead of miscounting them;
--   • a pool row rescues a spell whose level the seed doesn't know (the old
--     61-65 seed filter silently dropped those).
-- RETURNS TABLE changes shape, so drop-and-recreate.
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
    SELECT p.*, sd.level AS spell_level
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
  SELECT s.spell_name, s.spell_id, s.scroll_item_id, s.spell_level,
         pp.tier,
         m.name, m.class, m.lvl, COALESCE(h.names, '{}')
  FROM scrolls s
  JOIN mains m ON (s.class_bits & m.bit) > 0
  -- Space-insensitive class match: characters.class carries both
  -- 'Shadow Knight' and 'Shadowknight' in the wild (the bitmask CTE above
  -- already tolerates both; this join must too or SK rows silently lose
  -- their tier).
  LEFT JOIN pop_parchment_pools pp
         ON pp.scroll_item_id = s.scroll_item_id
        AND replace(lower(pp.class_name), ' ', '') = replace(lower(trim(m.class)), ' ', '')
  LEFT JOIN holders h ON h.nm = lower(s.spell_name)
  WHERE (s.spell_level BETWEEN 61 AND 65 OR pp.tier IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM character_spellbook sb
       WHERE sb.guild_id = p_guild_id
         AND lower(sb.character_name) = lower(m.name)
         AND lower(sb.spell_name) = lower(s.spell_name))
  ORDER BY m.lvl DESC NULLS LAST, s.spell_level DESC, s.spell_name, m.name
$function$;
