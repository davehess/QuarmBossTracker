-- /about page numbers, in one cheap round trip.
--
-- ── Why this is a function and not nine PostgREST counts ─────────────────────
-- The first cut of web/app/about/page.tsx issued nine count() calls plus three
-- scans of encounter_threat_snapshots pulling up to 200k uploader strings to
-- unique them in JS, because PostgREST cannot express count(distinct …).
--
-- ── Why it is shaped THIS way ────────────────────────────────────────────────
-- The obvious rewrite — one function doing exact counts — measured
-- **32,398 ms**. Two causes, both worth remembering:
--   1. exact count(*) is a full scan per table, and chat_messages +
--      who_observations + encounter_threat_snapshots are ~1M rows together;
--   2. count(distinct boss_name) on the snapshot stream alone was 1,345 ms,
--      and the active-parser windows called that shape three times.
--
-- Rebuilt to **65 ms** (a 500x cut) by changing what is asked, not by adding
-- caching machinery — there is no pg_cron on this project, so anything needing
-- a scheduled refresh would have meant new moving parts for a marketing page:
--
--   · Active parsers come from `contributions` (3.4k rows), not
--     encounter_threat_snapshots (560k). That is also the MORE HONEST metric:
--     a contribution is a parse a person actually uploaded, whereas a snapshot
--     fires on a timer whenever the client is open.
--   · Big-table display counts use pg_class.reltuples, which ANALYZE already
--     maintains. "341,000 chat lines" does not need to be exact, and paying a
--     full scan per page view for the last three digits would be absurd.
--   · Small/meaningful tables stay EXACT — encounters, characters,
--     wolfpack_members, contributions. Those are the numbers people check.
--   · `mobs` counts distinct npc_id on `encounters` (101) rather than distinct
--     boss_name on snapshots (357). The latter counts trash mobs and reads as
--     inflated; distinct bosses actually fought is the claim being made.
create or replace function public.about_stats()
returns json language sql stable as $$
  with est as (
    select relname, greatest(reltuples, 0)::bigint n
    from pg_class
    where relname in ('chat_messages','who_observations','encounter_threat_snapshots',
                      'buff_casts','opendkp_loot')
      and relnamespace = 'public'::regnamespace
  )
  select json_build_object(
    'fights',     (select count(*) from public.encounters),
    'damage',     (select coalesce(sum(total_damage),0) from public.encounters),
    'days',       (select count(distinct date_trunc('day', started_at)) from public.encounters),
    'mobs',       (select count(distinct npc_id) from public.encounters),
    'characters', (select count(*) from public.characters),
    'members',    (select count(*) from public.wolfpack_members),
    'uploads',    (select count(*) from public.contributions),
    'chat',       (select n from est where relname='chat_messages'),
    'who',        (select n from est where relname='who_observations'),
    'snapshots',  (select n from est where relname='encounter_threat_snapshots'),
    'buffs',      (select n from est where relname='buff_casts'),
    'loot',       (select n from est where relname='opendkp_loot'),
    'dau', (select count(distinct contributor_character) from public.contributions
              where created_at > now() - interval '24 hours'),
    'wau', (select count(distinct contributor_character) from public.contributions
              where created_at > now() - interval '7 days'),
    'mau', (select count(distinct contributor_character) from public.contributions
              where created_at > now() - interval '30 days')
  );
$$;

comment on function public.about_stats() is
  'Aggregate counts for the public /about page in one cheap round trip (~65ms). Big-table counts are pg_class.reltuples estimates (display only); encounters/characters/members are exact. Active-parser windows come from contributions, not threat snapshots. See web/app/about/page.tsx.';

grant execute on function public.about_stats() to anon, authenticated;
