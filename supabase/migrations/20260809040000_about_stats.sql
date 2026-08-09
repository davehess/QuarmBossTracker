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
  ),
  -- 90 days, so a quiet fortnight cannot swing the figure.
  -- "How big is a raid" has THREE answers and only one is honest.
  --   chars_all  (~68) every character in the fight — encounter_players also
  --                    contains NON-GUILD players in contested content; on one
  --                    sampled night only 38 of 53 resolved to our roster
  --   chars_ours (~42) characters that are ours
  --   people_ours(~38) those collapsed to the FAMILY ROOT, so somebody who
  --                    swaps warrior→cleric mid-raid counts once
  -- Family root precedence: main_name_override → main_name → own name.
  -- ⚠ discord_id must NOT lead — it is set on 355 of 473 characters, so a main
  -- with a Discord link and its unlinked alt yield two keys and no dedup at
  -- all. Measured wrong that way once (1.06 chars/person) before this fix.
  per_night as (
    select e.raid_night_id,
           count(distinct ep.character_name) filter (where c.name is not null) chars_ours,
           count(distinct lower(coalesce(nullif(c.main_name_override,''),
                                         nullif(c.main_name,''), c.name)))
             filter (where c.name is not null) people_ours,
           count(distinct co.contributor_character) parsers
    from public.encounters e
    join public.encounter_players ep on ep.encounter_id = e.id
    left join public.characters c
      on lower(c.name) = lower(ep.character_name) and coalesce(c.deleted,false) = false
    left join public.contributions co on co.encounter_id = e.id
    where e.raid_night_id is not null
      and e.started_at > now() - interval '90 days'
    group by 1
  ),
  -- Daily active, averaged over days that HAD activity.
  --
  -- ⚠ Deliberately NOT a "right now" or "today so far" count (Hitya
  -- 2026-08-09: "not current total of users because that would fluctuate
  -- wildly with the time of day"). This guild raids Sun/Wed/Thu, so a live
  -- count read at 3am on a Saturday is 1 and makes a healthy platform look
  -- abandoned. Every activity figure this function returns is time-of-day
  -- stable by construction.
  per_day as (
    select date_trunc('day', created_at) d, count(distinct contributor_character) n
    from public.contributions
    where created_at > now() - interval '30 days'
    group by 1
  )
  select json_build_object(
    'fights',     (select count(*) from public.encounters),
    'damage',     (select coalesce(sum(total_damage),0) from public.encounters),
    'days',       (select count(distinct date_trunc('day', started_at)) from public.encounters),
    'mobs',       (select count(distinct npc_id) from public.encounters),
    'characters', (select count(*) from public.characters where coalesce(deleted,false)=false),
    'members',    (select count(*) from public.wolfpack_members),
    'uploads',    (select count(*) from public.contributions),
    'chat',       (select n from est where relname='chat_messages'),
    'who',        (select n from est where relname='who_observations'),
    'snapshots',  (select n from est where relname='encounter_threat_snapshots'),
    'buffs',      (select n from est where relname='buff_casts'),
    'loot',       (select n from est where relname='opendkp_loot'),
    -- median, not mean: one huge night must not drag the "typical"
    'raid_people',  (select percentile_cont(0.5) within group (order by people_ours)::int
                       from per_night where people_ours > 0),
    'raid_chars',   (select percentile_cont(0.5) within group (order by chars_ours)::int
                       from per_night where chars_ours > 0),
    'raid_biggest', (select max(people_ours) from per_night),
    'raid_parsers', (select percentile_cont(0.5) within group (order by parsers)::int
                       from per_night where parsers > 0),
    'dau_avg',      (select round(avg(n))::int from per_day)
  );
$$;

comment on function public.about_stats() is
  'Aggregate counts for the public /about page in one cheap round trip. raid_people is the honest raid size: OUR characters only (encounter_players also contains non-guild players in contested content) collapsed to the family root so an alt swap counts once. All activity figures are time-of-day stable by construction. See web/app/about/page.tsx.';

grant execute on function public.about_stats() to anon, authenticated;
