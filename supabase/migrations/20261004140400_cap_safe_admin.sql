-- 20261004140400_cap_safe_admin.sql
-- The admin pages' aggregates, computed in the database instead of in a 1,000-row read.
--
-- PostgREST silently returns at most 1,000 rows per response. `.limit(20000)` does not raise
-- that, and neither does one `.range(0, N)`. The admin pages below each pulled a big window of
-- rows and counted them in JS, so every figure they showed came from the first 1,000 rows
-- the planner happened to return (the guild lead, 2026-10-04: "review all of the other tables
-- for silent 500 or 100 caps"). Measured on production the same day:
--
--   /admin queue banner (every admin page)
--     guild/raid chat, 14 d      21,545 rows read as 1,000  -> 117 speakers missing from OpenDKP
--                                                              (8 shown) and 41 with no class signal (6)
--     who_observations, 30 d     64,046 rows read as 1,000  -> the "classes we know" set
--     newest /who rows           3,000 requested, 1,000 read, all inside 2.7 h -> "L? / class?"
--                                                              for nearly every unregistered character
--     chat for missed-tick families, encounter windows (293 encounters, 1,369 player rows)
--   /admin/analytics             page_views, 7 d  12,242 rows read as 1,000
--   /admin/members               chat / contributions / who 30 d  36.6k / 32.9k / 84.7k rows read as 1,000
--   /admin/triggers              trigger_timing_feedback 30 d  48,252 rows read as 1,000 ("1,000 votes")
--
-- Every function here returns ONE jsonb value. A jsonb scalar is not a set, so the row cap does not
-- apply to it (who_directory_json in 20260709060000 is the precedent), however many entries it holds.
-- A set-returning function would be cut at 1,000 exactly like a table read.
--
-- Why aggregates and not paging: the queue banner runs on EVERY admin page. Paging 100k+ rows through
-- the REST gateway per view is egress we do not need to spend; these return a few hundred small
-- entries. Writes are cheap and reads are what bill (CLAUDE.md, Supabase).
--
-- Indexes (EXPLAIN ANALYZE on production, 2026-10-04): every function reads through an index that
-- already exists -- chat_messages_ts, chat_messages_channel_speaker_ts, who_obs_character_idx
-- (lower(character), observed_at desc), who_obs_observed_idx, encounters_started_idx,
-- encounter_players_pkey, page_views_viewed_at_idx, trigger_timing_feedback_name_idx. No new index.
--
-- SECURITY INVOKER: every table read is a plain table the caller could already read. Each page calls
-- through supabaseAdmin() (service_role), so the grant matches 20260718040000_lockdown_security_definer_rpcs.sql:
-- nothing for public/anon/authenticated, EXECUTE for service_role only.
--
-- Idempotent: CREATE OR REPLACE, REVOKE and GRANT all re-run cleanly.

-- ---------------------------------------------------------------------------------------------
-- /admin queue banner (web/lib/admin-queue.ts)
-- ---------------------------------------------------------------------------------------------

-- Guild + raid chat since p_since, one entry per speaker: message count and newest timestamp.
-- Grouped on the exact speaker (the old JS Map was keyed the same way). Feeds both "chat speakers
-- missing from OpenDKP" and "no class signal".
create or replace function public.admin_queue_chat_speakers(p_since timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('speaker', s.speaker, 'n', s.n, 'last', s.last_ts)
                            order by s.speaker), '[]'::jsonb)
  from (
    select c.speaker, count(*) as n, max(c.ts) as last_ts
    from chat_messages c
    where c.channel in ('guild', 'raid')
      and c.ts > p_since
    group by c.speaker
  ) s;
$$;

comment on function public.admin_queue_chat_speakers(timestamptz) is
  'Guild+raid chat newer than p_since as one jsonb array of {speaker, n, last}, one entry per exact speaker. A jsonb scalar, so PostgREST''s 1,000-row cap does not apply. Feeds the /admin review queue.';

