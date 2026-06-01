-- Server-side aggregation for the Guild Chat Browser (/admin/chat).
--
-- The browser used to pull raw `ts` rows with .limit(50000) and bucket them in
-- JS (per year/month/day/era + top speakers). But supabase-js goes through
-- PostgREST, whose default response cap (1000 rows) silently truncates every
-- one of those fetches — so the counts were computed over an arbitrary
-- oldest-1000 slice of a 90k+ row table. Symptom: the "Luclin" era chip showed
-- 0 even though ~70k messages are in the Luclin window, because the first 1000
-- rows by insertion order are all Classic/Kunark era.
--
-- These two SECURITY DEFINER functions do the grouping in Postgres and return
-- one small row per bucket, so the cap never bites and the counts are exact.
-- They are service_role-only (the page calls them with the admin client);
-- EXECUTE is revoked from PUBLIC so anon/authenticated can't read chat
-- aggregates around the table's RLS.

-- Bucketed counts. p_group: 'total' | 'year' | 'month' | 'day'. Year/month/day
-- are extracted in UTC to match the browser's getUTC* drilldown. Filters are
-- literal, case-insensitive substring matches (no ILIKE wildcard injection).
create or replace function public.chat_bucket_counts(
  p_channel  text        default null,
  p_speakers text[]      default null,
  p_search   text        default null,
  p_from     timestamptz default null,
  p_to       timestamptz default null,
  p_group    text        default 'total'
)
returns table(bucket int, n bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    case p_group
      when 'year'  then extract(year  from (ts at time zone 'UTC'))::int
      when 'month' then extract(month from (ts at time zone 'UTC'))::int
      when 'day'   then extract(day   from (ts at time zone 'UTC'))::int
      else 0
    end as bucket,
    count(*)::bigint as n
  from chat_messages
  where guild_id = 'wolfpack'
    and (p_channel is null or p_channel = 'all' or channel = p_channel)
    and (p_search is null or p_search = '' or strpos(lower(text), lower(p_search)) > 0)
    and (p_from is null or ts >= p_from)
    and (p_to   is null or ts <  p_to)
    and (
      p_speakers is null
      or array_length(p_speakers, 1) is null
      or exists (select 1 from unnest(p_speakers) sp where strpos(lower(speaker), lower(sp)) > 0)
    )
  group by 1
$$;

-- Top speakers in a scope (channel/search/time), ranked by message count.
-- Deliberately ignores any speaker filter — the sidebar shows every voice in
-- range so you can add/remove speakers without losing scope.
create or replace function public.chat_top_speakers(
  p_channel text        default null,
  p_search  text        default null,
  p_from    timestamptz default null,
  p_to      timestamptz default null,
  p_limit   int         default 30
)
returns table(speaker text, n bigint)
language sql
stable
security definer
set search_path = public
as $$
  select speaker, count(*)::bigint as n
  from chat_messages
  where guild_id = 'wolfpack'
    and (p_channel is null or p_channel = 'all' or channel = p_channel)
    and (p_search is null or p_search = '' or strpos(lower(text), lower(p_search)) > 0)
    and (p_from is null or ts >= p_from)
    and (p_to   is null or ts <  p_to)
  group by speaker
  order by count(*) desc
  limit greatest(coalesce(p_limit, 30), 1)
$$;

revoke all on function public.chat_bucket_counts(text, text[], text, timestamptz, timestamptz, text) from public;
revoke all on function public.chat_top_speakers(text, text, timestamptz, timestamptz, int) from public;
grant execute on function public.chat_bucket_counts(text, text[], text, timestamptz, timestamptz, text) to service_role;
grant execute on function public.chat_top_speakers(text, text, timestamptz, timestamptz, int) to service_role;
