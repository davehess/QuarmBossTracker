-- 20261004140800_cap_safe_pop.sql
-- Make the PoP pages' set-returning reads safe to PAGE, and take two aggregates off the page.
--
-- THE CAP: PostgREST returns at most 1,000 rows a response, silently, for tables AND for
-- set-returning functions, and `.limit(N)` / one `.range(0, N)` do not raise it. The web reads
-- these through selectAll (web/lib/selectAll.ts), which walks `.range()` pages. A walk is only
-- correct if every page sees the SAME total order, so a function a page reads must end its
-- ORDER BY on a unique key. Measured on production 2026-10-04 (the guild lead: "review all of the
-- other tables for silent 500 or 100 caps"):
--   pop_spell_needs   2,712 rows, /pop read the first 1,000 (37%); 29 characters showed
--                     "nothing missing" because their rows were past row 1,000.
--   pop_who_sightings 133 rows for the roster's names after four days of PoP (561 for every name /who
--                     has seen in a PoP plane), growing; /pop and /pop/guide read it whole.
--
-- 1. pop_who_sightings: no ORDER BY at all. Add `order by lower(character), zone`, which is its
--    GROUP BY key and so unique. Same signature, columns, rows. Grants are re-stated as they were.
--
-- 2. pop_spell_needs, two changes, both output-identical today:
--    a) ORDER BY ends `m.name, pp.tier`. (spell_name, name) is already unique in today's 2,712 rows
--       (pool is DISTINCT ON the lowered spell name, characters' key is (guild_id, name)), but
--       spell_class_levels and pop_parchment_pools have no unique constraint, so a duplicate row in
--       either would fan one (spell, character) pair out into rows that differ only in `tier` and
--       let a page boundary split them. `pp.tier` is the only output column that could differ.
--    b) The level is read per character through who_obs_character_idx instead of joining the
--       who_directory view. The view's best_* CTEs take no name filter, so every call scans all
--       161k rows of who_observations: the function measured 2.4 s to 4.4 s on 2026-10-04 and a
--       page of it costs the whole of that, so reading its three pages would cost three times as
--       much. It is the same fix latest_character_levels (20261004120000) made, and the newest
--       non-null level is what who_directory.level is: COALESCE(best_level, latest row's level) is
--       the newest non-null level, and null when no row has one (then the latest row's is null too).
--       Compared on production, the old function and this body returned the same 2,712 rows
--       (EXCEPT ALL both ways: 0 rows), and the body ran in 0.55 s (EXPLAIN ANALYZE) against 2.4 s to
--       4.4 s for the function.
--    Grants are not touched: CREATE OR REPLACE keeps the ones it has.
--
-- 3. pop_spellbook_names(p_guild_id, p_names): which of the given characters have ANY spellbook rows,
--    one lowered name each. /pop's My Characters read `character_spellbook` for the household with a
--    1,000-row limit to learn this; one household has 1,095 rows (20 characters), so a character whose
--    rows all sat past the first 1,000 would read "no spellbook on file". None does today, which is
--    luck of the heap order. The answer is at most one row per name asked, far under the cap.
--
-- 4. fun_caster_tally(p_event_type): events and summed reagent_qty per caster for one fun_events
--    type. /fun summed mana_twitch (686 rows, +7.8/day) and tallied mind_wrack_cast (615 rows,
--    +7.1/day) in JS from a plain select, which stops at 1,000 rows; at those rates the Mana
--    donated and Mind Wracks cards would have started under-counting in weeks. The aggregate is
--    one row per caster. A null or empty caster is 'unknown', as the page already treated it.
--
-- All SECURITY INVOKER (the tables are read by the caller as itself), `set search_path = public`,
-- and the two new functions are service_role only: the site calls them with the service key.
-- Idempotent: CREATE OR REPLACE, REVOKE and GRANT all re-run cleanly. No data changes.

create or replace function public.pop_who_sightings(p_guild_id text, p_names text[], p_zones text[])
returns table(character_key text, zone text, first_seen timestamptz, last_seen timestamptz, seen bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select lower(w.character), w.zone, min(w.observed_at), max(w.observed_at), count(*)
  from who_observations w
  where w.guild_id = p_guild_id
    and lower(w.character) = any(p_names)
    and w.zone = any(p_zones)
    and coalesce(w.gm, false) = false
  group by lower(w.character), w.zone
  order by lower(w.character), w.zone
$$;

revoke all on function public.pop_who_sightings(text, text[], text[]) from public, anon, authenticated;
grant execute on function public.pop_who_sightings(text, text[], text[]) to service_role;

create or replace function public.pop_spell_needs(p_guild_id text)
returns table(
  spell_name text, spell_id integer, scroll_item_id integer, spell_level integer,
  tier text,
  character_name text, char_class text, char_level integer, held_by text[],
  is_main boolean
)
language sql
stable
security invoker
set search_path = public
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
  ORDER BY m.lvl DESC NULLS LAST, COALESCE(scl.level, s.seed_level) DESC, s.spell_name, m.name, pp.tier
$function$;

create or replace function public.pop_spellbook_names(p_guild_id text, p_names text[])
returns table(character_key text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct lower(sb.character_name)
  from character_spellbook sb
  where sb.guild_id = p_guild_id
    and lower(sb.character_name) = any(array(select lower(n) from unnest(p_names) n))
  order by 1
$$;

revoke all on function public.pop_spellbook_names(text, text[]) from public, anon, authenticated;
grant execute on function public.pop_spellbook_names(text, text[]) to service_role;

create or replace function public.fun_caster_tally(p_event_type text)
returns table(caster text, events bigint, qty bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(nullif(e.caster, ''), 'unknown'), count(*), coalesce(sum(e.reagent_qty), 0)::bigint
  from fun_events e
  where e.event_type = p_event_type
  group by 1
  order by 1
$$;

revoke all on function public.fun_caster_tally(text) from public, anon, authenticated;
grant execute on function public.fun_caster_tally(text) to service_role;