-- Of p_names, the ones (lower-cased) that have at least one NON-anonymous /who row with a class since
-- p_since. The queue asks about the few hundred chat speakers it is judging, not every name /who
-- has ever seen, and each name is one probe of who_obs_character_idx.
create or replace function public.admin_queue_who_class_known(p_names text[], p_since timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(n.nm order by n.nm), '[]'::jsonb)
  from (select distinct lower(x) as nm from unnest(p_names) as x where x is not null) n
  where exists (
    select 1
    from who_observations o
    where lower(o."character") = n.nm
      and o.observed_at > p_since
      and o.anonymous = false
      and o.class is not null
  );
$$;

comment on function public.admin_queue_who_class_known(text[], timestamptz) is
  'The subset of p_names (lower-cased) with a non-anonymous /who row that carries a class newer than p_since, as a jsonb array of strings. One index probe per name (who_obs_character_idx). Feeds the /admin review queue.';

-- The newest /who row per name: level and class exactly as that row holds them (an /anon row carries
-- neither, and that is reported as it is). One jsonb array of {character, level, class, observed_at},
-- character lower-cased. Names with no row in the guild are omitted. A lateral per name reads
-- who_obs_character_idx (lower(character), observed_at desc) and stops at the first match; a
-- DISTINCT ON over the whole table would sort 161k rows for ~150 names.
create or replace function public.who_latest_per_character(p_guild text, p_names text[])
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('character', n.nm, 'level', w.level, 'class', w.class,
                                               'observed_at', w.observed_at)
                            order by n.nm), '[]'::jsonb)
  from (select distinct lower(x) as nm from unnest(p_names) as x where x is not null) n
  cross join lateral (
    select o.level, o.class, o.observed_at
    from who_observations o
    where lower(o."character") = n.nm
      and o.guild_id = p_guild
    order by o.observed_at desc, o.id desc
    limit 1
  ) w;
$$;

comment on function public.who_latest_per_character(text, text[]) is
  'Per name (lower-cased): level, class and observed_at of its NEWEST who_observations row in p_guild, as a jsonb array. Level/class are that row''s own values (null on an /anon row). Names with no row are omitted. Feeds /admin queue "Characters not in OpenDKP".';

-- Guild + raid chat timestamps (epoch ms) for p_speakers, restricted to the windows [p_lo[i], p_hi[i]]
-- and to ts >= p_since, as {lower(speaker): [ms, ...]}. The missed-tick check only ever asks "was this
-- family chatting between A and B", so the caller sends the windows it will ask about instead of
-- 30 days of every family member's chat. p_speakers may be in any case (matched on lower()).
create or replace function public.admin_queue_chat_times(
  p_speakers text[], p_since timestamptz, p_lo timestamptz[], p_hi timestamptz[])
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_object_agg(t.sp, t.ts_ms), '{}'::jsonb)
  from (
    select lower(c.speaker) as sp,
           jsonb_agg(floor(extract(epoch from c.ts) * 1000)::bigint order by c.ts) as ts_ms
    from (select distinct lower(x) as nm from unnest(p_speakers) as x where x is not null) n
    join chat_messages c
      on lower(c.speaker) = n.nm
     and c.channel in ('guild', 'raid')
     and c.ts >= p_since
    where exists (select 1 from unnest(p_lo, p_hi) as w(lo, hi) where c.ts between w.lo and w.hi)
    group by lower(c.speaker)
  ) t;
$$;

comment on function public.admin_queue_chat_times(text[], timestamptz, timestamptz[], timestamptz[]) is
  'Guild+raid chat timestamps (epoch ms) for p_speakers inside any window [p_lo[i], p_hi[i]] and at or after p_since, as one jsonb object {lower(speaker): [ms,...]}. Feeds the missed-tick corroboration in the /admin review queue.';

