-- 20261004140100_raid_review_aggregates.sql
-- Two aggregates for the Raid Night Review (utils/raidReview.js collectNightData), so the review reads
-- a handful of summary rows instead of thousands of raw ones that PostgREST would cut off at 1,000.
--
-- The guild lead asked for a review of every table for silent row caps (2026-10-04). PostgREST returns
-- at most 1,000 rows per response and `limit=3000` does not lift that. The review's reads were written
-- when `encounters` held a few dozen rows a night; since 2026-08-19 every named mob auto-registers and
-- a night holds 500-1,300. Both reads below fed a number on the card:
--
--   raid_review_fun_counts       the "Around the campfire" line. The review pulled every fun_events row
--                                of the 24 h window (`limit=3000`) just to count them by event_type in
--                                JS. 1,416 rows on 2026-09-17, so the cap cut that night at 1,000.
--                                Now: event_type, count(*), nothing else leaves the database.
--
--   raid_review_history_medians  the "slower / faster than our own median" lines. The review pulled
--                                every confirmed kill of the night's bosses over the 90 days before the
--                                night (`limit=3000`, unordered) and took a median per boss in JS. Now:
--                                per npc, how many kills and the median duration. The median is
--                                sorted[floor(n/2)], the upper middle for an even n, exactly the index
--                                the review has always used (a true even-n median would shift every
--                                comparison by half a rank). n comes back too, because the review
--                                makes no claim below four samples.
--
-- Both read what the review read: this guild's rows, in the same time window, with the same row
-- filters (a null or empty event_type is skipped; only confirmed kills with a positive duration count
-- for the history). Checked against production on 2026-09-27's bosses: the SQL median equals the
-- JS-style sorted[floor(n/2)] for all 13 npcs.
--
-- The history reads encounters_npc_started_idx (npc_id, started_at desc). fun_events is read through
-- fun_events_guild_id_event_type_caster_event_ts_key, an index-only scan: ~325 ms for the 1,416-row
-- night (EXPLAIN ANALYZE, 2026-10-04). It runs once per review and the live card caches it for 10
-- minutes. An index on (guild_id, event_ts) would make it a range scan; not added here.
--
-- SECURITY INVOKER: fun_events and encounters are plain tables with authenticated-read policies; the
-- functions add nothing they do not already allow. The bot calls them as service_role and no other
-- surface needs them, so the grants match 20260718040000_lockdown_security_definer_rpcs.sql.
--
-- Idempotent: CREATE OR REPLACE, REVOKE and GRANT all re-run cleanly.

create or replace function public.raid_review_fun_counts(p_guild_id text, p_from timestamptz, p_to timestamptz)
returns table(event_type text, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select f.event_type, count(*) as n
  from fun_events f
  where f.guild_id = p_guild_id
    and f.event_ts >= p_from
    and f.event_ts <  p_to
    and f.event_type is not null
    and f.event_type <> ''
  group by f.event_type
  order by count(*) desc, f.event_type
$$;

comment on function public.raid_review_fun_counts(text, timestamptz, timestamptz) is
  'fun_events in [p_from, p_to) for the guild, counted per event_type, most common first. Feeds the Around the campfire line of the raid review (utils/raidReview.js).';

create or replace function public.raid_review_history_medians(p_guild_id text, p_npc_ids int[], p_since timestamptz, p_until timestamptz)
returns table(npc_id int, n bigint, median_sec int)
language sql
stable
security invoker
set search_path = public
as $$
  with h as (
    select e.npc_id,
           e.duration_sec,
           row_number() over (partition by e.npc_id order by e.duration_sec) - 1 as rn,
           count(*) over (partition by e.npc_id) as n
    from encounters e
    where e.guild_id = p_guild_id
      and e.npc_id = any(p_npc_ids)
      and e.npc_id <> 0
      and e.ended_at is not null
      and e.duration_sec > 0
      and e.started_at >= p_since
      and e.started_at <  p_until
  )
  select h.npc_id, h.n, h.duration_sec as median_sec
  from h
  where h.rn = h.n / 2
  order by h.npc_id
$$;

comment on function public.raid_review_history_medians(text, int[], timestamptz, timestamptz) is
  'Per npc in p_npc_ids: n = confirmed kills with a duration in [p_since, p_until), median_sec = sorted durations at index floor(n/2) (the upper middle for an even n, the index the review has always used). An npc with no such kill is omitted. Feeds the slower/faster-than-our-median lines of the raid review (utils/raidReview.js).';

revoke all on function public.raid_review_fun_counts(text, timestamptz, timestamptz) from public;
revoke all on function public.raid_review_fun_counts(text, timestamptz, timestamptz) from anon;
revoke all on function public.raid_review_fun_counts(text, timestamptz, timestamptz) from authenticated;
grant execute on function public.raid_review_fun_counts(text, timestamptz, timestamptz) to service_role;

revoke all on function public.raid_review_history_medians(text, int[], timestamptz, timestamptz) from public;
revoke all on function public.raid_review_history_medians(text, int[], timestamptz, timestamptz) from anon;
revoke all on function public.raid_review_history_medians(text, int[], timestamptz, timestamptz) from authenticated;
grant execute on function public.raid_review_history_medians(text, int[], timestamptz, timestamptz) to service_role;
