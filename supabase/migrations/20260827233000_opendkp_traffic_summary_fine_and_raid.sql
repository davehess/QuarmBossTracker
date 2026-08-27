create or replace function public.opendkp_traffic_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with w as (
    select * from public.opendkp_call_stats where minute >= now() - interval '48 hours'
  ),
  dkp_1h  as (select * from w where minute >= now() - interval '1 hour'  and endpoint not like 'cognito:%'),
  dkp_24h as (select * from w where minute >= now() - interval '24 hours' and endpoint not like 'cognito:%'),
  auth_1h as (select * from w where minute >= now() - interval '1 hour'  and endpoint like 'cognito:%'),
  ep as (
    select endpoint, sum(calls) as calls, sum(bytes) as bytes, sum(errors) as errors
    from dkp_24h group by endpoint
  ),
  buckets as (
    select gs as h from generate_series(date_trunc('hour', now()) - interval '47 hours',
                                        date_trunc('hour', now()), interval '1 hour') gs
  ),
  hourly as (
    select b.h, coalesce(sum(w.calls),0) as calls, coalesce(sum(w.blocked),0) as blocked
    from buckets b left join w on date_trunc('hour', w.minute) = b.h group by b.h
  ),
  -- ── Fine grain: 10-minute buckets over the last 6 hours. An hourly bar cannot
  -- show a spike while it is happening; by the time the bar is tall the moment
  -- has passed. 36 buckets, gap-filled.
  fine_buckets as (
    select gs as t from generate_series(
      date_trunc('hour', now()) - interval '6 hours',
      now(), interval '10 minutes') gs
  ),
  fine as (
    select f.t,
           coalesce(sum(w.calls),0) as calls,
           coalesce(sum(w.bytes),0) as bytes
    from fine_buckets f
    left join w on w.minute >= f.t and w.minute < f.t + interval '10 minutes'
                and w.endpoint not like 'cognito:%'
    group by f.t
  ),
  -- ── The raid window. Sun/Wed/Thu 19:00→01:00 ET, matching _inRaidWindowEt in
  -- index.js — the gate that actually changes our behaviour, not the 20:00 pull
  -- time. Read from the base table, not from `w`: the most recent raid can be
  -- older than the 48h window when it is not a raid week.
  raid_days as (
    select gs::date as d from generate_series(
      (now() at time zone 'America/New_York')::date - 8,
      (now() at time zone 'America/New_York')::date, interval '1 day') gs
    where extract(dow from gs) in (0, 3, 4)
  ),
  raid_windows as (
    select ((d + time '19:00') at time zone 'America/New_York') as ts_start,
           ((d + time '19:00') at time zone 'America/New_York') + interval '6 hours' as ts_end
    from raid_days
  ),
  cur_raid as (
    select ts_start, ts_end from raid_windows where ts_start <= now()
    order by ts_start desc limit 1
  ),
  raid_rows as (
    select s.* from public.opendkp_call_stats s, cur_raid c
    where s.minute >= c.ts_start and s.minute < least(c.ts_end, now() + interval '1 minute')
      and s.endpoint not like 'cognito:%'
  ),
  raid_ep as (
    select endpoint, sum(calls) as calls, sum(bytes) as bytes, sum(errors) as errors
    from raid_rows group by endpoint
  ),
  raid_slots as (
    select gs as t from generate_series(
      (select ts_start from cur_raid),
      least((select ts_end from cur_raid), now()),
      interval '15 minutes') gs
  ),
  raid_series as (
    select r.t, coalesce(sum(x.calls),0) as calls, coalesce(sum(x.bytes),0) as bytes
    from raid_slots r
    left join raid_rows x on x.minute >= r.t and x.minute < r.t + interval '15 minutes'
    group by r.t
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
    'endpoints', coalesce((select jsonb_agg(jsonb_build_object(
        'endpoint', endpoint, 'calls', calls, 'bytes', bytes, 'errors', errors)
        order by calls desc) from ep), '[]'::jsonb),
    'hours', coalesce((select jsonb_agg(jsonb_build_object(
        'at', h, 'calls', calls, 'blocked', blocked) order by h) from hourly), '[]'::jsonb),
    'fine', coalesce((select jsonb_agg(jsonb_build_object(
        'at', t, 'calls', calls, 'bytes', bytes) order by t) from fine), '[]'::jsonb),
    'raid', jsonb_build_object(
      'started_at',  (select ts_start from cur_raid),
      'ends_at',     (select ts_end   from cur_raid),
      'in_progress', (select now() < ts_end from cur_raid),
      'calls',       coalesce((select sum(calls) from raid_rows), 0),
      'bytes',       coalesce((select sum(bytes) from raid_rows), 0),
      'errors',      coalesce((select sum(errors) from raid_rows), 0),
      'endpoints', coalesce((select jsonb_agg(jsonb_build_object(
          'endpoint', endpoint, 'calls', calls, 'bytes', bytes, 'errors', errors)
          order by calls desc) from raid_ep), '[]'::jsonb),
      'series', coalesce((select jsonb_agg(jsonb_build_object(
          'at', t, 'calls', calls, 'bytes', bytes) order by t) from raid_series), '[]'::jsonb)
    )
  );
$$;

grant execute on function public.opendkp_traffic_summary() to anon, authenticated;