-- Epoch-ms start times of the encounters in any window [p_lo[i], p_hi[i]] that each of p_names took part
-- in, as {lower(character_name): [ms, ...]}. p_names are matched exactly (the caller passes the roster's
-- own spelling), which is how encounter_players_pkey (encounter_id, character_name) is probed.
create or replace function public.admin_queue_combat_times(
  p_guild text, p_names text[], p_lo timestamptz[], p_hi timestamptz[])
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_object_agg(t.nm, t.ts_ms), '{}'::jsonb)
  from (
    select lower(ep.character_name) as nm,
           jsonb_agg(floor(extract(epoch from enc.started_at) * 1000)::bigint order by enc.started_at) as ts_ms
    -- Window-first: the encounters inside the windows (encounters_started_idx, ~150 a raid), each once
    -- even where two windows overlap, then only those encounters' players.
    from (select distinct e.id, e.started_at
          from unnest(p_lo, p_hi) as w(lo, hi)
          join encounters e on e.started_at between w.lo and w.hi and e.guild_id = p_guild) enc
    join encounter_players ep on ep.encounter_id = enc.id
    where ep.character_name = any(p_names)
    group by lower(ep.character_name)
  ) t;
$$;

comment on function public.admin_queue_combat_times(text, text[], timestamptz[], timestamptz[]) is
  'Epoch-ms started_at of every encounter inside any window [p_lo[i], p_hi[i]] that each name in p_names (exact spelling) fought in, as one jsonb object {lower(name): [ms,...]}. Replaces a 300-encounter read plus an .in(300 uuids) read. Feeds the missed-tick check in the /admin review queue.';

-- ---------------------------------------------------------------------------------------------
-- /admin/analytics (web/app/admin/analytics/page.tsx)
-- ---------------------------------------------------------------------------------------------

-- Everything the page renders, for page_views since p_since, as ONE jsonb object:
--   total, unique_viewers, routes_seen, paths_seen     the four stat tiles
--   top_routes / top_paths  [{route|path, count, uniques}]  top 25 by views (ties: name)
--   top_users               [{user_id, count, last_seen}]   top 25 by views (ties: newest, then id)
--   by_day                  [{day 'YYYY-MM-DD' (UTC), count}] only days that have views
-- The page resolves the 25 user ids to nicknames itself and fills the empty days.
create or replace function public.page_view_stats(p_since timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with v as materialized (
    select pv.user_id, pv.path, pv.route, pv.viewed_at
    from page_views pv
    where pv.viewed_at >= p_since
  )
  select jsonb_build_object(
    'total',          (select count(*) from v),
    'unique_viewers', (select count(distinct user_id) from v),
    'routes_seen',    (select count(distinct route) from v),
    'paths_seen',     (select count(distinct path) from v),
    'top_routes', coalesce((
      select jsonb_agg(jsonb_build_object('route', t.route, 'count', t.n, 'uniques', t.u) order by t.n desc, t.route)
      from (select route, count(*) as n, count(distinct user_id) as u
            from v group by route order by n desc, route limit 25) t), '[]'::jsonb),
    'top_paths', coalesce((
      select jsonb_agg(jsonb_build_object('path', t.path, 'count', t.n, 'uniques', t.u) order by t.n desc, t.path)
      from (select path, count(*) as n, count(distinct user_id) as u
            from v group by path order by n desc, path limit 25) t), '[]'::jsonb),
    'top_users', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', t.user_id, 'count', t.n, 'last_seen', t.last_seen)
                       order by t.n desc, t.last_seen desc, t.user_id)
      from (select user_id, count(*) as n, max(viewed_at) as last_seen
            from v group by user_id order by n desc, last_seen desc, user_id limit 25) t), '[]'::jsonb),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', t.d, 'count', t.n) order by t.d)
      from (select to_char(viewed_at at time zone 'utc', 'YYYY-MM-DD') as d, count(*) as n
            from v group by 1) t), '[]'::jsonb)
  );
$$;

comment on function public.page_view_stats(timestamptz) is
  'page_views since p_since as one jsonb object: total, unique_viewers, routes_seen, paths_seen, top_routes/top_paths (25, {route|path,count,uniques}), top_users (25, {user_id,count,last_seen}), by_day ([{day (UTC),count}]). Feeds /admin/analytics.';

-- ---------------------------------------------------------------------------------------------
-- /admin/members (web/app/admin/members/page.tsx)
-- ---------------------------------------------------------------------------------------------

