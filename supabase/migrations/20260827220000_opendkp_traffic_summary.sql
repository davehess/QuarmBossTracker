-- opendkp_traffic_summary() — server-side aggregation for wolfpack.quest/opendkp
--
-- The page used to select raw rows and aggregate in JS:
--     .order('minute', { ascending: true }).limit(1000)
--
-- Ascending WITH a limit, so it kept the OLDEST 1000 rows of the 48h window and
-- silently discarded everything newer. Once volume passed 1000 rows/48h the
-- newest data fell off the end, starting with the last hour. Measured when it
-- was caught (2026-08-27): 1,440 rows in the window, so the newest 440 were
-- dropped — the page read "0 calls in the last hour" against a true 49, and
-- "1,330 calls / 91.3 MB" over 24h against a true 2,074 / 115.9 MB.
--
-- ⚠ It under-reported BY ~36%, IN OUR FAVOUR, on the one page whose entire
-- purpose is that OpenDKP's operator does not have to take our word for our
-- traffic. A page like that being wrong in the flattering direction is worse
-- than it being down.
--
-- Aggregating here removes the cliff rather than raising it: there is no row
-- limit to outgrow, Postgres does the work instead of shipping thousands of
-- rows to the edge, and the hour buckets are gap-filled so a quiet hour renders
-- as zero rather than vanishing.
create or replace function public.opendkp_traffic_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with w as (
    select * from public.opendkp_call_stats
    where minute >= now() - interval '48 hours'
  ),
  -- Our AWS Cognito auth is counted but reported separately: folding it into
  -- "calls to OpenDKP" overstates what we send him, and this page must never be
  -- wrong in that direction either.
  dkp_1h  as (select * from w where minute >= now() - interval '1 hour'  and endpoint not like 'cognito:%'),
  dkp_24h as (select * from w where minute >= now() - interval '24 hours' and endpoint not like 'cognito:%'),
  auth_1h as (select * from w where minute >= now() - interval '1 hour'  and endpoint like 'cognito:%'),
  ep as (
    select endpoint, sum(calls) as calls, sum(bytes) as bytes, sum(errors) as errors
    from dkp_24h group by endpoint
  ),
  buckets as (
    select gs as h
    from generate_series(date_trunc('hour', now()) - interval '47 hours',
                         date_trunc('hour', now()), interval '1 hour') gs
  ),
  hourly as (
    select b.h,
           coalesce(sum(w.calls), 0)   as calls,
           coalesce(sum(w.blocked), 0) as blocked
    from buckets b
    left join w on date_trunc('hour', w.minute) = b.h
    group by b.h
  )
  select jsonb_build_object(
    'generated_at',    now(),
    'calls_1h',        coalesce((select sum(calls)   from dkp_1h),  0),
    'bytes_1h',        coalesce((select sum(bytes)   from dkp_1h),  0),
    'blocked_1h',      coalesce((select sum(blocked) from dkp_1h),  0),
    'calls_24h',       coalesce((select sum(calls)   from dkp_24h), 0),
    'bytes_24h',       coalesce((select sum(bytes)   from dkp_24h), 0),
    'errors_24h',      coalesce((select sum(errors)  from dkp_24h), 0),
    'auth_calls_1h',   coalesce((select sum(calls)   from auth_1h), 0),
    'auth_blocked_1h', coalesce((select sum(blocked) from auth_1h), 0),
    'ever_seen',       (select count(*) > 0 from w),
    'endpoints', coalesce(
      (select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'calls', calls,
                                           'bytes', bytes, 'errors', errors)
                        order by calls desc) from ep), '[]'::jsonb),
    'hours', coalesce(
      (select jsonb_agg(jsonb_build_object('at', h, 'calls', calls, 'blocked', blocked)
                        order by h) from hourly), '[]'::jsonb)
  );
$$;

-- Same reach as the table itself: opendkp_call_stats is the single anon-readable
-- table in the schema, a deliberate exception because the reader who most needs
-- this page is not in our Discord (see DECISIONS-2026-08-26.md).
grant execute on function public.opendkp_traffic_summary() to anon, authenticated;
