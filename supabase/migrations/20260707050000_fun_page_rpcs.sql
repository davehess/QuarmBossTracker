-- /fun page load regression fixes (Uilnayar 2026-07-07: "time to load the fun
-- page has increased substantially").
--
-- Measured on prod: chat_messages grew to 284k rows / 138MB → the Tunare
-- counter's two ILIKE scans cost ~1.5s EACH; encounter_combat_rollup grew to
-- 28k rows → the dirge counter shipped 20k jsonb rows to Vercel per page load
-- (and silently under-counted once the table passed its .limit(20000)).
-- These RPCs move both to indexed / aggregated single queries; the page also
-- goes from ~25 sequential queries to parallel sections.

-- Speaker-scoped chat lookups: btree on lower(speaker) lets the Tunare RPC
-- (and any future speaker-scoped stat) touch only that family's rows instead
-- of seq-scanning the whole table.
CREATE INDEX IF NOT EXISTS chat_messages_speaker_lower_idx
  ON public.chat_messages (lower(speaker));

-- Count + latest of "tunare" mentions by a set of speakers, in ONE indexed
-- query (was: two parallel 1.5s seq scans via PostgREST).
CREATE OR REPLACE FUNCTION public.fun_tunare_stats(p_names text[])
RETURNS TABLE(invocations bigint, last_ts timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT count(*), max(ts)
  FROM public.chat_messages
  WHERE lower(speaker) IN (SELECT lower(x) FROM unnest(p_names) x)
    AND text ILIKE '%tunare%';
$$;

-- Per-character dirge damage/hits aggregated server-side (was: fetch 20k
-- rows of by_skill jsonb to Vercel and reduce in JS — megabytes of egress,
-- truncated at the .limit). Slow-changing → the page caches the result.
CREATE OR REPLACE FUNCTION public.fun_dirge_damage()
RETURNS TABLE(character_name text, dmg numeric, hits numeric)
LANGUAGE sql STABLE AS $$
  SELECT r.character_name,
         sum(coalesce((v.value->>'dmg')::numeric, 0)),
         sum(coalesce((v.value->>'hits')::numeric, 0))
  FROM public.encounter_combat_rollup r,
       LATERAL jsonb_each(r.by_skill) v
  WHERE v.key ILIKE '%dirge%'
  GROUP BY r.character_name;
$$;