-- Chat messages since p_since per speaker (every channel, as the page counted), lower-cased:
-- [{speaker, n}]. The page maps a speaker to a Discord member through the roster.
create or replace function public.admin_members_chat_counts(p_since timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('speaker', t.sp, 'n', t.n) order by t.sp), '[]'::jsonb)
  from (select lower(c.speaker) as sp, count(*) as n
        from chat_messages c
        where c.ts >= p_since
        group by lower(c.speaker)) t;
$$;

comment on function public.admin_members_chat_counts(timestamptz) is
  'Chat messages at or after p_since per lower-cased speaker, every channel, as a jsonb array of {speaker, n}. Feeds /admin/members "Chat 30d".';

-- Parse contributions since p_since per (contributor Discord id, lower-cased character):
-- [{discord_id, character, n}]. Either may be null; the page takes the id when there is one and
-- looks the character up in the roster otherwise.
create or replace function public.admin_members_contrib_counts(p_since timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('discord_id', t.did, 'character', t.ch, 'n', t.n)
                            order by t.did nulls first, t.ch nulls first), '[]'::jsonb)
  from (select c.contributor_discord_id as did, lower(c.contributor_character) as ch, count(*) as n
        from contributions c
        where c.created_at >= p_since
        group by c.contributor_discord_id, lower(c.contributor_character)) t;
$$;

comment on function public.admin_members_contrib_counts(timestamptz) is
  'contributions at or after p_since per (contributor_discord_id, lower(contributor_character)), as a jsonb array of {discord_id, character, n}. Feeds /admin/members "Parses 30d".';

-- /who rows since p_since, restricted to characters on p_guild's roster (the page only ever looks a
-- character up in the roster, so the other ~3,000 names would be dead weight in the payload):
--   targets  [{character (lower), n}]            observations OF each roster character
--   seen     {uploader (lower): [character, ...]} distinct roster characters each of p_uploaders
--                                                 observed (uploaders are matched on lower())
create or replace function public.admin_members_who_counts(p_guild text, p_since timestamptz, p_uploaders text[])
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with roster as (
    select lower(ch.name) as nm from characters ch where ch.guild_id = p_guild
  ),
  w as materialized (
    select lower(o."character") as ch, lower(o.uploaded_by) as up
    from who_observations o
    where o.observed_at >= p_since
      and lower(o."character") in (select nm from roster)
  )
  select jsonb_build_object(
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object('character', t.ch, 'n', t.n) order by t.ch)
      from (select ch, count(*) as n from w group by ch) t), '[]'::jsonb),
    'seen', coalesce((
      select jsonb_object_agg(t.up, t.chs)
      from (select d.up, jsonb_agg(d.ch order by d.ch) as chs
            from (select distinct up, ch from w
                  where up = any(select lower(x) from unnest(p_uploaders) as x)) d
            group by d.up) t), '{}'::jsonb)
  );
$$;

comment on function public.admin_members_who_counts(text, timestamptz, text[]) is
  '/who rows at or after p_since limited to p_guild''s roster: {targets: [{character, n}], seen: {uploader: [character,...]}} with seen limited to p_uploaders. Feeds /admin/members "/who 30d" and the who-observation link suggestions.';

-- ---------------------------------------------------------------------------------------------
-- /admin/triggers (web/app/admin/triggers/page.tsx)
-- ---------------------------------------------------------------------------------------------

-- trigger_timing_feedback since p_since per (trigger, direction): [{name, direction, n, last_vote,
-- trigger_id}]. The page folds the directions into one row per trigger and decides the
-- recommendation, so the rule stays in one place (the page), not here. A blank name reads as
-- '(unknown)'. trigger_id is any one non-null id for the group (max(); the page does not render it,
-- and an ordered array_agg over 48k rows spilled a 4 MB sort to disk: 333 ms against 85 ms).
create or replace function public.trigger_timing_feedback_rollup(p_since timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', t.nm, 'direction', t.direction, 'n', t.n,
                                               'last_vote', t.last_vote, 'trigger_id', t.trigger_id)
                            order by t.nm, t.direction), '[]'::jsonb)
  from (
    select coalesce(nullif(btrim(f.trigger_name), ''), '(unknown)') as nm,
           f.direction,
           count(*) as n,
           max(f.voted_at) as last_vote,
           max(f.trigger_id) as trigger_id
    from trigger_timing_feedback f
    where f.voted_at >= p_since
    group by 1, 2
  ) t;
$$;

comment on function public.trigger_timing_feedback_rollup(timestamptz) is
  'trigger_timing_feedback at or after p_since per (trimmed trigger name, direction) as a jsonb array of {name, direction, n, last_vote, trigger_id}. Every direction is returned (earlier, good, too_early, dismissed, expired); the page decides which count as votes. Feeds /admin/triggers.';

-- ---------------------------------------------------------------------------------------------
-- Grants: service_role only (every caller is supabaseAdmin()).
-- ---------------------------------------------------------------------------------------------

revoke all on function public.admin_queue_chat_speakers(timestamptz) from public;
revoke all on function public.admin_queue_chat_speakers(timestamptz) from anon;
revoke all on function public.admin_queue_chat_speakers(timestamptz) from authenticated;
grant execute on function public.admin_queue_chat_speakers(timestamptz) to service_role;

revoke all on function public.admin_queue_who_class_known(text[], timestamptz) from public;
revoke all on function public.admin_queue_who_class_known(text[], timestamptz) from anon;
revoke all on function public.admin_queue_who_class_known(text[], timestamptz) from authenticated;
grant execute on function public.admin_queue_who_class_known(text[], timestamptz) to service_role;

revoke all on function public.who_latest_per_character(text, text[]) from public;
revoke all on function public.who_latest_per_character(text, text[]) from anon;
revoke all on function public.who_latest_per_character(text, text[]) from authenticated;
grant execute on function public.who_latest_per_character(text, text[]) to service_role;

revoke all on function public.admin_queue_chat_times(text[], timestamptz, timestamptz[], timestamptz[]) from public;
revoke all on function public.admin_queue_chat_times(text[], timestamptz, timestamptz[], timestamptz[]) from anon;
revoke all on function public.admin_queue_chat_times(text[], timestamptz, timestamptz[], timestamptz[]) from authenticated;
grant execute on function public.admin_queue_chat_times(text[], timestamptz, timestamptz[], timestamptz[]) to service_role;

revoke all on function public.admin_queue_combat_times(text, text[], timestamptz[], timestamptz[]) from public;
revoke all on function public.admin_queue_combat_times(text, text[], timestamptz[], timestamptz[]) from anon;
revoke all on function public.admin_queue_combat_times(text, text[], timestamptz[], timestamptz[]) from authenticated;
grant execute on function public.admin_queue_combat_times(text, text[], timestamptz[], timestamptz[]) to service_role;

revoke all on function public.page_view_stats(timestamptz) from public;
revoke all on function public.page_view_stats(timestamptz) from anon;
revoke all on function public.page_view_stats(timestamptz) from authenticated;
grant execute on function public.page_view_stats(timestamptz) to service_role;

revoke all on function public.admin_members_chat_counts(timestamptz) from public;
revoke all on function public.admin_members_chat_counts(timestamptz) from anon;
revoke all on function public.admin_members_chat_counts(timestamptz) from authenticated;
grant execute on function public.admin_members_chat_counts(timestamptz) to service_role;

revoke all on function public.admin_members_contrib_counts(timestamptz) from public;
revoke all on function public.admin_members_contrib_counts(timestamptz) from anon;
revoke all on function public.admin_members_contrib_counts(timestamptz) from authenticated;
grant execute on function public.admin_members_contrib_counts(timestamptz) to service_role;

revoke all on function public.admin_members_who_counts(text, timestamptz, text[]) from public;
revoke all on function public.admin_members_who_counts(text, timestamptz, text[]) from anon;
revoke all on function public.admin_members_who_counts(text, timestamptz, text[]) from authenticated;
grant execute on function public.admin_members_who_counts(text, timestamptz, text[]) to service_role;

revoke all on function public.trigger_timing_feedback_rollup(timestamptz) from public;
revoke all on function public.trigger_timing_feedback_rollup(timestamptz) from anon;
revoke all on function public.trigger_timing_feedback_rollup(timestamptz) from authenticated;
grant execute on function public.trigger_timing_feedback_rollup(timestamptz) to service_role;
